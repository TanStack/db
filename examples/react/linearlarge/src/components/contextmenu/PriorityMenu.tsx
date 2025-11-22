import { useState } from 'react'
import { connectMenu, type ConnectMenuProps } from '@firefox-devtools/react-contextmenu'
import type { Collection } from '@tanstack/db'
import type { Issue } from '@/db/schema'
import { Menu } from './menu'
import { PriorityOptions } from '../../types/types'
import { Portal } from '../Portal'

export const PRIORITY_MENU_ID = 'priority-menu'

interface PriorityMenuProps extends ConnectMenuProps {
  issuesCollection: Collection<Issue>
}

function PriorityMenuBase({ trigger, issuesCollection }: PriorityMenuProps) {
  const [keyword, setKeyword] = useState(``)
  const data = (trigger?.data || {}) as {
    issueId?: string
    priority?: Issue['priority']
  }

  const handleSelect = async (priority: string) => {
    setKeyword(``)
    if (!data.issueId) return
    await issuesCollection.update(data.issueId, {
      priority: priority as Issue['priority'],
    })
  }

  let statusOpts = PriorityOptions
  if (keyword !== ``) {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statusOpts = statusOpts.filter(
      ([_Icon, _priority, label]) =>
        (label as string).toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  const options = statusOpts.map(([Icon, priority, label]) => {
    const isActive = data.priority === priority
    return (
      <Menu.Item
        key={`priority-${priority}`}
        onClick={() => handleSelect(priority as string)}
      >
        <Icon className="mr-3" />
        <span className={isActive ? 'font-semibold text-gray-800' : undefined}>
          {label}
        </span>
      </Menu.Item>
    )
  })

  return (
    <Portal>
      <Menu
        id={PRIORITY_MENU_ID}
        size="small"
        filterKeyword={true}
        searchPlaceholder="Set priority..."
        onKeywordChange={(kw) => setKeyword(kw)}
        className="max-h-[60vh] overflow-y-auto"
      >
        {options}
      </Menu>
    </Portal>
  )
}

const PriorityMenu = connectMenu(PRIORITY_MENU_ID)(PriorityMenuBase)

export default PriorityMenu
