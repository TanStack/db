import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { refreshAfterMutation } from '../../../integrated-todo/src/refresh.server.ts'
const require=createRequire(new URL('../../../integrated-todo/package.json',import.meta.url))
const {PGlite}=require('@electric-sql/pglite')
const pg=new PGlite()
const evidence={scope:'one Todo table; sequential operation; one loaded query; nonempty coherent insert guess',observations:[]}
try{
 await pg.exec('CREATE TABLE todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL)')
 let reads=0
 const readsById={all:async()=>{reads++;return (await pg.query('SELECT * FROM todo ORDER BY id')).rows}}
 let failure
 try{
  await refreshAfterMutation([{id:'all'}],readsById,async()=>{
   await pg.query("INSERT INTO todo VALUES ('a','saved',false,'2026-01-01')")
   throw Error('handler failed after its write committed')
  })
 }catch(error){failure=error.message}
 const actual=(await pg.query('SELECT id FROM todo')).rows
 assert.equal(failure,'handler failed after its write committed')
 assert.deepEqual(actual,[{id:'a'}])
 assert.equal(reads,0)
 evidence.observations.push({case:'commit-then-handler-throw',result:failure,pgRows:actual,authoritativeReads:reads,interpretation:'The real server helper rejects without evaluating the retained read after an already committed write. Client rollback follows from runtime mutationFn rejection; not executed by this probe.'})
 await pg.exec('DELETE FROM todo')
 try{await refreshAfterMutation([{id:'all'}],readsById,async()=>{throw Error('rejected before write')})}catch{}
 assert.deepEqual((await pg.query('SELECT id FROM todo')).rows,[])
 evidence.observations.push({case:'pre-write-rejection-control',pgRows:[],authoritativeReads:reads})
 await refreshAfterMutation([{id:'all'}],readsById,async()=>{await pg.query("INSERT INTO todo VALUES ('b','saved',false,'2026-01-01')")})
 assert.equal(reads,1)
 evidence.observations.push({case:'successful-write-control',pgRows:(await pg.query('SELECT id FROM todo')).rows,authoritativeReads:reads})
 evidence.status='reproduced'
}finally{await pg.close();await writeFile(new URL('./fracture-probe.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n')}
console.log(JSON.stringify(evidence,null,2))
