/** @jsxImportSource solid-js */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import * as goober from 'goober'
import { clsx as cx } from 'clsx'
import { TransitionGroup } from 'solid-transition-group'
import { createResizeObserver } from '@solid-primitives/resize-observer'
import { Portal } from 'solid-js/web'
import { tokens } from './theme'
import {
  convertRemToPixels,
  getCollectionStatusColor,
  getTransactionStatusColor,
} from './utils'
import {
  CheckCircle,
  LoadingCircle,
  PauseCircle,
  TanstackLogo,
  Trash,
  XCircle,
} from './icons'
import { useDbDevtoolsContext, useTheme, usePiPWindow } from './contexts'
import {
  BUTTON_POSITION,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  POSITION,
  INITIAL_IS_OPEN,
  secondBreakpoint,
  thirdBreakpoint,
} from './constants'
import type { CollectionMetadata, DbDevtoolsRegistry, TransactionDetails } from './types'
import type { DevtoolsPosition } from './constants'
import type { StorageObject, StorageSetter } from '@solid-primitives/storage'
import type { Component, JSX } from 'solid-js'

interface DevtoolsPanelProps {
  localStore: StorageObject<string>
  setLocalStore: StorageSetter<string, unknown>
  collections: CollectionMetadata[]
  registry: DbDevtoolsRegistry
}

interface ContentViewProps {
  localStore: StorageObject<string>
  setLocalStore: StorageSetter<string, unknown>
  collections: CollectionMetadata[]
  registry: DbDevtoolsRegistry
  showPanelViewOnly?: boolean
  onClose?: () => unknown
}

const [selectedCollectionId, setSelectedCollectionId] = createSignal<string | null>(null)
const [selectedTransactionId, setSelectedTransactionId] = createSignal<string | null>(null)
const [panelWidth, setPanelWidth] = createSignal(0)
const [_offline, _setOffline] = createSignal(false)

export type DevtoolsComponentType = Component<{
  collections: CollectionMetadata[]
  registry: DbDevtoolsRegistry
  onClose?: () => void
}> & {
  shadowDOMTarget?: ShadowRoot
}

