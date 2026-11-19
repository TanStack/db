import { createInProcessWebLocks } from './node-web-locks'

// Node 22 has navigator but no Web Locks. Preserve native locks on newer Node
// versions; this setup is never loaded in the real Chromium receiving pages.
const nodeNavigator: { locks?: Pick<LockManager, `request`> } = navigator
if (!nodeNavigator.locks) {
  Object.defineProperty(nodeNavigator, `locks`, {
    value: createInProcessWebLocks(),
    configurable: true,
    writable: true,
  })
}
