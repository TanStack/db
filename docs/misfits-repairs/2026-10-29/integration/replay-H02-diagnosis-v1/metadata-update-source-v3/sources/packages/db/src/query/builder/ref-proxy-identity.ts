import type { RefProxy } from './ref-proxy.js'

/**
 * Ref proxy traps answer this module-private key, so a user object shaped
 * like a ref proxy is never mistaken for one.
 */
export const REF_PROXY_BRAND: unique symbol = Symbol(`refProxy`)

/** The brand a ref proxy answers, or undefined for any other value. */
export function readRefProxyBrand(value: unknown): unknown {
  if (!value || typeof value !== `object`) return undefined
  try {
    const brand = (value as Record<symbol, unknown>)[REF_PROXY_BRAND]
    return brand === true || Array.isArray(brand) ? brand : undefined
  } catch {
    // A revoked proxy, such as a finished Immer draft, is not a ref proxy.
    return undefined
  }
}

export function isRefProxy(value: any): value is RefProxy {
  return (
    value && typeof value === `object` && readRefProxyBrand(value) !== undefined
  )
}
