/**
 * A complete source result replaces its persisted baseline, with a surviving
 * peer retaining only its own rows. Network-first fallback retains the saved
 * snapshot until that result arrives. The independent set model and cut checks
 * live in persisted-startup-oracle.ts; this registration gives each adapter
 * the same controlled and real SQLite receiving paths.
 *
 * Each host runs every fixed history and the same 80-history fixed/fresh
 * campaigns. Constructed histories vary generated membership, mutation and
 * render choices while preserving the state they promise to enter. State
 * observations occur only after the composition driver proves its source /
 * restore order. The first-result, durable, refresh and reopen comparisons keep
 * their original cuts; a later result cannot repair an earlier verdict.
 *
 * Limits: the shared owner's three-key eager grammar, one source scope and an
 * optional peer, a disjoint persisting mutation, and local-only reopen. The
 * unchanged Chromium receiver supplies its separate real OPFS witness.
 */
import { describe } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-config'
import {
  expectedPersistedStartup,
  expectedStartupFallback,
  persistedStartupViolations,
  startupReachedStates,
  startupRequiredStates,
} from './persisted-startup-oracle'
import { observePersistedStartup } from './persisted-startup-driver'
import { createStartupHost } from './persisted-startup-host'
import type { Arbitrary } from 'fast-check'
import type {
  Observation,
  OraclePropertyOptions,
  Verdict,
} from '../../db/tests/oracle-config'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type {
  PersistedStartupHistory,
  PersistedStartupObservation,
} from './persisted-startup-oracle'
import type { PersistedStartupAdapter } from './persisted-startup-driver'

export function registerPersistedStartupConformance<
  H extends PersistedStartupHistory,
