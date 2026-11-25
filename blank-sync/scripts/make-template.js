// Make a "TEMPLATE - ... design" draft for a blank, to duplicate for new designs.
// Usage: npm run template -- G640          (any word from the blank's title)
//        npm run template -- G640 25.00    (optional starting price)
import { config, requireShopConfig } from '../src/config.js';
import { graphql } from '../src/shopify.js';
import { createTemplate } from '../src/templates.js';

requireShopConfig();
const [word, price] = process.argv.slice(2);
if (!word) {
  console.log('Usage: npm run template -- G640   (a word from the blank product title)');
  process.exit(1);
}
const found = (await graphql(`query($q:String!){products(first:20,query:$q){nodes{id title}}}`, { q: `title:*${word}*` }))
  .products.nodes.filter((p) => !p.title.startsWith('TEMPLATE'));
if (found.length !== 1) {
  console.log(found.length ? `"${word}" matches several products, be more specific:\n  ${found.map((p) => p.title).join('\n  ')}` : `No product matches "${word}".`);
  process.exit(1);
}
const r = await createTemplate(found[0].id, { price });
const id = String(r.product.id || '').split('/').pop();
if (r.existed) console.log(`Already there: ${r.product.title}`);
else if (r.dryRun) console.log(`[dry run] would create ${r.product.title} with ${r.variants} variants`);
else console.log(`Created ${r.product.title} (${r.variants} variants, draft).`);
if (id) console.log(`https://admin.shopify.com/store/${config.shop}/products/${id}`);
