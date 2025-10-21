import { createFileRoute } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { IssueDetail } from '@/components/IssueDetail'

export const Route = createFileRoute(`/_authenticated/issue/$issueId`)({
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
