/* Aktien-App · Oberfläche
   Zeigt, was die Datenbank rechnet (Depot, Break-even, Alarme), und nimmt Orders, Alarme und Konditionen entgegen.
   Wer nur Lesezugriff hat, sieht alles, kann aber nichts ändern; das sichert die Datenbank ab, nicht diese Datei. */
(function () {
  'use strict';
  var VERSION = '1';
  var CFG = window.AKTIEN_CONFIG, sb = window.supabase.createClient(CFG.url, CFG.key);
  var nf = L.nf, eur = L.eur, pct = L.pct, cls = L.cls, esc = L.esc, num = L.num;
  var BOERSEN = { WIEN: 'Wien', XETRA: 'Xetra', NYSE: 'NYSE', NASDAQ: 'NASDAQ', SONST: 'Andere Börse' };
  var ARTEN = { unter: 'der Kurs unter einen Wert fällt', ueber: 'der Kurs über einen Wert steigt', breakeven: 'der Break-even erreicht ist', verlust: 'der Verlust seit Kauf zu groß wird', tagessturz: 'die Aktie an einem Tag stark fällt', wochenrutsch: 'die Aktie über 5 Handelstage stark fällt' };
  var S = {
    sitzung: null, me: null, geladen: false, laedt: false, fehler: '', view: 'depot',
    pos: [], alarme: [], kz: {}, einst: {}, meldungen: [], trades: [], genutzt: 0,
    rechner: { boerse: 'WIEN', betrag: 5000, wochen: 4, ziel: 5 }, offen: {}, order: null, push: 'unbekannt', dreht: false
  };
  var app = document.getElementById('app'), blatt = null, tt = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var ro = new ResizeObserver(function (es) { es.forEach(function (e) { zeichnen(e.target); }); });
  var IC = {
    depot: '<path d="M3 20h18M6 16v-5M11 16V6M16 16v-8M20 16v-3"/>',
    rechner: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11.5h.01M12 11.5h.01M16 11.5h.01M8 15.5h.01M12 15.5h.01M16 15.5v2.5M8 18.5h.01M12 18.5h.01"/>',
    alarme: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    mehr: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>',
    neu: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  };

  /* ---------- Hilfen ---------- */
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function inhaber() { return !!S.me && S.me.rolle === 'inhaber'; }
  function kond() { return S.einst.konditionen || {}; }
  function wp(id) { return S.pos.find(function (p) { return String(p.wertpapier_id) === String(id); }) || null; }
  function bestand() { return S.pos.filter(function (p) { return num(p.stueck) > 0; }); }
  function runden(x) { return Math.round(x * 100) / 100; }
  function meldung(e) { return (e && (e.message || e.error_description)) || 'Das hat nicht geklappt.'; }
  function toast(msg, undo) {
    var el = $('#toast'); el.innerHTML = '';
    var sp = document.createElement('span'); sp.textContent = msg; el.appendChild(sp);
    if (undo) { var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Rückgängig'; b.onclick = function () { el.hidden = true; undo(); }; el.appendChild(b); }
    el.hidden = false; el.style.animation = 'none'; void el.offsetHeight; el.style.animation = '';
    clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, undo ? 7000 : 5000);
  }
  function summen() {
    var s = { wert: 0, kosten: 0, gv: 0, heute: 0, vortag: 0 };
    bestand().forEach(function (p) {
      s.wert += num(p.wert_eur); s.kosten += num(p.kaufwert_eur) + num(p.kaufspesen_eur); s.gv += num(p.gv_eur);
      if (p.vortag_eur) { s.heute += num(p.stueck) * (num(p.kurs_eur) - num(p.vortag_eur)); s.vortag += num(p.stueck) * num(p.vortag_eur); }
    });
    return s;
  }
  /* Kommen noch Kurse? Montag bis Freitag zwischen 8 und 22 Uhr sollte der letzte gute Abruf jünger als 30 Minuten sein. */
  function veraltet() {
    var d = S.einst.dienst || {}, jetzt = new Date(), tag = jetzt.getDay(), h = jetzt.getHours();
    if (tag === 0 || tag === 6 || h < 8 || h >= 22) return null;
    if (!d.ok) return 'Es sind noch keine Kurse angekommen.';
    return Date.now() - new Date(d.ok).getTime() > 30 * 60000 ? 'Seit ' + L.zeit(d.ok) + ' kommen keine neuen Kurse. Die Alarme pausieren so lange.' : null;
  }

  /* ---------- Daten ---------- */
  async function laden(still) {
    if (S.laedt) return;
    S.laedt = true;
    try {
      var r = await Promise.all([
        q(sb.from('members').select('rolle,name').maybeSingle()),
        q(sb.rpc('positionen')),
        q(sb.from('alarme').select('*').order('created_at')),
        q(sb.from('einstellungen').select('key,value')),
        q(sb.from('kennzahlen').select('*')),
        q(sb.from('meldungen').select('*').order('zeit', { ascending: false }).limit(30)),
        q(sb.from('trades').select('*').order('datum', { ascending: false }).order('created_at', { ascending: false })),
        q(sb.rpc('genutzt', { p_jahr: new Date().getFullYear() }))
      ]);
      S.me = r[0] || null; S.pos = r[1] || []; S.alarme = r[2] || [];
      S.einst = {}; (r[3] || []).forEach(function (e) { S.einst[e.key] = e.value; });
      S.kz = {}; (r[4] || []).forEach(function (k) { S.kz[k.symbol] = k; });
      S.meldungen = r[5] || []; S.trades = r[6] || []; S.genutzt = num(r[7]);
      S.geladen = true; S.fehler = '';
    } catch (e) {
      S.fehler = meldung(e);
      if (!still) toast('Laden fehlgeschlagen: ' + S.fehler);
    } finally { S.laedt = false; }
  }
  async function neu() { await laden(); render(); }
  function fn(name, query, body) {
    var tok = S.sitzung ? S.sitzung.access_token : CFG.key;
    return fetch(CFG.url + '/functions/v1/' + name + (query ? '?' + query : ''), {
      method: body ? 'POST' : 'GET', headers: { apikey: CFG.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    }).then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || 'Dienst antwortet nicht'); return j; }); });
  }

  /* ---------- Zeichnungen: Tagesverlauf und Kursleiste ---------- */
  function zeichnen(s) {
    var p = wp(s.dataset.id), W = s.clientWidth, H = s.clientHeight;
    if (!p || W < 60) return;
    if (s.dataset.zeichne === 'spark') {
      var v = (p.verlauf || []).map(num), vt = p.waehrung === 'USD' ? null : num(p.vortag_eur) || null;
      if (v.length < 2) { s.innerHTML = '<text x="0" y="' + (H / 2 + 4) + '">Für heute gibt es noch keinen Verlauf.</text>'; return; }
      var lo = Math.min.apply(null, v.concat(vt || v[0])), hi = Math.max.apply(null, v.concat(vt || v[0])), pad = (hi - lo) * 0.12 || 1;
      lo -= pad; hi += pad;
      var X = function (i) { return i / (v.length - 1) * W; }, Y = function (x) { return H - (x - lo) / (hi - lo) * H; };
      var pts = v.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(x).toFixed(1); }).join(' ');
      s.innerHTML = '<polygon class="flaeche" points="0,' + H + ' ' + pts + ' ' + W + ',' + H + '"/>' +
        (vt ? '<line class="vortag" x1="0" x2="' + W + '" y1="' + Y(vt) + '" y2="' + Y(vt) + '"/><text x="' + W + '" y="' + (Y(vt) > 20 ? Y(vt) - 6 : Y(vt) + 16) + '" text-anchor="end">Vortag ' + nf(vt) + '</text>' : '') +
        '<polyline class="linie" points="' + pts + '"/>';
      return;
    }
    var jetzt = num(p.kurs_eur), ein = num(p.einstand), be = num(p.breakeven_eur);
    var al = p.waehrung === 'USD' ? [] : S.alarme.filter(function (a) { return String(a.wertpapier_id) === String(p.wertpapier_id) && a.aktiv && !a.ausgeloest_am && (a.art === 'unter' || a.art === 'ueber') && num(a.wert) > 0; });
    var vs = [jetzt, ein, be].concat(al.map(function (a) { return num(a.wert); })), mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), pd = (mx - mn) * 0.08 || jetzt * 0.05;
    mn -= pd; mx += pd;
    var Lr = 12, Xp = function (x) { return Lr + (x - mn) / (mx - mn) * (W - 2 * Lr); }, Yl = 58, minus = be > jetzt;
    var o = '<line class="achse" x1="' + Lr + '" x2="' + (W - Lr) + '" y1="' + Yl + '" y2="' + Yl + '"/><rect class="' + (minus ? 'luecke-neg' : 'luecke-pos') + '" x="' + Math.min(Xp(jetzt), Xp(be)) + '" y="' + (Yl - 6) + '" width="' + Math.abs(Xp(be) - Xp(jetzt)) + '" height="12" rx="3"/>';
    var e = p.waehrung === 'USD' ? '€\u00a0' : '';
    var lab = [{ v: ein, t: 'Einstand ' + e + nf(ein), u: 0 }, { v: be, t: 'Break-even ' + e + nf(be), u: 1 }]
      .concat(al.map(function (a) { return { v: num(a.wert), t: 'Alarm ' + nf(a.wert), u: 0 }; })).concat([{ v: jetzt, t: 'Jetzt ' + e + nf(jetzt), u: 1, c: 'jetzt' }]);
    [0, 1].forEach(function (u) {
      var enden = [];
      lab.filter(function (l) { return l.u === u; }).map(function (l) { return { t: l.t, c: l.c, x: Xp(l.v), w: l.t.length * 7.4 + 8 }; })
        .sort(function (a, b) { return a.x - b.x; }).forEach(function (l) {
          var cx = Math.min(W - l.w / 2 - 2, Math.max(l.w / 2 + 2, l.x)), k = 0;
          while (enden[k] !== undefined && cx - l.w / 2 < enden[k] + 6) k++;
          enden[k] = cx + l.w / 2;
          var ty = u ? Yl - 16 - k * 17 : Yl + 27 + k * 17;
          o += '<line class="strich" x1="' + l.x + '" x2="' + l.x + '" y1="' + (u ? ty + 4 : Yl) + '" y2="' + (u ? Yl : ty - 12) + '"/><text x="' + cx + '" y="' + ty + '" text-anchor="middle" class="' + (l.c || '') + '">' + l.t + '</text>';
        });
    });
    s.innerHTML = o + '<circle class="' + (minus ? 'punkt-neg' : 'punkt-pos') + '" cx="' + Xp(jetzt) + '" cy="' + Yl + '" r="7"/>';
  }

  /* ---------- Depot ---------- */
  function karte(p) {
    var id = esc(p.wertpapier_id), ke = num(p.kurs_eur), hatKurs = p.kurs !== null && p.kurs !== undefined, kz = S.kz[p.symbol] || {};
    var tag = hatKurs && num(p.vortag_eur) ? (ke / num(p.vortag_eur) - 1) * 100 : null, be = num(p.breakeven_eur), abst = be && ke ? (be / ke - 1) * 100 : null;
    var kopf = '<div class="hd"><div><h2>' + esc(p.name) + '</h2><div class="mut">' + [esc(p.isin), BOERSEN[p.boerse] || '', nf(p.stueck, num(p.stueck) % 1 ? 2 : 0) + ' Stück'].filter(Boolean).join(', ') + '</div></div>' +
      '<div class="px">' + (hatKurs ? '<b>' + L.geld(p.kurs, p.waehrung) + '</b><span class="mut">' + (p.waehrung === 'USD' ? 'in Euro ' + nf(ke) + ', ' : '') + (tag === null ? '' : '<span class="' + cls(tag) + '">' + pct(tag) + '</span> heute, ') + 'Stand ' + esc(L.zeit(p.kurs_zeit)) + '</span>' : '<span class="mut">Noch kein Kurs</span>') + '</div></div>';
    if (!hatKurs) return '<article class="card">' + kopf + '</article>';
    var sigma = num(kz.sigma_tag), s200 = num(kz.schnitt200);
    return '<article class="card">' + kopf +
      '<div class="spark"><svg data-zeichne="spark" data-id="' + id + '" role="img" aria-label="Kursverlauf heute"></svg></div>' +
      '<div class="lad"><svg data-zeichne="leiste" data-id="' + id + '" role="img" aria-label="Kurs im Vergleich zu Einstand, Break-even und Alarmen"></svg></div>' +
      (abst === null ? '' : '<p class="abstand">' + (abst > 0.004 ? 'Noch <b class="neg nw">' + pct(abst, false) + '</b> bis zum Break-even nach Spesen und KESt' : '<b class="pos nw">' + pct(-abst, false) + '</b> über dem Break-even, ein Verkauf wäre im Plus') + '</p>') +
      '<dl class="kv"><div><dt>Kurswert</dt><dd>' + eur(p.wert_eur) + '</dd></div>' +
      '<div><dt>Seit Kauf inkl. Spesen</dt><dd class="' + cls(p.gv_eur) + '">' + eur(p.gv_eur, 1) + '</dd></div>' +
      '<div><dt>Einstand' + (p.waehrung === 'USD' ? ' in Euro' : '') + '</dt><dd>' + eur(p.einstand) + '</dd></div><div><dt>Break-even' + (p.waehrung === 'USD' ? ' in Euro' : '') + '</dt><dd>' + eur(be) + '</dd></div>' +
      '<div class="ganz"><dt>Wenn du jetzt verkaufst, nach Spesen' + (kond().depot_einrechnen === false ? '' : ', Depotgebühr') + ' und KESt</dt><dd class="' + cls(p.netto_jetzt_eur) + '">' + eur(p.netto_jetzt_eur, 1) + '</dd></div></dl>' +
      '<details class="mehr" data-offen="' + id + '"' + (S.offen[id] ? ' open' : '') + '><summary>Mehr Zahlen</summary><dl class="kv">' +
      '<div><dt>Kaufspesen</dt><dd>' + eur(p.kaufspesen_eur) + '</dd></div><div><dt>Verkaufsspesen jetzt</dt><dd>' + eur(p.verkaufsspesen_eur) + '</dd></div>' +
      '<div><dt>Depotgebühr seit Kauf, ca.</dt><dd>' + eur(p.depotgebuehr_eur) + '</dd></div><div><dt>Im Depot seit</dt><dd>' + esc(L.datum(p.erster_kauf)) + '</dd></div>' +
      (sigma ? '<div><dt>Übliche Schwankung am Tag</dt><dd>±' + nf(sigma * 100, 1) + ' %</dd></div>' : '') +
      (s200 ? '<div><dt>200-Tage-Schnitt</dt><dd>' + L.geld(s200, p.waehrung) + (num(p.kurs) >= s200 ? ', Kurs liegt darüber' : ', Kurs liegt darunter') + '</dd></div>' : '') +
      (kz.hoch52 ? '<div class="ganz"><dt>Spanne der letzten 12 Monate</dt><dd>' + L.geld(kz.tief52, p.waehrung) + ' bis ' + L.geld(kz.hoch52, p.waehrung) + '</dd></div>' : '') +
      '</dl></details>' +
      (inhaber() ? '<div class="reihe"><button type="button" data-act="order" data-art="verkauf" data-wid="' + id + '">Verkauf eintragen</button><button type="button" data-act="order" data-art="kauf" data-wid="' + id + '">Nachkauf eintragen</button></div>' : '') +
      '</article>';
  }
  function vDepot() {
    var s = summen(), pos = bestand(), alt = veraltet(), tag = s.vortag ? s.heute / s.vortag * 100 : null;
    var beob = S.pos.filter(function (p) { return !(num(p.stueck) > 0) && p.beobachten; });
    var bz = L.boersen(new Date());
    return {
      band: '<div class="oben"><h1>Depot</h1><button type="button" class="rund' + (S.dreht ? ' dreht' : '') + '" data-act="aktualisieren" aria-label="Kurse jetzt aktualisieren"><svg viewBox="0 0 24 24">' + IC.neu + '</svg></button></div>' +
        '<div class="gross">' + eur(s.wert) + '</div>' +
        (pos.length ? '<div class="zeile"><span class="chip">' + eur(s.gv, 1) + ' / ' + pct(s.kosten ? s.gv / s.kosten * 100 : 0) + '</span><span>seit Kauf inkl. Spesen</span></div>' +
          (tag === null ? '' : '<div class="zeile"><span>Heute ' + eur(s.heute, 1) + ' (' + pct(tag) + ')</span></div>') : '') +
        '<div class="zeile"><span>' + esc(L.boersenKurz(bz)) + '</span></div>',
      main: (alt ? '<p class="hinweis warn">' + esc(alt) + '</p>' : '') +
        (inhaber() ? '' : '<p class="hinweis">Du liest mit. Orders, Alarme und Konditionen ändert nur der Inhaber des Depots.</p>') +
        (pos.length ? pos.map(karte).join('') : '<div class="card"><h3>Noch keine Position</h3><p class="mut" style="margin:0">' + (inhaber() ? 'Lies unten eine Abrechnung aus George ein oder trag einen Kauf von Hand ein.' : 'Sobald ein Kauf eingetragen ist, erscheint er hier.') + '</p></div>') +
        '<section class="card"><h3>Handelszeiten in Wiener Zeit</h3>' + bz.map(function (b) {
          var wann = b.wann ? b.wann.charAt(0).toUpperCase() + b.wann.slice(1) + ' ' : '';
          return '<div class="eintrag"><div><b>' + esc(b.name) + '</b>' + (b.zusatz ? ' <span class="mut">' + esc(b.zusatz) + '</span>' : '') +
            '<div class="mut">' + esc(wann + b.zeiten) + '</div></div>' +
            '<div class="rechts"><span class="status' + (b.offen ? ' an' : '') + '">' + (b.offen ? 'offen' : 'geschlossen') + '</span></div></div>';
        }).join('') +
        '<details class="mehr" data-offen="zeiten"' + (S.offen.zeiten ? ' open' : '') + '><summary>Genauer</summary><p class="mut" style="margin:8px 0 0">' +
          'Wien: Eröffnungsauktion ab 8:55, fortlaufender Handel bis 17:30, Schlussauktion bis 17:35. ' +
          'Xetra: Haupthandel 9:00 bis 17:30, danach Schlussauktion. Für Privatanleger gibt es dort zusätzlich Früh- und Späthandel von 8:00 bis 22:00, wenn die Bank ihn anbietet. ' +
          'New York: Haupthandel 9:30 bis 16:00 Ortszeit. George leitet Aufträge Montag bis Freitag von 7:30 bis 22:00 an die Börse weiter, spätere Aufträge am nächsten Handelstag.</p>' +
          '<p class="mut" style="margin:8px 0 0">Feiertage, verkürzte Tage und die Zeitumstellung in den USA sind eingerechnet. Für den 30. Dezember gilt der frühe Schluss des Vorjahres, bis die Börsen ihn bestätigen.</p></details></section>' +
        (beob.length || inhaber() ? '<section class="card"><h3>Beobachtungsliste</h3>' +
          (beob.length ? beob.map(function (p) {
            var t = p.kurs !== null && p.kurs !== undefined && num(p.vortag_eur) ? (num(p.kurs_eur) / num(p.vortag_eur) - 1) * 100 : null;
            return '<div class="eintrag"><div><b>' + esc(p.name) + '</b><div class="mut">' + esc(BOERSEN[p.boerse] || '') + (p.kurs_zeit ? ', Stand ' + esc(L.zeit(p.kurs_zeit)) : '') + '</div></div>' +
              '<div class="rechts"><span class="nw" style="text-align:right"><b>' + (p.kurs === null || p.kurs === undefined ? 'Kein Kurs' : L.geld(p.kurs, p.waehrung)) + '</b>' + (t === null ? '' : '<br><span class="' + cls(t) + '">' + pct(t) + '</span>') + '</span>' +
              (inhaber() ? '<button type="button" class="klein" data-act="beob-weg" data-id="' + esc(p.wertpapier_id) + '" aria-label="' + esc(p.name) + ' von der Beobachtungsliste nehmen">Entfernen</button>' : '') + '</div></div>';
          }).join('') : '<p class="mut" style="margin:0">Aktien, die du im Auge behalten willst, ohne sie zu besitzen. Für sie gelten dieselben Kurswarnungen.</p>') +
          (inhaber() ? '<div class="reihe"><button type="button" data-act="beob">Aktie beobachten</button></div>' : '') + '</section>' : '') +
        (inhaber() ? '<section class="card"><h3>Order eintragen</h3><p class="mut" style="margin-top:0">Nach jedem Kauf oder Verkauf in George: Abrechnung als PDF einlesen oder die Order von Hand eintragen.</p>' +
          '<label for="pdf-in">Abrechnung aus George (PDF)<input type="file" id="pdf-in" accept="application/pdf,.pdf"></label>' +
          '<div class="reihe"><button type="button" data-act="order" data-art="kauf">Von Hand eintragen</button></div></section>' : '') +
        '<p class="note">Kurse aus Wien und von Xetra kommen etwa 15 Minuten verzögert, US-Kurse fast in Echtzeit. Die App rechnet und warnt, sie ist keine Anlageberatung.</p>'
    };
  }

  /* ---------- Rechner ---------- */
  function rechne(boerse) {
    var r = S.rechner;
    return L.rechner({ betrag: r.betrag, boerse: boerse || r.boerse, wochen: r.wochen, ziel: r.ziel, depotwert: summen().wert, genutzt: S.genutzt, k: kond() });
  }
  function vRechner() {
    var r = S.rechner;
    return {
      breit: true,
      band: '<h1>Spesenrechner</h1><p>Was Kauf und späterer Verkauf kosten und wie weit der Kurs steigen muss.</p>',
      main: '<div class="rechner"><section class="card"><p class="feld">Börse</p><div class="seg" role="group" aria-label="Börse">' +
        ['WIEN', 'XETRA', 'NYSE', 'NASDAQ'].map(function (b) { return '<button type="button" data-boerse="' + b + '" aria-pressed="' + (r.boerse === b) + '">' + BOERSEN[b] + '</button>'; }).join('') + '</div>' +
        '<label for="r-betrag" class="mt">Betrag (Kurswert) €<input id="r-betrag" type="number" min="0" step="100" inputmode="decimal" value="' + esc(r.betrag) + '"></label>' +
        '<div class="betraege">' + [1000, 2000, 5000, 10000, 20000].map(function (a) { return '<button type="button" data-betrag="' + a + '">' + nf(a, 0) + '</button>'; }).join('') + '</div>' +
        '<label for="r-wochen" class="mt">Haltedauer: <b id="r-wochen-t"></b><input id="r-wochen" type="range" min="1" max="26" step="1" value="' + esc(r.wochen) + '"></label>' +
        '<label for="r-ziel" class="mt">Angenommener Kursanstieg: <b id="r-ziel-t"></b><input id="r-ziel" type="range" min="0.5" max="20" step="0.5" value="' + esc(r.ziel) + '"></label></section>' +
        '<section class="card" id="r-aus" aria-live="polite"></section></div>' +
        '<section class="card"><h3>Gleicher Betrag an anderen Börsen</h3><div class="rollen"><table id="r-tab"></table></div><p class="mut" style="margin-bottom:0">USA inklusive Devisenprovision für Hin- und Rücktausch. Die Spesen für Xetra und USA sind Schätzwerte, bis die erste Abrechnung von dort vorliegt.</p></section>',
      nach: rechnerAus
    };
  }
  function rechnerAus() {
    var r = S.rechner, k = kond(), x = rechne(), minus = x.netto < 0, wo = r.wochen + (num(r.wochen) === 1 ? ' Woche' : ' Wochen');
    if (!$('#r-aus')) return;
    $('#r-wochen-t').textContent = wo; $('#r-ziel-t').textContent = pct(r.ziel);
    var teile = [['Spesen Kauf und Verkauf', x.kauf + x.verkauf, 't1'], ['Depotgebühr anteilig', x.dep, 't2'], ['KESt ' + nf(k.kest, 1) + ' %', x.steuer, 't3'], [minus ? 'Ergebnis' : 'Bleibt dir', x.netto, 't4']];
    $('#r-aus').innerHTML = '<p class="mut" style="margin:0">Nötiger Kursanstieg, damit du nach Spesen' + (k.depot_einrechnen === false ? '' : ', Depotgebühr') + ' und KESt bei null bist</p><div class="ergebnis">' + pct(x.noetig) + '</div>' +
      '<p style="margin:0">Bei ' + pct(r.ziel) + ' in ' + wo + ' sind das ' + eur(x.gewinn) + ' Kursgewinn. ' + (minus ? 'Es bleibt ein <b class="neg">Verlust von ' + eur(-x.netto) + '</b>.' : 'Davon bleiben dir <b class="pos">' + eur(x.netto) + '</b>.') + '</p>' +
      '<div class="balken" role="img" aria-label="Aufteilung des Kursgewinns">' + (minus ? '<span class="t1" style="width:100%"></span>' : teile.map(function (t) { return '<span class="' + t[2] + '" style="width:' + (x.gewinn > 0 ? Math.max(0, t[1]) / x.gewinn * 100 : 0) + '%"></span>'; }).join('')) + '</div>' +
      '<div class="legende">' + teile.map(function (t) { return '<i class="' + t[2] + '"></i><span>' + t[0] + '</span><b class="' + (t[2] === 't4' ? cls(t[1]) : '') + '">' + eur(t[1]) + '</b>'; }).join('') + '</div>' +
      '<p class="mut mt" style="margin-bottom:0">Freikontingent ' + new Date().getFullYear() + ': ' + nf(S.genutzt, 0) + ' von ' + nf(k.frei, 0) + ' Orders genutzt. Der Kauf wäre Nr. ' + x.nb + ', der Verkauf Nr. ' + x.ns +
      (x.ns > k.frei ? '. Ab Nr. ' + (num(k.frei) + 1) + ' kostet jede Order ' + eur(k.eigen_fix) + ' plus ' + nf(k.eigen_pct) + ' %.' : ', beide ohne Bankentgelt, nur fremde Spesen.') + '</p>' +
      '<div class="kontingent"><i style="width:' + Math.min(100, k.frei ? S.genutzt / k.frei * 100 : 100) + '%"></i></div>';
    $('#r-tab').innerHTML = '<thead><tr><th>Börse</th><th>Kauf und Verkauf</th><th>Nötiger Anstieg</th></tr></thead><tbody>' +
      [['Wien', 'WIEN'], ['Xetra', 'XETRA'], ['USA', 'NYSE']].map(function (z) {
        var y = rechne(z[1]), da = z[1] === r.boerse || (z[1] === 'NYSE' && r.boerse === 'NASDAQ');
        return '<tr' + (da ? ' class="gewaehlt"' : '') + '><td>' + z[0] + '</td><td>' + eur(y.hinZurueck) + '</td><td>' + pct(y.noetig) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  /* ---------- Alarme ---------- */
  function alarmText(a, p) {
    var kz = (p && S.kz[p.symbol]) || {}, w = p && p.waehrung;
    if (a.art === 'unter') return 'Kurs fällt unter ' + L.geld(a.wert, w);
    if (a.art === 'ueber') return 'Kurs steigt über ' + L.geld(a.wert, w);
    if (a.art === 'breakeven') return 'Break-even wird erreicht' + (p && p.breakeven_eur ? ', derzeit bei ' + eur(p.breakeven_eur) : '');
    if (a.art === 'verlust') return 'Verlust seit Kauf übersteigt ' + eur(a.wert);
    var auto = a.wert === null || a.wert === undefined, s = a.art === 'tagessturz' ? L.schwelleTag(num(kz.sigma_tag)) : L.schwelleWoche(num(kz.sigma_tag));
    return (a.art === 'tagessturz' ? 'Sturz an einem Tag um ' : 'Rutsch über 5 Handelstage um ') + nf(auto ? s : a.wert, 1) + '\u00a0% oder mehr' + (auto ? '<div class="mut">Schwelle folgt der Schwankung der Aktie</div>' : '');
  }
  function vAlarme() {
    var zeilen = S.pos.map(function (p) {
      var al = S.alarme.filter(function (a) { return String(a.wertpapier_id) === String(p.wertpapier_id); });
      if (!al.length) return '';
      return '<h4>' + esc(p.name) + '</h4>' + al.map(function (a) {
        var fest = a.art !== 'tagessturz' && a.art !== 'wochenrutsch';
        return '<div class="eintrag"><div>' + alarmText(a, p) +
          (a.ausgeloest_am ? '<div class="ausgeloest">' + (fest ? 'Ausgelöst ' : 'Zuletzt ausgelöst ') + esc(L.zeit(a.ausgeloest_am)) + (a.ausgeloest_kurs ? ' bei ' + L.geld(a.ausgeloest_kurs, p.waehrung) : '') + '</div>' : '') +
          (!inhaber() && !a.aktiv ? '<div class="mut">ausgeschaltet</div>' : '') + '</div>' +
          (inhaber() ? '<div class="rechts">' + (a.ausgeloest_am && fest ? '<button type="button" class="klein" data-act="scharf" data-id="' + esc(a.id) + '">Wieder scharf</button>' : '<label class="haken klein"><input type="checkbox" data-aktiv="' + esc(a.id) + '"' + (a.aktiv ? ' checked' : '') + '>an</label>') +
            '<button type="button" class="klein" data-act="alarm-weg" data-id="' + esc(a.id) + '" aria-label="Warnung löschen">Löschen</button></div>' : '') + '</div>';
      }).join('');
    }).join('');
    var alle = S.pos, push = { an: 'Mitteilungen sind auf diesem Gerät eingeschaltet.', aus: 'Auf diesem Gerät kommen noch keine Mitteilungen an.', gesperrt: 'Mitteilungen sind für diese App in den Einstellungen des Geräts gesperrt.', fehlt: 'Dieses Gerät kann so keine Mitteilungen empfangen. Auf dem iPhone: die App über „Teilen“ zum Home-Bildschirm hinzufügen und von dort öffnen.', unbekannt: 'Prüfe Mitteilungen …' }[S.push];
    return {
      band: '<h1>Alarme</h1><p>Warnungen kommen als Mitteilung auf jedes Handy, das sich dafür anmeldet.</p>',
      main: '<section class="card"><h3>Mitteilungen</h3><p style="margin:0">' + push + '</p><div class="reihe">' +
        (S.push === 'aus' ? '<button type="button" class="pri" data-act="push-an">Mitteilungen einschalten</button>' : '') +
        (S.push === 'an' ? '<button type="button" data-act="push-probe">Probe schicken</button>' : '') + '</div></section>' +
        '<section class="card warnungen"><h3>Warnungen</h3>' + (zeilen || '<p class="mut" style="margin:0">Noch keine Warnung eingerichtet.</p>') + '</section>' +
        (inhaber() && alle.length ? '<section class="card"><h3>Neue Warnung</h3><form id="alarmform" class="zwei" novalidate>' +
          '<label class="ganz" for="a-wid">Aktie<select id="a-wid">' + alle.map(function (p) { return '<option value="' + esc(p.wertpapier_id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
          '<label class="ganz" for="a-art">Warnen, wenn<select id="a-art">' + Object.keys(ARTEN).map(function (k) { return '<option value="' + k + '">' + ARTEN[k] + '</option>'; }).join('') + '</select></label>' +
          '<label class="ganz" for="a-wert"><span id="a-wert-t">Kurs</span><input id="a-wert" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
          '<p class="ganz fehler" id="a-fehler" aria-live="polite"></p><div class="ganz"><button class="pri" type="submit">Warnung anlegen</button></div></form></section>' : '') +
        '<section class="card" id="meldungen"><h3>Letzte Meldungen</h3>' + (S.meldungen.length ? S.meldungen.map(function (m) {
          return '<div class="eintrag"><div><b>' + esc(m.titel) + '</b><div>' + esc(m.text) + '</div><div class="mut">' + esc(L.zeit(m.zeit)) + '</div></div></div>';
        }).join('') : '<p class="mut" style="margin:0">Bisher hat keine Warnung ausgelöst.</p>') + '</section>',
      nach: function () {
        var neuste = S.meldungen[0] ? S.meldungen[0].id : 0;
        try { localStorage.setItem('aktien:gesehen', String(neuste)); } catch (e) { /* egal */ }
        if (S.push === 'unbekannt') pushStand().then(function (st) { S.push = st; if (S.view === 'alarme') render(); });
      }
    };
  }
  function ungelesen() {
    var g = 0; try { g = Number(localStorage.getItem('aktien:gesehen')) || 0; } catch (e) { /* egal */ }
    return !!S.meldungen[0] && S.meldungen[0].id > g;
  }

  /* ---------- Mehr: Konditionen, Buchungen, Konto ---------- */
  var FELDER = [
    ['Freikontingent', [['frei', 'Orders ohne Bankentgelt pro Jahr'], ['_genutzt', 'Davon heuer schon genutzt']], 'Bis zu dieser Zahl fallen nur fremde Spesen an. Die App zählt jede eingetragene Order mit; stimmt der Stand nicht, hier richtigstellen.'],
    ['Bankentgelt über dem Freikontingent', [['eigen_fix', 'Fix €'], ['eigen_pct', '% vom Kurswert']], ''],
    ['Fremde Spesen Wien', [['wien_fix', 'Fix €'], ['wien_pct', '% vom Kurswert']], 'Bestätigt durch die Abrechnung vom 18.09.2026.'],
    ['Fremde Spesen Xetra', [['xetra_fix', 'Fix €'], ['xetra_pct', '% vom Kurswert'], ['xetra_min', 'Mindestens €']], 'Schätzwert, bis die erste Abrechnung von Xetra vorliegt.'],
    ['USA (NYSE, NASDAQ)', [['us_fix', 'Fremde Spesen fix €'], ['us_pct', '% vom Kurswert'], ['devisen', 'Devisenprovision je Umtausch €']], 'Schätzwerte, bis die erste US-Abrechnung vorliegt.'],
    ['Depotführung', [['depot_pct', '% pro Monat vom Depotwert'], ['depot_min', 'Mindestens € pro Monat'], ['ust', 'Umsatzsteuer %']], ''],
    ['Steuer', [['kest', 'KESt %']], 'Spesen und Depotgebühr senken die KESt nicht: Im Privatvermögen zählt nur die Differenz zwischen Kauf- und Verkaufskurs.']
  ];
  function vMehr() {
    var k = kond(), ro2 = inhaber() ? '' : ' disabled', dv = summen().wert, m = L.depotMonat(dv, k);
    var kondHtml = FELDER.map(function (f) {
      return '<h3 class="mt">' + f[0] + '</h3><div class="zwei">' + f[1].map(function (x) {
        var v = x[0] === '_genutzt' ? S.genutzt : k[x[0]];
        return '<label for="k-' + x[0] + '">' + x[1] + '<input id="k-' + x[0] + '" type="number" step="any" min="0" inputmode="decimal" data-k="' + x[0] + '" value="' + esc(v) + '"' + ro2 + '></label>';
      }).join('') + '</div>' + (f[0] === 'Depotführung' && dv > 0 ? '<p class="mut" style="margin-bottom:0">Beim heutigen Depotwert sind das ca. ' + eur(m) + ' im Monat und ' + eur(m * 12) + ' im Jahr.</p>' : '') + (f[2] ? '<p class="mut" style="margin-bottom:0">' + f[2] + '</p>' : '');
    }).join('');
    var buch = S.trades.map(function (t) {
      var p = wp(t.wertpapier_id);
      return '<div class="eintrag"><div><b>' + (t.art === 'kauf' ? 'Kauf' : 'Verkauf') + ' ' + esc(p ? p.name : '') + '</b><div>' + nf(t.stueck, num(t.stueck) % 1 ? 2 : 0) + ' Stück zu ' + L.geld(t.kurs, t.waehrung) + ', Spesen ' + eur(t.spesen_eur) + (num(t.kest_eur) ? ', KESt ' + eur(t.kest_eur) : '') + '</div>' +
        '<div class="mut">' + esc(L.datum(t.datum)) + (t.quelle === 'pdf' ? ', aus Abrechnung' : ', von Hand') + (t.auftragsnr ? ', Auftrag ' + esc(t.auftragsnr) : '') + '</div></div>' +
        (inhaber() ? '<div class="rechts"><button type="button" class="klein" data-act="trade-weg" data-id="' + esc(t.id) + '">Löschen</button></div>' : '') + '</div>';
    }).join('');
    return {
      band: '<h1>Mehr</h1><p>Konditionen, Buchungen und dein Zugang.</p>',
      main: '<section class="card"><h2>Konditionen</h2><p class="mut" style="margin:4px 0 10px">' + esc(k.fassung || '') + '</p>' +
        '<p style="margin:0">Freikontingent ' + new Date().getFullYear() + ': ' + nf(S.genutzt, 0) + ' von ' + nf(k.frei, 0) + ' Orders genutzt, ' + nf(Math.max(0, num(k.frei) - S.genutzt), 0) + ' frei.</p>' +
        '<div class="kontingent"><i style="width:' + Math.min(100, k.frei ? S.genutzt / k.frei * 100 : 100) + '%"></i></div>' +
        '<details class="mehr" data-offen="kond"' + (S.offen.kond ? ' open' : '') + '><summary>' + (inhaber() ? 'Alle Sätze ansehen und ändern' : 'Alle Sätze ansehen') + '</summary><form id="kondform" novalidate>' + kondHtml +
        '<label class="haken mt" for="k-dep"><input type="checkbox" id="k-dep"' + (k.depot_einrechnen === false ? '' : ' checked') + ro2 + '>Depotgebühr in Break-even und Rechner einrechnen</label>' +
        (inhaber() ? '<div class="reihe"><button class="pri" type="submit">Konditionen speichern</button></div>' : '') + '</form></details></section>' +
        '<section class="card"><h2>Buchungen</h2>' + (buch || '<p class="mut" style="margin:8px 0 0">Noch keine Order eingetragen.</p>') + '</section>' +
        '<section class="card"><h2>Zugang</h2><p style="margin:8px 0 0">Angemeldet als ' + esc(S.sitzung.user.email || '') + (inhaber() ? '' : ', nur lesen') + '.</p>' +
        '<div class="reihe"><button type="button" data-act="passwort">Passwort ändern</button><button type="button" data-act="abmelden">Abmelden</button></div>' +
        '<p class="mut" style="margin-bottom:0">Version ' + VERSION + '</p></section>'
    };
  }

  /* ---------- Rahmen ---------- */
  var VIEWS = { depot: vDepot, rechner: vRechner, alarme: vAlarme, mehr: vMehr };
  var MARKE = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#0b5d63"/><path d="M8 20h24" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/><path d="M14 20v6M28 20v-7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="21" cy="20" r="4.2" fill="#fff"/></svg>';
  function tabs() {
    var t = [['depot', 'Depot'], ['rechner', 'Rechner'], ['alarme', 'Alarme'], ['mehr', 'Mehr']];
    return '<nav class="tabs" aria-label="Bereiche"><div class="wrap innen">' + t.map(function (x) {
      return '<a href="#' + x[0] + '"' + (S.view === x[0] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24">' + IC[x[0]] + '</svg>' + x[1] + (x[0] === 'alarme' && S.view !== 'alarme' && ungelesen() ? '<span class="neu" aria-label="Neue Meldung"></span>' : '') + '</a>';
    }).join('') + '</div></nav>';
  }
  function render() {
    ro.disconnect();
    if (!S.sitzung) {
      app.innerHTML = '<header class="band"><div class="wrap"><div class="marke">' + MARKE + '<h1>Aktien</h1></div><p>Depot, Break-even und Warnungen an einem Ort.</p></div></header>' +
        '<main class="anmelden"><form id="loginform" class="card" novalidate><h2>Anmelden</h2>' +
        '<label class="mt" for="l-mail">E-Mail<input id="l-mail" type="email" autocomplete="username" required></label>' +
        '<label class="mt" for="l-pw">Passwort<input id="l-pw" type="password" autocomplete="current-password" required></label>' +
        '<p class="fehler mt" id="l-fehler" aria-live="polite"></p><div class="reihe"><button class="pri" type="submit">Anmelden</button></div></form></main>';
      return;
    }
    if (!S.geladen) { app.innerHTML = '<p class="lade">' + (S.fehler ? esc(S.fehler) + '<br><button type="button" class="mt" data-act="neu-laden">Noch einmal versuchen</button>' : 'Lade …') + '</p>'; return; }
    if (!S.me) {
      app.innerHTML = '<header class="band"><div class="wrap"><h1>Kein Zugang</h1><p>Dieses Konto ist für die Aktien-App nicht freigeschaltet.</p></div></header><main class="wrap"><div class="reihe"><button type="button" data-act="abmelden">Abmelden</button></div></main>';
      return;
    }
    var v = (VIEWS[S.view] || vDepot)(), breit = v.breit ? ' breit' : '', y = window.scrollY;
    app.innerHTML = '<header class="band"><div class="wrap' + breit + '">' + v.band + '</div></header><main class="wrap' + breit + '">' + v.main + '</main>' + tabs();
    app.querySelectorAll('svg[data-zeichne]').forEach(function (s) { ro.observe(s); });
    if (v.nach) v.nach();
    window.scrollTo(0, y);
  }
  function route() {
    var h = (location.hash || '#depot').slice(1);
    if (h === 'meldungen') { S.view = 'alarme'; render(); var m = $('#meldungen'); if (m) m.scrollIntoView(); return; }
    if (h === 'geteilt') { history.replaceState(null, '', '#depot'); S.view = 'depot'; render(); geteilt(); return; }
    S.view = VIEWS[h] ? h : 'depot'; render(); window.scrollTo(0, 0);
  }

  /* ---------- Order eintragen (Blatt) ---------- */
  function oeffne(html) {
    if (!blatt) { blatt = document.createElement('dialog'); blatt.className = 'blatt'; document.body.appendChild(blatt); blatt.addEventListener('close', function () { S.order = null; S.beob = null; }); }
    blatt.innerHTML = '<div class="innen">' + html + '</div>';
    if (!blatt.open) blatt.showModal();
  }
  function schliesse() { if (blatt && blatt.open) blatt.close(); }
  function orderBlatt() {
    var o = S.order, p = o.wid && o.wid !== 'neu' ? wp(o.wid) : null, usd = (p && p.waehrung === 'USD') || o.waehrung === 'USD', z = usd ? '$' : '€';
    var hinw = o.quelle === 'pdf' ? (o.hinweise.length ? '<p class="neg" style="margin:0 0 10px">Bitte prüfen: ' + esc(o.hinweise.join(' ')) + '</p>' : '<p class="pos" style="margin:0 0 10px">Aus der Abrechnung gelesen und geprüft: Stück mal Kurs plus Spesen ergibt den Endbetrag.</p>') : '';
    oeffne('<form id="orderform" novalidate><div class="kopf"><h2>Order eintragen</h2><button type="button" class="klein" data-act="blatt-zu">Schließen</button></div>' + hinw +
      '<div class="seg" role="group" aria-label="Art der Order"><button type="button" data-oart="kauf" aria-pressed="' + (o.art === 'kauf') + '">Kauf</button><button type="button" data-oart="verkauf" aria-pressed="' + (o.art === 'verkauf') + '">Verkauf</button></div>' +
      '<label class="mt" for="o-wid">Wertpapier<select id="o-wid" data-o="wid">' + S.pos.map(function (x) { return '<option value="' + esc(x.wertpapier_id) + '"' + (String(o.wid) === String(x.wertpapier_id) ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
      '<option value="neu"' + (o.wid === 'neu' ? ' selected' : '') + '>Anderes Wertpapier suchen …</option></select></label>' +
      (o.wid === 'neu' ? '<div class="reihe"><label class="wachs" for="o-such">Name, ISIN oder Kürzel<input id="o-such" data-o="such" value="' + esc(o.such) + '"></label><button type="button" data-act="suchen">Suchen</button></div>' +
        '<div id="o-treffer">' + (o.treffer ? (o.treffer.length ? '<p class="mut mt" style="margin-bottom:6px">Wähle den Handelsplatz, an dem du gehandelt hast: Kürzel mit .VI ist Wien, mit .DE Xetra, ohne Endung USA.</p>' + o.treffer.map(function (t, i) {
          return '<label class="treffer"><input type="radio" name="o-symbol" value="' + i + '"' + (o.symbol === t.symbol ? ' checked' : '') + '><span><b>' + esc(t.name || t.symbol) + '</b><br><span class="mut">' + esc(t.symbol) + ', ' + esc(t.boerse || '') + '</span></span></label>';
        }).join('') : '<p class="mut">Nichts gefunden. Versuch es mit der ISIN.</p>') : '') + '</div>' : '') +
      '<div class="zwei mt"><label for="o-datum">Datum<input id="o-datum" type="date" data-o="datum" value="' + esc(o.datum) + '"></label>' +
      '<label for="o-stueck">Stück<input id="o-stueck" type="number" min="0" step="any" inputmode="decimal" data-o="stueck" value="' + esc(o.stueck) + '"></label>' +
      '<label for="o-kurs">Kurs ' + z + '<input id="o-kurs" type="number" min="0" step="any" inputmode="decimal" data-o="kurs" value="' + esc(o.kurs) + '"></label>' +
      '<label for="o-spesen">Spesen €<input id="o-spesen" type="number" min="0" step="any" inputmode="decimal" data-o="spesen" value="' + esc(o.spesen) + '" placeholder="leer = schätzen"></label>' +
      (usd ? '<label class="ganz" for="o-kwe">Kurswert in Euro laut Abrechnung<input id="o-kwe" type="number" min="0" step="any" inputmode="decimal" data-o="kurswert" value="' + esc(o.kurswert) + '" placeholder="leer = heutiger Wechselkurs"></label>' : '') +
      (o.art === 'verkauf' ? '<label class="ganz" for="o-kest">Einbehaltene KESt € laut Abrechnung<input id="o-kest" type="number" min="0" step="any" inputmode="decimal" data-o="kest" value="' + esc(o.kest) + '" placeholder="leer = 0"></label>' : '') + '</div>' +
      '<p class="fehler mt" id="o-fehler" aria-live="polite"></p><div class="reihe"><button class="pri" type="submit" id="o-ok">Speichern</button></div></form>');
  }
  function orderNeu(vor) {
    var erste = bestand()[0] || S.pos[0];
    S.order = Object.assign({ art: 'kauf', wid: erste ? erste.wertpapier_id : 'neu', datum: L.heute(), stueck: '', kurs: '', spesen: '', kest: '', kurswert: '', such: '', treffer: null, symbol: '', isin: '', branche: '', waehrung: '', auftragsnr: null, ausfuehrung_nr: null, uhrzeit: null, endbetrag: null, quelle: 'hand', hinweise: [] }, vor || {});
    orderBlatt();
  }
  function beobBlatt() {
    var b = S.beob;
    oeffne('<form id="beobform" novalidate><div class="kopf"><h2>Aktie beobachten</h2><button type="button" class="klein" data-act="blatt-zu">Schließen</button></div>' +
      '<div class="reihe" style="margin-top:0"><label class="wachs" for="b-such">Name, ISIN oder Kürzel<input id="b-such" value="' + esc(b.such) + '"></label><button type="submit">Suchen</button></div>' +
      (b.treffer ? (b.treffer.length ? '<p class="mut mt" style="margin-bottom:0">Wähle den Handelsplatz, an dem du kaufen würdest: Kürzel mit .VI ist Wien, mit .DE Xetra, ohne Endung USA.</p>' + b.treffer.map(function (t, i) {
        return '<div class="treffer"><span><b>' + esc(t.name || t.symbol) + '</b><br><span class="mut">' + esc(t.symbol) + ', ' + esc(t.boerse || '') + '</span></span><button type="button" class="klein" data-act="beob-neu" data-i="' + i + '">Beobachten</button></div>';
      }).join('') : '<p class="mut mt">Nichts gefunden. Versuch es mit der ISIN.</p>') : '') + '</form>');
    var f = $('#b-such'); if (f && !b.treffer) f.focus();
  }
  /* Bei einer neuen Aktie den Handelsplatz vorschlagen, der zur ISIN passt */
  function bester(treffer, isin) {
    var land = (isin || '').slice(0, 2), ende = land === 'AT' ? '.VI' : land === 'DE' ? '.DE' : null;
    var t = treffer.find(function (x) { return ende ? x.symbol.endsWith(ende) : land === 'US' ? x.symbol.indexOf('.') < 0 : false; }) || treffer[0];
    return t || null;
  }
  async function pdfEinlesen(file) {
    toast('Lese Abrechnung …');
    try {
      var a = await Abrechnung.lesen(file);
      if (a.auftragsnr && S.trades.some(function (t) { return t.auftragsnr === a.auftragsnr; })) { toast('Diese Abrechnung ist schon eingetragen.'); return; }
      var da = S.pos.find(function (p) { return p.isin === a.isin; });
      var vor = { art: a.art, datum: a.datum, stueck: a.stueck, kurs: runden(a.kurs * 10000) / 10000, spesen: a.spesen_eur, kest: a.kest_eur || '', kurswert: isFinite(a.kurswert_eur) ? a.kurswert_eur : '', isin: a.isin, waehrung: a.waehrung,
        auftragsnr: a.auftragsnr, ausfuehrung_nr: a.ausfuehrung_nr, uhrzeit: a.uhrzeit, endbetrag: a.endbetrag_eur, quelle: 'pdf', hinweise: a.hinweise };
      if (da) vor.wid = da.wertpapier_id;
      else {
        vor.wid = 'neu'; vor.such = a.isin; vor.treffer = await q(sb.rpc('suche', { q: a.isin }));
        var b = bester(vor.treffer, a.isin); if (b) { vor.symbol = b.symbol; vor.branche = b.branche || ''; }
      }
      $('#toast').hidden = true;
      orderNeu(vor);
    } catch (e) {
      var k = e && e.message;
      toast(k === 'keinpdf' ? 'Das ist keine PDF-Datei.' : k === 'format' ? 'Die Datei sieht nicht wie eine Wertpapierabrechnung aus George aus.' : k === 'gross' ? 'Die Datei ist zu groß.' : 'Die Abrechnung konnte nicht gelesen werden. Trag die Order bitte von Hand ein.');
    }
  }
  async function orderSpeichern() {
    var o = S.order, err = function (t) { $('#o-fehler').textContent = t; $('#o-ok').disabled = false; };
    var st = num(o.stueck), ku = num(o.kurs), wid = o.wid;
    if (!(st > 0) || !(ku > 0) || !o.datum) return err('Bitte Datum, Stück und Kurs ausfüllen.');
    if (wid === 'neu' && !o.symbol) return err('Bitte ein Wertpapier suchen und aus den Treffern wählen.');
    $('#o-ok').disabled = true;
    try {
      if (wid === 'neu') { wid = await q(sb.rpc('wertpapier_anlegen', { p_symbol: o.symbol, p_isin: o.isin || null, p_branche: o.branche || null })); await laden(true); o.wid = wid; o.treffer = null; }
      var p = wp(wid);
      if (!p) return err('Das Wertpapier wurde nicht gefunden. Bitte noch einmal versuchen.');
      if (o.art === 'verkauf' && st > num(p.stueck) + 1e-9) return err('Im Depot liegen nur ' + nf(p.stueck, 0) + ' Stück.');
      var fx = p.waehrung === 'USD' && num(p.kurs_eur) > 0 ? num(p.kurs) / num(p.kurs_eur) : 0;
      var kwe = p.waehrung === 'USD' ? (num(o.kurswert) || (fx ? st * ku / fx : 0)) : st * ku;
      if (!(kwe > 0)) { orderBlatt(); return err('Bitte den Kurswert in Euro laut Abrechnung eintragen.'); }
      var sp = o.spesen === '' || o.spesen === null ? runden(L.order(kwe, p.boerse, S.genutzt + 1, kond())) : num(o.spesen), ke = o.art === 'verkauf' ? num(o.kest) : 0;
      await q(sb.from('trades').insert({
        wertpapier_id: wid, art: o.art, datum: o.datum, uhrzeit: o.uhrzeit || null, stueck: st, kurs: ku, waehrung: p.waehrung, kurswert_eur: runden(kwe), spesen_eur: sp, kest_eur: ke,
        endbetrag_eur: o.endbetrag || runden(o.art === 'kauf' ? kwe + sp : kwe - sp - ke), auftragsnr: o.auftragsnr || null, ausfuehrung_nr: o.ausfuehrung_nr || null, quelle: o.quelle
      }));
      schliesse(); await laden(); S.view = 'depot'; render();
      toast((o.art === 'kauf' ? 'Kauf' : 'Verkauf') + ' eingetragen. ' + nf(S.genutzt, 0) + ' von ' + nf(kond().frei, 0) + ' freien Orders genutzt.');
    } catch (e) { err(/duplicate|unique/i.test(meldung(e)) ? 'Diese Abrechnung ist schon eingetragen.' : meldung(e)); }
  }

  /* ---------- Mitteilungen aufs Handy ---------- */
  async function pushStand() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'fehlt';
    if (Notification.permission === 'denied') return 'gesperrt';
    try {
      var reg = await Promise.race([navigator.serviceWorker.ready, new Promise(function (ok) { setTimeout(ok, 4000); })]);
      if (!reg) return 'fehlt';
      return (await reg.pushManager.getSubscription()) ? 'an' : 'aus';
    } catch (e) { return 'fehlt'; }
  }
  function b64(s) { var p = (s + '==='.slice((s.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'), r = atob(p), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  async function pushAn() {
    try {
      if ((await Notification.requestPermission()) !== 'granted') { S.push = 'gesperrt'; render(); return; }
      var key = (await fn('melden', 'key=1')).publicKey, reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      await q(sb.from('push_subs').upsert({ endpoint: sub.endpoint, sub: sub.toJSON() }));
      S.push = 'an'; render(); toast('Mitteilungen sind eingeschaltet.');
    } catch (e) { toast('Einschalten hat nicht geklappt: ' + meldung(e)); }
  }

  /* ---------- Geteilte Datei vom Handy ("Teilen" → Aktien) ---------- */
  async function geteilt() {
    try {
      var c = await caches.open('aktien-geteilt'), keys = await c.keys();
      if (!keys.length) return;
      var res = await c.match(keys[0]), blob = await res.blob();
      await Promise.all(keys.map(function (k) { return c.delete(k); }));
      if (inhaber()) pdfEinlesen(new File([blob], 'abrechnung.pdf', { type: 'application/pdf' }));
    } catch (e) { /* kein Cache: nichts zu tun */ }
  }

  /* ---------- Bedienung ---------- */
  var AKT = {
    'neu-laden': function () { start(); },
    aktualisieren: async function () {
      S.dreht = true; render();
      try { await q(sb.rpc('kurse_aktualisieren')); } catch (e) { toast('Kurse konnten nicht geholt werden: ' + meldung(e)); }
      S.dreht = false; await neu();
    },
    order: function (d) { var vor = { art: d.art || 'kauf' }; if (d.wid) vor.wid = d.wid; orderNeu(vor); },
    'blatt-zu': schliesse,
    beob: function () { S.beob = { such: '', treffer: null }; beobBlatt(); },
    'beob-neu': async function (d) {
      var t = S.beob && S.beob.treffer && S.beob.treffer[Number(d.i)]; if (!t) return;
      try {
        await q(sb.rpc('wertpapier_anlegen', { p_symbol: t.symbol, p_isin: null, p_branche: t.branche || null, p_beobachten: true }));
        schliesse(); await neu(); toast((t.name || t.symbol) + ' steht auf der Beobachtungsliste.');
      } catch (e) { toast(meldung(e)); }
    },
    'beob-weg': async function (d) {
      var setze = function (an) { return q(sb.from('wertpapiere').update({ beobachten: an }).eq('id', d.id)).then(neu); };
      try { await setze(false); toast('Von der Beobachtungsliste genommen.', function () { setze(true).catch(function (e) { toast(meldung(e)); }); }); } catch (e) { toast(meldung(e)); }
    },
    suchen: async function () {
      var o = S.order; if (!o || (o.such || '').trim().length < 2) return;
      try { o.treffer = await q(sb.rpc('suche', { q: o.such.trim() })); o.symbol = ''; } catch (e) { o.treffer = []; toast(meldung(e)); }
      orderBlatt();
    },
    scharf: async function (d) { try { await q(sb.from('alarme').update({ ausgeloest_am: null, ausgeloest_kurs: null }).eq('id', d.id)); await neu(); } catch (e) { toast(meldung(e)); } },
    'alarm-weg': async function (d) {
      var a = S.alarme.find(function (x) { return x.id === d.id; }); if (!a) return;
      try { await q(sb.from('alarme').delete().eq('id', d.id)); await neu(); toast('Warnung gelöscht.', async function () { try { await q(sb.from('alarme').insert(a)); await neu(); } catch (e) { toast(meldung(e)); } }); } catch (e) { toast(meldung(e)); }
    },
    'trade-weg': async function (d) {
      var t = S.trades.find(function (x) { return x.id === d.id; }); if (!t) return;
      try { await q(sb.from('trades').delete().eq('id', d.id)); await neu(); toast('Buchung gelöscht.', async function () { try { await q(sb.from('trades').insert(t)); await neu(); } catch (e) { toast(meldung(e)); } }); } catch (e) { toast(meldung(e)); }
    },
    'push-an': pushAn,
    'push-probe': async function () { try { var r = await fn('melden', 'test=1', { test: true }); toast(r.gesendet ? 'Probe ist unterwegs.' : 'Für dieses Gerät ist keine Anmeldung gespeichert. Bitte Mitteilungen neu einschalten.'); } catch (e) { toast(meldung(e)); } },
    passwort: function () {
      oeffne('<form id="pwform" novalidate><div class="kopf"><h2>Passwort ändern</h2><button type="button" class="klein" data-act="blatt-zu">Schließen</button></div>' +
        '<label for="pw1">Neues Passwort (mindestens 10 Zeichen)<input id="pw1" type="password" autocomplete="new-password"></label>' +
        '<label class="mt" for="pw2">Wiederholen<input id="pw2" type="password" autocomplete="new-password"></label>' +
        '<p class="fehler mt" id="pw-fehler" aria-live="polite"></p><div class="reihe"><button class="pri" type="submit">Passwort ändern</button></div></form>');
    },
    abmelden: function () { sb.auth.signOut(); }
  };
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    var d = t.dataset;
    if (d.act && AKT[d.act]) { AKT[d.act](d); return; }
    if (d.boerse) { S.rechner.boerse = d.boerse; app.querySelectorAll('[data-boerse]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); }); rechnerAus(); return; }
    if (d.betrag) { S.rechner.betrag = Number(d.betrag); $('#r-betrag').value = d.betrag; rechnerAus(); return; }
    if (d.oart && S.order) { S.order.art = d.oart; orderBlatt(); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'r-betrag') { S.rechner.betrag = parseFloat(t.value) || 0; rechnerAus(); }
    else if (t.id === 'r-wochen') { S.rechner.wochen = Number(t.value); rechnerAus(); }
    else if (t.id === 'r-ziel') { S.rechner.ziel = Number(t.value); rechnerAus(); }
    else if (t.dataset.o && S.order && t.tagName !== 'SELECT') S.order[t.dataset.o] = t.value;
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'pdf-in') { var f = t.files && t.files[0]; t.value = ''; if (f) pdfEinlesen(f); }
    else if (t.id === 'o-wid' && S.order) { S.order.wid = t.value; orderBlatt(); }
    else if (t.name === 'o-symbol' && S.order && S.order.treffer) { var x = S.order.treffer[Number(t.value)]; S.order.symbol = x.symbol; S.order.branche = x.branche || ''; }
    else if (t.dataset.aktiv) { q(sb.from('alarme').update({ aktiv: t.checked }).eq('id', t.dataset.aktiv)).then(function () { return laden(true); }).catch(function (er) { toast(meldung(er)); }); }
    else if (t.id === 'a-art') { var w = $('#a-wert'), art = t.value; w.disabled = art === 'breakeven'; w.placeholder = art === 'tagessturz' || art === 'wochenrutsch' ? 'leer = automatisch' : ''; $('#a-wert-t').textContent = art === 'verlust' ? 'Betrag €' : art === 'tagessturz' || art === 'wochenrutsch' ? 'Ab wie viel Prozent' : art === 'breakeven' ? 'Kein Wert nötig' : 'Kurs'; }
  });
  document.addEventListener('toggle', function (e) { if (e.target.dataset && e.target.dataset.offen) S.offen[e.target.dataset.offen] = e.target.open; }, true);
  document.addEventListener('submit', async function (e) {
    e.preventDefault();
    var id = e.target.id;
    try {
      if (id === 'loginform') {
        $('#l-fehler').textContent = '';
        var r = await sb.auth.signInWithPassword({ email: $('#l-mail').value.trim(), password: $('#l-pw').value });
        if (r.error) $('#l-fehler').textContent = /invalid/i.test(r.error.message) ? 'E-Mail oder Passwort stimmt nicht.' : r.error.message;
      } else if (id === 'orderform') { await orderSpeichern(); }
      else if (id === 'beobform') {
        var bs = $('#b-such').value.trim(); if (bs.length < 2 || !S.beob) return;
        S.beob.such = bs;
        try { S.beob.treffer = await q(sb.rpc('suche', { q: bs })); } catch (er2) { S.beob.treffer = []; toast(meldung(er2)); }
        if (S.beob) beobBlatt();
      } else if (id === 'alarmform') {
        var art = $('#a-art').value, wert = parseFloat($('#a-wert').value), auto = art === 'tagessturz' || art === 'wochenrutsch', ap = wp($('#a-wid').value);
        if ((art === 'breakeven' || art === 'verlust') && !(ap && num(ap.stueck) > 0)) { $('#a-fehler').textContent = 'Diese Warnung gibt es nur für Aktien, die im Depot liegen.'; return; }
        if (art !== 'breakeven' && !auto && !(wert > 0)) { $('#a-fehler').textContent = 'Bitte einen Wert eingeben.'; return; }
        await q(sb.from('alarme').insert({ wertpapier_id: Number($('#a-wid').value), art: art, wert: art === 'breakeven' || !(wert > 0) ? null : wert }));
        await neu(); toast('Warnung angelegt.');
      } else if (id === 'kondform') {
        var k = Object.assign({}, kond()), gen = S.genutzt;
        e.target.querySelectorAll('[data-k]').forEach(function (i) { var v = parseFloat(i.value); if (!(v >= 0)) return; if (i.dataset.k === '_genutzt') gen = Math.round(v); else k[i.dataset.k] = v; });
        k.depot_einrechnen = $('#k-dep').checked;
        await q(sb.from('einstellungen').update({ value: k, updated_at: new Date().toISOString() }).eq('key', 'konditionen'));
        if (gen !== S.genutzt) await q(sb.from('einstellungen').upsert({ key: 'freikontingent', value: { jahr: new Date().getFullYear(), stand: gen, am: new Date().toISOString() }, updated_at: new Date().toISOString() }));
        await neu(); toast('Konditionen gespeichert.');
      } else if (id === 'pwform') {
        var a = $('#pw1').value, b = $('#pw2').value;
        if (a.length < 10) { $('#pw-fehler').textContent = 'Mindestens 10 Zeichen.'; return; }
        if (a !== b) { $('#pw-fehler').textContent = 'Die beiden Eingaben sind verschieden.'; return; }
        var u = await sb.auth.updateUser({ password: a });
        if (u.error) { $('#pw-fehler').textContent = u.error.message; return; }
        schliesse(); toast('Passwort geändert.');
      }
    } catch (er) { toast(meldung(er)); }
  });
  window.addEventListener('hashchange', route);

  /* ---------- Start ---------- */
  async function start() { S.geladen = false; S.fehler = ''; render(); await laden(true); route(); }
  sb.auth.onAuthStateChange(function (ev, sitzung) {
    var war = S.sitzung && S.sitzung.user.id, ist = sitzung && sitzung.user.id;
    S.sitzung = sitzung;
    if (ist && ist !== war) setTimeout(start, 0);
    else if (!ist) { S.geladen = false; S.me = null; schliesse(); render(); }
  });
  sb.auth.getSession().then(function (r) { if (!r.data || !r.data.session) render(); });
  /* Im Hintergrund jede Minute frische Zahlen, solange niemand gerade etwas eintippt */
  setInterval(async function () {
    if (!S.sitzung || !S.geladen || document.hidden || (blatt && blatt.open)) return;
    var f = document.activeElement; if (f && /INPUT|SELECT|TEXTAREA/.test(f.tagName)) return;
    await laden(true);
    if (S.view === 'depot' || S.view === 'alarme') render();
  }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.sitzung && S.geladen && !(blatt && blatt.open)) laden(true).then(function () { if (S.view === 'depot') render(); }); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* ohne Hintergrunddienst läuft die App trotzdem */ });
})();