>({
  property,
  adapter,
  histories,
  arbitrary,
  origins = [],
  origin = () => undefined,
  scopedStartupCommit = false,
}: {
  property: string
  adapter: PersistedStartupAdapter<H>
  histories: Array<H>
  arbitrary: Arbitrary<H>
  scopedStartupCommit?: boolean
  origins?: Array<string>
  origin?: (history: H) => string | undefined
}) {
  const states = [
    ...startupRequiredStates(
      adapter.scope,
      histories.some((h) => h.batchSize !== undefined),
      histories.some((h) => h.singleSourceCommit),
      histories.some((h) => h.sourceKeys),
    ),
    ...origins,
  ]
  // The pinned framework remembers required states only for seed examples.
  // Keep the same obligations on every fresh generated or shrunk construction.
  // They describe its inputs, never production's expected rows.
  const constructionStates = new WeakMap<H, ReadonlyArray<string>>()
  const constructed = states.map((state) => {
    const witness = histories.find(
      (h) => startupReachedStates(h).includes(state) || origin(h) === state,
    )
    if (!witness)
      throw new Error(`${property}: no legal state witness for ${state}`)
    return {
      name: `generated ${state}`,
      enters: [state],
      build: (generated: H): H => {
        // Preserve generated membership and optional actions. Borrow only a
        // legal receiver origin / response schedule, then splice the minimum
        // premise for this state into the generated three-key history.
        const {
          previous: _previous,
          next: _next,
          peer: _peer,
          previousOwner: _owner,
          mutation: _mutation,
          initialRender: _render,
          ...receiver
        } = witness
        const history = { ...generated, ...receiver } as H
        const key = 1 << ((generated.previous + generated.next) % 3)
        switch (state) {
          case `empty-baseline`:
            history.previous = 0
            break
          case `empty-result`:
            history.next = 0
            break
          case `overlapping-update`:
            history.previous |= key
            history.next |= key
            break
          case `omitted-row`:
            history.previous |= key
            history.next &= ~key
            break
          case `peer-owner`:
            history.previous |= key
            history.peer = true
            break
          case `ownerless-baseline`:
            history.previous |= key
            history.peer = false
            history.previousOwner = `none`
            break
          case `persisting-mutation`:
            history.mutation = `persisting`
            break
          case `source-below-batch`:
            history.batchSize = 2
            history.next &= key
            break
          case `source-at-batch`:
            history.batchSize = 1
            history.next = key
            break
          case `source-above-batch`:
            history.batchSize = 2
            history.next = 7
            break
          case `omissions-above-batch`:
            history.batchSize = 2
            history.previous = 7
            history.next = 0
            break
          case `paged-single-source`:
            history.singleSourceCommit = true
            history.next = 7
            break
          case `omissions-above-read-batch`:
            history.singleSourceCommit = true
            history.previous = 7
            history.next = 0
            break
          case `source-key-transform`:
            history.sourceKeys = `prefixed`
            history.next |= key
            break
        }
        if (
          state.startsWith(`network-first-`) ||
          history.response === `after-deadline`
        )
          history.initialRender = `network-first`
        if (history.response === `after-deadline`) history.previous |= key
        if (history.previous === 0) {
          history.peer = false
          delete history.previousOwner
        }
        if (history.next === 0) delete history.sourceKeys
        constructionStates.set(history, [state])
        return history
      },
    }
  })

  for (const host of [`controlled`, `node-sqlite`] as const) {
    describe(`${property} through ${host}`, () => {
      let sequence = 0
      // This adapter's model return adds only construction obligations. The
      // product model remains expectedPersistedStartup / expectedStartupFallback
      // in the shared comparison module, also used by the Chromium receiver.
      type Expected = {
        requiredStates: ReadonlyArray<string>
      }
      type Driver = OraclePropertyOptions<H, Expected>[`driver`]
      // The composition driver performs immediate cut comparisons. Record any
      // mismatch before its structured throw so the framework preserves that
      // law ahead of later cleanup/setup errors. The final observation uses
      // exactly the same independent comparison as the previous registrar.
      const recordCutFailure = (
        observe: Parameters<Driver>[1],
        violations: Array<string>,
      ) => {
        const first = violations[0]!
        const colon = first.indexOf(`:`)
        observe(
          colon < 0 ? `startup premise` : first.slice(0, colon),
          violations,
        )
      }
      const drive: Driver = async (history, observe) => {
        const storage = createStartupHost(host)
        try {
          const observation = await observePersistedStartup(
            adapter,
            storage.persistence,
            storage.holdBaseline,
            history,
            `startup-${host}-${sequence++}`,
            storage.readRowCount,
            () => {
              for (const state of startupReachedStates(history))
                observe(`reach`, state)
              const responseOrigin = origin(history)
              if (responseOrigin) observe(`reach`, responseOrigin)
            },
            (violations) => recordCutFailure(observe, violations),
          )
          observe(`completed`, observation)
        } finally {
          storage.close()
        }
      }
      const check = (
        history: H,
        trace: ReadonlyArray<Observation>,
        expected: Expected,
      ): Verdict => {
        const immediate = trace.find(
          ({ checkpoint }) =>
            checkpoint !== `completed` && checkpoint !== `reach`,
        )
        if (immediate) {
          const violations = immediate.value as Array<string>
          return violation(
            immediate.checkpoint,
            violations.join(`\n`),
            violations[0]?.startsWith(`startupDurable:`)
              ? `startup durability`
              : violations[0]?.startsWith(`startup batching:`)
                ? `startup batching`
                : `persisted startup`,
          )
        }
        const completed = trace.find(
          ({ checkpoint }) => checkpoint === `completed`,
        )
        if (!completed)
          return violation(
            `completed`,
            `the persisted startup driver did not complete`,
            `persisted startup`,
          )
        const violations = persistedStartupViolations(
          history,
          adapter.scope,
          completed.value as PersistedStartupObservation,
        )
        if (violations.length)
          return violation(
            `completed`,
            violations.join(`\n`),
            violations[0]?.startsWith(`startupDurable:`)
              ? `startup durability`
              : violations[0]?.startsWith(`startup batching:`)
                ? `startup batching`
                : `persisted startup`,
          )
        const reached = new Set(
          trace
            .filter(({ checkpoint }) => checkpoint === `reach`)
            .map(({ value }) => value),
        )
        const missing = expected.requiredStates.filter(
          (state) => !reached.has(state),
        )
        // Completeness is judged only after production's own cuts. Keep this
        // checkpoint unrecorded so an interrupted driver keeps its real error.
        return missing.length
          ? violation(
              `constructed states`,
              `constructed history did not enter ${missing.join(`, `)}`,
              `constructed reach`,
            )
          : pass
      }

      // A source that publishes after fallback but silently loses its durable
      // writes fails before refresh can repair it. Wrap both the outer adapter
      // and the hydration-scope adapter; the scoped fault must actually run.
      const losePersistence =
        (response: H[`response`]): Driver =>
        async (history, observe) => {
          if (history.response !== response) return drive(history, observe)
          let dropped = 0
          let scopedDrops = 0
          const corrupt = (
            subject: PersistenceAdapter,
            inScope = false,
          ): PersistenceAdapter =>
            new Proxy(subject, {
              get(target, key) {
                if (key === `applyCommittedTx`)
                  return () => {
                    dropped++
                    if (inScope) scopedDrops++
                    return Promise.resolve()
                  }
                if (key === `runInHydrationScope` && target.runInHydrationScope)
                  return (
                    task: Parameters<
                      NonNullable<typeof target.runInHydrationScope>
                    >[0],
                  ) =>
                    target.runInHydrationScope!((scoped) =>
                      task(corrupt(scoped, true)),
                    )
                const value: unknown = Reflect.get(target, key)
                return typeof value === `function` ? value.bind(target) : value
              },
            })
          const storage = createStartupHost(host)
          try {
            const observation = await observePersistedStartup(
              {
                ...adapter,
                create: (persistence, h, id) =>
                  adapter.create(
                    { ...persistence, adapter: corrupt(persistence.adapter) },
                    h,
                    id,
                  ),
              },
              storage.persistence,
              storage.holdBaseline,
              history,
              `lost-persistence-${host}-${sequence++}`,
              storage.readRowCount,
              () => {
                for (const state of startupReachedStates(history))
                  observe(`reach`, state)
                const responseOrigin = origin(history)
                if (responseOrigin) observe(`reach`, responseOrigin)
              },
              (violations) => {
                if (
                  violations[0]?.startsWith(`startupDurable:`) &&
                  dropped > 0 &&
                  (!(
                    host === `node-sqlite` &&
                    response === `before-restore` &&
                    scopedStartupCommit
                  ) ||
                    scopedDrops > 0)
                )
                  recordCutFailure(observe, violations)
              },
            )
            observe(`completed`, observation)
          } finally {
            storage.close()
          }
        }

      oracleProperty({
        id: property,
        law: {
          statement: `A complete eager source result replaces its persisted baseline and is durable before later refresh; network-first fallback preserves the saved snapshot. Opted-in receivers preserve ordinary startup commits without a full replacement.`,
          authority: `READY-3/PUB-7; docs/collections/query-collection.md, Direct Writes and Query Sync and Initial Data; glossary, network-first initial render; maintainer shared-owner decision 2026-11-09 and batching decision 2026-11-10.`,
          owner: `Adapter conformance: persisted startup (#2367)`,
          limits: `Three string keys, eager startup, one source plus an optional peer, a disjoint persisting mutation, local-only reopen; no concurrent writers, failed I/O, on-demand windows, or intermediate-publication claim.`,
        },
        histories: {
          arbitrary,
          runs: 80,
          fixedSeeds: [2367],
          states,
          constructed,
          fixed: histories.map((history) => ({
            name: JSON.stringify(history),
            history,
          })),
        },
        model: (history) => ({
          requiredStates: constructionStates.get(history) ?? [],
        }),
        driver: drive,
        check,
        calibrations: [
          ...(histories.some(
            (h) => h.batchSize !== undefined || h.singleSourceCommit,
          )
            ? [
                {
                  name: `replaces the ordinary initial commit with an explicit truncate`,
                  law: `startup batching`,
                  corrupt: (trace: ReadonlyArray<Observation>, history: H) =>
                    history.batchSize === undefined &&
                    !history.singleSourceCommit
                      ? undefined
                      : trace.map((entry) => {
                          if (entry.checkpoint !== `completed`) return entry
                          const observation =
                            entry.value as PersistedStartupObservation
                          return {
                            ...entry,
                            value: {
                              ...observation,
                              sourceTransactions:
                                observation.sourceTransactions?.map(
                                  (tx, index) =>
                                    index === 0
                                      ? {
                                          ...tx,
                                          snapshot: false,
                                          truncate: true,
                                        }
                                      : tx,
                                ),
                            },
                          }
                        }),
                },
              ]
            : []),
          ...states.map((state) => ({
            name: `omits constructed ${state}`,
            law: `constructed reach`,
            corrupt: (trace: ReadonlyArray<Observation>, history: H) =>
              constructionStates.get(history)?.includes(state)
                ? trace.filter(
                    ({ checkpoint, value }) =>
                      checkpoint !== `reach` || value !== state,
                  )
                : undefined,
          })),
          {
            name: `keeps stale durability until later refresh`,
            law: `startup durability`,
            corrupt: (trace, history) => {
              if (history.next === history.previous) return undefined
              return trace.map((entry) =>
                entry.checkpoint === `completed`
                  ? {
                      ...entry,
                      value: {
                        ...(entry.value as PersistedStartupObservation),
                        startupDurable: expectedPersistedStartup(
                          { ...history, next: history.previous },
                          adapter.scope,
                        ),
                      },
                    }
                  : entry,
              )
            },
          },
          {
            name: `loses the saved fallback`,
            law: `persisted startup`,
            corrupt: (trace, history) =>
              history.response === `after-deadline` && history.previous !== 0
                ? trace.map((entry) =>
                    entry.checkpoint === `completed`
                      ? {
                          ...entry,
                          value: {
                            ...(entry.value as PersistedStartupObservation),
                            fallback: {
                              ...expectedStartupFallback(
                                history,
                                adapter.scope,
                              ),
                              rows: [],
                            },
                          },
                        }
                      : entry,
                  )
                : undefined,
          },
          {
            name: `keeps the saved snapshot at first durability`,
            law: `startup durability`,
            corrupt: (trace, history) =>
              history.response === `after-deadline` && history.previous !== 0
                ? trace.map((entry) =>
                    entry.checkpoint === `completed`
                      ? {
                          ...entry,
                          value: {
                            ...(entry.value as PersistedStartupObservation),
                            startupDurable: expectedStartupFallback(
                              history,
                              adapter.scope,
                            ),
                          },
                        }
                      : entry,
                  )
                : undefined,
          },
          ...([`before-restore`, `after-deadline`] as const).map(
            (response) => ({
              name: `loses source persistence with ${response}`,
              law: `startup durability`,
              driver: losePersistence(response),
            }),
          ),
        ],
        timeout: 60_000,
      })
    })
  }
}
