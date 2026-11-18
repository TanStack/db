import { describe, expect, it } from 'vitest'
import { readRefreshBarrier } from './offline-executor-refresh-driver'

describe(`refresh barrier observation`, () => {
  it(`records an absent barrier`, async () => {
    expect(await readRefreshBarrier(() => null)).toBe(`none`)
  })

  it(`records a held barrier as pending`, async () => {
    const barrier = new Promise<void>(() => {})
    expect(await readRefreshBarrier(() => barrier)).toBe(`pending`)
  })

  it.each([`fulfilled`, `rejected`])(
    `records an already %s barrier as settled`,
    async (outcome) => {
      const barrier =
        outcome === `fulfilled`
          ? Promise.resolve()
          : Promise.reject(new Error(`rejected barrier`))
      expect(await readRefreshBarrier(() => barrier)).toBe(`settled`)
    },
  )

  it(`keeps a replacement pending when the prior barrier settles`, async () => {
    const pending = new Promise<void>(() => {})
    let current: Promise<void> | null = Promise.resolve()
    void current.then(() => {
      current = pending
    })
    expect(await readRefreshBarrier(() => current)).toBe(`pending`)
  })

  it(`observes settlement through a pending promise reaction chain`, async () => {
    const barrier = Promise.resolve()
      .then(() => {})
      .then(() => {})
    expect(await readRefreshBarrier(() => barrier)).toBe(`settled`)
  })

  it(`observes removal during the settlement reaction`, async () => {
    let current: Promise<void> | null = Promise.resolve()
    void current.then(() => {
      current = null
    })
    expect(await readRefreshBarrier(() => current)).toBe(`none`)
  })
})
