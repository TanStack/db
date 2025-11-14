import { describe, expect, it } from "vitest"
import { createHasuraDialect } from "../dialects/hasura"
import { createPostGraphileDialect } from "../dialects/postgraphile"
import { createPrismaDialect } from "../dialects/prisma"

describe(`Dialect Adapters`, () => {
  describe(`HasuraDialect`, () => {
    const dialect = createHasuraDialect()

    it(`should format order by correctly`, () => {
      const result = dialect.formatOrderBy([
        { field: `createdAt`, direction: `desc` },
        { field: `title`, direction: `asc` },
      ])

      expect(result).toEqual([{ createdAt: `desc` }, { title: `asc` }])
    })

    it(`should return correct query field name`, () => {
      expect(dialect.getQueryFieldName(`Post`)).toBe(`posts`)
      expect(dialect.getQueryFieldName(`User`)).toBe(`users`)
    })

    it(`should return correct mutation field names`, () => {
      const mutations = dialect.getMutationFieldNames(`Post`)
      expect(mutations.insert).toBe(`insert_post`)
      expect(mutations.update).toBe(`update_post`)
      expect(mutations.delete).toBe(`delete_post`)
    })
  })

  describe(`PostGraphileDialect`, () => {
    const dialect = createPostGraphileDialect()

    it(`should format order by as enums`, () => {
      const result = dialect.formatOrderBy([
        { field: `createdAt`, direction: `desc` },
      ])

      expect(result).toEqual([`CREATEDAT_DESC`])
    })

    it(`should return correct query field name`, () => {
      expect(dialect.getQueryFieldName(`Post`)).toBe(`allPosts`)
    })

    it(`should support connections`, () => {
      expect(dialect.supportsConnections()).toBe(true)
    })
  })

  describe(`PrismaDialect`, () => {
    const dialect = createPrismaDialect()

    it(`should format order by correctly`, () => {
      const result = dialect.formatOrderBy([
        { field: `createdAt`, direction: `desc` },
      ])

      expect(result).toEqual([{ createdAt: `desc` }])
    })

    it(`should return correct mutation field names`, () => {
      const mutations = dialect.getMutationFieldNames(`Post`)
      expect(mutations.insert).toBe(`createOnePost`)
      expect(mutations.update).toBe(`updateOnePost`)
      expect(mutations.delete).toBe(`deleteOnePost`)
      expect(mutations.upsert).toBe(`upsertOnePost`)
    })
  })
})
