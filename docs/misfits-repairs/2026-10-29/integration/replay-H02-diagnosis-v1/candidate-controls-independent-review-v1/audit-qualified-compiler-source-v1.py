"""Independent lightweight compiler-wrapper source and metadata audit; no candidate execution or syntax compilation."""
from pathlib import Path
import datetime
import hashlib
import io
import json
import os
import shlex
import stat
import tokenize

O = Path(__file__).resolve().parent
H = O.parent
K = H / 'candidate-controls-pagination-qualified-peer-compiler-containment-source-v1'
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
            raise ValueError('duplicate key ' + key)
        result[key] = value
    return result

def load(path):
    return json.loads(Path(path).read_bytes(), object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))

def ref(record):
    check(sha(record['path']) == record['sha256'], 'reference ' + record['path'])

manifest_path = K / 'packet-manifest-v1.json'
check(sha(manifest_path) == '77ecb1a906d4712663622962fcf3db3dee522484118c536a308ec6f046ff4ba0', 'K manifest binding')
manifest = load(manifest_path)
check(len(manifest['files']) == 6 and manifest['fileCount'] == 6, 'six source members')
for name, record in manifest['files'].items():
    check(stat.S_ISREG(os.lstat(K / name).st_mode), 'regular source member ' + name)
    check(sha(K / name) == record['sha256'] and (K / name).stat().st_size == record['bytes'], 'source member identity ' + name)
    if name.endswith('.json'):
        load(K / name)
check({str(p.relative_to(K)) for p in K.rglob('*') if p.is_file()} == set(manifest['files']) | {'packet-manifest-v1.json'}, 'source packet closure')
check(not any(p.is_symlink() for p in K.rglob('*')), 'source packet no links')
c = load(K / 'compiler-containment-contract-v1.json')
tool = load(K / 'proposed-exact-compiler-only-tool-invocation-v1.json')
for record in [c['wrapper'], c['python'], c['gate'], c['binding'], c['plan'], c['geometry'],
               c['finiteToolInputs'], c['ps'], *c['copyReceipts'], *c['sourcePacketRefs'],
               c['mechanicalReuse']['source'], tool['contract'], tool['shell']]:
    ref(record)
gate = load(c['gate']['path'])
binding = load(c['binding']['path'])
plan = load(c['plan']['path'])
supp = load(c['finiteToolInputs']['path'])
check(c['command'] == gate['command'] == tool['childCommandExactlyV'], 'exact unchanged V child command')
check(c['command']['executable'] == binding['node']['executable'], 'bound Node child')
check(c['command']['args'] == [gate['compilerEntry']['path'], '--project', gate['config']['runtimePath'], '--noEmit', '--incremental', 'false', '--pretty', 'false', '--listFiles'], 'exact compiler argv and flags')
check(c['command']['cwd'] == plan['proposedCodeRoot'] == binding['worktree'], 'exact copied cwd')
check(sha(gate['config']['inactivePath']) == sha(gate['config']['runtimePath']) == gate['config']['sha256'], 'unchanged copied compile config')
check(len(gate['entryFiles']) == 7 and load(gate['config']['runtimePath'])['include'] == [r['path'] for r in gate['entryFiles']], 'seven exact config entries')
for record in gate['entryFiles']:
    ref(record)
argv = [c['python']['path'], '-I', '-S', '-B', c['wrapper']['path'], str(K / 'compiler-containment-contract-v1.json'), sha(K / 'compiler-containment-contract-v1.json')]
check(tool['argv'] == argv and shlex.split(tool['arguments']['cmd']) == ['exec', *argv], 'exact proposed shell exec argv')
check(tool['arguments']['shell'] == '/bin/sh' and tool['arguments']['login'] is False and tool['arguments']['sandbox_permissions'] == 'require_escalated' and tool['arguments']['yield_time_ms'] == 1000, 'explicit outer tool observation and escalation proposal')
check(tool['maxInvocations'] == 1 and not tool['executed'] and not c['executed'], 'one inactive proposed invocation')
check(c['limits'] == {'compilerWallMs': 45000, 'groupRssBytes': 2147483648, 'samplingMs': 100, 'psInvocationTimeoutMs': 1000, 'cleanupMs': 2000}, 'selected compiler policies')
check(not os.path.lexists(c['outputRoot']), 'compiler receipt root absent')

# Reuse the completed heavy actual-copy audit. This pass reads only its inventory,
# metadata, the small wrapper packet and current copied files; no new tool census.
actual = load(O / 'qualified-copy-actual-independent-facts-v2.json')
check(actual['allAuditChecksPass'] and actual['checks'] == 40375, 'accepted actual-copy facts')
check(sha(O / 'qualified-copy-actual-review-freeze-v1.json') == '1b491a76140b0994bd48c2e0b59385602ee016cc2418ff317fcbedbbb0b0f55e', 'separate actual-copy freeze')
inventory = load(actual['inventory']['path'])
for item in inventory['members']:
    st = os.lstat(item['path'])
    check((st.st_dev, st.st_ino, oct(stat.S_IMODE(st.st_mode)), st.st_size, st.st_mtime_ns) == (item['device'], item['inode'], item['mode'], item['size'], item['mtimeNs']), 'physical copy identity ' + item['path'])
    if item['kind'] == 'regular':
        check(sha(item['path']) == item['sha256'], 'physical copied hash ' + item['path'])
    elif item['kind'] == 'symlink':
        check(os.readlink(item['path']) == item['target'] and str(Path(item['path']).resolve()) == item['resolved'], 'physical copied link ' + item['path'])
