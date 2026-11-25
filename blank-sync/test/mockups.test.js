import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.DRY_RUN = 'false';
process.env.SHOPIFY_SHOP = 'test';
process.env.SHOPIFY_ACCESS_TOKEN = 'x';
const m = await import('../src/mockups.js');
const { renderMockupProduct, renderMockupGroup } = await import('../src/mockupPage.js');

const cdn = (f) => `https://cdn.shopify.com/s/files/1/0767/1260/7976/files/${f}?v=1`;

test('art fits inside the print box, centered across, at the top', () => {
  // Wide art in a tall box: width-limited.
  assert.deepEqual(m.placeArt(1000, 1000, 400, 200, { x: 0.5, y: 0.2, w: 0.4, h: 0.5 }), { left: 300, top: 200, width: 400, height: 200 });
  // Tall art: height-limited, still centered.
  assert.deepEqual(m.placeArt(1000, 1000, 100, 400, { x: 0.5, y: 0.2, w: 0.4, h: 0.2 }), { left: 475, top: 200, width: 50, height: 200 });
  // Never off the photo.
  const s = m.placeArt(100, 100, 10, 10, { x: 0.99, y: 0.99, w: 0.2, h: 0.2 });
  assert.ok(s.left + s.width <= 100 && s.top + s.height <= 100);
});

test('finds color photos in alt text and file names, without false hits', () => {
  const colors = ['Black', 'Navy', 'Red', 'Dark Ash', 'Heather Navy'];
  const show = (url, alt, c) => m.mediaShowsColor({ url: cdn(url), alt }, c, colors);
  assert.ok(show('2905-darkash.jpg', '', 'Dark Ash'));
  assert.ok(show('2160-navy1.jpg', '', 'Navy'));
  assert.ok(show('2905-navy_2d73fc0d-dd23-4462-a7f1-ebaf11925758.jpg', '', 'Navy'));
  assert.ok(show('x.jpg', 'Bayside 2905 red union-made T-shirt', 'Red'));
  assert.ok(!show('x.jpg', 'Bayside 2905 black union-made T-shirt', 'Red'));
  assert.ok(!show('shredded.jpg', '', 'Red'));
  assert.ok(!show('heather-navy.jpg', '', 'Navy'), 'longer color wins');
  assert.ok(show('heather-navy.jpg', '', 'Heather Navy'));
});

const product = () => ({
  id: 'gid://shopify/Product/1',
  title: 'Classic T-Shirt',
  options: [
    { name: 'Design', values: ['Design 1', 'Design 2'] },
    { name: 'Color', values: ['Black', 'Navy'] },
    { name: 'Size', values: ['S', 'M'] },
  ],
  media: [
    { id: 'm-black', alt: '', url: cdn('2905-black.jpg') },
    { id: 'm-navy', alt: '', url: cdn('2905-navy.jpg') },
  ],
  variants: ['Design 1', 'Design 2'].flatMap((d) =>
    ['Black', 'Navy'].flatMap((c) =>
      ['S', 'M'].map((s) => ({
        id: `v-${d}-${c}-${s}`,
        selectedOptions: [{ name: 'Design', value: d }, { name: 'Color', value: c }, { name: 'Size', value: s }],
        mediaIds: [c === 'Black' ? 'm-black' : 'm-navy'],
      })),
    ),
  ),
  art: { 'Design 1': cdn('art1.png') },
  place: m.PRESETS.front,
  made: {},
});

test('photos come from each color\'s variants first, and mockups are never used as photos', () => {
  const p = product();
  p.media.push({ id: 'mk', alt: 'Mockup: Design 1 / Black', url: cdn('mockup-black.jpg') });
  p.variants[0].mediaIds = ['mk'];
  const photos = m.findPhotos({ colors: ['Black', 'Navy'], variants: p.variants, media: p.media });
  assert.equal(photos.black.url, cdn('2905-black.jpg'));
  assert.equal(photos.navy.from, 'variant');
  const saved = m.findPhotos({ colors: ['Black'], variants: [], media: [], saved: { black: 'https://x/b.jpg' } });
  assert.equal(saved.black.url, 'https://x/b.jpg');
  const fromBlank = m.findPhotos({ colors: ['Black'], variants: [], media: [], blankMedia: [{ id: 'b', alt: 'Black', url: cdn('g640.jpg') }] });
  assert.equal(fromBlank.black.from, 'blank');
});

