/**
 * Loads the JSON datasource that ships with the code test. The test suite
 * derives its expectations from these files so the checks always compare the
 * API response against the *source of truth*, not against a hard-coded copy.
 *
 * Read-only: nothing in tests/ writes to json/.
 */
import { readFileSync } from 'node:fs'

function loadCollection(fileName) {
  const url = new URL(`../../json/${fileName}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8'))
}

export const source = {
  nodes: loadCollection('node.json'),
  triggers: loadCollection('trigger.json'),
  responses: loadCollection('response.json'),
  actions: loadCollection('action.json'),
  resourceTemplates: loadCollection('resourceTemplate.json'),
}

/** `_id` -> record map for every collection (first occurrence wins, like the store). */
export function indexBy(records) {
  const map = new Map()
  for (const record of records) {
    if (record && record._id !== undefined && !map.has(String(record._id))) map.set(String(record._id), record)
  }
  return map
}

export const byId = {
  nodes: indexBy(source.nodes),
  triggers: indexBy(source.triggers),
  responses: indexBy(source.responses),
  actions: indexBy(source.actions),
  resourceTemplates: indexBy(source.resourceTemplates),
}

/** The root node as declared by the datasource (`root: true`). */
export const rootNode = source.nodes.find((node) => node?.root === true) ?? source.nodes[0]

/** Flow node whose pre/inline/post actions exercise the merged `actionIds` contract. */
export const nodeWithActions = source.nodes.find((node) =>
  [node.preActions, node.actions, node.postActions].some((value) => value !== null && value !== undefined),
)

/** A node that has a trigger (so NodeObject.trigger can be exercised). */
export const nodeWithTrigger = source.nodes.find(
  (node) => node.trigger !== null && node.trigger !== undefined && node.trigger !== '',
)

/** A node without a trigger (so the `null` branch is exercised). */
export const nodeWithoutTrigger = source.nodes.find(
  (node) => node.trigger === null || node.trigger === undefined,
)
