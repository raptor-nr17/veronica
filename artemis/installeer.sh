#!/usr/bin/env bash
# installeer.sh -- ARTEMIS (Google, Apache 2.0) op de Linux-kant van de Chromebook, zodat Claude de REKTELEFOONS kan besturen
# via de webconsole op http://localhost:8000. Een keer plakken in de Linux-terminal:
#
#     bash <(curl -fsSL <adres van Veronica>/artemis/installeer.sh)
#
# Wat dit script doet, en NIET doet:
#   - adb, git en curl installeren (apt), ARTEMIS ophalen op EEN vaste, nagekeken versie (ARTEMIS_VERSIE);
#   - de Gemini-sleutel VRAGEN (je typt hem, hij komt niet in beeld) en alleen bewaren in ~/artemis/.env (alleen jij mag
#     dat bestand lezen). De sleutel gaat nergens anders heen: niet naar een repo, niet naar Veronica, niet in een logboek;
#   - standaard het profiel flash, en ARTEMIS_KEEP_DEVICE_AWAKE=false (ARTEMIS houdt een scherm niet wakker);
#   - een LIJST VAN TOEGESTANE TOESTELLEN (~/.artemis-rek/toegestaan): alleen telefoons die jij hier als rektelefoon
#     aanwijst. De F8 (de dagelijkse telefoon) komt er NOOIT op. Een bank-, crypto- of kluisapp op een telefoon is
#     GEEN reden meer om hem te weigeren: op alle drie de rektelefoons staan zulke apps achter 2FA en die kunnen er niet
#     af. We openen ze alleen nooit (zie de waakhond);
#   - een WAAKHOND die tijdens het draaien elke twee seconden kijkt: een toestel dat niet op de lijst staat (of de F8) =
#     ARTEMIS meteen uit; een GEVOELIGE app op de voorgrond (bank, betalen, crypto, Bitwarden, Authy, DigiD) = ARTEMIS
#     meteen stoppen, geen schermfoto en niets naar Gemini, plus terug naar het beginscherm; een persoonlijke app tijdens
#     het werk (Gmail, Foto's, WhatsApp) = terug naar het beginscherm en die app gestopt, ARTEMIS blijft draaien.
#   - het verwijdert NOOIT een app, en het verandert geen instellingen op een telefoon.
#
# Daarna: `artemis-rek start` (console op http://localhost:8000), `artemis-rek stop`, `artemis-rek toestellen`,
# `artemis-rek draadloos`, `artemis-rek status`.
set -euo pipefail

ARTEMIS_REPO="https://github.com/google/artemis"
ARTEMIS_VERSIE="351ca8422f7b5b54e80a9c1ce03a222e02415b6b"   # nagekeken op 25 oktober 2026; een nieuwere = eerst nakijken
ARTEMIS_MAP="${ARTEMIS_MAP:-$HOME/artemis}"
REK_MAP="${REK_MAP:-$HOME/.artemis-rek}"
BIN_MAP="${BIN_MAP:-$HOME/.local/bin}"

zeg() { printf '%s\n' "$*"; }
tty_lees() {   # lees van het toetsenbord, ook als dit script via een pijp binnenkwam
  local __var="$1" __vraag="$2" __stil="${3:-}"
  if [ -r /dev/tty ]; then
    if [ -n "$__stil" ]; then IFS= read -r -s -p "$__vraag" "$__var" </dev/tty; printf '\n' >/dev/tty
    else IFS= read -r -p "$__vraag" "$__var" </dev/tty; fi
  else
    printf -v "$__var" '%s' ""
  fi
}

