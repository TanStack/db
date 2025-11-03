import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { selectCommentSchema, selectIssueSchema } from '@/db/schema'

const ELECTRIC_URL =
  import.meta.env.VITE_ELECTRIC_URL || `http://localhost:3000`

export const issuesElectricCollection = createCollection(
  electricCollectionOptions({
    id: `issues-electric`,

    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: `issues`,
        // Filter in Electric shape to only include user's issues + demo issues
        // This requires setting up user context in Electric proxy
      },
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },

    getKey: (item) => item.id,
    schema: selectIssueSchema,

    onInsert: async ({ transaction }) => {
      const newIssue = transaction.mutations[0].modified
      await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newIssue.title,
          description: newIssue.description,
          priority: newIssue.priority,
          status: newIssue.status,
          kanbanorder: newIssue.kanbanorder,
        }),
      })

      // Note: For Electric sync with txid, you'd need to return the transaction ID
      // from your server function and pass it here
      // return { txid: response.txid }
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (mutation) => {
          // Only send fields that are allowed to be updated
          const allowedChanges: Record<string, any> = {}
          const allowedFields = [
            'title',
            'description',
            'priority',
            'status',
            'kanbanorder',
          ]

          for (const field of allowedFields) {
            if (field in mutation.changes) {
              allowedChanges[field] = mutation.changes[field]
            }
          }

          await fetch('/api/issues/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: mutation.original.id,
              ...allowedChanges,
            }),
          })
        })
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (mutation) => {
          await fetch('/api/issues/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: mutation.original.id }),
          })
        })
      )
    },
  })
)

export const commentsElectricCollection = createCollection(
  electricCollectionOptions({
    id: `comments-electric`,

    shapeOptions: {
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: `comments`,
      },
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },

    getKey: (item) => item.id,
    schema: selectCommentSchema,

    onInsert: async ({ transaction }) => {
      const newComment = transaction.mutations[0].modified
      await fetch('/api/comments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: newComment.body,
          issue_id: newComment.issue_id,
        }),
      })
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (mutation) => {
          await fetch('/api/comments/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: mutation.original.id }),
          })
        })
      )
    },
  })
)
