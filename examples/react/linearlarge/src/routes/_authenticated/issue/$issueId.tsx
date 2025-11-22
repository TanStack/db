import { createFileRoute } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { IssueDetail } from '@/components/IssueDetail'
import { preloadIssue, preloadComments } from '@/lib/queries'

export const Route = createFileRoute(`/_authenticated/issue/$issueId`)({
  loader: async ({ params, context }) => {
    const mode = context.search?.mode === 'electric' ? 'electric' : 'query'
    await Promise.all([
      preloadIssue(params.issueId, mode),
      preloadComments(params.issueId, mode),
    ])
  },
  component: IssueDetailPage,
})

function IssueDetailPage() {
  const { issueId } = Route.useParams()

  return (
    <>
      <LeftMenu />
      <div className="flex-1 overflow-auto">
        <IssueDetail issueId={issueId} />
      </div>
    </>
  )
}
