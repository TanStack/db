import { eq, useLiveQuery } from '@tanstack/react-db'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { BoardIssueCard } from './BoardIssueCard'
import type { Status } from '@/db/schema'
import { useMode } from '@/lib/mode-context'
import { cn } from '@/lib/utils'

interface BoardColumnProps {
  status: Status
}

const STATUS_LABELS: Record<Status, string> = {
  backlog: `Backlog`,
  todo: `Todo`,
  in_progress: `In Progress`,
  done: `Done`,
  canceled: `Canceled`,
}

const STATUS_COLORS: Record<Status, string> = {
  backlog: `bg-gray-100 text-gray-700`,
  todo: `bg-blue-100 text-blue-700`,
  in_progress: `bg-purple-100 text-purple-700`,
  done: `bg-green-100 text-green-700`,
  canceled: `bg-gray-100 text-gray-500`,
}

export function BoardColumn({ status }: BoardColumnProps) {
  const { issuesCollection } = useMode()

  const { data: issues } = useLiveQuery((q) =>
    q
      .from({ issue: issuesCollection })
      .where(({ issue }) => eq(issue.status, status))
      .orderBy(({ issue }) => issue.kanbanorder, `asc`)
  )

  const { setNodeRef } = useDroppable({
    id: status,
  })

  const issueIds = issues?.map((issue) => issue.id) ?? []

  return (
    <div className="flex flex-col w-80 bg-gray-50 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">
              {STATUS_LABELS[status]}
            </span>
            <span
              className={cn(
                `px-2 py-0.5 rounded text-xs font-medium`,
                STATUS_COLORS[status]
              )}
            >
              {issues?.length ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px]"
      >
        <SortableContext
          items={issueIds}
          strategy={verticalListSortingStrategy}
        >
          {issues?.map((issue) => (
            <BoardIssueCard key={issue.id} issue={issue} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}
