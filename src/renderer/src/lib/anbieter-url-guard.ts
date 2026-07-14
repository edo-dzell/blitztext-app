// Re-Export der geteilten Wahrheit (F2: EINE Guard-Implementierung für Main+Renderer, keine zwei
// Implementierungen, die auseinanderdriften). Siehe src/shared/anbieter-url-guard.ts für Details/Doku.
// Die Einbindung als Live-Validierung im Anbieter-URL-Feld übernimmt EinstellungenView.

export { istSichereAnbieterUrl } from '@shared/anbieter-url-guard'
