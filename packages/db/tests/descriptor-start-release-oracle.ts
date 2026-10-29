/**
 * Descriptor preparation can fail after acquiring several source Collections.
 * Each acquired deferral must be released independently. One eager source's
 * throwing sync adapter cannot block another source's start. The preparation
 * error remains the caller's error; acquired healthy resources clean up once.
 *
 * Authority: the descriptor cleanup contract in docs/guides/ssr.md
 * and the established failed-preparation histories in React/Svelte. Source
 * crashes and cleanup use the glossary's Collection lifecycle laws.
 *
 * This finite model combines one descriptor's binding and deferral acquisition
 * as `acquired`. It does not model graph demand. The receiving hosts reject
 * during binding, before a graph or subscription can own a source. A prefix of
 * zero through three descriptors is acquired; the next factory throws, and one
 * tail descriptor must remain unacquired. Every sync-failure mask and eager/lazy
 * policy is represented. A lazy source needs independent demand; an eager one
 * starts on release. Failed starts acquire no adapter resource.
 *
 * Limits: synchronous factory/start failure only, no provider shutdown, graph
 * compiler failure, or arbitrary concurrent render scheduling. React/Svelte
 * supply native receiving drivers for the same judgment.
 */
import { expect } from 'vitest'
import { declareOracle } from './oracle-declaration'

export type DescriptorStartHistory = {
  acquired: number
  failedStarts: number
  eagerStarts: number
}

// Bounds include failure before acquisition, after one resource, and after
// multiple resources. A mask outside its acquired prefix is not a legal input.
export const descriptorStartHistories: Array<DescriptorStartHistory> = (
  [0, 1, 2, 3] as const
).flatMap((acquired) =>
  Array.from({ length: 2 ** acquired }, (_, failedStarts) =>
    Array.from({ length: 2 ** acquired }, (_, eagerStarts) => ({
      acquired,
      failedStarts,
      eagerStarts,
    })),
  ).flat(),
)

export type DescriptorStartObservation = {
  factories: Array<number>
  starts: Array<number>
  cleanups: Array<number>
  statuses: Array<string>
  rows: Array<Array<{ id: string; value: string }>>
}

/** Each acquired source owns its start policy, independent of its neighbors.
 * Factory failure prevents acquisition of the failing descriptor and its tail.
 * Before demand, lazy sources stay idle. Demand attempts each source once;
 * a throwing adapter crashes its Collection and publishes no row.
 */
export function expectedDescriptorStart(
  history: DescriptorStartHistory,
  cut: `rejected` | `read` | `cleaned`,
): DescriptorStartObservation {
  const { acquired, failedStarts, eagerStarts } = history
  if (
    !Number.isInteger(acquired) ||
    acquired < 0 ||
    !Number.isInteger(failedStarts) ||
    failedStarts < 0 ||
    failedStarts >= 2 ** acquired ||
    !Number.isInteger(eagerStarts) ||
    eagerStarts < 0 ||
    eagerStarts >= 2 ** acquired
  )
    throw new Error(`Invalid descriptor start history`)
  const started = (index: number) =>
    Boolean(eagerStarts & (1 << index)) || cut !== `rejected`
  return {
    // The failing factory may be retried by its host. Drivers record only
    // successful factory calls and the unvisited tail, preserving duplicates.
    factories: [...Array.from({ length: acquired }, () => 1), 0],
    starts: Array.from({ length: acquired }, (_, index) =>
      Number(started(index)),
    ),
    cleanups: Array.from({ length: acquired }, (_, index) =>
      Number(cut === `cleaned` && !(failedStarts & (1 << index))),
    ),
    statuses: Array.from({ length: acquired }, (_, index) =>
      cut === `cleaned`
        ? `cleaned-up`
        : !started(index)
          ? `idle`
          : failedStarts & (1 << index)
            ? `crashed`
            : `ready`,
    ),
    rows: Array.from({ length: acquired }, (_, index) =>
      cut !== `cleaned` && started(index) && !(failedStarts & (1 << index))
        ? [{ id: `row-${index}`, value: `value-${index}` }]
        : [],
    ),
  }
}

export function checkDescriptorStart(
  actual: DescriptorStartObservation,
  history: DescriptorStartHistory,
  cut: `rejected` | `read` | `cleaned`,
): void {
  expect(actual, cut).toEqual(expectedDescriptorStart(history, cut))
}

declareOracle({
  check: [checkDescriptorStart],
  model: [expectedDescriptorStart],
  grammar: [descriptorStartHistories],
})
