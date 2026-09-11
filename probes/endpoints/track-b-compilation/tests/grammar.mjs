import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {endpointsProbe} from '../transform.mjs'
const source=await readFile('src/endpoint.ts','utf8'),id=process.cwd()+'/src/endpoint.ts',results=[]
for(const [name,code] of [
 ['alias',source.replace('import { mutation }','import { mutation as endpoint }').replace('= mutation(', '= endpoint(')],
 ['wrong-import',source.replace("'./runtime'","'./different-runtime'")],
 ['let-declaration',source.replace('export const addTodo','export let addTodo')],
 ['spread',source.replace(' input:z.object',' ...{},\n input:z.object')],
 ['nested-call',source.replace('export const addTodo = mutation(', 'export function nested(){ const addTodo = mutation(')+'\n}'],
 ['generated-binding-collision',source+'\nconst addTodoRpc = 1'],
 ['binding-alias',source.replace('export const addTodo = mutation(', 'const wrapped=mutation;\nexport const addTodo = wrapped(')],
 ['method-this',source.replace('return res.json','this.run(); return res.json')],
 ['duplicate-property',source.replace(' input:z.object',' input:null,\n input:z.object')],
]){
 assert.throws(()=>endpointsProbe().transform(code,id),/ENDPOINT_UNSUPPORTED_GRAMMAR/,name);results.push({name,status:'pass'})
}
assert.ok(endpointsProbe().transform(source,id).map);results.push({name:'supported baseline',status:'pass'})
await writeFile('evidence/phase-2/grammar.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
