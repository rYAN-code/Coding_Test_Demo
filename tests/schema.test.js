/**
 * Schema / introspection contract.
 *
 * With a valid token, introspection must expose exactly the nine object types
 * of the PDF schema (plus the Long/JSON scalars) and exactly the documented
 * field sets — no datasource-only keys may leak into the schema.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { expectData, expectUnauthenticated, gql, startServer } from './helpers/harness.js'
import {
  EXPECTED_FIELDS,
  EXPECTED_OBJECT_TYPES,
  EXPECTED_SCALARS,
  FORBIDDEN_FIELD_NAMES,
  INTROSPECTION_QUERY,
} from './helpers/schema-contract.js'

const BUILTIN_SCALARS = ['String', 'Boolean', 'Int', 'Float', 'ID']

describe('GraphQL schema / introspection', () => {
  let server
  let schema
  let typesByName

  before(async () => {
    server = await startServer()
    const data = expectData(await gql(server.baseUrl, INTROSPECTION_QUERY), 'introspection')
    schema = data.__schema
    typesByName = new Map(schema.types.map((type) => [type.name, type]))
  })

  after(async () => {
    await server.close()
  })

  test('query type is Query', () => {
    assert.equal(schema.queryType?.name, 'Query')
    assert.ok(typesByName.get('Query'))
    assert.equal(typesByName.get('Query').kind, 'OBJECT')
  })

  test('exposes exactly the nine schema object types (no extras, none missing)', () => {
    const objectTypes = schema.types
      .filter((type) => type.kind === 'OBJECT' && !type.name.startsWith('__'))
      .map((type) => type.name)
      .sort()
    assert.deepEqual(objectTypes, [...EXPECTED_OBJECT_TYPES].sort())
  })

  test('declares the custom Long and JSON scalars', () => {
    for (const name of EXPECTED_SCALARS) {
      const scalar = typesByName.get(name)
      assert.ok(scalar, `missing scalar type ${name}`)
      assert.equal(scalar.kind, 'SCALAR', `${name} should be a SCALAR`)
    }
    const customScalars = schema.types
      .filter(
        (type) =>
          type.kind === 'SCALAR' &&
          !type.name.startsWith('__') &&
          !BUILTIN_SCALARS.includes(type.name),
      )
      .map((type) => type.name)
      .sort()
    assert.deepEqual(customScalars, [...EXPECTED_SCALARS].sort())
  })

  test('each type exposes exactly the documented field set', async (t) => {
    for (const [typeName, expected] of Object.entries(EXPECTED_FIELDS)) {
      await t.test(typeName, () => {
        const type = typesByName.get(typeName)
        assert.ok(type, `type ${typeName} is missing from the schema`)
        assert.equal(type.kind, 'OBJECT')
        const actual = (type.fields ?? []).map((field) => field.name).sort()
        assert.deepEqual(actual, [...expected].sort(), `${typeName} field set mismatch`)
      })
    }
  })

  test('Query.node has a nullable ID argument and returns NodeObject', () => {
    const field = (typesByName.get('Query').fields ?? []).find((item) => item.name === 'node')
    assert.ok(field, 'Query.node is missing')
    // Nullable NodeObject return type (no NON_NULL wrapper).
    assert.equal(field.type.kind, 'OBJECT')
    assert.equal(field.type.name, 'NodeObject')

    assert.equal(field.args.length, 1)
    const [arg] = field.args
    assert.equal(arg.name, 'nodeId')
    // Nullable ID (the whole "omitted nodeId -> root node" contract depends on it).
    assert.equal(arg.type.kind, 'SCALAR')
    assert.equal(arg.type.name, 'ID')
    assert.equal(arg.defaultValue ?? null, null)
  })

  test('scalar / list field types match the contract', () => {
    const type = (name) => typesByName.get(name)
    const field = (typeName, fieldName) =>
      (type(typeName).fields ?? []).find((item) => item.name === fieldName)

    // Long non-null fields
    for (const typeName of ['Action', 'Trigger', 'Response', 'ResourceTemplate', 'NodeObject']) {
      const createdAt = field(typeName, 'createdAt')
      assert.equal(createdAt.type.kind, 'NON_NULL', `${typeName}.createdAt should be non-null`)
      assert.equal(createdAt.type.ofType.kind, 'SCALAR')
      assert.equal(createdAt.type.ofType.name, 'Long')
    }

    // JSON fields
    assert.equal(field('ResourceTemplate', 'schema').type.name, 'JSON')
    assert.equal(field('ResponseVariation', 'responses').type.name, 'JSON')

    // Node links
    const parents = field('NodeObject', 'parents')
    assert.equal(parents.type.kind, 'LIST')
    assert.equal(parents.type.ofType.kind, 'OBJECT')
    assert.equal(parents.type.ofType.name, 'NodeObject')

    const responses = field('NodeObject', 'responses')
    assert.equal(responses.type.kind, 'LIST')
    assert.equal(responses.type.ofType.name, 'Response')

    const actions = field('NodeObject', 'actions')
    assert.equal(actions.type.kind, 'LIST')
    assert.equal(actions.type.ofType.name, 'Action')

    assert.equal(field('NodeObject', 'trigger').type.name, 'Trigger')
    assert.equal(field('NodeObject', 'root').type.name, 'Boolean')
    assert.equal(field('NodeObject', 'priority').type.name, 'Float')
    assert.equal(field('ResponsePlatform', 'build').type.name, 'Int')

    // Response platform nesting chain
    assert.equal(field('Response', 'platforms').type.ofType.name, 'ResponsePlatform')
    assert.equal(
      field('ResponsePlatform', 'localeGroups').type.ofType.name,
      'ResponseLocaleGroup',
    )
    assert.equal(field('ResponseLocaleGroup', 'variations').type.ofType.name, 'ResponseVariation')
  })

  test('ResourceTemplate.createdAt is still declared Long! (the datasource fallback is data-level, not a schema change)', () => {
    const createdAt = (typesByName.get('ResourceTemplate').fields ?? []).find(
      (field) => field.name === 'createdAt',
    )
    assert.ok(createdAt)
    assert.equal(createdAt.type.kind, 'NON_NULL')
    assert.equal(createdAt.type.ofType.kind, 'SCALAR')
    assert.equal(createdAt.type.ofType.name, 'Long')
  })

  test('datasource-only keys are not exposed anywhere in the schema', () => {
    const exposed = new Set()
    for (const type of schema.types) {
      for (const field of type.fields ?? []) exposed.add(field.name)
    }
    const leaked = FORBIDDEN_FIELD_NAMES.filter((name) => exposed.has(name))
    assert.deepEqual(leaked, [], `schema leaks datasource-only fields: ${leaked.join(', ')}`)
  })

  test('introspection itself is only reachable with a valid token', async () => {
    const anonymous = await gql(server.baseUrl, INTROSPECTION_QUERY, undefined, { token: null })
    expectUnauthenticated(anonymous, 'anonymous introspection')
  })
})
