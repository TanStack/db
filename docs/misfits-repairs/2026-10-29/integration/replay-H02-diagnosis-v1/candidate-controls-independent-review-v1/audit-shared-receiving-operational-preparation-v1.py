"""Independent static D audit: reads, hashes, strict JSON and Python AST only.
No bound helper, supervisor, model or config is imported or executed.
"""
import ast
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path

O = Path(__file__).resolve().parent
H = O.parent
D = H / 'candidate-controls-pagination-shared-window-receiving-operational-preparation-v1'
Q = H / 'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
S = H / 'candidate-controls-source-failed-peer-checkpoint-successor-v1'
N = H / 'candidate-controls-pagination-2gib-shared-receiving-containment-v1'
errors = []

def check(value, label):
    if not value:
        errors.append(label)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def pairs(items):
    out = {}
    for k, v in items:
        if k in out:
            raise ValueError('duplicate JSON key: ' + k)
        out[k] = v
    return out

def load(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=pairs,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))

def bound(path, digest, label='bound input'):
    check(sha(path) == digest, label + ': ' + str(path))

def fmap(root, items, label):
    for name, value in items.items():
        digest = value['sha256'] if isinstance(value, dict) else value
        path = Path(root) / name
        bound(path, digest, label)
        if isinstance(value, dict):
            check(path.stat().st_size == value['bytes'], label + ' size ' + name)

manifest = load(D / 'packet-manifest-v1.json')
bound(D / 'packet-manifest-v1.json', 'b392686f0a401be65ca4c364efe54310e4ec454204f59f18859b7883cd0d6403')
fmap(D, manifest['files'], 'D packet')
check(len(manifest['files']) == manifest['members'] == 21, 'D 21 members')
check(sum(x['bytes'] for x in manifest['files'].values()) == manifest['memberBytes'] == 599852, 'D byte count')
check({str(p.relative_to(D)) for p in D.rglob('*') if p.is_file()} == set(manifest['files']) | {'packet-manifest-v1.json'}, 'D exact file closure')
for name in manifest['files']:
    if name.endswith('.json'):
        load(D / name)

q = load(Q / 'source-freeze-v1.json')
s = load(S / 'source-freeze-v1.json')
d = load(D / 'source-freeze-receiving-v1.json')
W = Path(d['worktree'])
bound(Q / 'source-freeze-v1.json', 'f85b261b1733c5581c0f8af8fbdff824b189b9b4517fda6b4cf397c1d2c8b193')
bound(S / 'source-freeze-v1.json', '0a1978c5a8856da7aab49379462dd5f258f75b7ba910454eed320f3018f13779')
bound(D / 'source-freeze-receiving-v1.json', '3cb1efc602cac751233bdb51d240d0022acf13397b4844893b05d5e032c4228b')
unchanged = ['sourceBindings', 'sourceCopies', 'productionFiles', 'instrumentFiles', 'sharedInstrumentFiles', 'packages', 'node', 'lockfiles', 'dependencyReuseLinks']
for key in unchanged:
    check(d[key] == q[key], 'unchanged Q map ' + key)
check(set(d) - set(q) == {'runtimeAdmission', 'sourcePreparationFreeze', 'sourcePreparationFreezeSha256', 'completionInstrumentFiles', 'receivingProductionFiles', 'receivingMetadataDerivation', 'standaloneReceivingConfiguration', 'operationalQualification'}, 'exact additive metadata fields')
check({k for k in d if k in q and d[k] != q[k]} == {'at', 'status', 'bindingProfile', 'requiredReportWorktreeExactLint'}, 'only four existing metadata changes')
check(d['sourcePreparationFreeze'] == str(Q / 'source-freeze-v1.json') and d['sourcePreparationFreezeSha256'] == sha(Q / 'source-freeze-v1.json'), 'Q derivation pin')
check({**d['productionFiles'], **d['instrumentFiles'], **d['sharedInstrumentFiles']} == d['sourceBindings'], 'all 596 maps retained')
check(len(d['sourceBindings']) == 596 and len(d['sourceCopies']) == 85 and len(d['productionFiles']) == 511, 'source counts')
fmap(W, d['sourceBindings'], 'active source')
fmap(d['sourceCopyRoot'], d['sourceCopies'], 'immutable support copies')
helper = 'packages/db/tests/query/pagination-window-publication-oracle.ts'
expected_completion = {name: q['instrumentFiles'][name] for name in s['completionInstrumentFiles']}
check(len(expected_completion) == 17 and helper not in expected_completion, 'S exact 17 basis')
expected_completion[helper] = q['instrumentFiles'][helper]
check(d['completionInstrumentFiles'] == expected_completion and len(expected_completion) == 18, 'exact additive 18 subset')
check(d['receivingProductionFiles'] == s['receivingProductionFiles'] and len(d['receivingProductionFiles']) == 161, 'exact S receiving 161 pairs')
for name, digest in d['receivingProductionFiles'].items():
    check(q['productionFiles'].get(name) == digest, 'receiving source already Q-bound: ' + name)
