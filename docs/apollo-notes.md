# Apollo Server 5.5.2 — verified notes for `Backend_Coding_Test_Demo`

Status: **research complete** (Deliverable 1). Everything below marked **[verified]** was checked against the
*installed* packages (`node_modules`) and/or live runtime probes, not just docs prose. See
[`probes/probe-express.mjs`](./probes/probe-express.mjs) and [`probes/review-probe.mjs`](./probes/review-probe.mjs)
for the runnable evidence.

Installed ground truth **[verified]**:

| package | version |
| --- | --- |
| `@apollo/server` | 5.5.2 (`engines.node >= 20`, ESM+CJS, peer `graphql ^16.11.0`) |
| `graphql` | 16.15.0 |
| `express` | 5.3.0 |
| `@as-integrations/express5` | 1.1.2 (peer `@apollo/server ^4.0.0 || ^5.0.0`, `express ^5.0.0`, `engines.node >= 20`) |
| `cors` | 2.x |

Reference docs (Apollo renders these client-side; fetched page bodies were navigation-only, so the
authoritative source used here is the installed package source + probes):
<https://www.apollographql.com/docs/apollo-server/getting-started>,
<https://www.apollographql.com/docs/apollo-server/api/express-middleware>,
<https://www.apollographql.com/docs/apollo-server/api/standalone>,
<https://www.apollographql.com/docs/apollo-server/api/plugin/landing-pages>,
<https://www.apollographql.com/docs/apollo-server/security/authentication>,
<https://www.apollographql.com/docs/apollo-server/security/cors>,
<https://www.apollographql.com/docs/apollo-server/schema/custom-scalars>,
<https://www.apollographql.com/docs/apollo-server/api/plugin/drain-http-server>,
<https://www.apollographql.com/docs/apollo-server/migration>.

---

## 1. Entrypoints shipped by `@apollo/server@5.5.2` **[verified]**

From `node_modules/@apollo/server/package.json` `exports` — the *only* public subpaths are:

```
@apollo/server                       -> dist/esm|cjs/index.js        (ApolloServer, HeaderMap, all external types)
@apollo/server/errors                -> errors/index.js              (ApolloServerErrorCode, unwrapResolverError, ...)
@apollo/server/standalone            -> startStandaloneServer
@apollo/server/plugin/cacheControl
@apollo/server/plugin/disabled       -> ApolloServerPluginLandingPageDisabled(), ...InlineTraceDisabled(), etc.
@apollo/server/plugin/disableSuggestions
@apollo/server/plugin/drainHttpServer-> ApolloServerPluginDrainHttpServer({ httpServer, stopGracePeriodMillis })
@apollo/server/plugin/inlineTrace
@apollo/server/plugin/landingPage/default -> ApolloServerPluginLandingPageLocalDefault / ...ProductionDefault
@apollo/server/plugin/schemaReporting
@apollo/server/plugin/subscriptionCallback
@apollo/server/plugin/usageReporting
```

**There is no `@apollo/server/express4` / `@apollo/server/express5` subpath in v5** — importing one fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` **[verified by probe]**. Any AS4-era snippet importing the Express middleware from
the core package must be rewritten (see §2).

`HeaderMap` (a `Map<string,string>` subclass) is exported from the package root and is also what the Express 5
integration uses internally to build `HTTPGraphQLRequest.headers`.

## 2. Express 5 integration = separate package `@as-integrations/express5` **[verified]**

- Must be installed separately: `npm i @as-integrations/express5` (peer deps `@apollo/server ^4||^5`, `express ^5`).
- Import: `import { expressMiddleware } from '@as-integrations/express5'`.
- Signature: `expressMiddleware(server, { context }?) => express.RequestHandler`.
  Context function receives **`{ req: express.Request, res: express.Response }`** (Express request/response objects,
  not raw Node ones — unlike standalone).
- **`await server.start()` must happen before `expressMiddleware(server)`** — the integration calls
  `server.assertStarted()` and throws immediately otherwise.
- **A JSON body parser must run before it.** If `req.body` was never set (no `express.json()` in front), the
  integration short-circuits with HTTP **500** text: `` `req.body` is not set; this probably means you forgot to set up the `json` middleware before the Apollo Server middleware.``  (verified in its dist source).
- `cors()` must run before it too if browsers call the API.

Minimal wiring (this exact shape was executed successfully):

```js
import http from 'node:http'
import express from 'express'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'

