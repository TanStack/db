import { test } from 'node:test'
import assert from 'node:assert/strict'
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
