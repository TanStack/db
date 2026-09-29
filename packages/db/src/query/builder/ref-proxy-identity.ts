import type { RefProxy } from './ref-proxy.js'

const refProxies = new WeakSet<object>()

export function registerRefProxy(value: object): void {
  refProxies.add(value)
}

export function isRefProxy(value: any): value is RefProxy {
  return value && typeof value === `object` && refProxies.has(value)
}
