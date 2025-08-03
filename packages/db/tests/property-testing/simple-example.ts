#!/usr/bin/env node

/**
 * Simple example demonstrating the Property-Based Testing Framework
 *
 * This script shows how to:
 * 1. Generate schemas and data
 * 2. Use the mock SQLite oracle
 * 3. Test value normalization
 * 4. Test AST to SQL translation
 */

import * as fc from "fast-check"
import { generateSchema } from "./generators/schema-generator"
import { createMockDatabase } from "./sql/mock-sqlite-oracle"
import { ValueNormalizer } from "./utils/normalizer"
import { astToSQL } from "./sql/ast-to-sql"

async function main() {
  console.log(
    `🚀 TanStack DB Property-Based Testing Framework - Simple Example\n`
  )

  // Example 1: Schema Generation
  console.log(`1. Generating a schema...`)
  try {
    const schemaArb = generateSchema({ maxTables: 2, maxColumns: 4 })
    const schema = await fc.sample(schemaArb, 1)[0]

    console.log(`✅ Schema generated successfully!`)
    console.log(`   Tables: ${schema.tables.length}`)
    schema.tables.forEach((table) => {
      console.log(
        `     Table "${table.name}": ${table.columns.length} columns, PK: ${table.primaryKey}`
      )
    })
    console.log(`   Join hints: ${schema.joinHints.length}`)
  } catch (error) {
    console.error(`❌ Schema generation failed:`, error)
  }

  console.log()

  // Example 2: Mock SQLite Oracle
  console.log(`2. Testing mock SQLite oracle...`)
  try {
    const db = createMockDatabase()

    const schema = {
      tables: [
        {
          name: `users`,
          columns: [
            {
              name: `id`,
              type: `number`,
              isPrimaryKey: true,
              isNullable: false,
              isJoinable: true,
            },
            {
              name: `name`,
              type: `string`,
              isPrimaryKey: false,
              isNullable: false,
              isJoinable: false,
            },
            {
              name: `email`,
              type: `string`,
              isPrimaryKey: false,
              isNullable: false,
              isJoinable: false,
            },
          ],
          primaryKey: `id`,
        },
      ],
      joinHints: [],
    }

    db.initialize(schema)

    // Insert some data
    db.insert(`users`, { id: 1, name: `Alice`, email: `alice@example.com` })
    db.insert(`users`, { id: 2, name: `Bob`, email: `bob@example.com` })

    console.log(`✅ Mock SQLite oracle working!`)
    console.log(`   Users count: ${db.getRowCount(`users`)}`)

    // Test update
    db.update(`users`, `id`, 1, { name: `Alice Updated` })
    const user = db.getRow(`users`, `id`, 1)
    console.log(`   Updated user: ${user?.name}`)

    // Test transaction
    db.beginTransaction()
    db.insert(`users`, { id: 3, name: `Charlie`, email: `charlie@example.com` })
    console.log(`   Users in transaction: ${db.getRowCount(`users`)}`)
    db.rollbackTransaction()
    console.log(`   Users after rollback: ${db.getRowCount(`users`)}`)
  } catch (error) {
    console.error(`❌ Mock SQLite oracle failed:`, error)
  }

  console.log()

  // Example 3: Value Normalization
  console.log(`3. Testing value normalization...`)
  try {
    const normalizer = new ValueNormalizer()
    const testValues = [`hello`, 42, true, null, { key: `value` }, [1, 2, 3]]

    testValues.forEach((value) => {
      const normalized = normalizer.normalizeValue(value)
      console.log(
        `   ${JSON.stringify(value)} → ${normalized.type} (${normalized.sortKey})`
      )
    })
    console.log(`✅ Value normalization working`)
  } catch (error) {
    console.error(`❌ Value normalization failed:`, error)
  }

  console.log()

  // Example 4: AST to SQL Translation
  console.log(`4. Testing AST to SQL translation...`)
  try {
    const ast = {
      from: {
        type: `collectionRef` as const,
        collection: null as any,
        alias: `users`,
      },
      select: {
        id: { type: `ref` as const, path: [`users`, `id`] },
        name: { type: `ref` as const, path: [`users`, `name`] },
        email: { type: `ref` as const, path: [`users`, `email`] },
      },
      where: [
        {
          type: `func` as const,
          name: `eq`,
          args: [
            { type: `ref` as const, path: [`users`, `id`] },
            { type: `val` as const, value: 1 },
          ],
        },
      ],
      orderBy: [
        {
          expression: { type: `ref` as const, path: [`users`, `name`] },
          direction: `asc` as const,
        },
      ],
    }

    const { sql, params } = astToSQL(ast)
    console.log(`✅ AST to SQL translation working!`)
    console.log(`   SQL: ${sql}`)
    console.log(`   Parameters: ${JSON.stringify(params)}`)
  } catch (error) {
    console.error(`❌ AST to SQL translation failed:`, error)
  }

  console.log()

  // Example 5: Row Set Comparison
  console.log(`5. Testing row set comparison...`)
  try {
    const normalizer = new ValueNormalizer()

    const rows1 = [
      { id: 1, name: `Alice`, email: `alice@example.com` },
      { id: 2, name: `Bob`, email: `bob@example.com` },
    ]

    const rows2 = [
      { id: 2, name: `Bob`, email: `bob@example.com` },
      { id: 1, name: `Alice`, email: `alice@example.com` },
    ]

    const comparison = normalizer.compareRowSets(rows1, rows2)
    console.log(`✅ Row set comparison working!`)
    console.log(`   Rows are equal: ${comparison.equal}`)
    console.log(`   Differences: ${comparison.differences?.length || 0}`)
  } catch (error) {
    console.error(`❌ Row set comparison failed:`, error)
  }

  console.log(`\n🎉 Simple example completed!`)
  console.log(`\nTo run the full property tests:`)
  console.log(`  npm run test:property:quick    # Quick property test suite`)
  console.log(`  npm run test:property:coverage # With coverage reporting`)
  console.log(
    `  npm test                       # All tests including property tests`
  )
}

// Run the example
main().catch((error) => {
  console.error(`Fatal error:`, error)
  process.exit(1)
})

export { main }
