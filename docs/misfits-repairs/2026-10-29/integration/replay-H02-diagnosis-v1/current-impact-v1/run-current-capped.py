from pathlib import Path
import subprocess, os, signal, time, json, sys, hashlib, datetime
out=Path(__file__).resolve().parent
label=sys.argv[1]
composition=next(x for x in json.loads((out/'composition-freeze-v1.json').read_text()) if x['label']==label)
root=Path(composition['root']); name='current-'+label
argv=['node','--max-old-space-size=384',str(root/'node_modules/vitest/vitest.mjs'),'run','--coverage.enabled=false','--typecheck.enabled=false','--maxWorkers=1','--pool=forks','--fileParallelism=false','--config','h02.vite.config.ts','tests/h02-current-impact-v1.test.ts']
env=os.environ.copy();env['NODE_OPTIONS']='--max-old-space-size=384';env['CI']='1';env['NO_COLOR']='1'
state={'label':label,'composition':composition,'argv':argv,'cwd':str(root/'packages/query-db-collection'),'NODE_OPTIONS':env['NODE_OPTIONS'],'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'prepared','caps':{'heapMiBPerNode':384,'groupRssBytes':1073741824,'wallSeconds':20,'primitiveEvents':128},'maximumGroupRssBytes':0,'samples':0,'termination':None,'killAttempts':[],'monitorErrors':[]}
start=time.monotonic();p=None;pgid=None
receipt=out/(name+'.json')
def save():
 state['elapsedSeconds']=round(time.monotonic()-start,3)
 temp=receipt.with_suffix('.tmp');temp.write_text(json.dumps(state,indent=2)+'\n');temp.replace(receipt)
def group_rows():
 q=subprocess.run(['ps','-A','-o','pid=,pgid=,rss=,stat='],capture_output=True,text=True,timeout=1,check=True)
 return [{'pid':int(x[0]),'pgid':int(x[1]),'rss':int(x[2])*1024,'stat':x[3]} for line in q.stdout.splitlines() if len(x:=line.split())==4 and int(x[1])==pgid]
def stop(reason):
 if state['termination'] is None:state['termination']=reason
 save()
 # Only the live run is stopped here. No unconditional post-wait kill.
 if p is not None and p.poll() is None:
  attempt={'reason':reason,'group':pgid}
  try:os.killpg(pgid,signal.SIGKILL);attempt['outcome']='sent'
  except ProcessLookupError:attempt['outcome']='already-exited'
  except OSError as error:attempt['outcome']=repr(error)
  state['killAttempts'].append(attempt);save()
class Deadline(Exception):pass
def deadline(signum,frame):raise Deadline('external wall deadline')
save()
try:
 with (out/(name+'.log')).open('wb') as log:
  p=subprocess.Popen(argv,cwd=state['cwd'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  pgid=p.pid;state.update({'pid':p.pid,'pgid':pgid,'status':'running'});save()
  signal.signal(signal.SIGALRM,deadline);signal.setitimer(signal.ITIMER_REAL,20)
  try:
   while p.poll() is None:
    rows=group_rows();rss=sum(x['rss'] for x in rows)
    state['maximumGroupRssBytes']=max(state['maximumGroupRssBytes'],rss);state['samples']+=1;state['lastGroupRows']=rows;save()
    current=(out/(name+'.log')).read_bytes()
    if b'H02_EVENT_LIMIT_REACHED' in current:stop('event-cap');break
    if b'H02_PRIMITIVE_ERROR_STOP' in current:stop('primitive-error-stop');break
    if rss>1073741824:stop('rss-cap');break
    time.sleep(.08)
  except Deadline:stop('wall-cap')
  except BaseException as error:
   state['monitorErrors'].append(repr(error));stop('monitor-failure')
  finally:signal.setitimer(signal.ITIMER_REAL,0)
  try:state['exitCode']=p.wait(timeout=3)
  except subprocess.TimeoutExpired:
   state['monitorErrors'].append('leader did not exit after containment');stop('leader-wait-failure')
except BaseException as error:
 state['monitorErrors'].append(repr(error));stop('runner-failure')
finally:
 signal.setitimer(signal.ITIMER_REAL,0)
 if pgid is not None:
  try:
   remaining=group_rows();state['remainingGroupRows']=remaining
   live=[x for x in remaining if not x['stat'].startswith('Z')]
   # Conditional descendant cleanup only after a positive process inventory.
   if live:
    attempt={'reason':'observed-live-descendants','group':pgid,'members':live}
    try:os.killpg(pgid,signal.SIGKILL);attempt['outcome']='sent'
    except ProcessLookupError:attempt['outcome']='already-exited'
    except OSError as error:attempt['outcome']=repr(error)
    state['killAttempts'].append(attempt)
  except BaseException as error:state['monitorErrors'].append('final inventory: '+repr(error))
 current=(out/(name+'.log')).read_text(errors='replace') if (out/(name+'.log')).exists() else ''
 events=[]
 for line in current.splitlines():
  if line.startswith('{"event"'):
   try:events.append(json.loads(line))
   except json.JSONDecodeError:pass
 state['primitiveEventCount']=len(events);state['events']=events;state['status']='finished';save()
print(json.dumps({k:state.get(k) for k in ['label','status','pid','pgid','exitCode','termination','elapsedSeconds','maximumGroupRssBytes','primitiveEventCount','remainingGroupRows','monitorErrors']}))
