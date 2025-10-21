import {
  createCollection,
  eq,
  ilike,
  liveQueryCollectionOptions,
  or,
} from "@tanstack/react-db"
import { productsCollection } from "./products"
import type { InitialQueryBuilder } from "@tanstack/react-db"

export type ProductsSearchParams = {
  q: string
  categories: Array<string>
  ratings: Array<number>
  inStockOnly: boolean
}

export function buildProductsQuery(
  q: InitialQueryBuilder,
  search: ProductsSearchParams
) {
  let query = q
    .from({ product: productsCollection })
    .orderBy(({ product }) => product.rating, `desc`)

  // Search filter
  if (search.q) {
    const searchPattern = `%${search.q}%`
    query = query.where(({ product }) =>
      or(
        ilike(product.name, searchPattern),
        ilike(product.description, searchPattern)
      )
    )
  }

  // Category filter
  if (search.categories.length > 0) {
    query = query.where(({ product }) =>
      or(...search.categories.map((cat) => eq(product.category, cat)))
    )
  }

  // Rating filter
  if (search.ratings.length > 0) {
    query = query.where(({ product }) =>
      or(...search.ratings.map((rating) => eq(product.rating, rating)))
    )
  }

  // In stock filter
  if (search.inStockOnly) {
    query = query.where(({ product }) => eq(product.inStock, true))
  }

  return query
}

export function buildProductByIdQuery(
  q: InitialQueryBuilder,
  productId: string
) {
  return q
    .from({ product: productsCollection })
    .where(({ product }) => eq(product.id, productId))
}

// Factory pattern with caching for product by ID live queries
const productByIdCache = new Map<string, ReturnType<typeof createCollection>>()

export function getProductByIdLiveQuery(productId: string) {
  if (!productByIdCache.has(productId)) {
    const collection = createCollection(
      liveQueryCollectionOptions({
        query: (q) => buildProductByIdQuery(q, productId),
      })
    )

    collection.on(`status:change`, ({ status }) => {
      if (status === `cleaned-up`) {
        productByIdCache.delete(productId)
      }
    })

    productByIdCache.set(productId, collection)
  }

  return productByIdCache.get(productId)!
}
