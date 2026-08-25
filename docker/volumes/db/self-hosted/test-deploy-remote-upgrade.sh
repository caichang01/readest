#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-remote-upgrade.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BIN_DIR="$TMP_DIR/bin"
LOG_FILE="$TMP_DIR/commands.log"
mkdir -p "$BIN_DIR"

cat >"$BIN_DIR/ssh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'ssh' >>"$COMMAND_LOG"
printf ' <%s>' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
SH

cat >"$BIN_DIR/scp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'scp' >>"$COMMAND_LOG"
printf ' <%s>' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
SH

chmod +x "$BIN_DIR/ssh" "$BIN_DIR/scp"

if PATH="$BIN_DIR:$PATH" COMMAND_LOG="$LOG_FILE" \
  "$DEPLOY_SCRIPT" --host tester@db.example.test >/dev/null 2>&1; then
  echo 'Expected deployment to reject a missing backup confirmation' >&2
  exit 1
fi

if [[ -e "$LOG_FILE" ]]; then
  echo 'Deployment contacted the remote host before backup confirmation' >&2
  exit 1
fi

PATH="$BIN_DIR:$PATH" COMMAND_LOG="$LOG_FILE" \
  "$DEPLOY_SCRIPT" \
  --host tester@db.example.test \
  --port 2222 \
  --remote-dir /home/tester/readest-db-019-test \
  --backup-completed >/dev/null

assert_log_contains() {
  local pattern="$1"
  if ! grep -Fq -- "$pattern" "$LOG_FILE"; then
    echo "Expected remote deployment log to contain: $pattern" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
}

assert_log_not_contains() {
  local pattern="$1"
  if grep -Fq -- "$pattern" "$LOG_FILE"; then
    echo "Expected remote deployment log not to contain: $pattern" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
}

assert_log_contains "ssh <-p> <2222> <tester@db.example.test> <mkdir -p -- '/home/tester/readest-db-019-test/migrations' '/home/tester/readest-db-019-test/self-hosted'>"
assert_log_contains 'scp <-P> <2222>'
assert_log_contains '<tester@db.example.test:/home/tester/readest-db-019-test/migrations/>'
assert_log_contains '<tester@db.example.test:/home/tester/readest-db-019-test/self-hosted/>'
assert_log_contains './self-hosted/upgrade.sh sudo -iu postgres psql -d postgres -X'
assert_log_contains "sudo -iu postgres psql -d postgres -X -v ON_ERROR_STOP=1 < self-hosted/verify.sql"
assert_log_not_contains 'bootstrap.sh'
assert_log_not_contains 'pig pb backup'

echo 'remote self-hosted upgrade deployment test passed'
