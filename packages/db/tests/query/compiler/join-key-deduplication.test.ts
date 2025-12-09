import { describe, expect, it } from 'vitest'
import { createCollection } from '../../../src/collection/index.js'
import { createLiveQueryCollection } from '../../../src/query/live-query-collection.js'
import { eq } from '../../../src/query/builder/functions.js'
import type { LoadSubsetOptions } from '../../../src/types.js'

interface User {
  id: number
  name: string
}

interface Post {
  id: number
  userId: number
  title: string
}

describe(`Join Key Deduplication`, () => {
  it(`should deduplicate join keys in the 'in' condition sent to loadSubset`, async () => {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const usersCollection = createCollection<User, number>({
      id: `users`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            },
          }
        },
      },
    })

    const postsCollection = createCollection<Post, number>({
      id: `posts`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, userId: 1, title: `Post 1 by User 1` } })
          write({ type: `insert`, value: { id: 2, userId: 1, title: `Post 2 by User 1` } })
          write({ type: `insert`, value: { id: 3, userId: 1, title: `Post 3 by User 1` } })
          write({ type: `insert`, value: { id: 4, userId: 2, title: `Post 1 by User 2` } })
          write({ type: `insert`, value: { id: 5, userId: 2, title: `Post 2 by User 2` } })
          commit()
          markReady()
        },
      },
    })

    await usersCollection.stateWhenReady()
    await postsCollection.stateWhenReady()

    usersCollection.createIndex((row) => row.id)

    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ post: postsCollection })
          .leftJoin({ user: usersCollection }, ({ post, user }) =>
            eq(post.userId, user.id),
          )
          .select(({ post, user }) => ({
            id: post.id,
            postTitle: post.title,
            userName: user?.name,
          })),
      startSync: true,
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    const inArrayCall = loadSubsetCalls.find(
      (call) =>
        call.where?.type === `func` && (call.where as any).name === `in`,
    )

    expect(inArrayCall).toBeDefined()

    const whereClause = inArrayCall!.where as any
    const inArrayArg = whereClause.args[1]
    expect(inArrayArg.type).toBe(`val`)
    const inArrayValues = inArrayArg.value as Array<number>

    const sortedValues = [...inArrayValues].sort((a, b) => a - b)
    expect(sortedValues).toEqual([1, 2])

    const uniqueValues = [...new Set(inArrayValues)]
    expect(inArrayValues.length).toBe(uniqueValues.length)

    await query.cleanup()
    await usersCollection.cleanup()
    await postsCollection.cleanup()
  })

  it(`should handle join keys with string values without duplicates`, async () => {
    interface Category {
      slug: string
      name: string
    }

    interface Product {
      id: number
      categorySlug: string
      name: string
    }

    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const categoriesCollection = createCollection<Category, string>({
      id: `categories`,
      getKey: (item) => item.slug,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            },
          }
        },
      },
    })

    const productsCollection = createCollection<Product, number>({
      id: `products`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, categorySlug: `electronics`, name: `Phone` } })
          write({ type: `insert`, value: { id: 2, categorySlug: `electronics`, name: `Laptop` } })
          write({ type: `insert`, value: { id: 3, categorySlug: `electronics`, name: `Tablet` } })
          write({ type: `insert`, value: { id: 4, categorySlug: `clothing`, name: `Shirt` } })
          write({ type: `insert`, value: { id: 5, categorySlug: `clothing`, name: `Pants` } })
          write({ type: `insert`, value: { id: 6, categorySlug: `books`, name: `Novel` } })
          commit()
          markReady()
        },
      },
    })

    await categoriesCollection.stateWhenReady()
    await productsCollection.stateWhenReady()

    categoriesCollection.createIndex((row) => row.slug)

    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: productsCollection })
          .leftJoin({ category: categoriesCollection }, ({ product, category }) =>
            eq(product.categorySlug, category.slug),
          )
          .select(({ product, category }) => ({
            id: product.id,
            productName: product.name,
            categoryName: category?.name,
          })),
      startSync: true,
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    const inArrayCall = loadSubsetCalls.find(
      (call) =>
        call.where?.type === `func` && (call.where as any).name === `in`,
    )

    expect(inArrayCall).toBeDefined()

    const whereClause = inArrayCall!.where as any
    const inArrayArg = whereClause.args[1]
    expect(inArrayArg.type).toBe(`val`)
    const inArrayValues = inArrayArg.value as Array<string>

    const sortedValues = [...inArrayValues].sort()
    expect(sortedValues).toEqual([`books`, `clothing`, `electronics`])

    const uniqueValues = [...new Set(inArrayValues)]
    expect(inArrayValues.length).toBe(uniqueValues.length)

    await query.cleanup()
    await categoriesCollection.cleanup()
    await productsCollection.cleanup()
  })
})
