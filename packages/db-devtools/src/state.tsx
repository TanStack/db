/** @jsxImportSource solid-js */
import { onCleanup, onMount } from "solid-js"
import { createCollection, useLiveQuery } from "@tanstack/solid-db"
import { localOnlyCollectionOptions } from "@tanstack/db"
import { onDevtoolsEvent } from "./index"
import { getDevtoolsRegistry } from "./devtools"
import type { CollectionMetadata, TransactionDetails } from "./types"

// Collections metadata store
const collectionsStore = createCollection<CollectionMetadata>(
  localOnlyCollectionOptions<CollectionMetadata>({
    id: "__devtools-collections__",
    getKey: (m: CollectionMetadata) => m.id,
    initialData: [],
  })
)

// Transactions store (flattened list)
const transactionsStore = createCollection<TransactionDetails>(
  localOnlyCollectionOptions<TransactionDetails>({
    id: "__devtools-transactions__",
    getKey: (t: TransactionDetails) => t.id,
    initialData: [],
  })
)

function seedFromRegistry() {
  const registry = getDevtoolsRegistry()
  if (!registry) return
  const metas = registry.getAllCollectionMetadata()
  // Diff apply (simple replace for now)
  const existingIds = new Set<string>()
  for (const meta of metas) {
    existingIds.add(meta.id)
    const current = collectionsStore.get(meta.id)
    if (current) {
      collectionsStore.update(meta.id, (draft: CollectionMetadata) => Object.assign(draft, meta))
    } else {
      collectionsStore.insert(meta)
    }
  }
  // Remove deleted
  for (const { id } of collectionsStore.syncedData.values() as IterableIterator<CollectionMetadata>) {
    if (!existingIds.has(id)) {
      collectionsStore.delete(id)
    }
  }

  // Seed transactions
  const txs = registry.getTransactions()
  const txIds = new Set<string>()
  for (const tx of txs) {
    txIds.add(tx.id)
    const current = transactionsStore.get(tx.id)
    if (current) {
      transactionsStore.update(tx.id, (draft: TransactionDetails) => Object.assign(draft, tx))
    } else {
      transactionsStore.insert(tx)
    }
  }
  for (const { id } of transactionsStore.syncedData.values() as IterableIterator<TransactionDetails>) {
    if (!txIds.has(id)) transactionsStore.delete(id)
  }
}

export function useDevtoolsCollections(): Array<CollectionMetadata> {
  onMount(() => {
    // Initial seed
    seedFromRegistry()

    const offRegister = onDevtoolsEvent("collectionRegistered", () => {
      seedFromRegistry()
    })
    const offUpdate = onDevtoolsEvent("collectionUpdated", () => {
      seedFromRegistry()
    })
    const offTx = onDevtoolsEvent("transactionsUpdated", () => {
      seedFromRegistry()
    })

    onCleanup(() => {
      offRegister()
      offUpdate()
      offTx()
    })
  })

  const { data } = useLiveQuery<CollectionMetadata[]>((q) =>
    q.from({ c: collectionsStore }).select(({ c }) => c)
  )
  return data
}

export function useDevtoolsTransactions(): Array<TransactionDetails> {
  onMount(() => {
    // keep in sync via seed
    seedFromRegistry()
  })
  const { data } = useLiveQuery<TransactionDetails[]>((q) =>
    q.from({ t: transactionsStore }).select(({ t }) => t)
  )
  return data
}