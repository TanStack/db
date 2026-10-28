/**
 * # Which render owns a paced mutation callback?
 *
 * `usePacedMutations` exposes callbacks from the latest committed render. A
 * render that suspends cannot replace callbacks used by the visible component.
 * When a later render commits, its callbacks are available before descendant
 * layout effects. The returned mutate function keeps its identity across that
 * callback-only transition.
 *
 * The model below tracks one fact: the document owned by the latest commit
 * when a transaction is admitted. No exercised history commits another render
 * between admission and persistence, so transaction-admission affinity remains
 * outside this oracle.
 *
 * The bounded history grammar crosses ordinary and StrictMode schedules with
 * calls before a candidate render, after a suspended or committed render, and
 * from a descendant layout effect, with delayed and immediate persistence.
 * Every committed history first suspends B, then releases it. A descendant
 * layout call without a commit is not legal.
 *
 * The production driver renders the public hook, updates a real Collection,
 * and controls the debounce edge. It records optimistic and persistence
 * callbacks without normalizing their order. The refinement check compares
 * the trace and both public rows at the mutation cut, then compares the trace
 * again after persistence. Committed histories also compare mutate identity at
 * the commit cut. This controlled React boundary does not establish server
 * delivery, callback affinity to transaction admission, or other frameworks.
 */
import {
  Fragment,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
  useState,
} from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection, debounceStrategy } from '@tanstack/db'
import { usePacedMutations } from '../src/usePacedMutations'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  mockSyncCollectionOptions,
  resetCleanupQueue,
} from '../../db/tests/utils'
import type { Transaction } from '@tanstack/db'

type DocumentId = `A` | `B`
type Document = { id: DocumentId; text: string }
type Mutate = (text: string) => Transaction<Document>
type CallbackPhase = `optimistic` | `persistence`
type CallbackObservation = {
  phase: CallbackPhase
  owner: DocumentId
  text: string
}
type RenderOutcome = `suspend` | `commit`
type MutationCut = `before-render` | `after-render` | `descendant-layout`
type PersistenceCut = `delayed` | `immediate`
type History = {
  name: string
  outcome: RenderOutcome
  mutationCut: MutationCut
  persistenceCut: PersistenceCut
}
type ExpectedOutcome = {
  trace: Array<CallbackObservation>
  rows: Array<Document>
}

const histories: ReadonlyArray<History> = [
  {
    name: `a mutation admitted before a suspended render`,
    outcome: `suspend`,
    mutationCut: `before-render`,
    persistenceCut: `delayed`,
  },
  {
    name: `a visible mutation invoked after a suspended render`,
    outcome: `suspend`,
    mutationCut: `after-render`,
    persistenceCut: `delayed`,
  },
  {
    name: `a mutation invoked after the next render commits`,
    outcome: `commit`,
    mutationCut: `after-render`,
    persistenceCut: `delayed`,
  },
  {
    name: `a delayed mutation invoked by a descendant layout effect`,
    outcome: `commit`,
    mutationCut: `descendant-layout`,
    persistenceCut: `delayed`,
  },
  {
    name: `an immediate mutation invoked by a descendant layout effect`,
    outcome: `commit`,
    mutationCut: `descendant-layout`,
    persistenceCut: `immediate`,
  },
]

const collections: Array<{ cleanup: () => Promise<void> }> = []
let collectionSequence = 0

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

// Rendering B does not change the committed callback owner. Committing B does.
function expectedOutcome(history: History): ExpectedOutcome {
  const owner =
    history.outcome === `commit` && history.mutationCut !== `before-render`
      ? `B`
      : `A`
  const text = `edited ${owner}`

  return {
    trace: [
      { phase: `optimistic`, owner, text },
      { phase: `persistence`, owner, text },
    ],
    rows: ([`A`, `B`] as const).map((id) => ({
      id,
      text: id === owner ? text : `original ${id}`,
    })),
  }
}

function MutateInLayout({
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

async function driveHistory(history: History, strictMode: boolean) {
  const documents = createCollection(
    mockSyncCollectionOptions<Document>({
      id: `paced-render-cuts-${collectionSequence++}`,
      getKey: (document) => document.id,
      initialData: [
        { id: `A`, text: `original A` },
        { id: `B`, text: `original B` },
      ],
    }),
  )
  collections.push(documents)
  await documents.preload()

  const trace: Array<CallbackObservation> = []
  const committedMutations: Array<Mutate> = []
  let releasePersistence = () => {}
  const heldPersistence = new Promise<void>((resolve) => {
    releasePersistence = resolve
  })
  let candidateRenders = 0
  let readyB = false
  let releaseB = () => {}
  const pendingB = new Promise<void>((resolve) => {
    releaseB = resolve
  })

  function Editor({ documentId }: { documentId: DocumentId }) {
    const mutate = usePacedMutations<string, Document>({
      onMutate: (text) => {
        trace.push({ phase: `optimistic`, owner: documentId, text })
        documents.update(documentId, (draft) => {
          draft.text = text
        })
      },
      mutationFn: ({ transaction }) => {
        trace.push({
          phase: `persistence`,
          owner: documentId,
          text: transaction.mutations[0].modified.text,
        })
        return history.persistenceCut === `immediate`
          ? heldPersistence
          : Promise.resolve()
      },
      strategy: debounceStrategy(
        history.persistenceCut === `immediate`
          ? { wait: 100, leading: true, trailing: false }
          : { wait: 100 },
      ),
    })
    useLayoutEffect(() => {
      committedMutations.push(mutate)
    })
    if (documentId === `B` && !readyB) {
      candidateRenders++
      throw pendingB
    }
    return (
      <>
        <button onClick={() => mutate(`edited ${documentId}`)}>
          Save {documentId}
        </button>
        {history.mutationCut === `descendant-layout` && (
          <MutateInLayout documentId={documentId} mutate={mutate} />
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
  if (history.mutationCut === `before-render`)
    fireEvent.click(view.getByText(`Save A`))

  await act(async () => {
    fireEvent.click(view.getByText(`Open B`))
    await Promise.resolve()
  })
  expect(
    candidateRenders,
    `the candidate render reached suspension`,
  ).toBeGreaterThan(0)

  if (history.outcome === `commit`) {
    await act(async () => {
      readyB = true
      releaseB()
      await Promise.resolve()
    })
    expect(view.getByText(`Save B`)).toBeVisible()
    expect(
      new Set(committedMutations).size,
      `callback-only commit keeps mutate identity`,
    ).toBe(1)
  } else {
    expect(view.getByText(`Save A`)).toBeVisible()
    expect(view.queryByText(`Loading`)).toBeNull()
  }

  if (history.mutationCut === `after-render`) {
    fireEvent.click(
      view.getByText(history.outcome === `commit` ? `Save B` : `Save A`),
    )
  }

  const expected = expectedOutcome(history)
  const expectedAtMutation =
    history.persistenceCut === `immediate`
      ? expected.trace
      : [expected.trace[0]]
  expect(trace, `callback trace at the mutation cut`).toEqual(
    expectedAtMutation,
  )
  expect([documents.get(`A`), documents.get(`B`)]).toMatchObject(expected.rows)

  if (history.persistenceCut === `immediate`) {
    await act(async () => {
      releasePersistence()
      await Promise.resolve()
    })
  }
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(trace, `callback trace after persistence`).toEqual(expected.trace)
}

describe.each([false, true])(
  `paced callback ownership with StrictMode=%s`,
  (strictMode) => {
    it.each(histories)(`models $name`, async (history) => {
      await driveHistory(history, strictMode)
    })
  },
)

declareOracle({ check: [driveHistory], model: [expectedOutcome] })
