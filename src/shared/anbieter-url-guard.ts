// S21-Rest + F2 (URL-Guard): https-Guard für frei eingegebene Anbieter-Basis-URLs (Custom-Anbieter,
// lokales ASR). Schützt vor Verschreibern/versehentlichem Klartext-http (API-Key ginge im Klartext
// übers Netz) — erlaubt aber http:// für lokale Endpunkte (localhost/127.0.0.1/::1), wie sie
// whisper.cpp/Speaches & Co. typischerweise nutzen (kein TLS auf localhost üblich).
//
// EINE Wahrheit für Main UND Renderer (F2-Befund: `istSichereAnbieterUrl` wurde bislang NUR beim
// Speichern im Renderer geprüft; die vier Key-sendenden fetch-Stellen im Main [rewrite/transcription
// cloud-provider, validate-api-key, erreichbarkeit-adapter] prüften gar nicht — ein per Settings-
// JSON/Migration gesetztes `http://fremder-host` hätte den Key im Klartext gesendet). Reine Funktionen;
// keine Node-/DOM-Abhängigkeit → aus src/main, src/renderer und src/preload gleichermaßen nutzbar.

const LOKALE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * true, wenn die URL sicher ist: entweder https:// (beliebiger Host) oder http(s):// auf einen
 * lokalen Host (localhost/127.0.0.1/::1). Ungültige/unparsbare URLs gelten als NICHT sicher.
 */
export function istSichereAnbieterUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol === 'http:' && LOKALE_HOSTS.has(parsed.hostname.toLowerCase())) return true
  return false
}

/** Strukturiertes Zusatzfeld, das die Fehler-Klassifikation (fehler-klassifikation.ts) liest. */
export interface AnbieterUrlFehler extends Error {
  status?: number
}

/**
 * Harter Block für den Main-Prozess: wirft, wenn die Base-URL NICHT sicher ist (siehe
 * istSichereAnbieterUrl), BEVOR ein Key-tragender fetch abgeht. Der Fehler trägt `.status = 400`,
 * damit die bestehende Fehler-Klassifikation (fehler-klassifikation.ts) ihn deterministisch als
 * Fehler-Art 'konfiguration' einstuft — kein sinnloser Netzwerk-Retry für einen Einrichtungsfehler,
 * kein echter Netzaufruf nötig, um die Klassifikation auszulösen.
 */
export function pruefeAnbieterUrlSicherheit(baseUrl: string): void {
  if (istSichereAnbieterUrl(baseUrl)) return
  const fehler = new Error(
    `Unsichere Anbieter-URL: „${baseUrl}" ist unverschlüsseltes http zu einem fremden Host. ` +
      'Der API-Key würde im Klartext übers Netz gehen. Bitte in den Einstellungen eine https-URL ' +
      'hinterlegen (http:// ist nur für localhost/127.0.0.1/::1 erlaubt).'
  ) as AnbieterUrlFehler
  fehler.status = 400
  throw fehler
}
