// Copies every blank's stock to its designs.
// With --fix it first turns on inventory tracking for design variants, stocks them at your
// location, and stops them selling when the blank is out.
import { config, requireShopConfig } from '../src/config.js';
import { graphql, stableKey } from '../src/shopify.js';
import { buildBlankMap } from '../src/blankMap.js';
import { getAvailable, setDesignQuantities, getDefaultLocationId } from '../src/inventory.js';

requireShopConfig();
const fix = process.argv.includes('--fix');
const map = await buildBlankMap();
const locationId = await getDefaultLocationId();

if (fix) {
  if (config.dryRun) console.log('[dry run] --fix would update design variants; set DRY_RUN=false to apply.');
  const TRACK = `mutation T($id: ID!) { inventoryItemUpdate(id: $id, input: { tracked: true }) { userErrors { message } } }`;
  const ACTIVATE = `mutation A($item: ID!, $loc: ID!, $key: String!) {
    inventoryActivate(inventoryItemId: $item, locationId: $loc) @idempotent(key: $key) { userErrors { message } } }`;
  const POLICY = `mutation P($pid: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $pid, variants: $variants) { userErrors { message } } }`;
  for (const d of map.designs) {
    const linked = d.variants.filter((v) => map.designVariantToBlank.has(v.id));
    if (config.dryRun) {
      console.log(`[dry run] ${d.title}: would fix ${linked.length} variant(s)`);
      continue;
    }
    for (const v of linked) {
      if (!v.tracked) await graphql(TRACK, { id: v.inventoryItemId });
      await graphql(ACTIVATE, { item: v.inventoryItemId, loc: locationId, key: stableKey(`activate|${v.inventoryItemId}|${locationId}`) });
    }
    const deny = linked.filter((v) => v.inventoryPolicy !== 'DENY').map((v) => ({ id: v.id, inventoryPolicy: 'DENY' }));
    for (let i = 0; i < deny.length; i += 100) {
      const r = await graphql(POLICY, { pid: d.id, variants: deny.slice(i, i + 100) });
      if (r.productVariantsBulkUpdate.userErrors.length) console.log(d.title, JSON.stringify(r.productVariantsBulkUpdate.userErrors));
    }
    console.log(`${d.title}: fixed ${linked.length} variant(s)`);
  }
}

let n = 0;
for (const [blankItemId, designItems] of map.blankItemToDesignItems) {
  const available = await getAvailable(blankItemId, locationId);
  if (available === null) {
    console.log(`Blank ${map.blankItemToVariant.get(blankItemId)?.title} is not stocked at this location, skipped`);
    continue;
  }
  await setDesignQuantities(designItems, locationId, available);
  n++;
}
console.log(`Synced ${n} blank variant(s) to their designs${config.dryRun ? ' (dry run)' : ''}.`);