const app = express()
const httpServer = http.createServer(app)
const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
})
await server.start()

app.use(cors())
app.use('/graphql', express.json(), expressMiddleware(server, {
  context: async ({ req }) => ({ token: req.headers.authorization?.replace(/^Bearer\s+/i, '') }),
}))
await new Promise((resolve) => httpServer.listen({ port: 4000 }, resolve))
```

## 3. `startStandaloneServer` (zero-extra-deps alternative) **[verified]**

Imported from `@apollo/server/standalone`. Options: `{ context?, listen? }`; `listen` is Node `ListenOptions`
(default `{ port: 4000 }`). Returns `{ url }` *after* binding.

```js
import { ApolloServer } from '@apollo/server'
import { startStandaloneServer } from '@apollo/server/standalone'
import { GraphQLError } from 'graphql'

const server = new ApolloServer({ typeDefs, resolvers })
const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async ({ req, res }) => {          // req: http.IncomingMessage, res: http.ServerResponse
    if (req.headers.authorization !== 'Bearer secret') {
      throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } })
    }
    return {}
  },
})
```

What it does for you (read from its source): adds `ApolloServerPluginDrainHttpServer` internally, uses
`body-parser.json({ limit: '50mb' })` and `cors()`, then calls `server.executeHTTPGraphQLRequest()`.
Trade-off: no custom routes, no per-route middleware, no fine-grained HTTP control. For a code test that only
needs one endpoint + Bearer auth it is the shortest path; for a `/health` route, custom 404s and per-route auth the
Express integration is the better fit.

## 4. HTTP 401 + `UNAUTHENTICATED` — how it actually works in AS5 **[verified]**

Mechanism (from `dist/esm/ApolloServer.js` + `errorNormalize.js`):

1. A GraphQLError whose `extensions.http` is an object with `status: <number>` (and optionally `headers: Map`) is
   recognised as an "HTTPGraphQLHead".
2. When the **context function throws**, `executeHTTPGraphQLRequest()` turns it into an HTTP response:
   `status = extensions.http.status ?? 500`, body `{"errors":[...]}`; `extensions.http` is **deleted from the
   response body** (so clients see only `code`).
3. If the thrown value is already a `GraphQLError`, its message is kept verbatim; a plain `Error` gets the
   `"Context creation failed: "` prefix and HTTP 500.
4. `includeStacktraceInErrorResponses: true` (dev) adds `extensions.stacktrace` to *all* GraphQL error bodies,
   including auth errors — disable it in production.

Verified response (context throw):

```http
HTTP/1.1 401 Unauthorized
content-type: application/json

{"errors":[{"message":"Missing or invalid Bearer token","extensions":{"code":"UNAUTHENTICATED"}}]}
```

### 4a. From a context function (recommended, Apollo-native)

```js
import { GraphQLError } from 'graphql'

function unauthenticated(message) {
  return new GraphQLError(message, {
    extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
    // optional: http: { status: 401, headers: new Map([['www-authenticate', 'Bearer']]) }
  })
}

