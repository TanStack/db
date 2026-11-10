"""Read/hash/parse only. No subprocess, imports from the worktree, or histories."""
import datetime
import hashlib
import json
import pathlib
import re

H = pathlib.Path(__file__).resolve().parent.parent
REVIEW = pathlib.Path(__file__).resolve().parent
COMBINED = H / 'candidate-controls-combined-source-v2'
INPUT = H / 'candidate-controls-baseline-batch-preparation-v1'
failures = []


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def check(condition, detail):
    if not condition:
        failures.append(detail)


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def verify_map(root, mapping, label):
    for relative, expected in mapping.items():
        path = pathlib.Path(root) / relative
        check(path.is_file() and digest(path) == expected, f'{label}:{relative}')
    return len(mapping)


freeze_path = COMBINED / 'source-freeze-v2.json'
freeze = load(freeze_path)
worktree = pathlib.Path(freeze['worktree'])
combined_packet = load(COMBINED / 'packet-sha256-v2.json')
counts = {'combinedPacket': verify_map(COMBINED, combined_packet, 'packet')}
for key in ['productionFiles', 'instrumentFiles', 'sharedInstrumentFiles']:
    counts[key] = verify_map(worktree, freeze[key], 'live-' + key)
frozen_sources = {**freeze['instrumentFiles'], **freeze['sharedInstrumentFiles']}
counts['frozenSources'] = verify_map(COMBINED / 'sources', frozen_sources, 'frozen-source')
counts['frozenRecords'] = verify_map(COMBINED / 'records', freeze['records'], 'frozen-record')
check(hashlib.sha256(json.dumps(freeze['productionFiles'], sort_keys=True,
                              separators=(',', ':')).encode()).hexdigest()
      == freeze['productionIdentity'], 'production identity map hash')
check(all(freeze['productionFiles'].get(k) == v
          for k, v in freeze['receivingProductionFiles'].items()),
      'receiving production subset')
check(all(freeze['instrumentFiles'].get(k) == v
          for k, v in freeze['completionInstrumentFiles'].items()),
      'completion instrument subset')
check(freeze['sharedInstrumentFiles'] == {
    **freeze['originalSharedInstrumentFiles'], **freeze['staticValidationFiles']
}, 'shared source partition')
node = freeze['node']
check(digest(node['executable']) == node['sha256'], 'selected node hash')
for key, path in [('repoPnpmLock', worktree / 'pnpm-lock.yaml'),
                  ('installedPnpmLock', worktree / 'node_modules/.pnpm/lock.yaml')]:
    check(digest(path) == freeze['lockfiles'][key], key)
for rel, expected in freeze['dependencyReuseLinks'].items():
    path = worktree / rel
    check(path.is_symlink() == expected['isSymlink']
          and str(path.resolve()) == expected['resolved'], 'dependency link:' + rel)
package_counts = {}
for name, package in freeze['packages'].items():
    root = pathlib.Path(package['resolved'])
    check(str((worktree / package['logical']).resolve()) == str(root),
          'package logical resolution:' + name)
    check(digest(root / 'package.json') == package['packageJsonSha256'],
          'package.json:' + name)
    check(load(root / 'package.json')['version'] == package['version'],
          'package version:' + name)
    files = package['regularPayloadFilesMap']
    package_counts[name] = verify_map(root, files, 'package:' + name)
    check(len(files) == package['regularPayloadFiles'], 'payload count:' + name)
    check(hashlib.sha256(json.dumps(files, sort_keys=True,
                                  separators=(',', ':')).encode()).hexdigest()
          == package['regularPayloadIdentity'], 'payload map hash:' + name)
    # Match the declared regular payload scope, omitting nested package manager
    # .bin shims and links. Those omissions remain an explicit scope limit.
    observed = {str(path.relative_to(root)) for path in root.rglob('*')
                if path.is_file() and not path.is_symlink()
                and 'node_modules' not in path.relative_to(root).parts}
    check(observed == set(files), 'regular payload path set:' + name)
counts['packagePayloads'] = sum(package_counts.values())
for key, provenance in freeze['provenance'].items():
    check(digest(provenance['path']) == provenance['sha256'], 'provenance:' + key)

