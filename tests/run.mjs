#!/usr/bin/env node
/**
 * Portable, dependency-free in-process test runner.
 *
 * `node --test tests/` spawns one child process per test file; environments that
 * forbid piped child-process stdio (some sandboxes/CI) fail with `spawn EPERM`
 * before any test runs. This entrypoint imports the test files directly, so the
 * Node built-in test runner executes them in the current process instead:
 *
 *   node tests/run.mjs        # pass/fail counted exactly like `node --test`
 *
 * It is intentionally NOT named *.test.js so `node --test tests/` does not pick
 * it up as an extra test file.
 */
import './auth.test.js'
import './schema.test.js'
import './resolvers.test.js'
import './fidelity.test.js'
import './http.test.js'
