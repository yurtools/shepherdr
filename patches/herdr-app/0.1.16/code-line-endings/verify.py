#!/usr/bin/env python3
"""Verify the code-line patch in NEW scratch source, without installing or opening an app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parent
ADAPTER = Path('vendor/gpui-kit/crates/base/src/text/format/markdown.rs')
NODE = Path('vendor/gpui-kit/crates/base/src/text/node.rs')


def parser_lock(lock, host_lock):
    # Keep the accepted harness graph, with the host's exact parser/JSON versions.
    for name in ['unicode-id', 'serde_json']:
        pattern = r'\[\[package\]\]\nname = "' + re.escape(name) + r'"\n.*?(?=\n\[\[package\]\]|\Z)'
        host = re.search(pattern, host_lock, flags=re.S)
        if not host:
            raise ValueError(f'Missing exact host lock entry: {name}')
        lock, count = re.subn(pattern, lambda _: host[0], lock, flags=re.S)
        if count != 1:
            raise ValueError(f'Unexpected harness lock entries: {name}')
    return lock


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
    shutil.copyfile(source / ADAPTER, work / 'original-markdown.rs')
    # Reuse the accepted exact-runtime harness dependency lock, not its font fix.
    harness = work / 'harness'
    (harness / 'src').mkdir(parents=True)
    for name in ['Cargo.toml', 'Cargo.lock']:
        text = (PACKAGE.parent / 'harness' / name).read_text()
        if name == 'Cargo.lock':
            text = parser_lock(text, (source / 'Cargo.lock').read_text())
        (harness / name).write_text(text.replace('markdown-font-regression', 'markdown-code-line-regression'))
    shutil.copyfile(PACKAGE / 'harness/main.rs', harness / 'src/main.rs')
    return work


def instrument(runtime):
    """Expose real private model tests only in the disposable verifier tree.

    This adds visibility/test entry points, not replacement production logic.
    The deliverable patch keeps these as conventional #[test] unit tests.
    """
    adapter = runtime / ADAPTER
    text = adapter.read_text()
    legacy_names = re.findall(r'#\[test\]\n    fn (\w+)\(', text)
    if legacy_names:
        text = text.replace('#[cfg(test)]\nmod tests {', 'mod tests {')
        text = text.replace('#[test]\n    fn ', 'pub fn ')
        text += '\nfn verify_legacy_adapter() {\n' + ''.join(f'    tests::{name}();\n' for name in legacy_names) + f'    println!("PASS {len(legacy_names)} existing adapter regressions");\n' + '}\n'
    test_code = (PACKAGE / 'regressions.rs').read_text()
    names = re.findall(r'#\[test\]\nfn (\w+)\(', test_code)
    test_code = test_code.replace('#[test]\nfn ', 'pub fn ')
    test_code += '\npub fn run_all() {\n' + ''.join(f'    println!("RUN {name}"); {name}(); println!("PASS {name}");\n' for name in names) + '    super::verify_legacy_adapter();\n}\n'
    test_code += '\npub fn payloads(source: &str) -> Vec<String> { codes(&document(source).blocks).iter().map(|code| code.code().to_string()).collect() }\n'
    folder = adapter.parent
    (folder / 'code_line_endings_tests.rs').write_text(test_code)
    shutil.copyfile(PACKAGE / 'fixtures.json', folder / 'code_line_endings_fixtures.json')
    declaration = '#[cfg(test)]\n#[path = "code_line_endings_tests.rs"]\nmod code_line_endings_tests;'
    if declaration in text:
        text = text.replace(declaration, '#[path = "code_line_endings_tests.rs"]\npub(crate) mod code_line_endings_tests;')
    elif 'pub(crate) mod code_line_endings_tests;' not in text:
        text = text.replace('pub(super) mod code_line_endings_tests;', '')
        text += '\n#[path = "code_line_endings_tests.rs"]\npub(crate) mod code_line_endings_tests;\n'
    adapter.write_text(text)
    node = runtime / NODE
    node.write_text(re.sub(r'#\[cfg\(test\)\]\n(    pub\(crate\) fn set_selection)', r'\1', node.read_text()))
    extension = runtime / 'vendor/gpui-kit/crates/base/src/text/markdown_ext.rs'
    extension.write_text(re.sub(r'#\[cfg\(test\)\]\n(?=(pub\(super\) struct TestInlinePlugin|impl (TestInlinePlugin|MarkdownPlugin for TestInlinePlugin)))', '', extension.read_text()))
    module = runtime / 'vendor/gpui-kit/crates/base/src/text/mod.rs'
    if 'pub fn verify_code_line_endings()' not in module.read_text():
        with module.open('a') as out:
            out.write('\npub fn verify_code_line_endings() { format::markdown::code_line_endings_tests::run_all(); }\n')
            out.write('pub fn code_line_ending_payloads(source: &str) -> Vec<String> { format::markdown::code_line_endings_tests::payloads(source) }\n')


def run(work, pixels, target=None):
    runtime = work / 'runtime'
    env = dict(os.environ, CARGO_TARGET_DIR=str(target.resolve() if target else work / 'target'), CARGO_BUILD_JOBS='2', HERDR_CODE_FONT=str(runtime / 'assets/fonts/Geist.ttf'))
    command = ['cargo', 'run', '--locked', '--manifest-path', str(work / 'harness/Cargo.toml'), '-j', '2', '--']
    proof = work / 'proof'
    proof.mkdir()

    def attempt(label, extra):
        folder = proof / label
        folder.mkdir()
        log = proof / f'{label}.txt'
        with log.open('w') as output:
            result = subprocess.run(command + extra, cwd=folder, env=env, stdout=output, stderr=subprocess.STDOUT)
        print(f'{label}: exit {result.returncode}; {log}', flush=True)
        return result.returncode, log.read_text()

    instrument(runtime)
    status, text = attempt('before-regression', [])
    if not status or 'audit_39_fixtures' not in text or 'nl-fence-CR' not in text:
        raise RuntimeError('Unchanged adapter did not fail the intended assertion; inspect log')
    if pixels:
        status, _ = attempt('before-pixels', ['--diagnose', '--pixels'])
        if status:
            raise RuntimeError('Baseline native diagnostic failed')
    # Restore exact adapter bytes before applying the independently reviewable patch.
    shutil.copyfile(work / 'original-markdown.rs', runtime / ADAPTER)
    subprocess.run(['patch', '--batch', '--forward', '-p1', '-i', str(PACKAGE / 'runtime.patch')], cwd=runtime, check=True)
    instrument(runtime)
    status, _ = attempt('after', ['--pixels'] if pixels else [])
    if status:
        raise RuntimeError('Patched runtime regression failed; inspect log')
    print('Verified: unchanged adapter fails; patched adapter/model/native shaping passes. No app installed or started.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('work', type=Path)
    parser.add_argument('--pixels', action='store_true', help='real headless GPUI GPU frames, no native app window')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--target-dir', type=Path, help='reuse a task-owned Cargo build cache; never point into the input source')
    args = parser.parse_args()
    if args.target_dir and (args.target_dir.resolve() == args.source.resolve() or args.source.resolve() in args.target_dir.resolve().parents):
        parser.error('Cargo target must be outside the input source')
    work = prepare(args.source, args.work)
    print(f'Prepared {work}', flush=True)
    if not args.prepare_only:
        run(work, args.pixels, args.target_dir)
