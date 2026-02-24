#!/bin/bash
# Setup automatic daily backups via system cron
# Run this once after configuring .env.local with backup credentials

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Cron schedule: 3 AM daily
CRON_SCHEDULE="0 3 * * *"

# Create cron entry
CRON_CMD="cd $PROJECT_DIR && docker-compose --profile backup run --rm backup >> /var/log/claos-backup.log 2>&1"

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "claos.*backup"; then
    echo "[SETUP] Backup cron already exists"
    crontab -l | grep "claos"
else
    # Add to crontab
    (crontab -l 2>/dev/null || true; echo "$CRON_SCHEDULE $CRON_CMD") | crontab -
    echo "[SETUP] Added backup cron:"
    echo "  Schedule: $CRON_SCHEDULE (3 AM daily)"
    echo "  Logs: /var/log/claos-backup.log"
fi

# Test backup credentials
echo ""
echo "[SETUP] Testing backup configuration..."
source "$PROJECT_DIR/.env.local" 2>/dev/null || true

if [[ -z "${BACKUP_BUCKET:-}" ]]; then
    echo "[SETUP] ⚠️  BACKUP_BUCKET not set in .env.local"
    echo ""
    echo "Add these to .env.local:"
    echo "  BACKUP_BUCKET=your-bucket-name"
    echo "  BACKUP_ENDPOINT=https://xxx.r2.cloudflarestorage.com  # For R2"
    echo "  AWS_ACCESS_KEY_ID=your-key"
    echo "  AWS_SECRET_ACCESS_KEY=your-secret"
    exit 1
fi

echo "[SETUP] ✅ Backup configured!"
echo ""
echo "Manual backup: docker-compose --profile backup run --rm backup"
echo "List backups:  docker-compose --profile backup run --rm backup /scripts/restore.sh list"
echo "Restore:       docker-compose --profile backup run --rm backup /scripts/restore.sh latest"
