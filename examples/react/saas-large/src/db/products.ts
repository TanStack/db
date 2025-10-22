import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { QueryClient } from "@tanstack/query-core"
import { z } from "zod"
import { getProducts } from "../lib/api"

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum([
    `Electronics`,
    `Clothing`,
    `Home`,
    `Books`,
    `Toys`,
    `Sports`,
  ]),
  price: z.number(),
  rating: z.number().min(1).max(5),
  inStock: z.boolean(),
  brand: z.string(),
  tags: z.array(z.string()),
})

export type Product = z.infer<typeof productSchema>

const queryClient = new QueryClient()

const itemsPerPage = 50

function computePageNumber(limit: number | undefined) {
  const effectiveLimit = limit ?? itemsPerPage
  return Math.max(0, Math.floor(effectiveLimit / itemsPerPage) - 1)
}

export const productsCollection = createCollection(
  queryCollectionOptions({
    syncMode: `on-demand`,
    queryKey: ({ limit, orderBy, where }) => {
      const page = computePageNumber(limit)
      console.log({ page, orderBy, where })
      return [`products`, { page, orderBy, where }]
    },
    queryFn: async (ctx) => {
      console.trace()
      const loadSubsetOptions = ctx.meta?.loadSubsetOptions
      if (!loadSubsetOptions) {
        throw new Error(`loadSubsetOptions is required`)
      }
      const { subscription: _subscription, ...rest } = loadSubsetOptions
      console.log(JSON.stringify(rest))
      const page = computePageNumber(loadSubsetOptions.limit)
      const limit = loadSubsetOptions.limit
      const orderBy = loadSubsetOptions.orderBy
      const where = loadSubsetOptions.where

      const result = await getProducts({
        data: {
          page,
          limit: limit ? limit + 1 : undefined,
          orderBy: orderBy ? JSON.stringify(orderBy) : undefined,
          where: where ? JSON.stringify(where) : undefined,
        },
      })
      console.log({ ctx, page, limit, orderBy, where, result })

      return result
    },
    queryClient,
    getKey: (item) => item.id,
    schema: productSchema,
  })
)
