// One-time setup: creates the "Blank product" fields and subscribes to webhooks.
// Usage: node scripts/setup.js https://your-app-url.run.app
import { requireShopConfig } from '../src/config.js';
import { graphql } from '../src/shopify.js';

requireShopConfig();
const appUrl = (process.argv[2] || process.env.APP_URL || '').replace(/\/$/, '');

const DEFINE = `
mutation Define($def: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $def) {
    createdDefinition { id name }
    userErrors { field message code }
  }
}`;

const definitions = [
  {
    name: 'Blank product',
    namespace: 'custom',
    key: 'blank_product',
    type: 'product_reference',
    ownerType: 'PRODUCT',
    pin: true,
    description: 'The blank shirt product this design is printed on. Stock is taken from the blank with the same color and size.',
  },
  {
    name: 'Blank variant (override)',
    namespace: 'custom',
    key: 'blank_variant',
    type: 'variant_reference',
    ownerType: 'PRODUCTVARIANT',
    description: 'Optional. Use only if this variant should draw from a different blank than its color and size match.',
  },
];

for (const def of definitions) {
  const r = (await graphql(DEFINE, { def })).metafieldDefinitionCreate;
  const taken = r.userErrors.some((e) => e.code === 'TAKEN');
  if (r.createdDefinition) console.log(`Created field "${def.name}"`);
  else if (taken) console.log(`Field "${def.name}" already exists`);
  else console.log(`Could not create "${def.name}":`, JSON.stringify(r.userErrors));
}

if (!appUrl) {
  console.log('\nNo app URL given, so webhooks were not set up. Run again with your app URL to add them.');
  process.exit(0);
}

const EXISTING = `query { webhookSubscriptions(first: 100) { nodes { id topic uri } } }`;
const SUBSCRIBE = `
mutation Sub($topic: WebhookSubscriptionTopic!, $uri: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

const uri = `${appUrl}/webhooks`;
const existing = (await graphql(EXISTING)).webhookSubscriptions.nodes;
const topics = ['ORDERS_CREATE', 'REFUNDS_CREATE', 'INVENTORY_LEVELS_UPDATE', 'PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
for (const topic of topics) {
  if (existing.some((w) => w.topic === topic && w.uri === uri)) {
    console.log(`Webhook ${topic} already set up`);
    continue;
  }
  const r = (await graphql(SUBSCRIBE, { topic, uri })).webhookSubscriptionCreate;
  console.log(r.userErrors.length ? `Webhook ${topic} failed: ${JSON.stringify(r.userErrors)}` : `Webhook ${topic} set up`);
}