export const Devtools: Component<DevtoolsPanelProps> = (props) => {
  const theme = useTheme()
  const css = useDbDevtoolsContext().shadowDOMTarget
    ? goober.css.bind({ target: useDbDevtoolsContext().shadowDOMTarget })
    : goober.css
  const styles = createMemo(() => {
    return theme() === 'dark' ? darkStyles(css) : lightStyles(css)
  })

  const pip = usePiPWindow()

  const buttonPosition = createMemo(() => {
    return useDbDevtoolsContext().buttonPosition || BUTTON_POSITION
  })

  const isOpen = createMemo(() => {
    return props.localStore.open === 'true'
      ? true
      : props.localStore.open === 'false'
        ? false
        : useDbDevtoolsContext().initialIsOpen || INITIAL_IS_OPEN
  })

  const position = createMemo(() => {
    return (
      props.localStore.position ||
      useDbDevtoolsContext().position ||
      POSITION
    )
  })

  let transitionsContainerRef!: HTMLDivElement
  createEffect(() => {
    const root = transitionsContainerRef.parentElement as HTMLElement
    const height = props.localStore.height || DEFAULT_HEIGHT
    const width = props.localStore.width || DEFAULT_WIDTH
    const panelPosition = position()
    root.style.setProperty(
      '--tsdb-panel-height',
      `${panelPosition === 'top' ? '-' : ''}${height}px`,
    )
    root.style.setProperty(
      '--tsdb-panel-width',
      `${panelPosition === 'left' ? '-' : ''}${width}px`,
    )
  })

  // Calculates the inherited font size of the parent and sets it as a CSS variable
  onMount(() => {
    const onFocus = () => {
      const root = transitionsContainerRef.parentElement as HTMLElement
      const fontSize = getComputedStyle(root).fontSize
      root.style.setProperty('--tsdb-font-size', fontSize)
    }
    onFocus()
    window.addEventListener('focus', onFocus)
    onCleanup(() => {
      window.removeEventListener('focus', onFocus)
    })
  })

  const pip_open = createMemo(
    () => (props.localStore.pip_open ?? 'false') as 'true' | 'false',
  )

  return (
    <>
              <Show when={pip.pipWindow() && pip_open() == 'true'}>
          <Portal mount={pip.pipWindow()?.document.body}>
          <PiPPanel>
            <ContentView {...props} />
          </PiPPanel>
        </Portal>
      </Show>
      <div
        class={cx(
          css`
            & .tsdb-panel-transition-exit-active,
            & .tsdb-panel-transition-enter-active {
              transition:
                opacity 0.3s,
                transform 0.3s;
            }

            & .tsdb-panel-transition-exit-to,
            & .tsdb-panel-transition-enter {
              ${position() === 'top' || position() === 'bottom'
                ? `transform: translateY(var(--tsdb-panel-height));`
                : `transform: translateX(var(--tsdb-panel-width));`}
            }

            & .tsdb-button-transition-exit-active,
            & .tsdb-button-transition-enter-active {
              transition:
                opacity 0.3s,
                transform 0.3s;
              opacity: 1;
            }

            & .tsdb-button-transition-exit-to,
            & .tsdb-button-transition-enter {
              transform: ${buttonPosition() === 'relative'
                ? `none;`
                : buttonPosition() === 'top-left'
                  ? `translateX(-72px);`
                  : buttonPosition() === 'top-right'
                    ? `translateX(72px);`
                    : `translateY(72px);`};
              opacity: 0;
            }
          `,
          'tsdb-transitions-container',
        )}
        ref={transitionsContainerRef}
      >
        <TransitionGroup name="tsdb-panel-transition">
          <Show when={isOpen() && !pip.pipWindow() && pip_open() == 'false'}>
            <DraggablePanel
              localStore={props.localStore}
              setLocalStore={props.setLocalStore}
              collections={props.collections}
              registry={props.registry}
            />
          </Show>
        </TransitionGroup>
        <TransitionGroup name="tsdb-button-transition">
          <Show when={!isOpen()}>
            <div
              class={cx(
                styles().devtoolsBtn,
                styles()[`devtoolsBtn-position-${buttonPosition()}`],
                'tsdb-open-btn-container',
              )}
            >
              <div aria-hidden="true">
                <TanstackLogo />
              </div>
              <button
                type="button"
                aria-label="Open TanStack DB devtools"
                onClick={() => props.setLocalStore('open', 'true')}
                class="tsdb-open-btn"
              >
                <TanstackLogo />
              </button>
            </div>
          </Show>
        </TransitionGroup>
      </div>
    </>
  )
}

const PiPPanel: Component<{
  children: JSX.Element
}> = (props) => {
  const pip = usePiPWindow()
  const theme = useTheme()
  const css = useDbDevtoolsContext().shadowDOMTarget
    ? goober.css.bind({ target: useDbDevtoolsContext().shadowDOMTarget })
    : goober.css
  const styles = createMemo(() => {
    return theme() === 'dark' ? darkStyles(css) : lightStyles(css)
  })

  const getPanelDynamicStyles = () => {
    const { colors } = tokens
    const t = (light: string, dark: string) =>
      theme() === 'dark' ? dark : light
    if (panelWidth() < secondBreakpoint) {
      return css`
        flex-direction: column;
        background-color: ${t(colors.gray[300], colors.gray[600])};
      `
    }
    return css`
      flex-direction: row;
      background-color: ${t(colors.gray[200], colors.darkGray[900])};
    `
  }

  createEffect(() => {
    const win = pip.pipWindow()
    const resizeCB = () => {
      if (!win) return
      setPanelWidth(win.innerWidth)
    }
    if (win) {
      win.addEventListener('resize', resizeCB)
      resizeCB()
    }

    onCleanup(() => {
      if (win) {
        win.removeEventListener('resize', resizeCB)
      }
    })
  })

  return (
    <div
      style={{
        '--tsdb-font-size': '16px',
        'max-height': '100vh',
        height: '100vh',
        width: '100vw',
      }}
      class={cx(
        styles().panel,
        getPanelDynamicStyles(),
        {
          [css`
            min-width: min-content;
          `]: panelWidth() < thirdBreakpoint,
        },
        'tsdb-main-panel',
      )}
    >
      {props.children}
    </div>
  )
}

