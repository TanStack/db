/** Calibrate receiving-premise timing, using the unchanged product judgment. */
import { expect, test } from 'vitest'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observeOnDemandStreams } from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import {
  failingStreams,
  onDemandStreamsModel,
  onDemandStreamsViolations,
} from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import { persistedDirectOnDemandStreamsAdapter } from './on-demand-streams-persisted-driver'
import type { OnDemandStreamsAdapter } from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import type { OnDemandStreamsHistory } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'

test(`storage admission is distinct from the mapper's progress bound`, async () => {
  const history: OnDemandStreamsHistory = {
    coordinate: 73,
    rowCount: 1,
    value: 4,
    kind: `ownership`,
    overlap: `disjoint`,
    failing: `right`,
    retire: `left`,
    changeError: false,
    recover: false,
  }
  const receiver = (drainStorage: boolean): OnDemandStreamsAdapter => {
    const adapter = persistedDirectOnDemandStreamsAdapter(() => {
      const host = createStartupHost(`controlled`)
      const storage: PersistedCollectionPersistence[`adapter`] =
        host.persistence.adapter
      const original = storage.loadResumeSnapshot.bind(storage)
      let delayed = false
      storage.loadResumeSnapshot = async (
        ...args: Parameters<typeof original>
      ) => {
        if (!delayed) {
          delayed = true
          // Valid storage latency exceeds the mapper helper's two-second
          // progress bound, but stays inside the input ledger's setup bound.
          await new Promise<void>((resolve) => setTimeout(resolve, 2200))
        }
        return original(...args)
      }
      return host
    })
    return {
      open: async (...args) => {
        const source = await adapter.open(...args)
        return drainStorage
          ? source
          : { ...source, receiveAdmissionWork: undefined }
      },
    }
  }
  // Omitting the storage premise reconstructs the old false setup failure.
  // Its diagnostic distinguishes actual pending storage from a lost demand.
  await expect(
    observeOnDemandStreams(
      receiver(false),
      history,
      `admission-before`,
      failingStreams(history),
    ),
  ).rejects.toThrow(
    /every logical query requested its streams;.*loadResumeSnapshot/,
  )
  const actual = await observeOnDemandStreams(
    receiver(true),
    history,
    `admission-after`,
    failingStreams(history),
  )
  expect(
    onDemandStreamsViolations(onDemandStreamsModel(history), actual.cuts),
  ).toEqual([])
}, 15_000)
