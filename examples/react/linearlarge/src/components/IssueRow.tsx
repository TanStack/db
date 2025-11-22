import type { CSSProperties } from 'react'
import PriorityIcon from './PriorityIcon'
import StatusIcon from './StatusIcon'
import Avatar from './Avatar'
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import { formatDate } from '../utils/date'
import type { Issue } from '@/db/schema'
import { PRIORITY_MENU_ID } from './contextmenu/PriorityMenu'
import { STATUS_MENU_ID } from './contextmenu/StatusMenu'

interface Props {
  issue: Issue | undefined
  style: CSSProperties
}

function IssueRow({ issue, style }: Props) {
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
      <ContextMenuTrigger
        id={PRIORITY_MENU_ID}
        collect={() => ({ issueId: issue.id, priority: issue.priority })}
        holdToDisplay={-1}
        triggerOnLeftClick
        attributes={{ className: 'flex-shrink-0 ml-4 cursor-pointer' }}
      >
        <PriorityIcon priority={issue.priority} />
      </ContextMenuTrigger>
      <ContextMenuTrigger
        id={STATUS_MENU_ID}
        collect={() => ({ issueId: issue.id, status: issue.status })}
        holdToDisplay={-1}
        triggerOnLeftClick
        attributes={{ className: 'flex-shrink-0 ml-3 cursor-pointer' }}
      >
        <StatusIcon status={issue.status} />
      </ContextMenuTrigger>
      <Link
        to="/issue/$issueId"
        params={{ issueId: issue.id }}
        search={(prev) => prev}
        className="flex items-center flex-grow min-w-0 h-full"
      >
        <div className="flex-wrap flex-shrink ml-3 overflow-hidden font-medium line-clamp-1 overflow-ellipsis">
          {issue.title || ''}
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
