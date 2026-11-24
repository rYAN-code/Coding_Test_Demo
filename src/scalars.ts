/**
 * Custom GraphQL scalars used by the schema.
 *
 * The code-test schema declares two custom scalars (`Long` and `JSON`). Both are
 * implemented here without any external dependency so the API stays small.
 */
import { GraphQLError, GraphQLScalarType, Kind, valueFromASTUntyped } from 'graphql'
import type { ValueNode } from 'graphql'

import type { JsonValue, Scalars } from './types.js'

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)

/** A 64-bit integer input: number, bigint or decimal string. */
export type LongInput = number | bigint | string

/** The JSON representation of a `Long`: a number when safe, else a string. */
export type LongOutput = number | string

/** Convert a JS value coming from JSON / GraphQL variables into a BigInt. */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new GraphQLError(`Long cannot represent a non-integer value: ${value}`)
    }
    return BigInt(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') throw new GraphQLError('Long cannot represent an empty string')
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new GraphQLError(`Long cannot represent value: "${value}"`)
    }
    return BigInt(trimmed)
  }
  throw new GraphQLError(`Long cannot represent value: ${JSON.stringify(value)}`)
}

/** BigInt -> JSON number when it fits, decimal string otherwise (no precision loss). */
function toLongOutput(bigint: bigint): LongOutput {
  return bigint <= MAX_SAFE && bigint >= MIN_SAFE ? Number(bigint) : bigint.toString()
}

/**
 * `Long` is a signed 64-bit integer. Epoch timestamps in the provided dataset
 * fit comfortably inside a JavaScript safe integer, so they are serialized as
 * JSON numbers (which is what API consumers expect); values outside the safe
 * integer range fall back to a decimal string so no precision is lost.
 */
export const GraphQLLong = new GraphQLScalarType<LongInput | null, LongOutput | null>({
  name: 'Long',
  description:
    'Signed 64-bit integer. Serialized as a JSON number when it is a safe integer, otherwise as a decimal string.',
  serialize(value: unknown): LongOutput | null {
    if (value === null || value === undefined) return null
    return toLongOutput(toBigInt(value))
  },
  parseValue(value: unknown): LongOutput | null {
    if (value === null || value === undefined) return null
    return toLongOutput(toBigInt(value))
  },
  parseLiteral(ast: ValueNode): LongOutput | null {
    if (ast.kind === Kind.INT) return toLongOutput(toBigInt(ast.value))
    if (ast.kind === Kind.STRING) return toLongOutput(toBigInt(ast.value))
    throw new GraphQLError(`Long cannot represent a non-integer literal of kind ${ast.kind}`)
  },
})

/**
 * `JSON` is an arbitrary JSON value: the datasource stores JSON Schema documents
 * (`resourceTemplate.schema`) and response payloads (`responseVariation.responses`)
 * in this field, so it must round-trip untouched.
 */
export const GraphQLJSON = new GraphQLScalarType<JsonValue | null, JsonValue | null>({
  name: 'JSON',
  description: 'Arbitrary JSON value (object, array, string, number, boolean or null).',
  serialize(value: unknown): JsonValue | null {
    return (value ?? null) as JsonValue | null
  },
  parseValue(value: unknown): JsonValue | null {
    return (value ?? null) as JsonValue | null
  },
  parseLiteral(ast: ValueNode): JsonValue | null {
    return valueFromASTUntyped(ast) as JsonValue | null
  },
})

export const scalars: Scalars = {
  Long: GraphQLLong,
  JSON: GraphQLJSON,
}
