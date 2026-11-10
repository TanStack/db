import { QueryClient, QueryObserver, hashKey } from '@tanstack/query-core'
import { expect, it } from 'vitest'
import { findQueuedAnswerPremise } from '../../../scripts/h02-progress/witness-premise.js'
import type {
  AnswerFact,
  PendingFact,
  QueryFact,
} from '../../../scripts/h02-progress/witness-premise.js'

// Ordinary instrument calibrations. Expected facts come from authored receipts
// or actual Query Core state, never from DB production or its product oracle.
function fixture() {
  const old = {}
  const fresh = {}
  const pending: PendingFact = {
    identity: old,
    atom: `old`,
    key: [`base`, 2, [3]],
    keys: [3],
    owner: 2,
    startCount: 1,
    pending: true,
    aborted: false,
  }
  const current: QueryFact = {
    ...pending,
    status: `success`,
    fetchStatus: `fetching`,
    dataUpdateCount: 1,
    rows: [3],
  }
  const sibling: QueryFact = {
    identity: fresh,
    atom: `fresh`,
    key: [`base`, 1, [3]],
    keys: [3],
    owner: 1,
    status: `success`,
    fetchStatus: `idle`,
    dataUpdateCount: 1,
    rows: [],
  }
  const cached: AnswerFact = {
    ...pending,
    startCount: 0,
    version: 1,
    backendVersion: 0,
    rows: [3],
    installedCount: 1,
  }
  const answer: AnswerFact = {
    ...sibling,
    version: 2,
    backendVersion: 1,
    rows: [],
    startCount: 0,
  }
  return { pending, current, sibling, cached, answer }
}

it(`requires real pending, physical current query, exact scope and installed answer facts`, () => {
  const good = fixture()
  const find = (f: ReturnType<typeof fixture>) =>
    findQueuedAnswerPremise(
      3,
      [f.pending],
      [f.current, f.sibling],
      [f.answer],
      [f.cached],
    )
  expect(find(good)?.request).toBe(good.pending)
  const controls: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.pending.pending = false
    },
    (f) => {
      f.pending.aborted = true
    },
    (f) => {
      f.pending.identity = {}
    },
    (f) => {
      f.current.identity = {}
    },
    (f) => {
      f.answer.identity = {}
    },
    (f) => {
      f.cached.identity = {}
    },
    (f) => {
      f.pending.key = [`wrong`]
    },
    (f) => {
      f.answer.key = [`wrong`]
    },
    (f) => {
      f.pending.owner = undefined
    },
    (f) => {
      f.sibling.owner = 2
    },
    (f) => {
      f.current.keys = [4]
    },
    (f) => {
      f.sibling.keys = [4]
    },
    (f) => {
      f.current.status = `pending`
    },
    (f) => {
      f.current.fetchStatus = `idle`
    },
    (f) => {
      f.current.dataUpdateCount = 2
    },
    (f) => {
      f.cached.installedCount = 0
    },
    (f) => {
      f.cached.startCount = 1
    },
    (f) => {
      f.cached.backendVersion = 1
    },
    (f) => {
      f.cached.rows = []
    },
    (f) => {
      f.sibling.status = `pending`
    },
    (f) => {
      f.sibling.dataUpdateCount = 0
    },
    (f) => {
      f.answer.startCount = 1
    },
    (f) => {
      f.answer.backendVersion = 0
    },
    (f) => {
      f.answer.rows = [3]
    },
    (f) => {
      f.sibling.rows = [3]
    },
  ]
  for (const control of controls) {
    const f = fixture()
    control(f)
    expect(find(f)).toBeUndefined()
  }
  expect(
    findQueuedAnswerPremise(
      3,
      [],
      [good.current, good.sibling],
      [good.answer],
      [good.cached],
    ),
  ).toBeUndefined()
  expect(
    findQueuedAnswerPremise(
      3,
      [good.pending],
      [good.current, good.sibling],
      [],
      [good.cached],
    ),
  ).toBeUndefined()
  expect(
    findQueuedAnswerPremise(
      3,
      [good.pending],
      [good.current, good.sibling],
      [good.answer],
      [],
    ),
  ).toBeUndefined()
  expect(
    findQueuedAnswerPremise(
      3,
      [good.pending],
      [good.current],
      [good.answer],
      [good.cached],
    ),
  ).toBeUndefined()
})

