import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { LeftMenu } from '@/components/LeftMenu'
import { TopFilter } from '@/components/TopFilter'
import { IssueList } from '@/components/IssueList'
import { useMode } from '@/lib/mode-context'

export const Route = createFileRoute(`/_authenticated/issues`)({
  component: IssuesPage,
})

function IssuesPage() {
  const { issuesCollection } = useMode()

  const { data: issues } = useLiveQuery((q) =>
    q.from({ issue: issuesCollection })
  )

  return (
    <>
      <LeftMenu />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopFilter issueCount={issues?.length ?? 0} />
        <IssueList />
      </div>
    </>
  )
}
