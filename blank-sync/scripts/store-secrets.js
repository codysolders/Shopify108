// Owner, one time: copies the Shopify settings from .env into Google Cloud Secret Manager,
// so anyone with access to the project can run the app's commands without seeing the keys.
// Usage (in Cloud Shell, in this folder): node scripts/store-secrets.js
import { execFileSync } from 'node:child_process';
import { config, SECRET_NAMES } from '../src/config.js';

const values = {
  SHOPIFY_SHOP: config.shop,
  SHOPIFY_CLIENT_ID: config.clientId,
  SHOPIFY_CLIENT_SECRET: config.clientSecret,
};
const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Run "node scripts/make-env.js" first.`);
  process.exit(1);
}

const gcloud = (args, input) =>
  execFileSync('gcloud', args, { input, encoding: 'utf8', stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });

gcloud(['services', 'enable', 'secretmanager.googleapis.com']);
for (const [envName, secret] of Object.entries(SECRET_NAMES)) {
  let exists = true;
  try {
    gcloud(['secrets', 'describe', secret]);
  } catch {
    exists = false;
  }
  if (!exists) gcloud(['secrets', 'create', secret, '--replication-policy=automatic']);
  gcloud(['secrets', 'versions', 'add', secret, '--data-file=-'], values[envName]);
  console.log(`${exists ? 'Updated' : 'Saved'} ${secret}`);
}
console.log('\nDone. To let an employee use the console, run:');
console.log('  node scripts/add-employee.js EMPLOYEE_EMAIL');
