"""Independent static/hash audit. Do not import or run any prepared gate."""

import ast
import copy
import hashlib
import json
import pathlib
import re
import shlex

REVIEW = pathlib.Path(__file__).resolve().parent
H = REVIEW.parent
PACKET = H / 'metadata-unseeded-campaign-preparation-v1'
SOURCE = H / 'metadata-update-source-v3'
SOURCES = SOURCE / 'sources'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def require(condition, label):
    if not condition:
        raise AssertionError(label)


pins = {
    PACKET / 'binding.json': 'a95dc1d31f59c4c6c39b44864a8f528dcc93583b361eb3f62a62ca4db7e27e34',
    PACKET / 'packet-manifest.json': '001d61d33d25af42ab5afb0c178840eb3f4ccdb9b14c71b8c43a0ca1a121d7f2',
    PACKET / 'first-command.json': 'edf6678933aa512bdcf6ca69ec38322d7a816a63960f93d0b9fb1133082c1eea',
    PACKET / 'report.md': '923b1a50c61f4a1669f1de498a72dd885f62ae4233d064b0f47f53d215f0c770',
    SOURCE / 'source-freeze.json': 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd',
    SOURCE / 'source-inventory.json': '3c8ece36701d450758587bd16dbf691b5e700668bc0be32ae2f20af8bc8bfb84',
    H / 'metadata-fixed-campaign-root-classification-v1.json': 'f865dd3dd1cfba632b2b461ab321f7e7d92c1a7a23f068d241c894363439b1b0',
}
for path, digest in pins.items():
    require(sha(path) == digest, 'pin: ' + path.name)
binding = read(PACKET / 'binding.json')
manifest = read(PACKET / 'packet-manifest.json')
for name, record in manifest['artifacts'].items():
    path = PACKET / name
    require(sha(path) == record['sha256'] and path.stat().st_size == record['bytes'], 'packet artifact: ' + name)
for name, digest in binding['files'].items():
    require(sha(PACKET / name) == digest, 'binding file: ' + name)
for name, digest in binding['externalInputs'].items():
    require(sha(pathlib.Path(name)) == digest, 'external input: ' + name)
classification = read(H / 'metadata-fixed-campaign-root-classification-v1.json')
require(classification['disposition'] == 'qualified exact fixed stable-output-metadata scope/default campaign GREEN' and not classification['nativeProgressionAuthorized'], 'fixed8 qualification with no inherited runtime')
for record in classification['evidence']:
    require(sha(pathlib.Path(record['path'])) == record['sha256'], 'fixed8 classification pointer')
require(classification['sourceFreezeSha256'] == binding['sourceFreezeSha256'] and classification['budget'] == binding['numRuns'] == 8 and classification['multiplier'] == binding['multiplier'] == 1, 'fixed/unseeded source and budgets agree')
require(binding['suppliedSeed'] is None and not binding['newRuntimeAdmitted'] and binding['sourceCopies'] == binding['sourceEdits'] == binding['sourceRefreezes'] == binding['nativeLaunches'] == 0, 'inert unsupplied-seed proposal')
recovery_path = next(pathlib.Path(p) for p in binding['externalInputs'] if p.endswith('root-shared-toolchain-recovery-qualification-v1.json'))
for key in ['actualRepair', 'postAudit', 'closeout', 'formattingAccount']:
    record = read(recovery_path)[key]
    require(sha(pathlib.Path(record['path'])) == record['sha256'], 'accepted recovery pointer: ' + key)

inventory = read(SOURCE / 'source-inventory.json')
freeze = read(SOURCE / 'source-freeze.json')
require(len(inventory) == 589 and len(freeze['productionFiles']) == 511, 'source and production cardinalities')
for name, digest in inventory.items():
    require(sha(SOURCES / name) == digest, 'frozen source: ' + name)
for name, digest in freeze['productionFiles'].items():
    require(inventory[name] == digest and sha(SOURCES / name) == digest, 'production: ' + name)
