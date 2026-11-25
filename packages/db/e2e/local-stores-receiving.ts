/** Native Storage receives the shared owner through its unchanged raw driver. */
import { observeEagerReload } from '../../db-adapter-conformance/tests/eager-reload-driver'
import { localStorageEagerReloadAdapter } from '../tests/local-storage-eager-reload-driver'
import { collectLocalStorageWriteOrder } from '../tests/local-storage-write-order-driver'
import type { EagerReloadHistory } from '../../db-adapter-conformance/tests/eager-reload-oracle'
import type { History } from '../tests/local-storage-write-order-oracle'

declare global {
  interface Window {
    runLocalStorageReload: typeof runLocalStorageReload
    runLocalStorageWriteOrder: typeof runLocalStorageWriteOrder
  }
}

async function runLocalStorageReload(
  history: EagerReloadHistory,
  id: string,
  invertSnapshot: boolean,
) {
  return observeEagerReload(
    localStorageEagerReloadAdapter(() => localStorage, window),
    history,
    id,
    undefined,
    invertSnapshot,
  )
}

window.runLocalStorageReload = runLocalStorageReload

async function runLocalStorageWriteOrder(
  history: History,
  id: string,
  teardownFailure = false,
) {
  const storage = teardownFailure
    ? {
        getItem: (key: string) => localStorage.getItem(key),
        setItem: (key: string, value: string) =>
          localStorage.setItem(key, value),
        removeItem: (key: string) => {
          localStorage.removeItem(key)
          throw new Error(`native receiving storage teardown failed`)
        },
      }
    : localStorage
  return collectLocalStorageWriteOrder(
    history,
    storage,
    `local-write-order-${id}`,
    window,
  )
}

window.runLocalStorageWriteOrder = runLocalStorageWriteOrder
