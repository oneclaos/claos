#!/bin/bash
# Setup SSL with Let's Encrypt
# Usage: ./scripts/setup-ssl.sh yourdomain.com your@email.com

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" ]] || [[ -z "$EMAIL" ]]; then
    echo "Usage: $0 <domain> <email>"
    echo "Example: $0 dashboard.example.com admin@example.com"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "[SSL] Setting up SSL for: $DOMAIN"
echo "[SSL] Email: $EMAIL"

# Update nginx config with actual domain
echo "[SSL] Updating nginx configuration..."
sed -i "s/DOMAIN/$DOMAIN/g" nginx/nginx.conf

# Create initial dummy certificate (nginx won't start without it)
echo "[SSL] Creating temporary self-signed certificate..."
mkdir -p ./certbot/conf/live/$DOMAIN
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout ./certbot/conf/live/$DOMAIN/privkey.pem \
    -out ./certbot/conf/live/$DOMAIN/fullchain.pem \
    -subj "/CN=$DOMAIN" 2>/dev/null

# Start nginx with dummy cert
echo "[SSL] Starting nginx..."
docker-compose -f docker-compose.prod.yml up -d nginx

# Wait for nginx
sleep 5

# Get real certificate
echo "[SSL] Requesting Let's Encrypt certificate..."
docker-compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# Restart nginx with real cert
echo "[SSL] Reloading nginx with new certificate..."
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo ""
echo "[SSL] ✅ SSL setup complete!"
echo ""
echo "Your dashboard is now available at: https://$DOMAIN"
echo ""
echo "Certificate auto-renewal is configured via certbot container."
echo ""
echo "To start all services:"
echo "  docker-compose -f docker-compose.prod.yml up -d"
