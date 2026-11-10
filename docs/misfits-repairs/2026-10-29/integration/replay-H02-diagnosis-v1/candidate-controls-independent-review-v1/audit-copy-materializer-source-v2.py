"""Independent named filesystem/hash/strict-JSON/lexical materializer review; candidate never executes or syntax-compiles."""
from pathlib import Path
import datetime,hashlib,io,json,os,re,shlex,stat,tokenize
O=Path(__file__).resolve().parent;H=O.parent
C=H/'candidate-controls-pagination-qualified-peer-materialization-source-v1'
U=H/'candidate-controls-pagination-qualified-peer-diagnostics-source-v1'
V=H/'candidate-controls-pagination-qualified-peer-receiving-operational-preparation-v1'
Q=H/'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
S=H/'candidate-controls-pagination-receiving-checkpoint-peer-diagnostics-successor-v1'
D=H/'candidate-controls-pagination-shared-window-receiving-operational-preparation-v1'
E=H/'candidate-controls-pagination-shared-window-failure-receiving-runtime-v1'
errors=[]
def check(v,m):
 if not v:errors.append(m)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pairs(xs):
 d={}
 for k,v in xs:
  if k in d:raise ValueError('duplicate '+k)
  d[k]=v
 return d
def load(p):return json.loads(Path(p).read_text(),object_pairs_hook=pairs,parse_constant=lambda x:(_ for _ in ()).throw(ValueError(x)))
def bound(p,h):check(sha(p)==h,'hash '+str(p))
def ref(r):bound(r['path'],r['sha256'])
def fmap(root,entries):
 for n,v in entries.items():
  p=Path(root)/n;bound(p,v['sha256'] if isinstance(v,dict) else v)
  if isinstance(v,dict):check(p.stat().st_size==v['bytes'],'bytes '+str(p))
def packet(root,digest,count,closure=True):
 bound(root/'packet-manifest-v1.json',digest);m=load(root/'packet-manifest-v1.json');fmap(root,m['files']);check(len(m['files'])==count,'count '+str(root))
 if closure:
  actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()};check(actual==set(m['files'])|{'packet-manifest-v1.json'},'closure '+str(root))
 return m
cm=packet(C,'9abbc7da757afc7ce98b60f1b07a3ed70f851875efff27e729efdd1b0b2bb298',7)
packet(U,'bc7c1ad1828d056fcf57aac1fdf6038bbc9a564d622cff75c262b9e8a1d97ca0',90)
packet(V,'d9cfd4cf3abbc8b1b41d148067eced85af9c8711907bd051aba1a41aff5e26a5',14)
packet(S,'a56541c3188c6a8348aa1187575e0192410dc3e8d86d1a9697628dc4a9312d25',120)
packet(D,'b392686f0a401be65ca4c364efe54310e4ec454204f59f18859b7883cd0d6403',21,False)
e=load(E/'result-freeze-v1.json');bound(E/'result-freeze-v1.json','5dd02625d22a6f096470737b3d09a447cf89c985d91f819e5e30cdda5c5e7b8a');check(len(e['files'])==1996,'E1996');fmap(E,e['files'])
rel={i['from']:i['to'] for i in load(Q/'artifact-snapshot-relocation-v1/path-map-v1.json')['relocations']}
for name,count,mapping in [('packet-sha256-v1.json',126,rel),('packet-sha256-with-snapshot-relocation-v2.json',133,{})]:
 m=load(Q/name);check(len(m)==count,'Qcount');fmap(Q,{mapping.get(k,k):v for k,v in m.items()})
for n in cm['files']:
 if n.endswith('.json'):load(C/n)
