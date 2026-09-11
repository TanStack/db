// Controlled test mutation of the map policy, not a production escape hatch.
import {readFile,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const original=await readFile('transform.mjs','utf8')
assert.ok(original.includes('sourcemapExcludeSources: true'))
try{
 await writeFile('transform.mjs',original.replace('sourcemapExcludeSources: true','sourcemapExcludeSources: false'))
 const result=spawnSync(process.execPath,['tests/built-maps.mjs'],{stdio:'inherit',env:{...process.env,EVIDENCE_PHASE:'replayed-red'}})
 assert.equal(result.status,1,'Embedding original client sources must fail the safety regression')
}finally{await writeFile('transform.mjs',original)}
