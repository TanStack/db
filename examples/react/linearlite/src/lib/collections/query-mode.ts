import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { selectIssueSchema, selectCommentSchema } from '@/db/schema'
import { issuesAPI, commentsAPI } from '@/lib/api-client'

export const queryClient = new QueryClient()

export const issuesQueryCollection = createCollection(
  queryCollectionOptions({
    id: 'issues-query',
    queryKey: ['issues'],
    refetchInterval: 3000, // Poll every 3 seconds
    queryClient,

    queryFn: async () => {
      const issues = await issuesAPI.getAll()
      return issues.map((issue: any) => ({
        ...issue,
        created_at: new Date(issue.created_at),
        modified: new Date(issue.modified),
      }))
    },

    getKey: (item) => item.id,
    schema: selectIssueSchema,

    onInsert: async ({ transaction }) => {
      const newIssue = transaction.mutations[0].modified
      await issuesAPI.create({
        title: newIssue.title,
        description: newIssue.description,
        priority: newIssue.priority,
        status: newIssue.status,
        kanbanorder: newIssue.kanbanorder,
      })
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          issuesAPI.update({
            id: mutation.original.id,
            ...mutation.changes,
          })
        )
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          issuesAPI.delete(mutation.original.id)
        )
      )
    },
  })
)

export const commentsQueryCollection = createCollection(
  queryCollectionOptions({
    id: 'comments-query',
    queryKey: ['comments'],
    refetchInterval: 3000,
    queryClient,

    queryFn: async () => {
      // This will be filtered per-issue in components
      // For now, return empty array - comments loaded per issue
      return []
    },

    getKey: (item) => item.id,
    schema: selectCommentSchema,

    onInsert: async ({ transaction }) => {
      const newComment = transaction.mutations[0].modified
      await commentsAPI.create({
        body: newComment.body,
        issue_id: newComment.issue_id,
      })
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          commentsAPI.delete(mutation.original.id)
        )
      )
    },
  })
)