# ---- 1. De bestanden die op de computer blijven (ook los te schrijven voor de test: --alleen-bestanden <map>) ----
schrijf_bestanden() {
  local rek="$1" bin="$2"
  mkdir -p "$rek" "$bin"
  chmod 700 "$rek"
  # 571: de bron waarvandaan artemis-rek zichzelf bijwerkt (de site). Komt uit de omgeving bij de installatie EN bij een
  # zelf-bijwerkronde, zodat hij blijft staan. Geen naam in de code: de eigenaar geeft hem een keer mee in de installatieregel.
  if [ -n "${ARTEMIS_BRON:-}" ]; then printf '%s\n' "${ARTEMIS_BRON%/}" >"$rek/bron"; chmod 600 "$rek/bron"; fi
  cat >"$rek/verboden-apps.txt" <<'LIJST'
# Apps die ARTEMIS NOOIT mag openen of aantikken. Een regel = een pakketnaam, of een stukje ervan na "~".
# TWEE SOORTEN, en een app op een telefoon is NOOIT een reden om die telefoon te weigeren (op alle drie de rektelefoons
# staan bank-, crypto- en kluisapps achter 2FA, die kunnen er niet af):
#  - GEVOELIG (de regels hieronder, met "~" of een volledige pakketnaam): bank, betalen, crypto, Bitwarden, Authy, DigiD.
#    Komt zo'n app op de voorgrond terwijl ARTEMIS draait, dan STOPT ARTEMIS meteen (geen schermfoto, niets naar Gemini)
#    en gaat de telefoon terug naar het beginscherm.
#  - TIJDENS HET WERK (regels met "voorgrond:"): Gmail, Foto's, WhatsApp en zo Die staan vaak al op een telefoon; ze gaan
#    tijdens het werk terug naar het beginscherm en worden gestopt, maar ARTEMIS blijft draaien.
~bank
~wallet
~paypal
~tikkie
~revolut
~bunq
~authenticator
~authy
~bitwarden
~digid
~mobielbetalen
~payments
~klarna
~lastpass
~1password
~keepass
~crypto
~coinbase
~binance
~bitvavo
~kraken
~ledger
~metamask
~trustwallet
~exodus
com.ing.mobile
nl.rabomobiel
com.google.android.apps.walletnfcrel
voorgrond:com.google.android.gm
voorgrond:com.google.android.apps.photos
voorgrond:com.whatsapp
voorgrond:org.telegram.messenger
voorgrond:org.thoughtcrime.securesms
LIJST
  cat >"$bin/artemis-rek.nieuw" <<'REK'
#!/usr/bin/env bash
# artemis-rek -- ARTEMIS starten en stoppen met de waakhond ernaast. Geschreven door installeer.sh.
set -uo pipefail
ARTEMIS_MAP="${ARTEMIS_MAP:-$HOME/artemis}"
REK_MAP="${REK_MAP:-$HOME/.artemis-rek}"
ADB="${ADB:-adb}"
TOEG="$REK_MAP/toegestaan"
VERB="$REK_MAP/verboden-apps.txt"
LOG="$REK_MAP/waakhond.log"
PIDA="$REK_MAP/artemis.pid"
PIDW="$REK_MAP/waakhond.pid"
BRONF="$REK_MAP/bron"
AANF="$REK_MAP/aan"           # 571: de GEWENSTE stand (ARTEMIS aan). De console-lus houdt ARTEMIS aan zolang dit bestand er is.
CONSOLE_POORT="${ARTEMIS_CONSOLE_POORT:-8000}"   # onze knoppen-console (Veronica/Claude openen die)
ARTEMIS_POORT="${ARTEMIS_POORT:-8001}"           # ARTEMIS zelf op een EIGEN poort, zodat hij onze console op 8000 niet in de weg zit
BIN_SELF="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "$HOME/.local/bin")"

zeg() { printf '%s\n' "$*"; }
logregel() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >>"$LOG"; zeg "$*"; }
leeft() { [ -s "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# Verboden op de voorgrond? $1 = pakketnaam. Echoot de soort en geeft 0 terug:
#  - "streng" = bank/betalen/crypto/Bitwarden/Authy/DigiD: ARTEMIS meteen stoppen (geen schermfoto, niets naar Gemini);
#  - "werk"   = een persoonlijke app (voorgrond:...): terug naar het beginscherm, ARTEMIS blijft draaien.
# Niets + exit 1 = toegestaan. Een tweede argument wordt genegeerd: een app WEIGERT nooit meer een telefoon (ARTEMIS-ronde
# 25 okt). De bank-, crypto- en kluisapps staan achter 2FA en kunnen er niet af; we openen ze alleen nooit.
verboden() {
  local pkg="$1" r
  [ -n "$pkg" ] || return 1
  while IFS= read -r r || [ -n "$r" ]; do
    r="${r%%#*}"; r="${r// /}"; [ -n "$r" ] || continue
    if [ "${r#voorgrond:}" != "$r" ]; then
      [ "${r#voorgrond:}" = "$pkg" ] && { printf 'werk'; return 0; }
      continue
    fi
    if [ "${r#\~}" != "$r" ]; then case "$pkg" in *"${r#\~}"*) printf 'streng'; return 0 ;; esac
    elif [ "$r" = "$pkg" ]; then printf 'streng'; return 0; fi
  done <"$VERB"
  return 1
}

toestel_id() {   # het vaste serienummer van de telefoon (een draadloos adres verandert elke keer)
  local i; i="$("$ADB" -s "$1" shell getprop ro.serialno 2>/dev/null | tr -d '\r\n ')"
  [ -n "$i" ] && printf '%s' "$i" || printf 'adb:%s' "$1"
}
toestel_naam() { "$ADB" -s "$1" shell getprop ro.product.model 2>/dev/null | tr -d '\r'; }
is_f8() {   # de F8 (de dagelijkse telefoon) blijft ALTIJD uitgesloten -- op naam en op modelcode
  local n; n="$(toestel_naam "$1")"
  case "$n" in *F8*|*25102PCBEG*) return 0 ;; esac
  return 1
}
toegestaan() { [ -n "$1" ] && [ -s "$TOEG" ] && grep -qxF "$1" "$TOEG"; }
verbonden() { "$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}'; }
voorgrond() {
  "$ADB" -s "$1" shell dumpsys window 2>/dev/null | tr -d '\r' \
    | sed -n 's/.*mCurrentFocus=Window{[^ ]* [^ ]* \([A-Za-z0-9_.]*\)\/.*/\1/p' | head -1
}

# 571: AUTO-SCAN. Zet elk AANGESLOTEN, al toegestane (adb-stand 'device'), niet-F8 toestel vanzelf op de lijst, zonder vraag.
# Een telefoon komt alleen in de 'device'-stand nadat er OP de telefoon 'Toestaan' is getikt (USB-foutopsporing) -- dat is de
# bewuste mens-stap per rektelefoon. De F8 blijft ALTIJD uitgesloten. Zo is 'toestellen' met de hand niet meer nodig.
scan() {
  "$ADB" start-server >/dev/null 2>&1 || true
  touch "$TOEG"; chmod 600 "$TOEG" 2>/dev/null || true
  local s id naam n=0
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"
    toegestaan "$id" && continue
    naam="$(toestel_naam "$s")"
    printf '%s\n' "$id" >>"$TOEG"; n=$((n+1))
    logregel "Nieuwe rektelefoon vanzelf op de lijst: $naam."
  done
  [ "$n" -gt 0 ] && zeg "$n nieuwe telefoon(s) toegevoegd." || zeg "Geen NIEUWE telefoons toegevoegd."
  # 573: altijd tonen WAT adb ziet (ook unauthorized/offline), zodat Claude in de console leest waarom er niets bijkwam.
  overzicht
}

# 573: WAT ADB NU ZIET, per aangesloten toestel -- zodat Claude het in de console (Chrome) kan lezen. 'unauthorized' is geen fout
# maar "tik Toestaan op de telefoon"; een leeg model hoort daar ook bij. Geen vraag, alleen tonen.
overzicht() {
  "$ADB" start-server >/dev/null 2>&1 || true
  local regels s staat id naam
  regels="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')"
  if [ -z "$regels" ]; then
    zeg "adb ziet geen enkel toestel. Kabel erin, in ChromeOS de telefoon DELEN met Linux, en op de telefoon USB-foutopsporing aan."
    return 0
  fi
  zeg "Wat adb nu ziet:"
  while read -r s staat; do
    [ -n "$s" ] || continue
    case "$staat" in
      device)
        naam="$(toestel_naam "$s")"; naam="${naam:-onbekend model}"; id="$(toestel_id "$s")"
        if is_f8 "$s"; then zeg "  - $naam ($s): de F8 -- blijft altijd uitgesloten."
        elif toegestaan "$id"; then zeg "  - $naam ($s): rektelefoon, staat op de lijst."
        else zeg "  - $naam ($s): klaar maar nog niet op de lijst -- tik 'Zoek telefoons' om hem erop te zetten."; fi ;;
      unauthorized) zeg "  - ($s): WACHT OP JOUW TIK -- kies op de telefoon 'Toestaan' (zet een vinkje 'Altijd toestaan vanaf deze computer'). Daarna 'Zoek telefoons'." ;;
      offline) zeg "  - ($s): offline -- kabel los en opnieuw erin, of ontgrendel de telefoon." ;;
      *) zeg "  - ($s): geweigerd of een onbekende staat ($staat)." ;;
    esac
  done <<<"$regels"
  zeg "Op de lijst: $(grep -c . "$TOEG" 2>/dev/null || echo 0) rektelefoon(s)."
}

