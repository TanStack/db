import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

// Constructed finite model of the frozen candidate. No Endpoints/DB code is
// executed. Server commit order is independent of client invocation order.
const kinds = ['start', 'commit', 'observe', 'deliver']
function* histories(progress, prefix = []) {
  if (progress.every(n => n === kinds.length)) { yield prefix; return }
  for (let op = 0; op < progress.length; op++) {
    if (progress[op] === kinds.length) continue
    const next = [...progress]
    next[op]++
    yield* histories(next, [...prefix, {op, kind:kinds[progress[op]]}])
  }
}
function run(history, strategy) {
  let epoch=0, server={revision:0,value:'initial'}, baseline={...server}, highest=0
  const operations=new Map(), accepted=[]
  const unknown=()=>[...operations.values()].filter(m=>!m.known)
  const remaining=()=>[...operations.values()].filter(m=>!m.retired)
  const install=(snapshot,why)=>{
    accepted.push({why,...snapshot})
    const regression=snapshot.revision < baseline.revision
    baseline={...snapshot}
    return regression
  }
  let regressed=false
  for(const {op,kind} of history){
    if(kind==='start'){
      const active=unknown()
      for(const m of active)m.overlap=true
      operations.set(op,{epoch:++epoch,overlap:active.length>0,known:false,retired:false})
    }
    const m=operations.get(op)
    if(kind==='commit')server={revision:server.revision+1,value:`op${op}`}
    if(kind==='observe')m.snapshot={...server}
    if(kind==='deliver'){
      m.known=true
      if(strategy==='arrival-wins')regressed = install(m.snapshot,`response ${op}`) || regressed
      if(strategy==='largest-invocation' && m.epoch>highest){
        highest=m.epoch
        regressed = install(m.snapshot,`invocation ${m.epoch}`) || regressed
      }
      if(strategy==='candidate'){
        if(!m.overlap && m.epoch===epoch){
          regressed = install(m.snapshot,`isolated ${op}`) || regressed
          m.retired=true
        }
        if(unknown().length===0 && remaining().length){
          regressed = install(server,'quiet read') || regressed
          for(const pending of remaining())pending.retired=true
        }
      }
    }
  }
  return {regressed,converged:baseline.revision===server.revision&&baseline.value===server.value,server,baseline,accepted}
}
const counts={candidate:0,'arrival-wins':0,'largest-invocation':0}
const witnesses={}
let total=0
for(const history of histories([0,0,0])){
  total++
  for(const strategy of Object.keys(counts)){
    const result=run(history,strategy)
    if(result.regressed||!result.converged){
      counts[strategy]++
      witnesses[strategy]??={history,result}
    }
  }
}
assert.equal(total,34650)
assert.equal(counts.candidate,0)
assert.ok(counts['arrival-wins']>0)
assert.ok(counts['largest-invocation']>0)

// Same client epoch and lifetime are not enough for a read begun during a write.
const ordinaryRead={epoch:1,lifetime:1,snapshot:0,issuedAfterKnownHandlers:[]}
const settled={epoch:1,lifetime:1,value:1,requiredHandlers:['A']}
const tokenOnlyAdmits=ordinaryRead.epoch===settled.epoch&&ordinaryRead.lifetime===settled.lifetime
const coverageAdmits=tokenOnlyAdmits&&settled.requiredHandlers.every(id=>ordinaryRead.issuedAfterKnownHandlers.includes(id))
assert.equal(tokenOnlyAdmits,true)
assert.equal(coverageAdmits,false)

// Invalidation itself supplies safety, but not progress under an endless stream.
let g=0,acceptedQuietReads=0
for(let round=0;round<100;round++){
  const readEpoch=g
  g++ // a fresh immediate mutation starts before this read returns
  if(readEpoch===g)acceptedQuietReads++
}
assert.equal(acceptedQuietReads,0)

// Baseline authority is current throughout; retiring the top overlay first can
// expose an older covered guess. This is a publication boundary, not a proof of
// baseline regression or a violation of an explicitly atomic contract.
const authority='B-server', overlays=[{id:'A',value:'A-guess'},{id:'B',value:'B-guess'}]
const visible=()=>overlays.at(-1)?.value??authority
const trace=[visible()]
overlays.pop();trace.push(visible())
overlays.pop();trace.push(visible())
assert.deepEqual(trace,['B-guess','A-guess','B-server'])

const report={
  evidence:'Constructed source-derived finite model; not actual Endpoints execution or independent range validation',
  histories:total,failures:counts,witnesses,
  ordinaryRead:{tokenOnlyAdmits,coverageAdmits,classification:'counter-only implementation rejected by frozen coverage rule'},
  continuousTraffic:{rounds:100,acceptedQuietReads,classification:'violates conditional progress premise; not an internal safety fracture'},
  retirement:{trace,authorityThroughout:authority,classification:'visible publication obligation; atomic publication explicitly unresolved'},
  limits:['Quiet reads in enumeration are immediate and globally coherent model observations','No unknown outcomes, GC, new-query support, query-adapter publication, reentrancy or actual DB overlays in enumeration','Separate hand traces cover selected boundaries only; no universal proof'],
}
await writeFile(new URL('./fracture-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({histories:total,failures:counts,ordinaryRead:report.ordinaryRead,retirement:report.retirement}))
