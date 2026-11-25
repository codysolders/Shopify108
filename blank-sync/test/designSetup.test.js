import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DRY_RUN = 'false';
process.env.SHOPIFY_SHOP = 'test';
process.env.SHOPIFY_ACCESS_TOKEN = 'x';
const { blankTagValue, pickBlankForTag, setupDesign, setupSignature, REVIEW_TAG } = await import('../src/designSetup.js');

const B = 'gid://shopify/Product/B';
const D = 'gid://shopify/Product/9';
const LOC = 'gid://shopify/Location/1';
const opt = (color, size) => [{ name: 'Color', value: color }, { name: 'Size', value: size }];

test('blank tag value', () => {
  assert.equal(blankTagValue(['Summer', 'blank:G640']), 'g640');
  assert.equal(blankTagValue(['Blank : 64200 ']), '64200');
  assert.equal(blankTagValue(['blanks']), null);
});

test('picks exactly one blank by whole word', () => {
  const products = [
    { id: '1', title: 'Gildan Soft Style Inventory G640', isDesign: false, isBlank: true },
    { id: '2', title: 'Gildan Inventory G6400', isDesign: false, isBlank: true },
    { id: '3', title: 'G640 Pride Design', isDesign: true, isBlank: false },
    { id: '4', title: 'Random G640 shirt', isDesign: false, isBlank: false },
  ];
  assert.equal(pickBlankForTag('g640', products, 'x').id, '1');
  assert.equal(pickBlankForTag('g6400', products, 'x').id, '2');
  assert.equal(pickBlankForTag('gildan', products, 'x'), null); // two blanks: no guess
  assert.equal(pickBlankForTag('nope', products, 'x'), null);
});

function fakeShop({ linked, tags, designVariants }) {
  const calls = [];
  const stock = { 'I1': 7, 'I2': 0 };
  const gql = async (query, vars) => {
    calls.push({ query, vars });
    if (query.includes('product(id: $id) {\n    id title tags')) {
      return { product: { id: D, title: 'New design', tags, blank: linked ? { reference: { id: B } } : null } };
    }
    if (query.includes('products(first')) {
      return { products: { pageInfo: { hasNextPage: false }, nodes: [
        { id: B, title: 'Gildan Soft Style Inventory G640', status: 'ACTIVE', blank: null, supplier: { id: 'm' }, reorderAt: null },
        { id: D, title: 'New design', status: 'DRAFT', blank: null, supplier: null, reorderAt: null },
      ] } };
    }
    if (query.includes('variants(first')) {
      const nodes = vars.id === B
        ? [
            { id: 'BV1', title: 'a', inventoryPolicy: 'DENY', inventoryQuantity: 7, selectedOptions: opt('Black', 'M'), inventoryItem: { id: 'I1', tracked: true }, override: null },
            { id: 'BV2', title: 'b', inventoryPolicy: 'DENY', inventoryQuantity: 0, selectedOptions: opt('White', 'L'), inventoryItem: { id: 'I2', tracked: true }, override: null },
          ]
        : designVariants;
      return { product: { variants: { pageInfo: { hasNextPage: false }, nodes } } };
    }
    if (query.includes('location { id')) return { location: { id: LOC } };
    if (query.includes('nodes(ids')) {
      return { nodes: vars.ids.map((id) => ({ id, inventoryLevel: { quantities: [{ name: 'available', quantity: stock[id] }] } })) };
    }
    for (const m of ['metafieldsSet', 'inventoryItemUpdate', 'inventoryActivate', 'productVariantsBulkUpdate', 'tagsAdd', 'tagsRemove', 'inventorySetQuantities']) {
      if (query.includes(m)) return { [m]: { userErrors: [] } };
    }
    throw new Error('unexpected query ' + query);
  };
  const named = (m) => calls.filter((c) => c.query.includes(m));
  return { gql, calls, named };
}

const dv = (id, item, options, extra = {}) => ({ id, title: id, inventoryPolicy: 'CONTINUE', inventoryQuantity: 0, selectedOptions: options, inventoryItem: { id: item, tracked: false }, override: null, ...extra });

test('a new design tagged blank:G640 is linked, tracked, set to deny and given the blank counts', async () => {
  const shop = fakeShop({ linked: false, tags: ['blank:G640'], designVariants: [
    dv('DV1', 'DI1', [{ name: 'Design', value: 'Cat' }, ...opt('Black', 'Medium')]),
    dv('DV2', 'DI2', [{ name: 'Design', value: 'Cat' }, ...opt('White', 'L')]),
  ] });
  const r = await setupDesign(9, { gql: shop.gql });
  assert.equal(r.linked, true);
  assert.equal(r.matched, 2);
  assert.equal(shop.named('metafieldsSet')[0].vars.m[0].value, B);
  assert.equal(shop.named('inventoryItemUpdate').length, 2);
  assert.deepEqual(shop.named('productVariantsBulkUpdate')[0].vars.variants.map((v) => v.inventoryPolicy), ['DENY', 'DENY']);
  const sets = shop.named('inventorySetQuantities').flatMap((c) => c.vars.input.quantities);
  assert.deepEqual(sets.map((q) => [q.inventoryItemId, q.quantity]).sort(), [['DI1', 7], ['DI2', 0]]);
  assert.equal(shop.named('tagsAdd').length, 0);
});

