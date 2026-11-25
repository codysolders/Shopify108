import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderEmailText } from '../src/email.js';

test('email text lists each line with its order link and the page link', () => {
  const text = reorderEmailText({
    lowCount: 1, notSet: [],
    groups: [{ supplier: 'SanMar', totalQty: 24, lines: [{ product: 'G640', variant: 'Black / M', orderQty: 24, available: 0, reorderUrl: 'https://s.example/G640' }] }],
  }, 'https://app/reorder?key=k');
  assert.match(text, /1 blank color\/size is at or below/);
  assert.match(text, /Order 24: G640 - Black \/ M \(have 0\)  https:\/\/s\.example\/G640/);
  assert.match(text, /Full list with photos: https:\/\/app\/reorder\?key=k/);
});