contract=load(C/'copy-only-contract-v1.json');geometry=load(C/'explicit-copy-geometry-v1.json');tool=load(C/'proposed-exact-copy-only-tool-invocation-v1.json')
bound(C/'materialize-qualified-peer-v1.py.txt','c70ae4e91c182afd5a8c1d0cd8597f43ec3e3e0cb1bff916d78b2d06a070bc09');bound(C/'copy-only-contract-v1.json','f5964732cc403ebe13dc401775b38d5bf9caba1536a2c2a5d53e0961905b9bed');bound(C/'proposed-exact-copy-only-tool-invocation-v1.json','2df5c78a10bbcb0b82b3cec7bf139bbd85603a775cbd8021fa91f4eac2e68b4f')
for r in [contract['materializer'],contract['geometry'],contract['binding'],contract['plan'],contract['finiteToolInputs'],*contract['sourceReviews'],*contract['packets'],*contract['lockInputs']]:ref(r)
classification=load(H/'candidate-controls-pagination-qualified-operational-root-classification-v1.json');check(classification['UManifestSha256']==sha(U/'packet-manifest-v1.json') and classification['VManifestSha256']==sha(V/'packet-manifest-v1.json') and not classification['runtimeAdmission'],'bounded root authority');ref(classification['review'])
plan=load(contract['plan']['path']);binding=load(contract['binding']['path']);u=load(U/'source-freeze-v1.json');q=load(Q/'source-freeze-v1.json');W=Path(u['acceptedActiveWorktree'])
fmap(W,q['sourceBindings']);fmap(q['sourceCopyRoot'],q['sourceCopies']);check(len(q['sourceBindings'])==596 and len(q['sourceCopies'])==85,'protectedW596Q85')
regulars=plan['regularCodeAndLockFiles']+plan['regularControlFiles'];links=plan['dependencyReuseSymlinks'];targets=[r['runtimePath'] for r in regulars+links];root=Path(plan['proposedRoot'])
check(len(regulars)==603 and len(links)==4 and len(set(targets))==607,'603regular4links607unique')
dirs={root}
for name in targets:
 p=Path(name);check(p.is_absolute() and str(p)==os.path.normpath(p) and p.is_relative_to(root) and p!=root,'target containment')
 for parent in p.parents:
  if parent==root or parent.is_relative_to(root):dirs.add(parent)
check(geometry['destinations']==sorted(targets) and set(geometry['directories'])=={str(p) for p in dirs} and len(dirs)==227,'exact607destinations227dirs')
check(not set(targets)&{str(p) for p in dirs},'directory-target disjoint')
for link in links:
 check(not any(t.startswith(link['runtimePath']+'/') for t in targets),'no child under link');check(Path(link['target']).is_dir() and str(Path(link['target']).resolve())==link['target'],'exact reuse endpoint')
for r in regulars:
 bound(r['from'],r['fromSha256']);check(stat.S_ISREG(os.lstat(r['from']).st_mode),'all603originfinalregular')
for p in [root,Path(contract['receiptRoot']),*[Path(p) for p in contract['receivingOutputRoots']]]:check(not os.path.lexists(p),'still absent '+str(p))
for p in [root/'code',root/'control']:check(not os.path.lexists(p),'absent child '+str(p))
bound(contract['python']['path'],contract['python']['sha256']);check(str(Path(contract['python']['path']).resolve())==contract['python']['resolved'],'Python resolved binary path');ref(tool['shell']);check(contract['python']==tool['python'] and contract['python']['flags']==['-I','-S','-B'],'same isolated interpreter proposal')
bound(binding['node']['executable'],binding['node']['sha256']);supp=load(contract['finiteToolInputs']['path']);seen=set();payloads=0
for r in list(binding['packages'].values())+supp['packages']:
 base=Path(r['resolved'])
 if str(base) in seen:continue
 seen.add(str(base));actual=set()
 for directory,ds,fs in os.walk(base,followlinks=False):
  ds[:]=[n for n in ds if n!='node_modules' and not (Path(directory)/n).is_symlink()]
  for n in fs:
   p=Path(directory)/n
   if p.is_file() and not p.is_symlink():actual.add(str(p.relative_to(base)))
 check(actual==set(r['regularPayloadFilesMap']),'named own closure '+str(base));fmap(base,r['regularPayloadFilesMap']);payloads+=len(r['regularPayloadFilesMap'])
check((len(seen),payloads)==(255,11974),'named tool25511974');check(len(supp['resolutionEdges'])==405 and len(supp['uninstalledDeclaredOptionalOrPeerDependencies'])==112,'named edge/absence405112')
for r in supp['resolutionEdges']:check(str(Path(r['logical']).resolve())==r['resolved'],'named resolution edge')
for r in supp['uninstalledDeclaredOptionalOrPeerDependencies']:
 p=Path(r['from']);check(not any(os.path.lexists(q/'node_modules'/r['dependency']) for q in [p,*p.parents]),'named optionalpeerabsence')
