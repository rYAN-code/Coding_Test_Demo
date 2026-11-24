/**
 * HTTP layer: Apollo Server 5 mounted on an Express 5 app.
 *
 *   POST /graphql        – GraphQL endpoint (also mounted at POST / for
 *                          compatibility with the Apollo "getting started" URL)
 *   GET  /graphql        – GraphQL-over-HTTP queries (same auth requirements)
 *   GET  /               – Apollo Sandbox explorer (static HTML only, no auth;
 *                          enabled by default, disable with LANDING_PAGE=false)
 *   GET  /health         – liveness/readiness probe (public)
 *
 * Every GraphQL request must be authenticated with `Authorization: Bearer <token>`.
 */
import { createServer } from 'node:http'

import { ApolloServer } from '@apollo/server'
import type { ApolloServerOptions } from '@apollo/server'
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled'
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default'
import { expressMiddleware } from '@as-integrations/express5'
import cors from 'cors'
import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'

import { config as defaultConfig } from './config.js'
import { createContext, isLandingPageRequest, requireBearerToken } from './auth.js'
import { createDataStore } from './data/store.js'
import { resolvers } from './schema/resolvers.js'
import { typeDefs } from './schema/typeDefs.js'
import type {
  AppConfig,
  AppServer,
  CreateAppOptions,
  DataStore,
  GraphQLContext,
  ListenOptions,
  ServerAddress,
} from './types.js'

/** Paths the GraphQL endpoint is reachable on. */
export const GRAPHQL_PATHS: string[] = ['/', '/graphql']

/**
 * Build the Express app + Apollo Server pair.
 *
 * @param options.config runtime configuration override
 * @param options.dataStore datasource override (tests)
 */
export async function createApp(options: CreateAppOptions = {}): Promise<AppServer> {
  const config: AppConfig = { ...defaultConfig, ...(options.config ?? {}) }
  const dataStore: DataStore = options.dataStore ?? createDataStore(config.dataDir)

  const app: Express = express()
  app.disable('x-powered-by')

  const httpServer = createServer(app)

  const apolloOptions: ApolloServerOptions<GraphQLContext> = {
    typeDefs,
    // `Resolvers` (see src/types.ts) is intentionally stricter than Apollo's
    // index-signature-based `IResolvers` type: the implementation is checked
    // field-by-field against that contract, and this single cast is the type
    // boundary with Apollo Server.
    resolvers: resolvers as unknown as ApolloServerOptions<GraphQLContext>['resolvers'],
    introspection: !config.isProduction,
    includeStacktraceInErrorResponses: !config.isProduction,
    // Apollo's CSRF prevention blocks "simple" cross-site requests. Every
    // GraphQL request here must carry `Authorization: Bearer <token>`, which a
    // browser cannot attach cross-site without a CORS preflight, so the
    // authorization header is accepted as the CSRF-safe marker (this also lets
    // clients issue GET queries with `?query=...` + a bearer token).
    csrfPrevention: { requestHeaders: ['authorization'] },
    plugins: [
      // Drains the HTTP server on apolloServer.stop() so shutdown is graceful.
      ApolloServerPluginDrainHttpServer({ httpServer }),
      // Apollo Sandbox on GET / (browser only; it carries no data by itself).
      // Apollo Server 5 installs a landing page implicitly unless the disabled
      // plugin is passed explicitly, so the else branch is required for
      // LANDING_PAGE=false to actually turn the explorer off.
      config.landingPage
        ? ApolloServerPluginLandingPageLocalDefault({ footer: false, embed: true })
        : ApolloServerPluginLandingPageDisabled(),
    ],
  }

  const apolloServer = new ApolloServer<GraphQLContext>(apolloOptions)
  await apolloServer.start()

  // -- middleware ---------------------------------------------------------
  app.use(cors())

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'backend-coding-test-demo',
      uptimeSeconds: Math.round(process.uptime()),
      collections: {
        nodes: dataStore.nodes.length,
        triggers: dataStore.triggers.length,
        responses: dataStore.responses.length,
        actions: dataStore.actions.length,
        resourceTemplates: dataStore.resourceTemplates.length,
      },
    })
  })

  // 1. Auth guard: rejects unauthenticated GraphQL traffic before any body is read.
  //    When the explorer is enabled, the Sandbox HTML page itself is exempt (it
  //    only bootstraps the UI and carries no data).
  app.all(GRAPHQL_PATHS, (req: Request, res: Response, next: NextFunction) => {
    if (config.landingPage && isLandingPageRequest(req)) return next()
    return requireBearerToken(req, res, next, config.authToken)
  })

  // 2. JSON body parsing + Apollo's GraphQL middleware.
  app.all(
    GRAPHQL_PATHS,
    express.json({ limit: '2mb' }),
    expressMiddleware(apolloServer, {
      // Defence in depth: re-validate the token inside the GraphQL context so
      // the schema stays protected even if the HTTP guard is ever refactored.
      context: async ({ req }) => createContext(dataStore, req, config.authToken),
    }),
  )

  // -- fallbacks ----------------------------------------------------------
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      errors: [
        {
          message: `Not found: ${req.method} ${req.originalUrl}. Use POST /graphql (or POST /) with an Authorization: Bearer <token> header.`,
          extensions: { code: 'NOT_FOUND' },
        },
      ],
    })
  })

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error)
    const status = Number((error as { status?: unknown } | null)?.status)
    const isClientError = Number.isInteger(status) && status >= 400 && status < 500
    const message = error instanceof Error ? error.message : 'Internal server error'
    res.status(isClientError ? status : 500).json({
      errors: [
        {
          message: isClientError ? message : 'Internal server error',
          extensions: { code: isClientError ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR' },
        },
      ],
    })
  })

  // -- lifecycle ----------------------------------------------------------
  let listening = false

  /** Start listening. `port: 0` binds an ephemeral port (used by tests). */
  async function listen(options: ListenOptions = {}): Promise<ServerAddress> {
    const port = options.port ?? config.port
    const host = options.host ?? config.host
    if (listening) throw new Error('Server is already listening')

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, host, () => {
        httpServer.removeListener('error', reject)
        resolve()
      })
    })
    listening = true

    const address = httpServer.address()
    const boundPort = typeof address === 'object' && address !== null ? address.port : port
    const boundHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    return { url: `http://${boundHost}:${boundPort}/`, port: boundPort, host }
  }

  /** Stop accepting connections and dispose of Apollo Server. */
  async function stop(): Promise<void> {
    listening = false
    // ApolloServerPluginDrainHttpServer closes the HTTP server (with a grace
    // period for in-flight requests) as part of Apollo Server's shutdown.
    await apolloServer.stop().catch(() => undefined)
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  }

  return { app, httpServer, apolloServer, dataStore, config, listen, stop }
}

export default createApp
