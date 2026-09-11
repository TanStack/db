import {execFileSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'todo-persistence-'))
const run=code=>execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env:{...process.env,TODO_DB_PATH:join(root,'pg')},encoding:'utf8'})
try{
 run(`import {pg,control} from './src/database.server.ts';await control({});await pg.exec("INSERT INTO todo VALUES ('persisted','Across processes',false,now(),'alice')");await pg.close()`)
 const rows=JSON.parse(run(`import {pg,control} from './src/database.server.ts';const result=await control({});console.log(JSON.stringify(result.rows));await pg.close()`))
 assert.equal(rows[0].text,'Across processes')
 console.log('PASS actual app schema and row survive closing and reopening in a new process')
}finally{rmSync(root,{recursive:true,force:true})}
