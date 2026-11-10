"""Additive static byte/hash audit only; no product/model/test imports or execution."""
import datetime,hashlib,json,pathlib
O=pathlib.Path(__file__).resolve().parent
H=O.parent
Q=H/'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
R=H.parents[1]/'coordinator-validation-after-shim-recovery-v1'
errors=[]
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(pathlib.Path(p).read_text())
def check(ok,label):
 if not ok:errors.append(label)
known={'source-freeze-v1.json':'f85b261b1733c5581c0f8af8fbdff824b189b9b4517fda6b4cf397c1d2c8b193','packet-sha256-v1.json':'f64dae8f38429d6d5f6358fa2295c1b91b48f92a5f0ebdaae29b3153939628ef','report-v1.md':'c8ab425db65bbdef057a1456fb5d39bcea3991190b5469435d0d778cd2c869a0','report-erratum-v1.md':'1702c0b59c8045052e907c45df64e70beb20ffe70e32b9df2e13256f497ce835','artifact-snapshot-relocation-v1/path-map-v1.json':'2be52168ecf9ed3c12aa6eb738e632c1abafaf363a73f5dcac0236eefe2d723e','packet-sha256-with-snapshot-relocation-v2.json':'e36b9780ca9891cbc25233618117e121619bca1c2b0aa29974fb9ffcc80d7462'}
for n,d in known.items():check(digest(Q/n)==d,'known '+n)
m=load(Q/'artifact-snapshot-relocation-v1/path-map-v1.json');rows=m['relocations']
expected={'from':'before/packages/db/tests/query/pagination-oracle.property.test.ts','to':'before/packages/db/tests/query/pagination-oracle.property.test.ts.txt','sha256':'6f26a439c6bcf949364e6c32c238a72b98d1d29d929c355622e32232c56e4f32','bytes':230217}
check(len(rows)==1 and all(rows[0][k]==v for k,v in expected.items()),'exact sole relocation')
row=rows[0];check(not (Q/row['from']).exists(),'old exact path absent')
check(digest(Q/row['to'])==row['sha256'] and (Q/row['to']).stat().st_size==row['bytes'],'relocated bytes unchanged')
old=load(Q/'packet-sha256-v1.json');new=load(Q/'packet-sha256-with-snapshot-relocation-v2.json')
check(len(old)==126 and len(new)==133,'old126 current133')
for n,d in old.items():
 target=row['to'] if n==row['from'] else n
 check(digest(Q/target)==d,'mapped old126 '+n)
 check(new.get(target)==d,'preserved old entry '+n)
for n,d in new.items():check(digest(Q/n)==d,'current133 '+n)
f=load(Q/'source-freeze-v1.json');w=pathlib.Path(f['worktree'])
for n,d in f['sourceBindings'].items():check(digest(w/n)==d,'live source '+n)
for n,d in f['sourceCopies'].items():check(digest(pathlib.Path(f['sourceCopyRoot'])/n)==d,'immutable copy '+n)
check(len(f['sourceBindings'])==596 and len(f['sourceCopies'])==85 and len(f['productionFiles'])==511,'source counts596/85/511')
erratum=(Q/'report-erratum-v1.md').read_text()
check('body execution UNESTABLISHED' in erratum and 'does not establish zero body execution' in erratum and 'no product RED/GREEN or reach credit' in erratum,'exact wording correction retained')
account=R/'validation-account-v1.json';check(digest(account)=='f9b32bf4d346b6778c94284cfae13ebf235a140bb666fb05a7868d6117d76c76','root lint account identity')
a=load(account)
check(a['first']['exit']==1 and a['second']['exit']==0 and a['second']['initial']=='d5af1a' and a['second']['session']==90690 and a['second']['final']=='74ba81','saved root exact lint result')
for version,key in [('v1','first'),('v2','second')]:check(digest(R/('exact-pnpm-lint-changed-'+version+'.log'))==a[key]['logSha256'],'saved lint log '+version)
log1=(R/'exact-pnpm-lint-changed-v1.log').read_text();log2=(R/'exact-pnpm-lint-changed-v2.log').read_text()
finding_lines=[line for line in log1.splitlines() if '(oracle/no-unit-test)' in line]
check(len(finding_lines)==33 and all(line.startswith('docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/candidate-controls-pagination-failed-peer-shared-receiving-successor-v1/before/packages/db/tests/query/pagination-oracle.property.test.ts:') for line in finding_lines),'exact first33 historical findings')
check('oracle/no-unit-test' not in log2,'second lint has no oracle finding')
ledger=O/'raw-items-ledger-v1.jsonl';data=ledger.read_bytes()
check(digest(ledger)=='7562e500c2afeb8d04f8e83ec96153bde509f17a91854872a9160cfc142e994c' and len(data.splitlines())==104,'original104 ledger prefix')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':__doc__,'knownQ':known,'historicalEntriesRehashedThroughExactMap':len(old),'currentPacketEntriesRehashed':len(new),'liveSourceBindingsUnchanged':len(f['sourceBindings']),'immutableCopiesUnchanged':len(f['sourceCopies']),'unchangedProductionCount':len(f['productionFiles']),'relocation':row,'reportWordingFinding':{'id':'H02-Q-REPORT-BODY-OVERCLAIM','status':'already-fixed','technicalValidity':'Original before-the-body claim overstates retained evidence; additive erratum corrects it.','durableValue':'Missing selected reports do not prove zero body execution; operational stops earn no product/reach credit.'},'priorSupplementReviewerCorrection':{'actual':'63c5d8 exit1','factsSha256':'df81dcbca22f760850de53b80203852001d40de63f58ea3090e8442622890bf9','reason':'v1 expected an ESLint formatter phrase; saved report uses agent-feedback text. v2 counts exact rule-bearing lines and requires every historical backup prefix. No bound source changed.'},'savedRootLint':{'account':str(account),'accountSha256':digest(account),'first':a['first'],'second':a['second'],'command':a['command'],'independentlyReexecuted':False},'ledgerPrefix':{'rows':104,'sha256':digest(ledger),'bytes':len(data)},'allAuditChecksPass':not errors,'errors':errors,'productExecutions':0,'modelExecutions':0,'testExecutions':0,'nativeRunInvocations':0,'boundProgramImports':0,'processProbes':0,'slot2':'returned; not consumed'}
p=O/'shared-window-receiving-source-supplement-independent-facts-v2.json';p.write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps({'facts':str(p),'sha256':digest(p),'old':len(old),'current':len(new),'sources':len(f['sourceBindings']),'errors':errors}))
raise SystemExit(bool(errors))
