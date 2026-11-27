# Aktien

Private App für ein Wertpapierdepot: Depotstand mit laufenden Kursen, Break-even nach Spesen und KESt, Spesenrechner und Kurswarnungen aufs Handy.

Die App rechnet und warnt. Sie ist keine Anlageberatung und gibt keine Kauf- oder Verkaufsempfehlungen.

## Aufbau

- **Oberfläche**: statische Seite ohne Build-Schritt (`index.html`, `app.css`, `js/`). Läuft über GitHub Pages und lässt sich auf dem Handy zum Home-Bildschirm hinzufügen.
- **Daten und Rechenlogik**: Supabase (Postgres). Depotstand, Break-even, Kursabruf und Warnungen rechnet die Datenbank, damit App und Server dieselben Zahlen verwenden. Die Tabellen, Zugriffsregeln und Funktionen liegen als Migrationen im Supabase-Projekt.
- **Kurse**: Der Server holt sie werktags alle zwei Minuten. Wien und Xetra kommen etwa 15 Minuten verzögert, US-Kurse fast in Echtzeit.
- **Mitteilungen**: `funktionen/melden` (Supabase Edge Function) verschickt Web-Push an angemeldete Geräte.
- **Abrechnungen**: `js/abrechnung.js` liest Kauf- und Verkaufsabrechnungen (PDF) direkt im Browser. Die Datei verlässt das Gerät nicht.

## Zugang

Anmeldung mit E-Mail und Passwort. Konten legt nur der Inhaber im Supabase-Dashboard an; eine freie Registrierung gibt es nicht. Zwei Rollen: `inhaber` darf alles, `leser` sieht alles und bekommt Warnungen, kann aber nichts ändern. Das erzwingt die Datenbank (Row Level Security), nicht die Oberfläche.

`config.js` enthält nur die Projektadresse und den öffentlichen Schlüssel. Beides ist für den Browser gedacht; ohne Anmeldung gibt die Datenbank nichts heraus.

## Dateien

| Datei | Zweck |
| --- | --- |
| `index.html`, `app.css` | Seite und Gestaltung |
| `js/app.js` | Ansichten und Bedienung |
| `js/logik.js` | Zahlenformate und Spesenrechner |
| `js/abrechnung.js` | PDF-Abrechnung einlesen |
| `js/lib/` | pdf.js (Apache-2.0) |
| `sw.js`, `manifest.webmanifest`, `icons/` | App auf dem Handy, Teilen von PDFs, Mitteilungen |
| `funktionen/melden/` | Edge Function für Mitteilungen |
