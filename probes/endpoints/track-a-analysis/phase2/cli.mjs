import { createHash } from 'node:crypto'
import { readFile,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL,fileURLToPath } from 'node:url'
import { adapt } from './adapters.mjs'
import { checkSql } from './checker.mjs'
import { fixtureContext } from './context.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
const position=(source,offset)=>{const lines=source.slice(0,offset).split('\n');return {line:lines.length-1,character:lines.at(-1).length}}
const [command,...args]=process.argv.slice(2)
const option=name=>args[args.indexOf(`--${name}`)+1]
function output(value,code){process.stdout.write(JSON.stringify(value)+'\n');process.exitCode=code}
try {
 if(!args.includes('--file')) throw new Error('--file is required')
 const file=resolve(option('file')),source=await readFile(file,'utf8'),sourceInfo={uri:pathToFileURL(file).href,sha256:hash(source)}
 if(command==='check') {
  const adapter=option('adapter'),rerun=[process.execPath,fileURLToPath(import.meta.url),'check','--adapter',adapter,'--file',file]
  let adapted
  try{adapted=adapt(adapter,source)}catch(error){adapted={status:'not checked',code:'SOURCE_PARSE_FAILED',reason:error.message}}
  const context=await fixtureContext()
  const result=adapted.status==='adapted'?checkSql(adapted.input,context):adapted
  const range=adapted.diagnosticRange??[0,source.length]
  const diagnostics=result.status==='supported'?[]:[{code:result.code,message:result.reason,range:{start:position(source,range[0]),end:position(source,range[1])},...(result.status==='violation'&&adapted.edit?{edit:{...adapted.edit,sourceHash:sourceInfo.sha256}}:{})}]
  output({protocol:'endpoints-probe/v1',status:result.status,source:sourceInfo,diagnostics,rerun,check:result,assumptions:['Disposable local PostgreSQL schema; no deployment checked','Trusted fixture Drizzle bindings or plain SQL; one text parameter placeholder supplied by harness','SQL result key/order only; no auth, wire, UI or ID immutability claim'],versions:{node:process.version,database:context.databaseVersion}},result.status==='supported'?0:result.status==='violation'?1:2)
 } else if(command==='apply') {
  if(!args.includes('--diagnostic')) throw new Error('--diagnostic is required')
  const report=JSON.parse(await readFile(resolve(option('diagnostic')),'utf8')),edit=report.diagnostics?.[0]?.edit
  if(report.source?.uri!==sourceInfo.uri||report.source?.sha256!==sourceInfo.sha256||edit?.sourceHash!==sourceInfo.sha256) output({status:'not checked',code:'STALE_DIAGNOSTIC',source:sourceInfo},2)
  else if(!Number.isInteger(edit.start)||!Number.isInteger(edit.end)||edit.start<0||edit.end<edit.start||edit.end>source.length||typeof edit.text!=='string') throw new Error('invalid edit')
  else {const fixed=source.slice(0,edit.start)+edit.text+source.slice(edit.end);await writeFile(file,fixed);output({status:'applied',source:{uri:sourceInfo.uri,sha256:hash(fixed)}},0)}
 } else throw new Error('command must be check or apply')
}catch(error){output({status:'error',code:'PROBE_ERROR',message:error.message},2)}
