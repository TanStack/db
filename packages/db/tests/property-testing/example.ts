#!/usr/bin/env node

/**
 * Example script demonstrating the Property-Based Testing Framework
 *
 * This script shows how to:
 * 1. Run a basic property test
 * 2. Run a quick test suite
 * 3. Handle test failures and regression testing
 */

import {
  PropertyTestHarness,
  runPropertyTest,
  runQuickTestSuite,
} from "./harness/property-test-harness"
import { generateSchema } from "./generators/schema-generator"
import { createTempDatabase } from "./sql/sqlite-oracle"
import { ValueNormalizer } from "./utils/normalizer"
import { astToSQL } from "./sql/ast-to-sql"

async function main() {
  console.log(`🚀 TanStack DB Property-Based Testing Framework Example\n`)

  // Example 1: Basic Property Test
  console.log(`1. Running a basic property test...`)
  try {
    const result = await runPropertyTest({
      maxTables: 1,
      maxColumns: 3,
      maxRowsPerTable: 10,
      maxCommands: 5,
    })

    if (result.success) {
      console.log(`✅ Property test passed!`)
      console.log(`   Seed: ${result.seed}`)
      console.log(`   Commands: ${result.commandCount}`)
    } else {
      console.log(`❌ Property test failed!`)
      console.log(`   Seed: ${result.seed}`)
      console.log(`   Error: ${result.error?.message}`)
      if (result.failingCommands) {
        console.log(`   Failing commands: ${result.failingCommands.length}`)
      }
    }
  } catch (error) {
    console.error(`❌ Error running property test:`, error)
  }

  console.log()

  // Example 2: Quick Test Suite
  console.log(`2. Running quick test suite...`)
  try {
    const suite = await runQuickTestSuite({
      maxTables: 1,
      maxColumns: 2,
      maxRowsPerTable: 5,
      maxCommands: 3,
    })

    console.log(`✅ Test suite completed!`)
    console.log(`   Total tests: ${suite.totalTests}`)
    console.log(`   Passed: ${suite.passedTests}`)
    console.log(`   Failed: ${suite.failedTests}`)
    console.log(
      `   Success rate: ${((suite.passedTests / suite.totalTests) * 100).toFixed(1)}%`
    )

    if (suite.failedTests > 0) {
      console.log(`\n   Failed test details:`)
      suite.results
        .filter((r) => !r.success)
        .forEach((result, index) => {
          console.log(
            `   Test ${index + 1}: Seed ${result.seed} - ${result.error?.message}`
          )
        })
    }
  } catch (error) {
    console.error(`❌ Error running test suite:`, error)
  }

  console.log()

  // Example 3: Custom Test Harness
  console.log(`3. Using custom test harness...`)
  try {
    const harness = new PropertyTestHarness({
      maxTables: 2,
      maxColumns: 4,
      maxRowsPerTable: 20,
      maxCommands: 8,
      maxQueries: 2,
      floatTolerance: 1e-12,
    })

    const stats = harness.getTestStats()
    console.log(`   Configuration:`)
    console.log(`     Max tables: ${stats.config.maxTables}`)
    console.log(`     Max columns: ${stats.config.maxColumns}`)
    console.log(`     Max rows per table: ${stats.config.maxRowsPerTable}`)
    console.log(`     Max commands: ${stats.config.maxCommands}`)
    console.log(`     Max queries: ${stats.config.maxQueries}`)
    console.log(`     Float tolerance: ${stats.config.floatTolerance}`)

    const result = await harness.runPropertyTest(12345) // Fixed seed for reproducibility
    console.log(`   Result: ${result.success ? `PASS` : `FAIL`}`)
  } catch (error) {
    console.error(`❌ Error with custom harness:`, error)
  }

  console.log()

  // Example 4: Individual Components
  console.log(`4. Testing individual components...`)

  // Schema Generation
  console.log(`   Generating schema...`)
  try {
    const schemaArb = generateSchema({ maxTables: 2, maxColumns: 3 })
    const schema = await schemaArb.sample(1)[0]
    console.log(`   ✅ Generated schema with ${schema.tables.length} tables`)
    schema.tables.forEach((table) => {
      console.log(
        `     Table "${table.name}": ${table.columns.length} columns, PK: ${table.primaryKey}`
      )
    })
  } catch (error) {
    console.error(`   ❌ Schema generation failed:`, error)
  }

  // SQLite Oracle
  console.log(`   Testing SQLite oracle...`)
  try {
    const db = createTempDatabase()
    const schema = {
      tables: [
        {
          name: `example`,
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
          ],
          primaryKey: `id`,
        },
      ],
      joinHints: [],
    }

    db.initialize(schema)
    db.insert(`example`, { id: 1, name: `test` })
    const count = db.getRowCount(`example`)
    console.log(`   ✅ SQLite oracle working: ${count} rows in example table`)
  } catch (error) {
    console.error(`   ❌ SQLite oracle failed:`, error)
  }

  // Value Normalization
  console.log(`   Testing value normalization...`)
  try {
    const normalizer = new ValueNormalizer()
    const testValues = [`hello`, 42, true, null, { key: `value` }]

    testValues.forEach((value) => {
      const normalized = normalizer.normalizeValue(value)
      console.log(
        `     ${JSON.stringify(value)} → ${normalized.type} (${normalized.sortKey})`
      )
    })
    console.log(`   ✅ Value normalization working`)
  } catch (error) {
    console.error(`   ❌ Value normalization failed:`, error)
  }

  // AST to SQL Translation
  console.log(`   Testing AST to SQL translation...`)
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
    }

    const { sql, params } = astToSQL(ast)
    console.log(`   ✅ AST to SQL: ${sql}`)
    console.log(`     Parameters: ${JSON.stringify(params)}`)
  } catch (error) {
    console.error(`   ❌ AST to SQL translation failed:`, error)
  }

  console.log(`\n🎉 Example completed!`)
  console.log(`\nTo run more comprehensive tests:`)
  console.log(`  npm run test:property:quick    # Quick property test suite`)
  console.log(`  npm run test:property:coverage # With coverage reporting`)
  console.log(
    `  npm test                       # All tests including property tests`
  )
}

// Run the example
if (require.main === module) {
  main().catch((error) => {
    console.error(`Fatal error:`, error)
    process.exit(1)
  })
}

export { main }
