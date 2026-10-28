import { expect, it } from 'vitest'
import { LazyWriteModel } from './lazy-paging-write-model-oracle'

/** Calibration of the two-sided law, independently of a backend driver. The
 * same source row distinguishes a confirmed lost write from a rejected write
 * that leaked remotely. These controls preserve both permitted counterparts. */
it(`rejects lost confirmations and remote effects of atomic rejection`, () => {
  const original = { id: `a`, rank: 1, text: `before` }
  const changed = { ...original, rank: 0, text: `after` }
  for (const confirmed of [false, true]) {
    const model = new LazyWriteModel([original])
    model.begin({ id: `a`, row: changed })
    expect(model.rows(true)).toEqual([changed])
    expect(model.rows()).toEqual([original])
    model.acknowledge(confirmed)
    model.startSettlement()
    model.finishSettlement()
    expect(() =>
      model.assertBackend([confirmed ? changed : original]),
    ).not.toThrow()
    expect(() => model.assertBackend([confirmed ? original : changed])).toThrow(
      `backend differs from authored ledger`,
    )
  }
  const model = new LazyWriteModel([original])
  model.begin({ id: `a` })
  expect(model.rows(true)).toEqual([])
  model.acknowledge(false)
  model.startSettlement()
  model.finishSettlement()
  expect(() => model.assertBackend([])).toThrow(
    `backend differs from authored ledger`,
  )
  model.assertBackend([original])
})

/** A rejected overlay can reveal an older applied source while a newer remote
 * revision waits. After the newer source is public, the old one cannot return. */
it(`separates optimistic rollback from source rollback and atomic source mixing`, () => {
  const a = { id: `a`, rank: 0, text: `a0` }
  const b = { id: `b`, rank: 1, text: `b0` }
  const nextA = { ...a, text: `a1` }
  const nextB = { ...b, text: `b1` }
  const model = new LazyWriteModel([a, b])
  model.observeWindow([a, b])
  model.begin({ id: `a` })
  model.observeWindow([b])
  model.remote([{ id: `b`, row: nextB }])
  model.acknowledge(false)
  model.startSettlement()
  model.observeWindow([a, b])
  model.finishSettlement()
  model.observeWindow([a, nextB])
  expect(() => model.observeWindow([a, b])).toThrow(
    `no coherent source/optimistic explanation`,
  )
  const atomic = new LazyWriteModel([a, b])
  atomic.observeWindow([a, b])
  atomic.remote([
    { id: `a`, row: nextA },
    { id: `b`, row: nextB },
  ])
  expect(() => atomic.observeWindow([nextA, b])).toThrow(
    `no coherent source/optimistic explanation`,
  )
  atomic.observeWindow([nextA, nextB])
})
