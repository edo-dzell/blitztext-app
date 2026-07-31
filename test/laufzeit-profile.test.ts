import { describe, it, expect } from 'vitest'
import {
  MINDEST_AUFNAHME_SEKUNDEN_STUFEN,
  MINDEST_AUFNAHME_SEKUNDEN_DEFAULT,
  STILLE_PROFIL_STUFEN,
  STILLE_PROFIL_DEFAULT,
  stilleSchwellenFuer,
  NETZWERK_PROFIL_STUFEN,
  NETZWERK_PROFIL_DEFAULT,
  NETZWERK_WATCHDOG_MARGE_MS,
  netzwerkProfilWerte,
  RETRY_VERSUCHE_STUFEN,
  RETRY_VERSUCHE_DEFAULT,
  VERLAUF_MAXIMUM_STUFEN,
  VERLAUF_MAXIMUM_DEFAULT,
  STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN,
  STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT,
  UPDATE_INTERVALL_STUNDEN_STUFEN,
  UPDATE_INTERVALL_STUNDEN_DEFAULT,
  PILLEN_ANZEIGEDAUER_PROFIL_STUFEN,
  PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT,
  pillenAnzeigedauerWerteFuer,
  PERF_AKTIV_DEFAULT,
  istStufe
} from '@shared/laufzeit-profile'
// Drift-Schutz: gegen die HEUTIGEN main-seitigen Konstanten vergleichen, damit `laufzeit-profile.ts`
// nie unbemerkt vom Bestandsverhalten abweicht (siehe Auftrag: 'normal' MUSS exakt reproduzieren).
import { STILLE_HART, STILLE_WEICH, STILLE_DYNAMIK, STILLE_ABSOLUT } from '@main/transcription/quality'
import { DEFAULT_FETCH_TIMEOUT_MS } from '@main/transcription/cloud-provider'
import { pillenStatus } from '@main/window/pill-status'

describe('laufzeit-profile: Drift-Schutz gegen den Bestand', () => {
  // Befund A (v0.8.0): STILLE_ABSOLUT kam NEU dazu — die 'normal'-Stufe muss weiterhin byte-identisch
  // mit den main-seitigen Konstanten bleiben, jetzt inklusive der neuen absoluten Untergrenze.
  it("stilleSchwellenFuer('normal') ist identisch mit STILLE_HART/STILLE_WEICH/STILLE_DYNAMIK/STILLE_ABSOLUT aus quality.ts", () => {
    expect(stilleSchwellenFuer('normal')).toEqual({
      hart: STILLE_HART,
      weich: STILLE_WEICH,
      dynamik: STILLE_DYNAMIK,
      absolut: STILLE_ABSOLUT
    })
  })

  it("netzwerkProfilWerte('normal').fetchTimeoutMs ist identisch mit DEFAULT_FETCH_TIMEOUT_MS aus cloud-provider.ts", () => {
    expect(netzwerkProfilWerte('normal').fetchTimeoutMs).toBe(DEFAULT_FETCH_TIMEOUT_MS)
  })

  it("netzwerkProfilWerte('normal').watchdogMs ist identisch mit dem heutigen Runner-Watchdog (90_000, runner.ts)", () => {
    expect(netzwerkProfilWerte('normal').watchdogMs).toBe(90_000)
  })

  // Pillen-Profil: pill-status.ts exportiert seine AUTO_HIDE_*-Konstanten nicht (Modul-privat) — daher
  // wird HIER über das öffentliche Verhalten (pillenStatus) gegengeprüft, nicht über einen Direktimport.
  describe("Pillen-Profil gegen das beobachtbare Verhalten von pillenStatus (pill-status.ts)", () => {
    it('kurzer Fehlertext trifft die Basis-Anzeigedauer (Floor) exakt', () => {
      const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'x' })
      expect(s.dauerMs).toBe(pillenAnzeigedauerWerteFuer('normal').basisMs)
    })

    it('sehr langer Fehlertext trifft die Obergrenze (Ceiling) exakt', () => {
      const s = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'y'.repeat(200) })
      expect(s.dauerMs).toBe(pillenAnzeigedauerWerteFuer('normal').obergrenzeMs)
    })

    it('die Steigung zwischen zwei mittellangen Labels entspricht msProZeichen (Differenz kürzt das Präfix „⚠️ " heraus)', () => {
      const kurz = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'a'.repeat(80) })
      const lang = pillenStatus({ status: 'fehler', art: 'anbieter', message: 'a'.repeat(100) })
      const differenz = lang.dauerMs! - kurz.dauerMs!
      expect(differenz).toBe(20 * pillenAnzeigedauerWerteFuer('normal').msProZeichen)
    })
  })

  it("für JEDE Netzwerk-Stufe gilt watchdogMs > fetchTimeoutMs", () => {
    for (const stufe of NETZWERK_PROFIL_STUFEN) {
      const werte = netzwerkProfilWerte(stufe)
      expect(werte.watchdogMs).toBeGreaterThan(werte.fetchTimeoutMs)
    }
  })

  it('die Watchdog-Marge ist für jede Stufe identisch (Fetch + feste Marge, keine zweite gepflegte Zahl)', () => {
    for (const stufe of NETZWERK_PROFIL_STUFEN) {
      const werte = netzwerkProfilWerte(stufe)
      expect(werte.watchdogMs - werte.fetchTimeoutMs).toBe(NETZWERK_WATCHDOG_MARGE_MS)
    }
  })

  it("stilleSchwellenFuer('aus') liefert null (keine Stille-Prüfung)", () => {
    expect(stilleSchwellenFuer('aus')).toBeNull()
  })
})

