#!/usr/bin/env python3

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = "345549356290"
REPLACEMENT = "<account-id>"

EXCLUDED_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    "cdk.out",
}

def main():
    scanned = 0
    changed = 0
    replacements = 0
    failures = []

    print("========== PROJECT-WIDE EXACT STRING REPLACEMENT ==========")
    print("Searching for:", TARGET)
    print("Replacing with:", REPLACEMENT)
    print("Project:", ROOT)
    print()

    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue

        relative = path.relative_to(ROOT)

        if any(part in EXCLUDED_DIRS for part in relative.parts):
            continue

        scanned += 1

        try:
            original = path.read_bytes()

            # Skip binary files.
            if b"\x00" in original:
                continue

            content = original.decode("utf-8")

            count = content.count(TARGET)

            if count == 0:
                continue

            updated = content.replace(TARGET, REPLACEMENT)

            # Preserve original file permissions.
            mode = path.stat().st_mode

            path.write_text(updated, encoding="utf-8")
            path.chmod(mode)

            changed += 1
            replacements += count

            print(f"REPLACED: {relative} ({count} occurrence(s))")

        except (OSError, UnicodeDecodeError) as error:
            failures.append((relative, str(error)))
            print(f"FAILED: {relative}: {error}")

    print("\n========== REPLACEMENT SUMMARY ==========")
    print("Files scanned:", scanned)
    print("Files modified:", changed)
    print("Total replacements:", replacements)
    print("Failures:", len(failures))

    if failures:
        raise SystemExit("Some files could not be processed.")

    print("\nReplacement completed.")


if __name__ == "__main__":
    main()
