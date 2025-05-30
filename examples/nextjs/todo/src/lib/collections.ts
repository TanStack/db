import { createElectricCollection } from "@tanstack/db-collections"
import { updateConfigSchema, updateTodoSchema } from "../db/validation"
import type { ElectricCollection } from "@tanstack/db-collections"
import type { PendingMutation } from "@tanstack/react-db"
import type { UpdateConfig, UpdateTodo } from "../db/validation"

export const createTodoCollection = (initialData: Array<UpdateTodo>) => {
  const isClient = typeof window !== `undefined`
  const baseUrl = isClient ? window.location.origin : `http://localhost:3000`

  const newCollection = createElectricCollection<UpdateTodo>({
    id: `todos`,
    streamOptions: {
      url: `${baseUrl}/api/electric`,
      params: {
        table: `todos`,
      },
      subscribe: isClient,
    },
    primaryKey: [`id`],
    schema: updateTodoSchema,
    initialData,
  })
  return newCollection
}

export const createConfigCollection = (initialData: Array<UpdateConfig>) => {
  const isClient = typeof window !== `undefined`
  const baseUrl = isClient ? window.location.origin : `http://localhost:3000`
  const newCollection = createElectricCollection<UpdateConfig>({
    id: `config`,
    streamOptions: {
      url: `${baseUrl}/api/electric`,
      params: {
        table: `config`,
      },
      subscribe: isClient,
    },
    primaryKey: [`id`],
    schema: updateConfigSchema,
    initialData,
  })
  return newCollection
}

export async function collectionSync(mutation: PendingMutation, txid: number) {
  await (mutation.collection as ElectricCollection<UpdateTodo>).awaitTxId(txid)
}
