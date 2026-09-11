import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const results=[]
for(const [path,expected] of [['/src/server-helper.ts','ENDPOINT_SERVER_IMPORT_IN_CLIENT'],['/src/server-helper.ts?raw','ENDPOINT_SERVER_IMPORT_IN_CLIENT'],['/src/endpoint.tsx?raw','ENDPOINT_UNSUPPORTED_GRAMMAR'],['/src/endpoint.tsx?url','ENDPOINT_UNSUPPORTED_GRAMMAR']]){
 const response=await fetch('http://127.0.0.1:4291'+path),body=await response.text()
 assert.equal(response.status,500,path);assert.ok(body.includes(expected),path)
 const leaks=/SERVER_ONLY_SENTINEL|DATABASE_ONLY_SENTINEL|AUTH_ONLY_SENTINEL/.test(body)
 assert.equal(leaks,false,`Rejection response leaked source for ${path}`)
 results.push({path,status:response.status,code:expected,sourceLeak:leaks})
}
console.log(JSON.stringify(results,null,2));await writeFile('evidence/dev-rejection.json',JSON.stringify(results,null,2))
