import { createFileRoute } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { IssueList } from '@/components/IssueList'
import { preloadIssuesList, preloadIssueCount } from '@/lib/queries'
import { getFilterStateFromSearch } from '@/utils/filterState'

export const Route = createFileRoute(`/_authenticated/`)({
  loader: async ({ search }) => {
    const mode = search?.mode === 'electric' ? 'electric' : 'query'
    const filterState = getFilterStateFromSearch(search || {})

    await Promise.all([
      preloadIssuesList(
        {
          status: filterState.status,
          priority: filterState.priority,
          orderBy: filterState.orderBy,
          orderDirection: filterState.orderDirection,
        },
        mode
      ),
      preloadIssueCount({
        status: filterState.status,
        priority: filterState.priority,
      }),
    ])

    return {}
  },
  loaderDeps: ({ search }) => ({
    mode: search?.mode,
    status: search?.status,
    priority: search?.priority,
    orderBy: search?.orderBy,
    orderDirection: search?.orderDirection,
  }),
  component: IssuesPage,
})

function IssuesPage() {
  return (
    <>
      <LeftMenu />
      <div className="flex-1 flex flex-col overflow-hidden">
        <IssueList />
      </div>
    </>
  )
}
