// A4: Upload-Dateiname darf nicht hart 'audio.webm' sein — er muss zum echten Blob-MIME-Typ passen
// (recorder-adapter.ts baut den Blob aus dem echten MediaRecorder.mimeType). Reine Tabellen-Funktion,
// ohne Netz/Blob testbar.

import { describe, it, expect } from 'vitest'
import { dateinameFuerMime } from '@shared/audio-dateiname'

describe('dateinameFuerMime', () => {
  it('audio/webm → audio.webm', () => {
    expect(dateinameFuerMime('audio/webm')).toBe('audio.webm')
  })

  it('audio/ogg → audio.ogg', () => {
    expect(dateinameFuerMime('audio/ogg')).toBe('audio.ogg')
  })

  it('audio/wav → audio.wav', () => {
    expect(dateinameFuerMime('audio/wav')).toBe('audio.wav')
  })

  it('audio/mp4 → audio.m4a', () => {
    expect(dateinameFuerMime('audio/mp4')).toBe('audio.m4a')
  })

  it('audio/m4a → audio.m4a', () => {
    expect(dateinameFuerMime('audio/m4a')).toBe('audio.m4a')
  })

  it('audio/mpeg → audio.mp3', () => {
    expect(dateinameFuerMime('audio/mpeg')).toBe('audio.mp3')
  })

  it('audio/flac → audio.flac', () => {
    expect(dateinameFuerMime('audio/flac')).toBe('audio.flac')
  })

  it('ignoriert Parameter nach dem Semikolon (codecs=opus)', () => {
    expect(dateinameFuerMime('audio/webm;codecs=opus')).toBe('audio.webm')
  })

  it('ignoriert Parameter nach dem Semikolon (ogg/vorbis)', () => {
    expect(dateinameFuerMime('audio/ogg;codecs=vorbis')).toBe('audio.ogg')
  })

  it('unbekannter MIME-Typ → Fallback audio.webm (heutiges Verhalten, kein Bruch)', () => {
    expect(dateinameFuerMime('audio/x-exotisch')).toBe('audio.webm')
  })

  it('leerer String → Fallback audio.webm', () => {
    expect(dateinameFuerMime('')).toBe('audio.webm')
  })
})
