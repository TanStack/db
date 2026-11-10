const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {spawnSync} = require('node:child_process')
const H = '/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1'
const P = path.join(H,'prepared-neighbor-controls-v3'), C = path.join(P,'native-calibration')
const O = process.argv[3] ? path.join(C,process.argv[3]) : C
if(O!==C) fs.mkdirSync(O,{recursive:true})
const V2=JSON.parse(fs.readFileSync(path.join(H,'prepared-neighbor-controls-v2/source-freeze-v2.json')))
const node=V2.node.executable, cli=path.join(V2.packages.vitest.resolved,'vitest.mjs')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const write=(p,v)=>fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx'})
const env={...process.env}; for(const k of ['NODE_OPTIONS','NODE_PATH','TANSTACK_DB_ORACLE_SEED','TANSTACK_DB_ORACLE_PATH','TANSTACK_DB_ORACLE_PROPERTY','TANSTACK_DB_ORACLE_CALIBRATION','H02_PROGRESS_WORKER_HISTORY','H02_PROGRESS_BINDING_DIR','H02_PROGRESS_SELECTED_ROOT','H02_PROGRESS_RECEIPTS','H02_PROGRESS_SOURCE_FREEZE']) delete env[k]
const commands=[]
const survey = '/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items'
const runtimeFiles = [node,cli,
path.join(survey,'node_modules/.pnpm/@vitest+runner@4.1.12/node_modules/@vitest/runner/package.json'),
path.join(survey,'node_modules/.pnpm/@vitest+runner@4.1.12/node_modules/@vitest/runner/dist/chunk-artifact.js'),
path.join(survey,'node_modules/.pnpm/@vitest+utils@4.1.12/node_modules/@vitest/utils/package.json'),
path.join(survey,'node_modules/.pnpm/@vitest+utils@4.1.12/node_modules/@vitest/utils/dist/display.js'),
path.join(V2.packages.vitest.resolved,'dist/chunks/index.UpGiHP7g.js'),
path.join(V2.packages.vitest.resolved,'dist/chunks/coverage.DM_a_rWm.js'),
path.join(C,'native-titles.test.ts'),path.join(C,'native.config.ts')]
const identity = () => Object.fromEntries(runtimeFiles.map(file=>[file,sha(fs.readFileSync(file))]))
function run(name,args){
 const before=identity()
 const start=performance.now(); const r=spawnSync(node,['--max-old-space-size=384',cli,...args],{cwd:C,env,timeout:20000,maxBuffer:4*1024*1024,encoding:'utf8'})
 const after=identity()
 write(path.join(O,name+'.stdout.log'),r.stdout||''); write(path.join(O,name+'.stderr.log'),r.stderr||'')
 commands.push({name,executable:node,args:['--max-old-space-size=384',cli,...args],cwd:C,exitCode:r.status,signal:r.signal,error:r.error?.message,elapsedMs:performance.now()-start,timeoutMs:20000,identityBefore:before,identityAfter:after,identityMatched:JSON.stringify(before)===JSON.stringify(after)})
 write(path.join(O,name+'.command.json'),commands.at(-1))
 if(JSON.stringify(before)!==JSON.stringify(after)) throw Error('native calibration input changed')
 if(r.status!==0||r.error||r.signal) throw Error(name+' failed '+r.stderr)
 return r.stdout
}
const mode=process.argv[2]
if(mode==='collect'){
 const out=run('native-list',['list','--config',path.join(C,'native.config.ts'),'--json'])
 const tasks=JSON.parse(out)
 write(path.join(O,'native-collected-tasks.json'),tasks)
 write(path.join(O,'native-collection-commands.json'),commands)
 console.log(JSON.stringify(tasks))
} else if(mode==='collect-all') {
 const report=path.join(O,'all-inert.report.json')
 run('all-inert',['run','--config',path.join(C,'native.config.ts'),'--reporter=verbose','--reporter=json','--outputFile.json='+report])
 const data=JSON.parse(fs.readFileSync(report)), assertions=data.testResults.flatMap(x=>x.assertionResults)
 if(data.numPassedTests!==5||assertions.length!==5||assertions.some(x=>x.status!=='passed')) throw Error('inert registration failed')
 write(path.join(O,'native-full-names.json'),assertions.map(x=>({name:x.fullName,title:x.title,ancestorTitles:x.ancestorTitles})))
 write(path.join(O,'native-all-inert-commands.json'),commands)
 console.log(JSON.stringify(assertions.map(x=>x.fullName)))
} else if(mode==='select') {
 const tasks=JSON.parse(fs.readFileSync(path.join(O,'native-full-names.json')))
 if(!Array.isArray(tasks)||tasks.length!==5) throw Error('unexpected native list schema')
 const escape = x => x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 const results=[]
 for(let i=0;i<tasks.length;i++){
   const task=tasks[i], name=task.name
   if(typeof name!=='string') throw Error('native name absent')
   const selector='^'+escape(name)+'$'
   const report=path.join(O,`selected-${i}.report.json`)
   run(`selected-${i}`,['run','--config',path.join(C,'native.config.ts'),'-t',selector,'--reporter=verbose','--reporter=json','--outputFile.json='+report])
   const data=JSON.parse(fs.readFileSync(report)), assertions=data.testResults.flatMap(x=>x.assertionResults)
   const passed=assertions.filter(x=>x.status==='passed'), skipped=assertions.filter(x=>x.status==='pending'||x.status==='skipped')
   if(data.numPassedTests!==1||passed.length!==1||skipped.length!==4||passed[0].fullName!==name) throw Error('native selected counts/name mismatch')
   const stdout=fs.readFileSync(path.join(O,`selected-${i}.stdout.log`),'utf8')
   if(!stdout.includes('H02 inert native selection')||!stdout.includes('sourceModule:')||!stdout.includes('testName:')) throw Error('native verbose payload absent')
   results.push({index:i,fullName:name,selector,selectedPassed:1,skipped:4,report,reportSha256:sha(fs.readFileSync(report)),consolePayloadRetained:true})
 }
 const old='checks receiving neighbor nonempty scope-key publication', report=path.join(O,'old-plain.report.json')
 run('old-plain',['run','--config',path.join(C,'native.config.ts'),'-t',old,'--reporter=verbose','--reporter=json','--outputFile.json='+report])
 const data=JSON.parse(fs.readFileSync(report)), assertions=data.testResults.flatMap(x=>x.assertionResults)
 if(data.numPassedTests!==0||assertions.length!==5||assertions.some(x=>!['pending','skipped'].includes(x.status))) throw Error('old selector did not skip all')
 write(path.join(O,'native-selection-results.json'),{kind:'inert native table registration/full-name selection/verbose console calibration only',results,oldPlainControl:{selector:old,selectedPassed:0,skipped:5,reportSha256:sha(fs.readFileSync(report))},limits:'No DB driver, model, production import or receiving history; this calibrates installed native titles and explicit reporter capture only.'})
 write(path.join(O,'native-selection-commands.json'),commands)
 console.log(JSON.stringify(results.map(x=>({fullName:x.fullName,selected:x.selectedPassed,skipped:x.skipped}))))
} else throw Error('mode required')
