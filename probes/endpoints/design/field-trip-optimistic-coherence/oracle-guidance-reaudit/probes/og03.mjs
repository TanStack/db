import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { Evidence } = await import(pathToFileURL(process.cwd()+'/probes/endpoints/integrated-todo/tests/oracles/evidence.mjs'))
for (const variable of ['ENDPOINT_ORACLE_MUTANT','ENDPOINT_COMPILED_MUTANT','ENDPOINT_FUNCTION_MUTANT','ENDPOINT_DEPENDENCY_MUTANT','ENDPOINT_ORACLE_TEST_FAULT']) {
 const saved=process.env[variable], exit=process.exitCode, output=await mkdtemp('/tmp/og03-')
 try {
  process.env[variable]='control'
  const evidence = new Evidence('OG-03'), report={ok:true}
  await evidence.finish(report,output)
  assert.equal(report.ok, variable !== 'ENDPOINT_ORACLE_TEST_FAULT')
  console.log(JSON.stringify({id:'OG-03',variable,ok:report.ok,outcome:report.outcome,recordedFault:report.evidence.fault}))
 } finally {
  saved===undefined?delete process.env[variable]:process.env[variable]=saved
  process.exitCode=exit
  await rm(output,{recursive:true,force:true})
 }
}
