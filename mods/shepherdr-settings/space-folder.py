#!/usr/bin/env python3
"""Change one local space folder through core CAS; keep the Files root aligned."""
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def app_home():
    return Path(os.environ.get('HERDR_APP_HOME') or Path.home() / '.config/herdr-app')


def rpc(method, params):
    request = {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}
    result = subprocess.run(['hc', 'connect'], input=json.dumps(request) + '\n',
                            capture_output=True, text=True, timeout=10, check=True)
    for line in result.stdout.splitlines():
        response = json.loads(line)
        if response.get('id') == 1:
            return response
    raise ValueError('Herdr core did not answer. Try again when it is connected.')


def read_doc(call):
    response = call('doc.get', {'name': 'herdr-app'})
    if response.get('error'):
        raise ValueError('Cannot read the space from Herdr core.')
    doc = response['result']
    if not isinstance(doc.get('value'), dict) or not isinstance(doc['value'].get('spaces'), list):
        raise ValueError('Herdr has no space document. No changes were made.')
    return doc


def find_space(doc, ident):
    matches = [s for s in doc['value']['spaces'] if s.get('id') == ident]
    if len(matches) != 1:
        raise ValueError('This space is no longer available.')
    return matches[0]


def restore_folder(call, ident, changed, original):
    for _ in range(5):
        doc = read_doc(call)
        space = find_space(doc, ident)
        if space.get('folder') != changed:
            return False  # Never overwrite another edit made after ours.
        value = copy.deepcopy(doc['value'])
        target = next(s for s in value['spaces'] if s['id'] == ident)
        if original is None:
            target.pop('folder', None)
        else:
            target['folder'] = original
        result = call('doc.set', {'name': 'herdr-app', 'version': doc['version'], 'value': value})
        if not result.get('error'):
            return True
        if result['error'].get('data', {}).get('kind') != 'conflict':
            return False
    return False


def set_folder(ident, folder, expected, call=None):
    if not isinstance(ident, str) or not re.fullmatch(r'sp[\w-]+', ident):
        raise ValueError('Choose a local space.')
    if not isinstance(folder, str) or not folder.strip() or any(c in folder for c in '\0\r\n'):
        raise ValueError('Enter an existing absolute folder path.')
    path = Path(folder.strip()).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise ValueError('The folder must be an existing absolute directory.')
    folder = os.path.normpath(str(path))
    call = call or rpc
    data = app_home() / 'data'
    data.mkdir(parents=True, exist_ok=True)
    roots_path = data / 'workspace-folders.json'
    with (data / 'space-folder.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        roots = json.loads(roots_path.read_text()) if roots_path.exists() else {}
        if not isinstance(roots, dict):
            raise ValueError('Saved project folders are invalid. No changes were made.')
        for _ in range(5):
            doc = read_doc(call)
            space = find_space(doc, ident)
            current = roots.get(ident) or space.get('folder')
            if current != expected:
                raise ValueError('The project folder changed elsewhere. Reopen Space settings before saving.')
            original = space.get('folder')
            value = copy.deepcopy(doc['value'])
            next(s for s in value['spaces'] if s['id'] == ident)['folder'] = folder
            updated = {**roots, ident: folder}
            fd, temporary = tempfile.mkstemp(prefix='.workspace-folders-', dir=data)
            try:
                with os.fdopen(fd, 'w') as output:
                    json.dump(updated, output, ensure_ascii=False, indent=2)
                    output.write('\n')
                    output.flush()
                    os.fsync(output.fileno())
                try:
                    result = call('doc.set', {'name': 'herdr-app', 'version': doc['version'], 'value': value})
                except Exception as error:
                    # The core may have committed before its response was lost.
                    try:
                        committed = find_space(read_doc(call), ident).get('folder') == folder
                    except Exception:
                        committed = False
                    if not committed:
                        raise ValueError('The save could not be confirmed. Reopen settings to check the space folder.') from error
                    result = {'result': {}}
                if result.get('error'):
                    if result['error'].get('data', {}).get('kind') == 'conflict':
                        continue
                    raise ValueError('Herdr could not save the space folder.')
                try:
                    os.replace(temporary, roots_path)
                except OSError as error:
                    try:
                        restored = restore_folder(call, ident, folder, original)
                    except Exception:
                        restored = False
                    message = 'The Files root could not be saved. ' + (
                        'The space folder was restored.' if restored else
                        'The space folder may have changed; reopen settings to check it.')
                    raise ValueError(message) from error
                return {'space': ident, 'folder': folder, 'roots': updated}
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        raise ValueError('The space kept changing. Try saving again.')


if __name__ == '__main__':
    try:
        payload = json.loads(sys.argv[1])
        print(json.dumps(set_folder(payload['space'], payload['folder'], payload.get('expected'))))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