# Independent lexical scan of only literal import/export/import() specifiers.
# This is not a general JavaScript parser or a transitive dependency proof.
literal_import = re.compile(
    r'\b(?:import|export)\s+(?:[^;\n]*?\bfrom\s*)?[\'\"]([^\'\"]+)[\'\"]'
    r'|\b(?:import|export)[\s\S]*?\bfrom\s*[\'\"]([^\'\"]+)[\'\"]'
)
simple_import = re.compile(r'\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*[^;\n]*|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s*from\s*[\'\"]([^\'\"]+)[\'\"]|\bimport\s*[\'\"]([^\'\"]+)[\'\"]|\bimport\(\s*[\'\"]([^\'\"]+)[\'\"]', re.MULTILINE)
imports = set()
for relative in frozen_sources:
    path = COMBINED / 'sources' / relative
    if path.suffix not in {'.ts', '.js', '.mjs'}:
        continue
    for match in simple_import.finditer(path.read_text()):
        specifier = next(value for value in match.groups() if value)
        if not specifier.startswith('.'):
            continue
        target = worktree / pathlib.Path(relative).parent / specifier
        possibilities = [target]
        if target.suffix == '.js':
            possibilities.append(target.with_suffix('.ts'))
        if not target.suffix:
            possibilities += [target.with_suffix('.ts'), target / 'index.ts']
        resolved = next((p.resolve() for p in possibilities if p.is_file()), None)
        check(resolved is not None, f'unresolved literal:{relative}:{specifier}')
        if resolved is not None:
            resolved_relative = str(resolved.relative_to(worktree))
            check(resolved_relative in frozen_sources or
                  resolved_relative in freeze['productionFiles'],
                  f'unlisted literal:{relative}:{specifier}:{resolved_relative}')
            imports.add((relative, specifier, resolved_relative))
author_identity = load(COMBINED / 'records/identity-verification-v2.json')
author_imports = {(row['from'], row['specifier'], row['resolved'])
                  for row in author_identity['relativeImports']}
check(imports == author_imports, 'independent literal import inventory differs')
counts['literalLocalImports'] = len(imports)

input_freeze = load(INPUT / 'input-freeze-v1.json')
input_packet = load(INPUT / 'input-packet-sha256-v1.json')
counts['inputPacket'] = verify_map(INPUT, input_packet, 'input-packet')
counts['inputFiles'] = verify_map(INPUT, input_freeze['files'], 'input-file')
check(input_freeze['sourceFreeze'] == str(freeze_path)
      and input_freeze['sourceFreezeSha256'] == digest(freeze_path), 'input source freeze')
check(input_freeze['sourcePacket'] == str(COMBINED / 'packet-sha256-v2.json')
      and input_freeze['sourcePacketSha256'] == digest(COMBINED / 'packet-sha256-v2.json'),
      'input source packet')
plan = load(INPUT / 'selection-plan-v1.json')
check(input_freeze['selectionPlanSha256'] == digest(INPUT / 'selection-plan-v1.json'),
      'selection plan hash')
check([row['id'] for row in input_freeze['cells']]
      == [row['id'] for row in plan['cells']], 'cell order')
limits = {'wallMs': 60000, 'nodeHeapMiB': 384,
          'groupRssBytes': 1073741824, 'samplingMs': 100}
expected_args = ['--max-old-space-size=384',
                 str(pathlib.Path(freeze['packages']['vitest']['resolved']) / 'vitest.mjs'),
                 'run', '--config', 'scripts/h02-progress/completion-parent.config.ts',
                 'packages/query-db-collection/tests/queued-answer-completion-baseline.test.ts',
                 '-t', 'checks a selected baseline constituent through the shared judgment']
