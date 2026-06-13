# OpenCode/Bun extracts the native opentui renderer to $TMPDIR and maps it
# executable. The add-on's /tmp is mounted noexec (tmpfs: true), so that mmap is
# refused and the OpenCode TUI crashes at start-up. Point Bun at an exec-capable
# directory on the persistent volume for every login shell, so `opencode` works
# whether it is auto-started or typed manually in any terminal/tmux window.
export TMPDIR="${TMPDIR:-/data/tmp}"
mkdir -p "${TMPDIR}" 2>/dev/null || true