check(d['bindingProfile'] == 'completion-baseline-v1' and d['runtime'] == 0, 'profile and no runtime')

nb = load(N / 'binding.json')
supath = N / 'supplemental-tool-inputs.json'
bound(supath, 'cd7eda6b0e649cb2aa019b83dac04f7821d52e34d0c62de144ac6d280636ba50')
sup = load(supath)
bound(d['node']['executable'], d['node']['sha256'], 'Node binary')
bound(nb['python']['executable'], nb['python']['sha256'], 'Python binary')
bound(nb['ps']['path'], nb['ps']['sha256'], 'ps bytes only; not invoked')
bound(W / 'pnpm-lock.yaml', d['lockfiles']['repoPnpmLock'])
bound(W / 'node_modules/.pnpm/lock.yaml', d['lockfiles']['installedPnpmLock'])
check(len(d['dependencyReuseLinks']) == 4, 'four reuse links')
for name, item in d['dependencyReuseLinks'].items():
    p = W / name
    check(p.is_symlink() == item['isSymlink'] and str(p.resolve()) == item['resolved'], 'reuse link ' + name)
seen = set()
payloads = 0
payload_bytes = 0
for item in list(d['packages'].values()) + sup['packages']:
    logical = Path(item['logical'])
    if not logical.is_absolute():
        logical = W / logical
    check(str(logical.resolve()) == item['resolved'], 'package logical identity ' + str(logical))
    root = Path(item['resolved'])
    if str(root) in seen:
        continue
    seen.add(str(root))
    expected = item['regularPayloadFilesMap']
    actual = set()
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if name != 'node_modules' and not (Path(directory) / name).is_symlink()]
        for name in files:
            p = Path(directory) / name
            if p.is_file() and not p.is_symlink():
                actual.add(str(p.relative_to(root)))
    check(actual == set(expected), 'exact own-file set ' + str(root))
    fmap(root, expected, 'named package payload')
    payloads += len(expected)
    payload_bytes += sum((root / name).stat().st_size for name in expected)
check(len(seen) == 255 and payloads == 11974, 'finite 255 roots / 11974 payloads')
check(len(sup['resolutionEdges']) == 405, 'finite 405 edges')
for edge in sup['resolutionEdges']:
    check(str(Path(edge['logical']).resolve()) == edge['resolved'], 'declared resolution edge ' + edge['logical'])
check(len(sup['uninstalledDeclaredOptionalOrPeerDependencies']) == 112, 'finite 112 absences')
for item in sup['uninstalledDeclaredOptionalOrPeerDependencies']:
    root = Path(item['from'])
    check(not any((p / 'node_modules' / item['dependency']).exists() for p in [root, *root.parents]), 'still absent ' + item['dependency'])

pathmap = load(Q / 'artifact-snapshot-relocation-v1/path-map-v1.json')
bound(Q / 'artifact-snapshot-relocation-v1/path-map-v1.json', '2be52168ecf9ed3c12aa6eb738e632c1abafaf363a73f5dcac0236eefe2d723e')
check(len(pathmap['relocations']) == 1, 'one historical relocation')
relocations = {i['from']: i['to'] for i in pathmap['relocations']}
archives = []
for base, name, digest, count, mapping in [
    (Q, 'packet-sha256-v1.json', 'f64dae8f38429d6d5f6358fa2295c1b91b48f92a5f0ebdaae29b3153939628ef', 126, relocations),
    (Q, 'packet-sha256-with-snapshot-relocation-v2.json', 'e36b9780ca9891cbc25233618117e121619bca1c2b0aa29974fb9ffcc80d7462', 133, {}),
    (S, 'packet-sha256-v1.json', '60a45f03547a64b44341b72b2a9cebe2f9c2f662efc014b613d0e840978427fd', 88, {}),
]:
    bound(base / name, digest, 'archive manifest')
    items = load(base / name)
    check(len(items) == count, 'archive count ' + name)
    for member, member_digest in items.items():
        bound(base / mapping.get(member, member), member_digest, 'archive member')
    archives.append({'manifest': str(base / name), 'members': count, 'mappedEntries': len(mapping)})

