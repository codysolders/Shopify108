// Read-only report: which designs are linked to which blanks, and anything that needs fixing.
import { requireShopConfig } from '../src/config.js';
import { buildBlankMap } from '../src/blankMap.js';

requireShopConfig();
const map = await buildBlankMap();

console.log(`\nDesign products linked to a blank: ${map.designs.length}`);
for (const d of map.designs) {
  const linked = d.variants.filter((v) => map.designVariantToBlank.has(v.id)).length;
  console.log(`  - ${d.title}: ${linked}/${d.variants.length} variants matched`);
}

const untracked = map.designs.flatMap((d) => d.variants.filter((v) => !v.tracked).map((v) => `${d.title} / ${v.title}`));
const continueSelling = map.designs.flatMap((d) =>
  d.variants.filter((v) => v.inventoryPolicy === 'CONTINUE').map((v) => `${d.title} / ${v.title}`));

if (map.unmatched.length) {
  console.log(`\nVariants with no matching blank (${map.unmatched.length}):`);
  for (const u of map.unmatched.slice(0, 50)) console.log(`  - ${u.design} / ${u.designVariant.title}: ${u.reason}`);
  if (map.unmatched.length > 50) console.log(`  ...and ${map.unmatched.length - 50} more`);
}
if (untracked.length) console.log(`\nDesign variants not tracking inventory: ${untracked.length} (run "npm run resync -- --fix" to turn tracking on)`);
if (continueSelling.length) console.log(`Design variants set to keep selling when out of stock: ${continueSelling.length} (fixed by --fix too)`);
if (!map.unmatched.length && !untracked.length && !continueSelling.length) console.log('\nEverything looks good.');
