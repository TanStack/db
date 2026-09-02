export const POWERSYNC_TEST_HOOKS = Symbol(`powerSyncTestHooks`)

export type PowerSyncTestHooks = {
  getDemandCount: () => number
}