proposals = []
for schedule, basename, gate, recipe_digest in [
    ('failure-first', 'inline-window-failure-first.json', 'source-failed-peer', '290ec57b7533b5ea59a466c5896fb758a864132e61c2b6a16dd3078fc1512f86'),
    ('success', 'inline-window-success.json', 'held-window', 'abc901dc7bc376988a463d44d42f9c3d851370abe3fdfdfa9b17140bdeeeafd0'),
]:
    rpath = D / 'frozen-inputs-v1/recipes' / basename
    r = load(rpath)
    old = load(Q / 'frozen-inputs-v1/recipes' / basename)
    bound(rpath, recipe_digest)
    check(set(r) == set(old) and {k for k in r if r[k] != old[k]} == {'sourceFreeze', 'sourceFreezeSha256', 'programFile', 'outputDirectory'}, 'recipe only four metadata fields ' + schedule)
    ppath = D / 'frozen-inputs-v1/programs' / basename
    check(ppath.read_bytes() == (Q / 'frozen-inputs-v1/programs' / basename).read_bytes(), 'exact Q program byte copy ' + schedule)
    p = load(ppath)
    check(p['windowReceivingSchedule'] == schedule and p['gate'] == gate and p['setup']['profile'] == 'inline', 'program stage/profile ' + schedule)
    check(r['gate'] == gate and r['profile'] == 'inline' and r['programFile'] == str(ppath) and r['programSha256'] == sha(ppath), 'recipe program link ' + schedule)
    check(r['sourceFreeze'] == str(D / 'source-freeze-receiving-v1.json') and r['sourceFreezeSha256'] == sha(D / 'source-freeze-receiving-v1.json'), 'recipe source pin ' + schedule)
    check(r['limits'] == {'wallMs': 60000, 'nodeHeapMiB': 384, 'groupRssBytes': 1073741824, 'samplingMs': 100}, 'unchanged outer limits ' + schedule)
    check(r['args'] == ['--max-old-space-size=384', str(Path(d['packages']['vitest']['resolved']) / 'vitest.mjs'), 'run', '--config', 'scripts/h02-progress/completion-parent.config.ts', 'packages/query-db-collection/tests/queued-answer-completion-baseline.test.ts', '-t', 'checks a selected baseline constituent through the shared judgment'], 'exact child args ' + schedule)
    proposal = load(D / ('proposed-exact-' + schedule + '-command-v1.json'))
    expected_command = {'executable': d['node']['executable'], 'args': [str(W / 'scripts/h02-progress/completion-parent.mjs'), str(rpath)], 'cwd': str(W)}
    check(proposal['command'] == expected_command and proposal['recipeSha256'] == sha(rpath), 'exact separate proposal ' + schedule)
    output = Path(r['outputDirectory'])
    check(output == D / 'runtime-output-v1' / basename.removesuffix('.json') and not os.path.lexists(output), 'exclusive fresh output absent ' + schedule)
    proposals.append(proposal['command'])
check((D / 'runtime-output-v1').is_dir() and not list((D / 'runtime-output-v1').iterdir()), 'output common parent empty')

reg = load(D / 'registration-and-config-bindings-v1.json')
for item in reg['registrations']:
    path = W / item['path']
    bound(path, item['sourceSha256FromQ'])
    lines = path.read_text().splitlines()
    check(lines[item['registrationLine'] - 1].strip() == item['registrationLiteral'], 'registration literal/line')
    check(sum(line.strip() == item['registrationLiteral'] for line in lines) == 1 and item['expectedAncestorTitles'] == [], 'single exact registration')
    check("import { it } from 'vitest'" in path.read_text(), 'plain it source')
for item in reg['configs'].values():
    if isinstance(item, dict):
        bound(W / item['path'], item['sourceSha256FromQ'])
        check(not item['coverageEnabled'] and not item['typecheckEnabled'], 'inherited standalone false flags')
        if 'inherits' in item:
            bound(W / item['inherits'], item['inheritedSourceSha256FromQ'])

audit = load(D / 'source-and-tool-audit-v1.json')
recovery_ref = audit['acceptedRecovery']
bound(recovery_ref['path'], recovery_ref['sha256'])
recovery = load(recovery_ref['path'])
for key in ['actualRepair', 'postAudit', 'closeout', 'formattingAccount']:
    bound(recovery[key]['path'], recovery[key]['sha256'])
post = load(recovery['postAudit']['path'])
check(post['allChecksPassed'] is False and len(post['errors']) == 4 and all(i['scope'] == 'A38Source3411' and i['detail'] == 'hash mismatch' for i in post['errors']), 'historical false/four retained errors')
check(audit['historicalPostAuditAllChecksPassed'] is False and audit['historicalPostAuditErrorsPreserved'] == post['errors'], 'D preserves exact historical failed audit')
check(len(post['inputHashes']) == 9, 'nine preserved input hashes')
for path, digest in post['inputHashes'].items():
    bound(path, digest)
