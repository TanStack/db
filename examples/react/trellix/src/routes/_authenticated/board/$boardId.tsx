import { useEffect, useState, useRef, useCallback } from "react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { eq } from "@tanstack/react-db"
import { authClient } from "@/lib/auth-client"
import {
  boardCollection,
  columnCollection,
  itemCollection,
  setCurrentBoardId,
} from "@/lib/collections"

export const Route = createFileRoute(`/_authenticated/board/$boardId`)({
  component: BoardPage,
  ssr: false,
  beforeLoad: async () => {
    const res = await authClient.getSession()
    if (!res.data?.session) {
      throw redirect({
        to: `/login`,
      })
    }
  },
  loader: async ({ params }) => {
    const boardId = parseInt(params.boardId)
    setCurrentBoardId(boardId)
    await boardCollection.preload()
    await columnCollection.preload()
    await itemCollection.preload()
    return { boardId }
  },
})

// Types for drag and drop
type DragItem = {
  id: string
  type: "card" | "column"
  title?: string
  order: number
  columnId?: string
}

function BoardPage() {
  const { boardId } = Route.useLoaderData()
  const navigate = useNavigate()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Get board data
  const { data: boards } = useLiveQuery((q) =>
    q.from({ boardCollection }).where(({ boardCollection }) =>
      eq(boardCollection.id, boardId)
    )
  )
  const board = boards[0]

  // Get columns for this board
  const { data: columns } = useLiveQuery((q) =>
    q.from({ columnCollection })
      .where(({ columnCollection }) => eq(columnCollection.boardId, boardId))
      .orderBy(({ columnCollection }) => columnCollection.order)
  )

  // Get all items for this board
  const { data: items } = useLiveQuery((q) =>
    q.from({ itemCollection })
      .where(({ itemCollection }) => eq(itemCollection.boardId, boardId))
      .orderBy(({ itemCollection }) => itemCollection.order)
  )

  // Redirect if board not found
  useEffect(() => {
    if (boards.length === 0 && board === undefined) {
      const timeout = setTimeout(() => {
        navigate({ to: `/` })
      }, 100)
      return () => clearTimeout(timeout)
    }
  }, [boards, board, navigate])

  // Board name editing
  const handleUpdateBoardName = (newName: string) => {
    if (board && newName.trim()) {
      boardCollection.update(board.id, (draft) => {
        draft.name = newName.trim()
      })
    }
  }

  // Column operations
  const handleCreateColumn = () => {
    const columnId = crypto.randomUUID()
    const maxOrder = columns.length > 0
      ? Math.max(...columns.map((c) => c.order))
      : 0

    columnCollection.insert({
      id: columnId,
      name: "New Column",
      order: maxOrder + 1,
      boardId,
    })

    // Scroll to the new column
    setTimeout(() => {
      scrollContainerRef.current?.scrollTo({
        left: scrollContainerRef.current.scrollWidth,
        behavior: "smooth",
      })
    }, 100)
  }

  const handleUpdateColumnName = (columnId: string, newName: string) => {
    if (newName.trim()) {
      columnCollection.update(columnId, (draft) => {
        draft.name = newName.trim()
      })
    }
  }

  const handleDeleteColumn = (columnId: string) => {
    if (confirm("Delete this column and all its cards?")) {
      // Delete all items in the column first
      const columnItems = items.filter((item) => item.columnId === columnId)
      columnItems.forEach((item) => {
        itemCollection.delete(item.id)
      })
      columnCollection.delete(columnId)
    }
  }

  // Item operations
  const handleCreateItem = (columnId: string) => {
    const columnItems = items.filter((item) => item.columnId === columnId)
    const maxOrder = columnItems.length > 0
      ? Math.max(...columnItems.map((i) => i.order))
      : 0

    const itemId = crypto.randomUUID()
    itemCollection.insert({
      id: itemId,
      title: "New Card",
      content: null,
      order: maxOrder + 1,
      columnId,
      boardId,
    })
  }

  const handleUpdateItemTitle = (itemId: string, newTitle: string) => {
    if (newTitle.trim()) {
      itemCollection.update(itemId, (draft) => {
        draft.title = newTitle.trim()
      })
    }
  }

  const handleDeleteItem = (itemId: string) => {
    itemCollection.delete(itemId)
  }

  const handleMoveItem = (itemId: string, newColumnId: string, newOrder: number) => {
    itemCollection.update(itemId, (draft) => {
      draft.columnId = newColumnId
      draft.order = newOrder
    })
  }

  if (!board) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Loading board...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Board Header */}
      <div className="mb-4 flex items-center gap-4">
        <EditableText
          value={board.name}
          onSave={handleUpdateBoardName}
          className="text-2xl font-bold text-white"
        />
        <div
          className="w-6 h-6 rounded"
          style={{ backgroundColor: board.color }}
        />
      </div>

      {/* Columns Container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex gap-4 overflow-x-auto pb-4"
      >
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            items={items.filter((item) => item.columnId === column.id)}
            onUpdateName={handleUpdateColumnName}
            onDelete={handleDeleteColumn}
            onCreateItem={handleCreateItem}
            onUpdateItemTitle={handleUpdateItemTitle}
            onDeleteItem={handleDeleteItem}
            onMoveItem={handleMoveItem}
          />
        ))}

        {/* Add Column Button */}
        <button
          onClick={handleCreateColumn}
          className="flex-shrink-0 w-72 h-12 flex items-center justify-center bg-slate-800/50 hover:bg-slate-800 border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          + Add Column
        </button>
      </div>
    </div>
  )
}

