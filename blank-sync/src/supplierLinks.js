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

const words = (s) => new Set(String(s).split(/[^a-z0-9]+/).filter(Boolean));

/**
 * When names differ slightly ("Heather Cardinal" vs "Heather Cardinal Red", "Purple Heather" vs
 * "Heather Purple"), pick the supplier variant with the same size whose color words all appear in
 * ours, or ours in theirs. Only used when exactly one supplier color qualifies.
 */
export function fuzzyMatch(variants, ours) {
  const color = ours.color;
  if (!color || !variants?.list) return null;
  const mine = words(color);
  const candidates = variants.list.filter((v) => {
    for (const [n, val] of Object.entries(ours)) if (n !== 'color' && v.opts[n] !== val) return false;
    if (!v.opts.color) return false;
    const theirs = words(v.opts.color);
    const subset = (a, b) => [...a].every((w) => b.has(w));
    return subset(mine, theirs) || subset(theirs, mine);
  });
  const colors = new Set(candidates.map((c) => c.opts.color));
  return colors.size === 1 && candidates.length === 1 ? candidates[0].id : null;
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
    if (res.ok) variants = parseShopifyProductJs(await res.json());
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
