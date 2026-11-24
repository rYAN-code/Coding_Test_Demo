/**
 * GraphQL resolvers.
 *
 * The JSON datasource is deliberately kept as close to the schema as possible:
 * most fields resolve with GraphQL's default resolver, and explicit resolvers
 * only exist where the datasource stores a reference (`node.trigger`,
 * `node.responses`, `node.actions`, `node.parents`) or uses a different key
 * (`localeGroup` -> `localeGroupId`, `color` -> `colour`).
 *
 * The resolver map is typed against `Resolvers` from `../types.js`, so a typo or
 * a wrong parent/return type is a compile-time error.
 */
import { scalars } from '../scalars.js'
import type {
  ActionRecord,
  GraphQLContext,
  NodeRecord,
  Resolvers,
  ResourceTemplateRecord,
  ResponseLocaleGroupRecord,
  ResponsePlatformRecord,
  ResponseRecord,
  ResponseVariationRecord,
  TriggerRecord,
} from '../types.js'

/** Accept either a raw id or an already-populated `{ _id }` reference. */
function refId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'object') {
    const id = (value as { _id?: unknown })._id
    return id === undefined || id === null ? null : String(id)
  }
  return String(value)
}

/** Read a possibly-absent property from a record without widening the record type. */
function readRaw(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key]
}

type ObjectLinkKey = 'parents' | 'responses' | 'actions'
type IdLinkKey = 'parentIds' | 'responseIds' | 'actionIds'

interface LinkList {
  /** Raw entries as stored in the datasource (ids or populated objects). */
  ids: unknown[]
  /** True when the datasource already stores populated objects. */
  isObjects: boolean
}

/** Split `node.responses` style data into: raw ids (`*Ids`) and objects. */
function linkList(node: NodeRecord, objectKey: ObjectLinkKey, idKey: IdLinkKey): LinkList | null {
  const objectValue = readRaw(node, objectKey)
  if (Array.isArray(objectValue)) {
    return { ids: objectValue, isObjects: objectValue.some((item) => item !== null && typeof item === 'object') }
  }
  const idValue = readRaw(node, idKey)
  if (Array.isArray(idValue)) return { ids: idValue, isObjects: false }

  const single = objectValue ?? idValue
  if (single === undefined || single === null) return null
  return { ids: [single], isObjects: typeof single === 'object' }
}

/** Raw ids for a list-valued link on a node. */
function nodeLinkIds(node: NodeRecord, objectKey: ObjectLinkKey, idKey: IdLinkKey): string[] | null {
  const list = linkList(node, objectKey, idKey)
  if (!list) return null
  return list.ids.map(refId).filter((id): id is string => id !== null)
}

/**
 * Populated records for a list-valued link on a node. `null` is returned when
 * the node has no such link at all, so a missing field stays `null` instead of
 * becoming an empty list.
 */
function nodeLinkRecords<TRecord>(
  node: NodeRecord,
  objectKey: ObjectLinkKey,
  idKey: IdLinkKey,
  resolveRecords: (ids: string[]) => Array<TRecord | null> | null,
): Array<TRecord | null> | null {
  const list = linkList(node, objectKey, idKey)
  if (!list) return null
  if (list.isObjects) return list.ids as TRecord[]
  const ids = list.ids.map(refId).filter((id): id is string => id !== null)
  return resolveRecords(ids)
}

/**
 * The datasource splits a node's side effects into `preActions`, `actions` and
 * `postActions`, while the GraphQL schema exposes a single `actions` /
 * `actionIds` pair. They are therefore merged (pre -> inline -> post, de-duped)
 * so no action referenced by the dataset becomes unreachable through the API.
 * `null` is returned when the node references no action at all, mirroring the
 * datasource.
 */
function nodeActionIds(node: NodeRecord): string[] | null {
  const raw = [readRaw(node, 'preActions'), readRaw(node, 'actions'), readRaw(node, 'postActions')].flatMap((value) => {
    if (value === undefined || value === null) return []
    return Array.isArray(value) ? (value as unknown[]) : [value]
  })
  const ids = raw.map(refId).filter((id): id is string => id !== null)
  const unique = [...new Set(ids)]
  return unique.length > 0 ? unique : null
}

