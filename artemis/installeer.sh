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
  cat >"$bin/artemis-rek" <<'REK'
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
  [ -s "$TOEG" ] || { zeg "Er staat nog geen rektelefoon op de lijst. Eerst: artemis-rek toestellen"; return 1; }
  if leeft "$PIDA"; then zeg "ARTEMIS draait al: http://localhost:8000"; return 0; fi
  waak_ronde || return 1
  ( cd "$ARTEMIS_MAP" && setsid bash start.sh </dev/null >>"$REK_MAP/artemis.log" 2>&1 & echo $! >"$PIDA" )
  sleep 1
  ( setsid "$0" waakhond </dev/null >>"$LOG" 2>&1 & echo $! >"$PIDW" )
  zeg "ARTEMIS start (de eerste keer duurt het een paar minuten). Console: http://localhost:8000"
}

stop() {
  stop_artemis
  if leeft "$PIDW"; then kill "$(cat "$PIDW")" 2>/dev/null || true; fi
  rm -f "$PIDW"
  zeg "ARTEMIS staat uit."
}

status() {
  if leeft "$PIDA"; then zeg "ARTEMIS draait: http://localhost:8000"; else zeg "ARTEMIS staat uit."; fi
  if leeft "$PIDW"; then zeg "De waakhond kijkt mee."; fi
  zeg "Rektelefoons op de lijst: $(grep -c . "$TOEG" 2>/dev/null || echo 0)"
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx searxng; then zeg "SearXNG draait: http://127.0.0.1:8888 (JSON aan)"; fi
  if command -v tailscale >/dev/null 2>&1; then zeg "Tailscale: $(tailscale ip -4 2>/dev/null | head -1 || echo 'niet ingelogd')"; fi
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

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  toestellen) toestellen ;;
  draadloos) draadloos ;;
  mcp) mcp ;;
  searxng) searxng ;;
  tailscale) tailscale_op ;;
  status) status ;;
  waakhond) waakhond ;;
  waak-een-keer) waakhond een ;;
  verboden) verboden "${2:-}" ;;
  *) zeg "Gebruik: artemis-rek start | stop | toestellen | draadloos | mcp | searxng | tailscale | status" ;;
esac
REK
  chmod 755 "$bin/artemis-rek"
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

# ---- 5. De eigen bestanden en de toestellenlijst ----
schrijf_bestanden "$REK_MAP" "$BIN_MAP"
case ":$PATH:" in *":$BIN_MAP:"*) ;; *) printf '\nexport PATH="%s:$PATH"\n' "$BIN_MAP" >>"$HOME/.bashrc"; export PATH="$BIN_MAP:$PATH" ;; esac
zeg ""
zeg "Nu de rektelefoons. Sluit ze aan (kabel), deel ze met Linux en zet USB-foutopsporing aan."
zeg "Je dagelijkse telefoon NOOIT: daar zet je USB-foutopsporing niet aan, en die deel je niet met Linux."
"$BIN_MAP/artemis-rek" toestellen || true
zeg ""
# De PATH-regel hierboven staat in ~/.bashrc, maar de TERMINAL die dit script startte kent 'artemis-rek' pas na een verse
# shell. Daarom: zeg het met zoveel woorden. (We doen geen 'exec bash' VANUIT het script -- dat zou dit script onderbreken.)
if command -v artemis-rek >/dev/null 2>&1; then
  zeg "Klaar. Starten: artemis-rek start   (console: http://localhost:8000)"
else
  zeg "Klaar. Typ eerst EEN keer:   exec bash"
  zeg "(dan kent de terminal het commando 'artemis-rek'; een nieuw terminalvenster openen kan ook.)"
  zeg "Daarna: artemis-rek start   (console: http://localhost:8000)"
fi
