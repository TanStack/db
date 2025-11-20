import { createLiveQueryCollection, eq, inArray, and } from '@tanstack/react-db'
import type { Collection } from '@tanstack/db'
import type { Issue, Comment } from '@/db/schema'
import {
  getIssuesQueryCollection,
  getIssueCountQueryCollection,
  getCommentsQueryCollection,
  getIssuesElectricCollection,
  getCommentsElectricCollection,
} from './collections'

// ============================================================================
// ISSUE QUERIES
// ============================================================================

// Factory function for issue by ID query
const createIssueByIdQuery = (
  issueId: string,
  issuesCollection: Collection<Issue>
) => {
  const query = createLiveQueryCollection((q) =>
    q
      .from({ issue: issuesCollection })
      .where(({ issue }) => eq(issue.id, issueId))
  )

  return query
}

// Extract type from factory function
type IssueByIdQuery = ReturnType<typeof createIssueByIdQuery>

// Cache for issue by ID queries
const issueByIdCache = new Map<string, IssueByIdQuery>()

// Getter function with caching
export const getIssueByIdQuery = (
  issueId: string,
  issuesCollection: Collection<Issue>
): IssueByIdQuery => {
  const cacheKey = `${issuesCollection.id}:${issueId}`

  if (!issueByIdCache.has(cacheKey)) {
    const query = createIssueByIdQuery(issueId, issuesCollection)

    // Auto-cleanup when collection is disposed
    query.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        issueByIdCache.delete(cacheKey)
      }
    })

    issueByIdCache.set(cacheKey, query)
  }

  return issueByIdCache.get(cacheKey)!
}

// ============================================================================
// COMMENT QUERIES
// ============================================================================

// Factory function for comments by issue ID query
const createCommentsByIssueQuery = (
  issueId: string,
  commentsCollection: Collection<Comment>
) => {
  const query = createLiveQueryCollection((q) =>
    q
      .from({ comment: commentsCollection })
      .where(({ comment }) => eq(comment.issue_id, issueId))
      .orderBy(({ comment }) => comment.created_at, `asc`)
      .limit(1000)
  )

  return query
}

// Extract type from factory function
type CommentsByIssueQuery = ReturnType<typeof createCommentsByIssueQuery>

// Cache for comments by issue ID queries
const commentsByIssueCache = new Map<string, CommentsByIssueQuery>()

// Getter function with caching
export const getCommentsByIssueQuery = (
  issueId: string,
  commentsCollection: Collection<Comment>
): CommentsByIssueQuery => {
  const cacheKey = `${commentsCollection.id}:${issueId}`

  if (!commentsByIssueCache.has(cacheKey)) {
    const query = createCommentsByIssueQuery(issueId, commentsCollection)

    // Auto-cleanup when collection is disposed
    query.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        commentsByIssueCache.delete(cacheKey)
      }
    })

    commentsByIssueCache.set(cacheKey, query)
  }

  return commentsByIssueCache.get(cacheKey)!
}

// ============================================================================
// COUNT QUERIES
// ============================================================================

const createIssueCountQuery = (filters: {
  status?: string[]
  priority?: string[]
}) => {
  const issueCountCollection = getIssueCountQueryCollection({
    status: filters?.status,
    priority: filters?.priority,
  })

  const query = createLiveQueryCollection((q) =>
    q.from({ count: issueCountCollection })
  )

  return query
}

type IssueCountQuery = ReturnType<typeof createIssueCountQuery>

const issueCountCache = new Map<string, IssueCountQuery>()

export const getIssueCountQuery = (filters?: {
  status?: string[]
  priority?: string[]
}): IssueCountQuery => {
  const cacheKey = JSON.stringify({
    status: filters?.status?.sort(),
    priority: filters?.priority?.sort(),
  })

  console.log({ cacheKey })

  if (!issueCountCache.has(cacheKey)) {
    const query = createIssueCountQuery(filters || {})

    query.on('status:change', ({ status }) => {
      if (status === 'cleaned-up') {
        issueCountCache.delete(cacheKey)
      }
    })

    issueCountCache.set(cacheKey, query)
  }

  return issueCountCache.get(cacheKey)!
}

// ============================================================================
// PRELOAD FUNCTIONS FOR LOADERS
// ============================================================================

export const preloadIssue = async (
  issueId: string,
  mode: 'query' | 'electric' = 'query'
) => {
  const issuesCollection =
    mode === 'query'
      ? getIssuesQueryCollection()
      : getIssuesElectricCollection()
  const query = getIssueByIdQuery(issueId, issuesCollection)
  await query.preload()
}

export const preloadComments = async (
  issueId: string,
  mode: 'query' | 'electric' = 'query'
) => {
  const commentsCollection =
    mode === 'query'
      ? getCommentsQueryCollection()
      : getCommentsElectricCollection()
  const query = getCommentsByIssueQuery(issueId, commentsCollection)
  await query.preload()
}

export const preloadIssueCount = async (filters?: {
  status?: string[]
  priority?: string[]
}) => {
  const query = getIssueCountQuery(filters)
  await query.preload()
}

export const preloadIssuesList = async (
  filters?: {
    status?: string[]
    priority?: string[]
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
  },
  mode: 'query' | 'electric' = 'query'
) => {
  const issuesCollection =
    mode === 'query'
      ? getIssuesQueryCollection()
      : getIssuesElectricCollection()

  const query = createLiveQueryCollection((q) => {
    let query = q.from({ issue: issuesCollection })

    if (filters?.status?.length || filters?.priority?.length) {
      query = query.where(({ issue }) => {
        const conditions = []

        if (filters.status?.length) {
          if (filters.status.length === 1) {
            conditions.push(eq(issue.status, filters.status[0]))
          } else {
            conditions.push(inArray(issue.status, filters.status))
          }
        }

        if (filters.priority?.length) {
          if (filters.priority.length === 1) {
            conditions.push(eq(issue.priority, filters.priority[0]))
          } else {
            conditions.push(inArray(issue.priority, filters.priority))
          }
        }

        return conditions.length === 1 ? conditions[0] : and(...conditions)
      })
    }

    const orderField =
      filters?.orderBy === 'created_at' ? 'created_at' : 'modified'
    return query
      .orderBy(
        ({ issue }) => issue[orderField],
        filters?.orderDirection || 'desc'
      )
      .limit(50)
      .offset(0)
  })

  await query.preload()
}
