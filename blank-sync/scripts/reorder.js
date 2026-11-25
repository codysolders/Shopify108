// Prints the reorder list in the console, and the private link to the reorder page.
// Usage: npm run reorder
import { requireShopConfig } from '../src/config.js';
import { fetchBlanksForRestock, computeReorder, reorderKey, addExactLinks } from '../src/restock.js';
import { supplierColors } from '../src/supplierLinks.js';

requireShopConfig();
const APP_URL = process.env.APP_URL || 'https://blank-sync-478869332742.us-west1.run.app';
const { groups, notSet, lowCount } = await addExactLinks(computeReorder(await fetchBlanksForRestock()));

if (!lowCount) console.log('Nothing to reorder. Every blank is above its minimum.');
for (const g of groups) {
  console.log(`\n${g.supplier} (${g.totalQty} shirts)`);
  for (const l of g.lines) console.log(`  order ${l.orderQty}  ${l.product} - ${l.variant}  (have ${l.available}, reorder at ${l.reorderAt})`);
}
const unmatched = groups.flatMap((g) => g.lines).filter((l) => l.reorderUrl && !l.exactLink);
if (unmatched.length) {
  console.log(`\n${unmatched.length} color/size(s) don't have an exact supplier link yet:`);
  const shown = new Set();
  for (const l of unmatched) {
    console.log(`  ${l.product} - ${l.variant}`);
    if (shown.has(l.product)) continue;
    shown.add(l.product);
    const colors = await supplierColors(l.reorderUrl);
    if (colors) console.log(`    Supplier colors for ${l.product}: ${colors.join(', ')}`);
  }
  console.log('  Fix by renaming the color in Shopify to match, or set that variant\'s own "Reorder link".');
}
if (notSet.length) console.log(`\n${notSet.length} blank color/size(s) have no "Reorder at" yet and aren't checked.`);
console.log(`\nReorder page (bookmark it, keep it private):\n${APP_URL}/reorder?key=${reorderKey()}`);
