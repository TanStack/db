import { createContext, createSignal, useContext } from "solid-js"
import type { Accessor, Setter } from "solid-js"
import type { CollectionMetadata, TransactionDetails } from "../types"

export interface NavigationState {
  selectedView: Accessor<`collections` | `transactions`>
  setSelectedView: Setter<`collections` | `transactions`>
  activeCollectionId: Accessor<string>
  setActiveCollectionId: Setter<string>
  selectedTransaction: Accessor<string | null>
  setSelectedTransaction: Setter<string | null>
  activeCollection: Accessor<CollectionMetadata | undefined>
  activeTransaction: Accessor<TransactionDetails | undefined>
  collections: Accessor<Array<CollectionMetadata>>
  setCollections: Setter<Array<CollectionMetadata>>
  transactions: Accessor<Array<TransactionDetails>>
  setTransactions: Setter<Array<TransactionDetails>>
}

const NavigationContext = createContext<NavigationState>()

export function createNavigationStore(): NavigationState {
  const [selectedView, setSelectedView] = createSignal<
    `collections` | `transactions`
  >(`collections`)
  const [activeCollectionId, setActiveCollectionId] = createSignal<string>(``)
  const [selectedTransaction, setSelectedTransaction] = createSignal<
    string | null
  >(null)

  // These will be set by the parent component
  const [collections, setCollections] = createSignal<Array<CollectionMetadata>>(
    []
  )
  const [transactions, setTransactions] = createSignal<
    Array<TransactionDetails>
  >([])

  const activeCollection = () => {
    const active = collections().find((c) => c.id === activeCollectionId())
    return active
  }

  const activeTransaction = () => {
    const active = transactions().find((t) => t.id === selectedTransaction())
    return active
  }

  // Debug logging
  const debugSetSelectedView: Setter<`collections` | `transactions`> = (
    value
  ) => {
    setSelectedView(value)
  }

  const debugSetActiveCollectionId: Setter<string> = (value) => {
    setActiveCollectionId(value)
  }

  const debugSetSelectedTransaction: Setter<string | null> = (value) => {
    setSelectedTransaction(value)
  }

  const debugSetCollections: Setter<Array<CollectionMetadata>> = (value) => {
    setCollections(value)
  }

  const debugSetTransactions: Setter<Array<TransactionDetails>> = (value) => {
    setTransactions(value)
  }

  const store: NavigationState = {
    selectedView,
    setSelectedView: debugSetSelectedView,
    activeCollectionId,
    setActiveCollectionId: debugSetActiveCollectionId,
    selectedTransaction,
    setSelectedTransaction: debugSetSelectedTransaction,
    activeCollection,
    activeTransaction,
    // Internal state setters for parent component
    collections,
    setCollections: debugSetCollections,
    transactions,
    setTransactions: debugSetTransactions,
  }

  return store
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error(`useNavigation must be used within a NavigationProvider`)
  }
  return context
}

export function NavigationProvider(props: {
  children: any
  store: NavigationState
}) {
  return (
    <NavigationContext.Provider value={props.store}>
      {props.children}
    </NavigationContext.Provider>
  )
}
