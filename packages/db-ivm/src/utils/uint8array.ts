/**
 * Threshold for normalizing Uint8Arrays to string representations.
 * Arrays larger than this will use reference equality to avoid memory overhead.
 * 128 bytes is enough for common ID formats (ULIDs are 16 bytes, UUIDs are 16 bytes)
 * while avoiding excessive string allocation for large binary data.
 */
export const UINT8ARRAY_NORMALIZE_THRESHOLD = 128

/**
 * Check if a value is a Uint8Array or Buffer
 */
export function isUint8Array(value: unknown): value is Uint8Array {
  return (
    (typeof Buffer !== `undefined` && value instanceof Buffer) ||
    value instanceof Uint8Array
  )
}

/**
 * Normalize a Uint8Array to a string representation for content-based comparison.
 * This enables Uint8Arrays with the same byte content to be treated as equal,
 * even if they are different object instances.
 *
 * @param value - The Uint8Array or Buffer to normalize
 * @returns A string representation of the byte array
 */
export function normalizeUint8Array(value: Uint8Array): string {
  // Convert to a string representation that can be used as a Map key
  // Use a special prefix to avoid collisions with user strings
  return `__u8__${Array.from(value).join(`,`)}`
}

/**
 * Normalize a value for Map key or comparison usage.
 * Converts small Uint8Arrays/Buffers to string representations for content-based equality.
 * This enables proper comparison and Map key usage for binary data like ULIDs.
 *
 * @param value - The value to normalize
 * @returns The normalized value (string for small Uint8Arrays, original value otherwise)
 */
export function normalizeValue<T>(value: T): T | string {
  if (isUint8Array(value)) {
    // Only normalize small arrays to avoid memory overhead for large binary data
    if (value.byteLength <= UINT8ARRAY_NORMALIZE_THRESHOLD) {
      return normalizeUint8Array(value)
    }
    // For large arrays, fall back to reference equality
    // Users working with large binary data should use a derived key if needed
  }

  return value
}
