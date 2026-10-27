#!/usr/bin/env bash
# installeer.sh -- ARTEMIS (Google, Apache 2.0) op de Linux-kant van de Chromebook, zodat Claude de REKTELEFOONS kan besturen
# via de webconsole op http://localhost:8765 (581: WEG van 8000, want ARTEMIS wil 8000 zelf). Een keer plakken in de Linux-terminal:
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
# Daarna: `artemis-rek start` (console op http://localhost:8765), `artemis-rek stop`, `artemis-rek toestellen`,
# `artemis-rek draadloos`, `artemis-rek status`.
set -euo pipefail

ARTEMIS_REPO="https://github.com/google/artemis"
ARTEMIS_VERSIE="351ca8422f7b5b54e80a9c1ce03a222e02415b6b"   # nagekeken op 25 oktober 2026; een nieuwere = eerst nakijken
ARTEMIS_MAP="${ARTEMIS_MAP:-$HOME/artemis}"
REK_MAP="${REK_MAP:-$HOME/.artemis-rek}"
BIN_MAP="${BIN_MAP:-$HOME/.local/bin}"
# 583b: ook in de INSTALLER-body nodig (de slotmelding noemt de console-poort). CONSOLE_POORT zat alleen in het GEGENEREERDE
# artemis-rek, dus gaf de slotregel "unbound variable" onder set -u. Zelfde standaard als daar (581: console op 8765).
CONSOLE_POORT="${ARTEMIS_CONSOLE_POORT:-8765}"

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
  # 583: nep-browsers. ARTEMIS' start.sh opent zelf een browsertab (Angular dev-server / xdg-open); bij elke mislukte
  # herstart gaf dat een nieuwe tab -> tientallen tabs. We zetten deze map vooraan in PATH wanneer we ARTEMIS starten, zodat
  # elke poging om een browser te openen een lege no-op is. Alleen voor het ARTEMIS-subproces (scoped PATH), niet systeembreed.
  mkdir -p "$rek/geen-browser"
  local gb
  for gb in xdg-open x-www-browser www-browser sensible-browser gnome-open kde-open google-chrome google-chrome-stable chromium chromium-browser chrome firefox open; do
    printf '#!/bin/sh\nexit 0\n' >"$rek/geen-browser/$gb"; chmod 755 "$rek/geen-browser/$gb"
  done
  # 585/589: een EIGEN artemis.jsonc met een model dat op de GRATIS laag van Gemini werkt. 589 (27 okt): Gemini gaf
  # 404 "models/gemini-2.5-flash is no longer available to new users. Please update your code to use
  # models/gemini-3.8-flash." Dus: default = gemini-3.8-flash (gratis sinds de GA van 2 sep 2026, Googles eigen
  # advies in de 404), fallback = gemini-3.6-flash (ook gratis). Beide op de gratis AIza-sleutel; een AQ-sleutel
  # werkt NIET (401). ARTEMIS breidt 'default' uit naar alle sub-agents (_expand_default_into_nodes), dus ook de
  # object-detector gebruikt 3.8-flash. ARTEMIS leest dit via de env ARTEMIS_ARTEMIS_JSONC (resolutievolgorde #1);
  # de config in de ARTEMIS-repo blijft met rust. Faalt 3.8-flash ooit toch, dan toont Log de ECHTE llm-fout uit de
  # laatste sessie (met het model dat Gemini dán aanraadt), zodat de keuze zich zelf laat bijsturen.
  # 592 (#130/§585-3): is er een LOKAAL model geconfigureerd ($rek/lokaal-model.conf, gezet door de knop 'Lokaal model'),
  # dan denkt ARTEMIS met dat lokale, OpenAI-compatibele model (OlliteRT/eigen motor op een rektelefoon, of de F8 als
  # gast-brein over het LAN) en is Gemini ALLEEN nog de terugval. Geen conf = Gemini-primair (589). ARTEMIS breidt 'default'
  # (incl. de fallback) uit naar alle rollen, dus ook de planner.
  # 592: artemis.jsonc wordt NIET meer hier geschreven, maar door de RUNTIME-functie schrijf_artemis_jsonc (in artemis-rek zelf),
  # zodat er EEN bron is: zowel de installatie (aan het eind van deze functie) als de knoppen Lokaal model / Lokaal uit roepen
  # dezelfde functie aan. Zo kan lokaal/lokaal_uit de config herschrijven zonder schrijf_bestanden (die bestaat alleen hier).
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
JARVIS_PKG="nl.eigen.jarvis"   # 590: het ENIGE pakket dat de JARVIS-waakhond ooit aanraakt (nooit bank/betaal/wachtwoord/authenticator)
LOKAAL_POORT="${ARTEMIS_LOKAAL_POORT:-8791}"   # 592: lokale poort op deze computer die via adb naar het model op een rektelefoon wijst
PIDA="$REK_MAP/artemis.pid"
PIDW="$REK_MAP/waakhond.pid"
BRONF="$REK_MAP/bron"
AANF="$REK_MAP/aan"           # 571: de GEWENSTE stand (ARTEMIS aan). De console-lus houdt ARTEMIS aan zolang dit bestand er is.
CONSOLE_POORT="${ARTEMIS_CONSOLE_POORT:-8765}"   # onze knoppen-console (Veronica/Claude openen die). 581: WEG van 8000 -- ARTEMIS wil 8000 zelf
ARTEMIS_POORT="${ARTEMIS_POORT:-8000}"           # 581: ARTEMIS HOUDT zijn eigen 8000 (hij negeerde onze poort-envs en pakte 8000); de console wijkt uit naar 8765
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
  local base tmp code; base="$(cat "$BRONF")"; tmp="$(mktemp)" || return 1
  # 586: toon de HTTP-code, zodat je ziet WAAROM het niet lukt (000 = geen internet/site weg, 404 = verkeerd adres).
  zeg "Bijwerken 1/4: script ophalen van $base/artemis/installeer.sh ..."
  code="$(curl -fsSL -m 30 -w '%{http_code}' "$base/artemis/installeer.sh" -o "$tmp" 2>/dev/null)"; code="${code:-000}"
  if [ "$code" != "200" ] || [ ! -s "$tmp" ]; then zeg "Bijwerken: ophalen mislukte (http $code). Geen internet, of de site is even weg. Niets veranderd."; rm -f "$tmp"; return 1; fi
  if ! bash -n "$tmp" 2>/dev/null; then zeg "Bijwerken: het opgehaalde script is geen geldige bash; niets veranderd."; rm -f "$tmp"; return 1; fi
  if ! grep -q 'artemis-rek' "$tmp" || ! grep -q 'ARTEMIS_REPO=' "$tmp"; then zeg "Bijwerken: het opgehaalde script lijkt niet op ARTEMIS; niets veranderd."; rm -f "$tmp"; return 1; fi
  if ARTEMIS_BRON="$base" bash "$tmp" --alleen-bestanden "$REK_MAP" "$BIN_SELF" >/dev/null 2>&1; then
    logregel "Bijgewerkt vanaf de site (http $code)."
    [ -s "$REK_MAP/artemis.jsonc" ] && zeg "Bijwerken 2/4: nieuwe instellingen binnen (ARTEMIS-model: $(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" | head -1))."
    rm -f "$tmp"; return 0
  fi
  zeg "Bijwerken: het herschrijven van de bestanden mislukte; niets veranderd."; rm -f "$tmp"; return 1
}

# 576/577: ARTEMIS draait op uv. uv koos cpython-3.15, en grpcio/zstandard hebben daar geen kant-en-klare wheel voor -> uv bouwt
# ze vanaf de bron -> 'cc'/'c++' ontbreekt in Crostini -> ARTEMIS start NOOIT. Twee sloten, allebei nodig:
#  (1) Python FORCEREN op 3.12 -- niet alleen .python-version/UV_PYTHON (ARTEMIS' eigen start.sh/uv kan dat negeren), maar de venv
#      ZELF aanmaken met `uv venv --python 3.12`, zodat elke latere `uv run`/`uv sync` die bestaande 3.12-venv hergebruikt.
#  (2) build-essential als VANGNET: lukt uv sync toch niet (een pakket zonder wheel, welke Python dan ook), dan een compiler
#      installeren (sudo -n) en opnieuw proberen. Zo start ARTEMIS ook als 3.12 om wat voor reden dan ook niet pakt.
# 577: controleer NA afloop echt welke Python in de venv staat en meld dat (zichtbaar in Status/Log).

# 577: een compiler installeren als die ontbreekt (Crostini-gebruiker heeft normaal sudo zonder wachtwoord).
venv_vangnet() {
  { command -v cc >/dev/null 2>&1 && command -v c++ >/dev/null 2>&1; } && return 0
  if sudo -n true 2>/dev/null; then
    zeg "Een pakket heeft geen kant-en-klaar wheel; ik installeer een compiler (build-essential)..."
    sudo -n apt-get update -qq >>"$REK_MAP/artemis.log" 2>&1 || true
    if sudo -n apt-get install -y -qq build-essential >>"$REK_MAP/artemis.log" 2>&1; then zeg "Compiler geinstalleerd."; return 0; fi
    zeg "build-essential installeren lukte niet -- kijk bij Log."; return 1
  fi
  zeg "Geen compiler (cc) en geen sudo zonder wachtwoord. Typ EENMALIG in de Linux-terminal: sudo apt-get install -y build-essential"
  return 1
}

