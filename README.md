# Backend Engineer Code Test — GraphQL API Server (TypeScript)

> **Language:** **English** · [简体中文](README.zh.md)

An **Apollo Server 5** GraphQL API in **TypeScript** (Node.js + Express 5) implementing the schema from
`Backend_Coding_Test/code_test_v1.pdf`, with the provided JSON files as an in-memory datasource. Every
request requires `Authorization: Bearer <token>`. Shared types live in [`src/types.ts`](./src/types.ts);
`npm run build` emits `dist/` (JS + `.d.ts`). More: [datasource mapping](./docs/data-mapping.md) ·
[Apollo Server 5 notes](./docs/apollo-notes.md) · [tests](./tests/README.md).

---

## 1. Quick start

```bash
npm install
npm start        # prestart runs `tsc`, then node dist/index.js
```

Then use `http://localhost:4000/graphql` (also `/`), Sandbox at `/`, health at `/health`, token
`backend-test-token`. Node.js **>= 20**; `npm start` builds first, so a fresh clone needs nothing else.

| Command | Purpose |
|---|---|
| `npm start` | build (`tsc`) + run `dist/index.js` |
| `npm run build` / `npm run typecheck` | compile to `dist/` / strict type check only |
| `npm run dev` | `tsx watch src/index.ts` (hot reload) |
| `npm test` / `npm run smoke` | rebuild + tests / end-to-end smoke check |

## 2. Token & Apollo Sandbox

| | |
|---|---|
| **Bearer token** | `backend-test-token` |
| Header | `Authorization: Bearer backend-test-token` |
| Override | `AUTH_TOKEN=my-secret npm start` (comma-separated list allowed) |

The token is printed by `npm start` and documented in [`.env.example`](./.env.example). Open
<http://localhost:4000/>, then **⚙ Connection settings → Shared headers**:

```json
{ "authorization": "Bearer backend-test-token" }
```

Only the Sandbox HTML page is public — every GraphQL operation (including introspection) needs that
header. Quick check: `curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'authorization: Bearer backend-test-token' -d '{"query":"{ node { _id name } }"}'`

## 3. HTTP API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/graphql` (also `/`) | Bearer | GraphQL endpoint |
| `GET` | `/graphql` | Bearer | GraphQL-over-HTTP queries (`?query=...`) |
| `GET` | `/` | public | Apollo Sandbox HTML (`Accept: text/html`) |
| `GET` | `/health` | public | Liveness probe + collection counts |

Missing/invalid token → **HTTP 401** with `extensions.code = "UNAUTHENTICATED"` (checked before body
parsing and again in the GraphQL context). Unknown paths → `404` JSON with `NOT_FOUND`.

## 4. Schema

Reproduced 1:1 from the PDF ([`src/schema/typeDefs.ts`](./src/schema/typeDefs.ts) is authoritative),
plus the two custom scalars the schema declares:

```graphql
scalar Long   # 64-bit integer → JSON number when safe, decimal string otherwise
scalar JSON   # arbitrary JSON, passed through untouched

type Action            { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  functionString: String  resourceTemplateId: ID  resourceTemplate: ResourceTemplate }
type Trigger           { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  functionString: String  resourceTemplateId: ID  resourceTemplate: ResourceTemplate }
type Response          { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  platforms: [ResponsePlatform] }
type ResponsePlatform  { integrationId: ID  build: Int  localeGroups: [ResponseLocaleGroup] }
type ResponseLocaleGroup { localeGroupId: ID  variations: [ResponseVariation] }
type ResponseVariation { name: String!  responses: JSON }
type ResourceTemplate  { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  schema: JSON  integrationId: String  functionString: String  key: String }
type NodeObject        { _id: ID!  createdAt: Long!  updatedAt: Long  name: String!  description: String  parents: [NodeObject]  parentIds: [ID]  root: Boolean  trigger: Trigger  triggerId: ID  responses: [Response]  responseIds: [ID]  actions: [Action]  actionIds: [ID]  priority: Float  compositeId: ID  global: Boolean  colour: String }
type Query             { node(nodeId: ID): NodeObject }
```

