import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DRY_RUN = 'false';
process.env.SHOPIFY_SHOP = 'test';
process.env.SHOPIFY_ACCESS_TOKEN = 'x';
const { handleOrderCreated, handleRefundCreated, handleInventoryLevelUpdate } = await import('../src/handlers.js');
const { invalidateBlankMap } = await import('../src/blankMap.js');

const opt = (color, size) => [{ name: 'Color', value: color }, { name: 'Size', value: size }];
const v = (id, item, options) => ({ id, title: id, inventoryPolicy: 'DENY', selectedOptions: options, inventoryItem: { id: item, tracked: true }, override: null });
const P = (n) => `gid://shopify/ProductVariant/${n}`;
const I = (n) => `gid://shopify/InventoryItem/${n}`;
const LOC = 'gid://shopify/Location/1';

function fakeShop(stock) {
  const calls = [];
  const gql = async (query, vars) => {
    calls.push({ query, vars });
    if (query.includes('products(first')) {
      return { products: { pageInfo: { hasNextPage: false }, nodes: [
        { id: 'gid://shopify/Product/B', title: 'Blank', blank: null },
        { id: 'gid://shopify/Product/D1', title: 'Design 1', blank: { reference: { id: 'gid://shopify/Product/B' } } },
        { id: 'gid://shopify/Product/D2', title: 'Design 2', blank: { reference: { id: 'gid://shopify/Product/B' } } },
      ] } };
    }
    if (query.includes('variants(first')) {
      const nodes = {
        'gid://shopify/Product/B': [v(P(1), I(1), opt('Black', 'M')), v(P(2), I(2), opt('White', 'L'))],
        'gid://shopify/Product/D1': [v(P(11), I(11), opt('Black', 'M')), v(P(12), I(12), opt('White', 'L'))],
        'gid://shopify/Product/D2': [v(P(21), I(21), opt('Black', 'Medium'))],
      }[vars.id];
      return { product: { variants: { pageInfo: { hasNextPage: false }, nodes } } };
    }
    if (query.includes('location { id')) return { location: { id: LOC } };
    if (query.includes('inventoryAdjustQuantities')) {
      for (const c of vars.input.changes) stock[c.inventoryItemId] += c.delta;
      return { inventoryAdjustQuantities: { userErrors: [] } };
    }
    if (query.includes('inventoryLevel(')) {
      return { inventoryItem: { inventoryLevel: { quantities: [{ name: 'available', quantity: stock[vars.item] }] } } };
    }
    if (query.includes('inventorySetQuantities')) {
      for (const q of vars.input.quantities) stock[q.inventoryItemId] = q.quantity;
      return { inventorySetQuantities: { userErrors: [] } };
    }
    if (query.includes('tagsAdd')) return { tagsAdd: { userErrors: [] } };
    throw new Error('unexpected query ' + query);
  };
  return { gql, calls };
}

beforeEach(() => invalidateBlankMap());

test('a sale of any design takes from the blank and updates every design', async () => {
  const stock = { [I(1)]: 10, [I(2)]: 5, [I(11)]: 10, [I(12)]: 5, [I(21)]: 10 };
  const { gql, calls } = fakeShop(stock);
  await handleOrderCreated({ id: 500, name: '#1001', tags: '', line_items: [
    { variant_id: 11, quantity: 2 },
    { variant_id: 21, quantity: 1 },
    { variant_id: 999, quantity: 1 }, // not a design (e.g. a coaster)
  ] }, { gql });
  assert.equal(stock[I(1)], 7);
  assert.equal(stock[I(11)], 7);
  assert.equal(stock[I(21)], 7);
  assert.equal(stock[I(2)], 5);
  assert.ok(calls.some((c) => c.query.includes('tagsAdd')));
});

test('an order already tagged is skipped', async () => {
  const stock = { [I(1)]: 10 };
  const { gql } = fakeShop(stock);
  const r = await handleOrderCreated({ id: 501, tags: 'vip, blanks-deducted', line_items: [{ variant_id: 11, quantity: 1 }] }, { gql });
  assert.equal(r.skipped, true);
  assert.equal(stock[I(1)], 10);
});

test('POS orders use the order location', async () => {
  const stock = { [I(1)]: 10, [I(11)]: 10, [I(21)]: 10 };
  const { gql, calls } = fakeShop(stock);
  await handleOrderCreated({ id: 502, location_id: 77, tags: '', line_items: [{ variant_id: 11, quantity: 1 }] }, { gql });
  const adj = calls.find((c) => c.query.includes('inventoryAdjustQuantities'));
  assert.equal(adj.vars.input.changes[0].locationId, 'gid://shopify/Location/77');
});

test('refunds with restock put the blank back; no-restock refunds do nothing', async () => {
  const stock = { [I(1)]: 7, [I(11)]: 7, [I(21)]: 7 };
  const { gql } = fakeShop(stock);
  await handleRefundCreated({ id: 9, refund_line_items: [
    { quantity: 1, restock_type: 'return', location_id: 1, line_item: { variant_id: 11 } },
    { quantity: 5, restock_type: 'no_restock', line_item: { variant_id: 21 } },
  ] }, { gql });
  assert.equal(stock[I(1)], 8);
  assert.equal(stock[I(21)], 8);
});

test('receiving blank stock copies the new count to designs', async () => {
  const stock = { [I(1)]: 30, [I(11)]: 0, [I(21)]: 0 };
  const { gql } = fakeShop(stock);
  const r = await handleInventoryLevelUpdate({ inventory_item_id: 1, location_id: 1, available: 30 }, { gql });
  assert.equal(r.mirrored, true);
  assert.equal(stock[I(11)], 30);
  assert.equal(stock[I(21)], 30);
});

test('inventory updates for design items themselves are ignored (no loop)', async () => {
  const stock = { [I(11)]: 3 };
  const { gql, calls } = fakeShop(stock);
  const r = await handleInventoryLevelUpdate({ inventory_item_id: 11, location_id: 1 }, { gql });
  assert.equal(r.mirrored, false);
  assert.ok(!calls.some((c) => c.query.includes('inventorySetQuantities')));
});
