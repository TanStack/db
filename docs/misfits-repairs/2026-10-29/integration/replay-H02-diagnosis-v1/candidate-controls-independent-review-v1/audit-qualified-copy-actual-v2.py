"""Independent actual-copy audit: named reads, hashes, strict JSON and physical tree inspection only."""
from pathlib import Path
import collections
import datetime
import hashlib
import json
import os
import stat

O = Path(__file__).resolve().parent
H = O.parent
C = H / 'candidate-controls-pagination-qualified-peer-materialization-source-v1'
U = H / 'candidate-controls-pagination-qualified-peer-diagnostics-source-v1'
V = H / 'candidate-controls-pagination-qualified-peer-receiving-operational-preparation-v1'
Q = H / 'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
S = H / 'candidate-controls-pagination-receiving-checkpoint-peer-diagnostics-successor-v1'
D = H / 'candidate-controls-pagination-shared-window-receiving-operational-preparation-v1'
E = H / 'candidate-controls-pagination-shared-window-failure-receiving-runtime-v1'
errors = []
checks = 0

def check(value, message):
    global checks
    checks += 1
    if not value:
        errors.append(message)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('duplicate JSON key ' + key)
        result[key] = value
    return result

def strict(data):
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))

def load(path):
    return strict(Path(path).read_bytes())

def bound(path, expected):
    check(sha(path) == expected, 'hash ' + str(path))

def ref(record):
    bound(record['path'], record['sha256'])

def fmap(root, entries):
    for name, record in entries.items():
        path = Path(root) / name
        check(stat.S_ISREG(os.lstat(path).st_mode), 'regular bound member ' + str(path))
        bound(path, record['sha256'] if isinstance(record, dict) else record)
        if isinstance(record, dict) and 'bytes' in record:
            check(path.stat().st_size == record['bytes'], 'bytes ' + str(path))

def packet(root, expected, count, closure=True):
    bound(root / 'packet-manifest-v1.json', expected)
    manifest = load(root / 'packet-manifest-v1.json')
    check(len(manifest['files']) == count, 'packet count ' + str(root))
    fmap(root, manifest['files'])
    if closure:
        files = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
        check(files == set(manifest['files']) | {'packet-manifest-v1.json'}, 'packet closure ' + str(root))
        check(not any(p.is_symlink() for p in root.rglob('*')), 'no packet symlinks ' + str(root))
    return manifest

def identity(path):
    st = os.lstat(path)
    return {'device': st.st_dev, 'inode': st.st_ino, 'mode': oct(stat.S_IMODE(st.st_mode)),
            'size': st.st_size, 'mtimeNs': st.st_mtime_ns}

def write_json(path, data):
    with Path(path).open('x') as stream:
        json.dump(data, stream, indent=2, sort_keys=True)
        stream.write('\n')

ledger = O / 'raw-items-ledger-v1.jsonl'
ledger_bytes = ledger.read_bytes()
check(len(ledger_bytes.splitlines()) == 130, '130-row ledger prefix')
check(hashlib.sha256(ledger_bytes).hexdigest() == 'c711b61b10c0e27161b41aeccf42effd3ebcb8ca2c76afe90f61ef2ae8f4d04f', 'ledger prefix hash')
for line in ledger_bytes.splitlines():
    strict(line)

cm = packet(C, '9abbc7da757afc7ce98b60f1b07a3ed70f851875efff27e729efdd1b0b2bb298', 7)
packet(U, 'bc7c1ad1828d056fcf57aac1fdf6038bbc9a564d622cff75c262b9e8a1d97ca0', 90)
packet(V, 'd9cfd4cf3abbc8b1b41d148067eced85af9c8711907bd051aba1a41aff5e26a5', 14)
packet(S, 'a56541c3188c6a8348aa1187575e0192410dc3e8d86d1a9697628dc4a9312d25', 120)
dm = packet(D, 'b392686f0a401be65ca4c364efe54310e4ec454204f59f18859b7883cd0d6403', 21, False)
bound(E / 'result-freeze-v1.json', '5dd02625d22a6f096470737b3d09a447cf89c985d91f819e5e30cdda5c5e7b8a')
em = load(E / 'result-freeze-v1.json')
check(len(em['files']) == 1996, 'E1996 sealed members')
fmap(E, em['files'])
relocations = {r['from']: r['to'] for r in load(Q / 'artifact-snapshot-relocation-v1/path-map-v1.json')['relocations']}
for name, count, mapping in [('packet-sha256-v1.json', 126, relocations),
                             ('packet-sha256-with-snapshot-relocation-v2.json', 133, {})]:
    manifest = load(Q / name)
    check(len(manifest) == count, 'Q historical map count ' + name)
    fmap(Q, {mapping.get(key, key): value for key, value in manifest.items()})

