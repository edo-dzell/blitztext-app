// A4: Upload-Dateiname für den ASR-Multipart-Upload — folgt dem ECHTEN Blob-MIME-Typ statt hart
// 'audio.webm' (transcription/cloud-provider.ts). Der Blob trägt den wahren MIME-Typ des Recorders
// (recorder-adapter.ts baut ihn aus `recorder.mimeType`); manche ASR-Anbieter entscheiden das Format
// anhand der Dateiendung — ein falscher Name auf einem Chromium-/Electron-Upgrade mit anderem Default-
// Container würde dort zu Fehlinterpretation führen. Reine Tabellen-Funktion, kein Transcoding.

const MIME_ZU_DATEINAME: Record<string, string> = {
  'audio/webm': 'audio.webm',
  'audio/ogg': 'audio.ogg',
  'audio/wav': 'audio.wav',
  'audio/mp4': 'audio.m4a',
  'audio/m4a': 'audio.m4a',
  'audio/mpeg': 'audio.mp3',
  'audio/flac': 'audio.flac'
}

/** Fallback = heutiges Verhalten (hart 'audio.webm'), falls der MIME-Typ leer/unbekannt ist — kein Bruch. */
const FALLBACK_DATEINAME = 'audio.webm'

/** Leitet aus einem MIME-Typ (z. B. `audio/webm;codecs=opus`) den passenden Upload-Dateinamen ab. */
export function dateinameFuerMime(mimeType: string): string {
  const basisTyp = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_ZU_DATEINAME[basisTyp] ?? FALLBACK_DATEINAME
}
