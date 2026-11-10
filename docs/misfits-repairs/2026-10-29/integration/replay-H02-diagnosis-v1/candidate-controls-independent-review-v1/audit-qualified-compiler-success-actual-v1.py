"""Independent actual compiler evidence audit; named finite reads/hashes only, no process/runtime action or new census."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import stat

O = Path(__file__).resolve().parent
H = O.parent
K = H / 'candidate-controls-pagination-qualified-peer-compiler-containment-source-v3'
K1 = H / 'candidate-controls-pagination-qualified-peer-compiler-containment-source-v2'
R = H / 'candidate-controls-pagination-qualified-peer-compiler-receipt-v2'
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

def write(path, data):
    with Path(path).open('x') as stream:
        json.dump(data, stream, indent=2, sort_keys=True)
        stream.write('\n')

bound(K / 'packet-manifest-v1.json', 'e3a83211c047b37e6162a95f7a7b806a9f9dd562253377c5d0cdeb35a58e18a0')
manifest = load(K / 'packet-manifest-v1.json')
check(len(manifest['files']) == 10, 'ten sealed v3 source members')
for name, record in manifest['files'].items():
    bound(K / name, record['sha256'])
    check((K / name).stat().st_size == record['bytes'], 'source member bytes')
original = (K1 / 'contain-compiler-v1.py.txt').read_bytes()
actual_source = (K / 'contain-compiler-v1.py.txt').read_bytes()
addition1 = b'    compiler_supplement = load(c["compilerInputSupplement"])\n    extra_inputs = compiler_supplement["files"] + compiler_supplement["packageMetadata"]\n    for item in extra_inputs:\n        path, expected = item["path"], item["sha256"]\n        require(path not in inputs or inputs[path] == expected, "conflicting fixed compiler input")\n        inputs[path] = expected\n\n'
addition2 = b'        for item in extra_inputs:\n            require(os.path.realpath(item["path"]) == item["resolved"], "fixed compiler input resolution")\n'
restored = actual_source.replace(addition1, b'', 1).replace(addition2, b'', 1)
restored = restored.replace(b', c["compilerInputSupplement"]', b'', 1).replace(b', *compiler_supplement["originEvidence"]', b'', 1)
check(restored == original, 'exact fixed-input-only delta restores complete sealed v2 source')
check(b'stop_lock = threading.RLock()' in actual_source and b'require(expected is not None and sha(line) == expected' in actual_source, 'RLock and strict unknown-input comparison unchanged')

c = load(K / 'compiler-containment-contract-v1.json')
tool = load(K / 'proposed-exact-compiler-only-tool-invocation-v1.json')
admission_path = K / 'root-independent-delta-and-compiler-admission-v1.json'
admission = load(admission_path)
check(admission['maxInvocations'] == 1 and admission['acceptedBy'] == '/root', 'ROOT one-shot compiler decision')
check(admission['wrapperSha256'] == sha(K / 'contain-compiler-v1.py.txt') and admission['contractSha256'] == sha(K / 'compiler-containment-contract-v1.json') and admission['toolProposalSha256'] == sha(K / 'proposed-exact-compiler-only-tool-invocation-v1.json'), 'admitted exact v2 pins')
copy_acceptance_path = H / 'candidate-controls-pagination-qualified-peer-materialization-root-actual-acceptance-v1.json'
copy_acceptance = load(copy_acceptance_path)
for record in [c['wrapper'], c['python'], c['gate'], c['binding'], c['plan'], c['geometry'], c['finiteToolInputs'], c['compilerInputSupplement'], c['ps'], *c['copyReceipts'], *c['sourcePacketRefs'], tool['shell']]:
    ref(record)
source_extras = {'root-independent-delta-and-compiler-admission-v1.json', 'root-actual-compiler-initial-tool-v1.json', 'root-actual-compiler-final-tool-v1.json'}
check({p.name for p in K.iterdir()} == set(manifest['files']) | {'packet-manifest-v1.json'} | source_extras, 'ten sealed members plus three ROOT actual records only')
binding = load(c['binding']['path'])
plan = load(c['plan']['path'])
supp = load(c['finiteToolInputs']['path'])
gate = load(c['gate']['path'])
check(c['command'] == gate['command'] == tool['childCommandExactlyV'], 'actual source preserves exact V compiler command')

receipt_names = {'child.json', 'cleanup-final.json', 'compiler.stderr.log', 'compiler.stdout.log',
                 'identity-after.json', 'identity-before.json', 'outcome.json', 'outer.stderr.log', 'outer.stdout.jsonl', 'resolved-compiler-inputs.json'}
check({p.name for p in R.iterdir()} == receipt_names, 'exact ten-file successful receipt with runtime-produced resolved-input manifest')
check(stat.S_ISDIR(os.lstat(R).st_mode) and stat.S_IMODE(os.lstat(R).st_mode) == 0o700, 'receipt directory0700')
receipt_bytes = {}
receipt_bindings = {}
for name in sorted(receipt_names):
    path = R / name
    st = os.lstat(path)
    check(stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o644, 'ordinary exclusive receipt file0644 ' + name)
    receipt_bytes[name] = path.read_bytes()
    receipt_bindings[name] = {'bytes': len(receipt_bytes[name]), 'sha256': sha(path), 'mode': oct(stat.S_IMODE(st.st_mode))}
    check(not receipt_bytes[name] or receipt_bytes[name].endswith(b'\n'), 'complete final LF ' + name)
    if name.endswith('.json'):
        strict(receipt_bytes[name])
child = load(R / 'child.json')
cleanup = load(R / 'cleanup-final.json')
outcome = load(R / 'outcome.json')
before = load(R / 'identity-before.json')
after = load(R / 'identity-after.json')
check(child == {'pid': 30153, 'originalPgid': 30153, 'newSession': True, 'command': c['command']}, 'exact child identity and compiler argv')
check(before == after == {'matched': True, 'finiteInputCount': 12586}, 'recorded matched12586 before/after')
check(cleanup == {'originalPgid': 30153, 'rows': [], 'trigger': [], 'stopErrors': [], 'childReturnCode': 0}, 'positive final original-group absence and child0')
check(outcome == {'compilerCode': 0, 'remainingOwnedRows': [], 'trigger': [], 'staticGatePassed': True, 'nativeAuthority': False}, 'exact successful gate outcome remains distinct from child0')
events = [strict(line) for line in receipt_bytes['outer.stdout.jsonl'].splitlines()]
check(len(events) == 13 and events[0] == {'event': 'compiler-preflight', 'command': c['command'], 'wrapperPid': 30151, 'limits': c['limits']}, 'preflight and complete13-event stream')
check(events[-1] == {'event': 'compiler-gate-passed', 'compilerCode': 0, 'nativeAuthority': False}, 'successful compiler-only terminal event retained')
samples = events[1:-1]
check(len(samples) == 11 and all(e['event'] == 'owned-resource' for e in samples), 'eleven resource samples')
check([e['elapsedMs'] for e in samples] == sorted(e['elapsedMs'] for e in samples), 'monotone sampled elapsed times')
for event in samples:
    check(event['elapsedMs'] < c['limits']['compilerWallMs'], 'sample before wall cutoff')
    for row in event['rows']:
        check(row['pid'] > 0 and row['pgid'] == child['originalPgid'] and row['rssBytes'] >= 0, 'only owned-group sample rows')
        fields = [int(x) for x in row['raw'].split()]
        check(fields == [row['pid'], row['pgid'], row['rssBytes'] // 1024], 'raw process row agrees with retained sample')
peak = max(sum(r['rssBytes'] for r in e['rows']) for e in samples)
check(peak == 634732544 and peak < c['limits']['groupRssBytes'], 'sampled peak634732544 below2GiB; not a continuous RSS bound')

initial_path = K / 'root-actual-compiler-initial-tool-v1.json'
final_path = K / 'root-actual-compiler-final-tool-v1.json'
initial, final = load(initial_path), load(final_path)
check(initial == {'chunk_id': 'a64e48', 'wall_time_seconds': 1.003650791, 'session_id': 78242, 'original_token_count': 237, 'output': initial['output']}, 'actual initial response/session')
check(final['chunk_id'] == 'af83ec' and final['exit_code'] == 0 and final['original_token_count'] == 365, 'actual outer0 final metadata')
raw_outer_lines = receipt_bytes['outer.stdout.jsonl'].splitlines(keepends=True)
expected_api_output = b''.join(raw_outer_lines[:-1]) + receipt_bytes['outer.stderr.log'] + raw_outer_lines[-1]
check((initial['output'] + final['output']).encode() == expected_api_output, 'complete API merged outer display agrees with separately retained raw streams')
check(b'truncated' not in expected_api_output.lower(), 'no API truncation marker for this actual outer result')

inputs = {r['runtimePath']: r['fromSha256'] for r in plan['regularCodeAndLockFiles'] + plan['regularControlFiles']}
inputs[binding['node']['executable']] = binding['node']['sha256']
inputs[c['ps']['path']] = c['ps']['sha256']
inputs[binding['worktree'] + '/node_modules/.pnpm/lock.yaml'] = binding['lockfiles']['installedPnpmLock']
roots = set()
for package in list(binding['packages'].values()) + supp['packages']:
    roots.add(package['resolved'])
    for name, expected in package['regularPayloadFilesMap'].items():
        path = package['resolved'] + '/' + name
        check(path not in inputs or inputs[path] == expected, 'finite input map conflict')
        inputs[path] = expected
compiler_supplement = load(c['compilerInputSupplement']['path'])
check(len(compiler_supplement['files']) == 3 and len(compiler_supplement['packageMetadata']) == 3, 'exact three fixed declarations and three metadata files')
for record in compiler_supplement['originEvidence']:
    ref(record)
for record in compiler_supplement['files'] + compiler_supplement['packageMetadata']:
    check(record['path'] not in inputs, 'supplement adds a new named finite input')
    check(os.path.realpath(record['path']) == record['resolved'], 'fixed supplementary path resolution')
    inputs[record['path']] = record['sha256']
for record in compiler_supplement['packageMetadata']:
    metadata = load(record['path'])
    check(metadata['name'] == record['packageName'] and metadata['version'] == record['version'], 'supplement package name/version identity')
check(len(inputs) == 12586 and len(roots) == 255, '12580 existing inputs plus six fixed named additions; existing255 package roots')
allowed = {}
for path, expected in inputs.items():
    check(stat.S_ISREG(os.lstat(path).st_mode), 'current named input regular ' + path)
    bound(path, expected)
    real = os.path.realpath(path)
    check(real not in allowed or allowed[real] == expected, 'resolved map conflict')
    allowed[real] = expected
check(len(allowed) == 12586, 'augmented finite12586 resolved identities')
for edge in supp['resolutionEdges']:
    check(os.path.realpath(edge['logical']) == edge['resolved'], 'existing named resolution edge')
for record in supp['uninstalledDeclaredOptionalOrPeerDependencies']:
    parent = Path(record['from'])
    check(not any(os.path.lexists(p / 'node_modules' / record['dependency']) for p in [parent, *parent.parents]), 'existing named absence')

old_inventory = load(O / 'qualified-copy-actual-physical-inventory-v1.json')
actual_tree_paths = set()
def tree(path):
    actual_tree_paths.add(str(path))
    if stat.S_ISDIR(os.lstat(path).st_mode):
        for child_path in path.iterdir():
            tree(child_path)
tree(Path(plan['proposedRoot']))
check(actual_tree_paths == {r['path'] for r in old_inventory['members']}, 'exact copied834 physical entries still present; no extras')
for item in old_inventory['members']:
    st = os.lstat(item['path'])
    check((st.st_dev, st.st_ino, oct(stat.S_IMODE(st.st_mode)), st.st_size, st.st_mtime_ns) == (item['device'], item['inode'], item['mode'], item['size'], item['mtimeNs']), 'copied physical identity unchanged ' + item['path'])
    if item['kind'] == 'symlink':
        check(os.readlink(item['path']) == item['target'] and os.path.realpath(item['path']) == item['resolved'], 'copied reuse link unchanged')

raw_stdout = receipt_bytes['compiler.stdout.log']
check(len(raw_stdout) == 102039 and hashlib.sha256(raw_stdout).hexdigest() == '5d806a9a05ef022124a78b1e32959e67049f6fdf8e47463e48f2fadb0ea93733', 'bound complete compiler stdout')
check(receipt_bytes['compiler.stderr.log'] == b'', 'compiler stderr empty')
lines = raw_stdout.decode('utf-8').splitlines()
check(len(lines) == 653 and len(set(lines)) == 653 and all(line.strip() for line in lines), '653 nonempty unique raw listed paths')
listed = []
missing = []
for number, line in enumerate(lines, 1):
    valid = os.path.isabs(line) and os.path.isfile(line) and stat.S_ISREG(os.lstat(line).st_mode)
    check(valid, 'raw stdout is a file path, not diagnostic line ' + str(number))
    if not valid:
        continue
    real = os.path.realpath(line)
    digest = sha(line)
    expected = allowed.get(real)
    item = {'line': number, 'path': line, 'resolved': real, 'currentSha256': digest,
            'bytes': Path(line).stat().st_size, 'preboundExpectedSha256': expected,
            'prebound': expected is not None}
    listed.append(item)
    if expected is None:
        missing.append(item)
    else:
        check(digest == expected, 'listed bound input unchanged ' + line)
check(missing == [], 'all653 listed inputs prebound in fixed augmented map')
check(len({r['resolved'] for r in listed}) == 653, '653 unique resolved input paths')
check(set(r['path'] for r in gate['entryFiles']) <= set(lines), 'all seven explicit entries listed')
expected_resolution_receipt = [{'path': r['path'], 'resolved': r['resolved'], 'sha256': r['preboundExpectedSha256']} for r in listed]
check(load(R / 'resolved-compiler-inputs.json') == expected_resolution_receipt, 'all653 runtime resolution records exactly equal independent fixed-map comparison in raw stdout order')
check(receipt_bytes['outer.stderr.log'] == b'', 'outer stderr empty')
check(raw_stdout == (H / 'candidate-controls-pagination-qualified-peer-compiler-receipt-v1/compiler.stdout.log').read_bytes(), 'second-run stdout equals prior raw653 path list without rewriting prior result')
old_freeze_path = O / 'qualified-compiler-actual-review-freeze-v1.json'
bound(old_freeze_path, 'c109a945d48316cadd74d543f4b5f56aaa813b77142138809ab2167fdcb0f39a')
for name, record in load(old_freeze_path)['files'].items():
    bound(O / name, record['sha256'])
check(load(H / 'candidate-controls-pagination-qualified-peer-compiler-receipt-v1/outcome.json')['staticGatePassed'] is False, 'earlier failed gate remains failed')

# Freeze original bytes separately from this independent post-run interpretation.
snapshot = O / 'qualified-compiler-success-actual-evidence-snapshot-v1'
snapshot.mkdir(mode=0o700)
sources = {**{'receipt-' + n: R / n for n in sorted(receipt_names)},
           'root-admission.json': admission_path, 'actual-initial-tool.json': initial_path,
           'actual-final-tool.json': final_path}
snapshots = []
for name, origin in sources.items():
    data = origin.read_bytes()
    destination = snapshot / name
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
    check(data == destination.read_bytes(), 'byte-exact original evidence snapshot ' + name)
    snapshots.append({'origin': str(origin), 'copy': str(destination), 'bytes': len(data), 'sha256': sha(destination)})
for name, data in receipt_bytes.items():
    check((R / name).read_bytes() == data, 'original receipt stable during audit ' + name)
listed_path = O / 'qualified-compiler-success-actual-listed-inputs-v1.json'
write(listed_path, {'kind': 'Independent actual strict-gate full raw-list comparison against the fixed prebound augmented map; runtime-produced resolution receipt separately preserved',
                   'rawStdoutSha256': receipt_bindings['compiler.stdout.log']['sha256'], 'listedInputs': listed,
                   'unboundInputs': missing})
facts = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': __doc__, 'checks': checks,
         'allAuditChecksPass': not errors, 'errors': errors, 'classification': 'ACCEPT actual compiler-only strict gate: child0, outer0, all653 inputs prebound and matching',
         'staticGatePassed': True, 'nativeAuthority': False, 'productCredit': False,
         'sourceManifestSha256': sha(K / 'packet-manifest-v1.json'), 'admissionSha256': sha(admission_path),
         'copyAcceptanceSha256': sha(copy_acceptance_path), 'sourceCorrection': 'exact fixed input supplement delta on RLock v2; no runtime reentrancy calibration',
         'actualInitial': {k: v for k, v in initial.items() if k != 'output'},
         'actualFinal': {k: v for k, v in final.items() if k != 'output'},
         'apiFullOuterDisplayMatchesRawStreams': True, 'apiContainsCompilerStdout': False,
         'inputProvenanceLimit': 'ROOT exact admission/dispatch plus pinned source, child command receipt and matching outputs; API responses do not independently echo the outer input arguments.',
         'child': child, 'cleanup': cleanup, 'outcome': outcome, 'identityBefore': before, 'identityAfter': after,
         'resourceSamples': 11, 'sampledPeakGroupRssBytes': peak, 'lastSampledElapsedMs': samples[-1]['elapsedMs'],
         'resourceLimit': 'Sampled evidence only; no exact child duration, continuous RSS or hard real-time guarantee inferred.',
         'receiptFiles': receipt_bindings, 'receiptFileCount': 10,
         'rawListedFiles': 653, 'preboundListedFiles': 653, 'unboundListedFiles': 0,
         'compilerDiagnosticLinesObserved': 0, 'compilerStderrBytes': 0,
         'unboundInputs': missing, 'listedInputClassification': {'path': str(listed_path), 'sha256': sha(listed_path)},
         'postRunInputBindingLimit': 'Three declarations and three metadata files were fixed before this separate source-v3 invocation. The prior failed gate remains failed; its post-run hashes never become retroactive prebinding.',
         'existingFiniteInputHashesRechecked': 12580, 'fixedAdditionalInputHashesRechecked': 6, 'existingFinitePackageRoots': 255,
         'existingResolutionEdges': 405, 'existingNamedAbsences': 112, 'copiedPhysicalEntries': 834,
         'newCensus': False, 'snapshotBindings': snapshots, 'candidateReruns': 0, 'compilerInvocationsByReviewer': 0,
         'processProbesByReviewer': 0, 'boundSourceEdits': 0, 'runtimeAdmission': False,
         'next': 'Only the admitted compiler-only static gate is accepted. ROOT separately decides any later failure-receiving admission; no native/product authority follows.',
         'artifactLint': 'PENDING ROOT'}
out = O / 'qualified-compiler-success-actual-independent-facts-v1.json'
write(out, facts)
print(json.dumps({'facts': str(out), 'sha256': sha(out), 'checks': checks, 'errors': errors,
                  'rawListedFiles': 653, 'unboundListedFiles': 0, 'snapshotFiles': len(snapshots),
                  'classification': facts['classification']}))
raise SystemExit(bool(errors))
