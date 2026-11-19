/**
 * LocalStorage Collections that share a storage key agree with storage: same-
 * tab peers at once, other tabs when their storage events arrive.
 *
 * The LocalStorage guide ("Synchronization") promises:
 *
 * - Two active Collections in one tab that use the same `storage` object and
 *   `storageKey` sync without a browser event. A successful write or
 *   `clearStorage()` updates both public snapshots.
 * - A Collection's pending optimistic rows stay visible until its own
 *   mutations settle. A pending mutation can stay visible through a
 *   `clearStorage()` and later persist.
 * - Each write stores a complete snapshot and preserves rows that other tabs
 *   already wrote, even before their events arrive.
 * - Other tabs see accepted changes when their storage events arrive. The
 *   same-tab mechanism does not connect distinct Storage objects.
 *
 * This property runs every history of up to three actions across three
 * Collections: A and B in one tab, C in another tab over the same bytes. After
 * each action it compares every Collection's public rows and the stored rows
 * with an independent model. At the end, a fresh Collection must restore the
 * stored rows.
 *
 * Keys are the strings a, b, and c and the number 7, so both key encodings
 * cross between tabs ("New writes encode string and number keys with a type
 * prefix"). C can also `reload()`, which must show the stored rows even when
 * no storage event arrived (coverage map, LocalStorage reload witnesses).
 *
 * Write paths. A writes through automatic handlers and holds one update. B
 * writes directly or through manual acceptance (`utils.acceptMutations`). C
 * uses a custom parser and has insert, update, and delete handlers, so its
 * writes take the handler path and the parser's read-back path. Any of the
 * three can call `clearStorage()`.
 *
 * Limits. Values are numbers, so value normalization is not exercised. Only A
 * has a held handler, and at most one write is held at a time. A Collection
 * never writes a key whose presence it disagrees with storage about (a write
 * race between tabs, which the guide says is not atomic). Only C reloads.
 * Startup errors, storage faults, value-normalizing parsers, and cleanup are
 * outside this property.
 */
import { createDeferred } from '../src/deferred'
import { createCollection } from '../src/collection/index'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'
import { createHost } from './local-storage-peer-fixtures'
import { withHistoryCleanup } from './optimistic-history-oracle'
import { oracleProperty, pass, violation } from './oracle-property'

// -- Histories ------------------------------------------------------------------
//
// Tab 1 holds A and B; tab 2 holds C. Stored rows start as a=0 and b=0. An
// action is a direct write by one Collection (update or delete of a stored
// key, or insert of key c), a held update of key a by A that a later action
// accepts or rejects, `clearStorage()` from A, or the delivery of a tab's
// pending storage events. The grammar generates only actions that are legal
// in the model's state: a write needs its key's presence to agree between the
// writer's view and storage, A holds at most one write and writes nothing else
// while it is held, and a delivery needs a pending event.

type Collection = `A` | `B` | `C`
type Key = `a` | `b` | `c` | `7`
type Action =
  | {
      kind: `write`
      by: Collection
      op: `update` | `delete` | `insert`
      key: Key
      manual?: true
    }
  | { kind: `hold` }
  | { kind: `settle`; accept: boolean }
  | { kind: `clear`; by: Collection }
  | { kind: `deliver`; tab: 1 | 2 }
  | { kind: `reload` }
type History = ReadonlyArray<Action>
type Rows = Record<string, number>

const MAX_ACTIONS = 3
const tabOf = (collection: Collection) => (collection === `C` ? 2 : 1)
const valueOf = (step: number, by: Collection) =>
  (step + 1) * 10 + [`A`, `B`, `C`].indexOf(by)

// -- Model ----------------------------------------------------------------------
//
// The model keeps the stored rows, and for each tab the keys that the other
// tab changed since this tab last read storage. A tab reads storage when its
// storage event is delivered and when any of its Collections writes: a write
// picks up every row currently in storage, for every Collection in the
// writing tab (maintainer decision D43, 2026-11-02; the gap report's
// comparison gaps raised the question). A tab's public rows are storage,
// except for stale keys, which may show the value they had when the tab last
// read storage, or the stored value, until the tab reads again.
//
// A's held update overlays A's public rows only, until it settles. While it is
// held, sync transactions that reach A are held too, and they apply in the
// publication that drops A's optimistic state (glossary, "accepted sync
// transaction"). So during the hold, A may show either what it showed when the
// hold began or what it would show otherwise, for every other key. Once the
// held write settles, A agrees with storage again. The driver accepts a write
// that is still held when the history ends, so the model does too before the
// fresh restore.

type Seen = Map<string, Set<number | undefined>>
type State = {
  stored: Rows
  stale: [undefined, Seen, Seen]
  pendingEvents: [undefined, boolean, boolean]
  held: { value: number; frozen: Allowed } | undefined
}

