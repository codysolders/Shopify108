// Webhook handlers: orders, refunds, inventory changes, product changes.
import { config } from './config.js';
import { graphql, gid } from './shopify.js';
import { getBlankMap, invalidateBlankMap } from './blankMap.js';
import { adjustBlanks, getAvailable, setDesignQuantities, getDefaultLocationId } from './inventory.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const TAGS_ADD = `
mutation Tag($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
}`;

/** Copy a blank's current available count to every design variant that uses it. */
export async function mirrorBlank(blankItemId, locationId, deps = {}) {
  const gql = deps.gql || graphql;
  const map = await getBlankMap({ gql });
  const designItems = map.blankItemToDesignItems.get(blankItemId);
  if (!designItems?.size) return false;
  const available = await getAvailable(blankItemId, locationId, gql);
  if (available === null) return false;
  await setDesignQuantities(designItems, locationId, available, gql);
  return true;
}

/** Sum quantities per blank inventory item for a list of { variantId, quantity }. */
export function blankChangesFor(lines, map, locationId, sign) {
  const totals = new Map();
  for (const line of lines) {
    if (!line.variantId) continue;
    const blank = map.designVariantToBlank.get(line.variantId);
    if (!blank) continue;
    totals.set(blank.inventoryItemId, (totals.get(blank.inventoryItemId) || 0) + sign * line.quantity);
  }
  return [...totals].map(([inventoryItemId, delta]) => ({ inventoryItemId, locationId, delta }));
}

export async function handleOrderCreated(order, deps = {}) {
  const gql = deps.gql || graphql;
  const tags = String(order.tags || '').split(',').map((t) => t.trim());
  if (tags.includes(config.processedTag)) {
    log(`order ${order.name || order.id}: already processed`);
    return { skipped: true };
  }
  const map = await getBlankMap({ gql });
  const locationId = order.location_id ? gid('Location', order.location_id) : await getDefaultLocationId(gql);
  const lines = (order.line_items || []).map((li) => ({
    variantId: li.variant_id ? gid('ProductVariant', li.variant_id) : null,
    quantity: Number(li.quantity) || 0,
  }));
  const changes = blankChangesFor(lines, map, locationId, -1);
  if (!changes.length) {
    log(`order ${order.name || order.id}: no design items`);
    return { changes };
  }
  await adjustBlanks(changes, `order|${order.id}`, 'correction', gql);
  for (const c of changes) await mirrorBlank(c.inventoryItemId, locationId, { gql });
  if (!config.dryRun) {
    await gql(TAGS_ADD, { id: gid('Order', order.id), tags: [config.processedTag] });
  }
  log(`order ${order.name || order.id}: took ${changes.reduce((s, c) => s - c.delta, 0)} blank(s)`);
  return { changes };
}

const RESTOCK_TYPES = new Set(['return', 'cancel', 'legacy_restock']);

export async function handleRefundCreated(refund, deps = {}) {
  const gql = deps.gql || graphql;
  const map = await getBlankMap({ gql });
  const fallback = await getDefaultLocationId(gql);
  const byLocation = new Map();
  for (const rli of refund.refund_line_items || []) {
    if (!RESTOCK_TYPES.has(rli.restock_type)) continue;
    const variantId = rli.line_item?.variant_id ? gid('ProductVariant', rli.line_item.variant_id) : null;
    const loc = rli.location_id ? gid('Location', rli.location_id) : fallback;
    if (!byLocation.has(loc)) byLocation.set(loc, []);
    byLocation.get(loc).push({ variantId, quantity: Number(rli.quantity) || 0 });
  }
  const all = [];
  for (const [loc, lines] of byLocation) {
    const changes = blankChangesFor(lines, map, loc, +1);
    if (!changes.length) continue;
    await adjustBlanks(changes, `refund|${refund.id}|${loc}`, 'restock', gql);
    for (const c of changes) await mirrorBlank(c.inventoryItemId, loc, { gql });
    all.push(...changes);
  }
  if (all.length) log(`refund ${refund.id}: returned ${all.reduce((s, c) => s + c.delta, 0)} blank(s)`);
  return { changes: all };
}

/** Any change to a blank's stock (sale, receiving, manual count) is copied to its designs. */
export async function handleInventoryLevelUpdate(level, deps = {}) {
  const itemId = gid('InventoryItem', level.inventory_item_id);
  const locationId = gid('Location', level.location_id);
  const mirrored = await mirrorBlank(itemId, locationId, deps);
  return { mirrored };
}

export function handleProductChanged() {
  invalidateBlankMap();
  return { invalidated: true };
}

export const topicHandlers = {
  'orders/create': handleOrderCreated,
  'refunds/create': handleRefundCreated,
  'inventory_levels/update': handleInventoryLevelUpdate,
  'products/update': handleProductChanged,
  'products/create': handleProductChanged,
  'products/delete': handleProductChanged,
};