const DraggablePanel: Component<DevtoolsPanelProps> = (props) => {
  const theme = useTheme()
  const css = useDbDevtoolsContext().shadowDOMTarget
    ? goober.css.bind({ target: useDbDevtoolsContext().shadowDOMTarget })
    : goober.css
  const styles = createMemo(() => {
    return theme() === 'dark' ? darkStyles(css) : lightStyles(css)
  })

  const [isResizing, setIsResizing] = createSignal(false)

  const position = createMemo(
    () =>
      (props.localStore.position ||
        useDbDevtoolsContext().position ||
        POSITION) as DevtoolsPosition,
  )

  const handleDragStart = (event: MouseEvent) => {
    const panelElement = event.currentTarget as HTMLDivElement
    if (!panelElement.parentElement) return
    setIsResizing(true)
    const { height, width } = panelElement.parentElement.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    let newSize = 0
    const minHeight = convertRemToPixels(3.5)
    const minWidth = convertRemToPixels(12)
    const runDrag = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault()

      if (position() === 'left' || position() === 'right') {
        const valToAdd =
          position() === 'right'
            ? startX - moveEvent.clientX
            : moveEvent.clientX - startX
        newSize = Math.round(width + valToAdd)
        if (newSize < minWidth) {
          newSize = minWidth
        }
        props.setLocalStore('width', String(Math.round(newSize)))
      } else {
        const valToAdd =
          position() === 'bottom'
            ? startY - moveEvent.clientY
            : moveEvent.clientY - startY
        newSize = Math.round(height + valToAdd)
        if (newSize < minHeight) {
          newSize = minHeight
          setSelectedCollectionId(null)
        }
        props.setLocalStore('height', String(Math.round(newSize)))
      }
    }

    const unsubscribe = () => {
      if (isResizing()) {
        setIsResizing(false)
      }
      document.removeEventListener('mousemove', runDrag, false)
      document.removeEventListener('mouseup', unsubscribe, false)
    }

    document.addEventListener('mousemove', runDrag, false)
    document.addEventListener('mouseup', unsubscribe, false)
  }

  let panelRef!: HTMLDivElement

  onMount(() => {
    createResizeObserver(panelRef, ({ width }, el) => {
      if (el === panelRef) {
        setPanelWidth(width)
      }
    })
  })

  const getPanelDynamicStyles = () => {
    const { colors } = tokens
    const t = (light: string, dark: string) =>
      theme() === 'dark' ? dark : light
    if (panelWidth() < secondBreakpoint) {
      return css`
        flex-direction: column;
        background-color: ${t(colors.gray[300], colors.gray[600])};
      `
    }
    return css`
      flex-direction: row;
      background-color: ${t(colors.gray[200], colors.darkGray[900])};
    `
  }

  return (
    <div
      ref={panelRef}
      style={{
        '--tsdb-font-size': '16px',
      }}
      class={cx(
        styles().panel,
        getPanelDynamicStyles(),
        {
          [css`
            min-width: min-content;
          `]: panelWidth() < thirdBreakpoint,
        },
        'tsdb-main-panel',
      )}
    >
      <ContentView {...props} />
      <div
        class={styles().dragHandle}
        onMouseDown={handleDragStart}
        style={{
          position: 'absolute',
          ...(position() === 'top' && { bottom: 0, left: 0, right: 0, height: '4px' }),
          ...(position() === 'bottom' && { top: 0, left: 0, right: 0, height: '4px' }),
          ...(position() === 'left' && { right: 0, top: 0, bottom: 0, width: '4px' }),
          ...(position() === 'right' && { left: 0, top: 0, bottom: 0, width: '4px' }),
        }}
      />
    </div>
  )
}

