import { useCallback, useEffect, useMemo, useState } from "react"
import mitt from "mitt"
import {
  createCollection,
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
  useSerializedMutations,
} from "@tanstack/react-db"
import type { PendingMutation, Transaction } from "@tanstack/react-db"

interface Item {
  id: number
  value: number
  timestamp: number
}

// Create event emitter for fake server communication
const serverEmitter = mitt()

// Fake server store - initialize with a single item
const fakeServer = new Map<number, Item>([
  [1, { id: 1, value: 0, timestamp: Date.now() }],
])

// Create a collection with fake sync
const itemCollection = createCollection<Item>({
  id: `items`,
  getKey: (item) => item.id,
  startSync: true,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      // Initial sync - load the initial item from fake server
      begin()
      fakeServer.forEach((item) => {
        write({
          type: `insert`,
          value: item,
        })
      })
      commit()
      markReady()

      // Listen for server updates and sync them back
      // @ts-expect-error mitt typing
      serverEmitter.on(`*`, (_, changes: Array<PendingMutation<Item>>) => {
        begin()
        changes.forEach((change) => {
          if (change.type === `update`) {
            write({
              type: change.type,
              // @ts-expect-error pending mutation type
              value: change.modified,
            })
          } else {
            write({
              type: change.type,
              // @ts-expect-error pending mutation type
              value: change.changes,
            })
          }
        })
        commit()
      })
    },
  },
})

// Track transaction state for visualization
interface TrackedTransaction {
  id: string
  transaction: Transaction
  state: `pending` | `executing` | `completed` | `failed`
  mutations: Array<PendingMutation<Item>>
  createdAt: number
  executingAt?: number
  completedAt?: number
}

type StrategyType = `debounce` | `queue` | `throttle`

