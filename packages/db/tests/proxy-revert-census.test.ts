// Fixed-seed censuses of the draft revert grammars. These tests run no
// production: each samples a grammar of proxy-revert-model-oracle.ts with the
// oracle's fixed seed and counts, through the model, the states that the
// generated campaigns in proxy-revert-oracle.property.test.ts must exercise.
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleFixedSeed } from './oracle-config'
import {
  FIELDS,
  FIXED_SEED,
  applicable,
  classWriteArb,
  encode,
  expectedChanges,
  historyArb,
  nativeHistoryArb,
  resolve,
  step,
} from './proxy-revert-model-oracle'
import type { Root } from './proxy-revert-model-oracle'

describe(`draft revert oracle`, () => {
  // Positive execution witness: the fixed campaign reaches each operation, a
  // partial revert (some change survives one revert), a full revert, and a
  // change made only under a nested symbol key.
  it(`reaches every operation and both revert outcomes in the fixed campaign`, () => {
    const sample = fc.sample(
      historyArb,
      oracleFixedSeed(FIXED_SEED, { numRuns: 400 }),
    )
    const reached = new Set<string>()
    let partial = 0
    let full = 0
    let symbolOnly = 0
    // Reverts that write the row's own object back, a class instance included.
    let sameObjectReverts = 0
    let samePointReverts = 0
    for (const { original, ops } of sample) {
      let state: Root = { ...original }
      // A revert counts only when the field differs from its original, so
      // the set trap's revert branch runs. Other reverts write an equal value.
      let effectiveReverts = 0
      for (const generated of ops) {
        const op = resolve(state, original, generated)
        if (op === undefined || !applicable(state, original, op)) continue
        reached.add(op.op)
        const restored = original[op.field]
        if (
          op.op === `revert` &&
          op.same &&
          restored !== undefined &&
          !(restored.k === `prim` || restored.k === `date`)
        )
          sameObjectReverts +=
            restored.k === `point` ? (samePointReverts++, 1) : 1
        if (
          op.op === `revert` &&
          encode(state[op.field]) !== encode(original[op.field])
        )
          effectiveReverts++
        state = step(state, original, op)
      }
      const changed = expectedChanges(original, state).size
      if (effectiveReverts > 0 && changed > 0) partial++
      if (effectiveReverts > 0 && changed === 0) full++
      for (const field of FIELDS) {
        const a = original[field]
        const b = state[field]
        if (
          a?.k === `obj` &&
          b?.k === `obj` &&
          a.sym !== b.sym &&
          encode({ ...a, sym: undefined }) ===
            encode({ ...b, sym: undefined }) &&
          !Object.is(a.sym, b.sym) &&
          encode(a) !== encode(b)
        )
          symbolOnly++
      }
    }
    expect([...reached].sort()).toEqual([
      `delete`,
      `forOf`,
      `index`,
      `nested`,
      `nestedDelete`,
      `revert`,
      `set`,
    ])
    expect(partial).toBeGreaterThanOrEqual(5)
    expect(full).toBeGreaterThanOrEqual(30)
    expect(symbolOnly).toBeGreaterThan(0)
    expect(sameObjectReverts).toBeGreaterThanOrEqual(20)
    expect(samePointReverts).toBeGreaterThan(0)
  })

  // Writes that a keyless comparison would call equal: another URL, or a
  // Secret over another Secret or over an object without keys.
  it(`reaches writes over URLs and keyless objects in the fixed campaign`, () => {
    let urlWrites = 0
    let keylessWrites = 0
    const sample = fc.sample(
      classWriteArb,
      oracleFixedSeed(FIXED_SEED, { numRuns: 200 }),
    )
    for (const { original, ops } of sample) {
      let state: Root = { ...original }
      for (const generated of ops) {
        const op = resolve(state, original, generated)
        if (op === undefined || !applicable(state, original, op)) continue
        const current = state[op.field]
        if (op.op === `set` && op.value.k === `url` && current?.k === `url`)
          if (op.value.path !== current.path) urlWrites++
        if (op.op === `set` && op.value.k === `secret`)
          if (
            (current?.k === `secret` && current.v !== op.value.v) ||
            (current?.k === `obj` && encode(current) === encode({ k: `obj` }))
          )
            keylessWrites++
        state = step(state, original, op)
      }
    }
    expect(urlWrites).toBeGreaterThanOrEqual(10)
    expect(keylessWrites).toBeGreaterThanOrEqual(10)
  })
})

describe(`draft revert oracle: native mutators mixed with assignments`, () => {
  // Positive execution witness: the fixed campaign reaches a native write
  // that an assignment then replaces, and a mutator through a detached handle.
  it(`reaches replaced native writes and detached handles in the fixed campaign`, () => {
    const sample = fc.sample(
      nativeHistoryArb,
      oracleFixedSeed(FIXED_SEED, { numRuns: 400 }),
    )
    const replaced = sample.filter((h) => {
      const first = h.ops.findIndex((o) =>
        [`push`, `pop`, `reverse`].includes(o.op),
      )
      return (
        first >= 0 &&
        h.ops
          .slice(first)
          .some((o) => o.op === `assignArr` || o.op === `restoreArr`)
      )
    })
    const detached = sample.filter((h) => {
      const retain = h.ops.findIndex((o) => o.op === `retain`)
      if (retain < 0) return false
      const after = h.ops.slice(retain + 1)
      const replace = after.findIndex(
        (o) => o.op === `assignArr` || o.op === `restoreArr`,
      )
      return (
        replace >= 0 &&
        after.slice(replace + 1).some((o) => o.op === `pushHandle`)
      )
    })
    expect(replaced.length).toBeGreaterThan(20)
    expect(detached.length).toBeGreaterThan(3)
  })
})
