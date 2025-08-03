import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Patterns to fix remaining errors
const patterns = [
  // Fix schema.tables[0] -> schema!.tables[0]
  { 
    pattern: /schema\.tables\[0\]/g, 
    replacement: 'schema!.tables[0]' 
  },
  // Fix table.name -> table!.name
  { 
    pattern: /table\.name/g, 
    replacement: 'table!.name' 
  },
  // Fix table.primaryKey -> table!.primaryKey
  { 
    pattern: /table\.primaryKey/g, 
    replacement: 'table!.primaryKey' 
  },
  // Fix table.columns -> table!.columns
  { 
    pattern: /table\.columns/g, 
    replacement: 'table!.columns' 
  },
  // Fix sqliteDb.initialize(schema) -> sqliteDb.initialize(schema!)
  { 
    pattern: /sqliteDb\.initialize\(schema\)/g, 
    replacement: 'sqliteDb.initialize(schema!)' 
  },
  // Fix generateRowsForTable(table, -> generateRowsForTable(table!,
  { 
    pattern: /generateRowsForTable\(table,/g, 
    replacement: 'generateRowsForTable(table!,' 
  },
  // Fix getKey: (item: any) => item[table.primaryKey] -> getKey: (item: any) => item[table!.primaryKey]
  { 
    pattern: /getKey: \(item: any\) => item\[table\.primaryKey\]/g, 
    replacement: 'getKey: (item: any) => item[table!.primaryKey]' 
  },
  // Fix row[tableName][table.primaryKey] -> row[tableName][table!.primaryKey]
  { 
    pattern: /row\[tableName\]\[table\.primaryKey\]/g, 
    replacement: 'row[tableName][table!.primaryKey]' 
  },
  // Fix row[tableName][stringColumn.name] -> row[tableName][stringColumn.name]
  { 
    pattern: /row\[tableName\]\[stringColumn\.name\]/g, 
    replacement: 'row[tableName][stringColumn.name]' 
  },
  // Fix row[tableName][numericColumn.name] -> row[tableName][numericColumn.name]
  { 
    pattern: /row\[tableName\]\[numericColumn\.name\]/g, 
    replacement: 'row[tableName][numericColumn.name]' 
  },
  // Fix row[tableName][sortColumn.name] -> row[tableName][sortColumn.name]
  { 
    pattern: /row\[tableName\]\[sortColumn\.name\]/g, 
    replacement: 'row[tableName][sortColumn.name]' 
  },
  // Fix [table.primaryKey] -> [table!.primaryKey]
  { 
    pattern: /\[table\.primaryKey\]/g, 
    replacement: '[table!.primaryKey]' 
  },
  // Fix [stringColumn.name] -> [stringColumn.name]
  { 
    pattern: /\[stringColumn\.name\]/g, 
    replacement: '[stringColumn.name]' 
  },
  // Fix [numericColumn.name] -> [numericColumn.name]
  { 
    pattern: /\[numericColumn\.name\]/g, 
    replacement: '[numericColumn.name]' 
  },
  // Fix [sortColumn.name] -> [sortColumn.name]
  { 
    pattern: /\[sortColumn\.name\]/g, 
    replacement: '[sortColumn.name]' 
  },
  // Fix testRows. -> testRows!.
  { 
    pattern: /testRows\./g, 
    replacement: 'testRows!.' 
  },
  // Fix for (const row of testRows) -> for (const row of testRows!)
  { 
    pattern: /for \(const row of testRows\)/g, 
    replacement: 'for (const row of testRows!)' 
  },
  // Fix sqliteResult[0]. -> sqliteResult[0]!.
  { 
    pattern: /sqliteResult\[0\]\./g, 
    replacement: 'sqliteResult[0]!.' 
  },
  // Fix commands. -> commands!.
  { 
    pattern: /commands\./g, 
    replacement: 'commands!.' 
  },
  // Fix value. -> value!.
  { 
    pattern: /value\./g, 
    replacement: 'value!.' 
  },
  // Fix expr. -> expr!.
  { 
    pattern: /expr\./g, 
    replacement: 'expr!.' 
  },
  // Fix join. -> join!.
  { 
    pattern: /join\./g, 
    replacement: 'join!.' 
  },
  // Fix results[0] -> results[0]!
  { 
    pattern: /results\[0\]/g, 
    replacement: 'results[0]!' 
  },
  // Fix row. -> row!.
  { 
    pattern: /row\./g, 
    replacement: 'row!.' 
  },
  // Fix item. -> item!.
  { 
    pattern: /item\./g, 
    replacement: 'item!.' 
  },
  // Fix col. -> col!.
  { 
    pattern: /col\./g, 
    replacement: 'col!.' 
  },
  // Fix stringColumn. -> stringColumn!.
  { 
    pattern: /stringColumn\./g, 
    replacement: 'stringColumn!.' 
  },
  // Fix numericColumn. -> numericColumn!.
  { 
    pattern: /numericColumn\./g, 
    replacement: 'numericColumn!.' 
  },
  // Fix sortColumn. -> sortColumn!.
  { 
    pattern: /sortColumn\./g, 
    replacement: 'sortColumn!.' 
  },
  // Fix columns[i] -> columns[i]!
  { 
    pattern: /columns\[i\]/g, 
    replacement: 'columns[i]!' 
  },
  // Fix columns[0] -> columns[0]!
  { 
    pattern: /columns\[0\]/g, 
    replacement: 'columns[0]!' 
  },
  // Fix for (let i = 0; i < columns.length; i++) -> for (let i = 0; i < columns!.length; i++)
  { 
    pattern: /for \(let i = 0; i < columns\.length; i\+\+\)/g, 
    replacement: 'for (let i = 0; i < columns!.length; i++)' 
  },
  // Fix for (const column of columns) -> for (const column of columns!)
  { 
    pattern: /for \(const column of columns\)/g, 
    replacement: 'for (const column of columns!)' 
  },
  // Fix for (const row of testRows) -> for (const row of testRows!)
  { 
    pattern: /for \(const row of testRows\)/g, 
    replacement: 'for (const row of testRows!)' 
  },
  // Fix for (const row of rows) -> for (const row of rows!)
  { 
    pattern: /for \(const row of rows\)/g, 
    replacement: 'for (const row of rows!)' 
  },
  // Fix for (const item of items) -> for (const item of items!)
  { 
    pattern: /for \(const item of items\)/g, 
    replacement: 'for (const item of items!)' 
  },
  // Fix for (const command of commands) -> for (const command of commands!)
  { 
    pattern: /for \(const command of commands\)/g, 
    replacement: 'for (const command of commands!)' 
  },
  // Fix for (const result of results) -> for (const result of results!)
  { 
    pattern: /for \(const result of results\)/g, 
    replacement: 'for (const result of results!)' 
  },
  // Fix for (const value of values) -> for (const value of values!)
  { 
    pattern: /for \(const value of values\)/g, 
    replacement: 'for (const value of values!)' 
  },
  // Fix for (const expr of exprs) -> for (const expr of exprs!)
  { 
    pattern: /for \(const expr of exprs\)/g, 
    replacement: 'for (const expr of exprs!)' 
  },
  // Fix for (const join of joins) -> for (const join of joins!)
  { 
    pattern: /for \(const join of joins\)/g, 
    replacement: 'for (const join of joins!)' 
  },
  // Fix for (const table of tables) -> for (const table of tables!)
  { 
    pattern: /for \(const table of tables\)/g, 
    replacement: 'for (const table of tables!)' 
  },
  // Fix for (const col of cols) -> for (const col of cols!)
  { 
    pattern: /for \(const col of cols\)/g, 
    replacement: 'for (const col of cols!)' 
  },
  // Fix for (const stringColumn of stringColumns) -> for (const stringColumn of stringColumns!)
  { 
    pattern: /for \(const stringColumn of stringColumns\)/g, 
    replacement: 'for (const stringColumn of stringColumns!)' 
  },
  // Fix for (const numericColumn of numericColumns) -> for (const numericColumn of numericColumns!)
  { 
    pattern: /for \(const numericColumn of numericColumns\)/g, 
    replacement: 'for (const numericColumn of numericColumns!)' 
  },
  // Fix for (const sortColumn of sortColumns) -> for (const sortColumn of sortColumns!)
  { 
    pattern: /for \(const sortColumn of sortColumns\)/g, 
    replacement: 'for (const sortColumn of sortColumns!)' 
  }
];

// Files to process
const testFiles = [
  'tests/property-testing/ir-to-sql-translation.test.ts',
  'tests/property-testing/tanstack-sqlite-comparison.test.ts',
  'tests/property-testing/query-builder-ir-extraction.test.ts',
  'tests/property-testing/quick-test-suite.test.ts',
  'tests/property-testing/framework-unit-tests.test.ts',
  'tests/property-testing/harness/property-test-harness.ts',
  'tests/property-testing/generators/mutation-generator.ts',
  'tests/property-testing/generators/schema-generator.ts',
  'tests/property-testing/generators/query-generator.ts',
  'tests/property-testing/generators/row-generator.ts',
  'tests/property-testing/utils/incremental-checker.ts',
  'tests/property-testing/utils/normalizer.ts',
  'tests/property-testing/sql/ast-to-sql.ts',
  'tests/property-testing/sql/sqlite-oracle.ts',
  'tests/property-testing/utils/functional-to-structural.ts',
  'tests/property-testing/comprehensive-sql-coverage.test.ts'
];

function fixFile(filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let originalContent = content;

  // Apply all patterns
  patterns.forEach(({ pattern, replacement }) => {
    content = content.replace(pattern, replacement);
  });

  // Write back if changed
  if (content !== originalContent) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Fixed: ${filePath}`);
  } else {
    console.log(`No changes needed: ${filePath}`);
  }
}

// Process all files
testFiles.forEach(fixFile);
console.log('Remaining TypeScript error fixes applied!');