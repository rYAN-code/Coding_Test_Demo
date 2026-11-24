/**
 * Authentication matrix + public endpoints.
 *
 * Contract: every GraphQL operation (`POST /graphql`, `POST /`, GraphQL-over-GET)
 * requires `Authorization: Bearer <token>`. Missing, unknown, malformed or
 * non-Bearer credentials are rejected with HTTP 401 and GraphQL error code
 * UNAUTHENTICATED *before* execution. `GET /health` is public.
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

const NODE_QUERY = /* GraphQL */ `{ node { _id name } }`
const INTROSPECTION_QUERY = /* GraphQL */ `{ __schema { queryType { name } types { name } } }`

describe('authentication', () => {
  let server

  before(async () => {
    server = await startServer()
  })

  after(async () => {
    await server.close()
  })

  test('valid bearer token authenticates the request', async () => {
    const result = await gql(server.baseUrl, NODE_QUERY)
    const data = expectData(result, 'valid token')
    assert.equal(data.node._id, '6296be3470a0c1052f89cccb')
    assert.equal(data.node.name, 'Greeting Message')
  })

  test('request without an Authorization header -> 401 UNAUTHENTICATED', async () => {
    const result = await gql(server.baseUrl, NODE_QUERY, undefined, { token: null })
    expectUnauthenticated(result, 'no Authorization header')
  })

  test('wrong token -> 401 UNAUTHENTICATED', async () => {
    const result = await gql(server.baseUrl, NODE_QUERY, undefined, { token: 'definitely-not-the-token' })
    const body = expectUnauthenticated(result, 'wrong token')
    assert.equal(body.errors[0].message, 'Invalid bearer token')
  })

  test('the API default token is rejected when a different token is configured', async () => {
    // The suite boots with TEST_TOKEN; the committed default must not bypass it.
    const result = await gql(server.baseUrl, NODE_QUERY, undefined, { token: 'backend-test-token' })
    expectUnauthenticated(result, 'default token against overridden config')
  })

  test('malformed / non-Bearer Authorization headers -> 401 UNAUTHENTICATED', async () => {
    const malformed = [
      'Bearer', // no token
      'Bearer ', // trailing space only
      'Bearer    ', // whitespace only
      'Basic dXNlcjpwYXNz', // wrong scheme
      'Token abc123', // wrong scheme
      'backend-test-token', // raw token without scheme
      '', // empty header value
    ]
    for (const authorization of malformed) {
      const result = await gql(server.baseUrl, NODE_QUERY, undefined, {
        token: null,
        headers: { authorization },
      })
      expectUnauthenticated(result, `Authorization: ${JSON.stringify(authorization)}`)
    }
  })

  test('bearer scheme is accepted case-insensitively', async () => {
    const result = await gql(server.baseUrl, NODE_QUERY, undefined, {
      token: null,
      headers: { authorization: `bearer ${TEST_TOKEN}` },
    })
    const data = expectData(result, 'lowercase bearer scheme')
    assert.equal(data.node._id, '6296be3470a0c1052f89cccb')
  })

  test('introspection requires authentication', async () => {
    const result = await gql(server.baseUrl, INTROSPECTION_QUERY, undefined, { token: null })
    expectUnauthenticated(result, 'unauthenticated introspection')
    // Specifically: 401, never a 500 / partially executed operation.
    assert.notEqual(result.status, 500)
  })

  test('POST / (root path) is authenticated with the same rules', async () => {
    const anonymous = await gql(server.baseUrl, NODE_QUERY, undefined, { token: null, path: '/' })
    expectUnauthenticated(anonymous, 'POST / without token')

    const wrong = await gql(server.baseUrl, NODE_QUERY, undefined, { token: 'nope', path: '/' })
    expectUnauthenticated(wrong, 'POST / with wrong token')

    const valid = await gql(server.baseUrl, NODE_QUERY, undefined, { token: TEST_TOKEN, path: '/' })
    const data = expectData(valid, 'POST / with valid token')
    assert.equal(data.node._id, '6296be3470a0c1052f89cccb')
  })

  test('GraphQL-over-GET (?query=) requires authentication', async () => {
    const path = `/graphql?query=${encodeURIComponent(NODE_QUERY)}`
    const headers = { accept: 'application/json' }

    const anonymous = await http(server.baseUrl, path, { headers })
    expectUnauthenticated(anonymous, 'GET /graphql?query= without token')

    const valid = await http(server.baseUrl, path, { headers, token: TEST_TOKEN })
    const data = expectData(valid, 'GET /graphql?query= with token')
    assert.equal(data.node._id, '6296be3470a0c1052f89cccb')

    // CSRF prevention must accept the bearer token itself as the safe marker,
    // so no extra content-type/accept headers are required.
    const tokenOnly = await http(server.baseUrl, path, { token: TEST_TOKEN })
    const tokenOnlyData = expectData(tokenOnly, 'GET /graphql?query= with bearer token only (CSRF)')
    assert.equal(tokenOnlyData.node._id, '6296be3470a0c1052f89cccb')
  })

  test('authentication runs before body parsing (invalid JSON without token -> 401, not 400)', async () => {
    const result = await gql(server.baseUrl, null, undefined, { token: null, body: '{ this is not json' })
    expectUnauthenticated(result, 'malformed body without token')
  })

  test('GET /health is public and reports datasource collection sizes', async () => {
    const result = await http(server.baseUrl, '/health')
    assert.equal(result.status, 200)
    assert.match(String(result.headers['content-type']), /application\/json/)
    assert.equal(result.json.status, 'ok')
    assert.equal(result.json.service, 'backend-coding-test-demo')
    assert.equal(typeof result.json.uptimeSeconds, 'number')
    assert.deepEqual(result.json.collections, {
      nodes: source.nodes.length,
      triggers: source.triggers.length,
      responses: source.responses.length,
      actions: source.actions.length,
      resourceTemplates: source.resourceTemplates.length,
    })
  })

  test('401 body has the canonical GraphQL error envelope (no stacktrace/http hint leak)', async () => {
    const result = await gql(server.baseUrl, NODE_QUERY, undefined, { token: null })
    assert.equal(result.status, 401)
    assert.deepEqual(Object.keys(result.json), ['errors'])
    assert.equal(result.json.data, undefined)
    assert.ok(Array.isArray(result.json.errors) && result.json.errors.length === 1)

    const error = result.json.errors[0]
    assert.deepEqual(Object.keys(error).sort(), ['extensions', 'message'])
    assert.equal(typeof error.message, 'string')
    assert.deepEqual(Object.keys(error.extensions), ['code'])
    assert.equal(error.extensions.code, 'UNAUTHENTICATED')
    // Apollo strips its transport hint on its own error path; the Express guard
    // must not re-introduce it.
    assert.equal(error.extensions.http, undefined)
    assert.equal(error.extensions.stacktrace, undefined)
  })
})
