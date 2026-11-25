import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReorder, renderReorderPage, reorderKey } from '../src/restock.js';

const product = (over = {}) => ({
  id: 'gid://shopify/Product/1', title: 'G640', image: 'p.jpg', supplier: 'SanMar',
  reorderUrl: 'https://www.sanmar.com/p/G640', reorderAt: 6, reorderQty: 24, variants: [], ...over,
});
const v = (title, available, over = {}) => ({ id: title, title, sku: null, available, image: null, reorderAt: null, reorderQty: null, ...over });

test('lists variants at or below the minimum, using product defaults', () => {
  const r = computeReorder([product({ variants: [v('Black / M', 6), v('Black / L', 7), v('White / S', -1)] })]);
  assert.equal(r.lowCount, 2);
  assert.deepEqual(r.groups[0].lines.map((l) => [l.variant, l.orderQty]), [['White / S', 24], ['Black / M', 24]]);
  assert.equal(r.groups[0].totalQty, 48);
  assert.equal(r.groups[0].lines[0].image, 'p.jpg');
});

test('variant overrides beat product defaults', () => {
  const r = computeReorder([product({ variants: [v('Black / 3XL', 3, { reorderAt: 2 }), v('Black / M', 10, { reorderAt: 12, reorderQty: 48 })] })]);
  assert.deepEqual(r.groups[0].lines.map((l) => [l.variant, l.orderQty]), [['Black / M', 48]]);
});

test('groups by supplier and reports blanks with no minimum', () => {
  const r = computeReorder([
    product({ variants: [v('Black / M', 0)] }),
    product({ id: 'gid://shopify/Product/2', title: 'Tank', supplier: 'Bayside', variants: [v('Black / S', 1)] }),
    product({ id: 'gid://shopify/Product/3', title: 'No min', reorderAt: null, variants: [v('Red / S', 0)] }),
  ]);
  assert.deepEqual(r.groups.map((g) => g.supplier), ['Bayside', 'SanMar']);
  assert.equal(r.notSet.length, 1);
});

test('page escapes text and shows order links', () => {
  const html = renderReorderPage(computeReorder([product({ title: '<b>G640</b>', variants: [v('Black / M', 0)] })]));
  assert.ok(html.includes('&lt;b&gt;G640&lt;/b&gt;'));
  assert.ok(html.includes('https://www.sanmar.com/p/G640'));
  assert.ok(renderReorderPage({ groups: [], notSet: [], lowCount: 0 }).includes('above its minimum'));
});

test('reorder key is stable and depends on the secret', () => {
  assert.equal(reorderKey('a'), reorderKey('a'));
  assert.notEqual(reorderKey('a'), reorderKey('b'));
  assert.equal(reorderKey('a').length, 24);
});
