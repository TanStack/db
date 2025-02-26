import { Kysely, PostgresDialect } from "kysely"
import pg from "pg"
import { Todo } from "./schema"

// Define the database interface for Kysely
interface Database {
  todos: Todo
}

// Create a Kysely instance
export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      host: `localhost`,
      port: 54321,
      user: `postgres`,
      password: `postgres`,
      database: `todo_app`,
    }),
  }),
})