/** Resolve one reference against a datasource index. */
function resolveOne<TRecord>(
  index: ReadonlyMap<string, TRecord>,
  id: string | null,
): TRecord | null {
  if (id === null) return null
  return index.get(id) ?? null
}

export const resolvers: Resolvers = {
  Long: scalars.Long,
  JSON: scalars.JSON,

  Query: {
    node(_parent, args, context: GraphQLContext): NodeRecord | null {
      const { dataStore } = context
      const { nodeId } = args
      // `node(nodeId: ID)` is nullable: no argument means "the root node".
      if (nodeId === undefined || nodeId === null || nodeId === '') return dataStore.rootNode
      return dataStore.getNode(nodeId)
    },
  },

  NodeObject: {
    parents(node, _args, context: GraphQLContext) {
      return nodeLinkRecords<NodeRecord>(node, 'parents', 'parentIds', (ids) => context.dataStore.getNodes(ids))
    },
    parentIds(node) {
      return nodeLinkIds(node, 'parents', 'parentIds')
    },
    triggerId(node) {
      return refId(node.triggerId ?? node.trigger)
    },
    trigger(node, _args, context: GraphQLContext) {
      const id = refId(node.triggerId ?? node.trigger)
      return resolveOne(context.dataStore.triggersById, id)
    },
    responses(node, _args, context: GraphQLContext) {
      return nodeLinkRecords<ResponseRecord>(node, 'responses', 'responseIds', (ids) =>
        context.dataStore.getResponses(ids),
      )
    },
    responseIds(node) {
      return nodeLinkIds(node, 'responses', 'responseIds')
    },
    actions(node, _args, context: GraphQLContext) {
      const ids = nodeActionIds(node)
      if (ids === null) return null
      return context.dataStore.getActions(ids)
    },
    actionIds(node) {
      return nodeActionIds(node)
    },
    // The datasource does not carry these fields on every node; they stay
    // null instead of being invented.
    priority(node) {
      return node.priority ?? null
    },
    colour(node) {
      return node.colour ?? node.color ?? null
    },
  },

  Action: {
    resourceTemplateId(action: ActionRecord) {
      return refId(action.resourceTemplateId)
    },
    resourceTemplate(action: ActionRecord, _args, context: GraphQLContext) {
      return resolveOne(context.dataStore.resourceTemplatesById, refId(action.resourceTemplateId))
    },
  },

  Trigger: {
    resourceTemplateId(trigger: TriggerRecord) {
      return refId(trigger.resourceTemplateId)
    },
    resourceTemplate(trigger: TriggerRecord, _args, context: GraphQLContext) {
      return resolveOne(context.dataStore.resourceTemplatesById, refId(trigger.resourceTemplateId))
    },
  },

  Response: {
    platforms(response: ResponseRecord) {
      return response.platforms ?? null
    },
  },

  ResponsePlatform: {
    localeGroups(platform: ResponsePlatformRecord) {
      return platform.localeGroups ?? null
    },
  },

  ResponseLocaleGroup: {
    // The datasource stores the locale group under `localeGroup`, while the
    // schema exposes it as `localeGroupId`.
    localeGroupId(localeGroup: ResponseLocaleGroupRecord) {
      return localeGroup.localeGroupId ?? localeGroup.localeGroup ?? null
    },
    variations(localeGroup: ResponseLocaleGroupRecord) {
      return localeGroup.variations ?? null
    },
  },

  ResponseVariation: {
    responses(variation: ResponseVariationRecord) {
      return variation.responses ?? null
    },
  },

  ResourceTemplate: {
    // The required schema declares `createdAt: Long!`, but the two trigger
    // resource templates in the provided datasource (the "Keyword / Payload"
    // and "Predefined Triggers" templates) only carry `updatedAt`. Returning
    // `updatedAt` as a fallback keeps the non-null contract intact and the API
    // usable (without it every query touching `trigger.resourceTemplate` would
    // fail); `updatedAt` is the latest known point in time the record existed.
    createdAt(template: ResourceTemplateRecord): number {
      return template.createdAt ?? template.updatedAt ?? 0
    },
  },
}

export default resolvers
