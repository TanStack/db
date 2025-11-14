import type { SelectionProject } from "../types"

/**
 * Selection synthesis - handles extracting rows from GraphQL responses
 *
 * GraphQL responses can have various shapes:
 * - Direct arrays: { posts: [...] }
 * - Relay connections: { posts: { nodes: [...], pageInfo: {...} } }
 * - Wrapped responses: { data: { posts: [...] } }
 *
 * This module provides utilities to extract the actual row data.
 */

/**
 * Apply a selection projection to a GraphQL response
 *
 * @param response - The raw GraphQL response
 * @param project - The selection project describing how to extract data
 * @returns Array of rows
 */
export function applySelection<T = any>(
  response: any,
  project: SelectionProject
): Array<T> {
  if (!response) {
    return []
  }

  // Navigate to the data using the dataPath
  let data = response
  for (const segment of project.dataPath) {
    if (!data || typeof data !== `object`) {
      console.warn(`Invalid response structure for dataPath:`, project.dataPath)
      return []
    }
    data = data[segment]
  }

  // If data is not an array, try to convert it
  if (!Array.isArray(data)) {
    if (data === null || data === undefined) {
      return []
    }
    console.warn(`Expected array but got:`, typeof data)
    return []
  }

  // Apply field mapping if provided
  if (project.fieldMap && Object.keys(project.fieldMap).length > 0) {
    return data.map((item) => mapFields(item, project.fieldMap!))
  }

  return data
}

/**
 * Map fields from one structure to another
 *
 * @param item - The source item
 * @param fieldMap - Map of source field -> target field
 * @returns Mapped item
 */
function mapFields<T = any>(item: any, fieldMap: Record<string, string>): T {
  const result: any = {}

  for (const [graphqlField, collectionField] of Object.entries(fieldMap)) {
    if (graphqlField in item) {
      result[collectionField] = item[graphqlField]
    }
  }

  // Copy unmapped fields as-is
  for (const key of Object.keys(item)) {
    if (!(key in fieldMap) && !(key in result)) {
      result[key] = item[key]
    }
  }

  return result
}

/**
 * Extract page info from a connection response
 *
 * @param response - The raw GraphQL response
 * @param project - The selection project
 * @returns Page info object or null
 */
export function extractPageInfo(
  response: any,
  project: SelectionProject
): PageInfo | null {
  if (!project.pageInfoPath || !project.isConnection) {
    return null
  }

  let pageInfo = response
  for (const segment of project.pageInfoPath) {
    if (!pageInfo || typeof pageInfo !== `object`) {
      return null
    }
    pageInfo = pageInfo[segment]
  }

  if (!pageInfo || typeof pageInfo !== `object`) {
    return null
  }

  return {
    hasNextPage: pageInfo.hasNextPage ?? false,
    hasPreviousPage: pageInfo.hasPreviousPage ?? false,
    startCursor: pageInfo.startCursor ?? null,
    endCursor: pageInfo.endCursor ?? null,
  }
}

/**
 * Page info from Relay connections
 */
export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

/**
 * Build a selection set string from field names
 *
 * @param fields - Array of field names
 * @param indent - Indentation level
 * @returns Selection set string
 */
export function buildSelectionSet(
  fields: Array<string>,
  indent: number = 0
): string {
  const indentStr = `  `.repeat(indent)
  return fields.map((field) => `${indentStr}${field}`).join(`\n`)
}

/**
 * Synthesize a minimal selection set for a type
 *
 * By default, we request:
 * - id (for normalization)
 * - __typename (for type identification)
 * - All scalar fields (non-relation fields)
 *
 * @param scalarFields - Array of scalar field names
 * @param requiredFields - Additional required fields
 * @returns Selection set string
 */
export function synthesizeSelection(
  scalarFields: Array<string>,
  requiredFields: Array<string> = [`id`, `__typename`]
): string {
  const allFields = Array.from(new Set([...requiredFields, ...scalarFields]))
  return buildSelectionSet(allFields, 3)
}
