import React, { useEffect, useState, useRef } from "react"
import type { OfflineTransaction } from "@tanstack/offline-transactions"

interface DevToolsProps {
  offline: any
  title: string
}

interface LogEntry {
  id: string
  timestamp: number
  type: 'click' | 'mutation' | 'api-get' | 'api-post' | 'api-put' | 'api-delete' | 'transaction-created' | 'transaction-committed' | 'transaction-completed' | 'transaction-failed' | 'outbox-update'
  data: any
  context?: {
    pendingTransactions: number
    runningTransactions: number
    outboxSize: number
    isOfflineEnabled: boolean
  }
}

interface TransactionState {
  id: string
  status: 'created' | 'committed' | 'pending' | 'running' | 'completed' | 'failed'
  mutations: any[]
  createdAt: Date
  retryCount: number
  error?: string
  lastUpdated: number
}

export function DevTools({ offline, title }: DevToolsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [transactions, setTransactions] = useState<TransactionState[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [view, setView] = useState<'split' | 'timeline'>('split')
  const logIdCounter = useRef(0)

  const currentOutboxSizeRef = useRef(0)

  const addLog = (type: LogEntry['type'], data: any, includeContext = true) => {
    const context = includeContext && offline ? {
      pendingTransactions: offline.getPendingCount ? offline.getPendingCount() : 0,
      runningTransactions: offline.getRunningCount ? offline.getRunningCount() : 0,
      outboxSize: currentOutboxSizeRef.current,
      isOfflineEnabled: offline.isOfflineEnabled || false
    } : undefined

    const entry: LogEntry = {
      id: `log-${++logIdCounter.current}`,
      timestamp: Date.now(),
      type,
      data,
      context
    }
    setLogs(prev => [entry, ...prev].slice(0, 200)) // Keep last 200 entries
  }

  // Monitor transaction state
  useEffect(() => {
    if (!offline) return

    let lastOutboxSize = 0
    let lastPendingCount = 0
    let lastRunningCount = 0

    const interval = setInterval(async () => {
      try {
        const outboxEntries = await offline.peekOutbox()
        const pendingCount = offline.getPendingCount ? offline.getPendingCount() : 0
        const runningCount = offline.getRunningCount ? offline.getRunningCount() : 0

        // Update context for future log entries
        const currentOutboxSize = outboxEntries.length
        currentOutboxSizeRef.current = currentOutboxSize

        setTransactions(outboxEntries.map((tx: OfflineTransaction) => ({
          id: tx.id,
          status: 'pending' as const,
          mutations: tx.mutations || [],
          createdAt: tx.createdAt,
          retryCount: tx.retryCount || 0,
          lastUpdated: Date.now()
        })))

        // Log significant state changes
        if (currentOutboxSize !== lastOutboxSize || pendingCount !== lastPendingCount || runningCount !== lastRunningCount) {
          addLog('outbox-update', {
            outboxSize: currentOutboxSize,
            pending: pendingCount,
            running: runningCount,
            changes: {
              outboxSizeDelta: currentOutboxSize - lastOutboxSize,
              pendingDelta: pendingCount - lastPendingCount,
              runningDelta: runningCount - lastRunningCount
            }
          }, false) // Don't include context to avoid recursion

          lastOutboxSize = currentOutboxSize
          lastPendingCount = pendingCount
          lastRunningCount = runningCount
        }
      } catch (error) {
        console.error('DevTools transaction monitoring error:', error)
        addLog('transaction-failed', { error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }, 100) // More frequent polling for better precision

    return () => clearInterval(interval)
  }, [offline])

  // Intercept fetch calls for API monitoring
  useEffect(() => {
    const originalFetch = window.fetch

    window.fetch = async (...args) => {
      const [url, options = {}] = args
      const method = options.method || 'GET'

      if (typeof url === 'string' && url.includes('/api/todos')) {
        const startTime = Date.now()

        try {
          const response = await originalFetch(...args)
          const duration = Date.now() - startTime

          addLog(`api-${method.toLowerCase()}` as LogEntry['type'], {
            url,
            method,
            status: response.status,
            duration,
            ok: response.ok,
            body: options.body ? JSON.parse(options.body as string) : null
          })

          return response
        } catch (error) {
          addLog(`api-${method.toLowerCase()}` as LogEntry['type'], {
            url,
            method,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: Date.now() - startTime
          })
          throw error
        }
      }

      return originalFetch(...args)
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  // Expose global functions for todo components to call
  useEffect(() => {
    const devTools = {
      logClick: (action: string, data: any) => {
        addLog('click', { action, data, component: 'TodoDemo' })
      },
      logMutation: (action: string, data: any) => {
        addLog('mutation', { action, data })
      },
      logTransactionCreated: (transactionId: string, mutationFnName: string, data: any) => {
        addLog('transaction-created', {
          transactionId: transactionId.slice(0, 8),
          mutationFnName,
          ...data
        })
      },
      logTransactionCommitted: (transactionId: string, data: any) => {
        addLog('transaction-committed', {
          transactionId: transactionId.slice(0, 8),
          ...data
        })
      },
      logTransactionCompleted: (transactionId: string, result: any) => {
        addLog('transaction-completed', {
          transactionId: transactionId.slice(0, 8),
          result
        })
      },
      logTransactionFailed: (transactionId: string, error: any) => {
        addLog('transaction-failed', {
          transactionId: transactionId.slice(0, 8),
          error: error instanceof Error ? error.message : error
        })
      }
    }

    ;(window as any).__devTools = devTools

    return () => {
      delete (window as any).__devTools
    }
  }, [addLog])

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true
    if (filter === 'api') return log.type.startsWith('api-')
    if (filter === 'transaction') return log.type.startsWith('transaction-') || log.type === 'outbox-update'
    return log.type === filter
  })

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  }

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'click': return 'text-blue-600'
      case 'mutation': return 'text-purple-600'
      case 'api-get': return 'text-green-600'
      case 'api-post': return 'text-orange-600'
      case 'api-put': return 'text-yellow-600'
      case 'api-delete': return 'text-red-600'
      case 'transaction-created': return 'text-indigo-600'
      case 'transaction-committed': return 'text-blue-700'
      case 'transaction-completed': return 'text-green-700'
      case 'transaction-failed': return 'text-red-700'
      case 'outbox-update': return 'text-gray-600'
      default: return 'text-gray-600'
    }
  }

  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-gray-700 flex items-center gap-2"
        >
          <span className="text-xs">🔧</span>
          <span className="text-sm">DevTools ({logs.length})</span>
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-300 shadow-lg z-50" style={{ height: '40vh' }}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b">
          <div className="flex items-center gap-4">
            <h3 className="font-bold text-gray-800">DevTools - {title}</h3>
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 bg-blue-100 rounded">
                Transactions: {transactions.length}
              </span>
              <span className="px-2 py-1 bg-green-100 rounded">
                Logs: {logs.length}
              </span>
              <span className={`px-2 py-1 rounded ${offline?.isOfflineEnabled ? 'bg-blue-100' : 'bg-gray-100'}`}>
                Mode: {offline?.isOfflineEnabled ? 'Offline' : 'Online-only'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-gray-200 rounded text-xs">
              <button
                onClick={() => setView('split')}
                className={`px-2 py-1 rounded-l ${view === 'split' ? 'bg-blue-500 text-white' : 'text-gray-700 hover:bg-gray-300'}`}
              >
                Split
              </button>
              <button
                onClick={() => setView('timeline')}
                className={`px-2 py-1 rounded-r ${view === 'timeline' ? 'bg-blue-500 text-white' : 'text-gray-700 hover:bg-gray-300'}`}
              >
                Timeline
              </button>
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs border rounded px-2 py-1"
            >
              <option value="all">All Logs</option>
              <option value="click">Clicks</option>
              <option value="mutation">Mutations</option>
              <option value="api">API Calls</option>
              <option value="transaction">Transactions</option>
            </select>

            <button
              onClick={() => setLogs([])}
              className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
            >
              Clear
            </button>

            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-600 hover:text-gray-800"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {view === 'split' ? (
            <>
              {/* Transactions Panel */}
              <div className="w-1/3 border-r overflow-y-auto">
                <div className="px-3 py-2 bg-gray-50 border-b font-medium text-sm">
                  Active Transactions
                </div>
                <div className="p-2 space-y-2">
                  {transactions.length === 0 ? (
                    <div className="text-gray-500 text-sm italic">No active transactions</div>
                  ) : (
                    transactions.map((tx) => (
                      <div key={tx.id} className="bg-gray-50 rounded p-2 text-xs">
                        <div className="font-mono text-blue-600">{tx.id.slice(0, 8)}</div>
                        <div className="text-gray-600">
                          Status: <span className="font-medium">{tx.status}</span>
                        </div>
                        <div className="text-gray-600">
                          Retries: <span className="font-medium">{tx.retryCount}</span>
                        </div>
                        <div className="text-gray-600">
                          Mutations: <span className="font-medium">{tx.mutations.length}</span>
                        </div>
                        {tx.mutations.length > 0 && (
                          <div className="mt-1 text-gray-500">
                            {tx.mutations.map((mut, i) => (
                              <div key={i} className="truncate">
                                {mut.type}: {mut.key}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Logs Panel */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-2 bg-gray-50 border-b font-medium text-sm">
                  Event Log ({filteredLogs.length})
                </div>
                <div className="p-2 space-y-1">
                  {filteredLogs.length === 0 ? (
                    <div className="text-gray-500 text-sm italic">No logs</div>
                  ) : (
                    filteredLogs.map((log) => (
                      <div key={log.id} className="border-l-2 border-gray-200 pl-3 py-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-500 font-mono">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          <span className={`font-medium uppercase ${getLogColor(log.type)}`}>
                            {log.type}
                          </span>
                        </div>
                        <div className="text-xs text-gray-700 mt-1 space-y-1">
                          {log.context && (
                            <div className="text-xs text-gray-500 bg-yellow-50 p-1 rounded border-l-2 border-yellow-300">
                              <strong>Context:</strong>
                              <span className="ml-1">
                                P:{log.context.pendingTransactions} R:{log.context.runningTransactions} O:{log.context.outboxSize}
                                {log.context.isOfflineEnabled ? ' [OFFLINE]' : ' [ONLINE-ONLY]'}
                              </span>
                            </div>
                          )}
                          <pre className="whitespace-pre-wrap font-mono bg-gray-50 p-1 rounded text-xs overflow-x-auto">
                            {JSON.stringify(log.data, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Timeline View */
            <div className="flex-1 overflow-y-auto">
              <div className="px-3 py-2 bg-gray-50 border-b font-medium text-sm">
                Timeline View ({filteredLogs.length} events)
              </div>
              <div className="p-4">
                {filteredLogs.length === 0 ? (
                  <div className="text-gray-500 text-sm italic">No events</div>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-300"></div>

                    <div className="space-y-4">
                      {filteredLogs.map((log, index) => {
                        return (
                          <div key={log.id} className="relative flex items-start">
                            {/* Timeline dot */}
                            <div className={`relative z-10 flex-shrink-0 w-4 h-4 rounded-full border-2 border-white ${getLogColor(log.type).replace('text-', 'bg-')}`}></div>

                            {/* Event content */}
                            <div className="ml-4 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-gray-500 font-mono">
                                  {formatTimestamp(log.timestamp)}
                                </span>
                                <span className={`text-xs font-medium uppercase ${getLogColor(log.type)}`}>
                                  {log.type}
                                </span>
                                {log.context && (
                                  <span className="text-xs text-gray-400">
                                    P:{log.context.pendingTransactions} R:{log.context.runningTransactions} O:{log.context.outboxSize}
                                    {log.context.isOfflineEnabled ? ' [OFFLINE]' : ' [ONLINE-ONLY]'}
                                  </span>
                                )}
                              </div>

                              {/* Event data - compact view for timeline */}
                              <div className="text-xs text-gray-700">
                                {log.type === 'click' && (
                                  <span className="font-medium">
                                    👆 {log.data.action} {log.data.data?.text ? `"${log.data.data.text}"` : log.data.data?.id ? `(${log.data.data.id.slice(0, 8)})` : ''}
                                  </span>
                                )}
                                {log.type === 'mutation' && (
                                  <span className="font-medium">
                                    🔄 {log.data.action} {log.data.todo?.text ? `"${log.data.todo.text}"` : log.data.id ? `(${log.data.id.slice(0, 8)})` : ''}
                                  </span>
                                )}
                                {log.type.startsWith('api-') && (
                                  <span className="font-medium">
                                    🌐 {log.data.method} {log.data.url}
                                    <span className={log.data.ok ? 'text-green-600' : 'text-red-600'}>
                                      {log.data.status} ({log.data.duration}ms)
                                    </span>
                                  </span>
                                )}
                                {log.type.startsWith('transaction-') && (
                                  <span className="font-medium">
                                    📦 {log.data.transactionId} {log.type.replace('transaction-', '')}
                                    {log.data.mutationCount && ` (${log.data.mutationCount} mutations)`}
                                  </span>
                                )}
                                {log.type === 'outbox-update' && (
                                  <span className="font-medium">
                                    📋 Outbox: {log.data.outboxSize} entries, P:{log.data.pending} R:{log.data.running}
                                    {log.data.changes && (
                                      <span className="text-gray-500">
                                        {' '}(
                                        {log.data.changes.outboxSizeDelta > 0 && `+${log.data.changes.outboxSizeDelta} outbox`}
                                        {log.data.changes.outboxSizeDelta < 0 && `${log.data.changes.outboxSizeDelta} outbox`}
                                        {log.data.changes.pendingDelta !== 0 && ` ${log.data.changes.pendingDelta > 0 ? '+' : ''}${log.data.changes.pendingDelta} pending`}
                                        {log.data.changes.runningDelta !== 0 && ` ${log.data.changes.runningDelta > 0 ? '+' : ''}${log.data.changes.runningDelta} running`}
                                        )
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>

                              {/* Full data on hover or click - collapsed by default in timeline */}
                              <details className="mt-1">
                                <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">Raw Data</summary>
                                <pre className="mt-1 whitespace-pre-wrap font-mono bg-gray-50 p-2 rounded text-xs overflow-x-auto">
                                  {JSON.stringify(log.data, null, 2)}
                                </pre>
                              </details>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}