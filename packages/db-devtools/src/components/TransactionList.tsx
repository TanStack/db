import { For, Show } from "solid-js"
import type { TransactionDetails } from "../types"

interface TransactionListProps {
  transactions: Array<TransactionDetails>
  selectedTransaction: string | null
  onTransactionSelect: (id: string) => void
}

export function TransactionList(props: TransactionListProps) {
  const getStateColor = (state: string) => {
    switch (state) {
      case `completed`:
        return `#22c55e`
      case `failed`:
        return `#ef4444`
      case `persisting`:
        return `#eab308`
      case `pending`:
        return `#3b82f6`
      default:
        return `#6b7280`
    }
  }

  const getStateIcon = (state: string) => {
    switch (state) {
      case `completed`:
        return `✓`
      case `failed`:
        return `✗`
      case `persisting`:
        return `⟳`
      case `pending`:
        return `○`
      default:
        return `?`
    }
  }

  return (
    <div style={{ overflow: `auto`, height: `100%` }}>
      <Show
        when={props.transactions.length === 0}
        fallback={
          <For each={props.transactions}>
            {(transaction) => (
              <div
                onClick={() => props.onTransactionSelect(transaction.id)}
                style={{
                  padding: `12px 16px`,
                  "border-bottom": `1px solid #333`,
                  cursor: `pointer`,
                  "background-color":
                    props.selectedTransaction === transaction.id
                      ? `#0088ff20`
                      : `transparent`,
                  "border-left":
                    props.selectedTransaction === transaction.id
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
                    {transaction.id.slice(0, 8)}...
                  </div>
                  <div
                    style={{
                      display: `flex`,
                      "align-items": `center`,
                      gap: `4px`,
                      color: getStateColor(transaction.state),
                    }}
                  >
                    <span style={{ "font-size": `12px` }}>
                      {getStateIcon(transaction.state)}
                    </span>
                    <span
                      style={{
                        "font-size": `12px`,
                        "text-transform": `capitalize`,
                      }}
                    >
                      {transaction.state}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    "font-size": `12px`,
                    color: `#888`,
                    display: `flex`,
                    "justify-content": `space-between`,
                    "align-items": `center`,
                  }}
                >
                  <span>{transaction.collectionId}</span>
                  <span>{transaction.mutations.length} mutations</span>
                </div>
                <div
                  style={{
                    "font-size": `11px`,
                    color: `#666`,
                    "margin-top": `4px`,
                  }}
                >
                  {new Date(transaction.createdAt).toLocaleString()}
                </div>
              </div>
            )}
          </For>
        }
      >
        <div
          style={{
            padding: `40px 20px`,
            "text-align": `center`,
            color: `#666`,
            "font-style": `italic`,
          }}
        >
          No transactions found
        </div>
      </Show>
    </div>
  )
}
