import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {parse} from '@babel/parser'
import {checkSql} from '../phase2/checker.mjs'
import {fixtureContext,expectedSchema} from '../phase2/context.mjs'
const {adaptModule}=await import(process.env.PHASE3_BASELINE==='1'?'./red-baseline.mjs':'./adapter.mjs')
const source=await readFile(new URL('./fixtures/endpoint.tsx',import.meta.url),'utf8')
const contract={endpoint:'listTodos',imports:{query:'./runtime',db:'./database.server',todo:'./database.server',requireUser:'./database.server',asc:'drizzle-orm',eq:'drizzle-orm',z:'zod'},schema:{identity:'disposable-public-todo',columns:expectedSchema}}
const context=await fixtureContext()
const results=[]
test('full module query input and siblings enter the same SQL checker',()=>{
 const adapted=adaptModule(source,contract)
 assert.equal(adapted.status,'adapted')
 const result=checkSql(adapted.input,context)
 assert.equal(result.code,'ENDPOINT_ORDER_NOT_TOTAL')
 assert.deepEqual(adapted.input.params,['fixture-user'])
 results.push({name:'inline query',adapted,result})
})
test('repair targets actual query order and preserves sibling mutation comments and JSX',()=>{
 const adapted=adaptModule(source,contract)
 assert.equal(adapted.status,'adapted')
 const {start,end,text}=adapted.edit
 assert.equal(source.slice(start-1,start),')')
 const fixed=source.slice(0,start)+text+source.slice(end)
 assert.equal(checkSql(adaptModule(fixed,contract).input,context).status,'supported')
 assert.equal(fixed.slice(fixed.indexOf('export const addTodo')),source.slice(source.indexOf('export const addTodo')))
 assert.ok(fixed.includes('// The query-like text below is a decoy: .orderBy(asc(todo.createdAt))'))
 assert.equal(source.slice(...adapted.diagnosticRange),'orderBy(asc(todo.createdAt))')
 parse(fixed,{sourceType:'module',plugins:['typescript','jsx']})
 results.push({name:'source mapped repair',range:adapted.diagnosticRange,edit:adapted.edit})
})
test('missing or changed import/schema contracts cannot support a query',()=>{
 assert.equal(adaptModule(source,{...contract,imports:{...contract.imports,db:'./other-db'}}).code,'BINDING_NOT_CHECKED')
 assert.equal(adaptModule(source,{}).code,'CONTRACT_NOT_CHECKED')
 assert.equal(adaptModule(source.replace("from 'drizzle-orm'","from './fake-operators'"),contract).code,'BINDING_NOT_CHECKED')
})
test('query spreads and transformed response stay outside supported grammar',()=>{
 for(const changed of [source.replace('input: z.object({}),','...extra, input: z.object({}),'),source.replace('res.json(todos)','res.json(todos.map(x => x))')]) {
  assert.equal(adaptModule(changed,contract).status,'not checked')
 }
})
test.after(async()=>{await writeFile(new URL(process.env.PHASE3_BASELINE==='1'?'./baseline-results.json':'./adapter-results.json',import.meta.url),JSON.stringify({node:process.version,results},null,2)+'\n')})
