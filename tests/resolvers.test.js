/**
 * Resolver contract.
 *
 * Drives the API with real ids from json/node.json and compares the response
 * against the datasource: node lookup (by _id, by compositeId, root fallback,
 * unknown -> null), parentIds/parents, trigger/triggerId, responses/responseIds,
 * actions/actionIds, and the full nested mapping chain.
 */
import { after, before, describe, test } from 'node:test'

import { assert, expectData, gql, startServer } from './helpers/harness.js'
import { byId, rootNode, source } from './helpers/fixtures.js'

const NODE_BY_ID_QUERY = /* GraphQL */ `
  query NodeById($nodeId: ID) {
    node(nodeId: $nodeId) {
      _id
      createdAt
      updatedAt
      name
      description
      compositeId
      global
      root
      priority
      colour
      parentIds
      parents {
        _id
      }
      triggerId
      trigger {
        _id
      }
      responseIds
      responses {
        _id
      }
      actionIds
      actions {
        _id
      }
    }
  }
`

const NODE_RESPONSES_QUERY = /* GraphQL */ `
  query NodeResponses($nodeId: ID) {
    node(nodeId: $nodeId) {
      _id
      responses {
        _id
        createdAt
        updatedAt
        name
        description
        platforms {
          integrationId
          build
          localeGroups {
            localeGroupId
            variations {
              name
              responses
            }
          }
        }
      }
    }
  }
`

/** Datasource-level reference normalisation, mirroring the documented contract. */
function refId(value) {
  if (value === undefined || value === null) return null
  return typeof value === 'object' ? (value._id ?? null) : value
}

function expectedActionIds(node) {
  const raw = [node.preActions, node.actions, node.postActions].flatMap((value) => {
    if (value === undefined || value === null) return []
    return Array.isArray(value) ? value : [value]
  })
  const ids = raw.map(refId).filter((id) => id !== null && id !== undefined)
  return ids.length > 0 ? [...new Set(ids)] : null
}

function resolveNodeByAnyId(id) {
  if (id === null || id === undefined) return null
  const key = String(id)
  return (
    source.nodes.find((node) => String(node._id) === key) ??
    source.nodes.find((node) => node.compositeId != null && String(node.compositeId) === key) ??
    null
  )
}

