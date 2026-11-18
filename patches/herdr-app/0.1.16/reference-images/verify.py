#!/usr/bin/env python3
"""Run real adapter/loader regressions in NEW scratch source. Never installs an app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parent
BASE = Path('vendor/gpui-kit/crates/base/src/text')
ADAPTER = BASE / 'format/markdown.rs'
CHANGED = [ADAPTER, BASE / 'node.rs', BASE / 'state.rs']
SHELL = Path('vendor/gpui-kit/crates/shell/src')


def prepare(source, work):
    source, work = source.resolve(), work.resolve()
    manifest = json.loads((PACKAGE / 'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unexpected runtime bytes: {name}; use official v0.1.16')
    if work.exists() or source == work or source in work.parents:
        raise ValueError('Work must be a NEW scratch directory outside the input source')
    work.mkdir(parents=True)
    shutil.copytree(source, work / 'runtime', ignore=shutil.ignore_patterns('.git', '.cargo', 'target'))
    for path in CHANGED:
        dest = work / 'original' / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / path, dest)
    harness = work / 'harness'
    (harness / 'src').mkdir(parents=True)
    for name in ['Cargo.toml', 'Cargo.lock']:
        shutil.copyfile(PACKAGE / 'harness' / name, harness / name)
    shutil.copyfile(PACKAGE / 'harness/main.rs', harness / 'src/main.rs')
    return work


def callable_tests(text):
    return re.sub(r'#\[(?:gpui::)?test\]\n(\s*)fn ', r'\1pub fn ', text).replace('gpui::TestAppContext', 'gpui::HeadlessAppContext')


def instrument(runtime):
    """Expose private tests in scratch only; replace no production parse/load logic."""
    adapter = runtime / ADAPTER
    text = adapter.read_text()
    legacy = re.findall(r'#\[test\]\n    fn (\w+)\(', text)
    text = callable_tests(text.replace('#[cfg(test)]\nmod tests {', 'mod tests {'))
    text += '\nfn verify_legacy() {\n' + ''.join(f'    tests::{name}();\n' for name in legacy) + f'    println!("PASS {len(legacy)} existing adapter tests");\n' + '}\n'
    for filename, target, declaration in [
        ('regressions.rs', 'reference_images_tests.rs', 'pub(crate) mod reference_images_tests;'),
    ]:
        tests = (PACKAGE / filename).read_text()
        names = re.findall(r'#\[test\]\nfn (\w+)\(', tests)
        tests = callable_tests(tests)
        tests += '\npub fn run_all() {\n' + ''.join(f'    println!("RUN {name}"); {name}(); println!("PASS {name}");\n' for name in names) + '    super::verify_legacy();\n}\n'
        (adapter.parent / target).write_text(tests)
        text = text.replace(f'#[cfg(test)]\n#[path = "{target}"]\n{declaration}', '')
        text += f'\n#[path = "{target}"]\n{declaration}\n'
    adapter.write_text(text)

    state = runtime / BASE / 'state.rs'
    tests = (PACKAGE / 'state_regressions.rs').read_text()
    names = re.findall(r'#\[(?:gpui::)?test\]\nfn (\w+)\(([^)]*)\)', tests)
    tests = callable_tests(tests)
    tests += '\npub fn run_all(cx: &mut gpui::HeadlessAppContext) {\n' + ''.join(f'    println!("RUN {name}"); {name}({"cx" if args else ""}); println!("PASS {name}");\n' for name, args in names) + '}\n'
    (state.parent / 'reference_images_state_tests.rs').write_text(tests)
    text = state.read_text().replace('#[cfg(test)]\n#[path = "reference_images_state_tests.rs"]\nmod reference_images_state_tests;', '')
    text += '\n#[path = "reference_images_state_tests.rs"]\npub(crate) mod reference_images_state_tests;\n'
    state.write_text(text)
    # Existing adapter tests need their original test-only helpers.
    node = runtime / BASE / 'node.rs'
    node.write_text(re.sub(r'#\[cfg\(test\)\]\n(    pub\(crate\) fn set_selection)', r'\1', node.read_text()))
    extension = runtime / BASE / 'markdown_ext.rs'
    extension.write_text(re.sub(r'#\[cfg\(test\)\]\n(?=(pub\(super\) struct TestInlinePlugin|impl (TestInlinePlugin|MarkdownPlugin for TestInlinePlugin)))', '', extension.read_text()))
    module = runtime / BASE / 'mod.rs'
    if 'pub fn verify_reference_images()' not in module.read_text():
        with module.open('a') as out:
            out.write('\npub fn verify_reference_images() { format::markdown::reference_images_tests::run_all(); }\n')
            out.write('pub fn verify_reference_image_state(cx: &mut gpui::HeadlessAppContext) { state::reference_images_state_tests::run_all(cx); }\n')
    # Compile unchanged production loader and capability code directly into the
    # assertion harness, bypassing only the unrelated JS interpreter/host modules.
    harness = runtime.parent / 'harness/src'
    shutil.copyfile(runtime / SHELL / 'materialize/text_view.rs', harness / 'document_images.rs')
    shutil.copyfile(runtime / SHELL / 'capability.rs', harness / 'capability.rs')
    # Re-run the host's existing URL/redirect/body-boundary tests too. Only the
    # unrelated JS mounting tests after this boundary are excluded.
    original = (runtime / SHELL / 'materialize/text_view/tests.rs').read_text().split('struct Documents(')[0]
    original = original.replace('use crate::{HttpRequestGrant, ScriptView, ShellRuntime};', 'use crate::HttpRequestGrant;')
    names = re.findall(r'#\[(?:gpui::)?test\]\nfn (\w+)\(([^)]*)\)', original)
    original = callable_tests(original).replace('TestAppContext', 'HeadlessAppContext')
    original += '\npub fn run_all(cx: &mut gpui::HeadlessAppContext) {\n' + ''.join(f'    {name}({"cx" if args else ""}); println!("PASS original {name}");\n' for name, args in names) + '}\n'
    (harness / 'original_policy_tests.rs').write_text(original)
    with (harness / 'document_images.rs').open('a') as out:
        out.write('\n#[path = "original_policy_tests.rs"]\nmod original_policy_tests;\n')
        out.write('pub fn verify_original_policy(cx: &mut gpui::HeadlessAppContext) { original_policy_tests::run_all(cx); }\n')


def run(work, pixels=False, target=None):
    runtime = work / 'runtime'
    env = dict(os.environ, CARGO_TARGET_DIR=str(target.resolve() if target else work / 'target'), CARGO_BUILD_JOBS='2', HERDR_IMAGE_FONT=str(runtime / 'assets/fonts/Geist.ttf'))
    command = ['cargo', 'run', '--locked', '--manifest-path', str(work / 'harness/Cargo.toml'), '-j', '2', '--']
    proof = work / 'proof'; proof.mkdir()

    def attempt(label, args):
        folder = proof / label; folder.mkdir()
        log = proof / f'{label}.txt'
        with log.open('w') as out:
            result = subprocess.run(command + args, cwd=folder, env=env, stdout=out, stderr=subprocess.STDOUT)
        print(f'{label}: exit {result.returncode}; {log}', flush=True)
        return result.returncode, log.read_text()

    instrument(runtime)
    status, text = attempt('before-regression', [])
    if not status or 'reference image must be emitted' not in text:
        raise RuntimeError('Baseline did not fail the intended image assertion; inspect log')
    if pixels:
        status, _ = attempt('before-pixels', ['--diagnose', '--pixels'])
        if status:
            raise RuntimeError('Baseline headless diagnostic failed')
    for path in CHANGED:
        shutil.copyfile(work / 'original' / path, runtime / path)
    subprocess.run(['patch', '--batch', '--forward', '-p1', '-i', str(PACKAGE / 'runtime.patch')], cwd=runtime, check=True)
    instrument(runtime)
    status, _ = attempt('after', ['--pixels'] if pixels else [])
    if status:
        raise RuntimeError('Patched image regressions failed; inspect log')
    print('Verified: same image assertion fails before and passes after; actual adapter, state and policy loader exercised. No app installed or started.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('work', type=Path)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--pixels', action='store_true')
    parser.add_argument('--target-dir', type=Path, help='task-owned Cargo cache outside input source')
    args = parser.parse_args()
    if args.target_dir and (args.target_dir.resolve() == args.source.resolve() or args.source.resolve() in args.target_dir.resolve().parents):
        parser.error('Cargo target must be outside input source')
    work = prepare(args.source, args.work)
    print(f'Prepared {work}', flush=True)
    if not args.prepare_only:
        run(work, args.pixels, args.target_dir)
