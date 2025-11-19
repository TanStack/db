import { createFileRoute } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { IssueList } from '@/components/IssueList'
import { preloadIssuesList } from '@/lib/queries'

export const Route = createFileRoute(`/_authenticated/`)({
  loader: async ({ context }) => {
    const mode = context.search?.mode === 'electric' ? 'electric' : 'query'
    await preloadIssuesList(mode)
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
