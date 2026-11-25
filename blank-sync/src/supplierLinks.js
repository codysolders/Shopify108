// Turns a supplier's product link into a link for the exact color/size, when the supplier
// runs on Shopify (like Ninja Transfers): it reads <product url>.js and adds ?variant=<id>.
import { normName, normValue } from './matching.js';

const cache = new Map(); // product url -> { at, variants: Map(key -> id) | null }
const TTL_MS = 6 * 60 * 60 * 1000;

const keyOf = (pairs) =>
  pairs
    .filter(([n]) => n !== 'title')
    .map(([n, v]) => `${n}=${v}`)
    .sort()
    .join('|');

/** Parse Shopify's public product.js into Map("color=black|size=m" -> variant id). */
export function parseShopifyProductJs(data) {
  const names = (data.options || []).map((o) => normName(typeof o === 'string' ? o : o.name));
  const out = new Map();
  out.list = [];
  for (const v of data.variants || []) {
    const values = v.options || [v.option1, v.option2, v.option3];
    const pairs = names.map((n, i) => [n, normValue(values[i] ?? '')]).filter(([, val]) => val);
    out.set(keyOf(pairs), v.id);
    out.list.push({ id: v.id, opts: Object.fromEntries(pairs) });
  }
  return out;
}

// Common supplier abbreviations, so "Hthr Irish Grn" reads as "heather irish green".
const ABBREV = { hthr: 'heather', hth: 'heather', htr: 'heather', grn: 'green', antiq: 'antique', antque: 'antique', rdnt: 'radiant', blk: 'black', wht: 'white', ryl: 'royal', nvy: 'navy', gry: 'grey', gray: 'grey' };
const words = (s) => new Set(String(s).split(/[^a-z0-9]+/).filter(Boolean).map((w) => ABBREV[w] || w));
const subset = (a, b) => [...a].every((w) => b.has(w));

/**
 * When names differ slightly ("Heather Cardinal" vs "Heather Cardinal Red", "Hthr Irish Green" vs
 * "Heather Irish Green"), pick the supplier color with the same size whose words all appear in ours,
 * or ours in theirs. Heather and non-heather colors never match each other. If several fit, the one
 * sharing the most words wins; a tie means no guess.
 */
export function fuzzyMatch(variants, ours) {
  const color = ours.color;
  if (!color || !variants?.list) return null;
  const mine = words(color);
  const scored = [];
  for (const v of variants.list) {
    let sameRest = true;
    for (const [n, val] of Object.entries(ours)) if (n !== 'color' && v.opts[n] !== val) sameRest = false;
    if (!sameRest || !v.opts.color) continue;
    const theirs = words(v.opts.color);
    if (mine.has('heather') !== theirs.has('heather')) continue;
    if (!subset(mine, theirs) && !subset(theirs, mine)) continue;
    scored.push({ id: v.id, score: [...mine].filter((w) => theirs.has(w)).length });
  }
  if (!scored.length) return null;
  const best = Math.max(...scored.map((c) => c.score));
  const top = scored.filter((c) => c.score === best);
  return top.length === 1 ? top[0].id : null;
}

/** Variants from the product page's own HTML (themes embed every variant; product.js caps at 250). */
export function parseVariantsFromHtml(html, names) {
  const out = [];
  const re = /"id":(\d+),"title":"(?:[^"\\]|\\.)*","option1":"((?:[^"\\]|\\.)*)","option2":(?:"((?:[^"\\]|\\.)*)"|null),"option3":(?:"((?:[^"\\]|\\.)*)"|null)/g;
  const unesc = (x) => (x == null ? '' : JSON.parse(`"${x}"`));
  for (const m of html.matchAll(re)) {
    const values = [unesc(m[2]), unesc(m[3]), unesc(m[4])];
    const pairs = names.map((n, i) => [n, normValue(values[i] ?? '')]).filter(([, val]) => val);
    out.push({ id: Number(m[1]), pairs });
  }
  return out;
}

/** The supplier's product page with no color picked. */
export function plainProductLink(link) {
  const urls = productJsUrl(link);
  return urls ? urls.base : link;
}

function productJsUrl(link) {
  try {
    const u = new URL(link);
    const m = u.pathname.match(/^(.*\/products\/[^/]+)\/?$/);
    if (!m) return null;
    return { base: `${u.origin}${m[1]}`, js: `${u.origin}${m[1]}.js` };
  } catch {
    return null;
  }
}

async function supplierVariants(link, fetchImpl) {
  const urls = productJsUrl(link);
  if (!urls) return null;
  const hit = cache.get(urls.js);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  let variants = null;
  try {
    const res = await fetchImpl(urls.js, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      variants = parseShopifyProductJs(data);
      // product.js lists at most 250 variants; read the rest from the product page.
      try {
        const page = await fetchImpl(urls.base, { signal: AbortSignal.timeout(8000) });
        if (page.ok) {
          const names = (data.options || []).map((o) => normName(typeof o === 'string' ? o : o.name));
          for (const v of parseVariantsFromHtml(await page.text(), names)) {
            const key = keyOf(v.pairs);
            if (variants.has(key)) continue;
            variants.set(key, v.id);
            variants.list.push({ id: v.id, opts: Object.fromEntries(v.pairs) });
          }
        }
      } catch {
        // page unreadable: product.js variants are still used
      }
    }
  } catch {
    variants = null; // not a Shopify store, or unreachable: keep the plain link
  }
  const entry = { at: Date.now(), base: urls.base, variants };
  cache.set(urls.js, entry);
  return entry;
}

/**
 * link: the blank's Reorder link. selectedOptions: the blank variant's options (Color, Size).
 * Returns a link to that exact color/size when the supplier has it, else the original link.
 */
export async function exactSupplierLink(link, selectedOptions, fetchImpl = fetch) {
  if (!link) return link;
  const s = await supplierVariants(link, fetchImpl);
  if (!s?.variants) return link;
  const pairs = (selectedOptions || []).map((o) => [normName(o.name), normValue(o.value)]).filter(([n]) => n !== 'title');
  const id = s.variants.get(keyOf(pairs)) ?? fuzzyMatch(s.variants, Object.fromEntries(pairs));
  // No match: open the product with no color picked, never a different color.
  return id ? `${s.base}?variant=${id}` : s.base;
}

/** For troubleshooting: the supplier's colors, as the app reads them. */
export async function supplierColors(link, fetchImpl = fetch) {
  const s = await supplierVariants(link, fetchImpl);
  if (!s?.variants) return null;
  return [...new Set(s.variants.list.map((v) => v.opts.color).filter(Boolean))].sort();
}

export function clearSupplierCache() {
  cache.clear();
}