# D has a sealed 21-member source packet plus the already classified spent admission
# and 13 runtime originals. These additions do not rewrite D's historical closure.
raw_copy = load(E / 'raw-copy-verification-v1.json')
d_runtime = [r for r in raw_copy['copies'] if Path(r['origin']).is_relative_to(D)]
check(len(d_runtime) == 13, 'D13 originals bound by E')
for record in d_runtime:
    bound(record['origin'], record['sha256'])
    bound(record['copy'], record['sha256'])
    check(Path(record['origin']).stat().st_size == record['bytes'], 'D runtime bytes')
d_admission = D / 'root-exact-one-failure-receiving-admission-v1.json'
bound(d_admission, '61d6c5fee04057a468647bc392127d43f5f092708e287aa3b43cd932be439769')
d_extras = {str(p.relative_to(D)) for p in D.rglob('*') if p.is_file()} - set(dm['files']) - {'packet-manifest-v1.json'}
check(d_extras == {str(d_admission.relative_to(D))} | {str(Path(r['origin']).relative_to(D)) for r in d_runtime}, 'D14 known additions only')

contract = load(C / 'copy-only-contract-v1.json')
geometry = load(C / 'explicit-copy-geometry-v1.json')
proposal = load(C / 'proposed-exact-copy-only-tool-invocation-v1.json')
admission_path = H / 'candidate-controls-pagination-qualified-peer-materialization-root-admission-v1.json'
bound(admission_path, 'b57fdf26f2268604beed0def6fe4bf6984da5fb6e4e8ae8522c67f80bc9539c7')
admission = load(admission_path)
for name, expected in admission['pins'].items():
    bound(C / name, expected)
ref(admission['review'])
check(admission['admittedMaterialization'] and admission['maxInvocations'] == 1, 'one-shot copy admission')
check(admission['exactToolArguments'] == proposal['arguments'], 'admitted exact tool arguments equal proposal')
for record in [contract['materializer'], contract['geometry'], contract['binding'], contract['plan'],
               contract['finiteToolInputs'], *contract['sourceReviews'], *contract['packets'], *contract['lockInputs']]:
    ref(record)
plan = load(contract['plan']['path'])
binding = load(contract['binding']['path'])
u = load(U / 'source-freeze-v1.json')
q = load(Q / 'source-freeze-v1.json')
W = Path(u['acceptedActiveWorktree'])
check(len(q['sourceBindings']) == 596 and len(q['sourceCopies']) == 85 and len(q['productionFiles']) == 511, 'protected W596 Q85 production511')
fmap(W, q['sourceBindings'])
fmap(q['sourceCopyRoot'], q['sourceCopies'])
fmap(W, q['productionFiles'])
check(binding['sourceBindings'] == u['proposedSourceBindings'], 'qualified proposed source binding maps equal')
check(q['sourceBindings'] == u['acceptedActiveSourceBindingsUnchanged'] and q['sourceCopies'] == u['acceptedSourceCopiesUnchanged'] and q['productionFiles'] == u['acceptedProductionFilesUnchanged'], 'protected accepted maps unchanged')
check(len(binding['sourceBindings']) == 596 and len(binding['productionFiles']) == 511, 'actual qualified 596 and production511')

regulars = plan['regularCodeAndLockFiles'] + plan['regularControlFiles']
links = plan['dependencyReuseSymlinks']
root = Path(plan['proposedRoot'])
root_before = identity(root)
root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
check(os.path.samestat(os.fstat(root_fd), os.lstat(root)), 'root FD equals named root before')
targets = [r['runtimePath'] for r in regulars + links]
expected_dirs = {str(root)}
for target in targets:
    path = Path(target)
    check(path.is_absolute() and str(path) == os.path.normpath(path) and path.is_relative_to(root), 'destination contained ' + target)
    expected_dirs.update(str(p) for p in path.parents if p == root or p.is_relative_to(root))
check(len(regulars) == 603 and len(links) == 4 and len(set(targets)) == 607 and len(expected_dirs) == 227, '603regular 4links 607destinations 227directories')
check(geometry['destinations'] == sorted(targets) and set(geometry['directories']) == expected_dirs, 'actual geometry bound')