zorg_venv() {
  [ -d "$ARTEMIS_MAP" ] || return 0
  printf '3.12\n' >"$ARTEMIS_MAP/.python-version" 2>/dev/null || true   # uv kiest nooit meer 3.15, ook via ARTEMIS' eigen start.sh
  local nu=""
  [ -x "$ARTEMIS_MAP/.venv/bin/python" ] && nu="$("$ARTEMIS_MAP/.venv/bin/python" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)"
  if [ "${1:-}" = forceer ] || [ "$nu" != "3.12" ]; then
    [ -n "$nu" ] && [ "$nu" != "3.12" ] && zeg "De venv draaide op Python $nu (daar faalt grpcio/zstandard); ik bouw hem opnieuw op met 3.12."
    if command -v uv >/dev/null 2>&1; then
      rm -rf "$ARTEMIS_MAP/.venv"
      # (1) de venv ZELF op 3.12 zetten, zodat latere uv-aanroepen hem hergebruiken i.p.v. 3.15 te kiezen.
      ( cd "$ARTEMIS_MAP" && uv python install 3.12 >>"$REK_MAP/artemis.log" 2>&1; UV_PYTHON=3.12 uv venv --python 3.12 .venv >>"$REK_MAP/artemis.log" 2>&1 )
      if ! ( cd "$ARTEMIS_MAP" && UV_PYTHON=3.12 uv sync >>"$REK_MAP/artemis.log" 2>&1 ); then
        # (2) vangnet: een compiler erbij en nog een keer (laat uv nu zelf de Python kiezen -- met een compiler bouwt elke versie).
        venv_vangnet && ( cd "$ARTEMIS_MAP" && uv sync >>"$REK_MAP/artemis.log" 2>&1 ) \
          && zeg "venv opgebouwd na het installeren van de compiler." \
          || zeg "venv opbouwen bleef mislukken -- kijk bij Log."
      else
        zeg "venv opgebouwd met Python 3.12 (wheels, geen compiler)."
      fi
    else
      zeg "uv staat er nog niet; ARTEMIS bouwt de venv zelf bij de eerste start -- met Python 3.12 (.python-version)."
    fi
  fi
  # 577: EERLIJK melden welke Python er nu echt in de venv staat (dit is de Python waarmee ARTEMIS draait).
  local na=""
  [ -x "$ARTEMIS_MAP/.venv/bin/python" ] && na="$("$ARTEMIS_MAP/.venv/bin/python" -c 'import sys;print("%d.%d.%d"%sys.version_info[:3])' 2>/dev/null)"
  [ -n "$na" ] && zeg "De venv draait nu op Python $na." || zeg "Er is nog geen venv; ARTEMIS bouwt hem bij de eerste start."
}

# 582: welke pids luisteren op een TCP-poort (eigen processen, geen root nodig). Nodig om de ECHTE console-server (de python op
# de oude poort) te stoppen: een pkill van de bash-wrapper liet de python-server -- die de poort vasthoudt -- in leven, en dan
# bleef 8000 bezet zodat ARTEMIS nooit startte (de bug van 581/582).
pids_op_poort() {
  local poort="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH 2>/dev/null | awk -v p=":$poort\$" '$4 ~ p {print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$poort" -sTCP:LISTEN -t 2>/dev/null | sort -u
  fi
}

# 582: na Bijwerken moet de DRAAIENDE console ECHT vervangen worden door een verse op de nieuwe poort (8765), en moet de oude
# poort (8000) vrijkomen voor ARTEMIS. 581 deed alleen `pkill -f "artemis-rek console"` -- dat doodt de bash-wrapper maar laat de
# python-server (die 8000 vasthoudt) in leven, dus bleef 8000 bezet. Nu:
#  (1) de autostart-unit/.profile opnieuw schrijven met de NIEUWE poort + daemon-reload;
#  (2) het oude console-proces ECHT stoppen: via zijn eigen pid-file, via de naam, en via de pids die op de poorten luisteren;
#  (3) een verse console op 8765 starten (onder systemd: restart; anders setsid);
#  (4) 8000 vrijmaken van wat er van ons nog op luistert, zodat ARTEMIS die kan pakken (de console-lus start ARTEMIS daarna).
# In een test staat ARTEMIS_GEEN_HERSTART, zodat er geen echte server opstart.
herstart_console() {
  [ -n "${ARTEMIS_GEEN_HERSTART:-}" ] && return 0
  local oudpid="" q
  [ -s "$REK_MAP/console.pid" ] && oudpid="$(cat "$REK_MAP/console.pid" 2>/dev/null)"
  autostart_installeren >/dev/null 2>&1 || true   # (1) unit (met ARTEMIS_CONSOLE_POORT in Environment) + .profile + daemon-reload
  if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet artemis-rek.service 2>/dev/null; then
    # (2+3) onder systemd: schoon herstarten -- de service stopt zijn hele cgroup (python incl.) en start op met de nieuwe poort.
    systemctl --user restart artemis-rek.service >/dev/null 2>&1 || true
  else
    # (2) geen systemd (Crostini-geval): het OUDE console-proces ECHT stoppen -- pid-file, naam, EN de poort zelf.
    [ -n "$oudpid" ] && { kill "$oudpid" 2>/dev/null || true; }
    pkill -f "artemis-rek console" 2>/dev/null || true
    for q in $(pids_op_poort "$CONSOLE_POORT"); do kill "$q" 2>/dev/null || true; done
    sleep 1
    # (3) een verse console op de nieuwe poort
    setsid "$BIN_SELF/artemis-rek" console </dev/null >>"$REK_MAP/console.log" 2>&1 &
  fi
  # (4) 8000 (ARTEMIS' poort) vrijmaken van wat er van ONS nog op luistert -- alleen als ARTEMIS niet al draait (dan zit onze
  # console daar niet). Zo komt de oude console-server (de python die 8000 vasthield) er echt af en kan ARTEMIS binden.
  if ! leeft "$PIDA"; then for q in $(pids_op_poort "$ARTEMIS_POORT"); do kill "$q" 2>/dev/null || true; done; fi
  zeg "De console draait nu op http://localhost:$CONSOLE_POORT (581/582: weg van 8000, dat is nu voor ARTEMIS). Open die in Chrome; de oude op 8000 werkt niet meer."
}