payloads = 0
for name, package in freeze['packages'].items():
    root = pathlib.Path(package['resolved'])
    require(sha(root / 'package.json') == package['packageJsonSha256'], 'package JSON: ' + name)
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and not p.is_symlink() and 'node_modules' not in p.relative_to(root).parts}
    require(actual == set(package['regularPayloadFilesMap']), 'package own payload set: ' + name)
    for relative, digest in package['regularPayloadFilesMap'].items():
        require(sha(root / relative) == digest, 'own payload: ' + name + '/' + relative)
        payloads += 1
require(payloads == 2544, '2544 named own payloads')
for relative, record in freeze['dependencyReuseLinks'].items():
    path = SOURCES / relative
    require(path.is_symlink() == record['isSymlink'] and str(path.resolve()) == record['resolved'], 'reuse link: ' + relative)
require(sha(pathlib.Path(freeze['node']['executable'])) == freeze['node']['sha256'], 'Node binary')
require(sha(SOURCES / 'pnpm-lock.yaml') == freeze['lockfiles']['repoPnpmLock'], 'repository lock')
require(sha(SOURCES / 'node_modules/.pnpm/lock.yaml') == freeze['lockfiles']['installedPnpmLock'], 'installed lock')

recipe = read(PACKET / 'recipe.json')
command = read(PACKET / 'first-command.json')
requirements = read(PACKET / 'evidence-requirements.json')
title = read(PACKET / 'title-evidence.json')
original = next(r for r in read(H / 'metadata-update-source-v2/required-native-recipes.json')['receiving'] if r['id'] == recipe['id'])
expected = copy.deepcopy(original)
expected['cwd'] = str(SOURCES)
expected['envSet']['H02_PROGRESS_SOURCE_FREEZE'] = str(SOURCE / 'source-freeze.json')
expected['envSet']['TANSTACK_DB_ORACLE_RUNS_MULTIPLIER'] = '1'
expected['freshOutputDirectory'] = str(H / 'metadata-unseeded-campaign-scope-default-v1')
expected['status'] = 'UNADMITTED and UNEXECUTED; independent preparation review and separate exact root one-shot admission required'
require(recipe == expected, 'exact authored recipe plus reviewed paths/status and explicit default multiplier')
require(not pathlib.Path(recipe['freshOutputDirectory']).exists(), 'future outer directory is unused')
require(command['argv'] == [str(PACKET / 'launcher-scope-default-unseeded.zsh'), pins[PACKET / 'binding.json']], 'one exact direct launcher')
require(command['executable'] == '/bin/zsh' and command['maxInvocations'] == 1 and command['cwd'] == str(H), 'one-shot outer command')
require(command['outerOutputDirectory'] == recipe['freshOutputDirectory'], 'fresh outer identity')
require(command['selection']['suppliedSeed'] is binding['suppliedSeed'] is None, 'no supplied seed')
require(command['selection']['numRuns'] == binding['numRuns'] == 8 and command['selection']['runMultiplier'] == binding['multiplier'] == 1, 'exact eight-history budget')
require(command['selection']['property'] == recipe['property'] == 'query.queued-answer-metadata.scope.default', 'one scope/default property')
pattern = recipe['argv'][-1]
require(pattern == '^' + re.escape(recipe['expectedFilterName']) + '$' == title['exactAnchoredRegex'], 'fully anchored exact selector')
names = read(H / 'metadata-update-native-discovery-v2/names.json')
require(len(names) == 20 and sum(n['name'] == recipe['expectedDisplayName'] for n in names) == 1, 'one preserved title among twenty')
filter_names = [n['name'].replace(' > ', ' ') for n in names]
require([n for n in filter_names if re.fullmatch(pattern, n)] == [recipe['expectedFilterName']], 'exact selector matches one preserved campaign')
rejected_titles = [recipe['expectedFilterName'] + ' (with seed=20261030)', recipe['expectedFilterName'] + ' arbitrary-tail', recipe['expectedFilterName'].replace("'default'", "'authored'"), recipe['expectedFilterName'].replace('checks the unseeded generated campaign or selected replay', 'checks the fixed generated campaign')]
require(not any(re.fullmatch(pattern, n) for n in rejected_titles), 'no suffix, tail, authored, or fixed match')
require(requirements['successfulHistoryCount'] == 8 and len(requirements['reach']['states']) == 31, 'eight distinct raw histories and31 states required')

