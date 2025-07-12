"use client"
import React, { useEffect, useRef, useState } from "react"
import {
  initializeDbDevtools,
} from "@tanstack/db-devtools/core"

export interface ReactDbDevtoolsProps {
  // DevTools configuration
  initialIsOpen?: boolean
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "relative"
  panelProps?: Record<string, any>
  closeButtonProps?: Record<string, any>
  toggleButtonProps?: Record<string, any>
  storageKey?: string
  panelState?: "open" | "closed"
  onPanelStateChange?: (isOpen: boolean) => void
  // Additional React-specific props if needed
}

export function ReactDbDevtools(props: ReactDbDevtoolsProps = {}) {
  const [isOpen, setIsOpen] = useState(props.initialIsOpen ?? false)
  const [collections, setCollections] = useState<any[]>([])
  const mountRef = useRef<HTMLDivElement>(null)

  // Initialize devtools on mount
  useEffect(() => {
    initializeDbDevtools()
    
    // Get the registry and start polling for updates
    const registry = (window as any).__TANSTACK_DB_DEVTOOLS__
    if (registry) {
      const updateCollections = () => {
        const metadata = registry.getAllCollectionMetadata()
        setCollections(metadata)
      }
      
      updateCollections()
      const interval = setInterval(updateCollections, 1000)
      
      return () => clearInterval(interval)
    }
  }, [])

  // Handle controlled state
  useEffect(() => {
    if (props.panelState) {
      setIsOpen(props.panelState === "open")
    }
  }, [props.panelState])

  const toggleOpen = () => {
    const newState = !isOpen
    setIsOpen(newState)
    props.onPanelStateChange?.(newState)
  }

  const position = props.position ?? "bottom-right"

  return (
    <>
      {/* Toggle Button */}
      <div
        style={{
          position: position === "relative" ? "relative" : "fixed",
          ...(position.includes("top") ? { top: "12px" } : { bottom: "12px" }),
          ...(position.includes("left") ? { left: "12px" } : { right: "12px" }),
          zIndex: 999999,
        }}
      >
        <button
          type="button"
          onClick={toggleOpen}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0088ff",
            border: "none",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "white",
            fontFamily: "system-ui, sans-serif",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 136, 255, 0.3)",
            transition: "all 0.2s ease",
            ...props.toggleButtonProps?.style,
          }}
          {...props.toggleButtonProps}
        >
          <span style={{ marginRight: "8px" }}>🗄️</span>
          DB ({collections.length})
        </button>
      </div>

      {/* Panel */}
      {isOpen && (
        <ReactDbDevtoolsPanel
          onClose={() => setIsOpen(false)}
          collections={collections}
          {...props.panelProps}
        />
      )}
    </>
  )
}