# 573: "Vergeet overgeslagen". ARTEMIS onthoudt GEEN overgeslagen toestellen (scan voegt alleen toe, slaat niets op als
# "nooit meer"), dus er is niets te wissen. Mocht een oude versie ooit een lijstje hebben weggeschreven: dat wordt opgeruimd.
# Daarna gewoon opnieuw zoeken en tonen wat adb ziet.
vergeet() {
  rm -f "$REK_MAP/overgeslagen" 2>/dev/null || true
  zeg "ARTEMIS onthoudt geen overgeslagen toestellen, dus er is niets te vergeten. Ik zoek opnieuw:"
  scan
}

# 571: ZELF BIJWERKEN vanaf de site. Haalt het nieuwste installeer.sh op (de bron staat in ~/.artemis-rek/bron), controleert dat
# het geldige bash is EN op ARTEMIS lijkt, en laat het ALLEEN de bestanden herschrijven (--alleen-bestanden). Bij elke twijfel:
# niets veranderd. De bron wordt doorgegeven zodat hij blijft staan. Nooit iets uitvoeren uit het opgehaalde script zelf.
zelf_bijwerken() {
  [ -s "$BRONF" ] || { zeg "Geen bron voor bijwerken ingesteld (niet meegegeven bij de installatie)."; return 1; }
  command -v curl >/dev/null 2>&1 || { zeg "Bijwerken: curl ontbreekt."; return 1; }
  local base tmp; base="$(cat "$BRONF")"; tmp="$(mktemp)" || return 1
  if ! curl -fsSL "$base/artemis/installeer.sh" -o "$tmp"; then zeg "Bijwerken: kon het script niet ophalen (geen internet?)."; rm -f "$tmp"; return 1; fi
  if ! bash -n "$tmp" 2>/dev/null; then zeg "Bijwerken: het opgehaalde script is geen geldige bash; niets veranderd."; rm -f "$tmp"; return 1; fi
  if ! grep -q 'artemis-rek' "$tmp" || ! grep -q 'ARTEMIS_REPO=' "$tmp"; then zeg "Bijwerken: het opgehaalde script lijkt niet op ARTEMIS; niets veranderd."; rm -f "$tmp"; return 1; fi
  if ARTEMIS_BRON="$base" bash "$tmp" --alleen-bestanden "$REK_MAP" "$BIN_SELF" >/dev/null 2>&1; then logregel "Bijgewerkt vanaf de site."; rm -f "$tmp"; return 0; fi
  zeg "Bijwerken mislukte; niets veranderd."; rm -f "$tmp"; return 1
}

# 576: ARTEMIS draait op uv. uv koos cpython-3.15, en grpcio (via langchain-google-vertexai) heeft daar geen kant-en-klare wheel
# voor -> uv bouwt het vanaf de bron -> 'c++' ontbreekt in Crostini -> ARTEMIS start NOOIT. We pinnen Python op 3.12: dan zijn er
# wheels en is er geen compiler nodig. De pin staat in .python-version (leest uv altijd) EN start() geeft UV_PYTHON=3.12 mee.
zorg_venv() {
  [ -d "$ARTEMIS_MAP" ] || return 0
  printf '3.12\n' >"$ARTEMIS_MAP/.python-version" 2>/dev/null || true   # uv kiest nooit meer 3.15, ook via ARTEMIS' eigen start.sh
  local nu=""
  [ -x "$ARTEMIS_MAP/.venv/bin/python" ] && nu="$("$ARTEMIS_MAP/.venv/bin/python" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)"
  if [ "${1:-}" = forceer ] || { [ -n "$nu" ] && [ "$nu" != "3.12" ]; }; then
    [ -n "$nu" ] && [ "$nu" != "3.12" ] && zeg "De venv draaide op Python $nu (daar faalt grpcio); ik bouw hem opnieuw op met 3.12."
    rm -rf "$ARTEMIS_MAP/.venv"
    if command -v uv >/dev/null 2>&1; then
      ( cd "$ARTEMIS_MAP" && uv python install 3.12 >>"$REK_MAP/artemis.log" 2>&1; UV_PYTHON=3.12 uv sync >>"$REK_MAP/artemis.log" 2>&1 ) \
        && zeg "venv opnieuw opgebouwd met Python 3.12 (wheels, geen compiler)." \
        || zeg "Opbouwen gaf een fout -- kijk bij Log."
    else
      zeg "uv staat er nog niet; ARTEMIS bouwt de venv zelf bij de eerste start -- nu met Python 3.12 (.python-version)."
    fi
  fi
}

# 576: na Bijwerken laadt de DRAAIENDE console-server de nieuwe code niet vanzelf (geen Log-knop zichtbaar). Stop de oude en
# start een verse. Deze opdracht draait in een eigen sessie (niet als "console"), dus pkill op "artemis-rek console" raakt
# onszelf niet. In een test staat ARTEMIS_GEEN_HERSTART, zodat er geen echte server opstart.
herstart_console() {
  [ -n "${ARTEMIS_GEEN_HERSTART:-}" ] && return 0
  pkill -f "artemis-rek console" 2>/dev/null || true
  sleep 1
  setsid "$BIN_SELF/artemis-rek" console </dev/null >>"$REK_MAP/console.log" 2>&1 &
  zeg "De console is opnieuw gestart met de nieuwe code -- herlaad de pagina in Chrome."
}

# 576: de Bijwerken-knop. Werkt het script bij, bouwt de venv opnieuw op met Python 3.12, en herstart de console zodat de nieuwe
# code (zoals de Log-knop) meteen zichtbaar is.
bijwerken() {
  zelf_bijwerken || zeg "Het script bijwerken ging niet door; ik ga wel verder met de venv en de console."
  zorg_venv forceer
  herstart_console
}

