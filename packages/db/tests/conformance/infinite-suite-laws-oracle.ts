/**
 * The laws that the shared infinite-query suite (infinite-suite.ts) compares
 * production with: the overlapping-window model, which predicts the committed
 * prefix, its continuation, and the retained error after overlapping window
 * outcomes, and the publication law, which checks every ready value against
 * the source prefix for its page count. Each expectation comes from the
 * immutable source rows and page size, never from the controller. The suite
 * runs under each framework's ordinary conformance test file.
 */
import { expect } from 'vitest'
import type { InfiniteRow } from './infinite-suite-harness'
import type { InfiniteQueryHandle } from './infinite-contract'

/**
 * A fulfilled page fetch advances the committed prefix. A failed request leaves
 * that prefix and the `ready` status alone; its rejection reaches the caller,
 * and a failed source load behind it is a request error in the health tree.
 * Source length decides whether the committed prefix has a continuation,
 * including after later source writes.
 */
export function expectedOverlappingWindow(
  source: ReadonlyArray<InfiniteRow>,
  pageSize: number,
  pageSucceeded: boolean,
) {
  const pageCount = pageSucceeded ? 2 : 1
  const visible = source.slice(0, pageCount * pageSize)
  return {
    ids: visible.map((row) => row.id),
    pages: Array.from({ length: pageCount }, (_, page) =>
      visible
        .slice(page * pageSize, (page + 1) * pageSize)
        .map((row) => row.id),
    ),
    pageParams: Array.from({ length: pageCount }, (_, page) => page),
    hasNextPage: source.length > pageCount * pageSize,
    isFetchingNextPage: !pageSucceeded,
  }
}

/**
 * Publication law for a fixed source and query: every ready value the binding
 * published equals the source prefix for that value's own page count. The
 * expectation comes from the immutable source rows and page size, not from the
 * controller, so a ready value that holds fewer rows than its pages, splits
 * them at the wrong boundary, or reports a false end of list fails here even
 * when the settled state later recovers.
 */
export function expectReadyObservationsMatchSource(
  handle: InfiniteQueryHandle,
  source: ReadonlyArray<InfiniteRow>,
  pageSize: number,
): void {
  const ready = handle
    .observations()
    .filter((observation) => observation.status === `ready`)
  expect(ready.length).toBeGreaterThan(0)
  for (const observation of ready) {
    const pageCount = observation.pages.length
    const visible = source.slice(0, pageCount * pageSize).map((row) => row.id)
    expect(observation).toEqual({
      status: `ready`,
      ids: visible,
      pages: Array.from({ length: pageCount }, (_, page) =>
        visible.slice(page * pageSize, (page + 1) * pageSize),
      ),
      hasNextPage: source.length > pageCount * pageSize,
    })
  }
}

/**
 * A live-query Collection sends no on-demand request until it has a
 * subscriber or a preload. A framework that publishes a value before its hook
 * subscribes (a React render, Svelte construction) therefore shows a value
 * with no rows first; one whose first value follows the subscription (Vue
 * setup) shows the ready first page. Both are legal. Any other first value,
 * such as an error, an idle value, or one holding rows before it is ready, is
 * not.
 */
export function expectFirstOnDemandValue(
  handle: InfiniteQueryHandle,
  firstPage: Array<string>,
  where: string,
  // `loading` when the hook started the collection before subscribing;
  // `idle` for a supplied window the hook adjusts before starting it.
  notReady: `loading` | `idle` = `loading`,
): void {
  const first = handle.observations()[0]
  if (first?.status === `ready`) {
    expect(first, `${where}: a ready first value`).toEqual({
      status: `ready`,
      ids: firstPage,
      pages: [firstPage],
      hasNextPage: true,
    })
  } else {
    expect(first, `${where}: a first value before the request`).toEqual({
      status: notReady,
      ids: [],
      pages: [[]],
      hasNextPage: false,
    })
  }
}

/** A rejected input throws at mount, reconfiguration, flush, or read. */
export async function captureRejection(
  run: () => Promise<unknown> | unknown,
): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (error) {
    return error
  }
}

/**
 * After a rejection, every read throws or holds no rows. Two reads catch a
 * memo that throws once and then serves its previous value. No current driver
 * can fail this check (see `contract.ts`); it guards a driver whose binding
 * stays mounted after a rejection.
 */
export function expectNoPagesAfterRejection(handle: InfiniteQueryHandle): void {
  for (let read = 0; read < 2; read++) {
    let data: unknown
    try {
      data = handle.current().data
    } catch {
      continue
    }
    expect(data).toEqual([])
  }
}