const initialRows: Rows = { a: 0, b: 0 }

function initialState(): State {
  return {
    stored: { ...initialRows },
    stale: [undefined, new Map(), new Map()],
    pendingEvents: [undefined, false, false],
    held: undefined,
  }
}

/** The values a Collection may show, per key. */
type Allowed = Map<string, ReadonlyArray<number | undefined>>

function syncedAllowed(state: State, collection: Collection): Allowed {
  const stale = state.stale[tabOf(collection)]
  const allowed: Allowed = new Map()
  for (const key of [`a`, `b`, `c`, `7`]) {
    const stored = state.stored[key]
    allowed.set(key, stale.has(key) ? [...stale.get(key)!, stored] : [stored])
  }
  return allowed
}

function allowedFor(state: State, collection: Collection): Allowed {
  const allowed = syncedAllowed(state, collection)
  if (collection === `A` && state.held !== undefined) {
    for (const [key, values] of allowed)
      allowed.set(key, [...state.held.frozen.get(key)!, ...values])
    allowed.set(`a`, [state.held.value])
  }
  return allowed
}

/** Whether a Collection's tab may believe a key is present. */
function believed(state: State, collection: Collection, key: string) {
  const stale = state.stale[tabOf(collection)]
  return stale.has(key) ? [...stale.get(key)!][0] : state.stored[key]
}

/**
 * Records that `tab` wrote `key`. The other tab's view of the key is now stale.
 * The writing tab reads storage, so none of its keys is stale (D43).
 */
function changedBy(
  state: State,
  tab: 1 | 2,
  key: string,
  before: number | undefined,
) {
  const other = tab === 1 ? 2 : 1
  const otherStale = state.stale[other]
  if (!otherStale.has(key)) otherStale.set(key, new Set([before]))
  state.stale[tab].clear()
  state.pendingEvents[other] = true
}

function apply(state: State, action: Action, step: number): void {
  if (action.kind === `write`) {
    const before = state.stored[action.key]
    if (action.op === `delete`) delete state.stored[action.key]
    else state.stored[action.key] = valueOf(step, action.by)
    changedBy(state, tabOf(action.by), action.key, before)
  } else if (action.kind === `hold`) {
    state.held = { value: valueOf(step, `A`), frozen: allowedFor(state, `A`) }
  } else if (action.kind === `settle`) {
    const held = state.held!
    state.held = undefined
    if (action.accept) {
      const before = state.stored.a
      state.stored.a = held.value
      changedBy(state, 1, `a`, before)
    }
  } else if (action.kind === `clear`) {
    const tab = tabOf(action.by)
    for (const key of Object.keys(state.stored))
      changedBy(state, tab, key, state.stored[key])
    state.stored = {}
    state.stale[tab].clear()
  } else if (action.kind === `reload`) {
    // A reload reads storage; a pending event, once delivered, changes nothing.
    state.stale[2].clear()
  } else {
    state.stale[action.tab].clear()
    state.pendingEvents[action.tab] = false
  }
}

function legalActions(state: State): Array<Action> {
  const actions: Array<Action> = []
  for (const by of [`A`, `B`, `C`] as const) {
    if (by === `A` && state.held !== undefined) continue
    for (const key of [`a`, `b`, `c`, `7`] as const) {
      // The writer's view and storage must agree on the key's presence.
      const seen = believed(state, by, key) !== undefined
      const stored = state.stored[key] !== undefined
      if (seen !== stored) continue
      const ops = stored
        ? ([`update`, `delete`] as const)
        : key === `c` || key === `7`
          ? ([`insert`] as const)
          : []
      for (const op of ops) {
        actions.push({ kind: `write`, by, op, key })
        if (by === `B`)
          actions.push({ kind: `write`, by, op, key, manual: true })
      }
    }
  }
  if (
    state.held === undefined &&
    state.stored.a !== undefined &&
    believed(state, `A`, `a`) !== undefined
  )
    actions.push({ kind: `hold` })
  if (state.held !== undefined) {
    actions.push({ kind: `settle`, accept: true })
    actions.push({ kind: `settle`, accept: false })
  }
  for (const by of [`A`, `B`, `C`] as const) actions.push({ kind: `clear`, by })
  actions.push({ kind: `reload` })
  for (const tab of [1, 2] as const)
    if (state.pendingEvents[tab]) actions.push({ kind: `deliver`, tab })
  return actions
}

function enumerate(): Array<History> {
  const histories: Array<History> = []
  const extend = (history: Array<Action>) => {
    if (history.length > 0) histories.push(history)
    if (history.length === MAX_ACTIONS) return
    const state = initialState()
    history.forEach((action, step) => apply(state, action, step))
    for (const action of legalActions(state)) extend([...history, action])
  }
  extend([])
  return histories
}

