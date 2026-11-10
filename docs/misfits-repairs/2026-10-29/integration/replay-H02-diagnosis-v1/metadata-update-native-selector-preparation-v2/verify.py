"""Read/hash selector gate bound to the accepted clean fresh universe.

Reuse both the complete source gate and original clean-result checker. Only
the checker's path provider is configured to the fixed v2 accepted epoch.
No original failure is exempted; no receiving stage exists here.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREVIOUS = H / 'metadata-update-native-preparation-v2'
PREVIOUS_BINDING = '86ccd3bf644d96f43e726f1e805c4b8850754707b7bb88c48ccd802cd90bd7b9'
CLASSIFICATION = H / 'metadata-update-native-discovery-root-classification-v2.json'
CLASSIFICATION_SHA = '2b07505ca12860a16210c4c6c4d6cb129224ee41d4e2d0b9de0596d935d5ba26'
OUTPUT = H / 'metadata-update-native-selector-v2'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def previous_gate():
    require(digest(PREVIOUS / 'binding.json') == PREVIOUS_BINDING, 'accepted universe binding changed')
    binding = json.loads((PREVIOUS / 'binding.json').read_text())
    require(digest(PREVIOUS / 'verify.py') == binding['files']['verify.py'], 'accepted source gate changed before import')
    spec = importlib.util.spec_from_file_location('accepted_metadata_source_gate', PREVIOUS / 'verify.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def read(path):
    return previous_gate().read(path)


def supervisor():
    return previous_gate().supervisor()


def universe_paths(stage):
    require(stage == 'universe', 'only the accepted fresh universe epoch is configured')
    return {'classification': CLASSIFICATION,
            'freeze': H / 'metadata-update-native-discovery-result-freeze-v2.json',
            'return': H / 'metadata-update-native-discovery-root-outer-return-v2.json',
            'absence': H / 'metadata-update-native-discovery-root-absence-v2.json',
            'review': H / 'metadata-receiving-independent-review-v1/metadata-update-native-discovery-actual-result-review-v2.md'}


def accepted_universe():
    require(digest(CLASSIFICATION) == CLASSIFICATION_SHA, 'accepted fresh root classification changed')
    previous = previous_gate()
    checker = previous.source_gate()  # Original frozen verifier definitions.
    checker.classification_paths = universe_paths  # Fixed epoch configuration only; judgment unchanged.
    recipes = read(PREVIOUS / 'recipes.json')
    result = checker.verify_classification('universe', PREVIOUS_BINDING, recipes)
    return result, checker


def check_recipe(recipe, universe, program):
    expected = copy.deepcopy(universe)
    expected['id'] = 'metadata-update-scope-default-q2-selector-v2'
    expected['argv'] = [f'--json={OUTPUT / "names.json"}' if arg.startswith('--json=') else arg
                        for arg in universe['argv']] + ['-t', '^' + re.escape(program['filterName']) + '$']
    expected['stdoutPath'] = str(OUTPUT / 'stdout.log')
    expected['stderrPath'] = str(OUTPUT / 'stderr.log')
    expected['expectedOutput'].update(path=str(OUTPUT / 'names.json'), count=1, names=[program['displayName']])
    require(universe['expectedOutput']['names'].count(program['displayName']) == 1 and
            program['filterName'] != program['displayName'], 'singleton/display/filter identity missing')
    require(recipe == expected, 'selector differs beyond exact selected filter/count/name and fresh identity/output')


def verify(binding_sha, gate='source'):
    require(gate in ['source', 'selector'], 'only singleton discovery is prepared; no universe/receiving admission')
    require(digest(HERE / 'binding.json') == binding_sha, 'selector binding changed')
    previous = previous_gate()
    source = previous.source_gate()
    binding = source.read(HERE / 'binding.json')
    source.check_map(HERE, binding['files'], 'selector preparation')
    source_preflight = previous.verify(PREVIOUS_BINDING, 'source')  # Complete existing preflight unchanged.
    classified, _ = accepted_universe()  # Requires actual outer0/qualified/native0 and captured absence.
    recipes = source.read(HERE / 'recipes.json')
    require(set(recipes) == {'status', 'selector'}, 'exactly one selector recipe required')
    universe = source.read(PREVIOUS / 'recipes.json')['universe']
    program = source.read(previous.PREVIOUS / 'program.json')
    check_recipe(recipes['selector'], universe, program)
    return {'status': 'READ/HASH SELECTOR PREFLIGHT ONLY; separate root runtime admission required',
            'gate': gate, 'bindingSha256': binding_sha,
            'identity': dict(source_preflight['identity'], selectorRecipeSha256=digest(HERE / 'recipes.json'),
                             acceptedFreshUniverseClassificationSha256=CLASSIFICATION_SHA),
            'priorClassifications': [classified], 'nativeLaunches': 0, 'nativeProcessProbes': 0,
            'productPassCredit': False, 'receivingReachCredit': False,
            'successRequirements': 'fresh actual outer0/qualified/native0, exactly one intended display name/module; receiving remains separate'}
