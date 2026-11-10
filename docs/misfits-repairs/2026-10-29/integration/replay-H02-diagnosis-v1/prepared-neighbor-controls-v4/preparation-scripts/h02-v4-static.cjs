const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const W='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1'
const H='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1'
const P=path.join(H,'prepared-neighbor-controls-v4'),node='/Users/kyle.mathews/.n/bin/node'
const code=['packages/query-db-collection/tests/queued-answer-progress-oracle.ts','packages/query-db-collection/tests/queued-answer-progress-neighbors.test.ts','scripts/h02-progress/checker-calibration.test.ts']
const files=[...code,'docs/contributing/oracle-coverage.md'],config=path.join(P,'static-tsconfig-v4.json')
fs.copyFileSync(path.join(H,'prepared-neighbor-controls-v3/static-tsconfig-v3.json'),config,fs.constants.COPYFILE_EXCL)
const commands=[
 ['format-v4',384,path.join(W,'node_modules/prettier/bin/prettier.cjs'),'--write',...files],
 ['pure-checker-final-v4',384,path.join(W,'node_modules/vitest/vitest.mjs'),'run','--config','scripts/h02-progress/calibration.config.ts','--reporter=verbose','--reporter=json','--outputFile.json='+path.join(P,'pure-checker-final-v4.report.json')],
 ['typescript-v4',1536,path.join(W,'node_modules/typescript/bin/tsc'),'--project',config],
 ['eslint-v4',1536,path.join(W,'node_modules/eslint/bin/eslint.js'),'--config','scripts/h02-progress/eslint.config.mjs',...code],
 ['lint-changed-v4',1536,'scripts/agent-lint-feedback.mjs'],
 ['prettier-v4',384,path.join(W,'node_modules/prettier/bin/prettier.cjs'),'--check',...files],
]
const env={...process.env};for(const k of ['NODE_OPTIONS','NODE_PATH','H02_PROGRESS_SOURCE_FREEZE','H02_PROGRESS_WORKER_HISTORY','H02_PROGRESS_BINDING_DIR','H02_PROGRESS_SELECTED_ROOT','H02_PROGRESS_RECEIPTS'])delete env[k]
const results=[]
for(const [name,heap,...args] of commands){
 const start=performance.now();const r=spawnSync(node,[`--max-old-space-size=${heap}`,...args],{cwd:W,env,encoding:'utf8',timeout:55000,maxBuffer:8*1024*1024})
 fs.writeFileSync(path.join(P,name+'.log'),(r.stdout||'')+(r.stderr||''),{flag:'wx'})
 const row={name,executable:node,args:[`--max-old-space-size=${heap}`,...args],exitCode:r.status,signal:r.signal,error:r.error?.message,elapsedMs:performance.now()-start,timeoutMs:55000,log:name+'.log'}
 results.push(row);fs.writeFileSync(path.join(P,'static-commands-v4.json'),JSON.stringify(results,null,2)+'\n')
 console.log(JSON.stringify(row))
 if(r.status!==0||r.error||r.signal)process.exit(1)
}
