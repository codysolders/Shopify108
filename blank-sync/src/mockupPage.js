// HTML for the private Mockups pages.
import { config } from './config.js';
import { PRESETS, DEFAULT_DESIGN, designOption, colorOption, colorKey, isMockup, planMockups } from './mockups.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const admin = (id) => `https://admin.shopify.com/store/${config.shop}/products/${String(id).split('/').pop()}`;
const small = (url, w = 400) => (url && url.includes('cdn.shopify.com') ? `${url}${url.includes('?') ? '&' : '?'}width=${w}` : url || '');

const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:#d9d9d9;--accent:#0a6c4a;--warn:#b42318;--okbg:#e8f5ef;--badbg:#fdecea;--tile:#f4f4f4}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#a0a0a0;--line:#3a3a3a;--accent:#3fbf8f;--warn:#ff7a6e;--okbg:#12291f;--badbg:#2e1513;--tile:#222}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0 4px}h2{font-size:17px;margin:28px 0 8px}
.v{color:var(--muted);font-size:13px}a{color:var(--accent)}
button,.btn{padding:9px 14px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
button.sec{background:transparent;color:var(--accent);border:1px solid var(--accent);padding:6px 10px;font-size:13px}
button:disabled{opacity:.5;cursor:default}
.msg{padding:12px;border-radius:8px;margin:12px 0;border:1px solid var(--line)}.ok{background:var(--okbg)}.bad{background:var(--badbg)}
.list{list-style:none;padding:0;margin:0}.list li{display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
.list img{width:56px;height:56px;object-fit:cover;border-radius:6px;background:var(--tile)}
.list .grow{flex:1;min-width:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.tile{position:relative;background:var(--tile);border-radius:8px;overflow:hidden}
.tile>img{display:block;width:100%;height:auto}
.box{position:absolute;outline:1px dashed transparent}
.show-box .box{outline-color:#e0457b}
.box img{width:100%;height:100%;object-fit:contain;object-position:top center;display:block}
.cap{font-size:12px;padding:4px 6px;color:var(--muted)}
.sliders{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px 16px;margin:8px 0}
.sliders label{font-size:13px;display:block}
input[type=range]{width:100%}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.card{border:1px solid var(--line);border-radius:8px;padding:12px;margin:8px 0}
.art{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.art img{width:72px;height:72px;object-fit:contain;background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/12px 12px;border-radius:6px}
select,input[type=file]{font:inherit;max-width:100%}
code{font:13px ui-monospace,monospace}
#log{white-space:pre-wrap;font:13px ui-monospace,monospace}
`;

function shell(title, body, script = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

const banner = (msg, bad) => (msg ? `<div class="msg ${bad ? 'bad' : 'ok'}">${esc(msg)}</div>` : '');

/** Home: pick a group of design products by tag. */
export function renderMockupHome({ key, tags, msg }) {
  const k = encodeURIComponent(key);
  const body = `
<h1>Mockups</h1>
<div class="v">Put each design's art on the photo of every blank color, and show it on the matching variants.</div>
${banner(msg)}
<h2>Pick a group</h2>
<ul class="list">${tags.map((t) => `<li><span class="grow"><a href="/mockups?key=${k}&tag=${encodeURIComponent(t.tag)}">${esc(t.tag)}</a></span><span class="v">${t.count} product${t.count === 1 ? '' : 's'}</span></li>`).join('') || '<li>No tagged products found.</li>'}</ul>`;
  return shell('Mockups', body);
}

/** One group (a tag): upload each design's art once for every product, then make all mockups. */
export function renderMockupGroup({ key, tag, products, msg, bad }) {
  const k = encodeURIComponent(key);
  const designs = [...new Set(products.flatMap((p) => p.designs))];
  const artFor = (d) => products.map((p) => p.art[d]).find(Boolean);
  const back = `/mockups?key=${k}&tag=${encodeURIComponent(tag)}`;
  const artCards = designs
    .map((d) => {
      const url = artFor(d);
      const have = products.filter((p) => p.designs.includes(d));
      const missing = have.filter((p) => !p.art[d]).length;
      return `<div class="card art">
  ${url ? `<img src="${esc(small(url, 200))}" alt="">` : '<div class="v" style="width:72px">No art</div>'}
  <div class="grow" style="flex:1;min-width:200px"><b>${esc(d)}</b><div class="v">${have.length} product${have.length === 1 ? '' : 's'}${missing ? `, ${missing} without art` : ''}</div>
  <form method="post" enctype="multipart/form-data" action="/mockups/art?key=${k}" class="row">
    <input type="hidden" name="tag" value="${esc(tag)}"><input type="hidden" name="design" value="${esc(d)}"><input type="hidden" name="back" value="${esc(back)}">
    <input type="file" name="art" accept="image/png,image/jpeg,image/webp" required>
    <button>Upload for all ${have.length}</button>
  </form></div></div>`;
    })
    .join('');
  const rows = products
    .map((p) => {
      const total = p.designs.length * p.colors.length;
      return `<li data-id="${esc(p.id)}" data-designs="${esc(JSON.stringify(p.designs))}">
  ${p.image ? `<img src="${esc(small(p.image, 120))}" alt="">` : '<img alt="">'}
  <span class="grow"><a href="/mockups/product?key=${k}&id=${encodeURIComponent(p.id)}&tag=${encodeURIComponent(tag)}">${esc(p.title)}</a>
  <div class="v">${esc(p.status.toLowerCase())} · ${p.designs.length} design${p.designs.length === 1 ? '' : 's'} × ${p.colors.length} color${p.colors.length === 1 ? '' : 's'} · <span class="st">${p.madeCount} of ${total} mockups made</span></div></span>
</li>`;
    })
    .join('');
  const body = `
<div class="v"><a href="/mockups?key=${k}">All groups</a></div>
<h1>Mockups: ${esc(tag)}</h1>
${banner(msg, bad)}
<h2>1. Art for each design</h2>
<div class="v">Upload a PNG with a see-through background. It is used on every product in this group that has that design. Art with a white background will show a white box.</div>
${artCards}
<h2>2. Check where the art sits</h2>
<div class="v">Open a product to see every color and move the art. Shirts start centered on the chest, hats on the front, pants on the left leg, polos and quarter-zips on the left chest.</div>
<h2>3. Make the mockups</h2>
<div class="row"><button id="all">Make missing mockups for all ${products.length}</button><span class="v">Takes about a minute per product. Keep this page open.</span></div>
<div id="log" class="v"></div>
<ul class="list">${rows}</ul>`;
  return shell(`Mockups: ${tag}`, body, runnerScript(k));
}

function runnerScript(k) {
  return `
async function make(id, design, force) {
  const r = await fetch('/mockups/make?key=${k}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, design, force }) });
  const d = await r.json().catch(() => ({ error: 'The app did not answer. Try again.' }));
  if (!r.ok || d.error) throw new Error(d.error || 'Something went wrong.');
  return d;
}
const logEl = document.getElementById('log');
const say = (t) => { if (logEl) logEl.textContent += t + '\\n'; };
const allBtn = document.getElementById('all');
if (allBtn) allBtn.onclick = async () => {
  allBtn.disabled = true; logEl.textContent = '';
  for (const li of document.querySelectorAll('li[data-id]')) {
    const name = li.querySelector('a').textContent;
    let made = 0, missing = new Set();
    try {
      for (const design of JSON.parse(li.dataset.designs)) {
        const d = await make(li.dataset.id, design, false);
        made += d.made || d.wouldMake || 0;
        (d.missing || []).forEach((m) => missing.add(m.design ? m.design + ' (' + m.reason + ')' : m.reason));
      }
      say(name + ': ' + made + ' made' + (missing.size ? '. Skipped: ' + [...missing].slice(0, 4).join(', ') : ''));
    } catch (e) { say(name + ': ' + e.message); }
  }
  say('Done. Reload to see the counts.');
  allBtn.disabled = false;
};
document.querySelectorAll('button[data-make]').forEach((b) => b.onclick = async () => {
  const id = b.dataset.id, force = b.dataset.force === '1';
  const designs = JSON.parse(b.dataset.make);
  document.querySelectorAll('button[data-make]').forEach((x) => x.disabled = true);
  logEl.textContent = '';
  for (const design of designs) {
    try {
      say(design + ': working...');
      const d = await make(id, design, force);
      say(design + ': ' + (d.dryRun ? 'dry run, would make ' + d.wouldMake : (d.made || 0) + ' made') + ((d.missing || []).length ? '. Skipped: ' + d.missing.map((m) => (m.color || '') + ' ' + m.reason).join(', ') : ''));
    } catch (e) { say(design + ': ' + e.message); }
  }
  say('Done. Reload to see them.');
  document.querySelectorAll('button[data-make]').forEach((x) => x.disabled = false);
});`;
}

/** One product: preview every design on every color, move the art, pick photos, make mockups. */
export function renderMockupProduct({ key, product: p, tag = '', msg, bad }) {
  const k = encodeURIComponent(key);
  const dOpt = designOption(p.options);
  const cOpt = colorOption(p.options);
  const designs = dOpt ? dOpt.values : [DEFAULT_DESIGN];
  const colors = cOpt?.values || [];
  const back = `/mockups/product?key=${k}&id=${encodeURIComponent(p.id)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;
  const pl = p.place;
  const boxStyle = `left:${((pl.x - pl.w / 2) * 100).toFixed(2)}%;top:${(pl.y * 100).toFixed(2)}%;width:${(pl.w * 100).toFixed(2)}%;height:${(pl.h * 100).toFixed(2)}%`;
  const plan = planMockups(p);
  const pending = new Set(plan.jobs.map((j) => j.key));
  const art = (d) => p.art[d] || (!dOpt ? p.art[DEFAULT_DESIGN] : null);
  const firstArt = designs.map(art).find(Boolean);

  const previews = designs
    .map((d) => {
      const a = art(d);
      const tiles = colors
        .map((c) => {
          const ph = p.photos[colorKey(c)];
          const made = p.made[`${d}|${colorKey(c)}`];
          const state = !a ? 'no art' : !ph ? 'no photo' : pending.has(`${d}|${colorKey(c)}`) ? (made ? 'needs remake' : 'not made yet') : 'made';
          return `<div><div class="tile">${ph ? `<img src="${esc(small(ph.url, 500))}" alt="${esc(c)}">` : '<div style="aspect-ratio:4/5"></div>'}${a && ph ? `<div class="box" style="${boxStyle}"><img src="${esc(small(a, 600))}" alt=""></div>` : ''}</div><div class="cap">${esc(c)} · ${state}</div></div>`;
        })
        .join('');
      return `<h3 style="font-size:15px;margin:16px 0 6px">${esc(d)}</h3><div class="grid">${tiles}</div>`;
    })
    .join('');

  const plainMedia = p.media.filter((m) => !isMockup(m) && m.url);
  const photoRows = colors
    .map((c) => {
      const ph = p.photos[colorKey(c)];
      const options = plainMedia
        .map((m) => `<option value="${esc(m.url)}"${ph?.url === m.url ? ' selected' : ''}>${esc(m.alt || decodeURIComponent(m.url.split('?')[0].split('/').pop()))}</option>`)
        .join('');
      const from = { saved: 'chosen', variant: 'from its variants', name: 'by file name', blank: 'from the blank product' }[ph?.from] || '';
      return `<li>${ph ? `<img src="${esc(small(ph.url, 120))}" alt="">` : '<img alt="">'}<span class="grow"><b>${esc(c)}</b><div class="v">${ph ? esc(from) : 'No photo found. Add one to the product in Shopify, or pick one here.'}</div></span>
  <form method="post" action="/mockups/photo?key=${k}" class="row"><input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="color" value="${esc(c)}"><input type="hidden" name="back" value="${esc(back)}">
  <select name="url"><option value="">Pick automatically</option>${ph && !plainMedia.some((m) => m.url === ph.url) ? `<option value="${esc(ph.url)}" selected>Current photo</option>` : ''}${options}</select><button class="sec">Use</button></form></li>`;
    })
    .join('');

  const artCards = designs
    .map((d) => {
      const a = art(d);
      return `<div class="card art">${a ? `<img src="${esc(small(a, 200))}" alt="">` : '<div class="v" style="width:72px">No art</div>'}
  <div style="flex:1;min-width:200px"><b>${esc(d)}</b>
  <form method="post" enctype="multipart/form-data" action="/mockups/art?key=${k}" class="row">
    <input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="design" value="${esc(d)}"><input type="hidden" name="back" value="${esc(back)}">
    <input type="file" name="art" accept="image/png,image/jpeg,image/webp" required>
    ${tag ? `<select name="tag"><option value="">This product only</option><option value="${esc(tag)}">Every ${esc(tag)} product with ${esc(d)}</option></select>` : ''}
    <button>Upload</button>
  </form></div></div>`;
    })
    .join('');

  const missingText = plan.missing.length
    ? `<div class="msg bad">Can't make yet: ${esc([...new Set(plan.missing.map((m) => (m.design && m.design !== DEFAULT_DESIGN ? `${m.design} ` : '') + (m.color && m.reason !== 'no art yet' ? `${m.color} ` : '') + m.reason))].slice(0, 8).join('; '))}</div>`
    : '';
  const mockupCount = p.media.filter(isMockup).length;
  const body = `
<div class="v">${tag ? `<a href="/mockups?key=${k}&tag=${encodeURIComponent(tag)}">Back to ${esc(tag)}</a> · ` : `<a href="/mockups?key=${k}">All groups</a> · `}<a href="${esc(admin(p.id))}" target="_blank">Open in Shopify</a></div>
<h1>${esc(p.title)}</h1>
${banner(msg, bad)}
<h2>Preview</h2>
<div class="v">This is how the mockups will look. Move the art with the sliders, then save.</div>
<form method="post" action="/mockups/place?key=${k}" id="placeForm">
<input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="back" value="${esc(back)}">
<div class="row"><b>Start from:</b> <button type="button" class="sec" data-preset="front">Full front</button><button type="button" class="sec" data-preset="chest">Left chest</button><button type="button" class="sec" data-preset="hat">Hat front</button>
<label class="v"><input type="checkbox" id="showBox"> Show print area</label></div>
<div class="sliders">
<label>Across (center) <input type="range" name="x" min="0" max="1" step="0.005" value="${pl.x}"></label>
<label>Down (top of art) <input type="range" name="y" min="0" max="0.95" step="0.005" value="${pl.y}"></label>
<label>Width <input type="range" name="w" min="0.03" max="0.9" step="0.005" value="${pl.w}"></label>
<label>Max height <input type="range" name="h" min="0.03" max="0.9" step="0.005" value="${pl.h}"></label>
</div>
<div class="row"><button>Save placement</button>${p.placeSaved ? '' : '<span class="v">Not saved yet: this is a starting guess.</span>'}</div>
</form>
<div id="previews">${firstArt ? previews : '<div class="msg">Upload art below to see the preview.</div>'}</div>
<h2>Make mockups</h2>
${missingText}
<div class="row">
<button data-make="${esc(JSON.stringify(designs))}" data-id="${esc(p.id)}">Make missing mockups (${plan.jobs.length})</button>
<button class="sec" data-make="${esc(JSON.stringify(designs))}" data-id="${esc(p.id)}" data-force="1">Remake all</button>
</div>
<div class="v">Each mockup is attached to every size of its design and color. Changing art, photos or placement marks them "needs remake".</div>
<div id="log" class="v"></div>
<h2>Art</h2>
${artCards}
<h2>Blank photo for each color</h2>
<ul class="list">${photoRows}</ul>
${mockupCount ? `<h2>Tidy the store page</h2>
<div class="v">Once every color has mockups, you can take the plain blank photos off the product page. They stay in Shopify Files, so mockups can still be remade.</div>
<form method="post" action="/mockups/hide?key=${k}" class="row"><input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="back" value="${esc(back)}"><button class="sec">Hide plain blank photos</button></form>` : ''}`;
  const script = `
const presets = ${JSON.stringify(PRESETS)};
const form = document.getElementById('placeForm');
const val = (n) => Number(form.elements[n].value);
function draw() {
  const x = val('x'), y = val('y'), w = val('w'), h = val('h');
  document.querySelectorAll('.box').forEach((b) => { b.style.left = ((x - w / 2) * 100) + '%'; b.style.top = (y * 100) + '%'; b.style.width = (w * 100) + '%'; b.style.height = (h * 100) + '%'; });
}
form.querySelectorAll('input[type=range]').forEach((r) => r.oninput = draw);
document.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { const p = presets[b.dataset.preset]; for (const n of ['x','y','w','h']) form.elements[n].value = p[n]; draw(); });
document.getElementById('showBox').onchange = (e) => document.getElementById('previews').classList.toggle('show-box', e.target.checked);
${runnerScript(k)}`;
  return shell(`Mockups: ${p.title}`, body, script);
}
