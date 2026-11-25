// HTTP server: receives Shopify webhooks.
import http from 'node:http';
import crypto from 'node:crypto';
import { config, requireShopConfig } from './config.js';
import { verifyWebhook } from './shopify.js';
import { topicHandlers } from './handlers.js';
import { getBlankMap } from './blankMap.js';
import { fetchBlanksForRestock, computeReorder, renderReorderPage, reorderKey } from './restock.js';
import { emailConfigured, reorderEmailText, sendReorderEmail } from './email.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(`blank-sync ok${config.dryRun ? ' (dry run)' : ''}`);
      }
      const url = new URL(req.url, 'http://x');
      const keyOk = () => {
        const key = url.searchParams.get('key') || '';
        const expected = reorderKey();
        return key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
      };
      // Called every morning by Cloud Scheduler. ?test=1 sends even when nothing is low.
      if (req.method === 'POST' && url.pathname === '/tasks/reorder-email') {
        if (!keyOk()) {
          res.writeHead(403);
          return res.end('forbidden');
        }
        if (!emailConfigured()) {
          res.writeHead(200);
          return res.end('email not set up');
        }
        const result = computeReorder(await fetchBlanksForRestock());
        const test = url.searchParams.get('test') === '1';
        if (!result.lowCount && !test) {
          res.writeHead(200);
          return res.end('nothing low, no email sent');
        }
        const pageUrl = `${config.appUrl}/reorder?key=${reorderKey()}`;
        await sendReorderEmail({
          subject: result.lowCount
            ? `Reorder blanks: ${result.lowCount} color/size${result.lowCount === 1 ? '' : 's'} low`
            : 'Blank Sync test email: nothing to reorder',
          text: reorderEmailText(result, pageUrl),
          html: renderReorderPage(result),
        });
        log(`reorder email sent (${result.lowCount} low)`);
        res.writeHead(200);
        return res.end('sent');
      }
      if (req.method === 'GET' && url.pathname === '/reorder') {
        if (!keyOk()) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('This link is missing its key. Ask the owner for the reorder page link.');
        }
        const html = renderReorderPage(computeReorder(await fetchBlanksForRestock()));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
        return res.end(html);
      }
      if (req.method === 'POST' && req.url.startsWith('/webhooks')) {
        const raw = await readBody(req);
        if (!verifyWebhook(raw, req.headers['x-shopify-hmac-sha256'])) {
          res.writeHead(401);
          return res.end('bad signature');
        }
        const topic = String(req.headers['x-shopify-topic'] || '');
        const handler = topicHandlers[topic];
        if (!handler) {
          res.writeHead(200);
          return res.end('ignored');
        }
        const payload = JSON.parse(raw.toString('utf8'));
        await handler(payload);
        res.writeHead(200);
        return res.end('ok');
      }
      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      // A 500 makes Shopify retry; changes use idempotency keys, so a retry won't double count.
      log('error', err.stack || err);
      res.writeHead(500);
      res.end('error');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  requireShopConfig();
  createServer().listen(config.port, () => {
    log(`blank-sync listening on ${config.port}${config.dryRun ? ' (DRY RUN: no inventory changes)' : ''}`);
    getBlankMap().then(
      (m) => log(`loaded ${m.designs.length} design product(s), ${m.designVariantToBlank.size} linked variant(s)`),
      (e) => log('could not load products yet:', e.message),
    );
  });
}
