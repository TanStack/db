import { describe, expect, it } from "vitest"
import * as fc from "fast-check"
import { createCollection } from "../../src/collection"
import { mockSyncCollectionOptions } from "../utls"
import {
  Aggregate,
  CollectionRef,
  Func,
  PropRef,
  Value,
} from "../../src/query/ir"
import { createTempDatabase } from "./sql/sqlite-oracle"
import { astToSQL } from "./sql/ast-to-sql"
import { generateSchema } from "./generators/schema-generator"
import { generateRowsForTable } from "./generators/row-generator"

describe(`IR to SQL Translation`, () => {
  it(`should translate simple SELECT queries correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema.tables[0]
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

    // Insert into SQLite
    for (const row of testRows) {
      sqliteDb.insert(tableName, row)
    }

    // Create IR for SELECT *
    const selectAllIR = {
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

    // Convert IR to SQL
    const { sql, params } = astToSQL(selectAllIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`FROM`)
    expect(sql).toContain(`"${tableName}"`)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get the expected number of rows
    expect(sqliteResult.length).toBe(testRows.length)
  })

  it(`should translate WHERE clause queries correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema.tables[0]
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

    // Insert into SQLite
    for (const row of testRows) {
      sqliteDb.insert(tableName, row)
    }

    // Find a string column for WHERE clause
    const stringColumn = table.columns.find(
      (col) => col.type === `string` && !col.isPrimaryKey
    )
    if (!stringColumn) {
      return
    }

    // Get a sample value for the WHERE clause
    const sampleValue =
      testRows.find((row) => row[stringColumn.name] !== undefined)?.[
        stringColumn.name
      ] || `test`

    // Create IR for WHERE clause
    const whereIR = {
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

    // Convert IR to SQL
    const { sql, params } = astToSQL(whereIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`FROM`)
    expect(sql).toContain(`WHERE`)
    expect(sql).toContain(`=`)
    expect(params).toContain(sampleValue)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get filtered results
    expect(sqliteResult.length).toBeGreaterThanOrEqual(0)
    expect(sqliteResult.length).toBeLessThanOrEqual(testRows.length)
  })

  it(`should translate ORDER BY queries correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema.tables[0]
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

    // Insert into SQLite
    for (const row of testRows) {
      sqliteDb.insert(tableName, row)
    }

    // Find a sortable column
    const sortColumn = table.columns.find(
      (col) => col.type === `string` || col.type === `number`
    )
    if (!sortColumn) {
      return
    }

    // Create IR for ORDER BY
    const orderByIR = {
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

    // Convert IR to SQL
    const { sql, params } = astToSQL(orderByIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`FROM`)
    expect(sql).toContain(`ORDER BY`)
    expect(sql).toContain(`ASC`)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get all rows
    expect(sqliteResult.length).toBe(testRows.length)
  })

  it(`should translate aggregate functions correctly`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 3 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema.tables[0]
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

    // Insert into SQLite
    for (const row of testRows) {
      sqliteDb.insert(tableName, row)
    }

    // Create IR for COUNT aggregate
    const countIR = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        count: new Aggregate(`count`, []),
      },
    }

    // Convert IR to SQL
    const { sql, params } = astToSQL(countIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`COUNT`)
    expect(sql).toContain(`FROM`)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get a count result
    expect(sqliteResult.length).toBe(1)
    expect(sqliteResult[0]).toHaveProperty(`count`)
    expect(Number(sqliteResult[0].count)).toBe(testRows.length)
  })

  it(`should translate complex queries with multiple clauses`, async () => {
    // Generate a simple schema
    const schemaArb = generateSchema({ maxTables: 1, maxColumns: 4 })
    const schema = await fc.sample(schemaArb, 1)[0]

    const table = schema.tables[0]
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
      generateRowsForTable(table, { minRows: 20, maxRows: 50 }),
      1
    )[0]

    // Insert into SQLite
    for (const row of testRows) {
      sqliteDb.insert(tableName, row)
    }

    // Find columns for complex query
    const stringColumn = table.columns.find(
      (col) => col.type === `string` && !col.isPrimaryKey
    )
    const numericColumn = table.columns.find(
      (col) => col.type === `number` && !col.isPrimaryKey
    )

    if (!stringColumn || !numericColumn) {
      return
    }

    // Create IR for complex query with WHERE, ORDER BY, and LIMIT
    const complexIR = {
      from: new CollectionRef(collection as any, tableName),
      select: {
        [table.primaryKey]: new PropRef([tableName, table.primaryKey]),
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

    // Convert IR to SQL
    const { sql, params } = astToSQL(complexIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`FROM`)
    expect(sql).toContain(`WHERE`)
    expect(sql).toContain(`ORDER BY`)
    expect(sql).toContain(`LIMIT`)
    expect(sql).toContain(`>`)
    expect(sql).toContain(`DESC`)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get limited results
    expect(sqliteResult.length).toBeLessThanOrEqual(5)
  })
})