# 571: AUTOSTART. Een systemd --user-dienst start de console bij het inloggen op Linux; een regel in ~/.profile is de terugval
# voor een Crostini zonder systemd --user. Zo draait de console (localhost) altijd, en hoeft de eigenaar na de installatie nooit
# meer de terminal in.
autostart_installeren() {
  local svc="$HOME/.config/systemd/user/artemis-rek.service" prof="$HOME/.profile"
  mkdir -p "$(dirname "$svc")"
  cat >"$svc" <<UNIT
[Unit]
Description=ARTEMIS-rek console
After=default.target
[Service]
ExecStart=$BIN_SELF/artemis-rek console
Restart=always
RestartSec=10
[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user enable --now artemis-rek.service >/dev/null 2>&1 || true
  if ! grep -q 'artemis-rek console' "$prof" 2>/dev/null; then
    printf '\n# ARTEMIS-rek console vanzelf starten (terugval als systemd --user er niet is)\npgrep -f "artemis-rek console" >/dev/null 2>&1 || setsid %s/artemis-rek console </dev/null >>%s/console.log 2>&1 &\n' "$BIN_SELF" "$REK_MAP" >>"$prof"
  fi
  zeg "Autostart aangezet: de console draait voortaan vanzelf (http://localhost:$CONSOLE_POORT)."
}

# 571: DE KNOPPEN-CONSOLE op http://localhost:CONSOLE_POORT (alleen 127.0.0.1). Hier doet Claude in Chrome alles wat vroeger een
# terminalopdracht was: Start, Stop, Status, Zoek telefoons (scan), Bijwerken. Een achtergrondlus zoekt elke minuut zelf nieuwe
# rektelefoons en houdt ARTEMIS aan zolang de gewenste stand "aan" is. Geen vrije invoer: alleen een vaste lijst opdrachten.
console() {
  command -v python3 >/dev/null 2>&1 || { zeg "python3 ontbreekt; de console kan niet starten."; return 1; }
  AREK="$BIN_SELF/artemis-rek" POORT="$CONSOLE_POORT" REK_MAP="$REK_MAP" python3 - <<'PY'
import os, subprocess, threading, time, html, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
AREK = os.environ.get('AREK', 'artemis-rek'); POORT = int(os.environ.get('POORT', '8000')); REK = os.environ.get('REK_MAP', '')
TOEGESTAAN = {'start', 'stop', 'status', 'scan', 'bijwerken', 'vergeet', 'log'}
# 575: start en bijwerken kunnen minuten duren (ARTEMIS start op, adb-ronde). Die blokkeren de knop NIET:
# ze draaien op de achtergrond naar een eigen logbestand; de knop komt meteen terug, en Status/Log tonen hoe het ging.
LOPEND = {'start', 'bijwerken'}
def doe(cmd):
    arg = cmd   # 576: Bijwerken draait nu de VOLLE opdracht (script + venv op 3.12 + console herstarten), niet enkel zelf-bijwerken
    if cmd in LOPEND:
        pad = os.path.join(REK, 'console-%s.log' % cmd)
        try:
            f = open(pad, 'ab')
            f.write(('\n=== %s %s ===\n' % (cmd, time.strftime('%Y-%m-%d %H:%M:%S'))).encode())
            subprocess.Popen([AREK, arg], stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
            return '%s draait nu op de achtergrond (dit duurt de eerste keer een paar minuten). Druk zo op Status of Log om te zien hoe het ging.' % cmd
        except Exception as e:
            return 'fout: ' + str(e)
    try:
        r = subprocess.run([AREK, arg], capture_output=True, text=True, timeout=120)
        return (r.stdout + r.stderr).strip() or '(geen uitvoer)'
    except subprocess.TimeoutExpired:
        return '%s duurt langer dan verwacht. Druk op Status of Log om te zien wat er gebeurt.' % cmd
    except Exception as e:
        return 'fout: ' + str(e)
def lus():
    # elke minuut: nieuwe telefoons zoeken; en ARTEMIS aanhouden als de gewenste stand "aan" is
    while True:
        try:
            doe('scan')
            if os.path.exists(os.path.join(REK, 'aan')):
                pida = os.path.join(REK, 'artemis.pid'); draait = False
                try:
                    with open(pida) as f: pid = int(f.read().strip())
                    os.kill(pid, 0); draait = True
                except Exception: draait = False
                if not draait: doe('start')
        except Exception: pass
        time.sleep(60)
PAGINA = """<!doctype html><html lang=nl><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>ARTEMIS-console</title><style>body{{font-family:system-ui,sans-serif;margin:0;background:#0b1020;color:#e8ecf5;font-size:18px}}
header{{padding:16px;background:#141b33;font-weight:600}}main{{padding:16px;max-width:760px;margin:0 auto}}
button{{font-size:18px;padding:12px 16px;margin:6px 6px 6px 0;border:0;border-radius:10px;background:#2b3a67;color:#fff;cursor:pointer;min-height:48px}}
button:hover{{background:#35508f}}pre{{background:#0a0f1e;border:1px solid #233;padding:12px;border-radius:10px;white-space:pre-wrap;min-height:120px}}
.rij{{display:flex;flex-wrap:wrap}}a{{color:#8fb7ff}}</style></head><body>
<header>ARTEMIS-console &mdash; de rektelefoons besturen zonder de terminal</header><main>
<div class=rij>
<button data-cmd=start>Start ARTEMIS</button><button data-cmd=stop>Stop</button><button data-cmd=status>Status</button>
<button data-cmd=scan>Zoek telefoons</button><button data-cmd=vergeet>Vergeet overgeslagen</button><button data-cmd=bijwerken>Bijwerken</button><button data-cmd=log>Log</button></div>
<p>ARTEMIS zelf opent op de poort die <b>Status</b> noemt (onze gok is <a href="http://localhost:{ap}" target=_blank>localhost:{ap}</a>, maar de echte poort kan afwijken). Start duurt de eerste keer een paar minuten; druk daarna op Status.</p>
<pre id=uit>Klaar. Kies een knop.</pre>
<script>
const uit=document.getElementById('uit');
async function doe(c){{uit.textContent='Bezig: '+c+'...';try{{const r=await fetch('/doe?cmd='+encodeURIComponent(c),{{method:'POST'}});uit.textContent=await r.text();}}catch(e){{uit.textContent='Kon de console niet bereiken: '+e;}}}}
for(const b of document.querySelectorAll('button[data-cmd]'))b.addEventListener('click',()=>doe(b.dataset.cmd));
doe('status');
</script></main></body></html>"""
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _schrijf(self, code, body, ctype='text/plain; charset=utf-8'):
        b = body.encode('utf-8'); self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        if p.path in ('/', '/index.html'):
            self._schrijf(200, PAGINA.format(ap=int(os.environ.get('ARTEMIS_POORT', '8001'))), 'text/html; charset=utf-8')
        elif p.path == '/status.json':
            aan = os.path.exists(os.path.join(REK, 'artemis.pid'))
            self._schrijf(200, '{"console":true,"artemis":%s}' % ('true' if aan else 'false'), 'application/json')
        else:
            self._schrijf(404, 'niet gevonden')
    def do_POST(self):
        p = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(p.query)
        cmd = (q.get('cmd', [''])[0]) if p.path == '/doe' else ''
        if cmd in TOEGESTAAN: self._schrijf(200, doe(cmd))
        else: self._schrijf(400, 'onbekende opdracht')
threading.Thread(target=lus, daemon=True).start()
try:
    ThreadingHTTPServer(('127.0.0.1', POORT), H).serve_forever()
except OSError as e:
    print('De console kon poort %d niet openen (draait hij al?): %s' % (POORT, e))
PY
}

stop_artemis() {
  if leeft "$PIDA"; then
    local p; p="$(cat "$PIDA")"
    kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null || true
  fi
  rm -f "$PIDA"
}

# Een ronde van de waakhond. Geeft 0 terug als ARTEMIS mag blijven draaien.
waak_ronde() {
  local s id pkg soort
  for s in $(verbonden); do
    id="$(toestel_id "$s")"
    if is_f8 "$s"; then
      logregel "STOP: de F8 blijft uitgesloten (de dagelijkse telefoon). ARTEMIS is uitgezet."
      case "$s" in *:*) "$ADB" disconnect "$s" >/dev/null 2>&1 || true ;; esac
      stop_artemis
      return 1
    fi
    if ! toegestaan "$id"; then
      logregel "STOP: een toestel dat niet op de lijst staat ($(toestel_naam "$s")). ARTEMIS is uitgezet."
      case "$s" in *:*) "$ADB" disconnect "$s" >/dev/null 2>&1 || true ;; esac
      stop_artemis
      return 1
    fi
    pkg="$(voorgrond "$s")"
    if soort="$(verboden "$pkg")"; then
      "$ADB" -s "$s" shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
      "$ADB" -s "$s" shell am force-stop "$pkg" >/dev/null 2>&1 || true
      if [ "$soort" = streng ]; then
        logregel "Gevoelige app op de voorgrond op $(toestel_naam "$s"): $pkg -- ARTEMIS meteen gestopt (geen schermfoto, niets naar Gemini)."
        stop_artemis
        return 1
      fi
      logregel "Persoonlijke app weggehaald op $(toestel_naam "$s"): $pkg"
    fi
  done
  return 0
}