describe('laufzeit-profile: Stufenlisten enthalten die dokumentierten Defaults', () => {
  it('mindestAufnahmeSekunden', () => {
    expect(MINDEST_AUFNAHME_SEKUNDEN_STUFEN).toContain(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT)
    expect(MINDEST_AUFNAHME_SEKUNDEN_DEFAULT).toBe(0.3)
    expect(MINDEST_AUFNAHME_SEKUNDEN_STUFEN).toEqual([0.1, 0.2, 0.3, 0.5, 1.0])
  })

  it('stilleProfil', () => {
    expect(STILLE_PROFIL_STUFEN).toContain(STILLE_PROFIL_DEFAULT)
    expect(STILLE_PROFIL_DEFAULT).toBe('normal')
    expect(STILLE_PROFIL_STUFEN).toEqual(['aus', 'vorsichtig', 'normal', 'streng'])
  })

  it('netzwerkProfil', () => {
    expect(NETZWERK_PROFIL_STUFEN).toContain(NETZWERK_PROFIL_DEFAULT)
    expect(NETZWERK_PROFIL_DEFAULT).toBe('normal')
    expect(NETZWERK_PROFIL_STUFEN).toEqual(['kurz', 'normal', 'lang'])
  })

  it('retryVersuche', () => {
    expect(RETRY_VERSUCHE_STUFEN).toContain(RETRY_VERSUCHE_DEFAULT)
    expect(RETRY_VERSUCHE_DEFAULT).toBe(2)
    expect(RETRY_VERSUCHE_STUFEN).toEqual([1, 2, 3, 4])
  })

  it('verlaufMaximum', () => {
    expect(VERLAUF_MAXIMUM_STUFEN).toContain(VERLAUF_MAXIMUM_DEFAULT)
    expect(VERLAUF_MAXIMUM_DEFAULT).toBe(200)
    expect(VERLAUF_MAXIMUM_STUFEN).toEqual([50, 100, 200, 500, 1000])
  })

  it('statistikKompaktierungTage', () => {
    expect(STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN).toContain(STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT)
    expect(STATISTIK_KOMPAKTIERUNG_TAGE_DEFAULT).toBe(90)
    expect(STATISTIK_KOMPAKTIERUNG_TAGE_STUFEN).toEqual([30, 60, 90, 180, 365])
  })

  it('updateIntervallStunden', () => {
    expect(UPDATE_INTERVALL_STUNDEN_STUFEN).toContain(UPDATE_INTERVALL_STUNDEN_DEFAULT)
    expect(UPDATE_INTERVALL_STUNDEN_DEFAULT).toBe(24)
    expect(UPDATE_INTERVALL_STUNDEN_STUFEN).toEqual([6, 12, 24, 72, 168])
  })

  it('pillenAnzeigedauerProfil', () => {
    expect(PILLEN_ANZEIGEDAUER_PROFIL_STUFEN).toContain(PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT)
    expect(PILLEN_ANZEIGEDAUER_PROFIL_DEFAULT).toBe('normal')
    expect(PILLEN_ANZEIGEDAUER_PROFIL_STUFEN).toEqual(['kurz', 'normal', 'lang'])
  })

  it('perfAktiv', () => {
    expect(PERF_AKTIV_DEFAULT).toBe(false)
  })
})

