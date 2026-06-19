const fs = require('fs');
const path = require('path');

// Helper to load .env manually
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const parts = trimmed.split('=', 2);
        if (parts.length === 2) {
          process.env[parts[0].trim()] = parts[1].trim();
        }
      }
    });
  }
}

loadEnv();

const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "YOUR_GOOGLE_MAPS_API_KEY";

const targetDir = path.resolve(__dirname, '../android/app/src/main/res/values');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const secretsXmlContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="google_maps_api_key">${apiKey}</string>
</resources>
`;

fs.writeFileSync(path.join(targetDir, 'secrets.xml'), secretsXmlContent, 'utf8');
console.log('[SECRETS] Generated android/app/src/main/res/values/secrets.xml successfully.');
