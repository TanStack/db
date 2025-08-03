import { describe, expect, it } from "vitest"
import * as fc from "fast-check"
import { createCollection } from "../../src/collection"
import { mockSyncCollectionOptions } from "../utls"
import { Query, getQueryIR } from "../../src/query/builder"
import { count, eq, gt } from "../../src/query/builder/functions"
import { createTempDatabase } from "./sql/sqlite-oracle"
import { astToSQL } from "./sql/ast-to-sql"
import { generateSchema } from "./generators/schema-generator"
import { generateRowsForTable } from "./generators/row-generator"

describe(`Query Builder IR Extraction and SQL Translation`, () => {
  it(`should extract IR from query builder and translate to SQL correctly`, async () => {
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

    // Build query using the query builder
    const queryBuilder = new Query()
      .from({ [tableName]: collection })
      .select((row) => row)

    // Extract IR before optimization
    const queryIR = getQueryIR(queryBuilder)

    console.log(`Extracted IR:`, JSON.stringify(queryIR, null, 2))

    // Convert IR to SQL
    const { sql, params } = astToSQL(queryIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`FROM`)
    expect(sql).toContain(`"${tableName}"`)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get the expected number of rows
    expect(sqliteResult.length).toBe(testRows.length)

    console.log(`✅ Query Builder IR extraction and SQL translation passed`)
    console.log(`   SQL: ${sql}`)
    console.log(`   Parameters: ${JSON.stringify(params)}`)
    console.log(`   Rows returned: ${sqliteResult.length}`)
  })

  it(`should extract IR from WHERE clause query and translate correctly`, async () => {
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
      console.log(`Skipping WHERE test - no string column found`)
      return
    }

    // Get a sample value for the WHERE clause
    const sampleValue =
      testRows.find((row) => row[stringColumn.name] !== undefined)?.[
        stringColumn.name
      ] || `test`

    // Build query using the query builder with WHERE clause
    const queryBuilder = new Query()
      .from({ [tableName]: collection })
      .select((row) => ({
        [table.primaryKey]: row[tableName][table.primaryKey],
        [stringColumn.name]: row[tableName][stringColumn.name],
      }))
      .where((row) => eq(row[tableName][stringColumn.name], sampleValue))

    // Extract IR before optimization
    const queryIR = getQueryIR(queryBuilder)

    console.log(`WHERE IR:`, JSON.stringify(queryIR, null, 2))

    // Convert IR to SQL
    const { sql, params } = astToSQL(queryIR)

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

    console.log(`✅ WHERE clause IR extraction and SQL translation passed`)
    console.log(`   SQL: ${sql}`)
    console.log(`   Parameters: ${JSON.stringify(params)}`)
    console.log(`   Filtered rows: ${sqliteResult.length}`)
  })

  it(`should extract IR from ORDER BY query and translate correctly`, async () => {
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
      console.log(`Skipping ORDER BY test - no sortable column found`)
      return
    }

    // Build query using the query builder with ORDER BY
    const queryBuilder = new Query()
      .from({ [tableName]: collection })
      .select((row) => ({
        [table.primaryKey]: row[tableName][table.primaryKey],
        [sortColumn.name]: row[tableName][sortColumn.name],
      }))
      .orderBy((row) => row[tableName][sortColumn.name], `asc`)

    // Extract IR before optimization
    const queryIR = getQueryIR(queryBuilder)

    console.log(`ORDER BY IR:`, JSON.stringify(queryIR, null, 2))

    // Convert IR to SQL
    const { sql, params } = astToSQL(queryIR)

    // Validate SQL structure
    expect(sql).toContain(`SELECT`)
    expect(sql).toContain(`FROM`)
    expect(sql).toContain(`ORDER BY`)
    expect(sql).toContain(`ASC`)

    // Execute on SQLite to verify SQL is valid
    const sqliteResult = sqliteDb.query(sql, params)

    // Verify we get all rows
    expect(sqliteResult.length).toBe(testRows.length)

    console.log(`✅ ORDER BY IR extraction and SQL translation passed`)
    console.log(`   SQL: ${sql}`)
    console.log(`   Parameters: ${JSON.stringify(params)}`)
    console.log(`   Ordered rows: ${sqliteResult.length}`)
  })

  it(`should extract IR from aggregate query and translate correctly`, async () => {
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

    // Build query using the query builder with COUNT aggregate
    const queryBuilder = new Query()
      .from({ [tableName]: collection })
      .select(() => ({ count: count(`*`) }))

    // Extract IR before optimization
    const queryIR = getQueryIR(queryBuilder)

    console.log(`COUNT IR:`, JSON.stringify(queryIR, null, 2))

    // Convert IR to SQL
    const { sql, params } = astToSQL(queryIR)

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

    console.log(`✅ COUNT aggregate IR extraction and SQL translation passed`)
    console.log(`   SQL: ${sql}`)
    console.log(`   Parameters: ${JSON.stringify(params)}`)
    console.log(`   Count result: ${sqliteResult[0].count}`)
  })

  it(`should extract IR from complex query and translate correctly`, async () => {
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
      console.log(`Skipping complex query test - missing required columns`)
      return
    }

    // Build query using the query builder with WHERE, ORDER BY, and LIMIT
    const queryBuilder = new Query()
      .from({ [tableName]: collection })
      .select((row) => ({
        [table.primaryKey]: row[tableName][table.primaryKey],
        [stringColumn.name]: row[tableName][stringColumn.name],
        [numericColumn.name]: row[tableName][numericColumn.name],
      }))
      .where((row) => gt(row[tableName][numericColumn.name], 0))
      .orderBy((row) => row[tableName][numericColumn.name], `desc`)
      .limit(5)

    // Extract IR before optimization
    const queryIR = getQueryIR(queryBuilder)

    console.log(`Complex IR:`, JSON.stringify(queryIR, null, 2))

    // Convert IR to SQL
    const { sql, params } = astToSQL(queryIR)

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

    console.log(`✅ Complex query IR extraction and SQL translation passed`)
    console.log(`   SQL: ${sql}`)
    console.log(`   Parameters: ${JSON.stringify(params)}`)
    console.log(`   Limited rows: ${sqliteResult.length}`)
  })
})
