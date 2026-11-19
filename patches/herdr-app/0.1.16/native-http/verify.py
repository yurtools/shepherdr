#!/usr/bin/env python3
"""Reproduce the four failures, then verify the combined native repairs. Never installs."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parent
MARKDOWN = PACKAGE.parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


IMAGES = load('combined_image_verifier', MARKDOWN / 'reference-images/verify.py')
CODE = load('combined_code_verifier', MARKDOWN / 'code-line-endings/verify.py')


def instrument(runtime):
    # The accepted private tests are exposed in scratch only, without replacing
    # parsing, shaping, policy, image loading or client construction.
    CODE.instrument(runtime)
    IMAGES.instrument(runtime)
    helper = runtime.parent / 'harness/src/document_images.rs'
    with helper.open('a') as out:
        out.write(f'\n#[path = "{PACKAGE / "loader_regressions.rs"}"]\nmod production_http_regressions;\n')
        out.write('pub fn verify_production_http(client: std::sync::Arc<dyn HttpClient>) { production_http_regressions::run_all(client); }\n')


def prepare(source, work):
    source, work = source.resolve(), work.resolve()
    for folder in [MARKDOWN, MARKDOWN / 'code-line-endings', MARKDOWN / 'reference-images']:
        manifest = json.loads((folder / 'manifest.json').read_text())
        files = manifest['runtime']['files'] if folder == MARKDOWN else manifest['files']
        for name, expected in files.items():
            if digest(source / name) != expected:
                raise ValueError(f'Unexpected runtime bytes: {name}; use official v0.1.16')
    fonts = json.loads((MARKDOWN / 'manifest.json').read_text())
    for asset in fonts['assets']:
        if digest(MARKDOWN / asset['file']) != asset['sha256']:
            raise ValueError('Unexpected font: ' + asset['file'])
    license = fonts['font_source']
    if digest(MARKDOWN / license['license_file']) != license['license_sha256']:
        raise ValueError('Unexpected font license')
    IMAGES.prepare(source, work)
    # Observe the real Application builder's chosen client without starting an
    # event loop. HeadlessAppContext itself installs a test 404 client, so it
    # cannot stand in for the production application's default transport.
    app = work / 'runtime/vendor/gpui-pre/src/app.rs'
    with app.open('a') as out:
        out.write('\nimpl Application {\n'
                  'pub fn verification_from_context(cx: &crate::HeadlessAppContext) -> Self { Self::with_platform(crate::TestPlatform::new(cx.background_executor.clone(), cx.foreground_executor.clone())) }\n'
                  'pub fn verification_http_client(&self) -> Arc<dyn HttpClient> { self.0.borrow().http_client() }\n}\n')
    harness = work / 'harness'
    for name in ['Cargo.toml', 'Cargo.lock']:
        shutil.copyfile(PACKAGE / 'harness' / name, harness / name)
    shutil.copyfile(MARKDOWN / 'harness/build.rs', harness / 'build.rs')
    shutil.copyfile(PACKAGE / 'client.rs', harness / 'src/production_http.rs')
    for name, path in [('font_check', MARKDOWN / 'harness/src/main.rs'), ('eol_check', MARKDOWN / 'code-line-endings/harness/main.rs')]:
        text = path.read_text().replace('fn main() -> Result<()> {', 'pub fn run() -> Result<()> {')
        (harness / f'src/{name}.rs').write_text(text)
    text = (harness / 'src/main.rs').read_text().replace('fn main() -> Result<()> {', 'fn image_main() -> Result<()> {')
    text += '''
mod production_http;
mod font_check;
mod eol_check;
fn application_client(configured: bool) -> Arc<dyn gpui::http_client::HttpClient> {
    let cx = context(false);
    let app = gpui::Application::verification_from_context(&cx);
    let app = if configured { app.with_http_client(production_http::client()) } else { app };
    app.verification_http_client()
}
fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.iter().any(|a| a == "--only-http") {
        let client = application_client(!args.iter().any(|a| a == "--http-baseline"));
        document_images::verify_production_http(client);
        return Ok(());
    }
    if args.iter().any(|a| a == "--only-fonts") { return font_check::run(); }
    if args.iter().any(|a| a == "--only-eol") { return eol_check::run(); }
    if args.iter().any(|a| a == "--only-images") { return image_main(); }
    font_check::run()?;
    eol_check::run()?;
    image_main()?;
    document_images::verify_production_http(application_client(true));
    println!("COMPLETE combined native emphasis, EOL/source/copy, references, lifecycle and real HTTP checks");
    Ok(())
}
'''
    (harness / 'src/main.rs').write_text(text)
    instrument(work / 'runtime')
    return work


def run(source, work, target=None, pixels=False, control=None):
    runtime = work / 'runtime'
    env = dict(os.environ, CARGO_BUILD_JOBS='2', CARGO_TARGET_DIR=str(target or work / 'target'),
               HERDR_FONT_SOURCE=str(runtime), HERDR_CODE_FONT=str(runtime / 'assets/fonts/Geist.ttf'),
               HERDR_IMAGE_FONT=str(runtime / 'assets/fonts/Geist.ttf'))
    command = ['cargo', 'run', '--locked', '--manifest-path', str(work / 'harness/Cargo.toml'), '-j', '2', '--']
    proof = work / 'proof'
    proof.mkdir()
    results = []
    controls = ['--control-dir', str(control.resolve())] if control else []

    def attempt(label, args):
        folder = proof / label
        folder.mkdir()
        log = proof / (label + '.log')
        with log.open('w') as output:
            result = subprocess.run(command + args, cwd=folder, env=env, stdout=output, stderr=subprocess.STDOUT)
        results.append({'label': label, 'command': command + args, 'exit_code': result.returncode})
        (proof / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        print(f'{label}: exit {result.returncode}; {log}', flush=True)
        return result.returncode, log.read_text()

    status, text = attempt('before-http', ['--only-http', '--http-baseline'])
    if status == 0 or 'No HttpClient available' not in text or 'production GPUI client must perform a permitted image GET' not in text:
        raise RuntimeError('The baseline did not reproduce the missing production transport')
    for label, option, marker in [('fonts', '--only-fonts', 'actual current glyph face for "aster"'),
                                  ('eol', '--only-eol', 'nl-fence-CR'),
                                  ('images', '--only-images', 'reference image must be emitted')]:
        status, text = attempt('before-' + label, [option] + controls)
        if status == 0 or marker not in text:
            raise RuntimeError('The baseline did not reproduce the expected ' + label + ' assertion')
        if pixels:
            status, _ = attempt('before-' + label + '-pixels', [option, '--diagnose', '--pixels'] + controls)
            if status:
                raise RuntimeError('Baseline native diagnostic failed: ' + label)
    for name in [IMAGES.ADAPTER, IMAGES.BASE / 'node.rs', IMAGES.BASE / 'state.rs',
                 IMAGES.BASE / 'mod.rs', IMAGES.BASE / 'markdown_ext.rs']:
        shutil.copyfile(source / name, runtime / name)
    for folder in [MARKDOWN, MARKDOWN / 'code-line-endings', MARKDOWN / 'reference-images', PACKAGE]:
        subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(folder / 'runtime.patch')], cwd=runtime, check=True)
    fonts = json.loads((MARKDOWN / 'manifest.json').read_text())
    for asset in fonts['assets']:
        shutil.copyfile(MARKDOWN / asset['file'], runtime / asset['destination'])
    manifest = json.loads((PACKAGE / 'manifest.json').read_text())
    for name, checksums in manifest['files'].items():
        if digest(runtime / name) != checksums['after']:
            raise ValueError('Unexpected combined production bytes: ' + name)
    if digest(runtime / 'src/document_http.rs') != digest(PACKAGE / 'client.rs'):
        raise ValueError('Regression factory differs from the production factory')
    instrument(runtime)
    status, _ = attempt('after-combined', (['--pixels'] if pixels else []) + controls)
    if status:
        raise RuntimeError('Combined native regressions failed; inspect after-combined.log')
    print('Verified four original failures and the combined native repairs. No app was installed or launched.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('work', type=Path)
    parser.add_argument('--target-dir', type=Path)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--pixels', action='store_true')
    parser.add_argument('--control-dir', type=Path)
    args = parser.parse_args()
    source, work = args.source.resolve(), args.work.resolve()
    target = args.target_dir.resolve() if args.target_dir else None
    if target and (target == source or source in target.parents):
        parser.error('Cargo target must stay outside the input source')
    prepare(source, work)
    if not args.prepare_only:
        run(source, work, target, args.pixels, args.control_dir)
