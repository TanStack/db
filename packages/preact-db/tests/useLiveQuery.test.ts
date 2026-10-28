/**
 * Preact-specific binding witnesses for `useLiveQuery`.
 *
 * The shared conformance suite owns the cross-framework result and identity
 * laws. These witnesses cover Preact binding obligations its histories cannot
 * reach:
 *
 * - A publication between render and subscription is not lost. A sibling's
 *   layout effect can write to the source after this hook rendered but before
 *   it subscribed; the committed result must include that write.
 * - Identity comes from the query IR or from `queryKey`, as in React. A
 *   changed key recompiles the query, and an equal key keeps its live-query
 *   Collection. A structurally equal rerender keeps it too.
 *
 * Observation: each component records the rows it rendered. Preact commits a
 * render synchronously, so the last render is the committed result.
 */
import { Fragment, h, render } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { createCollection, eq } from '@tanstack/db'
import { afterEach, describe, expect, it } from 'vitest'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import type { ComponentChild } from 'preact'

type Row = { id: string; team: string }

const containers: Array<HTMLElement> = []

function mountRoot(vnode: ComponentChild): HTMLElement {
  const container = document.createElement(`div`)
  containers.push(container)
  act(() => render(vnode, container))
  return container
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    act(() => render(null, container))
  }
})

function makeSource(id: string, rows: Array<Row>) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id,
      getKey: (row) => row.id,
      initialData: rows,
    }),
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe(`useLiveQuery subscription`, () => {
  it(`publishes a write made between render and subscription`, async () => {
    const source = makeSource(`late-write`, [{ id: `a`, team: `x` }])
    let rendered: Array<string> = []
    // Preact renders the whole tree before it runs layout effects, and runs
    // sibling layout effects in render order. Placed first, this write lands
    // after Reader rendered and before Reader's subscription effect runs.
    function Writer() {
      useLayoutEffect(() => {
        source.utils.begin()
        source.utils.write({ type: `insert`, value: { id: `b`, team: `x` } })
        source.utils.commit()
      }, [])
      return null
    }
    function Reader() {
      const { data } = useLiveQuery((q) => q.from({ row: source }))
      rendered = data.map((row) => row.id)
      return null
    }

    mountRoot(h(Fragment, null, h(Writer, null), h(Reader, null)))
    await settle()
    expect(rendered).toEqual([`a`, `b`])
  })
})

describe(`useLiveQuery identity`, () => {
  it(`keeps a structurally equal query across rerenders`, async () => {
    const source = makeSource(`structural`, [
      { id: `a`, team: `x` },
      { id: `b`, team: `y` },
    ])
    let collection: unknown
    function Reader({ team }: { team: string }) {
      const result = useLiveQuery((q) =>
        q.from({ row: source }).where(({ row }) => eq(row.team, team)),
      )
      collection = result.collection
      return null
    }
    const container = mountRoot(h(Reader, { team: `x` }))
    await settle()
    const first = collection
    act(() => render(h(Reader, { team: `x` }), container))
    expect(collection).toBe(first)
    act(() => render(h(Reader, { team: `y` }), container))
    expect(collection).not.toBe(first)
  })

  it(`recompiles a functional query when its queryKey changes`, async () => {
    const source = makeSource(`functional-key`, [
      { id: `a`, team: `x` },
      { id: `b`, team: `y` },
    ])
    let rendered: Array<string> = []
    let collection: unknown
    function Reader({ team }: { team: string }) {
      const result = useLiveQuery({
        queryKey: [`team`, team],
        query: (q) =>
          q.from({ row: source }).fn.where(({ row }) => row.team === team),
      })
      rendered = result.data.map((row) => row.id)
      collection = result.collection
      return null
    }

    const container = mountRoot(h(Reader, { team: `x` }))
    await settle()
    expect(rendered).toEqual([`a`])
    const first = collection

    act(() => render(h(Reader, { team: `x` }), container))
    await settle()
    expect(collection).toBe(first)

    act(() => render(h(Reader, { team: `y` }), container))
    await settle()
    expect(rendered).toEqual([`b`])
    expect(collection).not.toBe(first)
  })

  // A nonempty queryKey owns the identity, so the hook claims no source IDs.
  it(`lets a keyed query swap a source under its ID when the key changes`, async () => {
    const first = makeSource(`keyed-swap`, [{ id: `a`, team: `x` }])
    const replacement = makeSource(`keyed-swap`, [{ id: `b`, team: `x` }])
    let rendered: Array<string> = []
    function Reader({ source }: { source: typeof first }) {
      const result = useLiveQuery({
        queryKey: [`keyed-swap`, source === first ? 1 : 2],
        query: (q) => q.from({ row: source }),
      })
      rendered = result.data.map((row) => row.id)
      return null
    }

    const container = mountRoot(h(Reader, { source: first }))
    await settle()
    expect(rendered).toEqual([`a`])

    act(() => render(h(Reader, { source: replacement }), container))
    await settle()
    expect(rendered).toEqual([`b`])
  })
})
