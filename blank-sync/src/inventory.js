// Inventory reads and writes against Shopify.
import { config } from './config.js';
import { graphql, stableKey } from './shopify.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const ADJUST = `
mutation Adjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    userErrors { field message code }
  }
}`;

const SET = `
mutation Set($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    userErrors { field message code }
  }
}`;

const LEVEL = `
query Level($item: ID!, $loc: ID!) {
  inventoryItem(id: $item) {
    inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } }
  }
}`;

const PRIMARY_LOCATION = `query { location { id name } }`;

let primaryLocationId = null;
export async function getDefaultLocationId(gql = graphql) {
  if (config.defaultLocationId) return config.defaultLocationId;
  if (!primaryLocationId) primaryLocationId = (await gql(PRIMARY_LOCATION)).location.id;
  return primaryLocationId;
}

/** changes: [{ inventoryItemId, locationId, delta }], key: stable string for retries */
export async function adjustBlanks(changes, key, reason = 'correction', gql = graphql) {
  const nonZero = changes.filter((c) => c.delta !== 0);
  if (!nonZero.length) return;
  if (config.dryRun) {
    log('[dry run] would adjust blanks', JSON.stringify(nonZero));
    return;
  }
  const data = await gql(ADJUST, {
    key: stableKey(key),
    input: {
      name: 'available',
      reason,
      changes: nonZero.map((c) => ({
        inventoryItemId: c.inventoryItemId,
        locationId: c.locationId,
        delta: c.delta,
        changeFromQuantity: null,
      })),
    },
  });
  const errs = data.inventoryAdjustQuantities.userErrors;
  if (errs.length) throw new Error(`Adjust failed: ${JSON.stringify(errs)}`);
  log('adjusted blanks', JSON.stringify(nonZero));
}

export async function getAvailable(inventoryItemId, locationId, gql = graphql) {
  const data = await gql(LEVEL, { item: inventoryItemId, loc: locationId });
  const q = data.inventoryItem?.inventoryLevel?.quantities?.find((x) => x.name === 'available');
  return q ? q.quantity : null;
}

/** Set every design item to the given quantity at a location. */
export async function setDesignQuantities(designItemIds, locationId, quantity, gql = graphql) {
  const ids = [...designItemIds];
  if (!ids.length) return;
  const qty = Math.max(0, quantity);
  if (config.dryRun) {
    log(`[dry run] would set ${ids.length} design variant(s) to ${qty}`);
    return;
  }
  // Shopify accepts up to 250 quantities per call.
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const data = await gql(SET, {
      key: stableKey(`set|${locationId}|${qty}|${chunk.join(',')}|${Date.now()}`),
      input: {
        name: 'available',
        reason: 'correction',
        quantities: chunk.map((id) => ({ inventoryItemId: id, locationId, quantity: qty, changeFromQuantity: null })),
      },
    });
    const errs = data.inventorySetQuantities.userErrors;
    if (errs.length) log('some design variants could not be set', JSON.stringify(errs));
  }
  log(`set ${ids.length} design variant(s) to ${qty}`);
}
