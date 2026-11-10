"""Read/hash and pure recipe audit. Does not execute the inert launcher."""

import copy
import hashlib
import importlib.util
import json
import pathlib
import re
import shlex

R = pathlib.Path(__file__).resolve().parent
H = R.parent
P = H / 'metadata-update-receiving-preparation-v3'
OLD = H / 'metadata-update-receiving-preparation-v2'
SOURCE = H / 'metadata-update-source-v3'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p):
    return json.loads(p.read_text())


def check(condition, label):
    if not condition:
        raise AssertionError(label)


pins = {
    P / 'binding.json': '710cea233b1d57bdf9aeda39ea6fcadc317bfa0dd8d482776af30c6d07c02470',
    P / 'packet-manifest.json': 'b541cc7f75830a6d9bb12eb8f174a792c31b532b53912f18f8584c111160bd43',
    SOURCE / 'source-freeze.json': 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd',
    SOURCE / 'source-inventory.json': '3c8ece36701d450758587bd16dbf691b5e700668bc0be32ae2f20af8bc8bfb84',
    R / 'metadata-source-v3-independent-review.md': 'a07ed61feca7172165fb6d2489ce9d255fe160d761464152827f2dd584efd9f2',
    OLD / 'binding.json': 'ec925ca31d325cadf8a28e597c1d6ea0185fe79b0e1d4ef8b97b5333e0f5f238',
    OLD / 'verify.py': 'e7d4fab7945dfe254f36c24792ddf56b7beef355275f048f725a53bef4c535ab',
}
for p, digest in pins.items():
    check(sha(p) == digest, f'pinned identity: {p.name}')
manifest = read(P / 'packet-manifest.json')
for relative, record in manifest['artifacts'].items():
    p = P / relative
    check(p.stat().st_size == record['bytes'] and sha(p) == record['sha256'], f'frozen preparation member: {relative}')
binding = read(P / 'binding.json')
for relative, digest in binding['files'].items():
    check(sha(P / relative) == digest, f'bound preparation source: {relative}')

