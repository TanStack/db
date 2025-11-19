import { BsSortUp, BsPlus, BsX } from 'react-icons/bs'
import FilterMenu from './contextmenu/FilterMenu'
import { useFilterState, type FilterState } from '@/utils/filterState'

interface TopFilterProps {
  hideSort?: boolean
  issueCount?: number | undefined
  title?: string
}

const PriorityDisplay: Record<string, string> = {
  none: 'No Priority',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const StatusDisplay: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  canceled: 'Canceled',
}

export function TopFilter({
  hideSort,
  issueCount,
  title: titleProp = 'All issues',
}: TopFilterProps) {
  const [filterState, setFilterState] = useFilterState()

  let title = titleProp

  // Update title based on active filters
  const eqStatuses = (statuses: string[]) => {
    const statusSet = new Set(statuses)
    return (
      filterState.status?.length === statusSet.size &&
      filterState.status.every((x) => statusSet.has(x))
    )
  }

  if (filterState.status?.length) {
    if (eqStatuses(['backlog'])) {
      title = 'Backlog'
    } else if (eqStatuses(['todo', 'in_progress'])) {
      title = 'Active'
    }
  }

  return (
    <>
      <div className="flex justify-between flex-shrink-0 pl-2 pr-6 border-b border-gray-200 h-14 lg:pl-9">
        {/* left section */}
        <div className="flex items-center">
          <div className="p-1 font-semibold me-1">{title}</div>
          <span>{issueCount !== undefined ? issueCount.toLocaleString() : ''}</span>
          <FilterMenu
            button={
              <button
                type="button"
                className="px-1 py-0.5 ml-3 border border-gray-300 border-dashed rounded text-gray-500 hover:border-gray-400 hover:text-gray-800 flex items-center"
              >
                <BsPlus className="inline" size="16" />
                Filter
              </button>
            }
            id="filter-menu"
          />
        </div>

        <div className="flex items-center">
          {!hideSort && (
            <button
              type="button"
              className="p-2 rounded hover:bg-gray-100"
            >
              <BsSortUp size="16" className="inline" />
            </button>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {(!!filterState.status?.length || !!filterState.priority?.length) && (
        <div className="flex flex-shrink-0 pl-2 pr-6 border-b border-gray-200 lg:pl-9 py-2">
          {!!filterState.priority?.length && (
            <div className="flex pr-4 space-x-[1px]">
              <span className="px-1 bg-gray-300 rounded-l">Priority is</span>
              <span className="px-1 bg-gray-300">
                {filterState.priority
                  ?.map((priority) => PriorityDisplay[priority])
                  .join(', ')}
              </span>
              <span
                className="px-1 bg-gray-300 rounded-r cursor-pointer flex items-center"
                onClick={() => {
                  setFilterState({
                    ...filterState,
                    priority: undefined,
                  })
                }}
              >
                <BsX size={16} />
              </span>
            </div>
          )}
          {!!filterState.status?.length && (
            <div className="flex pr-4 space-x-[1px]">
              <span className="px-1 bg-gray-300 rounded-l">Status is</span>
              <span className="px-1 bg-gray-300">
                {filterState.status
                  ?.map((status) => StatusDisplay[status])
                  .join(', ')}
              </span>
              <span
                className="px-1 bg-gray-300 rounded-r cursor-pointer flex items-center"
                onClick={() => {
                  setFilterState({
                    ...filterState,
                    status: undefined,
                  })
                }}
              >
                <BsX size={16} />
              </span>
            </div>
          )}
        </div>
      )}
    </>
  )
}
