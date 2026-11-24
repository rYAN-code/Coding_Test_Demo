/**
 * Ad-hoc HTTP probe used by the Lead to verify the *real* entry point
 * (`node dist/index.js`) over the wire. Not part of `npm test`.
 *
 *   node scripts/probe-http.mjs [baseUrl]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:4000'
const token = process.env.AUTH_TOKEN ?? 'backend-test-token'
const endpoint = `${base.replace(/\/$/, '')}/graphql`

let failures = 0
function ok(name, cond, detail) {
  console.log(`${cond ? '✔' : '✘'} ${name}${cond || detail === undefined ? '' : ` -> ${JSON.stringify(detail).slice(0, 300)}`}`)
  if (!cond) failures += 1
}

async function gql(body, { token: t, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers }
  if (t) h.authorization = `Bearer ${t}`
  const res = await fetch(endpoint, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, text }
}

console.log(`Probing ${endpoint}\n`)

const noAuth = await gql({ query: '{ node { _id } }' })
ok('POST /graphql without token -> 401', noAuth.status === 401, noAuth)
ok('401 body has UNAUTHENTICATED', noAuth.json?.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED', noAuth.json)

const bad = await gql({ query: '{ node { _id } }' }, { token: 'nope' })
ok('wrong token -> 401', bad.status === 401, bad)

const malformed = await gql('{"query":', { token })
ok('malformed JSON body -> 400 (not 500)', malformed.status === 400, malformed)

const basic = await gql({ query: '{ node { _id } }' }, { headers: { authorization: `Basic ${token}` } })
ok('Basic auth header -> 401', basic.status === 401, basic)

const good = await gql({ query: '{ node { _id name root } }' }, { token })
ok('valid token -> 200 + root node', good.status === 200 && good.json?.data?.node?.root === true, good)

const health = await fetch(`${base.replace(/\/$/, '')}/health`)
const healthJson = await health.json()
ok('GET /health -> 200 public', health.status === 200 && healthJson.status === 'ok', healthJson)

const notFound = await fetch(`${base.replace(/\/$/, '')}/does-not-exist`, { headers: { authorization: `Bearer ${token}` } })
ok('unknown path -> 404 JSON', notFound.status === 404, notFound.status)

const sandbox = await fetch(`${base.replace(/\/$/, '')}/`, { headers: { accept: 'text/html' } })
const sandboxText = await sandbox.text()
ok('GET / (Accept: text/html) -> Sandbox HTML', sandbox.status === 200 && /<html/i.test(sandboxText), sandbox.status)

const getQuery = await fetch(`${endpoint}?query=${encodeURIComponent('{ node { _id } }')}`, { headers: { authorization: `Bearer ${token}` } })
const getJson = await getQuery.json()
ok('GET /graphql?query= with token -> 200', getQuery.status === 200 && getJson?.data?.node?._id, getJson)

const rootPath = await gql({ query: '{ node { _id } }' }, { token })
ok('POST / (root path) -> 200', rootPath.status === 200, rootPath.status)

const preflight = await fetch(endpoint, {
  method: 'OPTIONS',
  headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
})
ok('CORS preflight is allowed without auth', preflight.status === 204 || preflight.status === 200, preflight.status)

const deep = await gql(
  {
    query: `query($id: ID){
      node(nodeId: $id) {
        _id name root global compositeId createdAt priority colour
        parentIds parents { _id name }
        triggerId trigger { _id name description resourceTemplate { _id name key integrationId schema } }
        responseIds responses { _id name platforms { integrationId build localeGroups { localeGroupId variations { name responses } } } }
        actionIds actions { _id name resourceTemplateId resourceTemplate { _id name } }
      }
    }`,
    variables: { id: '6297172e70a0c165b989cd10' },
  },
  { token },
)
ok('deep node query -> 200 without errors', deep.status === 200 && !deep.json?.errors, deep.json)
console.log('   deep payload:', JSON.stringify(deep.json?.data?.node)?.slice(0, 900))

console.log(`\n${failures === 0 ? 'All HTTP probes passed.' : `${failures} probe(s) FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
