import { useState } from 'react'
import { connectMenu, type ConnectMenuProps } from '@firefox-devtools/react-contextmenu'
import type { Collection } from '@tanstack/db'
import type { Issue } from '@/db/schema'
import { StatusOptions } from '../../types/types'
import { Menu } from './menu'
import { Portal } from '../Portal'

export const STATUS_MENU_ID = 'status-menu'

interface StatusMenuProps extends ConnectMenuProps {
  issuesCollection: Collection<Issue>
}

function StatusMenuBase({ trigger, issuesCollection }: StatusMenuProps) {
  const [keyword, setKeyword] = useState(``)
  const data = (trigger?.data || {}) as {
    issueId?: string
    status?: Issue['status']
  }

  const handleSelect = async (status: string) => {
    setKeyword(``)
    if (!data.issueId) return
    await issuesCollection.update(data.issueId, {
      status: status as Issue['status'],
    })
  }

  let statuses = StatusOptions
  if (keyword !== ``) {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statuses = statuses.filter(
      ([_icon, _id, l]) => l.toLowerCase().indexOf(normalizedKeyword) !== -1
    )
  }

  const options = statuses.map(([Icon, id, label]) => {
    const isActive = data.status === id
    return (
      <Menu.Item key={`status-${id}`} onClick={() => handleSelect(id)}>
        <Icon className="mr-3" />
        <div
          className={`flex-1 overflow-hidden ${
            isActive ? 'font-semibold text-gray-800' : ''
          }`}
        >
          {label}
        </div>
      </Menu.Item>
    )
  })

  return (
    <Portal>
      <Menu
        id={STATUS_MENU_ID}
        size="normal"
        filterKeyword={true}
        className="max-h-[60vh] overflow-y-auto"
        searchPlaceholder="Set status..."
        onKeywordChange={(kw) => setKeyword(kw)}
      >
        {options}
      </Menu>
    </Portal>
  )
}

const StatusMenu = connectMenu(STATUS_MENU_ID)(StatusMenuBase)

export default StatusMenu
