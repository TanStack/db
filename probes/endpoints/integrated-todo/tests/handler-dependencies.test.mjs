import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { analyzeHandlerDependencies } from '../handler-dependencies.mjs'
const traverse = traverseModule.default ?? traverseModule

function analyze(
  body,
  kind = 'query',
  input = 'z.object({value:z.number().int()})',
  imports = "import {eq,gt,asc} from 'drizzle-orm'",
) {
  const ast = parse(
    `import {z} from 'zod';import {db,items,other,helper} from './database.server';${imports};const config={input:${input},async handler(req,res){${body}}}`,
    { sourceType: 'module' },
  )
  let result
  traverse(ast, {
    ObjectMethod(path) {
      if (path.node.key.name === 'handler')
        result = analyzeHandlerDependencies(
          path,
          kind,
          path.parentPath.get('properties.0.value'),
        )
    },
  })
  return result
}

test('direct read dependencies come from the actual Drizzle table binding', () => {
  assert.deepEqual(
    analyze(
      'const rows=await db.select().from(items).where(gt(items.value,req.body.value));return res.json(rows)',
    ),
    {
      database: 'db',
      tables: ['items'],
      operation: 'select',
      kind: 'query',
      values: undefined,
    },
  )
})
test('one direct insert, update or delete yields a bounded write candidate', () => {
  for (const [operation, query] of [
    ['insert', 'db.insert(items).values({id:"a",value:req.body.value})'],
    [
      'update',
      'db.update(items).set({value:req.body.value}).where(eq(items.id,"a"))',
    ],
    ['delete', 'db.delete(items).where(eq(items.id,"a"))'],
  ]) {
    const { values, ...result } = analyze(
      `await ${query};return res.json({ok:true})`,
      'mutation',
    )
    assert.deepEqual(result, {
      database: 'db',
      tables: ['items'],
      operation,
      kind: 'mutation',
    })
    assert.deepEqual(
      values?.properties.map((p) => p.key.name),
      operation === 'insert'
        ? ['id', 'value']
        : operation === 'update'
          ? ['value']
          : undefined,
    )
  }
})
test('opaque calls, additional SQL, raw SQL and validator effects remain unknown', () => {
  for (const body of [
    'await helper();const rows=await db.select().from(items);return res.json(rows)',
    'const rows=await db.select().from(items);await db.update(other).set({value:1});return res.json(rows)',
    'return res.json(await helper())',
    'return res.json(await db.execute("select * from items"))',
    'const rows=await db.select().from(items);return res.json(rows.map(helper))',
    'if(req.body.value)return res.json(await db.select().from(other));return res.json(await db.select().from(items))',
  ])
    assert.equal(analyze(body), null)
  assert.equal(
    analyze(
      'return res.json(await db.select().from(items))',
      'query',
      'z.object({}).transform(helper)',
    ),
    null,
  )
  assert.equal(
    analyze(
      'return res.json(await db.select().from(items).where(eq(items.value,1)))',
      'query',
      'z.object({})',
      "import {eq} from './unsafe.server'",
    ),
    null,
  )
})