const ContentView: Component<ContentViewProps> = (props) => {
  const theme = useTheme()
  const css = useDbDevtoolsContext().shadowDOMTarget
    ? goober.css.bind({ target: useDbDevtoolsContext().shadowDOMTarget })
    : goober.css
  const styles = createMemo(() => {
    return theme() === 'dark' ? darkStyles(css) : lightStyles(css)
  })

  const [selectedView, setSelectedView] = createSignal<'collections' | 'transactions'>('collections')

  // Create stable collection IDs that only change when collections are added/removed
  const collectionIds = createMemo(() => {
    const currentIds = new Set(props.collections.map(c => c.id))
    return Array.from(currentIds)
  })

  const liveQueryIds = createMemo(() => 
    collectionIds().filter(id => {
      const collection = props.collections.find(c => c.id === id)
      return collection?.type === 'live-query'
    })
  )
  
  const regularCollectionIds = createMemo(() => 
    collectionIds().filter(id => {
      const collection = props.collections.find(c => c.id === id)
      return collection?.type === 'collection'
    })
  )

  // Helper to get latest metadata for a collection ID
  const getCollectionMetadata = (id: string) => {
    return props.collections.find(c => c.id === id)
  }

  const allTransactions = createMemo(() => 
    props.registry.getTransactions()
  )

  const handleCollectionSelect = (id: string) => {
    setSelectedCollectionId(id)
    setSelectedTransactionId(null)
  }

  const handleTransactionSelect = (id: string) => {
    setSelectedTransactionId(id)
    setSelectedCollectionId(null)
  }

  return (
    <div class={styles().contentView}>
      {/* Header */}
      <div class={styles().header}>
        <div class={styles().headerTitle}>
          <TanstackLogo />
          <h1>TanStack DB Devtools</h1>
        </div>
        <div class={styles().headerControls}>
          <Show when={props.onClose}>
            <button
              onClick={props.onClose}
              class={styles().closeBtn}
              aria-label="Close devtools"
            >
              <XCircle />
            </button>
          </Show>
        </div>
      </div>

      <div class={styles().body}>
        {/* Sidebar */}
        <div class={styles().sidebar}>
          {/* Tab Navigation */}
          <div class={styles().tabNav}>
            <button
              onClick={() => setSelectedView('collections')}
              class={cx(
                styles().tabBtn,
                selectedView() === 'collections' && styles().tabBtnActive
              )}
            >
              Collections
            </button>
            <button
              onClick={() => setSelectedView('transactions')}
              class={cx(
                styles().tabBtn,
                selectedView() === 'transactions' && styles().tabBtnActive
              )}
            >
              Transactions ({allTransactions().length})
            </button>
          </div>

          {/* Content based on selected view */}
          <div class={styles().sidebarContent}>
            <Show when={selectedView() === 'collections'}>
              <Show when={liveQueryIds().length > 0}>
                <div class={styles().sectionHeader}>
                  <h3>Live Queries ({liveQueryIds().length})</h3>
                </div>
                <For each={liveQueryIds()}>
                  {(collectionId) => {
                    const collection = getCollectionMetadata(collectionId)
                    return collection ? (
                      <CollectionItem 
                        collection={collection} 
                        isSelected={selectedCollectionId() === collectionId}
                        onClick={() => handleCollectionSelect(collectionId)}
                      />
                    ) : null
                  }}
                </For>
              </Show>

              <Show when={regularCollectionIds().length > 0}>
                <div class={styles().sectionHeader}>
                  <h3>Collections ({regularCollectionIds().length})</h3>
                </div>
                <For each={regularCollectionIds()}>
                  {(collectionId) => {
                    const collection = getCollectionMetadata(collectionId)
                    return collection ? (
                      <CollectionItem 
                        collection={collection} 
                        isSelected={selectedCollectionId() === collectionId}
                        onClick={() => handleCollectionSelect(collectionId)}
                      />
                    ) : null
                  }}
                </For>
              </Show>

              <Show when={collectionIds().length === 0}>
                <div class={styles().emptyState}>
                  No collections found. Create a collection to see it here.
                </div>
              </Show>
            </Show>

            <Show when={selectedView() === 'transactions'}>
              <For each={allTransactions()}>
                {(transaction) => (
                  <TransactionItem 
                    transaction={transaction} 
                    isSelected={selectedTransactionId() === transaction.id}
                    onClick={() => handleTransactionSelect(transaction.id)}
                  />
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Main Content */}
        <div class={styles().mainContent}>
          <Show 
            when={selectedCollectionId()} 
            fallback={
              <Show 
                when={selectedTransactionId()}
                fallback={
                  <div class={styles().placeholder}>
                    {selectedView() === 'collections' 
                      ? 'Select a collection to view details'
                      : 'Select a transaction to view details'
                    }
                  </div>
                }
              >
                <TransactionDetails 
                  transactionId={selectedTransactionId()!}
                  registry={props.registry}
                />
              </Show>
            }
          >
            <CollectionDetails 
              collectionId={selectedCollectionId()!} 
              registry={props.registry}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}

// Collection Item Component
const CollectionItem = (props: { 
  collection: CollectionMetadata
  isSelected: boolean
  onClick: () => void 
}) => {
  const theme = useTheme()
  const css = useDbDevtoolsContext().shadowDOMTarget
    ? goober.css.bind({ target: useDbDevtoolsContext().shadowDOMTarget })
    : goober.css
  const styles = createMemo(() => {
    return theme() === 'dark' ? darkStyles(css) : lightStyles(css)
  })

  const statusColor = () => getCollectionStatusColor(props.collection.status)

  const statusIcon = () => {
    switch (props.collection.status) {
      case 'ready': return <CheckCircle />
      case 'loading': return <LoadingCircle />
      case 'error': return <XCircle />
      case 'cleaned-up': return <Trash />
      default: return <PauseCircle />
    }
  }

  return (
    <div
      onClick={props.onClick}
      class={cx(
        styles().collectionItem,
        props.isSelected && styles().collectionItemSelected
      )}
    >
      <div class={styles().collectionItemHeader}>
        <div class={styles().collectionItemTitle}>
          {props.collection.type === 'live-query' ? '🔄' : '📄'} {props.collection.id}
        </div>
        <div class={styles().collectionItemStatus} style={{ color: statusColor() }}>
          {statusIcon()}
        </div>
      </div>
      <div class={styles().collectionItemMeta}>
        <span>{props.collection.size} items</span>
        <Show when={props.collection.hasTransactions}>
          <span>{props.collection.transactionCount} tx</span>
        </Show>
      </div>
      <Show when={props.collection.timings && props.collection.type === 'live-query'}>
        <div class={styles().collectionItemTimings}>
          {props.collection.timings!.totalIncrementalRuns} runs
          <Show when={props.collection.timings!.averageIncrementalRunTime}>
            , avg {props.collection.timings!.averageIncrementalRunTime}ms
          </Show>
        </div>
      </Show>
    </div>
  )
}

// Transaction Item Component
const TransactionItem = (props: { 
  transaction: TransactionDetails
  isSelected: boolean
  onClick: () => void 
}) => {
  const theme = useTheme()
  const css = useDbDevtoolsContext().shadowDOMTarget
    ? goober.css.bind({ target: useDbDevtoolsContext().shadowDOMTarget })
    : goober.css
  const styles = createMemo(() => {
    return theme() === 'dark' ? darkStyles(css) : lightStyles(css)
  })

  const statusColor = () => getTransactionStatusColor(props.transaction.state)

  const statusIcon = () => {
    switch (props.transaction.state) {
      case 'pending': return <LoadingCircle />
      case 'success': return <CheckCircle />
      case 'error': return <XCircle />
      default: return <PauseCircle />
    }
  }

  return (
    <div
      onClick={props.onClick}
      class={cx(
        styles().transactionItem,
        props.isSelected && styles().transactionItemSelected
      )}
    >
      <div class={styles().transactionItemHeader}>
        <div class={styles().transactionItemTitle}>
          Transaction {props.transaction.id}
        </div>
        <div class={styles().transactionItemStatus} style={{ color: statusColor() }}>
          {statusIcon()}
        </div>
      </div>
      <div class={styles().transactionItemMeta}>
        <span>{props.transaction.collectionId}</span>
        <span>{props.transaction.mutations.length} mutations</span>
      </div>
    </div>
  )
}

// Placeholder components - these will be replaced with actual implementations
const CollectionDetails = (props: { collectionId: string, registry: DbDevtoolsRegistry }) => {
  return <div>Collection Details: {props.collectionId}</div>
}

const TransactionDetails = (props: { transactionId: string, registry: DbDevtoolsRegistry }) => {
  return <div>Transaction Details: {props.transactionId}</div>
}

// Style factory function
const stylesFactory = (
  theme: 'light' | 'dark',
  css: (typeof goober)['css'],
) => {
  const { colors, font, size, border, shadow } = tokens
  const t = (light: string, dark: string) => (theme === 'light' ? light : dark)

  return {
    devtoolsBtn: css`
      position: fixed;
      z-index: 99999;
      border: none;
      background: ${t(colors.white, colors.darkGray[800])};
      color: ${t(colors.gray[700], colors.gray[300])};
      border-radius: ${border.radius.md};
      box-shadow: ${shadow.lg(t(colors.gray[500] + '20', colors.black + '50'))};
      cursor: pointer;
      padding: ${size[2]};
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${size[12]};
      height: ${size[12]};
      font-size: ${font.size.lg};
      
      &:hover {
        background: ${t(colors.gray[50], colors.darkGray[700])};
      }
    `,
    'devtoolsBtn-position-bottom-right': css`
      bottom: ${size[6]};
      right: ${size[6]};
    `,
    'devtoolsBtn-position-bottom-left': css`
      bottom: ${size[6]};
      left: ${size[6]};
    `,
    'devtoolsBtn-position-top-right': css`
      top: ${size[6]};
      right: ${size[6]};
    `,
    'devtoolsBtn-position-top-left': css`
      top: ${size[6]};
      left: ${size[6]};
    `,
    'devtoolsBtn-position-relative': css`
      position: relative;
    `,
    panel: css`
      position: fixed;
      display: flex;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: ${font.size.md};
      z-index: 99999;
      color: ${t(colors.gray[700], colors.gray[300])};
      background: ${t(colors.gray[100], colors.darkGray[800])};
      border: 1px solid ${t(colors.gray[300], colors.gray[600])};
      border-radius: ${border.radius.lg};
      box-shadow: ${shadow.xl(t(colors.gray[500] + '20', colors.black + '50'))};
      backdrop-filter: blur(10px);
      min-height: 300px;
      min-width: 400px;
      max-height: 90vh;
      max-width: 90vw;
      overflow: hidden;
    `,
    contentView: css`
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    `,
    header: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: ${size[4]} ${size[6]};
      border-bottom: 1px solid ${t(colors.gray[300], colors.gray[600])};
      background: ${t(colors.gray[50], colors.darkGray[700])};
    `,
    headerTitle: css`
      display: flex;
      align-items: center;
      gap: ${size[3]};
      font-size: ${font.size.lg};
      font-weight: ${font.weight.semibold};
    `,
    headerControls: css`
      display: flex;
      align-items: center;
      gap: ${size[2]};
    `,
    closeBtn: css`
      background: none;
      border: none;
      color: ${t(colors.gray[500], colors.gray[400])};
      cursor: pointer;
      padding: ${size[1]};
      border-radius: ${border.radius.sm};
      
      &:hover {
        background: ${t(colors.gray[200], colors.gray[600])};
      }
    `,
    body: css`
      display: flex;
      flex: 1;
      overflow: hidden;
    `,
    sidebar: css`
      width: 300px;
      border-right: 1px solid ${t(colors.gray[300], colors.gray[600])};
      background: ${t(colors.gray[50], colors.darkGray[800])};
      display: flex;
      flex-direction: column;
    `,
    tabNav: css`
      display: flex;
      border-bottom: 1px solid ${t(colors.gray[300], colors.gray[600])};
      background: ${t(colors.gray[100], colors.darkGray[700])};
    `,
    tabBtn: css`
      flex: 1;
      padding: ${size[3]};
      background: transparent;
      border: none;
      color: ${t(colors.gray[600], colors.gray[400])};
      cursor: pointer;
      font-size: ${font.size.sm};
      font-weight: ${font.weight.medium};
      
      &:hover {
        background: ${t(colors.gray[200], colors.gray[600])};
      }
    `,
    tabBtnActive: css`
      background: ${colors.blue[500]};
      color: ${colors.white};
      
      &:hover {
        background: ${colors.blue[600]};
      }
    `,
    sidebarContent: css`
      flex: 1;
      overflow-y: auto;
    `,
    sectionHeader: css`
      padding: ${size[4]} ${size[4]} ${size[2]} ${size[4]};
      
      h3 {
        margin: 0;
        font-size: ${font.size.sm};
        font-weight: ${font.weight.semibold};
        color: ${t(colors.gray[600], colors.gray[400])};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    `,
    collectionItem: css`
      padding: ${size[3]} ${size[4]};
      border-bottom: 1px solid ${t(colors.gray[200], colors.gray[700])};
      cursor: pointer;
      
      &:hover {
        background: ${t(colors.gray[100], colors.gray[700])};
      }
    `,
    collectionItemSelected: css`
      background: ${colors.blue[50]};
      border-left: 3px solid ${colors.blue[500]};
      
      &:hover {
        background: ${colors.blue[100]};
      }
    `,
    collectionItemHeader: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: ${size[1]};
    `,
    collectionItemTitle: css`
      font-weight: ${font.weight.medium};
      font-size: ${font.size.sm};
      color: ${t(colors.gray[900], colors.gray[100])};
    `,
    collectionItemStatus: css`
      display: flex;
      align-items: center;
      font-size: ${font.size.xs};
    `,
    collectionItemMeta: css`
      font-size: ${font.size.xs};
      color: ${t(colors.gray[600], colors.gray[400])};
      display: flex;
      justify-content: space-between;
    `,
    collectionItemTimings: css`
      font-size: ${font.size['2xs']};
      color: ${t(colors.gray[500], colors.gray[500])};
      margin-top: ${size[0.5]};
    `,
    transactionItem: css`
      padding: ${size[3]} ${size[4]};
      border-bottom: 1px solid ${t(colors.gray[200], colors.gray[700])};
      cursor: pointer;
      
      &:hover {
        background: ${t(colors.gray[100], colors.gray[700])};
      }
    `,
    transactionItemSelected: css`
      background: ${colors.blue[50]};
      border-left: 3px solid ${colors.blue[500]};
      
      &:hover {
        background: ${colors.blue[100]};
      }
    `,
    transactionItemHeader: css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: ${size[1]};
    `,
    transactionItemTitle: css`
      font-weight: ${font.weight.medium};
      font-size: ${font.size.sm};
      color: ${t(colors.gray[900], colors.gray[100])};
    `,
    transactionItemStatus: css`
      display: flex;
      align-items: center;
      font-size: ${font.size.xs};
    `,
    transactionItemMeta: css`
      font-size: ${font.size.xs};
      color: ${t(colors.gray[600], colors.gray[400])};
      display: flex;
      justify-content: space-between;
    `,
    mainContent: css`
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `,
    placeholder: css`
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: ${t(colors.gray[500], colors.gray[400])};
      font-style: italic;
    `,
    emptyState: css`
      padding: ${size[10]} ${size[6]};
      text-align: center;
      color: ${t(colors.gray[500], colors.gray[400])};
      font-style: italic;
    `,
    dragHandle: css`
      background: transparent;
      cursor: ${(pos: DevtoolsPosition) => pos === 'left' || pos === 'right' ? 'ew-resize' : 'ns-resize'};
      opacity: 0;
      
      &:hover {
        opacity: 1;
        background: ${colors.blue[500]};
      }
    `,
  }
}

const lightStyles = (css: (typeof goober)['css']) => stylesFactory('light', css)
const darkStyles = (css: (typeof goober)['css']) => stylesFactory('dark', css)