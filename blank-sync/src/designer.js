// Tee designer: a store product where the customer picks a color and size, uploads their art, and
// moves and sizes it on a live preview of their shirt color. The theme loads /tee-designer.js on
// products tagged "Designer". The art goes to Shopify Files (same as the upload box), and the cart
// line gets the art link, the print size, the placement, and a Mockup link that this app draws on
// demand (art on the blank photo of that color), so the printers see exactly what was ordered.
import { config } from './config.js';
import { graphql, gid } from './shopify.js';
import { cleanPlace, colorOption, designOption, colorKey, isMockup, parseJson, fetchImage, composeMockup, trimArt } from './mockups.js';

export const DESIGNER_TAG = 'Designer';
export const MOCKUP_PROPERTY = 'Mockup';
export const PLACE_PROPERTY = '_Placement';
// Where art can go on a flat front photo of an adult tee: 12 in wide x 14 in tall, a little below
// the collar. Staff can change it per product on the Mockups page (Save placement).
export const PRINT_AREA = { x: 0.5, y: 0.22, w: 0.36, h: 0.34 };
export const PRINT_WIDTH_IN = 12;
// A Design value like "Your art" means the shopper uploads; any other value is a ready-made design.
export const isUploadDesign = (value) => /your\s*(own\s*)?(art|design|file|logo)|upload|custom/i.test(String(value || ''));

const log = (...a) => console.log(new Date().toISOString(), ...a);

const PRODUCT = `
query P($id: ID!) {
  product(id: $id) {
    id title tags
    options { name values }
    place: metafield(namespace: "custom", key: "mockup_place") { value }
    variants(first: 250) { nodes { id selectedOptions { name value } media(first: 1) { nodes { alt ... on MediaImage { image { url width height } } } } } }
    blank: metafield(namespace: "custom", key: "blank_product") {
      reference { ... on Product {
        options { name values }
        variants(first: 250) { nodes { selectedOptions { name value } media(first: 1) { nodes { alt ... on MediaImage { image { url width height } } } } } }
      } }
    }
  }
}`;

/** Pure: one photo per color: the design's own variant photo first, then the linked blank's. */
export function photosByColor(product) {
  const out = {};
  const add = (variants, optName) => {
    for (const v of variants || []) {
      const color = v.selectedOptions.find((o) => o.name === optName)?.value;
      const m = v.media?.nodes?.[0];
      if (!color || !m?.image?.url || isMockup(m)) continue;
      const k = colorKey(color);
      if (!out[k]) out[k] = { url: m.image.url, width: m.image.width, height: m.image.height };
    }
  };
  const own = colorOption(product.options)?.name;
  if (own) add(product.variants?.nodes, own);
  const blank = product.blank?.reference;
  const blankOpt = blank && colorOption(blank.options)?.name;
  if (blankOpt) add(blank.variants?.nodes, blankOpt);
  return out;
}

const cache = new Map(); // product gid -> { at, data }

/** What the designer script needs for one product, or null if it isn't a Designer product. */
export async function designerProduct(id, gql = graphql) {
  const pid = /^\d+$/.test(String(id)) ? gid('Product', id) : String(id);
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(pid)) return null;
  const hit = cache.get(pid);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  const p = (await gql(PRODUCT, { id: pid })).product;
  let data = null;
  if (p && p.tags.some((t) => t.toLowerCase() === DESIGNER_TAG.toLowerCase())) {
    const byKey = photosByColor(p);
    const photos = {};
    for (const c of colorOption(p.options)?.values || []) if (byKey[colorKey(c)]) photos[c] = byKey[colorKey(c)];
    const optName = colorOption(p.options)?.name;
    const designName = designOption(p.options)?.name;
    const variants = {};
    const ready = [];
    for (const v of p.variants?.nodes || []) {
      const id = v.id.split('/').pop();
      const c = v.selectedOptions.find((o) => o.name === optName)?.value;
      if (c) variants[id] = c;
      const d = designName && v.selectedOptions.find((o) => o.name === designName)?.value;
      if (d && !isUploadDesign(d)) ready.push(id);
    }
    data = {
      colorOption: optName || 'Color',
      photos,
      variants,
      ready,
      area: cleanPlace(parseJson(p.place?.value, PRINT_AREA)),
      printWidthIn: PRINT_WIDTH_IN,
    };
  }
  if (cache.size > 200) cache.clear();
  cache.set(pid, { at: Date.now(), data });
  return data;
}

export const clearDesignerCache = () => cache.clear();

// ---------- Mockup pictures, drawn on request ----------

const SHOPIFY_CDN = /^https:\/\/cdn\.shopify\.com\/s\/files\//;

/**
 * Pure: check a mockup request. Only Shopify-hosted pictures, and the art must be a customer upload
 * (PNG or JPG), so nobody can use the app to draw other pictures. Returns { art, photo, place } or null.
 */
export function mockupRequest(params) {
  const art = String(params.get('art') || '');
  const photo = String(params.get('photo') || '');
  if (!SHOPIFY_CDN.test(art) || !SHOPIFY_CDN.test(photo)) return null;
  const artFile = decodeURIComponent(art.split('?')[0].split('/').pop() || '');
  if (!/^customer-art-.+\.(png|jpe?g)$/i.test(artFile)) return null;
  if (!/\.(png|jpe?g|webp)$/i.test(photo.split('?')[0])) return null;
  const nums = ['x', 'y', 'w', 'h'].map((k) => Number(params.get(k)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums;
  return { art, photo, place: cleanPlace({ x, y, w, h }) };
}

/** Pure: the link to the mockup for an art, photo and placement (what goes on the order). */
export function mockupUrl({ art, photo, place }, appUrl = config.appUrl) {
  const q = new URLSearchParams({ art, photo });
  for (const k of ['x', 'y', 'w', 'h']) q.set(k, Number(place[k]).toFixed(4));
  return `${appUrl}/mockup.jpg?${q}`;
}

const drawn = new Map(); // url -> jpeg, a few recent ones
export async function drawMockup({ art, photo, place }, fetchImpl = fetch) {
  const key = JSON.stringify([art, photo, place]);
  if (drawn.has(key)) return drawn.get(key);
  const [photoBuf, artBuf] = await Promise.all([fetchImage(photo, fetchImpl), fetchImage(art, fetchImpl)]);
  // Place is the art's own box (the script sends it with the art's shape), so the art fills it.
  const jpg = await composeMockup(photoBuf, await trimArt(artBuf), place);
  if (drawn.size >= 20) drawn.delete(drawn.keys().next().value);
  drawn.set(key, jpg);
  log(`mockup drawn: ${art.split('/').pop().split('?')[0]}`);
  return jpg;
}

/** Pure: the Mockup link on an order line, if the designer put one there. */
export const mockupOnLine = (attrs = []) => attrs.find((a) => a.key === MOCKUP_PROPERTY && /^https:\/\//.test(a.value || ''))?.value || null;

// ---------- the browser script ----------

import fs from 'node:fs';

const CLIENT = fs.readFileSync(new URL('./teeDesigner.client.js', import.meta.url), 'utf8');
export const designerScript = (appUrl = config.appUrl) => `(function (S) {\n${CLIENT}\n})(${JSON.stringify({ appUrl })});\n`;
