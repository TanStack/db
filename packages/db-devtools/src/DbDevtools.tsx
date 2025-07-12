import { createSignal, createEffect, onCleanup, For } from 'solid-js'
import type { DbDevtoolsConfig, CollectionMetadata } from './types'
import { DbDevtoolsPanel } from './DbDevtoolsPanel'
import { initializeDevtoolsRegistry } from './registry'

interface DbDevtoolsProps extends DbDevtoolsConfig {
  // Additional component props
}

export function DbDevtools(props: DbDevtoolsProps = {}) {
  const [isOpen, setIsOpen] = createSignal(props.initialIsOpen ?? false)
  const [collections, setCollections] = createSignal<CollectionMetadata[]>([])
  
  const registry = initializeDevtoolsRegistry()
  
  let intervalId: number | undefined

  // Update collections metadata periodically
  createEffect(() => {
    const updateCollections = () => {
      const metadata = registry.getAllCollectionMetadata()
      setCollections(metadata)
    }

    // Initial load
    updateCollections()

    // Set up polling
    intervalId = window.setInterval(updateCollections, 1000)

    onCleanup(() => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    })
  })

  const toggleOpen = () => {
    const newState = !isOpen()
    setIsOpen(newState)
    props.onPanelStateChange?.(newState)
  }

  // Handle controlled state
  createEffect(() => {
    if (props.panelState) {
      setIsOpen(props.panelState === 'open')
    }
  })

  const position = props.position ?? 'bottom-right'
  const storageKey = props.storageKey ?? 'tanstackDbDevtools'

  return (
    <>
      {/* Toggle Button */}
      <div
        style={{
          position: position === 'relative' ? 'relative' : 'fixed',
          ...(position.includes('top') ? { top: '12px' } : { bottom: '12px' }),
          ...(position.includes('left') ? { left: '12px' } : { right: '12px' }),
          'z-index': 999999,
        }}
      >
        <button
          type="button"
          onClick={toggleOpen}
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '#0088ff',
            border: 'none',
            'border-radius': '8px',
            padding: '8px 12px',
            color: 'white',
            'font-family': 'system-ui, sans-serif',
            'font-size': '14px',
            'font-weight': '600',
            cursor: 'pointer',
            'box-shadow': '0 4px 12px rgba(0, 136, 255, 0.3)',
            transition: 'all 0.2s ease',
            ...props.toggleButtonProps?.style,
          }}
          {...props.toggleButtonProps}
        >
          <span style={{ 'margin-right': '8px' }}>🗄️</span>
          DB ({collections().length})
        </button>
      </div>

      {/* Panel */}
      {isOpen() && (
        <DbDevtoolsPanel
          onClose={() => setIsOpen(false)}
          collections={collections()}
          registry={registry}
          {...props.panelProps}
        />
      )}
    </>
  )
}