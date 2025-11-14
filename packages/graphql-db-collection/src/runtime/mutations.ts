import { parse } from "graphql"
import type { DocumentNode } from "graphql"
import type { GraphQLLink } from "./link"
import type { DialectAdapter } from "./dialects/base"
import type { MutationOperation, MutationResult } from "../types"

/**
 * Mutation handlers for GraphQL collections
 *
 * These handlers integrate with TanStack DB's mutation lifecycle:
 * 1. Optimistic update (immediate UI update)
 * 2. Server request (GraphQL mutation)
 * 3. Reconciliation (patch collection with server response)
 * 4. Rollback on error (automatic via TanStack DB)
 */

export interface MutationHandlerConfig {
  link: GraphQLLink
  dialect: DialectAdapter
  collection: string
  selectionSet: string
}

/**
 * Create mutation handlers for a collection
 */
export function createMutationHandlers(config: MutationHandlerConfig) {
  const { link, dialect, collection, selectionSet } = config

  const mutationFields = dialect.getMutationFieldNames(collection)

  return {
    /**
     * Insert mutation handler
     */
    insert: async <T extends object>(
      data: T | Array<T>
    ): Promise<MutationResult<T>> => {
      const isArray = Array.isArray(data)
      const items = isArray ? data : [data]

      const { document, variables } = buildInsertMutation(
        collection,
        mutationFields.insert,
        items,
        selectionSet,
        dialect
      )

      try {
        const response = await link.execute<any>(document, variables)

        // Extract the returned data
        const resultData = extractMutationResult(
          response,
          mutationFields.insert,
          dialect
        )

        return {
          data: isArray ? resultData : resultData[0],
        }
      } catch (error) {
        return {
          errors: [
            {
              message: error instanceof Error ? error.message : `Insert failed`,
            },
          ],
        }
      }
    },

    /**
     * Update mutation handler
     */
    update: async <T extends object>(
      id: string | number,
      patch: Partial<T>
    ): Promise<MutationResult<T>> => {
      const { document, variables } = buildUpdateMutation(
        collection,
        mutationFields.update,
        id,
        patch,
        selectionSet,
        dialect
      )

      try {
        const response = await link.execute<any>(document, variables)

        const resultData = extractMutationResult(
          response,
          mutationFields.update,
          dialect
        )

        return {
          data: resultData[0],
        }
      } catch (error) {
        return {
          errors: [
            {
              message: error instanceof Error ? error.message : `Update failed`,
            },
          ],
        }
      }
    },

    /**
     * Delete mutation handler
     */
    delete: async (id: string | number): Promise<MutationResult> => {
      const { document, variables } = buildDeleteMutation(
        collection,
        mutationFields.delete,
        id,
        dialect
      )

      try {
        const response = await link.execute<any>(document, variables)

        const resultData = extractMutationResult(
          response,
          mutationFields.delete,
          dialect
        )

        return {
          data: resultData[0],
        }
      } catch (error) {
        return {
          errors: [
            {
              message: error instanceof Error ? error.message : `Delete failed`,
            },
          ],
        }
      }
    },

    /**
     * Upsert mutation handler (if supported)
     */
    upsert: mutationFields.upsert
      ? async <T extends object>(data: T): Promise<MutationResult<T>> => {
          const { document, variables } = buildUpsertMutation(
            collection,
            mutationFields.upsert!,
            data,
            selectionSet,
            dialect
          )

          try {
            const response = await link.execute<any>(document, variables)

            const resultData = extractMutationResult(
              response,
              mutationFields.upsert!,
              dialect
            )

            return {
              data: resultData[0],
            }
          } catch (error) {
            return {
              errors: [
                {
                  message:
                    error instanceof Error ? error.message : `Upsert failed`,
                },
              ],
            }
          }
        }
      : undefined,
  }
}

/**
 * Build an insert mutation document
 */
function buildInsertMutation(
  collection: string,
  mutationField: string,
  data: Array<any>,
  selectionSet: string,
  _dialect: DialectAdapter
): { document: DocumentNode; variables: Record<string, unknown> } {
  const isBatch = data.length > 1 && dialect.supportsBatchMutations()

  let mutation: string
  const variables: Record<string, unknown> = {}

  if (isBatch) {
    // Batch insert
    mutation = `
      mutation Insert${collection}($objects: [${collection}_insert_input!]!) {
        ${mutationField}(objects: $objects) {
          returning {
            ${selectionSet}
          }
        }
      }
    `
    variables.objects = data
  } else {
    // Single insert
    mutation = `
      mutation Insert${collection}($object: ${collection}_insert_input!) {
        ${mutationField}(object: $object) {
          ${selectionSet}
        }
      }
    `
    variables.object = data[0]
  }

  return {
    document: parse(mutation),
    variables,
  }
}

/**
 * Build an update mutation document
 */
function buildUpdateMutation(
  collection: string,
  mutationField: string,
  id: string | number,
  patch: any,
  selectionSet: string,
  _dialect: DialectAdapter
): { document: DocumentNode; variables: Record<string, unknown> } {
  const mutation = `
    mutation Update${collection}($id: ID!, $patch: ${collection}_set_input!) {
      ${mutationField}(pk_columns: { id: $id }, _set: $patch) {
        ${selectionSet}
      }
    }
  `

  return {
    document: parse(mutation),
    variables: { id, patch },
  }
}

/**
 * Build a delete mutation document
 */
function buildDeleteMutation(
  collection: string,
  mutationField: string,
  id: string | number,
  _dialect: DialectAdapter
): { document: DocumentNode; variables: Record<string, unknown> } {
  const mutation = `
    mutation Delete${collection}($id: ID!) {
      ${mutationField}(id: $id) {
        id
      }
    }
  `

  return {
    document: parse(mutation),
    variables: { id },
  }
}

/**
 * Build an upsert mutation document
 */
function buildUpsertMutation(
  collection: string,
  mutationField: string,
  data: any,
  selectionSet: string,
  _dialect: DialectAdapter
): { document: DocumentNode; variables: Record<string, unknown> } {
  const mutation = `
    mutation Upsert${collection}($object: ${collection}_insert_input!) {
      ${mutationField}(object: $object, on_conflict: { constraint: ${collection}_pkey, update_columns: [] }) {
        ${selectionSet}
      }
    }
  `

  return {
    document: parse(mutation),
    variables: { object: data },
  }
}

/**
 * Extract the mutation result from the response
 */
function extractMutationResult(
  response: any,
  mutationField: string,
  dialect: DialectAdapter
): Array<any> {
  if (!response || !response[mutationField]) {
    return []
  }

  const result = response[mutationField]

  // Handle different response structures
  // Hasura: { returning: [...] }
  if (result.returning && Array.isArray(result.returning)) {
    return result.returning
  }

  // PostGraphile/Prisma: direct object
  if (typeof result === `object` && !Array.isArray(result)) {
    return [result]
  }

  // Array response
  if (Array.isArray(result)) {
    return result
  }

  return [result]
}