export function App() {
  const [strategyType, setStrategyType] = useState<StrategyType>(`debounce`)
  const [wait, setWait] = useState(300)
  const [leading, setLeading] = useState(false)
  const [trailing, setTrailing] = useState(true)

  const [transactions, setTransactions] = useState<Array<TrackedTransaction>>(
    []
  )
  const [optimisticState, setOptimisticState] = useState<Item | null>(null)
  const [syncedState, setSyncedState] = useState<Item>(fakeServer.get(1)!)

  // Initialize optimistic state from collection when ready
  useEffect(() => {
    itemCollection.stateWhenReady().then(() => {
      setOptimisticState(itemCollection.get(1))
    })
  }, [])

  // Create the strategy based on current settings
  // Memoize to prevent recreation on every render
  const strategy = useMemo(() => {
    if (strategyType === `debounce`) {
      return debounceStrategy({ wait, leading, trailing })
    } else if (strategyType === `queue`) {
      return queueStrategy({ wait })
    } else {
      return throttleStrategy({ wait, leading, trailing })
    }
  }, [strategyType, wait, leading, trailing])

  // Memoize mutationFn to prevent recreation on every render
  const mutationFn = useCallback(
    async ({ transaction }: { transaction: Transaction }) => {
      console.log(`mutationFn called with transaction:`, transaction)

      // Update transaction state to executing when commit starts
      const executingAt = Date.now()
      setTransactions((prev) =>
        prev.map((t) => {
          if (t.id === transaction.id) {
            return { ...t, state: `executing` as const, executingAt }
          }
          return t
        })
      )

      // Simulate network delay to fake server (random 100-600ms)
      const delay = Math.random() * 500 + 100
      await new Promise((resolve) => setTimeout(resolve, delay))

      // Write mutations to fake server
      transaction.mutations.forEach((mutation) => {
        console.log(`Processing mutation:`, mutation)
        if (mutation.type === `insert`) {
          const item = mutation.changes as Item
          fakeServer.set(item.id, item)
        } else if (mutation.type === `update`) {
          const item = mutation.modified as Item
          fakeServer.set(item.id, item)
        } else {
          // delete
          fakeServer.delete(mutation.key as number)
        }
      })

      // Update synced state
      setSyncedState(fakeServer.get(1)!)

      console.log(`Emitting sync event`)
      // Sync back from server
      serverEmitter.emit(`sync`, transaction.mutations)
    },
    []
  )

  // Create the serialized mutations hook
  const mutate = useSerializedMutations({
    mutationFn,
    strategy,
  })

  // Trigger a mutation with a specific value
  const triggerMutation = (newValue: number) => {
    const tx = mutate(() => {
      itemCollection.update(1, (draft) => {
        draft.value = newValue
        draft.timestamp = Date.now()
      })
    })

    // Update optimistic state
    setOptimisticState(itemCollection.get(1))

    // Track this transaction
    const tracked: TrackedTransaction = {
      id: tx.id,
      transaction: tx,
      state: `pending`,
      mutations: tx.mutations,
      createdAt: Date.now(),
    }

    setTransactions((prev) => {
      // Only add if this transaction ID isn't already tracked
      if (prev.some((t) => t.id === tx.id)) {
        return prev
      }
      return [...prev, tracked]
    })

    // Listen for completion
    tx.isPersisted.promise
      .then(() => {
        setTransactions((prev) =>
          prev.map((t) => {
            if (t.id === tx.id) {
              return {
                ...t,
                state: `completed` as const,
                completedAt: Date.now(),
              }
            }
            return t
          })
        )
        // Update optimistic state after completion
        setOptimisticState(itemCollection.get(1))
      })
      .catch((error) => {
        console.error(`Transaction failed:`, error)
        setTransactions((prev) =>
          prev.map((t) => {
            if (t.id === tx.id) {
              return { ...t, state: `failed` as const, completedAt: Date.now() }
            }
            return t
          })
        )
        // Update optimistic state after failure
        setOptimisticState(itemCollection.get(1))
      })
  }

  const pending = transactions.filter((t) => t.state === `pending`)
  const executing = transactions.filter((t) => t.state === `executing`)
  const completed = transactions.filter((t) => t.state === `completed`)

  return (
    <div className="app">
      <h1>Serialized Mutations Demo</h1>
      <p className="subtitle">
        Drag the slider to trigger mutations and see how different strategies
        batch, queue, and persist changes
      </p>

      <div className="stats">
        <div className="stat-card">
          <div className="stat-value">{optimisticState?.value ?? 0}</div>
          <div className="stat-label">Optimistic Value</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{syncedState.value}</div>
          <div className="stat-label">Synced Value</div>
        </div>
      </div>

      <div className="stats">
        <div className="stat-card">
          <div className="stat-value">{pending.length}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{executing.length}</div>
          <div className="stat-label">Executing</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{completed.length}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Strategy Configuration</h2>

          <div className="control-group">
            <label>Strategy Type</label>
            <select
              value={strategyType}
              onChange={(e) => setStrategyType(e.target.value as StrategyType)}
            >
              <option value="debounce">Debounce</option>
              <option value="queue">Queue</option>
              <option value="throttle">Throttle</option>
            </select>
          </div>

          <div className="control-group">
            <label>Wait Time (ms)</label>
            <input
              type="number"
              value={wait}
              onChange={(e) => setWait(Number(e.target.value))}
              min={0}
              step={100}
            />
          </div>

          {(strategyType === `debounce` || strategyType === `throttle`) && (
            <>
              <div className="checkbox-group">
                <input
                  type="checkbox"
                  id="leading"
                  checked={leading}
                  onChange={(e) => setLeading(e.target.checked)}
                />
                <label htmlFor="leading">Leading edge execution</label>
              </div>

              <div className="checkbox-group">
                <input
                  type="checkbox"
                  id="trailing"
                  checked={trailing}
                  onChange={(e) => setTrailing(e.target.checked)}
                />
                <label htmlFor="trailing">Trailing edge execution</label>
              </div>
            </>
          )}

          <div className="control-group">
            <label>Slider Value: {optimisticState?.value ?? 0}</label>
            <input
              type="range"
              min={0}
              max={100}
              value={optimisticState?.value ?? 0}
              onChange={(e) => triggerMutation(Number(e.target.value))}
              style={{ width: `100%` }}
            />
            <div
              style={{
                display: `flex`,
                justifyContent: `space-between`,
                fontSize: `12px`,
                color: `#999`,
              }}
            >
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          <div style={{ marginTop: `20px`, fontSize: `13px`, color: `#666` }}>
            <h3 style={{ fontSize: `14px`, marginBottom: `8px` }}>
              Strategy Info:
            </h3>
            {strategyType === `debounce` && (
              <p>
                <strong>Debounce:</strong> Waits for {wait}ms of inactivity
                before persisting.
                {leading && ` Executes immediately on first call.`}
                {trailing && ` Executes after wait period.`}
              </p>
            )}
            {strategyType === `queue` && (
              <p>
                <strong>Queue:</strong> Processes mutations sequentially in
                order received (FIFO) with {wait}ms between each.
              </p>
            )}
            {strategyType === `throttle` && (
              <p>
                <strong>Throttle:</strong> Ensures at least {wait}ms between
                executions.
                {leading && ` Executes immediately on first call.`}
                {trailing && ` Executes after wait period.`}
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Transaction Timeline</h2>

          {transactions.length === 0 ? (
            <div className="empty-state">
              No mutations yet. Drag the slider to start!
            </div>
          ) : (
            <div className="transaction-list">
              {[...transactions].reverse().map((tracked) => (
                <div
                  key={tracked.id}
                  className={`transaction-card ${tracked.state}`}
                >
                  <div className="transaction-header">
                    <span className="transaction-id">
                      ID: {tracked.id.slice(0, 8)}
                    </span>
                    <span className={`transaction-status ${tracked.state}`}>
                      {tracked.state}
                    </span>
                  </div>
                  <div className="transaction-details">
                    <div>
                      Created:{` `}
                      {new Date(tracked.createdAt).toLocaleTimeString()}
                    </div>
                    {tracked.executingAt && (
                      <div>
                        Started Executing:{` `}
                        {new Date(tracked.executingAt).toLocaleTimeString()}
                        {` `}(pending: {tracked.executingAt - tracked.createdAt}
                        ms)
                      </div>
                    )}
                    {tracked.completedAt && (
                      <div>
                        Completed:{` `}
                        {new Date(tracked.completedAt).toLocaleTimeString()}
                        {tracked.executingAt && (
                          <>
                            {` `}(persisting:{` `}
                            {tracked.completedAt - tracked.executingAt}ms)
                          </>
                        )}
                      </div>
                    )}
                    {tracked.completedAt && (
                      <div style={{ fontWeight: `bold`, marginTop: `4px` }}>
                        Total Duration:{` `}
                        {tracked.completedAt - tracked.createdAt}ms
                      </div>
                    )}
                  </div>
                  <div className="transaction-mutations">
                    <div style={{ fontWeight: `bold`, marginBottom: `4px` }}>
                      Mutations ({tracked.mutations.length}):
                    </div>
                    {tracked.mutations.map((mut, idx) => {
                      if (mut.type === `update`) {
                        const item = mut.modified
                        return (
                          <div key={idx} className="mutation">
                            <span className="mutation-type">{mut.type}</span>
                            <>: value = {item.value}</>
                          </div>
                        )
                      }
                      return (
                        <div key={idx} className="mutation">
                          <span className="mutation-type">{mut.type}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
