import { db } from '@/db/connection'
import { auth } from '@/lib/auth'

export async function getServerContext(headers: Headers) {
  const session = await auth.api.getSession({ headers })

  return {
    db,
    session,
    user: session?.user,
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