launcher = (PACKET / 'launcher-scope-default-unseeded.zsh').read_text()
lines = launcher.splitlines()
exec_line = next(line for line in lines if line.startswith('exec env '))
tokens = shlex.split(exec_line)
expected_tokens = ['exec', 'env']
for name in recipe['envUnset']:
    expected_tokens.extend(['-u', name])
expected_tokens.extend(k + '=' + v for k, v in recipe['envSet'].items())
expected_tokens.extend([recipe['executable'], *recipe['argv'], '>', recipe['freshOutputDirectory'] + '/outer-vitest.log', '2>&1'])
require(tokens == expected_tokens, 'all launcher command tokens match structured recipe')
require('set -euo pipefail' in lines and 'if [[ $# -ne 1 ]]; then' in launcher, 'fail-fast exact binding parameter')
cd = next(line for line in lines if line.startswith('cd '))
mkdir = next(line for line in lines if line.startswith('mkdir '))
verify = next(line for line in lines if '/verify.py --binding' in line)
ps = next(line for line in lines if line.startswith('/bin/ps '))
require(shlex.split(cd) == ['cd', str(SOURCES)], 'exact source cwd')
require(shlex.split(mkdir) == ['mkdir', '-m', '700', recipe['freshOutputDirectory']], 'exclusive output directory')
require(lines.index(cd) < lines.index(mkdir) < lines.index(verify) < lines.index(ps) < lines.index(exec_line), 'unchanged launch order')
require(shlex.split(verify)[1:] == ['-I', '-B', str(PACKET / 'verify.py'), '--binding', '$1', '--gate', 'receiving', '>', recipe['freshOutputDirectory'] + '/source-prelaunch.json'], 'future read/hash gate command')
require(shlex.split(ps) == ['/bin/ps', '-o', 'pid=,pgid=,rss=,args=', '-p', '$$', '>', recipe['freshOutputDirectory'] + '/launcher-process.txt'], 'actual launcher identity capture')
gate = (PACKET / 'verify.py').read_text()
ast.parse(gate)
require(gate.index("for name, expected in binding['externalInputs'].items():") < gate.index('prior = previous_gate()'), 'bound external inputs checked before prior gate import')
require("prior.verify(PREVIOUS_SHA, gate)" in gate and "result['receivingEvidenceBaseline'] = prior_result.pop('receivingEvidenceBaseline')" in gate, 'same fixed read/hash gate, move receiving-only passive baseline to top level')
previous_gate = (H / 'metadata-fixed-campaign-preparation-v1/verify.py').read_text()
ast.parse(previous_gate)
require("prior.verify(PREVIOUS_SHA, 'source')" in previous_gate and "prior.previous_gate().receipt_baseline()" in previous_gate, 'accepted fixed gate reads sources then only receiving gate gets passive baseline')
require("'seed': None" in gate and "'numRuns': 8, 'multiplier': 1" in gate, 'top-level unseeded gate does not present nested fixed seed as execution')

registration = (SOURCES / 'packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts').read_text()
fixed = registration[registration.index('oracleReplayTest(it)(\n        `checks the fixed generated campaign`'):registration.index('oracleReplayTest(it, property)')]
unseeded = registration[registration.index('oracleReplayTest(it, property)'):]
require("import { describe, it } from 'vitest'" in registration and '.prop(' not in registration and '@fast-check/vitest' not in registration, 'plain Vitest registration')
for campaign in [fixed, unseeded]:
    require('await fc.assert(' in campaign and 'fc.asyncProperty(metadataFollowupArbitrary, async (facts) => {' in campaign and 'await run(historyOf(facts), reach)' in campaign, 'same serial shared history receiver')
    require(campaign.index('await fc.assert(') < campaign.index('reach.assertReached()'), 'postcampaign reach assertion')
