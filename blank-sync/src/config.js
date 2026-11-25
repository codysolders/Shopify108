// Reads settings from environment variables (and a local .env file if present).
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();

export const config = {
  shop: (process.env.SHOPIFY_SHOP || '').replace(/\.myshopify\.com$/, ''),
  clientId: process.env.SHOPIFY_CLIENT_ID || '',
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
  dryRun: String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
  defaultLocationId: process.env.DEFAULT_LOCATION_ID || '',
  port: Number(process.env.PORT || 8080),
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
  if (missing.length) throw new Error(`Missing settings: ${missing.join(', ')}`);
}
