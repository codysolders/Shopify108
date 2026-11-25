// Template design products: a draft product with Design / Color / Size already linked to a blank.
// Staff duplicate it for each new design, so every new design joins Blank Sync with no extra steps.
import { config } from './config.js';
import { graphql, gid } from './shopify.js';
import { blankOptionNames, variantKey, normName } from './matching.js';

const BLANK = `
query Blank($id: ID!) {
  product(id: $id) {
    id title vendor productType
    options { name values }
  }
}`;

const FIND_TEMPLATE = `
query Find($q: String!) { products(first: 5, query: $q) { nodes { id title } } }`;

const PRODUCT_SET = `
mutation Make($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id title handle }
    userErrors { field message }
  }
}`;

export const DESIGN_OPTION = 'Design';
export const DESIGN_PLACEHOLDER = 'Design name';

export const templateTitle = (blankTitle) =>
  `TEMPLATE - ${blankTitle.replace(/\binventory\b/i, '').replace(/\s{2,}/g, ' ').trim()} design`;

/**
 * Pure: the productSet input for a blank's template. Every color/size the blank has, plus a
 * one-value "Design" option, linked to the blank, tracked, never oversold, saved as a draft.
 */
export function buildTemplateInput(blank, { price = '0.00' } = {}) {
  const options = (blank.options || []).filter((o) => o.name !== 'Title');
  if (!options.length) throw new Error(`${blank.title} has no Color/Size options to copy`);
  const allOptions = [{ name: DESIGN_OPTION, values: [DESIGN_PLACEHOLDER] }, ...options];
  let combos = [[]];
  for (const o of allOptions) combos = combos.flatMap((c) => o.values.map((v) => [...c, { optionName: o.name, name: v }]));
  if (combos.length > 2048) throw new Error(`${combos.length} variants is over Shopify's limit`);
  return {
    title: templateTitle(blank.title),
    status: 'DRAFT',
    vendor: blank.vendor || undefined,
    productType: blank.productType || undefined,
    descriptionHtml:
      '<p>Blank Sync template. Duplicate this product for a new design, then rename it, set the Design value, price and photos. ' +
      'Its stock comes from the blank automatically. Keep this template as a draft.</p>',
    productOptions: allOptions.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) })),
    variants: combos.map((optionValues) => ({
      optionValues,
      price,
      inventoryPolicy: 'DENY',
      inventoryItem: { tracked: true },
    })),
    metafields: [{ namespace: 'custom', key: 'blank_product', type: 'product_reference', value: blank.id }],
  };
}

/** Creates the template for a blank, unless one with the same title already exists. */
export async function createTemplate(blankId, { price, gql = graphql } = {}) {
  const blank = (await gql(BLANK, { id: gid('Product', blankId) })).product;
  if (!blank) throw new Error(`No product ${blankId}`);
  const input = buildTemplateInput(blank, { price });
  const existing = (await gql(FIND_TEMPLATE, { q: `title:"${input.title.replace(/"/g, '')}"` })).products.nodes
    .find((p) => p.title === input.title);
  if (existing) return { product: existing, existed: true };
  if (config.dryRun) return { product: { title: input.title }, dryRun: true, variants: input.variants.length };
  const r = (await gql(PRODUCT_SET, { input })).productSet;
  if (r.userErrors.length) throw new Error(r.userErrors.map((e) => e.message).join('; '));
  return { product: r.product, created: true, variants: input.variants.length };
}

// ---- Keeping templates in step with their blank ----

const TEMPLATES = `
query T { products(first: 50, query: "title:TEMPLATE*") { nodes { id title
  blank: metafield(namespace: "custom", key: "blank_product") { reference { ... on Product { id } } } } } }`;

const VARIANTS_WITH_PRICE = `
query V($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id price selectedOptions { name value } }
    }
  }
}`;

const BULK_DELETE = `
mutation D($pid: ID!, $ids: [ID!]!) {
  productVariantsBulkDelete(productId: $pid, variantsIds: $ids) { userErrors { field message } }
}`;

