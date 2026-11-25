// Automatic setup for design products: link to a blank (from the "blank:<style>" tag if needed),
// turn on tracking, stop overselling, and copy the blank's counts. Runs from product webhooks.
import { config } from './config.js';
import { graphql, gid, stableKey } from './shopify.js';
import { fetchVariants, invalidateBlankMap } from './blankMap.js';
import { matchDesignToBlank } from './matching.js';
import { setDesignQuantities, getDefaultLocationId } from './inventory.js';
import { syncTemplatesForBlank } from './templates.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
export const REVIEW_TAG = 'blank-sync-needs-review';

const PRODUCT = `
query P($id: ID!) {
  product(id: $id) {
    id title tags
    blank: metafield(namespace: "custom", key: "blank_product") { reference { ... on Product { id title } } }
  }
}`;

const ALL_PRODUCTS = `
query All($after: String) {
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status
      blank: metafield(namespace: "custom", key: "blank_product") { id }
      supplier: metafield(namespace: "custom", key: "supplier") { id }
      reorderAt: metafield(namespace: "custom", key: "reorder_at") { id }
    }
  }
}`;

const LEVELS = `
query L($ids: [ID!]!, $loc: ID!) {
  nodes(ids: $ids) { ... on InventoryItem { id inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } } }
}`;

const SET_LINK = `
mutation Link($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`;
const TRACK = `mutation T($id: ID!) { inventoryItemUpdate(id: $id, input: { tracked: true }) { userErrors { message } } }`;
const ACTIVATE = `mutation A($item: ID!, $loc: ID!, $key: String!) {
  inventoryActivate(inventoryItemId: $item, locationId: $loc) @idempotent(key: $key) { userErrors { message } } }`;
const POLICY = `mutation P($pid: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $pid, variants: $variants) { userErrors { message } } }`;
const TAGS_ADD = `mutation TA($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`;
const TAGS_REMOVE = `mutation TR($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`;

/** "blank:G640" -> "g640" */
export function blankTagValue(tags) {
  for (const t of tags || []) {
    const m = String(t).trim().match(/^blank\s*:\s*(.+)$/i);
    if (m) return m[1].trim().toLowerCase();
  }
  return null;
}

/**
 * Pure: pick the blank product a tag value names. A blank is a product that isn't a design and either
 * has a Supplier / Reorder at, or has "inventory" in its title. The tag must appear in its title as a
 * whole word ("g640" matches "Gildan Soft Style Inventory G640", not "G6400"). Exactly one match, or none.
 */
export function pickBlankForTag(value, products, selfId) {
  if (!value) return null;
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i');
  const blanks = products.filter(
    (p) => p.id !== selfId && !p.isDesign && (p.isBlank || /inventory/i.test(p.title)) && re.test(p.title),
  );
  return blanks.length === 1 ? blanks[0] : null;
}

/**
 * Pure: the shortest tag that picks this blank and no other, preferring the style number
 * ("Gildan Soft Style Inventory G640" -> "blank:G640"). Null if no word in its name is unique.
 */
export function suggestTag(blank, products) {
  const words = [...new Set(String(blank.title).split(/[^A-Za-z0-9-]+/).filter((w) => w.length >= 2))];
  const score = (w) => (/\d/.test(w) ? 0 : /^(inventory|blanks?|unisex|the|and|with)$/i.test(w) ? 2 : 1);
  words.sort((a, b) => score(a) - score(b) || a.length - b.length);
  for (const w of words) {
    if (score(w) === 2) continue;
    if (pickBlankForTag(w.toLowerCase(), products, null)?.id === blank.id) return `blank:${w}`;
  }
  return null;
}