source=(C/'materialize-qualified-peer-v1.py.txt').read_text();tokens=list(tokenize.generate_tokens(io.StringIO(source).readline));imports=re.findall(r'^import (\w+)$',source,re.M)
check(imports==['hashlib','json','os','stat','sys','traceback'],'sixstdlibimports')
code_tokens=[t.string for t in tokens if t.type not in [tokenize.STRING,tokenize.COMMENT,tokenize.NL,tokenize.NEWLINE,tokenize.INDENT,tokenize.DEDENT,tokenize.ENDMARKER]]
check(not any(code_tokens[i] in ['eval','exec','compile','__import__'] and code_tokens[i+1]=='(' for i in range(len(code_tokens)-1)) and not any(t in ['subprocess','shutil'] for t in code_tokens),'no dynamic execution/subprocess/removal source')
for s in ['os.O_RDONLY | os.O_NOFOLLOW','os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW','os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW','os.symlink(record["target"], name, dir_fd=parent)','files == expected_files','links == expected_links','dirs == expected_dirs','os.path.samestat(os.fstat(root_fd), os.lstat(root))','err.write(failure)','return 1']:
 check(s in source,'requiredsource '+s)
check(sum(line.strip()=='verify_tree(root_fd, expected_files, expected_links, expected_dirs)' for line in source.splitlines())==2 and source.count('            verify_inputs()')==2,'two source input and tree passes')
check(source.index('            verify_inputs()')<source.index('                os.mkdir(os.path.basename(root)')<source.index('            emit("copy-verified"'),'sourcepreflight-copy-finalordering')
check(source.index('    os.mkdir(receipt, 0o700)')<source.index('            emit("start"'),'exclusive receipt before start')
argv=[contract['python']['path'],'-I','-S','-B',contract['materializer']['path'],str(C/'copy-only-contract-v1.json'),sha(C/'copy-only-contract-v1.json')]
check(tool['argv']==argv and shlex.split(tool['arguments']['cmd'])==['exec',*argv],'exactexecargv')
check(tool['arguments']=={'cmd':'exec '+' '.join(argv),'shell':'/bin/sh','login':False,'workdir':str(C.parents[5]),'sandbox_permissions':'use_default','yield_time_ms':1000,'max_output_tokens':10000},'exacttoolarguments')
check(tool['maxInvocations']==1 and not tool['executed'] and not contract['executed'] and 'Still unselected' in tool['compilerContainment'],'one proposed copy-only no later authority')
ledger=O/'raw-items-ledger-v1.jsonl';check(len(ledger.read_bytes().splitlines())==127 and sha(ledger)=='8402b1eaa4f725b565fd8d0112b39c64f4de6f63beed837e2f4868b15eceb53c','127ledgerprefix')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':__doc__,'candidatePacketSha256':sha(C/'packet-manifest-v1.json'),'candidateMembers':7,'priorAuditFailure':'v1 lexical regex included docstring; call count included function declaration; coordinator ancestor index was one level short; all failed v1 artifacts preserved','candidateBytes':sum(r['bytes'] for r in cm['files'].values()),'materializerSha256':sha(C/'materialize-qualified-peer-v1.py.txt'),'contractSha256':sha(C/'copy-only-contract-v1.json'),'toolProposalSha256':sha(C/'proposed-exact-copy-only-tool-invocation-v1.json'),'protectedWBindings':596,'protectedQCopies':85,'destinations':607,'directories':227,'regularCopies':603,'namedLinks':4,'stdlibImports':imports,'lexicalTokens':len(tokens),'candidateSyntaxCompile':0,'candidateImports':0,'candidateExecutions':0,'materialization':0,'nativeReceiving':0,'processProbes':0,'namedPackageRoots':len(seen),'ownPayloads':payloads,'namedResolutionEdges':405,'namedOptionalPeerAbsences':112,'allAuditChecksPass':not errors,'errors':errors,'exactNextToolInvocation':tool['arguments'],'runtimeAdmission':False,'compilerContainment':'unselected; later separate admission','protectedAfterCopyGate':'independent actual verification must rehash W596/Q85 and sealed ancestors; candidate rehashes declared origins/U/V/tool inputs only','ledgerPrefixRows':127,'ledgerPrefixSha256':sha(ledger),'artifactLint':'PENDING ROOT'}
out=O/'copy-materializer-source-independent-facts-v2.json'
with out.open('x') as f:json.dump(facts,f,indent=2);f.write('\n')
print(json.dumps({'facts':str(out),'sha256':sha(out),'errors':errors,'candidateMembers':7,'priorAuditFailure':'v1 lexical regex included docstring; call count included function declaration; coordinator ancestor index was one level short; all failed v1 artifacts preserved','destinations':607,'directories':227}));raise SystemExit(bool(errors))
