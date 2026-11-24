/**
 * Value fidelity.
 *
 * - Long scalars must serialize as JSON *numbers* identical to the datasource
 *   (e.g. createdAt 1654046260304, not "1654046260304").
 * - JSON scalars (`resourceTemplate.schema`, `responseVariation.responses`)
 *   must round-trip the stored JSON untouched.
 * - Datasource-only keys must not leak into GraphQL results.
 */
import { after, before, describe, test } from 'node:test'

import { assert, expectData, gql, startServer } from './helpers/harness.js'
import { byId, source } from './helpers/fixtures.js'
import { EXPECTED_FIELDS } from './helpers/schema-contract.js'

function assertKeysExactly(object, expectedFields, label) {
  assert.deepEqual(
    Object.keys(object).sort(),
    [...expectedFields].sort(),
    `${label}: unexpected/missing fields`,
  )
}

/** Ordered, de-duped union of a node's preActions + actions + postActions. */
function expectedActionIdsOf(node) {
  const ids = [node.preActions, node.actions, node.postActions]
    .flatMap((value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]))
    .map((value) => (value && typeof value === 'object' ? value._id : value))
    .filter((id) => id !== undefined && id !== null)
  return [...new Set(ids)]
}

const ROOT_FULL_QUERY = /* GraphQL */ `
  query {
    node {
      _id
      createdAt
      updatedAt
      name
      description
      parentIds
      parents {
        _id
      }
      root
      triggerId
      trigger {
        _id
      }
      responseIds
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
      actionIds
      actions {
        _id
      }
      priority
      compositeId
      global
      colour
    }
  }
`

