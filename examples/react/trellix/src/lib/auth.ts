import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "@/db/connection"
import * as schema from "@/db/auth-schema"

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.NODE_ENV === "production",
    minPasswordLength: process.env.NODE_ENV === "production" ? 8 : 1,
  },
  trustedOrigins: [
    "http://localhost:5173",
  ],
})
