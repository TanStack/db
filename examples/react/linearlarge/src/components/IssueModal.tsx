import { useEffect, useRef, useState } from 'react'
import { generateKeyBetween } from 'fractional-indexing'
import { BsChevronRight as ChevronRight } from 'react-icons/bs'
import { Modal } from './Modal'
import { useMode } from '@/lib/mode-context'
import { useUser } from '@/lib/user-context'
import { createCollection, liveQueryCollectionOptions } from '@tanstack/react-db'
import type { Priority, Status } from '@/db/schema'

interface Props {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export function IssueModal({ isOpen, onOpenChange }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const { issuesCollection } = useMode()
  const { user } = useUser()

  // Local form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('backlog')
  const [priority, setPriority] = useState<Priority>('none')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setStatus('backlog')
      setPriority('none')
      setIsSubmitting(false)
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (title.trim() === '') {
      alert('Please enter a title')
      return
    }

    if (!user) {
      alert('User not found')
      return
    }

    setIsSubmitting(true)

    try {
      // Create a live query collection to get the last issue for kanbanorder calculation
      const lastIssueCollection = createCollection(
        liveQueryCollectionOptions({
          query: (q) =>
            q
              .from({ issue: issuesCollection })
              .orderBy(({ issue }) => issue.kanbanorder, 'desc')
              .limit(1),
        })
      )

      // Preload the collection to get data
      await lastIssueCollection.preload()

      // Get the last issue
      const lastIssue = lastIssueCollection.data[0]
      const kanbanorder = generateKeyBetween(lastIssue?.kanbanorder ?? null, null)
      const newIssueId = crypto.randomUUID()

      // Insert without optimistic updates - wait for server confirmation
      const tx = issuesCollection.insert(
        {
          id: newIssueId,
          title: title.trim(),
          description: description.trim(),
          priority,
          status,
          kanbanorder,
          user_id: user.id,
          username: user.username,
          created_at: new Date(),
          modified: new Date(),
        },
        { optimistic: false }
      )

      // Wait for write to server and sync back to complete
      await tx.isPersisted.promise

      // Server write and sync back were successful
      onOpenChange(false)
    } catch (error) {
      // Show error notification
      alert(
        'Failed to create issue: ' +
          (error instanceof Error ? error.message : String(error))
      )
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (isOpen && !timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        ref.current?.focus()
        timeoutRef.current = undefined
      }, 250)
    }
  }, [isOpen])

  return (
    <Modal isOpen={isOpen} size="large" onOpenChange={handleClose}>
      <div className="flex flex-col w-full py-4 overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between flex-shrink-0 px-4">
          <div className="flex items-center">
            <span className="inline-flex items-center p-1 px-2 text-gray-400 bg-gray-100 rounded">
              <img
                src="/tanstack-logo.svg"
                className="w-3 h-3 mr-1"
                alt="TanStack"
              />
              <span>linearlarge</span>
            </span>
            <ChevronRight className="ml-1" />
            <span className="ml-1 font-normal text-gray-700">New Issue</span>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              className="inline-flex rounded items-center justify-center ml-2 text-gray-500 h-7 w-7 hover:bg-gray-100 hover:text-gray-700"
              onClick={handleClose}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-col flex-1 pb-3.5 overflow-y-auto">
          {/* Issue title */}
          <div className="flex items-center w-full mt-1.5 px-4">
            <input
              className="w-full text-lg font-semibold placeholder-gray-400 border-none h-7 focus:border-none focus:outline-none focus:ring-0"
              placeholder="Issue title"
              value={title}
              ref={ref}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Issue description */}
          <div className="w-full px-4">
            <textarea
              className="w-full mt-2 p-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description..."
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Issue status and priority */}
        <div className="flex items-center gap-3 px-4 pb-3 mt-1 border-b border-gray-200">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSubmitting}
          >
            <option value="backlog">Backlog</option>
            <option value="todo">Todo</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="canceled">Canceled</option>
          </select>

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSubmitting}
          >
            <option value="none">No Priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {/* Footer */}
        <div className="flex items-center flex-shrink-0 px-4 pt-3">
          <button
            type="button"
            className="px-3 ml-auto text-white bg-indigo-600 rounded hover:bg-indigo-700 h-7 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Issue'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
