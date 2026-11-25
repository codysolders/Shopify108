// Restock: which blanks are at or below their minimum, and the reorder page.
import crypto from 'node:crypto';
import { config } from './config.js';
import { graphql } from './shopify.js';
import { fetchDesignProducts } from './blankMap.js';
import { exactSupplierLink } from './supplierLinks.js';

const DEFAULT_ORDER_QTY = 12;

const BLANK_PRODUCTS = `
query Blanks($after: String) {
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      status
      featuredMedia { preview { image { url(transform: { maxWidth: 160 }) } } }
      supplier: metafield(namespace: "custom", key: "supplier") { value }
      reorderUrl: metafield(namespace: "custom", key: "reorder_url") { value }
      reorderAt: metafield(namespace: "custom", key: "reorder_at") { value }
      reorderQty: metafield(namespace: "custom", key: "reorder_qty") { value }
    }
  }
}`;

const BLANK_VARIANTS = `
query BlankVariants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        sku
        inventoryQuantity
        selectedOptions { name value }
        reorderUrl: metafield(namespace: "custom", key: "reorder_url") { value }
        media(first: 1) { nodes { preview { image { url(transform: { maxWidth: 160 }) } } } }
        reorderAt: metafield(namespace: "custom", key: "reorder_at") { value }
        reorderQty: metafield(namespace: "custom", key: "reorder_qty") { value }
      }
    }
  }
}`;

const int = (mf) => (mf?.value != null && mf.value !== '' && !Number.isNaN(Number(mf.value)) ? Number(mf.value) : null);
const img = (media) => media?.preview?.image?.url || null;

