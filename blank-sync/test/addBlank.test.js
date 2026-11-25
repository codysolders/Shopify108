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

test('new colors get every size; colors already there are skipped (any spelling)', async () => {
  const { newColorVariants } = await import('../src/addBlank.js');
  const options = [{ name: 'Color', values: ['Black', 'Sport Grey'] }, { name: 'Size', values: ['S', 'M'] }];
  const r = newColorVariants(options, [{ price: '4.00' }], ['Maroon', 'sport gray', 'Forest'], 'L1');
  assert.deepEqual(r.added, ['Maroon', 'Forest']);
  assert.deepEqual(r.already, ['sport gray']);
  assert.equal(r.variants.length, 4);
  assert.deepEqual(r.variants[1].optionValues, [{ optionName: 'Color', name: 'Maroon' }, { optionName: 'Size', name: 'M' }]);
  assert.ok(r.variants.every((v) => v.price === '4.00' && v.inventoryPolicy === 'DENY' && v.inventoryQuantities[0].locationId === 'L1'));
});

test('a template gets only the blank colors/sizes it is missing, with its own design value and price', async () => {
  const { missingTemplateVariants } = await import('../src/templates.js');
  const o = (c, s) => [{ name: 'Color', value: c }, { name: 'Size', value: s }];
  const blank = [{ selectedOptions: o('Black', 'S') }, { selectedOptions: o('Black', 'M') }, { selectedOptions: o('Maroon', 'S') }];
  const tmpl = [
    { price: '25.00', selectedOptions: [{ name: 'Design', value: 'Design name' }, ...o('Black', 'S')] },
    { price: '25.00', selectedOptions: [{ name: 'Design', value: 'Design name' }, ...o('Black', 'Medium')] },
  ];
  const add = missingTemplateVariants(blank, tmpl, 'L1');
  assert.equal(add.length, 1);
  assert.deepEqual(add[0].optionValues, [{ optionName: 'Design', name: 'Design name' }, { optionName: 'Color', name: 'Maroon' }, { optionName: 'Size', name: 'S' }]);
  assert.equal(add[0].price, '25.00');
  assert.equal(missingTemplateVariants(blank.slice(0, 2), tmpl, 'L1').length, 0);
});
