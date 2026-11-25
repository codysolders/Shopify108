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
const fakeFetch = (body, ok = true, html = '') => async (url) => {
  if (url.endsWith('.js')) fakeFetch.lastUrl = url;
  return { ok, json: async () => body, text: async () => html };
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

test('falls back to the product page with no color picked, never another color', async () => {
  assert.equal(await exactSupplierLink(LINK, opts('Pink', 'M'), fakeFetch(productJs)), 'https://ninjatransfers.com/products/gildan-g640');
  clearSupplierCache();
  assert.equal(await exactSupplierLink(LINK, opts('Black', 'M'), fakeFetch(null, false)), LINK);
  assert.equal(await exactSupplierLink('https://www.sanmar.com/p/123', opts('Black', 'M'), fakeFetch(productJs)), 'https://www.sanmar.com/p/123');
});

test('fuzzy-matches small color name differences when only one color fits', async () => {
  const js = { options: ['Color', 'Size'], variants: [
    { id: 1, options: ['Heather Cardinal', 'M'] },
    { id: 2, options: ['Purple Heather', 'M'] },
    { id: 3, options: ['Heather Irish Green', 'M'] },
    { id: 4, options: ['Irish Green', 'M'] },
  ] };
  assert.equal(await exactSupplierLink(LINK, opts('Heather Cardinal Red', 'M'), fakeFetch(js)), 'https://ninjatransfers.com/products/gildan-g640?variant=1');
  assert.equal(await exactSupplierLink(LINK, opts('Heather Purple', 'M'), fakeFetch(js)), 'https://ninjatransfers.com/products/gildan-g640?variant=2');
  assert.equal(await exactSupplierLink(LINK, opts('Heather Irish Green', 'M'), fakeFetch(js)), 'https://ninjatransfers.com/products/gildan-g640?variant=3');
  // a heather color never matches a plain one, so "Green" can only be "Irish Green"
  assert.equal(await exactSupplierLink(LINK, opts('Green', 'M'), fakeFetch(js)), 'https://ninjatransfers.com/products/gildan-g640?variant=4');
});

test('Ninja-style names: heather stays heather, abbreviations expand', async () => {
  const js = { options: ['Color', 'Size'], variants: [
    { id: 10, options: ['Heather Cardinal', 'S'] },
    { id: 11, options: ['Cardinal Red', 'S'] },
    { id: 12, options: ['Hthr Irish Green', 'S'] },
    { id: 13, options: ['Irish Green', 'S'] },
  ] };
  const f = fakeFetch(js);
  assert.equal(await exactSupplierLink(LINK, opts('Heather Cardinal Red', 'S'), f), 'https://ninjatransfers.com/products/gildan-g640?variant=10');
  assert.equal(await exactSupplierLink(LINK, opts('Heather Irish Green', 'S'), f), 'https://ninjatransfers.com/products/gildan-g640?variant=12');
  assert.equal(await exactSupplierLink(LINK, opts('Cardinal Red', 'S'), f), 'https://ninjatransfers.com/products/gildan-g640?variant=11');
});

test('colors past the product.js limit are read from the product page', async () => {
  const js = { options: ['Color', 'Size'], variants: [{ id: 1, options: ['Black', 'S'] }] };
  const html = '<script>var meta = {"variants":[{"id":4001,"title":"Royal \\/ S","option1":"Royal","option2":"S","option3":null},'
    + '{"id":4002,"title":"Sport Grey \\/ M","option1":"Sport Grey","option2":"M","option3":null}]}</script>';
  const f = fakeFetch(js, true, html);
  assert.equal(await exactSupplierLink(LINK, opts('Royal Blue', 'S'), f), 'https://ninjatransfers.com/products/gildan-g640?variant=4001');
  assert.equal(await exactSupplierLink(LINK, opts('Sport Gray', 'M'), f), 'https://ninjatransfers.com/products/gildan-g640?variant=4002');
});