it(`sees actual installed success inside an observer before the cache success reporter`, async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const oldKey = [`base`, 2, [3]]
  const freshKey = [`base`, 1, [3]]
  await client.fetchQuery({ queryKey: oldKey, queryFn: () => [{ id: 3 }] })
  const old = client.getQueryCache().find({ queryKey: oldKey, exact: true })!
  const cached: AnswerFact = {
    identity: old,
    atom: hashKey(oldKey),
    key: oldKey,
    keys: [3],
    owner: 2,
    startCount: 0,
    installedCount: old.state.dataUpdateCount,
    version: 1,
    backendVersion: 0,
    rows: [3],
  }
  let releaseOld: (() => void) | undefined
  const held = client.fetchQuery({
    queryKey: oldKey,
    queryFn: () =>
      new Promise<Array<{ id: number }>>((resolve) => {
        releaseOld = () => resolve([])
      }),
  })
  const pending: PendingFact = {
    ...cached,
    startCount: old.state.dataUpdateCount,
    pending: true,
    aborted: false,
  }
  let reported = false
  let observed = false
  let completed: AnswerFact | undefined
  const delayedMirror: Array<AnswerFact> = [cached]
  const unsubscribeCache = client.getQueryCache().subscribe((event) => {
    if (
      event.type === `updated` &&
      event.action.type === `success` &&
      event.query.queryHash === hashKey(freshKey)
    ) {
      reported = true
      delayedMirror.push({
        ...completed!,
        installedCount: event.query.state.dataUpdateCount,
      })
    }
  })
  const observer = new QueryObserver(client, {
    queryKey: freshKey,
    enabled: false,
  })
  const unsubscribe = observer.subscribe((result) => {
    if (result.status !== `success`) return
    const fresh = client
      .getQueryCache()
      .find({ queryKey: freshKey, exact: true })!
    const current: QueryFact = {
      ...pending,
      status: old.state.status,
      fetchStatus: old.state.fetchStatus,
      dataUpdateCount: old.state.dataUpdateCount,
      rows: (old.state.data as Array<{ id: number }>).map(({ id }) => id),
    }
    const sibling: QueryFact = {
      ...completed!,
      status: fresh.state.status,
      fetchStatus: fresh.state.fetchStatus,
      dataUpdateCount: fresh.state.dataUpdateCount,
      rows: (fresh.state.data as Array<{ id: number }>).map(({ id }) => id),
    }
    expect(reported).toBe(false)
    // The old delayed mirror has no empty success yet: preserve its false-negative.
    expect(
      delayedMirror.find(
        (answer) => answer.backendVersion === 1 && answer.rows.length === 0,
      ),
    ).toBeUndefined()
    expect(
      findQueuedAnswerPremise(
        3,
        [pending],
        [current, sibling],
        [completed!],
        [cached],
      )?.answer,
    ).toBe(completed)
    observed = true
  })
  try {
    await client.fetchQuery({
      queryKey: freshKey,
      queryFn: () => {
        const fresh = client
          .getQueryCache()
          .find({ queryKey: freshKey, exact: true })!
        completed = {
          identity: fresh,
          atom: hashKey(freshKey),
          key: freshKey,
          keys: [3],
          owner: 1,
          startCount: fresh.state.dataUpdateCount,
          version: 2,
          backendVersion: 1,
          rows: [],
        }
        return []
      },
    })
    expect(observed).toBe(true)
    expect(reported).toBe(true)
    expect(
      delayedMirror.some(
        (answer) => answer.backendVersion === 1 && answer.rows.length === 0,
      ),
    ).toBe(true)
  } finally {
    pending.pending = false
    releaseOld?.()
    await held
    unsubscribe()
    unsubscribeCache()
    client.clear()
  }
})
