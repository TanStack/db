import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const here=fileURLToPath(new URL('.',import.meta.url))
const scratch=await mkdtemp(resolve(here,'fixture-run-'))
const cli=resolve(here,'cli.mjs')
const run=args=>{const p=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});return {exit:p.status,json:JSON.parse(p.stdout)}}
for(const adapter of ['drizzle','sql'])test(`${adapter} real diagnostic applies and clears; stale source refuses`,async()=>{
 const suffix=adapter==='sql'?'sql':'ts',file=resolve(scratch,`todo.${suffix}`),diagnostic=resolve(scratch,`${adapter}.json`)
 const original=await readFile(resolve(here,`fixtures/todo.${suffix}`),'utf8')
 await writeFile(file,original)
 const result=run(['check','--adapter',adapter,'--file',file])
 assert.equal(result.exit,1);assert.equal(result.json.status,'violation');assert.equal(result.json.diagnostics.length,1)
 assert.equal(result.json.diagnostics[0].code,'ENDPOINT_ORDER_NOT_TOTAL');assert.ok(result.json.source.uri.startsWith('file:///'))
 assert.ok(result.json.rerun[0].startsWith('/'));assert.ok(result.json.rerun[1].startsWith('/'))
 await writeFile(diagnostic,JSON.stringify(result.json))
 await writeFile(file,original+'\n')
 const stale=run(['apply','--file',file,'--diagnostic',diagnostic]);assert.equal(stale.exit,2);assert.equal(stale.json.code,'STALE_DIAGNOSTIC')
 await writeFile(file,original)
 assert.equal(run(['apply','--file',file,'--diagnostic',diagnostic]).exit,0)
 const cleared=run(['check','--adapter',adapter,'--file',file]);assert.equal(cleared.exit,0);assert.equal(cleared.json.status,'supported');assert.deepEqual(cleared.json.diagnostics,[])
 await writeFile(file,'\n\n'+original)
 const shifted=run(['check','--adapter',adapter,'--file',file]);assert.equal(shifted.json.diagnostics[0].range.start.line,result.json.diagnostics[0].range.start.line+2)
 await writeFile(resolve(here,`${adapter}-delivery-results.json`),JSON.stringify({result,stale,cleared,shifted},null,2)+'\n')
})
test('unsupported source is not represented as cleared',async()=>{
 const file=resolve(scratch,'unknown.ts');await writeFile(file,'export const unrelated = 1')
 const result=run(['check','--adapter','drizzle','--file',file]);assert.equal(result.exit,2);assert.equal(result.json.status,'not checked');assert.equal(result.json.diagnostics.length,1)
})

test('raw SQL comment order text cannot redirect the source edit',async()=>{
 const file=resolve(scratch,'comment.sql'),diagnostic=resolve(scratch,'comment.json')
 const original='-- order by created_at asc; decoy\n'+await readFile(resolve(here,'fixtures/todo.sql'),'utf8')+'-- order by id asc; trailing decoy\n'
 await writeFile(file,original)
 const result=run(['check','--adapter','sql','--file',file])
 assert.equal(result.exit,1)
 const edit=result.json.diagnostics[0].edit
 assert.equal(original.slice(edit.start,edit.start+1),';')
 assert.equal(edit.start,original.indexOf('asc;',original.indexOf('select'))+3)
 await writeFile(diagnostic,JSON.stringify(result.json));assert.equal(run(['apply','--file',file,'--diagnostic',diagnostic]).exit,0)
 const repaired=await readFile(file,'utf8');assert.ok(repaired.startsWith('-- order by created_at asc; decoy\n'));assert.ok(repaired.endsWith('-- order by id asc; trailing decoy\n'))
 assert.equal(run(['check','--adapter','sql','--file',file]).json.status,'supported')
})
