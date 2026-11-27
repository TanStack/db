/**
 * Decorate the same real SDK receiver with public persistedCollectionOptions.
 * Hosts supply controlled storage, Node SQLite, or Chromium worker/OPFS. The
 * shared on-demand model still judges public readiness, rows and stream health;
 * these histories make no saved-row or restart-durability claim.
 */
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { createHealthReportHandoff } from '../../db-adapter-conformance/tests/health-report-handoff'
import { directOnDemandStreamsAdapter } from './on-demand-streams-driver'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { OnDemandStreamsAdapter } from '../../db-adapter-conformance/tests/on-demand-streams-driver'

export function persistedDirectOnDemandStreamsAdapter(
  openStorage: (id: string) =>
    | {
        persistence: PersistedCollectionPersistence
        close: () => unknown
      }
    | Promise<{
        persistence: PersistedCollectionPersistence
        close: () => unknown
      }>,
): OnDemandStreamsAdapter {
  return directOnDemandStreamsAdapter({
    wrap: async (options, _history, id, input) => {
      const storage = await openStorage(id)
      const health = createHealthReportHandoff()
      const upstream = options.sync
      const persisted = persistedCollectionOptions({
        ...options,
        persistence: input.persistence(storage.persistence),
        sync: {
          ...upstream,
          sync: (params) =>
            upstream.sync({
              ...params,
              reportError: (error) =>
                health.issue(`error`, error, () => params.reportError(error)),
              reportHealthy: (error) =>
                health.issue(`healthy`, error, () =>
                  params.reportHealthy(error),
                ),
            }),
        },
      })
      const wrapper = persisted.sync
      return {
        options: {
          ...persisted,
          sync: {
            ...wrapper,
            sync: (params) =>
              wrapper.sync({
                ...params,
                reportError: (error) =>
                  health.deliver(`error`, error, () =>
                    params.reportError(error),
                  ),
                reportHealthy: (error) =>
                  health.deliver(`healthy`, error, () =>
                    params.reportHealthy(error),
                  ),
              }),
          },
        },
        receiveHealthReports: () => health.receive(),
        emptyMappingCut: `load-admission`,
        dispose: storage.close,
      }
    },
  })
}
