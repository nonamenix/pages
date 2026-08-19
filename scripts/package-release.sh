#!/bin/sh
set -eu

git diff --quiet
git diff --cached --quiet
test -z "$(git status --porcelain)" || { printf 'Worktree must be clean.\n' >&2; exit 1; }

commit=$(git rev-parse HEAD)
mkdir -p .tmp
output=${1:-".tmp/pages-live4dev-${commit}.tar.gz"}
case "$output" in
  /*) ;;
  *) output="$PWD/$output" ;;
esac

git archive --format=tar.gz --output "$output" "$commit"
openssl dgst -sha256 -r "$output" > "$output.sha256"
printf 'artifact=%s\nchecksum=%s.sha256\ncommit=%s\n' "$output" "$output" "$commit"
