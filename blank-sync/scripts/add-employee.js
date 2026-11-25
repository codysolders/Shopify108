// Owner: lets an employee's Google account read the Blank Sync secrets, so their console just works.
// Usage: node scripts/add-employee.js person@example.com
// Remove access later with: node scripts/add-employee.js person@example.com --remove
import { execFileSync } from 'node:child_process';
import { SECRET_NAMES } from '../src/config.js';

const email = process.argv[2];
const remove = process.argv.includes('--remove');
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/add-employee.js person@example.com [--remove]');
  process.exit(1);
}
for (const secret of Object.values(SECRET_NAMES)) {
  execFileSync('gcloud', [
    'secrets', remove ? 'remove-iam-policy-binding' : 'add-iam-policy-binding', secret,
    `--member=user:${email}`, '--role=roles/secretmanager.secretAccessor',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}
console.log(`${remove ? 'Removed' : 'Gave'} ${email} ${remove ? 'from' : 'access to'} the Blank Sync secrets.`);
