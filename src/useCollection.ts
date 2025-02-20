import { useState } from 'react'
import type { SyncConfig, MutationFn, Transaction } from './types'
import { TransactionManager } from './TransactionManager'
import { TransactionStore } from './TransactionStore'

// Initialize store and manager once, but only in browser environment
let store: TransactionStore | undefined
let transactionManager: TransactionManager | undefined

function getTransactionManager() {
  if (typeof window === 'undefined') return undefined

  if (!store) {
    store = new TransactionStore()
    transactionManager = new TransactionManager(store)
  }

  return transactionManager
}

interface UseCollectionConfig {
  sync: SyncConfig
  mutationFn?: MutationFn
}

interface UpdateParams {
  id: string
  changes: Record<string, any>
  metadata?: unknown
}

interface InsertParams {
  id: string
  data: Record<string, any>
  metadata?: unknown
}

interface DeleteParams {
  id: string
  metadata?: unknown
}

interface WithMutationParams {
  changes: Record<string, any>[]
  metadata?: unknown
}

export function useCollection(config: UseCollectionConfig) {
  const [data, setData] = useState<Record<string, any>>({})
  const manager = getTransactionManager()

  const update = ({ id, changes, metadata }: UpdateParams) => {
    if (!manager) return

    const mutation = {
      mutationId: crypto.randomUUID(),
      original: data[id] || {},
      modified: { ...data[id], ...changes, id },
      changes,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: 'created' as const
    }

    manager.createTransaction([mutation], { type: 'ordered' })
  }

  const insert = ({ id, data: newData, metadata }: InsertParams) => {
    if (!manager) return

    const mutation = {
      mutationId: crypto.randomUUID(),
      original: {},
      modified: { ...newData, id },
      changes: newData,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: 'created' as const
    }

    manager.createTransaction([mutation], { type: 'ordered' })
  }

  const deleteFn = ({ id, metadata }: DeleteParams) => {
    if (!manager) return

    const mutation = {
      mutationId: crypto.randomUUID(),
      original: data[id] || {},
      modified: { id, _deleted: true },
      changes: { _deleted: true },
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: 'created' as const
    }

    manager.createTransaction([mutation], { type: 'ordered' })
  }

  const withMutation = ({ changes, metadata }: WithMutationParams) => {
    if (!manager) return

    const mutations = changes.map(change => ({
      mutationId: crypto.randomUUID(),
      original: data[change.id] || {},
      modified: { ...data[change.id], ...change },
      changes: change,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: 'created' as const
    }))

    manager.createTransaction(mutations, { type: 'ordered' })
  }

  return {
    data,
    update,
    insert,
    delete: deleteFn,
    withMutation
  }
}