cells = []
for selected, row in zip(plan['cells'], input_freeze['cells']):
    cell = selected['id']
    program_path = INPUT / 'frozen-inputs-v1/programs' / (cell + '.json')
    recipe_path = INPUT / 'frozen-inputs-v1/recipes' / (cell + '.json')
    program, recipe = load(program_path), load(recipe_path)
    check(digest(program_path) == row['programSha256'], 'program hash:' + cell)
    check(digest(recipe_path) == row['recipeSha256'], 'recipe hash:' + cell)
    check(program['gate'] == selected['gate'] and
          program['setup']['profile'] == selected['profile'] and
          program['parameters'] == selected['parameters'], 'program selection:' + cell)
    check(recipe == {'kind': 'h02-completion-baseline-constituent',
                     'mode': 'baseline-constituent', 'worktree': str(worktree),
                     'executable': node['executable'], 'args': expected_args,
                     'sourceFreeze': str(freeze_path), 'sourceFreezeSha256': digest(freeze_path),
                     'programFile': str(program_path), 'programSha256': digest(program_path),
                     'gate': selected['gate'], 'profile': selected['profile'],
                     'outputDirectory': str(INPUT / 'runtime-output-v1' / cell),
                     'limits': limits}, 'exact recipe:' + cell)
    check(row['launchArgvIfAdmitted'] == [node['executable'],
          str(worktree / 'scripts/h02-progress/completion-parent.mjs'), str(recipe_path)],
          'outer argv:' + cell)
    check(not pathlib.Path(recipe['outputDirectory']).exists(), 'exclusive output already exists:' + cell)
    epochs = ([{'id': 'initialization', 'kind': 'initialization',
                'fromStep': -1, 'throughStep': -1}] if program['setup']['ready'] else [])
    start = 0
    for index, step in enumerate(program['steps']):
        if step['kind'] != 'baseline-observe':
            continue
        epochs.append({'id': str(len(epochs)) + ':' + step['boundary'],
                       'kind': 'cleanup' if step['boundary'] == 'cleanup-abandoned' else 'publication',
                       'fromStep': start, 'throughStep': index})
        start = index + 1
    check(start == len(program['steps']) and epochs == program['publicationEpochs'],
          'canonical epoch cuts:' + cell)
    constructions = 1 + sum(step.get('action', {}).get('type') == 'restart'
                            for step in program['steps'])
    check(constructions == selected['fixtureConstructions'], 'fixture constructions:' + cell)
    check(program['setup']['ready'] == (selected['gate'] != 'initial-status-tail'), 'ready:' + cell)
    cells.append({'id': cell, 'programSha256': digest(program_path),
                  'recipeSha256': digest(recipe_path),
                  'steps': len(program['steps']), 'epochs': len(epochs),
                  'fixtureConstructions': constructions,
                  'sourceAnswerPremises': program['sourceAnswerPremises']})
check(len(cells) == input_freeze['programs'] == input_freeze['recipes'] == 16, '16 cells')
check(sum(row['fixtureConstructions'] for row in cells)
      == input_freeze['fixtureConstructionsIfAllAdmitted'] == 18, '18 fixtures')
for record in [plan, input_freeze]:
    check(record['sequential'] and record['stopOnFirstFailureOrUnreachedPremise']
          and record['automaticReruns'] == record['resourceIncreases'] == 0
          and record['limitsPerCell'] == limits and record['innerReceivingWallMs'] == 20000,
          'plan/freeze stop policy')

result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'scope': 'Python stdlib read/hash/parse only; no worktree imports, subprocess, semantic execution or receiving',
          'combinedFreezeSha256': digest(freeze_path),
          'combinedPacketSha256': digest(COMBINED / 'packet-sha256-v2.json'),
          'inputFreezeSha256': digest(INPUT / 'input-freeze-v1.json'),
          'inputPacketSha256': digest(INPUT / 'input-packet-sha256-v1.json'),
          'counts': counts, 'packages': package_counts,
          'literalImportScope': 'Independent literal import/export/import() lexical scan; exact agreement with all 138 recorded local rows; no general parser or external transitive closure claim',
          'cells': cells, 'runtimeOutputParentExists': (INPUT / 'runtime-output-v1').exists(),
          'failures': failures, 'candidateRaw20': 'all UNREACHED',
          'state14': 'proposed; not adopted', 'runtimeAdmission': False}
output = REVIEW / 'combined-v2-input-v1-identity-checks-v1.json'
check(not output.exists(), 'review output collision')
with output.open('x') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'output': str(output), 'sha256': digest(output),
                  'counts': counts, 'failures': failures,
                  'runtimeOutputParentExists': result['runtimeOutputParentExists']}, indent=2))