fixed_body = fixed[fixed.index('async () => {'):fixed.index('300_000,')]
unseeded_body = unseeded[unseeded.index('async () => {'):unseeded.index('300_000,')]
require(fixed_body.replace('{ numRuns: oracleRuns(8), seed: 20261030 }', 'oraclePropertyOptions(8, property)') == unseeded_body, 'identical fixed/unseeded callback except seed options')
require('reach.beginHistory()' in registration and registration.index('checkQueuedAnswerProgress(history, outcome)') < registration.index('metadata.finish()'), 'per-history finish remains after outcome validation')
config = (SOURCES / 'packages/db/tests/oracle-config.ts').read_text()
require('return baseRuns * multiplier' in config and 'environment.TANSTACK_DB_ORACLE_RUNS_MULTIPLIER ?? `1`' in config, 'explicit multiplier1 gives eight')
require('return standsAside ? (registration.skip as TRegistration) : registration' in config, 'replay helper keeps plain title')
reach = (SOURCES / 'packages/db/tests/oracle-reach.ts').read_text()
require('current = new Set()' in reach and 'if (current.has(state)) return' in reach and 'counts.set(state, counts.get(state)! + 1)' in reach, 'cumulative per-history once-per-state counts')
metadata = (SOURCES / 'packages/query-db-collection/tests/queued-answer-metadata-oracle.ts').read_text()
require('metadataFollowupQuarter: fc.constantFrom(1 as const, 2 as const, 3 as const)' in metadata, 'positive-quarter generated grammar')
require('keyShift: fc.integer({ min: 0, max: 20 })' in metadata and 'rankScale: fc.integer({ min: 1, max: 20 })' in metadata, 'bounded generated payload grammar')
require('if (current.has(state)) return' in reach and 'minimum = 1' in reach, 'authored aggregate reach minimum remains one')

native_config = (SOURCES / 'scripts/h02-progress/vitest.config.ts').read_text()
for fragment in ['environment: `jsdom`', 'pool: `forks`', 'maxWorkers: 1', 'fileParallelism: false', 'coverage: { enabled: false }', 'typecheck: { enabled: false }', 'execArgv: [`--max-old-space-size=384`]', 'testTimeout: 300_000']:
    require(fragment in native_config, 'inherited native config: ' + fragment)
