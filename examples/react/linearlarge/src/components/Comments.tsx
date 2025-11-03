import { useEffect, useState } from 'react'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { Send } from 'lucide-react'
import { useMode } from '@/lib/mode-context'
import { useUser } from '@/lib/user-context'
import { cn } from '@/lib/utils'
import Avatar from './Avatar'

interface CommentsProps {
  issueId: string
}

export function Comments({ issueId }: CommentsProps) {
  const { commentsCollection } = useMode()
  const { user } = useUser()
  const [draftCommentId, setDraftCommentId] = useState<string | null>(null)

  // Get all comments for this issue including draft
  const { data: allComments } = useLiveQuery((q) =>
    q
      .from({ comment: commentsCollection })
      .where(({ comment }) => eq(comment.issue_id, issueId))
      .orderBy(({ comment }) => comment.created_at, `asc`)
  )

  // Filter out the draft comment for display
  const comments = allComments?.filter((c) => c.id !== draftCommentId)
  const draft = allComments?.find((c) => c.id === draftCommentId)

  // Initialize draft
  useEffect(() => {
    if (!draftCommentId && user) {
      const newDraftId = `draft-${issueId}-${crypto.randomUUID()}`
      setDraftCommentId(newDraftId)

      // Insert draft directly into collection
      commentsCollection.insert({
        id: newDraftId,
        body: '',
        issue_id: issueId,
        user_id: user.id,
        username: user.username,
        created_at: new Date(),
        modified: new Date(),
      })
    }
  }, [draftCommentId, user, issueId, commentsCollection])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft || !draft.body.trim() || !user) return

    // Draft is already in collection and will persist automatically
    // Create a new draft for the next comment
    const newDraftId = `draft-${issueId}-${crypto.randomUUID()}`
    setDraftCommentId(newDraftId)

    commentsCollection.insert({
      id: newDraftId,
      body: '',
      issue_id: issueId,
      user_id: user.id,
      username: user.username,
      created_at: new Date(),
      modified: new Date(),
    })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Comments</h3>

      <div className="space-y-3">
        {comments?.map((comment) => (
          <div
            key={comment.id}
            className="bg-gray-50 rounded-lg p-4 border border-gray-200"
          >
            <div className="flex items-center gap-2 mb-2">
              <Avatar name={comment.username} />
              <span className="text-sm font-medium text-gray-700">
                {comment.username}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(comment.created_at).toLocaleDateString()}
              </span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {comment.body}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={draft?.body ?? ''}
          onChange={(e) => {
            const value = e.target.value
            if (draft) {
              commentsCollection.update(draft.id, (d) => {
                d.body = value
              })
            }
          }}
          placeholder="Add a comment..."
          className={cn(
            `flex-1 px-4 py-2 border border-gray-300 rounded-lg`,
            `focus:outline-none focus:ring-2 focus:ring-blue-500`
          )}
        />
        <button
          type="submit"
          disabled={!draft?.body.trim()}
          className={cn(
            `px-4 py-2 bg-primary text-white rounded-lg`,
            `hover:opacity-90 transition-opacity`,
            `disabled:opacity-50 disabled:cursor-not-allowed`,
            `flex items-center gap-2`
          )}
        >
          <Send size={16} />
          Send
        </button>
      </form>
    </div>
  )
}
