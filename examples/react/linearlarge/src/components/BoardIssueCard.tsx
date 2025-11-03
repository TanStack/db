import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { AlertCircle, ArrowUp, GripVertical, Minus } from 'lucide-react'
import type { Issue } from '@/db/schema'
import { cn } from '@/lib/utils'

interface BoardIssueCardProps {
  issue: Issue
}

export function BoardIssueCard({ issue }: BoardIssueCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        `bg-white rounded-lg border border-gray-200 p-3 cursor-pointer`,
        `hover:border-gray-300 transition-colors`,
        isDragging && `opacity-50`
      )}
    >
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={14} className="text-gray-400" />
        </div>

        <Link
          to="/issue/$issueId"
          params={{ issueId: issue.id }}
          search={(prev) => prev}
          className="flex-1 min-w-0"
        >
          <div className="flex items-center gap-2 mb-1">
            <PriorityIcon priority={issue.priority} />
            <span className="text-sm font-medium truncate">{issue.title}</span>
          </div>
          {issue.description && (
            <p className="text-xs text-gray-500 line-clamp-2">
              {issue.description}
            </p>
          )}
        </Link>
      </div>
    </div>
  )
}

function PriorityIcon({ priority }: { priority: Issue[`priority`] }) {
  switch (priority) {
    case `urgent`:
      return <AlertCircle size={14} className="text-red-600 flex-shrink-0" />
    case `high`:
      return <ArrowUp size={14} className="text-orange-600 flex-shrink-0" />
    case `medium`:
      return <Minus size={14} className="text-yellow-600 flex-shrink-0" />
    case `low`:
      return (
        <ArrowUp size={14} className="text-gray-400 flex-shrink-0 rotate-180" />
      )
    default:
      return <Minus size={14} className="text-gray-300 flex-shrink-0" />
  }
}