test('an already set up design changes nothing', async () => {
  const done = { inventoryPolicy: 'DENY', inventoryItem: { id: 'x', tracked: true } };
  const shop = fakeShop({ linked: true, tags: [], designVariants: [
    dv('DV1', 'DI1', opt('Black', 'M'), { ...done, inventoryQuantity: 7, inventoryItem: { id: 'DI1', tracked: true } }),
    dv('DV2', 'DI2', opt('White', 'L'), { ...done, inventoryQuantity: 0, inventoryItem: { id: 'DI2', tracked: true } }),
  ] });
  const r = await setupDesign(9, { gql: shop.gql });
  assert.deepEqual([r.tracked, r.policy, r.synced, r.unmatched], [0, 0, 0, 0]);
  for (const m of ['metafieldsSet', 'inventoryItemUpdate', 'productVariantsBulkUpdate', 'inventorySetQuantities', 'tagsAdd', 'tagsRemove']) {
    assert.equal(shop.named(m).length, 0, m);
  }
});

test('colors the blank lacks get the review tag; the tag comes off once fixed', async () => {
  const shop = fakeShop({ linked: true, tags: [], designVariants: [dv('DV1', 'DI1', opt('Purple', 'M'))] });
  const r = await setupDesign(9, { gql: shop.gql });
  assert.equal(r.unmatched, 1);
  assert.deepEqual(shop.named('tagsAdd')[0].vars.tags, [REVIEW_TAG]);

  const fixed = fakeShop({ linked: true, tags: [REVIEW_TAG], designVariants: [dv('DV1', 'DI1', opt('Black', 'M'))] });
  await setupDesign(9, { gql: fixed.gql });
  assert.equal(fixed.named('tagsRemove').length, 1);
});

test('a tag that names no blank flags the product for review and links nothing', async () => {
  const shop = fakeShop({ linked: false, tags: ['blank:XYZ'], designVariants: [] });
  const r = await setupDesign(9, { gql: shop.gql });
  assert.equal(r.linked, false);
  assert.equal(shop.named('metafieldsSet').length, 0);
  assert.equal(shop.named('tagsAdd').length, 1);
});

test('products without a link or tag are left alone', async () => {
  const shop = fakeShop({ linked: false, tags: ['summer'], designVariants: [] });
  assert.deepEqual(await setupDesign(9, { gql: shop.gql }), { skipped: 'not a design' });
  assert.equal(shop.calls.length, 1);
});

test('stock-only updates are skipped after a successful setup', async () => {
  const variants = [dv('DV1', 'DI1', opt('Black', 'M'), { inventoryPolicy: 'DENY', inventoryQuantity: 7, inventoryItem: { id: 'DI1', tracked: true } })];
  const payload = (qty) => ({ id: 9, variants: [{ id: 1, option1: 'Black', option2: 'M', inventory_policy: 'deny', inventory_management: 'shopify', inventory_quantity: qty }] });
  const shop = fakeShop({ linked: true, tags: [], designVariants: variants });
  await setupDesign(9, { gql: shop.gql, payload: payload(7) });
  const before = shop.calls.length;
  assert.deepEqual(await setupDesign(9, { gql: shop.gql, payload: payload(3) }), { skipped: 'unchanged' });
  assert.equal(shop.calls.length, before + 1);
  assert.notEqual(setupSignature({ tags: ['a'] }, payload(1)), setupSignature({ tags: ['b'] }, payload(1)));
});

test('template input: one Design value times every color and size, linked and draft', async () => {
  const { buildTemplateInput, templateTitle } = await import('../src/templates.js');
  const input = buildTemplateInput({ id: B, title: 'Gildan Soft Style Inventory G640', options: [
    { name: 'Color', values: ['Black', 'White', 'Royal'] }, { name: 'Size', values: ['S', 'M'] },
  ] });
  assert.equal(input.title, 'TEMPLATE - Gildan Soft Style G640 design');
  assert.equal(templateTitle('G640 Inventory'), 'TEMPLATE - G640 design');
  assert.equal(input.status, 'DRAFT');
  assert.equal(input.variants.length, 6);
  assert.deepEqual(input.productOptions.map((o) => o.name), ['Design', 'Color', 'Size']);
  assert.deepEqual(input.variants[0].optionValues, [
    { optionName: 'Design', name: 'Design name' }, { optionName: 'Color', name: 'Black' }, { optionName: 'Size', name: 'S' },
  ]);
  assert.ok(input.variants.every((v) => v.inventoryPolicy === 'DENY' && v.inventoryItem.tracked));
  assert.equal(input.metafields[0].value, B);
});
