/* Aktien-App · Rechenlogik und Zahlenformate für die Oberfläche.
   Depotstand, Break-even und Alarme rechnet die Datenbank (eine Stelle für App und Server).
   Hier steht nur, was der Spesenrechner für gedachte Orders braucht. */
(function (root) {
  'use strict';
  var L = {};
  L.num = function (x) { var v = Number(x); return isFinite(v) ? v : 0; };
  L.nf = function (n, d) { d = d === undefined ? 2 : d; return Math.abs(L.num(n)).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  L.vz = function (n, plus) { return n < -0.004 ? '−' : plus && n > 0.004 ? '+' : ''; };
  L.eur = function (n, plus) { n = L.num(n); return L.vz(n, plus) + '€ ' + L.nf(n); };
  L.geld = function (n, w) { return w === 'USD' ? '$ ' + L.nf(n) : L.eur(n); };
  L.pct = function (n, plus, d) { n = L.num(n); return L.vz(n, plus !== false) + L.nf(n, d === undefined ? 2 : d) + ' %'; };
  L.cls = function (n) { n = L.num(n); return n < -0.004 ? 'neg' : n > 0.004 ? 'pos' : ''; };
  L.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  L.heute = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  L.datum = function (iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; };
  /* Uhrzeit, mit Datum davor, wenn es nicht heute ist */
  L.zeit = function (ts) {
    if (!ts) return '';
    var d = new Date(ts), h = d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? h + ' Uhr' : d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' }) + ' ' + h + ' Uhr';
  };

  /* ---------- Spesen laut Konditionen (k) ---------- */
  L.us = function (b) { return b === 'NYSE' || b === 'NASDAQ'; };
  L.fremd = function (v, b, k) {
    if (b === 'WIEN') return k.wien_fix + k.wien_pct / 100 * v;
    if (L.us(b)) return k.us_fix + k.us_pct / 100 * v;
    return Math.max(k.xetra_min, k.xetra_fix + k.xetra_pct / 100 * v);
  };
  /* nr = die wievielte Order des Jahres; über dem Freikontingent kommt das Bankentgelt dazu */
  L.order = function (v, b, nr, k) {
    return L.fremd(v, b, k) + (nr > k.frei ? k.eigen_fix + k.eigen_pct / 100 * v : 0) + (L.us(b) ? k.devisen : 0);
  };
  L.depotMonat = function (v, k) { return v > 0 ? Math.max(k.depot_pct / 100 * v, k.depot_min) * (1 + k.ust / 100) : 0; };
  L.solve = function (f, lo, hi) { for (var i = 0; i < 90; i++) { var m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; };

  /* Gedachter Kauf und späterer Verkauf: Kosten, nötiger Anstieg, was vom Gewinn bleibt */
  L.rechner = function (o) {
    var k = o.k, A = Math.max(0, L.num(o.betrag)), nb = o.genutzt + 1, ns = o.genutzt + 2;
    var kauf = L.order(A, o.boerse, nb, k);
    var dep = k.depot_einrechnen === false ? 0 : (L.depotMonat(o.depotwert + A, k) - L.depotMonat(o.depotwert, k)) * o.wochen * 7 / 30.4375;
    var netto = function (g) { var V = A * (1 + g); return V - A - kauf - L.order(V, o.boerse, ns, k) - dep - Math.max(0, V - A) * k.kest / 100; };
    var t = o.ziel / 100, V2 = A * (1 + t);
    return {
      betrag: A, kauf: kauf, verkauf: L.order(V2, o.boerse, ns, k), hinZurueck: kauf + L.order(A, o.boerse, ns, k), dep: dep,
      steuer: Math.max(0, V2 - A) * k.kest / 100, gewinn: V2 - A, netto: netto(t), noetig: A > 0 ? L.solve(netto, -0.9, 3) * 100 : 0, nb: nb, ns: ns
    };
  };

  /* Schwellen der automatischen Warnungen, gleich wie am Server */
  L.schwelleTag = function (sigma) { return Math.max(0.02, 2 * (sigma || 0.02)) * 100; };
  L.schwelleWoche = function (sigma) { return Math.max(0.04, 2 * (sigma || 0.02) * Math.sqrt(5)) * 100; };

  root.L = L;
})(window);
