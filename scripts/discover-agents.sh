#!/bin/bash
# Discover active Clawdbot agents and write to registry file

REGISTRY_FILE="/home/clawd/prod/claos/data/agents-registry.json"
mkdir -p "$(dirname "$REGISTRY_FILE")"

agents="[]"

for port in $(seq 18750 18799); do
  response=$(curl -s --connect-timeout 1 --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null)
  if [ $? -eq 0 ] && [ -n "$response" ]; then
    # Extract name from HTML: window.__CLAWDBOT_ASSISTANT_NAME__="Name"
    name=$(echo "$response" | grep -oP '__CLAWDBOT_ASSISTANT_NAME__="\K[^"]+' 2>/dev/null)
    if [ -n "$name" ]; then
      id=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
      # Extract avatar if available
      avatar=$(echo "$response" | grep -oP '__CLAWDBOT_ASSISTANT_AVATAR__="\K[^"]+' 2>/dev/null || echo "🤖")
      agents=$(echo "$agents" | jq --arg id "$id" --arg name "$name" --arg port "$port" --arg avatar "$avatar" \
        '. + [{"id": $id, "name": $name, "port": ($port|tonumber), "online": true, "avatar": $avatar}]')
    fi
  fi
done

# Write to file with timestamp
echo "{\"agents\": $agents, \"updatedAt\": \"$(date -Iseconds)\", \"count\": $(echo "$agents" | jq length)}" > "$REGISTRY_FILE"

echo "Discovered $(echo "$agents" | jq length) agents"