export async function listProducts(gql = graphql) {
  const out = [];
  let after = null;
  do {
    const data = await gql(ALL_PRODUCTS, { after });
    for (const p of data.products.nodes) {
      out.push({ id: p.id, title: p.title, isDesign: Boolean(p.blank), isBlank: Boolean(p.supplier || p.reorderAt) });
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

/** Blank counts at one location, read 100 at a time. */
async function blankLevels(itemIds, locationId, gql) {
  const out = new Map();
  for (let i = 0; i < itemIds.length; i += 100) {
    const data = await gql(LEVELS, { ids: itemIds.slice(i, i + 100), loc: locationId });
    for (const n of data.nodes || []) {
      const q = n?.inventoryLevel?.quantities?.find((x) => x.name === 'available');
      if (n?.id) out.set(n.id, q ? q.quantity : null);
    }
  }
  return out;
}

/**
 * Pure: what about a product webhook matters for setup (not stock counts, which change on every sale
 * and are handled by mirroring). Same signature as the last successful setup = nothing to do.
 */
export function setupSignature(product, payload) {
  const variants = (payload?.variants || [])
    .map((v) => [v.id, v.option1, v.option2, v.option3, v.inventory_policy, v.inventory_management].join('~'))
    .sort();
  return JSON.stringify([product.blank?.reference?.id || null, [...(product.tags || [])].sort(), variants]);
}

const lastSetup = new Map();

export async function setupDesign(productId, deps = {}) {
  const gql = deps.gql || graphql;
  const id = gid('Product', productId);
  const product = (await gql(PRODUCT, { id })).product;
  if (!product) return { skipped: 'not found' };
  let blankId = product.blank?.reference?.id || null;
  const tags = product.tags || [];
  const signature = deps.payload?.variants ? setupSignature(product, deps.payload) : null;
  if (signature && lastSetup.get(id) === signature) return { skipped: 'unchanged' };

  // 1. Link from the "blank:<style>" tag when the field is empty.
  if (!blankId) {
    const value = blankTagValue(tags);
    if (!value) return { skipped: 'not a design' };
    const blank = pickBlankForTag(value, await listProducts(gql), id);
    if (!blank) {
      log(`${product.title}: tag blank:${value} matches no single blank product`);
      if (!tags.includes(REVIEW_TAG) && !config.dryRun) await gql(TAGS_ADD, { id, tags: [REVIEW_TAG] });
      return { linked: false, reason: `no single blank matches "${value}"` };
    }
    if (config.dryRun) log(`[dry run] would link ${product.title} to ${blank.title}`);
    else {
      const r = await gql(SET_LINK, { m: [{ ownerId: id, namespace: 'custom', key: 'blank_product', type: 'product_reference', value: blank.id }] });
      if (r.metafieldsSet.userErrors.length) throw new Error(JSON.stringify(r.metafieldsSet.userErrors));
      log(`${product.title}: linked to ${blank.title} from its tag`);
    }
    blankId = blank.id;
  }

  // 2. Match variants.
  const blankVariants = await fetchVariants(blankId, gql);
  const design = { id, title: product.title, variants: await fetchVariants(id, gql) };
  const { matches, unmatched } = matchDesignToBlank(design, { id: blankId, variants: blankVariants });
  const locationId = await getDefaultLocationId(gql);
  const changes = { tracked: 0, policy: 0, synced: 0, unmatched: unmatched.length };

  if (!config.dryRun) {
    // 3. Tracking and stocking at the shop.
    for (const { designVariant: v } of matches) {
      if (v.tracked) continue;
      await gql(TRACK, { id: v.inventoryItemId });
      await gql(ACTIVATE, { item: v.inventoryItemId, loc: locationId, key: stableKey(`activate|${v.inventoryItemId}|${locationId}`) });
      changes.tracked++;
    }
    // 4. Never sell past the blank's count.
    const deny = matches.filter((m) => m.designVariant.inventoryPolicy !== 'DENY').map((m) => ({ id: m.designVariant.id, inventoryPolicy: 'DENY' }));
    for (let i = 0; i < deny.length; i += 100) await gql(POLICY, { pid: id, variants: deny.slice(i, i + 100) });
    changes.policy = deny.length;
  }

  // 5. Copy blank counts where they differ.
  const blankQty = await blankLevels([...new Set(matches.map((m) => m.blankVariant.inventoryItemId))], locationId, gql);
  const byQty = new Map();
  for (const { designVariant: v, blankVariant: b } of matches) {
    const q = blankQty.get(b.inventoryItemId) ?? null;
    if (q === null || (v.tracked && v.inventoryQuantity === q)) continue;
    if (!byQty.has(q)) byQty.set(q, []);
    byQty.get(q).push(v.inventoryItemId);
  }
  for (const [q, items] of byQty) {
    await setDesignQuantities(items, locationId, q, gql);
    changes.synced += items.length;
  }

  // 6. Flag designs with colors/sizes the blank doesn't have.
  if (!config.dryRun) {
    if (unmatched.length && !tags.includes(REVIEW_TAG)) await gql(TAGS_ADD, { id, tags: [REVIEW_TAG] });
    if (!unmatched.length && tags.includes(REVIEW_TAG)) await gql(TAGS_REMOVE, { id, tags: [REVIEW_TAG] });
  }
  invalidateBlankMap();
  if (signature) lastSetup.set(id, signature);
  if (changes.tracked || changes.policy || changes.synced || changes.unmatched) {
    log(`${product.title}: set up ${matches.length} variant(s)`, JSON.stringify(changes));
  }
  return { linked: true, matched: matches.length, ...changes };
}

// A blank's colors/sizes, as last synced to its templates (stock-only updates skip the work).
const lastBlankSync = new Map();
async function syncBlankTemplates(payload, deps) {
  const gql = deps.gql || graphql;
  const id = gid('Product', payload.id);
  const sig = (payload.variants || []).map((v) => [v.option1, v.option2, v.option3].join('~')).sort().join('|');
  if (payload.variants && lastBlankSync.get(id) === sig) return { skipped: 'unchanged' };
  const r = await syncTemplatesForBlank(id, { gql, locationId: await getDefaultLocationId(gql) });
  if (payload.variants) lastBlankSync.set(id, sig);
  return r;
}

/** Webhook entry: products/create and products/update. Never throws, so one bad product can't block others. */
export async function handleDesignProductWebhook(payload, deps = {}) {
  invalidateBlankMap();
  if (!payload?.id) return { skipped: 'no id' };
  try {
    const r = await setupDesign(payload.id, { ...deps, payload });
    if (r.skipped === 'not a design') return { ...r, template: await syncBlankTemplates(payload, deps) };
    return r;
  } catch (e) {
    log(`design setup failed for ${payload.title || payload.id}:`, e.message);
    return { error: e.message };
  }
}
