"""Supplementary saved-source audit only; no native imports or process probes."""
import hashlib,json,pathlib
R=pathlib.Path(__file__).resolve().parent
H=R.parent
P=H/'metadata-update-source-v2'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text())
def require(c,n):
 if not c: raise AssertionError(n)
freeze=read(P/'source-freeze.json')
require(sha(P/'source-freeze.json')=='4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a','prior source pin')
require(sha(P/'source-inventory.json')==freeze['sourceInventorySha256']=='c5cdea6b41d82b331435162ea06b9254be96acff7b7450be79e0c37690cb74b2','prior inventory pin')
inventory=read(P/'source-inventory.json')
require(len(inventory)==588,'588 prior source members')
for n,d in inventory.items(): require(sha(P/'sources'/n)==d,'prior member '+n)
for n,r in read(P/'packet-manifest.json')['artifacts'].items():
 p=P/n;require(sha(p)==r['sha256'] and p.stat().st_size==r['bytes'],'prior packet '+n)
require(sha(R/'metadata-fixed-campaign-actual-independent-audit-v2.json')=='c6ad440b7aa68e85556f4c244ae4b56b3ffa3709416b16ac173d73951e161f39','main audit pin')
result={'status':'PRIOR FAILED V2 SOURCE PRESERVED','sourceFilesRehashed':588,'sourceFreezeSha256':sha(P/'source-freeze.json'),'sourceInventorySha256':sha(P/'source-inventory.json'),'mainAuditSha256':sha(R/'metadata-fixed-campaign-actual-independent-audit-v2.json'),'scriptSha256':sha(pathlib.Path(__file__)),'qualification':'Main audit independently rehashed prior result and exact original/preserved raw files. This supplement rehashes all588 source members and packet members. Prior recorder missing retained followup boundaries remains a failed observation instrument, not a product RED.','nativeLaunches':0,'processProbes':0}
p=R/'metadata-fixed-campaign-prior-failure-preservation-audit-v1.json';require(not p.exists(),'additive output unused');p.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n');print(json.dumps({'status':result['status'],'scriptSha256':result['scriptSha256'],'auditSha256':sha(p)}))
