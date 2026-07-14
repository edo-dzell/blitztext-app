# Sicherheitsrichtlinie

## Unterstützte Version

Es wird jeweils nur das **neueste Release** unterstützt. Sicherheitsfixes fließen nicht rückwirkend
in ältere Versionen zurück — bitte immer auf die
[aktuellste Release-Version](https://github.com/edo-dzell/blitztext-app-windows/releases/latest)
aktualisieren.

## Sicherheitslücke melden

Bitte **keine Sicherheitslücken über öffentliche Issues oder Pull Requests** melden, solange
Exploit-Details oder sensible Angaben enthalten sind — das gibt Angreifern einen Vorsprung, bevor
ein Fix verfügbar ist.

Bevorzugter Weg:

- **[GitHub Security Advisories](https://github.com/edo-dzell/blitztext-app-windows/security/advisories/new)**
  („Report a vulnerability“ im Tab „Security“ dieses Repos) — nicht-öffentlich, direkt an die
  Maintainer.

Falls das nicht funktioniert, ist ein Issue mit möglichst wenigen sensiblen Details (keine
funktionierenden Exploits, keine API-Keys, keine echten Diktat-Inhalte) eine Notlösung — bitte im
Issue-Text ausdrücklich um privaten Folgekontakt bitten.

Es gibt keine feste Zusicherung zu Reaktionszeiten (pseudonym gepflegtes Einzelprojekt, siehe
[`CONTRIBUTING.md`](./CONTRIBUTING.md)) — ernsthafte Meldungen werden aber priorisiert behandelt.

## Was bei einer Meldung hilft

- Betroffene Version (Release-Tag oder Commit)
- Reproduktionsschritte bzw. minimaler Nachweis
- Erwartetes vs. tatsächliches Verhalten
- Einschätzung der Auswirkung (z. B. Schlüssel-Leak, Code-Ausführung, Datenverlust)

## Sicherheitsrelevanter Kontext dieses Projekts

Für die Einordnung, was überhaupt exponiert sein kann:

- **Kein eigenes Backend, keine Konten, keine Telemetrie.** Cloud-Aufrufe laufen ausschließlich
  über den vom Nutzer selbst hinterlegten API-Key direkt zum gewählten Anbieter (OpenAI, Groq,
  Mistral oder ein selbst konfigurierter OpenAI-kompatibler bzw. lokaler Endpunkt).
- **API-Keys werden lokal verschlüsselt gespeichert** (Windows DPAPI via Electrons
  `safeStorage`), nie im Klartext auf der Platte.
- **Diktat-Audio bleibt flüchtig im Arbeitsspeicher** (nie auf der Platte) und wird nur an den vom
  Nutzer konfigurierten Anbieter bzw. lokalen Endpunkt gesendet.
- **Releases sind aktuell nicht code-signiert** (siehe README, Abschnitt „Code-Signing &
  Datenschutz“) — Herkunft ist über `SHA256SUMS.txt` und GitHub-Build-Provenance
  (`gh attestation verify`) prüfbar, da jedes Artefakt ausschließlich per CI aus diesem Repository
  gebaut wird.

Verantwortungsvolle Offenlegung (Coordinated Disclosure) wird ausdrücklich erbeten und geschätzt.