waakhond() {
  local een="${1:-}"
  while :; do
    waak_ronde || { [ -n "$een" ] && return 1; }
    [ -n "$een" ] && return 0
    leeft "$PIDA" || { logregel "ARTEMIS is gestopt; de waakhond ook."; rm -f "$PIDW"; return 0; }
    sleep 2
  done
}

toestellen() {
  "$ADB" start-server >/dev/null 2>&1 || true
  local regels s staat id naam antwoord n=0
  regels="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')"
  if [ -z "$regels" ]; then
    zeg "Ik zie geen telefoon. Kabel erin, in ChromeOS de telefoon delen met Linux, en op de telefoon USB-foutopsporing aan."
    return 1
  fi
  touch "$TOEG"; chmod 600 "$TOEG"
  while read -r s staat; do
    [ -n "$s" ] || continue
    if [ "$staat" = "unauthorized" ]; then zeg "Een telefoon wacht op jouw tik: kies op de telefoon 'Toestaan'. Daarna dit nog eens."; continue; fi
    [ "$staat" = "device" ] || continue
    id="$(toestel_id "$s")"; naam="$(toestel_naam "$s")"
    if toegestaan "$id"; then zeg "$naam staat al op de lijst."; continue; fi
    if is_f8 "$s"; then
      zeg "$naam is de F8 (je dagelijkse telefoon): die komt NOOIT op de lijst."
      continue
    fi
    # 573: een LEEG model betekent meestal dat de telefoon nog niet 'Toestaan' kreeg (unauthorized -> model onleesbaar). NOOIT
    # vragen met een lege naam; toon de tik.
    if [ -z "$naam" ]; then zeg "Een telefoon ($s) heeft nog geen naam -- tik op de telefoon op 'Toestaan' (vinkje 'Altijd toestaan'). Daarna opnieuw."; continue; fi
    # Een bank-, crypto- of kluisapp is GEEN reden meer om te weigeren (ARTEMIS-ronde 25 okt): die apps staan achter 2FA
    # en kunnen er niet af. De waakhond zorgt dat ARTEMIS ze nooit opent; komt er toch een op de voorgrond, dan stopt hij.
    IFS= read -r -p "Is $naam een REKtelefoon (niet je dagelijkse telefoon)? [j/N] " antwoord </dev/tty || antwoord=""
    case "$antwoord" in j|J|ja|Ja) printf '%s\n' "$id" >>"$TOEG"; n=$((n+1)); zeg "$naam staat op de lijst." ;; *) zeg "$naam overgeslagen." ;; esac
  done <<<"$regels"
  zeg "Klaar: $(grep -c . "$TOEG" 2>/dev/null || echo 0) telefoon(s) op de lijst."
}

draadloos() {
  zeg "Draadloos werkt alleen als deze Chromebook en de telefoon op HETZELFDE gewone wifi zitten (geen gastnetwerk)."
  zeg "Op de telefoon: Ontwikkelaarsopties > Draadloze foutopsporing > Koppelen met code. Daar staan een adres en een code."
  local paar code verbind
  IFS= read -r -p "Adres bij 'koppelen' (getallen met een dubbele punt en een poort): " paar </dev/tty || return 1
  IFS= read -r -p "De code van zes cijfers: " code </dev/tty || return 1
  "$ADB" pair "$paar" "$code" || { zeg "Koppelen lukte niet. Zit je op hetzelfde wifi? Een gastnetwerk laat dit niet toe."; return 1; }
  IFS= read -r -p "Adres bovenaan bij 'Draadloze foutopsporing' (ander poortnummer): " verbind </dev/tty || return 1
  "$ADB" connect "$verbind" || { zeg "Verbinden lukte niet."; return 1; }
  zeg "Verbonden. Nu nog op de lijst zetten:"; toestellen
}

