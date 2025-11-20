import { createFileRoute } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { IssueList } from '@/components/IssueList'
import { preloadIssuesList } from '@/lib/queries'
import { getFilterStateFromSearch } from '@/utils/filterState'

export const Route = createFileRoute(`/_authenticated/`)({
  loader: async ({ context }) => {
    const mode = context.search?.mode === 'electric' ? 'electric' : 'query'
    const filterState = getFilterStateFromSearch(context.search || {})

    await preloadIssuesList(
      {
        status: filterState.status,
        priority: filterState.priority,
        orderBy: filterState.orderBy,
        orderDirection: filterState.orderDirection,
      },
      mode
    )
  },
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
