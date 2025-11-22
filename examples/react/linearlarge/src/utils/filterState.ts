import { useNavigate, useSearch } from '@tanstack/react-router'

export interface FilterState {
  orderBy: string
  orderDirection: `asc` | `desc`
  status?: string[]
  priority?: string[]
  query?: string
}

export function getFilterStateFromSearch(search: any): FilterState {
  const orderBy = search?.orderBy ?? `created_at`
  const orderDirection = (search?.orderDirection as `asc` | `desc`) ?? `desc`

  // Handle both comma-separated string and array formats
  let status: string[] = []
  if (search?.status) {
    if (typeof search.status === 'string') {
      status = search.status.toLowerCase().split(',').filter(Boolean)
    } else if (Array.isArray(search.status)) {
      status = search.status.map((s: string) => s.toLowerCase())
    }
  }

  let priority: string[] = []
  if (search?.priority) {
    if (typeof search.priority === 'string') {
      priority = search.priority.toLowerCase().split(',').filter(Boolean)
    } else if (Array.isArray(search.priority)) {
      priority = search.priority.map((p: string) => p.toLowerCase())
    }
  }

  const query = search?.q || search?.query || undefined

  return {
    orderBy,
    orderDirection,
    status: status.length > 0 ? status : undefined,
    priority: priority.length > 0 ? priority : undefined,
    query,
  }
}

export function useFilterState(): [
  FilterState,
  (state: Partial<FilterState>) => void,
] {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const state = getFilterStateFromSearch(search)

  const setState = (newState: Partial<FilterState>) => {
    navigate({
      search: (prev) => ({
        ...prev,
        orderBy: newState.orderBy ?? prev.orderBy,
        orderDirection: newState.orderDirection ?? prev.orderDirection,
        status: newState.status && newState.status.length > 0
          ? newState.status.join(',')
          : undefined,
        priority: newState.priority && newState.priority.length > 0
          ? newState.priority.join(',')
          : undefined,
        q: newState.query || undefined,
      }),
    })
  }

  return [state, setState]
}

export function filterStateToSql(filterState: FilterState) {
  let i = 1
  const sqlWhere = []
  const sqlParams = []
  if (filterState.status?.length) {
    sqlWhere.push(
      `status IN (${filterState.status.map(() => `$${i++}`).join(` ,`)})`
    )
    sqlParams.push(...filterState.status)
  }
  if (filterState.priority?.length) {
    sqlWhere.push(
      `priority IN (${filterState.priority.map(() => `$${i++}`).join(` ,`)})`
    )
    sqlParams.push(...filterState.priority)
  }
  if (filterState.query) {
    sqlWhere.push(`
      (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || 
       setweight(to_tsvector('simple', coalesce(description, '')), 'B'))
      @@ plainto_tsquery('simple', $${i++})
    `)
    sqlParams.push(filterState.query)
  }
  const sql = `
    SELECT id, title, priority, status, modified, created, kanbanorder, username, synced
    FROM issue
    WHERE
      ${sqlWhere.length ? `${sqlWhere.join(` AND `)} AND ` : ``}
      deleted = false
    ORDER BY
      ${filterState.orderBy} ${filterState.orderDirection},
      id ASC
  `
  return { sql, sqlParams }
}
