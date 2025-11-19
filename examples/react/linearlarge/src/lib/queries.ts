import { createLiveQueryCollection, eq } from '@tanstack/react-db'
import type { Collection } from '@tanstack/db'
import type { Issue, Comment } from '@/db/schema'
import {
  getIssuesQueryCollection,
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
// PRELOAD FUNCTIONS FOR LOADERS
// ============================================================================

export const preloadIssue = async (issueId: string, mode: 'query' | 'electric' = 'query') => {
  const issuesCollection =
    mode === 'query' ? getIssuesQueryCollection() : getIssuesElectricCollection()
  const query = getIssueByIdQuery(issueId, issuesCollection)
  await query.preload()
}

export const preloadComments = async (issueId: string, mode: 'query' | 'electric' = 'query') => {
  const commentsCollection =
    mode === 'query' ? getCommentsQueryCollection() : getCommentsElectricCollection()
  const query = getCommentsByIssueQuery(issueId, commentsCollection)
  await query.preload()
}

export const preloadIssuesList = async (mode: 'query' | 'electric' = 'query') => {
  const issuesCollection =
    mode === 'query' ? getIssuesQueryCollection() : getIssuesElectricCollection()
  await issuesCollection.preload()
}
