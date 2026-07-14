# Beitragen

Danke fürs Interesse an Blitztext für Windows.

## Einordnung

Dieses Repository ist ein **pseudonym gepflegter Fork/Neuschrieb** — ein Schaufenster-Projekt eines
Einzelnen in der Freizeit, kein Team mit fester Support-Zusage. Issues und Pull Requests werden
gelesen und nach bestem Ermessen priorisiert, aber es gibt keine Garantie für Reaktionszeiten oder
dass jeder Beitrag angenommen wird.

## Bevor du einen Pull Request aufmachst

- Bei größeren Änderungen: bitte zuerst ein Issue aufmachen und die Idee kurz skizzieren, bevor viel
  Arbeit investiert wird.
- Bei kleinen, klar abgegrenzten Fixes (Tippfehler, offensichtliche Bugs): direkt ein PR ist okay.

## Lokale Gates vor jedem PR

Diese Befehle müssen sauber durchlaufen, bevor ein PR sinnvoll reviewbar ist (sie sind auch das
CI-Gate, siehe [`release.yml`](.github/workflows/release.yml)):

```bash
npm install
npm test             # Vitest
npm run typecheck    # TypeScript, ohne zu bauen
npm run lint         # ESLint (Architektur-Regel @main im Renderer)
```

## GUI-Änderungen brauchen Windows-HITL

Die Electron-GUI läuft (Chrome-Sandbox) **nicht** in einer Linux/WSL-Sandbox — Logik lässt sich dort
nur über `npm test` / `npm run typecheck` / `npm run build` verifizieren. Für Änderungen an
GUI-Verhalten (Fenster, Tray, Hotkeys, Einfügen, Aufnahme) ist ein manueller Klicktest unter echtem
Windows (Human-in-the-loop) nötig, bevor sie als abgenommen gelten — bitte im PR-Text vermerken,
falls das noch aussteht.

## Code-Konventionen

- **Deutsche Domänen-Bezeichner:** Funktions-/Variablen-/Typnamen, die fachliche Konzepte der App
  beschreiben (Workflows, Verlauf, Anbieter, Diktat, …), sind bewusst auf Deutsch gehalten — bitte
  am bestehenden Stil orientieren statt auf Englisch umzustellen.
- TypeScript strikt, kein `any` ohne guten Grund.
- Neue Logik nach Möglichkeit mit Tests (Vitest) absichern statt nur manuell zu prüfen.

## Presets beitragen

Fertige Workflow-Presets liegen unter `presets/<slug>/` (siehe [README](README.md#-workflow-presets)).
Für einen eigenen Beitrag:

- **Slug in kebab-case:** Ordnername nur Kleinbuchstaben, Ziffern und Bindestriche
  (z. B. `presets/mein-preset/`), passend zum Preset-Zweck.
- **`preset.json` muss dem Preset-Dateiformat entsprechen** (`PresetDatei`/`PresetWorkflow` in
  [`src/shared/workflows.ts`](src/shared/workflows.ts)) und die Import-Validierung
  (`parseImportierterWorkflow`) bestehen. Vor dem PR prüfen — entweder:
  - `npm run validate:presets` laufen lassen (validiert alle `presets/*/preset.json` gegen den
    echten Parser), oder
  - die Datei einmal über **Workflows → Importieren…** in der App selbst einlesen.
- **`README.md` je Preset ist Pflicht**: kurzer Zweck-Absatz + ein Mini-Beispiel
  (Diktat vorher → Ergebnis nachher), analog zu den bestehenden Presets.
- **Keine personenbezogenen oder firmenspezifischen Inhalte** im Prompt oder Beispieltext — Presets
  sind öffentlich und für alle nutzbar, nicht auf einen bestimmten Kontext zugeschnitten.
- Der von der App zur Laufzeit angehängte Daten-Rahmen (Transkript-Kapselung/Treue-Vorgaben) gehört
  NICHT in den Preset-Prompt — der entsteht automatisch beim Umschreiben, unabhängig vom Preset.

## Sicherheitslücken

Bitte **nicht** als normales Issue melden — siehe [`SECURITY.md`](./SECURITY.md) für den
verantwortungsvollen Meldeweg.

## Verhaltenskodex

Für dieses Projekt gilt der [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
