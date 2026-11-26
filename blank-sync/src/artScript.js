// The script the store's product page loads to show the "Upload your art" box.
// The theme only needs:  <div data-blank-sync-art></div><script src="APP_URL/art-upload.js" defer></script>
// Options on the div:
//   data-required="false"  upload is optional
//   data-max-files="10"    allow several files (Artwork, Artwork 2, ...)
//   data-questions="gang"  ask how to print it (size, copies, background, notes)
import { ART_PROPERTY, ART_NAME_PROPERTY } from './artUpload.js';

// Print questions. Each answer goes on the order as a line property named by its label.
export const QUESTION_SETS = {
  gang: [
    { name: 'Print size', type: 'text', required: true, label: 'How big should each design print?',
      placeholder: 'e.g. 10 in wide for shirt fronts, 3.5 in for left chest' },
    { name: 'Copies', type: 'text', required: true, label: 'How many copies of each design?',
      placeholder: 'e.g. 12 of design 1, 6 of design 2, or "fill the sheet"' },
    { name: 'Remove background', type: 'select', required: true, label: 'Remove the background?',
      options: ['Yes, remove the background', 'No, print it as is', 'Not sure, please check for me'] },
    { name: 'Print notes', type: 'textarea', required: false, label: 'Anything else we should know? (optional)',
      placeholder: 'Colors to keep, mirror for a dark shirt, deadline...' },
  ],
};

