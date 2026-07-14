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

## Sicherheitslücken

Bitte **nicht** als normales Issue melden — siehe [`SECURITY.md`](./SECURITY.md) für den
verantwortungsvollen Meldeweg.

## Verhaltenskodex

Für dieses Projekt gilt der [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
