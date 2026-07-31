// A6 (v0.8.0): Das tatsächlich gelaufene Modell (asrModell/chatModell) war im Verlauf nirgends
// sichtbar, obwohl VerlaufEintrag es längst speichert — dadurch konnte niemand gegenprüfen, welches
// Modell einen Fehlschlag verursacht hat.
import { describe, it, expect } from 'vitest'
import { modellLabelFuerEintrag } from '@shared/modell-label'

describe('modellLabelFuerEintrag', () => {
  it('ASR + Chat gesetzt → "<asr> + <chat>"', () => {
    expect(modellLabelFuerEintrag({ asrModell: 'whisper-1', chatModell: 'gpt-4o-mini' })).toBe(
      'whisper-1 + gpt-4o-mini'
    )
  })

  it('nur ASR gesetzt (reine Transkription ohne Umschreiben) → nur ASR', () => {
    expect(modellLabelFuerEintrag({ asrModell: 'whisper-1', chatModell: undefined })).toBe('whisper-1')
  })

  it('nur ASR gesetzt, chatModell als leerer String → nur ASR', () => {
    expect(modellLabelFuerEintrag({ asrModell: 'whisper-1', chatModell: '' })).toBe('whisper-1')
  })

  it('keines gesetzt (Alt-Eintrag vor Feld-Einführung) → leerer String', () => {
    expect(modellLabelFuerEintrag({})).toBe('')
    expect(modellLabelFuerEintrag({ asrModell: undefined, chatModell: undefined })).toBe('')
  })
})
