/**
 * Source ID reuse contract for React's derived live-query identity.
 *
 * A Collection ID names one source object for the lifetime of a mounted
 * derived-identity hook in one DbClient scope. Re-rendering that hook with a different object under
 * the same ID must reject before it can return rows from the old source.
 * Unmounting and cleaning up the old scope permits the ID in a new hook. Two
 * independent client scopes may use the same ID at the same time.
 *
 * Model: each mounted hook remembers the source object first seen for an ID
 * in each client scope. Same object and fresh ID transitions are legal. A
 * different object for a remembered ID is rejected. A new hook starts a new
 * model; switching clients selects that client's remembered bindings.
 * A render that starts a live query claims its source before a descendant
 * suspends, because the live query may still own that source until cleanup.
 * Separate hooks can use same-ID objects: their client-scoped Suspense cache
 * entries must remain distinct, including before the first hook commits.
 * A rejected render must release any sync-start deferral it acquired for a
 * shared client descriptor, so a later direct reader can start that Collection.
 * This remains true when earlier deferred sync starts throw: each pending
 * Collection is attempted before the first startup error is rethrown.
 * The bounded histories below distinguish this law from a hash-only check,
 * which would miss A(id=x) -> C(id=y) -> B(id=x), a changed predicate, and
 * two different same-ID sources in one query.
 *
 * Driver and observation: render the public hook, then rerender it with each
 * source. At the rerender boundary, compare a thrown error or the public row.
 * This does not assert a process-wide Collection registry, legacy dependency
 * arrays, or explicit-key semantics; explicit queryKey callers own their key.
 */
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { DbClient, gt } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { Suspense } from 'react'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { source } from './source-id-reuse-support'

type Binding = { source: ReturnType<typeof source>; client?: DbClient }

// A prior source with the same ID in this client scope forbids a new object.
// Pairwise history comparison is independent of the hook's token maps.
function expectedCollision(history: ReadonlyArray<Binding>, next: Binding) {
  return history.some(
    (prior) =>
      prior.client === next.client &&
      prior.source.id === next.source.id &&
      prior.source !== next.source,
  )
}

function checkRerender(
  history: ReadonlyArray<Binding>,
  next: Binding,
  rerender: () => void,
) {
  if (expectedCollision(history, next)) {
    expect(rerender).toThrow(/source Collection .*same ID/i)
  } else {
    expect(rerender).not.toThrow()
  }
}

declareOracle({ check: [checkRerender], model: [expectedCollision] })

describe(`React source ID reuse`, () => {
  it(`rejects a different active source with the same ID before exposing stale rows`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`rejects a previously used ID after another source and a query change`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current, minimum }) =>
        useLiveQuery({
          query: (q) =>
            q
              .from({ settings: current })
              .where(({ settings }) => gt(settings.rank, minimum)),
        }),
      { initialProps: { current: first, minimum: 0 } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    act(() => hook.rerender({ current: other, minimum: 0 }))
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [{ source: first }, { source: other }],
      { source: second },
      () => hook.rerender({ current: second, minimum: -1 }),
    )
  })

  it(`accepts the same source object and a different source ID`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: first }, () =>
      hook.rerender({ current: first }),
    )
    expect(hook.result.current.data[0]?.value).toBe(`first`)
    checkRerender([{ source: first }], { source: other }, () =>
      hook.rerender({ current: other }),
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
  })

  it(`keeps a mounted hook's ID binding after source cleanup`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    await act(async () => first.cleanup())
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`remembers each client scope when one mounted hook switches clients`, async () => {
    const firstClient = new DbClient()
    const secondClient = new DbClient()
    const first = source(`settings`, `first`)
    const otherScope = source(`settings`, `other`)
    const replacement = source(`settings`, `replacement`)
    const hook = renderHook(
      ({ client, current }) =>
        useLiveQuery({
          client,
          query: (q) => q.from({ settings: current }),
        }),
      { initialProps: { client: firstClient, current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    hook.rerender({ client: secondClient, current: otherScope })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [
        { source: first, client: firstClient },
        { source: otherScope, client: secondClient },
      ],
      { source: replacement, client: firstClient },
      () => hook.rerender({ client: firstClient, current: replacement }),
    )
  })

  it(`rejects same-ID reuse after a suspended render starts a source query`, async () => {
    const first = source(`first`, `first`)
    const abandoned = source(`candidate`, `abandoned`)
    const replacement = source(`candidate`, `replacement`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useLiveQuery({
        query: (q) => q.from({ settings: current }),
      })
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())

    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={abandoned} suspend={true} />
      </Suspense>,
    )
    checkRerender(
      [{ source: first }, { source: abandoned }],
      { source: replacement },
      () =>
        root.rerender(
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} suspend={false} />
          </Suspense>,
        ),
    )
  })
})

/**
 * ## useLiveInfiniteQuery
 *
 * The infinite hook derives its identity the same way, and keeps the window
 * collection built by its latest render for a second render before commit.
 * That cache is keyed by derived identity, which names sources by ID, so the
 * same law applies: a different same-ID source must reject before the hook
 * can publish the old source's rows, from a committed or a suspended render.
 * This driver reuses the model above with the bounded histories that
 * distinguish the law from a hash-only check.
 */
describe(`React source ID reuse: useLiveInfiniteQuery`, () => {
  const useInfinite = (current: ReturnType<typeof source>) =>
    useLiveInfiniteQuery(
      (q) =>
        q.from({ settings: current }).orderBy(({ settings }) => settings.rank),
      { pageSize: 1 },
    )

  it(`rejects a different active source with the same ID before exposing stale rows`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`rejects a previously used ID after another source`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const second = source(`settings`, `second`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    act(() => hook.rerender({ current: other }))
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [{ source: first }, { source: other }],
      { source: second },
      () => hook.rerender({ current: second }),
    )
  })

  it(`accepts the same source object and a different source ID`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: first }, () =>
      hook.rerender({ current: first }),
    )
    checkRerender([{ source: first }], { source: other }, () =>
      hook.rerender({ current: other }),
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
  })

  it(`rejects same-ID reuse after a suspended render starts a source query`, async () => {
    const first = source(`first`, `first`)
    const abandoned = source(`candidate`, `abandoned`)
    const replacement = source(`candidate`, `replacement`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useInfinite(current)
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())
    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={abandoned} suspend={true} />
      </Suspense>,
    )
    checkRerender(
      [{ source: first }, { source: abandoned }],
      { source: replacement },
      () =>
        root.rerender(
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} suspend={false} />
          </Suspense>,
        ),
    )
  })
})
