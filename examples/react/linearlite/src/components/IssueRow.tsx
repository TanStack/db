import { Link } from '@tanstack/react-router'
import { AlertCircle, ArrowUp, CheckCircle2, Circle, Minus } from 'lucide-react'
import type { Issue } from '@/db/schema'
import { cn } from '@/lib/utils'

interface IssueRowProps {
  issue: Issue
}

export function IssueRow({ issue }: IssueRowProps) {
  return (
    <Link
      to="/issue/$issueId"
      params={{ issueId: issue.id }}
      className={cn(
        `flex items-center gap-3 px-6 py-3 border-b border-gray-100`,
        `hover:bg-gray-50 transition-colors cursor-pointer`
      )}
    >
      <StatusIcon status={issue.status} />
      <PriorityIcon priority={issue.priority} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{issue.title}</span>
        </div>
        {issue.description && (
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {issue.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>{new Date(issue.created_at).toLocaleDateString()}</span>
      </div>
    </Link>
  )
}

function StatusIcon({ status }: { status: Issue[`status`] }) {
  switch (status) {
    case `done`:
      return <CheckCircle2 size={16} className="text-green-600" />
    case `in_progress`:
      return <Circle size={16} className="text-blue-600 fill-blue-600" />
    case `todo`:
      return <Circle size={16} className="text-gray-400" />
    case `canceled`:
      return <Circle size={16} className="text-gray-300" />
    default:
      return <Circle size={16} className="text-gray-300" />
  }
}

function PriorityIcon({ priority }: { priority: Issue[`priority`] }) {
  switch (priority) {
    case `urgent`:
      return <AlertCircle size={16} className="text-red-600" />
    case `high`:
      return <ArrowUp size={16} className="text-orange-600" />
    case `medium`:
      return <Minus size={16} className="text-yellow-600" />
    case `low`:
      return <ArrowUp size={16} className="text-gray-400 rotate-180" />
    default:
      return <Minus size={16} className="text-gray-300" />
  }
}
