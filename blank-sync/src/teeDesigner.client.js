// Runs in the shopper's browser on products tagged "Designer". Served by the app as /tee-designer.js,
// with `S` (settings) put in front of it. Plain ES5 so it works on every browser the store supports.
// Theme snippet: <div data-blank-sync-designer data-product="{{ product.id }}" data-handle="{{ product.handle }}"></div>
(function () {
  var ACCEPT = '.png,.jpg,.jpeg,.svg,.pdf,.ai,.eps,.psd';
  var css = '.bsd{margin:12px 0}.bsd__t{font-weight:600;margin:0 0 6px}' +
    '.bsd__stage{position:relative;width:100%;max-width:520px;background:#eee;border-radius:8px;overflow:hidden;user-select:none;-webkit-user-select:none}' +
    '.bsd__shirt{display:block;width:100%;height:auto;pointer-events:none}' +
    '.bsd__area{position:absolute;border:1px dashed rgba(0,0,0,.45);box-shadow:0 0 0 1px rgba(255,255,255,.45);pointer-events:none}' +
    '.bsd__art{position:absolute;cursor:move;touch-action:none;outline:1px solid rgba(20,110,255,.8);max-width:none}' +
    '.bsd__ph{display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;background:rgba(255,255,255,.75);color:#222;border:2px dashed #555;box-sizing:border-box;padding:4px}' +
    '.bsd__empty{position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:.85em;color:#222;text-shadow:0 0 3px #fff}' +
    '.bsd__row{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap;margin:8px 0}' +
    '.bsd__row input[type=range]{flex:1;min-width:140px}.bsd__b{font:inherit;font-size:.85em;padding:6px 10px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}' +
    '.bsd__s{font-size:.9em}.bsd__s--bad{color:#b42318;font-weight:600}.bsd__s--ok{color:#0a6c4a;font-weight:600}' +
    '.bsd__h{font-size:.85em;opacity:.75;margin:4px 0}.bsd input[type=file]{max-width:100%}.bsd [hidden]{display:none!important}';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function n1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  function findForm(box) {
    var section = box.closest('section, .shopify-section') || document;
    return section.querySelector('form[id^="BuyButtons-ProductForm"]') ||
      section.querySelector('form[action$="/cart/add"]') ||
      document.querySelector('product-form-component form, form[action$="/cart/add"]');
  }

  // Cut see-through edges off a PNG, so the size shown is the size of the art itself.
  function trimmed(file, done) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return done({ src: url, w: 1, h: 1 });
      if (file.type !== 'image/png') return done({ src: url, w: w, h: h });
      try {
        var k = Math.min(1, 1500 / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0, cw, ch);
        var d = g.getImageData(0, 0, cw, ch).data;
        var x0 = cw, y0 = ch, x1 = -1, y1 = -1;
        for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) {
          if (d[(y * cw + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) return done({ src: url, w: w, h: h, blank: true });
        var tw = x1 - x0 + 1, th = y1 - y0 + 1;
        if (tw === cw && th === ch) return done({ src: url, w: w, h: h });
        var t = document.createElement('canvas'); t.width = tw; t.height = th;
        t.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
        done({ src: t.toDataURL('image/png'), w: tw, h: th });
      } catch (e) { done({ src: url, w: w, h: h }); }
    };
    img.onerror = function () { done(null); };
    img.src = url;
  }

  function setup(box) {
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    if (!document.getElementById('bsd-css')) { var st = el('style'); st.id = 'bsd-css'; st.textContent = css; document.head.appendChild(st); }
    var required = box.getAttribute('data-required') !== 'false';
    var info = null, product = null, color = '', photo = null;
    var art = null; // { url, name, kind: 'image'|'file', w, h, mockup }
    var pos = { cx: 0.5, top: 0, s: 0.8 }; // art center across and top, as parts of the print area; s = width / area width
    var busy = false;

    box.classList.add('bsd');
    box.appendChild(el('p', 'bsd__t', (box.getAttribute('data-title') || 'Your design') + (required ? ' *' : '')));
    var stage = el('div', 'bsd__stage');
    var shirt = el('img', 'bsd__shirt'); shirt.alt = 'Preview of your shirt'; shirt.hidden = true;
    var area = el('div', 'bsd__area');
    var artImg = el('img', 'bsd__art'); artImg.alt = 'Your art'; artImg.hidden = true; artImg.draggable = false;
    var ph = el('div', 'bsd__art bsd__ph', 'Your file. We’ll print it here.'); ph.hidden = true;
    var empty = el('div', 'bsd__empty', 'Upload your art to see it on the shirt');
    stage.appendChild(shirt); stage.appendChild(area); stage.appendChild(artImg); stage.appendChild(ph); stage.appendChild(empty);
    box.appendChild(stage);

    var ctl = el('div'); ctl.hidden = true;
    var sizeRow = el('div', 'bsd__row');
    var size = el('input'); size.type = 'range'; size.min = '5'; size.max = '100'; size.step = '1'; size.setAttribute('aria-label', 'Art size');
    sizeRow.appendChild(el('span', 'bsd__s', 'Size')); sizeRow.appendChild(size);
    var btnRow = el('div', 'bsd__row');
    var presets = [['Full front', 'full'], ['Center it', 'center'], ['Left chest', 'chest']];
    presets.forEach(function (p) {
      var b = el('button', 'bsd__b', p[0]); b.type = 'button';
      b.addEventListener('click', function () { preset(p[1]); });
      btnRow.appendChild(b);
    });
    var readout = el('p', 'bsd__h');
    ctl.appendChild(sizeRow); ctl.appendChild(btnRow); ctl.appendChild(readout);
    ctl.appendChild(el('p', 'bsd__h', 'Drag the art to move it. The dashed box is the area we can print.'));
    box.appendChild(ctl);

    var pick = el('div', 'bsd__row');
    var input = el('input'); input.type = 'file'; input.accept = ACCEPT;
    var status = el('span', 'bsd__s');
    pick.appendChild(input); pick.appendChild(status);
    box.appendChild(pick);
    box.appendChild(el('p', 'bsd__h', box.getAttribute('data-help') ||
      'A PNG with a see-through background prints best and shows on the preview. JPG and SVG preview too. PDF, AI, EPS and PSD work, shown as a box. Up to 25 MB.'));
    var hidden = el('div');
    box.appendChild(hidden);

    function say(text, kind) { status.textContent = text; status.className = 'bsd__s' + (kind ? ' bsd__s--' + kind : ''); }

    // ----- geometry, in pixels of the preview as shown -----
    function geo() {
      var W = stage.clientWidth;
      var H = !shirt.hidden && shirt.naturalWidth ? W * shirt.naturalHeight / shirt.naturalWidth : W * 1.25;
      var a = info ? info.area : { x: 0.5, y: 0.22, w: 0.36, h: 0.34 };
      var g = { W: W, H: H, ax: (a.x - a.w / 2) * W, ay: a.y * H, aw: a.w * W, ah: a.h * H };
      if (art) {
        var ratio = art.h / art.w;
        g.maxS = Math.min(1, g.ah / (g.aw * ratio));
        pos.s = Math.max(0.05 * g.maxS, Math.min(pos.s, g.maxS));
        g.w = pos.s * g.aw; g.h = g.w * ratio;
        var half = g.w / 2 / g.aw;
        pos.cx = Math.max(half, Math.min(1 - half, pos.cx));
        pos.top = Math.max(0, Math.min((g.ah - g.h) / g.ah, pos.top));
        g.left = g.ax + pos.cx * g.aw - g.w / 2; g.top = g.ay + pos.top * g.ah;
      }
      return g;
    }

    function draw() {
      var g = geo();
      stage.style.height = shirt.hidden || !shirt.naturalWidth ? g.H + 'px' : '';
      area.style.left = g.ax + 'px'; area.style.top = g.ay + 'px'; area.style.width = g.aw + 'px'; area.style.height = g.ah + 'px';
      var node = art && art.kind === 'image' ? artImg : ph;
      artImg.hidden = !(art && art.kind === 'image'); ph.hidden = !(art && art.kind !== 'image');
      empty.hidden = !!art || busy; ctl.hidden = !art;
      if (art) {
        node.style.left = g.left + 'px'; node.style.top = g.top + 'px'; node.style.width = g.w + 'px'; node.style.height = g.h + 'px';
        size.value = String(Math.round(100 * pos.s / g.maxS));
        var inch = (info ? info.printWidthIn : 12) / g.aw;
        var off = (g.left + g.w / 2 - (g.ax + g.aw / 2)) * inch;
        art.printSize = n1(g.w * inch) + ' in wide x ' + n1(g.h * inch) + ' in tall';
        art.placement = (Math.abs(off) < 0.25 ? 'Centered' : n1(Math.abs(off)) + ' in ' + (off < 0 ? 'left' : 'right') + ' of center (as you face the shirt)') +
          ', top of art ' + n1((g.top - g.ay) * inch) + ' in below the top of the print area';
        readout.textContent = 'Prints about ' + art.printSize + '.';
        art.place = { x: (g.left + g.w / 2) / g.W, y: g.top / g.H, w: g.w / g.W, h: g.h / g.H };
      }
      link();
    }

    function preset(which) {
      if (!art) return;
      var g = geo();
      var inch = (info ? info.printWidthIn : 12);
      if (which === 'full') { pos.s = 1; pos.cx = 0.5; pos.top = 0; }
      if (which === 'center') pos.cx = 0.5;
      if (which === 'chest') { pos.s = Math.min(g.maxS, 3.5 / inch); pos.cx = 0.78; pos.top = 0.02; }
      draw();
    }

    size.addEventListener('input', function () {
      var g = geo();
      var old = pos.s * g.aw;
      pos.s = g.maxS * Number(size.value) / 100;
      // Grow around the art's center.
      var oldH = old * art.h / art.w, newH = pos.s * g.aw * art.h / art.w;
      pos.top += (oldH - newH) / 2 / g.ah;
      draw();
    });

    // ----- dragging -----
    var drag = null;
    function down(ev) {
      if (!art) return;
      ev.preventDefault();
      drag = { x: ev.clientX, y: ev.clientY, cx: pos.cx, top: pos.top };
      try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    function move(ev) {
      if (!drag) return;
      var g = geo();
      pos.cx = drag.cx + (ev.clientX - drag.x) / g.aw;
      pos.top = drag.top + (ev.clientY - drag.y) / g.ah;
      draw();
    }
    function up() { drag = null; }
    [artImg, ph].forEach(function (n) {
      n.addEventListener('pointerdown', down);
      n.addEventListener('pointermove', move);
      n.addEventListener('pointerup', up);
      n.addEventListener('pointercancel', up);
    });
    window.addEventListener('resize', draw);
    shirt.addEventListener('load', draw);

    // ----- the shirt color the shopper picked -----
    function currentVariant() {
      if (!product) return null;
      var form = findForm(box);
      var f = form && form.querySelector('[name="id"]');
      var id = f && f.value;
      if (!id) { var m = location.search.match(/[?&]variant=(\d+)/); id = m && m[1]; }
      var list = product.variants || [];
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
      return list[0] || null;
    }
    function colorIndex() {
      var opts = product.options || [];
      for (var i = 0; i < opts.length; i++) {
        var name = typeof opts[i] === 'string' ? opts[i] : opts[i].name;
        if (info && name === info.colorOption) return i;
      }
      for (var j = 0; j < opts.length; j++) { var nm = typeof opts[j] === 'string' ? opts[j] : opts[j].name; if (/^colou?r/i.test(nm)) return j; }
      return -1;
    }
    function watchColor() {
      var v = currentVariant();
      var ci = product ? colorIndex() : -1;
      var c = v && ci >= 0 ? v.options[ci] : '';
      if (c === color && photo !== undefined) return;
      color = c;
      photo = (info && info.photos[c]) || null;
      if (photo) { shirt.src = photo.url + (photo.url.indexOf('?') < 0 ? '?' : '&') + 'width=1000'; shirt.hidden = false; }
      else { shirt.removeAttribute('src'); shirt.hidden = true; }
      draw();
    }

    // ----- what goes on the order -----
    function link() {
      var form = findForm(box);
      var formId = form && form.getAttribute('id');
      hidden.innerHTML = '';
      if (!art || !art.url) return;
      var props = [['Artwork', art.url], ['Artwork file', art.name], ['Print size', art.printSize], ['Placement', art.placement]];
      if (art.place) {
        props.push(['_Placement', JSON.stringify({ x: +art.place.x.toFixed(4), y: +art.place.y.toFixed(4), w: +art.place.w.toFixed(4), h: +art.place.h.toFixed(4), color: color })]);
        if (art.mockup && photo) {
          var q = 'art=' + encodeURIComponent(art.url) + '&photo=' + encodeURIComponent(photo.url) +
            '&x=' + art.place.x.toFixed(4) + '&y=' + art.place.y.toFixed(4) + '&w=' + art.place.w.toFixed(4) + '&h=' + art.place.h.toFixed(4);
          props.push(['Mockup', S.appUrl + '/mockup.jpg?' + q]);
        }
      }
      props.forEach(function (p) {
        if (!p[1]) return;
        var h = el('input'); h.type = 'hidden'; h.name = 'properties[' + p[0] + ']'; h.value = p[1];
        if (formId) h.setAttribute('form', formId);
        hidden.appendChild(h);
      });
    }
    new MutationObserver(function (m) {
      if (m.some(function (r) { return !box.contains(r.target); })) { link(); watchColor(); }
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', function () { setTimeout(watchColor, 0); }, true);
    setInterval(watchColor, 700);

    // ----- upload -----
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) return say(file.name + ' is over 25 MB. Please email it to us instead.', 'bad');
      var ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
      var showable = /^(png|jpe?g|svg)$/.test(ext);
      busy = true; say('Uploading ' + file.name + '...');
      var shown = null, url = null, failed = false;
      function finish() {
        if (failed || !url || (showable && shown === null)) return;
        busy = false;
        var was = art;
        art = shown && shown !== false
          ? { url: url, name: file.name, kind: 'image', w: shown.w, h: shown.h, mockup: /^(png|jpe?g)$/.test(ext) }
          : { url: url, name: file.name, kind: 'file', w: 1, h: 1, mockup: false };
        if (shown && shown !== false) artImg.src = shown.src;
        if (!was) { pos = { cx: 0.5, top: 0, s: Math.min(1, 10 / (info ? info.printWidthIn : 12)) }; }
        say('Uploaded: ' + file.name + (shown && shown.blank ? ' (this picture looks empty)' : ''), shown && shown.blank ? 'bad' : 'ok');
        draw();
      }
      if (showable) trimmed(file, function (r) { shown = r || false; finish(); }); else shown = false;
      var body = new FormData(); body.append('file', file, file.name);
      fetch(S.appUrl + '/art/upload', { method: 'POST', body: body })
        .then(function (r) { return r.json().catch(function () { return { error: 'Upload failed (' + r.status + ').' }; }); })
        .then(function (d) { if (!d || !d.url) throw new Error((d && d.error) || 'Upload failed.'); url = d.url; finish(); })
        .catch(function (e) { failed = true; busy = false; say(file.name + ': ' + e.message + ' Please try again, or email your art to us.', 'bad'); draw(); });
      draw();
    });

    // ----- don't let them add to cart without art -----
    function problem() {
      if (busy) return 'Still uploading, one moment...';
      if (required && !art) return 'Please upload your art first.';
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

    // ----- load the product -----
    var pid = box.getAttribute('data-product');
    var handle = box.getAttribute('data-handle');
    var root = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
    Promise.all([
      fetch(S.appUrl + '/designer/product?id=' + encodeURIComponent(pid)).then(function (r) { return r.json(); }),
      fetch(root + 'products/' + encodeURIComponent(handle) + '.js').then(function (r) { return r.json(); }),
    ]).then(function (res) {
      info = res[0] && res[0].photos ? res[0] : null;
      product = res[1];
      photo = undefined; watchColor();
    }).catch(function () { photo = undefined; draw(); });
    draw();
  }

  function init() { document.querySelectorAll('[data-blank-sync-designer]').forEach(setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
