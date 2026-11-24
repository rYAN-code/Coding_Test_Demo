# Datasource → GraphQL schema mapping (acceptance contract)

**Project:** `Backend_Coding_Test_Demo` — Apollo Server 5 GraphQL API for the Backend Engineer code test.
**Datasource:** the five JSON files in `Backend_Coding_Test_Demo/json/` (byte-identical copies of `Backend_Coding_Test/*.json`, SHA-256 verified).
**Required schema:** the `type Action / Trigger / Response / ResponsePlatform / ResponseLocaleGroup / ResponseVariation / ResourceTemplate / NodeObject / Query` SDL from the code-test PDF (reproduced 1:1 in `src/schema/typeDefs.ts`, plus the `Long` and `JSON` custom scalars the SDL relies on).
**Status:** this document is the acceptance contract for the resolvers and tests. The 8 canonical fixtures in §4 were executed against the running API on 2026-11-22 and **8/8 matched exactly** (plus the edge-case probes in §3/§5). If `src/` changes, re-run them.
**Owner:** data-mapping-analyst (task-2). Path: `Backend_Coding_Test_Demo/docs/data-mapping.md`.

Request assumptions for every fixture below:

* `POST http://<host>:<port>/graphql` (also mounted at `POST /`), `Content-Type: application/json`.
* Header `Authorization: Bearer <AUTH_TOKEN>`; default token is `backend-test-token` (`AUTH_TOKEN` env overrides; see `src/config.ts`). Missing/wrong token → HTTP 401 with `errors[0].extensions.code === "UNAUTHENTICATED"`.
* A successful GraphQL execution returns HTTP 200 with a body containing `data` and **no** `errors` key. Object fields are serialized in selection-set order (fixtures below are written in that order; structural deep-equality is key-order agnostic).
* Fixture queries are read-only; they require no seeding and no network access beyond localhost.

---

## 0. Collection → GraphQL type overview

| File | Records | GraphQL type(s) |
|---|---|---|
| `json/node.json` | 7 | `NodeObject` (+ id links resolved to `Trigger`, `Response`, `Action`, `NodeObject`) |
| `json/trigger.json` | 5 | `Trigger` |
| `json/response.json` | 5 | `Response`, `ResponsePlatform`, `ResponseLocaleGroup`, `ResponseVariation` |
| `json/action.json` | 1 | `Action` |
| `json/resourceTemplate.json` | 3 | `ResourceTemplate` |

Verified data facts used throughout:

* Every file is a JSON array. No duplicate `_id` within any collection (5 collections checked).
* IDs are 24-char lowercase-hex strings (`_id`) or 16-char mixed-case alphanumerics (`compositeId`). Treat both as **opaque strings**; never cast to MongoDB `ObjectId`.
* All `createdAt`/`updatedAt` are epoch **milliseconds** integers, e.g. `1654046260304`. All 30 timestamp values present in the dataset are > 2<sup>31</sup>−1, so the GraphQL type must be the 64-bit `Long` scalar, not `Int`; all fit in `Number.MAX_SAFE_INTEGER` and are returned as JS numbers.
* `build` values are written as `1.0` / `2.0` in JSON; after `JSON.parse` and GraphQL `Int` they are the numbers `1` / `2`. All other numbers in the dataset are integers.
* JSON scalar payloads (`ResourceTemplate.schema`, `ResponseVariation.responses`) must be passed through **verbatim** (same objects/arrays, no stringification, no wrapping, no filtering).
* One documented data/schema conflict exists (`ResourceTemplate.createdAt` is `Long!` in the PDF schema but absent for 2 of 3 templates); the resolvers return `createdAt ?? updatedAt ?? 0` for it — see §2.10.

---

## 1. Field-by-field mapping

Legend: **raw** = value copied unchanged; **derived** = resolved/transformed by a resolver; **absent** = key not in the datasource → `null`.

### 1.1 `Query`

| Schema field | Behaviour |
|---|---|
| `node(nodeId: ID): NodeObject` | `nodeId` omitted / `null` / `""` → the node with `root: true` (`6296be3470a0c1052f89cccb`, "Greeting Message"). If no node is flagged `root: true`, return the first node in file order (not exercised by this dataset). Otherwise look up `nodeId` **by `_id` first, then by `compositeId`**; no match (incl. unknown/whitespace-only ids) → `null`. Root fallback is not an error and must not be wrapped in `errors`. |

Evidence of the recommended/implemented semantics (probed live): omitted, explicit `null`, and `""` all return the root node; lookup by `_id` and by `compositeId` (`rCMUtmL3aOULyqBL` → node `6297164810f52524ba1a9300`) both work; `000000000000000000000000` → `null`.

### 1.2 `NodeObject` (`json/node.json`)

