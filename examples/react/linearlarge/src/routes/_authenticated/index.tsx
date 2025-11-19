import { createFileRoute } from '@tanstack/react-router'
import { LeftMenu } from '@/components/LeftMenu'
import { IssueList } from '@/components/IssueList'

export const Route = createFileRoute(`/_authenticated/`)({
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
