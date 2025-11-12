import type { Comment, Post, SeedDataResult, User } from "../types"

// Cache UUIDs for deterministic behavior across test runs
const uuidCache = new Map<string, string>()

/**
 * Generate deterministic valid UUIDs for testing
 */
function generateId(prefix: string, index: number): string {
  const key = `${prefix}-${index}`
  if (!uuidCache.has(key)) {
    // Generate a real UUID but make it deterministic for the same prefix+index
    const hex = index.toString(16).padStart(8, `0`)
    // Create a valid UUID v4 format
    uuidCache.set(
      key,
      `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, `0`)}`
    )
  }
  return uuidCache.get(key)!
}

/**
 * Generate seed data with proper distributions for testing
 *
 * Data characteristics:
 * - ~100 users with varied attributes
 * - ~100 posts distributed across users
 * - ~100 comments distributed across posts
 * - Mix of null/non-null values
 * - Various string cases (uppercase, lowercase, special chars)
 * - Date ranges (past, present, future)
 * - Numeric ranges (negative, zero, positive)
 * - Some soft-deleted records
 */
export function generateSeedData(): SeedDataResult {
  const users: Array<User> = []
  const posts: Array<Post> = []
  const comments: Array<Comment> = []

  const now = new Date()
  const oneDay = 24 * 60 * 60 * 1000
  const oneYear = 365 * oneDay

  // Generate 100 users with varied distributions
  for (let i = 0; i < 100; i++) {
    const id = generateId(`user`, i)

    // Name variations for collation testing
    const names = [
      `Alice ${i}`,
      `bob ${i}`,
      `Charlie ${i}`,
      `DIANA ${i}`,
      `Eve ${i}`,
      `Frank ${i}`,
      `Grace ${i}`,
      `henry ${i}`,
      `Ivy ${i}`,
      `Jack ${i}`,
      `Kate ${i}`,
      `liam ${i}`,
      `Mia ${i}`,
      `Noah ${i}`,
      `Olivia ${i}`,
      `PAUL ${i}`,
      `Quinn ${i}`,
      `Rose ${i}`,
      `sam ${i}`,
      `Tina ${i}`,
    ]
    const name = names[i % names.length]

    // Email: 70% have emails, 30% null
    const email = i % 10 < 7 ? `user${i}@example.com` : null

    // Age distribution: 18-80, with some edge cases
    const age = i === 0 ? 0 : i === 1 ? -5 : i === 2 ? 150 : 18 + (i % 63)

    // IsActive: 80% true, 20% false
    const isActive = i % 5 !== 0

    // CreatedAt: distributed over past year
    const createdAt = new Date(now.getTime() - Math.random() * oneYear)

    // Metadata: 40% have metadata, 60% null
    const metadata =
      i % 5 < 2 ? { score: i * 10, level: Math.floor(i / 10) } : null

    // DeletedAt: 10% soft deleted
    const deletedAt =
      i % 10 === 0
        ? new Date(now.getTime() - Math.random() * oneDay * 30)
        : null

    users.push({
      id: id,
      name: name!,
      email,
      age,
      isActive,
      createdAt,
      metadata,
      deletedAt,
    })
  }

  // Generate 100 posts distributed across users
  for (let i = 0; i < 100; i++) {
    const id = generateId(`post`, i)

    // Distribute posts across users (some users have multiple posts)
    const userId = users[i % users.length]!.id

    // Title variations
    const titles = [
      `Introduction to ${i}`,
      `Deep Dive: Topic ${i}`,
      `Quick Guide ${i}`,
      `ANNOUNCEMENT: ${i}`,
      `tutorial ${i}`,
      `Best Practices ${i}`,
    ]
    const title = titles[i % titles.length]!

    // Content: 70% have content, 30% null
    const content =
      i % 10 < 7
        ? `This is the content for post ${i}. Lorem ipsum dolor sit amet.`
        : null

    // ViewCount: varied distribution
    const viewCount = i === 0 ? 0 : i === 1 ? -10 : i * 42

    // PublishedAt: 80% published, 20% null (drafts)
    const publishedAt =
      i % 5 !== 0 ? new Date(now.getTime() - Math.random() * oneYear) : null

    // DeletedAt: 5% soft deleted
    const deletedAt =
      i % 20 === 0
        ? new Date(now.getTime() - Math.random() * oneDay * 10)
        : null

    posts.push({
      id,
      userId,
      title,
      content,
      viewCount,
      publishedAt,
      deletedAt,
    })
  }

  // Generate 100 comments distributed across posts
  for (let i = 0; i < 100; i++) {
    const id = generateId(`comment`, i)

    // Distribute comments across posts (some posts have multiple comments)
    const postId = posts[i % posts.length]!.id
    const userId = users[(i * 3) % users.length]!.id

    // Text variations
    const texts = [
      `Great post! Comment ${i}`,
      `I disagree with comment ${i}`,
      `question about ${i}`,
      `AMAZING WORK ${i}`,
      `thanks for sharing ${i}`,
      `Very helpful comment ${i}`,
    ]
    const text = texts[i % texts.length]!

    // CreatedAt: distributed over past 6 months
    const createdAt = new Date(now.getTime() - Math.random() * (oneYear / 2))

    // DeletedAt: 8% soft deleted
    const deletedAt =
      i % 13 === 0 ? new Date(now.getTime() - Math.random() * oneDay * 5) : null

    comments.push({
      id,
      postId,
      userId,
      text,
      createdAt,
      deletedAt,
    })
  }

  return {
    users,
    posts,
    comments,
    userIds: users.map((u) => u.id),
    postIds: posts.map((p) => p.id),
    commentIds: comments.map((c) => c.id),
  }
}

/**
 * Get expected counts for different predicate scenarios
 */
export function getExpectedCounts(seedData: SeedDataResult) {
  return {
    // Users
    totalUsers: seedData.users.length,
    activeUsers: seedData.users.filter((u) => u.isActive).length,
    deletedUsers: seedData.users.filter((u) => u.deletedAt !== null).length,
    usersWithEmail: seedData.users.filter((u) => u.email !== null).length,
    usersWithoutEmail: seedData.users.filter((u) => u.email === null).length,
    usersWithMetadata: seedData.users.filter((u) => u.metadata !== null).length,

    // Posts
    totalPosts: seedData.posts.length,
    publishedPosts: seedData.posts.filter((p) => p.publishedAt !== null).length,
    draftPosts: seedData.posts.filter((p) => p.publishedAt === null).length,
    deletedPosts: seedData.posts.filter((p) => p.deletedAt !== null).length,
    postsWithContent: seedData.posts.filter((p) => p.content !== null).length,

    // Comments
    totalComments: seedData.comments.length,
    deletedComments: seedData.comments.filter((c) => c.deletedAt !== null)
      .length,
  }
}
