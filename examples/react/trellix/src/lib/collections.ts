import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { QueryClient } from "@tanstack/query-core"
import {
  selectBoardSchema,
  selectColumnSchema,
  selectItemSchema,
} from "@/db/schema"
import { trpc } from "@/lib/trpc-client"

// Create a query client for query collections
const queryClient = new QueryClient()

// Store the current board ID for filtering columns and items
let currentBoardId: number | null = null

export function setCurrentBoardId(boardId: number | null) {
  currentBoardId = boardId
}

export const boardCollection = createCollection(
  queryCollectionOptions({
    id: "boards",
    queryKey: ["boards"],
    refetchInterval: 5000,
    queryFn: async () => {
      const boards = await trpc.boards.getAll.query()
      return boards.map((board) => ({
        ...board,
        createdAt: new Date(board.createdAt),
      }))
    },
    queryClient,
    schema: selectBoardSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newBoard } = transaction.mutations[0]
      await trpc.boards.create.mutate({
        name: newBoard.name,
        color: newBoard.color,
        ownerId: newBoard.ownerId,
      })
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedBoard } = transaction.mutations[0]
      await trpc.boards.update.mutate({
        id: updatedBoard.id,
        data: {
          name: updatedBoard.name,
          color: updatedBoard.color,
        },
      })
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedBoard } = transaction.mutations[0]
      await trpc.boards.delete.mutate({
        id: deletedBoard.id,
      })
    },
  })
)

export const columnCollection = createCollection(
  queryCollectionOptions({
    id: "columns",
    queryKey: ["columns"],
    refetchInterval: 5000,
    queryFn: async () => {
      if (!currentBoardId) return []
      const columns = await trpc.columns.getByBoardId.query({ boardId: currentBoardId })
      return columns
    },
    queryClient,
    schema: selectColumnSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newColumn } = transaction.mutations[0]
      await trpc.columns.create.mutate({
        id: newColumn.id,
        name: newColumn.name,
        order: newColumn.order,
        boardId: newColumn.boardId,
      })
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedColumn } = transaction.mutations[0]
      await trpc.columns.update.mutate({
        id: updatedColumn.id,
        data: {
          name: updatedColumn.name,
          order: updatedColumn.order,
        },
      })
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedColumn } = transaction.mutations[0]
      await trpc.columns.delete.mutate({
        id: deletedColumn.id,
      })
    },
  })
)

export const itemCollection = createCollection(
  queryCollectionOptions({
    id: "items",
    queryKey: ["items"],
    refetchInterval: 5000,
    queryFn: async () => {
      if (!currentBoardId) return []
      const items = await trpc.items.getByBoardId.query({ boardId: currentBoardId })
      return items
    },
    queryClient,
    schema: selectItemSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newItem } = transaction.mutations[0]
      await trpc.items.create.mutate({
        id: newItem.id,
        title: newItem.title,
        content: newItem.content,
        order: newItem.order,
        columnId: newItem.columnId,
        boardId: newItem.boardId,
      })
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedItem } = transaction.mutations[0]
      await trpc.items.update.mutate({
        id: updatedItem.id,
        data: {
          title: updatedItem.title,
          content: updatedItem.content,
          order: updatedItem.order,
          columnId: updatedItem.columnId,
        },
      })
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedItem } = transaction.mutations[0]
      await trpc.items.delete.mutate({
        id: deletedItem.id,
      })
    },
  })
)
