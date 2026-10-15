import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Fragment,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
  useState,
} from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createCollection, debounceStrategy } from '@tanstack/db'
import { usePacedMutations } from '../src/usePacedMutations'
import {
  mockSyncCollectionOptions,
  resetCleanupQueue,
} from '../../db/tests/utils'
import type { Transaction } from '@tanstack/db'

type DocumentId = `A` | `B`
type Document = { id: DocumentId; text: string }
type Mutate = (text: string) => Transaction<Document>

const collections: Array<{ cleanup: () => Promise<void> }> = []

beforeEach(() => {
  resetCleanupQueue()
  vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
})

afterEach(async () => {
  try {
    cleanup()
    await vi.advanceTimersByTimeAsync(100)
    await Promise.all(
      collections.splice(0).map((collection) => collection.cleanup()),
    )
  } finally {
    resetCleanupQueue()
    vi.useRealTimers()
  }
})

function SaveInLayout({
  documentId,
  mutate,
}: {
  documentId: DocumentId
  mutate: Mutate
}) {
  useLayoutEffect(() => {
    if (documentId === `B`) mutate(`edited B`)
  }, [documentId, mutate])
  return null
}

async function mountEditor(strictMode: boolean, saveInLayout = false) {
  const documents = createCollection(
    mockSyncCollectionOptions<Document>({
      id: `paced-concurrent-documents`,
      getKey: (document) => document.id,
      initialData: [
        { id: `A`, text: `original A` },
        { id: `B`, text: `original B` },
      ],
    }),
  )
  collections.push(documents)
  await documents.preload()
  const persisted = vi.fn<(documentId: DocumentId) => void>()
  const attemptedB = vi.fn()
  const committedMutations: Array<Mutate> = []
  let readyB = false
  let releaseB = () => {}
  const pendingB = new Promise<void>((resolve) => {
    releaseB = resolve
  })

  function Editor({ documentId }: { documentId: DocumentId }) {
    const mutate = usePacedMutations<string, Document>({
      onMutate: (text) => {
        documents.update(documentId, (draft) => {
          draft.text = text
        })
      },
      mutationFn: () => {
        persisted(documentId)
        return Promise.resolve()
      },
      strategy: debounceStrategy({ wait: 100 }),
    })
    useLayoutEffect(() => {
      committedMutations.push(mutate)
    })
    if (documentId === `B` && !readyB) {
      attemptedB()
      throw pendingB
    }
    return (
      <>
        <button onClick={() => mutate(`edited ${documentId}`)}>
          Save {documentId}
        </button>
        {saveInLayout && (
          <SaveInLayout documentId={documentId} mutate={mutate} />
        )}
      </>
    )
  }

  function App() {
    const [documentId, setDocumentId] = useState<DocumentId>(`A`)
    return (
      <>
        <button onClick={() => startTransition(() => setDocumentId(`B`))}>
          Open B
        </button>
        <Suspense fallback={<div>Loading</div>}>
          <Editor documentId={documentId} />
        </Suspense>
      </>
    )
  }

  const view = render(<App />, { wrapper: strictMode ? StrictMode : Fragment })
  return {
    view,
    documents,
    persisted,
    attemptedB,
    committedMutations,
    resolveB: () => {
      readyB = true
      releaseB()
    },
  }
}

// The visible editor owns optimistic writes and pending persistence callbacks.
// A suspended render of another document has not committed those callbacks.
// These receiving tests exercise React's scheduler; core pacing tests cannot
// distinguish a rendered callback from a committed one.
describe.each([false, true])(
  `paced callbacks with StrictMode=%s`,
  (strictMode) => {
    it.each([`before`, `after`] as const)(
      `keeps a mutation queued %s a suspended render on the visible document`,
      async (timing) => {
        const { view, documents, persisted, attemptedB } =
          await mountEditor(strictMode)
        if (timing === `before`) fireEvent.click(view.getByText(`Save A`))

        await act(async () => {
          fireEvent.click(view.getByText(`Open B`))
          await Promise.resolve()
        })
        // Prove that B rendered while the committed editor still belongs to A.
        expect(attemptedB).toHaveBeenCalled()
        expect(view.getByText(`Save A`)).toBeVisible()
        expect(view.queryByText(`Loading`)).toBeNull()
        if (timing === `after`) fireEvent.click(view.getByText(`Save A`))

        expect([documents.get(`A`), documents.get(`B`)]).toMatchObject([
          { id: `A`, text: `edited A` },
          { id: `B`, text: `original B` },
        ])
        expect(persisted).not.toHaveBeenCalled()
        await act(() => vi.advanceTimersByTimeAsync(100))
        expect(persisted).toHaveBeenCalledExactlyOnceWith(`A`)
      },
    )

    it(`refreshes both callbacks after a transition commits without replacing mutate`, async () => {
      const { view, documents, persisted, resolveB, committedMutations } =
        await mountEditor(strictMode)
      await act(async () => {
        fireEvent.click(view.getByText(`Open B`))
        await Promise.resolve()
      })
      await act(async () => {
        resolveB()
        await Promise.resolve()
      })
      expect(view.getByText(`Save B`)).toBeVisible()
      expect(committedMutations.length).toBeGreaterThan(1)
      expect(new Set(committedMutations).size).toBe(1)

      fireEvent.click(view.getByText(`Save B`))
      expect([documents.get(`A`), documents.get(`B`)]).toMatchObject([
        { id: `A`, text: `original A` },
        { id: `B`, text: `edited B` },
      ])
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(persisted).toHaveBeenCalledExactlyOnceWith(`B`)
    })

    it(`refreshes callbacks before a descendant's layout effect mutates`, async () => {
      const { view, documents, persisted, resolveB } = await mountEditor(
        strictMode,
        true,
      )
      await act(async () => {
        fireEvent.click(view.getByText(`Open B`))
        await Promise.resolve()
      })
      await act(async () => {
        resolveB()
        await Promise.resolve()
      })
      expect(view.getByText(`Save B`)).toBeVisible()
      expect([documents.get(`A`), documents.get(`B`)]).toMatchObject([
        { id: `A`, text: `original A` },
        { id: `B`, text: `edited B` },
      ])
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(persisted).toHaveBeenCalledExactlyOnceWith(`B`)
    })
  },
)
