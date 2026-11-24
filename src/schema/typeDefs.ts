/**
 * GraphQL schema — reproduced 1:1 from the "Schema" section of the code test
 * PDF, plus the two custom scalars the schema relies on (`Long` and `JSON`).
 *
 * Do not rename fields: the API contract is defined by the PDF.
 */
export const typeDefs: string = /* GraphQL */ `
  """
  Epoch-millisecond timestamps used by the datasource (_id/createdAt/updatedAt).
  Serialized as a JSON number (64-bit values outside the JS safe-integer range
  are serialized as decimal strings so no precision is lost).
  """
  scalar Long

  """
  Arbitrary JSON value. Used for stored JSON Schema documents and for the
  response payloads of a response variation.
  """
  scalar JSON

  type Action {
    _id: ID!
    createdAt: Long!
    updatedAt: Long
    name: String!
    description: String
    functionString: String
    resourceTemplateId: ID
    resourceTemplate: ResourceTemplate
  }

  type Trigger {
    _id: ID!
    createdAt: Long!
    updatedAt: Long
    name: String!
    description: String
    functionString: String
    resourceTemplateId: ID
    resourceTemplate: ResourceTemplate
  }

  type Response {
    _id: ID!
    createdAt: Long!
    updatedAt: Long
    name: String!
    description: String
    platforms: [ResponsePlatform]
  }

  type ResponsePlatform {
    integrationId: ID
    build: Int
    localeGroups: [ResponseLocaleGroup]
  }

  type ResponseLocaleGroup {
    localeGroupId: ID
    variations: [ResponseVariation]
  }

  type ResponseVariation {
    name: String!
    responses: JSON
  }

  type ResourceTemplate {
    _id: ID!
    createdAt: Long!
    updatedAt: Long
    name: String!
    description: String
    schema: JSON
    integrationId: String
    functionString: String
    key: String
  }

  type NodeObject {
    _id: ID!
    createdAt: Long!
    updatedAt: Long
    name: String!
    description: String
    parents: [NodeObject]
    parentIds: [ID]
    root: Boolean
    trigger: Trigger
    triggerId: ID
    responses: [Response]
    responseIds: [ID]
    actions: [Action]
    actionIds: [ID]
    priority: Float
    compositeId: ID
    global: Boolean
    colour: String
  }

  type Query {
    """
    Fetch a single flow node. When \`nodeId\` is omitted the root node of the
    flow is returned; when it does not match any node the result is \`null\`.
    """
    node(nodeId: ID): NodeObject
  }
`

export default typeDefs
