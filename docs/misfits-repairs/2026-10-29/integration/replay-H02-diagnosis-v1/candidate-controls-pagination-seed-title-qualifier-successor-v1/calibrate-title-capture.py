"""Calibrate exact report identity using frozen JSON, without a target run.

The instrument must capture the sole executed authored fixed-seed assertion,
including a failed assertion. The installed runner supplies the exact title
suffix. This changes report identity only; no product law or answer changes.
The frozen capture_report function remains the sole judgment for every case.
"""
import ast
import copy
import difflib
import hashlib
import json
from pathlib import Path
import re
import stat
import tempfile

HERE = Path(__file__).resolve().parent
R = HERE.parents[5]
H = HERE.parent
N = H / 'candidate-controls-pagination-2gib-shared-receiving-containment-v1'
O = H / 'candidate-controls-pagination-2gib-shared-receiving-primary-red-runtime-v1'
Q = H / 'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
REVIEW = H / 'candidate-controls-independent-review-v1/2gib-shared-primary-actual-independent-review-v1.md'
INSTALLED = R / 'node_modules/.pnpm/@fast-check+vitest@0.4.1_vitest@4.1.12/node_modules/@fast-check/vitest'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def save(name, value):
    (HERE / name).write_text(json.dumps(value, indent=2) + '\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def calibrate():
    # These are small existing evidence inputs, not a new dependency census.
    require(sha(N / 'packet-manifest.json') == '439cdcb6df9125142fece28cf55f834b60d071d57fb8b6498c2d4d1f7feca2f1', 'N manifest changed')
    require(sha(N / 'binding.json') == '9c8dfceab5666c6d242002858a852ad4e05e33e6a147598730958025042b8faf', 'N binding changed')
    require(sha(O / 'result-freeze-v1.json') == 'ec7775de91e14a892dbfe17360cd8d2b73fb2766a0919605c66ee71561a09669', 'actual result freeze changed')
    require(sha(Q / 'source-freeze-v1.json') == 'f85b261b1733c5581c0f8af8fbdff824b189b9b4517fda6b4cf397c1d2c8b193', 'Q source freeze changed')
    require(sha(REVIEW) == '1a995f97683d8240b53260748a25bd16b92f6206c271a649dd72ddf185475923', 'actual review changed')
    classification_sha = sha(O / 'root-primary-product-red-classification-v1.json')
    require(classification_sha.startswith('ed3825c') and classification_sha.endswith('c498c'), 'ROOT classification identity changed')
    binding = read(N / 'binding.json')
    source = read(Q / 'source-freeze-v1.json')
    authored_path = Path(source['worktree']) / 'packages/db/tests/query/pagination-oracle.property.test.ts'
    require(sha(authored_path) == source['sourceBindings']['packages/db/tests/query/pagination-oracle.property.test.ts'], 'authored registration changed')
    for name in ['launch.py', 'run-recipe.json']:
        require(sha(N / name) == binding['files'][name], name + ' changed')
    package = next(item for item in read(N / 'supplemental-tool-inputs.json')['packages']
                   if item['resolved'] == str(INSTALLED))
    for name in ['package.json', 'lib/vitest-fast-check.js']:
        require(sha(INSTALLED / name) == package['regularPayloadFilesMap'][name], 'installed title source changed')

    authored = authored_path.read_text()
    seed_matches = re.findall(r'parameters: \{ numRuns: transitionScenarioRuns, seed: (\d+) \}', authored)
    require(seed_matches == ['1665'], 'fixed campaign seed is ambiguous or changed')
    seed = int(seed_matches[0])
    installed_lines = (INSTALLED / 'lib/vitest-fast-check.js').read_text().splitlines()
    title_lines = [(i + 1, line) for i, line in enumerate(installed_lines) if 'testFn(' in line and ' (with seed=' in line]
    require(len(title_lines) == 1, 'installed title construction is ambiguous')
    require('customParams.seed' in title_lines[0][1], 'installed seed source changed')
    original_recipe = read(N / 'run-recipe.json')
    base = original_recipe['expectedOutput']['title']
    require(base == 'retains complete windows across joined failure histories for a fixed seed', 'authored base title changed')
    require('`retains complete windows across joined failure histories for a ${campaign.name}`' in authored, 'authored label construction changed')
    require('name: `fixed seed`' in authored, 'authored fixed label changed')
    require(original_recipe['argv'][original_recipe['argv'].index('-t') + 1] == base, 'CLI selector changed')
    successor = copy.deepcopy(original_recipe)
    successor['expectedOutput']['title'] = base + f' (with seed={seed})'
    save('proposed-run-recipe-title-only-v1.json', successor)
    expected = copy.deepcopy(successor)
    expected['expectedOutput']['title'] = base
    require(expected == original_recipe, 'successor changes more than exact report title')
    (HERE / 'recipe-title-only-v1.patch').write_text(''.join(difflib.unified_diff(
        (N / 'run-recipe.json').read_text().splitlines(True),
        (HERE / 'proposed-run-recipe-title-only-v1.json').read_text().splitlines(True),
        fromfile='frozen-N/run-recipe.json', tofile='source-only-successor/run-recipe.json')))

    # Compile only four exact function definitions. Do not import the launcher,
    # its supervisor, the runner, a config or the oracle. Filesystem guards and
    # the strict global singleton/ancestry judgment remain unchanged.
    launcher_ast = ast.parse((N / 'launch.py').read_text())
    names = {'digest', 'require', 'read_json', 'capture_report'}
    functions = [node for node in launcher_ast.body if isinstance(node, ast.FunctionDef) and node.name in names]
    require({node.name for node in functions} == names and len(functions) == 4, 'capture helpers changed')
    require(all(not node.decorator_list for node in functions), 'capture decorators changed')
    extracted = ast.Module(body=functions, type_ignores=[])
    scope = {'Path': Path, 'hashlib': hashlib, 'json': json, 'stat': stat}
    exec(compile(extracted, str(N / 'launch.py') + ':capture-only', 'exec'), scope)
    capture = scope['capture_report']
    raw_path = O / 'vitest-report.json'
    raw = read(raw_path)
    freeze = read(O / 'result-freeze-v1.json')
    require(sha(raw_path) == freeze['members']['vitest-report.json']['sha256'], 'raw JSON changed')
    input_paths = [N / 'packet-manifest.json', N / 'binding.json', N / 'launch.py', N / 'run-recipe.json',
                   Q / 'source-freeze-v1.json', authored_path, INSTALLED / 'package.json',
                   INSTALLED / 'lib/vitest-fast-check.js', O / 'result-freeze-v1.json', raw_path,
                   O / 'outer-final.receipt.json', O / 'actual-tool-return-v1.json',
                   O / 'root-primary-product-red-classification-v1.json', REVIEW]
    inputs = {str(path): sha(path) for path in input_paths}
    results = []

    def rejected(name, recipe, expected_error='report does not identify exactly the selected executed fixed campaign'):
        try:
            capture(recipe)
        except ValueError as error:
            require(str(error) == expected_error, name + ' failed outside its intended identity comparison')
            results.append({'case': name, 'outcome': 'REJECTED', 'error': str(error)})
            return
        raise AssertionError(name + ' unexpectedly captured')

    rejected('original raw JSON with original base-title recipe', original_recipe)
    captured = capture(successor)
    require(captured['selectedStatus'] == 'failed' and captured['reportSuccess'] is False and
            captured['productVerdict'] == 'UNCLASSIFIED', 'failed result was normalized')
    results.append({'case': 'original raw JSON with exact seed-title successor', 'outcome': 'CAPTURED_FAILED_ASSERTION', 'capture': captured})
    positions = [(m, a) for m, module in enumerate(raw['testResults'])
                 for a, result in enumerate(module.get('assertionResults', []))
                 if result.get('status') not in ['pending', 'skipped', 'todo', 'disabled']]
    require(len(positions) == 1, 'raw executed singleton changed')
    module_index, assertion_index = positions[0]
    with tempfile.TemporaryDirectory(prefix='h02-title-capture-') as temporary:
        temporary_path = Path(temporary) / 'mutated-report.json'
        for name in ['wrong seed title', 'wrong ancestry', 'missing selected assertion', 'second executed assertion']:
            mutated = copy.deepcopy(raw)
            assertions = mutated['testResults'][module_index]['assertionResults']
            selected = assertions[assertion_index]
            if name == 'wrong seed title':
                selected['title'] = base + f' (with seed={seed + 1})'
            elif name == 'wrong ancestry':
                selected['ancestorTitles'] = [*selected['ancestorTitles'], 'wrong extra ancestor']
            elif name == 'missing selected assertion':
                del assertions[assertion_index]
            else:
                second = copy.deepcopy(selected)
                second['title'] = 'unrelated second executed assertion'
                second['fullName'] = 'unrelated second executed assertion'
                second['status'] = 'passed'
                second['failureMessages'] = []
                assertions.append(second)
            temporary_path.write_text(json.dumps(mutated))
            mutation_recipe = copy.deepcopy(successor)
            mutation_recipe['expectedOutput']['path'] = str(temporary_path)
            expected_error = ('selected campaign ancestry changed' if name == 'wrong ancestry'
                              else 'report does not identify exactly the selected executed fixed campaign')
            rejected(name, mutation_recipe, expected_error)

    # Re-read the original small evidence packets after pure calibration.
    # No source/dependency census, process API or target execution occurs.
    for path, expected_sha in inputs.items():
        require(sha(path) == expected_sha, 'original input changed: ' + path)
    original_packets = 0
    for packet, key in [(N / 'packet-manifest.json', 'files'), (O / 'result-freeze-v1.json', 'members')]:
        for name, item in read(packet)[key].items():
            require(sha(packet.parent / name) == item['sha256'], 'original packet member changed: ' + name)
            original_packets += 1
    outer = read(O / 'outer-final.receipt.json')
    actual = read(O / 'actual-tool-return-v1.json')
    require(outer['report'] is None and outer['child']['exitCode'] == 1 and actual['actualOuterExitCode'] == 1,
            'historical failed outcome changed')
    require(any(x['phase'] == 'report-capture' for x in outer['secondaryFailures']), 'historical qualifier failure lost')
    save('input-bindings-v1.json', {'scope': '14 small exact inputs; no wide source/tool audit or new dependency census', 'inputs': inputs})
    save('title-derivation-v1.json', {
        'authority': 'Installed @fast-check/vitest title construction plus authored fixed campaign seed; instrument identity only',
        'installedPackage': {'path': str(INSTALLED / 'package.json'), 'sha256': sha(INSTALLED / 'package.json'), 'version': read(INSTALLED / 'package.json')['version']},
        'installedTitleSource': {'path': str(INSTALLED / 'lib/vitest-fast-check.js'), 'sha256': sha(INSTALLED / 'lib/vitest-fast-check.js'), 'line': title_lines[0][0], 'text': title_lines[0][1]},
        'sourceFreezeSha256': sha(Q / 'source-freeze-v1.json'), 'authoredSource': {'path': str(authored_path), 'sha256': sha(authored_path)},
        'seed': seed, 'baseLabelAndUnchangedCliSelector': base,
        'exactExpectedReportTitle': successor['expectedOutput']['title'],
        'onlyRecipeFieldChanged': 'expectedOutput.title', 'wrapperChanges': 0,
        'fuzzyMatching': False, 'exitNormalization': False,
        'readyToLaunch': False,
        'futureRunRequirement': 'This title-only component retains the consumed historical output path. A future operational successor needs an explicit fresh-output/source binding, independent review and separate ROOT admission.'})
    output = {'status': 'PASS bounded pure instrument calibration only; no product GREEN or native admission',
              'cases': results, 'caseCount': len(results), 'rejectedCorruptions': 4,
              'exactOriginalCaptureFunctions': sorted(names), 'launcherImported': False,
              'supervisorImported': False, 'configOrTestImports': 0, 'targetExecutions': 0,
              'nativeProbes': 0, 'wideSourceOrDependencyAudit': False,
              'originalPacketMembersRehashedAndUnchanged': original_packets,
              'historicalOuterExit': 1, 'historicalChildExit': 1,
              'historicalOuterReport': None, 'historicalQualifierSecondaryPreserved': True,
              'newGuardsAdded': [],
              'limits': ['Only the observed pinned @fast-check/vitest fixed-seed title encoding is calibrated.',
                         'No general JSON schema/status/module hardening is added or claimed.',
                         'No future runtime, actual config evaluation, new source epoch, receiving, reach, campaign or bug-class closure is established.',
                         'The successor recipe is a title-only calibration/template component, not an executable launch packet.']}
    save('pure-calibration-results-v1.json', output)
    print(json.dumps({'status': output['status'], 'caseCount': len(results), 'rejectedCorruptions': 4,
                      'oldQualifier': results[0]['outcome'], 'exactSuccessor': results[1]['outcome'],
                      'selectedStatus': captured['selectedStatus'], 'reportSuccess': captured['reportSuccess'],
                      'historicalOuterExit': 1, 'historicalChildExit': 1,
                      'originalPacketMembersUnchanged': original_packets}, indent=2))


if __name__ == '__main__':
    calibrate()
