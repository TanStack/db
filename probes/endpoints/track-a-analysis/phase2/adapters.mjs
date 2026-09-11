import { parse,locationOf } from 'pgsql-ast-parser'
import { extract,build } from '../probe.mjs'
export function adapt(adapter,source) {
 if(adapter==='drizzle') {
  const facts=extract(source)
  if(facts.status!=='checked') return {status:'not checked',code:'SOURCE_NOT_CHECKED',reason:facts.reason}
  return {status:'adapted',input:{...build(facts,'fixture-user').toSQL(),parameterTypes:['text']},diagnosticRange:facts.order.range,edit:{start:facts.order.insertAt,end:facts.order.insertAt,text:', asc(todo.id)'}}
 }
 if(adapter==='sql') {
  const statements=parse(source,{locationTracking:true})
  const order=statements[0]?.orderBy
  const first=order?.[0],last=order?.at(-1)
  return {status:'adapted',input:{sql:source,params:['fixture-user'],parameterTypes:['text']},diagnosticRange:first?[locationOf(first).start,locationOf(last).end]:[0,source.length],edit:last?{start:locationOf(last).end,end:locationOf(last).end,text:', id asc'}:null}
 }
 return {status:'not checked',code:'ADAPTER_UNKNOWN',reason:'adapter must be drizzle or sql'}
}
