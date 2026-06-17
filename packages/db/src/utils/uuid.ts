/**
 * Returns a RFC 4122 version 4 UUID.
 *
 * Prefers `crypto.randomUUID()` when available. In non-secure browser contexts
 * (e.g. a dev server accessed via a LAN IP over HTTP) `crypto.randomUUID` is
 * `undefined`, so this falls back to building a UUIDv4 from
 * `crypto.getRandomValues`. Throws if neither API is available.
 *
 * See https://github.com/TanStack/db/issues/1541.
 */
export function randomUUID(): string {
  const c: Crypto | undefined =
    typeof globalThis !== `undefined` ? (globalThis as any).crypto : undefined

  if (c && typeof c.randomUUID === `function`) {
    return c.randomUUID()
  }

  if (c && typeof c.getRandomValues === `function`) {
    const bytes = c.getRandomValues(new Uint8Array(16))
    // Per RFC 4122 §4.4: set version (4) and variant (10xx) bits.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80

    const hex: Array<string> = []
    for (let i = 0; i < 16; i++) {
      hex.push(bytes[i]!.toString(16).padStart(2, `0`))
    }
    return (
      hex.slice(0, 4).join(``) +
      `-` +
      hex.slice(4, 6).join(``) +
      `-` +
      hex.slice(6, 8).join(``) +
      `-` +
      hex.slice(8, 10).join(``) +
      `-` +
      hex.slice(10, 16).join(``)
    )
  }

  throw new Error(
    `No secure random number generator available: neither crypto.randomUUID nor crypto.getRandomValues is defined in this environment.`
  )
}
