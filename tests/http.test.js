/**
 * HTTP surface, landing page and server lifecycle.
 *
 * Covers: POST / compatibility path, 404 JSON fallback, preflight/CORS,
 * malformed requests, Apollo Sandbox HTML on GET / (enabled + disabled),
 * and the documented createApp()/listen()/stop() lifecycle contract.
 */
import { after, before, describe, test } from 'node:test'

import {
  TEST_TOKEN,
  assert,
  expectData,
  expectUnauthenticated,
  gql,
  http,
  startServer,
} from './helpers/harness.js'
import { source } from './helpers/fixtures.js'
import { createApp } from '../dist/server.js'

describe('HTTP surface (landing page disabled)', () => {
  let server

  before(async () => {
    server = await startServer() // harness default: landingPage: false
  })

  after(async () => {
    await server.close()
  })

  test('POST /graphql is the canonical endpoint', async () => {
    const result = await gql(server.baseUrl, `{ node { _id name } }`)
    const data = expectData(result, 'POST /graphql')
    assert.equal(data.node._id, '6296be3470a0c1052f89cccb')
  })

  test('POST / is an equivalent GraphQL endpoint', async () => {
    const result = await gql(server.baseUrl, `{ node { _id name } }`, undefined, { path: '/' })
    const data = expectData(result, 'POST /')
    assert.equal(data.node._id, '6296be3470a0c1052f89cccb')
    assert.equal(data.node.name, 'Greeting Message')

    const anonymous = await gql(server.baseUrl, `{ node { _id } }`, undefined, { path: '/', token: null })
    expectUnauthenticated(anonymous, 'POST / without token')
  })

  test('landingPage:false: browser-style GET / is rejected by the auth guard (401, not 200 HTML)', async () => {
    const result = await http(server.baseUrl, '/', { headers: { accept: 'text/html' } })
    expectUnauthenticated(result, 'GET / with landing page disabled')
    assert.equal(/text\/html/i.test(String(result.headers['content-type'] ?? '')), false)
    assert.equal(/<html/i.test(result.text), false, 'body must not contain the Sandbox HTML document')
    assert.equal(/apollo server/i.test(result.text), false, 'body must not be the Apollo landing page')
  })

  test('GET / with JSON accept and no token -> 401', async () => {
    const result = await http(server.baseUrl, '/', { headers: { accept: 'application/json' } })
    expectUnauthenticated(result, 'GET / as JSON without token')
  })

  test('unknown path -> 404 JSON NOT_FOUND (with token)', async () => {
    const result = await http(server.baseUrl, '/definitely-not-a-route', { token: TEST_TOKEN })
    assert.equal(result.status, 404)
    assert.ok(Array.isArray(result.json?.errors) && result.json.errors.length > 0)
    assert.equal(result.json.errors[0].extensions.code, 'NOT_FOUND')
    assert.match(result.json.errors[0].message, /\/definitely-not-a-route/)
  })

  test('unknown path is still a JSON 404 (not an HTML error page)', async () => {
    const result = await http(server.baseUrl, '/definitely-not-a-route')
    assert.equal(result.status, 404)
    assert.match(String(result.headers['content-type']), /application\/json/)
    assert.equal(result.json.errors[0].extensions.code, 'NOT_FOUND')
  })

  test('malformed JSON body with a valid token -> 400 BAD_REQUEST (not 500)', async () => {
    const result = await gql(server.baseUrl, null, undefined, { body: '{ this is not json' })
    assert.equal(result.status, 400, `expected 400, got ${result.status}: ${result.text.slice(0, 300)}`)
    assert.ok(Array.isArray(result.json?.errors) && result.json.errors.length > 0)
    assert.equal(result.json.errors[0].extensions.code, 'BAD_REQUEST')
  })

  test('GraphQL validation error -> 400 GRAPHQL_VALIDATION_FAILED', async () => {
    const result = await gql(server.baseUrl, `{ node { definitelyNotAField } }`)
    assert.equal(result.status, 400)
    assert.ok(Array.isArray(result.json?.errors) && result.json.errors.length > 0)
    assert.equal(result.json.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED')
  })

  test('GraphQL syntax error -> 400 GRAPHQL_PARSE_FAILED', async () => {
    const result = await gql(server.baseUrl, `{ node { _id `)
    assert.equal(result.status, 400)
    assert.ok(Array.isArray(result.json?.errors) && result.json.errors.length > 0)
    assert.equal(result.json.errors[0].extensions.code, 'GRAPHQL_PARSE_FAILED')
  })

  test('CORS preflight OPTIONS is answered without authentication', async () => {
    const result = await http(server.baseUrl, '/graphql', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    })
    assert.ok(
      result.status === 200 || result.status === 204,
      `expected a 200/204 preflight response, got ${result.status}`,
    )
    assert.equal(result.headers['access-control-allow-origin'], '*')
  })

  test('GET /health stays public on this instance too', async () => {
    const result = await http(server.baseUrl, '/health')
    assert.equal(result.status, 200)
    assert.equal(result.json.status, 'ok')
  })
})

