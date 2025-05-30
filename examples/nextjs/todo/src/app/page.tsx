import React from "react"
import { Shape, ShapeStream } from "@electric-sql/client"
import {
  createCollectionClient,
  dehydrateCollections,
} from "../lib/createCollectionClient"
import { CollectionHydrationBoundary } from "../lib/CollectionHydrationBoundary"
import TodoClient from "./TodoClient"
import type { UpdateConfig, UpdateTodo } from "../db/validation"

async function fetchInitialShapeData<T>(table: string): Promise<Array<T>> {
  const stream = new ShapeStream({
    url: `http://localhost:3003/v1/shape`,
    params: { table },
    subscribe: false,
  })

  const shape = new Shape(stream)

  const shapeData = await shape.rows

  return shapeData as Array<T>
}

export default async function TodoPage() {
  const fetchInitialData = async () => {
    try {
      const todosData = await fetchInitialShapeData<any>(`todos`)
      const configData = await fetchInitialShapeData<any>(`config`)

      const initialTodos: Array<UpdateTodo> = todosData.map((item: any) => ({
        id: parseInt(item.id),
        text: item.text,
        completed: item.completed === true || item.completed === `true`,
        created_at: new Date(item.created_at),
        updated_at: new Date(item.updated_at),
      }))

      const initialConfig: Array<UpdateConfig> = configData.map(
        (item: any) => ({
          id: parseInt(item.id),
          key: item.key,
          value: item.value,
          created_at: new Date(item.created_at),
          updated_at: new Date(item.updated_at),
        })
      )

      return { initialTodos, initialConfig }
    } catch (error) {
      return { initialTodos: [], initialConfig: [] }
    }
  }

  const { initialTodos, initialConfig } = await fetchInitialData()

  const serverInitialData: Record<string, Array<any>> = {}
  if (initialTodos.length > 0) serverInitialData.todos = initialTodos
  if (initialConfig.length > 0) serverInitialData.config = initialConfig

  const serverCollectionClient = createCollectionClient(serverInitialData)

  const dehydratedState = dehydrateCollections(serverCollectionClient)
  const serializableState = JSON.parse(JSON.stringify(dehydratedState))

  return (
    <CollectionHydrationBoundary state={serializableState}>
      <TodoClient />
    </CollectionHydrationBoundary>
  )
}
