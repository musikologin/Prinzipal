# Prinzipal

Assistenz-App für Sebastian (Kirchenmusik Meiningen). Web-App auf Firebase Hosting
(https://prinzipal.web.app) plus Android-Hülle mit Widget. Sprache der App und aller
Texte für den Nutzer: Deutsch, Anrede „du“.

## Aufbau

- `src/app.html` – die ganze App in einer Datei (Markup, CSS, JavaScript). Hier wird fast alles geändert.
- `src/shim-head.html` – wird beim Bauen in den Kopf eingefügt und lädt die Zwischenschicht.
- `build.py` – baut `public/index.html` aus den beiden Dateien. `public/index.html` wird nicht eingecheckt.
- `public/pz-*.js` – Zwischenschicht: stellt `window.claude.use(...)` bereit und verbindet die App mit
  Firebase (Anmeldung, Firestore, Storage), Google Kalender und Drive, Todoist.
- `app-android/` – Capacitor-Hülle, lädt die Live-Seite. Eigener Java-Code in
  `android/app/src/main/java/de/musikologin/prinzipal/` (Anmeldung, Widget `PzWidget`, Stift).

In `src/app.html`: ein Klick-Verteiler mit `REG`-Einträgen `(b,id,ev)=>({aktion:()=>…})`, Ansichten in `VIEWS`,
Einstellungen in `SET` (`saveSet(key,patch)`), Daten über `save(col,id,data)` und `remove(col,id)`.
Zwei Optiken: „Seriös“ (hell) und „Konsole“ (dunkel, Klasse `k` am body). Jede Änderung in beiden prüfen,
am Handy (390 px) und am Tablet (ab 900 px).

## Daten

Firebase-Projekt `journal-70fbc` (gehört Melanie, enthält auch ihre eigenen Apps).
Sebastians Daten: Firestore `users/<uid>/pz_<sammlung>/<id>` als `{j: JSON-Text, t}`,
Dateien in Storage `users/<uid>/pz_a/<id>`. Die Zugriffsregeln liegen nicht in diesem Repository.

Wunschbox: Sebastians Wünsche liegen in der Sammlung `wuensche` (`{text, ts, status: offen|arbeit|erledigt, antwort, wo, gemeldet, dateien}`).
Anhänge eines Wunsches: `dateien: [{name, type, size, asset}]`, die Datei selbst liegt in Storage `users/<uid>/pz_a/<asset>`
(immer in der App, nie in Google Drive; höchstens 5 je Wunsch, je 20 MB). „Zurückziehen“ löscht die Dateien mit.
Die Wunschbox liest und bearbeitet Melanie mit ihrem Claude, nicht Sebastians Claude. Hier nichts daran ändern oder abhaken.
Knopf „Bescheid geben“ (Einstellungen, nur Android-App): startet Melanies geplanten Auftrag „Prinzipal: Wunschbox prüfen“.
Adresse und Schlüssel dafür stehen nur in Sebastians Einstellungen (`settings/wunsch`), nie im Code und nicht in der Sicherung.

## Veröffentlichen

Push auf `main` genügt:
- `.github/workflows/deploy.yml` baut und veröffentlicht die Seite.
- `.github/workflows/apk.yml` baut bei Änderungen unter `app-android/` eine neue signierte APK und
  aktualisiert den Download https://prinzipal.web.app/Prinzipal.apk.

Die Anmeldung bei Google läuft ohne gespeicherten Schlüssel (Workload Identity, nur für dieses Repository).
Das Konto darf nur Hosting veröffentlichen und die Prinzipal-APK ablegen. Keine Schlüssel einchecken.

## Regeln

- Vor dem Push: `python3 build.py` muss durchlaufen; die Seite einmal im Browser laden und auf Konsolenfehler prüfen.
- Daten von Kindern (Kinderchöre): nur mit Datenschutzhinweis, nach Projektende löschen, keine pauschale Fotoerlaubnis.
- Private Bereiche (Gremiennotizen, Fahrtenbuch, Orgelunterricht, Kasualien, Geburtstage, Leihnoten, Plakate)
  dürfen bei späteren Freigaben für Mitarbeitende nicht sichtbar werden.
- Fahrtenbuch: Kilometerstände bleiben nach dem Speichern unveränderlich, Korrekturen als neuer Eintrag.
- Personalnotizen (Kreiskantorat) gehen nur auf ausdrücklichen Klick an eine KI.
- Keine geschützten Texte oder Grafiken einbauen (Bibelübersetzungen, Losungen, Gesangbuch-Cover, Star-Trek-Material).
- Vertragsvorlage und Steuerangaben sind ungeprüfte Hilfen, keine Rechts- oder Steuerberatung.

## Offene Wünsche

Siehe `WUENSCHE.md`.
