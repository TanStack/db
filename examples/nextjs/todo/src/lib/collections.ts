import { createElectricCollection } from "@tanstack/db-collections"
import { updateConfigSchema, updateTodoSchema } from "../db/validation"
import type { ElectricCollection } from "@tanstack/db-collections"
import type { PendingMutation } from "@tanstack/react-db"
import type { UpdateConfig, UpdateTodo } from "../db/validation"

const isClient = typeof window !== `undefined`
const baseUrl = isClient ? window.location.origin : `http://localhost:3000`

export const collections = {
  todos: createElectricCollection<UpdateTodo>({
    id: `todos`,
    streamOptions: {
      url: `${baseUrl}/api/electric`,
      params: { table: `todos` },
      subscribe: isClient,
    },
    primaryKey: [`id`],
    schema: updateTodoSchema,
  }),
  config: createElectricCollection<UpdateConfig>({
    id: `config`,
    streamOptions: {
      url: `${baseUrl}/api/electric`,
      params: { table: `config` },
      subscribe: isClient,
    },
    primaryKey: [`id`],
    schema: updateConfigSchema,
  }),
}

export async function collectionSync(mutation: PendingMutation, txid: number) {
  await (mutation.collection as ElectricCollection<UpdateTodo>).awaitTxId(txid)
}
