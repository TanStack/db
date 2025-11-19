import { createCollection } from '@tanstack/react-db'
import {
  queryCollectionOptions,
  parseLoadSubsetOptions,
} from '@tanstack/query-db-collection'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { selectIssueSchema, selectCommentSchema } from '@/db/schema'

// Query client singleton
export const queryClient = new QueryClient()

const ELECTRIC_URL =
  import.meta.env.VITE_ELECTRIC_URL || `http://localhost:3001`

// Helper function to create stable query keys from predicates
const serializePredicates = (opts: any) => {
  if (!opts || (!opts.where && !opts.orderBy && !opts.limit && !opts.offset)) {
    return null
  }
  return JSON.stringify({
    where: opts.where,
    orderBy: opts.orderBy,
    limit: opts.limit,
    offset: opts.offset,
  })
}

// ============================================================================
// QUERY MODE COLLECTIONS
// ============================================================================

// Factory function for issues query collection
const createIssuesQueryCollection = () => {
  return createCollection(
    queryCollectionOptions({
      id: 'issues-query',
      queryKey: (opts) => ['issues', serializePredicates(opts)],
      syncMode: 'on-demand',
      queryClient,
      staleTime: 5 * 60 * 1000, // 5 minutes

      queryFn: async (ctx) => {
        // Parse predicates from loadSubsetOptions
        const { limit, where, orderBy, offset } = ctx.meta?.loadSubsetOptions || {}
        const parsed = parseLoadSubsetOptions({ where, orderBy, limit, offset })

        // Build query parameters from parsed filters
        const params = new URLSearchParams()

        // Handle pagination - for query collections, pageParam takes precedence
        // (useLiveInfiniteQuery sets offset=0 via setWindow, but we need actual page offsets)
        console.log('🔍 Issues Pagination:', {
          offsetFromSetWindow: offset,
          pageParam: ctx.pageParam,
          parsedLimit: parsed.limit,
          parsedOffset: parsed.offset,
        })

        if (ctx.pageParam !== undefined && parsed.limit) {
          const calculatedOffset = ctx.pageParam * parsed.limit
          params.set('offset', String(calculatedOffset))
          console.log('✅ Using pageParam offset:', calculatedOffset)
        } else if (offset !== undefined && offset !== 0) {
          params.set('offset', String(offset))
          console.log('✅ Using setWindow offset:', offset)
        }

        // Add filters
        parsed.filters.forEach(({ field, operator, value }) => {
          const fieldName = field.join('.')

          // Serialize value properly (dates to ISO, etc.)
          const serializeValue = (val: any) => {
            if (val instanceof Date) {
              return val.toISOString()
            }
            return String(val)
          }

          if (operator === 'eq') {
            params.set(fieldName, serializeValue(value))
          } else if (operator === 'lt') {
            params.set(`${fieldName}_lt`, serializeValue(value))
          } else if (operator === 'lte') {
            params.set(`${fieldName}_lte`, serializeValue(value))
          } else if (operator === 'gt') {
            params.set(`${fieldName}_gt`, serializeValue(value))
          } else if (operator === 'gte') {
            params.set(`${fieldName}_gte`, serializeValue(value))
          } else if (operator === 'in') {
            params.set(`${fieldName}_in`, JSON.stringify(value))
          }
        })

        // Add sorting
        if (parsed.sorts.length > 0) {
          const sortParam = parsed.sorts
            .map((s) => `${s.field.join('.')}:${s.direction}`)
            .join(',')
          params.set('sort', sortParam)
        }

        // Add limit
        if (parsed.limit) {
          params.set('limit', String(parsed.limit))
        }

        const url = params.toString() ? `/api/issues?${params}` : '/api/issues'
        const response = await fetch(url)

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Failed to fetch issues:', response.status, errorText)
          throw new Error(
            `Failed to fetch issues: ${response.status} ${errorText}`
          )
        }

        const issues = await response.json()
        return issues.map((issue) => ({
          ...issue,
          created_at: new Date(issue.created_at),
          modified: new Date(issue.modified),
        }))
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

            return fetch('/api/issues/update', {
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
          transaction.mutations.map((mutation) =>
            fetch('/api/issues/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: mutation.original.id }),
            })
          )
        )
      },
    })
  )
}

