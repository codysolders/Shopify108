// Prints the private page links. Keep them private: anyone with a link can use that page.
import { config } from '../src/config.js';
import { reorderKey } from '../src/restock.js';
import { addBlankKey } from '../src/addBlank.js';
import { mockupsKey } from '../src/mockups.js';
import { customOrdersKey } from '../src/artUpload.js';

if (!config.clientSecret) {
  console.log('No client secret found. Run this in Cloud Shell from ~/Shopify108/blank-sync.');
  process.exit(1);
}
console.log(`Reorder list:  ${config.appUrl}/reorder?key=${reorderKey()}`);
console.log(`Add a blank:   ${config.appUrl}/add-blank?key=${addBlankKey()}`);
console.log(`Mockups:       ${config.appUrl}/mockups?key=${mockupsKey()}`);
console.log(`Custom orders: ${config.appUrl}/custom-orders?key=${customOrdersKey()}`);
