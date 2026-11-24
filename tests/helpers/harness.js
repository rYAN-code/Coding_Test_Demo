/**
 * Hermetic test harness for the GraphQL API.
 *
 * Every test file boots its own `createApp()` instance on an ephemeral port
 * (127.0.0.1:0), so the suite is independent of `npm start`, of port 4000 and
 * of any environment variable. Servers are always stopped in an `after` hook.
 */
import assert from 'node:assert/strict'

import { createApp } from '../../dist/server.js'

/** Token configured for the suite; deliberately different from the default. */
export const TEST_TOKEN = 'qa-suite-token-2f7b9c'

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

/**
 * Boot an isolated API instance.
 *
 * @param {object} [options]
 * @param {object} [options.config] extra config overrides (authToken/landingPage/...)
 * @param {object} [options.dataStore] optional datasource override
 */
export async function startServer(options = {}) {
  const { config = {}, dataStore } = options
  const app = await createApp({
    config: {
      authToken: TEST_TOKEN,
      landingPage: false,
      ...config,
    },
    ...(dataStore ? { dataStore } : {}),
  })
  const { url, port, host } = await app.listen({ port: 0, host: '127.0.0.1' })
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    server: app,
    url,
    baseUrl,
    port,
    host,
    config: app.config,
    dataStore: app.dataStore,
    endpoint: `${baseUrl}/graphql`,

    /** POST a GraphQL request through the `/graphql` endpoint. */
    graphql(query, variables, opts) {
      return gql(baseUrl, query, variables, opts)
    },

    /** Stop listening and dispose Apollo Server. */
    async close() {
      await app.stop()
    },
  }
}

/**
 * Low-level HTTP request helper.
 *
 * @param {string} baseUrl e.g. "http://127.0.0.1:1234"
 * @param {string} path path beginning with "/"
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.headers]
 * @param {any} [options.body] object -> JSON encoded, string -> sent as-is
 * @param {string|null} [options.token] when not null/undefined, adds `Authorization: Bearer <token>`
 */
export async function http(baseUrl, path, options = {}) {
  const { method = 'GET', headers = {}, body, token } = options
  const requestHeaders = { ...headers }
  if (token !== undefined && token !== null) requestHeaders.authorization = `Bearer ${token}`

  let payload
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Uint8Array) {
      payload = body
    } else {
      payload = JSON.stringify(body)
      if (!hasHeader(requestHeaders, 'content-type')) requestHeaders['content-type'] = 'application/json'
    }
  }

  const response = await fetch(new URL(path, baseUrl), { method, headers: requestHeaders, body: payload })
  const text = await response.text()
  let json
  try {
    json = text.length > 0 ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    text,
    json,
  }
}

/**
 * POST a GraphQL operation. `token: null` sends no Authorization header.
 *
 * @param {string} baseUrl
 * @param {string} query
 * @param {object} [variables]
 * @param {object} [opts]
 * @param {string|null} [opts.token]
 * @param {string} [opts.path] defaults to "/graphql"
 * @param {string} [opts.operationName]
 * @param {object} [opts.headers]
 * @param {any} [opts.body] body override (used for malformed-body tests)
 */
export function gql(baseUrl, query, variables, opts = {}) {
  const { token = TEST_TOKEN, path = '/graphql', operationName, headers = {}, body } = opts
  const payload =
    body !== undefined
      ? body
      : {
          query,
          ...(variables !== undefined ? { variables } : {}),
          ...(operationName !== undefined ? { operationName } : {}),
        }
  return http(baseUrl, path, { method: 'POST', headers, body: payload, token })
}

/** Assert a 200 GraphQL response without GraphQL errors and return `data`. */
export function expectData(result, label = 'GraphQL request') {
  assert.equal(result.status, 200, `${label}: expected HTTP 200, got ${result.status} (${result.text.slice(0, 500)})`)
  assert.equal(
    result.json?.errors,
    undefined,
    `${label}: unexpected GraphQL errors: ${JSON.stringify(result.json?.errors)?.slice(0, 800)}`,
  )
  assert.ok(result.json?.data !== undefined, `${label}: response has no "data" key`)
  return result.json.data
}

/** Assert the canonical 401/UNAUTHENTICATED envelope. */
export function expectUnauthenticated(result, label = 'unauthenticated request') {
  assert.equal(result.status, 401, `${label}: expected HTTP 401, got ${result.status} (${result.text.slice(0, 500)})`)
  assert.ok(result.json, `${label}: expected a JSON body, got ${JSON.stringify(result.text.slice(0, 200))}`)
  assert.ok(Array.isArray(result.json.errors), `${label}: expected an "errors" array`)
  assert.ok(result.json.errors.length > 0, `${label}: "errors" array is empty`)
  assert.equal(
    result.json.errors[0]?.extensions?.code,
    'UNAUTHENTICATED',
    `${label}: expected extensions.code UNAUTHENTICATED, got ${JSON.stringify(result.json.errors[0]?.extensions)}`,
  )
  assert.match(
    String(result.json.errors[0]?.message),
    /auth|token/i,
    `${label}: error message should mention authentication`,
  )
  return result.json
}

/** Assert a GraphQL response that carries errors (optionally with an HTTP status). */
export function expectGraphQLErrors(result, label = 'GraphQL error case') {
  assert.ok(
    Array.isArray(result.json?.errors) && result.json.errors.length > 0,
    `${label}: expected GraphQL errors, got status ${result.status} body ${result.text.slice(0, 500)}`,
  )
  return result.json.errors
}

export { assert }