# 561: Android Remote Control MCP (danielealbano, GPL-3.0) als RESERVE naast ARTEMIS: besturen zonder kabel, maar ALLEEN binnen het
# eigen wifi. We binden de app aan het LAN-adres van de telefoon zelf, zetten ELKE tunnel UIT (nooit een openbaar adres), en zetten
# een vers bedacht bearer-token EN OAuth aan. De verboden-apps-waakhond hierboven geldt ook hier (de app heeft zelf geen zo'n lijst).
# Instellen kan alleen via adb (de kabel), daarna werkt het draadloos. Per toestel schrijven we het adres en het token in ~/.artemis-rek.
MCP_APP="com.danielealbano.androidremotecontrolmcp"
mcp() {
  "$ADB" start-server >/dev/null 2>&1 || true
  [ -s "$TOEG" ] || { zeg "Eerst een rektelefoon op de lijst: artemis-rek toestellen"; return 1; }
  local s id naam ip token poort=8080 raak=0
  for s in $(verbonden); do
    id="$(toestel_id "$s")"; naam="$(toestel_naam "$s")"
    toegestaan "$id" || { zeg "$naam staat niet op de lijst; overgeslagen."; continue; }
    if ! "$ADB" -s "$s" shell pm path "$MCP_APP" >/dev/null 2>&1; then
      zeg "$naam: de app 'Android Remote Control MCP' staat er nog niet. Zet hem er eerst op (GitHub-release, foss-APK)."; continue
    fi
    ip="$("$ADB" -s "$s" shell ip -f inet addr show wlan0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)"
    [ -n "$ip" ] || { zeg "$naam: geen wifi-adres gevonden. Zit hij op het wifi?"; continue; }
    token="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    # DUMP-recht: de adb-shell heeft het, een app op de telefoon niet -- zo kan geen app op het toestel dit omzetten.
    "$ADB" -s "$s" shell am broadcast \
      -a "$MCP_APP.ADB_CONFIGURE" \
      -n "$MCP_APP/$MCP_APP.services.mcp.AdbConfigReceiver" \
      --es binding_address "$ip" --ei port "$poort" \
      --ez tunnel_enabled false \
      --ez bearer_token_enabled true --es bearer_token "$token" \
      --ez oauth_enabled true \
      --ez https_enabled false \
      --ez block_local_network_downloads true \
      --ez auto_start_on_boot true >/dev/null 2>&1 \
      && { printf '%s\t%s\thttp://%s:%s/mcp\t%s\n' "$id" "$naam" "$ip" "$poort" "$token" >>"$REK_MAP/mcp"; raak=$((raak+1));
           zeg "$naam: bereikbaar op http://$ip:$poort/mcp (tunnel UIT, token aan). Token staat in ~/.artemis-rek/mcp."; } \
      || zeg "$naam: instellen lukte niet (heeft de app het DUMP-recht? zie docs)."
  done
  [ "$raak" -gt 0 ] && { chmod 600 "$REK_MAP/mcp" 2>/dev/null || true; zeg "Klaar. De adressen gelden ALLEEN binnen je eigen wifi; er is geen openbare tunnel."; } || zeg "Geen enkele telefoon ingesteld."
}

start() {
  [ -d "$ARTEMIS_MAP" ] || { zeg "ARTEMIS staat er niet. Draai eerst installeer.sh."; return 1; }
  [ -s "$TOEG" ] || { zeg "Er staat nog geen rektelefoon op de lijst. Sluit er een aan (kabel + USB-foutopsporing); de console vindt hem vanzelf."; return 1; }
  touch "$AANF"   # 571: de gewenste stand is "aan"; de console-lus houdt hem aan
  if leeft "$PIDA"; then zeg "ARTEMIS draait al: http://localhost:$ARTEMIS_POORT"; return 0; fi
  waak_ronde || return 1
  zorg_venv   # 576: zorg dat de venv op Python 3.12 staat (anders faalt grpcio en start ARTEMIS nooit)
  # ARTEMIS op een EIGEN poort (envnamen best-effort; NIET op een echte ARTEMIS nagekeken), zodat onze console 8000 houdt.
  # UV_PYTHON=3.12: ook als ARTEMIS' eigen start.sh uv draait, kiest hij 3.12 (wheels, geen compiler).
  ( cd "$ARTEMIS_MAP" && UV_PYTHON=3.12 PORT="$ARTEMIS_POORT" ARTEMIS_PORT="$ARTEMIS_POORT" ARTEMIS_WEB_PORT="$ARTEMIS_POORT" setsid bash start.sh </dev/null >>"$REK_MAP/artemis.log" 2>&1 & echo $! >"$PIDA" )
  sleep 1
  ( setsid "$0" waakhond </dev/null >>"$LOG" 2>&1 & echo $! >"$PIDW" )
  zeg "ARTEMIS start (de eerste keer duurt het een paar minuten). ARTEMIS zelf: http://localhost:$ARTEMIS_POORT"
}

stop() {
  rm -f "$AANF"   # 571: de gewenste stand is "uit"; de console-lus start hem niet opnieuw
  stop_artemis
  if leeft "$PIDW"; then kill "$(cat "$PIDW")" 2>/dev/null || true; fi
  rm -f "$PIDW"
  zeg "ARTEMIS staat uit."
}

# 575: welke TCP-poorten luistert de PROCESGROEP van ARTEMIS echt? (eigen processen, geen root nodig).
# De env-namen voor onze gok-poort 8001 zijn NIET op een echte ARTEMIS nagekeken; dit toont waar hij echt luistert.
poorten_van() {
  local pid="$1" pids
  pids="$(printf '%s\n' "$pid" $(pgrep -g "$pid" 2>/dev/null) | grep -E '^[0-9]+$' | sort -u)"
  [ -n "$pids" ] || return 0
  if command -v ss >/dev/null 2>&1; then
    local re; re="$(printf '%s' "$pids" | paste -sd'|')"
    ss -ltnH -p 2>/dev/null | awk -v re="$re" '$0 ~ ("pid=("re")"){n=split($4,a,":"); print a[n]}' | sort -un | paste -sd', '
  elif command -v lsof >/dev/null 2>&1; then
    local csv; csv="$(printf '%s' "$pids" | paste -sd',')"
    lsof -nP -iTCP -sTCP:LISTEN -a -p "$csv" 2>/dev/null | awk 'NR>1{n=split($9,a,":"); print a[n]}' | sort -un | paste -sd', '
  fi
}
# 575: antwoordt er iets op localhost:<poort>?
antwoordt() { command -v curl >/dev/null 2>&1 && curl -fsS -m 3 -o /dev/null "http://localhost:$1/" 2>/dev/null; }