// Column Component
interface ColumnProps {
  column: { id: string; name: string; order: number; boardId: number }
  items: Array<{ id: string; title: string; content: string | null; order: number; columnId: string; boardId: number }>
  onUpdateName: (columnId: string, name: string) => void
  onDelete: (columnId: string) => void
  onCreateItem: (columnId: string) => void
  onUpdateItemTitle: (itemId: string, title: string) => void
  onDeleteItem: (itemId: string) => void
  onMoveItem: (itemId: string, columnId: string, order: number) => void
}

function Column({
  column,
  items,
  onUpdateName,
  onDelete,
  onCreateItem,
  onUpdateItemTitle,
  onDeleteItem,
  onMoveItem,
}: ColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const sortedItems = [...items].sort((a, b) => a.order - b.order)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const data = e.dataTransfer.getData("application/json")
    if (!data) return

    try {
      const dragItem: DragItem = JSON.parse(data)
      if (dragItem.type === "card") {
        // Calculate new order - place at end of column
        const maxOrder = sortedItems.length > 0
          ? Math.max(...sortedItems.map((i) => i.order))
          : 0
        onMoveItem(dragItem.id, column.id, maxOrder + 1)
      }
    } catch {
      // Invalid drag data
    }
  }

  return (
    <div
      className={`flex-shrink-0 w-72 flex flex-col bg-slate-800 rounded-lg border ${
        isDragOver ? "border-blue-500" : "border-slate-700"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <EditableText
          value={column.name}
          onSave={(name) => onUpdateName(column.id, name)}
          className="font-medium text-white flex-1"
        />
        <button
          onClick={() => onDelete(column.id)}
          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
          title="Delete column"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {sortedItems.map((item) => (
          <Card
            key={item.id}
            item={item}
            onUpdateTitle={onUpdateItemTitle}
            onDelete={onDeleteItem}
            onMoveItem={onMoveItem}
            allItems={sortedItems}
          />
        ))}
      </div>

      {/* Add Card Button */}
      <button
        onClick={() => onCreateItem(column.id)}
        className="m-2 p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors text-sm"
      >
        + Add Card
      </button>
    </div>
  )
}

// Card Component
interface CardProps {
  item: { id: string; title: string; content: string | null; order: number; columnId: string; boardId: number }
  onUpdateTitle: (itemId: string, title: string) => void
  onDelete: (itemId: string) => void
  onMoveItem: (itemId: string, columnId: string, order: number) => void
  allItems: Array<{ id: string; order: number }>
}

function Card({ item, onUpdateTitle, onDelete, onMoveItem, allItems }: CardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dropPosition, setDropPosition] = useState<"top" | "bottom" | null>(null)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    const dragData: DragItem = {
      id: item.id,
      type: "card",
      title: item.title,
      order: item.order,
      columnId: item.columnId,
    }
    e.dataTransfer.setData("application/json", JSON.stringify(dragData))
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    setDropPosition(e.clientY < midY ? "top" : "bottom")
  }

  const handleDragLeave = () => {
    setDropPosition(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropPosition(null)

    const data = e.dataTransfer.getData("application/json")
    if (!data) return

    try {
      const dragItem: DragItem = JSON.parse(data)
      if (dragItem.type === "card" && dragItem.id !== item.id) {
        // Calculate new order based on drop position
        const currentIndex = allItems.findIndex((i) => i.id === item.id)
        const prevItem = currentIndex > 0 ? allItems[currentIndex - 1] : null
        const nextItem = currentIndex < allItems.length - 1 ? allItems[currentIndex + 1] : null

        let newOrder: number
        if (dropPosition === "top") {
          newOrder = prevItem
            ? (prevItem.order + item.order) / 2
            : item.order - 1
        } else {
          newOrder = nextItem
            ? (item.order + nextItem.order) / 2
            : item.order + 1
        }

        onMoveItem(dragItem.id, item.columnId, newOrder)
      }
    } catch {
      // Invalid drag data
    }
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative p-3 bg-slate-700 rounded-lg border cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? "opacity-50 scale-95" : ""
      } ${
        dropPosition === "top"
          ? "border-t-2 border-t-blue-500 border-slate-600"
          : dropPosition === "bottom"
          ? "border-b-2 border-b-blue-500 border-slate-600"
          : "border-slate-600 hover:border-slate-500"
      }`}
    >
      <EditableText
        value={item.title}
        onSave={(title) => onUpdateTitle(item.id, title)}
        className="text-sm text-white pr-6"
      />
      {item.content && (
        <p className="mt-1 text-xs text-slate-400 line-clamp-2">{item.content}</p>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(item.id)
        }}
        className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete card"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  )
}

// Editable Text Component
interface EditableTextProps {
  value: string
  onSave: (value: string) => void
  className?: string
}

function EditableText({ value, onSave, className = "" }: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = useCallback(() => {
    if (editValue.trim() && editValue !== value) {
      onSave(editValue.trim())
    } else {
      setEditValue(value)
    }
    setIsEditing(false)
  }, [editValue, value, onSave])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave()
    } else if (e.key === "Escape") {
      setEditValue(value)
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`bg-transparent border-b border-blue-500 outline-none ${className}`}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setEditValue(value)
        setIsEditing(true)
      }}
      className={`cursor-pointer hover:opacity-80 ${className}`}
    >
      {value}
    </span>
  )
}
