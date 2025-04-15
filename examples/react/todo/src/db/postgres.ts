import postgres from "postgres"

// Create a postgres instance
export const sql = postgres({
  host: `localhost`,
  port: 54322,
  user: `postgres`,
  password: `postgres`,
  database: `todo_app`,
})
