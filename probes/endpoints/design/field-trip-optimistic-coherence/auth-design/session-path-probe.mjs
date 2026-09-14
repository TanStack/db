// Disposable generated identities only. No application configuration or credentials.
import { betterAuth } from '/Users/kylemathews/programs/kitchen-ai/node_modules/better-auth/dist/index.mjs'
import { memoryAdapter } from '/Users/kylemathews/programs/kitchen-ai/node_modules/better-auth/dist/adapters/memory-adapter/index.mjs'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const results = []
for (const scenario of ['cached', 'revoked-cached', 'revoked-bypass', 'bypass-fresh', 'renewal', 'expired', 'expired-disable-refresh', 'renewal-write-failed']) {
  const store = {user: [], session: [], account: [], verification: []}
  const auth = betterAuth({database:memoryAdapter(store), baseURL:'http://localhost:3999', secret:randomBytes(32).toString('hex'),emailAndPassword:{enabled:true},session:{cookieCache:{enabled:true,maxAge:300}},logger:{disabled:true}})
  const signup = await auth.api.signUpEmail({body:{name:'Probe',email:'probe@example.test',password:randomBytes(24).toString('hex')},returnHeaders:true})
  const cookies = signup.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.ok(cookies)
  const ctx=await auth.$context
  const calls={findSession:0,updateSession:0,deleteSession:0}
  for (const method of Object.keys(calls)) {
    const original=ctx.internalAdapter[method].bind(ctx.internalAdapter)
    ctx.internalAdapter[method]=async(...args)=>{calls[method]++; if(scenario==='renewal-write-failed'&&method==='updateSession')return null;return original(...args)}
  }
  assert.equal(store.session.length,1)
  if(scenario.startsWith('revoked'))store.session.length=0
  if(scenario==='renewal'||scenario==='renewal-write-failed')store.session[0].expiresAt=new Date(Date.now()+1000*60*60*24*5)
  if(scenario.startsWith('expired'))store.session[0].expiresAt=new Date(Date.now()-1000)
  const query=scenario==='cached'||scenario==='revoked-cached'?{}:{disableCookieCache:true,...(scenario==='expired-disable-refresh'?{disableRefresh:true}:{})}
  let accepted=false, error=false, responseCookies=0
  try{const result=await auth.api.getSession({headers:new Headers({cookie:cookies}),query,returnHeaders:true});accepted=!!result.response?.user;responseCookies=result.headers?.getSetCookie().length??0}catch{error=true}
  results.push({scenario,accepted,error,calls,responseCookies,storedSessions:store.session.length})
}
const byName=Object.fromEntries(results.map(v=>[v.scenario,v]))
assert.equal(byName.cached.accepted,true);assert.equal(byName.cached.calls.findSession,0)
assert.equal(byName['revoked-cached'].accepted,true);assert.equal(byName['revoked-cached'].calls.findSession,0)
assert.equal(byName['revoked-bypass'].accepted,false);assert.equal(byName['revoked-bypass'].calls.findSession,1)
assert.equal(byName.renewal.calls.updateSession,1)
assert.equal(byName['expired-disable-refresh'].calls.deleteSession,1)
assert.equal(byName['renewal-write-failed'].error,true)
const report={library:'better-auth 1.7.4',adapter:'memory',scope:'Installed public API control-flow probe; not Drizzle/PostgreSQL or browser header integration',results}
await writeFile(new URL('./session-path-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