const server = new ApolloServer({
  typeDefs, resolvers,
  csrfPrevention: { requestHeaders: ['authorization'] },   // see §6
})
// ... expressMiddleware(server, { context: async ({ req }) => {
//   const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
//   if (token !== AUTH_TOKEN) throw unauthenticated('Invalid bearer token')
//   return { dataStore, token }
// }})
```

`extensions.http.headers` must be a real `Map` (a `HeaderMap` is fine); a plain object is ignored.
`extensions.http.status` must be a `number`.

### 4b. From an Express middleware *before* Apollo

```js
app.all('/graphql', (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
  if (token !== AUTH_TOKEN) {
    res.status(401).set('www-authenticate', 'Bearer').json({
      errors: [{ message: 'Invalid bearer token', extensions: { code: 'UNAUTHENTICATED' } }],
    })
    return
  }
  next()
})
```

Gotcha for this style: if you build the body from a `GraphQLError`'s `extensions`, **strip `http` manually** — `error.extensions` contains `{ code, http: { status: 401 } }`, and unlike Apollo's own response path nothing removes
it, so it leaks into the JSON body (non-standard; Apollo strips it). Keep the body shape
`{"errors":[{message,extensions:{code}}]}` and, for browsers, send `WWW-Authenticate: Bearer`.

## 5. Landing page / Apollo Sandbox in AS5 **[verified]**

Key facts:

- `ApolloServerOptions` in v5 has **no `landingPage` option** (checked `externalTypes/constructor.d.ts`).
  The landing page is a *plugin*.
- **A landing page is served by default, even if you pass no plugin.** At `server.start()` Apollo Server
  implicitly appends `ApolloServerPluginLandingPageLocalDefault()` when
  `nodeEnv !== 'production'` (`nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? ''`) and
  `ApolloServerPluginLandingPageProductionDefault()` otherwise — unless a plugin with internal id
  `LandingPageDisabled` is present. **[verified in dist + probe]**
- `LocalDefault` defaults to `embed: true`, i.e. it serves **Apollo Sandbox embedded in an iframe**
  (`sandbox.embed.apollographql.com`); `ProductionDefault` defaults to `embed: false` (CDN landing page, no
  embedded explorer).
- It is served for **`GET` requests whose `Accept` negotiates `text/html`** (any path, not just `/`), with
  `content-type: text/html`. No auth, no CSRF check, no body needed.
- Only one plugin may implement `renderLandingPage`; an explicitly passed landing-page plugin suppresses the
  implicitly installed one (the implicit one is filtered out at startup — **no duplicate-plugin error**).
- **To disable it** you must pass `ApolloServerPluginLandingPageDisabled()` from
  `@apollo/server/plugin/disabled`; simply omitting the landing-page plugin does **not** disable it.

```js
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default'
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled'

const sandboxPlugin = ApolloServerPluginLandingPageLocalDefault({
  footer: false,            // hide footer
  embed: true,              // embedded Sandbox (default true for LocalDefault)
  // handy for reviewers: prefill the Authorization header in Sandbox:
  // initialState: { sharedHeaders: { Authorization: 'Bearer <token>' } },
})

new ApolloServer({
  typeDefs, resolvers,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    landingPageEnabled ? sandboxPlugin : ApolloServerPluginLandingPageDisabled(),
  ],
})
```

Browser/CSRF notes for the embedded Sandbox: the iframe origin
(`https://sandbox.embed.apollographql.com`) POSTs to your endpoint cross-origin with
`content-type: application/json` and an `Authorization` header the operator types into the Sandbox UI, which
triggers a CORS preflight — `cors()` default settings work (it reflects `Access-Control-Request-Headers`,
allow-origin `*`; verified preflight `204`).

## 6. CSRF prevention, preflight, and Bearer auth **[verified]**

Default in AS5: **enabled** (`csrfPrevention: undefined`/`true` — accepted marker headers
`['x-apollo-operation-name', 'apollo-require-preflight']`).

Exact rule (`dist/esm/preventCsrf.js`):

- Only enforced when the `content-type` header is **missing or one of**
  `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` (the browser-"simple" request types).
- In that case a request is accepted if it carries a non-empty `x-apollo-operation-name` **or**
  `apollo-require-preflight` header (or the list customised via
  `csrfPrevention: { requestHeaders: [...] }`).
- `content-type: application/json` (any non-simple type) is **exempt** — browsers must preflight such requests,
  so it is CSRF-safe by construction. Verified: `curl`/`fetch` with `content-type: application/json` and a Bearer
  token needs no extra header; form-urlencoded POST is blocked with HTTP 400 *unless* a marker header is present.

