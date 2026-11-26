// HTTP server: receives Shopify webhooks.
import http from 'node:http';
import crypto from 'node:crypto';
import { config, requireShopConfig } from './config.js';
import { verifyWebhook } from './shopify.js';
import { topicHandlers } from './handlers.js';
import { getBlankMap } from './blankMap.js';
import { fetchBlanksForRestock, computeReorder, renderReorderPage, reorderKey, addExactLinks } from './restock.js';
import { addBlankKey, createBlank, colorsFromLink, blankLists, renderAddBlankPage, addColorsToBlank, newSupplierColors } from './addBlank.js';
import { createTemplate } from './templates.js';
import { mockupsKey, loadProduct, listTagged, designTags, saveArt, savePlace, savePhoto, makeMockups, hidePlainPhotos } from './mockups.js';
import { renderMockupHome, renderMockupGroup, renderMockupProduct } from './mockupPage.js';
import { customOrdersKey, saveCustomerArt, allowedOrigins, rateLimited, ordersWithArt } from './artUpload.js';
import { artUploadScript } from './artScript.js';
import { renderCustomOrdersPage } from './customOrdersPage.js';
import { emailConfigured, reorderEmailText, sendReorderEmail } from './email.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Parses a multipart form (file uploads) with Node's built-in web Request.
async function readMultipart(req, maxBytes = 25 * 1024 * 1024) {
  const buf = await readBody(req);
  if (buf.length > maxBytes) throw Object.assign(new Error('That file is too big (25 MB max).'), { userFacing: true });
  return new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' }, body: buf }).formData();
}

const sameSite = (back) => {
  if (typeof back !== 'string' || !back.startsWith('/mockups')) return '/mockups';
  const u = new URL(back, 'http://x');
  u.searchParams.delete('msg');
  u.searchParams.delete('bad');
  return u.pathname + u.search;
};
const withMsg = (back, msg, bad) => `${back}${back.includes('?') ? '&' : '?'}${bad ? 'bad=1&' : ''}msg=${encodeURIComponent(msg)}`;

