import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {endpointsProbe} from '../transform.mjs'
const full=await readFile('src/endpoint.tsx','utf8'),source=full.slice(0,full.indexOf('export const addTodo')).replace('{query,mutation}','{query}')
const transformed=endpointsProbe().transform(source,process.cwd()+'/src/endpoint.tsx')
assert.ok(transformed?.code.includes('const listTodosRpc='));assert.ok(transformed.code.includes("__makeQuery('listTodos'"))
assert.throws(()=>endpointsProbe().transform(source.replace("'./runtime'","'./wrong'"),process.cwd()+'/src/endpoint.tsx'),/ENDPOINT_UNSUPPORTED_GRAMMAR/)
console.log(JSON.stringify({queryOnly:'pass',wrongQueryBinding:'rejected'}))
