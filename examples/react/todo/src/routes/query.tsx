import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { queryConfigCollection, queryTodoCollection } from "../lib/collections"
import { TodoApp } from "../components/TodoApp"
import { api } from "../lib/api"
import type { Transaction } from "@tanstack/react-db"

export const Route = createFileRoute(`/query`)({
  component: QueryPage,
  ssr: false,
  loader: async () => {
    await Promise.all([
      queryTodoCollection.preload(),
      queryConfigCollection.preload(),
    ])

    return null
  },
})

function QueryPage() {
  // Get data using live queries with Query collections
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: queryTodoCollection })
      .orderBy(({ todo }) => todo.created_at, `asc`)
  )

  const { data: configData } = useLiveQuery((q) =>
    q.from({ config: queryConfigCollection })
  )

  // Query collections automatically refetch after handler completes
  const configMutationFn = async ({
    transaction,
  }: {
    transaction: Transaction
  }) => {
    // Handle inserts
    const inserts = transaction.mutations.filter((m) => m.type === `insert`)
    await Promise.all(
      inserts.map(async (mutation) => {
        await api.config.create(mutation.modified)
      })
    )

    // Handle updates
    const updates = transaction.mutations.filter((m) => m.type === `update`)
    await Promise.all(
      updates.map(async (mutation) => {
        if (!(`id` in mutation.original)) {
          throw new Error(`Original config not found for update`)
        }
        await api.config.update(mutation.original.id, mutation.changes)
      })
    )

    // Trigger refetch to get confirmed server state
    await queryConfigCollection.utils.refetch()
  }

  return (
    <TodoApp
      todos={todos}
      configData={configData}
      todoCollection={queryTodoCollection}
      configCollection={queryConfigCollection}
      title="todos (query)"
      configMutationFn={configMutationFn}
    />
  )
}
