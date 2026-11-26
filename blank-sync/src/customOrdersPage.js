// HTML for the private Custom orders page: recent orders with the customer's art.
import { config } from './config.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isImage = (url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
const small = (url, w = 300) => (url.includes('cdn.shopify.com') ? `${url}${url.includes('?') ? '&' : '?'}width=${w}` : url);
const orderAdmin = (id) => `https://admin.shopify.com/store/${config.shop}/orders/${String(id).split('/').pop()}`;
const fileExt = (url) => (url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toUpperCase() || 'FILE';

const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:#d9d9d9;--accent:#0a6c4a;--warn:#b42318;--tile:#f4f4f4;--badbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#a0a0a0;--line:#3a3a3a;--accent:#3fbf8f;--warn:#ff7a6e;--tile:#222;--badbg:#2e1513}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0 4px}.v{color:var(--muted);font-size:13px}a{color:var(--accent)}
.order{border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}
.top{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}.top b{font-size:16px}
.line{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);margin-top:10px;flex-wrap:wrap}
.line .grow{flex:1;min-width:180px}
.art{display:flex;gap:10px;flex-wrap:wrap}
.art a.f{display:flex;flex-direction:column;align-items:center;gap:4px;text-decoration:none;font-size:12px}
.art img,.art .doc{width:110px;height:110px;object-fit:contain;border-radius:6px;background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/12px 12px}
.art .doc{display:flex;align-items:center;justify-content:center;background:var(--tile);color:var(--fg);font-weight:700}
.lost{background:var(--badbg);border-radius:6px;padding:8px;font-size:13px}
.note{font-size:13px;margin-top:4px;white-space:pre-wrap}
.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px}
`;

export function renderCustomOrdersPage({ orders, days }) {
  const cards = orders.map((o) => {
    const status = o.cancelledAt ? 'Cancelled' : String(o.displayFulfillmentStatus || '').replace(/_/g, ' ').toLowerCase();
    const lines = o.lines.map((li) => `
      <div class="line">
        <div class="grow"><b>${esc(li.title)}</b><div>${esc(li.variantTitle || '')}</div><div class="v">Qty ${li.quantity}</div>
          ${(li.notes || []).map((n) => `<div class="note"><b>${esc(n.key)}:</b> ${esc(n.value)}</div>`).join('')}</div>
        <div class="art">
          ${li.art.map((a) => `<a class="f" href="${esc(a.url)}" target="_blank" rel="noopener" download>
            ${isImage(a.url) ? `<img src="${esc(small(a.url))}" alt="">` : `<span class="doc">${esc(fileExt(a.url))}</span>`}
            <span>Download${a.name ? `: ${esc(a.name.slice(0, 28))}` : ''}</span></a>`).join('')}
          ${li.lost.length ? `<div class="lost">The old upload button lost this file (${esc(li.lost.join(', '))}). Ask the customer to email it.</div>` : ''}
        </div>
      </div>`).join('');
    return `<div class="order"><div class="top"><b><a href="${orderAdmin(o.id)}" target="_blank" rel="noopener">${esc(o.name)}</a></b>
      <span class="v">${esc(new Date(o.createdAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }))}</span>
      ${status ? `<span class="tag">${esc(status)}</span>` : ''}</div>${lines}</div>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Custom orders</title><style>${STYLE}</style></head>
<body><main>
<h1>Custom orders</h1>
<div class="v">Orders from the last ${days} days where the customer uploaded their own art. Newest first. Click a picture to download the file.
In Shopify admin these orders are tagged <b>custom-art</b>.</div>
${cards || '<p>No orders with uploaded art yet.</p>'}
</main></body></html>`;
}
