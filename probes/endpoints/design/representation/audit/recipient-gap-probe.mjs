import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Driver } from '../../../integrated-todo/tests/oracles/driver.mjs'

const program={orders:[['createdAt','id'],['createdAt','id'],['createdAt','id']],filters:[null,false,true],unsubscribed:[2],scope:'alice',initial:[]}
const steps=[{kind:'insert',slot:0,target:0,text:'guess',rank:0,outcome:'success'}]
class AuditDriver extends Driver {
 constructor(mutant,diverge){super();this.mutant=mutant;this.diverge=diverge}
 async init(){
  await super.init()
  if(this.mutant){
   const path=join(this.dir,'src/runtime.ts');const source=await readFile(path,'utf8')
   const start=source.indexOf('    const targets = retained.filter(')
   const end=source.indexOf('    const response =',start)
   assert.ok(start>0&&end>start)
   await writeFile(path,source.slice(0,start)+'    const targets = retained.filter(([,collection])=>transaction.mutations.some(m=>m.collection.id===collection.id))\n'+source.slice(end))
  }
  if(this.diverge){
   const apply=this.reference.apply.bind(this.reference)
   this.reference.apply=(table,operation)=>apply(table,table==='confirmed'&&operation.kind==='insert'?{...operation,input:{...operation.input,completed:!operation.input.completed}}:operation)
  }
 }
 async process(args){
  if(this.diverge&&args.includes('build')){
   const path=join(this.dir,'src/endpoint.tsx');const source=await readFile(path,'utf8')
   const before='createdAt:input.createdAt,userId:user.id'
   assert.ok(source.includes(before))
   const changed=source.replaceAll('text:input.text,completed:input.completed,createdAt:input.createdAt,userId:user.id','text:input.text,completed:!input.completed,createdAt:input.createdAt,userId:user.id')
   assert.notEqual(changed,source)
   await writeFile(path,changed)
  }
  return super.process(args)
 }
}
const results=[]
for(const [mutant,diverge] of [[false,false],[true,false],[true,true],[false,true]]){
 const driver=new AuditDriver(mutant,diverge);let failure
 try{await driver.init();await driver.prepare(program);await driver.run(program,steps)}catch(error){failure=String(error)}finally{await driver.close()}
 const expectedFailure=mutant&&diverge
 results.push({optimisticRecipientsOnly:mutant,serverFlipsCompleted:diverge,passed:!failure,error:failure??null,counts:driver.counts})
 await writeFile(new URL('./recipient-gap-probe.json',import.meta.url),JSON.stringify(results,null,2)+'\n')
 console.log(JSON.stringify(results.at(-1)))
 assert.equal(Boolean(failure),expectedFailure)
 if(failure)assert.match(failure,/every active collection must equal reference PG/)
}
