import {
  assertLocalDbInstance,
  markDbInstance,
} from '../../duplicate-instance-check.js'
import type { RefProxy } from './ref-proxy.js'

const refProxies = new WeakSet<object>()

export function registerRefProxy(value: object): void {
  markDbInstance(value)
  refProxies.add(value)
}

export function isRefProxy(value: any): value is RefProxy {
  assertLocalDbInstance(value)
  return value && typeof value === `object` && refProxies.has(value)
}