/** Blank products = any product used as a design's blank, or with a "Reorder at" set. */
export async function fetchBlanksForRestock(gql = graphql) {
  const usedAsBlank = new Set((await fetchDesignProducts(gql)).map((d) => d.blankId));
  const products = [];
  let after = null;
  do {
    const data = await gql(BLANK_PRODUCTS, { after });
    for (const p of data.products.nodes) {
      if (p.status === 'ARCHIVED') continue;
      if (!usedAsBlank.has(p.id) && int(p.reorderAt) === null) continue;
      products.push({
        id: p.id,
        title: p.title,
        image: img(p.featuredMedia),
        supplier: p.supplier?.value || 'No supplier set',
        reorderUrl: p.reorderUrl?.value || null,
        reorderAt: int(p.reorderAt),
        reorderQty: int(p.reorderQty),
        variants: [],
      });
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);

  for (const p of products) {
    let vAfter = null;
    do {
      const data = await gql(BLANK_VARIANTS, { id: p.id, after: vAfter });
      const conn = data.product?.variants;
      if (!conn) break;
      for (const v of conn.nodes) {
        p.variants.push({
          id: v.id,
          title: v.title,
          sku: v.sku,
          available: v.inventoryQuantity ?? 0,
          selectedOptions: v.selectedOptions || [],
          reorderUrl: v.reorderUrl?.value || null,
          image: img(v.media?.nodes?.[0]),
          reorderAt: int(v.reorderAt),
          reorderQty: int(v.reorderQty),
        });
      }
      vAfter = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (vAfter);
  }
  return products;
}

/**
 * Pure: work out what to order.
 * A variant is low when available <= its "Reorder at" (variant value, else the product's).
 * Variants with no "Reorder at" anywhere are listed under `notSet` so nothing is silently skipped.
 */
export function computeReorder(products) {
  const bySupplier = new Map();
  const notSet = [];
  for (const p of products) {
    for (const v of p.variants) {
      const reorderAt = v.reorderAt ?? p.reorderAt;
      if (reorderAt === null) {
        notSet.push({ product: p.title, variant: v.title });
        continue;
      }
      if (v.available > reorderAt) continue;
      const orderQty = v.reorderQty ?? p.reorderQty ?? DEFAULT_ORDER_QTY;
      const line = {
        product: p.title,
        productId: p.id,
        variant: v.title,
        sku: v.sku,
        available: v.available,
        reorderAt,
        orderQty,
        image: v.image || p.image,
        reorderUrl: v.reorderUrl || p.reorderUrl,
        exactLink: Boolean(v.reorderUrl),
        selectedOptions: v.selectedOptions || [],
      };
      if (!bySupplier.has(p.supplier)) bySupplier.set(p.supplier, []);
      bySupplier.get(p.supplier).push(line);
    }
  }
  const groups = [...bySupplier]
    .map(([supplier, lines]) => ({
      supplier,
      lines: lines.sort((a, b) => a.product.localeCompare(b.product) || a.available - b.available),
      totalQty: lines.reduce((s, l) => s + l.orderQty, 0),
    }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier));
  return { groups, notSet, lowCount: groups.reduce((s, g) => s + g.lines.length, 0) };
}

/**
 * Point each line's Order button at the supplier's exact color/size where possible
 * (a variant's own Reorder link always wins). Mutates and returns the result.
 */
export async function addExactLinks(result, fetchImpl = fetch) {
  for (const g of result.groups) {
    for (const l of g.lines) {
      if (l.exactLink || !l.reorderUrl) continue;
      const exact = await exactSupplierLink(l.reorderUrl, l.selectedOptions, fetchImpl);
      l.exactLink = exact !== l.reorderUrl;
      l.reorderUrl = exact;
    }
  }
  return result;
}

/** The secret part of the reorder page link, derived from the app's client secret. */
export function reorderKey(secret = config.clientSecret) {
  return crypto.createHmac('sha256', secret || 'unset').update('reorder-page').digest('hex').slice(0, 24);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const adminProductUrl = (productId) =>
  `https://admin.shopify.com/store/${config.shop}/products/${String(productId).split('/').pop()}`;

export function renderReorderPage({ groups, notSet, lowCount }, now = new Date()) {
  const when = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
  const sections = groups
    .map((g) => {
      const rows = g.lines
        .map(
          (l) => `<tr>
  <td>${l.image ? `<img src="${esc(l.image)}" alt="" width="56" height="56">` : ''}</td>
  <td><a href="${esc(adminProductUrl(l.productId))}">${esc(l.product)}</a><div class="v">${esc(l.variant)}${l.sku ? ` · ${esc(l.sku)}` : ''}</div></td>
  <td class="n ${l.available <= 0 ? 'out' : ''}">${l.available}</td>
  <td class="n">${l.reorderAt}</td>
  <td class="n b">${l.orderQty}</td>
  <td>${l.reorderUrl ? `<a class="btn" href="${esc(l.reorderUrl)}" target="_blank" rel="noopener">${l.exactLink ? 'Order' : 'Supplier page'}</a>` : '<span class="v">No link</span>'}</td>
</tr>`,
        )
        .join('\n');
      const copyText = g.lines.map((l) => `${l.orderQty} x ${l.product} - ${l.variant}${l.sku ? ` (${l.sku})` : ''}`).join('\n');
      return `<section>
<h2>${esc(g.supplier)} <span class="v">${g.lines.length} item${g.lines.length === 1 ? '' : 's'}, ${g.totalQty} shirts</span></h2>
<div class="scroll"><table>
<thead><tr><th></th><th>Blank</th><th class="n">Have</th><th class="n">Reorder at</th><th class="n">Order</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
<details><summary>Copy as a list</summary><textarea readonly rows="${Math.min(12, g.lines.length + 1)}">${esc(copyText)}</textarea></details>
</section>`;
    })
    .join('\n');

  const notSetNote = notSet.length
    ? `<p class="note">${notSet.length} blank color/size${notSet.length === 1 ? ' has' : 's have'} no "Reorder at" yet, so they aren't checked. Set "Reorder at (default)" on the blank product in Shopify.</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blank reorder list</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e5e5e5;--accent:#0a6c4a;--warn:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#a0a0a0;--line:#2c2c2c;--accent:#3fbf8f;--warn:#ff7a6e}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:900px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0 4px}h2{font-size:17px;margin:24px 0 8px}
.v{color:var(--muted);font-size:13px;font-weight:400}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}
th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums}.b{font-weight:700}.out{color:var(--warn);font-weight:700}
img{border-radius:6px;object-fit:cover;display:block}
a{color:var(--accent)}.btn{display:inline-block;padding:6px 12px;border:1px solid var(--accent);border-radius:6px;text-decoration:none;white-space:nowrap}
textarea{width:100%;box-sizing:border-box;font:13px ui-monospace,monospace;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px}
details{margin-top:8px}.note{color:var(--muted);margin-top:24px}
.ok{padding:24px;border:1px solid var(--line);border-radius:8px;text-align:center}
</style></head>
<body><main>
<h1>Blank reorder list</h1>
<div class="v">${lowCount ? `${lowCount} color/size${lowCount === 1 ? '' : 's'} at or below minimum` : 'Nothing to reorder'} · updated ${esc(when)} Pacific · refresh for the latest</div>
${lowCount ? sections : '<p class="ok">Every blank is above its minimum.</p>'}
${notSetNote}
</main></body></html>`;
}
