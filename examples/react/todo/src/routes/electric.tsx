import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import {
  electricConfigCollection,
  electricTodoCollection,
} from "../lib/collections"
import { TodoApp } from "../components/TodoApp"
import { api } from "../lib/api"
import type { Transaction } from "@tanstack/react-db"

export const Route = createFileRoute(`/electric`)({
  component: ElectricPage,
  ssr: false,
  loader: async () => {
    await Promise.all([
      electricTodoCollection.preload(),
      electricConfigCollection.preload(),
    ])

    return null
  },
})

function ElectricPage() {
  // Get data using live queries with Electric collections
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: electricTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: electricConfigCollection })
  )

  // Electric collections use txid to track sync
  const configMutationFn = async ({
    transaction,
  }: {
    transaction: Transaction
  }) => {
    const txids: Array<number> = []

    // Handle inserts
    const inserts = transaction.mutations.filter((m) => m.type === `insert`)
    for (const mutation of inserts) {
      const response = await api.config.create(mutation.modified)
      txids.push(response.txid)
    }

    // Handle updates
    const updates = transaction.mutations.filter((m) => m.type === `update`)
    for (const mutation of updates) {
      if (!(`id` in mutation.original)) {
        throw new Error(`Original config not found for update`)
      }
      const response = await api.config.update(
        mutation.original.id,
        mutation.changes
      )
      txids.push(response.txid)
    }

    // Wait for all txids to sync back to the collection
    await Promise.all(
      txids.map((txid) => electricConfigCollection.utils.awaitTxid(txid))
    )
  }

  return (
    <TodoApp
      todos={todos}
      configData={configData}
      todoCollection={electricTodoCollection}
      configCollection={electricConfigCollection}
      title="todos (electric)"
      configMutationFn={configMutationFn}
    />
  )
}
