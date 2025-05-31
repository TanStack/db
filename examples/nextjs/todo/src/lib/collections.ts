import { createElectricCollection } from "@tanstack/db-collections"
import { updateConfigSchema, updateTodoSchema } from "../db/validation"
import type { ElectricCollection } from "@tanstack/db-collections"
import type { PendingMutation, Row } from "@tanstack/react-db"
import type { UpdateConfig, UpdateTodo } from "../db/validation"
import type { CollectionClient } from "./CollectionHydrationBoundary"

const isServer = typeof window === `undefined`
const baseUrl = isServer ? `http://localhost:3000` : window.location.origin
export function makeCollections() {
  return {
    todos: createElectricCollection<UpdateTodo>({
      id: `todos`,
      streamOptions: {
        url: `${baseUrl}/api/electric`,
        params: { table: `todos` },
        subscribe: !isServer,
        parser: {
          timestamptz: (date: string) => new Date(date),
        },
      },
      primaryKey: [`id`],
      schema: updateTodoSchema,
    }),
    config: createElectricCollection<UpdateConfig>({
      id: `config`,
      streamOptions: {
        url: `${baseUrl}/api/electric`,
        params: { table: `config` },
        subscribe: !isServer,
        parser: {
          timestamptz: (date: string) => new Date(date),
        },
      },
      primaryKey: [`id`],
      schema: updateConfigSchema,
    }),
  }
}

export function makeCollectionClient(): CollectionClient {
  return makeCollections()
}
export async function collectionSync(mutation: PendingMutation, txid: number) {
  await (mutation.collection as ElectricCollection<UpdateTodo>).awaitTxId(txid)
}