Options for this project:

- **Bearer token in the `Authorization` header (not cookies)** already prevents CSRF on authenticated calls:
  a cross-site HTML form cannot set the header, and `fetch()` with it triggers a preflight. Default CSRF
  prevention is then harmless for JSON clients and for Sandbox.
- If you want clients to be able to hit the endpoint with simple content types (e.g. `GET ?query=...`), configure a
  marker header such as `csrfPrevention: { requestHeaders: ['authorization'] }`. Effect: any request carrying the
  (mandatory) auth header bypasses the CSRF check — acceptable for header-token APIs, **not** if you also use
  cookie auth.
- CORS: `cors()` defaults (origin `*`, reflects requested headers, no credentials) are enough for Sandbox and
  `fetch`-based clients. If you add `credentials: true`, an explicit origin is required.

## 7. Custom scalars `Long` and `JSON` with graphql@16 (no extra deps) **[verified]**

`graphql@16.15.0` root exports `GraphQLScalarType`, `GraphQLError`, `Kind`, and `valueFromASTUntyped`
(verified). Minimal, round-trip-safe implementations:

```js
import { GraphQLError, GraphQLScalarType, Kind, valueFromASTUntyped } from 'graphql'

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)

function toBigInt(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new GraphQLError(`Long cannot represent non-integer: ${value}`)
    return BigInt(value)
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return BigInt(value.trim())
  throw new GraphQLError(`Long cannot represent value: ${JSON.stringify(value)}`)
}
const encodeLong = (v) => {
  const b = toBigInt(v)
  return b <= MAX_SAFE && b >= MIN_SAFE ? Number(b) : b.toString() // never return BigInt!
}

export const Long = new GraphQLScalarType({
  name: 'Long',
  serialize: encodeLong,
  parseValue: encodeLong,                 // GraphQL variables: numbers or decimal strings
  parseLiteral(ast) {
    if (ast.kind === Kind.INT) return encodeLong(ast.value)
    if (ast.kind === Kind.STRING) return encodeLong(ast.value)
    throw new GraphQLError(`Long cannot represent literal kind ${ast.kind}`)
  },
})

export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: (ast) => valueFromASTUntyped(ast), // handles OBJECT/LIST/STRING/INT/FLOAT/BOOLEAN/NULL/VARIABLE
})
```

Gotchas:

1. **SDL `scalar Long` with no resolver entry silently becomes an identity scalar.** graphql-js builds scalars
   declared in SDL with default `serialize`/`parseValue` identity and `parseLiteral` returning raw AST value (verified:
   `buildSchema('scalar Long ...').getType('Long').serialize(5) === 5`). So it "works" by accident and validates
   nothing — always pass `{ Long, JSON }` in the resolver map.
2. `serialize` must not return a `BigInt` — `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`.
   Convert to `number` when safe, else decimal `string`.
3. `parseLiteral` receives an AST node (`Kind.INT` / `Kind.STRING`), not a JS value; `Variable` nodes are handled by
   graphql-js through `parseValue`, not `parseLiteral`.
4. JSON numbers beyond `Number.MAX_SAFE_INTEGER` already lost precision inside `JSON.parse()` of the datasource;
   the Long scalar can only preserve precision for values passed as **strings**.
5. `JSON` scalar `parseValue`/`serialize` identity is fine because the value must already be JSON-serializable;
   `parseLiteral` must use `valueFromASTUntyped` (a naive `ast.value` returns `undefined` for object/list literals).
6. Resolver map keys must match the SDL scalar names exactly (`Long`, `JSON`), or Apollo throws
   "Type X is not defined in the schema" / the scalar stays identity.

## 8. Graceful shutdown **[verified]**

Use `ApolloServerPluginDrainHttpServer({ httpServer })` (exported from `@apollo/server/plugin/drainHttpServer`);
its `drainServer` hook runs on `apolloServer.stop()`, closes the HTTP server, ends idle sockets and (after
`stopGracePeriodMillis`, default `10_000`) destroys stragglers. Recommended order:

