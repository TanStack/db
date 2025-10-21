import { useState } from 'react'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { Send } from 'lucide-react'
import { useMode } from '@/lib/mode-context'
import { cn } from '@/lib/utils'

interface CommentsProps {
  issueId: string
}

export function Comments({ issueId }: CommentsProps) {
  const { commentsCollection } = useMode()
  const [newComment, setNewComment] = useState(``)

  const { data: comments } = useLiveQuery((q) =>
    q
      .from({ comment: commentsCollection })
      .where(({ comment }) => eq(comment.issue_id, issueId))
      .orderBy(({ comment }) => comment.created_at, `asc`)
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim()) return

    commentsCollection.insert({
      id: crypto.randomUUID(),
      body: newComment,
      issue_id: issueId,
      user_id: `current-user-id`, // TODO: Get from auth context
      created_at: new Date(),
      modified: new Date(),
    })

    setNewComment(``)
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
              <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-medium">
                U
              </div>
              <span className="text-sm font-medium text-gray-700">User</span>
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
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          className={cn(
            `flex-1 px-4 py-2 border border-gray-300 rounded-lg`,
            `focus:outline-none focus:ring-2 focus:ring-blue-500`
          )}
        />
        <button
          type="submit"
          disabled={!newComment.trim()}
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
