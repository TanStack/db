import { db } from '@/db/connection'
import { usersTable } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function getServerContext(headers: Headers) {
  // Get user from custom headers
  const userId = headers.get('x-user-id')
  const username = headers.get('x-user-name')
  console.log({ userId, username })

  if (!userId || !username) {
    throw new Error('Unauthorized - No user headers provided')
  }

  // Check if user exists in database
  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  })

  // Auto-create user if doesn't exist
  if (!user) {
    const [newUser] = await db
      .insert(usersTable)
      .values({
        id: userId,
        username: username,
        email: `${username}@linearlarge.local`,
        name: username,
        is_demo: false,
      })
      .returning()

    user = newUser
  }
  console.log({ user })

  const session = {
    userId: user.id,
    sessionId: 'local-session',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }

  return {
    db,
    session,
    user,
  }
}

export function requireAuth<T>(
  handler: (context: {
    db: typeof db
    user: NonNullable<ReturnType<typeof getServerContext>['user']>
    session: NonNullable<ReturnType<typeof getServerContext>['session']>
  }) => Promise<T>
) {
  return async (headers: Headers) => {
    const context = await getServerContext(headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    return handler({
      db: context.db,
      user: context.user,
      session: context.session,
    })
  }
}
