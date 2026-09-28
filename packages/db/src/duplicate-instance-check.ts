import { DuplicateDbInstanceError } from './errors.js'

// Independent module evaluation is valid in SSR. Constructed DB values cannot
// cross evaluations because their IR classes and transaction state differ.
const DB_INSTANCE_REGISTRY = Symbol.for(`@tanstack/db/constructed-instances`)
const instanceToken = {}
const runtime = globalThis as unknown as Record<
  symbol,
  WeakMap<object, object> | undefined
>
const owners = (runtime[DB_INSTANCE_REGISTRY] ??= new WeakMap<object, object>())

export function markDbInstance(value: object): void {
  owners.set(value, instanceToken)
}

export function assertLocalDbInstance(value: unknown): void {
  if (value === null || typeof value !== `object`) return
  const owner = owners.get(value)
  if (owner !== undefined && owner !== instanceToken) {
    throw new DuplicateDbInstanceError()
  }
}