require(recipe['testTimeoutMs'] == 300000 and recipe['innerReceivingBudget'] == {'wallMs': 20000, 'groupRssBytes': 1073741824, 'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000}, 'unchanged test and inner budgets')
static = read(SOURCE / 'static-results.json')
require(static['typecheck']['exitCode'] == 0 and '--project scripts/h02-progress/metadata-tsconfig.json --noEmit' in static['typecheck']['command'], 'prior standalone TypeScript evidence only')
python = pathlib.Path(shlex.split(verify)[0])
native_binding = read(H / 'metadata-update-native-preparation-v1/binding.json')
require(sha(python) == native_binding['python']['sha256'], 'pinned launcher Python binary')

required_unsets = {'TANSTACK_DB_ORACLE_SEED', 'TANSTACK_DB_ORACLE_PATH', 'TANSTACK_DB_ORACLE_PROPERTY', 'TANSTACK_DB_ORACLE_CALIBRATION', 'NODE_OPTIONS', 'NODE_PATH'}
require(required_unsets <= set(recipe['envUnset']), 'canonical replay and Node controls cleared')
require(recipe['envSet'] == {'H02_PROGRESS_SOURCE_FREEZE': str(SOURCE/'source-freeze.json'), 'TANSTACK_DB_ORACLE_RUNS_MULTIPLIER':'1'}, 'only source freeze and explicit multiplier injected')
require('if (replaySeed === undefined) return { numRuns }' in config and 'return oracleRandomParameters(oracleRuns(baseRuns), replay, property)' in config, 'no seed/path options under cleared replay inputs')
fixed_requirements = read(H/'metadata-fixed-campaign-preparation-v1/evidence-requirements.json')
for name in ['states', 'perHistory', 'perHistoryFinish']:
    require(requirements['reach'][name] == fixed_requirements['reach'][name], '31-state/finalizer obligation unchanged '+name)
for name in ['historyGrammar','sourceBinding','artifactAttribution','identityAndCleanup','rawPreservation','successfulHistoryCount']:
    require(requirements[name] == fixed_requirements[name], 'receiving evidence obligation unchanged '+name)
require('every raw initial/shrinking attempt' in requirements['unseededFailureEvidence'] and 'successful chosen seed is not recorded' in requirements['unseededFailureEvidence'], 'failure preservation and success seed limit explicit')

result = {
    'status': 'ACCEPT EXACT-ONE UNSEEDED CAMPAIGN PROPOSAL; SOURCE-ONLY; ROOT ADMISSION REQUIRED',
    'scriptSha256': sha(pathlib.Path(__file__)),
    'pins': {str(p): digest for p, digest in pins.items()},
    'packetArtifactsHashed': len(manifest['artifacts']),
    'boundExternalInputsHashed': len(binding['externalInputs']),
    'sourceMembersHashed': 589, 'productionMembersCompared': 511,
    'namedOwnPayloadsHashed': payloads, 'reuseLinksChecked': 4,
    'nodeAndPythonBinaryHashesMatch': True, 'bothLocksMatch': True,
    'property': recipe['property'], 'suppliedSeed': None, 'numRuns': 8, 'multiplier': 1,
    'preservedTitleMatches': 1, 'preservedTitleUniverse': 20,
    'rejectedTitleVariants': rejected_titles,
    'launcherMatchesRecipe': True, 'futureOutputAbsent': True,
    'pythonGateParsedOnly': True, 'gateImportsExecuted': 0,
    'nativeLaunches': 0, 'nativeImports': 0, 'nativeDiscovery': 0,
    'generatorExecutions': 0, 'processProbes': 0, 'sourceEdits': 0,
    'authoredReachMinimum': 1,
    'futureReceivingGreenRequirement': 'Eight one-to-one actual raw history artifacts; all31 states per history backed by cumulative console counts1..8/final8; exact source-order/pass finish assumption; normal cleanup; complete separate outer and inner returns; original recorded identities absent.',
    'configFacts': {'environment': 'jsdom', 'pool': 'forks', 'workers': 1, 'coverage': False, 'nativeTypecheck': False, 'nodeHeapMiB': 384, 'testTimeoutMs': 300000},
    'typecheckCredit': 'Inherited exact-source standalone metadata-tsconfig noEmit exit0 only; native Vitest typecheck remains disabled.',
    'campaignPassCredit': False, 'generatedReachCredit': False, 'productRepairCredit': False,
    'bugClassClosureCredit': False, 'newRuntimeAdmitted': False,
    'limits': ['No prepared gate/config/test/model/generator imported or executed', 'Preserved20-name discovery supports static exact selection; actual one-pass/nineteen-skipped selection remains required', 'Authored aggregate reach minimum is1; eight-history per-state coverage requires separate raw and cumulative actual result verification', 'No new parent checker V8 or finalizer invocation receipt', 'No initial actual getpgid or universal process census', '300000ms test timeout is not a hard outer watchdog; root owns outer lifecycle', 'Nine named own-package maps are not complete transitive host/native/dist equivalence', 'Unseeded actual result remains unproved until separately admitted run; authored/noop/subscription/strict-cache/changing-metadata/mutant/framework/closure claims remain outside scope', 'Chosen success seed may remain unavailable; failure seed/path/errors and all shrinks must remain preserved'],
}
output = REVIEW / 'metadata-unseeded-campaign-preparation-independent-audit-v1.json'
require(not output.exists(), 'unused additive output')
output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'status': result['status'], 'audit': str(output), 'auditSha256': sha(output), 'scriptSha256': result['scriptSha256']}))
