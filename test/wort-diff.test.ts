import { describe, it, expect } from 'vitest'
import { tokenisiere, wortDiff, MAX_DIFF_TOKENS, type DiffToken } from '@renderer/lib/wort-diff'

function nurGleichUndEingefuegt(tokens: DiffToken[]): string {
  return tokens
    .filter((t) => t.art === 'gleich' || t.art === 'eingefuegt')
    .map((t) => t.text)
    .join('')
}

function nurGleichUndEntfernt(tokens: DiffToken[]): string {
  return tokens
    .filter((t) => t.art === 'gleich' || t.art === 'entfernt')
    .map((t) => t.text)
    .join('')
}

describe('tokenisiere', () => {
  it('rekonstruiert den Originaltext exakt (join)', () => {
    const text = 'Hallo   Welt,\n\ndas ist  ein Test.\t\tEnde.'
    expect(tokenisiere(text).join('')).toBe(text)
  })

  it('erhält Zeilenumbrüche und Mehrfach-Leerzeichen als eigene Tokens', () => {
    const tokens = tokenisiere('a  b\n\nc')
    expect(tokens).toEqual(['a', '  ', 'b', '\n\n', 'c'])
  })

  it('liefert leeres Array für leeren Text', () => {
    expect(tokenisiere('')).toEqual([])
  })

  it('tokenisiert reinen Whitespace als einzelnes Token', () => {
    expect(tokenisiere('   ')).toEqual(['   '])
  })
})

describe('wortDiff', () => {
  it('markiert identische Texte komplett als gleich (ein zusammengefasster Lauf)', () => {
    const text = 'Dies ist ein Test.'
    const diff = wortDiff(text, text)
    expect(diff).not.toBeNull()
    expect(diff).toEqual([{ text, art: 'gleich' }])
  })

  it('reines Anhängen: neuer Text erscheint als eingefuegt am Ende', () => {
    const roh = 'Hallo Welt'
    const end = 'Hallo Welt und mehr'
    const diff = wortDiff(roh, end)!
    expect(diff.length).toBeGreaterThan(0)
    expect(diff[diff.length - 1]!.art).toBe('eingefuegt')
    // Der gemeinsame Anfang bleibt "gleich".
    expect(diff[0]!.art).toBe('gleich')
    expect(diff[0]!.text.startsWith('Hallo Welt')).toBe(true)
  })

  it('reines Löschen: entfernter Text erscheint als entfernt', () => {
    const roh = 'Hallo schöne Welt'
    const end = 'Hallo Welt'
    const diff = wortDiff(roh, end)!
    const entfernte = diff.filter((t) => t.art === 'entfernt')
    expect(entfernte.length).toBeGreaterThan(0)
    expect(entfernte.map((t) => t.text).join('')).toContain('schöne')
    // Es gibt keine eingefügten Tokens bei reinem Löschen.
    expect(diff.some((t) => t.art === 'eingefuegt')).toBe(false)
  })

  it('Ersetzung in der Mitte: entfernt+eingefuegt um unveränderten Rest', () => {
    const roh = 'Der schnelle Fuchs springt.'
    const end = 'Der lahme Fuchs springt.'
    const diff = wortDiff(roh, end)!
    expect(diff.some((t) => t.art === 'entfernt' && t.text.includes('schnelle'))).toBe(true)
    expect(diff.some((t) => t.art === 'eingefuegt' && t.text.includes('lahme'))).toBe(true)
    // Umgebender Text bleibt gleich.
    expect(diff.some((t) => t.art === 'gleich' && t.text.includes('Der'))).toBe(true)
    expect(diff.some((t) => t.art === 'gleich' && t.text.includes('Fuchs springt.'))).toBe(true)
  })

  it('Invariante: gleich+eingefuegt rekonstruiert exakt den endtext', () => {
    const roh = 'Der schnelle Fuchs springt.\nÜber den Zaun.'
    const end = 'Der  lahme Fuchs springt weiter.\n\nÜber den hohen Zaun.'
    const diff = wortDiff(roh, end)!
    expect(nurGleichUndEingefuegt(diff)).toBe(end)
  })

  it('Invariante: gleich+entfernt rekonstruiert exakt den rohtext', () => {
    const roh = 'Der schnelle Fuchs springt.\nÜber den Zaun.'
    const end = 'Der  lahme Fuchs springt weiter.\n\nÜber den hohen Zaun.'
    const diff = wortDiff(roh, end)!
    expect(nurGleichUndEntfernt(diff)).toBe(roh)
  })

  it('Invariante hält auch bei reinem Anhängen/Löschen/Identität', () => {
    const faelle: Array<[string, string]> = [
      ['Hallo Welt', 'Hallo Welt und mehr'],
      ['Hallo schöne Welt', 'Hallo Welt'],
      ['Gleicher Text.', 'Gleicher Text.'],
      ['', 'Neuer Text von Null.'],
      ['Alter Text komplett weg.', '']
    ]
    for (const [roh, end] of faelle) {
      const diff = wortDiff(roh, end)!
      expect(nurGleichUndEingefuegt(diff)).toBe(end)
      expect(nurGleichUndEntfernt(diff)).toBe(roh)
    }
  })

  it('leere Eingaben: beide leer ergibt leeres Diff', () => {
    expect(wortDiff('', '')).toEqual([])
  })

  it('leerer rohtext mit Endtext ergibt vollständig eingefuegt', () => {
    const diff = wortDiff('', 'Ganz neu.')!
    expect(diff).toEqual([{ text: 'Ganz neu.', art: 'eingefuegt' }])
  })

  it('leerer endtext mit Rohtext ergibt vollständig entfernt', () => {
    const diff = wortDiff('Ganz weg.', '')!
    expect(diff).toEqual([{ text: 'Ganz weg.', art: 'entfernt' }])
  })

  it('fasst benachbarte Tokens gleicher Art zusammen (weniger DOM-Knoten)', () => {
    // "a b c" vs "a X c" -> erwartet: gleich("a "), entfernt/eingefuegt für b/X (je ein Lauf
    // trotz Wort+Whitespace-Grenzen), gleich(" c") — keine Fragmentierung in Einzel-Tokens.
    const diff = wortDiff('eins zwei drei', 'eins vier fuenf drei')!
    // Es darf keine zwei aufeinanderfolgenden Einträge mit gleicher `art` geben.
    for (let k = 1; k < diff.length; k++) {
      expect(diff[k]!.art).not.toBe(diff[k - 1]!.art)
    }
  })

  it('Kappung: übersteigt der Rohtext MAX_DIFF_TOKENS, liefert wortDiff null', () => {
    const grosserText = Array.from({ length: MAX_DIFF_TOKENS + 10 }, (_, i) => `w${i}`).join(' ')
    expect(wortDiff(grosserText, 'kurz')).toBeNull()
  })

  it('Kappung: übersteigt der Endtext MAX_DIFF_TOKENS, liefert wortDiff null', () => {
    const grosserText = Array.from({ length: MAX_DIFF_TOKENS + 10 }, (_, i) => `w${i}`).join(' ')
    expect(wortDiff('kurz', grosserText)).toBeNull()
  })

  it('keine Kappung knapp unter dem Limit', () => {
    // Grob unter dem Token-Limit (Worte + Whitespace-Tokens zusammen).
    const text = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(' ')
    expect(wortDiff(text, text)).not.toBeNull()
  })
})