describe('laufzeit-profile: Auflösungsfunktionen für alle Stufen (keine wirft, keine liefert unsinnige Werte)', () => {
  it('stilleSchwellenFuer: vorsichtig < normal < streng in hart/weich/dynamik/absolut (monoton strenger)', () => {
    const vorsichtig = stilleSchwellenFuer('vorsichtig')!
    const normal = stilleSchwellenFuer('normal')!
    const streng = stilleSchwellenFuer('streng')!
    expect(vorsichtig.hart).toBeLessThan(normal.hart)
    expect(normal.hart).toBeLessThan(streng.hart)
    expect(vorsichtig.weich).toBeLessThan(normal.weich)
    expect(normal.weich).toBeLessThan(streng.weich)
    expect(vorsichtig.dynamik).toBeLessThan(normal.dynamik)
    expect(normal.dynamik).toBeLessThan(streng.dynamik)
    // Befund A (v0.8.0): absolut skaliert ebenso monoton UND bleibt in jeder Stufe über `weich`
    // (Faktor 2,5) — sonst würde die absolute Untergrenze den lautesten bekannten Fehlalarm dieser
    // Stufe nicht mehr abdecken (siehe STILLE_ABSOLUT-Kommentar in quality.ts).
    expect(vorsichtig.absolut).toBeLessThan(normal.absolut)
    expect(normal.absolut).toBeLessThan(streng.absolut)
    for (const stufe of [vorsichtig, normal, streng]) {
      expect(stufe.absolut).toBeGreaterThan(stufe.weich)
    }
  })

  it('netzwerkProfilWerte: kurz < normal < lang (fetchTimeoutMs)', () => {
    expect(netzwerkProfilWerte('kurz').fetchTimeoutMs).toBeLessThan(
      netzwerkProfilWerte('normal').fetchTimeoutMs
    )
    expect(netzwerkProfilWerte('normal').fetchTimeoutMs).toBeLessThan(
      netzwerkProfilWerte('lang').fetchTimeoutMs
    )
  })

  it('pillenAnzeigedauerWerteFuer: kurz < normal < lang (alle drei Werte proportional)', () => {
    const kurz = pillenAnzeigedauerWerteFuer('kurz')
    const normal = pillenAnzeigedauerWerteFuer('normal')
    const lang = pillenAnzeigedauerWerteFuer('lang')
    expect(kurz.basisMs).toBeLessThan(normal.basisMs)
    expect(normal.basisMs).toBeLessThan(lang.basisMs)
    expect(kurz.obergrenzeMs).toBeLessThan(normal.obergrenzeMs)
    expect(normal.obergrenzeMs).toBeLessThan(lang.obergrenzeMs)
    expect(kurz.msProZeichen).toBeLessThan(normal.msProZeichen)
    expect(normal.msProZeichen).toBeLessThan(lang.msProZeichen)
  })
})

describe('istStufe (generischer Wertebereichs-Check)', () => {
  it('erkennt Mitglieder der Stufenliste', () => {
    expect(istStufe(RETRY_VERSUCHE_STUFEN, 3)).toBe(true)
    expect(istStufe(STILLE_PROFIL_STUFEN, 'streng')).toBe(true)
  })

  it('lehnt Nicht-Mitglieder und typfremde Werte ab, ohne zu werfen', () => {
    expect(istStufe(RETRY_VERSUCHE_STUFEN, 7)).toBe(false)
    expect(istStufe(RETRY_VERSUCHE_STUFEN, '2')).toBe(false)
    expect(istStufe(RETRY_VERSUCHE_STUFEN, undefined)).toBe(false)
    expect(istStufe(STILLE_PROFIL_STUFEN, 'unbekannt')).toBe(false)
  })
})