# 575: de laatste logregels, zodat Cowork in Chrome ziet waarom ARTEMIS wel/niet luistert.
log() {
  zeg "== Laatste logregels (ARTEMIS) =="
  if [ -s "$REK_MAP/artemis.log" ]; then tail -n 20 "$REK_MAP/artemis.log"; else zeg "(nog geen artemis.log -- ARTEMIS is nog niet gestart)"; fi
  local f
  for f in console-start console-bijwerken waakhond; do
    [ -s "$REK_MAP/$f.log" ] && { zeg "== $f (laatste 10) =="; tail -n 10 "$REK_MAP/$f.log"; } || true
  done
}

status() {
  if leeft "$PIDA"; then
    local p poorten; p="$(cat "$PIDA" 2>/dev/null)"
    zeg "ARTEMIS draait (pid $p)."
    poorten="$(poorten_van "$p")"
    if [ -n "$poorten" ]; then
      zeg "Luistert op poort(en): $poorten"
      zeg "Open ARTEMIS op: http://localhost:$(printf '%s' "$poorten" | tr -d ' ' | cut -d, -f1)"
    else
      zeg "Luistert nog op GEEN enkele poort -- hij start nog op (de eerste keer duurt het een paar minuten) of hij is gestopt. Kijk bij Log."
    fi
    if antwoordt "$ARTEMIS_POORT"; then zeg "http://localhost:$ARTEMIS_POORT antwoordt."; else zeg "http://localhost:$ARTEMIS_POORT (onze gok) antwoordt niet -- gebruik de poort hierboven, of kijk bij Log."; fi
  else
    zeg "ARTEMIS staat uit."
  fi
  if leeft "$PIDW"; then zeg "De waakhond kijkt mee."; fi
  zeg "Console (knoppen): http://localhost:$CONSOLE_POORT"
  zeg "Rektelefoons op de lijst: $(grep -c . "$TOEG" 2>/dev/null || echo 0)"
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx searxng; then zeg "SearXNG draait: http://127.0.0.1:8888 (JSON aan)"; fi
  if command -v tailscale >/dev/null 2>&1; then zeg "Tailscale: $(tailscale ip -4 2>/dev/null | head -1 || echo 'niet ingelogd')"; fi
  overzicht   # 573: ook per aangesloten toestel wat adb ziet (model, unauthorized, geweigerd), leesbaar in de console
  log         # 575: en de laatste logregels erbij
}

# 562: SEARXNG als EIGEN privé-zoekmachine in Linux (Docker, de officiele searxng/searxng). JSON-uitvoer aan, de bot-limiter
# versoepeld (alleen ons eigen rek gebruikt hem), en gebonden aan 127.0.0.1 -- alleen deze computer, en via Tailscale de eigen
# telefoons. NOOIT open op het internet. settings.yml komt in ~/.artemis-rek/searxng.
SEARX_MAP="$REK_MAP/searxng"
searxng() {
  command -v docker >/dev/null 2>&1 || { zeg "Docker staat er niet. In Linux: 'sudo apt-get install -y docker.io' en 'sudo usermod -aG docker \$USER' (daarna opnieuw inloggen)."; return 1; }
  mkdir -p "$SEARX_MAP"
  local geheim; geheim="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  # alleen schrijven als het er nog niet is (zodat het geheim blijft staan)
  if [ ! -f "$SEARX_MAP/settings.yml" ]; then
    cat >"$SEARX_MAP/settings.yml" <<YML
# 562: eigen SearXNG voor het rek. JSON aan, limiter uit (alleen wijzelf), geen openbare toegang.
use_default_settings: true
server:
  secret_key: "$geheim"
  limiter: false            # versoepeld: alleen ons eigen rek gebruikt hem
  image_proxy: false
  method: "GET"
search:
  formats:
    - html
    - json                 # JSON-uitvoer aan (voor de telefoons en Onderzoek)
YML
    chmod 600 "$SEARX_MAP/settings.yml"
  fi
  docker rm -f searxng >/dev/null 2>&1 || true
  docker run -d --name searxng --restart unless-stopped \
    -p 127.0.0.1:8888:8080 \
    -v "$SEARX_MAP:/etc/searxng" \
    docker.io/searxng/searxng:latest >/dev/null \
    && zeg "SearXNG draait op http://127.0.0.1:8888 (JSON aan, limiter uit, alleen deze computer)." \
    || { zeg "Starten lukte niet. Staat Docker aan? 'docker ps' zou moeten werken zonder sudo."; return 1; }
  zeg "Wil je dat de telefoons hem via Tailscale bereiken, zet dan het adres in Veronica (Meer > Zoekmachine)."
}

# 562: TAILSCALE (gratis Personal-plan) zodat je van buitenaf bij Veronica, de rektelefoons en de MCP-reserve kunt, ZONDER
# openbare tunnel. Dit script installeert alleen de Linux-kant op de Chromebook en logt in; het ACCOUNT maak je zelf aan.
tailscale_op() {
  if ! command -v tailscale >/dev/null 2>&1; then
    zeg "Tailscale installeren (officieel script van tailscale.com)..."
    curl -fsSL https://tailscale.com/install.sh | sh || { zeg "Installeren lukte niet."; return 1; }
  fi
  zeg "Nu inloggen. Er komt een adres; open dat in Chrome en log in met je Tailscale-account (dat maak je zelf aan op tailscale.com)."
  sudo tailscale up || { zeg "Inloggen lukte niet."; return 1; }
  zeg "Klaar. Dit toestel heet in Tailscale: $(tailscale ip -4 2>/dev/null | head -1). Zet de rektelefoons en de F8 met de Tailscale-app erbij."
}

