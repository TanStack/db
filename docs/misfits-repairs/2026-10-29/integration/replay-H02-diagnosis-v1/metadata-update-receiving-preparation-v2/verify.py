"""Read/hash exact receiving preflight; no receiving or process API execution.

Both clean discovery epochs are prerequisites. The original source gate,
clean-result judgment and native receiving supervisor remain unchanged.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREVIOUS = H / 'metadata-update-native-selector-preparation-v2'
PREVIOUS_BINDING = 'bdd159931e7c4603d30f5bec97ad1953257226bb3f93a24e24ea1dc76a97f4c6'
CLASSIFICATION = H / 'metadata-update-native-selector-root-classification-v2.json'
CLASSIFICATION_SHA = '4fd95de65589d512920a37f7ff92d90abdee1f54a9f265441bacc808ebb692d4'
ORIGINAL = H / 'metadata-update-native-preparation-v1'
OUTPUT = H / 'metadata-update-native-scope-default-q2-v2'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def previous_gate():
    require(digest(PREVIOUS / 'binding.json') == PREVIOUS_BINDING, 'accepted selector preparation binding changed')
    binding = json.loads((PREVIOUS / 'binding.json').read_text())
    require(digest(PREVIOUS / 'verify.py') == binding['files']['verify.py'], 'accepted selector gate changed before import')
    spec = importlib.util.spec_from_file_location('accepted_metadata_selector_gate', PREVIOUS / 'verify.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def read(path):
    return previous_gate().read(path)


def selector_paths(stage):
    require(stage == 'selector', 'only the accepted clean selector epoch is configured')
    return {'classification': CLASSIFICATION,
            'freeze': H / 'metadata-update-native-selector-result-freeze-v2.json',
            'return': H / 'metadata-update-native-selector-root-outer-return-v2.json',
            'absence': H / 'metadata-update-native-selector-root-absence-v2.json',
            'review': H / 'metadata-receiving-independent-review-v1/metadata-update-native-selector-actual-result-review-v2.md'}


def accepted_selector():
    require(digest(CLASSIFICATION) == CLASSIFICATION_SHA, 'accepted selector root classification changed')
    previous = previous_gate()
    checker = previous.previous_gate().source_gate()  # Original clean-result checker definitions.
    checker.classification_paths = selector_paths  # Exact epoch paths only; success judgment unchanged.
    return checker.verify_classification('selector', PREVIOUS_BINDING, read(PREVIOUS / 'recipes.json')), checker


def check_recipe(recipe, original, program):
    expected = copy.deepcopy(original)
    expected['freshOutputDirectory'] = str(OUTPUT)
    require(recipe == expected, 'receiving differs beyond fresh output path')
    require(recipe['receivingHistory'] == program['history'] and
            recipe['expectedFilterName'] == program['filterName'] and
            recipe['expectedDisplayName'] == program['displayName'] and
            recipe['testTimeoutMs'] == 60000 and recipe['innerReceivingBudget'] ==
            {'wallMs': 20000, 'groupRssBytes': 1073741824, 'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000},
            'canonical history/name or inherited limits changed')


def receipt_baseline(root=None):
    """Passive candidate inventory, never an artifact identity or selection rule."""
    if root is None:
        root = next((os.environ[key] for key in ['TMPDIR', 'TMP', 'TEMP'] if os.environ.get(key)), '/tmp')
    directory = Path(root).resolve()
    require(directory.is_dir(), 'receiving temporary-directory root unavailable')
    members = {}
    for path in directory.iterdir():
        if path.name.startswith('h02-progress-'):
            info = path.lstat()  # Do not follow an existing symlink into another directory.
            members[path.name] = {'device': info.st_dev, 'inode': info.st_ino,
                                  'mode': info.st_mode, 'mtimeNs': info.st_mtime_ns}
    require(len(members) <= 4096, 'passive receiving-directory candidate set needs bounded review')
    return {'status': 'PASSIVE PRELAUNCH CANDIDATES ONLY; no artifact selected',
            'temporaryRoot': str(directory), 'members': dict(sorted(members.items())),
            'selectionRequired': 'Unique canonical history/program/sourcefreeze and prepared/supervisor/receipt-writer identity agreement; never first new directory or mtime; stop if ambiguous'}


def verify(binding_sha, gate='source'):
    require(gate in ['source', 'receiving'], 'only exact receiving is prepared; no list/retry admission')
    require(digest(HERE / 'binding.json') == binding_sha, 'receiving preparation binding changed')
    previous = previous_gate()
    source = previous.previous_gate().source_gate()
    binding = source.read(HERE / 'binding.json')
    source.check_map(HERE, binding['files'], 'receiving preparation')
    prior = previous.verify(PREVIOUS_BINDING, 'source')  # Full unchanged source and clean universe gate.
    selector, _ = accepted_selector()
    recipes = source.read(HERE / 'recipes.json')
    require(set(recipes) == {'status', 'receiving'}, 'one exact receiving recipe required')
    program = source.read(ORIGINAL / 'program.json')
    check_recipe(recipes['receiving'], source.read(ORIGINAL / 'recipes.json')['receiving'], program)
    return {'status': 'READ/HASH RECEIVING PREFLIGHT ONLY; separate root exact runtime admission required',
            'gate': gate, 'bindingSha256': binding_sha,
            'identity': dict(prior['identity'], receivingRecipeSha256=digest(HERE / 'recipes.json'),
                             acceptedSelectorClassificationSha256=CLASSIFICATION_SHA),
            'priorClassifications': prior['priorClassifications'] + [selector],
            'canonicalProgram': program, 'nativeLaunches': 0, 'nativeProcessProbes': 0,
            'productPassCredit': False, 'receivingReachCredit': False,
            'limits': 'Direct eager source update after checked reload baseline; stable metadata values; no strict conflicting-cache progress or generated/mutant claim'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binding', required=True)
    parser.add_argument('--gate', choices=['source', 'receiving'], default='source')
    args = parser.parse_args()
    value = verify(args.binding, args.gate)
    if args.gate == 'receiving':
        value['receivingEvidenceBaseline'] = receipt_baseline()
    print(json.dumps(value, indent=2, sort_keys=True))
