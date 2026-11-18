/**
 * LocalStorage receives the shared complete-result law at its actual Storage
 * boundary. Replacing bytes while the old run is retired is a missed event,
 * not a synthetic source answer. The next run must read the entire snapshot.
 * This seam accepts native Storage as well as the documented custom API.
 */
import { localStorageCollectionOptions } from '../src/local-storage'
import type { EagerReloadAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { StorageApi, StorageEventApi } from '../src/local-storage'

export function localStorageEagerReloadAdapter(
  openStorage: () => StorageApi = () => {
    const bytes = new Map<string, string>()
    return {
      getItem: (key) => bytes.get(key) ?? null,
      setItem: (key, value) => {
        bytes.set(key, value)
      },
      removeItem: (key) => {
        bytes.delete(key)
      },
    }
  },
  events: StorageEventApi = {
    addEventListener() {},
    removeEventListener() {},
  },
): EagerReloadAdapter {
  return {
    open: async (initial, id) => {
      const storage = openStorage()
      const key = `local-storage-reload-${id}`
      let version = 0
      const replace = (rows: Array<StartupRow>): Promise<void> => {
        storage.setItem(
          key,
          JSON.stringify(
            Object.fromEntries(
              rows.map((row) => [
                `s:${row.id}`,
                { versionKey: `${version++}`, data: { ...row } },
              ]),
            ),
          ),
        )
        return Promise.resolve()
      }
      await replace(initial)
      return {
        options: localStorageCollectionOptions({
          id,
          storageKey: key,
          storage,
          storageEventApi: events,
          getKey: (row: StartupRow) => row.id,
        }),
        replace,
        // The actual Storage read, decode and source callbacks all run
        // synchronously inside sync(). No provider work remains after entry,
        // including when the snapshot is empty or readiness was omitted.
        propagate: () => Promise.resolve(),
        dispose: () => {
          storage.removeItem(key)
          return Promise.resolve()
        },
      }
    },
  }
}