function ReactDbDevtoolsPanel({ onClose, collections, ...props }: any) {
  const [selectedView, setSelectedView] = useState("collections")
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<string | null>(null)

  const registry = (window as any).__TANSTACK_DB_DEVTOOLS__
  
  const liveQueries = collections.filter((c: any) => c.type === "live-query")
  const regularCollections = collections.filter((c: any) => c.type === "collection")
  const allTransactions = registry ? registry.getTransactions() : []

  const handleCollectionSelect = (id: string) => {
    setSelectedCollection(id)
    setSelectedTransaction(null)
  }

  const handleTransactionSelect = (id: string) => {
    setSelectedTransaction(id)
    setSelectedCollection(null)
  }

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    zIndex: 9999999,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, sans-serif",
  }

  const contentStyle: React.CSSProperties = {
    backgroundColor: "#1a1a1a",
    color: "#e1e1e1",
    width: "90vw",
    height: "90vh",
    borderRadius: "12px",
    boxShadow: "0 20px 40px rgba(0, 0, 0, 0.3)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  }

  return (
    <div
      style={panelStyle}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid #333",
            backgroundColor: "#222",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>🗄️</span>
            <h1 style={{ margin: 0, fontSize: "18px", fontWeight: "600" }}>
              TanStack DB Devtools
            </h1>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "20px",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar */}
          <div
            style={{
              width: "300px",
              borderRight: "1px solid #333",
              backgroundColor: "#1e1e1e",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Tab buttons */}
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid #333",
                backgroundColor: "#222",
              }}
            >
              <button
                onClick={() => setSelectedView("collections")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: selectedView === "collections" ? "#0088ff" : "transparent",
                  border: "none",
                  color: selectedView === "collections" ? "white" : "#888",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Collections
              </button>
              <button
                onClick={() => setSelectedView("transactions")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: selectedView === "transactions" ? "#0088ff" : "transparent",
                  border: "none",
                  color: selectedView === "transactions" ? "white" : "#888",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Transactions ({allTransactions.length})
              </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {selectedView === "collections" && (
                <>
                  {liveQueries.length > 0 && (
                    <>
                      <div style={{ padding: "16px 0 8px 16px" }}>
                        <h3
                          style={{
                            margin: "0 0 8px 0",
                            fontSize: "14px",
                            fontWeight: "600",
                            color: "#888",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          Live Queries ({liveQueries.length})
                        </h3>
                      </div>
                      {liveQueries.map((collection: any) => (
                        <CollectionItem
                          key={collection.id}
                          collection={collection}
                          isSelected={selectedCollection === collection.id}
                          onClick={() => handleCollectionSelect(collection.id)}
                        />
                      ))}
                    </>
                  )}

                  {regularCollections.length > 0 && (
                    <>
                      <div style={{ padding: "16px 0 8px 16px" }}>
                        <h3
                          style={{
                            margin: "0 0 8px 0",
                            fontSize: "14px",
                            fontWeight: "600",
                            color: "#888",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          Collections ({regularCollections.length})
                        </h3>
                      </div>
                      {regularCollections.map((collection: any) => (
                        <CollectionItem
                          key={collection.id}
                          collection={collection}
                          isSelected={selectedCollection === collection.id}
                          onClick={() => handleCollectionSelect(collection.id)}
                        />
                      ))}
                    </>
                  )}

                  {collections.length === 0 && (
                    <div
                      style={{
                        padding: "40px 20px",
                        textAlign: "center",
                        color: "#666",
                        fontStyle: "italic",
                      }}
                    >
                      No collections found. Create a collection to see it here.
                    </div>
                  )}
                </>
              )}

              {selectedView === "transactions" && (
                <TransactionList
                  transactions={allTransactions}
                  selectedTransaction={selectedTransaction}
                  onTransactionSelect={handleTransactionSelect}
                />
              )}
            </div>
          </div>

          {/* Main content */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {selectedCollection ? (
              <CollectionDetails collectionId={selectedCollection} registry={registry} />
            ) : selectedTransaction ? (
              <TransactionDetails transactionId={selectedTransaction} registry={registry} />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                  color: "#666",
                  fontStyle: "italic",
                }}
              >
                {selectedView === "collections"
                  ? "Select a collection to view details"
                  : "Select a transaction to view details"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CollectionItem({ collection, isSelected, onClick }: any) {
  const statusColor = () => {
    switch (collection.status) {
      case "ready":
        return "#22c55e"
      case "loading":
        return "#eab308"
      case "error":
        return "#ef4444"
      case "cleaned-up":
        return "#6b7280"
      default:
        return "#6b7280"
    }
  }

  const statusIcon = () => {
    switch (collection.status) {
      case "ready":
        return "✓"
      case "loading":
        return "⟳"
      case "error":
        return "⚠"
      case "cleaned-up":
        return "🗑"
      default:
        return "○"
    }
  }

  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid #333",
        cursor: "pointer",
        backgroundColor: isSelected ? "#0088ff20" : "transparent",
        borderLeft: isSelected ? "3px solid #0088ff" : "3px solid transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "4px",
        }}
      >
        <div
          style={{
            fontWeight: "500",
            fontSize: "14px",
            color: "#e1e1e1",
          }}
        >
          {collection.type === "live-query" ? "🔄" : "📄"} {collection.id}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            color: statusColor(),
          }}
        >
          <span style={{ fontSize: "12px" }}>{statusIcon()}</span>
        </div>
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "#888",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{collection.size} items</span>
        {collection.hasTransactions && <span>{collection.transactionCount} tx</span>}
      </div>
      {collection.timings && collection.type === "live-query" && (
        <div
          style={{
            fontSize: "11px",
            color: "#666",
            marginTop: "2px",
          }}
        >
          {collection.timings.totalIncrementalRuns} runs
          {collection.timings.averageIncrementalRunTime &&
            `, avg ${collection.timings.averageIncrementalRunTime}ms`}
        </div>
      )}
    </div>
  )
}

function TransactionList({ transactions, selectedTransaction, onTransactionSelect }: any) {
  if (transactions.length === 0) {
    return (
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          color: "#666",
          fontStyle: "italic",
        }}
      >
        No transactions found
      </div>
    )
  }

  return (
    <div>
      {transactions.map((transaction: any) => (
        <div
          key={transaction.id}
          onClick={() => onTransactionSelect(transaction.id)}
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #333",
            cursor: "pointer",
            backgroundColor: selectedTransaction === transaction.id ? "#0088ff20" : "transparent",
            borderLeft: selectedTransaction === transaction.id ? "3px solid #0088ff" : "3px solid transparent",
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>
            Transaction {transaction.id}
          </div>
          <div style={{ fontSize: "12px", color: "#888", display: "flex", justifyContent: "space-between" }}>
            <span>{transaction.state}</span>
            <span>{transaction.mutations.length} mutations</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function CollectionDetails({ collectionId, registry }: any) {
  const [collectionData, setCollectionData] = useState<any[]>([])
  const metadata = registry.getCollectionMetadata(collectionId)

  useEffect(() => {
    if (!registry || !collectionId) return

    const collection = registry.getCollection(collectionId)
    if (collection) {
      setCollectionData(Array.from(collection.values()))
      
      // Subscribe to collection changes
      const unsubscribe = collection.subscribeChanges(
        () => {
          setCollectionData(Array.from(collection.values()))
        },
        { includeInitialState: true }
      )

      return () => {
        unsubscribe?.()
        registry.releaseCollection(collectionId)
      }
    }
  }, [registry, collectionId])

  if (!metadata) {
    return <div style={{ padding: "20px" }}>Collection not found</div>
  }

  return (
    <div style={{ padding: "20px", overflow: "auto" }}>
      <h2 style={{ margin: "0 0 16px 0", fontSize: "18px" }}>
        {metadata.type === "live-query" ? "🔄" : "📄"} {metadata.id}
      </h2>
      
      {/* Metadata */}
      <div style={{ marginBottom: "20px" }}>
        <div><strong>Type:</strong> {metadata.type}</div>
        <div><strong>Status:</strong> {metadata.status}</div>
        <div><strong>Size:</strong> {metadata.size} items</div>
        <div><strong>Transactions:</strong> {metadata.transactionCount}</div>
        <div><strong>Last Updated:</strong> {metadata.lastUpdated.toLocaleString()}</div>
      </div>

      {/* Data */}
      <h3>Data ({collectionData.length} items)</h3>
      <div style={{ maxHeight: "400px", overflow: "auto" }}>
        {collectionData.map((item: any, index: number) => (
          <details key={index} style={{ marginBottom: "8px" }}>
            <summary style={{ cursor: "pointer", padding: "8px", backgroundColor: "#333", borderRadius: "4px" }}>
              Item {index + 1}
            </summary>
            <pre
              style={{
                marginTop: "8px",
                backgroundColor: "#222",
                padding: "12px",
                borderRadius: "4px",
                fontSize: "12px",
                overflow: "auto",
              }}
            >
              {JSON.stringify(item, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  )
}

function TransactionDetails({ transactionId, registry }: any) {
  const transaction = registry.getTransaction(transactionId)

  if (!transaction) {
    return <div style={{ padding: "20px" }}>Transaction not found</div>
  }

  return (
    <div style={{ padding: "20px", overflow: "auto" }}>
      <h2 style={{ margin: "0 0 16px 0", fontSize: "18px" }}>
        Transaction {transaction.id}
      </h2>
      
      <div style={{ marginBottom: "20px" }}>
        <div><strong>Collection:</strong> {transaction.collectionId}</div>
        <div><strong>State:</strong> {transaction.state}</div>
        <div><strong>Created:</strong> {transaction.createdAt.toLocaleString()}</div>
        <div><strong>Updated:</strong> {transaction.updatedAt.toLocaleString()}</div>
        <div><strong>Persisted:</strong> {transaction.isPersisted ? "Yes" : "No"}</div>
      </div>

      <h3>Mutations ({transaction.mutations.length})</h3>
      {transaction.mutations.map((mutation: any, index: number) => (
        <div
          key={index}
          style={{
            marginBottom: "12px",
            padding: "12px",
            backgroundColor: "#333",
            borderRadius: "4px",
          }}
        >
          <div><strong>Type:</strong> {mutation.type}</div>
          <div><strong>Key:</strong> {String(mutation.key)}</div>
          <div><strong>Optimistic:</strong> {mutation.optimistic ? "Yes" : "No"}</div>
          {mutation.changes && (
            <details style={{ marginTop: "8px" }}>
              <summary style={{ cursor: "pointer" }}>Changes</summary>
              <pre
                style={{
                  marginTop: "8px",
                  backgroundColor: "#222",
                  padding: "8px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  overflow: "auto",
                }}
              >
                {JSON.stringify(mutation.changes, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
