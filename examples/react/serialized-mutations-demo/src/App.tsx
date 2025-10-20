import { useState } from "react"
import {
  createCollection,
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
  useSerializedMutations,
} from "@tanstack/react-db"
import type { Transaction } from "@tanstack/react-db"

interface Item {
  id: number
  value: string
  timestamp: number
}

// Create a simple in-memory collection
const itemCollection = createCollection<Item>({
  getKey: (item) => item.id,
})

// Track transaction state for visualization
interface TrackedTransaction {
  id: string
  transaction: Transaction
  state: `pending` | `executing` | `completed` | `failed`
  mutations: Array<{ type: string; value: string }>
  createdAt: number
  completedAt?: number
}

type StrategyType = `debounce` | `queue` | `throttle`

export function App() {
  const [strategyType, setStrategyType] = useState<StrategyType>(`debounce`)
  const [wait, setWait] = useState(1000)
  const [leading, setLeading] = useState(false)
  const [trailing, setTrailing] = useState(true)

  const [transactions, setTransactions] = useState<Array<TrackedTransaction>>(
    []
  )
  const [mutationCounter, setMutationCounter] = useState(0)

  // Create the strategy based on current settings
  const getStrategy = () => {
    if (strategyType === `debounce`) {
      return debounceStrategy({ wait, leading, trailing })
    } else if (strategyType === `queue`) {
      return queueStrategy({ wait })
    } else {
      return throttleStrategy({ wait, leading, trailing })
    }
  }
  const strategy = getStrategy()

  // Create the serialized mutations hook
  const mutate = useSerializedMutations({
    mutationFn: async ({ transaction }) => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Update transaction state to executing when commit starts
      setTransactions((prev) =>
        prev.map((t) => {
          if (t.id === transaction.id) {
            return { ...t, state: `executing` as const }
          }
          return t
        })
      )
    },
    strategy,
  })

  // Trigger a mutation
  const triggerMutation = () => {
    const mutationId = ++mutationCounter
    setMutationCounter(mutationId)

    const tx = mutate(() => {
      itemCollection.insert({
        id: mutationId,
        value: `Mutation ${mutationId}`,
        timestamp: Date.now(),
      })
    })

    // Track this transaction
    const tracked: TrackedTransaction = {
      id: tx.id,
      transaction: tx,
      state: `pending`,
      mutations: [
        {
          type: `insert`,
          value: `Mutation ${mutationId}`,
        },
      ],
      createdAt: Date.now(),
    }

    setTransactions((prev) => [...prev, tracked])

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
      })
      .catch(() => {
        setTransactions((prev) =>
          prev.map((t) => {
            if (t.id === tx.id) {
              return { ...t, state: `failed` as const, completedAt: Date.now() }
            }
            return t
          })
        )
      })
  }

  const clearHistory = () => {
    setTransactions([])
    setMutationCounter(0)
  }

  const pending = transactions.filter((t) => t.state === `pending`)
  const executing = transactions.filter((t) => t.state === `executing`)
  const completed = transactions.filter((t) => t.state === `completed`)

  return (
    <div className="app">
      <h1>Serialized Mutations Demo</h1>
      <p className="subtitle">
        Test different strategies and see how mutations are queued, executed,
        and persisted
      </p>

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

          <div className="action-buttons">
            <button className="btn-primary" onClick={triggerMutation}>
              Trigger Mutation
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                for (let i = 0; i < 5; i++) {
                  setTimeout(triggerMutation, i * 100)
                }
              }}
            >
              Trigger 5 Rapid Mutations
            </button>
            <button className="btn-danger" onClick={clearHistory}>
              Clear History
            </button>
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
                <strong>Queue:</strong> Processes all mutations sequentially
                with {wait}ms between each.
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
              No mutations yet. Click "Trigger Mutation" to start!
            </div>
          ) : (
            <div className="transaction-list">
              {transactions.map((tracked) => (
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
                    Created: {new Date(tracked.createdAt).toLocaleTimeString()}
                    {tracked.completedAt && (
                      <>
                        {` `}• Duration:{` `}
                        {tracked.completedAt - tracked.createdAt}ms
                      </>
                    )}
                  </div>
                  <div className="transaction-mutations">
                    {tracked.mutations.map((mut, idx) => (
                      <div key={idx} className="mutation">
                        <span className="mutation-type">{mut.type}</span>:{` `}
                        {mut.value}
                      </div>
                    ))}
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