export function artUploadScript(appUrl) {
  const settings = JSON.stringify({ appUrl, prop: ART_PROPERTY, nameProp: ART_NAME_PROPERTY, sets: QUESTION_SETS });
  return `(function () {
  var S = ${settings};
  var ACCEPT = '.png,.jpg,.jpeg,.pdf,.svg,.ai,.eps,.psd';
  var css = '.bsa{margin:12px 0;padding:14px;border:1px dashed currentColor;border-radius:8px}' +
    '.bsa__t{font-weight:600;margin:0 0 4px}.bsa__h{font-size:.85em;opacity:.75;margin:0 0 10px}' +
    '.bsa__row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:6px 0}' +
    '.bsa__img{width:56px;height:56px;object-fit:contain;border-radius:6px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px}' +
    '.bsa__s{font-size:.9em}.bsa__s--bad{color:#b42318;font-weight:600}.bsa__s--ok{color:#0a6c4a;font-weight:600}' +
    '.bsa__x{background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font:inherit;color:inherit}' +
    '.bsa__q{display:block;margin:12px 0 0}.bsa__q span{display:block;font-size:.9em;font-weight:600;margin-bottom:4px}' +
    '.bsa__q input,.bsa__q select,.bsa__q textarea{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid rgba(0,0,0,.3);border-radius:6px;background:transparent;color:inherit}' +
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
    var maxFiles = Math.max(1, Math.min(20, parseInt(box.getAttribute('data-max-files') || '1', 10) || 1));
    var questions = S.sets[box.getAttribute('data-questions') || ''] || [];
    var files = []; // { name, url, img, row }
    var busy = 0;
    var fields = []; // hidden and visible inputs that go on the order
    if (!document.getElementById('bsa-css')) { var st = el('style'); st.id = 'bsa-css'; st.textContent = css; document.head.appendChild(st); }

    box.classList.add('bsa');
    box.appendChild(el('p', 'bsa__t', box.getAttribute('data-title') ||
      (maxFiles > 1 ? 'Upload your designs' : 'Upload your art') + (required ? ' *' : '')));
    box.appendChild(el('p', 'bsa__h', box.getAttribute('data-help') ||
      'A PNG with a see-through background prints best. PDF, SVG, AI, EPS, PSD and JPG work too. Up to 25 MB each' +
      (maxFiles > 1 ? ', up to ' + maxFiles + ' files.' : '.')));
    var list = el('div');
    box.appendChild(list);
    var pick = el('div', 'bsa__row');
    var input = el('input'); input.type = 'file'; input.accept = ACCEPT; if (maxFiles > 1) input.multiple = true;
    var status = el('span', 'bsa__s');
    pick.appendChild(input); pick.appendChild(status);
    box.appendChild(pick);
    var hidden = el('div');
    box.appendChild(hidden);

    questions.forEach(function (q) {
      var wrap = el('label', 'bsa__q');
      wrap.appendChild(el('span', '', q.label + (q.required ? ' *' : '')));
      var f;
      if (q.type === 'select') {
        f = el('select');
        var none = el('option', '', 'Choose one'); none.value = ''; f.appendChild(none);
        q.options.forEach(function (o) { var op = el('option', '', o); op.value = o; f.appendChild(op); });
      } else {
        f = el(q.type === 'textarea' ? 'textarea' : 'input');
        if (q.type !== 'textarea') f.type = 'text'; else f.rows = 3;
        f.placeholder = q.placeholder || '';
      }
      f.name = 'properties[' + q.name + ']';
      f.dataset.required = q.required ? '1' : '';
      f.addEventListener('input', function () { if (/bad/.test(status.className)) say(''); link(); });
      f.addEventListener('change', link);
      wrap.appendChild(f);
      box.appendChild(wrap);
      fields.push(f);
    });

    function link() {
      // getAttribute: the form has an input named "id", so form.id is that input, not the form's id.
      var form = findForm(box);
      var formId = form && form.getAttribute('id');
      hidden.innerHTML = '';
      files.forEach(function (f, i) {
        var n = i === 0 ? S.prop : S.prop + ' ' + (i + 1);
        [[n, f.url], [n + ' file', f.name]].forEach(function (p) {
          var h = el('input'); h.type = 'hidden'; h.name = 'properties[' + p[0] + ']'; h.value = p[1];
          if (formId) h.setAttribute('form', formId);
          hidden.appendChild(h);
        });
      });
      fields.forEach(function (f) {
        if (formId) f.setAttribute('form', formId);
        // An empty answer is left off the order.
        f.disabled = false;
        if (!String(f.value).trim()) f.removeAttribute('name'); else f.name = 'properties[' + f.closest('.bsa__q').dataset.key + ']';
      });
      input.hidden = files.length + busy >= maxFiles;
    }
    questions.forEach(function (q, i) { fields[i].closest('.bsa__q').dataset.key = q.name; });
    link();
    new MutationObserver(function (m) {
      if (m.some(function (r) { return !box.contains(r.target); })) link();
    }).observe(document.body, { childList: true, subtree: true });

    function say(text, kind) { status.textContent = text; status.className = 'bsa__s' + (kind ? ' bsa__s--' + kind : ''); }

    function addRow(file) {
      var row = el('div', 'bsa__row');
      var img = el('img', 'bsa__img'); img.alt = '';
      img.hidden = !/^image\\/(png|jpeg)$/.test(file.type);
      if (!img.hidden) img.src = URL.createObjectURL(file);
      var label = el('span', 'bsa__s', 'Uploading ' + file.name + '...');
      var remove = el('button', 'bsa__x', 'Remove'); remove.type = 'button'; remove.hidden = true;
      row.appendChild(img); row.appendChild(label); row.appendChild(remove);
      list.appendChild(row);
      return { row: row, label: label, remove: remove };
    }

    function upload(file) {
      if (file.size > 25 * 1024 * 1024) return say(file.name + ' is over 25 MB. Please email it to us instead.', 'bad');
      busy++; link();
      var ui = addRow(file);
      var body = new FormData(); body.append('file', file, file.name);
      fetch(S.appUrl + '/art/upload', { method: 'POST', body: body })
        .then(function (r) { return r.json().catch(function () { return { error: 'Upload failed (' + r.status + ').' }; }); })
        .then(function (d) {
          if (!d || !d.url) throw new Error((d && d.error) || 'Upload failed.');
          var entry = { name: file.name, url: d.url, row: ui.row };
          files.push(entry);
          ui.label.textContent = 'Uploaded: ' + file.name; ui.label.className = 'bsa__s bsa__s--ok';
          ui.remove.hidden = false;
          ui.remove.addEventListener('click', function () {
            files = files.filter(function (f) { return f !== entry; }); ui.row.remove(); link();
          });
        })
        .catch(function (e) { ui.row.remove(); say(file.name + ': ' + e.message + ' Please try again, or email your art to us.', 'bad'); })
        .then(function () { busy--; link(); });
    }

    input.addEventListener('change', function () {
      var chosen = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var room = maxFiles - files.length - busy;
      if (chosen.length > room) say('Only ' + maxFiles + ' file' + (maxFiles === 1 ? '' : 's') + ' fit. Email us the rest.', 'bad'); else say('');
      if (maxFiles === 1 && files.length) { files[0].row.remove(); files = []; room = 1; }
      chosen.slice(0, room).forEach(upload);
    });

    function problem() {
      if (busy) return 'Still uploading, one moment...';
      if (required && !files.length) return maxFiles > 1 ? 'Please upload at least one design first.' : 'Please upload your art first.';
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].dataset.required && !String(fields[i].value).trim()) { fields[i].focus(); return 'Please answer: ' + questions[i].label; }
      }
      return '';
    }

    function guard(ev) {
      var t = ev.target;
      if (!t.closest) return;
      var buy = t.closest('add-to-cart-component button, button[name="add"], .shopify-payment-button, [data-shopify="payment-button"]');
      if (ev.type === 'submit') { if (t !== findForm(box)) return; } else if (!buy) return;
      var p = problem();
      if (!p) return link();
      ev.preventDefault(); ev.stopImmediatePropagation();
      say(p, 'bad'); box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    document.addEventListener('click', guard, true);
    document.addEventListener('submit', guard, true);
  }

  function init() { document.querySelectorAll('[data-blank-sync-art]').forEach(setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
`;
}
