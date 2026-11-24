/**
 * The GraphQL schema contract taken from the code-test PDF / Lead's contract.
 * Kept as data so the introspection test can assert the *exact* field sets.
 */
export const EXPECTED_FIELDS = Object.freeze({
  Action: [
    '_id',
    'createdAt',
    'updatedAt',
    'name',
    'description',
    'functionString',
    'resourceTemplateId',
    'resourceTemplate',
  ],
  Trigger: [
    '_id',
    'createdAt',
    'updatedAt',
    'name',
    'description',
    'functionString',
    'resourceTemplateId',
    'resourceTemplate',
  ],
  Response: ['_id', 'createdAt', 'updatedAt', 'name', 'description', 'platforms'],
  ResponsePlatform: ['integrationId', 'build', 'localeGroups'],
  ResponseLocaleGroup: ['localeGroupId', 'variations'],
  ResponseVariation: ['name', 'responses'],
  ResourceTemplate: [
    '_id',
    'createdAt',
    'updatedAt',
    'name',
    'description',
    'schema',
    'integrationId',
    'functionString',
    'key',
  ],
  NodeObject: [
    '_id',
    'createdAt',
    'updatedAt',
    'name',
    'description',
    'parents',
    'parentIds',
    'root',
    'trigger',
    'triggerId',
    'responses',
    'responseIds',
    'actions',
    'actionIds',
    'priority',
    'compositeId',
    'global',
    'colour',
  ],
  Query: ['node'],
})

export const EXPECTED_OBJECT_TYPES = Object.keys(EXPECTED_FIELDS)
export const EXPECTED_SCALARS = ['Long', 'JSON']

/**
 * Datasource keys that are deliberately NOT part of the GraphQL schema.
 * None of them may leak into introspection or into a fully-selected node.
 */
export const FORBIDDEN_FIELD_NAMES = Object.freeze([
  'params',
  'position',
  'tags',
  'preActions',
  'postActions',
  'redirect',
  'analytics',
  'memberTagging',
  'saveCompositeId',
])

/** Query that returns the names + field sets of every named type in the schema. */
export const INTROSPECTION_QUERY = /* GraphQL */ `
  query IntrospectSchema {
    __schema {
      queryType {
        name
      }
      types {
        kind
        name
        fields {
          name
          type {
            kind
            name
            ofType {
              kind
              name
            }
          }
          args {
            name
            type {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
`

/** Selects every scalar/enum field of NodeObject (nested object fields selected by id only). */
export const NODE_FULL_FIELDS = /* GraphQL */ `
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
  }
  actionIds
  actions {
    _id
  }
  priority
  compositeId
  global
  colour
`
