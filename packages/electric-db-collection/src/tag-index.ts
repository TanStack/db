// Import Row and Message types for the isEventMessage function
import type { Message, Row } from '@electric-sql/client'

export type RowId = string | number
export type MoveTag = string
export type ParsedMoveTag = Array<string | NonParticipating>
export type Position = number
export type Value = string
export type MoveOutPattern = {
  pos: Position
  value: Value
}

/**
 * Sentinel value for tag positions where the disjunct does not participate
 * in that condition. These positions are not indexed and won't match any
 * move-out pattern.
 */
export const NON_PARTICIPATING = null
export type NonParticipating = typeof NON_PARTICIPATING

export type ActiveConditions = Array<boolean>
export type DisjunctPositions = Array<Array<number>>

/**
 * Event message type for move-out events
 */
export interface EventMessage {
  headers: {
    event: `move-out`
    patterns: Array<MoveOutPattern>
  }
}

/**
 * Tag index structure: array indexed by position, maps value to set of row IDs.
 * For example:
 * ```example
 * const tag1 = [a, b, c]
 * const tag2 = [a, b, d]
 * const tag3 = [a, d, e]
 *
 * // Index is:
 * [
 *   new Map([a -> <rows with a on index 0>])
 *   new Map([b -> <rows with b on index 1>, d -> <rows with d on index 1>])
 *   new Map([c -> <rows with c on index 2>, d -> <rows with d on index 2>, e -> <rows with e on index 2>])
 * ]
 * ```
 */
export type TagIndex = Array<Map<Value, Set<RowId>>>

/**
 * Parse a tag string into a ParsedMoveTag.
 * Splits on `/` delimiter and maps empty strings to {@link NON_PARTICIPATING}.
 */
export function parseTag(tag: MoveTag): ParsedMoveTag {
  return tag.split(`/`).map((s) => (s === `` ? NON_PARTICIPATING : s))
}

/**
 * Abstraction to get the value at a specific position in a tag
 */
export function getValue(
  tag: ParsedMoveTag,
  position: Position,
): string | NonParticipating {
  if (position >= tag.length) {
    throw new Error(`Position out of bounds`)
  }
  return tag[position]!
}

/**
 * Abstraction to extract position and value from a pattern.
 */
function getPositionalValue(pattern: MoveOutPattern): {
  pos: number
  value: string
} {
  return pattern
}

/**
 * Abstraction to get the length of a tag
 */
export function getTagLength(tag: ParsedMoveTag): number {
  return tag.length
}

/**
 * Check if a tag matches a pattern.
 * A tag matches if the value at the pattern's position equals the pattern's value.
 * {@link NON_PARTICIPATING} positions naturally don't match any string value.
 */
export function tagMatchesPattern(
  tag: ParsedMoveTag,
  pattern: MoveOutPattern,
): boolean {
  const { pos, value } = getPositionalValue(pattern)
  const tagValue = getValue(tag, pos)
  return tagValue === value
}

/**
 * Add a tag to the index for efficient pattern matching
 */
export function addTagToIndex(
  tag: ParsedMoveTag,
  rowId: RowId,
  index: TagIndex,
  tagLength: number,
): void {
  for (let i = 0; i < tagLength; i++) {
    const value = getValue(tag, i)

    if (value !== NON_PARTICIPATING) {
      const positionIndex = index[i]!
      if (!positionIndex.has(value)) {
        positionIndex.set(value, new Set())
      }

      const tags = positionIndex.get(value)!
      tags.add(rowId)
    }
  }
}

/**
 * Remove a tag from the index
 */
export function removeTagFromIndex(
  tag: ParsedMoveTag,
  rowId: RowId,
  index: TagIndex,
  tagLength: number,
): void {
  for (let i = 0; i < tagLength; i++) {
    const value = getValue(tag, i)

    if (value !== NON_PARTICIPATING) {
      const positionIndex = index[i]
      if (positionIndex) {
        const rowSet = positionIndex.get(value)
        if (rowSet) {
          rowSet.delete(rowId)

          // Clean up empty sets
          if (rowSet.size === 0) {
            positionIndex.delete(value)
          }
        }
      }
    }
  }
}

/**
 * Find all rows that match a given pattern
 */
export function findRowsMatchingPattern(
  pattern: MoveOutPattern,
  index: TagIndex,
): Set<RowId> {
  const { pos, value } = getPositionalValue(pattern)
  const positionIndex = index[pos]
  const rowSet = positionIndex?.get(value)
  return rowSet ?? new Set()
}

/**
 * Derive disjunct positions from parsed tags.
 * For each tag (= disjunct), collect the indices of participating positions.
 * E.g., ["hash_a", NON_PARTICIPATING, "hash_b"] → [0, 2]
 */
export function deriveDisjunctPositions(
  tags: Array<ParsedMoveTag>,
): DisjunctPositions {
  return tags.map((tag) => {
    const positions: Array<number> = []
    for (let i = 0; i < tag.length; i++) {
      if (tag[i] !== NON_PARTICIPATING) {
        positions.push(i)
      }
    }
    return positions
  })
}

/**
 * Evaluate whether a row is visible given active conditions and disjunct positions.
 * Returns true if ANY disjunct has ALL its positions as true in activeConditions.
 */
export function rowVisible(
  activeConditions: ActiveConditions,
  disjunctPositions: DisjunctPositions,
): boolean {
  return disjunctPositions.some((positions) =>
    positions.every((pos) => activeConditions[pos]),
  )
}

/**
 * Check if a message is an event message with move-out event
 */
export function isMoveOutMessage<T extends Row<unknown>>(
  message: Message<T>,
): message is Message<T> & EventMessage {
  return message.headers.event === `move-out`
}
