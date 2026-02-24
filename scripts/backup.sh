#!/bin/bash
# Claos Backup Script
# Backs up DATA_DIR to S3-compatible storage (R2, S3, B2, etc.)

set -euo pipefail

# Configuration (override via environment)
DATA_DIR="${DATA_DIR:-/data}"
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
BACKUP_ENDPOINT="${BACKUP_ENDPOINT:-}"  # e.g., https://xxx.r2.cloudflarestorage.com
BACKUP_REGION="${BACKUP_REGION:-auto}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-claos}"

# Check required env vars
if [[ -z "$BACKUP_BUCKET" ]]; then
    echo "[BACKUP] ERROR: BACKUP_BUCKET not set"
    exit 1
fi

if [[ -z "$AWS_ACCESS_KEY_ID" ]] || [[ -z "$AWS_SECRET_ACCESS_KEY" ]]; then
    echo "[BACKUP] ERROR: AWS credentials not set"
    exit 1
fi

# Check if aws cli is available
if ! command -v aws &> /dev/null; then
    echo "[BACKUP] ERROR: aws cli not found"
    exit 1
fi

# Create timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${BACKUP_PREFIX}_${TIMESTAMP}.tar.gz"
TEMP_FILE="/tmp/${BACKUP_NAME}"

echo "[BACKUP] Starting backup at $(date)"
echo "[BACKUP] Source: $DATA_DIR"
echo "[BACKUP] Destination: s3://$BACKUP_BUCKET/$BACKUP_NAME"

# Create compressed archive
echo "[BACKUP] Creating archive..."
tar -czf "$TEMP_FILE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" 2>/dev/null || {
    echo "[BACKUP] ERROR: Failed to create archive"
    rm -f "$TEMP_FILE"
    exit 1
}

# Get file size
SIZE=$(du -h "$TEMP_FILE" | cut -f1)
echo "[BACKUP] Archive size: $SIZE"

# Upload to S3/R2
echo "[BACKUP] Uploading to bucket..."
ENDPOINT_ARG=""
if [[ -n "$BACKUP_ENDPOINT" ]]; then
    ENDPOINT_ARG="--endpoint-url $BACKUP_ENDPOINT"
fi

aws s3 cp "$TEMP_FILE" "s3://$BACKUP_BUCKET/$BACKUP_NAME" \
    $ENDPOINT_ARG \
    --region "$BACKUP_REGION" \
    --storage-class STANDARD \
    --only-show-errors || {
    echo "[BACKUP] ERROR: Upload failed"
    rm -f "$TEMP_FILE"
    exit 1
}

# Cleanup temp file
rm -f "$TEMP_FILE"

echo "[BACKUP] Upload complete: $BACKUP_NAME"

# Cleanup old backups (retention policy)
if [[ "$BACKUP_RETENTION_DAYS" -gt 0 ]]; then
    echo "[BACKUP] Cleaning backups older than $BACKUP_RETENTION_DAYS days..."
    
    CUTOFF_DATE=$(date -d "-${BACKUP_RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${BACKUP_RETENTION_DAYS}d +%Y%m%d)
    
    aws s3 ls "s3://$BACKUP_BUCKET/${BACKUP_PREFIX}_" \
        $ENDPOINT_ARG \
        --region "$BACKUP_REGION" 2>/dev/null | while read -r line; do
        
        FILE=$(echo "$line" | awk '{print $4}')
        if [[ -n "$FILE" ]]; then
            # Extract date from filename (YYYYMMDD)
            FILE_DATE=$(echo "$FILE" | grep -oP '\d{8}' | head -1)
            if [[ -n "$FILE_DATE" ]] && [[ "$FILE_DATE" < "$CUTOFF_DATE" ]]; then
                echo "[BACKUP] Deleting old backup: $FILE"
                aws s3 rm "s3://$BACKUP_BUCKET/$FILE" \
                    $ENDPOINT_ARG \
                    --region "$BACKUP_REGION" \
                    --only-show-errors
            fi
        fi
    done
fi

echo "[BACKUP] Backup completed successfully at $(date)"
