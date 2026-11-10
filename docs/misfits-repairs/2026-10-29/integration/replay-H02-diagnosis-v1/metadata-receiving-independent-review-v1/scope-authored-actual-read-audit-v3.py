"""Reuse the read-only asset/provenance audit with explicit run-identity changes."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WT = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1')
template = HERE / 'scope-default-actual-read-audit-v3.py'
assert hashlib.sha256(template.read_bytes()).hexdigest() == '2ceb8c09690fe4e59f31f76f570f486287499cd675870c269da6ec533b3cb581'
source = template.read_text()
changes = {
    'scope-default': 'scope-authored',
    '6ab1f9d725a91919bdedc45cc92c869bce2ddcf4b3d290e81a5bb40300d4841b': '35d3ad5412fcd90b67616ada1f8fe66e7909d1796ccd907caf344c65a7662465',
    'f851652a162b43b73f455493d107c0ea030ff13c7cdb6b120fb3bba2ec02d82a': '3faf85281638e92183944d93b6db9e2fc0effb0d354dc043e2c71463a48982e7',
    '32210': '45952',
    '32152': '45936',
    '32195': '45951',
    '453509120': '482443264',
    '2688': '2333',
    '21330': '24696',
    "['cells'][0]": "['cells'][1]",
}
for old, new in changes.items():
    assert old in source, old
    source = source.replace(old, new)

classification = WT / 'docs/misfits-metadata-scope-default-root-classification-v3.json'
assert hashlib.sha256(classification.read_bytes()).hexdigest() == '860fd21b4d5a792b8484c68e6dae5287a81ed3ab40755cc3188ff09457171a54'
assert json.loads(classification.read_text())['boundedAccepted'] is True
admission = json.loads((WT / 'docs/misfits-metadata-scope-authored-root-admission-v3.json').read_text())
assert admission['precedingRootClassificationSha256'] == hashlib.sha256(classification.read_bytes()).hexdigest()
assert admission['maxInvocations'] == 1 and admission['allFollowingRuntimeUnadmitted'] is True

output = WT / 'docs/misfits-metadata-receiving-runtime-v3/scope-authored'
native = output / 'receiving-artifacts'
raw = [json.loads(line) for line in (native / 'receipts.jsonl').read_text().splitlines()]
by_sequence = {r['sequence']: r for r in raw}
history = json.loads((native / 'history.json').read_text())
assert history == {'kind':'query','scheduler':'microtask','cacheIdentity':'scope','includes':True,'window':True,'nonemptyPrior':True,'keyShift':0,'rankScale':10,'metadataKeys':'authored'}
identities = by_sequence[4]
assert identities['keyLane'] == 'authored'
assert len({identities['sourceId'],identities['rootId'],identities['downstreamId']}) == 3

# Concrete raw-record inspection for this run; this does not define an oracle
# or claim coverage beyond the already executed independent shared judgment.
def expected(row_id, layer):
    row = {'id':row_id,'rank':row_id*10,'markers':[],
        '$hasPendingWrites':False,'$origin':'remote',
        '$key':f'metadata-{layer}-{row_id}',
        '$collectionId':identities['rootId' if layer == 'root' else 'downstreamId']}
    if layer == 'downstream':
        row.update(observedKey=f'metadata-root-{row_id}',observedCollectionId=identities['rootId'],observedOrigin='remote',observedPending=False)
    return row

for sequence, row_id in [(87,4),(134,4),(160,3)]:
    event = by_sequence[sequence]
    for layer, rows_name, entries_name in [('root','rows','entries'),('downstream','downstream','downstreamEntries')]:
        row = expected(row_id,layer)
        assert event[rows_name] == [row]
        assert event[entries_name] == [[row['$key'],row]]
for sequence, layer in [(158,'root'),(159,'downstream')]:
    event = by_sequence[sequence]
    row = expected(3,layer)
    assert event['rows'] == [row] and event['entries'] == [[row['$key'],row]]
    changes_by_type = {c['type']:c for c in event['changes']}
    assert len(event['changes']) == len(changes_by_type) == 2
    for kind, row_id in [('insert',3),('delete',4)]:
        value = expected(row_id,layer)
        assert changes_by_type[kind] == {'type':kind,'key':value['$key'],'value':value}
assert by_sequence[159]['upstreamEntries'] == [[expected(3,'root')['$key'],expected(3,'root')]]

# The original frozen audit remains unchanged. Only fixed run identities and
# the declared cell index differ; all hash/raw/provenance/cleanup checks run.
exec(compile(source,str(template),'exec'),{'__file__':str(Path(__file__).resolve())})
