import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@babel/parser'
import { transformBoundEndpoints } from '../bound-transform.mjs'
import { endpoints } from '../transform.mjs'
const compilerPlugin = () => endpoints().find((plugin) => plugin.transform)

import { specimen } from './fixtures/scalar-specimen.mjs'
const compile = (source) =>
  compilerPlugin().transform(source, '/test/endpoint.tsx').code

test('scalar queries retain relation identity and nullable predicate structure', () => {
  const result = compile(specimen)
  assert.match(result, /"relation":"[a-f0-9]+:items"/)
  assert.match(result, /"kind":"expression"/)
  assert.match(result, /"op":"isNull"/)
  assert.match(result, /"column":"score"/)
})

test('unsupported SQL and untrusted operators remain explicit rejections', () => {
  for (const source of [
    specimen.replace('.orderBy(', '.limit(1).orderBy('),
    specimen.replace('gt(items.score,0)', 'custom(items.score)'),
    specimen.replace("from 'drizzle-orm'", "from './untrusted'"),
    specimen.replace(
      'return res.json(todos)',
      'return res.json(todos.reverse())',
    ),
    specimen.replace('label:items.label', 'label:items.score'),
    specimen.replace(
      'label:items.label',
      'label:items.label,userId:items.userId',
    ),
  ])
    assert.throws(() => compile(source), /ENDPOINT_BOUND_UNSUPPORTED/)
})

test('incompatible row projections on the same relation cannot share optimism', () => {
  const source = specimen.replace(
    'return rows',
    `const other=query({input:z.object({}),async handler(req,res){
 const user=await requireUser(req)
 const todos=await db.select({id:items.id,text:items.text,completed:items.completed,createdAt:items.createdAt,score:items.score})
 .from(items).where(eq(items.userId,user.id)).orderBy(asc(items.id))
 return res.json(todos)
 }})\nreturn rows`,
  )
  assert.throws(() => compile(source), /projection/)
})

const unfilteredSource = (expression, prefix = 'await requireUser(req);') => `
import {z} from 'zod';import {endpoints} from './runtime';
import {db,items,other,requireUser} from './database.server';import {custom} from './helpers.server';
function App(dbClient){const {query,mutation}=endpoints(dbClient);
const rows=query({input:z.object({}),schema:z.object({id:z.string(),value:z.number()}),
async handler(req,res){${prefix}return res.json(${expression})}});return rows}`
const queryModel = (source) =>
  transformBoundEndpoints(
    source,
    '/test/endpoint.tsx',
    parse(source, { sourceType: 'module' }),
  ).definitions[0].model

test('unfiltered row collections retain identity without Todo fields or an auth result variable', () => {
  for (const prefix of [
    '',
    'await requireUser(req);',
    'const actor=await requireUser(req);',
  ]) {
    for (const selection of ['', '{id:items.id,value:items.value}']) {
      const model = queryModel(
        unfilteredSource(`await db.select(${selection}).from(items)`, prefix),
      )
      assert.ok(!model.relation.startsWith('opaque:'))
      assert.deepEqual(model.order, [])
      assert.deepEqual(model.membership, { kind: 'all' })
    }
  }
})

test('unfiltered recognition cannot erase membership, windows, transformations, or projection differences', () => {
  for (const expression of [
    'await db.select().from(items).where(custom(items))',
    'await db.select().from(items).limit(1)',
    'await db.select().from(items).orderBy(custom(items))',
    '(await db.select().from(items)).filter(row=>row.value>0)',
    'await db.select({id:items.id,value:items.other}).from(items)',
    'await db.select({value:items.value}).from(items)',
    'await db.select().from(items).innerJoin(other,custom(items))',
  ]) {
    assert.ok(
      queryModel(unfilteredSource(expression)).relation.startsWith('opaque:'),
    )
  }
  const full = queryModel(unfilteredSource('await db.select().from(items)'))
  const projected = queryModel(
    unfilteredSource(
      'await db.select({id:items.id,value:items.value}).from(items)',
    ),
  )
  assert.notEqual(full.relation, projected.relation)
  assert.notEqual(full.relation, queryModel(specimen).relation)
  assert.notEqual(projected.relation, queryModel(specimen).relation)
})
