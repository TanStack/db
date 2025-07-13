import { clsx as cx } from 'clsx'
import { Show, createMemo, createSignal, onMount } from 'solid-js'
import { useDevtoolsOnClose } from './contexts'
import { useStyles } from './useStyles'
import { useLocalStorage } from './useLocalStorage'
import { multiSortBy } from './utils'
import type { Accessor, JSX } from 'solid-js'
import type { DbDevtoolsRegistry, CollectionMetadata } from './types'

export interface BaseDbDevtoolsPanelOptions {
  /**
   * The standard React style object used to style a component with inline styles
   */
  style?: Accessor<JSX.CSSProperties>
  /**
   * The standard React class property used to style a component with classes
   */
  className?: Accessor<string>
  /**
   * A boolean variable indicating whether the panel is open or closed
   */
  isOpen?: boolean
  /**
   * A function that toggles the open and close state of the panel
   */
  setIsOpen?: (isOpen: boolean) => void
  /**
   * Handles the opening and closing the devtools panel
   */
  handleDragStart?: (e: any) => void
  /**
   * The DB devtools registry instance
   */
  registry: Accessor<DbDevtoolsRegistry>
  /**
   * Use this to attach the devtool's styles to specific element in the DOM.
   */
  shadowDOMTarget?: ShadowRoot
}

function Logo(props: any) {
  const { className, ...rest } = props
  const styles = useStyles()
  return (
    <button {...rest} class={cx(styles().logo, className ? className() : '')}>
      <div class={styles().tanstackLogo}>TANSTACK</div>
      <div class={styles().dbLogo}>TanStack DB v0</div>
    </button>
  )
}

function CollectionItem({
  collection,
  isActive,
  onSelect,
}: {
  collection: CollectionMetadata
  isActive: boolean
  onSelect: (collection: CollectionMetadata) => void
}) {
  const styles = useStyles()
  
  return (
    <div
      class={cx(
        styles().collectionItem,
        isActive ? styles().collectionItemActive : ''
      )}
      onClick={() => onSelect(collection)}
    >
      <div class={styles().collectionName}>{collection.id}</div>
      <div class={styles().collectionCount}>({collection.size})</div>
      <div class={cx(
        styles().collectionStatus,
        collection.status === 'error' ? styles().collectionStatusError : ''
      )}>
        {collection.status}
      </div>
    </div>
  )
}

export const BaseTanStackDbDevtoolsPanel = function BaseTanStackDbDevtoolsPanel({
  ...props
}: BaseDbDevtoolsPanelOptions): JSX.Element {
  const {
    isOpen = true,
    setIsOpen,
    handleDragStart,
    registry,
    shadowDOMTarget,
    ...panelProps
  } = props

  const { onCloseClick } = useDevtoolsOnClose()
  const styles = useStyles()
  const { className, style, ...otherPanelProps } = panelProps

  const [activeCollectionId, setActiveCollectionId] = useLocalStorage(
    'tanstackDbDevtoolsActiveCollectionId',
    '',
  )

  const [collections, setCollections] = createSignal<CollectionMetadata[]>([])

  // Poll for collections data
  onMount(() => {
    const updateCollections = () => {
      if (typeof window === 'undefined') return
      
      try {
        const metadata = registry().getAllCollectionMetadata()
        setCollections(metadata)
      } catch (error) {
        console.warn('Error fetching collections metadata:', error)
      }
    }

    updateCollections()
    const intervalId = setInterval(updateCollections, 1000)

    return () => clearInterval(intervalId)
  })

  const activeCollection = createMemo(() => {
    const active = collections().find(c => c.id === activeCollectionId())
    return active || collections()[0]
  })

  const sortedCollections = createMemo(() => {
    return multiSortBy(
      collections(),
      [
        (c) => c.status === 'error' ? 0 : 1, // Errors first
        (c) => c.id.toLowerCase(), // Then alphabetically by ID
      ]
    )
  })

  const collectionDetails = createMemo(() => {
    const active = activeCollection()
    if (!active) return null
    
    try {
      const collection = registry().getCollection(active.id)
      const metadata = registry().getCollectionMetadata(active.id)
      
      return {
        collection,
        metadata,
        transactions: registry().getTransactions(active.id),
      }
    } catch (error) {
      console.warn('Error getting collection details:', error)
      return null
    }
  })

  return (
    <div
      class={cx(
        styles().devtoolsPanel,
        'TanStackDbDevtoolsPanel',
        className ? className() : '',
      )}
      style={style ? style() : ''}
      {...otherPanelProps}
    >
      {handleDragStart ? (
        <div class={styles().dragHandle} onMouseDown={handleDragStart}></div>
      ) : null}
      
      <button
        class={styles().panelCloseBtn}
        onClick={(e: any) => {
          if (setIsOpen) {
            setIsOpen(false)
          }
          onCloseClick(e)
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="6"
          fill="none"
          viewBox="0 0 10 6"
          class={styles().panelCloseBtnIcon}
        >
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.667"
            d="M1 1l4 4 4-4"
          ></path>
        </svg>
      </button>

      <div class={styles().firstContainer}>
        <div class={styles().row}>
          <Logo />
        </div>
        <div class={styles().collectionsExplorerContainer}>
          <div class={styles().collectionsExplorer}>
            <div class={styles().collectionsHeader}>
              <div>Collections ({collections().length})</div>
            </div>
            
            <div class={styles().collectionsList}>
              <Show
                when={sortedCollections().length > 0}
                fallback={
                  <div style={{ padding: '16px', color: '#666' }}>
                    No collections found
                  </div>
                }
              >
                {sortedCollections().map((collection) => (
                  <CollectionItem
                    collection={collection}
                    isActive={collection.id === activeCollectionId()}
                    onSelect={(c) => setActiveCollectionId(c.id)}
                  />
                ))}
              </Show>
            </div>
          </div>
        </div>
      </div>

      <div class={styles().secondContainer}>
        <Show
          when={activeCollection()}
          fallback={
            <div class={styles().detailsPanel}>
              <div class={styles().detailsHeader}>
                Select a collection to view details
              </div>
            </div>
          }
        >
          {(collection) => (
            <div class={styles().detailsPanel}>
              <div class={styles().detailsHeader}>
                {collection().id}
              </div>
              <div class={styles().detailsContent}>
                <pre>{JSON.stringify(collection(), null, 2)}</pre>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

export default BaseTanStackDbDevtoolsPanel 