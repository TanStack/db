import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { captureHashSession } from './hash-session'
import type { HashSession } from './hash-session'

type Encounter = `symbol-a` | `symbol-b` | `function` | `register-opaque`
const encounters: Array<Encounter> = [
  `symbol-a`,
  `symbol-b`,
  `function`,
  `register-opaque`,
]

function runEncounterScript(
  session: HashSession,
  script: ReadonlyArray<Encounter>,
): Array<number> {
  // Same descriptions do not collapse distinct symbols. The IDs and action
  // order below are the replay representation; JSON of runtime handles is not.
  const symbols = { 'symbol-a': Symbol(`same`), 'symbol-b': Symbol(`same`) }
  const callable = () => 1
  const opaque: { self?: object } = {}
  opaque.self = opaque
  const observed: Array<number> = []
  for (const action of script) {
    if (action === `register-opaque`) session.registerOpaqueHash(opaque)
    else
      observed.push(
        session.hash(action === `function` ? callable : symbols[action]),
      )
  }
  const value = { symbol: symbols[`symbol-a`], callable, opaque }
  const clone = { symbol: symbols[`symbol-a`], callable, opaque }
  const result = session.hash(value)
  expect(session.hash(clone)).toBe(result)
  observed.push(result, session.hash(symbols[`symbol-b`]))
  return observed
}

function expectSessionLaws(session: HashSession): void {
  expect(session.hash({ a: [1, 2] })).toBe(session.hash({ a: [1, 2] }))
  expect(session.hash(-0)).toBe(session.hash(0))
  const cycle: { next?: object } = {}
  cycle.next = cycle
  expect(() => session.hash(cycle)).toThrow(
    `Cannot hash cyclic structural values`,
  )
}

describe(`hash initialization and encounter replay`, () => {
  it(`replays native module draws and an explicit reference encounter history`, async () => {
    const nativeRandom = Math.random
    const first = await captureHashSession()
    expect(Math.random).toBe(nativeRandom)
    expect(first.tape.length).toBeGreaterThan(0)
    const script: Array<Encounter> = [
      `symbol-b`,
      `function`,
      `register-opaque`,
      `symbol-a`,
    ]
    const observed = runEncounterScript(first, script)
    const replay = await captureHashSession(first.tape)
    expect(Math.random).toBe(nativeRandom)
    expect(replay.environment).toEqual(first.environment)
    expect(runEncounterScript(replay, script)).toEqual(observed)
  })

  it(`preserves equality and cycle laws across bounded initialization tapes`, async () => {
    const captured = await captureHashSession()
    for (const offset of [0.125, 0.375, 0.625]) {
      // Do not require the numeric digest to agree across different tapes.
      const tape = captured.tape.map((_, index) => (offset + index / 64) % 1)
      expectSessionLaws(await captureHashSession(tape))
    }
  })

  it(`replays bounded encounter permutations without changing their order`, async () => {
    const captured = await captureHashSession()
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(encounters, {
          minLength: encounters.length,
          maxLength: encounters.length,
        }),
        async (script) => {
          const first = await captureHashSession(captured.tape)
          const observed = runEncounterScript(first, script)
          const replay = await captureHashSession(captured.tape)
          expect(runEncounterScript(replay, script)).toEqual(observed)
        },
      ),
      { seed: 205205, numRuns: 12 },
    )
  })

  it(`rejects incomplete and excessive tapes and restores randomness on import failure`, async () => {
    const nativeRandom = Math.random
    const captured = await captureHashSession()
    await expect(captureHashSession(captured.tape.slice(1))).rejects.toThrow(
      `Hash replay tape exhausted`,
    )
    expect(Math.random).toBe(nativeRandom)
    await expect(captureHashSession([...captured.tape, 0.5])).rejects.toThrow(
      `Unused hash replay draws`,
    )
    expect(Math.random).toBe(nativeRandom)
    const error = new Error(`import rejected`)
    await expect(
      captureHashSession(undefined, () => Promise.reject(error)),
    ).rejects.toBe(error)
    expect(Math.random).toBe(nativeRandom)
    expectSessionLaws(await captureHashSession(captured.tape))
  })
})
