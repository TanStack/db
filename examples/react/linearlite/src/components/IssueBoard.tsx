import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { generateKeyBetween } from 'fractional-indexing'
import { BoardColumn } from './BoardColumn'
import type { DragEndEvent } from '@dnd-kit/core'
import type { Status } from '@/db/schema'
import { useMode } from '@/lib/mode-context'

const STATUSES: Array<Status> = [
  `backlog`,
  `todo`,
  `in_progress`,
  `done`,
  `canceled`,
]

export function IssueBoard() {
  const { issuesCollection } = useMode()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const issueId = active.id as string
    const newStatus = over.id as Status

    // Update issue status
    issuesCollection.update(issueId, (draft) => {
      draft.status = newStatus
      // Generate new kanbanorder
      // In a real implementation, we'd calculate this based on drop position
      draft.kanbanorder = generateKeyBetween(null, null)
      draft.modified = new Date()
    })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 p-4 overflow-x-auto h-full">
        {STATUSES.map((status) => (
          <BoardColumn key={status} status={status} />
        ))}
      </div>
      <DragOverlay>{null}</DragOverlay>
    </DndContext>
  )
}
