// Pure logic for matching design variants to blank variants by option values (Color, Size, ...).

const OPTION_ALIASES = { colour: 'color' };

const VALUE_ALIASES = {
  'x-small': 'xs', 'extra small': 'xs', xsmall: 'xs',
  small: 's', sm: 's',
  medium: 'm', med: 'm',
  large: 'l', lg: 'l',
  'x-large': 'xl', 'extra large': 'xl', xlarge: 'xl',
  xxl: '2xl', '2x': '2xl', 'xx-large': '2xl', '2x-large': '2xl',
  xxxl: '3xl', '3x': '3xl', 'xxx-large': '3xl', '3x-large': '3xl',
  xxxxl: '4xl', '4x': '4xl', '4x-large': '4xl',
  xxxxxl: '5xl', '5x': '5xl',
  gray: 'grey', 'sport gray': 'sport grey',
};

export function normName(name) {
  const n = String(name).trim().toLowerCase();
  return OPTION_ALIASES[n] || n;
}

export function normValue(value) {
  let v = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  if (VALUE_ALIASES[v]) return VALUE_ALIASES[v];
  // "Heather Gray" -> "heather grey" so gray/grey spelling never breaks a match
  v = v.replace(/\bgray\b/g, 'grey');
  return v;
}

function optionMap(selectedOptions) {
  const m = new Map();
  for (const o of selectedOptions || []) m.set(normName(o.name), normValue(o.value));
  return m;
}

// The option names that identify a blank variant, e.g. ["color", "size"].
export function blankOptionNames(blankVariants) {
  const names = new Set();
  for (const v of blankVariants) for (const o of v.selectedOptions || []) names.add(normName(o.name));
  names.delete('title'); // "Default Title" products
  return [...names].sort();
}

export function variantKey(selectedOptions, names) {
  const m = optionMap(selectedOptions);
  const parts = [];
  for (const n of names) {
    if (!m.has(n)) return null;
    parts.push(`${n}=${m.get(n)}`);
  }
  return parts.join('|');
}

/**
 * Build the mapping for one design product.
 * blank: { id, variants: [{ id, selectedOptions, inventoryItemId }] }
 * design: { id, title, variants: [{ id, selectedOptions, inventoryItemId, blankVariantOverride? }] }
 * Returns { matches: [{ designVariant, blankVariant }], unmatched: [{ designVariant, reason }] }
 */
export function matchDesignToBlank(design, blank, allBlankVariantsById = new Map()) {
  const names = blankOptionNames(blank.variants);
  const byKey = new Map();
  for (const bv of blank.variants) {
    const k = variantKey(bv.selectedOptions, names);
    if (k) byKey.set(k, bv);
  }
  const matches = [];
  const unmatched = [];
  for (const dv of design.variants) {
    if (dv.blankVariantOverride) {
      const bv = allBlankVariantsById.get(dv.blankVariantOverride) ||
        blank.variants.find((b) => b.id === dv.blankVariantOverride);
      if (bv) matches.push({ designVariant: dv, blankVariant: bv });
      else unmatched.push({ designVariant: dv, reason: 'blank variant override not found' });
      continue;
    }
    const k = variantKey(dv.selectedOptions, names);
    if (!k) {
      unmatched.push({ designVariant: dv, reason: `design is missing option(s): ${names.join(', ')}` });
      continue;
    }
    const bv = byKey.get(k);
    if (bv) matches.push({ designVariant: dv, blankVariant: bv });
    else unmatched.push({ designVariant: dv, reason: `no blank variant for ${k}` });
  }
  return { matches, unmatched };
}

/**
 * Turn matches for many designs into the lookups the app uses.
 */
export function buildIndex(entries) {
  const designVariantToBlank = new Map(); // design variant id -> blank variant
  const blankItemToDesignItems = new Map(); // blank inventory item id -> Set(design inventory item ids)
  const blankItemToVariant = new Map(); // blank inventory item id -> blank variant
  const unmatched = [];
  for (const { design, result } of entries) {
    for (const { designVariant, blankVariant } of result.matches) {
      designVariantToBlank.set(designVariant.id, blankVariant);
      blankItemToVariant.set(blankVariant.inventoryItemId, blankVariant);
      if (!blankItemToDesignItems.has(blankVariant.inventoryItemId)) {
        blankItemToDesignItems.set(blankVariant.inventoryItemId, new Set());
      }
      blankItemToDesignItems.get(blankVariant.inventoryItemId).add(designVariant.inventoryItemId);
    }
    for (const u of result.unmatched) unmatched.push({ design: design.title, ...u });
  }
  return { designVariantToBlank, blankItemToDesignItems, blankItemToVariant, unmatched };
}
