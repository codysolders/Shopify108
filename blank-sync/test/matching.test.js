import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDesignToBlank, normValue, buildIndex } from '../src/matching.js';

const opt = (color, size) => [{ name: 'Color', value: color }, { name: 'Size', value: size }];
const blank = {
  id: 'B',
  variants: [
    { id: 'b1', selectedOptions: opt('Black', 'M'), inventoryItemId: 'ib1' },
    { id: 'b2', selectedOptions: opt('Sport Grey', '2XL'), inventoryItemId: 'ib2' },
  ],
};

test('normalizes common size and color spellings', () => {
  assert.equal(normValue('Medium'), 'm');
  assert.equal(normValue('XXL'), '2xl');
  assert.equal(normValue(' Sport  Gray '), 'sport grey');
  assert.equal(normValue('Heather Gray'), 'heather grey');
});

test('matches design variants by color and size, ignoring the Design option', () => {
  const design = {
    id: 'D', title: 'Pride',
    variants: [
      { id: 'd1', selectedOptions: [{ name: 'Design', value: 'Ally-Saurus' }, ...opt('black', 'Medium')], inventoryItemId: 'id1' },
      { id: 'd2', selectedOptions: [{ name: 'Design', value: "Y'all" }, ...opt('Black', 'M')], inventoryItemId: 'id2' },
      { id: 'd3', selectedOptions: [{ name: 'Design', value: "Y'all" }, ...opt('Sport Gray', 'XXL')], inventoryItemId: 'id3' },
      { id: 'd4', selectedOptions: opt('Pink', 'M'), inventoryItemId: 'id4' },
    ],
  };
  const r = matchDesignToBlank(design, blank);
  assert.deepEqual(r.matches.map((m) => [m.designVariant.id, m.blankVariant.id]), [['d1', 'b1'], ['d2', 'b1'], ['d3', 'b2']]);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.unmatched[0].designVariant.id, 'd4');

  const idx = buildIndex([{ design, result: r }]);
  assert.deepEqual([...idx.blankItemToDesignItems.get('ib1')].sort(), ['id1', 'id2']);
});

test('variant override wins over color/size match', () => {
  const design = { id: 'D', title: 'x', variants: [{ id: 'd1', selectedOptions: opt('Black', 'M'), inventoryItemId: 'i', blankVariantOverride: 'b2' }] };
  const r = matchDesignToBlank(design, blank);
  assert.equal(r.matches[0].blankVariant.id, 'b2');
});

test('design missing a blank option is reported, not guessed', () => {
  const design = { id: 'D', title: 'x', variants: [{ id: 'd1', selectedOptions: [{ name: 'Size', value: 'M' }], inventoryItemId: 'i' }] };
  const r = matchDesignToBlank(design, blank);
  assert.equal(r.matches.length, 0);
  assert.match(r.unmatched[0].reason, /missing/);
});