test('plans one mockup per design and color, for every size, and skips ones already made', () => {
  const p = product();
  p.photos = m.findPhotos({ colors: ['Black', 'Navy'], variants: p.variants, media: p.media });
  let plan = m.planMockups(p);
  assert.equal(plan.jobs.length, 2);
  assert.deepEqual(plan.jobs[0].variantIds, ['v-Design 1-Black-S', 'v-Design 1-Black-M']);
  assert.deepEqual(plan.missing.map((x) => x.reason), ['no art yet', 'no art yet']);
  // Made with the same inputs: nothing to do. Placement changed: remake, replacing the old one.
  p.media.push({ id: 'mk1', alt: 'Mockup: Design 1 / Black', url: cdn('mk1.jpg') });
  p.made['Design 1|black'] = { media: 'mk1', hash: plan.jobs[0].hash };
  assert.equal(m.planMockups(p).jobs.length, 1);
  p.place = m.PRESETS.chest;
  const again = m.planMockups(p);
  assert.equal(again.jobs.length, 2);
  assert.equal(again.jobs[0].old, 'mk1');
  assert.equal(m.planMockups(p, { only: 'Design 2' }).jobs.length, 0);
});

test('products without a Design option use one art for everything', () => {
  const p = product();
  p.options = p.options.filter((o) => o.name !== 'Design');
  p.variants = p.variants.slice(0, 4).map((v) => ({ ...v, selectedOptions: v.selectedOptions.filter((o) => o.name !== 'Design') }));
  p.art = { [m.DEFAULT_DESIGN]: cdn('art.png') };
  p.photos = m.findPhotos({ colors: ['Black', 'Navy'], variants: p.variants, media: p.media });
  assert.equal(m.planMockups(p).jobs.length, 2);
});

test('starting placement follows the product type', () => {
  assert.deepEqual(m.guessPlace('Richardson 112 Trucker'), m.PRESETS.hat);
  assert.deepEqual(m.guessPlace('12" Knit Cuff Beanie'), m.PRESETS.hat);
  assert.deepEqual(m.guessPlace('Plaid Polo'), m.PRESETS.chest);
  assert.deepEqual(m.guessPlace('Classic T-Shirt'), m.PRESETS.front);
});

test('puts the art on the photo where the plan says', async () => {
  const photo = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#000080' } }).jpeg().toBuffer();
  const art = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const out = await m.composeMockup(photo, art, { x: 0.5, y: 0.25, w: 0.4, h: 0.4 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1200); // small photos are enlarged
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.slice((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  const spot = m.placeArt(1200, 1500, 200, 100, { x: 0.5, y: 0.25, w: 0.4, h: 0.4 });
  const [r, , b] = px(spot.left + 10, spot.top + 10);
  assert.ok(r > 200 && b < 60, 'art is there');
  const [r2, , b2] = px(20, 20);
  assert.ok(r2 < 40 && b2 > 90, 'shirt is untouched elsewhere');
});

test('the group and product pages render', () => {
  const p = product();
  p.photos = m.findPhotos({ colors: ['Black', 'Navy'], variants: p.variants, media: p.media });
  const html = renderMockupProduct({ key: 'k', product: { ...p, placeSaved: false, savedPhotos: {} }, tag: 'union-3711' });
  assert.match(html, /Make missing mockups \(2\)/);
  assert.match(html, /Design 2 no art yet/);
  const g = renderMockupGroup({ key: 'k', tag: 'union-3711', products: [{ id: '1', title: 'Tee', status: 'ACTIVE', tags: [], image: null, designs: ['Design 1'], colors: ['Black'], art: {}, madeCount: 0 }] });
  assert.match(g, /Upload for all 1/);
});

test('design tags skip Blank Sync tags and templates', () => {
  const tags = m.designTags([
    { title: 'Tee', tags: ['union-3711', 'blank:2905'], colors: ['Black'] },
    { title: 'TEMPLATE - x design', tags: ['union-3711'], colors: ['Black'] },
    { title: 'Blank', tags: ['blank'], colors: ['Black'] },
  ]);
  assert.deepEqual(tags, [{ tag: 'union-3711', count: 1 }]);
});

test('empty see-through edges are cut off the art', async () => {
  const inner = await sharp({ create: { width: 50, height: 30, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const art = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, left: 40, top: 60 }]).png().toBuffer();
  const meta = await sharp(await m.trimArt(art)).metadata();
  assert.deepEqual([meta.width, meta.height], [50, 30]);
});
