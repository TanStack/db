import type { RefProxy } from './ref-proxy.js'

/**
 * Ref proxy traps answer this module-private key, so a user object shaped
 * like a ref proxy is never mistaken for one.
 */
export const REF_PROXY_BRAND: unique symbol = Symbol(`refProxy`)

function hasRefProxyBrand(value: object): boolean {
  try {
    return (value as Record<symbol, unknown>)[REF_PROXY_BRAND] === true
  } catch {
    // A revoked proxy, such as a finished Immer draft, is not a ref proxy.
    return false
  }
}

export function isRefProxy(value: any): value is RefProxy {
  return value && typeof value === `object` && hasRefProxyBrand(value)
}
