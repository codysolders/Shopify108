// Owner, one time: turns on the morning reorder email and schedules it for 7 AM Pacific.
// Usage (in Cloud Shell, in this folder): node scripts/setup-email.js
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { config, requireShopConfig } from '../src/config.js';
import { reorderKey } from '../src/restock.js';

requireShopConfig();
const SERVICE = 'blank-sync';
const REGION = 'us-west1';
const JOB = 'blank-sync-reorder-email';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(q) {
  process.stdout.write(q);
  const { value } = await lines.next();
  return value ?? '';
}
const clean = (s) => s.replace(/[^\x21-\x7e]/g, '');

const gmailUser = clean(await ask('Gmail address the email is sent from: '));
const appPassword = clean(await ask('Gmail app password (16 letters, spaces are fine): '));
const to = (await ask(`Send the email to (comma-separated) [${gmailUser}]: `)).split(',').map(clean).filter(Boolean).join(',') || gmailUser;
rl.close();

if (!gmailUser.includes('@') || appPassword.length !== 16) {
  console.error('\nThat Gmail address or app password doesn\'t look right (the app password is 16 letters). Run this again.');
  process.exit(1);
}

const gcloud = (args) => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

console.log('\nSaving email settings on the app (about a minute)...');
gcloud(['run', 'services', 'update', SERVICE, `--region=${REGION}`,
  `--update-env-vars=^##^GMAIL_USER=${gmailUser}##GMAIL_APP_PASSWORD=${appPassword}##ALERT_EMAIL_TO=${to}`]);

const appUrl = gcloud(['run', 'services', 'describe', SERVICE, `--region=${REGION}`, '--format=value(status.url)']).trim() || config.appUrl;
const taskUrl = `${appUrl}/tasks/reorder-email?key=${reorderKey()}`;

console.log('Scheduling the 7 AM email...');
gcloud(['services', 'enable', 'cloudscheduler.googleapis.com']);
const jobArgs = [`--location=${REGION}`, '--schedule=0 7 * * *', '--time-zone=America/Los_Angeles', `--uri=${taskUrl}`, '--http-method=POST'];
try {
  gcloud(['scheduler', 'jobs', 'describe', JOB, `--location=${REGION}`]);
  gcloud(['scheduler', 'jobs', 'update', 'http', JOB, ...jobArgs]);
} catch {
  gcloud(['scheduler', 'jobs', 'create', 'http', JOB, ...jobArgs]);
}

console.log('Sending a test email...');
const res = await fetch(`${taskUrl}&test=1`, { method: 'POST' });
console.log(`Test email: ${res.ok ? await res.text() : `failed (${res.status})`}`);
console.log(`\nDone. Every morning at 7 AM Pacific, ${to} gets an email when anything is low.`);
console.log(`Reorder page (bookmark it, keep it private):\n${appUrl}/reorder?key=${reorderKey()}`);