/** The allowed observations after each action, and the rows a restore must show. */
function expectedResult(history: History) {
  const state = initialState()
  const steps = history.map((action, step) => {
    apply(state, action, step)
    return {
      A: allowedFor(state, `A`),
      B: allowedFor(state, `B`),
      C: allowedFor(state, `C`),
      stored: { ...state.stored },
    }
  })
  if (state.held !== undefined)
    apply(state, { kind: `settle`, accept: true }, history.length)
  return { steps, restored: { ...state.stored } }
}

// -- Production driver ------------------------------------------------------------
//
// Two hosts over one byte map are two tabs of one origin (peer fixtures). A
// write by one tab queues a storage event for the other tab; the history
// decides when it is delivered. A's update handler holds only the held write.
// After each action the driver waits for that action's receipts to settle and
// for the event loop to drain, then records every Collection's public rows and
// the stored rows. It records; it does not judge.

const rowsOf = (
  values: Iterable<{ id: string | number; value: number }>,
): Rows =>
  Object.fromEntries([...values].map((row) => [String(row.id), row.value]))

async function drive(
  history: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const data = new Map<string, string>()
  data.set(
    `rows`,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(initialRows).map(([id, value]) => [
          `s:${id}`,
          { versionKey: `initial-${id}`, data: { id, value } },
        ]),
      ),
    ),
  )
  const hosts = [createHost(data), createHost(data)] as const
  const pending = [false, false]
  // A write through one tab's Storage object is an event for the other tab.
  hosts.forEach((host, index) => {
    const { setItem, removeItem } = host.storage
    host.storage.setItem = (key, value) => {
      setItem(key, value)
      pending[1 - index] = true
    }
    host.storage.removeItem = (key) => {
      removeItem(key)
      pending[1 - index] = true
    }
  })
  let gate: ReturnType<typeof createDeferred<void>> | undefined
  let holdNext = false
  // A holds its next update when asked. C's handlers finish at once, and C's
  // parser is a custom object, so C takes the handler and read-back paths.
  const holdingUpdate = async () => {
    if (!holdNext) return
    holdNext = false
    await gate!.promise
  }
  const parser = { parse: JSON.parse, stringify: JSON.stringify }
  const make = (
    host: (typeof hosts)[number],
    id: string,
    kind: `holding` | `plain` | `handled`,
  ) =>
    createCollection(
      localStorageCollectionOptions<{ id: string | number; value: number }>({
        id,
        storageKey: `rows`,
        storage: host.storage,
        storageEventApi: host.events,
        getKey: (row) => row.id,
        ...(kind === `holding` ? { onUpdate: holdingUpdate } : {}),
        ...(kind === `handled`
          ? {
              parser,
              onInsert: async () => {},
              onUpdate: async () => {},
              onDelete: async () => {},
            }
          : {}),
      }),
    )
  const collections = {
    A: make(hosts[0], `A`, `holding`),
    B: make(hosts[0], `B`, `plain`),
    C: make(hosts[1], `C`, `handled`),
  }
  let restored: ReturnType<typeof make> | undefined
  let heldReceipt: Promise<unknown> | undefined
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0))
  await withHistoryCleanup(
    async () => {
      await Promise.all(Object.values(collections).map((c) => c.preload()))
      for (const [step, action] of history.entries()) {
        if (action.kind === `write`) {
          const collection = collections[action.by]
          const value = valueOf(step, action.by)
          // Key 7 is the number 7, so it takes the numeric key encoding.
          const id = action.key === `7` ? 7 : action.key
          const write = () =>
            action.op === `insert`
              ? collection.insert({ id, value })
              : action.op === `update`
                ? collection.update(id, (draft) => {
                    draft.value = value
                  })
                : collection.delete(id)
          if (action.manual) {
            const transaction = createTransaction({
              autoCommit: false,
              mutationFn: ({ transaction: accepted }) =>
                collection.utils.acceptMutations(accepted),
            })
            transaction.mutate(write)
            await transaction.commit().catch(() => undefined)
          } else
            await write()
              .when(`settled`)
              .catch(() => undefined)
        } else if (action.kind === `hold`) {
          gate = createDeferred<void>()
          holdNext = true
          const transaction = collections.A.update(`a`, (draft) => {
            draft.value = valueOf(step, `A`)
          })
          heldReceipt = transaction.when(`settled`).catch(() => undefined)
        } else if (action.kind === `settle`) {
          if (action.accept) gate!.resolve()
          else gate!.reject(new Error(`held write rejected`))
          await heldReceipt
        } else if (action.kind === `clear`) {
          collections[action.by].utils.clearStorage()
        } else if (action.kind === `reload`) {
          await collections.C.reload()
        } else {
          const index = action.tab - 1
          if (pending[index]) {
            pending[index] = false
            hosts[index]!.deliver(`rows`)
          }
        }
        await drain()
        const raw = data.get(`rows`)
        observe(`after action ${step + 1}`, {
          A: rowsOf(collections.A.values()),
          B: rowsOf(collections.B.values()),
          C: rowsOf(collections.C.values()),
          stored:
            raw === undefined
              ? {}
              : rowsOf(
                  Object.values(
                    JSON.parse(raw) as Record<
                      string,
                      { data: { id: string; value: number } }
                    >,
                  ).map(({ data: row }) => row),
                ),
        })
      }
      gate?.resolve()
      await heldReceipt
      restored = make(createHost(data), `restored`, `plain`)
      await restored.preload()
      observe(`fresh restore`, rowsOf(restored.values()))
    },
    () => [
      () => gate?.resolve(),
      () => restored?.cleanup(),
      ...Object.values(collections).map((c) => () => c.cleanup()),
    ],
  )
}

