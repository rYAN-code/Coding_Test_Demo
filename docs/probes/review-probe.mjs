// Review probe: exercise the REAL compiled server wiring in-process (read-only usage).
// Run from Backend_Coding_Test_Demo after `npm run build`: node docs/probes/review-probe.mjs
import { createApp } from '../../dist/server.js'
import { config } from '../../dist/config.js'

const log = (name, value) => console.log('REVIEW', name, JSON.stringify(value))

const post = (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

// ---------- Case A: default config (landingPage: true, NODE_ENV unset) ----------
const a = await createApp()
const A = await a.listen({ port: 0, host: '127.0.0.1' })
log('A.listen', A)

// GET / as a browser (Sandbox)
{
  const r = await fetch(A.url, { headers: { accept: 'text/html' } })
  const t = await r.text()
  log('A.GET-/-html', { status: r.status, ct: r.headers.get('content-type'), sandbox: t.includes('sandbox.embed.apollographql.com') })
}
// POST /graphql no token
{
  const r = await post(`${A.url}graphql`, { query: '{ node { _id } }' })
  log('A.401-no-token', { status: r.status, body: await r.json() })
}
// POST /graphql wrong token
{
  const r = await post(`${A.url}graphql`, { query: '{ node { _id } }' }, { authorization: 'Bearer nope' })
  log('A.401-wrong-token', { status: r.status, body: await r.json() })
}
// POST /graphql valid token
{
  const r = await post(`${A.url}graphql`, { query: '{ node { _id name } }' }, { authorization: `Bearer ${config.authToken}` })
  log('A.200-valid', { status: r.status, data: (await r.json()).data })
}
// CSRF: form-urlencoded + valid token
{
  const r = await post(`${A.url}graphql`, 'query=%7B+node+%7B+_id+%7D+%7D', {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Bearer ${config.authToken}`,
  })
  log('A.csrf-form', { status: r.status, body: (await r.text()).slice(0, 160) })
}
// malformed JSON
{
  const r = await post(`${A.url}graphql`, '{"query":', { authorization: `Bearer ${config.authToken}` })
  log('A.bad-json', { status: r.status, body: (await r.text()).slice(0, 160) })
}
// 404 fallback
{
  const r = await fetch(`${A.url}nope`)
  log('A.404', { status: r.status, body: (await r.json()).errors?.[0]?.message?.slice(0, 80) })
}
// health
{
  const r = await fetch(`${A.url}health`)
  log('A.health', { status: r.status, ok: r.ok })
}
// preflight
{
  const r = await fetch(`${A.url}graphql`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://sandbox.embed.apollographql.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, authorization, apollo-require-preflight',
    },
  })
  log('A.preflight', { status: r.status, allowOrigin: r.headers.get('access-control-allow-origin'), allowHeaders: r.headers.get('access-control-allow-headers') })
}
await a.stop()
log('A.stop', 'ok')
// double stop must not throw / hang
try {
  await a.stop()
  log('A.double-stop', 'ok')
} catch (e) {
  log('A.double-stop', { threw: String(e) })
}

// ---------- Case B: landingPage: false (what scripts/smoke.mjs uses) ----------
const b = await createApp({ config: { ...config, landingPage: false } })
const B = await b.listen({ port: 0, host: '127.0.0.1' })
{
  const r = await fetch(B.url, { headers: { accept: 'text/html' } })
  const t = await r.text()
  log('B.LANDING_PAGE=false-GET-/-html', {
    status: r.status,
    ct: r.headers.get('content-type'),
    stillServesSandbox: t.includes('sandbox.embed.apollographql.com'),
    landedHtml: t.slice(0, 60).replace(/\s+/g, ' '),
  })
}
await b.stop()
log('B.stop', 'ok')

// ---------- Case C: production flags ----------
const c = await createApp({ config: { ...config, isProduction: true, landingPage: false } })
const C = await c.listen({ port: 0, host: '127.0.0.1' })
{
  const r = await post(`${C.url}graphql`, { query: '{ __schema { queryType { name } } }' }, { authorization: `Bearer ${config.authToken}` })
  const j = await r.json()
  log('C.prod-introspection', { status: r.status, errors: j.errors?.map((e) => e.message) })
}
{
  const r = await fetch(C.url, { headers: { accept: 'text/html' } })
  const t = await r.text()
  log('C.prod-GET-/-html', { status: r.status, ct: r.headers.get('content-type'), length: t.length })
}
await c.stop()
log('C.stop', 'ok')
console.log('DONE review probe')
