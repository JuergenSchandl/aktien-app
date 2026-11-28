/* Aktien-App · Wertpapierabrechnung aus George einlesen (PDF).
   Die Datei wird nur auf dem Gerät gelesen. Übernommen werden die Zahlen der Order,
   nicht Name, Adresse, Depot- oder Kontonummer. Die Datei selbst wird nicht gespeichert. */
(function (root) {
  'use strict';
  var pdfjs = null;
  var dnum = function (s) { return parseFloat(String(s).replace(/\./g, '').replace(',', '.')); };
  var diso = function (d) { return d.slice(6) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2); };
  var KEEP = { AG: 1, SE: 1, NV: 1, SA: 1, PLC: 1, INC: 1, KGAA: 1, ADR: 1, ASA: 1, AB: 1, OYJ: 1, SPA: 1, CORP: 1, LTD: 1, CO: 1 };
  var nice = function (s) { return s.split(' ').map(function (w) { return KEEP[w] ? w : w.charAt(0) + w.slice(1).toLowerCase(); }).join(' '); };

  /* Textstücke einer Seite zu Zeilen ordnen (gleiche Höhe = gleiche Zeile, von links nach rechts) */
  function rowsOf(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var x = it.transform[4], y = it.transform[5], r = rows.find(function (q) { return Math.abs(q.y - y) < 2.5; });
      if (!r) { r = { y: y, its: [] }; rows.push(r); }
      r.its.push({ x: x, s: it.str });
    });
    return rows.sort(function (a, b) { return b.y - a.y; }).map(function (r) {
      return r.its.sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; }).join(' ').replace(/\s+/g, ' ').trim();
    });
  }

  function parse(lines) {
    var F = lines.join(' ').replace(/\s+/g, ' ');
    var g = function (re) { var r = re.exec(F); return r ? r[1] : null; };
    var kind = g(/\b(Kauf|Verkauf)\b/), at = F.indexOf('Ihr Auftrag vom'), ir = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/.exec(at < 0 ? F : F.slice(at));
    if (!kind || !ir) return null;
    var isin = ir[0], warn = [], li = lines.findIndex(function (l) { return l.indexOf(isin) >= 0; }), name = '';
    if (li >= 0) {
      name = lines[li].replace(isin, '').replace(/Auftragsnummer\s*\d+/, '').trim();
      if (!name) { var nx = lines.slice(li + 1, li + 6).find(function (l) { return /^[A-Z0-9 .&'\-]{3,}$/.test(l) && !/STK/.test(l); }); if (nx) name = nx; }
    }
    var costs = dnum(g(/Einmalige Kosten ([\d.]+,\d+) EUR/) || g(/Summe der Kosten dieser Transaktion EUR ([\d.]+,\d+)/) || '0');
    var total = dnum(g(/Endbetrag gesamt ([\d.]+,\d+) EUR/) || '');
    var kest = dnum(g(/(?:Kapitalertrag(?:s)?steuer|KESt)[^\d\-]{0,40}-?([\d.]+,\d+) EUR/) || '0');
    var qty = 0, value = 0, cur = 'EUR', r, ex = /([\d.]+,\d+) STK ([\d.]+,\d+) ([A-Z]{3}) ([\d.]+,\d+) ([A-Z]{3})/g;
    while ((r = ex.exec(F))) { qty += dnum(r[1]); value += dnum(r[4]); cur = r[3]; }
    if (!qty && kind === 'Kauf' && total > 0) { qty = dnum(g(/Gesamtauftrag: ([\d.]+,\d+) STK/) || ''); value = total - costs; warn.push('Der Kurs wurde aus dem Endbetrag zurückgerechnet.'); }
    if (!(qty > 0) || !(value > 0)) return null;
    var kurswertEur = value;
    if (cur !== 'EUR') {
      warn.push('Fremdwährung: Bitte den Kurswert in Euro prüfen.');
      kurswertEur = total > 0 ? (kind === 'Kauf' ? total - costs : total + costs + kest) : NaN;
    } else if (kind === 'Kauf' && total > 0 && Math.abs(value + costs - total) > 0.011) warn.push('Kurswert plus Spesen ergibt nicht den Endbetrag.');
    if (kind === 'Verkauf') warn.push('Verkaufsabrechnung: Bitte Spesen und KESt mit der Abrechnung vergleichen.');
    var d = g(/Schlusstag: (\d\d\.\d\d\.\d{4})/) || g(/Ihr Auftrag vom (\d\d\.\d\d\.\d{4})/);
    if (!d) return null;
    return {
      art: kind === 'Kauf' ? 'kauf' : 'verkauf', isin: isin, name: nice(name) || isin, stueck: qty, kurs: value / qty, waehrung: cur,
      kurswert_eur: kurswertEur, spesen_eur: costs, kest_eur: kind === 'Verkauf' ? kest : 0, endbetrag_eur: total > 0 ? total : null,
      datum: diso(d), uhrzeit: g(/Ausführungszeit: (\d{1,2}:\d\d)/), auftragsnr: g(/Auftragsnummer (\d+)/),
      ausfuehrung_nr: +(g(/die (\d+)\. Ausführung in diesem Jahr/) || 0) || null, geprueft: !warn.length, hinweise: warn
    };
  }

  /* Die Datei aus George hat vor dem eigentlichen PDF einen kleinen Datenblock; der wird übersprungen */
  async function lesen(file) {
    if (file.size > 15e6) throw new Error('gross');
    var buf = new Uint8Array(await file.arrayBuffer()), s = -1;
    for (var i = 0; i < Math.min(buf.length - 5, 4096); i++) if (buf[i] === 37 && buf[i + 1] === 80 && buf[i + 2] === 68 && buf[i + 3] === 70 && buf[i + 4] === 45) { s = i; break; }
    if (s < 0) throw new Error('keinpdf');
    if (!pdfjs) {
      var m = await import(new URL('js/lib/pdf.min.mjs', document.baseURI).href);
      m.GlobalWorkerOptions.workerSrc = new URL('js/lib/pdf.worker.min.mjs', document.baseURI).href;
      pdfjs = m;
    }
    var doc = await pdfjs.getDocument({ data: buf.slice(s) }).promise, out = [];
    for (var n = 1; n <= Math.min(doc.numPages, 6); n++) { var pg = await doc.getPage(n); out = out.concat(rowsOf((await pg.getTextContent()).items)); }
    var res = parse(out);
    if (!res) throw new Error('format');
    return res;
  }

  root.Abrechnung = { lesen: lesen, parse: parse, rowsOf: rowsOf };
})(window);
