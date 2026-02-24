const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

const lines = envContent.split('\n');
for (const line of lines) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
  if (match) {
    let [, key, value] = match;
    if ((value.startsWith("'") && value.endsWith("'")) || 
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

process.env.NODE_ENV = 'production';
process.env.PORT = process.env.PORT || '3006';

// Debug: verify GATEWAYS
console.log('[launch.js] GATEWAYS set:', !!process.env.GATEWAYS);
if (process.env.GATEWAYS) {
  try {
    const gw = JSON.parse(process.env.GATEWAYS);
    console.log('[launch.js] Parsed', gw.length, 'gateways:', gw.map(g => g.id).join(', '));
  } catch (e) {
    console.log('[launch.js] GATEWAYS parse error:', e.message);
  }
}

require('./.next/standalone/server.js');
