import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DRY_RUN = 'false';
process.env.SHOPIFY_SHOP = 'test';
process.env.SHOPIFY_ACCESS_TOKEN = 'x';
const a = await import('../src/artUpload.js');
const { artUploadScript } = await import('../src/artScript.js');
const { renderCustomOrdersPage } = await import('../src/customOrdersPage.js');
const { handleOrderCreated } = await import('../src/handlers.js');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

test('accepts real art files and refuses others', () => {
  assert.equal(a.checkArt('Logo.PNG', png).ext, 'png');
  assert.equal(a.checkArt('x.pdf', Buffer.from('%PDF-1.7 ...')).image, undefined);
  assert.equal(a.checkArt('x.svg', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">')).ext, 'svg');
  assert.equal(a.checkArt('x.ai', Buffer.from('%PDF-1.5')).ext, 'ai');
  assert.equal(a.checkArt('x.eps', Buffer.from('%!PS-Adobe-3.0 EPSF')).ext, 'eps');
  assert.throws(() => a.checkArt('x.exe', png), /PNG, JPG/);
  assert.throws(() => a.checkArt('x.png', Buffer.from('<html>')), /real \.png/);
  assert.throws(() => a.checkArt('x.png', Buffer.alloc(0)), /empty/);
  assert.throws(() => a.checkArt('x.png', Buffer.concat([png, Buffer.alloc(a.MAX_ART_BYTES)])), /too big/);
});

test('saves to Shopify Files and returns the file link', async () => {
  const calls = [];
  const gql = async (q, v) => {
    calls.push(q.match(/(stagedUploadsCreate|fileCreate|node\()/)[1]);
    if (q.includes('stagedUploadsCreate')) {
      assert.equal(v.input[0].resource, 'IMAGE');
      assert.match(v.input[0].filename, /^customer-art-\d{4}-\d\d-\d\d-[0-9a-f]{6}-my-logo\.png$/);
      return { stagedUploadsCreate: { stagedTargets: [{ url: 'https://up', resourceUrl: 'https://res', parameters: [{ name: 'k', value: 'v' }] }], userErrors: [] } };
    }
    if (q.includes('fileCreate')) return { fileCreate: { files: [{ id: 'gid://shopify/MediaImage/9' }], userErrors: [] } };
    return { node: calls.filter((c) => c === 'node(').length < 2 ? { fileStatus: 'UPLOADED' } : { fileStatus: 'READY', image: { url: 'https://cdn.shopify.com/s/files/1/x/files/a.png' } } };
  };
  const fetchImpl = async (url) => ({ ok: url === 'https://up' });
  const out = await a.saveCustomerArt({ buf: png, filename: 'My Logo.png' }, { gql, fetchImpl, delayMs: 0 });
  assert.equal(out.url, 'https://cdn.shopify.com/s/files/1/x/files/a.png');
  assert.deepEqual(calls, ['stagedUploadsCreate', 'fileCreate', 'node(', 'node(']);
});

test('PDFs are saved as plain files', async () => {
  const gql = async (q, v) => {
    if (q.includes('stagedUploadsCreate')) {
      assert.equal(v.input[0].resource, 'FILE');
      return { stagedUploadsCreate: { stagedTargets: [{ url: 'https://up', resourceUrl: 'https://res', parameters: [] }], userErrors: [] } };
    }
    if (q.includes('fileCreate')) {
      assert.equal(v.files[0].contentType, 'FILE');
      return { fileCreate: { files: [{ id: 'g' }], userErrors: [] } };
    }
    return { node: { fileStatus: 'READY', url: 'https://cdn.shopify.com/s/files/1/x/files/a.pdf' } };
  };
  const out = await a.saveCustomerArt({ buf: Buffer.from('%PDF-1.7'), filename: 'a.pdf' }, { gql, fetchImpl: async () => ({ ok: true }), delayMs: 0 });
  assert.equal(out.image, undefined);
  assert.match(out.url, /a\.pdf$/);
});

test('finds art on order lines, including files the old button lost', () => {
  const art = a.artOnLine([
    { key: 'Artwork', value: 'https://cdn.shopify.com/s/files/1/x/files/a.png' },
    { key: 'Artwork file', value: 'logo.png' },
    { key: 'Add Custom Text', value: 'hello' },
  ]);
  assert.deepEqual(art, [{ url: 'https://cdn.shopify.com/s/files/1/x/files/a.png', name: 'logo.png' }]);
  assert.deepEqual(a.lostArt([{ key: 'Your picture 1', value: 'C:\\fakepath\\BDACE.png' }]), ['BDACE.png']);
  assert.ok(a.orderHasArt({ line_items: [{ properties: [{ name: 'Artwork', value: 'https://cdn.shopify.com/x.png' }] }] }));
  assert.ok(!a.orderHasArt({ line_items: [{ properties: [] }] }));
});

test('rate limit: 30 an hour per address', () => {
  for (let i = 0; i < 30; i++) assert.ok(!a.rateLimited('1.2.3.4', { now: 1000 + i }));
  assert.ok(a.rateLimited('1.2.3.4', { now: 2000 }));
  assert.ok(!a.rateLimited('5.6.7.8', { now: 2000 }));
  assert.ok(!a.rateLimited('1.2.3.4', { now: 1000 + 3600 * 1000 + 50 }));
});

test('script and page render', () => {
  const js = artUploadScript('https://app.example');
  assert.match(js, /https:\/\/app\.example/);
  assert.match(js, /properties\[/);
  new Function(js); // valid JavaScript
  const html = renderCustomOrdersPage({
    days: 120,
    orders: [{ id: 'gid://shopify/Order/5', name: '#1300', createdAt: '2026-11-26T00:00:00Z', customer: { displayName: 'A <b>' },
      lines: [{ title: 'Custom Tee', variantTitle: 'Black / L', quantity: 2, art: [{ url: 'https://cdn.shopify.com/a.pdf', name: 'a.pdf' }], lost: [] }] }],
  });
  assert.match(html, /#1300/);
  assert.match(html, /PDF/);
  assert.ok(!html.includes('<b>'.repeat(1) + '</span>'));
  assert.match(html, /A &lt;b&gt;/);
});

test('orders with art get the custom-art tag', async () => {
  const tagged = [];
  const gql = async (q, v) => {
    if (q.includes('tagsAdd')) { tagged.push(v.tags[0]); return { tagsAdd: { userErrors: [] } }; }
    if (q.includes('products')) return { products: { nodes: [], pageInfo: { hasNextPage: false } } };
    if (q.includes('locations')) return { locations: { nodes: [{ id: 'gid://shopify/Location/1' }] } };
    return {};
  };
  await handleOrderCreated({ id: 1, name: '#1', tags: '', line_items: [{ variant_id: 2, quantity: 1, properties: [{ name: 'Artwork', value: 'https://cdn.shopify.com/x.png' }] }] }, { gql }).catch(() => {});
  assert.deepEqual(tagged.slice(0, 1), ['custom-art']);
});
