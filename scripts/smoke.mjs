#!/usr/bin/env node
/**
 * Manual smoke test — boots the API in-process on an ephemeral port and runs a
 * handful of real HTTP requests against it. Useful as a fast "does it work?"
 * check and as executable documentation of the API contract.
 *
 *   node scripts/smoke.mjs
 */
import { createApp } from '../dist/server.js'
import { config } from '../dist/config.js'

const TOKEN = config.authToken
let failures = 0

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`)
  } else {
    failures += 1
    console.log(`  ✘ ${name}${detail === undefined ? '' : `  ->  ${JSON.stringify(detail).slice(0, 400)}`}`)
  }
}

async function post(url, body, { token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: res.status, json }
}

const server = await createApp({ config: { ...config, landingPage: false } })
const { url } = await server.listen({ port: 0, host: '127.0.0.1' })
const endpoint = `${url}graphql`
console.log(`\nSmoke testing ${endpoint}\n`)

try {
  // 1. Authentication -------------------------------------------------------
  const anonymous = await post(endpoint, { query: '{ node { _id } }' })
  check('no token -> HTTP 401', anonymous.status === 401, anonymous)
  check(
    'no token -> UNAUTHENTICATED',
    anonymous.json?.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED',
    anonymous.json,
  )

  const badToken = await post(endpoint, { query: '{ node { _id } }' }, { token: 'nope' })
  check('wrong token -> HTTP 401', badToken.status === 401, badToken)

  const health = await fetch(`${url}health`)
  check('GET /health is public -> 200', health.status === 200)

  // 2. Schema ---------------------------------------------------------------
  const introspection = await post(
    endpoint,
    {
      query: `{
        __schema { types { name } queryType { name } }
      }`,
    },
    { token: TOKEN },
  )
  const typeNames = new Set((introspection.json?.data?.__schema?.types ?? []).map((t) => t.name))
  const expectedTypes = [
    'Action',
    'Trigger',
    'Response',
    'ResponsePlatform',
    'ResponseLocaleGroup',
    'ResponseVariation',
    'ResourceTemplate',
    'NodeObject',
    'Query',
    'Long',
    'JSON',
  ]
  check('introspection exposes schema types', expectedTypes.every((name) => typeNames.has(name)), [
    ...typeNames,
  ])

  // 3. Root node ------------------------------------------------------------
  const root = await post(
    endpoint,
    {
      query: `{
        node {
          _id name root global compositeId
          description
          createdAt updatedAt
          triggerId
          trigger { _id name resourceTemplateId resourceTemplate { _id name key integrationId } }
          parentIds
          parents { _id name }
          responseIds
          responses { _id name platforms { integrationId build localeGroups { localeGroupId variations { name responses } } } }
          actionIds
          actions { _id name resourceTemplate { _id name } }
          priority colour
        }
      }`,
    },
    { token: TOKEN },
  )
  check('root node query succeeds', root.status === 200 && !root.json?.errors, root.json)
  const rootNode = root.json?.data?.node
  check('root node is the node flagged root:true', rootNode?._id === '6296be3470a0c1052f89cccb', rootNode)
  check('root node name is "Greeting Message"', rootNode?.name === 'Greeting Message', rootNode?.name)
  check('root node createdAt is a number (Long scalar)', rootNode?.createdAt === 1654046260304, rootNode?.createdAt)

  // 4. Node by id ----------------------------------------------------------
  const userEmail = await post(
    endpoint,
    {
      query: `query Node($nodeId: ID) {
        node(nodeId: $nodeId) {
          _id name parentIds parents { _id name compositeId }
          triggerId trigger { _id name }
          responseIds responses { _id name }
          actionIds actions { _id name resourceTemplate { _id name } }
        }
      }`,
      variables: { nodeId: '6297172e70a0c165b989cd10' },
    },
    { token: TOKEN },
  )
  check('node by id succeeds', userEmail.status === 200 && !userEmail.json?.errors, userEmail.json)
  const node = userEmail.json?.data?.node
  check('node by id returns "User\'s Email"', node?.name === "User's Email", node?.name)
  check(
    'parentIds keep raw compositeIds',
    JSON.stringify(node?.parentIds) === JSON.stringify(['rCMUtmL3aOULyqBL']),
    node?.parentIds,
  )
  check(
    'parents resolve compositeId -> node',
    node?.parents?.[0]?._id === '6297164810f52524ba1a9300',
    node?.parents,
  )
  check('actions resolve to the Send Email action', node?.actions?.[0]?.name === 'Send Email Action', node?.actions?.[0])

  // 5. Unknown node -> null -------------------------------------------------
  const unknown = await post(
    endpoint,
    { query: '{ node(nodeId: "does-not-exist") { _id } }' },
    { token: TOKEN },
  )
  check('unknown nodeId -> null', unknown.status === 200 && unknown.json?.data?.node === null, unknown.json)

  // 6. Root alias path POST / ----------------------------------------------
  const rootPath = await post(url, { query: '{ node { _id } }' }, { token: TOKEN })
  check('POST / (root path) works too', rootPath.status === 200 && rootPath.json?.data?.node?._id === rootNode?._id, rootPath.json)

  // 7. Non-null Long with a missing source value ---------------------------
  //    The two trigger resource templates have no `createdAt` in the JSON, but
  //    the schema declares `createdAt: Long!`; the resolver falls back to
  //    `updatedAt` so the query never fails.
  const templateCreatedAt = await post(
    endpoint,
    {
      query: `{
        node(nodeId: "6297164810f52524ba1a9300") {
          name
          trigger { name resourceTemplate { _id name createdAt updatedAt } }
        }
      }`,
    },
    { token: TOKEN },
  )
  check(
    'trigger.resourceTemplate.createdAt is non-null (updatedAt fallback)',
    templateCreatedAt.status === 200 &&
      !templateCreatedAt.json?.errors &&
      templateCreatedAt.json?.data?.node?.trigger?.resourceTemplate?.createdAt === 1727122901548,
    templateCreatedAt.json,
  )
} finally {
  await server.stop()
}

// 8. LANDING_PAGE=false disables the Sandbox HTML ---------------------------
const noLanding = await createApp({ config: { ...config, landingPage: false } })
const noLandingUrl = await noLanding.listen({ port: 0, host: '127.0.0.1' })
try {
  const res = await fetch(noLandingUrl.url, { headers: { accept: 'text/html' } })
  const body = await res.text()
  check('LANDING_PAGE=false disables the Sandbox HTML', res.status !== 200 || !/<html/i.test(body), res.status)
} finally {
  await noLanding.stop()
}

console.log(`\n${failures === 0 ? 'All smoke checks passed.' : `${failures} smoke check(s) FAILED.`}\n`)
process.exit(failures === 0 ? 0 : 1)
