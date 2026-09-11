import {createHash} from 'node:crypto'
import {parse} from '@babel/parser'
import {extract,build} from '../probe.mjs'
const gap=(code,reason)=>({status:'not checked',code,reason})
const id=(node,name)=>node?.type==='Identifier'&&node.name===name
const member=(node,object,key)=>node?.type==='MemberExpression'&&!node.computed&&id(node.object,object)&&id(node.property,key)
const position=(source,offset)=>{const lines=source.slice(0,offset).split('\n');return {line:lines.length,column:lines.at(-1).length+1}}
const prefix="import { asc, eq } from 'drizzle-orm'\nimport { db, todo, query, requireUser } from './fixture-bindings'\nexport const listTodos = query({\n"

// Recognizes only the declared specimen's imported bindings and list handler.
// Mutation, UI, input validation behavior and module side effects are not checked.
export function adaptModule(source,contract,userId='fixture-user') {
 if(!contract?.endpoint||!contract.imports||!contract.schema?.identity||!Array.isArray(contract.schema.columns)) return gap('CONTRACT_NOT_CHECKED','endpoint/import/schema contract is required')
 let ast
 try{ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']})}catch(error){return gap('SOURCE_PARSE_FAILED',error.message)}
 const imports=ast.program.body.filter(node=>node.type==='ImportDeclaration')
 for(const name of ['query','db','todo','requireUser','asc','eq','z']) {
  if(typeof contract.imports[name]!=='string'||!imports.some(node=>node.source.value===contract.imports[name]&&node.specifiers.some(s=>s.type==='ImportSpecifier'&&id(s.local,name)&&id(s.imported,name)))) return gap('BINDING_NOT_CHECKED',`import binding ${name} does not match the declared contract`)
 }
 const declarations=ast.program.body.flatMap(node=>{
  const declaration=node.type==='ExportNamedDeclaration'?node.declaration:node
  return declaration?.type==='VariableDeclaration'?declaration.declarations:[]
 })
 const endpoint=declarations.find(node=>id(node.id,contract.endpoint))
 const init=endpoint?.init
 if(init?.type!=='CallExpression'||!id(init.callee,'query')||init.arguments.length!==1||init.arguments[0].type!=='ObjectExpression') return gap('ENDPOINT_NOT_CHECKED','named endpoint must be a direct query object declaration')
 const properties=init.arguments[0].properties
 if(properties.length!==2||properties.some(p=>p.computed||!['ObjectProperty','ObjectMethod'].includes(p.type)||!['input','handler'].some(name=>id(p.key,name)))) return gap('QUERY_OPTIONS_NOT_CHECKED','query supports only direct input and handler properties')
 const handler=properties.find(p=>id(p.key,'handler'))
 const input=properties.find(p=>id(p.key,'input'))?.value
 if(handler?.type!=='ObjectMethod'||input?.type!=='CallExpression'||!member(input.callee,'z','object')||input.arguments.length!==1||input.arguments[0].type!=='ObjectExpression'||input.arguments[0].properties.length!==0) return gap('QUERY_OPTIONS_NOT_CHECKED','query input must be z.object({}) and handler an inline method')
 const handlerSource=source.slice(handler.start,handler.end)
 const canonical=prefix+handlerSource+'\n})'
 const facts=extract(canonical)
 if(facts.status!=='checked') return gap('HANDLER_NOT_CHECKED',facts.reason)
 const delta=handler.start-prefix.length
 const shift=span=>({range:span.range.map(offset=>offset+delta),location:position(source,span.range[0]+delta)})
 return {status:'adapted',endpoint:contract.endpoint,input:{...build(facts,userId).toSQL(),parameterTypes:['text']},diagnosticRange:shift(facts.order).range,edit:{start:facts.order.insertAt+delta,end:facts.order.insertAt+delta,text:', asc(todo.id)'},correspondence:{sourceHash:createHash('sha256').update(source).digest('hex'),handler:shift({range:[prefix.length,prefix.length+handlerSource.length]}),fields:facts.fields.map(field=>({name:field.name,...shift(field)})),predicate:shift(facts.where),response:shift(facts.response),method:'AST selected handler → bounded Drizzle lowering; source offset translation',unchecked:['sibling mutation/UI/module side effects','auth/input validation/serialization semantics']}}
}
