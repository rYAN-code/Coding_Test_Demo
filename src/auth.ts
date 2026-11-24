/**
 * Bearer-token authentication.
 *
 * The code test requires the API to be authenticated with a Bearer token:
 *
 *   Authorization: Bearer <token>
 *
 * A missing / malformed / unknown token is rejected with HTTP 401 and the
 * GraphQL error code `UNAUTHENTICATED` before the request ever reaches the
 * GraphQL execution layer. The same check is repeated inside the GraphQL
 * `context` function as defence in depth (so the API stays protected even if a
 * future refactor drops the HTTP middleware).
 */
import { createHash, timingSafeEqual } from 'node:crypto'

import { GraphQLError } from 'graphql'
import type { NextFunction, Request, Response } from 'express'

import { config } from './config.js'
import type { GraphQLContext } from './types.js'

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header || typeof header !== 'string') return null
  const match = BEARER_PATTERN.exec(header.trim())
  return match ? (match[1] ?? null) : null
}

/** Constant-time comparison of two secrets (hashing avoids length leaks). */
function safeCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest()
  const digestB = createHash('sha256').update(b).digest()
  return timingSafeEqual(digestA, digestB)
}

/** Validate a token against the configured secret. Multiple secrets may be comma-separated. */
export function isValidToken(token: unknown, expected: string = config.authToken): boolean {
  if (typeof token !== 'string' || token.length === 0) return false
  if (typeof expected !== 'string' || expected.length === 0) return false
  return expected
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .some((candidate) => safeCompare(token, candidate))
}

/** GraphQL error carrying the canonical 401 / UNAUTHENTICATED shape. */
export function unauthenticatedError(
  message = 'Authentication required: provide an "Authorization: Bearer <token>" header',
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: 'UNAUTHENTICATED',
      http: { status: 401 },
    },
  })
}

/** Reject the request unless it carries a valid bearer token. */
export function requireBearerToken(
  req: Request,
  res: Response,
  next: NextFunction,
  expectedToken: string = config.authToken,
): void {
  const token = extractBearerToken(req)
  if (isValidToken(token, expectedToken)) {
    next()
    return
  }

  const error = unauthenticatedError(
    token
      ? 'Invalid bearer token'
      : 'Authentication required: provide an "Authorization: Bearer <token>" header',
  )
  // Apollo strips its own `extensions.http` transport hint before serialising;
  // do the same here so the response body only carries the public error shape.
  res.status(401).json({ errors: [{ message: error.message, extensions: { code: error.extensions.code } }] })
}

/**
 * A browser opening the Apollo Sandbox explorer issues a plain `GET /` with
 * `Accept: text/html`. That request only serves static HTML (no data), so it is
 * allowed through the auth guard; every GraphQL operation still requires a token.
 */
export function isLandingPageRequest(req: Request): boolean {
  if (!req || req.method !== 'GET') return false
  const accept = String(req.headers.accept ?? '')
  if (!accept.includes('text/html')) return false
  const url = String(req.originalUrl ?? req.url ?? '')
  const hasQuery = /[?&]query=/.test(url)
  return !hasQuery
}

/** GraphQL context helper: throws when the request has no valid token. */
export function assertAuthenticated(req: Request, expectedToken: string = config.authToken): string {
  const token = extractBearerToken(req)
  if (isValidToken(token, expectedToken)) return token as string
  throw unauthenticatedError()
}

/** Build the context object handed to every resolver. */
export function createContext(dataStore: GraphQLContext['dataStore'], req: Request, expectedToken?: string): GraphQLContext {
  return { dataStore, token: assertAuthenticated(req, expectedToken) }
}
