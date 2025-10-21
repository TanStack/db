import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { LeftMenu } from '@/components/LeftMenu'
import { TopFilter } from '@/components/TopFilter'
import { IssueBoard } from '@/components/IssueBoard'
import { useMode } from '@/lib/mode-context'

export const Route = createFileRoute(`/_authenticated/board`)({
  component: BoardPage,
})

function BoardPage() {
  const { issuesCollection } = useMode()

  const { data: issues } = useLiveQuery((q) =>
    q.from({ issue: issuesCollection })
  )

  return (
    <>
      <LeftMenu />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopFilter hideSort issueCount={issues?.length ?? 0} />
        <IssueBoard />
      </div>
    </>
  )
}
