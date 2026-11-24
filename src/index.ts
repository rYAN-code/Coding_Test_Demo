#!/usr/bin/env node
/**
 * Entry point: boots the GraphQL API and wires up graceful shutdown.
 *
 *   npm start                 # http://0.0.0.0:4000/          (compiled dist/)
 *   npm run dev               # tsx watch src/index.ts        (development)
 *   PORT=4001 AUTH_TOKEN=xyz npm start
 */
import { config } from './config.js'
import { createApp } from './server.js'
import type { AppServer, ServerAddress } from './types.js'

async function main(): Promise<void> {
  const server: AppServer = await createApp()
  const address: ServerAddress = await server.listen()
  const { url, port } = address

  console.log('')
  console.log('  GraphQL API server is running')
  console.log('  ---------------------------------------------')
  console.log(`  GraphQL endpoint : ${url}graphql  (also ${url})`)
  console.log(`  Apollo Sandbox   : ${url}  (open in a browser)`)
  console.log(`  Health check     : ${url}health`)
  console.log(`  Bound port       : ${port}`)
  console.log('')
  console.log('  Authentication   : Authorization: Bearer <token>')
  console.log(`  Token            : ${config.authToken}`)
  console.log(`  Datasource       : ${config.dataDir}`)
  console.log('')

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[${signal}] shutting down gracefully…`)
    try {
      await server.stop()
      console.log('[shutdown] closed')
      process.exit(0)
    } catch (error) {
      console.error('[shutdown] failed', error)
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  console.error('Failed to start the GraphQL API server:', error)
  process.exit(1)
})
