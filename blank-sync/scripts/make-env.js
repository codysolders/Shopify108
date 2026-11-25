// Asks for your Shopify app keys and writes .env and env.yaml (both ignored by git).
// Usage: node scripts/make-env.js
import fs from 'node:fs';
import readline from 'node:readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(q) {
  process.stdout.write(q);
  const { value } = await lines.next();
  return value ?? '';
}
// Remove spaces and invisible characters that sneak in when pasting.
const clean = (s) => s.replace(/[^\x21-\x7e]/g, '');

const shop = clean(await ask('Store (the part before .myshopify.com) [90zkxu-ef]: ')) || '90zkxu-ef';
const id = clean(await ask('Client ID: '));
const secret = clean(await ask('Client secret: '));
rl.close();

if (!id || !secret) {
  console.error('Client ID and secret are both needed. Run this again.');
  process.exit(1);
}
const vars = { SHOPIFY_SHOP: shop.replace(/\.myshopify\.com$/, ''), SHOPIFY_CLIENT_ID: id, SHOPIFY_CLIENT_SECRET: secret, DRY_RUN: 'true' };
fs.writeFileSync('.env', Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
fs.writeFileSync('env.yaml', Object.entries(vars).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
console.log(`\nSaved. Client ID is ${id.length} characters, secret is ${secret.length} characters.`);
