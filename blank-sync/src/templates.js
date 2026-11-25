// Template design products: a draft product with Design / Color / Size already linked to a blank.
// Staff duplicate it for each new design, so every new design joins Blank Sync with no extra steps.
import { config } from './config.js';
import { graphql, gid } from './shopify.js';

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
