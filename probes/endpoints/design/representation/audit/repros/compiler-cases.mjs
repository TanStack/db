import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { endpoints } from '../../../../integrated-todo/transform.mjs'

const query = completed => `const rows = query({input:z.object({}),async handler(req,res){
  const user=await requireUser(req)
  const todos=await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt}).from(todo).where(and(eq(todo.userId,user.id),eq(todo.completed,${completed}))).orderBy(asc(todo.id))
  return res.json(todos)
}})`
const source = `import {z} from 'zod'
import {endpoints} from './runtime'
import {db,todo,requireUser} from './database.server'
import {asc,eq,and} from 'drizzle-orm'
export function makeActiveComponent(){
  function TodoApp(dbClient){const {query,mutation}=endpoints(dbClient);${query(false)};return rows}
  return TodoApp
}
export function makeCompletedComponent(){
  function TodoApp(dbClient){const {query,mutation}=endpoints(dbClient);${query(true)};return rows}
  return TodoApp
}`
const compiled = endpoints().find((plugin) => plugin.transform).transform(source, '/fixture/endpoint.tsx').code
const keys = [...compiled.matchAll(/__boundQuery\(dbClient,"([^"]+)"/g)].map(match => match[1])
assert.equal(keys.length, 2)
assert.equal(new Set(keys).size, 1, 'Two distinct declarations received the same runtime key')
const report = { compileAccepted: true, queryKeys: keys, distinctKeys: new Set(keys).size,
  memberships: [...compiled.matchAll(/"membership":(\{[^}]+\})/g)].map(m => JSON.parse(m[1])) }
console.log(JSON.stringify(report, null, 2))
writeFileSync(new URL('./compiler-collision-input.tsx', import.meta.url), source + '\n')
writeFileSync(new URL('./compiler-collision-output.txt', import.meta.url), compiled + '\n')
writeFileSync(new URL('./compiler-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
