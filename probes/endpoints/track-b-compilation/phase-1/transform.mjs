import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
const generate = generateModule.default ?? generateModule
// Bounded probe grammar: exported top-level const = mutation(object literal).
// No analysis metadata is inferred. Start owns RPC identity and transport.
export function endpointsProbe() {
 return { name:'endpoints-probe', enforce:'pre', transform(code,id) {
  if(!id.split('?')[0].endsWith('/endpoint.ts')) return
  const ast=parse(code,{sourceType:'module',plugins:['typescript']})
  const edits=[]
  for(const stmt of ast.program.body) {
   const decl=stmt.type==='ExportNamedDeclaration'?stmt.declaration:stmt
   if(decl?.type!=='VariableDeclaration') continue
   for(const d of decl.declarations) {
    if(d.init?.type!=='CallExpression'||d.init.callee.name!=='mutation') continue
    if(d.id.type!=='Identifier'||d.init.arguments[0]?.type!=='ObjectExpression') throw Error('Unsupported endpoint declaration')
    const props=d.init.arguments[0].properties
    if(props.some(p=>!['ObjectMethod','ObjectProperty'].includes(p.type)||p.computed)) throw Error('Unsupported endpoint properties')
    const values=Object.fromEntries(props.map(p=>[p.key.name,p.type==='ObjectMethod'?`${p.async?'async ':''}function(${p.params.map(x=>generate(x).code).join(',')}) ${generate(p.body).code}`:generate(p.value).code]))
    const name=d.id.name
    const out=`const ${name}Rpc=createServerFn({method:'POST'}).inputValidator(${values.input}).handler(async ({data})=>(${values.handler})({body:data},{json: value=>value}));\n${stmt.type==='ExportNamedDeclaration'?'export ':''}const ${name}=Object.assign((input)=>${name}Rpc({data:input}),{onMutate:${values.onMutate}});`
    edits.push([stmt.start,stmt.end,out])
   }
  }
  if(!edits.length) return
  for(const [start,end,out] of edits.reverse()) code=code.slice(0,start)+out+code.slice(end)
  return {code:`import {createServerFn} from '@tanstack/react-start';\n${code}`,map:null}
 }}
}