lint = d['requiredReportWorktreeExactLint']
bound(lint['account'], lint['accountSha256'])
bound(lint['log'], lint['logSha256'])
va = load(lint['account'])
check(va['second'] == lint['actual'] and va['second']['exit'] == 0, 'exact saved lint GREEN')
bound(va['gitCaptureShim']['path'], va['gitCaptureShim']['sha256'])
v1 = (D / 'seal-helper-v1.py.txt').read_text()
v2 = (D / 'seal-helper-v2.py.txt').read_text()
ast.parse(v1)
ast.parse(v2)
patch = ''.join(difflib.unified_diff(v1.splitlines(True), v2.splitlines(True), fromfile='saved-v1', tofile='saved-v2'))
check("postaudit['allChecksPassed'] is True" in v1 and "postaudit['allChecksPassed'] is False" in v2, 'initial failed assertion corrected explicitly')
check(manifest['actualStaticTools']['initialHelper'] == {'actual': '3204b7', 'exit': 1, 'classification': 'incorrect assertion about historical preserved false recovery audit; no source/tool mismatch or partial freeze'}, 'original helper failure retained')

# Source assertions supplement the manual full-source review. None evaluates JS/TS.
launcher = (W / 'scripts/h02-progress/completion-parent.mjs').read_text()
check(launcher.index('const { programBytes, ...command } = validateCompletionRecipe') < launcher.index('mkdirSync(directory, { mode: 0o700 })') < launcher.index('save(`identity-before.json`, verifyCompletionIdentity(freeze))') < launcher.index('const child = spawn(command.executable, command.args'), 'recipe validation / exclusive output / disk preflight / child order')
check('registeredGroups.size !== 1' in launcher and 'process.exitCode = result.classification.startsWith(' in launcher and '? 0\n    : 1' in launcher, 'exact-one registration and actual outer failure propagation')
check('finally {\n      // Recording failure cannot prevent process containment.\n      killGroup()' in launcher and 'save(`identity-after.json`, verifyCompletionIdentity(freeze))' in launcher, 'cleanup despite record failure and after-identity')
checker = (W / 'scripts/h02-progress/verify-bindings.mjs').read_text()
check('receivingProductionFiles' in checker and 'completion-baseline-v1' in checker, 'receiving production subset / exact profile checker seam')
model = (W / 'packages/query-db-collection/tests/queued-answer-completion-oracle.ts').read_text()
check('pagination-window-publication-oracle' in model, 'shared full-child helper remains on evaluated required model import path')
ledger = O / 'raw-items-ledger-v1.jsonl'
check(len(ledger.read_bytes().splitlines()) == 112 and sha(ledger) == '29a297b3c178176431c30dd9076fbf3750ec610e864795e4735253c5f6e041ed', '112-row append-only ledger prefix')
facts = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'mode': __doc__, 'packetManifestSha256': sha(D / 'packet-manifest-v1.json'),
    'sourceFreezeSha256': sha(D / 'source-freeze-receiving-v1.json'),
    'members': 21, 'memberBytes': 599852, 'activeSources': 596, 'immutableCopies': 85,
    'productionSources': 511, 'newSourceIdentities': 0,
    'completionSubset': 18, 'receivingProductionSubset': 161,
    'unchangedMaps': unchanged, 'namedPackageRoots': len(seen), 'ownPayloadFiles': payloads,
    'ownPayloadBytes': payload_bytes, 'declaredResolutionEdges': 405,
    'absentOptionalOrPeer': 112, 'locks': 2, 'reuseLinks': 4, 'archives': archives,
    'firstExactProposal': proposals[0], 'secondProposalSeparate': proposals[1],
    'helperCorrectionDiff': patch, 'historicalPostAuditAllChecksPassed': False,
    'historicalPostAuditErrors': post['errors'], 'recoveryInputHashes': 9,
    'ledgerPrefixRows': 112, 'ledgerPrefixSha256': sha(ledger),
    'allAuditChecksPass': not errors, 'errors': errors, 'blockingSourceFindings': [],
    'productExecutions': 0, 'modelExecutions': 0, 'testExecutions': 0,
    'boundProgramImports': 0, 'processProbes': 0, 'runtimeAdmission': False,
    'runtimeReachCredit': False, 'bugClassClosure': False,
    'scopeLimit': 'Named static own-file closure only. No undeclared dynamic import, evaluated-module, native lifecycle, OS shared-library or Python stdlib equivalence claim. Separate ROOT failure and success admissions remain required.'
}
out = O / 'shared-receiving-operational-preparation-independent-facts-v1.json'
with out.open('x') as stream:
    json.dump(facts, stream, indent=2)
    stream.write('\n')
print(json.dumps({'facts': str(out), 'sha256': sha(out), 'errors': errors, 'sourceCount': 596, 'roots': len(seen), 'payloads': payloads}))
raise SystemExit(bool(errors))
