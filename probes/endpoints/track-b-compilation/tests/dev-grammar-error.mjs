import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const source=await readFile('src/endpoint.ts','utf8'),phase=process.env.EVIDENCE_PHASE??'green',results=[]
try{
 for(const [name,changed] of [['extra-property',source.replace(' input:z.object',' extra:true,\n input:z.object')],['syntax-error',source.replace(' input:z.object',' input:??z.object')]]){
  await writeFile('src/endpoint.ts',changed)
  await new Promise(resolve=>setTimeout(resolve,300))
  const response=await fetch('http://127.0.0.1:4179/src/endpoint.ts'),body=await response.text()
  assert.equal(response.status,500)
  results.push({name,httpStatus:response.status,sourceLeak:/SERVER_ONLY_SENTINEL|DATABASE_ONLY_SENTINEL|AUTH_ONLY_SENTINEL/.test(body)})
 }
}finally{await writeFile('src/endpoint.ts',source);await writeFile(`evidence/phase-2/${phase}-grammar-error.json`,JSON.stringify(results,null,2))}
console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>!r.sourceLeak),'Invalid endpoint errors must not echo server source')
