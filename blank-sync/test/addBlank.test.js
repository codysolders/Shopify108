import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DRY_RUN = 'false';
process.env.SHOPIFY_SHOP = 'test';
process.env.SHOPIFY_ACCESS_TOKEN = 'x';
const { splitList, buildBlankInput, renderAddBlankPage, addBlankKey, createBlank } = await import('../src/addBlank.js');
const { reorderKey } = await import('../src/restock.js');

test('lists split on commas and lines, without repeats', () => {
  assert.deepEqual(splitList('Black, white\n Royal  Blue ,BLACK,,'), ['Black', 'white', 'Royal Blue']);
});

test('builds a blank with every color and size, tracked and never oversold', () => {
  const { input, errors } = buildBlankInput({
    title: 'Gildan 64000 Inventory', brand: 'Gildan', supplier: 'Ninja Blanks', reorderUrl: 'https://ninjatransfers.com/products/x',
    colors: 'Black, White', sizes: 'S, M, L', reorderAt: '3', reorderQty: '12', cost: '3.25',
  });
  assert.equal(errors, undefined);
  assert.equal(input.variants.length, 6);
  assert.ok(input.variants.every((v) => v.inventoryPolicy === 'DENY' && v.inventoryItem.tracked && v.inventoryItem.cost === '3.25'));
  assert.deepEqual(input.metafields.map((m) => [m.key, m.value]), [
    ['supplier', 'Ninja Blanks'], ['reorder_url', 'https://ninjatransfers.com/products/x'], ['reorder_at', '3'], ['reorder_qty', '12'],
  ]);
});

test('bad input is explained and nothing is built', () => {
  const { errors, input } = buildBlankInput({ title: '', colors: '', sizes: 'S', reorderAt: '2.5', reorderUrl: 'ninja.com' });
  assert.equal(input, undefined);
  assert.equal(errors.length, 4);
});

test('a duplicate name is refused before anything is written', async () => {
  const calls = [];
  const gql = async (q) => {
    calls.push(q);
    return { products: { pageInfo: { hasNextPage: false }, nodes: [{ id: '1', title: 'Gildan 64000 Inventory', blank: null, supplier: null, reorderAt: null }] } };
  };
  const r = await createBlank({ title: 'gildan 64000 inventory', colors: 'Black', sizes: 'M' }, gql);
  assert.match(r.errors[0], /already exists/);
  assert.ok(!calls.some((q) => q.includes('productSet')));
});

test('page escapes what was typed and uses its own key', () => {
  const html = renderAddBlankPage({ key: 'k', form: { title: '<b>x</b>' }, result: { errors: ['nope'] } });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('Nothing was created'));
  assert.notEqual(addBlankKey('s'), reorderKey('s'));
});
