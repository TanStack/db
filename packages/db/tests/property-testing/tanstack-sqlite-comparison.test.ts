import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as fc from "fast-check"
import { createCollection } from "../../src/collection"
import { createLiveQueryCollection } from "../../src/query"
import {
  Aggregate,
  CollectionRef,
  Func,
  PropRef,
  Value,
} from "../../src/query/ir"
import { mockSyncCollectionOptions } from "../utls"
import { createTempDatabase } from "./sql/sqlite-oracle"
import { astToSQL } from "./sql/ast-to-sql"
import { ValueNormalizer } from "./utils/normalizer"
import { generateSchema } from "./generators/schema-generator"
import { generateRowsForTable } from "./generators/row-generator"

describe(`SQL Translation and Execution Comparison`, () => {
  let normalizer: ValueNormalizer

  beforeAll(() => {
    normalizer = new ValueNormalizer()
  })

  afterAll(() => {
    // Cleanup
  })

  it(`should translate and execute simple SELECT queries correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]
    if (!schema) throw new Error(`Failed to generate schema`)

    const table = schema.tables[0]
    if (!table) throw new Error(`No tables in schema`)
    const tableName = table.name

    // Create SQLite database
    const sqliteDb = createTempDatabase()
    sqliteDb.initialize(schema)

    // Create TanStack collection
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: tableName,
        getKey: (item: any) => item[table.primaryKey],
        initialData: [],
        autoIndex: `eager`,
      })
    )

    // Generate and insert test data
    const testRows = await fc.sample(
      generateRowsForTable(table, { minRows: 5, maxRows: 10 }),
      1
    )[0]
    if (!testRows) throw new Error(`Failed to generate test rows`)

    // Insert into SQLite
    for (const row of testRows) {
      sqliteDb.insert(tableName, row)
    }

    // Insert into TanStack collection
    for (const row of testRows) {
      collection.insert(row)
    }

    // Test simple SELECT *
    const selectAllAST = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        // Select all columns
        ...Object.fromEntries(
          table.columns.map((col) => [
            col.name,
            new PropRef([tableName, col.name]),
          ])
        ),
      },
    }

    // Execute on TanStack DB using the IR directly
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) => q.from({ [tableName]: collection }).select((row) => row),
    })
    const tanstackResult = liveQuery.toArray

    // Execute on SQLite
    const { sql, params } = astToSQL(selectAllAST)
    const sqliteResult = sqliteDb.query(sql, params)

    // Compare results
    const comparison = normalizer.compareRowSets(tanstackResult, sqliteResult)

    expect(comparison.equal).toBe(true)
    expect(comparison.differences).toBeUndefined()
  })

  it(`should translate and execute WHERE clause queries correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]
    if (!schema) throw new Error(`Failed to generate schema`)

    const table = schema.tables[0]
    if (!table) throw new Error(`No tables in schema`)
    const tableName = table.name

    // Create SQLite database
    const sqliteDb = createTempDatabase()
    sqliteDb.initialize(schema)

    // Create TanStack collection
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: tableName,
        getKey: (item: any) => item[table.primaryKey],
        initialData: [],
        autoIndex: `eager`,
      })
    )

    // Generate and insert test data
    const testRows = await fc.sample(
      generateRowsForTable(table, { minRows: 10, maxRows: 20 }),
      1
    )[0]

    // Insert into both databases
    for (const row of testRows!) {
      sqliteDb.insert(tableName, row)
      collection.insert(row)
    }

    // Find a string column for WHERE clause
    const stringColumn = table.columns.find(
      (col) => col.type === `string` && !col.isPrimaryKey
    )
    if (!stringColumn) {
      return
    }

    // Get a sample value for the WHERE clause
    const sampleValue = testRows![0]![stringColumn.name]

    // Test WHERE clause
    const whereAST = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        [table.primaryKey]: new PropRef([tableName, table.primaryKey]),
        [stringColumn.name]: new PropRef([tableName, stringColumn.name]),
      },
      where: [
        new Func(`eq`, [
          new PropRef([tableName, stringColumn.name]),
          new Value(sampleValue),
        ]),
      ],
    }

    // Execute on TanStack DB
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ [tableName]: collection })
          .select((row) => ({
            [table.primaryKey]: row[table.primaryKey]!,
            [stringColumn.name]: row[stringColumn.name]!,
          }))
          .where((row) => row[stringColumn.name] === sampleValue),
    })
    const tanstackResult = liveQuery.toArray

    // Execute on SQLite
    const { sql, params } = astToSQL(whereAST)
    const sqliteResult = sqliteDb.query(sql, params)

    // Compare results
    const comparison = normalizer.compareRowSets(tanstackResult, sqliteResult)

    expect(comparison.equal).toBe(true)
    expect(comparison.differences).toBeUndefined()
  })

  it(`should translate and execute ORDER BY queries correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]
    if (!schema) throw new Error(`Failed to generate schema`)

    const table = schema.tables[0]
    if (!table) throw new Error(`No tables in schema`)
    const tableName = table.name

    // Create SQLite database
    const sqliteDb = createTempDatabase()
    sqliteDb.initialize(schema)

    // Create TanStack collection
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: tableName,
        getKey: (item: any) => item[table.primaryKey],
        initialData: [],
        autoIndex: `eager`,
      })
    )

    // Generate and insert test data
    const testRows = await fc.sample(
      generateRowsForTable(table, { minRows: 10, maxRows: 20 }),
      1
    )[0]

    // Insert into both databases
    for (const row of testRows!) {
      sqliteDb.insert(tableName, row)
      collection.insert(row)
    }

    // Find a sortable column
    const sortColumn = table.columns.find(
      (col) => col.type === `string` || col.type === `number`
    )
    if (!sortColumn) {
      return
    }

    // Test ORDER BY
    const orderByAST = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        [table.primaryKey]: new PropRef([tableName, table.primaryKey]),
        [sortColumn.name]: new PropRef([tableName, sortColumn.name]),
      },
      orderBy: [
        {
          expression: new PropRef([tableName, sortColumn.name]),
          direction: `asc` as const,
        },
      ],
    }

    // Execute on TanStack DB
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ [tableName]: collection })
          .select((row) => ({
            [table.primaryKey]: row[table.primaryKey],
            [sortColumn.name]: row[sortColumn.name],
          }))
          .orderBy((row) => row[sortColumn.name], `asc`),
    })
    const tanstackResult = liveQuery.toArray

    // Execute on SQLite
    const { sql, params } = astToSQL(orderByAST)
    const sqliteResult = sqliteDb.query(sql, params)

    // Compare results
    const comparison = normalizer.compareRowSets(tanstackResult, sqliteResult)

    expect(comparison.equal).toBe(true)
    expect(comparison.differences).toBeUndefined()
  })

  it(`should handle aggregate functions correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema!.tables[0]
    const tableName = table!.name

    // Create SQLite database
    const sqliteDb = createTempDatabase()
    sqliteDb.initialize(schema!)

    // Create TanStack collection
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: tableName,
        getKey: (item: any) => item[table!.primaryKey],
        initialData: [],
        autoIndex: `eager`,
      })
    )

    // Generate and insert test data
    const testRows = await fc.sample(
      generateRowsForTable(table!, { minRows: 10, maxRows: 20 }),
      1
    )[0]

    // Insert into both databases
    for (const row of testRows!) {
      sqliteDb.insert(tableName, row)
      collection.insert(row)
    }

    // Find a numeric column for aggregation
    const numericColumn = table!.columns.find(
      (col) => col.type === `number` && !col.isPrimaryKey
    )
    if (!numericColumn) {
      return
    }

    // Test COUNT aggregate
    const countAST = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        count: new Aggregate(`count`, []),
      },
    }

    // Execute on TanStack DB
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ [tableName]: collection })
          .select(() => ({ count: q.count() })),
    })
    const tanstackResult = liveQuery.toArray

    // Execute on SQLite
    const { sql, params } = astToSQL(countAST)
    const sqliteResult = sqliteDb.query(sql, params)

    // Compare results
    const comparison = normalizer.compareRowSets(tanstackResult, sqliteResult)

    expect(comparison.equal).toBe(true)
    expect(comparison.differences).toBeUndefined()
  })

  it(`should handle complex queries with multiple clauses`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 4 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema!.tables[0]
    const tableName = table!.name

    // Create SQLite database
    const sqliteDb = createTempDatabase()
    sqliteDb.initialize(schema!)

    // Create TanStack collection
    const collection = createCollection(
      mockSyncCollectionOptions({
        id: tableName,
        getKey: (item: any) => item[table!.primaryKey],
        initialData: [],
        autoIndex: `eager`,
      })
    )

    // Generate and insert test data
    const testRows = await fc.sample(
      generateRowsForTable(table!, { minRows: 20, maxRows: 50 }),
      1
    )[0]

    // Insert into both databases
    for (const row of testRows!) {
      sqliteDb.insert(tableName, row)
      collection.insert(row)
    }

    // Find columns for complex query
    const stringColumn = table!.columns.find(
      (col) => col.type === `string` && !col.isPrimaryKey
    )
    const numericColumn = table!.columns.find(
      (col) => col.type === `number` && !col.isPrimaryKey
    )

    if (!stringColumn || !numericColumn) {
      return
    }

    // Test complex query with WHERE, ORDER BY, and LIMIT
    const complexAST = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        [table!.primaryKey]: new PropRef([tableName, table!.primaryKey]),
        [stringColumn.name]: new PropRef([tableName, stringColumn.name]),
        [numericColumn.name]: new PropRef([tableName, numericColumn.name]),
      },
      where: [
        new Func(`gt`, [
          new PropRef([tableName, numericColumn.name]),
          new Value(0),
        ]),
      ],
      orderBy: [
        {
          expression: new PropRef([tableName, numericColumn.name]),
          direction: `desc` as const,
        },
      ],
      limit: 5,
    }

    // Execute on TanStack DB
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ [tableName]: collection })
          .select((row) => ({
            [table!.primaryKey]: row[table!.primaryKey],
            [stringColumn.name]: row[stringColumn.name],
            [numericColumn.name]: row[numericColumn.name],
          }))
          .where((row) => row[numericColumn.name] > 0)
          .orderBy((row) => row[numericColumn.name], `desc`)
          .limit(5),
    })
    const tanstackResult = liveQuery.toArray

    // Execute on SQLite
    const { sql, params } = astToSQL(complexAST)
    const sqliteResult = sqliteDb.query(sql, params)

    // Compare results
    const comparison = normalizer.compareRowSets(tanstackResult, sqliteResult)

    expect(comparison.equal).toBe(true)
    expect(comparison.differences).toBeUndefined()
  })
})