describe('value fidelity', () => {
  let server

  before(async () => {
    server = await startServer()
  })

  after(async () => {
    await server.close()
  })

  test('Long timestamps serialize as JSON numbers equal to the datasource values', async () => {
    const result = await gql(
      server.baseUrl,
      `{ node { createdAt updatedAt responses { createdAt updatedAt } } }`,
    )
    const data = expectData(result, 'root timestamps')

    assert.strictEqual(data.node.createdAt, 1654046260304)
    assert.strictEqual(data.node.updatedAt, 1696991678515)
    assert.equal(typeof data.node.createdAt, 'number')
    assert.equal(typeof data.node.updatedAt, 'number')

    // Byte-level check: the values must be emitted unquoted (numbers, not strings).
    assert.ok(
      result.text.includes('"createdAt":1654046260304'),
      `createdAt was not serialized as a JSON number: ${result.text.slice(0, 300)}`,
    )
    assert.ok(
      result.text.includes('"updatedAt":1696991678515'),
      `updatedAt was not serialized as a JSON number: ${result.text.slice(0, 300)}`,
    )
    assert.ok(
      !result.text.includes('"1654046260304"'),
      'createdAt must not be serialized as a string',
    )

    // Every node timestamp must be a JS number identical to node.json.
    for (const node of source.nodes) {
      const nodeData = expectData(
        await gql(
          server.baseUrl,
          `query($id: ID) { node(nodeId: $id) { createdAt updatedAt } }`,
          { id: node._id },
        ),
        `timestamps for ${node._id}`,
      )
      assert.equal(typeof nodeData.node.createdAt, 'number', `${node._id} createdAt is not a number`)
      assert.strictEqual(nodeData.node.createdAt, node.createdAt)
      assert.strictEqual(nodeData.node.updatedAt ?? null, node.updatedAt ?? null)
    }
  })

  test('ResourceTemplate.schema round-trips the stored JSON document', async () => {
    const paths = [
      {
        templateId: '62cfc19bf4573e1b32ca2295',
        query: `{ node(nodeId: "6297172e70a0c165b989cd10") { actions { resourceTemplate { _id name createdAt updatedAt schema } } } }`,
        get: (data) => data.node.actions[0].resourceTemplate,
      },
      {
        templateId: '61e9ba20f9b58155162dbf52',
        query: `{ node(nodeId: "6297172e70a0c165b989cd10") { trigger { resourceTemplate { _id name createdAt updatedAt schema } } } }`,
        get: (data) => data.node.trigger.resourceTemplate,
      },
      {
        templateId: '61e9ba20f9b581f25a2dbf51',
        query: `{ node(nodeId: "629718ba70a0c1836d89cd12") { trigger { resourceTemplate { _id name createdAt updatedAt schema } } } }`,
        get: (data) => data.node.trigger.resourceTemplate,
      },
    ]

    for (const testCase of paths) {
      const expected = byId.resourceTemplates.get(testCase.templateId)
      assert.ok(expected, `template ${testCase.templateId} missing from fixture`)
      assert.ok(expected.schema, `template ${testCase.templateId} has no schema in fixture`)

      const data = expectData(await gql(server.baseUrl, testCase.query), `schema ${testCase.templateId}`)
      const actual = testCase.get(data)
      assert.ok(actual, `template ${testCase.templateId} was not resolved`)
      assert.equal(actual._id, expected._id)
      assert.equal(actual.name, expected.name)
      assert.strictEqual(actual.updatedAt ?? null, expected.updatedAt ?? null)
      assert.deepStrictEqual(actual.schema, expected.schema)

      // It must be embedded as JSON (an object), not as a stringified blob.
      assert.equal(typeof actual.schema, 'object')
      assert.equal(Array.isArray(actual.schema), false)
    }
  })

  test('ResourceTemplate.createdAt keeps the non-null contract via the documented updatedAt fallback', async () => {
    // The PDF schema declares `createdAt: Long!` while two trigger templates in
    // the datasource only carry `updatedAt`; resolvers fall back to updatedAt.
    // Documented in README + docs/data-mapping.md — not a schema change.
    //
    // Reference values:
    //   61e9ba20f9b581f25a2dbf51 ("Keyword / Payload")     -> 1727122901548 (updatedAt)
    //   61e9ba20f9b58155162dbf52 ("Predefined Triggers")   -> 1727122901547 (updatedAt)
    //   62cfc19bf4573e1b32ca2295 ("Send Email", via action) -> 1654758039590 (real createdAt)
    const fallbackExpectations = {
      '61e9ba20f9b581f25a2dbf51': 1727122901548,
      '61e9ba20f9b58155162dbf52': 1727122901547,
    }

    const cases = [
      {
        label: 'node -> trigger -> resourceTemplate "Keyword / Payload"',
        nodeId: '6297164810f52524ba1a9300',
        via: 'trigger',
      },
      {
        label: 'node -> trigger -> resourceTemplate "Predefined Triggers"',
        nodeId: '6297172e70a0c165b989cd10',
        via: 'trigger',
      },
      {
        label: 'node -> action -> resourceTemplate "Send Email" (real createdAt)',
        nodeId: '6297172e70a0c165b989cd10',
        via: 'action',
        templateId: '62cfc19bf4573e1b32ca2295',
        expectedCreatedAt: 1654758039590,
      },
    ]

    for (const testCase of cases) {
      const sourceNode = byId.nodes.get(testCase.nodeId)
      assert.ok(sourceNode, `node ${testCase.nodeId} missing from fixture`)

      let templateId = testCase.templateId
      if (testCase.via === 'trigger') {
        const sourceTrigger = byId.triggers.get(String(sourceNode.trigger))
        assert.ok(sourceTrigger, `trigger ${sourceNode.trigger} missing from fixture`)
        templateId = String(sourceTrigger.resourceTemplateId)
      } else {
        const actionId = expectedActionIdsOf(sourceNode)[0]
        templateId = String(byId.actions.get(String(actionId)).resourceTemplateId)
      }

      const query =
        testCase.via === 'trigger'
          ? `{ node(nodeId: ${JSON.stringify(testCase.nodeId)}) { trigger { name resourceTemplate { _id createdAt updatedAt } } } }`
          : `{ node(nodeId: ${JSON.stringify(testCase.nodeId)}) { actions { resourceTemplate { _id createdAt updatedAt } } } }`

      const result = await gql(server.baseUrl, query)
      const data = expectData(result, testCase.label) // asserts HTTP 200 + no GraphQL errors
      const template =
        data.node.trigger?.resourceTemplate ?? data.node.actions?.[0]?.resourceTemplate
      assert.ok(template, `${testCase.label}: resourceTemplate did not resolve`)
      assert.equal(template._id, templateId)

      const sourceTemplate = byId.resourceTemplates.get(templateId)
      assert.ok(sourceTemplate)
      const expectedCreatedAt =
        testCase.expectedCreatedAt ?? sourceTemplate.createdAt ?? sourceTemplate.updatedAt ?? 0
      assert.equal(typeof template.createdAt, 'number', `${testCase.label}: createdAt must be a number`)
      assert.strictEqual(template.createdAt, expectedCreatedAt, testCase.label)
      assert.strictEqual(
        template.createdAt,
        sourceTemplate.createdAt ?? sourceTemplate.updatedAt ?? 0,
        `${testCase.label}: must be createdAt ?? updatedAt ?? 0`,
      )
      assert.strictEqual(template.updatedAt ?? null, sourceTemplate.updatedAt ?? null)

      if (fallbackExpectations[templateId] !== undefined) {
        assert.strictEqual(
          template.createdAt,
          fallbackExpectations[templateId],
          `${testCase.label}: fallback createdAt must equal updatedAt`,
        )
        // The datasource really has no createdAt for these templates.
        assert.equal(sourceTemplate.createdAt, undefined)
      }
    }
  })

  test('ResponseVariation.responses round-trips the stored JSON payload', async () => {
    // The root node's response is the only one with two platforms + WhatsApp
    // rich payloads, so it is the strongest JSON round-trip fixture.
    const expected = byId.responses.get('6296fcad70a0c11ddb89ccf0')
    const result = await gql(
      server.baseUrl,
      `{ node(nodeId: "6296be3470a0c1052f89cccb") { responses { _id name platforms { integrationId build localeGroups { localeGroupId variations { name responses } } } } } }`,
    )
    const data = expectData(result, 'root response JSON')
    assert.equal(data.node.responses.length, 1)
    const actual = data.node.responses[0]
    assert.equal(actual._id, expected._id)

    assert.equal(actual.platforms.length, expected.platforms.length)
    expected.platforms.forEach((sourcePlatform, platformIndex) => {
      const platform = actual.platforms[platformIndex]
      assert.equal(platform.integrationId, sourcePlatform.integrationId)
      assert.strictEqual(platform.build, sourcePlatform.build)
      const sourceGroup = sourcePlatform.localeGroups[0]
      const group = platform.localeGroups[0]
      assert.equal(group.localeGroupId, 'default')
      assert.equal(group.variations.length, sourceGroup.variations.length)
      sourceGroup.variations.forEach((sourceVariation, variationIndex) => {
        assert.equal(group.variations[variationIndex].name, sourceVariation.name)
        assert.deepStrictEqual(group.variations[variationIndex].responses, sourceVariation.responses)
      })
    })

    // Inline JSON object, not a quoted string.
    assert.ok(result.text.includes('"responses":[{"type":"TEXT"'), 'response JSON should be embedded as JSON')
    assert.ok(
      !result.text.includes('"responses":"[{'),
      'response JSON must not be double-encoded as a string',
    )
  })

  test('GraphQL results contain exactly the NodeObject/Response fields (no datasource leak)', async () => {
    const result = await gql(server.baseUrl, ROOT_FULL_QUERY)
    const data = expectData(result, 'root full selection')

    assertKeysExactly(data.node, EXPECTED_FIELDS.NodeObject, 'NodeObject')
    assert.equal(data.node.parents.length, 0)
    assert.equal(data.node.trigger, null)

    const response = data.node.responses[0]
    assertKeysExactly(response, EXPECTED_FIELDS.Response, 'Response')
    assertKeysExactly(response.platforms[0], EXPECTED_FIELDS.ResponsePlatform, 'ResponsePlatform')

    const localeGroup = response.platforms[0].localeGroups[0]
    assertKeysExactly(localeGroup, EXPECTED_FIELDS.ResponseLocaleGroup, 'ResponseLocaleGroup')
    assertKeysExactly(
      localeGroup.variations[0],
      EXPECTED_FIELDS.ResponseVariation,
      'ResponseVariation',
    )

    // Datasource-only keys never appear in the payload.
    for (const leaked of [
      'preActions',
      'postActions',
      'redirect',
      'analytics',
      'memberTagging',
      'saveCompositeId',
      'position',
      'tags',
      'params',
    ]) {
      assert.equal(result.text.includes(`"${leaked}"`), false, `payload leaks datasource key ${leaked}`)
    }
  })

  test('Trigger / Action / ResourceTemplate results contain exactly the schema fields', async () => {
    const data = expectData(
      await gql(
        server.baseUrl,
        `query($id: ID) {
          node(nodeId: $id) {
            trigger {
              _id
              createdAt
              updatedAt
              name
              description
              functionString
              resourceTemplateId
              resourceTemplate {
                _id
                createdAt
                updatedAt
                name
                description
                schema
                integrationId
                functionString
                key
              }
            }
            actions {
              _id
              createdAt
              updatedAt
              name
              description
              functionString
              resourceTemplateId
              resourceTemplate {
                _id
                createdAt
                updatedAt
                name
                description
                schema
                integrationId
                functionString
                key
              }
            }
          }
        }`,
        { id: '6297172e70a0c165b989cd10' },
      ),
      'trigger/action field sets',
    )

    const trigger = data.node.trigger
    assertKeysExactly(trigger, EXPECTED_FIELDS.Trigger, 'Trigger')
    // The required schema keeps ResourceTemplate.createdAt: Long! (asserted
    // again in schema.test.js); the datasource-level fallback is exercised in
    // the dedicated createdAt test above.
    assertKeysExactly(
      trigger.resourceTemplate,
      EXPECTED_FIELDS.ResourceTemplate,
      'ResourceTemplate (trigger)',
    )

    const action = data.node.actions[0]
    assertKeysExactly(action, EXPECTED_FIELDS.Action, 'Action')
    assertKeysExactly(action.resourceTemplate, EXPECTED_FIELDS.ResourceTemplate, 'ResourceTemplate (action)')
    assert.strictEqual(action.resourceTemplate.createdAt, 1654758039590)
    assert.deepStrictEqual(
      action.resourceTemplate.schema,
      byId.resourceTemplates.get('62cfc19bf4573e1b32ca2295').schema,
    )
  })

  test('Int field build is a number and JSON nulls stay null', async () => {
    const data = expectData(
      await gql(
        server.baseUrl,
        `{ node { priority colour responses { platforms { build } } } }`,
      ),
      'build/priority',
    )
    assert.equal(data.node.priority, null)
    assert.equal(data.node.colour, null)
    const builds = data.node.responses[0].platforms.map((platform) => platform.build)
    assert.deepEqual(builds, [1, 2])
    for (const build of builds) assert.equal(typeof build, 'number')
  })
})
