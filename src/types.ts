/**
 * Type declarations for the GraphQL API server.
 *
 * This file is type-only (it compiles to an empty module): every shared
 * interface/type used across `src/` lives here, so the datasource records, the
 * GraphQL context, the resolver signatures, the configuration and the app/server
 * contract are declared in one place and imported with `import type`.
 *
 * The build (`npm run build`) also emits `dist/types.d.ts` so the declarations
 * can be consumed by other TypeScript projects.
 */
import type { Server } from 'node:http'

import type { ApolloServer } from '@apollo/server'
import type { GraphQLResolveInfo, GraphQLScalarType } from 'graphql'

/* -------------------------------------------------------------------------- */
/* JSON values                                                                */
/* -------------------------------------------------------------------------- */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/* -------------------------------------------------------------------------- */
/* Datasource records — the exact shapes of the five JSON files in `json/`     */
/* -------------------------------------------------------------------------- */

/**
 * A reference stored in the datasource: either the raw `_id` (what the provided
 * JSON files contain) or an already populated record (accepted defensively).
 */
export type Ref<TRecord extends { _id: string }> = string | TRecord

/** A list of ids as stored in node.json / trigger.json. */
export type IdList = string | number | null | undefined | ReadonlyArray<string | number | null | undefined>

/** One documented `action.json` record. */
export interface ActionRecord {
  _id: string
  name: string
  description?: string | null
  functionString?: string | null
  /** Configured params — NOT exposed by the GraphQL schema. */
  params?: JsonObject | null
  resourceTemplateId?: string | null
  createdAt: number
  updatedAt?: number | null
  [key: string]: unknown
}

/** One `trigger.json` record. */
export interface TriggerRecord {
  _id: string
  name: string
  description?: string | null
  functionString?: string | null
  params?: JsonObject | null
  resourceTemplateId?: string | null
  createdAt: number
  updatedAt?: number | null
  [key: string]: unknown
}

/** A response variation payload (arbitrary JSON in the datasource). */
export interface ResponseVariationRecord {
  name: string
  responses?: JsonValue
  [key: string]: unknown
}

/** A locale group inside a response platform (`localeGroup` is the raw key). */
export interface ResponseLocaleGroupRecord {
  localeGroup?: string
  localeGroupId?: string
  variations?: ResponseVariationRecord[]
  [key: string]: unknown
}

/** A platform-specific rendering of a response. */
export interface ResponsePlatformRecord {
  integrationId?: string
  build?: number
  localeGroups?: ResponseLocaleGroupRecord[]
  [key: string]: unknown
}

/** One `response.json` record. */
export interface ResponseRecord {
  _id: string
  name: string
  description?: string | null
  platforms?: ResponsePlatformRecord[] | null
  tags?: unknown[]
  createdAt: number
  updatedAt?: number | null
  [key: string]: unknown
}

/**
 * One `node.json` record. Note the references: `trigger` holds a trigger `_id`,
 * `responses`/`actions` hold response/action `_id`s and `parents` holds the
 * *compositeId* of the parent nodes.
 */
export interface NodeRecord {
  _id: string
  name: string
  description?: string | null
  trigger?: Ref<TriggerRecord> | null
  triggerId?: string | null
  responses?: Array<Ref<ResponseRecord>> | null
  responseIds?: string[] | null
  preActions?: Array<Ref<ActionRecord>> | null
  actions?: Array<Ref<ActionRecord>> | null
  postActions?: Array<Ref<ActionRecord>> | null
  actionIds?: string[] | null
  parents?: IdList
  parentIds?: string[] | null
  root?: boolean | null
  global?: boolean | null
  compositeId?: string | null
  priority?: number | null
  colour?: string | null
  color?: string | null
  /** Layout metadata — NOT exposed by the GraphQL schema. */
  position?: { x: number; y: number } | null
  redirect?: JsonObject | null
  analytics?: JsonObject | null
  memberTagging?: JsonObject | null
  type?: string | null
  tags?: unknown[] | null
  createdAt: number
  updatedAt?: number | null
  [key: string]: unknown
}

/** One `resourceTemplate.json` record. */
export interface ResourceTemplateRecord {
  _id: string
  name: string
  description?: string | null
  schema?: JsonValue
  integrationId?: string | null
  functionString?: string | null
  key?: string | null
  /** `createdAt` is absent on the two trigger templates (schema says `Long!`). */
  createdAt?: number
  updatedAt?: number | null
  [key: string]: unknown
}

/* -------------------------------------------------------------------------- */
/* Datasource collections / store                                             */
/* -------------------------------------------------------------------------- */

/** One entry per JSON file: collection name -> parsed records. */
export interface Collections {
  nodes: NodeRecord[]
  triggers: TriggerRecord[]
  responses: ResponseRecord[]
  actions: ActionRecord[]
  resourceTemplates: ResourceTemplateRecord[]
}

export type CollectionName = keyof Collections

/** Collection name -> datasource file name. */
export type CollectionFiles = Readonly<Record<CollectionName, string>>

/** Raw-string keys of each collection, useful for generic helpers. */
export type RecordOf<TName extends CollectionName> = Collections[TName][number]

