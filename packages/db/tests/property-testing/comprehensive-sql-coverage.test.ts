import { describe, expect, it } from "vitest"
import { Query, getQueryIR } from "../../src/query/builder"
import {
  add,
  and,
  avg,
  coalesce,
  concat,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  length,
  like,
  lower,
  lt,
  lte,
  max,
  min,
  not,
  or,
  sum,
  upper,
} from "../../src/query/builder/functions"
import { createCollection } from "../../src/collection"
import { mockSyncCollectionOptions } from "../utls"
import { astToSQL } from "./sql/ast-to-sql"

describe(`Comprehensive SQL Translation Coverage`, () => {
  // Helper function to test SQL translation
  function testSQLTranslation(
    description: string,
    queryBuilder: any,
    expectedSQLPatterns: Array<string>,
    expectedParams: Array<any> = []
  ) {
    it(description, () => {
      // Extract IR from query builder
      const queryIR = getQueryIR(queryBuilder)

      // Convert to SQL
      const { sql, params } = astToSQL(queryIR)

      // Validate SQL structure
      for (const pattern of expectedSQLPatterns) {
        expect(sql).toContain(pattern)
      }

      // Validate parameters
      if (expectedParams.length > 0) {
        expect(params).toEqual(expect.arrayContaining(expectedParams))
      }
    })
  }

  describe(`Basic SELECT Operations`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate simple SELECT *`,
      new Query().from({ users: collection }).select((row) => row),
      [`SELECT`, `FROM`, `"users"`]
    )

    testSQLTranslation(
      `should translate SELECT with specific columns`,
      new Query().from({ users: collection }).select((row) => ({
        id: row.users.id!,
        name: row.users.name!,
      })),
      [`SELECT`, `FROM`, `"users"`, `AS`]
    )
  })

  describe(`Comparison Operators`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate eq() comparison`,
      new Query()
        .from({ users: collection })
        .where((row) => eq(row.users.id!, 1)),
      [`SELECT`, `FROM`, `WHERE`, `=`, `?`],
      [1]
    )

    testSQLTranslation(
      `should translate gt() comparison`,
      new Query()
        .from({ users: collection })
        .where((row) => gt(row.users.age!, 18)),
      [`SELECT`, `FROM`, `WHERE`, `>`, `?`],
      [18]
    )

    testSQLTranslation(
      `should translate gte() comparison`,
      new Query()
        .from({ users: collection })
        .where((row) => gte(row.users.age!, 18)),
      [`SELECT`, `FROM`, `WHERE`, `>=`, `?`],
      [18]
    )

    testSQLTranslation(
      `should translate lt() comparison`,
      new Query()
        .from({ users: collection })
        .where((row) => lt(row.users.age!, 65)),
      [`SELECT`, `FROM`, `WHERE`, `<`, `?`],
      [65]
    )

    testSQLTranslation(
      `should translate lte() comparison`,
      new Query()
        .from({ users: collection })
        .where((row) => lte(row.users.age!, 65)),
      [`SELECT`, `FROM`, `WHERE`, `<=`, `?`],
      [65]
    )
  })

  describe(`Logical Operators`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate AND operator`,
      new Query()
        .from({ users: collection })
        .where((row) =>
          and(eq(row.users.age!, 25), eq(row.users.active!, true))
        ),
      [`SELECT`, `FROM`, `WHERE`, `AND`]
    )

    testSQLTranslation(
      `should translate OR operator`,
      new Query()
        .from({ users: collection })
        .where((row) => or(eq(row.users.age!, 25), eq(row.users.age!, 30))),
      [`SELECT`, `FROM`, `WHERE`, `OR`]
    )

    testSQLTranslation(
      `should translate NOT operator`,
      new Query()
        .from({ users: collection })
        .where((row) => not(eq(row.users.active!, false))),
      [`SELECT`, `FROM`, `WHERE`, `NOT`]
    )
  })

  describe(`String Functions`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate LIKE operator`,
      new Query()
        .from({ users: collection })
        .where((row) => like(row.users.name! as any, `%john%`)),
      [`SELECT`, `FROM`, `WHERE`, `LIKE`, `?`],
      [`%john%`]
    )

    testSQLTranslation(
      `should translate ILIKE operator`,
      new Query()
        .from({ users: collection })
        .where((row) => ilike(row.users.name! as any, `%john%`)),
      [`SELECT`, `FROM`, `WHERE`, `ILIKE`, `?`],
      [`%john%`]
    )

    testSQLTranslation(
      `should translate UPPER function`,
      new Query().from({ users: collection }).select((row) => ({
        name: upper(row.users.name! as any),
      })),
      [`SELECT`, `UPPER`, `FROM`]
    )

    testSQLTranslation(
      `should translate LOWER function`,
      new Query().from({ users: collection }).select((row) => ({
        name: lower(row.users.name! as any),
      })),
      [`SELECT`, `LOWER`, `FROM`]
    )

    testSQLTranslation(
      `should translate LENGTH function`,
      new Query().from({ users: collection }).select((row) => ({
        nameLength: length(row.users.name! as any),
      })),
      [`SELECT`, `LENGTH`, `FROM`]
    )

    testSQLTranslation(
      `should translate CONCAT function`,
      new Query().from({ users: collection }).select((row) => ({
        fullName: concat(
          row.users.firstName! as any,
          ` `,
          row.users.lastName! as any
        ),
      })),
      [`SELECT`, `CONCAT`, `FROM`]
    )
  })

  describe(`Aggregate Functions`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate COUNT aggregate`,
      new Query().from({ users: collection }).select(() => ({
        total: count(`*` as any),
      })),
      [`SELECT`, `COUNT`, `FROM`]
    )

    testSQLTranslation(
      `should translate SUM aggregate`,
      new Query().from({ users: collection }).select(() => ({
        totalSalary: sum(`salary` as any),
      })),
      [`SELECT`, `SUM`, `FROM`]
    )

    testSQLTranslation(
      `should translate AVG aggregate`,
      new Query().from({ users: collection }).select(() => ({
        avgSalary: avg(`salary` as any),
      })),
      [`SELECT`, `AVG`, `FROM`]
    )

    testSQLTranslation(
      `should translate MIN aggregate`,
      new Query().from({ users: collection }).select(() => ({
        minSalary: min(`salary` as any),
      })),
      [`SELECT`, `MIN`, `FROM`]
    )

    testSQLTranslation(
      `should translate MAX aggregate`,
      new Query().from({ users: collection }).select(() => ({
        maxSalary: max(`salary` as any),
      })),
      [`SELECT`, `MAX`, `FROM`]
    )
  })

  describe(`ORDER BY and LIMIT`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate ORDER BY ASC`,
      new Query()
        .from({ users: collection })
        .orderBy((row) => row.users.name!, `asc`),
      [`SELECT`, `FROM`, `ORDER BY`, `ASC`]
    )

    testSQLTranslation(
      `should translate ORDER BY DESC`,
      new Query()
        .from({ users: collection })
        .orderBy((row) => row.users.age!, `desc`),
      [`SELECT`, `FROM`, `ORDER BY`, `DESC`]
    )

    testSQLTranslation(
      `should translate LIMIT`,
      new Query().from({ users: collection }).limit(10),
      [`SELECT`, `FROM`, `LIMIT`]
    )

    testSQLTranslation(
      `should translate OFFSET`,
      new Query().from({ users: collection }).offset(20),
      [`SELECT`, `FROM`, `OFFSET`]
    )

    testSQLTranslation(
      `should translate ORDER BY with LIMIT and OFFSET`,
      new Query()
        .from({ users: collection })
        .orderBy((row) => row.users.age!, `desc`)
        .limit(10)
        .offset(20),
      [`SELECT`, `FROM`, `ORDER BY`, `DESC`, `LIMIT`, `OFFSET`]
    )
  })

  describe(`Complex WHERE Conditions`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate complex AND/OR conditions`,
      new Query()
        .from({ users: collection })
        .where((row) =>
          and(
            gte(row.users.age!, 18),
            or(eq(row.users.active!, true), eq(row.users.verified!, true))
          )
        ),
      [`SELECT`, `FROM`, `WHERE`, `AND`, `OR`, `>=`, `=`]
    )

    testSQLTranslation(
      `should translate nested conditions`,
      new Query()
        .from({ users: collection })
        .where((row) =>
          and(
            gt(row.users.age!, 18),
            lt(row.users.age!, 65),
            not(eq(row.users.banned!, true))
          )
        ),
      [`SELECT`, `FROM`, `WHERE`, `AND`, `NOT`, `>`, `<`, `=`]
    )
  })

  describe(`Mathematical Functions`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate ADD function`,
      new Query().from({ users: collection }).select((row) => ({
        total: add(row.users.salary! as any, row.users.bonus! as any),
      })),
      [`SELECT`, `+`, `FROM`]
    )

    testSQLTranslation(
      `should translate COALESCE function`,
      new Query().from({ users: collection }).select((row) => ({
        displayName: coalesce(row.users.nickname!, row.users.name!, `Unknown`),
      })),
      [`SELECT`, `COALESCE`, `FROM`]
    )
  })

  describe(`Array Operations`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate IN ARRAY operator`,
      new Query()
        .from({ users: collection })
        .where((row) => inArray(row.users.id!, [1, 2, 3, 4, 5])),
      [`SELECT`, `FROM`, `WHERE`, `IN`]
    )
  })

  describe(`DISTINCT`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate DISTINCT`,
      new Query()
        .from({ users: collection })
        .select((row) => row.users.department! as any)
        .distinct(),
      [`SELECT`, `DISTINCT`, `FROM`]
    )
  })

  describe(`GROUP BY and HAVING`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate GROUP BY`,
      new Query()
        .from({ users: collection })
        .select(() => ({
          department: `department`,
          count: count(`*` as any),
        }))
        .groupBy((row) => row.users.department!),
      [`SELECT`, `FROM`, `GROUP BY`, `COUNT`]
    )

    testSQLTranslation(
      `should translate HAVING`,

      new Query()
        .from({ users: collection })
        .select(() => ({
          department: `department`,
          // @ts-expect-error - avg function expects number but we're passing string
          avgSalary: avg(`salary`),
        }))
        .groupBy((row) => row.users.department!)
        // @ts-expect-error - Property access on RefProxyForContext
        .having((row) => gt(row.avgSalary as any, 50000)),
      [`SELECT`, `FROM`, `GROUP BY`, `HAVING`, `>`, `AVG`]
    )
  })

  describe(`JOIN Operations`, () => {
    const usersCollection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    const postsCollection = createCollection(
      mockSyncCollectionOptions({
        id: `posts`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate INNER JOIN`,
      new Query()
        .from({ users: usersCollection })
        .innerJoin({ posts: postsCollection }, (row) =>
          eq(row.users.id!, row.posts.userId!)
        )
        .select((row) => ({
          userName: row.users.name!,
          postTitle: row.posts.title!,
        })),
      [`SELECT`, `FROM`, `INNER JOIN`, `ON`, `=`]
    )

    testSQLTranslation(
      `should translate LEFT JOIN`,
      new Query()
        .from({ users: usersCollection })
        .leftJoin({ posts: postsCollection }, (row) =>
          eq(row.users.id!, row.posts.userId!)
        )
        .select((row) => ({
          userName: row.users.name!,
          postTitle: row.posts.title!,
        })),
      [`SELECT`, `FROM`, `LEFT JOIN`, `ON`, `=`]
    )

    testSQLTranslation(
      `should translate RIGHT JOIN`,
      new Query()
        .from({ users: usersCollection })
        .rightJoin({ posts: postsCollection }, (row) =>
          eq(row.users.id!, row.posts.userId!)
        )
        .select((row) => ({
          userName: row.users.name!,
          postTitle: row.posts.title!,
        })),
      [`SELECT`, `FROM`, `RIGHT JOIN`, `ON`, `=`]
    )

    testSQLTranslation(
      `should translate FULL JOIN`,
      new Query()
        .from({ users: usersCollection })
        .fullJoin({ posts: postsCollection }, (row) =>
          eq(row.users.id!, row.posts.userId!)
        )
        .select((row) => ({
          userName: row.users.name!,
          postTitle: row.posts.title!,
        })),
      [`SELECT`, `FROM`, `FULL JOIN`, `ON`, `=`]
    )
  })

  describe(`Subqueries`, () => {
    const usersCollection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    const postsCollection = createCollection(
      mockSyncCollectionOptions({
        id: `posts`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate subquery in FROM clause`,
      new Query()
        .from({
          activeUsers: new Query()
            .from({ users: usersCollection })
            .where((row) => eq(row.users.active!, true)),
        })
        .select((row) => row.activeUsers as any),
      [`SELECT`, `FROM`, `WHERE`, `=`]
    )

    testSQLTranslation(
      `should translate subquery in WHERE clause`,
      new Query().from({ users: usersCollection }).where((row) =>
        inArray(
          row.users.id!,
          new Query()
            .from({ posts: postsCollection })
            .select((postRow) => postRow.posts.userId as any)
        )
      ),
      [`SELECT`, `FROM`, `WHERE`, `IN`]
    )
  })

  describe(`Complex Queries`, () => {
    const usersCollection = createCollection(
      mockSyncCollectionOptions({
        id: `users`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    const postsCollection = createCollection(
      mockSyncCollectionOptions({
        id: `posts`,
        getKey: (item: any) => item!.id,
        initialData: [],
        autoIndex: `eager`,
      })
    )

    testSQLTranslation(
      `should translate complex query with joins, where, group by, having, order by, and limit`,
      new Query()
        .from({ users: usersCollection })
        .leftJoin({ posts: postsCollection }, (row) =>
          eq(row.users.id!, row.posts.userId!)
        )
        .where((row) =>
          and(gte(row.users.age!, 18), eq(row.users.active!, true))
        )
        .select(() => ({
          department: `department`,
          userCount: count(`*` as any),
          avgAge: avg(`age` as any),
        }))
        .groupBy((row) => row.users.department!)
        // @ts-expect-error - Property access on RefProxyForContext
        .having((row) => gt(row.userCount as any, 5))
        // @ts-expect-error - Property access on RefProxyForContext
        .orderBy((row) => row.avgAge as any, `desc`)
        .limit(10),
      [
        `SELECT`,
        `FROM`,
        `LEFT JOIN`,
        `ON`,
        `WHERE`,
        `AND`,
        `>=`,
        `=`,
        `GROUP BY`,
        `HAVING`,
        `>`,
        `ORDER BY`,
        `DESC`,
        `LIMIT`,
        `COUNT`,
        `AVG`,
      ]
    )
  })
})
