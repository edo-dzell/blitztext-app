/*
 * win-paste.exe — winziger nativer Paste-Helfer (ADR-0003, erweitert W3 für ADR-0011 Weg B + MAL-2).
 *
 * CLI-Protokoll (schlank, stdout/Exit-Code):
 *   win-paste.exe                 → unbedingt einfügen (Rückwärts-Kompatibilität, wie v1).
 *   win-paste.exe --paste         → unbedingt einfügen (explizit, gleiches Verhalten).
 *   win-paste.exe --paste <hwnd>  → NUR einfügen, wenn das aktuelle Vordergrundfenster == <hwnd> ist
 *                                   (nativer Drift-Gate, Weg B). Bei Drift: Exit-Code 2, kein Tastendruck.
 *   win-paste.exe --hwnd          → das aktuelle Vordergrundfenster-Handle als Dezimalzahl auf stdout
 *                                   (die App merkt es beim Auslösen und vergleicht vor dem Einfügen).
 *   win-paste.exe --set-clip      → liest UTF-8-Text von stdin und legt ihn so in die Zwischenablage,
 *                                   dass er NICHT in die Zwischenablage-Historie / Cloud-Sync gelangt
 *                                   (MAL-2: ExcludeClipboardContentFromMonitorProcessing +
 *                                    CanIncludeInClipboardHistory=0). Electron-clipboard bleibt Fallback.
 *
 * Beim Einfügen wird der Text VOR dem Aufruf von der App gesetzt (paste-service.ts / bzw. --set-clip);
 * dieser Helfer sendet nur den Einfüge-Tastendruck ins Paste-Ziel (das Vordergrundfenster):
 *   - Terminal erkannt  → Strg+Shift+V (Konsolen nehmen Strg+V nicht als Einfügen)
 *   - sonst             → Strg+V
 *
 * Zuvor werden physisch gehaltene Modifier freigegeben, damit der gehaltene "Halten"-Hotkey das
 * synthetische Strg+V nicht zu Strg+Alt+V o.ä. kontaminiert (ADR-0003, Bezug ADR-0002).
 *
 * Laufzeit-Feinabstimmung (welche Terminal-Klassen, Modifier-Restore, Timing) ist HITL/Windows
 * (#04) — hier steht die nach ADR-0003 erwartete Struktur; gebaut wird via mingw-w64 cross (ADR-0006).
 *
 * Bekannte Grenze: Läuft das Vordergrundfenster als Administrator, nimmt es von einer
 * nicht-erhöhten App kein SendInput an → die Fallback-Kette (PowerShell/Hinweis) greift. Ein HWND
 * passt praktisch in 2^32 (Windows-Handle-Vergabe), daher als Dezimalzahl JS-sicher parsbar.
 *
 * Exit-Code-Katalog (gesamtes Programm):
 *   0 = Erfolg (eingefügt/HWND ausgegeben/Zwischenablage gesetzt, je nach Kommando)
 *   1 = --hwnd: kein Vordergrundfenster ermittelbar
 *   2 = Drift-Gate (--paste <hwnd>): Vordergrund != erwartetes <hwnd> → NICHTS gesendet
 *   3 = <hwnd>-Argument fehlt oder ist nicht als positive Ganzzahl parsbar
 *   4 = --set-clip: stdin leer/nicht lesbar oder UTF-8→UTF-16-Konvertierung fehlgeschlagen
 *   5 = --set-clip: OpenClipboard/SetClipboardData fehlgeschlagen
 */

#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>

static void send_key(WORD vk, BOOL up) {
    INPUT in;
    ZeroMemory(&in, sizeof(in));
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    SendInput(1, &in, sizeof(INPUT));
}

static BOOL is_down(int vk) {
    return (GetAsyncKeyState(vk) & 0x8000) != 0;
}

static BOOL foreground_is_terminal(void) {
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return FALSE;
    char cls[256] = {0};
    if (!GetClassNameA(hwnd, cls, (int)sizeof(cls))) return FALSE;
    return strcmp(cls, "ConsoleWindowClass") == 0            /* klassische Konsole (conhost) */
        || strcmp(cls, "CASCADIA_HOSTING_WINDOW_CLASS") == 0 /* Windows Terminal */
        || strcmp(cls, "mintty") == 0;                       /* Git Bash / mintty */
}

/* Einfüge-Tastendruck ins Vordergrundfenster senden (die eigentliche Paste-Mechanik). */
static void sende_einfuegen(void) {
    static const WORD mods[] = {
        VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU,
        VK_LSHIFT, VK_RSHIFT, VK_LWIN, VK_RWIN
    };
    const int n = (int)(sizeof(mods) / sizeof(mods[0]));

    BOOL was_down[8];
    for (int i = 0; i < n; i++) {
        was_down[i] = is_down(mods[i]);
        if (was_down[i]) send_key(mods[i], TRUE);
    }
    Sleep(5); /* dem System Zeit geben, die freigegebenen Modifier zu verarbeiten */

    BOOL terminal = foreground_is_terminal();

    send_key(VK_CONTROL, FALSE);
    if (terminal) send_key(VK_SHIFT, FALSE);
    send_key('V', FALSE);
    send_key('V', TRUE);
    if (terminal) send_key(VK_SHIFT, TRUE);
    send_key(VK_CONTROL, TRUE);

    /* Best-effort-Restore zuvor gehaltener Modifier (physisch hält der Nutzer den Hotkey ggf.
       weiter; finale Abstimmung HITL/Windows, #04). */
    for (int i = 0; i < n; i++) {
        if (was_down[i]) send_key(mods[i], FALSE);
    }
}

