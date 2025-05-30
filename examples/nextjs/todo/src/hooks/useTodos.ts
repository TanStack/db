import { useOptimisticMutation } from "@tanstack/react-db"
import { api } from "../lib/api"
import { collectionSync } from "../lib/collections"
import type { Collection, PendingMutation } from "@tanstack/react-db"
import type { UpdateTodo } from "../db/validation"

export const useTodos = (todoCollection: Collection<UpdateTodo>) => {
  const addTodo = useOptimisticMutation({
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0] as PendingMutation<UpdateTodo>
      const { modified } = mutation
      const response = await api.todos.create(modified)
      await collectionSync(mutation, response.txid)
    },
  })

  const updateTodo = useOptimisticMutation({
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0] as PendingMutation<UpdateTodo>
      const { original, changes } = mutation
      const response = await api.todos.update(original.id, changes)
      await collectionSync(mutation, response.txid)
    },
  })

  const deleteTodo = useOptimisticMutation({
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0] as PendingMutation<UpdateTodo>
      const { original } = mutation
      const response = await api.todos.delete(original.id)
      await collectionSync(mutation, response.txid)
    },
  })

  return {
    addTodo,
    updateTodo,
    deleteTodo,
  }
}