# 576/577: de Bijwerken-knop. Werkt het script bij, bouwt de venv opnieuw op (3.12, met compiler-vangnet), en herstart de console
# zodat de nieuwe code (zoals de Log-knop) meteen zichtbaar is. 577: ook de OUDE console-route (die Bijwerken naar `zelf-bijwerken`
# stuurde) komt hier terecht, zodat de venv-rebuild en de herstart ook dan gebeuren.
bijwerken() {
  zeg "== Bijwerken gestart $(date '+%H:%M:%S') =="
  zelf_bijwerken || zeg "Het script bijwerken ging niet door; ik ga wel verder met de venv en de console."
  zeg "Bijwerken 3/4: de Python-venv nalopen (3.12) ..."
  zorg_venv forceer
  zeg "Bijwerken 4/4: de console herstarten op poort $CONSOLE_POORT ..."
  herstart_console
  zeg "== Bijwerken klaar. Doe nu: Stop, dan Start, dan een taak. (De console draait op http://localhost:$CONSOLE_POORT.) =="
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
Environment=ARTEMIS_CONSOLE_POORT=$CONSOLE_POORT
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
  # 583: de poortwissel naar 8765 moet ook werken als een OUDE console nog op 8000 hangt (bv. na een Linux-herstart met de
  # nieuwe code). Deze nieuwe console draait op 8765; als ARTEMIS niet draait en er hangt nog iets van ons op de ARTEMIS-poort
  # (8000), stop dat dan, zodat ARTEMIS die poort kan pakken. Veilig: alleen als ARTEMIS niet al draait.
  if declare -f artemis_draait >/dev/null 2>&1 && ! artemis_draait; then
    local q; for q in $(pids_op_poort "$ARTEMIS_POORT" 2>/dev/null); do kill "$q" 2>/dev/null || true; done
  fi
  AREK="$BIN_SELF/artemis-rek" POORT="$CONSOLE_POORT" ARTEMIS_POORT="$ARTEMIS_POORT" REK_MAP="$REK_MAP" MIN_MB="$ARTEMIS_MIN_MB" python3 - <<'PY'
import os, subprocess, threading, time, html, urllib.parse, hashlib, re, json, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
AREK = os.environ.get('AREK', 'artemis-rek'); POORT = int(os.environ.get('POORT', '8765')); REK = os.environ.get('REK_MAP', '')
MIN_MB = int(os.environ.get('MIN_MB', '2048'))   # 588: ARTEMIS heeft ~2 GB nodig (Node/venv); zie ARTEMIS_MIN_MB
TOEGESTAAN = {'start', 'stop', 'status', 'scan', 'bijwerken', 'vergeet', 'log', 'opruimen', 'jarvis-waak', 'lokaal', 'lokaal-uit', 'lokaal-meet'}
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
def _hash(p):
    try:
        with open(p, 'rb') as f: return hashlib.sha256(f.read()).hexdigest()
    except Exception: return ''
START_HASH = _hash(AREK)
def herstart_als_nieuwer():
    # 577/587: laadt de nieuwe code zodra het script op schijf ANDERS is dan toen deze console startte. 587: op de HASH, niet op
    # de mtime -- zelf_bijwerken herschrijft de bestanden elke keer (ook als de inhoud gelijk is), dus mtime bumpt altijd en dat
    # zou een eindeloze herstart-lus geven. Met de hash herstart hij ALLEEN bij een echte nieuwe versie; gelijk = niets doen.
    h = _hash(AREK)
    if not h or h == START_HASH: return
    if os.environ.get('INVOCATION_ID'):
        os._exit(0)   # onder systemd: Restart=always start de console meteen opnieuw met de nieuwe code
    try: subprocess.Popen([AREK, 'console'], stdin=subprocess.DEVNULL, start_new_session=True)
    except Exception: pass
    os._exit(0)
RONDE = 0
LAATST_OPRUIM = -999
def vrij_mb():
    try:
        st = os.statvfs(REK or os.path.expanduser('~'))
        return st.f_bavail * st.f_frsize // (1024 * 1024)
    except Exception:
        return None
def schijfwacht():
    # 588: zelfherstel -- is de schijf te krap voor ARTEMIS (Node/venv/werkruimte), ruim dan zelf de caches op. opruimen raakt
    # ALLEEN caches en mislukte downloads (bewezen in de 585-check: nooit de venv, de code of bestanden van de gebruiker).
    # Hoogstens eens per ~30 min, zodat het nooit in een lus gaat malen als de schijf krap blijft.
    global LAATST_OPRUIM
    v = vrij_mb()
    if v is None or v >= MIN_MB: return
    if (RONDE - LAATST_OPRUIM) < 30: return
    LAATST_OPRUIM = RONDE
    doe('opruimen')
def lus():
    # elke minuut: nieuwe telefoons zoeken; en ARTEMIS aanhouden als de gewenste stand "aan" is.
    # 583: NIET meer blind 'start' aanroepen (dat startte ARTEMIS elke minuut opnieuw, en ARTEMIS opende elke keer een
    # browsertab voor hij op "poort bezet" stopte -> tientallen tabs). 'start-stil' houdt een pogingenteller bij en stopt
    # na 3 mislukte starts met een reden in Status; een mens die op Start drukt reset dat.
    # 587: EN elke ~10 min zichzelf bijwerken vanaf de site (stil: alleen ONZE bestanden ophalen, geen venv-rebuild). Zo hoeft
    # niemand meer op Bijwerken te klikken voor een nieuwe versie -- herstart_als_nieuwer laadt de nieuwe code daarna vanzelf.
    global RONDE
    while True:
        try:
            if RONDE % 10 == 0:
                doe('zelf-bijwerken-stil')
            RONDE += 1
            herstart_als_nieuwer()
            schijfwacht()
            doe('scan')
            doe('start-stil')
            if RONDE % 3 == 0:
                doe('jarvis-waak')   # 590: elke ~3 min JARVIS nakijken op de rektelefoons (nooit de F8)
            if RONDE % 15 == 7:
                doe('lokaal-auto')   # 592: lokaal model AANzetten zodra er een lokale server verschijnt ("standaard AAN")
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
<button data-cmd=scan>Zoek telefoons</button><button data-cmd=jarvis-waak>JARVIS nakijken</button><button data-cmd=lokaal>Lokaal model</button><button data-cmd=lokaal-uit>Lokaal uit</button><button data-cmd=vergeet>Vergeet overgeslagen</button><button data-cmd=bijwerken>Bijwerken</button><button data-cmd=opruimen>Ruim op</button><button data-cmd=log>Log</button></div>
<p>ARTEMIS zelf opent op de poort die <b>Status</b> noemt (onze gok is <a href="http://localhost:{ap}" target=_blank>localhost:{ap}</a>, maar de echte poort kan afwijken). Start duurt de eerste keer een paar minuten; druk daarna op Status.</p>
<pre id=uit>Klaar. Kies een knop.</pre>
<script>
// 586: elke knop geeft ALTIJD een zichtbaar, getimed antwoord en de pagina hangt nooit (AbortController-timeout). Bijwerken en
// Start draaien op de achtergrond; daarna halen we vanzelf Log en Status op zodat je de voortgang ziet zonder nog een klik.
const uit=document.getElementById('uit');
function nu(){{return new Date().toLocaleTimeString();}}
async function doe(c){{
  uit.textContent=nu()+' — bezig: '+c+'…';
  const ac=new AbortController();const t=setTimeout(()=>ac.abort(),25000);
  try{{
    const r=await fetch('/doe?cmd='+encodeURIComponent(c),{{method:'POST',signal:ac.signal}});
    clearTimeout(t);
    uit.textContent=nu()+' — '+c+':\\n'+(await r.text());
    if(c==='bijwerken'||c==='start'){{setTimeout(()=>doe('log'),7000);setTimeout(()=>doe('status'),20000);}}
  }}catch(e){{
    clearTimeout(t);
    uit.textContent=nu()+' — '+c+': de console antwoordt nog niet (hij start soms heel even opnieuw na Bijwerken). Druk zo op Log of Status. ('+e+')';
  }}
}}
for(const b of document.querySelectorAll('button[data-cmd]'))b.addEventListener('click',()=>doe(b.dataset.cmd));
doe('status');
</script></main></body></html>"""
# 592b: alleen een lokaal/LAN-adres (de telefoon) mag het ARTEMIS-model worden -- nooit een publiek internet-adres.
def _lan_adres_ok(u):
    try: pu = urllib.parse.urlparse(u)
    except Exception: return False
    if pu.scheme not in ('http', 'https') or not pu.path.endswith('/v1'): return False
    h = pu.hostname or ''
    if h in ('localhost', '127.0.0.1') or h.endswith('.local'): return True
    if h.startswith('10.') or h.startswith('192.168.'): return True
    if re.match(r'^172\.(1[6-9]|2[0-9]|3[0-1])\.', h): return True
    return False
def _probe_model(base):
    # lees /v1/models van het lokale adres en kies een model dat schermbeelden aankan (e4b/e2b/gemma/3n/vision), anders het eerste.
    try:
        with urllib.request.urlopen(base + '/models', timeout=6) as r:
            ids = [m.get('id', '') for m in (json.load(r).get('data') or []) if isinstance(m, dict)]
    except Exception:
        return ''
    ids = [i for i in ids if i]
    for i in ids:
        if re.search(r'e4b|e2b|gemma|3n|vision', i, re.I): return i
    return ids[0] if ids else ''
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _schrijf(self, code, body, ctype='text/plain; charset=utf-8'):
        b = body.encode('utf-8'); self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def _cors(self, code, body):
        b = body.encode('utf-8'); self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        self._cors(204, '')
    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        if p.path in ('/', '/index.html'):
            self._schrijf(200, PAGINA.format(ap=int(os.environ.get('ARTEMIS_POORT', '8000'))), 'text/html; charset=utf-8')
        elif p.path == '/status.json':
            aan = os.path.exists(os.path.join(REK, 'artemis.pid'))
            self._schrijf(200, '{"console":true,"artemis":%s}' % ('true' if aan else 'false'), 'application/json')
        else:
            self._schrijf(404, 'niet gevonden')
    def do_POST(self):
        p = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(p.query)
        if p.path == '/lokaal-zet':
            # 592b: Veronica (die de hartslag/relay kent) geeft het modeladres van een TELEFOON door -- het model draait NOOIT
            # op deze Chromebook (1,6 GB vrij; en het maakt hem traag). Alleen een LOKAAL/LAN-adres wordt aangenomen; geen
            # publiek internet-adres (anders zou een willekeurige website ARTEMIS naar zijn eigen model kunnen sturen).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            ruw = self.rfile.read(ln).decode('utf-8', 'replace') if ln else ''
            # 592g: accepteer ZOWEL form-encoded (base=...) ALS JSON ({"base":...} of base_url/url). Veronica stuurt form-encoded,
            # maar een JSON-POST met de hand (of een andere client) mag ook -- anders gaf een geldig LAN-adres per ongeluk 400.
            ct = (self.headers.get('Content-Type') or '').lower()
            base = model = ''; token = 'local'
            if 'application/json' in ct or ruw.lstrip().startswith('{'):
                try:
                    j = json.loads(ruw) if ruw.strip() else {}
                    base = str(j.get('base') or j.get('base_url') or j.get('url') or '').strip()
                    model = str(j.get('model') or '').strip(); token = (str(j.get('token') or 'local').strip() or 'local')
                except Exception:
                    base = ''
            else:
                f = urllib.parse.parse_qs(ruw)
                base = (f.get('base', [''])[0]).strip(); model = (f.get('model', [''])[0]).strip(); token = ((f.get('token', ['local'])[0]).strip() or 'local')
            if not _lan_adres_ok(base):
                self._cors(400, 'alleen een lokaal/LAN-modeladres wordt aangenomen (de telefoon, niet het internet)'); return
            if not model:
                model = _probe_model(base)
            if not model:
                self._cors(502, 'geen model gevonden op %s/models (draait OlliteRT met een geladen model?)' % base); return
            try:
                with open(os.path.join(REK, 'lokaal-model.conf'), 'w') as fh:
                    fh.write('BASE_URL=%s\nMODEL=%s\nTOKEN=%s\n' % (base, model, token))
                try: os.chmod(os.path.join(REK, 'lokaal-model.conf'), 0o600)
                except Exception: pass
                subprocess.run([AREK, 'schrijf-jsonc'], timeout=30)
                self._cors(200, 'lokaal model gezet: %s via %s (Gemini blijft terugval). Doe: Stop, dan Start.' % (model, base))
            except Exception as e:
                self._cors(500, 'fout: ' + str(e))
            return
        cmd = (q.get('cmd', [''])[0]) if p.path == '/doe' else ''
        if cmd in TOEGESTAAN: self._schrijf(200, doe(cmd))
        else: self._schrijf(400, 'onbekende opdracht')
threading.Thread(target=lus, daemon=True).start()
# 587: bind met korte herhaling. Na een zelf-herstart (herstart_als_nieuwer) start deze verse console terwijl de OUDE de poort
# nog een ogenblik vasthoudt; zonder herhaling zou de verse meteen op OSError sterven en bleef er niets draaien. Max ~6 s wachten.
srv = None
for _ in range(12):
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', POORT), H); break
    except OSError:
        time.sleep(0.5)
if srv is None:
    print('De console kon poort %d niet openen (draait hij al?).' % POORT)
else:
    # 582: de server bindt -> schrijf PAS DAN de pid weg (de python-server zelf, die de poort vasthoudt). herstart_console leest
    # deze om bij Bijwerken de ECHTE console te stoppen; een pkill van de bash-wrapper alleen liet deze python in leven.
    try:
        with open(os.path.join(REK, 'console.pid'), 'w') as f: f.write(str(os.getpid()))
    except Exception: pass
    srv.serve_forever()
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

# 583: draait ARTEMIS? pid levend OF hij antwoordt op zijn poort (start.sh kan zijn pid afsplitsen).
artemis_draait() { leeft "$PIDA" || antwoordt "$ARTEMIS_POORT"; }

# De ECHTE start (geen teller-reset, geen AANF-touch). Aangeroepen door start() (mens) en start_stil() (console-lus).
start_kern() {
  [ -d "$ARTEMIS_MAP" ] || { zeg "ARTEMIS staat er niet. Draai eerst installeer.sh."; return 1; }
  [ -s "$TOEG" ] || { zeg "Er staat nog geen rektelefoon op de lijst. Sluit er een aan (kabel + USB-foutopsporing); de console vindt hem vanzelf."; return 1; }
  if artemis_draait; then zeg "ARTEMIS draait al: http://localhost:$ARTEMIS_POORT"; return 0; fi
  waak_ronde || return 1
  ruim_als_krap   # 588: zelfherstel -- eerst opruimen als de schijf te krap is voor Node/venv (de blokkade van 580)
  zorg_venv   # 576: zorg dat de venv op Python 3.12 staat (anders faalt grpcio en start ARTEMIS nooit)
  # 581: ARTEMIS HOUDT zijn eigen 8000 (onze console staat op 8765). UV_PYTHON=3.12: ook ARTEMIS' eigen start.sh pakt 3.12.
  # 583: ARTEMIS mag NOOIT zelf een browser openen (anders: tientallen tabs bij elke herstart). BROWSER=true, DISPLAY leeg,
  # en een map met nep-browsers (xdg-open en soortgenoten, elk een lege 'exit 0') vooraan in PATH -- alleen voor dit ARTEMIS-subproces.
  # 585: ARTEMIS_ARTEMIS_JSONC wijst ARTEMIS naar onze config ($REK_MAP/artemis.jsonc) -- NIET ARTEMIS_APP_DIR zetten
  # (dat verplaatst ook .env en breekt de sleutel). ARTEMIS_<FILE> is resolutievolgorde #1 in get_config_path.
  # 592: staat er een LOKAAL model (lokaal-model.conf), geef ARTEMIS dan OPENAI_BASE_URL/OPENAI_API_KEY mee -- dan denkt hij
  # lokaal (OpenAI-compatibel) en is Gemini alleen terugval. Bij een adb-doorgestuurde poort (127.0.0.1:...) wordt de doorsturing
  # hier opnieuw gelegd, want die kan na een herstart/herverbinding wegvallen.
  local lok_env=""
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    local lm_base lm_token lm_serial lm_fport
    lm_base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    lm_token="$(sed -n 's/^TOKEN=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    lm_serial="$(sed -n 's/^ADB_SERIAL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    lm_fport="$(sed -n 's/^ADB_FORWARD=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    # een adb-doorsturing opnieuw leggen (alleen naar een toegestane, niet-F8 telefoon)
    if [ -n "$lm_serial" ] && [ -n "$lm_fport" ] && ! is_f8 "$lm_serial"; then
      "$ADB" -s "$lm_serial" forward tcp:"${lm_fport%%:*}" tcp:"${lm_fport##*:}" >/dev/null 2>&1 || true
    fi
    [ -n "$lm_base" ] && lok_env="OPENAI_BASE_URL=$lm_base OPENAI_API_KEY=${lm_token:-local}"
  fi
  # 592fix: via `env` -- een VARIABELE ($lok_env) in prefix-positie wordt door bash als het COMMANDO gelezen (niet als
  # toewijzing), waardoor 'PORT=8000: command not found' kwam. `env` neemt alle KEY=VAL (ook de lege/gevulde $lok_env)
  # gewoon als argumenten, dus het werkt met en zonder lokaal model.
  ( cd "$ARTEMIS_MAP" && env PATH="$REK_MAP/geen-browser:$PATH" BROWSER=true DISPLAY= UV_PYTHON=3.12 $lok_env PORT="$ARTEMIS_POORT" ARTEMIS_PORT="$ARTEMIS_POORT" ARTEMIS_WEB_PORT="$ARTEMIS_POORT" ARTEMIS_NO_OPEN=1 NG_CLI_ANALYTICS=false ARTEMIS_ARTEMIS_JSONC="$REK_MAP/artemis.jsonc" setsid bash start.sh </dev/null >>"$REK_MAP/artemis.log" 2>&1 & echo $! >"$PIDA" )
  sleep 1
  ( setsid "$0" waakhond </dev/null >>"$LOG" 2>&1 & echo $! >"$PIDW" )
  zeg "ARTEMIS start (de eerste keer duurt het een paar minuten). ARTEMIS zelf: http://localhost:$ARTEMIS_POORT"
}

# Door een MENS (console-knop Start): de gewenste stand AAN, de pogingenteller RESET (vers budget), dan starten.
start() {
  touch "$AANF"   # 571: de gewenste stand is "aan"; de console-lus houdt hem aan
  rm -f "$REK_MAP/start-pogingen" "$REK_MAP/start-gestopt"
  start_kern
}

# 583: aangeroepen door de console-lus (elke minuut). Houdt een pogingenteller bij; na 3 mislukte starts STOPT hij met
# proberen en schrijft een reden (zichtbaar in Status), zodat ARTEMIS niet elke minuut opnieuw start. Een mens die op Start
# drukt reset de teller. Lukt een start wel, dan wordt de teller gewist.
START_MAX=3
start_stil() {
  [ -f "$AANF" ] || return 0
  if artemis_draait; then rm -f "$REK_MAP/start-pogingen" "$REK_MAP/start-gestopt"; return 0; fi
  [ -f "$REK_MAP/start-gestopt" ] && return 0
  local n; n="$(cat "$REK_MAP/start-pogingen" 2>/dev/null || echo 0)"; [ "$n" -eq "$n" ] 2>/dev/null || n=0; n=$((n+1))
  if [ "$n" -gt "$START_MAX" ]; then
    printf 'ARTEMIS startte %s keer niet (vaak: poort %s bezet, of een startfout -- kijk bij Log). Gestopt met automatisch opnieuw proberen om geen browsertabs te blijven openen. Druk op Start om het opnieuw te proberen.\n' "$START_MAX" "$ARTEMIS_POORT" >"$REK_MAP/start-gestopt"
    return 0
  fi
  printf '%s' "$n" >"$REK_MAP/start-pogingen"
  start_kern
}

stop() {
  rm -f "$REK_MAP/start-pogingen" "$REK_MAP/start-gestopt"   # 583: Stop wist de pogingenteller; een latere Start begint vers
  rm -f "$AANF"   # 571: de gewenste stand is "uit"; de console-lus start hem niet opnieuw
  stop_artemis
  if leeft "$PIDW"; then kill "$(cat "$PIDW")" 2>/dev/null || true; fi
  rm -f "$PIDW"
  zeg "ARTEMIS staat uit."
}

# 575: welke TCP-poorten luistert de PROCESGROEP van ARTEMIS echt? (eigen processen, geen root nodig).
# 581: ARTEMIS luistert op zijn eigen 8000 (onze gok); dit toont waar hij ECHT luistert, mocht dat afwijken.
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

# 585: waar bewaart ARTEMIS zijn eigen staat (daemon-log, traces)? Spiegelt de Linux-resolutie van ARTEMIS: ARTEMIS_APP_DIR,
# anders XDG_DATA_HOME/artemis, anders ~/.gemini/jetski of ~/.artemis als die bestaan, anders ~/.local/share/artemis.
artemis_app_dir() {
  if [ -n "${ARTEMIS_APP_DIR:-}" ]; then printf '%s' "$ARTEMIS_APP_DIR"; return; fi
  if [ -n "${XDG_DATA_HOME:-}" ]; then printf '%s' "$XDG_DATA_HOME/artemis"; return; fi
  [ -d "$HOME/.gemini/jetski" ] && { printf '%s' "$HOME/.gemini/jetski"; return; }
  [ -d "$HOME/.artemis" ] && { printf '%s' "$HOME/.artemis"; return; }
  printf '%s' "$HOME/.local/share/artemis"
}

# 575/585: de laatste logregels, zodat Cowork in Chrome ziet waarom ARTEMIS wel/niet luistert. 585: ARTEMIS' LLM-fouten
# (401/429/404, modelnaam, quota) staan NIET in onze artemis.log (dat is de launcher/uvicorn) maar in de DAEMON-log en de
# per-taak trace-logs onder de app-map. Die tonen we er nu bij.
# 590 (stap 78 van de lijst): WAAKHOND ZONDER AI -- gewoon adb. Per rektelefoon (NOOIT de F8, NOOIT een niet-toegestane):
# (1) kijkt of JARVIS draait en start hem anders; (2) houdt de batterij op Onbeperkt (geen doze/standby); (3) installeert een
# nieuwere JARVIS als er een klaarligt. Raakt UITSLUITEND het JARVIS-pakket ($JARVIS_PKG) aan -- nooit een bank-, betaal-,
# wachtwoord- of authenticator-app, nooit een force-stop van iets anders. Dat is de veiligheidskern en er staat een test op.
jarvis_waak() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  [ -s "$TOEG" ] || { zeg "Geen rektelefoon op de lijst (sluit er een aan + USB-foutopsporing)."; return 0; }
  local s id naam draait apkcode opcode any=0
  for s in $(verbonden); do
    id="$(toestel_id "$s")"; [ -n "$id" ] || continue
    toegestaan "$id" || continue
    if is_f8 "$s"; then zeg "JARVIS-waakhond slaat de F8 over (de dagelijkse telefoon)."; continue; fi
    any=1; naam="$(toestel_naam "$s")"
    # (1) draait JARVIS? pidof is het betrouwbaarst; leeg = gestart via de LAUNCHER-intent (nooit een ander pakket aanraken).
    draait="$("$ADB" -s "$s" shell pidof "$JARVIS_PKG" 2>/dev/null | tr -d '\r\n ')"
    if [ -z "$draait" ]; then
      if "$ADB" -s "$s" shell monkey -p "$JARVIS_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; then
        zeg "$naam: JARVIS lag stil -> opnieuw gestart."
      else
        zeg "$naam: JARVIS starten lukte niet (staat de app er al op?)."
      fi
    else
      zeg "$naam: JARVIS draait (pid $draait)."
    fi
    # (2) batterij op Onbeperkt / vrijstellen van doze -- best-effort, meerdere wegen (per Android-versie verschillend).
    "$ADB" -s "$s" shell dumpsys deviceidle whitelist +"$JARVIS_PKG" >/dev/null 2>&1 || true
    "$ADB" -s "$s" shell cmd deviceidle whitelist +"$JARVIS_PKG" >/dev/null 2>&1 || true
    "$ADB" -s "$s" shell cmd appops set "$JARVIS_PKG" RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1 || true
    # (3) een nieuwere JARVIS installeren ALS er een klaarligt: $REK_MAP/jarvis.apk + $REK_MAP/jarvis.apk.code (de versionCode).
    # Zonder die twee bestanden: niets installeren (we raden nooit). Alleen -r (behoudt gegevens); alleen het JARVIS-pakket.
    if [ -s "$REK_MAP/jarvis.apk" ] && [ -s "$REK_MAP/jarvis.apk.code" ]; then
      apkcode="$(tr -dc 0-9 < "$REK_MAP/jarvis.apk.code")"
      opcode="$("$ADB" -s "$s" shell dumpsys package "$JARVIS_PKG" 2>/dev/null | sed -n 's/.*versionCode=\([0-9]\{1,\}\).*/\1/p' | head -1)"
      if [ -n "$apkcode" ] && { [ -z "$opcode" ] || [ "$apkcode" -gt "$opcode" ]; }; then
        if "$ADB" -s "$s" install -r "$REK_MAP/jarvis.apk" >/dev/null 2>&1; then
          zeg "$naam: JARVIS bijgewerkt naar versionCode $apkcode."
        else
          zeg "$naam: JARVIS bijwerken lukte niet (kijk bij de telefoon)."
        fi
      fi
    fi
  done
  [ "$any" = 1 ] || zeg "Geen bereikbare rektelefoon om JARVIS op na te kijken."
}

# 589: haal de LLM-fout uit de LAATSTE ARTEMIS-sessie (localhost, puur lezen, geen sleutel). Hier staat WAAROM een taak faalde,
# bv. een Gemini-404 met het model dat je dan moet gebruiken ("update your code to use models/gemini-..."). Valt stil als de
# API anders is. Zo laat de modelkeuze zich zelf bijsturen zonder dat je in ARTEMIS' eigen console hoeft te graven.
llm_laatste_fout() {
  command -v python3 >/dev/null 2>&1 || return 0
  ARTEMIS_BASIS="http://127.0.0.1:$ARTEMIS_POORT" python3 - <<'PY' 2>/dev/null || true
import json, os, sys, re, urllib.request
b = os.environ['ARTEMIS_BASIS']
def haal(u):
    with urllib.request.urlopen(u, timeout=5) as r: return json.load(r)
try: sess = haal(b + '/api/sessions')
except Exception: sys.exit(0)
rows = [r for r in (sess if isinstance(sess, list) else sess.get('sessions') or sess.get('data') or []) if isinstance(r, dict)]
if not rows:
    print('(geen ARTEMIS-sessies gevonden)'); sys.exit(0)
rows.sort(key=lambda r: str(r.get('created_at') or r.get('updated_at') or r.get('start_time') or r.get('started_at') or ''))
last = rows[-1]
sid = str(last.get('session_id') or last.get('id') or '')
if not sid: sys.exit(0)
print('Laatste ARTEMIS-sessie:', sid)
try: steps = haal(b + '/api/sessions/' + sid + '/steps')
except Exception:
    print('(kon de stappen niet lezen)'); sys.exit(0)
items = steps if isinstance(steps, list) else steps.get('steps') or steps.get('data') or []
blob = json.dumps(items, ensure_ascii=False)
sleutels = ['llm_gave_up', 'gave_up', 'no longer available', 'not available', 'NOT_FOUND', 'PERMISSION_DENIED',
            'RESOURCE_EXHAUSTED', 'quota', 'API key not valid', 'update your code', 'models/gemini', 'error']
pat = '|'.join(re.escape(s) for s in sleutels)
gezien = []
for m in re.finditer(r'"([^"]{0,300}?(?:%s)[^"]{0,300}?)"' % pat, blob, re.I):
    t = m.group(1).strip()
    if t and t not in gezien: gezien.append(t)
if gezien:
    print('LLM-fout in de laatste sessie:')
    for t in gezien[:8]: print('  -', t)
else:
    print('(geen duidelijke LLM-fout -- de taak lukte, was leeg, of is nog bezig)')
PY
}
# 592 (#130/§585-3): ARTEMIS lokaal laten denken. Zoekt een OpenAI-compatibele server ZONDER sleutel op een rektelefoon
# (OlliteRT/ollama op 8000/11434/8080 -- de eigen motor op 8081 vraagt de rij-code, die de console niet heeft en dus overslaat),
# via een adb-doorsturing naar 127.0.0.1:$LOKAAL_POORT. Vindt hij een (liefst multimodaal/vision) Gemma-model, dan schrijft hij
# lokaal-model.conf en herschrijft artemis.jsonc naar lokaal-primair; Gemini wordt de terugval. NOOIT de F8 via adb (die mag thuis
# wel als gast-brein over het LAN dienen -- zet dan met de hand BASE_URL in lokaal-model.conf). Raakt geen enkele app aan.
# 592: DE ENE plek die artemis.jsonc schrijft (runtime, in artemis-rek zelf -- aangeroepen door de installatie en door
# lokaal/lokaal_uit/lokaal_auto). Lokaal-model.conf aanwezig = LOKAAL primair (openai) + Gemini als terugval; anders Gemini-primair.
schrijf_artemis_jsonc() {
  local lm_model
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    lm_model="$(sed -n 's/^MODEL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    [ -n "$lm_model" ] || lm_model="local-model"
    # 592g (27 okt, 20:30): ELKE LLM-rol lokaal. ARTEMIS' default/nodes-formaat dekt NIET de optionele keurmeester-nodes
    # (planner_validation, validator_pixel_safety_net, history_analyzer, output_analyzer): die blijven leeg en vallen in
    # get_agent() terug op een HARDGECODEERDE lightweight_judge_default() = gemini-3.5-flash-lite. planner_validation draait
    # na elke milestone-edit (dus TIJDENS het plannen) -> dat was de Gemini-429 bij de proef. We schrijven daarom het VOLLEDIGE
    # formaat (top-level planner + utils, dan geeft _expand_default_into_nodes het ongewijzigd door) met ELKE node op het
    # lokale model en Gemini (gemini-3.8-flash) alleen als terugval. Python bouwt de JSON (robuust bij modelnamen).
    python3 - "$lm_model" >"$REK_MAP/artemis.jsonc" <<'PY'
import json, sys
m = sys.argv[1]
def lok(temp=None):
    d = {"provider": "openai", "model": m, "fallback": {"provider": "google", "model": "gemini-3.8-flash", "thinking_level": "medium"}}
    if temp is not None: d["temperature"] = temp
    return d
cfg = {
    "planner": lok(),
    "utils": {"outputter": lok(), "hopper": lok(), "video_analyzer": lok(), "object_detector": lok()},
    "summarizer": lok(), "operator": lok(), "operator_summarizer": lok(),
    "log_reader_sub_agent": lok(), "log_analyzer": lok(), "diagnoser": lok(),
    "checker": lok(), "planner_avatar": lok(), "history_analyzer_expert": lok(),
    "diagnoser_expert": lok(), "explorer": lok(), "history_analyzer": lok(),
    "validator_pixel_safety_net": lok(0.0), "planner_validation": lok(0.0), "output_analyzer": lok(),
}
print(json.dumps(cfg, indent=2))
PY
  else
    cat >"$REK_MAP/artemis.jsonc" <<'JSONC'
{
  // 589: een model dat op de gratis Gemini-laag werkt (gemini-3.8-flash sinds 27 okt; het vorige model werd ingetrokken
  // voor nieuwe gebruikers). Gebruik een AIza-sleutel (een AQ-sleutel werkt niet).
  "default": {
    "provider": "google",
    "model": "gemini-3.8-flash",
    "thinking_level": "medium",
    "fallback": { "provider": "google", "model": "gemini-3.6-flash", "thinking_level": "medium" }
  },
  "presets": {
    "gemini-flash": { "provider": "google", "model": "gemini-3.8-flash", "fallback": { "provider": "google", "model": "gemini-3.6-flash" } },
    "cost-saving": { "provider": "google", "model": "gemini-3.6-flash", "fallback": { "provider": "google", "model": "gemini-3.8-flash" } }
  }
}
JSONC
  fi
  chmod 600 "$REK_MAP/artemis.jsonc" 2>/dev/null || true
}
lokaal_vind() {   # echoot "SERIAL|PHONEPORT|MODEL" van de eerste werkende lokale server, of niets
  local s id poort model lp="$LOKAAL_POORT"
  for s in $(verbonden); do
    id="$(toestel_id "$s")"; [ -n "$id" ] || continue
    toegestaan "$id" || continue
    is_f8 "$s" && continue
    for poort in 8000 11434 8080; do
      "$ADB" -s "$s" forward --remove tcp:"$lp" >/dev/null 2>&1 || true
      "$ADB" -s "$s" forward tcp:"$lp" tcp:"$poort" >/dev/null 2>&1 || continue
      model="$(curl -fsS -m 5 "http://127.0.0.1:$lp/v1/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | grep -iE 'e4b|e2b|gemma|3n|vision' | head -1)"
      [ -n "$model" ] || model="$(curl -fsS -m 5 "http://127.0.0.1:$lp/v1/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | head -1)"
      "$ADB" -s "$s" forward --remove tcp:"$lp" >/dev/null 2>&1 || true
      if [ -n "$model" ]; then printf '%s|%s|%s' "$s" "$poort" "$model"; return 0; fi
    done
  done
  return 1
}
lokaal() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 1; }
  [ -s "$TOEG" ] || { zeg "Geen rektelefoon op de lijst."; return 1; }
  local vondst serial poort model lp="$LOKAAL_POORT"
  zeg "Zoek een lokaal model op de rektelefoons (OlliteRT/ollama, zonder sleutel)..."
  vondst="$(lokaal_vind)"
  if [ -z "$vondst" ]; then
    zeg "Geen lokale OpenAI-server zonder sleutel gevonden (geprobeerd: 8000/11434/8080 op elke rektelefoon; de eigen motor op 8081 vraagt de rij-code)."
    zeg "Twee wegen:"
    zeg "  1) Start OlliteRT op een rektelefoon (Start Server + een multimodaal Gemma, bv. E4B) en druk opnieuw op 'Lokaal model'."
    zeg "  2) Of de F8 thuis als gast-brein (OlliteRT, >30% accu, niet in gebruik): zet met de hand in $REK_MAP/lokaal-model.conf:"
    zeg "       BASE_URL=http://<F8-ip>:8000/v1 | MODEL=<modelnaam> | TOKEN=local   (elk op een eigen regel, = i.p.v. |)"
    zeg "ARTEMIS blijft zolang op Gemini (terugval)."
    return 1
  fi
  serial="${vondst%%|*}"; model="${vondst##*|}"; poort="$(printf '%s' "$vondst" | cut -d'|' -f2)"
  "$ADB" -s "$serial" forward tcp:"$lp" tcp:"$poort" >/dev/null 2>&1 || true
  printf 'BASE_URL=http://127.0.0.1:%s/v1\nMODEL=%s\nTOKEN=local\nADB_SERIAL=%s\nADB_FORWARD=%s:%s\n' "$lp" "$model" "$serial" "$lp" "$poort" >"$REK_MAP/lokaal-model.conf"
  chmod 600 "$REK_MAP/lokaal-model.conf"
  zeg "Lokaal model AAN: '$model' op $(toestel_naam "$serial") (telefoonpoort $poort, via 127.0.0.1:$lp). Gemini is nu alleen terugval."
  schrijf_artemis_jsonc   # artemis.jsonc -> lokaal-primair
  lokaal_meet
  zeg "Doe nu: Stop, dan Start, dan een taak. (ARTEMIS herstart met het lokale model.)"
}
lokaal_uit() {
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    local serial fport; serial="$(sed -n 's/^ADB_SERIAL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    fport="$(sed -n 's/^ADB_FORWARD=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    [ -n "$serial" ] && [ -n "$fport" ] && "$ADB" -s "$serial" forward --remove tcp:"${fport%%:*}" >/dev/null 2>&1 || true
    rm -f "$REK_MAP/lokaal-model.conf"
    schrijf_artemis_jsonc   # terug naar Gemini-primair
    zeg "Lokaal model UIT. ARTEMIS denkt weer met Gemini (gemini-3.8-flash). Doe: Stop, dan Start."
  else
    zeg "Er stond al geen lokaal model aan."
  fi
}
lokaal_meet() {
  [ -s "$REK_MAP/lokaal-model.conf" ] || { zeg "Lokaal model staat uit."; return 0; }
  command -v curl >/dev/null 2>&1 || return 0
  local base model t0 t1 ant
  base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
  model="$(sed -n 's/^MODEL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
  zeg "Meet het lokale model ($model op $base)..."
  t0="$(date +%s%3N 2>/dev/null)"; [ -n "$t0" ] || t0="$(( $(date +%s) * 1000 ))"
  ant="$(curl -fsS -m 60 "$base/chat/completions" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Antwoord met EEN woord: werkt dit?\"}],\"max_tokens\":16}" 2>/dev/null)"
  t1="$(date +%s%3N 2>/dev/null)"; [ -n "$t1" ] || t1="$(( $(date +%s) * 1000 ))"
  if [ -n "$ant" ]; then
    zeg "Lokaal model antwoordde in ~$(( t1 - t0 )) ms. (De echte snelheid met een schermbeeld blijkt pas op een echte taak.)"
  else
    zeg "Lokaal model antwoordde NIET op een testvraag -- draait OlliteRT met een geladen model? ARTEMIS valt zolang terug op Gemini."
  fi
}
lokaal_auto() {   # 592: de console-lus -- zet lokaal AAN zodra er een lokale server verschijnt (geen conf nodig), zonder de 60s-meting
  [ -s "$REK_MAP/lokaal-model.conf" ] && return 0
  command -v "$ADB" >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 || return 0
  [ -s "$TOEG" ] || return 0
  local vondst serial poort model lp="$LOKAAL_POORT"
  vondst="$(lokaal_vind)" || return 0
  [ -n "$vondst" ] || return 0
  serial="${vondst%%|*}"; model="${vondst##*|}"; poort="$(printf '%s' "$vondst" | cut -d'|' -f2)"
  "$ADB" -s "$serial" forward tcp:"$lp" tcp:"$poort" >/dev/null 2>&1 || true
  printf 'BASE_URL=http://127.0.0.1:%s/v1\nMODEL=%s\nTOKEN=local\nADB_SERIAL=%s\nADB_FORWARD=%s:%s\n' "$lp" "$model" "$serial" "$lp" "$poort" >"$REK_MAP/lokaal-model.conf"
  chmod 600 "$REK_MAP/lokaal-model.conf"
  schrijf_artemis_jsonc
  logregel "Lokaal model gevonden en AANgezet: $model op $(toestel_naam "$serial"). Gemini is nu terugval. Herstart ARTEMIS (Stop, Start) om het te gebruiken."
}

# 591: WELK MODEL gebruikte de laatste taak ECHT? De modelnaam staat in de daemon-/trace-logs (de stappen-API draagt alleen de
# provider). Zo zie je of ARTEMIS bij een 503/429 op gemini-3.8-flash is overgestapt op de reserve gemini-3.6-flash -- en of hij
# daarna weer terugging. Puur lezen. ARTEMIS schakelt na 4 mislukte pogingen (provider_unavailable) over op de reserve, en begint
# de volgende taak weer bij het primaire model (dat is "overstappen en terug" -- deze regel maakt het alleen zichtbaar).
model_gebruikt() {
  local ad tr bestanden modellen prim res lokaal rollen
  ad="$(artemis_app_dir)"
  bestanden="$(ls -1t "$ad"/logs/daemon-*.log 2>/dev/null | head -2)"
  tr="$(ls -1dt "$ad"/traces/*/ 2>/dev/null | head -1)"
  [ -n "$tr" ] && bestanden="$bestanden ${tr}stderr.log ${tr}stdout.log"
  prim="$(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" 2>/dev/null | head -1)"
  res="$(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" 2>/dev/null | sed -n 2p)"
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    lokaal="$(sed -n 's/^MODEL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    zeg "Ingesteld: LOKAAL ${lokaal:-?} voor ELKE rol (planner, operator, checker, keurmeester...), Gemini (${res:-gemini-3.8-flash}) alleen als terugval."
  else
    zeg "Ingesteld: primair ${prim:-?}, reserve ${res:-?} (ARTEMIS stapt na een paar 503/429-pogingen over op de reserve, en terug op de volgende taak)."
  fi
  if [ -n "$bestanden" ]; then
    # 592g: tel ZOWEL de Gemini-modellen ALS de lokale modelnaam (openai). Zo zie je of het lokale model echt gebeld wordt.
    modellen="$(grep -hoE "gemini-[0-9]+\.[0-9]+-flash(-lite)?|$(printf '%s' "${lokaal:-__geen__}" | sed 's/[.[\*^$()+?{|]/\\&/g')" $bestanden 2>/dev/null | sort | uniq -c | sort -rn)"
    if [ -n "$modellen" ]; then
      zeg "Modellen die ARTEMIS echt aanriep (recente logs, met aantal):"; printf '%s\n' "$modellen" | sed 's/^/  /'
    else
      zeg "(nog geen modelnaam in de logs gezien -- draait er al een taak?)"
    fi
    # 592g: WELK MODEL PER ROL? De logregels noemen de node-naam vaak samen met de provider/het model; toon die regels (ontdubbeld,
    # de laatste per rol). Format-ongevoelig: we zoeken regels die een rolnaam EN een provider/modelnaam bevatten.
    rollen="planner|planner_validation|validator_pixel_safety_net|operator|operator_summarizer|summarizer|checker|diagnoser|diagnoser_expert|explorer|log_analyzer|log_reader_sub_agent|history_analyzer|history_analyzer_expert|planner_avatar|output_analyzer|outputter|hopper|object_detector|video_analyzer"
    local perrol
    perrol="$(grep -hiE "($rollen)" $bestanden 2>/dev/null | grep -iE 'openai|google|gemini|provider|model' | grep -oiE "($rollen)[^A-Za-z0-9]{1,40}(openai|google|gemini-[0-9.]+-flash(-lite)?|$(printf '%s' "${lokaal:-__geen__}" | sed 's/[.[\*^$()+?{|]/\\&/g'))" | awk '!z[$0]++' | tail -n 20)"
    if [ -n "$perrol" ]; then
      zeg "Per rol gezien in de logs (rol -> provider/model):"; printf '%s\n' "$perrol" | sed 's/^/  /'
    fi
    grep -qiE 'fallback|on_fallback|switching to fallback|overstap' $bestanden 2>/dev/null \
      && zeg "-> ARTEMIS is minstens een keer op de RESERVE overgestapt (fallback gezien in de logs)."
  fi
}
log() {
  zeg "== Welk model gebruikte de laatste taak (591) =="
  model_gebruikt
  zeg ""
  zeg "== LLM-fout uit de laatste ARTEMIS-sessie (589) =="
  llm_laatste_fout
  zeg ""
  zeg "== Laatste logregels (ARTEMIS launcher) =="
  if [ -s "$REK_MAP/artemis.log" ]; then tail -n 20 "$REK_MAP/artemis.log"; else zeg "(nog geen artemis.log -- ARTEMIS is nog niet gestart)"; fi
  local f dl tr tl ad; ad="$(artemis_app_dir)"
  for dl in "$ad"/logs/daemon-*.log; do
    [ -s "$dl" ] && { zeg "== ARTEMIS daemon $(basename "$dl") (laatste 20 -- hier staan LLM-fouten) =="; tail -n 20 "$dl"; } || true
  done
  # de nieuwste taak-trace: stderr/stdout bevatten de echte LLM-fout (statuscode + bericht)
  tr="$(ls -1dt "$ad"/traces/*/ 2>/dev/null | head -1)"
  if [ -n "$tr" ]; then
    for tl in stderr.log stdout.log; do
      [ -s "$tr$tl" ] && { zeg "== laatste taak $tl (laatste 15) =="; tail -n 15 "$tr$tl"; } || true
    done
  fi
  for f in console-start console-bijwerken waakhond; do
    [ -s "$REK_MAP/$f.log" ] && { zeg "== $f (laatste 10) =="; tail -n 10 "$REK_MAP/$f.log"; } || true
  done
}

# 584: de Gemini-sleutel moet met 'AIza' beginnen. Google AI Studio maakt sinds kort alleen 'AQ.'-sleutels, die ARTEMIS met
# 401 'API key not valid' afwijst. Deze controle leest ALLEEN het begin (nooit de hele sleutel loggen) en waarschuwt met de
# weg naar een AIza-sleutel. ARTEMIS' .env staat in $ARTEMIS_MAP/.env.
sleutel_check() {
  local env="$ARTEMIS_MAP/.env" k
  [ -f "$env" ] || return 0
  k="$(sed -n 's/^GEMINI_API_KEY=//p' "$env" 2>/dev/null | head -1)"
  case "$k" in
    AIza*) : ;;   # goed
    "") zeg "LET OP: er staat geen Gemini-sleutel. Draai de installatieregel opnieuw; hij vraagt om een AIza-sleutel." ;;
    AQ.*|AQ*) zeg "LET OP: de Gemini-sleutel begint met 'AQ' -- die werkt NIET met ARTEMIS (401 'API key not valid')."
      zeg "Nodig: een klassieke 'AIza'-sleutel via console.cloud.google.com > APIs & Services > Library > 'Generative Language API' (Enable) > Credentials > Create credentials > API key."
      zeg "Draai daarna de installatieregel opnieuw; hij ziet de AQ-sleutel en vraagt om de nieuwe AIza-sleutel." ;;
    *) zeg "LET OP: de Gemini-sleutel begint niet met 'AIza'; controleer hem (ARTEMIS geeft anders 401)." ;;
  esac
}

status() {
  if artemis_draait; then
    local p poorten open_poort; p="$(cat "$PIDA" 2>/dev/null)"
    zeg "ARTEMIS draait (pid $p)."
    poorten="$(poorten_van "$p")"
    # 586: poorten_van kijkt in de PROCESGROEP van onze pid; ARTEMIS' echte server kan in een EIGEN sessie draaien en dan
    # valt hij buiten die groep ("GEEN poort") terwijl hij wel antwoordt. Spreek elkaar niet tegen: als iets op ARTEMIS_POORT
    # antwoordt, DAT is de poort. Geen "GEEN poort" meer zolang er iets antwoordt.
    open_poort=""
    if [ -n "$poorten" ]; then open_poort="$(printf '%s' "$poorten" | tr -d ' ' | cut -d, -f1)"; fi
    if antwoordt "$ARTEMIS_POORT"; then
      [ -n "$open_poort" ] || open_poort="$ARTEMIS_POORT"
      [ -n "$poorten" ] && zeg "Luistert op poort(en): $poorten" || zeg "Luistert op poort: $ARTEMIS_POORT (ARTEMIS antwoordt daar)."
      zeg "Open ARTEMIS op: http://localhost:$open_poort"
    elif [ -n "$poorten" ]; then
      zeg "Luistert op poort(en): $poorten"
      zeg "Open ARTEMIS op: http://localhost:$open_poort"
      zeg "(http://localhost:$ARTEMIS_POORT antwoordt nog niet -- gebruik de poort hierboven, of kijk bij Log.)"
    else
      zeg "Luistert nog op GEEN enkele poort en http://localhost:$ARTEMIS_POORT antwoordt niet -- hij start nog op (de eerste keer duurt het een paar minuten) of hij is gestopt. Kijk bij Log."
    fi
  elif [ -f "$REK_MAP/start-gestopt" ]; then
    # 583: na 3 mislukte starts stopte de lus met proberen -- zeg dat duidelijk in plaats van stil te blijven.
    zeg "ARTEMIS staat uit. $(cat "$REK_MAP/start-gestopt")"
  else
    zeg "ARTEMIS staat uit."
  fi
  if leeft "$PIDW"; then zeg "De waakhond kijkt mee."; fi
  zeg "Console (knoppen): http://localhost:$CONSOLE_POORT"
  zeg "Rektelefoons op de lijst: $(grep -c . "$TOEG" 2>/dev/null || echo 0)"
  sleutel_check   # 584: waarschuw als de Gemini-sleutel een AQ-sleutel is (401) i.p.v. een AIza-sleutel
  # 585/591/592: welk model gebruikt ARTEMIS? Primair + reserve uit onze config; Log toont welk model ECHT werd aangeroepen.
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    zeg "ARTEMIS denkt LOKAAL (592g): $(sed -n 's/^MODEL=//p' "$REK_MAP/lokaal-model.conf" | head -1) via $(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1) voor ELKE rol (planner, operator, checker, keurmeester); Gemini (gemini-3.8-flash) is alleen terugval. 'Lokaal uit' zet hem terug."
  elif [ -s "$REK_MAP/artemis.jsonc" ]; then
    zeg "ARTEMIS-model (onze config): primair $(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" | head -1), reserve $(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" | sed -n 2p) (gratis Gemini-laag; 'Lokaal model' laat ARTEMIS lokaal denken; Log toont welk model echt werd gebruikt)."
  fi
  schijf      # 580: altijd de vrije schijfruimte erbij -- een volle schijf is de reden dat ARTEMIS niet start
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

# 580: hoeveel ruimte is er, en is dat genoeg voor ARTEMIS? ARTEMIS heeft Node.js 22 (~150 MB), een Python-venv (~300-500 MB)
# en werkruimte nodig; reken op minstens ~2 GB vrij. Een volle Linux-schijf is GEEN netwerkfout -- vandaar deze meting in Status.
ARTEMIS_MIN_MB=2048
schijf() {
  zeg "== Schijfruimte =="
  zeg "Je Linux-map ($HOME):"; df -h "$HOME" 2>/dev/null | awk 'NR==1||NR==2{print "  " $0}'
  zeg "Hele schijf (/):"; df -h / 2>/dev/null | awk 'NR==1||NR==2{print "  " $0}'
  local vrij_kb vrij_mb
  vrij_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
  if [ -n "$vrij_kb" ] && [ "$vrij_kb" -eq "$vrij_kb" ] 2>/dev/null; then
    vrij_mb=$(( vrij_kb / 1024 ))
    zeg "Vrij op je Linux-map: ${vrij_mb} MB."
    if [ "$vrij_mb" -lt "$ARTEMIS_MIN_MB" ]; then
      zeg "LET OP: dit is te weinig. ARTEMIS heeft ongeveer ${ARTEMIS_MIN_MB} MB (2 GB) vrij nodig: Node.js 22, de Python-venv en werkruimte."
      zeg "Tik eerst op 'Ruim op'. Is er daarna nog steeds te weinig, maak dan de Linux-schijf groter:"
      zeg "ChromeOS > Instellingen > Over ChromeOS > Linux-ontwikkelomgeving > Schijfgrootte (zet hem op 10 GB of meer)."
    else
      zeg "Dit is genoeg voor ARTEMIS."
    fi
  fi
}

# 580: veilig opruimen bij een volle schijf. ALLEEN caches en mislukte downloads -- nooit de actieve venv, de ARTEMIS-code
# of iets van de gebruiker. Meet de vrije ruimte voor en na, en meldt hoeveel het scheelde.
# 588: zelfherstel -- vóór een (her)start eerst opruimen als de schijf te krap is voor Node/venv (de blokkade van 580). opruimen
# raakt ALLEEN caches en mislukte downloads (bewezen in de 585-check: nooit de venv, de code of bestanden van de gebruiker).
ruim_als_krap() {
  local vrij_kb vrij_mb
  vrij_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
  [ -n "$vrij_kb" ] && [ "$vrij_kb" -eq "$vrij_kb" ] 2>/dev/null || return 0
  vrij_mb=$(( vrij_kb / 1024 ))
  if [ "$vrij_mb" -lt "$ARTEMIS_MIN_MB" ]; then
    zeg "Schijf krap (${vrij_mb} MB < ${ARTEMIS_MIN_MB} MB) -- eerst opruimen voor de (her)start."
    opruimen >/dev/null 2>&1 || true
  fi
}
opruimen() {
  local voor na
  voor="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
  zeg "== Opruimen (alleen caches en mislukte downloads) =="
  # apt: de pakketcache en mislukte .deb's (o.a. de nodejs-22 die niet paste)
  if command -v apt-get >/dev/null 2>&1; then
    if sudo -n apt-get clean >/dev/null 2>&1; then zeg "- apt-pakketcache geleegd."; else zeg "- apt overslaan (geen sudo zonder wachtwoord)."; fi
    sudo -n sh -c 'rm -f /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/*.deb' >/dev/null 2>&1 \
      && zeg "- mislukte .deb-downloads (o.a. nodejs) weggehaald." || true
  fi
  # uv: de buildcache kan honderden MB zijn
  if command -v uv >/dev/null 2>&1; then
    uv cache prune >/dev/null 2>&1 && zeg "- uv-cache opgeschoond (prune)." || true
  fi
  # npm: de cache van Node
  [ -d "$HOME/.npm/_cacache" ] && { rm -rf "$HOME/.npm/_cacache" >/dev/null 2>&1 && zeg "- npm-cache weggehaald."; } || true
  # de rest van ~/.cache (pip, uv, thumbnails) -- veilig, wordt vanzelf opnieuw opgebouwd. NOOIT de ARTEMIS-map zelf.
  if [ -d "$HOME/.cache" ]; then
    find "$HOME/.cache" -mindepth 1 -maxdepth 1 ! -name 'artemis-rek' -exec rm -rf {} + >/dev/null 2>&1 || true
    zeg "- ~/.cache geleegd."
  fi
  # oude/mislukte venvs IN de ARTEMIS-map -- nooit de actieve .venv
  local v
  for v in "$REK_MAP"/.venv.oud "$REK_MAP"/.venv-mislukt "$REK_MAP"/.venv.*; do
    [ -e "$v" ] && [ "$v" != "$REK_MAP/.venv" ] && { rm -rf "$v" >/dev/null 2>&1 && zeg "- oude venv weg: $(basename "$v")"; } || true
  done
  na="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
  if [ -n "$voor" ] && [ -n "$na" ]; then
    zeg ""
    zeg "Vrijgemaakt: ongeveer $(( (na - voor) / 1024 )) MB."
  fi
  zeg ""
  schijf
}

# 571: bij start en console eerst zichzelf bijwerken vanaf de site, dan opnieuw starten met de nieuwe code (een keer, geen lus).
if { [ "${1:-}" = start ] || [ "${1:-}" = console ]; } && [ -z "${ARTEMIS_HERSTART:-}" ]; then
  zelf_bijwerken >/dev/null 2>&1 || true
  ARTEMIS_HERSTART=1 exec "$0" "$@"
fi
case "${1:-status}" in
  start) start ;;
  start-stil) start_stil ;;   # 583: door de console-lus; respecteert de pogingenteller (geen eindeloze herstart + tabs)
  stop) stop ;;
  console) console ;;
  autostart) autostart_installeren ;;
  scan) scan ;;
  jarvis-waak) jarvis_waak ;;   # 590: adb-waakhond -- JARVIS draaiend houden, batterij Onbeperkt, nieuwe versie installeren
  lokaal) lokaal ;;             # 592: ARTEMIS op een lokaal model zetten (OpenAI-compatibel op een rektelefoon), Gemini als terugval
  lokaal-uit) lokaal_uit ;;     # 592: terug naar Gemini-primair
  lokaal-meet) lokaal_meet ;;   # 592: meet of het lokale model antwoordt en hoe snel
  lokaal-auto) lokaal_auto ;;   # 592: de lus -- lokaal AANzetten zodra er een lokale server verschijnt (geen knop)
  schrijf-jsonc) schrijf_artemis_jsonc ;;   # 592: artemis.jsonc (her)schrijven -- door de installatie en lokaal/lokaal_uit
  overzicht) overzicht ;;
  vergeet) vergeet ;;
  bijwerken) bijwerken ;;
  zelf-bijwerken) bijwerken ;;   # 577: de oude console stuurt Bijwerken hierheen -> ook dan venv-rebuild + console-herstart
  zelf-bijwerken-stil) zelf_bijwerken >/dev/null 2>&1 || true ;;   # 587: de console-lus; ALLEEN ophalen (geen venv/herstart) -- herstart_als_nieuwer laadt de nieuwe code
  toestellen) toestellen ;;
  draadloos) draadloos ;;
  mcp) mcp ;;
  searxng) searxng ;;
  tailscale) tailscale_op ;;
  status) status ;;
  log) log ;;
  schijf) schijf ;;
  opruimen) opruimen ;;
  waakhond) waakhond ;;
  waak-een-keer) waakhond een ;;
  verboden) verboden "${2:-}" ;;
  *) zeg "Gebruik: artemis-rek console | start | stop | status | log | scan | bijwerken | toestellen | draadloos | mcp | searxng | tailscale" ;;
esac
REK
  chmod 755 "$bin/artemis-rek.nieuw"
  # Atomisch vervangen: een lopende artemis-rek (de console) houdt zijn oude inode en blijft heel; de VOLGENDE aanroep is nieuw.
  mv "$bin/artemis-rek.nieuw" "$bin/artemis-rek"
  # 592: artemis.jsonc via de ENE runtime-functie schrijven (lokaal-primair als lokaal-model.conf er is, anders Gemini-primair).
  REK_MAP="$rek" BIN_SELF="$bin" bash "$bin/artemis-rek" schrijf-jsonc >/dev/null 2>&1 || true
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
# 584: ARTEMIS heeft een KLASSIEKE "AIza..."-sleutel nodig. Google AI Studio maakt sinds kort alleen nog "AQ."-sleutels
# (authenticatie-tokens); die geven 401 ACCESS_TOKEN_TYPE_UNSUPPORTED en WERKEN NIET met ARTEMIS, ook niet met de nieuwste SDK.
# Daarom: vraag opnieuw zodra de opgeslagen sleutel GEEN AIza-sleutel is (ook als er al een AQ-sleutel staat), en wijs de
# weg naar een AIza-sleutel via de Google Cloud Console.
sleutel_uitleg() {
  zeg "ARTEMIS heeft een KLASSIEKE sleutel nodig die begint met 'AIza'."
  zeg "Let op: aistudio.google.com/apikey maakt tegenwoordig vaak een 'AQ.'-sleutel -- die WERKT NIET (401)."
  zeg "Maak een AIza-sleutel zo (gratis):"
  zeg "  1. Open console.cloud.google.com en kies/maak een project."
  zeg "  2. APIs & Services > Library > zoek 'Generative Language API' > Enable."
  zeg "  3. APIs & Services > Credentials > Create credentials > API key."
  zeg "  4. (aanrader) Edit API key > API restrictions > beperk tot 'Generative Language API'."
  zeg "  5. Kopieer de sleutel (begint met 'AIza') en plak hem hieronder."
}
HUIDIG="$(sed -n 's/^GEMINI_API_KEY=//p' "$ENV" 2>/dev/null | head -1)"
case "$HUIDIG" in
  AIza*) : ;;   # al een goede sleutel: met rust laten
  *)
    zeg ""
    case "$HUIDIG" in
      AQ.*|AQ*) zeg "De opgeslagen Gemini-sleutel begint met 'AQ' -- die werkt niet met ARTEMIS (401 'API key not valid'). Ik vraag om een AIza-sleutel." ;;
    esac
    sleutel_uitleg
    zeg "Je ziet niets terwijl je plakt; dat hoort zo. Druk daarna op Enter."
    SLEUTEL=""; POGING=0
    while :; do
      POGING=$((POGING+1))
      tty_lees SLEUTEL "AIza-sleutel: " stil
      SLEUTEL="${SLEUTEL//[$'\r\n ']/}"
      case "$SLEUTEL" in
        AIza*) break ;;
        "") if [ -n "$HUIDIG" ]; then zeg "Niets ingevuld; de bestaande sleutel blijft staan (die werkt mogelijk niet)."; SLEUTEL=""; break; fi
            zeg "Geen sleutel ingevuld. Draai deze regel later nog eens."; SLEUTEL=""; break ;;
        AQ.*|AQ*) if [ "$POGING" -ge 3 ]; then zeg "Nog steeds een AQ-sleutel; ik bewaar hem, maar ARTEMIS zal 401 geven tot er een AIza-sleutel staat."; break; fi
            zeg "Dat is weer een 'AQ'-sleutel; die werkt niet. Maak een AIza-sleutel via de Cloud Console (zie hierboven) en plak die, of druk Enter om te stoppen." ;;
        *) if [ "$POGING" -ge 3 ]; then zeg "Onbekend sleutelformaat; ik bewaar hem, maar controleer of hij met 'AIza' begint."; break; fi
            zeg "Een Gemini-sleutel begint normaal met 'AIza'. Controleer wat je kopieerde en plak opnieuw, of druk Enter om te stoppen." ;;
      esac
    done
    if [ -n "$SLEUTEL" ]; then zet_env GEMINI_API_KEY "$SLEUTEL"; zeg "Bewaard in $ENV (alleen jij kunt het lezen)."; fi
    unset SLEUTEL
    ;;
esac
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
zeg "Alles gaat nu via de console in Chrome: http://localhost:$CONSOLE_POORT"
zeg "Daar staan de knoppen Start, Stop, Status, Zoek telefoons en Bijwerken. De console draait voortaan vanzelf,"
zeg "werkt zichzelf bij vanaf de site, en zoekt elke minuut zelf nieuwe rektelefoons. Je hoeft hier niets meer te typen."
