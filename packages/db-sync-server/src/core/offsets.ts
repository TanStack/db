import type { Offset } from '../types'

/**
 * Parse an offset string in the format "v_seq"
 * @param offset The offset string to parse
 * @returns The parsed version number, or null if invalid
 */
export function parseOffset(offset: string): number | null {
  if (offset === '-1') return -1
  
  const match = offset.match(/^(\d+)_(\d+)$/)
  if (!match) return null
  
  const [, versionStr, seqStr] = match
  const version = parseInt(versionStr, 10)
  const seq = parseInt(seqStr, 10)
  
  // Validate seq is always 0 (no batching)
  if (seq !== 0) return null
  
  return version
}

/**
 * Format a version number into an offset string
 * @param version The version number
 * @returns The formatted offset string
 */
export function formatOffset(version: number): Offset {
  if (version === -1) return '-1'
  return `${version}_0`
}

/**
 * Compare two offsets
 * @param a First offset
 * @param b Second offset
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareOffsets(a: Offset, b: Offset): number {
  const versionA = parseOffset(a)
  const versionB = parseOffset(b)
  
  if (versionA === null || versionB === null) {
    throw new Error('Invalid offset format')
  }
  
  if (versionA < versionB) return -1
  if (versionA > versionB) return 1
  return 0
}

/**
 * Get the head offset (latest version)
 * @param version The current version number
 * @returns The head offset string
 */
export function headOffset(version: number): Offset {
  return formatOffset(version)
}

/**
 * Check if an offset is valid
 * @param offset The offset to validate
 * @returns True if valid, false otherwise
 */
export function isValidOffset(offset: string): boolean {
  return parseOffset(offset) !== null
}