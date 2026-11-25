// Reads settings from environment variables (and a local .env file if present).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Names of the Google Cloud Secret Manager secrets that hold the app's settings.
export const SECRET_NAMES = {
  SHOPIFY_SHOP: 'blank-sync-shop',
  SHOPIFY_CLIENT_ID: 'blank-sync-client-id',
  SHOPIFY_CLIENT_SECRET: 'blank-sync-client-secret',
};

// In Cloud Shell, fill in anything missing from Google Cloud Secret Manager,
// so employees never need to handle the keys themselves.
function loadFromSecretManager() {
  if (process.env.K_SERVICE) return; // running on Cloud Run: settings come from the service
  for (const [envName, secret] of Object.entries(SECRET_NAMES)) {
    if (process.env[envName]) continue;
    try {
      const value = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${secret}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 20_000,
      }).trim();
      if (value) process.env[envName] = value;
    } catch {
      // gcloud missing, no access, or secret not created yet: fall through to the usual error.
    }
  }
}

loadDotEnv();
loadFromSecretManager();

export const config = {
  shop: (process.env.SHOPIFY_SHOP || '').replace(/\.myshopify\.com$/, ''),
  clientId: process.env.SHOPIFY_CLIENT_ID || '',
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
  dryRun: String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
  defaultLocationId: process.env.DEFAULT_LOCATION_ID || '',
  port: Number(process.env.PORT || 8080),
  appUrl: (process.env.APP_URL || 'https://blank-sync-478869332742.us-west1.run.app').replace(/\/$/, ''),
  // Morning reorder email
  gmailUser: process.env.GMAIL_USER || '',
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  alertEmailTo: process.env.ALERT_EMAIL_TO || '',
  // Metafields the store owner fills in.
  blankProductMetafield: { namespace: 'custom', key: 'blank_product' },
  blankVariantMetafield: { namespace: 'custom', key: 'blank_variant' },
  // Tag added to an order once its blanks have been taken off.
  processedTag: 'blanks-deducted',
  // How long the design-to-blank map is cached before re-reading products.
  mapTtlMs: 5 * 60 * 1000,
};

export function requireShopConfig() {
  const missing = [];
  if (!config.shop) missing.push('SHOPIFY_SHOP');
  if (!config.accessToken && !(config.clientId && config.clientSecret)) {
    missing.push('SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ACCESS_TOKEN)');
  }
  if (missing.length) {
    throw new Error(
      `Missing settings: ${missing.join(', ')}. ` +
        'In Cloud Shell, check that the right project is selected and that your Google account can read the ' +
        'blank-sync secrets (Secret Manager Secret Accessor). Or run "node scripts/make-env.js".',
    );
  }
}