inventory = []
def inspect(path):
    st = os.lstat(path)
    item = {'path': str(path), 'relativePath': str(path.relative_to(root)), **identity(path)}
    if stat.S_ISLNK(st.st_mode):
        item.update(kind='symlink', target=os.readlink(path), resolved=str(path.resolve()))
    elif stat.S_ISDIR(st.st_mode):
        item['kind'] = 'directory'
    elif stat.S_ISREG(st.st_mode):
        item.update(kind='regular', sha256=sha(path))
    else:
        item['kind'] = 'other'
    inventory.append(item)
    if item['kind'] == 'directory':
        for child in sorted(path.iterdir()):
            inspect(child)

inspect(root)
actual_regulars = {r['path']: r for r in inventory if r['kind'] == 'regular'}
actual_links = {r['path']: r for r in inventory if r['kind'] == 'symlink'}
actual_dirs = {r['path']: r for r in inventory if r['kind'] == 'directory'}
check(not any(r['kind'] == 'other' for r in inventory), 'no unexpected physical types')
check(set(actual_regulars) == {r['runtimePath'] for r in regulars}, 'exact physical603 regular closure')
check(set(actual_links) == {r['runtimePath'] for r in links}, 'exact physical4 link closure')
check(set(actual_dirs) == expected_dirs, 'exact physical227 directory closure')
for item in actual_dirs.values():
    check(item['mode'] == '0o700', 'directory mode0700 ' + item['path'])
for record in regulars:
    path = record['runtimePath']
    item = actual_regulars[path]
    check(item['mode'] == '0o600', 'copied mode0600 ' + path)
    bound(record['from'], record['fromSha256'])
    check(stat.S_ISREG(os.lstat(record['from']).st_mode), 'origin regular ' + record['from'])
    check(item['sha256'] == record['fromSha256'] and item['size'] == Path(record['from']).stat().st_size, 'actual copied bytes ' + path)
for record in links:
    item = actual_links[record['runtimePath']]
    check(item['target'] == record['target'] and item['resolved'] == record['target'] and Path(record['target']).is_dir(), 'exact link target identity ' + record['runtimePath'])
fmap(plan['proposedCodeRoot'], binding['sourceBindings'])
for name, record in binding['dependencyReuseLinks'].items():
    path = Path(plan['proposedCodeRoot']) / name
    check(path.is_symlink() and str(path.resolve()) == record['resolved'], 'four binding reuse identities ' + name)

receipt = Path(contract['receiptRoot'])
stdout = receipt / 'stdout.jsonl'
stderr = receipt / 'stderr.log'
raw = stdout.read_bytes()
err = stderr.read_bytes()
check(raw.endswith(b'\n') and b'\r' not in raw, 'complete LF JSONL stream')
records = [strict(line) for line in raw.splitlines()]
expected_records = [
    {'event': 'start', 'contract': {'path': str(C / 'copy-only-contract-v1.json'), 'sha256': sha(C / 'copy-only-contract-v1.json')}, 'materializer': contract['materializer']},
    {'event': 'preflight-passed', 'codeAndLock': 597, 'controls': 6, 'directories': 227, 'finiteOwnPayloads': 11974, 'finiteToolRoots': 255, 'links': 4, 'sourceBindings': 596},
    {'event': 'created-directory', 'path': str(root)},
]
expected_records += [{'event': 'created-directory', 'path': p} for p in sorted(expected_dirs - {str(root)}, key=lambda p: (p.count(os.sep), p))]
expected_records += [{'event': 'copied-regular', 'path': r['runtimePath'], 'sha256': r['fromSha256'], 'bytes': Path(r['from']).stat().st_size} for r in regulars]
expected_records += [{'event': 'created-link', 'path': r['runtimePath'], 'target': r['target']} for r in links]
expected_records += [{'event': 'copy-verified', 'regularCodeAndLock': 597, 'controls': 6, 'links': 4, 'directories': 227, 'compilerInvocations': 0, 'nativeInvocations': 0, 'executionAuthority': False}]
check(records == expected_records, 'all837 exact ordered receipt objects')
check(len(records) == 837 and len(raw) == 173354 and sha(stdout) == 'a448255c72105bc6b8d26918f036e0731d7150f7127a077ff2e93e0a2666f4b1', 'bound complete persistent stdout')
check(err == b'', 'empty persistent stderr')
check({p.name for p in receipt.iterdir()} == {'stdout.jsonl', 'stderr.log'}, 'exact receipt closure')
check(identity(receipt)['mode'] == '0o700', 'receipt directory0700')
check(all(stat.S_ISREG(os.lstat(p).st_mode) and identity(p)['mode'] == '0o644' for p in [stdout, stderr]), 'actual receipt regular modes0644 inside0700')
for output in contract['receivingOutputRoots']:
    check(not os.path.lexists(output), 'receiving output remains absent ' + output)

