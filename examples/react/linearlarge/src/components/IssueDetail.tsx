import { eq, useLiveQuery, usePacedMutations, debounceStrategy } from '@tanstack/react-db'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Editor } from './Editor'
import { Comments } from './Comments'
import type { Priority, Status } from '@/db/schema'
import { cn } from '@/lib/utils'
import { useMode } from '@/lib/mode-context'
import { useUser } from '@/lib/user-context'

interface IssueDetailProps {
  issueId: string
}

export function IssueDetail({ issueId }: IssueDetailProps) {
  const { issuesCollection } = useMode()
  const { user } = useUser()

  const { data: issues } = useLiveQuery((q) =>
    q
      .from({ issue: issuesCollection })
      .where(({ issue }) => eq(issue.id, issueId))
  )

  const issue = issues?.[0]
  const isOwner = user && issue && issue.user_id === user.id

  const [title, setTitle] = useState(issue?.title ?? ``)
  const [description, setDescription] = useState(issue?.description ?? ``)

  useEffect(() => {
    if (issue) {
      setTitle(issue.title)
      setDescription(issue.description)
    }
  }, [issue?.id])

  const mutateTitle = usePacedMutations<{ issueId: string; title: string }>({
    onMutate: ({ issueId, title }) => {
      if (!title.trim()) return
      issuesCollection.update(issueId, (draft) => {
        draft.title = title
        draft.modified = new Date()
      })
    },
    mutationFn: async ({ transaction }) => {
      if (!user) return
      const mutations = transaction.mutations
      const latest = mutations[mutations.length - 1].modified

      await fetch('/api/issues/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          'x-user-name': user.username,
        },
        body: JSON.stringify({
          id: latest.id,
          title: latest.title,
        }),
      })
    },
    strategy: debounceStrategy({ wait: 500 }),
  })

  const mutateDescription = usePacedMutations<{ issueId: string; description: string }>({
    onMutate: ({ issueId, description }) => {
      issuesCollection.update(issueId, (draft) => {
        draft.description = description
        draft.modified = new Date()
      })
    },
    mutationFn: async ({ transaction }) => {
      if (!user) return
      const mutations = transaction.mutations
      const latest = mutations[mutations.length - 1].modified

      await fetch('/api/issues/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          'x-user-name': user.username,
        },
        body: JSON.stringify({
          id: latest.issueId,
          description: latest.description,
        }),
      })
    },
    strategy: debounceStrategy({ wait: 500 }),
  })

  const handleStatusChange = (newStatus: Status) => {
    if (!issue) return
    issuesCollection.update(issue.id, (draft) => {
      draft.status = newStatus
      draft.modified = new Date()
    })
  }

  const handlePriorityChange = (newPriority: Priority) => {
    if (!issue) return
    issuesCollection.update(issue.id, (draft) => {
      draft.priority = newPriority
      draft.modified = new Date()
    })
  }

  if (!issue) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Issue not found</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link
        to="/"
        search={(prev) => prev}
        className={cn(
          `inline-flex items-center gap-2 text-sm text-gray-600`,
          `hover:text-gray-900 mb-6`
        )}
      >
        <ArrowLeft size={16} />
        Back to issues
      </Link>

      <input
        type="text"
        value={title}
        onChange={(e) => {
          const newTitle = e.target.value
          setTitle(newTitle)
          if (issue && user && isOwner) {
            mutateTitle({
              issueId: issue.id,
              title: newTitle,
            })
          }
        }}
        disabled={!isOwner}
        className={cn(
          `text-3xl font-bold w-full mb-4`,
          `border-none outline-none focus:ring-0`,
          `placeholder-gray-400`,
          !isOwner && `opacity-60 cursor-not-allowed`
        )}
        placeholder="Issue title"
      />

      <div className="flex gap-3 mb-8">
        <select
          value={issue.status}
          onChange={(e) => handleStatusChange(e.target.value as Status)}
          disabled={!isOwner}
          className={cn(
            `px-3 py-1.5 border border-gray-300 rounded-md text-sm`,
            `focus:outline-none focus:ring-2 focus:ring-blue-500`,
            !isOwner && `opacity-60 cursor-not-allowed`
          )}
        >
          <option value="backlog">Backlog</option>
          <option value="todo">Todo</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="canceled">Canceled</option>
        </select>

        <select
          value={issue.priority}
          onChange={(e) => handlePriorityChange(e.target.value as Priority)}
          disabled={!isOwner}
          className={cn(
            `px-3 py-1.5 border border-gray-300 rounded-md text-sm`,
            `focus:outline-none focus:ring-2 focus:ring-blue-500`,
            !isOwner && `opacity-60 cursor-not-allowed`
          )}
        >
          <option value="none">No Priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">Description</h3>
        {isOwner ? (
          <Editor
            content={description}
            onChange={(newDescription) => {
              setDescription(newDescription)
              if (issue && user) {
                mutateDescription({
                  issueId: issue.id,
                  description: newDescription,
                })
              }
            }}
          />
        ) : (
          <div className="prose max-w-none p-4 bg-gray-50 rounded-lg border border-gray-200">
            {description || (
              <span className="text-gray-400 italic">No description</span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-8">
        <Comments issueId={issue.id} />
      </div>
    </div>
  )
}
