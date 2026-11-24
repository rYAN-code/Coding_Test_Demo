# Automated test suite

Independent verification of the GraphQL API contract (auth, schema, resolvers,
value fidelity, HTTP surface, lifecycle). Node's built-in test runner only —
**no extra dependencies**. ESM, Node >= 20, global `fetch`.

The implementation is TypeScript (`src/*.ts`); the tests import the **compiled**
server from `dist/`, so run them through the npm scripts (which build first) or
run `npm run build` yourself beforehand.

## Run

From `Backend_Coding_Test_Demo/`:

```bash
npm test              # pretest builds dist/ with tsc, then runs every *.test.js in-process
npm run test:node     # standard runner: node --test tests/  (one child process per file)
```

`npm test` runs [`run.mjs`](./run.mjs), which imports the same `*.test.js` files
so Node's built-in test runner executes them in the current process. In an
unrestricted shell both commands behave identically (same counts, same exit
code); the in-process variant additionally works where spawning child processes
with piped stdio is forbidden (some sandboxes/CI).

Each test file boots its own `createApp()` instance on an ephemeral port
(`127.0.0.1:0`) with its own token, and stops it in an `after` hook:

- no `npm start` / running server required
- no fixed ports, so files can run concurrently
- everything in-process (`fetch` over localhost), no external network

### If the environment blocks child-process spawning

`node --test` runs every test file in a child process (piped stdio/IPC). In a
sandbox that forbids named pipes/piped spawns this fails with
`Error: spawn EPERM` *before any test file is executed*. The suite itself is
unaffected; run the files in-process instead:

```bash
# prerequisites: the tests import ../../dist/server.js
npm run build

# all files, in-process (Node >= 22.8)
node --test --test-isolation=none "tests/*.test.js"

# or through the portable in-process runner (every Node version)
node tests/run.mjs

# or per file (works on every Node version, also in-process)
node tests/auth.test.js
```

`tests/run.mjs` imports every `*.test.js` file, so the same Node built-in test
runner executes them in the current process; pass/fail counts and the exit code
are identical. It is not named `*.test.js`, so `node --test tests/` does not
pick it up twice.

## Files

| File | Covers |
| --- | --- |
| `helpers/harness.js` | Hermetic server boot, HTTP/GraphQL helpers, shared assertions |
| `helpers/fixtures.js` | Read-only loader for `json/*.json` (expectations derive from the datasource) |
| `helpers/schema-contract.js` | Expected types/fields/scalars + forbidden datasource keys |
| `auth.test.js` | 401/UNAUTHENTICATED matrix (missing, wrong, malformed, non-Bearer), valid token, `POST /`, GraphQL-over-GET + CSRF, public `/health`, 401 envelope shape |
| `schema.test.js` | Introspection: exactly 9 object types, exact field sets, `Long`/`JSON` scalars, `node(nodeId: ID)` arg, `ResourceTemplate.createdAt: Long!`, no datasource-key leakage |
| `resolvers.test.js` | `node` for every `_id` and `compositeId`, root fallback (omitted/null), unknown -> null, `parentIds` vs resolved `parents`, `trigger(Id)`, `responses(Ids)`, `actions(Ids)` union, full `responses -> platforms -> localeGroups -> variations -> responses` chain |
| `fidelity.test.js` | `Long` timestamps as JSON numbers identical to `json/*.json`; `ResourceTemplate.schema` and `ResponseVariation.responses` JSON round-trip; `ResourceTemplate.createdAt` fallback; no extra/missing result fields |
| `http.test.js` | `POST /` alias, 404 `NOT_FOUND` JSON, malformed body 400, validation/parse errors, CORS preflight, Sandbox HTML on/off, `createApp`/`listen`/`stop` lifecycle (double-stop safe) |

## Notes

- Tests never write outside `tests/`; `json/` is only read.
- Tests target the compiled TypeScript output in `dist/` (`npm test` builds it via `pretest`).
- Expectations are computed from the datasource files, so a changed fixture
  shows up as a failed assertion rather than silently passing.
- `node --test tests/` also prints Node's own skip/fail counts; the suite has
  zero skips and zero failures against the current build.
