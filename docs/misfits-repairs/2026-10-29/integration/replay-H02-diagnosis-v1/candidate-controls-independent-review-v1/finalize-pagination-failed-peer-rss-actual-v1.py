"""Finalize the static evidence audit; additive files and lossless ledger append only."""
import datetime
import hashlib
import json
import pathlib

O = pathlib.Path(__file__).resolve().parent
H = O.parent
P = H / 'candidate-controls-pagination-failed-peer-source-preparation-v1'

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

facts_v1 = O / 'pagination-failed-peer-rss-actual-independent-facts-v1.json'
assert sha(facts_v1) == 'f266a2cc48993d2581e6becf23d7edb37f08bd22dfdcc3ab6150c34737c57b6d'
facts = json.loads(facts_v1.read_text())
assert facts['allAuditChecksPass'] and not facts['errors']
source = json.loads((P / 'source-freeze-v1.json').read_text())
production = {str(pathlib.Path(source['worktree']) / name) for name in source['productionFiles']}
drift = facts['currentSourcesAtIndependentAudit']['drift']
assert len(drift) == 4 and not any(item['path'] in production for item in drift)
facts['currentSourceDriftInterpretation'] = 'Four test/support source files differ at the independent audit; all511 bound production files match. Cause, timing and successor semantics of that drift are not independently audited here. Immutable source copies and saved historical before/after/separate-post identity remain intact. Current drift neither reproduces nor automatically invalidates the frozen historical result.'
facts['all511ProductionBindingsStillMatchAtAudit'] = True
facts['finalization'] = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'priorFacts': str(facts_v1), 'priorFactsSha256': sha(facts_v1), 'reason': 'Clarify that the source of current test/support drift is not independently inferred. Preserve original v1 facts and static return.', 'additionalProductModelTestNativeExecutionsOrProcessProbes': 0}
facts_path = O / 'pagination-failed-peer-rss-actual-independent-facts-v2.json'
assert not facts_path.exists()
facts_path.write_text(json.dumps(facts, indent=2) + '\n')

static_return = {
    'actualAuditCommand': '/opt/homebrew/opt/python@3.14/bin/python3.14 -I -B audit-pagination-failed-peer-rss-actual-v1.py',
    'workdir': str(O),
    'actualToolReturn': {'chunk_id': 'a77f01', 'wall_time_seconds': 0.948642292, 'exit_code': 0, 'original_token_count': 128},
    'stdoutFields': {'facts': str(facts_v1), 'factsSha256': sha(facts_v1), 'resultAssets': 13, 'resultBytes': 37846, 'sourcePacket': 105, 'currentSourceDriftCount': 4, 'uniquePackageRoots': 255, 'uniquePayloadFiles': 11974, 'errors': []},
    'auditScript': str(O / 'audit-pagination-failed-peer-rss-actual-v1.py'),
    'auditScriptSha256': sha(O / 'audit-pagination-failed-peer-rss-actual-v1.py'),
    'mode': 'Independent static filesystem/hash/source/JSON audit; no bound program imports, product/model/test/native run or process probe.',
}
static_path = O / 'pagination-failed-peer-rss-actual-independent-static-return-v1.json'
assert not static_path.exists()
static_path.write_text(json.dumps(static_return, indent=2) + '\n')