describe('Apollo Sandbox landing page (landingPage: true)', () => {
  let server

  before(async () => {
    server = await startServer({ config: { landingPage: true } })
  })

  after(async () => {
    await server.close()
  })

  test('GET / with Accept: text/html returns Sandbox HTML without a token', async () => {
    const result = await http(server.baseUrl, '/', { headers: { accept: 'text/html' } })
    assert.equal(result.status, 200)
    assert.match(String(result.headers['content-type']), /text\/html/)
    assert.match(result.text, /<html/i)
    assert.match(result.text.toLowerCase(), /apollo/)
  })

  test('the Sandbox HTML contains no data (GraphQL still needs the token)', async () => {
    const html = await http(server.baseUrl, '/', { headers: { accept: 'text/html' } })
    assert.equal(html.text.includes('6296be3470a0c1052f89cccb'), false)
    expectUnauthenticated(await gql(server.baseUrl, `{ node { _id } }`, undefined, { token: null }))
  })
})

describe('server lifecycle (createApp / listen / stop)', () => {
  test('createApp exposes the documented API contract', async () => {
    const app = await createApp()
    try {
      for (const key of ['app', 'httpServer', 'apolloServer', 'dataStore', 'config', 'listen', 'stop']) {
        assert.ok(key in app, `createApp() result is missing "${key}"`)
      }
      assert.equal(typeof app.listen, 'function')
      assert.equal(typeof app.stop, 'function')
      assert.ok(Array.isArray(app.dataStore.nodes))
      assert.equal(app.dataStore.nodes.length, source.nodes.length)
      assert.equal(app.dataStore.triggers.length, source.triggers.length)
      assert.equal(app.dataStore.responses.length, source.responses.length)
      assert.equal(app.dataStore.actions.length, source.actions.length)
      assert.equal(app.dataStore.resourceTemplates.length, source.resourceTemplates.length)
      assert.equal(app.dataStore.rootNode._id, '6296be3470a0c1052f89cccb')

      const listening = await app.listen({ port: 0, host: '127.0.0.1' })
      assert.ok(Number.isInteger(listening.port) && listening.port > 0, 'listen() must report the bound port')
      assert.equal(listening.host, '127.0.0.1')
      assert.equal(listening.url, `http://127.0.0.1:${listening.port}/`)
    } finally {
      await app.stop()
    }
  })

  test('config overrides are honoured (authToken) and ephemeral ports are unique', async () => {
    const first = await startServer({ config: { authToken: 'lifecycle-token-a' } })
    const second = await startServer({ config: { authToken: 'lifecycle-token-b' } })
    try {
      assert.equal(first.server.config.authToken, 'lifecycle-token-a')
      assert.notEqual(first.port, second.port)

      // Token isolation: token A is rejected by server B and vice versa.
      expectUnauthenticated(
        await gql(second.baseUrl, '{ node { _id } }', undefined, { token: 'lifecycle-token-a' }),
        'server B rejects server A token',
      )
      expectData(
        await gql(second.baseUrl, '{ node { _id } }', undefined, { token: 'lifecycle-token-b' }),
        'server B accepts its own token',
      )
    } finally {
      await first.close()
      await second.close()
    }
  })

  test('stop() closes the listener, frees the port and is safe to call twice', async () => {
    const server = await startServer()
    const { baseUrl } = server
    // Sanity: reachable before stop.
    expectData(await gql(baseUrl, '{ node { _id } }'), 'reachable before stop')

    const startedAt = Date.now()
    await server.close()
    const elapsed = Date.now() - startedAt
    assert.ok(elapsed < 5000, `stop() should resolve promptly, took ${elapsed}ms`)

    // Double-stop must resolve without throwing (graceful-shutdown hook safety).
    await server.close()
    await server.close()

    await assert.rejects(
      async () => {
        await fetch(`${baseUrl}/health`)
      },
      (error) => {
        // fetch wraps ECONNREFUSED in a TypeError with a `cause`.
        assert.match(String(error?.message ?? error), /fetch failed|ECONNREFUSED/i)
        return true
      },
      'requests after stop() must be refused',
    )
  })
})
