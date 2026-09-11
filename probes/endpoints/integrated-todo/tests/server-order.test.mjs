import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { endpointsProbe } from '../transform.mjs'
const traverse=traverseModule.default??traverseModule
const source=readFileSync(new URL('../src/endpoint.tsx',import.meta.url),'utf8')
const compile=code=>endpointsProbe().transform(code,'/test/endpoint.tsx').code
function order(code){
 const ast=parse(compile(code),{sourceType:'module',plugins:['typescript','jsx']})
 let value
 traverse(ast,{CallExpression(path){if(path.node.callee.name==='__boundQuery')value=path.node.arguments[3].elements.map(n=>n.value)}})
 return value
}
test('component declarations carry server order in priority order',()=>{
 assert.deepEqual(order(source),['createdAt','id'])
 assert.deepEqual(order(source.replace(/orderBy\(asc\(todo.createdAt\),\s*asc\(todo.id\)\)/,'orderBy(asc(todo.id), asc(todo.createdAt))')),['id','createdAt'])
})
test('sort columns must be selected',()=>assert.throws(()=>compile(source.replace('createdAt: todo.createdAt,','')),/ENDPOINT_ORDER_NOT_CHECKED/))
test('unsupported direction cannot silently lose client ordering',()=>assert.throws(()=>compile(source.replace(/import \{ ([^}]+) \} from 'drizzle-orm'/, "import { $1, desc } from 'drizzle-orm'").replace('asc(todo.createdAt)','desc(todo.createdAt)')),/ENDPOINT_ORDER_NOT_CHECKED/))
test('transformed responses cannot borrow intermediate query ordering',()=>assert.throws(()=>compile(source.replace('res.json(todos)','res.json(todos.reverse())')),/ENDPOINT_ORDER_NOT_CHECKED/))
test('server handler cannot capture the bound client',()=>assert.throws(()=>compile(source.replace('await beforeWrite()','await beforeWrite(dbClient)')),/server code captures dbClient/))
test('server handler cannot capture component state',()=>assert.throws(()=>compile(source.replace('await beforeWrite()','await beforeWrite(status)')),/server code captures status/))
test('input validator cannot capture component state',()=>assert.throws(()=>compile(source.replace('min(1)','min(text.length)')),/server code captures text/))
test('optimistic callback stays within the component while RPCs move to module scope',()=>{
 const output=compile(source)
 assert.ok(output.indexOf('const __boundRpc0')<output.indexOf('export function TodoApp'))
 assert.ok(output.indexOf('listTodos.insert')>output.indexOf('export function TodoApp'))
 assert.match(output,/__boundMutation\(dbClient,/)
})