const BULK_CREATE = `
mutation C($pid: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $pid, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

export async function variantsWithPrice(productId, gql = graphql) {
  const out = [];
  let after = null;
  do {
    const conn = (await gql(VARIANTS_WITH_PRICE, { id: productId, after })).product?.variants;
    if (!conn) break;
    out.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return out;
}

export async function bulkCreateVariants(productId, variants, gql = graphql) {
  for (let i = 0; i < variants.length; i += 100) {
    const r = (await gql(BULK_CREATE, { pid: productId, variants: variants.slice(i, i + 100) })).productVariantsBulkCreate;
    if (r.userErrors.length) throw new Error(r.userErrors.map((e) => e.message).join('; '));
  }
}

/**
 * Pure: the variants a template is missing compared to its blank (new colors or sizes), ready for
 * productVariantsBulkCreate. Uses the template's own Design value and price. Never removes anything.
 */
export function missingTemplateVariants(blankVariants, templateVariants, locationId) {
  const names = blankOptionNames(blankVariants);
  const have = new Set(templateVariants.map((v) => variantKey(v.selectedOptions, names)).filter(Boolean));
  const first = templateVariants[0];
  const design = first?.selectedOptions?.find((o) => normName(o.name) === normName(DESIGN_OPTION))?.value || DESIGN_PLACEHOLDER;
  const price = first?.price || '0.00';
  const out = [];
  for (const b of blankVariants) {
    const k = variantKey(b.selectedOptions, names);
    if (!k || have.has(k)) continue;
    have.add(k);
    out.push({
      optionValues: [
        { optionName: DESIGN_OPTION, name: design },
        ...b.selectedOptions.filter((o) => o.name !== 'Title').map((o) => ({ optionName: o.name, name: o.value })),
      ],
      price,
      inventoryPolicy: 'DENY',
      inventoryItem: { tracked: true },
      inventoryQuantities: [{ locationId, availableQuantity: 0 }],
    });
  }
  return out;
}

/** Pure: template variants whose color/size the blank no longer has (templates are drafts, safe to trim). */
export function extraTemplateVariants(blankVariants, templateVariants) {
  const names = blankOptionNames(blankVariants);
  if (!names.length) return [];
  const blankKeys = new Set(blankVariants.map((v) => variantKey(v.selectedOptions, names)).filter(Boolean));
  const extra = templateVariants.filter((v) => !blankKeys.has(variantKey(v.selectedOptions, names)));
  return extra.length < templateVariants.length ? extra : []; // never empty a template
}

/** Adds a blank's new colors/sizes to its template(s), and drops ones the blank no longer has. The template's own webhook then copies counts. */
export async function syncTemplatesForBlank(blankId, { gql = graphql, locationId } = {}) {
  const templates = (await gql(TEMPLATES)).products.nodes.filter((t) => t.blank?.reference?.id === blankId);
  if (!templates.length) return { templates: 0, added: 0 };
  const blankVariants = await variantsWithPrice(blankId, gql);
  let added = 0;
  let removed = 0;
  for (const t of templates) {
    const tv = await variantsWithPrice(t.id, gql);
    const missing = missingTemplateVariants(blankVariants, tv, locationId);
    const extra = extraTemplateVariants(blankVariants, tv);
    if (!missing.length && !extra.length) continue;
    if (config.dryRun) {
      console.log(`[dry run] would add ${missing.length} and remove ${extra.length} variant(s) on ${t.title}`);
      continue;
    }
    if (missing.length) await bulkCreateVariants(t.id, missing, gql);
    for (let i = 0; i < extra.length; i += 250) {
      const r = (await gql(BULK_DELETE, { pid: t.id, ids: extra.slice(i, i + 250).map((v) => v.id) })).productVariantsBulkDelete;
      if (r.userErrors.length) throw new Error(r.userErrors.map((e) => e.message).join('; '));
    }
    console.log(new Date().toISOString(), `${t.title}: +${missing.length} / -${extra.length} color/size(s) to match its blank`);
    added += missing.length;
    removed += extra.length;
  }
  return { templates: templates.length, added, removed };
}
