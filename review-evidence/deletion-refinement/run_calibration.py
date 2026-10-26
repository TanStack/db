from pathlib import Path
import subprocess, json, hashlib
root=Path(__file__).resolve().parents[2]
package=root/'packages/indexeddb-db-collection'
adapter=package/'src/indexeddb.ts'
state=root/'packages/db/src/collection/state.ts'
wrapper=package/'src/wrapper.ts'
out=root/'review-evidence/deletion-refinement/calibration';out.mkdir(parents=True,exist_ok=True)
original={p:p.read_text() for p in [adapter,state,wrapper]}
pair='first.*insert.*second.*insert.*explicit.*false'
cases=[
 ('explicitClose',adapter,'    for (const notify of [...connection.listeners]) notify()','    for (const notify of []) notify()','confirms native-committed update'),
 ('lateRead',adapter,'if (activeSync !== params || connection?.error) return','if (activeSync !== params) return','rejects late replacement publication after explicit'),
 ('truncateReady',adapter,'activeSync.truncate({ markReady: !connection?.error })','activeSync.truncate()','confirms native-committed import'),
 ('lateReady',adapter,'if (connection?.error) {\n      retire()','if (connection?.error) {\n      params.markReady()','does not admit a resolved handler after explicit'),
 ('admitClosed',adapter,'  const close = () => {\n    db.close()','  const close = () => {','does not admit a resolved handler after explicit'),
 ('notifyBeforeClose',adapter,'  const close = () => {\n    db.close()','  const close = () => {','closes native admission before exposing explicit'),
 ('dropAccepted',state,'    const hasPersistingTransaction = this.hasPersistingTransaction()','    if (this.lifecycle.status === `error`) return { processed: false }\n    const hasPersistingTransaction = this.hasPersistingTransaction()','publishes accepted update before caller settlement after explicit'),
 ('rejectCommitted',adapter,'    if (replace) versionCache.clear()','    if (connection?.error) throw connection.error\n    if (replace) versionCache.clear()',pair),
 ('prematureSuccess',wrapper,'Promise.all([callbackResult, completed]).then(', 'Promise.all([callbackResult, Promise.resolve()]).then(',pair),
 ('obsoleteProtocol',adapter,"message.type === 'database-cleared')", "message.type === 'database-cleared' || message.type === 'database-deleted')",'ignores the retired database-deleted message protocol'),
]
results=[]
try:
 for name,path,before,after,selector in cases:
  source=original[path]
  if before not in source: raise RuntimeError(f'{name}: missing mutation anchor')
  changed=source.replace(before,after)
  if name=='notifyBeforeClose': changed=changed.replace('    for (const notify of [...connection.listeners]) notify()', '    for (const notify of [...connection.listeners]) notify()\n    db.close()')
  path.write_text(changed)
  command=['node','../../node_modules/vitest/vitest.mjs','run','tests/retirement-oracle.test.ts','--coverage.enabled=false','--typecheck.enabled=false','--reporter=verbose','-t',selector]
  try:
   result=subprocess.run(command,cwd=package,capture_output=True,text=True,timeout=40)
   log=result.stdout+result.stderr
   (out/f'{name}.log').write_text(log)
   killed=result.returncode!=0 and 'AssertionError' in log and 'Test timed out' not in log and 'No test files found' not in log
   results.append({'fault':name,'selector':selector,'exit':result.returncode,'assertionKill':killed})
   print(name, 'KILLED' if killed else 'CHECK',flush=True)
  finally: path.write_text(source)
finally:
 for path,source in original.items(): path.write_text(source)
 (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
if any(not row['assertionKill'] for row in results): raise SystemExit(1)