roots = {}
for record in list(binding['packages'].values()) + supp['packages']:
    if record['resolved'] in roots:
        check(roots[record['resolved']] == record['regularPayloadFilesMap'], 'duplicate finite root has identical map')
    else:
        roots[record['resolved']] = record['regularPayloadFilesMap']
check(len(roots) == 255 and sum(len(m) for m in roots.values()) == 11974, 'existing finite package metadata25511974')
check(len(supp['resolutionEdges']) == 405 and len(supp['uninstalledDeclaredOptionalOrPeerDependencies']) == 112, 'existing finite edges405absences112')
inputs = {r['runtimePath']: r['fromSha256'] for r in plan['regularCodeAndLockFiles'] + plan['regularControlFiles']}
check(len(inputs) == 603, 'finite copied603 inputs')
inputs[binding['node']['executable']] = binding['node']['sha256']
inputs[c['ps']['path']] = c['ps']['sha256']
inputs[binding['worktree'] + '/node_modules/.pnpm/lock.yaml'] = binding['lockfiles']['installedPnpmLock']
for root, members in roots.items():
    for name, expected in members.items():
        path = root + '/' + name
        check(path not in inputs or inputs[path] == expected, 'finite input map conflict')
        inputs[path] = expected
resolved = {}
for path, expected in inputs.items():
    real = os.path.realpath(path)
    check(real not in resolved or resolved[real] == expected, 'finite resolved input conflict')
    resolved[real] = expected
check(inputs.get(gate['compilerEntry']['path']) == gate['compilerEntry']['sha256'], 'compiler entry in existing finite map')

source = (K / 'contain-compiler-v1.py.txt').read_text()
tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
check(len(source.splitlines()) == 236, 'full236-line source read')
check(source.count('subprocess.Popen(') == 1 and source.count('subprocess.run(') == 1 and source.count('os.killpg(') == 1, 'one compiler spawn one ps observer one group-kill site')
for text in ['start_new_session=True', 'stdout=stdout, stderr=stderr', 'timeout=1, text=True', 'os.killpg(pgid, signal.SIGKILL)', 'timer.cancel(); timer.join()', 'save("cleanup-final.json"', 'save("resolved-compiler-inputs.json"', 'child_code == 0 and not trigger and resolved', 'passed = bool(passed and not trigger and not stop_errors)']:
    check(text in source, 'source mechanical guard ' + text)
check(source.index('save("cleanup-final.json"') < source.index('save("outcome.json"') < source.index('emit("compiler-gate-passed"'), 'final cleanup before pass receipt')
check('stop_lock = threading.Lock()' in source and 'with stop_lock:' in source and 'signal.signal(sig, lambda number, frame: stop(' in source, 'static reentrant signal-deadlock witness premises')
facts = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': __doc__, 'checks': checks,
         'allMetadataAndPhysicalChecksPass': not errors, 'errors': errors,
         'candidateManifestSha256': sha(manifest_path), 'wrapperSha256': sha(K / 'contain-compiler-v1.py.txt'),
         'contractSha256': sha(K / 'compiler-containment-contract-v1.json'),
         'toolProposalSha256': sha(K / 'proposed-exact-compiler-only-tool-invocation-v1.json'),
         'wrapperLines': 236, 'lexicalTokens': len(tokens), 'unchangedVChildCommand': True,
         'finiteInputs': len(inputs), 'finiteResolvedInputs': len(resolved),
         'existingFiniteToolMetadata': [255, 11974, 405, 112], 'heavyToolRehashRepeated': False,
         'copiedPhysicalInventoryRechecked': len(inventory['members']), 'copiedRegularHashesRechecked': 603,
         'actualCopyFreezeSha256': sha(O / 'qualified-copy-actual-review-freeze-v1.json'),
         'blockingFindings': [{'id': 'H02-COMPILER-STOP-SIGNAL-REENTRANCY', 'priority': 1,
                              'path': str(K / 'contain-compiler-v1.py.txt'), 'lines': [108, 110, 115, 158],
                              'authority': 'Contract/report require owned-group stop for wall/resource/operational/outer-signal faults; this is containment mechanics, not a product law.',
                              'witness': 'After handlers are installed, main enters stop and owns non-reentrant stop_lock; SIGINT/SIGTERM arrives before killpg; handler reenters stop on that same thread and blocks acquiring its own lock; main cannot finish stop and timer blocks on that lock too.',
                              'status': 'Confirmed by static control-flow; unexecuted',
                              'smallestRepair': 'Make stop reentrant (for example threading.RLock) or avoid acquiring that lock from the signal handler; preserve the same stop scope and limits.'}],
         'verdict': 'HOLD exact compiler v1 source for one contained signal-reentrancy correction',
         'candidateExecutions': 0, 'candidateImports': 0, 'candidateSyntaxCompiles': 0, 'compilerInvocations': 0,
         'nativeReceiving': 0, 'processProbes': 0, 'boundSourceEdits': 0, 'runtimeAdmission': False,
         'productRedGreenCredit': False, 'artifactLint': 'PENDING ROOT'}
out = O / 'qualified-compiler-source-independent-facts-v1.json'
with out.open('x') as stream:
    json.dump(facts, stream, indent=2, sort_keys=True)
    stream.write('\n')
print(json.dumps({'facts': str(out), 'sha256': sha(out), 'checks': checks, 'errors': errors,
                  'blockingFindings': len(facts['blockingFindings']), 'verdict': facts['verdict']}))
raise SystemExit(bool(errors))