async function handleMockups(req, res, url) {
  const key = url.searchParams.get('key');
  const html = (body) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return res.end(body);
  };
  const redirect = (to) => {
    res.writeHead(303, { Location: to });
    return res.end();
  };
  const msg = url.searchParams.get('msg') || '';
  const bad = url.searchParams.get('bad') === '1';
  if (req.method === 'GET' && url.pathname === '/mockups') {
    const tag = url.searchParams.get('tag');
    if (!tag) return html(renderMockupHome({ key, tags: designTags(await listTagged('')), msg }));
    return html(renderMockupGroup({ key, tag, products: (await listTagged(tag)).filter((p) => p.colors.length), msg, bad }));
  }
  if (req.method === 'GET' && url.pathname === '/mockups/product') {
    const product = await loadProduct(url.searchParams.get('id') || '');
    if (!product) return redirect(withMsg(`/mockups?key=${encodeURIComponent(key)}`, 'That product no longer exists.', true));
    return html(renderMockupProduct({ key, product, tag: url.searchParams.get('tag') || '', msg, bad }));
  }
  if (req.method === 'POST' && url.pathname === '/mockups/make') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    let out;
    try {
      out = await makeMockups(String(body.id || ''), { design: body.design || null, force: Boolean(body.force) });
    } catch (e) {
      log('mockups: make failed:', e.message);
      out = { error: e.message };
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(out));
  }
  if (req.method === 'POST' && url.pathname === '/mockups/art') {
    let back = '/mockups';
    try {
      const form = await readMultipart(req);
      back = sameSite(form.get('back'));
      const file = form.get('art');
      const design = String(form.get('design') || '');
      if (!file || typeof file === 'string' || !file.size) return redirect(withMsg(back, 'Choose an art file first.', true));
      const tag = String(form.get('tag') || '');
      const ids = tag
        ? (await listTagged(tag)).filter((p) => p.designs.includes(design)).map((p) => p.id)
        : [String(form.get('id') || '')];
      const r = await saveArt({ productIds: ids, design, buf: Buffer.from(await file.arrayBuffer()), filename: file.name || 'art.png', mimeType: file.type });
      return redirect(withMsg(back, r.dryRun ? `Dry run: would save ${design} art on ${r.products} product(s).` : `Saved ${design} art on ${r.products} product${r.products === 1 ? '' : 's'}. Check the preview, then make the mockups.`));
    } catch (e) {
      log('mockups: art upload failed:', e.message);
      return redirect(withMsg(back, e.message, true));
    }
  }
  if (req.method === 'POST' && ['/mockups/place', '/mockups/photo', '/mockups/hide'].includes(url.pathname)) {
    const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()));
    const back = sameSite(form.back);
    try {
      if (url.pathname === '/mockups/place') {
        await savePlace(form.id, { x: form.x, y: form.y, w: form.w, h: form.h });
        return redirect(withMsg(back, 'Placement saved. Mockups made before now show "needs remake".'));
      }
      if (url.pathname === '/mockups/photo') {
        await savePhoto(form.id, form.color, form.url || '');
        return redirect(withMsg(back, `Photo for ${form.color} saved.`));
      }
      const r = await hidePlainPhotos(form.id);
      return redirect(withMsg(back, r.dryRun ? `Dry run: would hide ${r.wouldHide} photo(s).` : `Took ${r.hidden} plain photo${r.hidden === 1 ? '' : 's'} off the product page.`));
    } catch (e) {
      log('mockups:', e.message);
      return redirect(withMsg(back, e.message, true));
    }
  }
  res.writeHead(404);
  return res.end('not found');
}

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
      const keyOk = (expected = reorderKey()) => {
        const key = url.searchParams.get('key') || '';
        return key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
      };
      // Customer art upload, called from the store's product pages.
      if (url.pathname === '/art-upload.js' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
        return res.end(artUploadScript(config.appUrl));
      }
      if (url.pathname === '/art/upload') {
        const origin = String(req.headers.origin || '');
        const allowed = await allowedOrigins();
        const cors = allowed.has(origin)
          ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
          : {};
        const json = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors });
          return res.end(JSON.stringify(body));
        };
        if (req.method === 'OPTIONS') {
          res.writeHead(204, cors);
          return res.end();
        }
        if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
        if (!allowed.has(origin)) {
          log(`art upload refused from origin "${origin}"`);
          return json(403, { error: 'Uploads only work from our store.' });
        }
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (rateLimited(ip)) return json(429, { error: 'Too many uploads. Please wait a bit, or email your art to us.' });
        try {
          const form = await readMultipart(req, 26 * 1024 * 1024);
          const file = form.get('file');
          if (!file || typeof file === 'string') return json(400, { error: 'No file was sent.' });
          const out = await saveCustomerArt({ buf: Buffer.from(await file.arrayBuffer()), filename: file.name || 'art' });
          log(`art upload saved: ${out.url}`);
          return json(200, { url: out.url, image: out.image });
        } catch (e) {
          log('art upload failed:', e.message);
          return json(e.userFacing ? 400 : 500, { error: e.userFacing ? e.message : 'Upload failed on our side.' });
        }
      }
      if (url.pathname === '/custom-orders' && req.method === 'GET') {
        if (!keyOk(customOrdersKey())) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('This link is missing its key. Ask the owner for the Custom orders link.');
        }
        const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 120));
        let html;
        try {
          html = renderCustomOrdersPage({ orders: await ordersWithArt({ days }), days });
        } catch (e) {
          log('custom orders page failed:', e.message);
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(`Could not load orders from Shopify: ${e.message.slice(0, 300)}`);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
        return res.end(html);
      }
      // Mockups: its own key.
      if (url.pathname === '/mockups' || url.pathname.startsWith('/mockups/')) {
        if (!keyOk(mockupsKey())) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('This link is missing its key. Ask the owner for the Mockups link.');
        }
        return await handleMockups(req, res, url);
      }
      // Add a blank: its own key, so the reorder link alone can't create products.
      if (url.pathname.startsWith('/add-blank')) {
        if (!keyOk(addBlankKey())) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('This link is missing its key. Ask the owner for the Add a blank link.');
        }
        const key = url.searchParams.get('key');
        const page = async (args) => {
          const html = renderAddBlankPage({ key, ...(await blankLists()), ...args });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
          return res.end(html);
        };
        if (req.method === 'GET' && url.pathname === '/add-blank/colors') {
          const link = url.searchParams.get('url') || '';
          const colors = /^https:\/\//i.test(link) ? await colorsFromLink(link).catch(() => []) : [];
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ colors }));
        }
        if (req.method === 'GET' && url.pathname === '/add-blank/supplier-colors') {
          const out = await newSupplierColors(url.searchParams.get('id') || '').catch(() => ({ colors: [], note: 'Could not read the supplier page.' }));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify(out));
        }
        if (req.method === 'POST' && url.pathname === '/add-blank/colors') {
          const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()));
          const result = await addColorsToBlank(form.id, form.colors);
          if (result.colorsAdded) log(`add-blank: added ${result.colorsAdded.added.join(', ')} to ${result.colorsAdded.blank.title}`);
          return page({ result });
        }
        if (req.method === 'GET' && url.pathname === '/add-blank') return page({});
        if (req.method === 'POST' && url.pathname === '/add-blank') {
          const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()));
          form.template = form.template === '1';
          const result = await createBlank(form);
          if (result.blank) log(`add-blank: created ${result.blank.title}`);
          return page({ form: result.errors || result.dryRun ? form : {}, result });
        }
        if (req.method === 'POST' && url.pathname === '/add-blank/template') {
          const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()));
          const t = await createTemplate(form.id);
          return page({ result: t.dryRun ? { dryRun: true, title: t.product.title, variants: t.variants } : { templateOnly: t } });
        }
      }
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
        const result = await addExactLinks(computeReorder(await fetchBlanksForRestock()));
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
        const html = renderReorderPage(await addExactLinks(computeReorder(await fetchBlanksForRestock())));
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
