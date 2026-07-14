// Minimale, architektur-fokussierte Lint-Regel (A10.2): verbietet WERT-Importe von Main-Prozess-Modulen
// (@main) im Renderer — Typ-Importe (`import type`) sind ok. Hält den Renderer-Bundle frei von Electron/
// Node-Code. Bewusst KEIN allgemeines Regelwerk (kein Floodgate auf nie-gelintetem Bestand); der
// typecheck deckt den Rest. Reine @main-Logik (prompt-builder, electron.vite.config erlaubt sie für R2/#10)
// nur per gezielter eslint-disable-Ausnahme an der Importzeile.
//
// Gespiegelter Block (D4): src/shared ist richtungsunabhängig und darf weder @main- noch @renderer-Module
// als WERT importieren (Typ-Importe ok) — sonst entsteht eine versteckte Richtungsabhängigkeit im
// „neutralen" Layer. Gleiche Beschränkung wie oben, ebenfalls bewusst KEIN allgemeines Regelwerk.

import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // D4: schaltet src/main überhaupt fürs Linten frei (Flat-Config lintet nur Dateien, die in einem
    // files-Block landen). Bewusst OHNE eigene Regeln — Main hat aktuell keine architektonische
    // Import-Beschränkung; der typecheck deckt den Rest ab.
    files: ['src/main/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main', '@main/*'],
              allowTypeImports: true,
              message:
                'Renderer darf keinen Main-/Electron-Code als WERT importieren (nur @shared-Logik; Typen sind ok).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/shared/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main', '@main/*', '@renderer', '@renderer/*'],
              allowTypeImports: true,
              message:
                'shared ist richtungsunabhängig — keine Main-/Renderer-Importe (Typen sind ok).'
            }
          ]
        }
      ]
    }
  }
)