`node(nodeId)` → lookup by `_id`, then `compositeId`; omitted/null → the root node (`root: true`);
unknown → `null`.

## 5. Datasource → schema highlights

JSON in [`json/`](./json) is loaded once by [`src/data/store.ts`](./src/data/store.ts) and indexed by
`_id`; resolvers turn stored id references into objects.

| GraphQL field | Datasource | Mapping |
|---|---|---|
| `parentIds` / `parents` | `node.parents` | raw `compositeId` strings / resolved to nodes |
| `triggerId` / `trigger` | `node.trigger` | raw trigger id / resolved from `trigger.json` |
| `responseIds` / `responses` | `node.responses` | raw ids / resolved from `response.json` |
| `actionIds` / `actions` | `preActions` + `actions` + `postActions` | merged, de-duplicated (schema exposes one `actions` pair) |
| `localeGroupId` | `localeGroups[].localeGroup` | renamed |
| `Long` / `JSON` fields | epoch ms / JSON | JSON numbers / passed through untouched |
| `ResourceTemplate.createdAt`, `priority`, `colour` | partly missing | `createdAt` falls back to `updatedAt` (schema: `Long!`); the others are `null` |

Keys the schema does not expose are dropped and missing references resolve to `null`. Full field-by-field
table + 8 expected-result fixtures: [`docs/data-mapping.md`](./docs/data-mapping.md).

## 6. Project structure

```
Backend_Coding_Test_Demo/
├── json/                 # datasource (copied from Backend_Coding_Test/)
├── src/
│   ├── index.ts          # entry: listen + graceful shutdown
│   ├── server.ts         # Apollo 5 + Express 5 wiring, auth guard, health, 404/errors
│   ├── types.ts          # ALL shared type declarations (type-only module)
│   ├── config.ts         # AUTH_TOKEN / PORT / HOST / DATA_DIR / LANDING_PAGE
│   ├── auth.ts           # bearer-token extraction, constant-time check, 401 helpers
│   ├── scalars.ts        # custom Long + JSON scalars (no extra deps)
│   ├── data/store.ts     # load + index + type the JSON files
│   └── schema/           # typeDefs.ts (SDL) + resolvers.ts (typed as `Resolvers`)
├── tests/                # node:test suite (81 tests) against dist/, `npm test`
├── scripts/              # smoke.mjs + probe-http.mjs
├── docs/                 # data-mapping.md, apollo-notes.md, probes/
├── tsconfig.json
└── package.json
```

`src/types.ts` holds the datasource record types, `DataStore`, `AppConfig`, `GraphQLContext`, the
`Resolvers` contract and `AppServer` (used via `import type`, erased at runtime). `package.json`
`main`/`types` point at `dist/server.js`, so `createApp()` can be imported for embedding.

## 7. Tests & typecheck

```bash
npm run typecheck   # strict tsc — clean
npm test            # pretest builds, then 81 tests / 7 suites — all pass (~0.5 s)
npm run smoke       # 18 end-to-end checks against an in-process server
```

Tests boot a hermetic `createApp()` per file on an ephemeral port (no running server needed) and import
the compiled `dist/`. Coverage: token matrix, introspection/field sets, every node by `_id` and
`compositeId`, nested traversal, `Long`/`JSON` fidelity, HTTP/CSRF/CORS, lifecycle — see
[`tests/README.md`](./tests/README.md).

## 8. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `AUTH_TOKEN` | `backend-test-token` | accepted bearer token(s), comma-separated |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | HTTP port / bind address |
| `DATA_DIR` | `./json` | datasource directory |
| `LANDING_PAGE` | `true` | `false` disables the Sandbox HTML |
| `NODE_ENV` | — | `production` disables introspection/stack traces |

`.env` is not auto-loaded (no `dotenv`): `cp .env.example .env && npm run start:env` uses Node's
`--env-file`, or just export the variables.
