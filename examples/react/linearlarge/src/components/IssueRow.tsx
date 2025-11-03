import type { CSSProperties } from 'react'
import { BsCloudCheck as SyncedIcon } from 'react-icons/bs'
import { BsCloudSlash as UnsyncedIcon } from 'react-icons/bs'
import PriorityMenu from './contextmenu/PriorityMenu'
import StatusMenu from './contextmenu/StatusMenu'
import PriorityIcon from './PriorityIcon'
import StatusIcon from './StatusIcon'
import Avatar from './Avatar'
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { formatDate } from '../utils/date'
import type { Issue } from '@/db/schema'
import { useMode } from '@/lib/mode-context'

interface Props {
  issue: Issue | undefined
  style: CSSProperties
}

function IssueRow({ issue, style }: Props) {
  const { issuesCollection } = useMode()

  const handleChangeStatus = async (status: string) => {
    if (!issue?.id) return
    issuesCollection.update(issue.id, { status: status as Issue['status'] })
  }

  const handleChangePriority = async (priority: string) => {
    if (!issue?.id) return
    issuesCollection.update(issue.id, {
      priority: priority as Issue['priority'],
    })
  }

  if (!issue?.id) {
    return (
      <div
        className="flex items-center flex-grow w-full min-w-0 pl-2 pr-8 text-sm border-b border-gray-100 hover:bg-gray-100 shrink-0"
        style={style}
      >
        <div className="w-full h-full" />
      </div>
    )
  }

  return (
    <div
      key={issue.id}
      className="flex items-center flex-grow w-full min-w-0 pl-2 pr-8 text-sm border-b border-gray-100 hover:bg-gray-100 shrink-0"
      id={issue.id}
      style={style}
    >
      <div className="flex-shrink-0 ml-4">
        <PriorityMenu
          id={`r-priority-` + issue.id}
          button={<PriorityIcon priority={issue.priority} />}
          onSelect={handleChangePriority}
        />
      </div>
      <div className="flex-shrink-0 ml-3">
        <StatusMenu
          id={`r-status-` + issue.id}
          button={<StatusIcon status={issue.status} />}
          onSelect={handleChangeStatus}
        />
      </div>
      <Link
        to="/issue/$issueId"
        params={{ issueId: issue.id }}
        search={(prev) => prev}
        className="flex items-center flex-grow min-w-0 h-full"
      >
        <div className="flex-wrap flex-shrink ml-3 overflow-hidden font-medium line-clamp-1 overflow-ellipsis">
          {issue.title.slice(0, 3000) || ''}
        </div>
        <div className="flex-shrink-0 hidden w-15 ml-auto font-normal text-gray-500 sm:block whitespace-nowrap">
          {formatDate(issue.created_at)}
        </div>
        <div className="flex-shrink-0 hidden ml-4 font-normal text-gray-500 sm:block w-15 md:block">
          <Avatar name={issue.username} />
        </div>
        {/* Sync status - will be implemented with Electric mode */}
        {/* <div className="flex-shrink-0 hidden ml-4 font-normal text-gray-500 sm:block w-15 md:block">
          {issue.synced ? (
            <SyncedIcon className="text-green-500 w-4 h-4" />
          ) : (
            <UnsyncedIcon className="text-orange-500 w-4 h-4" />
          )}
        </div> */}
      </Link>
    </div>
  )
}

export default memo(IssueRow)
