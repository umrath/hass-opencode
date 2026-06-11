#!/usr/bin/env bash
# Blocking: every shell script in the tree must pass `bash -n` (syntax only).
# Covers s6-overlay run/finish/up scripts (bashio shebang), profile.d/*.sh,
# helper scripts under usr/local/bin, git hooks and scripts/.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "Shell syntax (bash -n)"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  all=$(git ls-files)
else
  all=$(find . -path ./.git -prune -o -type f -print | sed 's|^\./||')
fi

is_shell() {
  # by extension
  case "$1" in
    *.sh|*.bash) return 0 ;;
  esac
  # by shebang (s6 run scripts and bare-name helpers). Reset first each call so
  # a stale value never leaks across calls; `|| true` keeps a single-line file
  # without a trailing newline (read returns 1 at EOF but still sets first).
  first=""
  IFS= read -r first < "$1" 2>/dev/null || true
  case "$first" in
    '#!'*sh|'#!'*sh\ *|'#!'*bash|'#!'*bash\ *|'#!'*bashio|'#!'*bashio*) return 0 ;;
  esac
  return 1
}

checked=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  is_shell "$f" || continue
  checked=$((checked + 1))
  if err=$(bash -n "$f" 2>&1); then
    pass "$f"
  else
    fail "$f"
    printf '%s\n' "$err" | while IFS= read -r l; do info "$l"; done
  fi
done < <(printf '%s\n' "$all")

[ "$checked" -gt 0 ] || warn "no shell scripts detected"
finish_check; exit $?
