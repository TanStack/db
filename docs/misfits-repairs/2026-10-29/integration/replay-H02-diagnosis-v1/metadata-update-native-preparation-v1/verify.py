"""Read/hash preflight and future result gates. No subprocess or process probe.

Discovery is collection evidence only. A later root classification consumes
preserved actual results; it never admits the next command automatically.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

HERE = Path(__file__).resolve().parent
H = HERE.parent
SOURCE = H / 'metadata-update-source-v2'
ROOT = SOURCE / 'sources'
ORIGINAL = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1')
OLD = ORIGINAL / 'docs/misfits-metadata-receiving-native-list-launcher-v1'
SOURCE_SHA = '4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a'
SOURCE_PACKET_SHA = '4c252d1d69103bc25ac527c1dde6c3f685295c50a936d6f9b69227eb75c7f8f2'
INVENTORY_SHA = 'c5cdea6b41d82b331435162ea06b9254be96acff7b7450be79e0c37690cb74b2'
OLD_LAUNCH_SHA = '9566ec6fe9fdace272d8e204e3a8c86e407f8da50f4ffc11f7d5961bdd07cfb2'
ORIGINAL_SHA = '888ff265816fe90252d1d4ad674ac98ac57c294c18498fb0b88277a687cd5a8a'
PYTHON = '/opt/homebrew/opt/python@3.14/bin/python3.14'
PYTHON_SHA = '87d4df53fd91304be5bac391fb204643c36b7df2023c04a0953bcbc7d4fdf634'
REVIEW = H / 'metadata-receiving-independent-review-v1/metadata-update-source-review-v2.md'
REVIEW_SHA = 'ec2b660912c85f5420e06b805567d51c51f99be996df6bf9098ab28bc019f61d'
ENV_UNSET = ['NODE_OPTIONS', 'NODE_PATH', 'TANSTACK_DB_ORACLE_SEED',
             'TANSTACK_DB_ORACLE_PATH', 'TANSTACK_DB_ORACLE_PROPERTY',
             'TANSTACK_DB_ORACLE_CALIBRATION', 'H02_PROGRESS_WORKER_HISTORY',
             'H02_PROGRESS_BINDING_DIR', 'H02_PROGRESS_SELECTED_ROOT',
             'H02_PROGRESS_RECEIPTS', 'H02_PROGRESS_SOURCE_FREEZE']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError(f'non-finite JSON constant: {value}')
    return json.loads(Path(path).read_text(encoding='utf-8'),
                      object_pairs_hook=pairs, parse_constant=bad_constant)


def regular_files(root):
    """Own regular payload names, excluding nested dependencies and symlinks."""
    names = set()
    for directory, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name != 'node_modules'
                          and not (Path(directory) / name).is_symlink()]
        for name in files:
            path = Path(directory) / name
            if path.is_file() and not path.is_symlink():
                names.add(str(path.relative_to(root)))
    return names


def check_map(root, mapping, label):
    for name, expected in mapping.items():
        require(not Path(name).is_absolute() and '..' not in Path(name).parts,
                f'unsafe {label} member: {name}')
        path = root / name
        require(path.is_file() and not path.is_symlink() and digest(path) == expected,
                f'{label} changed: {name}')


def merged_maps(source):
    merged = {}
    for key in ['productionFiles', 'receivingProductionFiles', 'instrumentFiles', 'sharedInstrumentFiles']:
        for name, expected in source[key].items():
            require(name not in merged or merged[name] == expected, 'conflicting source maps')
            merged[name] = expected
    return merged


def supervisor():
    require(digest(OLD / 'launch.py') == OLD_LAUNCH_SHA, 'original supervisor changed before import')
    spec = importlib.util.spec_from_file_location('frozen_metadata_list_supervisor', OLD / 'launch.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # Definitions only; no old execute/verify_inputs.
    return module


def check_recipes(recipes, program, source):
    required = read(SOURCE / 'required-native-recipes.json')
    # Exact source-v2 recipes are authoritative; only fresh output names change.
    original_universe = required['list']
    for stage in ['universe', 'selector']:
        recipe = recipes[stage]
        require(recipe['executable'] == source['node']['executable'] and recipe['cwd'] == str(ROOT),
                f'{stage} executable/source root changed')
        require(recipe['order'] == 0 and recipe['maxWorkers'] == 1 and
                recipe['fileParallelism'] is False and recipe['workerNodeHeapMiB'] == 384 and
                recipe['outerWallContainmentMs'] == 30000 and
                recipe['groupRssContainmentBytes'] == 1073741824 and recipe['envUnset'] == ENV_UNSET,
                f'{stage} limits/environment changed')
        out = H / ('metadata-update-native-discovery-v1' if stage == 'universe'
                   else 'metadata-update-native-selector-v1')
        for key in ['stdoutPath', 'stderrPath']:
            require(Path(recipe[key]) == out / ('stdout.log' if key == 'stdoutPath' else 'stderr.log'),
                    f'{stage} log path changed')
        require(Path(recipe['expectedOutput']['path']) == out / 'names.json', 'native JSON path changed')
        require(recipe['expectedOutput']['module'] == str(ROOT / 'packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts'),
                'native module changed')
        argv = [f'--json={out / "names.json"}' if value.startswith('--json=') else value
                for value in original_universe['argv']]
        if stage == 'selector':
            argv += ['-t', '^' + re.escape(program['filterName']) + '$']
        require(recipe['argv'] == argv, f'{stage} argv changed beyond output path')
        names = original_universe['expectedNames'] if stage == 'universe' else [program['displayName']]
        require(recipe['expectedOutput']['names'] == names and
                recipe['expectedOutput']['count'] == len(names),
                f'{stage} expected display universe changed')
    receiving = recipes['receiving']
    original = next(r for r in required['receiving'] if r['id'] == 'followup-scope-default-q2')
    for key in ['argv', 'cwd', 'executable', 'envUnset', 'envSet', 'expectedFilterName',
                'expectedDisplayName', 'testTimeoutMs', 'innerReceivingBudget', 'receivingHistory', 'property']:
        require(receiving[key] == original[key], f'receiving inherited field changed: {key}')
    require(receiving['freshOutputDirectory'] == str(H / 'metadata-update-native-scope-default-q2-v1'),
            'receiving output changed')
    require(receiving['receivingHistory'] == program['history'] and
            receiving['expectedFilterName'] == program['filterName'] and
            receiving['expectedDisplayName'] == program['displayName'], 'selected program changed')
    require(recipes['selector']['argv'][-1] == '^' + re.escape(program['filterName']) + '$' and
            program['displayName'] != program['filterName'], 'display/filter distinction changed')


def verify_inputs(binding_sha):
    require(digest(HERE / 'binding.json') == binding_sha, 'preparation binding changed')
    binding = read(HERE / 'binding.json')
    require(sys.executable == PYTHON and digest(PYTHON) == PYTHON_SHA, 'Python interpreter changed')
    check_map(HERE, binding['files'], 'preparation')
    for name, expected in binding['externalInputs'].items():
        require(digest(name) == expected, f'preserved provenance input changed: {name}')
    require(digest(SOURCE / 'packet-manifest.json') == SOURCE_PACKET_SHA, 'source packet manifest changed')
    manifest = read(SOURCE / 'packet-manifest.json')
    require({p.name for p in SOURCE.iterdir() if p.is_file()} ==
            set(manifest['artifacts']) | {'packet-manifest.json'}, 'source packet artifact set changed')
    for name, item in manifest['artifacts'].items():
        path = SOURCE / name
        require(path.stat().st_size == item['bytes'] and digest(path) == item['sha256'],
                f'source packet artifact changed: {name}')
    require(digest(REVIEW) == REVIEW_SHA, 'accepted source review changed')
    require(digest(SOURCE / 'source-freeze.json') == SOURCE_SHA and
            digest(SOURCE / 'source-inventory.json') == INVENTORY_SHA, 'source freeze/inventory changed')
    source = read(SOURCE / 'source-freeze.json')
    inventory = read(SOURCE / 'source-inventory.json')
    require(len(inventory) == 588 and regular_files(ROOT) == set(inventory), '588 source member set changed')
    links = set()
    for directory, directories, files in os.walk(ROOT, followlinks=False):
        for name in directories + files:
            path = Path(directory) / name
            if path.is_symlink():
                links.add(str(path.relative_to(ROOT)))
        directories[:] = [name for name in directories if not (Path(directory) / name).is_symlink()]
    require(links == set(source['dependencyReuseLinks']), 'source symlink member set changed')
    check_map(ROOT, inventory, 'successor source')
    require(source['worktree'] == str(ROOT) and source['sourceInventorySha256'] == INVENTORY_SHA,
            'source location/inventory binding changed')
    require(digest(source['parentSourceFreeze']) == ORIGINAL_SHA and
            source['parentSourceFreezeSha256'] == ORIGINAL_SHA, 'original freeze changed')
    original = read(source['parentSourceFreeze'])
    merged = merged_maps(original)
    require(len(merged) == 573 and len(source['productionFiles']) == 511 and
            source['productionFiles'] == original['productionFiles'], 'source/production epoch changed')
    check_map(ORIGINAL, merged, 'original source')
    check_map(ROOT, source['productionFiles'], 'production')
    check_map(ROOT, merged_maps(source), 'successor frozen maps')
    payload_count = 0
    require(source['packages'] == original['packages'] and source['lockfiles'] == original['lockfiles'] and
            source['node'] == original['node'], 'dependency/runtime epoch changed')
    for item in source['packages'].values():
        require(str((ROOT / item['logical']).resolve()) == item['resolved'], 'package resolution changed')
        base = Path(item['resolved'])
        require(regular_files(base) == set(item['regularPayloadFilesMap']), 'dependency own payload set changed')
        check_map(base, item['regularPayloadFilesMap'], 'dependency payload')
        payload_count += len(item['regularPayloadFilesMap'])
    require(payload_count == 2544, 'dependency payload count changed')
    for name, item in source['dependencyReuseLinks'].items():
        path = ROOT / name
        require(path.is_symlink() == item['isSymlink'] and str(path.resolve()) == item['resolved'],
                f'dependency reuse link changed: {name}')
    require(len(source['dependencyReuseLinks']) == 4, 'reuse link count changed')
    require(digest(source['node']['executable']) == source['node']['sha256'], 'Node binary changed')
    require(digest(ROOT / 'pnpm-lock.yaml') == source['lockfiles']['repoPnpmLock'] and
            digest(ROOT / 'node_modules/.pnpm/lock.yaml') == source['lockfiles']['installedPnpmLock'],
            'lockfile changed')
    require(digest(OLD / 'launch.py') == OLD_LAUNCH_SHA, 'original list supervisor changed')
    supervisor().verify_packet(OLD, 'f08445559a9e558843c278e2222ab37cdfff23cfa842271570a1e49d423dda57')
    program = read(HERE / 'program.json')
    encoded = json.dumps(program['history'], sort_keys=True, separators=(',', ':')).encode()
    require(hashlib.sha256(encoded).hexdigest() == program['canonicalProgramSha256'], 'program identity changed')
    finalizer = program['perHistoryFinalizer']
    for path_key, sha_key in [('definition', 'definitionSha256'), ('callSite', 'callSiteSha256')]:
        require(inventory[finalizer[path_key]] == finalizer[sha_key], 'per-history finalizer source changed')
    require(len(program['requiredReachStates']) == len(set(program['requiredReachStates'])) == 31,
            'required reach state set changed')
    recipes = read(HERE / 'recipes.json')
    check_recipes(recipes, program, source)
    return recipes, {'successorSourceFiles': 588, 'originalSourceFiles': 573, 'productionFiles': 511,
                     'namedDependencyOwnPayloads': payload_count, 'dependencyReuseLinks': 4,
                     'sourceFreezeSha256': SOURCE_SHA, 'sourceInventorySha256': INVENTORY_SHA,
                     'canonicalProgramSha256': program['canonicalProgramSha256'],
                     'perHistoryFinalizer': finalizer, 'nativeLaunches': 0, 'nativeProcessProbes': 0}


def classification_paths(stage):
    require(stage in ['universe', 'selector'], 'unknown result stage')
    label = 'discovery' if stage == 'universe' else 'selector'
    stem = f'metadata-update-native-{label}'
    return {'classification': H / f'{stem}-root-classification-v1.json',
            'freeze': H / f'{stem}-result-freeze-v1.json',
            'return': H / f'{stem}-root-outer-return-v1.json',
            'absence': H / f'{stem}-root-absence-v1.json',
            'review': H / f'metadata-receiving-independent-review-v1/{stem}-actual-result-review-v1.md'}


def verify_classification(stage, binding_sha, recipes):
    """Consumes future ROOT-authored evidence, never creates it or probes PIDs."""
    paths = classification_paths(stage)
    c = read(paths['classification'])
    require(c['classifiedBy'] == '/root' and c['boundedAccepted'] is True and
            c['newRuntimeAdmitted'] is False and c['stage'] == stage and
            c['bindingSha256'] == binding_sha and c['sourceFreezeSha256'] == SOURCE_SHA,
            'missing exact bounded root classification')
    for key, field in [('freeze', 'resultFreezeSha256'), ('return', 'actualOuterReturnSha256'),
                       ('absence', 'rootAbsenceSha256'), ('review', 'independentReviewSha256')]:
        require(digest(paths[key]) == c[field], f'classified {key} changed')
    require(c['independentActualResultAccepted'] is True and c['productPassCredit'] is False and
            c['receivingReachCredit'] is False, 'discovery cannot supply product/receiving credit')
    freeze = read(paths['freeze'])
    out = Path(recipes[stage]['expectedOutput']['path']).parent
    require(freeze['bindingSha256'] == binding_sha and freeze['sourceFreezeSha256'] == SOURCE_SHA and
            freeze['outputDirectory'] == str(out), 'result freeze belongs to another epoch/output')
    require({p.name for p in out.iterdir()} == set(freeze['assets']), 'actual output file set changed')
    for name, expected in freeze['assets'].items():
        require(Path(name).name == name, 'result asset escapes output')
        path = out / name
        require(stat.S_ISREG(path.lstat().st_mode) and path.stat().st_nlink == 1 and digest(path) == expected,
                f'actual result changed: {name}')
    outer = read(out / 'outer-final.receipt.json')
    child = read(out / '00-final.receipt.json')
    actual = read(paths['return'])
    require(actual['actualOuterExitCode'] == 0 and actual['completionToolReturn']['exit_code'] == 0,
            'actual outer completion not zero')
    require(outer['status'] == 'qualified' and outer['stage'] == stage and
            outer['bindingSha256'] == binding_sha and outer['primaryFailure'] is None and
            outer['secondaryFailures'] == [] and len(outer['completedRecipes']) == 1 and
            outer['identityAfter'] == outer['identityBefore'], 'outer was not fully qualified/rechecked')
    require(child['phase'] == 'final' and child['bindingSha256'] == binding_sha and
            child['recipeId'] == recipes[stage]['id'] and child['exitCode'] == 0 and
            child['pgidVerified'] is True and child['remainingGroupRows'] == [] and
            child['killAttempts'] == [] and child['primaryFailure'] is None and child['secondaryFailures'] == [],
            'original child containment/return not clean')
    state = {key: value for key, value in child.items() if key not in ['phase', 'bindingSha256']}
    returned = outer['completedRecipes'][0]
    # The inherited supervisor samples elapsedMs again while writing the final
    # receipt. Preserve both measurements; do not require equal clock samples.
    require({k: v for k, v in returned.items() if k != 'elapsedMs'} ==
            {k: v for k, v in state.items() if k != 'elapsedMs'} and
            type(returned['elapsedMs']) is int and type(state['elapsedMs']) is int and
            0 <= returned['elapsedMs'] <= state['elapsedMs'], 'outer and child final state disagree')
    require(actual['outerPid'] == outer['outerPid'] and actual['outerPgid'] == outer['outerPgid'],
            'actual outer identity differs')
    absence = read(paths['absence'])
    expected_probes = [('outer', 'pid', outer['outerPid'], 'empty-ESRCH'),
                       ('outer', 'pgid', outer['outerPgid'], 'empty-ESRCH'),
                       ('child', 'pid', child['pid'], 'empty-ESRCH'),
                       ('child', 'pgid', child['pgid'], 'empty-ESRCH')]
    require([(p['participant'], p['kind'], p['identity'], p['status']) for p in absence['probes']] ==
            expected_probes and all(type(p[2]) is int and p[2] > 0 for p in expected_probes) and
            child['pid'] == child['pgid'], 'original identity absence unestablished')
    qualified = supervisor().qualify_output(recipes[stage])
    require(qualified == child['qualification'], 'actual list qualification changed')
    return {'stage': stage, 'classificationSha256': digest(paths['classification']),
            'resultFreezeSha256': c['resultFreezeSha256'], 'nativeNames': qualified['count'],
            'productPassCredit': False, 'receivingReachCredit': False}


def verify(binding_sha, gate='source'):
    recipes, identity = verify_inputs(binding_sha)
    gates = []
    if gate in ['selector', 'receiving']:
        gates.append(verify_classification('universe', binding_sha, recipes))
    if gate == 'receiving':
        gates.append(verify_classification('selector', binding_sha, recipes))
    require(gate in ['source', 'universe', 'selector', 'receiving'], 'unknown preflight gate')
    return {'status': 'READ/HASH PREFLIGHT ONLY; separate root one-shot admission required',
            'gate': gate, 'bindingSha256': binding_sha, 'identity': identity, 'priorClassifications': gates,
            'nativeLaunches': 0, 'nativeProcessProbes': 0, 'productPassCredit': False,
            'receivingReachCredit': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binding', required=True)
    parser.add_argument('--gate', choices=['source', 'universe', 'selector', 'receiving'], default='source')
    args = parser.parse_args()
    print(json.dumps(verify(args.binding, args.gate), indent=2, sort_keys=True))
