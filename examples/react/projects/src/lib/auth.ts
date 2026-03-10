import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db/connection' // your drizzle instance
import * as schema from '@/db/auth-schema'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_BASE_URL || 'http://localhost:5174',
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema,
    // debugLogs: true,
  }),
  emailAndPassword: {
    enabled: true,
    // Disable signup in production, allow in dev
    disableSignUp: process.env.NODE_ENV === 'production',
    minPasswordLength: process.env.NODE_ENV === 'production' ? 8 : 1,
  },
  trustedOrigins: ['http://localhost:5173', 'http://localhost:5174'],
})
