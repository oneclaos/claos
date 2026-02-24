#!/bin/bash
cd /home/clawd/prod/claos

# Load env vars line by line (handles complex values like JSON)
while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # Remove quotes from value
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  export "$key=$value"
done < .env.local

export NODE_ENV=production
export PORT=3006

exec node .next/standalone/server.js
