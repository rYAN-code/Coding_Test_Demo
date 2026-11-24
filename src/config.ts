/**
 * Runtime configuration.
 *
 * Every value can be overridden with an environment variable so the same code
 * runs unchanged in local development, tests and CI.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AppConfig } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Project root (…/Backend_Coding_Test_Demo) — valid from `src/` and `dist/`. */
export const PROJECT_ROOT: string = resolve(__dirname, '..')

/**
 * Default bearer token accepted by the API.
 * It is intentionally committed so the reviewer can call the API immediately;
 * set AUTH_TOKEN in the environment to override it (the .env.example file shows
 * how it is expected to be supplied in a real deployment).
 */
export const DEFAULT_AUTH_TOKEN = 'backend-test-token'

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 0 and 65535`)
  }
  return port
}

function isDisabled(raw: string | undefined): boolean {
  return ['false', '0', 'no'].includes(String(raw ?? '').toLowerCase())
}

export const config: AppConfig = {
  /** HTTP port. 0 lets the OS pick a free port (used by the test suite). */
  port: parsePort(process.env.PORT, 4000),
  /** Interface to bind. */
  host: process.env.HOST || '0.0.0.0',
  /** Token the API expects in `Authorization: Bearer <token>`. */
  authToken: process.env.AUTH_TOKEN || DEFAULT_AUTH_TOKEN,
  /** Directory holding node.json / trigger.json / ... */
  dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(PROJECT_ROOT, 'json'),
  /**
   * Serve the Apollo Sandbox explorer on GET /.
   * Disable with LANDING_PAGE=false (e.g. production deployments).
   */
  landingPage: !isDisabled(process.env.LANDING_PAGE),
  /** Expose the schema / field suggestions in errors & introspection. */
  isProduction: process.env.NODE_ENV === 'production',
}
