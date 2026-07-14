# Code-Kommentar

Formt ein gesprochenes Diktat ("das macht im Grunde folgendes...") in einen knappen, technischen
Kommentar- bzw. Docstring-Text um — ideal zum Diktieren von Code-Dokumentation direkt im Editor.
Liefert reinen Kommentartext, keine Code-Blöcke und keine Kommentarzeichen (`//`, `#`, `/* */`,
`"""`) — die fügst du je nach Sprache selbst hinzu.

## Beispiel

**Vorher (Diktat):**

> Also diese Funktion nimmt die rohe Liste von Bestellungen und filtert erstmal alle raus die schon
> storniert sind, danach werden die restlichen nach Datum sortiert.

**Nachher:**

```
Filtert stornierte Bestellungen aus der übergebenen Liste heraus und sortiert die verbleibenden
Einträge nach Datum.
```

## Import

Workflows → Importieren… → `preset.json` aus diesem Ordner auswählen.