report = f'''# Independent actual qualification: primary pagination RSS stop

**Qualified as an operational resource stop only. No product RED or GREEN, assertion, reach, or mutant-rejection credit.** The immutable evidence is coherent. No blocking provenance finding was found within this audit. No rerun, bound-source edit, product/model/test execution, bound-program import, or process probe was performed by this reviewer. Slot 2 is returned after this report.

The intended primary experiment was the accepted atomic-window law on unchanged production. This attempt did not retain evidence that the intended comparison ran. It neither adds a product memory/deadline law nor changes the accepted law, model, budgets, adapter contract, or earlier finding dispositions.

## Exact invocation and immutable assets

The result freeze `6a3df64c714d54542e8c2cda8ea3b5def9b5c2ef8c35652d2e452ce5463c7d9d` and all **13 files / 37,846 bytes** match. The JSON report is absent as recorded. All seven containment-manifest members and 105 primary-source-packet members match. Root admission pins manifest `81ad3dff…`, binding `73f288a8…`, launcher `8cae808c…`, recipe `6a290c3a…`, and source freeze `cf550f0a…`.

The saved actual tool record identifies exactly one elevated invocation of the pinned Python with `-I -B launch.py --execute-exact-one 73f288a8…`: initial chunk **46d907**, session **31238**, completion **5a6619**, outer exit **1**. This is actual invocation permission `sandbox_permissions=require_escalated`, not an inference from a prior preflight. The Node/Vitest argv, candidate workdir, environment clearing, ordinary package setup, and added default/JSON reporters match the reviewed recipe. Seed 1665, eight runs, and the three schedules are the intended campaign; they are not measured completions.

## Failure chronology and cleanup

The original child PID and PGID **73353** were positively verified. After 13 samples, the failure receipt at **1,681 ms** records group RSS **1,091,452,928 bytes**, exceeding **1,073,741,824 bytes** by **17,711,104 bytes**. The three retained group rows sum exactly to that value. Their roles cannot be assigned from RSS rows because process commands were not retained. The bound supervisor checks sampled RSS before polling child exit and records the first failure before signalling cleanup.

The final receipt at **1,744 ms** records `SIGKILL` sent to the verified original PGID, child exit **−9**, no child secondary failure, and no remaining original-group rows. The outer result preserves the RSS failure as primary and missing JSON as secondary, with `report: null` and `productVerdict: UNCLASSIFIED`. The saved elevated post-return check records exit-zero `ps`, no named rows, and ESRCH for original PIDs/PGIDs 73331 and 73353. This establishes only the named observations; it does not establish an escaped/unregistered descendant census or PID/PGID reuse proof. It does not validate the different inner completion-supervisor kill path with the earlier default-sandbox EPERM limitation.

The received raw ledger summary attached RSS to 1,744 ms. The immutable records distinguish the **failure at 1,681 ms** from **final cleanup at 1,744 ms**. The raw ledger text is preserved.

## Source and tool identity

Saved wrapper-before, wrapper-after, and separate post-return identities agree: **595 sources, 84 copies, 255 unique package roots, 11,974 own payload files**, source freeze `cf550f0a…`, and the pinned Node identity. The separate postcheck reports 405 resolution edges, 112 absent optional/peer checks, no esbuild controls, and no runtime-config/test/supervisor reimport.

This independent audit rehashed the 84 copies, all package own-payload sets and hashes, the 405 edges, 112 absence checks, Node, Python, `/bin/ps`, two locks, and four dependency links. All match. All **511 production bindings** still match. **Four live test/support files now differ**: the completion baseline driver, fixture, completion oracle, and primary pagination test. Their hashes are recorded separately in the facts. Cause, timing, and successor semantics of those edits were not audited. Current drift does not replace the immutable historical positive source postcheck, and no rerun against those current files is claimed. These are disk/source/tool bindings; no V8/evaluated-source binding is claimed.

## Expo diagnostics

The complete stderr contains two `vite-tsconfig-paths` errors resolving `expo/tsconfig.base`, for the shopping-list and offline-transactions example tsconfigs, plus the experimental typecheck warning. Bound plugin `dist/index.js` SHA **78c7739176947b8e012ef3afc2e8c7c233fc21ee96a7fcf493e5178829c0ffb7** scans workspace configs at lines 61–94. Its parse catch at lines 123–137 logs these errors and **returns null**; lines 141–145 skip null projects. `firstError` is only logging state, with no rethrow or exit in this path. Stdout retains the Vitest RUN and Istanbul banners.

These are therefore **caught configuration-scan diagnostics**, not an independently established fatal Expo setup stop. This does not prove that every later setup stage succeeds. No config change, ignore flag, Expo installation, or rerun is justified by this audit.

## Product evidence and preserved limits

No selected-test JSON result, reach diagnostic, callback comparison, or intended product assertion was retained. Body execution is **unestablished**; missing logs do not prove zero body execution. Resource cutoff, missing report, and setup diagnostics cannot count as product RED, GREEN, reach, or mutant rejection. The intended generated and receiving obligations remain open.

The earlier independently qualified singleton RED remains limited to the first emitted callback: raw301/boundary286, normalized delivery302, showing rank30 with empty children while the last complete limit2 window and child peer were pending. Later raw321, `flush-throw`, and the pending operation remain contaminated follow-on evidence. All20 candidate states remain UNREACHED; actual-helper/no-active-operation is required and UNREACHED; state14 is proposed/unadopted; metadata has its separate owner. Rich full-child shared QueryClient receiving remains required before production edits. Peer-pending after failure remains a controlled premise, not a law forbidding legal retirement. The explicit test-name replay selector restriction remains.

All eight source-order categories in the received assignment are accounted for in the facts and ledger. This audit authorizes no retry, native progression, production edit, publication, or canonical import. ROOT owns the next operational allowance.

Facts: `pagination-failed-peer-rss-actual-independent-facts-v2.json` SHA **{sha(facts_path)}**.

Static audit: chunk `a77f01`, exit 0, errors `[]`; record SHA **{sha(static_path)}**. The v1 facts are preserved; v2 clarifies the scope of current drift without changing the hash observations.
'''
report_path = O / 'pagination-failed-peer-rss-actual-independent-review-v1.md'
assert not report_path.exists()
report_path.write_text(report)

