// The script the store's product page loads to show the "Upload your art" box.
// The theme only needs:  <div data-blank-sync-art></div><script src="APP_URL/art-upload.js" defer></script>
import { ART_PROPERTY, ART_NAME_PROPERTY } from './artUpload.js';

export function artUploadScript(appUrl) {
  const settings = JSON.stringify({ appUrl, prop: ART_PROPERTY, nameProp: ART_NAME_PROPERTY });
  return `(function () {
  var S = ${settings};
  var ACCEPT = '.png,.jpg,.jpeg,.pdf,.svg,.ai,.eps,.psd';
  var css = '.bsa{margin:12px 0;padding:14px;border:1px dashed currentColor;border-radius:8px}' +
    '.bsa__t{font-weight:600;margin:0 0 4px}.bsa__h{font-size:.85em;opacity:.75;margin:0 0 10px}' +
    '.bsa__row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}' +
    '.bsa__img{width:72px;height:72px;object-fit:contain;border-radius:6px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px}' +
    '.bsa__s{font-size:.9em}.bsa__s--bad{color:#b42318;font-weight:600}.bsa__s--ok{color:#0a6c4a;font-weight:600}' +
    '.bsa__x{background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font:inherit;color:inherit}' +
    '.bsa input[type=file]{max-width:100%}.bsa [hidden]{display:none!important}';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

  function findForm(box) {
    var section = box.closest('section, .shopify-section') || document;
    return section.querySelector('form[id^="BuyButtons-ProductForm"]') ||
      document.querySelector('product-form-component form, form[action$="/cart/add"]');
  }

  function setup(box) {
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    var required = box.getAttribute('data-required') !== 'false';
    var state = 'empty'; // empty | busy | done
    if (!document.getElementById('bsa-css')) { var st = el('style'); st.id = 'bsa-css'; st.textContent = css; document.head.appendChild(st); }

    box.classList.add('bsa');
    box.appendChild(el('p', 'bsa__t', box.getAttribute('data-title') || 'Upload your art' + (required ? ' *' : '')));
    box.appendChild(el('p', 'bsa__h', box.getAttribute('data-help') ||
      'A PNG with a see-through background prints best. PDF, SVG, AI, EPS, PSD and JPG work too. Up to 25 MB.'));
    var row = el('div', 'bsa__row');
    var input = el('input'); input.type = 'file'; input.accept = ACCEPT;
    var img = el('img', 'bsa__img'); img.alt = ''; img.hidden = true;
    var status = el('span', 'bsa__s');
    var remove = el('button', 'bsa__x', 'Remove'); remove.type = 'button'; remove.hidden = true;
    row.appendChild(input); row.appendChild(img); row.appendChild(status); row.appendChild(remove);
    box.appendChild(row);

    var urlField = el('input'); urlField.type = 'hidden'; urlField.name = 'properties[' + S.prop + ']';
    var nameField = el('input'); nameField.type = 'hidden'; nameField.name = 'properties[' + S.nameProp + ']';
    box.appendChild(urlField); box.appendChild(nameField);
    function link() {
      var form = findForm(box);
      // getAttribute: the form has an input named "id", so form.id is that input, not the form's id.
      var formId = form && form.getAttribute('id');
      if (formId) { urlField.setAttribute('form', formId); nameField.setAttribute('form', formId); }
      // Hidden fields with an empty value are left off the order.
      urlField.disabled = !urlField.value; nameField.disabled = !urlField.value;
    }
    link();
    new MutationObserver(link).observe(document.body, { childList: true, subtree: true });

    function say(text, kind) { status.textContent = text; status.className = 'bsa__s' + (kind ? ' bsa__s--' + kind : ''); }
    function clear() {
      state = 'empty'; urlField.value = ''; nameField.value = ''; input.value = ''; input.hidden = false;
      img.hidden = true; img.removeAttribute('src'); remove.hidden = true; say(''); link();
    }
    remove.addEventListener('click', clear);

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { input.value = ''; return say('That file is over 25 MB. Please email it to us instead.', 'bad'); }
      state = 'busy'; urlField.value = ''; link();
      img.hidden = !/^image\\/(png|jpeg)$/.test(file.type);
      if (!img.hidden) img.src = URL.createObjectURL(file);
      say('Uploading ' + file.name + '...');
      var body = new FormData(); body.append('file', file, file.name);
      fetch(S.appUrl + '/art/upload', { method: 'POST', body: body })
        .then(function (r) { return r.json().catch(function () { return { error: 'Upload failed (' + r.status + ').' }; }); })
        .then(function (d) {
          if (!d || !d.url) throw new Error((d && d.error) || 'Upload failed.');
          state = 'done'; urlField.value = d.url; nameField.value = file.name; link();
          input.hidden = true; remove.hidden = false;
          say('Uploaded: ' + file.name, 'ok');
        })
        .catch(function (e) { clear(); say(e.message + ' Please try again, or email your art to us.', 'bad'); });
    });

    function guard(ev) {
      var t = ev.target;
      if (!t.closest) return;
      var buy = t.closest('add-to-cart-component button, button[name="add"], .shopify-payment-button, [data-shopify="payment-button"]');
      if (ev.type === 'submit') { if (t !== findForm(box)) return; } else if (!buy) return;
      if (state === 'busy') { ev.preventDefault(); ev.stopImmediatePropagation(); say('Still uploading, one moment...', 'bad'); return; }
      if (required && state !== 'done') {
        ev.preventDefault(); ev.stopImmediatePropagation();
        say('Please upload your art first.', 'bad'); box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    document.addEventListener('click', guard, true);
    document.addEventListener('submit', guard, true);
  }

  function init() { document.querySelectorAll('[data-blank-sync-art]').forEach(setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
`;
}
