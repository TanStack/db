import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping'
import {endpointsProbe} from '../transform.mjs'
const code=await readFile('src/endpoint.ts','utf8'),id=process.cwd()+'/src/endpoint.ts'
const transformed=await endpointsProbe().transform(code,id)
assert.ok(transformed.map,'Transform must return an authored source map')
const map=new TraceMap(transformed.map),results=[]
function position(source,index){const lines=source.slice(0,index).split('\n');return {line:lines.length,column:lines.at(-1).length}}
for(const token of ['z.object','req.body.text','SERVER_ONLY_SENTINEL','optimistic:','shared(input.text)']){
 const generated=position(transformed.code,transformed.code.indexOf(token)),authored=position(code,code.indexOf(token))
 const actual=originalPositionFor(map,generated)
 assert.equal(actual.line,authored.line,token);assert.equal(actual.column,authored.column,token)
 assert.ok(actual.source.endsWith('/src/endpoint.ts'))
 results.push({token,generated,authored,actual})
}
await writeFile('evidence/phase-2/correspondence.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