/* --hwnd: aktuelles Vordergrundfenster-Handle als Dezimalzahl auf stdout. Kein Fenster → Exit 1. */
static int kommando_hwnd(void) {
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return 1;
    /* HWND ist ein Zeiger; als vorzeichenlose Ganzzahl ausgeben (praktisch < 2^32 → JS-sicher). */
    printf("%llu\n", (unsigned long long)(uintptr_t)hwnd);
    return 0;
}

/* --paste [<hwnd>]: ohne Argument unbedingt einfügen; mit <hwnd> nur bei passendem Vordergrund
   (nativer Drift-Gate, Weg B). Drift → Exit 2 (kein Tastendruck). Ungültiges <hwnd> → Exit 3. */
static int kommando_paste(const char *hwnd_arg) {
    if (hwnd_arg != NULL) {
        char *ende = NULL;
        unsigned long long erwartet = strtoull(hwnd_arg, &ende, 10);
        if (ende == hwnd_arg || *ende != '\0' || erwartet == 0ULL) return 3;
        unsigned long long aktuell = (unsigned long long)(uintptr_t)GetForegroundWindow();
        if (aktuell != erwartet) return 2; /* Fokus gewandert → NICHT ins fremde Fenster tippen */
    }
    sende_einfuegen();
    return 0;
}

/* Ein Clipboard-Format registrieren; 0 (nicht registrierbar) toleriert der Aufrufer. */
static UINT registriere_format(const char *name) {
    return RegisterClipboardFormatA(name);
}

/* Ein leeres (0-Byte) Marker-Format setzen, dessen bloße Anwesenheit das Verhalten steuert
   (ExcludeClipboardContentFromMonitorProcessing / CanIncludeInClipboardHistory). */
static void setze_marker_format(UINT format) {
    if (!format) return;
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, 1);
    if (!h) return;
    void *p = GlobalLock(h);
    if (p) {
        ((BYTE *)p)[0] = 0;
        GlobalUnlock(h);
        if (!SetClipboardData(format, h)) GlobalFree(h); /* bei Misserfolg selbst freigeben */
    } else {
        GlobalFree(h);
    }
}

/* Gesamten stdin (UTF-8) einlesen; Aufrufer gibt free() zurück. NULL bei Fehler/leer. */
static char *lies_stdin(void) {
    size_t cap = 4096, len = 0;
    char *buf = (char *)malloc(cap);
    if (!buf) return NULL;
    int c;
    while ((c = fgetc(stdin)) != EOF) {
        if (len + 1 >= cap) {
            size_t neu = cap * 2;
            char *g = (char *)realloc(buf, neu);
            if (!g) { free(buf); return NULL; }
            buf = g;
            cap = neu;
        }
        buf[len++] = (char)c;
    }
    buf[len] = '\0';
    return buf;
}

/* --set-clip (MAL-2): stdin-Text so in die Zwischenablage legen, dass er NICHT in Historie/Cloud-Sync
   gelangt. Setzt CF_UNICODETEXT + die zwei Windows-Marker-Formate. Exit 0 bei Erfolg, sonst != 0. */
static int kommando_set_clip(void) {
    char *utf8 = lies_stdin();
    if (!utf8) return 4;

    /* UTF-8 → UTF-16 für CF_UNICODETEXT. */
    int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    if (wlen <= 0) { free(utf8); return 4; }
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, (size_t)wlen * sizeof(WCHAR));
    if (!h) { free(utf8); return 4; }
    WCHAR *w = (WCHAR *)GlobalLock(h);
    if (!w) { GlobalFree(h); free(utf8); return 4; }
    MultiByteToWideChar(CP_UTF8, 0, utf8, -1, w, wlen);
    GlobalUnlock(h);
    free(utf8);

    if (!OpenClipboard(NULL)) { GlobalFree(h); return 5; }
    EmptyClipboard();
    /* Marker VOR dem Text setzen — ihre Anwesenheit im Clipboard-Set steuert Historie/Sync.
       ExcludeClipboardContentFromMonitorProcessing: Clipboard-History/Cloud verarbeiten den Inhalt nicht.
       CanIncludeInClipboardHistory = 0 (leeres/0-Marker genügt als „ausschließen"). */
    setze_marker_format(registriere_format("ExcludeClipboardContentFromMonitorProcessing"));
    setze_marker_format(registriere_format("CanIncludeInClipboardHistory"));
    int rc = 0;
    if (!SetClipboardData(CF_UNICODETEXT, h)) {
        GlobalFree(h); /* System hat das Handle nicht übernommen → selbst freigeben */
        rc = 5;
    }
    CloseClipboard();
    return rc;
}

int main(int argc, char **argv) {
    /* Kein Argument → unbedingt einfügen (Rückwärts-Kompatibilität mit v1). */
    if (argc < 2) return kommando_paste(NULL);

    if (strcmp(argv[1], "--hwnd") == 0) return kommando_hwnd();
    if (strcmp(argv[1], "--set-clip") == 0) return kommando_set_clip();
    if (strcmp(argv[1], "--paste") == 0) return kommando_paste(argc >= 3 ? argv[2] : NULL);

    /* Unbekanntes Argument → als unbedingtes Einfügen behandeln (defensiv, nie den Paste verlieren). */
    return kommando_paste(NULL);
}
