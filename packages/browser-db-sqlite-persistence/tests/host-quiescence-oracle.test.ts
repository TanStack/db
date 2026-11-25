// @vitest-environment node
/**
 * Quiescence is an observation premise, not evidence of Collection readiness.
 * A host cannot be quiet while an observed operation remains unfinished.
 * Fulfillment and rejection both end work, without changing its Promise or
 * deciding whether the product result is correct (ORC-005 and ORC-010).
 *
 * The model counts externally released calls. The production driver holds
 * their Promises across more than five otherwise quiet tasks, then releases
 * them. A fake clock controls tasks only; it never settles the held calls.
 * Public rows, coordinator recovery policy and cross-process work are outside
 * this instrument law. The multi-tab Electric receiver supplies the real
 * coordinator path and retains its independent product comparisons.
 */
import { fc } from '@fast-check/vitest'
import { vi } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { createHostQuiescence } from './host-quiescence'

type History = { outcomes: Array<boolean>; followups: boolean }
type Cut = { idle: boolean; settled: number; identity: boolean }
const state = `observed call remains held at the checkpoint`
const followupState = `a settled call starts another held call`
const states = [state, followupState]
const constructed = Array.from({ length: 5 }, (_, index) => ({
  name: `held calls ${index + 1}`,
  enters: states,
  build: (h: History): History => ({
    outcomes: [...h.outcomes, index % 2 === 0].slice(-4),
    followups: true,
  }),
}))

oracleProperty({
  id: `browser.host-quiescence`,
  owns: [`tests/host-quiescence.ts#createHostQuiescence`],
  law: {
    statement: `Quiescence cannot finish while an observed call or its observed follow-up is held. Both fulfilled and rejected calls release work, and tracking preserves the original Promise.`,
    authority: `Oracle rubric ORC-005: the driver must establish its observation checkpoint. ORC-010: recording must preserve failures and release resources.`,
    limits: `Zero to four observed calls, held then fulfilled or rejected, optionally starting one held follow-up each. This does not prove completion of unobserved host work or unbounded chains.`,
  },
  histories: {
    arbitrary: fc.record({
      outcomes: fc.array(fc.boolean(), { maxLength: 4 }),
      followups: fc.boolean(),
    }),
    fixedSeeds: [2377],
    runs: 8,
    states,
    constructed,
  },
  // A call ends only when the driver releases it, regardless of its outcome.
  model: (h): Array<Cut> => [
    { idle: h.outcomes.length === 0, settled: 0, identity: true },
    {
      idle: !h.followups || h.outcomes.length === 0,
      settled: h.outcomes.length,
      identity: true,
    },
    {
      idle: true,
      settled: h.outcomes.length * (h.followups ? 2 : 1),
      identity: true,
    },
  ],
  driver: async (h, observe) => {
    vi.useFakeTimers()
    try {
      const host = createHostQuiescence()
      let settled = 0
      let identity = true
      const children: Array<() => void> = []
      const hold = (rejects: boolean, follows = false) => {
        let finish!: () => void
        const work = new Promise<void>((resolve, reject) => {
          finish = () =>
            rejects ? reject(new Error(`held failure`)) : resolve()
        })
        const done = () => {
          settled++
          if (follows) children.push(hold(!rejects))
        }
        void work.then(done, done)
        identity &&= host.track(work) === work
        return finish
      }
      const release = h.outcomes.map((rejects) => hold(rejects, h.followups))
      let idle = false
      const waiting = host.wait(`held operations`).then(() => {
        idle = true
      })
      await vi.advanceTimersByTimeAsync(20)
      observe(`cut`, { idle, settled, identity })
      if (settled < release.length) observe(`reach`, state)
      for (const finish of release) finish()
      await vi.advanceTimersByTimeAsync(20)
      observe(`cut`, { idle, settled, identity })
      if (children.length > 0 && settled === release.length)
        observe(`reach`, followupState)
      for (const finish of children) finish()
      await vi.advanceTimersByTimeAsync(20)
      await waiting
      observe(`cut`, { idle, settled, identity })
    } finally {
      vi.useRealTimers()
    }
  },
  check: (_h, trace, expected) => {
    const actual = trace
      .filter((entry) => entry.checkpoint === `cut`)
      .map((entry) => entry.value) as Array<Cut>
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      return violation(
        `held/released calls`,
        `unfinished work reported idle`,
        `host quiescence`,
        { actual, expected },
      )
    for (const [index, reached] of states.entries())
      if (
        !expected[index]!.idle &&
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === reached,
        )
      )
        return violation(`reach`, `held call was not observed`, `host reach`)
    return pass
  },
  calibrations: [
    {
      name: `rejects idle before held calls settle`,
      law: `host quiescence`,
      history: { constructed: constructed[0]!.name },
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `cut` && (entry.value as Cut).settled === 0
            ? { ...entry, value: { ...(entry.value as Cut), idle: true } }
            : entry,
        ),
    },
    {
      name: `rejects idle while follow-up calls remain held`,
      law: `host quiescence`,
      history: { constructed: constructed[0]!.name },
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `cut` &&
          (entry.value as Cut).settled > 0 &&
          !(entry.value as Cut).idle
            ? { ...entry, value: { ...(entry.value as Cut), idle: true } }
            : entry,
        ),
    },
    ...constructed.flatMap((builder) =>
      states.map((reached) => ({
        name: `${builder.name} must reach ${reached}`,
        law: `host reach`,
        history: { constructed: builder.name },
        corrupt: (
          trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
        ) =>
          trace.filter(
            (entry) => entry.checkpoint !== `reach` || entry.value !== reached,
          ),
      })),
    ),
  ],
})
