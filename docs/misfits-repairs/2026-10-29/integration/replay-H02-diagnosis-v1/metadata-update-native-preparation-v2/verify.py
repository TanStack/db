"""Fresh-universe read/hash adapter. No stopped-result success exemption.

The unchanged complete source preflight owns all 588 sources/runtime inputs.
The new recipe differs only by accepted four-name display correction and fresh
identity/output paths. No selector or receiving stage is prepared or admitted.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREVIOUS = H / 'metadata-update-native-preparation-v1'
CORRECTION = H / 'metadata-update-native-display-correction-v1'
OUTPUT = H / 'metadata-update-native-discovery-v2'
PREVIOUS_BINDING = 'f76ca819782079460124aa2fba14dc203362e5c3a03a435a5d7d30bbdab4ba65'
CORRECTION_MANIFEST = 'c2445689e8fb7f5e931d490487a0eff0ef2b3e17173388ebd25bbbf18c277b4d'
CORRECTION_REVIEW = H / 'metadata-receiving-independent-review-v1/metadata-native-display-correction-review-v1.md'
CORRECTION_REVIEW_SHA = '7a67cd9bae25c9ed49b4135ebafa985e2af24768faaa1e2a37cd553b0b632e05'
STOPPED = H / 'metadata-update-native-discovery-root-stopped-classification-v1.json'
STOPPED_SHA = 'c89e2e1a2663edae0c4d7c984f62830466b66b6dc96f6dc82bd8bbe150f7e118'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_gate():
    require(digest(PREVIOUS / 'binding.json') == PREVIOUS_BINDING, 'original source binding changed')
    binding = json.loads((PREVIOUS / 'binding.json').read_text())
    require(digest(PREVIOUS / 'verify.py') == binding['files']['verify.py'], 'original source gate changed before import')
    spec = importlib.util.spec_from_file_location('frozen_metadata_source_preflight', PREVIOUS / 'verify.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def read(path):
    return source_gate().read(path)


def supervisor():
    return source_gate().supervisor()


def check_recipe(recipe, corrected):
    expected = copy.deepcopy(corrected)
    expected['id'] = 'metadata-update-native20-discovery-v2'
    expected['argv'] = [f'--json={OUTPUT / "names.json"}' if arg.startswith('--json=') else arg
                        for arg in expected['argv']]
    expected['expectedOutput']['path'] = str(OUTPUT / 'names.json')
    expected['stdoutPath'] = str(OUTPUT / 'stdout.log')
    expected['stderrPath'] = str(OUTPUT / 'stderr.log')
    require(recipe == expected, 'fresh universe differs beyond accepted display correction and fresh identity/output')


def verify(binding_sha, gate='source'):
    require(gate in ['source', 'universe'], 'only fresh universe is prepared; no selector/receiving admission')
    require(digest(HERE / 'binding.json') == binding_sha, 'fresh universe binding changed')
    binding = read(HERE / 'binding.json')
    source = source_gate()
    source.check_map(HERE, binding['files'], 'fresh universe preparation')
    original_recipes, identity = source.verify_inputs(PREVIOUS_BINDING)  # Unchanged full 588-source preflight.
    require(digest(CORRECTION / 'packet-manifest.json') == CORRECTION_MANIFEST and
            digest(CORRECTION_REVIEW) == CORRECTION_REVIEW_SHA, 'accepted display correction changed')
    manifest = read(CORRECTION / 'packet-manifest.json')
    require({p.name for p in CORRECTION.iterdir()} == set(manifest['artifacts']) | {'packet-manifest.json'},
            'display-correction packet member set changed')
    for name, item in manifest['artifacts'].items():
        path = CORRECTION / name
        require(stat.S_ISREG(path.lstat().st_mode) and path.stat().st_size == item['bytes'] and
                digest(path) == item['sha256'], 'accepted display-correction bytes changed')
    corrected = read(CORRECTION / 'corrected-universe-recipe.json')
    expected = copy.deepcopy(original_recipes['universe'])
    expected['expectedOutput']['names'] = [name[:-1] + '+0' if name.endswith('quarter 0') else name
                                         for name in expected['expectedOutput']['names']]
    require(corrected == expected, 'correction changed more than accepted four expected display names')
    recipes = read(HERE / 'recipes.json')
    require(set(recipes) == {'status', 'universe'}, 'fresh namespace must contain one universe recipe only')
    check_recipe(recipes['universe'], corrected)
    # Provenance only. This never makes the old stopped result successful.
    require(digest(STOPPED) == STOPPED_SHA, 'original honest stopped classification changed')
    stopped = read(STOPPED)
    require(stopped['classifiedBy'] == '/root' and stopped['boundedAccepted'] is False and
            stopped['newRuntimeAdmitted'] is False and stopped['actualOuterExitCode'] == 1 and
            stopped['nativeChildExitCode'] == 0,
            'original observed outer1/child0 changed')
    for key in ['resultFreeze', 'independentActualReview']:
        require(digest(stopped[key]['path']) == stopped[key]['sha256'], 'original stopped evidence changed')
    result = read(stopped['resultFreeze']['path'])
    raw = Path(result['outputDirectory'])
    require({p.name for p in raw.iterdir()} == set(result['assets']), 'original stopped raw file set changed')
    for name, expected in result['assets'].items():
        require(Path(name).name == name and stat.S_ISREG((raw / name).lstat().st_mode) and
                digest(raw / name) == expected, 'original stopped raw bytes changed')
    for suffix, key in [('root-outer-return', 'actualOuterReturnSha256'), ('root-absence', 'rootAbsenceSha256'),
                        ('source-recheck', 'sourceRecheckSha256'), ('name-difference', 'nameDifferenceSha256')]:
        require(digest(H / f'metadata-update-native-discovery-{suffix}-v1.json') == result[key],
                'original stopped external evidence changed')
    return {'status': 'READ/HASH FRESH UNIVERSE PREFLIGHT ONLY; no runtime admission or result',
            'gate': gate, 'bindingSha256': binding_sha,
            'identity': dict(identity, freshRecipeSha256=digest(HERE / 'recipes.json'),
                             acceptedDisplayCorrectionReviewSha256=CORRECTION_REVIEW_SHA),
            'priorClassifications': [], 'productPassCredit': False, 'receivingReachCredit': False,
            'nativeLaunches': 0, 'nativeProcessProbes': 0,
            'successRequirements': 'fresh clean qualified outer with actual exit0 and child0; original stopped result never substituted'}
