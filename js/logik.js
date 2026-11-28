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

  /* ---------- Handelszeiten der Börsen, umgerechnet auf Wiener Zeit ----------
     Regeln nach den Kalendern der Wiener Börse, der Deutschen Börse und der NYSE (Stand 2026/2027).
     Sommerzeit: Die USA stellen an anderen Tagen um als Europa; in diesen Wochen öffnet New York nach Wiener Zeit eine Stunde früher. */
  var WIEN_TZ = 'Europe/Vienna';
  var PLAETZE = [
    { id: 'WIEN', name: 'Wien', tz: 'Europe/Vienna', auf: [9, 0], zu: [17, 35] },
    { id: 'XETRA', name: 'Xetra', tz: 'Europe/Berlin', auf: [9, 0], zu: [17, 35] },
    { id: 'NY', name: 'New York', zusatz: 'NYSE und NASDAQ', tz: 'America/New_York', auf: [9, 30], zu: [16, 0] }
  ];
  var fmtCache = {};
  function teile(tz, d) {
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }));
    var o = {}; f.formatToParts(d).forEach(function (p) { if (p.type !== 'literal') o[p.type] = Number(p.value); });
    return o;
  }
  /* Ortszeit einer Börse (Jahr, Monat, Tag, Stunde, Minute) als Zeitpunkt */
  function zeitpunkt(tz, j, m, t, h, mi) {
    var ziel = Date.UTC(j, m - 1, t, h, mi), ms = ziel;
    for (var i = 0; i < 2; i++) { var p = teile(tz, new Date(ms)); ms += ziel - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); }
    return new Date(ms);
  }
  function wochentag(j, m, t) { return new Date(Date.UTC(j, m - 1, t)).getUTCDay(); }
  function ostern(j) {  /* Ostersonntag als [Monat, Tag] */
    var a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * mm + 114) / 31), ta = ((h + l - 7 * mm + 114) % 31) + 1;
    return [mo, ta];
  }
  function plus(j, m, t, n) { var d = new Date(Date.UTC(j, m - 1, t + n)); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }
  function nter(j, m, wt, n) {  /* n-ter Wochentag im Monat; n = -1: der letzte */
    if (n > 0) { var erster = wochentag(j, m, 1); return 1 + ((wt - erster + 7) % 7) + 7 * (n - 1); }
    var letzter = new Date(Date.UTC(j, m, 0)).getUTCDate(); return letzter - ((wochentag(j, m, letzter) - wt + 7) % 7);
  }
  /* Was gilt an diesem Kalendertag an dieser Börse? null = kein Handel */
  function handelstag(id, j, m, t) {
    var wt = wochentag(j, m, t);
    if (wt === 0 || wt === 6) return null;
    var o = ostern(j), kf = plus(j, o[0], o[1], -2), om = plus(j, o[0], o[1], 1);
    var ist = function (mm, tt) { return m === mm && t === tt; };
    if (ist(kf[1], kf[2])) return null;
    if (id !== 'NY') {
      if (ist(om[1], om[2]) || ist(1, 1) || ist(5, 1) || ist(12, 24) || ist(12, 25) || ist(12, 26) || ist(12, 31)) return null;
      if (id === 'WIEN' && ist(10, 26)) return null;
      /* letzter Handelstag des Jahres: verkürzt */
      var l = 30; while (wochentag(j, 12, l) === 0 || wochentag(j, 12, l) === 6) l--;
      if (ist(12, l)) return { zu: id === 'WIEN' ? [14, 15] : [14, 0], verkuerzt: true };
      return {};
    }
    /* New York: fällt ein Feiertag auf Samstag, ist der Freitag frei, bei Sonntag der Montag (Neujahr am Samstag entfällt) */
    var fest = function (mm, tt, ohneFreitag) { var w = wochentag(j, mm, tt); return w === 6 ? (ohneFreitag ? false : ist.apply(null, plus(j, mm, tt, -1).slice(1))) : w === 0 ? ist.apply(null, plus(j, mm, tt, 1).slice(1)) : ist(mm, tt); };
    if (fest(1, 1, true) || ist(1, nter(j, 1, 1, 3)) || ist(2, nter(j, 2, 1, 3)) || ist(5, nter(j, 5, 1, -1)) || fest(6, 19) || fest(7, 4) || ist(9, nter(j, 9, 1, 1)) || fest(12, 25)) return null;
    if (m === 12 && t === 31 && wochentag(j + 1, 1, 1) === 6) return {};
    var dank = nter(j, 11, 4, 4);
    if (ist(11, dank)) return null;
    var w4 = wochentag(j, 7, 4), w25 = wochentag(j, 12, 25);
    if (ist(11, dank + 1) || (ist(7, 3) && w4 >= 2 && w4 <= 5) || (ist(12, 24) && w25 >= 2 && w25 <= 5)) return { zu: [13, 0], verkuerzt: true };
    return {};
  }
  var uhrWien = function (d) { return d.toLocaleTimeString('de-AT', { timeZone: WIEN_TZ, hour: 'numeric', minute: '2-digit' }); };
  var TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  /* Stand aller Börsen zu einem Zeitpunkt. Jede Zeile: { id, name, zusatz, offen, text, zeiten, verkuerzt } */
  L.boersen = function (jetzt) {
    jetzt = jetzt || new Date();
    var hw = teile(WIEN_TZ, jetzt);
    return PLAETZE.map(function (b) {
      var p = teile(b.tz, jetzt), tag = [p.year, p.month, p.day], r = { id: b.id, name: b.name, zusatz: b.zusatz || '', offen: false, verkuerzt: false };
      for (var i = 0; i < 12; i++) {
        var h = handelstag(b.id, tag[0], tag[1], tag[2]);
        if (h) {
          var zu = h.zu || b.zu, von = zeitpunkt(b.tz, tag[0], tag[1], tag[2], b.auf[0], b.auf[1]), bis = zeitpunkt(b.tz, tag[0], tag[1], tag[2], zu[0], zu[1]);
          if (jetzt < bis) {
            var vw = teile(WIEN_TZ, von), tageWeg = Math.round((Date.UTC(vw.year, vw.month - 1, vw.day) - Date.UTC(hw.year, hw.month - 1, hw.day)) / 86400000);
            r.offen = jetzt >= von; r.verkuerzt = !!h.verkuerzt; r.von = von; r.bis = bis;
            r.zeiten = uhrWien(von) + ' bis ' + uhrWien(bis) + (h.verkuerzt ? ' (verkürzt)' : '');
            r.wann = tageWeg === 0 ? 'heute' : tageWeg === 1 ? 'morgen' : TAGE[new Date(Date.UTC(vw.year, vw.month - 1, vw.day)).getUTCDay()];
            r.text = r.offen ? 'offen bis ' + uhrWien(bis) : 'öffnet ' + (tageWeg === 0 ? '' : r.wann + ' ') + 'um ' + uhrWien(von);
            return r;
          }
        }
        tag = plus(tag[0], tag[1], tag[2], 1);
      }
      r.text = 'geschlossen'; r.zeiten = ''; r.wann = '';
      return r;
    });
  };
  /* Ein Satz für die Kopfzeile, z. B. "Wien und Xetra offen bis 17:35, New York öffnet um 15:30" */
  L.boersenKurz = function (liste) {
    var gruppen = [];
    liste.forEach(function (b) { var g = gruppen.find(function (x) { return x.text === b.text; }); if (g) g.namen.push(b.name); else gruppen.push({ text: b.text, namen: [b.name], offen: b.offen }); });
    var und = function (a) { return a.length < 2 ? a[0] : a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1]; };
    if (gruppen.length === 1 && !gruppen[0].offen) return 'Alle Börsen geschlossen, Handel ' + gruppen[0].text.replace('öffnet ', '');
    return gruppen.map(function (g) { return und(g.namen) + ' ' + (g.namen.length > 1 ? g.text.replace('öffnet', 'öffnen') : g.text); }).join(', ');
  };

  root.L = L;
})(window);
