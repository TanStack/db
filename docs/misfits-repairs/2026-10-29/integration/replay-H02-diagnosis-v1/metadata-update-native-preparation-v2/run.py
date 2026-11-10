"""Fresh universe only, reusing the frozen thin wrapper without copying it.

The imported wrapper's HERE selects this binding/recipe/input namespace. Its
functions, source gate and original run_one containment are not rewritten.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PREVIOUS = HERE.parent / 'metadata-update-native-preparation-v1'
PREVIOUS_BINDING = 'f76ca819782079460124aa2fba14dc203362e5c3a03a435a5d7d30bbdab4ba65'


def load_wrapper():
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()
    if digest(PREVIOUS / 'binding.json') != PREVIOUS_BINDING:
        raise ValueError('original thin-wrapper binding changed')
    binding = json.loads((PREVIOUS / 'binding.json').read_text())
    if digest(PREVIOUS / 'launch.py') != binding['files']['launch.py']:
        raise ValueError('original thin wrapper changed before import')
    spec = importlib.util.spec_from_file_location('frozen_metadata_one_list_wrapper', PREVIOUS / 'launch.py')
    wrapper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wrapper)  # Definitions only; not the original entry point.
    wrapper.HERE = HERE  # Explicit namespace configuration; all original functions stay unchanged.
    return wrapper


def execute(binding_sha):
    return load_wrapper().execute('universe', binding_sha)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Separate root one-shot admission required: run.py <exact-binding-sha256>')
    sys.exit(execute(sys.argv[1]))
