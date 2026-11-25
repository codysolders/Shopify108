import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { exactSupplierLink, parseShopifyProductJs, clearSupplierCache } from '../src/supplierLinks.js';

const productJs = {
  options: ['Color', 'Size'],
  variants: [
    { id: 111, options: ['Black', 'Medium'] },
    { id: 222, options: ['Sport Grey', 'XXL'] },
  ],
};
const fakeFetch = (body, ok = true) => async (url) => {
  fakeFetch.lastUrl = url;
  return { ok, json: async () => body };
};
const opts = (c, s) => [{ name: 'Color', value: c }, { name: 'Size', value: s }];
const LINK = 'https://ninjatransfers.com/products/gildan-g640?variant=42485252325459&srsltid=abc';

beforeEach(() => clearSupplierCache());

test('parses Shopify product.js with normalized options', () => {
  const m = parseShopifyProductJs(productJs);
  assert.equal(m.get('color=black|size=m'), 111);
  assert.equal(m.get('color=sport grey|size=2xl'), 222);
});

test('builds an exact color/size link, matching M/Medium and Gray/Grey', async () => {
  assert.equal(await exactSupplierLink(LINK, opts('Black', 'M'), fakeFetch(productJs)),
    'https://ninjatransfers.com/products/gildan-g640?variant=111');
  assert.equal(fakeFetch.lastUrl, 'https://ninjatransfers.com/products/gildan-g640.js');
  assert.equal(await exactSupplierLink(LINK, opts('Sport Gray', '2XL'), fakeFetch(productJs)),
    'https://ninjatransfers.com/products/gildan-g640?variant=222');
});

test('falls back to the plain link when the color is missing or the site is not Shopify', async () => {
  assert.equal(await exactSupplierLink(LINK, opts('Pink', 'M'), fakeFetch(productJs)), LINK);
  clearSupplierCache();
  assert.equal(await exactSupplierLink(LINK, opts('Black', 'M'), fakeFetch(null, false)), LINK);
  assert.equal(await exactSupplierLink('https://www.sanmar.com/p/123', opts('Black', 'M'), fakeFetch(productJs)), 'https://www.sanmar.com/p/123');
});