```js
async function stop() {
  await apolloServer.stop()      // plugin drains/closes httpServer
}
```

Calling `httpServer.close()` *before* `apolloServer.stop()` also works (the drain plugin's second `close()` resolves
even though Node passes `ERR_SERVER_NOT_RUNNING` to the callback), and double `stop()` is safe — but the manual
`close()` has no timeout, so rely on the drain plugin when in-flight requests may be slow.

## 9. AS4 → AS5 deltas that bite

- **Express middleware is no longer in the core package.** `import { expressMiddleware } from '@apollo/server/express5'`
  (a v4 pattern) fails on v5 with `ERR_PACKAGE_PATH_NOT_EXPORTED`; use `@as-integrations/express5` instead. The v5
  README calls framework integrations "community-maintained".
- Node **>= 20** required by `@apollo/server` 5.5.2 (`engines`).
- `graphql` peer range is `^16.11.0` (graphql 15 will not resolve).
- Landing page / CSRF / drain-plugin behaviour is otherwise the same v4→v5 shape, but the default landing page is a
  *plugin*; there is no `landingPage:` server option (there never was in v4 either — use the plugin or
  `ApolloServerPluginLandingPageDisabled()`).

## 10. Pointers for this repo (from the independent src review, 2026-11-22)

`src/server.ts` now uses the correct v5 wiring **[verified at runtime by booting the built `createApp()`]:**
`ApolloServerPluginDrainHttpServer` + explicit `ApolloServerPluginLandingPageLocalDefault` / 
`ApolloServerPluginLandingPageDisabled` pair (the disabled plugin is required — without it AS5 installs a landing
page implicitly even when the plugin array omits one), `express.json()` before `expressMiddleware`,
`server.start()` before mounting, `csrfPrevention: { requestHeaders: ['authorization'] }`, sandbox served with
HTTP 200 `text/html` on `GET /` + `Accept: text/html`, 401 `UNAUTHENTICATED` on missing/bad token, 200 on valid
token, CORS preflight 204, `stop()`/double-`stop()` safe.

Review items — resolution status (all four addressed by the Lead after the review):

- ✅ The Express 401 guard (`src/auth.ts`) no longer reuses `GraphQLError.extensions` verbatim: the body is now
  `{ errors: [{ message, extensions: { code: 'UNAUTHENTICATED' } }] }`, matching Apollo's own shape (no `http` hint).
- ✅ The GraphQL context now genuinely re-validates the request via `assertAuthenticated(req, config.authToken)`
  from `src/auth.ts` (defence in depth; it throws the mapped-to-401 `UNAUTHENTICATED` GraphQLError).
- ✅ The landing-page exemption is gated on `config.landingPage`, so with `LANDING_PAGE=false` a browser-style
  `GET /` returns `401` from the auth guard instead of Apollo's CSRF `400`.
- ✅ `stop()` now relies on `ApolloServerPluginDrainHttpServer` (`apolloServer.stop()` closes the HTTP server with its
  grace period); the manual `httpServer.close()` remains only as a fallback when the socket is somehow still open.

## 11. Probe evidence

- [`probes/probe-express.mjs`](./probes/probe-express.mjs) — full Express 5 + AS5 probe: landing page 200 HTML (embedded
  Sandbox), 401 UNAUTHENTICATED from context with `http.status`, valid-token query, Long/JSON scalar round-trip, CSRF
  block on form-urlencoded POST, CORS preflight 204, missing `@apollo/server/express5` subpath error.
- [`probes/review-probe.mjs`](./probes/review-probe.mjs) — boots the real compiled server (`dist/server.js`,
  built from `src/server.ts`) in-process: default landing page, 401 shapes, CSRF config, production introspection
  block, `LANDING_PAGE=false` behaviour, double `stop()`.

Run them from the project root after `npm run build` (they resolve `node_modules` upwards):

```bash
npm run build
node docs/probes/review-probe.mjs
node docs/probes/probe-express.mjs
```


