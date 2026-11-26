import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.DRY_RUN = 'false';
process.env.SHOPIFY_SHOP = 'test';
process.env.SHOPIFY_ACCESS_TOKEN = 'x';
const d = await import('../src/designer.js');
const { renderCustomOrdersPage } = await import('../src/customOrdersPage.js');

const cdn = (f) => `https://cdn.shopify.com/s/files/1/0767/1260/7976/files/${f}?v=1`;
const v = (color, url, alt = '') => ({ selectedOptions: [{ name: 'Color', value: color }, { name: 'Size', value: 'M' }], media: { nodes: url ? [{ alt, image: { url, width: 500, height: 625 } }] : [] } });

test('photos come from the design first, then the linked blank, never from mockups', () => {
  const photos = d.photosByColor({
    options: [{ name: 'Design', values: ['Your art'] }, { name: 'Color', values: ['Black', 'Sport Gray', 'White'] }],
    variants: { nodes: [v('Black', cdn('own-black.jpg')), v('White', cdn('mock.jpg'), 'Mockup: Design 1 on White')] },
    blank: { reference: { options: [{ name: 'Color', values: [] }], variants: { nodes: [v('Black', cdn('b.jpg')), v('Sport Grey', cdn('g.jpg')), v('White', cdn('w.jpg'))] } } },
  });
  assert.equal(photos.black.url, cdn('own-black.jpg'));
  assert.equal(photos['sport grey'].url, cdn('g.jpg'), 'gray and grey match');
  assert.equal(photos.white.url, cdn('w.jpg'), 'a mockup is not a plain photo');
});

test('designer product: only Designer-tagged products, photos keyed by the product\'s own color names', async () => {
  d.clearDesignerCache();
  const product = (tags) => ({
    id: 'gid://shopify/Product/5', title: 'Custom tee', tags,
    options: [{ name: 'Color', values: ['Sport Gray'] }, { name: 'Size', values: ['M'] }],
    place: null, variants: { nodes: [] },
    blank: { reference: { options: [{ name: 'Color', values: ['Sport Grey'] }], variants: { nodes: [v('Sport Grey', cdn('g.jpg'))] } } },
  });
  const out = await d.designerProduct('5', async () => ({ product: product(['Designer']) }));
  assert.equal(out.photos['Sport Gray'].url, cdn('g.jpg'));
  assert.deepEqual(out.area, d.PRINT_AREA);
  d.clearDesignerCache();
  assert.equal(await d.designerProduct('5', async () => ({ product: product(['Upload']) })), null);
  assert.equal(await d.designerProduct('not-an-id', async () => assert.fail('no query')), null);
});

test('mockup links only draw customer art on Shopify photos', () => {
  const place = { x: 0.5, y: 0.25, w: 0.3, h: 0.2 };
  const good = d.mockupUrl({ art: cdn('customer-art-2026-11-26-abc123-logo.png'), photo: cdn('29881_f_fm_1.jpg'), place }, 'https://app');
  const r = d.mockupRequest(new URL(good).searchParams);
  assert.deepEqual(r.place, place);
  const bad = (over) => {
    const q = new URL(good).searchParams;
    for (const [k, val] of Object.entries(over)) q.set(k, val);
    return d.mockupRequest(q);
  };
  assert.equal(bad({ art: cdn('somebody-else.png') }), null);
  assert.equal(bad({ art: 'https://evil.example/customer-art-x.png' }), null);
  assert.equal(bad({ art: cdn('customer-art-x.pdf') }), null);
  assert.equal(bad({ photo: 'https://evil.example/a.jpg' }), null);
  assert.equal(bad({ x: 'abc' }), null);
});

test('draws the art on the shirt photo where the customer put it', async () => {
  const photo = await sharp({ create: { width: 500, height: 625, channels: 3, background: '#000000' } }).jpeg().toBuffer();
  // Art with see-through padding: the padding is trimmed, so the red fills the box.
  const red = await sharp({ create: { width: 100, height: 50, channels: 4, background: '#ff0000ff' } }).png().toBuffer();
  const art = await sharp({ create: { width: 140, height: 90, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: red, left: 20, top: 20 }]).png().toBuffer();
  const files = { 'p.jpg': photo, 'customer-art-a.png': art };
  const fetchImpl = async (u) => ({ ok: true, arrayBuffer: async () => files[new URL(u).pathname.split('/').pop()] });
  const jpg = await d.drawMockup({ art: cdn('customer-art-a.png'), photo: cdn('p.jpg'), place: { x: 0.5, y: 0.2, w: 0.4, h: 0.16 } }, fetchImpl);
  const img = sharp(jpg);
  const { width, height } = await img.metadata();
  assert.equal(width, 1200); // small photos are enlarged
  const px = async (fx, fy) => {
    const { data } = await sharp(jpg).extract({ left: Math.round(fx * width), top: Math.round(fy * height), width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    return [...data];
  };
  const center = await px(0.5, 0.28);
  assert.ok(center[0] > 200 && center[1] < 60, `red in the middle of the box, got ${center}`);
  const outside = await px(0.5, 0.5);
  assert.ok(outside[0] < 40, 'shirt stays black below the art');
});

test('custom orders page shows the mockup and the print size', () => {
  const html = renderCustomOrdersPage({
    days: 30,
    orders: [{
      id: 'gid://shopify/Order/1', name: '#1300', createdAt: '2026-11-26T00:00:00Z', displayFulfillmentStatus: 'UNFULFILLED',
      lines: [{
        title: 'Custom tee', variantTitle: 'Black / M', quantity: 1,
        customAttributes: [{ key: 'Mockup', value: 'https://app/mockup.jpg?art=x' }],
        art: [{ url: cdn('customer-art-a.png'), name: 'logo.png' }], lost: [],
        notes: [{ key: 'Print size', value: '10.0 in wide x 6.0 in tall' }],
      }],
    }],
  });
  assert.match(html, /mockup\.jpg\?art=x/);
  assert.match(html, /10\.0 in wide/);
});

test('the browser script is valid JavaScript with the app address', () => {
  const js = d.designerScript('https://app.example');
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /"appUrl":"https:\/\/app.example"/);
});
