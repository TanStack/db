import { DuplicateDbInstanceError } from './errors'

// The marker belongs to the runtime, not a browser window. A second module
// instance would have separate IR classes and transaction state.
const DB_INSTANCE_MARKER = Symbol.for(`@tanstack/db/instance-marker`)
const instanceToken = {}
const DISABLED =
  typeof process !== `undefined` &&
  process.env.TANSTACK_DB_DISABLE_DUP_CHECK === `1`

export function assertSingleDbInstance(): void {
  if (DISABLED) return
  const current = (globalThis as any)[DB_INSTANCE_MARKER]
  if (current !== undefined && current !== instanceToken) {
    throw new DuplicateDbInstanceError()
  }
  ;(globalThis as any)[DB_INSTANCE_MARKER] = instanceToken
}
