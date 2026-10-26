"""Run one wrong implementation per new oracle law; always restore source."""
from pathlib import Path
import json, subprocess, hashlib
root = Path(__file__).resolve().parents[2]
source = root / 'packages/indexeddb-db-collection/src/indexeddb.ts'
original = source.read_text()
mutants = [
 ('name-prefix', 'storeName === name', 'storeName.startsWith(name)', 'tests/compatibility-oracle.test.ts', 'preserves store isolation under legal name'),
 ('premature-readiness', '    void restore(params, false)', '    params.markReady()\n    void restore(params, false)', 'tests/compatibility-oracle.test.ts', 'concurrent first opens'),
 ('json-values', 'stores[name]!.put(mutation.modified, key)', 'stores[name]!.put(JSON.parse(JSON.stringify(mutation.modified)), key)', 'tests/persistence-values-oracle.test.ts', 'preserves date'),
]
results = []
try:
 for name, old, new, file, selector in mutants:
  assert original.count(old) == 1, (name, original.count(old))
  source.write_text(original.replace(old, new))
  result = subprocess.run(['node', '../../node_modules/vitest/vitest.mjs', 'run', file, '-t', selector, '--coverage.enabled=false'], cwd=root/'packages/indexeddb-db-collection', text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
  (Path(__file__).parent/(name+'.txt')).write_text(result.stdout)
  outcome = 'assertion failure' if result.returncode and 'AssertionError' in result.stdout else 'unclassified'
  results.append({'mutant': name, 'outcome': outcome, 'exitCode': result.returncode, 'test': file, 'selector': selector})
  assert outcome == 'assertion failure', result.stdout
finally:
 source.write_text(original)
(Path(__file__).parent/'calibration.json').write_text(json.dumps({'baselineSourceSha256': hashlib.sha256(original.encode()).hexdigest(), 'results': results}, indent=2)+'\n')
print(json.dumps(results, indent=2))