describe('Query.node resolvers', () => {
  let server

  before(async () => {
    server = await startServer()
  })

  after(async () => {
    await server.close()
  })

  test('resolves every node in json/node.json by _id', async (t) => {
    assert.ok(source.nodes.length > 0)
    for (const expected of source.nodes) {
      await t.test(`${expected._id} (${expected.name})`, async () => {
        const data = expectData(
          await gql(server.baseUrl, NODE_BY_ID_QUERY, { nodeId: expected._id }),
          `node ${expected._id}`,
        )
        const actual = data.node
        assert.ok(actual, `node ${expected._id} resolved to null`)

        assert.equal(actual._id, expected._id)
        assert.equal(actual.name, expected.name)
        assert.equal(actual.description ?? null, expected.description ?? null)
        assert.strictEqual(actual.createdAt, expected.createdAt)
        assert.strictEqual(actual.updatedAt ?? null, expected.updatedAt ?? null)
        assert.equal(actual.compositeId ?? null, expected.compositeId ?? null)
        assert.equal(actual.global ?? null, expected.global ?? null)
        assert.equal(actual.root ?? null, expected.root ?? null)

        // Neither key exists in the datasource, so they must stay null.
        assert.equal(actual.priority, null, 'priority is absent from the datasource')
        assert.equal(actual.colour, null, 'colour is absent from the datasource')

        // parentIds keep the RAW compositeId strings from node.json.
        assert.deepEqual(actual.parentIds, expected.parents ?? null)

        // parents are resolved through compositeId.
        const expectedParentIds = expected.parents ?? null
        if (expectedParentIds === null) {
          assert.equal(actual.parents, null)
        } else {
          assert.equal(actual.parents.length, expectedParentIds.length)
          expectedParentIds.forEach((parentId, index) => {
            const resolved = resolveNodeByAnyId(parentId)
            assert.ok(resolved, `parent compositeId ${parentId} not found in datasource`)
            assert.equal(actual.parents[index]._id, resolved._id)
          })
        }

        // triggerId is raw; trigger is populated from trigger.json.
        assert.equal(actual.triggerId ?? null, expected.trigger ?? null)
        if (expected.trigger == null) {
          assert.equal(actual.trigger, null)
        } else {
          const trigger = byId.triggers.get(String(expected.trigger))
          assert.ok(trigger, `trigger ${expected.trigger} referenced by ${expected._id} not found`)
          assert.equal(actual.trigger._id, trigger._id)
        }

        // responseIds raw; responses resolved from response.json.
        assert.deepEqual(actual.responseIds, expected.responses ?? null)
        if (expected.responses == null) {
          assert.equal(actual.responses, null)
        } else {
          assert.equal(actual.responses.length, expected.responses.length)
          expected.responses.forEach((responseId, index) => {
            assert.ok(byId.responses.has(String(responseId)), `response ${responseId} not found`)
            assert.equal(actual.responses[index]._id, String(responseId))
          })
        }

        // actions = ordered, de-duped union of preActions + actions + postActions.
        const expectedActions = expectedActionIds(expected)
        assert.deepEqual(actual.actionIds, expectedActions)
        if (expectedActions === null) {
          assert.equal(actual.actions, null)
        } else {
          assert.equal(actual.actions.length, expectedActions.length)
          expectedActions.forEach((actionId, index) => {
            assert.ok(byId.actions.has(String(actionId)), `action ${actionId} not found`)
            assert.equal(actual.actions[index]._id, String(actionId))
          })
        }
      })
    }
  })

  test('looks a node up by compositeId when no _id matches', async (t) => {
    const nodesWithCompositeId = source.nodes.filter((node) => node.compositeId != null)
    assert.ok(nodesWithCompositeId.length >= 2, 'fixture should contain compositeIds')
    for (const expected of nodesWithCompositeId) {
      await t.test(`compositeId ${expected.compositeId}`, async () => {
        const data = expectData(
          await gql(server.baseUrl, `{ node(nodeId: ${JSON.stringify(expected.compositeId)}) { _id name } }`),
          `compositeId ${expected.compositeId}`,
        )
        assert.equal(data.node._id, expected._id)
        assert.equal(data.node.name, expected.name)
      })
    }
  })

  test('omitted nodeId returns the root node', async () => {
    const data = expectData(await gql(server.baseUrl, `{ node { _id name root } }`), 'omitted nodeId')
    assert.equal(data.node._id, rootNode._id)
    assert.equal(data.node.name, rootNode.name)
    assert.equal(data.node.root, true)
  })

  test('explicit null nodeId returns the root node', async () => {
    const data = expectData(
      await gql(server.baseUrl, NODE_BY_ID_QUERY, { nodeId: null }),
      'null nodeId',
    )
    assert.equal(data.node._id, rootNode._id)
  })

  test('empty-string nodeId behaves like an omitted id (returns root node)', async () => {
    // Documented implementation detail in src/schema/resolvers.ts.
    const data = expectData(await gql(server.baseUrl, `{ node(nodeId: "") { _id } }`), 'empty nodeId')
    assert.equal(data.node._id, rootNode._id)
  })

  test('unknown nodeId returns null (HTTP 200, no errors)', async () => {
    for (const nodeId of ['does-not-exist', '999999999999999999999999']) {
      const result = await gql(server.baseUrl, `query($id: ID) { node(nodeId: $id) { _id } }`, { id: nodeId })
      const data = expectData(result, `unknown nodeId ${nodeId}`)
      assert.equal(data.node, null)
    }
  })

  test('contract example: "User\'s Email" parents/actions', async () => {
    const data = expectData(
      await gql(
        server.baseUrl,
        `{ node(nodeId: "6297172e70a0c165b989cd10") {
            _id name
            parentIds parents { _id name }
            actionIds actions { _id name resourceTemplateId resourceTemplate { _id name } }
          } }`,
      ),
      "User's Email",
    )
    const node = data.node
    assert.equal(node.name, "User's Email")
    assert.deepEqual(node.parentIds, ['rCMUtmL3aOULyqBL'])
    assert.deepEqual(node.parents, [{ _id: '6297164810f52524ba1a9300', name: 'Sign up Webinar' }])
    assert.deepEqual(node.actionIds, ['6530933e6a1690d2f0c78a92'])
    assert.equal(node.actions.length, 1)
    assert.equal(node.actions[0]._id, '6530933e6a1690d2f0c78a92')
    assert.equal(node.actions[0].name, 'Send Email Action')
    assert.equal(node.actions[0].resourceTemplateId, '62cfc19bf4573e1b32ca2295')
    assert.equal(node.actions[0].resourceTemplate.name, 'Send Email')
  })

  test('triggerless node: triggerId and trigger are null', async () => {
    const data = expectData(
      await gql(
        server.baseUrl,
        `{ node(nodeId: "62971b3470a0c1803c89cd15") {
            _id triggerId trigger { _id }
            responseIds responses { _id }
            actionIds actions { _id }
          } }`,
      ),
      'triggerless node',
    )
    const node = data.node
    assert.equal(node.triggerId, null)
    assert.equal(node.trigger, null)
    assert.equal(node.responseIds, null)
    assert.equal(node.responses, null)
    assert.equal(node.actionIds, null)
    assert.equal(node.actions, null)
  })

  test('Node -> trigger -> resourceTemplate resolves via resourceTemplateId', async () => {
    // Expected values are derived from trigger.json (node -> trigger -> resourceTemplateId).
    const cases = [
      { nodeId: '6297164810f52524ba1a9300', nodeName: 'Sign up Webinar' },
      { nodeId: '6297172e70a0c165b989cd10', nodeName: "User's Email" },
      { nodeId: '629718ba70a0c1836d89cd12', nodeName: 'Book for Consulting' },
    ]

    for (const testCase of cases) {
      const sourceNode = byId.nodes.get(testCase.nodeId)
      assert.ok(sourceNode, `node ${testCase.nodeId} missing from fixture`)
      const triggerId = String(sourceNode.trigger)
      const sourceTrigger = byId.triggers.get(triggerId)
      assert.ok(sourceTrigger, `trigger ${triggerId} missing from fixture`)
      const templateId = String(sourceTrigger.resourceTemplateId)
      const sourceTemplate = byId.resourceTemplates.get(templateId)
      assert.ok(sourceTemplate, `template ${templateId} missing from fixture`)

      const data = expectData(
        await gql(
          server.baseUrl,
          `query($id: ID) { node(nodeId: $id) {
              _id name
              triggerId
              trigger { _id name createdAt resourceTemplateId resourceTemplate { _id name description integrationId functionString key } }
            } }`,
          { id: testCase.nodeId },
        ),
        `trigger chain for ${testCase.nodeId}`,
      )
      const node = data.node
      assert.equal(node.name, testCase.nodeName)
      assert.equal(node.triggerId, triggerId)
      assert.equal(node.trigger._id, triggerId)
      assert.equal(node.trigger.name, sourceTrigger.name)

      assert.strictEqual(node.trigger.createdAt, sourceTrigger.createdAt)
      assert.equal(node.trigger.resourceTemplateId, templateId)

      assert.ok(node.trigger.resourceTemplate, 'resourceTemplate should resolve')
      assert.equal(node.trigger.resourceTemplate._id, sourceTemplate._id)
      assert.equal(node.trigger.resourceTemplate.name, sourceTemplate.name)
      assert.equal(node.trigger.resourceTemplate.description ?? null, sourceTemplate.description ?? null)
      assert.equal(node.trigger.resourceTemplate.integrationId ?? null, sourceTemplate.integrationId ?? null)
      assert.equal(node.trigger.resourceTemplate.functionString ?? null, sourceTemplate.functionString ?? null)
      assert.equal(node.trigger.resourceTemplate.key ?? null, sourceTemplate.key ?? null)
    }
  })

  test('Node -> responses -> platforms -> localeGroups -> variations -> responses (JSON)', async (t) => {
    for (const node of source.nodes) {
      if (node.responses == null) continue
      await t.test(`node ${node._id}`, async () => {
        const data = expectData(
          await gql(server.baseUrl, NODE_RESPONSES_QUERY, { nodeId: node._id }),
          `responses for node ${node._id}`,
        )
        assert.equal(data.node.responses.length, node.responses.length)

        node.responses.forEach((responseId, index) => {
          const expected = byId.responses.get(String(responseId))
          assert.ok(expected, `response ${responseId} not found in json/response.json`)
          const actual = data.node.responses[index]

          assert.equal(actual._id, expected._id)
          assert.equal(actual.name, expected.name)
          assert.equal(actual.description ?? null, expected.description ?? null)
          assert.strictEqual(actual.createdAt, expected.createdAt)
          assert.strictEqual(actual.updatedAt ?? null, expected.updatedAt ?? null)

          const sourcePlatforms = expected.platforms ?? null
          if (sourcePlatforms === null) {
            assert.equal(actual.platforms, null)
            return
          }
          assert.equal(actual.platforms.length, sourcePlatforms.length)
          sourcePlatforms.forEach((sourcePlatform, platformIndex) => {
            const platform = actual.platforms[platformIndex]
            assert.equal(platform.integrationId ?? null, sourcePlatform.integrationId ?? null)
            assert.strictEqual(platform.build ?? null, sourcePlatform.build ?? null)

            const sourceLocaleGroups = sourcePlatform.localeGroups ?? null
            if (sourceLocaleGroups === null) {
              assert.equal(platform.localeGroups, null)
              return
            }
            assert.equal(platform.localeGroups.length, sourceLocaleGroups.length)
            sourceLocaleGroups.forEach((sourceGroup, groupIndex) => {
              const group = platform.localeGroups[groupIndex]
              // `localeGroup` in the datasource maps to `localeGroupId` in GraphQL.
              assert.equal(group.localeGroupId, sourceGroup.localeGroup)

              const sourceVariations = sourceGroup.variations ?? null
              if (sourceVariations === null) {
                assert.equal(group.variations, null)
                return
              }
              assert.equal(group.variations.length, sourceVariations.length)
              sourceVariations.forEach((sourceVariation, variationIndex) => {
                const variation = group.variations[variationIndex]
                assert.equal(variation.name, sourceVariation.name)
                // JSON scalar: must round-trip the stored payload exactly.
                assert.deepStrictEqual(variation.responses, sourceVariation.responses)
              })
            })
          })
        })
      })
    }
  })
})