# 571: bij start en console eerst zichzelf bijwerken vanaf de site, dan opnieuw starten met de nieuwe code (een keer, geen lus).
if { [ "${1:-}" = start ] || [ "${1:-}" = console ]; } && [ -z "${ARTEMIS_HERSTART:-}" ]; then
  zelf_bijwerken >/dev/null 2>&1 || true
  ARTEMIS_HERSTART=1 exec "$0" "$@"
fi
case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  console) console ;;
  autostart) autostart_installeren ;;
  scan) scan ;;
  overzicht) overzicht ;;
  vergeet) vergeet ;;
  bijwerken) bijwerken ;;
  zelf-bijwerken) zelf_bijwerken ;;
  toestellen) toestellen ;;
  draadloos) draadloos ;;
  mcp) mcp ;;
  searxng) searxng ;;
  tailscale) tailscale_op ;;
  status) status ;;
  log) log ;;
  waakhond) waakhond ;;
  waak-een-keer) waakhond een ;;
  verboden) verboden "${2:-}" ;;
  *) zeg "Gebruik: artemis-rek console | start | stop | status | log | scan | bijwerken | toestellen | draadloos | mcp | searxng | tailscale" ;;
esac
REK
  chmod 755 "$bin/artemis-rek.nieuw"
  # Atomisch vervangen: een lopende artemis-rek (de console) houdt zijn oude inode en blijft heel; de VOLGENDE aanroep is nieuw.
  mv "$bin/artemis-rek.nieuw" "$bin/artemis-rek"
}

if [ "${1:-}" = "--alleen-bestanden" ]; then
  schrijf_bestanden "${2:?map}" "${3:-${2}/bin}"
  exit 0
fi

# ---- 2. Gereedschap ----
zeg "== ARTEMIS voor de rektelefoons =="
if ! grep -qi 'debian\|ubuntu' /etc/os-release 2>/dev/null; then
  zeg "Dit is gemaakt voor Linux op de Chromebook (Debian). Hier ga ik niet verder."; exit 1
fi
if ! command -v adb >/dev/null || ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  zeg "adb, git en curl installeren..."
  sudo apt-get update -qq && sudo apt-get install -y -qq adb git curl
fi

# ---- 3. ARTEMIS op de vaste versie ----
if [ ! -d "$ARTEMIS_MAP/.git" ]; then
  git clone --quiet "$ARTEMIS_REPO" "$ARTEMIS_MAP"
fi
git -C "$ARTEMIS_MAP" fetch --quiet origin "$ARTEMIS_VERSIE" 2>/dev/null || git -C "$ARTEMIS_MAP" fetch --quiet origin
git -C "$ARTEMIS_MAP" -c advice.detachedHead=false checkout --quiet "$ARTEMIS_VERSIE"

# ---- 4. De sleutel: alleen in ~/artemis/.env, alleen voor jou leesbaar ----
ENV="$ARTEMIS_MAP/.env"
umask 077
[ -f "$ENV" ] || cp "$ARTEMIS_MAP/.env.example" "$ENV"
chmod 600 "$ENV"
zet_env() {   # zet_env NAAM WAARDE  (de waarde gaat via de omgeving, nooit via de opdrachtregel)
  NAAM="$1" WAARDE="$2" awk 'BEGIN{n=ENVIRON["NAAM"];w=ENVIRON["WAARDE"];g=0}
    $0 ~ "^#? *"n"=" {print n"="w; g=1; next} {print} END{if(!g) print n"="w}' "$ENV" >"$ENV.nieuw"
  mv "$ENV.nieuw" "$ENV"; chmod 600 "$ENV"
}
if ! grep -qE '^GEMINI_API_KEY=.+' "$ENV"; then
  zeg ""
  zeg "Nu de Gemini-sleutel. Maak hem op aistudio.google.com/apikey (gratis) en plak hem hier."
  zeg "Je ziet niets terwijl je plakt; dat hoort zo. Druk daarna op Enter."
  SLEUTEL=""
  tty_lees SLEUTEL "Sleutel: " stil
  SLEUTEL="${SLEUTEL//[$'\r\n ']/}"
  if [ -z "$SLEUTEL" ]; then zeg "Geen sleutel ingevuld. Draai dit script later nog eens."; exit 1; fi
  zet_env GEMINI_API_KEY "$SLEUTEL"
  unset SLEUTEL
  zeg "Bewaard in $ENV (alleen jij kunt het lezen)."
fi
zet_env ARTEMIS_DEFAULT_PROFILE flash
zet_env ARTEMIS_KEEP_DEVICE_AWAKE false
zet_env ARTEMIS_DESKTOP_NOTIFY false

# ---- 5. De eigen bestanden, de autostart en de telefoons ----
schrijf_bestanden "$REK_MAP" "$BIN_MAP"
case ":$PATH:" in *":$BIN_MAP:"*) ;; *) printf '\nexport PATH="%s:$PATH"\n' "$BIN_MAP" >>"$HOME/.bashrc"; export PATH="$BIN_MAP:$PATH" ;; esac
zeg ""
zeg "Nu de rektelefoons. Sluit ze aan (kabel), deel ze met Linux en zet USB-foutopsporing aan."
zeg "Je dagelijkse telefoon NOOIT: daar zet je USB-foutopsporing niet aan, en die deel je niet met Linux."
# 571: TERMINALVRIJ NA DEZE ENE REGEL. Geen 'toestellen'-vraag meer: de console zoekt elke minuut zelf nieuwe rektelefoons
# (scan). We zetten de autostart aan (de console draait voortaan vanzelf, ook na opnieuw opstarten) en starten hem nu meteen.
"$BIN_MAP/artemis-rek" scan || true
"$BIN_MAP/artemis-rek" autostart || true
if ! pgrep -f "artemis-rek console" >/dev/null 2>&1; then
  setsid "$BIN_MAP/artemis-rek" console </dev/null >>"$REK_MAP/console.log" 2>&1 &
fi
zeg ""
zeg "Klaar -- en dit was de laatste keer in de terminal."
zeg "Alles gaat nu via de console in Chrome: http://localhost:8000"
zeg "Daar staan de knoppen Start, Stop, Status, Zoek telefoons en Bijwerken. De console draait voortaan vanzelf,"
zeg "werkt zichzelf bij vanaf de site, en zoekt elke minuut zelf nieuwe rektelefoons. Je hoeft hier niets meer te typen."
