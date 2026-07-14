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
}
