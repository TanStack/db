"""Read/hash audit and creation of pure replay copies with relocated outputs."""

import hashlib
import json
import pathlib
import re

R = pathlib.Path(__file__).resolve().parent
H = R.parent
V2 = H / 'metadata-update-source-v2'
V3 = H / 'metadata-update-source-v3'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p):
    return json.loads(p.read_text())


def check(condition, label):
    if not condition:
        raise AssertionError(label)


pins = {
    H / 'metadata-update-receiving-root-classification-v2.json': 'a7122694df31dbbea26314c0a3268e4a81e74a13d92d4abd9904498ccf6e037f',
    V3 / 'source-freeze.json': 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd',
    V3 / 'source-inventory.json': '3c8ece36701d450758587bd16dbf691b5e700668bc0be32ae2f20af8bc8bfb84',
    V3 / 'packet-manifest.json': 'e7574c41407e9e5b7fecfa181abc7f22b7ed4e2dcc48a7ab19860180a49bc00a',
    V2 / 'source-freeze.json': '4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a',
    H / 'metadata-update-receiving-result-freeze-v2.json': 'e490825ed92a6fa97891d2ab8b0414f65691bc06c214573e7ed119e9d236d9eb',
}
for p, digest in pins.items():
    check(sha(p) == digest, f'pinned identity: {p.name}')
manifest = read(V3 / 'packet-manifest.json')
for relative, record in manifest['artifacts'].items():
    p = V3 / relative
    check(p.stat().st_size == record['bytes'] and sha(p) == record['sha256'], f'packet member: {relative}')
old = read(V2 / 'source-inventory.json')
new = read(V3 / 'source-inventory.json')
check(len(old) == 588 and len(new) == 589, 'inventory cardinalities')
for inventory, packet in [(old, V2), (new, V3)]:
    for relative, digest in inventory.items():
        check(sha(packet / 'sources' / relative) == digest, f'frozen source {packet.name}/{relative}')
added = sorted(set(new) - set(old))
changed = sorted(k for k in old if old[k] != new[k])
prefix = 'packages/query-db-collection/tests/'
helper = prefix + 'queued-answer-progress-receipts.ts'
supervisor = prefix + 'queued-answer-progress-supervisor.ts'
check(added == [helper] and changed == [supervisor] and set(old) <= set(new), 'exact one changed plus one added source')
old_text = (V2 / 'sources' / supervisor).read_text()
new_text = (V3 / 'sources' / supervisor).read_text()
guard = re.search(r'if\s*\(\s*\[([^]]+)\]\.includes\(receipt.phase\)\s*\)', old_text)
check(guard is not None, 'actual old guard')
old_phases = re.findall(r'`([^`]+)`', guard.group(1))
new_phases = re.findall(r'`([^`]+)`', (V3 / 'sources' / helper).read_text())
check([p for p in new_phases if p not in ['followup-start', 'followup-publication']] == old_phases, 'old phase list preserved in order')
check(set(new_phases) - set(old_phases) == {'followup-start', 'followup-publication'}, 'only two added phases')
expected = old_text[:guard.start()] + 'if (retainProgressReceipt(receipt))' + old_text[guard.end():]
expected = expected.replace("import type {\n  ProgressHistory,", "import { retainProgressReceipt } from './queued-answer-progress-receipts.js'\nimport type {\n  ProgressHistory,", 1)
check(expected == new_text, 'existing supervisor changes exactly import and guard')
freeze = read(V3 / 'source-freeze.json')
previous_freeze = read(V2 / 'source-freeze.json')
for key in ['productionFiles', 'receivingProductionFiles', 'packages', 'lockfiles', 'node', 'dependencyReuseLinks']:
    check(freeze[key] == previous_freeze[key], f'predecessor preimage retained: {key}')
check(len(freeze['productionFiles']) == 511, '511 production files unchanged')
registration = prefix + 'queued-answer-metadata-oracle.test.ts'
check(new[registration] == old[registration] == '3d47cc699d4ceb04c8d23f0438e4995ea62b9f1ae23c5e6c386cdd47182f669e', 'exact parent registration/name/selector bytes unchanged')
check(new[prefix + 'queued-answer-metadata-oracle.ts'] == old[prefix + 'queued-answer-metadata-oracle.ts'] == 'b965769c351c3d4bd563df915ad052ab3ecb0c3cc85559ff38c02916faae2cca', 'metadata finalizer definition unchanged')

raw_manifest = read(H / 'metadata-update-receiving-actual-v2/raw-manifest.json')
for kind in ['inner', 'outer']:
    for origin in ['original', 'preserved']:
        root = pathlib.Path(raw_manifest[f'{origin}{kind.title()}Directory'])
        members = raw_manifest[f'{kind}Members']
        check({str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()} == set(members), f'{origin} {kind} member set')
        for relative, record in members.items():
            p = root / relative
            check(p.stat().st_size == record['bytes'] and sha(p) == record['sha256'], f'{origin} {kind} raw hash {relative}')

derived = []
for name, output in [('selector-roundtrip-controls.mjs', 'metadata-source-v3-roundtrip-replayed.json'), ('legacy-pure-controls.mjs', 'metadata-source-v3-legacy-replayed.json')]:
    original = (V3 / name).read_text()
    directory_line = 'const directory = dirname(fileURLToPath(import.meta.url))'
    check(original.count(directory_line) == 1, f'one input anchor: {name}')
    modified = original.replace(directory_line, 'const directory = ' + json.dumps(str(V3)), 1)
    target = 'selector-roundtrip-results.json' if name.startswith('selector') else 'pure-results.json'
    write_anchor = "writeFileSync(resolve(directory, '" + target + "'),"
    check(modified.count(write_anchor) == 1, f'one output anchor: {name}')
    modified = modified.replace(write_anchor, 'writeFileSync(' + json.dumps(str(R / output)) + ',', 1)
    destination = R / ('metadata-source-v3-' + name)
    destination.write_text(modified)
    derived.append({'original': str(V3 / name), 'originalSha256': sha(V3 / name), 'replay': str(destination), 'replaySha256': sha(destination), 'output': str(R / output), 'changes': 'Only source-directory anchor and result-file destination relocated; executable judgments unchanged'})

result = {
    'status': 'SOURCE V3 HASH/DIFF/PRESERVATION PASS; PURE REPLAYS PREPARED',
    'scriptSha256': sha(pathlib.Path(__file__)),
    'inputPins': {str(p): digest for p, digest in pins.items()},
    'sourceFilesRehashed': {'v2': 588, 'v3': 589},
    'unchangedPredecessorMembers': 587,
    'added': added, 'changed': changed,
    'productionFilesUnchanged': 511,
    'registrationAndTestNameBytesUnchangedSha256': new[registration],
    'oldAndNewSelectorDifference': ['followup-start', 'followup-publication'],
    'oldCaptureOriginalAndPreservedRehashed': {'inner': 1948, 'outer': 3},
    'derivedPureScripts': derived,
    'toolchainRecoveryAccepted': False,
    'dependencyBaselineChanged': False,
    'nativeLaunches': 0, 'processProbes': 0,
    'limits': 'Declared predecessor dependency preimage preserved; shared-wrapper restoration/full toolchain audit remain root-owned and are not accepted by this source audit.',
}
p = R / 'metadata-source-v3-audit.json'
p.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'status': result['status'], 'auditSha256': sha(p), 'scriptSha256': result['scriptSha256'], 'derived': derived}))
