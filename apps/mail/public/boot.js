/*
  ZMail boot skeleton — markup and progress logic, shared by public/boot.html (macOS app,
  before the engine is up) and the React app's first paint (components/boot-screen.tsx).
  window.ZMailBoot.mount(container, { progress, label }) returns { set, error, done }.
*/
(function () {
  if (window.ZMailBoot) return;

  // ZMail's logo, projected from Brand/ by scripts/sync-brand.sh. Resolved next to this script,
  // so it loads both from the app (/boot.js) and from the macOS boot page (boot.html, on disk).
  var BASE = ((document.currentScript && document.currentScript.src) || '').replace(/boot\.js(\?.*)?$/, '');
  var MARK = '<img src="' + BASE + 'brand/icon.svg" alt="" draggable="false">';

  // Same language as the app (lib/i18n.ts): the saved choice, else the system's.
  var LANG = (function () {
    try {
      var saved = localStorage.getItem('zmail.locale');
      if (saved === 'fr' || saved === 'en') return saved;
    } catch (e) {}
    return /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
  })();
  var EN = {
    'Chargement de ZMail': 'Loading ZMail',
    'Tout reste sur votre Mac': 'Everything stays on your Mac',
    'Prêt': 'Ready',
    'Ouverture de ZMail': 'Opening ZMail',
    'Ouverture de votre boîte de réception': 'Opening your inbox',
    'Démarrage du moteur sécurisé': 'Starting the secure engine',
    'Déverrouillage de vos clés dans le Trousseau': 'Unlocking your keys in the Keychain',
    'Connexion à vos boîtes mail': 'Connecting to your mailboxes',
    'Réveil de ZMail': 'Waking ZMail up',
  };
  function tr(text) {
    return LANG === 'en' && EN[text] ? EN[text] : text;
  }

  function bone(w, h, extra) {
    return '<div class="zb-bone ' + (extra || '') + '" style="width:' + w + ';height:' + h + 'px"></div>';
  }
  function markup() {
    var i = 0;
    var row = function (w) {
      return '<div class="zb-row zb-in" style="--i:' + i++ + '">' + bone('16px', 16, 'zb-round') + bone(w, 10) + '</div>';
    };
    var side =
      '<aside class="zb-side"><div class="zb-top">' + bone('64px', 22) + '</div>' +
      '<div class="zb-compose zb-in" style="--i:' + i++ + '">' + bone('16px', 16) + bone('110px', 10, 'strong') + '</div>' +
      '<div class="zb-rows">' + ['62%', '44%', '52%', '38%', '56%'].map(row).join('') + '</div>' +
      '<div class="zb-label zb-in" style="--i:' + i++ + '">' + bone('72px', 8) + '</div>' +
      '<div class="zb-rows" style="margin-top:0">' + ['48%', '58%', '42%', '54%', '36%', '50%', '46%'].map(row).join('') + '</div></aside>';
    var mails = '';
    var widths = [['38%', '82%', '64%'], ['46%', '74%', '58%'], ['30%', '88%', '52%'], ['42%', '70%', '66%'], ['34%', '80%', '48%'], ['40%', '76%', '60%'], ['28%', '84%', '54%']];
    for (var m = 0; m < widths.length; m++) {
      var w = widths[m];
      mails +=
        '<div class="zb-mail zb-in" style="--i:' + (4 + m) + '">' + bone('32px', 32, 'zb-round strong') +
        '<div class="zb-lines"><div style="display:flex;justify-content:space-between">' + bone(w[0], 11, 'strong') + bone('34px', 9) + '</div>' +
        bone(w[1], 10) + '<div class="zb-chips">' + bone('68px', 16) + bone('54px', 16) + bone(w[2], 10) + '</div></div></div>';
    }
    var list =
      '<div class="zb-list"><div class="zb-in" style="--i:1;display:flex;gap:8px;align-items:center;padding:4px 6px 8px">' + bone('132px', 14, 'strong') + bone('52px', 10) + '</div>' +
      '<div class="zb-in" style="--i:2;padding:0 2px 6px">' + bone('100%', 34) + '</div>' + mails + '</div>';
    var stage =
      '<div class="zb-stage"><div class="zb-aurora"></div><div class="zb-core">' +
      '<div class="zb-mark">' + MARK + '</div>' +
      '<div class="zb-title">ZMail</div>' +
      '<div class="zb-status" aria-live="polite"><span></span></div>' +
      '<div class="zb-track"><div class="zb-fill"></div></div>' +
      '<div class="zb-meta"><span class="zb-step"></span><span class="zb-pct">0 %</span></div>' +
      '<div class="zb-error" hidden></div></div></div>';
    return side + '<main class="zb-main"><div class="zb-panel">' + list + stage + '</div></main>';
  }

  function mount(root, initial) {
    root.classList.add('zb');
    root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-label', tr('Chargement de ZMail'));
    root.innerHTML = markup();
    var fill = root.querySelector('.zb-fill');
    var pct = root.querySelector('.zb-pct');
    var stepEl = root.querySelector('.zb-step');
    var status = root.querySelector('.zb-status');
    stepEl.textContent = tr('Tout reste sur votre Mac');
    var errorEl = root.querySelector('.zb-error');
    var shown = 0;
    var target = 0;
    var cap = 0;
    var label = '';
    var timer = null;

    function paint() {
      var v = Math.max(0, Math.min(100, shown));
      fill.style.width = v + '%';
      pct.textContent = Math.round(v) + ' %';
      root.setAttribute('aria-valuenow', String(Math.round(v)));
    }
    function setLabel(text) {
      if (!text || text === label) return;
      label = text;
      var old = status.querySelector('span:not(.out)');
      var next = document.createElement('span');
      next.className = 'pre';
      next.textContent = text + '…';
      status.appendChild(next);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          next.className = '';
          if (old) {
            old.className = 'out';
            setTimeout(function () {
              old.remove();
            }, 400);
          }
        });
      });
    }
    // Between real milestones the bar keeps creeping (never past the next one), so it never looks stuck.
    function tick() {
      if (shown < target) shown = Math.min(target, shown + Math.max(0.6, (target - shown) * 0.18));
      else if (shown < cap) shown = shown + (cap - shown) * 0.025;
      paint();
    }
    function set(progress, text, nextCap) {
      target = Math.max(target, progress);
      cap = Math.max(target, nextCap == null ? Math.min(99, target + 12) : nextCap);
      setLabel(tr(text));
      if (!timer) timer = setInterval(tick, 80);
    }
    function error(message) {
      errorEl.hidden = !message;
      errorEl.textContent = message || '';
    }
    function done() {
      set(100, label || tr('Prêt'), 100);
      return new Promise(function (resolve) {
        setTimeout(function () {
          root.classList.add('zb-done');
          setTimeout(function () {
            clearInterval(timer);
            resolve();
          }, 440);
        }, 260);
      });
    }
    // `instant`: continue where a previous screen left off (no animation from 0).
    if (initial && initial.instant) {
      shown = initial.progress || 0;
      fill.style.transition = 'none';
      paint();
      fill.getBoundingClientRect();
      fill.style.transition = '';
    }
    set((initial && initial.progress) || 4, tr((initial && initial.label) || 'Ouverture de ZMail'), initial && initial.cap);
    return { set: set, error: error, done: done };
  }

  window.ZMailBoot = { mount: mount };
})();
