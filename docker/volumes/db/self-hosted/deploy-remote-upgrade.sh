#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$DB_DIR/migrations"

HOST=""
PORT=""
REMOTE_DIR=""
BACKUP_COMPLETED=false

usage() {
  cat <<'EOF'
Upload and apply Readest self-hosted database migrations over SSH.

Usage:
  deploy-remote-upgrade.sh --host USER@HOST --backup-completed [options]

Required:
  --host USER@HOST       SSH destination, including the remote user when needed
  --backup-completed     Confirm `sudo -iu postgres pig pb backup` succeeded

Options:
  --port PORT            Non-default SSH port
  --remote-dir PATH      Absolute staging directory on the remote host
  -h, --help             Show this help

The script uploads only migrations 018–024 plus upgrade.sh and verify.sql. It
does not run the backup command and never runs bootstrap.sh.
EOF
}

die() {
  echo "Error: $*" >&2
  exit 2
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --host)
      [[ "$#" -ge 2 ]] || die '--host requires a value'
      HOST="$2"
      shift 2
      ;;
    --port)
      [[ "$#" -ge 2 ]] || die '--port requires a value'
      PORT="$2"
      shift 2
      ;;
    --remote-dir)
      [[ "$#" -ge 2 ]] || die '--remote-dir requires a value'
      REMOTE_DIR="$2"
      shift 2
      ;;
    --backup-completed)
      BACKUP_COMPLETED=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$HOST" ]] || die '--host is required'
[[ "$BACKUP_COMPLETED" == true ]] || die \
  'backup confirmation is required; run `sudo -iu postgres pig pb backup` successfully, then add --backup-completed'

if [[ ! "$HOST" =~ ^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$ ]]; then
  die '--host contains unsupported characters; use USER@HOST or an SSH config alias'
fi

if [[ -n "$PORT" && ! "$PORT" =~ ^[0-9]+$ ]]; then
  die '--port must be numeric'
fi

for command_name in ssh scp; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is not installed"
done

required_files=(
  "$MIGRATIONS_DIR/018_add_storage_stats_rpc.sql"
  "$MIGRATIONS_DIR/019_add_metadata_updated_at.sql"
  "$MIGRATIONS_DIR/020_stat_pages_upsert_rpc.sql"
  "$MIGRATIONS_DIR/021_stat_archives.sql"
  "$MIGRATIONS_DIR/022_stat_archive_row_cap.sql"
  "$MIGRATIONS_DIR/023_add_group_updated_at.sql"
  "$MIGRATIONS_DIR/024_replica_abs_server.sql"
  "$SCRIPT_DIR/upgrade.sh"
  "$SCRIPT_DIR/verify.sql"
)

for required_file in "${required_files[@]}"; do
  [[ -f "$required_file" ]] || die "required file is missing: $required_file"
done

run_ssh() {
  if [[ -n "$PORT" ]]; then
    command ssh -p "$PORT" "$@"
  else
    command ssh "$@"
  fi
}

run_scp() {
  if [[ -n "$PORT" ]]; then
    command scp -P "$PORT" "$@"
  else
    command scp "$@"
  fi
}

if [[ -z "$REMOTE_DIR" ]]; then
  remote_home="$(run_ssh "$HOST" 'printf "%s" "$HOME"')"
  [[ "$remote_home" =~ ^/[A-Za-z0-9._/-]+$ ]] || die \
    'remote home directory contains unsupported characters; pass a safe absolute path with --remote-dir'
  REMOTE_DIR="${remote_home%/}/readest-db-024-$(date -u +%Y%m%dT%H%M%SZ)"
fi

if [[ ! "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  die '--remote-dir must be an absolute path containing only letters, digits, dot, underscore, dash, and slash'
fi

echo "Preparing remote staging directory: $HOST:$REMOTE_DIR"
run_ssh "$HOST" \
  "mkdir -p -- '$REMOTE_DIR/migrations' '$REMOTE_DIR/self-hosted'"

echo 'Uploading Readest migrations and verification files...'
run_scp \
  "$MIGRATIONS_DIR/018_add_storage_stats_rpc.sql" \
  "$MIGRATIONS_DIR/019_add_metadata_updated_at.sql" \
  "$MIGRATIONS_DIR/020_stat_pages_upsert_rpc.sql" \
  "$MIGRATIONS_DIR/021_stat_archives.sql" \
  "$MIGRATIONS_DIR/022_stat_archive_row_cap.sql" \
  "$MIGRATIONS_DIR/023_add_group_updated_at.sql" \
  "$MIGRATIONS_DIR/024_replica_abs_server.sql" \
  "$HOST:$REMOTE_DIR/migrations/"
run_scp \
  "$SCRIPT_DIR/upgrade.sh" \
  "$SCRIPT_DIR/verify.sql" \
  "$HOST:$REMOTE_DIR/self-hosted/"

echo 'Applying forward migrations and running independent verification...'
run_ssh -tt "$HOST" \
  "set -e; cd '$REMOTE_DIR'; chmod +x self-hosted/upgrade.sh; ./self-hosted/upgrade.sh sudo -iu postgres psql -d postgres -X; sudo -iu postgres psql -d postgres -X -v ON_ERROR_STOP=1 < self-hosted/verify.sql"

echo
echo 'Readest database upgrade and verification completed successfully.'
echo "Remote audit directory retained at: $REMOTE_DIR"
