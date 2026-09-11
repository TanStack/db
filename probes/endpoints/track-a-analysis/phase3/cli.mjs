import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {adaptModule} from './adapter.mjs'
import {verifyEvidence} from './evidence.mjs'
import {checkSql} from '../phase2/checker.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
const position=(source,offset)=>{const lines=source.slice(0,offset).split('\n');return {line:lines.length-1,character:lines.at(-1).length}}
const [command,...args]=process.argv.slice(2)
const required=name=>{const index=args.indexOf(`--${name}`);if(index<0||!args[index+1])throw Error(`--${name} is required`);return resolve(args[index+1])}
const output=(value,code)=>{process.stdout.write(JSON.stringify(value)+'\n');process.exitCode=code}
try {
 const file=required('file'),source=await readFile(file,'utf8'),sourceInfo={uri:pathToFileURL(file).href,sha256:hash(source)}
 if(command==='check') {
  const contractFile=required('contract'),snapshotFile=required('snapshot')
  const contract=JSON.parse(await readFile(contractFile,'utf8')),snapshot=JSON.parse(await readFile(snapshotFile,'utf8'))
  const evidence=await verifyEvidence(source,contract,snapshot)
  const adapted=evidence.status==='checked'?adaptModule(source,contract,snapshot.query?.params?.[0]):evidence
  let result=adapted.status==='adapted'?checkSql(adapted.input,evidence.context):adapted
  let runtimeComparison={status:'not checked'}
  if(adapted.status==='adapted') {
   const matches=snapshot.query?.sql===adapted.input.sql&&JSON.stringify(snapshot.query.params)===JSON.stringify(adapted.input.params)
   runtimeComparison={status:matches?'matched':'not checked',analyzed:adapted.input,observed:snapshot.query??null}
   if(!matches)result={status:'not checked',code:'RUNTIME_QUERY_MISMATCH',reason:'analyzed SQL/parameters differ from the captured handler query; execute current listTodos and recapture evidence'}
  }
  const range=adapted.diagnosticRange??[0,source.length]
  const diagnostics=result.status==='supported'?[]:[{code:result.code,message:result.reason,range:{start:position(source,range[0]),end:position(source,range[1])},...(result.status==='violation'?{edit:{...adapted.edit,sourceHash:sourceInfo.sha256}}:{})}]
  const rerun=[process.execPath,fileURLToPath(import.meta.url),'check','--file',file,'--contract',contractFile,'--snapshot',snapshotFile]
  output({protocol:'endpoints-probe/v2',endpoint:contract.endpoint,status:result.status,source:sourceInfo,diagnostics,rerun,check:result,provenance:evidence.provenance??null,runtimeComparison,correspondence:adapted.correspondence??null,assumptions:['Caller-captured local integrated Todo instance snapshot; not deployment attestation','Named handler only; sibling mutation/UI/module side effects are not analyzed','SQL result key/order only; no auth, wire or UI order proof'],nextStep:result.status==='violation'?'Apply repair, wait for local rebuild, execute listTodos, recapture snapshot and rerun':null},result.status==='supported'?0:result.status==='violation'?1:2)
 } else if(command==='apply') {
  const report=JSON.parse(await readFile(required('diagnostic'),'utf8')),edit=report.diagnostics?.[0]?.edit
  if(report.source?.uri!==sourceInfo.uri||report.source?.sha256!==sourceInfo.sha256||edit?.sourceHash!==sourceInfo.sha256)output({status:'not checked',code:'STALE_DIAGNOSTIC',source:sourceInfo},2)
  else if(!Number.isInteger(edit.start)||!Number.isInteger(edit.end)||edit.start<0||edit.end<edit.start||edit.end>source.length||typeof edit.text!=='string')throw Error('invalid edit')
  else{const fixed=source.slice(0,edit.start)+edit.text+source.slice(edit.end);await writeFile(file,fixed);output({status:'applied',source:{uri:sourceInfo.uri,sha256:hash(fixed)},nextStep:'Rebuild app, execute listTodos, recapture snapshot, rerun checker'},0)}
 } else throw Error('command must be check or apply')
}catch(error){output({status:'error',code:'PROBE_ERROR',message:error.message},2)}