| Schema field | Type | JSON source | Rule |
|---|---|---|---|
| `_id` | `ID!` | `_id` | raw string. |
| `createdAt` | `Long!` | `createdAt` | raw number. Present on all 7 nodes. |
| `updatedAt` | `Long` | `updatedAt` | raw number. Present on all 7 nodes. |
| `name` | `String!` | `name` | raw. |
| `description` | `String` | `description` | raw; source `""` stays `""` (all 7 nodes have `""`). |
| `parents` | `[NodeObject]` | derived from `parents` | **Resolve each entry as a `compositeId`** against `node.compositeId` (NOT `_id`). Order preserved; an unresolvable entry becomes a `null` element (never filtered out, never a crash). `parents: null` → `null`; `parents: []` → `[]`. |
| `parentIds` | `[ID]` | `parents` | **raw** `compositeId` strings from `node.json`, in source order; no resolution/rename (e.g. `"rCMUtmL3aOULyqBL"`). `null` → `null`. |
| `root` | `Boolean` | `root` | raw: `true` (node 1), `false` (5 nodes), `null` (node `6297005470a0c10d6b89ccf1`). Do not coerce `null` to `false`. |
| `trigger` | `Trigger` | derived from `trigger` | Resolve the id string against `trigger.json` `_id`. `trigger: null` → `null`; id not found → `null` (no crash). |
| `triggerId` | `ID` | `trigger` | **raw** id string (`null` when absent). |
| `responses` | `[Response]` | derived from `responses` | Resolve each id against `response.json`. `responses: null` → `null`; unknown id → `null` element; `[]` → `[]`. |
| `responseIds` | `[ID]` | `responses` | **raw** id strings in source order. `null` → `null`. |
| `actions` | `[Action]` | derived from **union** of `preActions` + `actions` + `postActions` | The schema exposes only one actions pair but the datasource splits side effects into three keys. Merge in order **preActions → actions → postActions**, drop `null`/missing entries, de-duplicate by id preserving first occurrence, then resolve against `action.json`. If the union is empty → `null` (not `[]`). |
| `actionIds` | `[ID]` | same union as `actions` | Raw ids in the merged/de-duplicated order. `null` when no action is referenced. |
| `priority` | `Float` | — (absent) | `null` for all 7 nodes. Never fabricate from `position`. |
| `compositeId` | `ID` | `compositeId` | raw; `null` for node `6297005470a0c10d6b89ccf1` (and used by children's `parentIds`). |
| `global` | `Boolean` | `global` | raw (`false` ×6, `true` ×1). |
| `colour` | `String` | — (absent) | `null` for all 7 nodes. |

**Non-obvious NodeObject transformations (must be implemented deliberately):**

1. `parents` → split into `parentIds` (raw **compositeId** strings) and `parents` (resolved `NodeObject`s via a compositeId → node map). Example: node `6297172e70a0c165b989cd10` ("User's Email") has `parents: ["rCMUtmL3aOULyqBL"]`; `parentIds` = `["rCMUtmL3aOULyqBL"]`, `parents` = `[{_id: "6297164810f52524ba1a9300", name: "Sign up Webinar", ...}]`.
2. `trigger` → `triggerId` (raw) + `trigger` (resolved).
3. `responses` → `responseIds` (raw) + `responses` (resolved).
4. `preActions` / `actions` / `postActions` → single merged `actionIds` / `actions` pair (the separate keys themselves are **not exposed**).
5. `priority` / `colour` do not exist in the data (null); `position`, `redirect`, etc. are dropped (§1.8).

### 1.3 `Trigger` (`json/trigger.json`)

| Schema field | Type | JSON source | Rule |
|---|---|---|---|
| `_id` | `ID!` | `_id` | raw. |
| `createdAt` | `Long!` | `createdAt` | raw; present on all 5 triggers. |
| `updatedAt` | `Long` | `updatedAt` | **absent on all 5 triggers** → `null`. |
| `name` | `String!` | `name` | raw. |
| `description` | `String` | `description` | raw (`""` on all 5). |
| `functionString` | `String` | `functionString` | raw; JSON `null` on all 5. |
| `resourceTemplateId` | `ID` | `resourceTemplateId` | raw; resolves for all 5 (4× `61e9ba20f9b581f25a2dbf51`, 1× `61e9ba20f9b58155162dbf52`). |
| `resourceTemplate` | `ResourceTemplate` | derived from `resourceTemplateId` | Resolve against `resourceTemplate.json`; unknown/missing → `null`. |

### 1.4 `Action` (`json/action.json`)

| Schema field | Type | JSON source | Rule |
|---|---|---|---|
| `_id` | `ID!` | `_id` | raw. |
| `createdAt` | `Long!` | `createdAt` | raw (`1697682238144`). |
| `updatedAt` | `Long` | `updatedAt` | raw (`1697682238144`). |
| `name` | `String!` | `name` | raw (`"Send Email Action"`). |
| `description` | `String` | `description` | raw (`""`). |
| `functionString` | `String` | `functionString` | raw (`null`). |
| `resourceTemplateId` | `ID` | `resourceTemplateId` | raw (`62cfc19bf4573e1b32ca2295`, resolves). |
| `resourceTemplate` | `ResourceTemplate` | derived from `resourceTemplateId` | Resolve against `resourceTemplate.json` → "Send Email". |

Reachability note: `Query` has no `action`/`actions` root field, but the single action is reachable through `NodeObject.actions` (merged union) on node `6297172e70a0c165b989cd10` (its `postActions`), so the `Action` type and `Action.resourceTemplate` are exercised by fixture Q6.

### 1.5 `Response` / `ResponsePlatform` / `ResponseLocaleGroup` / `ResponseVariation` (`json/response.json`)

| Schema field | Type | JSON source | Rule |
|---|---|---|---|
| `Response._id` | `ID!` | `_id` | raw. |
| `Response.createdAt` | `Long!` | `createdAt` | raw; present on all 5. |
| `Response.updatedAt` | `Long` | `updatedAt` | absent for 4 of 5 → `null`. Only `6296fcad70a0c11ddb89ccf0` has `1696993124533`. |
| `Response.name` | `String!` | `name` | raw. |
| `Response.description` | `String` | `description` | raw (`""` on all 5). |
| `Response.platforms` | `[ResponsePlatform]` | `platforms` | array copied 1:1 into `ResponsePlatform` objects; `null`/absent → `null` (not exercised: all 5 have 1–2 platforms). |
| `ResponsePlatform.integrationId` | `ID` | `integrationId` | raw string (`"woztell-essential-pack"` or `"whatsapp-cloud"`). |
| `ResponsePlatform.build` | `Int` | `build` | `1.0` → `1`, `2.0` → `2` (JSON number → GraphQL Int). |
| `ResponsePlatform.localeGroups` | `[ResponseLocaleGroup]` | `localeGroups` | array copied 1:1; missing → `null`. |
| `ResponseLocaleGroup.localeGroupId` | `ID` | **`localeGroup`** | **RENAME**: source key is `localeGroup`, schema field is `localeGroupId`. All 7 groups in the data have value `"default"`. Tolerance: prefer `localeGroupId` if present, else `localeGroup`, else `null`. |
| `ResponseLocaleGroup.variations` | `[ResponseVariation]` | `variations` | array copied 1:1; missing → `null`. |
| `ResponseVariation.name` | `String!` | `name` | raw; every variation in the data is named `"Standard"`. |
| `ResponseVariation.responses` | `JSON` | `responses` | **raw JSON value verbatim** (it is an array of channel payload objects); missing → `null`. |

### 1.6 `ResourceTemplate` (`json/resourceTemplate.json`)

| Schema field | Type | JSON source | Rule |
|---|---|---|---|
| `_id` | `ID!` | `_id` | raw. |
| `createdAt` | `Long!` | `createdAt`, else `updatedAt` | **Non-null in the PDF schema, but the key is absent for `61e9ba20f9b581f55162dbf52` and `61e9ba20f9b581f25a2dbf51`** → resolver returns `createdAt ?? updatedAt ?? 0` (§2.10): served `1727122901547` (Predefined Triggers), `1727122901548` (Keyword / Payload); real `1654758039590` for Send Email (`62cfc19bf4573e1b32ca2295`). |
| `updatedAt` | `Long` | `updatedAt` | absent for `62cfc19bf4573e1b32ca2295` → `null`; `1727122901547` / `1727122901548` for the other two. |
| `name` | `String!` | `name` | raw. |
| `description` | `String` | `description` | absent for `61e9ba20f9b58155162dbf52` and `62cfc19bf4573e1b32ca2295` → `null`; present for the keyword template. |
| `schema` | `JSON` | `schema` | **raw JSON object verbatim** (JSON Schema document). |
| `integrationId` | `String` | `integrationId` | raw (`"woztell-essential-pack"` ×2, `"email"` ×1). |
| `functionString` | `String` | `functionString` | raw long JavaScript source string; never JSON-encode/shorten. Not selected in the §4 fixtures (size); tests should assert strict equality with the source value. |
| `key` | `String` | `key` | absent for `62cfc19bf4573e1b32ca2295` → `null`; `"predefined-trigger"` / `"keyword-payload"` otherwise. |

### 1.7 Deliberate transformations checklist

| # | Transformation | Where |
|---|---|---|
| T1 | key rename `localeGroup` → `localeGroupId` | `ResponseLocaleGroup` |
| T2 | raw id key → resolved object field pair (`parentIds`/`parents`) | `NodeObject` |
| T3 | raw id key → resolved object field pair (`triggerId`/`trigger`) | `NodeObject` |
| T4 | raw id key → resolved object field pair (`responseIds`/`responses`) | `NodeObject` |
| T5 | 3 source keys (`preActions`, `actions`, `postActions`) merged, ordered pre→inline→post, de-duplicated → `actionIds`/`actions` | `NodeObject` |
| T6 | raw `compositeId` used as the parent foreign key (`parents`), while node lookup of `Query.node` may also fall back to `compositeId` | `NodeObject`, `Query` |
| T7 | `parents`/`responses`/`actions` id lists resolve against dedicated collections; unknown id → `null` element | `NodeObject` |
| T8 | JSON-valued fields (`schema`, `ResponseVariation.responses`) passed through as parsed JSON values | `ResourceTemplate`, `ResponseVariation` |
| T9 | `build` JSON float notation → GraphQL `Int` | `ResponsePlatform` |
| T10 | 64-bit timestamps serialized as JSON numbers via `Long` scalar | all types |
| T11 | missing/absent `priority`, `colour` → `null` (do not derive from `position` or anything else) | `NodeObject` |
| T12 | `createdAt` fallback chain `createdAt ?? updatedAt ?? 0` to satisfy the non-null SDL for templates with no `createdAt` (documented workaround, §2.10) | `ResourceTemplate` |

### 1.8 JSON keys the schema does NOT expose — must be dropped (never add resolvers/fields for them)

| File | Dropped keys | Notes |
|---|---|---|
| `node.json` | `preActions`, `postActions` | **consumed by T5** (merged into `actions`/`actionIds`) but not exposed under their own names; there must be no `preActions`/`postActions` field in the schema. |
| `node.json` | `redirect`, `analytics`, `memberTagging`, `type`, `tags`, `saveCompositeId`, `position` | pure extras; node 2's `redirect.nodeCompositeId` happens to resolve to node 1's `compositeId` but the field is not exposed. |
| `trigger.json` | `params` | keyword/payload/IndividualTriggers configuration; not in schema. |
| `action.json` | `params` | email `to`/`from`/`subject`/`text`; not in schema. |
| `response.json` | `tags` | always `[]`; not in schema. |
| `resourceTemplate.json` | `type`, `requestedVerification`, `verified`, `published` | action/trigger verification metadata; not in schema. |

Because GraphQL only ever returns selected schema fields, these keys cannot leak through ordinary object serialization. The hard requirement is: **do not model them as GraphQL fields, and do not dump whole records into any `JSON` scalar field.** Also drop empty container semantics: no field named `params`, `position`, etc. may appear in introspection.

---

## 2. Reference graph / integrity inventory

### 2.1 Node inventory — identity and flags

| `_id` | `name` | `compositeId` | `root` | `global` | `createdAt` | `updatedAt` |
|---|---|---|---|---|---|---|
| `6296be3470a0c1052f89cccb` | Greeting Message | `V78P4OA9maz31ORn` | `true` | `false` | 1654046260304 | 1696991678515 |
| `6297005470a0c10d6b89ccf1` | Greeting Message Global | `null` | `null` | `true` | 1654063188547 | 1690790880192 |
| `6297164810f52524ba1a9300` | Sign up Webinar | `rCMUtmL3aOULyqBL` | `false` | `false` | 1654068808589 | 1696991678931 |
| `6297172e70a0c165b989cd10` | User's Email | `L2ZrxYMqAW44L5tB` | `false` | `false` | 1654069038783 | 1696991678725 |
| `629718ba70a0c1836d89cd12` | Book for Consulting | `XTpR0HkNpxWjJ6eG` | `false` | `false` | 1654069434341 | 1696991679555 |
| `62971a9570a0c12bb389cd13` | 10AM Timeslot | `Er9xF8cOr7oVrrvj` | `false` | `false` | 1654069909520 | 1696991679141 |
| `62971b3470a0c1803c89cd15` | 12PM Timeslot | `cqBGDrKZrRqiMJpz` | `false` | `false` | 1654070068308 | 1696991679345 |

All 7 nodes have `description: ""`, `priority`/`colour` absent, and `name`/`createdAt`/`updatedAt` present. Exactly one node has `root: true` (the root of the flow) — that is the default result of `Query.node` when `nodeId` is omitted/null/empty.

### 2.2 Node inventory — references

| `_id` | `triggerId` (raw) | `responseIds` (raw) | `actionIds` (merged pre→inline→post, de-duped) | `parentIds` (raw compositeIds) |
|---|---|---|---|---|
| `6296be3470a0c1052f89cccb` | `null` | `["6296fcad70a0c11ddb89ccf0"]` | `null` | `[]` |
| `6297005470a0c10d6b89ccf1` | `629712b210f525845e1a92f8` | `null` | `null` | `null` |
| `6297164810f52524ba1a9300` | `629716db70a0c1202689cd0a` | `["6297171270a0c17c5689cd0c"]` | `null` | `["V78P4OA9maz31ORn"]` |
| `6297172e70a0c165b989cd10` | `6297176c10f525b8a81a9304` | `["6297189510f525833b1a9305"]` | `["6530933e6a1690d2f0c78a92"]` (from `postActions`) | `["rCMUtmL3aOULyqBL"]` |
| `629718ba70a0c1836d89cd12` | `6297193110f5255a271a9307` | `["62971a7910f525e2b41a930a"]` | `null` | `["V78P4OA9maz31ORn"]` |
| `62971a9570a0c12bb389cd13` | `62971ad610f525424f1a930b` | `["62971b2970a0c15ccc89cd14"]` | `null` | `["XTpR0HkNpxWjJ6eG"]` |
| `62971b3470a0c1803c89cd15` | `null` | `null` | `null` | `["XTpR0HkNpxWjJ6eG"]` |

Raw source keys behind the merged action column: every node has `actions: null` and `preActions: null`; only node `6297172e70a0c165b989cd10` has `postActions: ["6530933e6a1690d2f0c78a92"]`. Hence exactly one node has non-null `actions`/`actionIds`; the other six return `null` for both.

### 2.3 `_id` ↔ `compositeId` table (used to verify `parentIds` resolution)

| Node `_id` | `compositeId` | Referenced as a parent by |
|---|---|---|
| `6296be3470a0c1052f89cccb` | `V78P4OA9maz31ORn` | nodes 3 (`6297164810f52524ba1a9300`) and 5 (`629718ba70a0c1836d89cd12`) |
| `6297005470a0c10d6b89ccf1` | `null` | — (cannot be a parent; never referenced) |
| `6297164810f52524ba1a9300` | `rCMUtmL3aOULyqBL` | node 4 (`6297172e70a0c165b989cd10`) |
| `6297172e70a0c165b989cd10` | `L2ZrxYMqAW44L5tB` | — (never referenced) |
| `629718ba70a0c1836d89cd12` | `XTpR0HkNpxWjJ6eG` | nodes 6 (`62971a9570a0c12bb389cd13`) and 7 (`62971b3470a0c1803c89cd15`) |
| `62971a9570a0c12bb389cd13` | `Er9xF8cOr7oVrrvj` | — (never referenced) |
| `62971b3470a0c1803c89cd15` | `cqBGDrKZrRqiMJpz` | — (never referenced) |

### 2.4 Parent resolution results (`parentIds` → `parents`)

| Child node `_id` | `parentIds` raw | Resolved `parents[]._id` | Resolved `parents[].name` |
|---|---|---|---|
| `6297164810f52524ba1a9300` | `["V78P4OA9maz31ORn"]` | `["6296be3470a0c1052f89cccb"]` | `["Greeting Message"]` |
| `6297172e70a0c165b989cd10` | `["rCMUtmL3aOULyqBL"]` | `["6297164810f52524ba1a9300"]` | `["Sign up Webinar"]` |
| `629718ba70a0c1836d89cd12` | `["V78P4OA9maz31ORn"]` | `["6296be3470a0c1052f89cccb"]` | `["Greeting Message"]` |
| `62971a9570a0c12bb389cd13` | `["XTpR0HkNpxWjJ6eG"]` | `["629718ba70a0c1836d89cd12"]` | `["Book for Consulting"]` |
| `62971b3470a0c1803c89cd15` | `["XTpR0HkNpxWjJ6eG"]` | `["629718ba70a0c1836d89cd12"]` | `["Book for Consulting"]` |
| `6296be3470a0c1052f89cccb` | `[]` | `[]` | `[]` |
| `6297005470a0c10d6b89ccf1` | `null` | `null` | `null` |

### 2.5 Trigger inventory (all resource-templates resolve)

| Trigger `_id` | `name` | `createdAt` | `updatedAt` | `functionString` | `description` | `resourceTemplateId` → `ResourceTemplate.name` |
|---|---|---|---|---|---|---|
| `629712b210f525845e1a92f8` | Keyword: Say Hi | 1654067890224 | **absent → null** | `null` | `""` | `61e9ba20f9b581f25a2dbf51` → Keyword / Payload |
| `629716db70a0c1202689cd0a` | Payload: WEBINAR | 1654068955016 | **absent → null** | `null` | `""` | `61e9ba20f9b581f25a2dbf51` → Keyword / Payload |
| `6297176c10f525b8a81a9304` | Email Trigger | 1654069100236 | **absent → null** | `null` | `""` | `61e9ba20f9b58155162dbf52` → Predefined Triggers |
| `6297193110f5255a271a9307` | Payload: CONSULT | 1654069553350 | **absent → null** | `null` | `""` | `61e9ba20f9b581f25a2dbf51` → Keyword / Payload |
| `62971ad610f525424f1a930b` | Payload: 10_AM | 1654069974465 | **absent → null** | `null` | `""` | `61e9ba20f9b581f25a2dbf51` → Keyword / Payload |

(Trigger `params` — keywords/payloads/IndividualTriggers — is dropped; see §1.8.)

### 2.6 Response inventory

| Response `_id` | `name` | `createdAt` | `updatedAt` | `platforms` (integrationId / build) | locale groups / variations |
|---|---|---|---|---|---|
| `6296fcad70a0c11ddb89ccf0` | Greeting Message | 1654062253768 | 1696993124533 | `woztell-essential-pack`/1, `whatsapp-cloud`/2 | each 1 group `"default"` × 1 variation `"Standard"` |
| `6297171270a0c17c5689cd0c` | Ask for Email | 1654069010275 | **absent → null** | `woztell-essential-pack`/1 | 1 group × 1 variation |
| `6297189510f525833b1a9305` | Get Email Response | 1654069397386 | **absent → null** | `woztell-essential-pack`/1 | 1 group × 1 variation |
| `62971a7910f525e2b41a930a` | Booking Timeslot | 1654069881839 | **absent → null** | `woztell-essential-pack`/1, `whatsapp-cloud`/2 | 1 group × 1 variation per platform |
| `62971b2970a0c15ccc89cd14` | Timeslot 1 Response | 1654070057427 | **absent → null** | `woztell-essential-pack`/1 | 1 group × 1 variation |

All 7 `localeGroups` entries in the data use source key `localeGroup: "default"` (→ `localeGroupId: "default"`). All 7 variations are `name: "Standard"` with a 1-element `responses` JSON array. Response descriptions are `""` everywhere; `tags` is `[]` and is dropped.

### 2.7 Action inventory

| Action `_id` | `name` | `description` | `createdAt` | `updatedAt` | `functionString` | `resourceTemplateId` → name |
|---|---|---|---|---|---|---|
| `6530933e6a1690d2f0c78a92` | Send Email Action | `""` | 1697682238144 | 1697682238144 | `null` | `62cfc19bf4573e1b32ca2295` → Send Email |

`params` (`to`/`from`/`subject`/`text`) is dropped.

### 2.8 ResourceTemplate inventory

| `_id` | `name` | `createdAt` (source → served) | `updatedAt` | `description` | `integrationId` | `functionString` | `key` | `schema` top keys |
|---|---|---|---|---|---|---|---|---|
| `61e9ba20f9b58155162dbf52` | Predefined Triggers | **absent → served 1727122901547** | 1727122901547 | **absent → null** | `woztell-essential-pack` | present (long JS) | `predefined-trigger` | `title`, `type`, `properties` |
| `61e9ba20f9b581f25a2dbf51` | Keyword / Payload | **absent → served 1727122901548** | 1727122901548 | `"Use keyword or payload as triggers"` | `woztell-essential-pack` | present (long JS) | `keyword-payload` | `title`, `type`, `default`, `properties`, `minProperties` |
| `62cfc19bf4573e1b32ca2295` | Send Email | 1654758039590 (real) | **absent → null** | **absent → null** | `email` | present (long JS) | **absent → null** | `type`, `title`, `properties` |

The served `createdAt` for the two trigger templates is the `updatedAt` fallback mandated by the non-null SDL — see §2.10 for the full rationale.

`type`, `requestedVerification`, `verified`, `published` are dropped.

### 2.9 Reference resolution counts — **0 dangling references**

Every foreign key that the schema exposes resolves against its target collection:

| Reference | Instances | Resolved | Dangling |
|---|---|---|---|
| `NodeObject.triggerId` → `trigger.json._id` | 5 | 5 | 0 |
| `NodeObject.responseIds` → `response.json._id` | 5 | 5 | 0 |
| `NodeObject.actionIds` (merged) → `action.json._id` | 1 | 1 | 0 |
| `NodeObject.parentIds` (compositeIds) → `node.json.compositeId` | 5 | 5 | 0 |
| `Trigger.resourceTemplateId` → `resourceTemplate.json._id` | 5 | 5 | 0 |
| `Action.resourceTemplateId` → `resourceTemplate.json._id` | 1 | 1 | 0 |
| **Total** | **22** | **22** | **0** |

**`createdAt` (non-null on every type) audit — the only non-null gap is `ResourceTemplate.createdAt`:**

| Type | Records | `createdAt` present in source | Notes |
|---|---|---|---|
| `NodeObject` | 7 | 7 | every node has `createdAt` (and `updatedAt`). |
| `Trigger` | 5 | 5 | every trigger's `createdAt` exists; all 5 lack the *nullable* `updatedAt`. |
| `Response` | 5 | 5 | every response's `createdAt` exists; 4 of 5 lack the *nullable* `updatedAt`. |
| `Action` | 1 | 1 | the single action's `createdAt` exists. |
| `ResourceTemplate` | 3 | 1 | **only `62cfc19bf4573e1b32ca2295` has `createdAt`**; `bf51`/`bf52` are missing it → served via the documented `createdAt ?? updatedAt ?? 0` workaround (§2.10). |

No other `_id!`/`name!`/`createdAt!` field is missing from the datasource.

Non-exposed ids that must not be resolved/exposed as fields: node 2's `redirect.nodeCompositeId` (`V78P4OA9maz31ORn`, happens to exist) — dropped with `redirect`; `node.actions`/`preActions`/`postActions` raw keys are consumed only through the merged union rule.

**Absent optional data (null results, not dangling ids):**
- `NodeObject.priority` / `colour`: absent for all 7 nodes → `null`.
- Node `6297005470a0c10d6b89ccf1`: `compositeId: null`, `parents: null`, `responses: null`, `root: null`.
- Node `62971b3470a0c1803c89cd15`: `trigger: null`, `responses: null`.
- Root node `6296be3470a0c1052f89cccb`: `trigger: null`, `parents: []`, `actions: null`.
- All 5 triggers: `updatedAt` missing → `null`; `functionString` `null`.
- 4 of 5 responses: `updatedAt` missing → `null`.
- ResourceTemplates: `bf51`/`bf52` missing source `createdAt` → served via the documented `?? updatedAt ?? 0` workaround (§2.10: `1727122901548` / `1727122901547`); `bf52`/`62cfc` missing `description`; `62cfc` missing `key` and `updatedAt`.
- No node has inline `actions`/`preActions`; only node 4 has `postActions` (1 action).

### 2.10 Documented workaround: `ResourceTemplate.createdAt` (schema says non-null, datasource omits it)

The PDF SDL (authoritative) declares `ResourceTemplate.createdAt: Long!`, but `resourceTemplate.json` only stores `createdAt` for one of the three templates:

* `61e9ba20f9b581f25a2dbf51` ("Keyword / Payload") — no `createdAt`, `updatedAt: 1727122901548`
* `61e9ba20f9b58155162dbf52` ("Predefined Triggers") — no `createdAt`, `updatedAt: 1727122901547`
* `62cfc19bf4573e1b32ca2295` ("Send Email") — real `createdAt: 1654758039590`

A pass-through resolver therefore produces `Cannot return null for non-nullable field ResourceTemplate.createdAt.`, propagates `resourceTemplate` to `null` and adds an `errors` entry. **Adopted contract (implemented in `src/`):** the `ResourceTemplate.createdAt` field resolves as `createdAt ?? updatedAt ?? 0`. The SDL stays exactly as given in the PDF (non-null); the JSON datasource is not modified. Result:

| ResourceTemplate | source `createdAt` | source `updatedAt` | **served `createdAt`** |
|---|---|---|---|
| `61e9ba20f9b581f25a2dbf51` | absent | 1727122901548 | **1727122901548** |
| `61e9ba20f9b58155162dbf52` | absent | 1727122901547 | **1727122901547** |
| `62cfc19bf4573e1b32ca2295` | 1654758039590 | absent | **1654758039590** |

`0` is only the last-resort fallback (no template needs it in this dataset). This is a deliberate, documented workaround driven by the data/schema mismatch — not a data change, and not a schema change. Regression fixture (verified live):

```graphql
query ResourceTemplateCreatedAtFallback($nodeId: ID) {
  node(nodeId: $nodeId) {
    trigger {
      resourceTemplate {
        _id
        createdAt
      }
    }
  }
}
```
variables `{"nodeId": "6297164810f52524ba1a9300"}` → `data.node.trigger.resourceTemplate = {"_id": "61e9ba20f9b581f25a2dbf51", "createdAt": 1727122901548}` (bf51 via node 3). For bf52 use variables `{"nodeId": "6297172e70a0c165b989cd10"}` → `{"_id": "61e9ba20f9b58155162dbf52", "createdAt": 1727122901547}`.

---

## 3. Edge cases the resolvers must handle

1. **`null` vs absent vs `[]` — preserve the distinction.** `parents: null` → `parents: null`; `parents: []` → `parents: []` (root node). Same for `responses` (`null` on nodes 2 and 7; array elsewhere) and `actionIds`/`actions` (empty union → `null`, not `[]`). Do not default missing lists to `[]`.
2. **Unresolvable reference → `null` element, never a crash, never filtered.** Current data has 0 dangling ids, but resolvers must be defensive: for each raw id, unresolved → `null` at the same list position (so `parentIds[i]` and `parents[i]` stay aligned). A single missing record must not null out the whole list or throw.
3. **Duplicate `_id`s / duplicate refs.** No duplicate `_id` exists in any collection (verified). Still index collections by `_id` with "first occurrence wins" (or reject at boot). For merged `actionIds`, de-duplicate while preserving first-seen order (`preActions` → `actions` → `postActions`); duplicate refs must not be returned twice.
4. **`Long` (64-bit) timestamps.** All 30 timestamps present in the data exceed 2<sup>31</sup>−1 (e.g. `1654046260304`), so `Int` would overflow; use the custom `Long` scalar and return a JSON **number**, not a string (`createdAt`/`updatedAt` must equal the JSON literal exactly). All values are within the JS safe-integer range, so no precision loss is expected; if a larger value ever appears, the scalar's documented fallback is a decimal string, but the fixtures assume numbers.
5. **`build` is an `Int`.** Source literals are `1.0`/`2.0`; expected GraphQL values are `1`/`2`. If a fractional `build` ever appears, GraphQL `Int` coercion would error — current data has none.
6. **JSON scalars pass through verbatim.** `ResourceTemplate.schema` and `ResponseVariation.responses` must be returned as parsed JSON (objects/arrays), with the same content and nesting; do not stringify, wrap, rename keys, or coerce. `ResponseVariation.responses` is an **array** of payload objects in the data (the scalar accepts any JSON type).
7. **`localeGroup` → `localeGroupId`.** Forgetting the rename makes `localeGroupId` null; the resolver must read the source key `localeGroup` (value `"default"`). Do not expose a `localeGroup` field (not in schema).
8. **Merged actions pair.** `preActions`/`actions`/`postActions` must not be exposed under their own names; only the single merged `actions`/`actionIds` pair. A node with only `postActions` (node 4) must still return that action. If all three keys are null/empty → `null`.
9. **Missing nullable vs missing non-null fields — exactly one documented non-null gap.** Every node (7/7), every trigger (5/5), every response (5/5) and the single action have `createdAt`; the only schema-non-null field absent from the datasource is `ResourceTemplate.createdAt` for `bf51`/`bf52`, resolved as `createdAt ?? updatedAt ?? 0` → served `1727122901548` (Keyword / Payload) and `1727122901547` (Predefined Triggers) — deliberate documented workaround, SDL unchanged (§2.10). Nullable fields that are absent: `Trigger.updatedAt` (all 5) → `null`, `Response.updatedAt` (4/5) → `null`, `ResourceTemplate.updatedAt`/`description`/`key` → `null` when absent. Never emit `null` for a non-null field.
10. **`description`**: `""` in the source is returned as `""` (empty string), a missing key as `null`. Do not normalise `""` to `null`.
11. **`root: null`** on node `6297005470a0c10d6b89ccf1` stays `null` (do not coerce to `false`). Only node `6296be3470a0c1052f89cccb` has `root: true`; it is the fallback target for omitted `nodeId`.
12. **`compositeId: null`** on node 2 must stay `null` and must never be inserted into the parent/composite index (otherwise it would shadow lookups).
13. **`priority`/`colour` absent** → `null` for all nodes. Never derive them from `position`/`redirect` (both dropped anyway).
14. **`nodeId` edge inputs.** omitted / `null` / `""` → root node; unknown 24-hex id → `null`; whitespace-only string → no match → `null`; `compositeId` string is also accepted (fallback lookup). Matching is exact, case-sensitive; return `null` rather than throwing `NOT_FOUND` (the field is nullable by design).
15. **No action/root query.** There is no top-level `actions`/`triggers`/`responses` field; the only entry point is `Query.node`. The `Action` type is reachable only via node 4's merged actions (see §1.4).
16. **Unicode/emoji fidelity.** e.g. `"Hi there, welcome to our booking system 😉"` and the `{{firstName}}` placeholders must round-trip UTF-8 unchanged (no escaping/mangling) — covered by fixture Q5.
17. **Long `functionString` strings** (trigger/action/resource-template JS source) must be returned verbatim; never truncate. They are excluded from the §4 fixtures for readability but should be asserted with strict equality in tests.
18. **Deterministic ordering.** Collection order (`node.json` order) and array order must be preserved for `parents`/`responses`/`actions` and for `variations`; do not sort by name/id.

---

## 4. Canonical verification queries + exact expected results

All eight were executed against the running implementation on 2026-11-22 and matched. Each is a `POST /graphql` with the token header; the expected **response body** is shown in full (`data` only, no `errors`). "variables" are the exact `variables` object of the request (omit the key entirely when no variables are listed). These are the acceptance fixtures.

### Q1 — Fetch one node by `_id`: scalar fields + raw id fields + absent fields

```graphql
query NodeById($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    createdAt
    updatedAt
    name
    description
    parentIds
    root
    triggerId
    responseIds
    actionIds
    priority
    compositeId
    global
    colour
  }
}
```

variables: `{"nodeId": "6297164810f52524ba1a9300"}`

```json
{
  "data": {
    "node": {
      "_id": "6297164810f52524ba1a9300",
      "createdAt": 1654068808589,
      "updatedAt": 1696991678931,
      "name": "Sign up Webinar",
      "description": "",
      "parentIds": [
        "V78P4OA9maz31ORn"
      ],
      "root": false,
      "triggerId": "629716db70a0c1202689cd0a",
      "responseIds": [
        "6297171270a0c17c5689cd0c"
      ],
      "actionIds": null,
      "priority": null,
      "compositeId": "rCMUtmL3aOULyqBL",
      "global": false,
      "colour": null
    }
  }
}
```

### Q2 — `nodeId` omitted → root node (`root: true`)

```graphql
query RootNode {
  node {
    _id
    createdAt
    updatedAt
    name
    description
    parentIds
    root
    global
    triggerId
    responseIds
    actionIds
    priority
    compositeId
    colour
  }
}
```

variables: *(none — omit `variables`, or send `{}`; sending `{"nodeId": null}` gives the identical result and was verified)*

```json
{
  "data": {
    "node": {
      "_id": "6296be3470a0c1052f89cccb",
      "createdAt": 1654046260304,
      "updatedAt": 1696991678515,
      "name": "Greeting Message",
      "description": "",
      "parentIds": [],
      "root": true,
      "global": false,
      "triggerId": null,
      "responseIds": [
        "6296fcad70a0c11ddb89ccf0"
      ],
      "actionIds": null,
      "priority": null,
      "compositeId": "V78P4OA9maz31ORn",
      "colour": null
    }
  }
}
```

### Q3 — Full nested traversal `Node → trigger → resourceTemplate` (incl. JSON `schema` verbatim, null nullable fields, `createdAt` fallback)

```graphql
query NodeTriggerResourceTemplate($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    name
    triggerId
    trigger {
      _id
      createdAt
      updatedAt
      name
      description
      functionString
      resourceTemplateId
      resourceTemplate {
        _id
        createdAt
        updatedAt
        name
        description
        integrationId
        key
        schema
      }
    }
  }
}
```

variables: `{"nodeId": "6297164810f52524ba1a9300"}`

```json
{
  "data": {
    "node": {
      "_id": "6297164810f52524ba1a9300",
      "name": "Sign up Webinar",
      "triggerId": "629716db70a0c1202689cd0a",
      "trigger": {
        "_id": "629716db70a0c1202689cd0a",
        "createdAt": 1654068955016,
        "updatedAt": null,
        "name": "Payload: WEBINAR",
        "description": "",
        "functionString": null,
        "resourceTemplateId": "61e9ba20f9b581f25a2dbf51",
        "resourceTemplate": {
          "_id": "61e9ba20f9b581f25a2dbf51",
          "createdAt": 1727122901548,
          "updatedAt": 1727122901548,
          "name": "Keyword / Payload",
          "description": "Use keyword or payload as triggers",
          "integrationId": "woztell-essential-pack",
          "key": "keyword-payload",
          "schema": {
            "title": "Keyword Payload Template",
            "type": "object",
            "default": {
              "keywords": [],
              "payloads": null
            },
            "properties": {
              "payloads": {
                "title": "Payloads",
                "ui:type": "creatableTemplate",
                "type": "array",
                "items": {
                  "type": "string",
                  "default": ""
                },
                "uniqueItems": true
              },
              "keywords": {
                "title": "Keywords Groups",
                "type": "array",
                "items": {
                  "type": "object",
                  "default": {
                    "caseSensitive": false,
                    "keyword": []
                  },
                  "properties": {
                    "keyword": {
                      "title": "Keywords",
                      "type": "array",
                      "ui:type": "creatableTemplate",
                      "items": {
                        "type": "string",
                        "default": ""
                      }
                    },
                    "caseSensitive": {
                      "title": "Case Sensitive",
                      "type": "boolean"
                    },
                    "wordBoundary": {
                      "title": "Word Boundary",
                      "ui:tooltipText": "For example, you have toggled this condition and set \"hi\". When user types \"high\" (even though \"high\" contains the alphabets \"hi\", it is not an individual word of \"hi\".), the tree node can not be triggered. When user types a sentence containing an individual word of \"hi\" (i.e. hi, this is Stella!), the tree node can be triggered.",
                      "type": "boolean"
                    },
                    "equal": {
                      "title": "Equal",
                      "ui:tooltipText": "The Text String must be completely equal for the trigger to occur. If the trigger is set to \"Hello\", then only \"Hello\" will trigger the logic. \"Hello World\" and even \"hello\" will not work. NOTE: If Equal is set to true, Word Boundary and Case Sensitive is not used.",
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "keyword",
                    "caseSensitive"
                  ]
                }
              }
            },
            "minProperties": 1
          }
        }
      }
    }
  }
}
```

### Q4 — `Node → parents` resolved via `compositeId → trigger` (raw `parentIds` vs resolved `parents`)

```graphql
query NodeParents($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    name
    parentIds
    parents {
      _id
      name
      compositeId
      triggerId
      trigger {
        _id
        name
        resourceTemplateId
      }
    }
  }
}
```

variables: `{"nodeId": "6297172e70a0c165b989cd10"}`

```json
{
  "data": {
    "node": {
      "_id": "6297172e70a0c165b989cd10",
      "name": "User's Email",
      "parentIds": [
        "rCMUtmL3aOULyqBL"
      ],
      "parents": [
        {
          "_id": "6297164810f52524ba1a9300",
          "name": "Sign up Webinar",
          "compositeId": "rCMUtmL3aOULyqBL",
          "triggerId": "629716db70a0c1202689cd0a",
          "trigger": {
            "_id": "629716db70a0c1202689cd0a",
            "name": "Payload: WEBINAR",
            "resourceTemplateId": "61e9ba20f9b581f25a2dbf51"
          }
        }
      ]
    }
  }
}
```

### Q5 — `Node → responses → platforms → localeGroups → variations` (incl. `localeGroup`→`localeGroupId` rename and JSON `responses` verbatim)

```graphql
query NodeResponses($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    name
    responseIds
    responses {
      _id
      createdAt
      updatedAt
      name
      description
      platforms {
        integrationId
        build
        localeGroups {
          localeGroupId
          variations {
            name
            responses
          }
        }
      }
    }
  }
}
```

variables: `{"nodeId": "6296be3470a0c1052f89cccb"}`

```json
{
  "data": {
    "node": {
      "_id": "6296be3470a0c1052f89cccb",
      "name": "Greeting Message",
      "responseIds": [
        "6296fcad70a0c11ddb89ccf0"
      ],
      "responses": [
        {
          "_id": "6296fcad70a0c11ddb89ccf0",
          "createdAt": 1654062253768,
          "updatedAt": 1696993124533,
          "name": "Greeting Message",
          "description": "",
          "platforms": [
            {
              "integrationId": "woztell-essential-pack",
              "build": 1,
              "localeGroups": [
                {
                  "localeGroupId": "default",
                  "variations": [
                    {
                      "name": "Standard",
                      "responses": [
                        {
                          "type": "TEXT",
                          "text": "hello {{firstName}}",
                          "id": "WxPXEokG",
                          "transform": ""
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "integrationId": "whatsapp-cloud",
              "build": 2,
              "localeGroups": [
                {
                  "localeGroupId": "default",
                  "variations": [
                    {
                      "name": "Standard",
                      "responses": [
                        {
                          "type": "WHATSAPP_REPLY_BUTTONS",
                          "header": {
                            "type": "text",
                            "text": "Hi there, welcome to our booking system 😉"
                          },
                          "body": {
                            "text": "You would like to..."
                          },
                          "action": {
                            "buttons": [
                              {
                                "type": "reply",
                                "reply": {
                                  "title": "Sign up for Webinar",
                                  "payload": "WEBINAR"
                                }
                              },
                              {
                                "type": "reply",
                                "reply": {
                                  "title": "Book for Consulting",
                                  "payload": "CONSULT"
                                }
                              }
                            ]
                          },
                          "id": "ZPVCmFvV",
                          "transform": ""
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

### Q6 — `Node → actions` (merged `preActions`+`actions`+`postActions`) `→ Action → resourceTemplate`

Node 4 exposes only `postActions: ["6530933e6a1690d2f0c78a92"]`; the merged actions pair must return it (and the raw source keys `preActions`/`postActions` must not exist in the schema).

```graphql
query NodeActions($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    name
    actionIds
    actions {
      _id
      createdAt
      updatedAt
      name
      description
      functionString
      resourceTemplateId
      resourceTemplate {
        _id
        name
        createdAt
        updatedAt
        description
        key
      }
    }
  }
}
```

variables: `{"nodeId": "6297172e70a0c165b989cd10"}`

```json
{
  "data": {
    "node": {
      "_id": "6297172e70a0c165b989cd10",
      "name": "User's Email",
      "actionIds": [
        "6530933e6a1690d2f0c78a92"
      ],
      "actions": [
        {
          "_id": "6530933e6a1690d2f0c78a92",
          "createdAt": 1697682238144,
          "updatedAt": 1697682238144,
          "name": "Send Email Action",
          "description": "",
          "functionString": null,
          "resourceTemplateId": "62cfc19bf4573e1b32ca2295",
          "resourceTemplate": {
            "_id": "62cfc19bf4573e1b32ca2295",
            "name": "Send Email",
            "createdAt": 1654758039590,
            "updatedAt": null,
            "description": null,
            "key": null
          }
        }
      ]
    }
  }
}
```

### Q7 — Unknown `nodeId` → `null` (no error)

```graphql
query NodeUnknown($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    name
  }
}
```

variables: `{"nodeId": "000000000000000000000000"}`

```json
{
  "data": {
    "node": null
  }
}
```

### Q8 — Null handling: `null` vs `[]`, missing nullable fields, `Long` values, node with null `trigger`/`compositeId`/`root`

Node 2 ("Greeting Message Global") is the stress case: `parents`/`responses`/`actions` are all `null`, `root` is `null`, `compositeId` is `null`, its trigger has null `updatedAt`/`functionString`, and the resolved resource template (`61e9ba20f9b581f25a2dbf51`) has no `createdAt` (see §2.10 — that field is deliberately omitted from this fixture) while its `description` is present.

```graphql
query NodeNulls($nodeId: ID) {
  node(nodeId: $nodeId) {
    _id
    name
    root
    global
    description
    parents {
      _id
    }
    parentIds
    responses {
      _id
    }
    responseIds
    actions {
      _id
    }
    actionIds
    priority
    colour
    compositeId
    triggerId
    trigger {
      _id
      name
      description
      createdAt
      updatedAt
      functionString
      resourceTemplate {
        _id
        name
        description
        updatedAt
      }
    }
  }
}
```

variables: `{"nodeId": "6297005470a0c10d6b89ccf1"}`

```json
{
  "data": {
    "node": {
      "_id": "6297005470a0c10d6b89ccf1",
      "name": "Greeting Message Global",
      "root": null,
      "global": true,
      "description": "",
      "parents": null,
      "parentIds": null,
      "responses": null,
      "responseIds": null,
      "actions": null,
      "actionIds": null,
      "priority": null,
      "colour": null,
      "compositeId": null,
      "triggerId": "629712b210f525845e1a92f8",
      "trigger": {
        "_id": "629712b210f525845e1a92f8",
        "name": "Keyword: Say Hi",
        "description": "",
        "createdAt": 1654067890224,
        "updatedAt": null,
        "functionString": null,
        "resourceTemplate": {
          "_id": "61e9ba20f9b581f25a2dbf51",
          "name": "Keyword / Payload",
          "description": "Use keyword or payload as triggers",
          "updatedAt": 1727122901548
        }
      }
    }
  }
}
```

---

## 5. `node(nodeId: ID)` — omitted/ambiguous behaviour (recommendation)

`Query.node` declares a **nullable** argument (`nodeId: ID`) and a nullable return (`NodeObject`), so the PDF schema does not define what "no argument" means. Recommended (and implemented/verified) contract:

| Input | Result |
|---|---|
| argument omitted | the node flagged `root: true` → `6296be3470a0c1052f89cccb` (verified; also returns that node when no `variables` object is sent at all) |
| `nodeId: null` | same root node (verified) |
| `nodeId: ""` | same root node (verified; treated as "not provided") |
| `nodeId` = existing `_id` | that node (verified for every id used in the §4 fixtures and the §3/§5 probes) |
| `nodeId` = existing `compositeId` | the node whose `compositeId` matches (verified: `"rCMUtmL3aOULyqBL"` → `6297164810f52524ba1a9300`) |
| `nodeId` = unknown / whitespace-only / otherwise no match | `null`, HTTP 200, no `errors` (verified: `"000000000000000000000000"` → `{"data":{"node":null}}`) |

Fallback details: if no node has `root: true`, fall back to the first node in `node.json` order (defensive; not exercised by this dataset). Root defaulting must happen **before** lookup, so an omitted argument is never treated as "unknown id". `_id` lookup takes precedence over `compositeId`. If both omit/root behaviour and a client-supplied `""` are considered distinct, keep the table above — it is the acceptance behaviour. This is preferable to returning `null` for an omitted argument (which would make the single query field useless as an entry point) and is what the fixtures Q2/Q7 encode.

---

## 6. Acceptance checklist for the Lead / test author

* [ ] `Query.node` root fallback for omitted/`null`/`""`; `_id` then `compositeId` lookup; unknown → `null` (Q2, Q7, §5).
* [ ] `parentIds` raw compositeIds + `parents` resolved via `compositeId`; order preserved; `[]` vs `null` preserved (Q1, Q2, Q4, Q8).
* [ ] `triggerId`/`trigger`, `responseIds`/`responses` raw + resolved pairs; null propagation (Q1, Q3, Q5, Q8).
* [ ] merged, ordered, de-duplicated `actionIds`/`actions` from `preActions`+`actions`+`postActions` (Q6).
* [ ] `localeGroup` → `localeGroupId`; `build` as `Int`; JSON `schema`/`responses` verbatim (Q3, Q5).
* [ ] `Long` timestamps as JSON numbers (all fixtures).
* [ ] dropped keys absent from the schema/introspection: `params`, `position`, `redirect`, `analytics`, `memberTagging`, `type`, `tags`, `saveCompositeId`, `preActions`, `postActions`, `tags` (response), `requestedVerification`, `verified`, `published` (§1.8).
* [ ] `priority`/`colour` → `null` everywhere (Q1, Q8).
* [ ] §2.10 `ResourceTemplate.createdAt` non-null workaround returns `createdAt ?? updatedAt ?? 0` (bf51 → 1727122901548, bf52 → 1727122901547, 62cfc → 1654758039590) and its regression fixture passes.
* [ ] 0 dangling references among all 22 exposed references (§2.9); defensive null-on-unresolved behaviour still tested synthetically if possible.
