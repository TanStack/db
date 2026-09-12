import { expect, it } from 'vitest'
import { expectDisabledResult } from './conformance/disabled-laws'
import type { ConformanceResult, LiveQueryDriver } from './conformance/contract'

const representations = [`absent`, `empty-reactive`] as const
function disabled(
  representation: LiveQueryDriver['disabledRepresentation'],
): ConformanceResult {
  return {
    data: representation === `absent` ? undefined : [],
    state: representation === `absent` ? undefined : new Map(),
    status: `disabled`,
    isReady: true,
    isError: false,
    isEnabled: false,
  }
}

it.each(representations)(
  `accepts the declared %s disabled representation`,
  (representation) => {
    expectDisabledResult(disabled(representation), representation)
  },
)

const faults: Array<[string, (value: ConformanceResult) => void]> = [
  [
    `ready status`,
    (value) => {
      value.status = `ready`
    },
  ],
  [
    `enabled`,
    (value) => {
      value.isEnabled = true
    },
  ],
  [
    `not ready`,
    (value) => {
      value.isReady = false
    },
  ],
  [
    `error`,
    (value) => {
      value.isError = true
    },
  ],
  [
    `stale data`,
    (value) => {
      value.data = [{ id: `stale` }]
    },
  ],
  [
    `stale state`,
    (value) => {
      value.state = new Map([[`stale`, { id: `stale` }]])
    },
  ],
]

for (const representation of representations) {
  it.each(faults)(
    `rejects %s under ${representation} disabled policy`,
    (_name, fault) => {
      const actual = disabled(representation)
      fault(actual)
      expect(() => expectDisabledResult(actual, representation)).toThrowError(
        /expected/,
      )
    },
  )
  it(`does not normalize the other representation into ${representation}`, () => {
    const other = representation === `absent` ? `empty-reactive` : `absent`
    expect(() =>
      expectDisabledResult(disabled(other), representation),
    ).toThrowError(/expected/)
  })
}