// -- Check ------------------------------------------------------------------------
//
// After each action, stored rows must equal the model exactly, and each
// Collection's public value for each key must be one the model allows. At the
// end, a fresh Collection restores the stored rows.

function checkHistory(
  history: History,
  observations: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  expected: ReturnType<typeof expectedResult>,
) {
  const json = (value: unknown) => JSON.stringify(value)
  for (const [step, allowed] of expected.steps.entries()) {
    const checkpoint = `after action ${step + 1}`
    const observed = observations.find(
      (entry) => entry.checkpoint === checkpoint,
    )?.value as Record<`A` | `B` | `C` | `stored`, Rows> | undefined
    if (observed === undefined)
      return violation(checkpoint, `the driver recorded no observation`)
    if (json(sortKeys(observed.stored)) !== json(sortKeys(allowed.stored)))
      return violation(
        checkpoint,
        `stored ${json(observed.stored)}, expected ${json(allowed.stored)}`,
        undefined,
        { actual: observed.stored, expected: allowed.stored },
      )
    for (const collection of [`A`, `B`, `C`] as const) {
      const rows = observed[collection]
      for (const [key, values] of allowed[collection]) {
        if (!values.includes(rows[key]))
          return violation(
            checkpoint,
            `${collection} shows ${key}=${rows[key]}, allowed ${json(values.map((v) => v ?? `absent`))} (stored ${json(observed.stored)})`,
          )
      }
      for (const key of Object.keys(rows))
        if (!allowed[collection].has(key))
          return violation(checkpoint, `${collection} shows unknown key ${key}`)
    }
  }
  const restored = observations.find(
    (entry) => entry.checkpoint === `fresh restore`,
  )
  if (restored === undefined)
    return violation(`fresh restore`, `the driver recorded no restore`)
  if (
    json(sortKeys(restored.value as Rows)) !== json(sortKeys(expected.restored))
  )
    return violation(
      `fresh restore`,
      `restored ${json(restored.value)}, expected ${json(expected.restored)}`,
      undefined,
      { actual: restored.value, expected: expected.restored },
    )
  return pass
}

function sortKeys(rows: Rows): Rows {
  return Object.fromEntries(
    Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)),
  )
}

const describeAction = (action: Action) => {
  if (action.kind === `write`)
    return `${action.by}:${action.manual ? `manual-` : ``}${action.op[0]}${action.key}`
  if (action.kind === `clear`) return `${action.by}:clear`
  if (action.kind === `reload`) return `C:reload`
  if (action.kind === `settle`) return action.accept ? `accept` : `reject`
  if (action.kind === `deliver`) return `deliver${action.tab}`
  return action.kind
}

// What this oracle owns: the gap report judges every function in
// src/local-storage.ts by this file's generated same-tab and cross-tab peer
// histories.

oracleProperty({
  id: `local-storage.peers`,
  law: {
    statement: `Collections sharing a LocalStorage key agree with storage: stored rows follow each write applied to the current snapshot; same-tab peers show stored rows once a write or clearStorage() settles, except their own pending optimistic rows; a write makes every Collection in its tab read storage; another tab shows a row the first tab changed once its storage event arrives.`,
    authority: `LocalStorage guide, "Synchronization" (same-tab peers, pending optimistic rows, clearStorage, preserved peer rows, storage events); glossary "accepted sync transaction" (held while an optimistic transaction persists); maintainer decision D43, 2026-11-02 (a write reads storage for its tab)`,
    limits: `Up to three actions; numeric values; one held write by A; automatic, manual, handler, and custom-parser write paths and clearStorage() from any Collection; no write races, startup errors, storage faults, reload, or cleanup.`,
  },
  owns: [`src/local-storage.ts`],
  histories: enumerate(),
  label: (history) => history.map(describeAction).join(` `),
  model: expectedResult,
  driver: drive,
  check: checkHistory,
})
