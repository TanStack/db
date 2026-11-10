"""Exact selector only, reusing the frozen one-list wrapper and loader."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PREVIOUS = HERE.parent / 'metadata-update-native-preparation-v2'
PREVIOUS_BINDING = '86ccd3bf644d96f43e726f1e805c4b8850754707b7bb88c48ccd802cd90bd7b9'


def load_wrapper():
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()
    if digest(PREVIOUS / 'binding.json') != PREVIOUS_BINDING:
        raise ValueError('accepted universe preparation binding changed')
    binding = json.loads((PREVIOUS / 'binding.json').read_text())
    if digest(PREVIOUS / 'run.py') != binding['files']['run.py']:
        raise ValueError('accepted original wrapper loader changed before import')
    spec = importlib.util.spec_from_file_location('frozen_metadata_wrapper_loader', PREVIOUS / 'run.py')
    previous = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(previous)
    wrapper = previous.load_wrapper()  # All original wrapper functions remain unchanged.
    wrapper.HERE = HERE  # Explicit selector binding/recipe namespace.
    return wrapper


def execute(binding_sha):
    return load_wrapper().execute('selector', binding_sha)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Separate root selector admission required: run.py <exact-binding-sha256>')
    sys.exit(execute(sys.argv[1]))
