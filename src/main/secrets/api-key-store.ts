// Framework-freie Ports für die sichere Key-Ablage (ADR-0004): der Cipher (Electron safeStorage) und
// die Ciphertext-Datei (fs). Injiziert, damit der Kern (api-key-vault.ts) ohne echtes safeStorage/
// Dateisystem testbar ist. Die echten Adapter werden im Main-Prozess verdrahtet.

export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encrypt(plain: string): Promise<Uint8Array>
  decrypt(data: Uint8Array): Promise<string>
}

export interface CiphertextFile {
  read(): Promise<Uint8Array | null>
  write(data: Uint8Array): Promise<void>
  remove(): Promise<void>
  /**
   * Korruptions-Rettung (A1, Muster wörtlich wie `SettingsFile.beiseiteLegen` in settings-file.ts):
   * eine vorhandene, aber nicht entschlüsselbare/parsebare Datei beiseite legen (Suffix `.korrupt`),
   * BEVOR ein nachfolgender Schreibvorgang sie sonst stillschweigend überschreiben würde. Optional,
   * damit bestehende Fake-Ports/Tests ohne diese Methode weiter gültig bleiben — Kern-Aufrufer rufen
   * sie nur mit `?.()`. Wirft NIE (best effort — die Rettung ist optional, der Aufrufer hat Vorrang).
   */
  beiseiteLegen?(): Promise<void>
}