initial_path = H / 'candidate-controls-pagination-qualified-peer-materialization-actual-initial-tool-v1.json'
final_path = H / 'candidate-controls-pagination-qualified-peer-materialization-actual-final-tool-v1.json'
initial = load(initial_path)['response']
final = load(final_path)['response']
check(initial['chunk_id'] == 'e63808' and initial['session_id'] == 46686 and 'exit_code' not in initial, 'actual initial chunk/session metadata')
check(final['chunk_id'] == '97749a' and final['exit_code'] == 0 and 'session_id' not in final, 'actual final exit0 metadata')
check(initial['original_token_count'] == 25558 and final['original_token_count'] == 17781, 'actual response token counts')
check(all('truncated' in response['output'] for response in [initial, final]), 'API output truncation explicitly retained')

bound(contract['python']['path'], contract['python']['sha256'])
check(str(Path(contract['python']['path']).resolve()) == contract['python']['resolved'], 'Python binary resolution')
ref(proposal['shell'])
bound(binding['node']['executable'], binding['node']['sha256'])
supp = load(contract['finiteToolInputs']['path'])
seen = set()
payloads = 0
for record in list(binding['packages'].values()) + supp['packages']:
    base = Path(record['resolved'])
    if str(base) in seen:
        continue
    seen.add(str(base))
    own = set()
    for directory, dirs, files in os.walk(base, followlinks=False):
        dirs[:] = [n for n in dirs if n != 'node_modules' and not (Path(directory) / n).is_symlink()]
        for name in files:
            path = Path(directory) / name
            if path.is_file() and not path.is_symlink():
                own.add(str(path.relative_to(base)))
    check(own == set(record['regularPayloadFilesMap']), 'named tool own payload closure ' + str(base))
    fmap(base, record['regularPayloadFilesMap'])
    payloads += len(record['regularPayloadFilesMap'])
check((len(seen), payloads) == (255, 11974), 'finite named255 roots11974 own payloads')
check(len(supp['resolutionEdges']) == 405 and len(supp['uninstalledDeclaredOptionalOrPeerDependencies']) == 112, 'finite named405 edges112 absences')
for record in supp['resolutionEdges']:
    check(str(Path(record['logical']).resolve()) == record['resolved'], 'named tool resolution edge')
for record in supp['uninstalledDeclaredOptionalOrPeerDependencies']:
    base = Path(record['from'])
    check(not any(os.path.lexists(p / 'node_modules' / record['dependency']) for p in [base, *base.parents]), 'named absent optional/peer')

# Recheck current tree and stream identity after the audit reads. This is a bounded
# after-state comparison, not a process census or a proof of race freedom.
for item in inventory:
    check(identity(item['path']) == {k: item[k] for k in ['device', 'inode', 'mode', 'size', 'mtimeNs']}, 'stable physical identity ' + item['path'])
    if item['kind'] == 'regular':
        bound(item['path'], item['sha256'])
    elif item['kind'] == 'symlink':
        check(os.readlink(item['path']) == item['target'] and str(Path(item['path']).resolve()) == item['resolved'], 'stable actual link')
check(root_before == identity(root) and os.path.samestat(os.fstat(root_fd), os.lstat(root)), 'root identity stable after')
os.close(root_fd)
check(raw == stdout.read_bytes() and err == stderr.read_bytes(), 'persistent streams unchanged during audit')
check(ledger_bytes == ledger.read_bytes(), 'ledger prefix unchanged during audit')

snapshot = O / 'qualified-copy-actual-evidence-snapshot-v1'
snapshot.mkdir(mode=0o700)
snapshot_sources = {'root-admission.json': admission_path, 'actual-initial-tool.json': initial_path,
                    'actual-final-tool.json': final_path, 'persistent-stdout.jsonl': stdout,
                    'persistent-stderr.log': stderr}
snapshot_bindings = []
for name, origin in snapshot_sources.items():
    destination = snapshot / name
    data = origin.read_bytes()
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
    check(data == destination.read_bytes(), 'byte-exact evidence snapshot ' + name)
    snapshot_bindings.append({'origin': str(origin), 'copy': str(destination), 'bytes': len(data), 'sha256': sha(destination)})

