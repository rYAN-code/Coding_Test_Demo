/**
 * Datasource layer.
 *
 * The five JSON files that ship with the code test are the single source of
 * truth for the API. They are loaded once at boot and indexed by `_id` so the
 * resolvers can turn the id references stored in node.json (trigger, responses,
 * actions, parents) into real GraphQL objects without any database.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { config } from '../config.js'
import type {
  ActionRecord,
  CollectionFiles,
  Collections,
  DataStore,
  IdList,
  NodeRecord,
  ResourceTemplateRecord,
  ResponseRecord,
  TriggerRecord,
} from '../types.js'

/** Files that make up the dataset, mapped to the collection name we expose. */
export const COLLECTION_FILES: CollectionFiles = Object.freeze({
  nodes: 'node.json',
  triggers: 'trigger.json',
  responses: 'response.json',
  actions: 'action.json',
  resourceTemplates: 'resourceTemplate.json',
})

/** Minimal shape every datasource record must have. */
interface Identifiable {
  _id?: unknown
}

function readCollection<TRecord extends Identifiable>(dataDir: string, fileName: string): TRecord[] {
  const filePath = join(dataDir, fileName)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Unable to read datasource file "${filePath}": ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Datasource file "${filePath}" is not valid JSON: ${(error as Error).message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Datasource file "${filePath}" must contain a JSON array`)
  }
  return parsed as TRecord[]
}

/** Build a `_id` -> record index. First occurrence wins for duplicated ids. */
function indexById<TRecord extends Identifiable>(records: TRecord[]): Map<string, TRecord> {
  const index = new Map<string, TRecord>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const id = record._id
    if (id === undefined || id === null) continue
    const key = String(id)
    if (!index.has(key)) index.set(key, record)
  }
  return index
}

/**
 * Resolve a list of ids to records. `null` stays `null` (the GraphQL field was
 * absent in the datasource) and unknown ids become `null` entries instead of
 * crashing, which keeps list positions aligned with `parentIds`/`responseIds`.
 */
function resolveIdList<TRecord>(ids: IdList, ...indexes: Array<ReadonlyMap<string, TRecord>>): Array<TRecord | null> | null {
  if (ids === undefined || ids === null) return null
  const list = Array.isArray(ids) ? ids : [ids]
  return list.map((id) => {
    if (id === undefined || id === null) return null
    const key = String(id)
    for (const index of indexes) {
      const record = index.get(key)
      if (record) return record
    }
    return null
  })
}

/**
 * Create an immutable snapshot of the JSON datasource.
 *
 * @param dataDir directory containing the five JSON files
 */
export function createDataStore(dataDir: string = config.dataDir): DataStore {
  const collections: Collections = {
    nodes: readCollection<NodeRecord>(dataDir, COLLECTION_FILES.nodes),
    triggers: readCollection<TriggerRecord>(dataDir, COLLECTION_FILES.triggers),
    responses: readCollection<ResponseRecord>(dataDir, COLLECTION_FILES.responses),
    actions: readCollection<ActionRecord>(dataDir, COLLECTION_FILES.actions),
    resourceTemplates: readCollection<ResourceTemplateRecord>(dataDir, COLLECTION_FILES.resourceTemplates),
  }

  const { nodes, triggers, responses, actions, resourceTemplates } = collections

  const nodesByCompositeId = new Map<string, NodeRecord>()
  for (const node of nodes) {
    if (node.compositeId && !nodesByCompositeId.has(String(node.compositeId))) {
      nodesByCompositeId.set(String(node.compositeId), node)
    }
  }

  /** The root of the flow: the node flagged `root: true`, else the first node. */
  const rootNode: NodeRecord | null = nodes.find((node) => node.root === true) ?? nodes[0] ?? null

  const nodesById = indexById(nodes)
  const triggersById = indexById(triggers)
  const responsesById = indexById(responses)
  const actionsById = indexById(actions)
  const resourceTemplatesById = indexById(resourceTemplates)

  const store: DataStore = {
    dataDir,
    nodes,
    triggers,
    responses,
    actions,
    resourceTemplates,
    nodesById,
    triggersById,
    responsesById,
    actionsById,
    resourceTemplatesById,
    nodesByCompositeId,
    rootNode,

    /** Look a node up by `_id`, falling back to its `compositeId`. */
    getNode(nodeId: string | null | undefined): NodeRecord | null {
      if (nodeId === undefined || nodeId === null || nodeId === '') return null
      const key = String(nodeId)
      return nodesById.get(key) ?? nodesByCompositeId.get(key) ?? null
    },
    getNodes(ids: IdList): Array<NodeRecord | null> | null {
      return resolveIdList(ids, nodesById, nodesByCompositeId)
    },
    getTriggers(ids: IdList): Array<TriggerRecord | null> | null {
      return resolveIdList(ids, triggersById)
    },
    getResponses(ids: IdList): Array<ResponseRecord | null> | null {
      return resolveIdList(ids, responsesById)
    },
    getActions(ids: IdList): Array<ActionRecord | null> | null {
      return resolveIdList(ids, actionsById)
    },
    getResourceTemplates(ids: IdList): Array<ResourceTemplateRecord | null> | null {
      return resolveIdList(ids, resourceTemplatesById)
    },
  }

  return Object.freeze(store)
}

let sharedStore: DataStore | undefined

/** Process-wide lazily created store (handy for resolvers and scripts). */
export function getDataStore(): DataStore {
  if (!sharedStore) sharedStore = createDataStore()
  return sharedStore
}
