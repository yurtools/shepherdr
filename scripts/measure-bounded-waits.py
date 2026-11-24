#!/usr/bin/env python3
"""Measure the actual helper with a prebuilt QuickJS archive, without rebuilding it."""
import argparse
import csv
import hashlib
import io
import json
import pathlib
import subprocess
import tempfile


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include", type=pathlib.Path, required=True)
    parser.add_argument("--archive", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--metadata", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[1]
    c = root / "test/fixtures/bounded-wait-memory.c"
    helper = root / "lib/bounded-wait.js"
    driver = root / "test/fixtures/bounded-wait-memory.js"
    with tempfile.TemporaryDirectory(prefix="bounded-waits-") as scratch:
        binary = pathlib.Path(scratch) / "memory"
        subprocess.run(["gcc", "-O2", "-I", str(args.include), str(c), str(args.archive),
                        "-lm", "-ldl", "-lpthread", "-o", str(binary)], check=True)
        result = subprocess.run([str(binary), str(helper), str(driver)],
                                capture_output=True, text=True, check=True)
    args.output.write_text(result.stdout)
    rows = list(csv.DictReader(io.StringIO(result.stdout)))
    for mode in {row["pattern"] for row in rows}:
        heaps = [int(r["heap_bytes"]) for r in rows if r["pattern"] == mode]
        if mode == "repeated_race":
            assert heaps[-1] - heaps[0] > 40_000_000, heaps
        else:
            assert max(heaps) - min(heaps) < 4096, (mode, heaps)
    args.metadata.write_text(json.dumps({
        "helper_sha256": sha(helper), "driver_sha256": sha(driver), "harness_sha256": sha(c),
        "engine_archive_sha256": sha(args.archive),
        "engine_header_sha256": sha(args.include / "quickjs.h"),
        "engine_source_sha256": sha(args.include / "quickjs.c"),
        "compiler": subprocess.check_output(["gcc", "--version"], text=True).splitlines()[0],
        "compile_returncode": 0, "measurement_returncode": result.returncode,
        "samples": len(rows), "plateau_tolerance_bytes": 4096,
    }, indent=2) + "\n")
    print(result.stdout, end="")
    print("Compile, measurement and plateau assertions: return code 0")


if __name__ == "__main__":
    main()
