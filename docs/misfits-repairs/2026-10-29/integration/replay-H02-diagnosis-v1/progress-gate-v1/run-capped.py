from pathlib import Path
import subprocess, os, signal, time, json, sys, hashlib
root=Path('/private/tmp/replay-h02-diagnostic-mo8pxcv_')
out=Path(__file__).resolve().parent
name=sys.argv[1]
test=sys.argv[2]
argv=['node', '--max-old-space-size=384', str(root/'node_modules/vitest/vitest.mjs'), 'run', '--coverage.enabled=false', '--typecheck.enabled=false', '--maxWorkers=1', '--pool=forks', '--fileParallelism=false', '--config', 'h02.vite.config.ts', test]
env=os.environ.copy(); env['NODE_OPTIONS']='--max-old-space-size=384'; env['CI']='1'; env['NO_COLOR']='1'
start=time.monotonic(); maximum=0; samples=0; termination=None; pgid=None
with (out/(name+'.log')).open('wb') as log:
 p=subprocess.Popen(argv,cwd=root/'packages/query-db-collection',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 pgid=p.pid
 while p.poll() is None:
  elapsed=time.monotonic()-start
  q=subprocess.run(['ps','-A','-o','pid=,pgid=,rss='],capture_output=True,text=True)
  if q.returncode != 0:
   termination='monitor-failed'; break
  rows=[line.split() for line in q.stdout.splitlines()]
  rss=sum(int(row[2])*1024 for row in rows if len(row)==3 and int(row[1])==pgid)
  maximum=max(maximum,rss); samples+=1
  currentLog=(out/(name+'.log')).read_bytes()
  if b'H02_EVENT_LIMIT_REACHED' in currentLog: termination='event-cap'; break
  if b'H02_PRIMITIVE_ERROR_STOP' in currentLog: termination='primitive-error-stop'; break
  if rss>1024**3: termination='rss-cap'; break
  if elapsed>20: termination='wall-cap'; break
  time.sleep(.1)
 if termination:
  try: os.killpg(pgid,signal.SIGKILL)
  except ProcessLookupError: pass
 p.wait()
 # Always stop any retained descendant after leader completion.
 try: os.killpg(pgid,signal.SIGKILL)
 except ProcessLookupError: pass
result={'name':name,'argv':argv,'cwd':str(root/'packages/query-db-collection'),'NODE_OPTIONS':env['NODE_OPTIONS'],'testSha256':hashlib.sha256((root/'packages/query-db-collection'/test).read_bytes()).hexdigest(),'sourceIdentity':'archived baseline 3937a73a source aliases; reconstructed receiving path, original build bytes unavailable','exitCode':p.returncode,'termination':termination,'elapsedSeconds':round(time.monotonic()-start,3),'maximumGroupRssBytes':maximum,'rssSamples':samples,'pgid':pgid}
(out/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
