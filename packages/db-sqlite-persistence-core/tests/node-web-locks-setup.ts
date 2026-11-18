import { createInProcessWebLocks } from './node-web-locks'

// Node 22 has navigator but no Web Locks. Preserve native locks on newer Node
// versions; this setup is never loaded in the real Chromium receiving pages.
if (!navigator.locks) {
  Object.defineProperty(navigator, `locks`, {
    value: createInProcessWebLocks(),
    configurable: true,
    writable: true,
  })
}
