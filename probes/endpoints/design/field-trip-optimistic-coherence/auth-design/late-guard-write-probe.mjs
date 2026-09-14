// A controlled witness for the opaque fallback boundary, not a full candidate implementation.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFile} from 'node:fs/promises'
import {refreshAfterMutation} from '../../../integrated-todo/src/refresh.server.ts'
const require=createRequire(new URL('../../../integrated-todo/package.json',import.meta.url))
const {PGlite}=await import(require.resolve('@electric-sql/pglite'))
const db=new PGlite()
const trace=[]
let release
const sampled=new Promise(resolve=>{release=resolve})
try {
  await db.exec('CREATE TABLE payload(id integer PRIMARY KEY, value integer); INSERT INTO payload VALUES (1,0)')
  const response=await refreshAfterMutation([{id:'pure'},{id:'opaque'}],{
    pure:async()=>{const {rows}=await db.query('SELECT * FROM payload ORDER BY id');trace.push('pure sampled value 0');release();return rows},
    opaque:async()=>{await sampled;await db.exec('UPDATE payload SET value=1');trace.push('opaque guard wrote value 1');return [{id:'allowed'}]},
  },async()=>{trace.push('mutation completed');return null})
  assert.equal(response.kind,'confirmed')
  const snapshot=response.snapshots.find(s=>s.id==='pure').rows
  const authoritative=(await db.query('SELECT * FROM payload ORDER BY id')).rows
  assert.notDeepEqual(snapshot,authoritative)
  const report={claim:'Every retained payload equals authority after covered request effects',mode:'Actual refreshAfterMutation fallback plus constructed effectful guard fixture on PGlite',lawHolds:false,trace,snapshot,authoritative,limit:'No candidate compiler or client publication is implemented; this establishes an admissible unsafe fallback schedule, not observed Kitchen data corruption.'}
  await writeFile(new URL('./late-guard-write-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
}finally{await db.close()}
