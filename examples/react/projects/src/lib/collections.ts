import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { QueryClient } from "@tanstack/query-core"
import {
  selectTodoSchema,
  selectProjectSchema,
  selectUsersSchema,
} from "@/db/schema"
import { trpc } from "@/lib/trpc-client"

// Create a query client for query collections
const queryClient = new QueryClient()

export const usersCollection = createCollection(
  queryCollectionOptions({
    id: "users",
    queryKey: ["users"],
    // Poll for updates every 5 seconds
    refetchInterval: 5000,
    queryFn: async () => {
      const users = await trpc.users.getAll.query()
      return users.map((user) => ({
        ...user,
        created_at: new Date(user.created_at),
        updated_at: new Date(user.updated_at),
      }))
    },
    queryClient,
    schema: selectUsersSchema,
    getKey: (item) => item.id,
  })
)
export const projectCollection = createCollection(
  queryCollectionOptions({
    id: "projects",
    queryKey: ["projects"],
    // Poll for updates every 5 seconds
    refetchInterval: 5000,
    queryFn: async () => {
      const projects = await trpc.projects.getAll.query()
      return projects.map((project) => ({
        ...project,
        created_at: new Date(project.created_at),
        updated_at: new Date(project.updated_at),
      }))
    },
    queryClient,
    schema: selectProjectSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newProject } = transaction.mutations[0]
      await trpc.projects.create.mutate({
        name: newProject.name,
        description: newProject.description,
        owner_id: newProject.owner_id,
        shared_user_ids: newProject.shared_user_ids,
      })
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedProject } = transaction.mutations[0]
      await trpc.projects.update.mutate({
        id: updatedProject.id,
        data: {
          name: updatedProject.name,
          description: updatedProject.description,
          shared_user_ids: updatedProject.shared_user_ids,
        },
      })
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedProject } = transaction.mutations[0]
      await trpc.projects.delete.mutate({
        id: deletedProject.id,
      })
    },
  })
)

export const todoCollection = createCollection(
  queryCollectionOptions({
    id: "todos",
    queryKey: ["todos"],
    // Poll for updates every 5 seconds
    refetchInterval: 5000,
    queryFn: async () => {
      const todos = await trpc.todos.getAll.query()
      return todos.map((todo) => ({
        ...todo,
        created_at: new Date(todo.created_at),
        updated_at: new Date(todo.updated_at),
      }))
    },
    queryClient,
    schema: selectTodoSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newTodo } = transaction.mutations[0]
      await trpc.todos.create.mutate({
        user_id: newTodo.user_id,
        text: newTodo.text,
        completed: newTodo.completed,
        project_id: newTodo.project_id,
        user_ids: newTodo.user_ids,
      })
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedTodo } = transaction.mutations[0]
      await trpc.todos.update.mutate({
        id: updatedTodo.id,
        data: {
          text: updatedTodo.text,
          completed: updatedTodo.completed,
        },
      })
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedTodo } = transaction.mutations[0]
      await trpc.todos.delete.mutate({
        id: deletedTodo.id,
      })
    },
  })
)
