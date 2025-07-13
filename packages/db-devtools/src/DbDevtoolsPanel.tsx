/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js"
import { CollectionDetails } from "./components/CollectionDetails"
import { TransactionList } from "./components/TransactionList"
import type {
  CollectionMetadata,
  DbDevtoolsRegistry,
  TransactionDetails,
} from "./types"

interface DbDevtoolsPanelProps {
  onClose: () => void
  collections: Array<CollectionMetadata>
  registry: DbDevtoolsRegistry
  [key: string]: any
}

export function DbDevtoolsPanel(props: DbDevtoolsPanelProps) {
  const [selectedView, setSelectedView] = createSignal<
    `collections` | `transactions`
  >(`collections`)
  const [selectedCollection, setSelectedCollection] = createSignal<
    string | null
  >(null)
  const [selectedTransaction, setSelectedTransaction] = createSignal<
    string | null
  >(null)

  const liveQueries = createMemo(() =>
    props.collections.filter((c) => c.type === `live-query`)
  )

  const regularCollections = createMemo(() =>
    props.collections.filter((c) => c.type === `collection`)
  )

  const allTransactions = createMemo(() => props.registry.getTransactions())

  const handleCollectionSelect = (id: string) => {
    setSelectedCollection(id)
    setSelectedTransaction(null)
  }

  const handleTransactionSelect = (id: string) => {
    setSelectedTransaction(id)
    setSelectedCollection(null)
  }

  const panelStyle = {
    position: `fixed` as const,
    top: `0`,
    left: `0`,
    width: `100vw`,
    height: `100vh`,
    "z-index": 9999999,
    "background-color": `rgba(0, 0, 0, 0.5)`,
    display: `flex`,
    "align-items": `center`,
    "justify-content": `center`,
    "font-family": `system-ui, -apple-system, sans-serif`,
  }

  const contentStyle = {
    "background-color": `#1a1a1a`,
    color: `#e1e1e1`,
    width: `90vw`,
    height: `90vh`,
    "border-radius": `12px`,
    "box-shadow": `0 20px 40px rgba(0, 0, 0, 0.3)`,
    display: `flex`,
    "flex-direction": `column` as const,
    overflow: `hidden`,
  }

  const headerStyle = {
    display: `flex`,
    "align-items": `center`,
    "justify-content": `space-between`,
    padding: `16px 20px`,
    "border-bottom": `1px solid #333`,
    "background-color": `#222`,
  }

  const bodyStyle = {
    display: `flex`,
    flex: `1`,
    overflow: `hidden`,
  }

  const sidebarStyle = {
    width: `300px`,
    "border-right": `1px solid #333`,
    "background-color": `#1e1e1e`,
    display: `flex`,
    "flex-direction": `column` as const,
  }

  const mainStyle = {
    flex: `1`,
    display: `flex`,
    "flex-direction": `column` as const,
    overflow: `hidden`,
  }

  return (
    <div
      style={panelStyle}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div
            style={{ display: `flex`, "align-items": `center`, gap: `12px` }}
          >
            <span style={{ "font-size": `20px` }}>🗄️</span>
            <h1
              style={{ margin: `0`, "font-size": `18px`, "font-weight": `600` }}
            >
              TanStack DB Devtools
            </h1>
          </div>
          <button
            onClick={props.onClose}
            style={{
              background: `none`,
              border: `none`,
              color: `#888`,
              "font-size": `20px`,
              cursor: `pointer`,
              padding: `4px 8px`,
              "border-radius": `4px`,
            }}
          >
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          {/* Sidebar */}
          <div style={sidebarStyle}>
            {/* Tab Navigation */}
            <div
              style={{
                display: `flex`,
                "border-bottom": `1px solid #333`,
                "background-color": `#222`,
              }}
            >
              <button
                onClick={() => setSelectedView(`collections`)}
                style={{
                  flex: `1`,
                  padding: `12px`,
                  background:
                    selectedView() === `collections`
                      ? `#0088ff`
                      : `transparent`,
                  border: `none`,
                  color: selectedView() === `collections` ? `white` : `#888`,
                  cursor: `pointer`,
                  "font-size": `14px`,
                }}
              >
                Collections
              </button>
              <button
                onClick={() => setSelectedView(`transactions`)}
                style={{
                  flex: `1`,
                  padding: `12px`,
                  background:
                    selectedView() === `transactions`
                      ? `#0088ff`
                      : `transparent`,
                  border: `none`,
                  color: selectedView() === `transactions` ? `white` : `#888`,
                  cursor: `pointer`,
                  "font-size": `14px`,
                }}
              >
                Transactions ({allTransactions().length})
              </button>
            </div>

            {/* Content based on selected view */}
            <div style={{ flex: `1`, overflow: `auto` }}>
              <Show when={selectedView() === `collections`}>
                {/* Live Queries Section */}
                <Show when={liveQueries().length > 0}>
                  <div style={{ padding: `16px 0 8px 16px` }}>
                    <h3
                      style={{
                        margin: `0 0 8px 0`,
                        "font-size": `14px`,
                        "font-weight": `600`,
                        color: `#888`,
                        "text-transform": `uppercase`,
                        "letter-spacing": `0.5px`,
                      }}
                    >
                      Live Queries ({liveQueries().length})
                    </h3>
                  </div>
                  <For each={liveQueries()}>
                    {(collection) => (
                      <CollectionItem
                        collection={collection}
                        isSelected={selectedCollection() === collection.id}
                        onClick={() => handleCollectionSelect(collection.id)}
                      />
                    )}
                  </For>
                </Show>

                {/* Regular Collections Section */}
                <Show when={regularCollections().length > 0}>
                  <div style={{ padding: `16px 0 8px 16px` }}>
                    <h3
                      style={{
                        margin: `0 0 8px 0`,
                        "font-size": `14px`,
                        "font-weight": `600`,
                        color: `#888`,
                        "text-transform": `uppercase`,
                        "letter-spacing": `0.5px`,
                      }}
                    >
                      Collections ({regularCollections().length})
                    </h3>
                  </div>
                  <For each={regularCollections()}>
                    {(collection) => (
                      <CollectionItem
                        collection={collection}
                        isSelected={selectedCollection() === collection.id}
                        onClick={() => handleCollectionSelect(collection.id)}
                      />
                    )}
                  </For>
                </Show>

                <Show when={props.collections.length === 0}>
                  <div
                    style={{
                      padding: `40px 20px`,
                      "text-align": `center`,
                      color: `#666`,
                      "font-style": `italic`,
                    }}
                  >
                    No collections found. Create a collection to see it here.
                  </div>
                </Show>
              </Show>

              <Show when={selectedView() === `transactions`}>
                <TransactionList
                  transactions={allTransactions()}
                  selectedTransaction={selectedTransaction()}
                  onTransactionSelect={handleTransactionSelect}
                />
              </Show>
            </div>
          </div>

          {/* Main Content */}
          <div style={mainStyle}>
            <Show
              when={selectedCollection()}
              fallback={
                <Show
                  when={selectedTransaction()}
                  fallback={
                    <div
                      style={{
                        display: `flex`,
                        "align-items": `center`,
                        "justify-content": `center`,
                        flex: `1`,
                        color: `#666`,
                        "font-style": `italic`,
                      }}
                    >
                      {selectedView() === `collections`
                        ? `Select a collection to view details`
                        : `Select a transaction to view details`}
                    </div>
                  }
                >
                  <TransactionDetails
                    transactionId={selectedTransaction()}
                    registry={props.registry}
                  />
                </Show>
              }
            >
              <CollectionDetails
                collectionId={selectedCollection()}
                registry={props.registry}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

// Collection Item Component
function CollectionItem(props: {
  collection: CollectionMetadata
  isSelected: boolean
  onClick: () => void
}) {
  const statusColor = () => {
    switch (props.collection.status) {
      case `ready`:
        return `#22c55e`
      case `loading`:
        return `#eab308`
      case `error`:
        return `#ef4444`
      case `cleaned-up`:
        return `#6b7280`
      default:
        return `#6b7280`
    }
  }

  const statusIcon = () => {
    switch (props.collection.status) {
      case `ready`:
        return `✓`
      case `loading`:
        return `⟳`
      case `error`:
        return `⚠`
      case `cleaned-up`:
        return `🗑`
      default:
        return `○`
    }
  }

  return (
    <div
      onClick={props.onClick}
      style={{
        padding: `12px 16px`,
        "border-bottom": `1px solid #333`,
        cursor: `pointer`,
        "background-color": props.isSelected ? `#0088ff20` : `transparent`,
        "border-left": props.isSelected
          ? `3px solid #0088ff`
          : `3px solid transparent`,
      }}
    >
      <div
        style={{
          display: `flex`,
          "align-items": `center`,
          "justify-content": `space-between`,
          "margin-bottom": `4px`,
        }}
      >
        <div
          style={{
            "font-weight": `500`,
            "font-size": `14px`,
            color: `#e1e1e1`,
          }}
        >
          {props.collection.type === `live-query` ? `🔄` : `📄`}
          {` `}
          {props.collection.id}
        </div>
        <div
          style={{
            display: `flex`,
            "align-items": `center`,
            gap: `4px`,
            color: statusColor(),
          }}
        >
          <span style={{ "font-size": `12px` }}>{statusIcon()}</span>
        </div>
      </div>
      <div
        style={{
          "font-size": `12px`,
          color: `#888`,
          display: `flex`,
          "justify-content": `space-between`,
        }}
      >
        <span>{props.collection.size} items</span>
        <Show when={props.collection.hasTransactions}>
          <span>{props.collection.transactionCount} tx</span>
        </Show>
      </div>
      <Show
        when={
          props.collection.timings && props.collection.type === `live-query`
        }
      >
        <div
          style={{
            "font-size": `11px`,
            color: `#666`,
            "margin-top": `2px`,
          }}
        >
          {props.collection.timings!.totalIncrementalRuns} runs
          <Show when={props.collection.timings!.averageIncrementalRunTime}>
            , avg {props.collection.timings!.averageIncrementalRunTime}ms
          </Show>
        </div>
      </Show>
    </div>
  )
}

// Transaction Details Component
function TransactionDetails(props: {
  transactionId: string
  registry: DbDevtoolsRegistry
}) {
  const transaction = () => props.registry.getTransaction(props.transactionId)

  return (
    <div style={{ padding: `20px`, overflow: `auto` }}>
      <Show when={transaction()} fallback={<div>Transaction not found</div>}>
        {(tx) => (
          <div>
            <h2 style={{ margin: `0 0 16px 0`, "font-size": `18px` }}>
              Transaction {tx().id}
            </h2>
            <div style={{ "margin-bottom": `20px` }}>
              <div>
                <strong>Collection:</strong> {tx().collectionId}
              </div>
              <div>
                <strong>State:</strong> {tx().state}
              </div>
              <div>
                <strong>Created:</strong> {tx().createdAt.toLocaleString()}
              </div>
              <div>
                <strong>Updated:</strong> {tx().updatedAt.toLocaleString()}
              </div>
              <div>
                <strong>Persisted:</strong> {tx().isPersisted ? `Yes` : `No`}
              </div>
            </div>
            <h3>Mutations ({tx().mutations.length})</h3>
            <For each={tx().mutations}>
              {(mutation) => (
                <div
                  style={{
                    "margin-bottom": `12px`,
                    padding: `12px`,
                    "background-color": `#333`,
                    "border-radius": `4px`,
                  }}
                >
                  <div>
                    <strong>Type:</strong> {mutation.type}
                  </div>
                  <div>
                    <strong>Key:</strong> {String(mutation.key)}
                  </div>
                  <div>
                    <strong>Optimistic:</strong>
                    {` `}
                    {mutation.optimistic ? `Yes` : `No`}
                  </div>
                  <Show when={mutation.changes}>
                    <details style={{ "margin-top": `8px` }}>
                      <summary style={{ cursor: `pointer` }}>Changes</summary>
                      <pre
                        style={{
                          "margin-top": `8px`,
                          "background-color": `#222`,
                          padding: `8px`,
                          "border-radius": `4px`,
                          "font-size": `12px`,
                          overflow: `auto`,
                        }}
                      >
                        {JSON.stringify(mutation.changes, null, 2)}
                      </pre>
                    </details>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  )
}
