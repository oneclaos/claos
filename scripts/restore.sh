#!/bin/bash
# Claos Restore Script
# Restores DATA_DIR from S3-compatible storage backup

set -euo pipefail

# Configuration
DATA_DIR="${DATA_DIR:-/data}"
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
BACKUP_ENDPOINT="${BACKUP_ENDPOINT:-}"
BACKUP_REGION="${BACKUP_REGION:-auto}"
BACKUP_PREFIX="${BACKUP_PREFIX:-claos}"

# Check required env vars
if [[ -z "$BACKUP_BUCKET" ]]; then
    echo "[RESTORE] ERROR: BACKUP_BUCKET not set"
    exit 1
fi

if [[ -z "$AWS_ACCESS_KEY_ID" ]] || [[ -z "$AWS_SECRET_ACCESS_KEY" ]]; then
    echo "[RESTORE] ERROR: AWS credentials not set"
    exit 1
fi

ENDPOINT_ARG=""
if [[ -n "$BACKUP_ENDPOINT" ]]; then
    ENDPOINT_ARG="--endpoint-url $BACKUP_ENDPOINT"
fi

# List available backups
list_backups() {
    echo "[RESTORE] Available backups:"
    aws s3 ls "s3://$BACKUP_BUCKET/${BACKUP_PREFIX}_" \
        $ENDPOINT_ARG \
        --region "$BACKUP_REGION" 2>/dev/null | sort -r | head -20 | while read -r line; do
        FILE=$(echo "$line" | awk '{print $4}')
        SIZE=$(echo "$line" | awk '{print $3}')
        DATE=$(echo "$line" | awk '{print $1, $2}')
        echo "  $FILE ($SIZE bytes, $DATE)"
    done
}

# Get latest backup
get_latest() {
    aws s3 ls "s3://$BACKUP_BUCKET/${BACKUP_PREFIX}_" \
        $ENDPOINT_ARG \
        --region "$BACKUP_REGION" 2>/dev/null | sort -r | head -1 | awk '{print $4}'
}

# Restore from backup
restore_backup() {
    local BACKUP_NAME="$1"
    local TEMP_FILE="/tmp/${BACKUP_NAME}"
    
    echo "[RESTORE] Downloading: $BACKUP_NAME"
    aws s3 cp "s3://$BACKUP_BUCKET/$BACKUP_NAME" "$TEMP_FILE" \
        $ENDPOINT_ARG \
        --region "$BACKUP_REGION" \
        --only-show-errors || {
        echo "[RESTORE] ERROR: Download failed"
        exit 1
    }
    
    # Backup current data
    if [[ -d "$DATA_DIR" ]]; then
        BACKUP_CURRENT="${DATA_DIR}.pre-restore.$(date +%Y%m%d_%H%M%S)"
        echo "[RESTORE] Backing up current data to: $BACKUP_CURRENT"
        mv "$DATA_DIR" "$BACKUP_CURRENT"
    fi
    
    # Extract
    echo "[RESTORE] Extracting to: $DATA_DIR"
    mkdir -p "$(dirname "$DATA_DIR")"
    tar -xzf "$TEMP_FILE" -C "$(dirname "$DATA_DIR")" || {
        echo "[RESTORE] ERROR: Extraction failed"
        # Restore previous data
        if [[ -d "$BACKUP_CURRENT" ]]; then
            mv "$BACKUP_CURRENT" "$DATA_DIR"
        fi
        rm -f "$TEMP_FILE"
        exit 1
    }
    
    # Cleanup
    rm -f "$TEMP_FILE"
    
    echo "[RESTORE] Restore completed successfully!"
    echo "[RESTORE] Previous data saved to: $BACKUP_CURRENT"
}

# Main
case "${1:-}" in
    list)
        list_backups
        ;;
    latest)
        LATEST=$(get_latest)
        if [[ -z "$LATEST" ]]; then
            echo "[RESTORE] No backups found"
            exit 1
        fi
        echo "[RESTORE] Latest backup: $LATEST"
        read -p "Restore this backup? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            restore_backup "$LATEST"
        fi
        ;;
    restore)
        if [[ -z "${2:-}" ]]; then
            echo "Usage: $0 restore <backup_name>"
            exit 1
        fi
        restore_backup "$2"
        ;;
    *)
        echo "Usage: $0 {list|latest|restore <backup_name>}"
        echo ""
        echo "Commands:"
        echo "  list              List available backups"
        echo "  latest            Restore from latest backup"
        echo "  restore <name>    Restore specific backup"
        exit 1
        ;;
esac
