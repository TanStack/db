import { useState } from 'react'
import { ChevronDown, Filter } from 'lucide-react'
import type { Priority, Status } from '@/db/schema'
import { cn } from '@/lib/utils'

interface TopFilterProps {
  hideSort?: boolean
  issueCount?: number
}

export function TopFilter({ hideSort, issueCount = 0 }: TopFilterProps) {
  const [selectedStatuses, _setSelectedStatuses] = useState<Array<Status>>([])
  const [selectedPriorities, _setSelectedPriorities] = useState<
    Array<Priority>
  >([])

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            {issueCount} {issueCount === 1 ? `issue` : `issues`}
          </div>

          <button
            className={cn(
              `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm`,
              `border border-gray-300 hover:bg-gray-50 transition-colors`
            )}
          >
            <Filter size={14} />
            Filter
            <ChevronDown size={14} />
          </button>

          {selectedStatuses.map((status) => (
            <div
              key={status}
              className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium"
            >
              {status.replace(`_`, ` `)}
            </div>
          ))}

          {selectedPriorities.map((priority) => (
            <div
              key={priority}
              className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium"
            >
              {priority}
            </div>
          ))}
        </div>

        {!hideSort && (
          <select className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white">
            <option>Sort by: Created</option>
            <option>Sort by: Modified</option>
            <option>Sort by: Priority</option>
            <option>Sort by: Status</option>
          </select>
        )}
      </div>
    </div>
  )
}
