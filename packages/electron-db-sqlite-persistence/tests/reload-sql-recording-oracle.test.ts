/**
 * A recording frame contains exactly its main-process statements, in sequence
 * order, once each. A previous frame's delayed notifications cannot enter it.
 * Replaying the main buffer and live IPC delivery can repeat or reorder the
 * same entry. This is a recorder law, not a new persistence scheduling promise.
 * The model is the authored current frame. The driver combines live notices,
 * delayed retired notices and a buffer replay, then observes the recorder.
 * Stop includes a tail statement executed after the last trace snapshot but
 * before main acknowledges stop, even when its live notice arrives afterward.
 */
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { createSqlRecording } from './e2e/reload-class/sql-recording'
import type { Observation } from '../../db/tests/oracle-property'

oracleProperty({
  id: `sqlite-reload.electron.sql-recording`,
  owns: [`tests/e2e/reload-class/sql-recording.ts#createSqlRecording`],
  law: {
    statement: `The SQL recorder retains its current recording frame once, in main-process sequence order, excluding delayed retired notifications.`,
    authority: `reload-class-oracle.ts ReloadHost.record: record every statement the database runs in order, or stop; Electron receiving fixture session isolation.`,
    limits: `Transport recording only; two to six initial statements plus a stop-tail statement, delayed prior-frame notifications and buffer/live duplication. No SQL or scheduler behavior is inferred.`,
  },
  histories: {
    arbitrary: fc.record({
      statements: fc.array(
        fc.record({
          sql: fc.string({ maxLength: 12 }),
          value: fc.integer({ min: -3, max: 3 }),
        }),
        { minLength: 2, maxLength: 6 },
      ),
      offset: fc.nat({ max: 20 }),
    }),
    runs: 100,
    fixedSeeds: [2205],
    states: [`retired-frame`, `buffer-replay`, `sequence-gap`, `stop-tail`],
    constructed: Array.from({ length: 5 }, (_, i) => ({
      name: `all recording cuts ${i + 1}`,
      enters: [`retired-frame`, `buffer-replay`, `sequence-gap`, `stop-tail`],
      build: (h: {
        statements: Array<{ sql: string; value: number }>
        offset: number
      }) => ({
        ...h,
        offset: (h.offset + i) % 21,
        statements: [...h.statements.slice(0, -1), h.statements[0]!],
      }),
    })),
  },
  model: (h) => ({
    retired: [],
    gap: [],
    complete: [...h.statements, h.statements[0]!].map(({ sql, value }) => ({
      sql,
      params: [value],
    })),
  }),
  driver: async (h, observe) => {
    const recorder = createSqlRecording()
    const output: Array<{ sql: string; params: ReadonlyArray<unknown> }> = []
    const previous = recorder.begin(() => {})
    const current = recorder.begin((sql, params) =>
      output.push({ sql, params }),
    )
    const entries = [...h.statements, h.statements[0]!].map(
      ({ sql, value }, i) => ({
        frame: current,
        sequence: i + 1,
        session: 2,
        sql,
        params: [value],
      }),
    )
    recorder.accept({ ...entries[0]!, frame: previous, session: 1 })
    observe(`retired`, [...output])
    if (output.length === 0) observe(`reach`, `retired-frame`)
    recorder.accept(entries[1]!)
    observe(`gap`, [...output])
    if (output.length === 0) observe(`reach`, `sequence-gap`)
    // The final statement executes in main between the trace and stop RPCs.
    // Only stop's atomic buffer reply supplies it before the final comparison.
    const snapshot = entries.slice(0, -1)
    const split = h.offset % snapshot.length
    for (const entry of [...snapshot.slice(split), ...snapshot.slice(0, split)])
      recorder.accept(entry)
    const before = output.length
    for (const entry of snapshot) recorder.accept(entry)
    if (output.length === before) observe(`reach`, `buffer-replay`)
    await recorder.stop(Promise.resolve(entries))
    const stopped = output.length
    recorder.accept(entries.at(-1)!)
    if (stopped === entries.length && output.length === stopped)
      observe(`reach`, `stop-tail`)
    observe(`recorded`, output)
  },
  check: (_h, trace, expected) => {
    const actual = trace.find((entry) => entry.checkpoint === `recorded`)?.value
    try {
      expect(
        trace.find((entry) => entry.checkpoint === `retired`)?.value,
      ).toEqual(expected.retired)
      expect(trace.find((entry) => entry.checkpoint === `gap`)?.value).toEqual(
        expected.gap,
      )
      expect(actual).toEqual(expected.complete)
      for (const state of [
        `retired-frame`,
        `buffer-replay`,
        `sequence-gap`,
        `stop-tail`,
      ]) {
        if (
          !trace.some(
            (entry) => entry.checkpoint === `reach` && entry.value === state,
          )
        )
          return violation(`reach`, `missing ${state}`, `recording reach`)
      }
      return pass
    } catch (error) {
      return violation(`recorded SQL`, String(error), `recording frame`, {
        actual,
        expected,
      })
    }
  },
  calibrations: [
    ...[`retired-frame`, `buffer-replay`, `sequence-gap`, `stop-tail`].map(
      (state) => ({
        name: `cannot omit ${state}`,
        law: `recording reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter(
            (entry) => entry.checkpoint !== `reach` || entry.value !== state,
          ),
      }),
    ),
    {
      name: `a term ahead of its read remains visible`,
      law: `recording frame`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `recorded`
            ? {
                ...entry,
                value: [...(entry.value as Array<unknown>)].reverse(),
              }
            : entry,
        ),
    },
  ],
})
