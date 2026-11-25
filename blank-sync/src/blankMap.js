// Reads the store's design products and their blanks, and builds the lookup index.
import { config } from './config.js';
import { graphql } from './shopify.js';
import { matchDesignToBlank, buildIndex } from './matching.js';

const PRODUCTS_QUERY = `
query Products($after: String) {
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      status
      blank: metafield(namespace: "${config.blankProductMetafield.namespace}", key: "${config.blankProductMetafield.key}") {
        reference { ... on Product { id title } }
      }
    }
  }
}`;

const VARIANTS_QUERY = `
query Variants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        inventoryPolicy
        selectedOptions { name value }
        inventoryItem { id tracked }
        override: metafield(namespace: "${config.blankVariantMetafield.namespace}", key: "${config.blankVariantMetafield.key}") {
          reference { ... on ProductVariant { id } }
        }
      }
    }
  }
}`;

export async function fetchDesignProducts(gql = graphql) {
  const designs = [];
  let after = null;
  do {
    const data = await gql(PRODUCTS_QUERY, { after });
    for (const p of data.products.nodes) {
      const blankId = p.blank?.reference?.id;
      if (blankId && blankId !== p.id) designs.push({ id: p.id, title: p.title, status: p.status, blankId });
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return designs;
}

export async function fetchVariants(productId, gql = graphql) {
  const out = [];
  let after = null;
  do {
    const data = await gql(VARIANTS_QUERY, { id: productId, after });
    const conn = data.product?.variants;
    if (!conn) break;
    for (const v of conn.nodes) {
      out.push({
        id: v.id,
        title: v.title,
        inventoryPolicy: v.inventoryPolicy,
        selectedOptions: v.selectedOptions,
        inventoryItemId: v.inventoryItem.id,
        tracked: v.inventoryItem.tracked,
        blankVariantOverride: v.override?.reference?.id || null,
      });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return out;
}

export async function buildBlankMap(gql = graphql) {
  const designs = await fetchDesignProducts(gql);
  const blanks = new Map();
  for (const d of designs) {
    if (!blanks.has(d.blankId)) blanks.set(d.blankId, { id: d.blankId, variants: await fetchVariants(d.blankId, gql) });
  }
  const allBlankVariantsById = new Map();
  for (const b of blanks.values()) for (const v of b.variants) allBlankVariantsById.set(v.id, v);

  const entries = [];
  for (const d of designs) {
    const design = { ...d, variants: await fetchVariants(d.id, gql) };
    entries.push({ design, result: matchDesignToBlank(design, blanks.get(d.blankId), allBlankVariantsById) });
  }
  const index = buildIndex(entries);
  return { ...index, designs: entries.map((e) => e.design), blanks: [...blanks.values()], builtAt: Date.now() };
}

let cache = null;
let building = null;

export async function getBlankMap({ force = false, gql = graphql } = {}) {
  if (!force && cache && Date.now() - cache.builtAt < config.mapTtlMs) return cache;
  if (!building) {
    building = buildBlankMap(gql)
      .then((m) => (cache = m))
      .finally(() => (building = null));
  }
  return building;
}

export function invalidateBlankMap() {
  cache = null;
}
