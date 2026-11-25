// Prints the reorder list in the console, and the private link to the reorder page.
// Usage: npm run reorder
import { requireShopConfig } from '../src/config.js';
import { fetchBlanksForRestock, computeReorder, reorderKey, addExactLinks } from '../src/restock.js';

requireShopConfig();
const APP_URL = process.env.APP_URL || 'https://blank-sync-478869332742.us-west1.run.app';
const { groups, notSet, lowCount } = await addExactLinks(computeReorder(await fetchBlanksForRestock()));

if (!lowCount) console.log('Nothing to reorder. Every blank is above its minimum.');
for (const g of groups) {
  console.log(`\n${g.supplier} (${g.totalQty} shirts)`);
  for (const l of g.lines) console.log(`  order ${l.orderQty}  ${l.product} - ${l.variant}  (have ${l.available}, reorder at ${l.reorderAt})`);
}
if (notSet.length) console.log(`\n${notSet.length} blank color/size(s) have no "Reorder at" yet and aren't checked.`);
console.log(`\nReorder page (bookmark it, keep it private):\n${APP_URL}/reorder?key=${reorderKey()}`);
