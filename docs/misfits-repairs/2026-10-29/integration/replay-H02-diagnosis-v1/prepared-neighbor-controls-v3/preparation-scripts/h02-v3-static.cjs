const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const W='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1'
const H='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1'
const P=path.join(H,'prepared-neighbor-controls-v3'),node='/Users/kyle.mathews/.n/bin/node'
const files=Object.keys(JSON.parse(fs.readFileSync(path.join(H,'prepared-neighbor-controls-v2/source-changes-v2.json'))))
const config=path.join(P,'static-tsconfig-v3.json')
fs.copyFileSync(path.join(H,'prepared-neighbor-controls-v2/static-tsconfig-v2.json'),config,fs.constants.COPYFILE_EXCL)
const commands=[
 ['format-v3',384,path.join(W,'node_modules/prettier/bin/prettier.cjs'),'--write',...files],
 ['pure-ownership-v3',384,'--test','scripts/h02-progress/ownership-parent.test.mjs'],
 ['pure-candidate-v3',384,path.join(W,'node_modules/vitest/vitest.mjs'),'run','--config','scripts/h02-progress/candidate-controls.config.ts'],
 ['typescript-v3',1536,path.join(W,'node_modules/typescript/bin/tsc'),'--project',config],
 ['eslint-v3',1536,path.join(W,'node_modules/eslint/bin/eslint.js'),'--config','scripts/h02-progress/eslint.config.mjs',...files],
 ['lint-changed-v3',1536,'scripts/agent-lint-feedback.mjs'],
 ['prettier-v3',384,path.join(W,'node_modules/prettier/bin/prettier.cjs'),'--check',...files],
]
const env={...process.env};for(const k of ['NODE_OPTIONS','NODE_PATH','H02_PROGRESS_SOURCE_FREEZE','H02_PROGRESS_WORKER_HISTORY','H02_PROGRESS_BINDING_DIR','H02_PROGRESS_SELECTED_ROOT','H02_PROGRESS_RECEIPTS'])delete env[k]
const results=[]
for(const [name,heap,...args] of commands){
 const start=performance.now();const r=spawnSync(node,[`--max-old-space-size=${heap}`,...args],{cwd:W,env,encoding:'utf8',timeout:55000,maxBuffer:8*1024*1024})
 fs.writeFileSync(path.join(P,name+'.log'),(r.stdout||'')+(r.stderr||''),{flag:'wx'})
 const row={name,executable:node,args:[`--max-old-space-size=${heap}`,...args],exitCode:r.status,signal:r.signal,error:r.error?.message,elapsedMs:performance.now()-start,timeoutMs:55000,log:name+'.log'}
 results.push(row);fs.writeFileSync(path.join(P,'static-commands-v3.json'),JSON.stringify(results,null,2)+'\n')
 console.log(JSON.stringify(row))
 if(r.status!==0||r.error||r.signal)process.exit(1)
}
