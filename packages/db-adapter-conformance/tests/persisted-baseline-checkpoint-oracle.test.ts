/**
 * The lifecycle instrument must observe the source event after its own applied
 * receipt, even when an unrelated empty commit arrives first. The shared
 * hydration judgment derives rows from the source history, not receipt counts.
 *
 * This controlled provider commits backend state, then delivers its event on a
 * later task. The real Collection and persistence wrapper still apply writes.
 * Histories vary the saved, old and replacement rows, one to three empty
 * commits and one to four delivery turns. This check judges the shared driver's cut;
 * the existing PowerSync/RxDB receivers retain the real SDK and browser paths.
 */
import fc from 'fast-check'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { hydrationLifecycleRows } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import {
  baselineGate,
  observeBaselineLifecycle,
} from './persisted-baseline-lifecycle-driver'
import { baselineLifecycleViolations } from './persisted-baseline-lifecycle-oracle'
import { createStartupHost } from './persisted-startup-host'
import { startupTurn } from './persisted-startup-driver'
import type { BaselineLifecycleAdapter } from './persisted-baseline-lifecycle-driver'
import type { BaselineLifecycleObservation } from './persisted-baseline-lifecycle-oracle'
import type { HydrationLifecycleRow } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import type { SyncConfig } from '@tanstack/db'

const checkpointAdapter =
  (
    turns: number,
    emptyCommits: number,
    reached: () => void,
  ): BaselineLifecycleAdapter =>
  (history, id) => {
    let rows = hydrationLifecycleRows(history.old, 2)
    let eventDelivery: Promise<void> | undefined
    const sessions: Array<{
      closed: boolean
      releases: number
      gate: ReturnType<typeof baselineGate<void>>
      params: Parameters<SyncConfig<HydrationLifecycleRow, string>['sync']>[0]
    }> = []
    return Promise.resolve({
      options: {
        id,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            const session = {
              closed: false,
              releases: 0,
              gate: baselineGate<void>(),
              params,
            }
            sessions.push(session)
            void session.gate.promise
              .then(async () => {
                if (session.closed) return
                params.begin({ snapshot: true })
                for (const row of rows)
                  params.write({ type: 'insert', value: row })
                const receipt = params.commit()
                await params.metadata?.persistence?.hydrateBaseline()
                await receipt
                // The retired run may resume here; core fences its callback.
                params.markReady()
              })
              .catch((error) => {
                if (!session.closed) params.fail(error)
              })
            return () => {
              session.closed = true
              session.releases++
            }
          },
        },
      },
      sessions: () => sessions.length,
      deliver: (run) => sessions[run]?.gate.resolve(),
      fail: (run, error) => sessions[run]!.params.fail(error),
      replace: (next) => {
        rows = next
        return Promise.resolve()
      },
      event: async (row) => {
        // The backend commits the row, but source delivery remains held.
        // An independent empty source transaction is legal before delivery.
        rows = [...rows, row]
        const session = sessions[1]!
        for (let commit = 0; commit < emptyCommits; commit++) {
          session.params.begin()
          await session.params.commit()
        }
        reached()
        eventDelivery = (async () => {
          for (let turn = 0; turn < turns; turn++) await startupTurn()
          if (session.closed) return
          session.params.begin()
          session.params.write({ type: 'insert', value: row })
          session.params.commit()
        })()
      },
      releases: () => sessions.map((session) => session.releases),
      hookReleases: () => sessions.map((session) => session.releases),
      hookAcquisitions: () => sessions.length,
      diagnostics: () => [],
      dispose: async () => {
        for (const session of sessions) session.gate.resolve()
        await eventDelivery
      },
    })
  }

const histories = fc.record({
  previous: fc.integer({ min: 0, max: 7 }),
  old: fc.integer({ min: 0, max: 7 }),
  replacement: fc.integer({ min: 0, max: 7 }),
  turns: fc.integer({ min: 1, max: 4 }),
  emptyCommits: fc.integer({ min: 1, max: 3 }),
})
let sequence = 0
oracleProperty({
  id: 'adapter-conformance.persisted-baseline-lifecycle.checkpoint',
  law: {
    statement:
      'The afterEvent observation waits for the applied receipt containing the replacement source event.',
    authority:
      'Shared PUB-3/FID-4 and the persisted lifecycle afterEvent law: applied changes equal the source batch folded onto the prior rows.',
    limits:
      'Instrument check of the shared driver with a controlled provider, real Collection and in-memory persistence. Existing SDK and browser receiving paths remain separate.',
  },
  owns: [
    'tests/persisted-baseline-lifecycle-driver.ts#observeBaselineLifecycle',
  ],
  histories: {
    arbitrary: histories,
    runs: 24,
    fixedSeeds: [239467],
    states: ['source-event-held-after-empty-commit'],
    constructed: [
      {
        name: 'a source event follows an unrelated empty commit',
        enters: ['source-event-held-after-empty-commit'],
        build: (base) => ({ ...base }),
      },
    ],
    fixed: [
      {
        name: 'CI reload membership and batching',
        history: {
          previous: 7,
          old: 6,
          replacement: 2,
          turns: 3,
          emptyCommits: 1,
        },
      },
    ],
  },
  resolve: ({ turns, ...rows }) => ({
    ...rows,
    turns,
    batchSize: 2,
    action: 'reload' as const,
    initialRender: 'default' as const,
  }),
  // Reuse the hydration owner's independent row and lifecycle judgment.
  model: (history, trace) => {
    const record = trace.find(({ checkpoint }) => checkpoint === 'completed')
    return record?.value !== undefined
      ? baselineLifecycleViolations(
          history,
          record.value as BaselineLifecycleObservation,
          true,
        )
      : undefined
  },
  driver: async (history, observe) => {
    const host = createStartupHost('controlled')
    await withOracleCleanup(async () => {
      const actual = await observeBaselineLifecycle(
        checkpointAdapter(history.turns, history.emptyCommits, () =>
          observe('reach', 'source-event-held-after-empty-commit'),
        ),
        host.persistence,
        host.holdBaseline,
        history,
        'event-checkpoint-' + sequence++,
        true,
      )
      observe('completed', actual)
    }, [() => host.close()])
  },
  check: (_history, trace, differences) => {
    if (!differences)
      return violation(
        'completed',
        'missing completed observation',
        'event checkpoint execution',
      )
    if (differences.length)
      return violation(
        'lifecycle',
        differences.join('; '),
        'persisted source lifecycle',
      )
    if (
      !trace.some(
        ({ checkpoint, value }) =>
          checkpoint === 'reach' &&
          value === 'source-event-held-after-empty-commit',
      )
    )
      return violation(
        'event delivery',
        'missing source-event-held-after-empty-commit',
        'event checkpoint reach',
      )
    return pass
  },
  calibrations: [
    {
      name: 'rejects observing before the source event applies',
      history: {
        constructed: 'a source event follows an unrelated empty commit',
      },
      law: 'persisted source lifecycle',
      difference: 'afterEvent: replacement source authority',
      corrupt: (trace) =>
        trace.map((entry) => {
          if (entry.checkpoint !== 'completed') return entry
          const actual = entry.value as BaselineLifecycleObservation
          return {
            ...entry,
            value: { ...actual, afterEvent: actual.replacement },
          }
        }),
    },
    {
      name: 'rejects a missing held-event premise',
      history: {
        constructed: 'a source event follows an unrelated empty commit',
      },
      law: 'event checkpoint reach',
      corrupt: (trace) =>
        trace.filter(({ checkpoint }) => checkpoint !== 'reach'),
    },
  ],
})
