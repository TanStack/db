import {readFile,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const names=['transform.mjs','vite.config.ts'],saved=await Promise.all(names.map(name=>readFile(name,'utf8')))
try{
 for(const name of names)await writeFile(name,await readFile(`phase-1/${name}`,'utf8'))
 const result=spawnSync(process.execPath,['tests/safety.mjs'],{stdio:'inherit',env:{...process.env,EVIDENCE_PHASE:'replayed-red'}})
 assert.equal(result.status,1,'Original compiler must fail the current safety regression')
}finally{for(let i=0;i<names.length;i++)await writeFile(names[i],saved[i])}