recipe = read(P / 'recipes.json')['receiving']
prior = read(OLD / 'recipes.json')['receiving']
expected = copy.deepcopy(prior)
expected['cwd'] = str(SOURCE / 'sources')
expected['envSet']['H02_PROGRESS_SOURCE_FREEZE'] = str(SOURCE / 'source-freeze.json')
output = H / 'metadata-update-native-scope-default-q2-v3'
expected['freshOutputDirectory'] = str(output)
check(recipe == expected, 'exact three-field recipe rebind')
check(not output.exists() and not output.is_symlink(), 'fresh output absent, including no dangling symlink')
canonical = hashlib.sha256(json.dumps(recipe['receivingHistory'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
check(canonical == binding['canonicalProgramSha256'] == 'bb837d81114314f37f2d8383f471aedbd3d2a3350c84db4075a5d3b79247b213', 'same canonical program')
check(re.fullmatch(recipe['argv'][-1], recipe['expectedFilterName']) is not None, 'anchored exact filter matches prior selected name')
check(recipe['innerReceivingBudget'] == {'wallMs': 20000, 'groupRssBytes': 1073741824, 'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000} and recipe['testTimeoutMs'] == 60000, 'operational containment unchanged')

old_launcher = (OLD / 'launcher-scope-default-q2.zsh').read_text()
launcher = (P / 'launcher-scope-default-q2.zsh').read_text()
for a, b in [('metadata-update-source-v2', 'metadata-update-source-v3'), ('metadata-update-receiving-preparation-v2', 'metadata-update-receiving-preparation-v3'), ('metadata-update-native-scope-default-q2-v2', 'metadata-update-native-scope-default-q2-v3')]:
    old_launcher = old_launcher.replace(a, b)
check(launcher == old_launcher, 'launcher exact equality after only three epoch path substitutions')
exec_lines = [line for line in launcher.splitlines() if line.startswith('exec ')]
check(len(exec_lines) == 1, 'one inert launcher exec')
tokens = shlex.split(exec_lines[0])
expected_tokens = ['exec', 'env']
for name in recipe['envUnset']:
    expected_tokens += ['-u', name]
expected_tokens += [k + '=' + v for k, v in recipe['envSet'].items()]
expected_tokens += [recipe['executable']] + recipe['argv']
expected_tokens += ['>', str(output / 'outer-vitest.log'), '2>&1']
check(tokens == expected_tokens, 'inert launcher exec argv/env/filter/redirection equal structured recipe')
check('mkdir -m 700 ' + str(output) in launcher, 'non-reusing output creation retained')
check(str(P / 'verify.py') + ' --binding "$1" --gate receiving' in launcher, 'bound receiving preflight before exec')

first = read(P / 'first-command.json')
check(first['executable'] == '/bin/zsh' and first['argv'] == [str(P / 'launcher-scope-default-q2.zsh'), sha(P / 'binding.json')] and first['cwd'] == str(H), 'exact first-command entry/binding')
check(first['maxInvocations'] == 1 and first['sourceFreezeSha256'] == sha(SOURCE / 'source-freeze.json'), 'one-shot exact source binding')
check(first['sourceReviewSha256'] == sha(R / 'metadata-source-v3-independent-review.md'), 'accepted source review binding')
check('separate root outer supervision/return required' in first['executionRequirement'], 'separate existing outer supervision remains required')
inventory = read(SOURCE / 'source-inventory.json')
check(len(inventory) == 589, '589 source identity')
for relative, digest in inventory.items():
    check(sha(SOURCE / 'sources' / relative) == digest, f'current reviewed source: {relative}')
prefix = 'packages/query-db-collection/tests/'
check(inventory[prefix + 'queued-answer-metadata-oracle.test.ts'] == '3d47cc699d4ceb04c8d23f0438e4995ea62b9f1ae23c5e6c386cdd47182f669e', 'registration/name/finalizer callsite byte identity')
check(inventory[prefix + 'queued-answer-metadata-oracle.ts'] == 'b965769c351c3d4bd563df915ad052ab3ecb0c3cc85559ff38c02916faae2cca', 'metadata finalizer definition byte identity')

calibration_path = R / 'metadata-receiving-prep-v3-calibration-replayed.json'
preflight_path = R / 'metadata-receiving-prep-v3-preflight-replayed.json'
check(calibration_path.read_bytes() == (P / 'pure-results.json').read_bytes(), 'independent recipe calibration exact output')
check(preflight_path.read_bytes() == (P / 'source-preparation-preflight.json').read_bytes(), 'independent inherited read/hash preflight exact output')
preflight = read(preflight_path)
check(preflight['sourceEquivalence']['successorSourceMembers'] == 589 and preflight['canonicalProgram']['canonicalProgramSha256'] == canonical, 'preflight source/program binding')
check(len(preflight['priorAcceptedDiscovery']) == 2, 'both prior accepted discovery classifications retained')
check(preflight['nativeLaunches'] == preflight['nativeProcessProbes'] == 0 and not preflight['productPassCredit'] and not preflight['receivingReachCredit'], 'preflight claims no execution/product credit')

spec = importlib.util.spec_from_file_location('reviewed_v3_pure_recipe_definitions', P / 'verify.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
extra_controls = []
for name, mutate in [
    ('drop environment cleanup', lambda x: x['envUnset'].pop()),
    ('change Node heap', lambda x: x['argv'].__setitem__(0, '--max-old-space-size=768')),
    ('change post-enqueue bound', lambda x: x['innerReceivingBudget'].update(postEnqueueWindowMs=2000)),
    ('change metadata key lane', lambda x: x['receivingHistory'].update(metadataKeys='authored')),
    ('add an execution argument', lambda x: x['argv'].append('--retry=1')),
]:
    changed = copy.deepcopy(recipe)
    mutate(changed)
    try:
        gate.check_recipe(changed, prior)
    except ValueError as error:
        extra_controls.append({'name': name, 'rejected': True, 'error': str(error)})
    else:
        raise AssertionError(name)

result = {
    'status': 'ACCEPT BOUNDED V3 RECEIVING PREPARATION; NO RUNTIME ADMISSION',
    'scriptSha256': sha(pathlib.Path(__file__)),
    'inputPins': {str(p): digest for p, digest in pins.items()},
    'recipeChanges': ['cwd', 'envSet.H02_PROGRESS_SOURCE_FREEZE', 'freshOutputDirectory'],
    'launcherOnlyEpochPathSubstitutions': True,
    'freshOutputAbsent': True,
    'sourceMembersRehashed': 589,
    'registrationAndFinalizerUnchanged': True,
    'independentCalibrationSha256': sha(calibration_path),
    'independentPreflightSha256': sha(preflight_path),
    'authorPureControls': {'accepted': 1, 'rejected': 8, 'exactOutputMatches': True},
    'additionalPureRecipeControls': extra_controls,
    'prior20NameDiscoveryCarriedWithOriginalLimits': True,
    'nativeLaunches': 0, 'processProbes': 0,
    'rootToolchainRecoveryAccepted': False,
    'nativeReadinessCredit': False,
    'limits': 'No launcher execution; existing outer supervision and actual escalated one-shot admission remain root-owned. Source-only preflight does not accept changed wrappers or establish parent compiled/runtime identity.',
}
out = R / 'metadata-receiving-prep-v3-audit.json'
out.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'status': result['status'], 'auditSha256': sha(out), 'scriptSha256': result['scriptSha256'], 'preflightSha256': sha(preflight_path), 'calibrationSha256': sha(calibration_path)}))
