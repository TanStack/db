"""Check frozen study inputs and deterministic replay; no application tests."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    for relative, expected in manifest['sha256'].items():
        actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
        assert actual == expected, f'Frozen input changed: {relative}; create a new model version'
    sources = json.loads((ROOT / 'sources.json').read_text())
    models = sorted(ROOT.glob('*/model.json'))
    assert len(models) == 4
    for path in models:
        model = json.loads(path.read_text())
        assert model['relations'] and model['limits'] and model['range']
        for name, action in model['actions'].items():
            assert action['source_refs'], (model['id'], name)
            assert all(ref in sources for ref in action['source_refs'])
            for clause in action['requires_any']:
                assert set(clause) <= set(model['initial']), (model['id'], name, clause)
            for effects in action['outcomes'].values():
                assert set(effects) <= set(model['initial'])
        ids = [relation['id'] for relation in model['relations']]
        assert len(ids) == len(set(ids))
        for relation in model['relations']:
            assert all(ref in sources for ref in relation['source_refs'])
        for episode in model['episodes']:
            occurrences = [event['id'] for event in episode['events']]
            assert len(occurrences) == len(set(occurrences))
            assert all(event['source_refs'] for event in episode['events'])
            for event in episode['events']:
                assert all(ref in sources for ref in event['source_refs'])
                assert event['outcome'] in model['actions'][event['action']]['outcomes']
    subprocess.run([sys.executable, str(ROOT / 'replay.py')], check=True)
    print(f'Validated {len(models)} frozen models and {len(sources)} source records. Application behavior was not rerun.')


if __name__ == '__main__':
    main()
