import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const phase=process.env.EVIDENCE_PHASE??'green',response=await fetch('http://127.0.0.1:4291/src/endpoint.tsx'),text=await response.text()
assert.equal(response.status,200)
const match=text.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/)
assert.ok(match,'Dev endpoint response must provide an inline map')
const map=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'))
const code=text.slice(0,match.index),marker=/SERVER_ONLY_SENTINEL|DATABASE_ONLY_SENTINEL|AUTH_ONLY_SENTINEL/
const result={httpStatus:response.status,codeLeaks:marker.test(code),inlineMapLeaks:marker.test(JSON.stringify(map)),sourcesContent:map.sourcesContent?.map(v=>v===null?null:v.length)}
await writeFile(`evidence/${phase}-dev-delivery.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
assert.equal(result.codeLeaks,false);assert.equal(result.inlineMapLeaks,false,'Dev client source maps must not embed server bodies')
