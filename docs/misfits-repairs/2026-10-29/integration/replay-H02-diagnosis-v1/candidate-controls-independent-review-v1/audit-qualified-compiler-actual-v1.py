"""Independent actual compiler evidence audit; named finite reads/hashes only, no process/runtime action or new census."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import stat

O = Path(__file__).resolve().parent
H = O.parent
K = H / 'candidate-controls-pagination-qualified-peer-compiler-containment-source-v2'
K1 = H / 'candidate-controls-pagination-qualified-peer-compiler-containment-source-v1'
R = H / 'candidate-controls-pagination-qualified-peer-compiler-receipt-v1'
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

bound(K / 'packet-manifest-v1.json', '9a17c4ecc40115981a18c885c9e5ad2900eff7d4ca748d34ba9837ae8d7b434f')
manifest = load(K / 'packet-manifest-v1.json')
check(len(manifest['files']) == 6, 'six sealed v2 source members')
for name, record in manifest['files'].items():
    bound(K / name, record['sha256'])
    check((K / name).stat().st_size == record['bytes'], 'source member bytes')
original = (K1 / 'contain-compiler-v1.py.txt').read_bytes()
actual_source = (K / 'contain-compiler-v1.py.txt').read_bytes()
check(original.replace(b'stop_lock = threading.Lock()', b'stop_lock = threading.RLock()', 1) == actual_source, 'only source Lock-to-RLock correction')
c = load(K / 'compiler-containment-contract-v1.json')
tool = load(K / 'proposed-exact-compiler-only-tool-invocation-v1.json')
admission_path = K / 'root-independent-delta-and-compiler-admission-v1.json'
admission = load(admission_path)
check(admission['maxInvocations'] == 1 and admission['acceptedBy'] == '/root', 'ROOT one-shot compiler decision')
check(admission['wrapperSha256'] == sha(K / 'contain-compiler-v1.py.txt') and admission['contractSha256'] == sha(K / 'compiler-containment-contract-v1.json') and admission['toolProposalSha256'] == sha(K / 'proposed-exact-compiler-only-tool-invocation-v1.json'), 'admitted exact v2 pins')
copy_acceptance_path = (K / admission['copyAcceptance']).resolve()
copy_acceptance = load(copy_acceptance_path)
for record in [c['wrapper'], c['python'], c['gate'], c['binding'], c['plan'], c['geometry'], c['finiteToolInputs'], c['ps'], *c['copyReceipts'], *c['sourcePacketRefs'], tool['shell']]:
    ref(record)
source_extras = {'root-independent-delta-and-compiler-admission-v1.json', 'root-actual-compiler-initial-tool-v1.json', 'root-actual-compiler-final-tool-v1.json'}
check({p.name for p in K.iterdir()} == set(manifest['files']) | {'packet-manifest-v1.json'} | source_extras, 'six sealed members plus three ROOT actual records only')
binding = load(c['binding']['path'])
plan = load(c['plan']['path'])
supp = load(c['finiteToolInputs']['path'])
gate = load(c['gate']['path'])
check(c['command'] == gate['command'] == tool['childCommandExactlyV'], 'actual source preserves exact V compiler command')

receipt_names = {'child.json', 'cleanup-final.json', 'compiler.stderr.log', 'compiler.stdout.log',
                 'identity-after.json', 'identity-before.json', 'outcome.json', 'outer.stderr.log', 'outer.stdout.jsonl'}
check({p.name for p in R.iterdir()} == receipt_names, 'exact nine-file failed receipt; no fabricated resolved-input manifest')
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
check(child == {'pid': 16757, 'originalPgid': 16757, 'newSession': True, 'command': c['command']}, 'exact child identity and compiler argv')
check(before == after == {'matched': True, 'finiteInputCount': 12580}, 'recorded matched12580 before/after')
check(cleanup == {'originalPgid': 16757, 'rows': [], 'trigger': ['operational'], 'stopErrors': [], 'childReturnCode': 0}, 'positive final original-group absence and child0')
check(outcome == {'compilerCode': 0, 'remainingOwnedRows': [], 'trigger': ['operational'], 'staticGatePassed': False, 'nativeAuthority': False}, 'exact failed gate outcome distinct from child0')
events = [strict(line) for line in receipt_bytes['outer.stdout.jsonl'].splitlines()]
check(len(events) == 13 and events[0] == {'event': 'compiler-preflight', 'command': c['command'], 'wrapperPid': 16710, 'limits': c['limits']}, 'preflight and complete13-event stream')
check(events[-1] == {'event': 'compiler-operational-failure', 'compilerCode': 0, 'nativeAuthority': False}, 'failure terminal event retained')
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
check(peak == 635568128 and peak < c['limits']['groupRssBytes'], 'sampled peak635568128 below2GiB; not a continuous RSS bound')

initial_path = K / 'root-actual-compiler-initial-tool-v1.json'
final_path = K / 'root-actual-compiler-final-tool-v1.json'
initial, final = load(initial_path), load(final_path)
check(initial == {'chunk_id': '4b6893', 'wall_time_seconds': 1.003337416, 'session_id': 64181, 'original_token_count': 0, 'output': ''}, 'actual initial response/session')
check(final['chunk_id'] == 'e81dd0' and final['exit_code'] == 1 and final['original_token_count'] == 870, 'actual outer1 final metadata')
raw_outer_lines = receipt_bytes['outer.stdout.jsonl'].splitlines(keepends=True)
expected_api_output = b''.join(raw_outer_lines[:-1]) + receipt_bytes['outer.stderr.log'] + raw_outer_lines[-1]
check(final['output'].encode() == expected_api_output, 'complete API merged outer display agrees with separately retained raw streams')
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
check(len(inputs) == 12580 and len(roots) == 255, 'existing finite12580 inputs255 package roots')
allowed = {}
for path, expected in inputs.items():
    check(stat.S_ISREG(os.lstat(path).st_mode), 'current named input regular ' + path)
    bound(path, expected)
    real = os.path.realpath(path)
    check(real not in allowed or allowed[real] == expected, 'resolved map conflict')
    allowed[real] = expected
check(len(allowed) == 12580, 'finite12580 resolved identities')
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
check(len(missing) == 3 and [r['line'] for r in missing] == [88, 214, 458], 'exact three unbound declaration paths at88/214/458')
check(all(r['path'].endswith('.d.ts') for r in missing), 'unbound paths are declarations')
check(set(r['path'] for r in gate['entryFiles']) <= set(lines), 'all seven explicit entries listed')
failure = receipt_bytes['outer.stderr.log'].decode()
check(failure.endswith('ValueError: unbound resolved compiler input: ' + missing[0]['path'] + '\n'), 'outer exception names first actual unbound line88')
check('line 189, in main' in failure and 'line 19, in require' in failure, 'failure at bound-listFiles guard')

# Freeze original bytes separately from this independent post-run interpretation.
snapshot = O / 'qualified-compiler-actual-evidence-snapshot-v1'
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
listed_path = O / 'qualified-compiler-actual-listed-inputs-v1.json'
write(listed_path, {'kind': 'Independent post-run full raw-list classification; not a runtime-produced resolution receipt or retroactive input binding',
                   'rawStdoutSha256': receipt_bindings['compiler.stdout.log']['sha256'], 'listedInputs': listed,
                   'unboundInputs': missing})
facts = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': __doc__, 'checks': checks,
         'allAuditChecksPass': not errors, 'errors': errors, 'classification': 'Compiler child0; wrapper outer1 due incomplete prebound declaration-input closure',
         'staticGatePassed': False, 'nativeAuthority': False, 'productCredit': False,
         'sourceManifestSha256': sha(K / 'packet-manifest-v1.json'), 'admissionSha256': sha(admission_path),
         'copyAcceptanceSha256': sha(copy_acceptance_path), 'sourceCorrection': 'exact one-line Lock-to-RLock; no runtime reentrancy calibration',
         'actualInitial': {k: v for k, v in initial.items() if k != 'output'},
         'actualFinal': {k: v for k, v in final.items() if k != 'output'},
         'apiFullOuterDisplayMatchesRawStreams': True, 'apiContainsCompilerStdout': False,
         'inputProvenanceLimit': 'ROOT exact admission/dispatch plus pinned source, child command receipt and matching outputs; API responses do not independently echo the outer input arguments.',
         'child': child, 'cleanup': cleanup, 'outcome': outcome, 'identityBefore': before, 'identityAfter': after,
         'resourceSamples': 11, 'sampledPeakGroupRssBytes': peak, 'lastSampledElapsedMs': samples[-1]['elapsedMs'],
         'resourceLimit': 'Sampled evidence only; no exact child duration, continuous RSS or hard real-time guarantee inferred.',
         'receiptFiles': receipt_bindings, 'receiptFileCount': 9,
         'rawListedFiles': 653, 'preboundListedFiles': 650, 'unboundListedFiles': 3,
         'compilerDiagnosticLinesObserved': 0, 'compilerStderrBytes': 0,
         'unboundInputs': missing, 'listedInputClassification': {'path': str(listed_path), 'sha256': sha(listed_path)},
         'postRunInputBindingLimit': 'The three missing paths were not prebound for this invocation. Current post-run hashes classify the gap and cannot retroactively pass the failed gate.',
         'existingFiniteInputHashesRechecked': 12580, 'existingFinitePackageRoots': 255,
         'existingResolutionEdges': 405, 'existingNamedAbsences': 112, 'copiedPhysicalEntries': 834,
         'newCensus': False, 'snapshotBindings': snapshots, 'candidateReruns': 0, 'compilerInvocationsByReviewer': 0,
         'processProbesByReviewer': 0, 'boundSourceEdits': 0, 'runtimeAdmission': False,
         'next': 'ROOT classifies a separately prepared minimal named missing-input supplement; no retry, native or product authority follows.',
         'artifactLint': 'PENDING ROOT'}
out = O / 'qualified-compiler-actual-independent-facts-v1.json'
write(out, facts)
print(json.dumps({'facts': str(out), 'sha256': sha(out), 'checks': checks, 'errors': errors,
                  'rawListedFiles': 653, 'unboundListedFiles': 3, 'snapshotFiles': len(snapshots),
                  'classification': facts['classification']}))
raise SystemExit(bool(errors))
