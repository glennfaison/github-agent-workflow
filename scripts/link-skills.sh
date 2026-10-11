#!/usr/bin/env bash
set -euo pipefail

# Links every skill in this package into a skills directory, so agents that only look one level deep
# (Kilo Code, Codex, ...) can find skills that live in bucket folders here.
#
#   scripts/link-skills.sh [--dest DIR] [--dry-run]
#
# Each skill becomes a relative symlink: DIR/<skill> -> <package>/skills/<bucket>/<skill>.
# By default DIR is this package's parent directory, but only when that directory is named "skills"
# (the usual case when the package is a folder or submodule at .agents/skills/<package>).
# Otherwise pass --dest. Buckets named "deprecated" and "in-progress" are never linked.
# Links that point into this package but no longer have a target are removed.
#
# Run it again after adding, renaming or removing a skill. Safe to run any number of times.

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=""
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:?--dest needs a directory}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '3,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$DEST" ]; then
  parent="$(dirname "$PKG")"
  if [ "$(basename "$parent")" != "skills" ]; then
    echo "error: $parent is not a directory named 'skills'. Pass --dest DIR." >&2
    exit 1
  fi
  DEST="$parent"
fi
[ -d "$DEST" ] || { echo "error: $DEST is not a directory" >&2; exit 1; }
DEST="$(cd "$DEST" && pwd)"

# Portable stand-ins for GNU `realpath -m` and `realpath --relative-to` (absent on macOS).
abspath() { python3 -c 'import os,sys; print(os.path.normpath(os.path.join(sys.argv[1], sys.argv[2])))' "$1" "$2"; }
relpath() { python3 -c 'import os,sys; print(os.path.relpath(sys.argv[2], sys.argv[1]))' "$1" "$2"; }

run() { if [ "$DRY" -eq 1 ]; then echo "would: $*"; else "$@"; fi; }

# Remove dangling links that point into this package.
for link in "$DEST"/*; do
  [ -L "$link" ] || continue
  target="$(readlink "$link")"
  abs="$(abspath "$DEST" "$target")"
  case "$abs" in
    "$PKG"/skills/*) [ -e "$abs" ] || { echo "removing stale link $(basename "$link")"; run rm "$link"; } ;;
  esac
done

count=0
while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  name="$(basename "$src")"
  rel="$(relpath "$DEST" "$src")"
  target="$DEST/$name"

  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "error: $target exists and is not a symlink. Move or delete it first." >&2
    exit 1
  fi
  run ln -sfn "$rel" "$target"
  echo "linked $name -> $rel"
  count=$((count + 1))
done < <(find "$PKG/skills" -mindepth 3 -maxdepth 3 -name SKILL.md \
           -not -path '*/deprecated/*' -not -path '*/in-progress/*' -print0 | sort -z)

echo "$count skills linked into $DEST"