ledger_path = O / 'raw-items-ledger-v1.jsonl'
prefix = ledger_path.read_bytes()
assert len(prefix.splitlines()) == 102 and hashlib.sha256(prefix).hexdigest() == '6e72a0032f89f054e5286a3de20f8edc5de8cf403a287e1e8c9f2c0c0371a224'
entry = {
    'event_id': 'H02-CAND-INDEP-PRIMARY-RSS-ACTUAL-QUALIFIED', 'item_id': 'H02-PRIMARY-INITIAL-ACTUAL',
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'technical_validity': 'Qualified operational RSS stop only; no product/assertion/reach/mutant credit; no blocking provenance finding within bounded static audit.',
    'action': 'Return slot2. No rerun, production edit, native progression or source change admitted by reviewer; ROOT chooses next operational allowance.',
    'artifact': report_path.name, 'artifact_sha256': sha(report_path),
    'facts_artifact': facts_path.name, 'facts_sha256': sha(facts_path),
    'static_return_artifact': static_path.name, 'static_return_sha256': sha(static_path),
    'result_freeze_sha256': '6a3df64c714d54542e8c2cda8ea3b5def9b5c2ef8c35652d2e452ce5463c7d9d',
    'source_order_review': facts['sourceOrderReview'],
    'correction': facts['rawTimestampCorrection'],
    'current_drift': 'Four test/support files; all511 production bindings and84 immutable copies match. Historical before/after/post positive preserved; current drift cause/timing/semantics not audited.',
    'expo': facts['expoDiagnosis']['conclusion'],
    'limits': facts['preservedLimits'],
    'new_product_model_test_native_executions_or_probes': 0,
}
with ledger_path.open('ab') as output:
    output.write((json.dumps(entry) + '\n').encode())
after = ledger_path.read_bytes()
assert after.startswith(prefix) and len(after.splitlines()) == 103
print(json.dumps({'report': str(report_path), 'reportSha256': sha(report_path), 'facts': str(facts_path), 'factsSha256': sha(facts_path), 'staticReturnSha256': sha(static_path), 'auditScriptSha256': sha(O / 'audit-pagination-failed-peer-rss-actual-v1.py'), 'ledgerRows': 103, 'ledgerSha256': sha(ledger_path), 'prefixPreserved': True, 'slot2': 'returned'}))
