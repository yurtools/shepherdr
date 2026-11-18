#!/usr/bin/env python3
"""Prepare and test the font patch in a NEW scratch tree. Never installs anything."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

PACKAGE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_files(root, files):
    for name, expected in files.items():
        if digest(root / name) != expected:
            raise ValueError(f"Unexpected source bytes: {name}; use the exact v0.1.16 archive")


def prepare(source, work):
    source, work = source.resolve(), work.resolve()
    manifest = json.loads((PACKAGE / "manifest.json").read_text())
    verify_files(source, manifest["runtime"]["files"])
    verify_files(PACKAGE, {a["file"]: a["sha256"] for a in manifest["assets"]})
    license = manifest["font_source"]
    verify_files(PACKAGE, {license["license_file"]: license["license_sha256"]})
    if work.exists() or source == work or source in work.parents:
        raise ValueError("Work must be a new directory outside the supplied source tree")
    work.mkdir(parents=True)
    runtime = work / "runtime"
    # The input stays read-only. Even a source checkout's targets/config are excluded.
    shutil.copytree(source, runtime, ignore=shutil.ignore_patterns(".git", ".cargo", "target"))
    baseline = work / "baseline"
    (baseline / "src").mkdir(parents=True)
    shutil.copyfile(source / "src/settings.rs", baseline / "src/settings.rs")
    shutil.copytree(source / "assets/fonts", baseline / "assets/fonts")
    subprocess.run(["patch", "--batch", "--forward", "-p1", "-i", str(PACKAGE / "runtime.patch")], cwd=runtime, check=True)
    for asset in manifest["assets"]:
        target = runtime / asset["destination"]
        if target.exists():
            raise ValueError(f"Refusing to replace an existing new face: {target.name}")
        shutil.copyfile(PACKAGE / asset["file"], target)
    # The original OFL and Regular face are deliberately unchanged.
    verify_files(runtime, {n: h for n, h in manifest["runtime"]["files"].items() if n.startswith("assets/")})
    shutil.copytree(PACKAGE / "harness", work / "harness", ignore=shutil.ignore_patterns("target"))
    return work


def run(work, pixels=False, control=None):
    env = dict(os.environ, CARGO_TARGET_DIR=str(work / "target"), CARGO_BUILD_JOBS="2")
    command = ["cargo", "run", "--locked", "--manifest-path", str(work / "harness/Cargo.toml"), "-j", "2", "--"]
    extra = (["--pixels"] if pixels else []) + (["--control-dir", str(control.resolve())] if control else [])
    proof = work / "proof"
    proof.mkdir()

    def attempt(label, source, arguments):
        folder = proof / label
        folder.mkdir()
        log = proof / f"{label}.txt"
        with log.open("w") as out:
            result = subprocess.run(command + arguments, cwd=folder, env=dict(env, HERDR_FONT_SOURCE=str(work / source)), stdout=out, stderr=subprocess.STDOUT)
        print(f"{label}: exit {result.returncode}; {log}", flush=True)
        return result.returncode, log.read_text()

    status, text = attempt("before-regression", "baseline", extra)
    if status == 0 or 'actual current glyph face for "aster"' not in text or 'FontWeight(400.0)' not in text:
        raise RuntimeError("Baseline did not reproduce the expected real selected-face assertion; inspect its log")
    if pixels:
        status, _ = attempt("before-pixels", "baseline", ["--diagnose"] + extra)
        if status:
            raise RuntimeError("Baseline native pixel diagnostic failed")
    status, _ = attempt("after", "runtime", extra)
    if status:
        raise RuntimeError("Patched native regressions failed")
    print("Verified: the same selected-face regression fails before and passes after. No app was installed or started.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="exact official unpacked Herdr App v0.1.16 source (read only)")
    parser.add_argument("work", type=Path, help="NEW task-owned scratch directory; must not already exist")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--pixels", action="store_true", help="use the host headless GPU renderer; never opens a native window")
    parser.add_argument("--control-dir", type=Path, help="test-only DejaVu Sans/Mono static TTF directory, for code and UTF-8 fallback controls")
    args = parser.parse_args()
    work = prepare(args.source, args.work)
    print(f"Prepared isolated runtime and harness in {work}", flush=True)
    if not args.prepare_only:
        run(work, args.pixels, args.control_dir)
