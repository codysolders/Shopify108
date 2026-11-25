// "Add a blank" page: staff fill in one form and get a ready blank product (tracked, never oversold,
// with supplier and reorder fields) plus a design template to duplicate.
import crypto from 'node:crypto';
import { config } from './config.js';
import { graphql } from './shopify.js';
import { createTemplate, templateTitle } from './templates.js';
import { listProducts } from './designSetup.js';
import { supplierColors, plainProductLink } from './supplierLinks.js';

export const DEFAULT_SIZES = 'S, M, L, XL, 2XL, 3XL';

const PRODUCT_SET = `
mutation Make($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id title }
    userErrors { field message }
  }
}`;

export function addBlankKey(secret = config.clientSecret) {
  return crypto.createHmac('sha256', secret || 'unset').update('add-blank-page').digest('hex').slice(0, 24);
}

/** "Black, White\nRoyal" -> ["Black", "White", "Royal"], trimmed, no repeats (case-insensitive). */
export function splitList(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[,\n]/)) {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

const whole = (v) => (v === '' || v == null ? null : Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
const money = (v) => (v === '' || v == null ? null : /^\d+(\.\d{1,2})?$/.test(String(v).trim()) ? String(v).trim() : NaN);

/** Pure: check the form and build the productSet input. Returns { errors } or { input }. */
export function buildBlankInput(form) {
  const errors = [];
  const title = String(form.title || '').trim();
  const colors = splitList(form.colors);
  const sizes = splitList(form.sizes);
  const reorderAt = whole(form.reorderAt);
  const reorderQty = whole(form.reorderQty);
  const cost = money(form.cost);
  const link = String(form.reorderUrl || '').trim();
  if (!title) errors.push('Give the blank a name, like "Gildan 64000 Inventory".');
  if (!colors.length) errors.push('List at least one color.');
  if (!sizes.length) errors.push('List at least one size.');
  if (colors.length * sizes.length > 2000) errors.push('That is more than 2,000 color/size combinations.');
  if (Number.isNaN(reorderAt)) errors.push('"Reorder at" must be a whole number.');
  if (Number.isNaN(reorderQty)) errors.push('"Order quantity" must be a whole number.');
  if (Number.isNaN(cost)) errors.push('Cost must be a price like 3.25.');
  if (link && !/^https?:\/\/\S+$/i.test(link)) errors.push('The supplier link must start with https://');
  if (errors.length) return { errors };

  const metafields = [];
  const mf = (key, type, value) => value != null && value !== '' && metafields.push({ namespace: 'custom', key, type, value: String(value) });
  mf('supplier', 'single_line_text_field', String(form.supplier || '').trim());
  mf('reorder_url', 'url', link);
  mf('reorder_at', 'number_integer', reorderAt);
  mf('reorder_qty', 'number_integer', reorderQty);

  const variants = [];
  for (const color of colors) {
    for (const size of sizes) {
      variants.push({
        optionValues: [{ optionName: 'Color', name: color }, { optionName: 'Size', name: size }],
        price: '0.00',
        inventoryPolicy: 'DENY',
        inventoryItem: { tracked: true, ...(cost ? { cost } : {}) },
      });
    }
  }
  return {
    input: {
      title,
      status: 'ACTIVE',
      vendor: String(form.brand || '').trim() || undefined,
      productType: 'Blank',
      tags: ['blank'],
      descriptionHtml: '<p>Blank Sync blank: holds the stock for every design printed on this shirt. Not for sale on its own.</p>',
      productOptions: [
        { name: 'Color', values: colors.map((name) => ({ name })) },
        { name: 'Size', values: sizes.map((name) => ({ name })) },
      ],
      variants,
      metafields,
    },
  };
}

export async function createBlank(form, gql = graphql) {
  const built = buildBlankInput(form);
  if (built.errors) return built;
  const existing = (await listProducts(gql)).find((p) => p.title.toLowerCase() === built.input.title.toLowerCase());
  if (existing) return { errors: [`A product named "${existing.title}" already exists.`] };
  if (config.dryRun) return { dryRun: true, title: built.input.title, variants: built.input.variants.length };
  const r = (await gql(PRODUCT_SET, { input: built.input })).productSet;
  if (r.userErrors.length) return { errors: r.userErrors.map((e) => e.message) };
  const out = { blank: r.product, variants: built.input.variants.length };
  if (form.template) out.template = await createTemplate(r.product.id, { gql });
  return out;
}

/** Colors (and sizes, when the supplier lists them) from a supplier's Shopify product link. */
export async function colorsFromLink(link, fetchImpl = fetch) {
  const colors = await supplierColors(plainProductLink(link), fetchImpl);
  return colors || [];
}

/** Blanks that have no template yet, for the "make a template" buttons. */
export async function blanksWithoutTemplate(gql = graphql) {
  const products = await listProducts(gql);
  const titles = new Set(products.map((p) => p.title));
  return products.filter(
    (p) => (p.isBlank || /inventory/i.test(p.title)) && !p.isDesign && !p.title.startsWith('TEMPLATE') && !titles.has(templateTitle(p.title)),
  );
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const admin = (id) => `https://admin.shopify.com/store/${config.shop}/products/${String(id).split('/').pop()}`;

export function renderAddBlankPage({ key, form = {}, result = null, blanks = [] }) {
  const f = { sizes: DEFAULT_SIZES, template: true, ...form };
  let banner = '';
  if (result?.errors) banner = `<div class="msg bad"><b>Nothing was created.</b><ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  else if (result?.dryRun) banner = `<div class="msg">Dry run: would create ${esc(result.title)} with ${result.variants} colors/sizes.</div>`;
  else if (result?.blank) {
    banner = `<div class="msg ok"><b>Created <a href="${esc(admin(result.blank.id))}" target="_blank">${esc(result.blank.title)}</a></b> with ${result.variants} colors/sizes, all at 0. Count your shirts and enter the numbers in Shopify.`;
    if (result.template?.product?.id) banner += `<br>Design template: <a href="${esc(admin(result.template.product.id))}" target="_blank">${esc(result.template.product.title)}</a>. Duplicate it for each new design.`;
    banner += '</div>';
  } else if (result?.templateOnly) {
    const t = result.templateOnly;
    banner = `<div class="msg ok">${t.existed ? 'Already there' : 'Created'}: <a href="${esc(admin(t.product.id))}" target="_blank">${esc(t.product.title)}</a></div>`;
  }
  const action = `?key=${esc(key)}`;
  const templates = blanks.length
    ? `<h2>Blanks without a design template</h2><ul class="list">${blanks
        .map((b) => `<li><span>${esc(b.title)}</span><form method="post" action="/add-blank/template${action}"><input type="hidden" name="id" value="${esc(b.id)}"><button>Make template</button></form></li>`)
        .join('')}</ul>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add a blank</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:#d9d9d9;--accent:#0a6c4a;--warn:#b42318;--okbg:#e8f5ef;--badbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#a0a0a0;--line:#3a3a3a;--accent:#3fbf8f;--warn:#ff7a6e;--okbg:#12291f;--badbg:#2e1513}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0 4px}h2{font-size:17px;margin:28px 0 8px}
.v{color:var(--muted);font-size:13px}
label{display:block;margin:14px 0 4px;font-weight:600}
input[type=text],input[type=url],input[type=number],textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:84px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
button{padding:10px 16px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.sec{background:transparent;color:var(--accent);border:1px solid var(--accent);padding:6px 10px;font-size:13px}
.check{display:flex;gap:8px;align-items:center;margin-top:16px;font-weight:400}
.msg{padding:12px;border-radius:8px;margin:12px 0;border:1px solid var(--line)}.ok{background:var(--okbg)}.bad{background:var(--badbg)}
.msg ul{margin:6px 0 0;padding-left:20px}a{color:var(--accent)}
.list{list-style:none;padding:0}.list li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}
.list form{margin:0}
</style></head>
<body><main>
<h1>Add a blank</h1>
<div class="v">Creates the blank product in Shopify with every color and size, ready for Blank Sync and the reorder list.</div>
${banner}
<form method="post" action="/add-blank${action}">
<label for="title">Blank name</label>
<input type="text" id="title" name="title" required placeholder="Gildan 64000 Inventory" value="${esc(f.title)}">
<div class="v">Put the style number in the name (like G640). Designs can then link with the tag blank:G640.</div>
<div class="row">
<div><label for="brand">Brand</label><input type="text" id="brand" name="brand" placeholder="Gildan" value="${esc(f.brand)}"></div>
<div><label for="supplier">Supplier</label><input type="text" id="supplier" name="supplier" placeholder="Ninja Blanks" value="${esc(f.supplier)}"></div>
</div>
<label for="reorderUrl">Supplier link</label>
<input type="url" id="reorderUrl" name="reorderUrl" placeholder="https://..." value="${esc(f.reorderUrl)}">
<button type="button" class="sec" id="load" style="margin-top:8px">Get colors from this link</button> <span class="v" id="loadmsg"></span>
<label for="colors">Colors</label>
<textarea id="colors" name="colors" placeholder="Black, White, Royal, Sport Grey">${esc(f.colors)}</textarea>
<div class="v">Separate with commas or new lines. Use the same names your designs use.</div>
<label for="sizes">Sizes</label>
<input type="text" id="sizes" name="sizes" value="${esc(f.sizes)}">
<div class="row">
<div><label for="reorderAt">Reorder at</label><input type="number" min="0" id="reorderAt" name="reorderAt" placeholder="3" value="${esc(f.reorderAt)}"></div>
<div><label for="reorderQty">Order quantity</label><input type="number" min="0" id="reorderQty" name="reorderQty" placeholder="12" value="${esc(f.reorderQty)}"></div>
</div>
<div class="v">Each color/size is reordered when it falls to "Reorder at". You can change single sizes later in Shopify.</div>
<label for="cost">Cost per shirt (optional)</label>
<input type="text" id="cost" name="cost" inputmode="decimal" placeholder="3.25" value="${esc(f.cost)}">
<label class="check"><input type="checkbox" name="template" value="1"${f.template ? ' checked' : ''}> Also make a design template to duplicate</label>
<p><button type="submit">Create blank</button></p>
</form>
${templates}
<script>
document.getElementById('load').onclick = async () => {
  const link = document.getElementById('reorderUrl').value.trim();
  const msg = document.getElementById('loadmsg');
  if (!link) { msg.textContent = 'Paste the supplier link first.'; return; }
  msg.textContent = 'Looking...';
  try {
    const r = await fetch('/add-blank/colors${action}&url=' + encodeURIComponent(link));
    const d = await r.json();
    if (!d.colors || !d.colors.length) { msg.textContent = 'No colors found on that page. Type them in.'; return; }
    document.getElementById('colors').value = d.colors.join(', ');
    msg.textContent = d.colors.length + ' colors found. Remove any you do not stock.';
  } catch (e) { msg.textContent = 'Could not read that page. Type the colors in.'; }
};
</script>
</main></body></html>`;
}