inventory_path = O / 'qualified-copy-actual-physical-inventory-v1.json'
write_json(inventory_path, {'schema': 'h02-independent-actual-copy-inventory-v1', 'root': str(root),
                          'rootBefore': root_before, 'rootAfter': identity(root), 'members': inventory})
facts = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': __doc__,
    'checks': checks, 'allAuditChecksPass': not errors, 'errors': errors,
    'actualCopyRoot': str(root), 'actualRegulars': len(actual_regulars), 'actualLinks': len(actual_links),
    'actualDirectories': len(actual_dirs), 'regularModes': sorted({r['mode'] for r in actual_regulars.values()}),
    'directoryModes': sorted({r['mode'] for r in actual_dirs.values()}), 'symlinkModes': sorted({r['mode'] for r in actual_links.values()}),
    'receiptRecords': len(records), 'receiptCounts': dict(collections.Counter(r['event'] for r in records)),
    'receiptExactOrderedPlanMatch': records == expected_records,
    'persistentStdoutBytes': len(raw), 'persistentStdoutSha256': sha(stdout), 'persistentStderrBytes': len(err),
    'receiptFileModes': {p.name: identity(p)['mode'] for p in [stdout, stderr]},
    'actualInitial': {k: v for k, v in initial.items() if k != 'output'},
    'actualFinal': {k: v for k, v in final.items() if k != 'output'},
    'apiOutputsTruncated': True,
    'inputProvenanceLimit': 'Saved API records are responses and do not independently echo all input argv. Exact-input provenance is ROOT admission/dispatch plus pinned source-bound persistent receipt and independently matching physical copies.',
    'beforeAfterLimit': 'Prior independent source audit bound pre-copy named maps; pinned actual source declares preflight and final input checks. This independent audit rehashes current-after protected W596/Q85 and sealed ancestors, origins, actual copies and finite tool inputs. No continuous monitoring or universal process census.',
    'protectedWBindings': 596, 'protectedQCopies': 85, 'productionBindings': 511,
    'sealedMembers': {'C': 7, 'U': 90, 'V': 14, 'S': 120, 'D': 21, 'E': 1996, 'QHistoricalRelocated': 126, 'QLiteral': 133},
    'DPostFreezeKnownAdditions': 14, 'DOriginalRuntimeFilesVerified': 13,
    'namedPackageRoots': len(seen), 'namedOwnPayloads': payloads, 'namedResolutionEdges': 405, 'namedOptionalPeerAbsences': 112,
    'admissionSha256': sha(admission_path), 'candidateManifestSha256': sha(C / 'packet-manifest-v1.json'),
    'priorSourceReviewSha256': sha(O / 'copy-materializer-source-independent-review-v1.md'),
    'priorSourceFactsSha256': sha(O / 'copy-materializer-source-independent-facts-v2.json'),
    'inventory': {'path': str(inventory_path), 'sha256': sha(inventory_path)}, 'evidenceSnapshots': snapshot_bindings,
    'ledgerPrefixRows': 130, 'ledgerPrefixSha256': hashlib.sha256(ledger_bytes).hexdigest(),
    'candidateReruns': 0, 'candidateImports': 0, 'candidateSyntaxCompiles': 0, 'compilerInvocationsByReviewer': 0,
    'nativeReceivingByReviewer': 0, 'processProbesByReviewer': 0, 'boundSourceEdits': 0,
    'verdict': 'Actual copy accepted for separate compiler-containment preparation and review only' if not errors else 'Actual copy review failed; no successor authority',
    'compilerOrNativeAdmission': False, 'productRedGreenCredit': False, 'canonicalImport': False,
    'preservedLimits': ['all20 candidate states UNREACHED', 'state14 proposed/unadopted', 'actual-helper/no-active-public-operation UNREACHED', 'metadata separate', 'real failure/success receiving pair and settlement/retry open', 'historical E raw302/315 UNCLASSIFIED; raw322 positive cleanup retained', 'no unconditional receipt/terminal fidelity for broken sinks'],
    'artifactLint': 'PENDING ROOT',
}
facts_path = O / 'qualified-copy-actual-independent-facts-v2.json'
write_json(facts_path, facts)
print(json.dumps({'facts': str(facts_path), 'sha256': sha(facts_path), 'checks': checks, 'errors': errors,
                  'inventorySha256': sha(inventory_path), 'snapshotFiles': len(snapshot_bindings),
                  'verdict': facts['verdict']}))
raise SystemExit(bool(errors))
