import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js'
import type { DbDevtoolsRegistry } from '../types'

interface CollectionDetailsProps {
  collectionId: string
  registry: DbDevtoolsRegistry
}

export function CollectionDetails(props: CollectionDetailsProps) {
  const [collectionData, setCollectionData] = createSignal<any[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let unsubscribe: (() => void) | undefined

  createEffect(() => {
    const collectionId = props.collectionId
    if (!collectionId) return

    setIsLoading(true)
    setError(null)

    // Get the collection (creates hard reference)
    const collection = props.registry.getCollection(collectionId)
    if (!collection) {
      setError('Collection not found')
      setIsLoading(false)
      return
    }

    // Subscribe to collection changes
    unsubscribe = collection.subscribeChanges(
      (changes) => {
        // Update the local state with fresh data
        setCollectionData(Array.from(collection.values()))
      },
      { includeInitialState: true }
    )

    setIsLoading(false)

    // Cleanup: release hard reference and unsubscribe
    onCleanup(() => {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = undefined
      }
      props.registry.releaseCollection(collectionId)
    })
  })

  const metadata = () => props.registry.getCollectionMetadata(props.collectionId)

  return (
    <div style={{ padding: '20px', overflow: 'auto', height: '100%' }}>
      <Show when={error()} fallback={
        <Show when={!isLoading()} fallback={
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '200px' }}>
            <div style={{ color: '#666' }}>Loading collection details...</div>
          </div>
        }>
          <div>
            <div style={{ 
              display: 'flex', 
              'align-items': 'center', 
              'justify-content': 'space-between',
              'margin-bottom': '20px',
              'padding-bottom': '16px',
              'border-bottom': '1px solid #333'
            }}>
              <h2 style={{ margin: '0', 'font-size': '20px', color: '#e1e1e1' }}>
                {metadata()?.type === 'live-query' ? '🔄' : '📄'} {props.collectionId}
              </h2>
              <div style={{ 
                display: 'flex', 
                'align-items': 'center', 
                gap: '12px',
                'font-size': '14px',
                color: '#888'
              }}>
                <span>Status: {metadata()?.status}</span>
                <span>•</span>
                <span>{collectionData().length} items</span>
              </div>
            </div>

            {/* Metadata Section */}
            <Show when={metadata()}>
              <div style={{ 'margin-bottom': '24px' }}>
                <h3 style={{ margin: '0 0 12px 0', 'font-size': '16px', color: '#e1e1e1' }}>
                  Metadata
                </h3>
                <div style={{ 
                  display: 'grid', 
                  'grid-template-columns': 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  'font-size': '14px'
                }}>
                  <div>
                    <strong>Type:</strong> {metadata()!.type}
                  </div>
                  <div>
                    <strong>Created:</strong> {metadata()!.createdAt.toLocaleString()}
                  </div>
                  <div>
                    <strong>Last Updated:</strong> {metadata()!.lastUpdated.toLocaleString()}
                  </div>
                  <div>
                    <strong>GC Time:</strong> {metadata()!.gcTime || 'Default'}ms
                  </div>
                  <Show when={metadata()!.hasTransactions}>
                    <div>
                      <strong>Transactions:</strong> {metadata()!.transactionCount}
                    </div>
                  </Show>
                </div>

                {/* Live Query Timings */}
                <Show when={metadata()!.type === 'live-query' && metadata()!.timings}>
                  <div style={{ 'margin-top': '16px' }}>
                    <h4 style={{ margin: '0 0 8px 0', 'font-size': '14px', color: '#e1e1e1' }}>
                      Performance Metrics
                    </h4>
                    <div style={{ 
                      display: 'grid', 
                      'grid-template-columns': 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '12px',
                      'font-size': '14px'
                    }}>
                      <Show when={metadata()!.timings!.initialRunTime}>
                        <div>
                          <strong>Initial Run:</strong> {metadata()!.timings!.initialRunTime}ms
                        </div>
                      </Show>
                      <div>
                        <strong>Total Runs:</strong> {metadata()!.timings!.totalIncrementalRuns}
                      </div>
                      <Show when={metadata()!.timings!.averageIncrementalRunTime}>
                        <div>
                          <strong>Avg Incremental:</strong> {metadata()!.timings!.averageIncrementalRunTime}ms
                        </div>
                      </Show>
                      <Show when={metadata()!.timings!.lastIncrementalRunTime}>
                        <div>
                          <strong>Last Run:</strong> {metadata()!.timings!.lastIncrementalRunTime}ms
                        </div>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Data Section */}
            <div>
              <h3 style={{ margin: '0 0 16px 0', 'font-size': '16px', color: '#e1e1e1' }}>
                Data ({collectionData().length} items)
              </h3>
              
              <Show when={collectionData().length === 0} fallback={
                <div style={{ 
                  'max-height': '400px', 
                  overflow: 'auto',
                  border: '1px solid #333',
                  'border-radius': '4px'
                }}>
                  <For each={collectionData()}>
                    {(item, index) => (
                      <div style={{ 
                        padding: '12px',
                        'border-bottom': index() < collectionData().length - 1 ? '1px solid #333' : 'none',
                        'background-color': index() % 2 === 0 ? '#222' : '#1a1a1a'
                      }}>
                        <details>
                          <summary style={{ 
                            cursor: 'pointer',
                            'font-weight': '500',
                            color: '#e1e1e1',
                            'margin-bottom': '8px'
                          }}>
                            Item {index() + 1}
                          </summary>
                          <pre style={{ 
                            'font-size': '12px',
                            'line-height': '1.4',
                            color: '#ccc',
                            margin: '0',
                            'white-space': 'pre-wrap',
                            'word-break': 'break-word'
                          }}>
                            {JSON.stringify(item, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </For>
                </div>
              }>
                <div style={{ 
                  padding: '40px 20px',
                  'text-align': 'center',
                  color: '#666',
                  'font-style': 'italic',
                  border: '1px solid #333',
                  'border-radius': '4px',
                  'background-color': '#1a1a1a'
                }}>
                  No data in collection
                </div>
              </Show>
            </div>
          </div>
        </Show>
      }>
        <div style={{ 
          display: 'flex', 
          'align-items': 'center', 
          'justify-content': 'center',
          height: '200px',
          color: '#ef4444'
        }}>
          {error()}
        </div>
      </Show>
    </div>
  )
}