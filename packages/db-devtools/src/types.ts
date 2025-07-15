import type { CollectionImpl } from "../../db/src/collection"
import type { CollectionStatus } from "../../db/src/types"

export interface DbDevtoolsConfig {
  /**
   * Set this true if you want the dev tools to default to being open
   */
  initialIsOpen?: boolean
  /**
   * The position of the TanStack logo to open and close the devtools panel.
   * 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'relative'
   * Defaults to 'bottom-right'
   */
  position?:
    | `top-left`
    | `top-right`
    | `bottom-left`
    | `bottom-right`
    | `relative`
  /**
   * Use this to add props to the panel. For example, you can add className, style (merge and override default style), etc.
   */
  panelProps?: Record<string, any>
  /**
   * Use this to add props to the close button. For example, you can add className, style (merge and override default style), etc.
   */
  closeButtonProps?: Record<string, any>
  /**
   * Use this to add props to the toggle button. For example, you can add className, style (merge and override default style), etc.
   */
  toggleButtonProps?: Record<string, any>
  /**
   * The prefix for the localStorage keys used to store the open state and position of the devtools panel.
   * Defaults to 'tanstackDbDevtools'
   */
  storageKey?: string
  /**
   * A boolean variable indicating whether the pannel is open or closed.
   * If defined, the open state will be controlled by this variable, otherwise it will be controlled by the component's internal state.
   */
  panelState?: `open` | `closed`
  /**
   * A callback function which will be called when the open state changes.
   * If panelState is defined, this callback will be called when the user toggles the panel.
   */
  onPanelStateChange?: (isOpen: boolean) => void
}

export interface CollectionMetadata {
  id: string
  type: string
  status: CollectionStatus
  size: number
  hasTransactions: boolean
  transactionCount: number
  createdAt: Date
  lastUpdated: Date
  gcTime?: number

  // Performance tracking for live queries
  timings?: {
    initialRunTime?: number
    lastIncrementalRunTime?: number
    totalIncrementalRuns: number
    averageIncrementalRunTime?: number
  }

  // Additional metadata
  schema?: any
  syncConfig?: any
}

export interface CollectionRegistryEntry {
  weakRef: WeakRef<CollectionImpl<any, any, any>>
  metadata: CollectionMetadata
  isActive: boolean // Whether we're currently viewing this collection (hard ref held)
  hardRef?: CollectionImpl<any, any, any> // Only set when actively viewing
}

export interface TransactionDetails {
  id: string
  collectionId: string
  state: string
  mutations: Array<{
    id: string
    type: `insert` | `update` | `delete`
    key: any
    optimistic: boolean
    createdAt: Date
    original?: any
    modified?: any
    changes?: any
  }>
  createdAt: Date
  updatedAt: Date
  isPersisted: boolean
}

export interface DbDevtoolsRegistry {
  collections: Map<string, CollectionRegistryEntry>

  // Registration methods
  registerCollection: (collection: CollectionImpl<any, any, any>) => void
  unregisterCollection: (id: string) => void

  // Metadata access
  getCollectionMetadata: (id: string) => CollectionMetadata | undefined
  getAllCollectionMetadata: () => Array<CollectionMetadata>

  // Collection access (creates hard refs)
  getCollection: (id: string) => CollectionImpl<any, any, any> | undefined
  releaseCollection: (id: string) => void

  // Transaction access
  getTransactions: (collectionId?: string) => Array<TransactionDetails>
  getTransaction: (id: string) => TransactionDetails | undefined

  // Cleanup utilities
  cleanup: () => void
  garbageCollect: () => void
}

// Window global interface is already declared in @tanstack/db
// The DbDevtoolsRegistry interface extends the base interface used there