// Factory function for comments query collection
const createCommentsQueryCollection = () => {
  return createCollection(
    queryCollectionOptions({
      id: 'comments-query',
      queryKey: (opts) => ['comments', serializePredicates(opts)],
      syncMode: 'on-demand',
      queryClient,
      staleTime: 5 * 60 * 1000, // 5 minutes

      queryFn: async (ctx) => {
        // Parse predicates from loadSubsetOptions
        const { limit, where, orderBy, offset } = ctx.meta?.loadSubsetOptions || {}
        const parsed = parseLoadSubsetOptions({ where, orderBy, limit })

        // Build query parameters from parsed filters
        const params = new URLSearchParams()

        // Handle pagination - for query collections, pageParam takes precedence
        // (useLiveInfiniteQuery sets offset=0 via setWindow, but we need actual page offsets)
        if (ctx.pageParam !== undefined && parsed.limit) {
          const calculatedOffset = ctx.pageParam * parsed.limit
          params.set('offset', String(calculatedOffset))
        } else if (offset !== undefined && offset !== 0) {
          params.set('offset', String(offset))
        }

        // Add filters
        parsed.filters.forEach(({ field, operator, value }) => {
          const fieldName = field.join('.')

          // Serialize value properly (dates to ISO, etc.)
          const serializeValue = (val: any) => {
            if (val instanceof Date) {
              return val.toISOString()
            }
            return String(val)
          }

          if (operator === 'eq') {
            params.set(fieldName, serializeValue(value))
          } else if (operator === 'lt') {
            params.set(`${fieldName}_lt`, serializeValue(value))
          } else if (operator === 'lte') {
            params.set(`${fieldName}_lte`, serializeValue(value))
          } else if (operator === 'gt') {
            params.set(`${fieldName}_gt`, serializeValue(value))
          } else if (operator === 'gte') {
            params.set(`${fieldName}_gte`, serializeValue(value))
          } else if (operator === 'in') {
            params.set(`${fieldName}_in`, JSON.stringify(value))
          }
        })

        // Add sorting
        if (parsed.sorts.length > 0) {
          const sortParam = parsed.sorts
            .map((s) => `${s.field.join('.')}:${s.direction}`)
            .join(',')
          params.set('sort', sortParam)
        }

        // Add limit
        if (parsed.limit) {
          params.set('limit', String(parsed.limit))
        }

        const url = params.toString()
          ? `/api/comments?${params}`
          : '/api/comments'
        const response = await fetch(url)

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Failed to fetch comments:', response.status, errorText)
          throw new Error(
            `Failed to fetch comments: ${response.status} ${errorText}`
          )
        }

        const comments = await response.json()
        return comments.map((comment) => ({
          ...comment,
          created_at: new Date(comment.created_at),
          modified: new Date(comment.modified),
        }))
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
          transaction.mutations.map((mutation) =>
            fetch('/api/comments/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: mutation.original.id }),
            })
          )
        )
      },
    })
  )
}

// Extract types from factory functions
type IssuesQueryCollection = ReturnType<typeof createIssuesQueryCollection>
type CommentsQueryCollection = ReturnType<typeof createCommentsQueryCollection>

// Caches for query collections
let issuesQueryCollectionCache: IssuesQueryCollection | null = null
let commentsQueryCollectionCache: CommentsQueryCollection | null = null

// Getter functions with caching
export const getIssuesQueryCollection = (): IssuesQueryCollection => {
  if (!issuesQueryCollectionCache) {
    issuesQueryCollectionCache = createIssuesQueryCollection()

    // Auto-cleanup when collection is disposed
    issuesQueryCollectionCache.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        issuesQueryCollectionCache = null
      }
    })
  }

  return issuesQueryCollectionCache
}

export const getCommentsQueryCollection = (): CommentsQueryCollection => {
  if (!commentsQueryCollectionCache) {
    commentsQueryCollectionCache = createCommentsQueryCollection()

    // Auto-cleanup when collection is disposed
    commentsQueryCollectionCache.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        commentsQueryCollectionCache = null
      }
    })
  }

  return commentsQueryCollectionCache
}

// ============================================================================
// ELECTRIC MODE COLLECTIONS
// ============================================================================

// Factory function for issues electric collection
const createIssuesElectricCollection = () => {
  return createCollection(
    electricCollectionOptions({
      id: `issues-electric`,
      syncMode: `on-demand`,

      shapeOptions: {
        url: `${ELECTRIC_URL}/v1/shape`,
        params: {
          table: `issues`,
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
}

// Factory function for comments electric collection
const createCommentsElectricCollection = () => {
  return createCollection(
    electricCollectionOptions({
      id: `comments-electric`,
      syncMode: `on-demand`,

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
          transaction.mutations.map((mutation) =>
            fetch('/api/comments/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: mutation.original.id }),
            })
          )
        )
      },
    })
  )
}

// Extract types from factory functions
type IssuesElectricCollection = ReturnType<typeof createIssuesElectricCollection>
type CommentsElectricCollection = ReturnType<typeof createCommentsElectricCollection>

// Caches for electric collections
let issuesElectricCollectionCache: IssuesElectricCollection | null = null
let commentsElectricCollectionCache: CommentsElectricCollection | null = null

// Getter functions with caching
export const getIssuesElectricCollection = (): IssuesElectricCollection => {
  if (!issuesElectricCollectionCache) {
    issuesElectricCollectionCache = createIssuesElectricCollection()

    // Auto-cleanup when collection is disposed
    issuesElectricCollectionCache.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        issuesElectricCollectionCache = null
      }
    })
  }

  return issuesElectricCollectionCache
}

export const getCommentsElectricCollection = (): CommentsElectricCollection => {
  if (!commentsElectricCollectionCache) {
    commentsElectricCollectionCache = createCommentsElectricCollection()

    // Auto-cleanup when collection is disposed
    commentsElectricCollectionCache.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        commentsElectricCollectionCache = null
      }
    })
  }

  return commentsElectricCollectionCache
}