/** The indexed, read-only datasource handed to resolvers through the context. */
export interface DataStore extends Collections {
  readonly dataDir: string
  readonly nodesById: ReadonlyMap<string, NodeRecord>
  readonly triggersById: ReadonlyMap<string, TriggerRecord>
  readonly responsesById: ReadonlyMap<string, ResponseRecord>
  readonly actionsById: ReadonlyMap<string, ActionRecord>
  readonly resourceTemplatesById: ReadonlyMap<string, ResourceTemplateRecord>
  readonly nodesByCompositeId: ReadonlyMap<string, NodeRecord>
  /** The node flagged `root: true` (falls back to the first node). */
  readonly rootNode: NodeRecord | null

  /** Look a node up by `_id`, falling back to its `compositeId`. */
  getNode(nodeId: string | null | undefined): NodeRecord | null
  getNodes(ids: IdList): Array<NodeRecord | null> | null
  getTriggers(ids: IdList): Array<TriggerRecord | null> | null
  getResponses(ids: IdList): Array<ResponseRecord | null> | null
  getActions(ids: IdList): Array<ActionRecord | null> | null
  getResourceTemplates(ids: IdList): Array<ResourceTemplateRecord | null> | null
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export interface AppConfig {
  /** HTTP port (`0` binds an ephemeral port). */
  port: number
  /** Bind address. */
  host: string
  /** Token(s) expected in `Authorization: Bearer <token>` (comma-separated). */
  authToken: string
  /** Directory that contains the five datasource JSON files. */
  dataDir: string
  /** Serve the Apollo Sandbox explorer on `GET /`. */
  landingPage: boolean
  /** `NODE_ENV=production`: disables introspection and stack traces. */
  isProduction: boolean
}

/** Options accepted by `createApp()` — used by the test suite and embedding. */
export interface CreateAppOptions {
  config?: Partial<AppConfig>
  dataStore?: DataStore
}

export interface ListenOptions {
  port?: number
  host?: string
}

export interface ServerAddress {
  url: string
  port: number
  host: string
}

/* -------------------------------------------------------------------------- */
/* GraphQL                                                                    */
/* -------------------------------------------------------------------------- */

/** Apollo Server context available to every resolver. */
export interface GraphQLContext {
  readonly dataStore: DataStore
  /** The (already validated) bearer token of the current request. */
  readonly token: string
}

/** The two custom scalars declared by the schema. */
export interface Scalars {
  Long: GraphQLScalarType
  JSON: GraphQLScalarType
}

/** Arguments of `Query.node`. */
export interface NodeQueryArgs {
  nodeId?: string | null
}

/**
 * Generic resolver signature. Implementations may omit the trailing parameters
 * they do not need (TypeScript allows shorter function types to be assigned).
 */
export type ResolverFn<TParent, TResult, TArgs extends object = Record<string, never>> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult

/**
 * The complete resolver map for the schema from the code test. Declaring it here
 * keeps the implementation in `schema/resolvers.ts` fully type-checked against a
 * single readable contract.
 */
export interface Resolvers {
  Long: GraphQLScalarType
  JSON: GraphQLScalarType

  Query: {
    node: ResolverFn<unknown, NodeRecord | null, NodeQueryArgs>
  }

  NodeObject: {
    parents: ResolverFn<NodeRecord, Array<NodeRecord | null> | null>
    parentIds: ResolverFn<NodeRecord, string[] | null>
    trigger: ResolverFn<NodeRecord, TriggerRecord | null>
    triggerId: ResolverFn<NodeRecord, string | null>
    responses: ResolverFn<NodeRecord, Array<ResponseRecord | null> | null>
    responseIds: ResolverFn<NodeRecord, string[] | null>
    actions: ResolverFn<NodeRecord, Array<ActionRecord | null> | null>
    actionIds: ResolverFn<NodeRecord, string[] | null>
    priority: ResolverFn<NodeRecord, number | null>
    colour: ResolverFn<NodeRecord, string | null>
  }

  Action: {
    resourceTemplateId: ResolverFn<ActionRecord, string | null>
    resourceTemplate: ResolverFn<ActionRecord, ResourceTemplateRecord | null>
  }

  Trigger: {
    resourceTemplateId: ResolverFn<TriggerRecord, string | null>
    resourceTemplate: ResolverFn<TriggerRecord, ResourceTemplateRecord | null>
  }

  Response: {
    platforms: ResolverFn<ResponseRecord, ResponsePlatformRecord[] | null>
  }

  ResponsePlatform: {
    localeGroups: ResolverFn<ResponsePlatformRecord, ResponseLocaleGroupRecord[] | null>
  }

  ResponseLocaleGroup: {
    localeGroupId: ResolverFn<ResponseLocaleGroupRecord, string | null>
    variations: ResolverFn<ResponseLocaleGroupRecord, ResponseVariationRecord[] | null>
  }

  ResponseVariation: {
    responses: ResolverFn<ResponseVariationRecord, JsonValue | null>
  }

  ResourceTemplate: {
    /** Non-null in the schema; falls back to `updatedAt` when absent. */
    createdAt: ResolverFn<ResourceTemplateRecord, number>
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP layer                                                                 */
/* -------------------------------------------------------------------------- */

/** The object returned by `createApp()`; supports embedding and tests. */
export interface AppServer {
  app: import('express').Express
  httpServer: Server
  apolloServer: ApolloServer<GraphQLContext>
  dataStore: DataStore
  config: AppConfig
  listen(options?: ListenOptions): Promise<ServerAddress>
  stop(): Promise<void>
}
