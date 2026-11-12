#!/usr/bin/env bash
# installeer.sh -- ARTEMIS (Google, Apache 2.0) op de Linux-kant van de Chromebook, zodat Claude de REKTELEFOONS kan besturen
# via de webconsole op http://penguin.linux.test:8765 (618: op ChromeOS bereik je de Linux-VM NIET via localhost; 581: WEG van 8000, want ARTEMIS wil 8000 zelf). Een keer plakken in de Linux-terminal:
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
# Daarna: `artemis-rek start` (console op http://penguin.linux.test:8765), `artemis-rek stop`, `artemis-rek toestellen`,
# `artemis-rek draadloos`, `artemis-rek status`.
ARTEMIS_EINDEREGEL=1   # 678: bovenaan verklaard: dit bestand eindigt op '# EINDE-ARTEMIS-SCRIPT'; zelf_bijwerken weigert een download zonder die regel (afgekapt)
set -euo pipefail

ARTEMIS_REPO="https://github.com/google/artemis"
ARTEMIS_VERSIE="351ca8422f7b5b54e80a9c1ce03a222e02415b6b"   # nagekeken op 25 oktober 2026; een nieuwere = eerst nakijken
ARTEMIS_MAP="${ARTEMIS_MAP:-$HOME/artemis}"
REK_MAP="${REK_MAP:-$HOME/.artemis-rek}"
BIN_MAP="${BIN_MAP:-$HOME/.local/bin}"
# 583b: ook in de INSTALLER-body nodig (de slotmelding noemt de console-poort). CONSOLE_POORT zat alleen in het GEGENEREERDE
# artemis-rek, dus gaf de slotregel "unbound variable" onder set -u. Zelfde standaard als daar (581: console op 8765).
CONSOLE_POORT="${ARTEMIS_CONSOLE_POORT:-8765}"
KBHOST="${ARTEMIS_KB_HOST:-penguin.linux.test}"   # 618: in Chrome op ChromeOS bereik je de Linux-VM via penguin.linux.test, niet via localhost

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
  # 673: de VASTE §499-JARVIS-serverlink (.../jarvis-app/<code>). Verloopt niet, over internet bereikbaar ook op het gastnet.
  # Komt EEN keer mee in de installatieregel (ARTEMIS_APK_LINK) en blijft in een runtime-bestand -- NOOIT in de code (de code is
  # een HMAC van een geheime sleutel). Zo haalt ARTEMIS de nieuwste jarvis.apk vanzelf op als geen telefoon hem nog heeft, en hoeft
  # er niets met de hand gedownload te worden. Alleen deze ene link-vorm wordt bewaard; elke andere waarde valt weg.
  if [ -n "${ARTEMIS_APK_LINK:-}" ] && printf '%s' "$ARTEMIS_APK_LINK" | grep -Eq '^https://[a-z0-9.-]{3,253}/jarvis-app/[a-z2-9]{10}$'; then printf '%s\n' "$ARTEMIS_APK_LINK" >"$rek/apk-link"; chmod 600 "$rek/apk-link"; fi
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
# 678g: de eigen (crypto)programma's van de eigenaar worden NOOIT verplaatst, opgeruimd of aangeraakt (besluit 8 nov: "oude
# cryptoprogramma's laat je in de staat die ze zijn"). Vaste uitsluitlijst op mapnaam (basename). beschermd_pad() is de ENE poort;
# opruimen, kaart_verhuis en de schijfmeting gaan er allemaal langs. Nooit een pad hieruit verplaatsen/wissen, ook niet als het groot is.
BESCHERMD=".zcash-params verus .verus .zcash .komodo .hush zcash-params komodo"
beschermd_pad() {   # waar: de map (of een ouder ervan) hoort bij de eigen programma's van de eigenaar -- afblijven
  local p="$1" naam w
  for w in $BESCHERMD; do
    case "$p" in *"/$w"|*"/$w/"*) return 0 ;; esac
  done
  return 1
}
# 678c/678d: de SD-kaart van de Chromebook voor GROTE, verplaatsbare dingen (apk-downloads, uv/pip/npm-caches, ARTEMIS-traces/logs,
# modelbestanden, de kennisboek-kopie), zodat de kleine Crostini-schijf ("het hokje", vaak maar 10 GB) niet volloopt en ARTEMIS wel
# start. ChromeOS mount een met Linux gedeeld kaartje onder /mnt/chromeos/removable/<label>; het label is niet altijd UNTITLED, dus
# we VINDEN de kaart zelf. Het kaartje is exFAT/FAT: GEEN symlinks of rechten erop -- daarom blijven de venv en node_modules ALTIJD in
# het hokje (symlinks/+x); alleen gewone grote bestanden gaan naar de kaart. SLEUTELS/TOKENS gaan NOOIT naar de kaart (je kunt hem eruit halen).
kaart_vinden() {   # het pad van een met Linux gedeelde, schrijfbare verwijderbare kaart (ARTEMIS_KAART wint); leeg als er geen is.
  if [ -n "${ARTEMIS_KAART:-}" ] && [ -d "$ARTEMIS_KAART" ] && [ -w "$ARTEMIS_KAART" ]; then printf '%s' "${ARTEMIS_KAART%/}"; return 0; fi
  local d; for d in /mnt/chromeos/removable/*/ /media/removable/*/; do
    [ -d "$d" ] && [ -w "$d" ] || continue; printf '%s' "${d%/}"; return 0
  done; return 1
}
ARTEMIS_KAART="$(kaart_vinden 2>/dev/null || true)"
op_kaart() { [ -n "$ARTEMIS_KAART" ] && [ -d "$ARTEMIS_KAART" ] && [ -w "$ARTEMIS_KAART" ]; }
groot_plek() {   # een schrijfbare map voor grote bestanden: de kaart als die er is, anders intern. Maakt de map aan en echoot het pad.
  local p; if op_kaart; then p="$ARTEMIS_KAART/artemis-opslag"; else p="$REK_MAP/opslag"; fi
  mkdir -p "$p" 2>/dev/null || { p="$REK_MAP/opslag"; mkdir -p "$p" 2>/dev/null || true; }
  printf '%s' "$p"
}
# 678f: HET 9p-KAARTJE (ChromeOS-share, FAT/exFAT) KAN GEEN file-locks, atomische rename of chmod ('Operation not permitted').
# Daarom MOETEN uv/pip/npm-caches (locks + atomische rename) EN de venv/node_modules (symlinks/+x) IN HET HOKJE blijven. Op de kaart
# alleen GEWONE bestanden die je schrijft en daarna leest: APK-downloads, modellen, traces, kopieen. Er gaat dus GEEN cache naar de
# kaart meer -- dat gaf 'uv: Could not acquire lock ... Operation not permitted'. Caches blijven op hun gewone plek in het hokje en
# worden daar gesnoeid (opruimen/ruim_als_krap, 588).
kaart_cache_env() { :; }   # 678f: leeg -- GEEN cache-redirect naar de kaart (de kaart kan geen locks/rename). Alleen hier gelaten zodat oude aanroepen niet breken.
# kaart_verhuis doet nu twee dingen: (1) REPAREER de schade van 678d -- een cache/app die als symlink naar de kaart wijst wordt
# teruggedraaid, zodat uv/pip/npm weer een ECHTE map in het hokje maken en niet meer op de kaart proberen te locken; (2) verplaats
# alleen INERTE, write-once DATA (de kennisboek-kopie, oude traces) naar de kaart. NOOIT caches, venv, node_modules of levende app-state.
kaart_verhuis() {
  # (1) altijd: een cache/app-symlink naar de kaart terugdraaien (ook zonder kaart bruikbaar -- het repareert een eerder kapotgezette telefoon)
  local l
  for l in "$HOME/.cache/uv" "$HOME/.cache/pip" "$HOME/.npm" "$HOME/.cache/xdg" "$(artemis_app_dir)"; do
    [ -L "$l" ] || continue
    if rm -f "$l" 2>/dev/null; then zeg "  - cache/app terug in het hokje (de kaart kan geen locks/rename): $l"; fi
  done
  op_kaart || return 0
  # (2) alleen inerte data naar de kaart; symlink terug IN HET HOKJE (ext4-symlink mag naar de kaart wijzen, de kaart krijgt nooit een symlink)
  local doel; doel="$(groot_plek)"; local paar
  for paar in "$REK_MAP/kennisboek:kennisboek" "$REK_MAP/traces:traces"; do
    local src="${paar%%:*}"
    local sub="${paar#*:}"
    local dst="$doel/$sub"
    case "$src" in *.venv*|*node_modules*|*/.cache/*|*/.npm*) continue ;; esac   # nooit caches/venv/node
    beschermd_pad "$src" && continue                                              # 678g: nooit de eigen (crypto)programma's van de eigenaar
    [ -d "$src" ] && [ ! -L "$src" ] || continue                                  # een echte map, nog geen symlink
    mkdir -p "$(dirname "$dst")" 2>/dev/null || continue
    if cp -r "$src/." "$dst/" 2>/dev/null && rm -rf "$src" 2>/dev/null; then ln -s "$dst" "$src" 2>/dev/null || true; zeg "  - inerte data naar de kaart (hokje vrijgemaakt): $src"; fi
  done
}
JAPK_PLEK="$(groot_plek)"
TOEG="$REK_MAP/toegestaan"
VERB="$REK_MAP/verboden-apps.txt"
LOG="$REK_MAP/waakhond.log"
JARVIS_PKG="nl.eigen.jarvis"   # 590: het ENIGE pakket dat de JARVIS-waakhond ooit aanraakt (nooit bank/betaal/wachtwoord/authenticator)
LOKAAL_POORT="${ARTEMIS_LOKAAL_POORT:-8791}"   # 592: lokale poort op deze computer die via adb naar het model op een rektelefoon wijst
# 592h: een kleine VERTAAL- EN VANGNET-proxy tussen ARTEMIS en het lokale model (OlliteRT/Gemma). Gemma geeft een actie terug
# als TEKST ("call:click{target: 'NOODSTOP'}", JS-achtige args) i.p.v. een echte OpenAI-tool_call -> ARTEMIS' tekst-parser liep
# daarop vast. De proxy zet die tekst om naar een STRUCTURELE tool_call (valide JSON-args), EN blokkeert gevaarlijke acties
# (NOODSTOP/Stop/Verwijder/Delete/Uninstall-knoppen, bank-/kluis-/authenticator-/betaal-/crypto-apps), EN laat in de
# alleen-kijken-stand alleen Home door. ARTEMIS praat met de proxy; de proxy praat met het model.
PROXY_POORT="${ARTEMIS_PROXY_POORT:-8792}"
PROXYF="$REK_MAP/artemis-proxy.py"
PROXY_PIDF="$REK_MAP/proxy.pid"
PROXY_LOG="$REK_MAP/proxy-blok.log"              # waar de proxy geblokkeerde acties noteert (Log/Status tonen dit)
ALLEEN_KIJKEN_F="$REK_MAP/alleen-kijken"         # bestaat = alleen-kijken-stand (alleen Home mag); de console-knop zet hem
ACTIEF_F="$REK_MAP/proxy-actief"                 # 592L: welk model antwoordde het laatst (Status leest dit)
REDEN_F="$REK_MAP/proxy-reden"                   # 592o: de laatste echte reden van een mislukt/geblokkeerd verzoek (Status leest dit)
# 678 (11 nov, eigenaar 17:41): GEMINI IS HET ENIGE DAT GELD KOST OF OP EEN LIMIET LOOPT. Daarom: standaard UIT, alleen de ALLERLAATSTE terugval, alleen met een
# AI Studio-sleutel (AIza...) zonder Vertex/projectgegevens, een lage dagteller, en bij een 429 of 503 NIET herhalen maar stoppen en terug naar lokaal.
# De vlag is een BESTAND (afwezig = uit): de enige manier om Gemini aan te zetten is de knop in de console of `artemis-rek gemini-aan`.
GEM_AAN_F="$REK_MAP/gemini-aan"; GEM_DAG_F="$REK_MAP/gemini-dag"; GEM_STOP_F="$REK_MAP/gemini-stop"
GEMINI_MAX_DAG="${GEMINI_MAX_DAG:-20}"
F8_GEVONDEN_F="$REK_MAP/f8-gevonden.conf"        # 592p: het teruggevonden LAN-adres van de F8 (na een IP-wissel); Status leest dit
DRAADLOOS_F="$REK_MAP/draadloos"                 # 596: onthouden draadloze adb-adressen (ip:5555) zodat de minuut-scan ze na een herstart weer verbindt
KLAAR_F="$REK_MAP/klaargezet"                    # 667d: toestel-id's die al VOLLEDIG zijn klaargezet (telefoon_klaarzetten), zodat de auto-lus ze niet opnieuw doet
BIJWERK_GEDAAN=''                                # 678m: gezet door jarvis_bijwerk_een zodra een telefoon ECHT een nieuwe JARVIS kreeg; dan zet klaarzetten er daarna Tailscale op
KLAAR_LOCK="$REK_MAP/klaarzetten.lock"           # 667d: lock zodat de auto-klaarzet-lus niet twee keer tegelijk draait
SCAN5555_T="$REK_MAP/scan5555.t"                 # 606: tijdstip van de laatste subnet-scan op poort 5555 (rem: eens per ~180 s)
TS_BRUG_F="$REK_MAP/tailscale-bruggen"           # 678: socat-bruggen (lport 100.x pid) zodat adb de rektelefoons op hun VASTE 100.x bereikt, over elk netwerk
TS_BRUG_T="$REK_MAP/tailscale-brug.t"            # 678: tijdstip van de laatste Tailscale-adb-ronde (rem: eens per ~300 s in de minuut-scan)
LAN_SUBNETTEN_F="$REK_MAP/lan-subnetten"         # 608: onthouden /24-prefixen waar ooit een telefoon te vinden was (beide wifi's), zodat de F8/rek na een wifi-wissel vanzelf terugkomt
PIDA="$REK_MAP/artemis.pid"
PIDW="$REK_MAP/waakhond.pid"
BRONF="$REK_MAP/bron"
AANF="$REK_MAP/aan"           # 571: de GEWENSTE stand (ARTEMIS aan). De console-lus houdt ARTEMIS aan zolang dit bestand er is.
CONSOLE_POORT="${ARTEMIS_CONSOLE_POORT:-8765}"   # onze knoppen-console (Veronica/Claude openen die). 581: WEG van 8000 -- ARTEMIS wil 8000 zelf
ARTEMIS_POORT="${ARTEMIS_POORT:-8000}"           # 581: ARTEMIS HOUDT zijn eigen 8000 (hij negeerde onze poort-envs en pakte 8000); de console wijkt uit naar 8765
# 618: de host waarmee je de console/ARTEMIS IN CHROME opent. Op ChromeOS bereikt de browser de Linux-VM NIET via localhost
# (dat is ChromeOS zelf), maar via penguin.linux.test (de vaste Crostini-hostnaam). Binnen de VM blijft curl localhost gebruiken.
KBHOST="${ARTEMIS_KB_HOST:-penguin.linux.test}"
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
  verbind_draadloos   # 596: onthouden draadloze telefoons weer verbinden (na een herstart van de telefoon)
  rek_verbind_lijst >/dev/null 2>&1 || true   # 620: eerst de telefoons die zichzelf aan de relay melden (ip:5555), nooit de F8; leeg = geen effect
  rek_via_tailscale_rem   # 678: de rektelefoons op hun vaste 100.x via Tailscale (socat/tailscale nc), hoogstens eens per 300 s; best-effort
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
  onthoud_wifi_adb   # 599: onthoud de huidige draadloze endpoints zodat ze na een drop vanzelf terugkomen
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
  local base tmp code rc poging=0 klaar=0 fout="" grootte; base="$(cat "$BRONF")"; tmp="$(mktemp)" || return 1
  # 586: toon de HTTP-code, zodat je ziet WAAROM het niet lukt (000 = geen internet/site weg, 404 = verkeerd adres).
  zeg "Bijwerken 1/4: script ophalen van $base/artemis/installeer.sh ..."
  # 605: cache-buster + no-cache-koppen. GitHub Pages (Fastly) cachet een bestand ~10 min; ZONDER dit kreeg de zelf-bijwerker een
  # OUDE installeer.sh terug en bleef een nieuwe versie (bv. §604) uren weg, ook na 'Bijwerken'. Een unieke query (?nc=<epoch>) plus
  # Cache-Control: no-cache dwingt een VERSE kopie af, zodat een nieuwe versie altijd vanzelf binnenkomt.
  # 678 (12 nov): "geen geldige bash" bij een bestand dat WEL geldig is (435 KB): curl -m 30 brak midden in de overdracht af terwijl -w nog http 200 meldde, dus een
  # AFGEKAPT bestand. Nu: gecomprimeerd ophalen (--compressed, veel kleiner), 90 s, het curl-resultaat zelf controleren, en tot DRIE pogingen; een afgekapt bestand
  # herken je aan het ontbreken van de eindregel. Het mislukte bestand blijft in $REK_MAP/bijwerken-mislukt.sh (600) om de oorzaak te zien. Pas een bestand dat bash
  # leest EN de eindregel draagt (of een oudere versie zonder eindregel-afspraak die wel bash leest) wordt gebruikt.
  while [ "$poging" -lt "${BIJWERK_POGINGEN:-3}" ] && [ "$klaar" = 0 ]; do
    poging=$((poging + 1))
    code="$(curl -fsSL --compressed --retry "${BIJWERK_RETRY:-1}" --retry-delay 2 -m "${BIJWERK_TIMEOUT:-90}" -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' -w '%{http_code}' "$base/artemis/installeer.sh?nc=$(date +%s)-$poging" -o "$tmp" 2>/dev/null)"; rc=$?; code="${code:-000}"
    if [ "$rc" -ne 0 ] || [ "$code" != "200" ] || [ ! -s "$tmp" ]; then fout="ophalen mislukte (http $code, curl $rc)"; sleep 2; continue; fi
    grootte="$(wc -c <"$tmp" 2>/dev/null | tr -d ' ')"
    if ! bash -n "$tmp" 2>/dev/null; then fout="het bestand ($grootte bytes) is geen geldige bash -- waarschijnlijk afgekapt"; cp "$tmp" "$REK_MAP/bijwerken-mislukt.sh" 2>/dev/null && chmod 600 "$REK_MAP/bijwerken-mislukt.sh" 2>/dev/null; sleep 2; continue; fi
    if grep -q 'ARTEMIS_EINDEREGEL=1' "$tmp" && ! tail -n 3 "$tmp" | grep -q '^# EINDE-ARTEMIS-SCRIPT$'; then fout="de eindregel ontbreekt ($grootte bytes) -- afgekapt"; cp "$tmp" "$REK_MAP/bijwerken-mislukt.sh" 2>/dev/null && chmod 600 "$REK_MAP/bijwerken-mislukt.sh" 2>/dev/null; sleep 2; continue; fi
    klaar=1
  done
  if [ "$klaar" != 1 ]; then zeg "Bijwerken: het opgehaalde script is niet bruikbaar na $poging pogingen ($fout); niets veranderd. Probeer het zo nog eens, liefst op een snelle verbinding."; rm -f "$tmp"; return 1; fi
  if ! grep -q 'artemis-rek' "$tmp" || ! grep -q 'ARTEMIS_REPO=' "$tmp"; then zeg "Bijwerken: het opgehaalde script lijkt niet op ARTEMIS; niets veranderd."; rm -f "$tmp"; return 1; fi
  if ARTEMIS_BRON="$base" bash "$tmp" --alleen-bestanden "$REK_MAP" "$BIN_SELF" >/dev/null 2>&1; then
    logregel "Bijgewerkt vanaf de site (http $code)."
    # 592g: herschrijf artemis.jsonc met de ZOJUIST opgehaalde generator (zelfherstel is de standaard). Zo landt een nieuw
    # config-formaat -- bv. elke rol lokaal i.p.v. alleen de default -- VANZELF op een al draaiende Chromebook, zonder dat
    # iemand opnieuw 'Lokaal model' hoeft te tikken. schrijf-jsonc is puur een bestand schrijven (geen start/venv/herstart).
    REK_MAP="$REK_MAP" BIN_SELF="$BIN_SELF" bash "$BIN_SELF" schrijf-jsonc >/dev/null 2>&1 || true
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
  zeg "De console draait nu op http://$KBHOST:$CONSOLE_POORT (618: in Chrome op ChromeOS via penguin.linux.test, NIET localhost). Open die in Chrome; de oude op 8000 werkt niet meer."
}

# 576/577: de Bijwerken-knop. Werkt het script bij, bouwt de venv opnieuw op (3.12, met compiler-vangnet), en herstart de console
# zodat de nieuwe code (zoals de Log-knop) meteen zichtbaar is. 577: ook de OUDE console-route (die Bijwerken naar `zelf-bijwerken`
# stuurde) komt hier terecht, zodat de venv-rebuild en de herstart ook dan gebeuren.
bijwerken() {
  zeg "== Bijwerken gestart $(date '+%H:%M:%S') =="
  # 678 (12 nov): de console herstarten stopt ook ARTEMIS (SIGTERM, zelfde cgroup). Stond ARTEMIS aan (draaide hij, of was de gewenste stand "aan"), dan zetten we de
  # gewenste stand na de herstart WEER aan en wissen we de pogingenteller: de console-lus start hem dan vanzelf opnieuw, zonder dat iemand Stop+Start hoeft te tikken.
  local was_aan=0; { artemis_draait || [ -f "$AANF" ]; } 2>/dev/null && was_aan=1
  zelf_bijwerken || zeg "Het script bijwerken ging niet door; ik ga wel verder met de venv en de console."
  zeg "Bijwerken 3/4: de Python-venv nalopen (3.12) ..."
  zorg_venv forceer
  zeg "Bijwerken 4/4: de console herstarten op poort $CONSOLE_POORT ..."
  herstart_console
  if [ "$was_aan" = 1 ]; then
    touch "$AANF" 2>/dev/null || true; chmod 600 "$AANF" 2>/dev/null || true
    rm -f "$REK_MAP/start-pogingen" "$REK_MAP/start-gestopt" 2>/dev/null || true
    zeg "ARTEMIS stond aan; de console start hem na de herstart vanzelf weer (binnen een minuut, met vangnet-proxy)."
  fi
  zeg "== Bijwerken klaar. Doe nu: Stop, dan Start, dan een taak. (De console draait op http://$KBHOST:$CONSOLE_POORT.) =="
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
RestartSec=1
[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user enable --now artemis-rek.service >/dev/null 2>&1 || true
  if ! grep -q 'artemis-rek console' "$prof" 2>/dev/null; then
    printf '\n# ARTEMIS-rek console vanzelf starten (terugval als systemd --user er niet is)\npgrep -f "artemis-rek console" >/dev/null 2>&1 || setsid %s/artemis-rek console </dev/null >>%s/console.log 2>&1 &\n' "$BIN_SELF" "$REK_MAP" >>"$prof"
  fi
  zeg "Autostart aangezet: de console draait voortaan vanzelf (http://$KBHOST:$CONSOLE_POORT)."
}

# 571/618: DE KNOPPEN-CONSOLE op http://$KBHOST:CONSOLE_POORT (bindt alle interfaces van de VM; op ChromeOS bereikt de browser
# de VM via penguin.linux.test, niet via localhost -- host-only netwerk met alleen de Chromebook). Hier doet Claude in Chrome alles wat vroeger een
# terminalopdracht was: Start, Stop, Status, Zoek telefoons (scan), Bijwerken. Een achtergrondlus zoekt elke minuut zelf nieuwe
# rektelefoons en houdt ARTEMIS aan zolang de gewenste stand "aan" is. Geen vrije invoer: alleen een vaste lijst opdrachten.
console() {
  command -v python3 >/dev/null 2>&1 || { zeg "python3 ontbreekt; de console kan niet starten."; return 1; }
  # 623e: zet cryptography vast op de achtergrond klaar (de relay-reader heeft hem nodig), zodat de eerste "Relay-lijst lezen"
  # niet op een eenmalige venv-bouw hoeft te wachten. Nooit blokkerend; op de voorgrond heelt de reader zichzelf ook nog.
  ( rek_zorg_crypto >/dev/null 2>&1 & ) 2>/dev/null || true
  # 583: de poortwissel naar 8765 moet ook werken als een OUDE console nog op 8000 hangt (bv. na een Linux-herstart met de
  # nieuwe code). Deze nieuwe console draait op 8765; als ARTEMIS niet draait en er hangt nog iets van ons op de ARTEMIS-poort
  # (8000), stop dat dan, zodat ARTEMIS die poort kan pakken. Veilig: alleen als ARTEMIS niet al draait.
  if declare -f artemis_draait >/dev/null 2>&1 && ! artemis_draait; then
    local q; for q in $(pids_op_poort "$ARTEMIS_POORT" 2>/dev/null); do kill "$q" 2>/dev/null || true; done
  fi
  AREK="$BIN_SELF/artemis-rek" POORT="$CONSOLE_POORT" ARTEMIS_POORT="$ARTEMIS_POORT" REK_MAP="$REK_MAP" MIN_MB="$ARTEMIS_MIN_MB" KB_HOST="$KBHOST" python3 - <<'PY'
import os, subprocess, threading, time, html, urllib.parse, hashlib, re, json, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
AREK = os.environ.get('AREK', 'artemis-rek'); POORT = int(os.environ.get('POORT', '8765')); REK = os.environ.get('REK_MAP', '')
KB = os.environ.get('KB_HOST', 'penguin.linux.test')   # 665: de host waarmee je de console IN CHROME opent (618: NIET localhost)
MIN_MB = int(os.environ.get('MIN_MB', '2048'))   # 588: ARTEMIS heeft ~2 GB nodig (Node/venv); zie ARTEMIS_MIN_MB
TOEGESTAAN = {'gemini-wissel', 'start', 'stop', 'status', 'scan', 'bijwerken', 'vergeet', 'log', 'opruimen', 'jarvis-waak', 'lokaal', 'lokaal-uit', 'lokaal-meet', 'motor-meet', 'alleen-kijken', 'alleen-kijken-uit', 'cat-kijk', 'cat-ruim', 'duraspeed-uit', 'hardware', 'motor-zoek', 'f8-kabel', 'scherm-lees', 'versies', 'rek-zoek', 'draadloos-auto', 'kabel-koppel', 'klaarzetten', 'rek-hotspot', 'rek-op', 'rek-lijst', 'rek-diag', 'beheerder', 'tailscale-telefoon', 'tailscale-authkey', 'tailscale', 'rek-tailscale', 'meetuitslag', 'wifi-hotspot-test', 'kennisboek-kijk', 'kennisboek-deel', 'kennisboek-terug', 'voortgang', 'voortgang-controle', 'meet-hervat', 'motor-status', 'duurtest-start', 'duurtest-stop', 'duurtest-uitslag', 'duurtest-tik'}
# 575: start en bijwerken kunnen minuten duren (ARTEMIS start op, adb-ronde). Die blokkeren de knop NIET:
# ze draaien op de achtergrond naar een eigen logbestand; de knop komt meteen terug, en Status/Log tonen hoe het ging.
LOPEND = {'meet-hervat', 'start', 'bijwerken', 'rek-op', 'kabel-koppel', 'klaarzetten', 'klaarzetten-auto', 'tailscale-telefoon', 'tailscale-authkey', 'tailscale', 'rek-tailscale', 'motor-meet', 'beheerder'}   # 578b/676/677/678: ook Rek opbouwen, Koppel via de kabel, Tailscale, de beheerder EN Snelheid meten op de achtergrond (anders 25 s AbortError) -- motor-meet haalt een 382 MB-model op en meet minuten; dat duurt veel langer dan de ~25 s fetch-time-out van de pagina. Nu meteen terug + via Log/Status (console-motor-meet.log) te volgen.
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
def doe_args(args, timeout=20):
    # 602: artemis-rek met ARGUMENTEN draaien (de schermenwand: schermenwand/schermfoto/wand-tik/...). Alleen tekst terug.
    try:
        r = subprocess.run([AREK] + list(args), capture_output=True, text=True, timeout=timeout)
        return (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return 'GEWEIGERD duurde te lang'
    except Exception as e:
        return 'GEWEIGERD ' + str(e)
WAND_SERIAL = re.compile(r'^[A-Za-z0-9_.:-]{1,64}$')   # 602: een adb-serial/endpoint; geen spaties/argument-injectie naar adb
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
            doe('klaarzetten-auto')   # 667d: een nieuwe rektelefoon aan de kabel vanzelf volledig klaarzetten (nooit de F8), geen knop nodig
            doe('start-stil')
            if RONDE % 3 == 0:
                doe('jarvis-waak')   # 590: elke ~3 min JARVIS nakijken op de rektelefoons (nooit de F8)
            if RONDE % 2 == 1:
                doe('beheerder')   # 675: de lokale beheerder -- elke ~2 min kijken of alle rektelefoons verbonden zijn, een weggevallene zelf terughalen, anders de eigenaar vragen
            if RONDE % 15 == 7:
                doe('lokaal-auto')   # 592: lokaal model AANzetten zodra er een lokale server verschijnt ("standaard AAN")
            if RONDE % 10 == 2:
                doe('meet-hervat')   # 678: een onderbroken Snelheid-meten-lezer na een console-herstart weer oppakken
            if RONDE % 5 == 1:
                doe('duurtest-tik')   # 678: de duurtest (alleen als hij aan staat; anders meteen klaar)
            if RONDE % 5 == 3:
                doe('voortgang-controle')   # 678 (12 nov): kijkt of er langer dan 30 minuten niets gepusht is (stil; melding hoogstens eens per uur)
            if RONDE % 180 == 45:
                doe('beheerder-opslag')   # 609: de lokale beheerder -- elke ~3 uur de opslag van de rektelefoons bewaken + veilig opruimen (nooit de F8)
            if RONDE % 180 == 120:
                doe('kennisboek-kopie')   # 165: elke ~3 uur proberen; de kopie zelf gebeurt hoogstens één keer per dag (idempotent)
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
<button data-cmd=motor-status>Motor en spraak: status</button><button data-cmd=duurtest-start>Duurtest start (24 u)</button><button data-cmd=duurtest-uitslag>Duurtest-uitslag</button><button data-cmd=duurtest-stop>Duurtest stop</button><button data-cmd=voortgang>Voortgang</button><button data-cmd=gemini-wissel>Gemini: uit/aan</button><button data-cmd=scan>Zoek telefoons</button><button data-cmd=beheerder>Beheerder: rek nakijken + herstellen</button><button data-cmd=jarvis-waak>JARVIS nakijken</button><button data-cmd=lokaal>Lokaal model</button><button data-cmd=lokaal-uit>Lokaal uit</button><button data-cmd=alleen-kijken>Alleen kijken: aan</button><button data-cmd=alleen-kijken-uit>Alleen kijken: uit</button><button data-cmd=cat-kijk>Cat: kijken</button><button data-cmd=cat-ruim>Cat: opruimen</button><button data-cmd=duraspeed-uit>DuraSpeed uit</button><button data-cmd=kennisboek-kijk>Kennisboek: kijken</button><button data-cmd=kennisboek-deel>Kennisboek: delen</button><button data-cmd=kennisboek-terug>Kennisboek: terugzetten</button><button data-cmd=hardware>Hardware per telefoon</button><button data-cmd=motor-meet>Snelheid meten (llama-bench)</button><button data-cmd=meetuitslag>Meetuitslag</button><button data-cmd=motor-zoek>F8 terugvinden</button><button data-cmd=f8-kabel>F8-adres via de kabel (alleen lezen)</button><button data-cmd=scherm-lees>Scherm als tekst lezen</button><button data-cmd=versies>JARVIS-versie per telefoon</button><button data-cmd=rek-zoek>Rektelefoons koppelen</button><button data-cmd=rek-op>Rek opbouwen</button><button data-cmd=rek-lijst>Relay-lijst lezen</button><button data-cmd=rek-diag>Relay: waarom leeg?</button><button data-cmd=rek-hotspot>Eigen rek-netwerk (hotspot, voor later)</button><button data-cmd=tailscale>Tailscale op deze Chromebook (inloggen)</button><button data-cmd=tailscale-telefoon>Tailscale op de telefoons (kabel)</button><button data-cmd=rek-tailscale>Rek via Tailscale (overal bereikbaar)</button><button data-cmd=wifi-hotspot-test>Wifi+hotspot tegelijk? (lezen)</button><button data-cmd=draadloos-auto>Draadloos maken</button><button data-cmd=kabel-koppel>Koppel via de kabel (blijft draadloos)</button><button data-cmd=klaarzetten>Telefoon klaarzetten (aan de kabel)</button><button data-cmd=vergeet>Vergeet overgeslagen</button><button data-cmd=bijwerken>Bijwerken</button><button data-cmd=opruimen>Ruim op</button><button data-cmd=log>Log</button></div>
<p><a href="/wand" target=_blank><b>&#128241; Schermenwand</b></a> &mdash; de schermen van de rektelefoons draadloos naast elkaar, kijken en bedienen (nooit de F8, nooit bank-/kluis-apps).</p>
<p><a href="/gezond" target=_blank><b>&#9989; Status in platte tekst</b></a> &mdash; console, ARTEMIS, de poort en de wand-telefoons in een keer leesbaar (geen ververste pagina). Open deze console altijd via <b>penguin.linux.test</b>, NIET via localhost.</p>
<p>ARTEMIS zelf opent op de poort die <b>Status</b> noemt (onze gok is <a href="http://penguin.linux.test:{ap}" target=_blank>penguin.linux.test:{ap}</a>, maar de echte poort kan afwijken). Start duurt de eerste keer een paar minuten; druk daarna op Status.</p>
<p style="margin-top:14px">Relay-onderwerp (eenmalig): zo leest ARTEMIS zelf welke telefoons op het huis-wifi staan &mdash; geen hotspot meer nodig. Kopieer het uit Veronica bij Instellingen (begint met &quot;jv&quot;).<br>
<input id=onderwerp type=text autocomplete=off spellcheck=false placeholder="jv..." style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<button id=onderwerpBewaar>Bewaar relay-onderwerp</button></p>
<p style="margin-top:6px">Relay-adres (eenmalig, alleen op een gastnetwerk nodig): op het gastnetwerk melden de telefoons zich via de relay i.p.v. ntfy.sh. Zonder dit adres blijft de relay-lijst leeg. Kopieer het uit Veronica bij Instellingen, Relay (eindigt op &quot;.workers.dev&quot;).<br>
<input id=relayAdres type=text autocomplete=off spellcheck=false placeholder="https://...workers.dev" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<button id=relayAdresBewaar>Bewaar relay-adres</button></p>
<p style="margin-top:6px">APK-link (eenmalig, voor een telefoon met een oude JARVIS): zo haalt ARTEMIS de nieuwste JARVIS-apk zelf van de server &mdash; geen token, geen handmatige download. Plak de downloadlink uit de bijwerk-mail (de link naar &quot;jarvis.apk&quot;), de &quot;LRWERK1&quot;-pakket-link uit diezelfde mail (daaruit lees ik de vaste, niet-verlopende serverlink), of de vaste serverlink zelf (.../jarvis-app/&lt;code&gt;). Een Gmail-verpakking (www.google.com/url?q=...) mag; die haal ik er zelf af.<br>
<input id=apkLink type=text autocomplete=off spellcheck=false placeholder="https://.../jarvis-app/..." style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<button id=apkLinkBewaar>Bewaar APK-link</button></p>
<p style="margin-top:6px">Tailscale-sleutel (eenmalig): de herbruikbare auth-key uit de Tailscale-admin (begint met &quot;tskey-&quot;). Hiermee zet ARTEMIS Tailscale op de rektelefoons zonder een tik. De sleutel blijft ALLEEN hier op de Chromebook (600) &mdash; nooit in het log, GitHub, de relay of Veronica.<br>
<input id=tailscaleKey type=text autocomplete=off spellcheck=false placeholder="tskey-..." style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<button id=tailscaleKeyBewaar>Bewaar Tailscale-sleutel</button>
<button data-cmd=tailscale-authkey>Tailscale op de telefoons (auth-key, zonder tik)</button></p>
<p style="margin-top:6px">Wifi van deze plek (eenmalig): zo geeft ARTEMIS een nieuwe rektelefoon zelf het wifi (en daarna de relay/Tailscale). SSID + wachtwoord blijven ALLEEN hier op de Chromebook (600) &mdash; nooit in het log, GitHub, de relay of Veronica. Dan is een nieuwe telefoon: kabel erin, USB-foutopsporing aan, verder niets.<br>
<input id=wifiSsid type=text autocomplete=off spellcheck=false placeholder="wifi-naam (SSID)" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:200px;min-height:48px">
<input id=wifiWw type=password autocomplete=off spellcheck=false placeholder="wifi-wachtwoord" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:200px;min-height:48px">
<button id=wifiBewaar>Bewaar wifi van deze plek</button></p>
<p style="margin-top:6px">Meet-links (voor &quot;Snelheid meten&quot;): plak de llama-bench-link (de presigned link die Claude geeft, 7 dagen geldig). Het meetmodel hoeft NIET: ARTEMIS haalt Qwen3 0.6B zelf van Hugging Face naar de SD-kaart. Beide blijven ALLEEN hier (600). Laat een veld leeg om het niet te wijzigen.<br>
<input id=benchLink type=text autocomplete=off spellcheck=false placeholder="llama-bench-link (https://...)" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<input id=modelLink type=text autocomplete=off spellcheck=false placeholder="meetmodel-link (optioneel, laat leeg)" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<button id=meetLinksBewaar>Bewaar meet-links</button></p>
<p style="margin-top:6px">Voortgang (laat de console nakijken of het bouwwerk doorgaat): zet een bron per regel als <code>eigenaar/repo tak</code>; de Pages-repo staat er vanzelf in. Voor een privé-repo een token met ALLEEN leesrecht. Beide blijven alleen hier (600); laat een veld leeg om het niet te wijzigen.<br>
<input id=vgBron type=text autocomplete=off spellcheck=false placeholder="eigenaar/repo tak (toevoegen)" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<input id=vgToken type=password autocomplete=off spellcheck=false placeholder="leestoken (privé-repo, optioneel)" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:260px;min-height:48px">
<button id=vgBewaar>Bewaar voortgang</button></p>
<p style="margin-top:6px">Rij-code (laat ARTEMIS de EIGEN motor van een rektelefoon op poort 8081 gebruiken als lokaal model; staat alleen hier, 600): <input id=rijCode type=password autocomplete=off spellcheck=false placeholder="rij-code" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #233;background:#0a0f1e;color:#e8ecf5;min-width:200px;min-height:48px"> <button id=rijBewaar>Bewaar rij-code</button></p>
<pre id=uit>Klaar. Kies een knop.</pre>
<pre id=meetUit hidden></pre>
<p style="margin:8px 0 2px;color:#8aa">Live (Log/Status vernieuwen hier, zonder je knop-uitkomst te overschrijven):</p>
<pre id=live style="opacity:.85"></pre>
<script>
// 586: elke knop geeft ALTIJD een zichtbaar, getimed antwoord en de pagina hangt nooit (AbortController-timeout). Bijwerken en
// Start draaien op de achtergrond; daarna halen we vanzelf Log en Status op zodat je de voortgang ziet zonder nog een klik.
// 675: de UITKOMST van een knop blijft in #uit staan; de automatische Log/Status-opvolging schrijft naar #live, zodat hij de
// knop-uitkomst NIET meer binnen seconden overschrijft (klacht van vanochtend). Een mens-klik op Log/Status schrijft wel naar #uit.
const uit=document.getElementById('uit');
const live=document.getElementById('live');
function nu(){{return new Date().toLocaleTimeString();}}
async function doe(c,naar){{
  // 678 (12 nov): Meetuitslag krijgt een EIGEN vak dat de automatische Status-verversing (en een herladen na een console-herstart) nooit overschrijft; de laatste uitslag blijft bewaard in deze tab.
  const vak=(naar==='live')?live:(c==='meetuitslag'?document.getElementById('meetUit'):uit);
  if(c==='meetuitslag'){{vak.hidden=false;}}
  vak.textContent=nu()+' — bezig: '+c+'…';
  const ac=new AbortController();const t=setTimeout(()=>ac.abort(),25000);
  try{{
    const r=await fetch('/doe?cmd='+encodeURIComponent(c),{{method:'POST',signal:ac.signal}});
    clearTimeout(t);
    vak.textContent=nu()+' — '+c+':\\n'+(await r.text());
    if(c==='meetuitslag'){{try{{sessionStorage.setItem('meetuitslag',vak.textContent);}}catch(e){{}}}}
    if(c==='bijwerken'||c==='start'||c==='rek-op'||c==='kabel-koppel'||c==='klaarzetten'||c==='beheerder'||c==='tailscale-telefoon'||c==='tailscale'){{setTimeout(()=>doe('log','live'),7000);setTimeout(()=>doe('status','live'),20000);}}
  }}catch(e){{
    clearTimeout(t);
    vak.textContent=nu()+' — '+c+': de console antwoordt nog niet (hij start soms heel even opnieuw na Bijwerken). Druk zo op Log of Status. ('+e+')';
  }}
}}
for(const b of document.querySelectorAll('button[data-cmd]'))b.addEventListener('click',()=>doe(b.dataset.cmd));
// 620: het relay-onderwerp bewaren (het ENIGE vrije veld; strikt gevalideerd op de server). Daarna leest ARTEMIS de relay-lijst.
const obw=document.getElementById('onderwerpBewaar');
if(obw)obw.addEventListener('click',async()=>{{
  const v=(document.getElementById('onderwerp').value||'').trim();
  uit.textContent=nu()+' — relay-onderwerp bewaren…';
  try{{
    const r=await fetch('/onderwerp',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'onderwerp='+encodeURIComponent(v)}});
    uit.textContent=nu()+' — '+(await r.text());
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
// 623: het relay-adres bewaren (het TWEEDE vrije veld; strikt gevalideerd op ".workers.dev"). Alleen op een gastnetwerk nodig --
// dan melden de telefoons zich via de relay i.p.v. ntfy.sh, en zonder dit adres blijft de relay-lijst leeg.
const rbw=document.getElementById('relayAdresBewaar');
if(rbw)rbw.addEventListener('click',async()=>{{
  const v=(document.getElementById('relayAdres').value||'').trim();
  uit.textContent=nu()+' — relay-adres bewaren…';
  try{{
    const r=await fetch('/relay-adres',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'relay='+encodeURIComponent(v)}});
    uit.textContent=nu()+' — '+(await r.text());
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
// 678k: de §499 APK-link bewaren (derde vrije veld; strikt gevalideerd op .../jarvis-app/<code>). Zo haalt ARTEMIS de nieuwste
// JARVIS-apk zelf van de server -- geen token nodig -- zodat een telefoon met een oude JARVIS kan worden bijgewerkt zonder de eigenaar.
const abw=document.getElementById('apkLinkBewaar');
if(abw)abw.addEventListener('click',async()=>{{
  const v=(document.getElementById('apkLink').value||'').trim();
  uit.textContent=nu()+' — APK-link bewaren…';
  try{{
    const r=await fetch('/apk-link',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'link='+encodeURIComponent(v)}});
    uit.textContent=nu()+' — '+(await r.text());
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
// 678 stap 1: de Tailscale-sleutel bewaren (alleen lokaal op de Chromebook, 600; nooit in het log/GitHub/relay/Veronica).
const tbw=document.getElementById('tailscaleKeyBewaar');
if(tbw)tbw.addEventListener('click',async()=>{{
  const v=(document.getElementById('tailscaleKey').value||'').trim();
  uit.textContent=nu()+' — Tailscale-sleutel bewaren…';
  try{{
    const r=await fetch('/tailscale-key',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'key='+encodeURIComponent(v)}});
    uit.textContent=nu()+' — '+(await r.text());
    const el=document.getElementById('tailscaleKey'); if(el)el.value='';
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
// 678: de wifi van deze plek bewaren (alleen lokaal op de Chromebook, 600; nooit in het log/GitHub/relay/Veronica).
const wbw=document.getElementById('wifiBewaar');
if(wbw)wbw.addEventListener('click',async()=>{{
  const ssid=(document.getElementById('wifiSsid').value||'').trim();
  const ww=(document.getElementById('wifiWw').value||'');
  uit.textContent=nu()+' — wifi van deze plek bewaren…';
  try{{
    const r=await fetch('/wifi',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'ssid='+encodeURIComponent(ssid)+'&ww='+encodeURIComponent(ww)}});
    uit.textContent=nu()+' — '+(await r.text());
    const w=document.getElementById('wifiWw'); if(w)w.value='';
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
// 678: de meet-links bewaren (llama-bench + optioneel meetmodel), alleen lokaal op de Chromebook (600). Een leeg veld = niet wijzigen.
const rjb=document.getElementById('rijBewaar');
if(rjb)rjb.addEventListener('click',async()=>{{
  const code=(document.getElementById('rijCode').value||'').trim();
  uit.textContent=nu()+' — rij-code bewaren…';
  try{{
    const r=await fetch('/rij-code',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'code='+encodeURIComponent(code)}});
    uit.textContent=nu()+' — '+(await r.text());
    document.getElementById('rijCode').value='';
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
const vgb=document.getElementById('vgBewaar');
if(vgb)vgb.addEventListener('click',async()=>{{
  const bron=(document.getElementById('vgBron').value||'').trim();
  const token=(document.getElementById('vgToken').value||'').trim();
  uit.textContent=nu()+' — voortgang bewaren…';
  try{{
    const r=await fetch('/voortgang-bron',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'bron='+encodeURIComponent(bron)+'&token='+encodeURIComponent(token)}});
    uit.textContent=nu()+' — '+(await r.text());
    document.getElementById('vgToken').value='';
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
const mbw=document.getElementById('meetLinksBewaar');
if(mbw)mbw.addEventListener('click',async()=>{{
  const bench=(document.getElementById('benchLink').value||'').trim();
  const model=(document.getElementById('modelLink').value||'').trim();
  uit.textContent=nu()+' — meet-links bewaren…';
  try{{
    const r=await fetch('/meet-links',{{method:'POST',headers:{{'Content-Type':'application/x-www-form-urlencoded'}},body:'bench='+encodeURIComponent(bench)+'&model='+encodeURIComponent(model)}});
    uit.textContent=nu()+' — '+(await r.text());
  }}catch(e){{uit.textContent=nu()+' — kon het niet bewaren ('+e+')';}}
}});
// 613: bij een zelf-herstart (Bijwerken) is de console ~1 s weg. Dit HERGEBRUIKT HETZELFDE tabblad: zodra de console terug is
// laadt deze pagina zichzelf opnieuw -- geen nieuw tabblad, geen dode pagina. We openen NOOIT zelf een tab.
let _consoleWeg=false;
setInterval(()=>{{fetch('/',{{method:'HEAD',cache:'no-store'}}).then(()=>{{if(_consoleWeg)location.reload();}}).catch(()=>{{_consoleWeg=true;}});}},3000);
try{{const m=sessionStorage.getItem('meetuitslag');if(m){{const v=document.getElementById('meetUit');v.textContent=m;v.hidden=false;}}}}catch(e){{}}
doe('status');
</script></main></body></html>"""
# 602: DE SCHERMENWAND -- de schermen van de rektelefoons draadloos naast elkaar, kijken en bedienen. Alle veiligheid zit in de
# shell (wand_gate: nooit de F8, alleen op de lijst, nooit bij een gevoelige/persoonlijke app) en de noodstop; deze pagina toont
# alleen en stuurt tikken door. 127.0.0.1-only, net als de rest van de console. Geen namen, geen opslag.
WAND_PAGINA = """<!doctype html><html lang=nl><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Schermenwand</title><style>
body{font-family:system-ui,sans-serif;margin:0;background:#0b1020;color:#e8ecf5;font-size:18px}
header{position:sticky;top:0;z-index:5;padding:12px 16px;background:#141b33;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
h1{font-size:20px;margin:0 auto 0 0}
button{font-size:18px;padding:12px 16px;border:0;border-radius:10px;background:#2b3a67;color:#fff;cursor:pointer;min-height:48px;min-width:48px}
#noodstop{background:#b4231f;font-weight:700}#hervat{background:#1f6f3a}
#wand{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;padding:16px}
.tegel{background:#141b33;border:1px solid #233;border-radius:12px;overflow:hidden}
.tnaam{padding:8px 10px;font-weight:600}
.tbeeld{width:100%;display:block;background:#000;cursor:crosshair;touch-action:none}
.treden{padding:14px;color:#ffd27d}
.tknop{display:flex;gap:6px;padding:8px}
.tklein{font-size:16px;padding:10px;flex:1}
.ttyp{flex:2;min-width:0;font-size:16px;padding:10px;border-radius:8px;border:1px solid #334;background:#0a0f1e;color:#e8ecf5}
.tgroot{font-size:16px;padding:10px;flex:1;background:#1f6f3a}
#melding{padding:0 16px;color:#9fb0d0}
/* 615b: de grote, LIVE weergave van een rektelefoon (MJPEG-stroom), met bedienen */
#groot{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.92);display:none;flex-direction:column}
#groot.aan{display:flex}
#grootKop{display:flex;gap:8px;align-items:center;padding:10px 14px;background:#141b33;flex-wrap:wrap}
#grootKop .gnaam{font-weight:600;margin-right:auto}
#grootDicht{background:#b4231f;font-weight:700}
#grootBeeld{flex:1;min-height:0;width:100%;object-fit:contain;background:#000;cursor:crosshair;touch-action:none}
#grootTyprij{display:flex;gap:6px;padding:8px 14px;background:#141b33}
#grootTyp{flex:1;min-width:0;font-size:16px;padding:10px;border-radius:8px;border:1px solid #334;background:#0a0f1e;color:#e8ecf5}
</style></head><body>
<header><h1>Schermenwand &mdash; de rektelefoons</h1>
<button id=noodstop>NOODSTOP</button><button id=hervat>Hervat besturen</button><button id=ververs>Ververs</button></header>
<div style="padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
<input id=zoekveld type=text placeholder="Eén vraag -> elke telefoon een andere zoekmachine" autocomplete=off style="flex:1;min-width:220px;font-size:16px;padding:10px;border-radius:8px;border:1px solid #334">
<button id=zoekallen>Zoek op alle telefoons</button></div>
<div style="padding:0 16px 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
<input id=doelveld type=text placeholder="ARTEMIS op tekst: zeg wat het model moet doen (bijv. 'open de instellingen')" autocomplete=off style="flex:1;min-width:220px;font-size:16px;padding:10px;border-radius:8px;border:1px solid #334">
<button id=doelknop>Doe op tekst</button></div>
<p id=melding>De schermen komen eraan&hellip; (nooit de F8; nooit een telefoon met een bank-, kluis- of betaalapp op de voorgrond.)</p>
<div id=wand></div>
<div id=groot><div id=grootKop><span class=gnaam></span>
<button data-gk=terug>Terug</button><button data-gk=thuis>Home</button><button data-gk=apps>Apps</button>
<button id=grootDicht>Sluiten</button></div>
<img id=grootBeeld alt="">
<div id=grootTyprij><input id=grootTyp type=text placeholder="typ hier (bijv. een zoekterm)" autocomplete=off><button id=grootTypKnop>Typ</button></div></div>
<script>
const wand=document.getElementById('wand'),melding=document.getElementById('melding');
const tegels=new Map();   // serial -> {el, img, reden}
async function post(f){const b=new URLSearchParams(f);try{const r=await fetch('/wand-doe',{method:'POST',body:b});return await r.text();}catch(e){return 'niet gelukt';}}
// 678q: ARTEMIS op tekst -- het lokale model kiest een element uit de schermlijst en ARTEMIS tikt het aan (door de §565-gate,
// nooit de F8). Leeg serial = de eerste rektelefoon. Het kan even duren (model + maximaal een paar stappen); de uitslag komt in de melding.
const doelknop=document.getElementById('doelknop');
if(doelknop)doelknop.addEventListener('click',async()=>{const v=document.getElementById('doelveld');const d=(v.value||'').trim();if(!d)return;doelknop.disabled=true;melding.textContent='ARTEMIS op tekst bezig (het model kiest, ARTEMIS tikt)…';const r=await post({wat:'doe',doel:d});melding.textContent=r;doelknop.disabled=false;});
function maakTegel(t){
  const el=document.createElement('div');el.className='tegel';
  el.innerHTML='<div class=tnaam></div><img class=tbeeld alt=""><div class=treden hidden></div>'+
    '<div class=tknop><button class="tklein" data-k=terug>Terug</button><button class="tklein" data-k=thuis>Home</button><button class="tklein" data-k=apps>Apps</button></div>'+
    '<div class=tknop><button class="tgroot">Groot + bedienen (live)</button></div>'+
    '<div class=tknop><input class=ttyp type=text placeholder="typ hier (bijv. een zoekterm)" autocomplete=off><button class="tklein ttypknop">Typ</button></div>';
  el.querySelector('.tnaam').textContent=t.naam||'Telefoon';
  const img=el.querySelector('.tbeeld'),reden=el.querySelector('.treden'),typ=el.querySelector('.ttyp');
  img.addEventListener('pointerdown',(ev)=>{ev.preventDefault();const x=ev.offsetX/(img.clientWidth||1),y=ev.offsetY/(img.clientHeight||1);post({wat:'tik',serial:t.serial,x:x.toFixed(4),y:y.toFixed(4)});});
  for(const b of el.querySelectorAll('.tknop .tklein[data-k]'))b.addEventListener('click',()=>post({wat:'toets',serial:t.serial,toets:b.dataset.k}));
  el.querySelector('.tgroot').addEventListener('click',()=>openGroot(t.serial,t.naam||'Telefoon'));
  const typDoe=async()=>{if(!typ.value)return;const r=await post({wat:'typ',serial:t.serial,tekst:typ.value});if(r==='ok')typ.value='';else melding.textContent=r;};
  el.querySelector('.ttypknop').addEventListener('click',typDoe);
  typ.addEventListener('keydown',(e)=>{if(e.key==='Enter')typDoe();});
  wand.appendChild(el);const rec={el,img,reden};tegels.set(t.serial,rec);return rec;
}
async function fotoVan(serial,rec){
  if(grootOpen&&serial===grootSerial)return;   // 615b: de live-stroom heeft die telefoon; niet tegelijk de tegel verversen (race op dezelfde PNG)
  try{
    const r=await fetch('/wand-foto?serial='+encodeURIComponent(serial)+'&t='+Date.now());
    if(r.ok){const b=await r.blob();rec.img.src=URL.createObjectURL(b);rec.img.hidden=false;rec.reden.hidden=true;setTimeout(()=>URL.revokeObjectURL(rec.img.src),8000);}
    else{rec.reden.textContent=await r.text();rec.reden.hidden=false;rec.img.hidden=true;}
  }catch(e){rec.reden.textContent='geen verbinding met de telefoon';rec.reden.hidden=false;rec.img.hidden=true;}
}
async function lijst(){
  let l=[];try{l=await (await fetch('/wand-lijst')).json();}catch(e){}
  if(!l.length){melding.textContent='Geen rektelefoon op de wand. Koppel ze in de console (Zoek telefoons / Koppel via de kabel). De F8 staat er nooit bij.';}
  else{melding.textContent=l.length+' rektelefoon(s). Tik op een scherm om te tikken; de knoppen eronder zijn Terug/Home/Apps.';}
  const nu=new Set(l.map(t=>t.serial));
  for(const [s,rec] of tegels)if(!nu.has(s)){rec.el.remove();tegels.delete(s);}
  for(const t of l){const rec=tegels.get(t.serial)||maakTegel(t);fotoVan(t.serial,rec);}
}
// 615b: de grote, LIVE weergave (MJPEG-stroom) + bedienen. Hoogstens EEN tegelijk open.
let grootSerial=null,grootOpen=false;
const groot=document.getElementById('groot'),grootBeeld=document.getElementById('grootBeeld'),grootTyp=document.getElementById('grootTyp');
function openGroot(serial,naam){
  grootSerial=serial;grootOpen=true;
  groot.querySelector('.gnaam').textContent=naam+' — live';
  grootBeeld.src='/wand-stroom?serial='+encodeURIComponent(serial)+'&t='+Date.now();
  groot.classList.add('aan');
}
function sluitGroot(){grootBeeld.src='';groot.classList.remove('aan');grootOpen=false;grootSerial=null;}
document.getElementById('grootDicht').addEventListener('click',sluitGroot);
grootBeeld.addEventListener('pointerdown',(ev)=>{if(!grootSerial)return;ev.preventDefault();const x=ev.offsetX/(grootBeeld.clientWidth||1),y=ev.offsetY/(grootBeeld.clientHeight||1);post({wat:'tik',serial:grootSerial,x:x.toFixed(4),y:y.toFixed(4)});});
grootBeeld.addEventListener('error',()=>{if(grootOpen)melding.textContent='De live-weergave stopte (telefoon weg of een gevoelige app op de voorgrond).';});
for(const b of groot.querySelectorAll('[data-gk]'))b.addEventListener('click',()=>{if(grootSerial)post({wat:'toets',serial:grootSerial,toets:b.dataset.gk});});
const grootTypDoe=async()=>{if(!grootSerial||!grootTyp.value)return;const r=await post({wat:'typ',serial:grootSerial,tekst:grootTyp.value});if(r==='ok')grootTyp.value='';else melding.textContent=r;};
document.getElementById('grootTypKnop').addEventListener('click',grootTypDoe);
grootTyp.addEventListener('keydown',(e)=>{if(e.key==='Enter')grootTypDoe();});
document.getElementById('noodstop').addEventListener('click',async()=>{melding.textContent=await post({wat:'noodstop'});});
document.getElementById('hervat').addEventListener('click',async()=>{melding.textContent=await post({wat:'hervat'});});
document.getElementById('ververs').addEventListener('click',lijst);
const zoekveld=document.getElementById('zoekveld'),zoekallen=document.getElementById('zoekallen');
async function zoekAllen(){const v=(zoekveld.value||'').trim();if(!v){melding.textContent='Typ eerst een zoekvraag.';return;}zoekallen.disabled=true;melding.textContent='Elke telefoon opent een andere zoekmachine…';try{melding.textContent=await post({wat:'zoek-allen',vraag:v});}finally{zoekallen.disabled=false;}}
zoekallen.addEventListener('click',zoekAllen);
zoekveld.addEventListener('keydown',(e)=>{if(e.key==='Enter')zoekAllen();});
lijst();setInterval(lijst,15000);setInterval(()=>{for(const [s,rec] of tegels)fotoVan(s,rec);},3000);
</script></body></html>"""
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
    def _cors_json(self, code, body):
        b = body.encode('utf-8'); self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        self._cors(204, '')
    def do_GET(self):
        p = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(p.query)
        if p.path in ('/', '/index.html'):
            self._schrijf(200, PAGINA.format(ap=int(os.environ.get('ARTEMIS_POORT', '8000'))), 'text/html; charset=utf-8')
        elif p.path == '/rek.json':
            # 678 punt 22: alleen LEZEN -- welke rektelefoons ARTEMIS nu ziet (kabel/wifi/Tailscale), voor de lijst in Veronica.
            t = doe_args(['rek-aanwezig'], 45)
            self._cors_json(200, t if t.startswith('[') else '[]')
        elif p.path == '/status.json':
            aan = os.path.exists(os.path.join(REK, 'artemis.pid'))
            self._schrijf(200, '{"console":true,"artemis":%s}' % ('true' if aan else 'false'), 'application/json')
        elif p.path == '/gezond':
            # 665: EEN-SHOT leesbare status in PLATTE TEKST (geen polling, geen stroom), zodat de Claude-extensie en een mens
            # de staat in een keer kunnen LEZEN. De /wand-pagina ververst zichzelf en laat zich daardoor slecht uitlezen; deze
            # pagina niet. Belangrijkste eerst: de JUISTE host (618: penguin.linux.test, NIET localhost).
            ap = os.environ.get('ARTEMIS_POORT', '8000')
            aan = os.path.exists(os.path.join(REK, 'artemis.pid'))
            wandjson = doe_args(['schermenwand'])
            try:
                wl = json.loads(wandjson) if wandjson.strip().startswith('[') else []
            except Exception:
                wl = []
            namen = ', '.join([str((t.get('naam') or t.get('serial') or '?')) for t in wl]) if wl else '(geen)'
            regels = [
                'ARTEMIS-rek console: DRAAIT (je leest dit, dus de console antwoordt).',
                'Open in Chrome op ChromeOS via http://%s:%d/ -- NIET via localhost (618: de Linux-VM is daar geen localhost).' % (KB, POORT),
                'ARTEMIS zelf: %s; gok-poort %s -> http://%s:%s/ (de echte poort kan afwijken; druk op Status).' % (('gestart' if aan else 'NIET gestart -- druk op Start'), ap, KB, ap),
                'Schermenwand: %d rektelefoon(s) klaar: %s. (De F8 en bank-/kluis-apps staan er nooit bij.)' % (len(wl), namen),
                'Wand openen: http://%s:%d/wand -- kijken mag altijd, tikken pas na de aan-knop.' % (KB, POORT),
                'Logboek: ~/.artemis-rek/console.log en artemis.log; de knop Log toont de laatste regels.',
            ]
            self._schrijf(200, '\n'.join(regels) + '\n')
        elif p.path == '/wand':
            self._schrijf(200, WAND_PAGINA, 'text/html; charset=utf-8')
        elif p.path == '/wand-lijst':
            # 602: welke rektelefoons horen nu op de wand (JSON uit de shell; de F8 en niet-toegestane toestellen zitten er nooit in).
            uit = doe_args(['schermenwand'])
            self._schrijf(200, uit if uit.strip().startswith('[') else '[]', 'application/json')
        elif p.path == '/wand-foto':
            # 602: één schermfoto van één rektelefoon. De shell weigert (GEWEIGERD + reden) bij de F8, een niet-toegestane telefoon,
            # of een gevoelige/persoonlijke app op de voorgrond -- dan 409 met de reden, nooit een beeld.
            s = (q.get('serial', [''])[0])
            if not WAND_SERIAL.match(s): self._schrijf(400, 'onbruikbare telefoon'); return
            uit = doe_args(['schermfoto', s]).strip()
            if uit.startswith('GEWEIGERD') or not uit or not os.path.isfile(uit):
                self._schrijf(409, uit or 'geen beeld'); return
            try:
                with open(uit, 'rb') as fh: beeld = fh.read()
                self.send_response(200); self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(beeld))); self.send_header('Cache-Control', 'no-store')
                self.end_headers(); self.wfile.write(beeld)
            except Exception:
                self._schrijf(409, 'beeld niet leesbaar')
        elif p.path == '/wand-stroom':
            # 615b: ECHT LIVE beeld van EEN rektelefoon als MJPEG-stroom (multipart/x-mixed-replace met PNG-frames). Pure python,
            # geen scrcpy/node: elk frame is een `schermfoto` (adb exec-out screencap), en die gaat ELKE keer door wand_gate --
            # dus nooit de F8, nooit een niet-toegestane telefoon, en zodra een gevoelige/persoonlijke app op de voorgrond komt
            # STOPT de stroom meteen (geen beeld meer). ~2,5 fps; dat is ruim genoeg om zoekresultaten mee te lezen. Lokaal
            # adb-verkeer (geen internet), dus geen gastnet-budget. ThreadingHTTPServer -> deze lange verbinding blokkeert de
            # console niet. Hoogstens EEN tegelijk open (de pagina opent er maar een), met een harde bovengrens in tijd.
            s = (q.get('serial', [''])[0])
            if not WAND_SERIAL.match(s): self._schrijf(400, 'onbruikbare telefoon'); return
            import time as _t
            grens = 'artemiswandframe'
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=%s' % grens)
            self.send_header('Cache-Control', 'no-store'); self.send_header('Connection', 'close')
            self.end_headers()
            eind = _t.time() + 600   # een stroom leeft hoogstens 10 minuten; de pagina heropent hem vanzelf als je blijft kijken
            try:
                while _t.time() < eind:
                    uit = doe_args(['schermfoto', s]).strip()
                    if uit.startswith('GEWEIGERD') or not uit or not os.path.isfile(uit):
                        break   # gevoelige app op de voorgrond, F8, of telefoon weg -> de stroom stopt (de pagina toont dan de reden)
                    try:
                        with open(uit, 'rb') as fh: beeld = fh.read()
                    except Exception:
                        _t.sleep(0.4); continue
                    try:
                        self.wfile.write(('--%s\r\nContent-Type: image/png\r\nContent-Length: %d\r\n\r\n' % (grens, len(beeld))).encode('ascii'))
                        self.wfile.write(beeld); self.wfile.write(b'\r\n'); self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break   # de kijker heeft de grote weergave gesloten
                    _t.sleep(0.4)
            except Exception:
                pass
            return
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
        if p.path == '/wand-doe':
            # 602: de schermenwand bestuurt een rektelefoon (tik/veeg/toets/noodstop/hervat). De SHELL (wand_besturen) doet de
            # §565-zeef (nooit de F8, alleen op de lijst, nooit bij een gevoelige/persoonlijke app) EN de noodstop; hier alleen
            # doorgeven, met een serial die aan een veilig patroon voldoet (geen argument-injectie naar adb).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            wat = (f.get('wat', [''])[0])
            if wat == 'noodstop': self._cors(200, doe_args(['wand-noodstop'])); return
            if wat == 'hervat': self._cors(200, doe_args(['wand-hervat'])); return
            if wat == 'zoek-allen': self._cors(200, doe_args(['wand-zoek', f.get('vraag', [''])[0]], timeout=40)); return   # 615: elke telefoon een andere zoekmachine
            if wat == 'tik-allen': self._cors(200, doe_args(['wand-tik-allen', f.get('x', ['0'])[0], f.get('y', ['0'])[0]])); return   # 615: tik naar alle telefoons tegelijk
            if wat == 'doe':   # 678 stap 8: ARTEMIS op tekst -- het lokale model kiest, ARTEMIS tikt (serial optioneel; leeg = de eerste rektelefoon aan de kabel)
                sd = (f.get('serial', [''])[0])
                if sd and not WAND_SERIAL.match(sd): self._cors(400, 'onbruikbare telefoon'); return
                self._cors(200, doe_args(['scherm-doe', f.get('doel', [''])[0], sd], timeout=180)); return
            s = (f.get('serial', [''])[0])
            if not WAND_SERIAL.match(s): self._cors(400, 'onbruikbare telefoon'); return
            if wat == 'tik': self._cors(200, doe_args(['wand-tik', s, f.get('x', ['0'])[0], f.get('y', ['0'])[0]])); return
            if wat == 'veeg': self._cors(200, doe_args(['wand-veeg', s, f.get('x', ['0'])[0], f.get('y', ['0'])[0], f.get('x2', ['0'])[0], f.get('y2', ['0'])[0], f.get('ms', ['250'])[0]])); return
            if wat == 'toets' and f.get('toets', [''])[0] in ('terug', 'thuis', 'apps'): self._cors(200, doe_args(['wand-toets', s, f['toets'][0]])); return
            if wat == 'typ': self._cors(200, doe_args(['wand-typ', s, f.get('tekst', [''])[0]])); return
            self._cors(400, 'onbekende besturing'); return
        if p.path == '/onderwerp':
            # 620: het ENIGE vrije-invoerveld van de console, en strikt gevalideerd: het geheime relay-/ntfy-onderwerp (jv + 30
            # kleine letters/cijfers), zodat ARTEMIS de hartslag-lijst van de telefoons kan lezen. Geen opdracht, een config-waarde.
            # Veronica toont dit onderwerp bij Instellingen; de eigenaar plakt het hier één keer. Leeg = wissen (terug naar scannen).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            o = (f.get('onderwerp', [''])[0]).strip()
            pad = os.path.join(REK, 'rek-onderwerp.conf')
            if o == '':
                try: os.remove(pad)
                except Exception: pass
                self._schrijf(200, 'Relay-onderwerp gewist. ARTEMIS zoekt de telefoons weer door te scannen.'); return
            if not re.match(r'^jv[a-z0-9]{30}$', o):
                self._schrijf(400, 'Dat lijkt geen relay-onderwerp. Het begint met "jv" en is 32 tekens (kleine letters en cijfers). Kopieer het uit Veronica bij Instellingen.'); return
            try:
                with open(pad, 'w') as fh: fh.write(o + '\n')
                try: os.chmod(pad, 0o600)
                except Exception: pass
                self._schrijf(200, 'Relay-onderwerp opgeslagen. Druk nu op "Relay-lijst lezen" of "Rek opbouwen"; ARTEMIS leest nu zelf welke telefoons op het huis-wifi staan.')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/relay-adres':
            # 623: het TWEEDE config-veld van de console (naast het onderwerp), en net zo strikt gevalideerd: het workers.dev-adres
            # van de relay. OP HET GASTNETWERK posten de telefoons hun hartslag NAAR DE RELAY (de vaste route, §548), niet naar
            # ntfy.sh -- dus zonder dit adres leest ARTEMIS alleen ntfy.sh en blijft de relay-lijst leeg terwijl Veronica (die het
            # adres wel kent) de telefoons wél ziet. Dat was de fout van 1 nov. Een config-waarde, geen opdracht; leeg = wissen
            # (terug naar alleen ntfy.sh). Het adres staat NOOIT in de bron (het gaat naar de openbare Pages-site); de eigenaar
            # plakt het één keer, zoals het onderwerp. Veronica toont het bij Instellingen, Relay.
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            a = (f.get('relay', [''])[0]).strip().rstrip('/')
            pad = os.path.join(REK, 'rek-relay.conf')
            if a == '':
                try: os.remove(pad)
                except Exception: pass
                self._schrijf(200, 'Relay-adres gewist. ARTEMIS leest alleen nog ntfy.sh (werkt op het hoofd-wifi; op een gastnetwerk zie je de telefoons dan niet).'); return
            # 623b: EEN of MEER subdomein-labels voor workers.dev -- het echte adres heeft er twee (<naam>-relay.<naam>-<cijfers>.
            # workers.dev). De eerste versie liet maar EEN label toe en wees het echte adres daarom af (gemeld 2 nov 21:04).
            if not re.match(r'^https://([a-z0-9][a-z0-9-]{0,62}\.)+workers\.dev$', a):
                self._schrijf(400, 'Dat lijkt geen relay-adres. Het is een https-adres dat eindigt op ".workers.dev" (de vorm https://...workers.dev). Kopieer het uit Veronica bij Instellingen, Relay.'); return
            try:
                with open(pad, 'w') as fh: fh.write(a + '\n')
                try: os.chmod(pad, 0o600)
                except Exception: pass
                self._schrijf(200, 'Relay-adres opgeslagen. Druk nu op "Relay-lijst lezen" of "Rek opbouwen"; op het gastnetwerk leest ARTEMIS de telefoons nu via de relay (zoals Veronica).')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/tailscale-key':
            # 678 stap 1: het config-veld voor de Tailscale auth-key. Strikt gevalideerd (tskey- + [A-Za-z0-9-]) en ALLEEN lokaal
            # bewaard (600). De sleutel komt NOOIT in een antwoord, het log, GitHub, de relay of Veronica -- we bevestigen alleen
            # met het prefix 'tskey-...'. Leeg = wissen. Een config-waarde, geen opdracht; staat nooit in de bron (openbare Pages).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            k = (f.get('key', [''])[0]).strip()
            pad = os.path.join(REK, 'tailscale-authkey')
            if k == '':
                try: os.remove(pad)
                except Exception: pass
                self._schrijf(200, 'Tailscale-sleutel gewist.'); return
            if not re.match(r'^tskey-[A-Za-z0-9-]{10,}$', k):
                self._schrijf(400, 'Dat lijkt geen Tailscale auth-key. Hij begint met "tskey-" (daarna letters, cijfers en streepjes). Maak er een in de Tailscale-admin (Settings > Keys, Reusable aan).'); return
            try:
                with open(pad, 'w') as fh: fh.write(k + '\n')
                try: os.chmod(pad, 0o600)
                except Exception: pass
                self._schrijf(200, 'Tailscale-sleutel opgeslagen (tskey-...), alleen hier op de Chromebook. Druk nu op "Tailscale op de telefoons (auth-key, zonder tik)".')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/wifi':
            # 678: de wifi van deze plek (SSID + wachtwoord). ALLEEN lokaal bewaard (600). Het wachtwoord komt NOOIT in een antwoord,
            # het log, GitHub, de relay of Veronica. Een config-waarde, geen opdracht; staat nooit in de bron (openbare Pages).
            # Leeg SSID = wissen. Zo geeft klaarzetten een nieuwe telefoon zelf wifi (cmd wifi connect-network).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            ssid = (f.get('ssid', [''])[0]).strip()
            ww = (f.get('ww', [''])[0])
            pad = os.path.join(REK, 'wifi.conf')
            if ssid == '':
                try: os.remove(pad)
                except Exception: pass
                self._schrijf(200, 'Wifi van deze plek gewist.'); return
            if '\n' in ssid or '\r' in ssid or '\n' in ww or '\r' in ww or len(ssid) > 64 or len(ww) > 128:
                self._schrijf(400, 'SSID of wachtwoord lijkt ongeldig (te lang of met een regeleinde).'); return
            try:
                with open(pad, 'w') as fh: fh.write('SSID=' + ssid + '\nWW=' + ww + '\n')
                try: os.chmod(pad, 0o600)
                except Exception: pass
                self._schrijf(200, 'Wifi van deze plek opgeslagen (SSID: ' + ssid + '; wachtwoord niet getoond), alleen hier op de Chromebook. Een nieuwe telefoon aan de kabel krijgt dit wifi nu vanzelf bij het klaarzetten.')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/meet-links':
            # 678: de links voor "Snelheid meten": llama-bench (bench-link) en optioneel het meetmodel (meet-model-link). ALLEEN
            # lokaal bewaard (600); nooit in de bron (openbare Pages), het log, GitHub, de relay of Veronica. Een https-link, of leeg
            # (= dat veld niet wijzigen). ARTEMIS haalt de bench hier vandaan en pusht hem bij het meten; het model valt zonder link
            # terug op de Hugging-Face-standaard.
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            bench = (f.get('bench', [''])[0]).strip()
            model = (f.get('model', [''])[0]).strip()
            gedaan = []
            try:
                for naam, waarde in (('bench-link', bench), ('meet-model-link', model)):
                    if waarde == '':
                        continue
                    if not waarde.startswith('https://') or '\n' in waarde or '\r' in waarde or len(waarde) > 2000:
                        self._schrijf(400, 'De ' + naam + ' moet een https-link zijn (geen regeleinde, niet te lang).'); return
                    pad = os.path.join(REK, naam)
                    with open(pad, 'w') as fh: fh.write(waarde + '\n')
                    try: os.chmod(pad, 0o600)
                    except Exception: pass
                    gedaan.append(naam)
                if gedaan:
                    self._schrijf(200, 'Opgeslagen (' + ', '.join(gedaan) + '), alleen hier op de Chromebook. Druk nu op "Snelheid meten (llama-bench)"; ARTEMIS zet de bench + het model zelf op elke telefoon.')
                else:
                    self._schrijf(200, 'Niets gewijzigd (beide velden leeg). Het meetmodel haalt ARTEMIS sowieso zelf op; de llama-bench-link heb je wel nodig.')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/rij-code':
            # 678 (12 nov): de rij-code bewaren (600) zodat 'Lokaal model' ook de eigen motor (poort 8081) kan gebruiken. Strikt gevalideerd, nooit teruggegeven.
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            code = (f.get('code', [''])[0]).strip()
            if not code:
                self._schrijf(200, 'Niets gewijzigd (veld leeg).'); return
            if not re.match(r'^[A-Za-z0-9_-]{6,128}$', code):
                self._schrijf(200, 'Dat lijkt geen rij-code (6 tot 128 letters, cijfers, - of _).'); return
            try:
                pad = os.path.join(REK, 'rek-token.conf')
                with open(pad, 'w') as fh: fh.write(code + '\n')
                os.chmod(pad, 0o600)
                self._schrijf(200, 'Rij-code bewaard, alleen hier op de Chromebook. Druk nu op Lokaal model: ik zoek ook de eigen motor (poort 8081) van de rektelefoons.')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/voortgang-bron':
            # 678 (12 nov): bron (eigenaar/repo tak) toevoegen en/of een LEESTOKEN bewaren; alleen op de Chromebook (600), strikt gevalideerd, nooit teruggegeven.
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            bron = (f.get('bron', [''])[0]).strip(); tok = (f.get('token', [''])[0]).strip(); gedaan = []
            try:
                if bron:
                    if not re.match(r'^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100} [A-Za-z0-9._/-]{1,100}$', bron):
                        self._schrijf(200, 'Dat is geen bron. Schrijf: eigenaar/repo tak (bijvoorbeeld naam/project main).'); return
                    pad = os.path.join(REK, 'voortgang-bronnen')
                    bestaand = open(pad).read().split('\n') if os.path.exists(pad) else []
                    if bron not in bestaand: bestaand.append(bron)
                    with open(pad, 'w') as fh: fh.write('\n'.join(x for x in bestaand if x.strip()) + '\n')
                    os.chmod(pad, 0o600); gedaan.append('bron')
                if tok:
                    if not re.match(r'^[A-Za-z0-9_]{20,255}$', tok):
                        self._schrijf(200, 'Dat lijkt geen GitHub-token (letters, cijfers en _, minstens 20 tekens).'); return
                    pad = os.path.join(REK, 'voortgang-token')
                    with open(pad, 'w') as fh: fh.write(tok + '\n')
                    os.chmod(pad, 0o600); gedaan.append('leestoken')
                self._schrijf(200, ('Opgeslagen (' + ', '.join(gedaan) + '), alleen hier op de Chromebook. Druk op Voortgang.') if gedaan else 'Niets gewijzigd (beide velden leeg).')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/apk-link':
            # 678k: het DERDE config-veld van de console, en net zo strikt gevalideerd: de vaste §499-downloadlink van de nieuwste
            # JARVIS-apk (https://.../jarvis-app/<10 tekens>). Zonder dit kon ARTEMIS een telefoon met een oude JARVIS NIET
            # bijwerken (de updateplek-repo is privé, dus de release-terugval vraagt een token). Met deze link haalt ARTEMIS de
            # apk TOKENLOOS van de server (de server stuurt een 302 naar een presigned leesadres, §499). Veronica kent de link al
            # (Koppelen, "JARVIS bijwerken"); de eigenaar/Cowork plakt hem hier één keer. Een config-waarde, geen opdracht; de link
            # staat NOOIT in de bron (het gaat naar de openbare Pages-site). Leeg = wissen (terug naar oogsten van een telefoon).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            a = (f.get('link', [''])[0]).strip()
            pad = os.path.join(REK, 'apk-link')
            if a == '':
                try: os.remove(pad)
                except Exception: pass
                self._schrijf(200, 'APK-link gewist. ARTEMIS oogst de nieuwste JARVIS weer van een telefoon die hem al heeft.'); return
            # 678k: haal een Gmail-verpakking eraf (www.google.com/url?q=<geëncodeerde url>&source=...), net als Veronica's leesMail (§504).
            m = re.match(r'^https://www\.google\.com/url\?q=([^&]+)', a)
            if m:
                a = urllib.parse.unquote(m.group(1))
            # DRIE geldige vormen: de vaste §499-serverlink, een directe presigned bucket-link naar jarvis.apk (zoals in de mail),
            # OF een pakket.json-link (678l: daaruit leest ARTEMIS de DURABELE §499-link -- de "LRWERK1 <adres>"-link uit de mail).
            ok499 = re.match(r'^https://[a-z0-9.-]{3,253}/jarvis-app/[a-z2-9]{10}$', a)
            okapk = re.match(r'^https://[a-z0-9.-]{3,253}/[A-Za-z0-9._~/%=&?-]*jarvis\.apk(\?\S+)?$', a)
            okpakket = re.match(r'^https://[a-z0-9.-]{3,253}/[A-Za-z0-9._~/%=&?-]*pakket\.json(\?\S+)?$', a)
            if okpakket:
                # een pakket-link: bewaren als pakket-link; jarvis_pakket_bron haalt er de vaste serverlink uit.
                try:
                    pp = os.path.join(REK, 'pakket-link')
                    with open(pp, 'w') as fh: fh.write(a + '\n')
                    try: os.chmod(pp, 0o600)
                    except Exception: pass
                    self._schrijf(200, 'Pakket-link opgeslagen. Druk nu op "Telefoon klaarzetten"; ARTEMIS haalt uit het pakket de vaste (niet-verlopende) serverlink en zet de nieuwste JARVIS op de telefoon.')
                except Exception as e:
                    self._schrijf(500, 'fout: ' + str(e))
                return
            if not (ok499 or okapk):
                self._schrijf(400, 'Dat lijkt geen downloadlink. Het is een https-adres dat eindigt op jarvis.apk (met een ?... eraan), een pakket.json-link, OF de vorm https://.../jarvis-app/<code>. Kopieer de link uit de bijwerk-mail of uit Veronica.'); return
            try:
                with open(pad, 'w') as fh: fh.write(a + '\n')
                try: os.chmod(pad, 0o600)
                except Exception: pass
                try: os.remove(os.path.join(REK, 'apk-link.gecheckt'))   # de 6-uur-rem resetten zodat de volgende poging meteen ophaalt
                except Exception: pass
                self._schrijf(200, 'APK-link opgeslagen. Druk nu op "Telefoon klaarzetten" (telefoon aan de kabel); ARTEMIS haalt de nieuwste JARVIS van de server en zet hem erop.')
            except Exception as e:
                self._schrijf(500, 'fout: ' + str(e))
            return
        if p.path == '/relay-zet':
            # 623c: Veronica geeft het relay-ONDERWERP (jv+30) EN -ADRES in EEN POST door -- met CORS, zoals /lokaal-zet, want
            # Veronica draait cross-origin in Chrome. Zo hoeft de eigenaar NIETS te plakken: Veronica kent het onderwerp al (met de
            # code van de rij) en zet het bij het openen van Meer zelf in de console. Het onderwerp is cryptografisch nodig -- de
            # relay-lijst is NIET te lezen zonder (de topic is sha256(onderwerp) en de inhoud is ermee versleuteld). Elk veld wordt
            # gevalideerd; een LEEG veld laat de bestaande waarde ongemoeid (niet wissen), zodat een losse push niets kapotmaakt.
            # Veronica draait op dezelfde computer; het geheim verlaat de machine niet (de console is 127.0.0.1/penguin-only).
            ln = int(self.headers.get('Content-Length', 0) or 0)
            f = urllib.parse.parse_qs(self.rfile.read(ln).decode('utf-8', 'replace') if ln else '')
            o = (f.get('onderwerp', [''])[0]).strip()
            a = (f.get('relay', [''])[0]).strip().rstrip('/')
            gedaan = []
            if o:
                if not re.match(r'^jv[a-z0-9]{30}$', o):
                    self._cors(400, 'Het relay-onderwerp van Veronica is ongeldig (hoort jv + 30 tekens te zijn).'); return
                try:
                    p1 = os.path.join(REK, 'rek-onderwerp.conf')
                    with open(p1, 'w') as fh: fh.write(o + '\n')
                    try: os.chmod(p1, 0o600)
                    except Exception: pass
                    gedaan.append('onderwerp')
                except Exception as e:
                    self._cors(500, 'fout: ' + str(e)); return
            if a:
                if not re.match(r'^https://([a-z0-9][a-z0-9-]{0,62}\.)+workers\.dev$', a):
                    self._cors(400, 'Het relay-adres van Veronica is ongeldig (hoort op .workers.dev te eindigen).'); return
                try:
                    p2 = os.path.join(REK, 'rek-relay.conf')
                    with open(p2, 'w') as fh: fh.write(a + '\n')
                    try: os.chmod(p2, 0o600)
                    except Exception: pass
                    gedaan.append('adres')
                except Exception as e:
                    self._cors(500, 'fout: ' + str(e)); return
            self._cors(200, ('Relay %s ingesteld door Veronica -- ARTEMIS leest de telefoons nu via de relay.' % ' en '.join(gedaan)) if gedaan else 'Niets ingesteld (Veronica gaf geen onderwerp of adres).')
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
        # 618: bind op ALLE interfaces van de Linux-VM (host ''), niet alleen 127.0.0.1. Op ChromeOS is de loopback van de
        # Crostini-VM NIET de loopback van ChromeOS, dus `localhost:POORT` in de Chrome-browser kwam nooit binnen ("Nieuw
        # tabblad"). De VM is vanuit Chrome bereikbaar via penguin.linux.test (dat lost op naar het VM-adres). De Crostini-VM
        # zit op een host-only netwerk met ALLEEN de Chromebook (ChromeOS routeert geen inkomend LAN-verkeer naar de VM), dus
        # '' is net zo besloten als 127.0.0.1 -- maar wel bereikbaar voor de browser. Geen IP-letterlijk in de bron.
        srv = ThreadingHTTPServer(('', POORT), H); break
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
  local q
  if leeft "$PIDA"; then
    local p; p="$(cat "$PIDA")"
    kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null || true
  fi
  rm -f "$PIDA"
  # 592j: het pid-bestand kan LEEG of verouderd zijn terwijl een oude ARTEMIS nog op 8000 luistert (dan hielp "Stop" niets en bleef
  # ARTEMIS ZONDER vangnet doordraaien). Maak de poort daarom ALTIJD echt vrij: dood wat er op ARTEMIS_POORT luistert.
  for q in $(pids_op_poort "$ARTEMIS_POORT"); do kill "$q" 2>/dev/null || true; done
  sleep 1
  for q in $(pids_op_poort "$ARTEMIS_POORT"); do kill -9 "$q" 2>/dev/null || true; done
  # 592h/592j: de vertaal-/vangnet-proxy hoort bij ARTEMIS -- samen aan, samen uit; ook op zijn poort doodmaken.
  if leeft "$PROXY_PIDF"; then kill "$(cat "$PROXY_PIDF")" 2>/dev/null || true; fi
  for q in $(pids_op_poort "$PROXY_POORT"); do kill "$q" 2>/dev/null || true; done
  rm -f "$PROXY_PIDF"
}

# Een ronde van de waakhond. Geeft 0 terug als ARTEMIS mag blijven draaien.
waak_ronde() {
  local s id pkg soort via_ts
  local naam
  for s in $(verbonden); do
    # 678 (10 nov): een Tailscale-brug (127.0.0.1:560x uit TS_BRUG_F) is een rektelefoon die rek_via_tailscale verbond (de F8 is
    # daar al uitgesloten + ontdubbeld). Zulke tunnel-toestellen staan NIET op de kabel-lijst (TOEG) en hun adb-shell is tijdens
    # een meting BEZIG (dus soms even geen modelnaam). Geen van beide is een reden voor een STOP of een disconnect -- dat doodde
    # de meting (een tunnel-telefoon via 127.0.0.1:5600 werd als 'onbekend' gezien; ARTEMIS + de meet-lezer gingen uit, de tunnels vielen weg).
    via_ts=0; case "$s" in 127.0.0.1:56[0-9][0-9]) { [ -f "$TS_BRUG_F" ] && awk -v p="${s##*:}" '$1==p{f=1} END{exit !f}' "$TS_BRUG_F" 2>/dev/null; } && via_ts=1 ;; esac
    naam="$(toestel_naam "$s")"
    # 675: een toestel dat GEEN modelnaam teruggeeft is half-verbonden/offline (de adb-shell antwoordt niet). Geen veiligheidsrisico
    # (niet te besturen, geen schermfoto) en dus GEEN reden om ARTEMIS te stoppen. Een DOOD draadloos adres ruimen we op; een BEZIGE
    # Tailscale-meettunnel laten we met rust (die moet blijven staan).
    if [ -z "$naam" ]; then
      if [ "$via_ts" -eq 1 ]; then logregel "Overgeslagen: $s (Tailscale-meettunnel, adb-shell bezig) -- geen STOP, tunnel blijft staan."; continue; fi
      case "$s" in *:*) "$ADB" disconnect "$s" >/dev/null 2>&1 || true ;; esac
      logregel "Overgeslagen: $s antwoordt niet (geen modelnaam) -- geen STOP."
      continue
    fi
    id="$(toestel_id "$s")"
    if is_f8 "$s"; then
      logregel "STOP: de F8 blijft uitgesloten (de dagelijkse telefoon). ARTEMIS is uitgezet."
      case "$s" in *:*) "$ADB" disconnect "$s" >/dev/null 2>&1 || true ;; esac
      stop_artemis
      return 1
    fi
    # een tunnel-toestel dat niet op de kabel-lijst staat is GEEN reden voor een STOP (de verboden-app-controle hieronder geldt wél).
    if [ "$via_ts" -eq 0 ] && ! toegestaan "$id"; then
      logregel "STOP: een toestel dat niet op de lijst staat ($naam). ARTEMIS is uitgezet."
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

# 596: DRAADLOOS MAKEN ZONDER TERMINAL. Een rektelefoon die één keer via de kabel is toegestaan (adb-stand 'device') zetten we
# met de knop "Draadloos maken" op draadloze adb (tcpip 5555 + connect ip:5555). Geen pincode-invoer nodig (die vraagt het
# Android-11-koppelscherm wél, en de console kan geen vrije invoer -- §571), want het toestel is al geautoriseerd over USB.
# Daarna mag de kabel eruit en bestuurt ARTEMIS de telefoon over het gewone wifi. De F8 blijft ALTIJD uitgesloten.
verbind_draadloos() {   # verbind de draadloze telefoons opnieuw (stil); de minuut-scan roept dit aan na een herstart/wifi-wissel van een telefoon
  "$ADB" start-server >/dev/null 2>&1 || true
  local a verbonden_nu; verbonden_nu="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1}')"
  # 596: de onthouden tcpip:5555-adressen opnieuw verbinden.
  if [ -s "$DRAADLOOS_F" ]; then
    while read -r a; do
      [ -n "$a" ] || continue
      printf '%s\n' "$verbonden_nu" | grep -qxF "$a" && continue   # al verbonden
      "$ADB" connect "$a" >/dev/null 2>&1 || true
    done <"$DRAADLOOS_F"
  fi
  # 597: paired Wireless-debugging-telefoons (Android 11+) TERUGVINDEN via mDNS. Hun CONNECT-poort verandert na elke herstart of
  # wifi-wissel, maar de KOPPELING (de pair) blijft bestaan -- adb vindt ze zelf (_adb-tls-connect._tcp) en verbindt opnieuw,
  # ZONDER kabel en ZONDER koppelcode. Zo komt een telefoon na een herstart vanzelf weer onder ARTEMIS. Best-effort: kan mdns niet,
  # dan blijven alleen de opgeslagen adressen over. (Niet op echte toestellen geprobeerd vanuit de bouwomgeving.)
  "$ADB" mdns services 2>/dev/null | awk '/_adb-tls-connect/ {print $NF}' | while read -r m; do
    case "$m" in *:*) printf '%s\n' "$verbonden_nu" | grep -qxF "$m" || "$ADB" connect "$m" >/dev/null 2>&1 || true ;; esac
  done
  scan_5555   # 606: het /24 op poort 5555 afzoeken (geen mDNS nodig; rem eens per ~180 s), zodat een telefoon ook op een gastnetwerk terugkomt
}
# 599: onthoud de HUIDIGE draadloze adb-endpoints (ip:poort) van toegestane rektelefoons, zodat verbind_draadloos ze na een drop
# weer kan verbinden -- OOK zonder mDNS (op een gastnetwerk werkt mDNS vaak niet, en dan vielen rektelefoons er na een drop uit en
# kwamen niet terug). We schrijven alleen endpoints van toestellen die al op de lijst staan en niet de F8 zijn.
onthoud_wifi_adb() {
  touch "$DRAADLOOS_F" 2>/dev/null; chmod 600 "$DRAADLOOS_F" 2>/dev/null || true
  local s id
  for s in $("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}'); do
    case "$s" in *:*) ;; *) continue ;; esac   # alleen draadloze endpoints (ip:poort), niet een usb-serienummer
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; [ -n "$id" ] || continue
    toegestaan "$id" || continue
    grep -qxF "$s" "$DRAADLOOS_F" 2>/dev/null || printf '%s\n' "$s" >>"$DRAADLOOS_F"
  done
}
draadloos_auto() {
  "$ADB" start-server >/dev/null 2>&1 || true
  [ -s "$TOEG" ] || { zeg "Eerst een rektelefoon toestaan: sluit hem één keer met de kabel aan (USB-foutopsporing aan, in ChromeOS delen met Linux, op de telefoon 'Toestaan'), druk op Zoek telefoons."; return 1; }
  local regels s staat id naam ip n=0
  regels="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')"
  [ -n "$regels" ] || { zeg "Geen telefoon via de kabel te zien. Sluit hem één keer met USB aan en druk op Zoek telefoons."; return 1; }
  touch "$DRAADLOOS_F"; chmod 600 "$DRAADLOOS_F" 2>/dev/null || true
  while read -r s staat; do
    [ -n "$s" ] || continue
    case "$s" in *:*) continue ;; esac                 # al een draadloos adres
    [ "$staat" = "device" ] || continue
    is_f8 "$s" && { zeg "F8 overgeslagen (de dagelijkse telefoon bestuurt ARTEMIS nooit)."; continue; }
    id="$(toestel_id "$s")"; naam="$(toestel_naam "$s")"
    toegestaan "$id" || { zeg "$naam staat niet op de lijst; overgeslagen (druk eerst op Zoek telefoons)."; continue; }
    ip="$("$ADB" -s "$s" shell ip -f inet addr show wlan0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)"
    [ -n "$ip" ] || { zeg "$naam: geen wifi-adres gevonden. Zit hij op het gewone wifi (geen gastnet)?"; continue; }
    "$ADB" -s "$s" tcpip 5555 >/dev/null 2>&1 || { zeg "$naam: kon de draadloze modus niet aanzetten."; continue; }
    sleep 2
    if "$ADB" connect "$ip:5555" 2>/dev/null | grep -qiE 'connected|already'; then
      grep -qxF "$ip:5555" "$DRAADLOOS_F" 2>/dev/null || printf '%s\n' "$ip:5555" >>"$DRAADLOOS_F"
      n=$((n+1)); zeg "$naam: nu draadloos op $ip:5555 -- de kabel mag eruit."
    else
      zeg "$naam: verbinden op $ip:5555 lukte niet (probeer het nog eens, of houd de kabel erin)."
    fi
  done <<<"$regels"
  zeg "Klaar: $n telefoon(s) draadloos gemaakt. ARTEMIS bestuurt ze nu over het wifi; de minuut-scan verbindt ze na een herstart vanzelf opnieuw."
  overzicht
}

# 606: SUBNET-SCAN OP POORT 5555. Deep research (31 okt) wees uit dat elke rektelefoon zichzelf op de VASTE poort 5555 kan houden
# (JARVIS-kant, volgende APK-bundel); dan maakt het niet meer uit of mDNS werkt of welke kant bestuurt. ARTEMIS' helft: gewoon het
# /24 afzoeken op poort 5555 en elke open telefoon verbinden -- GEEN mDNS nodig, werkt dus ook op een gastnetwerk. We leiden het /24
# af uit de onthouden endpoints (DRAADLOOS_F), de teruggevonden F8, verbonden draadloze toestellen en een telefoon aan de kabel --
# NOOIT uit het eigen adres van de Chromebook (die zit in Crostini op 100.115.92.x, een ander net dan de telefoons). Faalveilig: een
# korte time-out per host, parallel, hoogstens drie /24's, zodat de minuut-scan nooit blijft hangen. Rem: eens per ~180 s. De F8
# wordt, mocht hij adb op 5555 aan hebben, meteen weer losgekoppeld -- hij blijft ALTIJD uitgesloten.
scan_5555() {
  local nu laatst
  nu="$(date +%s 2>/dev/null || echo 0)"; case "$nu" in *[!0-9]*|'') nu=0 ;; esac
  if [ -f "$SCAN5555_T" ]; then laatst="$(cat "$SCAN5555_T" 2>/dev/null || echo 0)"; else laatst=0; fi
  case "$laatst" in *[!0-9]*|'') laatst=0 ;; esac
  [ "$nu" -ne 0 ] && [ $((nu - laatst)) -lt 180 ] && return 0
  printf '%s\n' "$nu" >"$SCAN5555_T" 2>/dev/null || true
  # 608: /24-prefixen uit de bekende LAN-netten (608: beide wifi's), plus een telefoon aan de kabel; NOOIT het eigen Crostini-net.
  local prefixes="" ip s sp
  for sp in $(bekende_lan_subnetten); do prefixes="$prefixes ${sp%.}"; done   # trailing dot eraf (192.168.178. -> 192.168.178)
  for s in $("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}'); do
    case "$s" in
      *:*) ip="${s%%:*}"; case "$ip" in [0-9]*.[0-9]*.[0-9]*.[0-9]*) prefixes="$prefixes ${ip%.*}" ;; esac ;;
      *) ip="$("$ADB" -s "$s" shell ip -f inet addr show wlan0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)"
         case "$ip" in [0-9]*.[0-9]*.[0-9]*.[0-9]*) prefixes="$prefixes ${ip%.*}" ;; esac ;;
    esac
  done
  prefixes="$(printf '%s\n' $prefixes | awk 'NF && !seen[$0]++' | head -4)"   # hoogstens 4 /24's (eigen net + beide wifi's + kabel)
  [ -n "$prefixes" ] || return 0
  local verbonden_nu open p h alreedsip
  verbonden_nu="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1}')"
  # 623h: de IP's waarmee adb AL verbonden is (zonder :poort). Die mogen we NIET rauw aftasten: een losse TCP-connect naar poort
  # 5555 van een telefoon waarmee al een echte adb-verbinding loopt, zet adbd's bestaande verbinding soms OFFLINE. Dat was de
  # tegenstrijdigheid van 05:49 -- de relay-lijst verbond een telefoon, en de sweep daarna tastte datzelfde adres rauw af en gooide hem eruit.
  alreedsip="$(printf '%s\n' "$verbonden_nu" | sed 's/:.*//')"
  # poort 5555 proberen met /dev/tcp (geen extra tool nodig), parallel, korte time-out per host; de IP gaat als argument mee ($0), nooit in de code.
  # Een al verbonden IP slaan we over (awk-set), zodat een live adb-verbinding nooit door de rauwe tast sneuvelt.
  open="$(
    for p in $prefixes; do for h in $(seq 1 254); do printf '%s.%s\n' "$p" "$h"; done; done \
    | awk -v skip="$alreedsip" 'BEGIN{n=split(skip,a,"\n"); for(i=1;i<=n;i++) if(a[i]!="") s[a[i]]=1} !($0 in s)' \
    | xargs -P 48 -I{} bash -c 'timeout 1 bash -c "exec 3<>/dev/tcp/$0/5555" 2>/dev/null && printf "%s\n" "$0"' {} 2>/dev/null
  )"
  for ip in $open; do
    [ -n "$ip" ] || continue
    printf '%s\n' "$verbonden_nu" | grep -qxF "$ip:5555" && continue
    if "$ADB" connect "$ip:5555" 2>/dev/null | grep -qiE 'connected|already'; then
      if is_f8 "$ip:5555"; then "$ADB" disconnect "$ip:5555" >/dev/null 2>&1 || true; else onthoud_lan_subnet "$ip"; fi   # de F8 blijft ALTIJD uitgesloten; een echte rektelefoon = dit /24 onthouden
    fi
  done
  onthoud_wifi_adb   # 599: alleen toegestane, niet-F8 endpoints onthouden
}

# (4) KOPPELEN VANAF DE KABEL, HERSTART-VAST (Android 11+ Draadloze foutopsporing). Een rektelefoon die één keer via de kabel is
# toegestaan (adb-stand 'device') krijgt: (a) het recht WRITE_SECURE_SETTINGS voor JARVIS, zodat de JARVIS-boot-herinschakeling de
# draadloze foutopsporing na een herstart ZELF weer aanzet; (b) draadloze foutopsporing AAN (adb_wifi_enabled=1). De adb-sleutel van
# deze computer is al vertrouwd (via USB), dus er is GEEN zescijferige koppelcode nodig -- die is alleen voor een computer die het
# toestel nog nooit zag. ARTEMIS vindt het toestel daarna over mDNS (§597) en verbindt. Anders dan 'Draadloos maken' (tcpip 5555, weg
# na een herstart) overleeft dit een herstart zodra JARVIS met de boot-herinschakeling erop staat. De F8 blijft ALTIJD uitgesloten;
# we raken alleen adb-instellingen aan, nooit een bank-, kluis-, betaal- of crypto-app. (Niet op een echt toestel geprobeerd vanuit de
# bouwomgeving; best-effort met eerlijke meldingen.)
kabel_koppel() {
  "$ADB" start-server >/dev/null 2>&1 || true
  [ -s "$TOEG" ] || { zeg "Eerst een rektelefoon toestaan: sluit hem één keer met de kabel aan (USB-foutopsporing aan, in ChromeOS delen met Linux, op de telefoon 'Toestaan'), druk op Zoek telefoons."; return 1; }
  local regels s staat id naam rel relmaj ip n=0
  regels="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')"
  [ -n "$regels" ] || { zeg "Geen telefoon via de kabel te zien. Sluit hem één keer met USB aan en druk op Zoek telefoons."; return 1; }
  jarvis_oogst   # 598: de nieuwste JARVIS oogsten van een telefoon die hem al heeft, zodat we een oude telefoon eerst kunnen bijwerken
  while read -r s staat; do
    [ -n "$s" ] || continue
    case "$s" in *:*) continue ;; esac                 # een draadloos adres: dit gaat over de kabel
    [ "$staat" = "device" ] || { zeg "$s: nog niet toegestaan over de kabel (zet USB-foutopsporing aan en tik 'Toestaan' op de telefoon)."; continue; }
    is_f8 "$s" && { zeg "F8 overgeslagen (de dagelijkse telefoon bestuurt ARTEMIS nooit)."; continue; }
    id="$(toestel_id "$s")"; naam="$(toestel_naam "$s")"
    toegestaan "$id" || { zeg "$naam staat niet op de lijst; overgeslagen (druk eerst op Zoek telefoons)."; continue; }
    rel="$("$ADB" -s "$s" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r\n ')"
    relmaj="$(printf '%s' "$rel" | cut -d. -f1)"; case "$relmaj" in *[!0-9]*|'') relmaj=0 ;; esac
    if [ "$relmaj" -lt 11 ]; then zeg "$naam: Android ${rel:-onbekend} kent nog geen draadloze foutopsporing (Android 11+). Gebruik 'Draadloos maken' (werkt, maar is weg na een herstart)."; continue; fi
    # 598: EERST de nieuwste JARVIS, DAN het recht. Een oude JARVIS (bv. 1.9.65) heeft WRITE_SECURE_SETTINGS niet in zijn manifest,
    # dus 'pm grant' faalt. jarvis_bijwerk_een zet de geoogste nieuwste versie erop (nooit de F8); daarna lukt de grant wel.
    jarvis_bijwerk_een "$s" "$naam" || true
    # (a) JARVIS het recht geven de draadloze foutopsporing na een herstart zelf weer aan te zetten.
    if "$ADB" -s "$s" shell pm grant "$JARVIS_PKG" android.permission.WRITE_SECURE_SETTINGS >/dev/null 2>&1; then
      zeg "$naam: JARVIS mag nu na een herstart de draadloze foutopsporing zelf weer aanzetten."
    else
      zeg "$naam: kon JARVIS het recht WRITE_SECURE_SETTINGS niet geven. Meestal heeft JARVIS dan nog een oude versie (zonder dit recht) en was er geen nieuwere APK om over te zetten. Download de JARVIS-apk één keer op de Chromebook (de JARVIS-downloadlink in Chrome -> hij heet 'jarvis.apk' in je downloadmap), of zet 1.9.79 op één andere rektelefoon; druk daarna opnieuw op 'Koppel via de kabel': ik installeer/oogst hem dan en zet hem vanzelf op deze telefoon. Zonder de boot-herinschakeling moet je na een herstart de kabel er één keer weer in doen."
    fi
    # (b) draadloze foutopsporing AAN. De adb-sleutel van deze computer is al vertrouwd (USB), dus geen koppelcode nodig.
    "$ADB" -s "$s" shell settings put global adb_wifi_enabled 1 >/dev/null 2>&1 || { zeg "$naam: kon de draadloze foutopsporing niet aanzetten (adb_wifi_enabled)."; continue; }
    sleep 2
    ip="$("$ADB" -s "$s" shell ip -f inet addr show wlan0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)"
    n=$((n+1))
    # 604: OOK de VASTE poort 5555 (adb tcpip) + het endpoint onthouden. Op een GASTNETWERK werkt de mDNS van de Android-11 draadloze
    # foutopsporing vaak NIET, en dan kwam een telefoon na de kabel niet terug (alleen de telefoon aan de kabel bleef zichtbaar -- precies
    # de klacht van deze ronde). De vaste poort heeft GEEN mDNS nodig: de minuut-scan (verbind_draadloos) verbindt ip:5555
    # opnieuw, ook na een herstart van de Chromebook (DRAADLOOS_F overleeft dat en de autostart-console draait scan elke minuut). tcpip is
    # wel weg na een herstart van de TELEFOON; dan brengt de boot-herinschakeling (a) de draadloze foutopsporing terug (of één keer de kabel).
    touch "$DRAADLOOS_F" 2>/dev/null; chmod 600 "$DRAADLOOS_F" 2>/dev/null || true
    if [ -n "$ip" ] && "$ADB" -s "$s" tcpip 5555 >/dev/null 2>&1; then
      sleep 2
      if "$ADB" connect "$ip:5555" 2>/dev/null | grep -qiE 'connected|already'; then
        grep -qxF "$ip:5555" "$DRAADLOOS_F" 2>/dev/null || printf '%s\n' "$ip:5555" >>"$DRAADLOOS_F"
        zeg "$naam: draadloze foutopsporing aan + vast op $ip:5555. De kabel mag eruit; ik vind hem terug -- ook op een gastnetwerk, en ook na een herstart van de Chromebook."
      else
        grep -qxF "$ip:5555" "$DRAADLOOS_F" 2>/dev/null || printf '%s\n' "$ip:5555" >>"$DRAADLOOS_F"
        zeg "$naam: draadloze foutopsporing aan (wifi $ip); verbinden op $ip:5555 lukte nu nog niet, maar ik onthoud het en de minuut-scan probeert het opnieuw. De kabel mag eruit."
      fi
    else
      zeg "$naam: draadloze foutopsporing aan${ip:+ (wifi $ip)}. De kabel mag eruit; ik vind hem over het wifi en verbind. (Geen wifi-adres gevonden? Zit hij op het wifi, niet alleen aan de kabel?)"
    fi
  done <<<"$regels"
  verbind_draadloos   # §597: meteen over mDNS verbinden
  onthoud_wifi_adb    # 599: het draadloze endpoint onthouden, zodat het na een drop zonder mDNS (gastnet) weer terugkomt
  overzicht
  [ "$n" -gt 0 ] && zeg "Klaar: $n telefoon(s) herstart-vast draadloos gekoppeld. Staat de JARVIS-boot-herinschakeling erop, dan komen ze ook na een herstart vanzelf terug; zo niet, dan na een herstart één keer de kabel erin en opnieuw 'Koppel via de kabel'."
}

# 667c: TELEFOON KLAARZETTEN -- ARTEMIS configureert een rektelefoon aan de KABEL volledig zelf (de eigenaar doet niets). Dit lost de
# verhuis-stilte op: stond het wifi soms als 'niet gevalideerd' (Privé-DNS strikt), sprong de telefoon naar mobiele data, en stopte
# HyperOS de hartslag in de WebView. Eén knop zet alles recht. Fysieke toestemming = de kabel + 'Toestaan' op de telefoon; NOOIT
# de F8. Elke stap wordt gemeld. Herbruikbaar: elke rektelefoon aan de kabel krijgt dit.
# 667d: argument "auto" = de minuut-lus roept dit aan. Dan slaat hij telefoons over die AL klaargezet zijn (KLAAR_F, per toestel-id),
# en zwijgt hij als er niets NIEUWS aan de kabel hangt -- zo hoeft niemand ooit op de knop te drukken (de eigenaar doet niets). Een lock
# voorkomt dat twee lussen tegelijk draaien. De knop (zonder "auto") doet altijd alles, ook een telefoon die al klaar is.
telefoon_klaarzetten() {
  local auto=''; [ "${1:-}" = "auto" ] && auto=1
  "$ADB" start-server >/dev/null 2>&1 || true
  local regels s staat id naam ip rel relmaj n=0
  regels="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')"
  if [ -z "$regels" ]; then [ -n "$auto" ] || zeg "Geen telefoon via de kabel te zien. Sluit de telefoon met USB aan, deel hem in ChromeOS met Linux, en zet USB-foutopsporing aan (op sommige telefoons ook 'USB-foutopsporing (beveiligingsinstellingen)')."; return 1; fi
  # 667d (auto): is er wel een NIEUWE, niet-F8, toegestane telefoon in 'device'-stand die nog niet klaargezet is? Zo niet: stil weg.
  if [ -n "$auto" ]; then
    local nieuw='' did
    while read -r s staat; do
      [ -n "$s" ] || continue; case "$s" in *:*) continue ;; esac
      [ "$staat" = "device" ] || continue; is_f8 "$s" && continue
      did="$(toestel_id "$s")"
      [ -s "$KLAAR_F" ] && grep -qxF "$did" "$KLAAR_F" 2>/dev/null && continue
      nieuw=1; break
    done <<<"$regels"
    [ -n "$nieuw" ] || return 0
    # een lock, zodat twee minuut-lussen niet tegelijk dezelfde telefoon klaarzetten
    if [ -f "$KLAAR_LOCK" ] && [ "$(( $(date +%s) - $(stat -c %Y "$KLAAR_LOCK" 2>/dev/null || echo 0) ))" -lt 600 ]; then return 0; fi
    touch "$KLAAR_LOCK" 2>/dev/null || true
    zeg "Nieuwe telefoon aan de kabel gezien -- ik zet hem vanzelf klaar (geen knop nodig)."
  fi
  zeg "== JARVIS-versie per telefoon (nu, vóór bijwerken) =="   # 678p: bovenaan, zodat hij niet uit het korte console-log valt
  jarvis_versies
  jarvis_oogst "$([ -n "$auto" ] && echo 0 || echo 1)"   # de nieuwste JARVIS oogsten (knopdruk: toon=1 => per bron uitleggen wat faalt EN de serverlink NU ophalen); nooit de F8
  touch "$TOEG"; chmod 600 "$TOEG" 2>/dev/null || true
  BIJWERK_GEDAAN=''   # 678m: wordt 1 zodra jarvis_bijwerk_een hieronder echt een nieuwe JARVIS installeert
  while read -r s staat; do
    [ -n "$s" ] || continue
    case "$s" in *:*) continue ;; esac                 # alleen de kabel (usb-serienummer), geen draadloos adres
    is_f8 "$s" && { [ -n "$auto" ] || zeg "F8 overgeslagen (de dagelijkse telefoon zetten we NOOIT klaar)."; continue; }
    if [ "$staat" != "device" ]; then [ -n "$auto" ] || zeg "$s: nog niet toegestaan over de kabel. Zet USB-foutopsporing aan en tik 'Toestaan' op de telefoon (op sommige telefoons ook 'USB-foutopsporing (beveiligingsinstellingen)')."; continue; fi
    id="$(toestel_id "$s")"; naam="$(toestel_naam "$s")"
    # in de auto-lus: alleen wat nog niet klaar is (de knop doet alles opnieuw)
    if [ -n "$auto" ] && [ -s "$KLAAR_F" ] && grep -qxF "$id" "$KLAAR_F" 2>/dev/null; then continue; fi
    # fysieke toestemming (kabel + Toestaan) = op de lijst, zodat de draadloze stappen hem later herkennen.
    toegestaan "$id" || { printf '%s\n' "$id" >>"$TOEG"; logregel "Klaarzetten: $naam op de lijst."; }
    zeg "== $naam klaarzetten =="
    rel="$("$ADB" -s "$s" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r\n ')"; relmaj="$(printf '%s' "$rel" | cut -d. -f1)"; case "$relmaj" in *[!0-9]*|'') relmaj=0 ;; esac
    # 1. Nieuwste JARVIS EERST (zijn manifest heeft WRITE_SECURE_SETTINGS; een oude niet, dan faalt de grant).
    jarvis_bijwerk_een "$s" "$naam" || true
    # 2. JARVIS mag na een herstart de draadloze foutopsporing zelf aanzetten.
    if "$ADB" -s "$s" shell pm grant "$JARVIS_PKG" android.permission.WRITE_SECURE_SETTINGS >/dev/null 2>&1; then zeg "  - WRITE_SECURE_SETTINGS: gelukt (5555 komt na een herstart vanzelf terug)."; elif [ -s "$JAPK_PLEK/jarvis.apk" ]; then zeg "  - WRITE_SECURE_SETTINGS: nog niet (JARVIS is zojuist bijgewerkt maar het recht zit pas in de nieuwe versie -- druk na de herstart nog een keer op Telefoon klaarzetten)."; else zeg "  - WRITE_SECURE_SETTINGS: niet gelukt -- JARVIS is te oud en er is GEEN nieuwere apk om op te zetten. Zie de regels hierboven (serverlink/release/download-map) voor welke bron faalde; zet de §499-apk-link in de console bij \"APK-link\", dan werkt het vanzelf."; fi
    # 3. Meldingen aan (hartslag/status).
    if [ "$relmaj" -ge 13 ]; then "$ADB" -s "$s" shell pm grant "$JARVIS_PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 && zeg "  - meldingen: aan." || zeg "  - meldingen: kon POST_NOTIFICATIONS niet zetten."; else zeg "  - meldingen: standaard aan (Android ${rel:-?})."; fi
    # 4. Batterijoptimalisatie-uitzondering + achtergrond toestaan (anders stopt HyperOS de hartslag in de WebView).
    "$ADB" -s "$s" shell dumpsys deviceidle whitelist +"$JARVIS_PKG" >/dev/null 2>&1 || true
    "$ADB" -s "$s" shell cmd appops set "$JARVIS_PKG" RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1 || true
    zeg "  - batterij: JARVIS mag op de achtergrond blijven draaien."
    # 5. Privé-DNS automatisch. STRIKT brak op sommige telefoons de wifi-validatie -> wifi gold als 'niet gevalideerd' en Android koos mobiele data.
    "$ADB" -s "$s" shell settings put global private_dns_mode opportunistic >/dev/null 2>&1 && zeg "  - Privé-DNS: automatisch (niet strikt) -- dit was de hoofdoorzaak van de stilte na de verhuizing." || zeg "  - Privé-DNS: kon niet gezet."
    # 6. Scherm aan bij laden, zodat hij tijdens het klaarzetten niet in diepe slaap gaat.
    "$ADB" -s "$s" shell settings put global stay_on_while_plugged_in 7 >/dev/null 2>&1 || true
    # 7. Draadloze foutopsporing + vaste poort 5555, endpoint onthouden (zelfde als Koppel via de kabel).
    "$ADB" -s "$s" shell settings put global adb_wifi_enabled 1 >/dev/null 2>&1 || true
    ip="$("$ADB" -s "$s" shell ip -f inet addr show wlan0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)"
    touch "$DRAADLOOS_F" 2>/dev/null; chmod 600 "$DRAADLOOS_F" 2>/dev/null || true
    if [ -n "$ip" ] && "$ADB" -s "$s" tcpip 5555 >/dev/null 2>&1; then
      sleep 2; "$ADB" connect "$ip:5555" >/dev/null 2>&1 || true
      grep -qxF "$ip:5555" "$DRAADLOOS_F" 2>/dev/null || printf '%s\n' "$ip:5555" >>"$DRAADLOOS_F"
      zeg "  - draadloze foutopsporing vast op $ip:5555 (de kabel mag straks eruit)."
    else
      zeg "  - draadloze foutopsporing aan${ip:+ (wifi $ip)}."
    fi
    # 8. JARVIS starten.
    "$ADB" -s "$s" shell monkey -p "$JARVIS_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 && zeg "  - JARVIS gestart." || zeg "  - JARVIS starten lukte niet (open hem één keer met de hand)."
    # 9. Nakijken: zit hij op wifi (niet mobiele data)? Zo niet: de wifi van DEZE plek zelf doorgeven (als die bewaard is).
    if [ -n "$ip" ]; then zeg "  - staat op wifi ($ip); hij hoort zich nu bij de relay te melden."; else
      zeg "  - geen wifi-adres; ik probeer de wifi van deze plek zelf door te geven."
      wifi_doorgeven "$s" "$naam"
      ip="$("$ADB" -s "$s" shell ip -o -4 addr 2>/dev/null | tr -d '\r' | grep -oE '192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    fi
    # 9b (678 stap 1): meteen Tailscale aanmelden met de bewaarde auth-key, zonder tik -- zo is een nieuwe telefoon: kabel erin,
    # USB-foutopsporing aan, verder niets. Alleen als er een sleutel staat; anders doet het §678m-blok hieronder de inloglink-weg.
    if ts_authkey_lees >/dev/null; then zeg "  - Tailscale aanmelden met de auth-key:"; ts_authkey_een "$s" "$naam" || true; fi
    # 667d: onthoud dat deze telefoon VOLLEDIG is klaargezet, zodat de auto-lus hem niet opnieuw doet.
    touch "$KLAAR_F" 2>/dev/null; chmod 600 "$KLAAR_F" 2>/dev/null || true
    grep -qxF "$id" "$KLAAR_F" 2>/dev/null || printf '%s\n' "$id" >>"$KLAAR_F"
    relay_meld "Telefoon klaargezet: $naam${ip:+ op wifi $ip} (JARVIS gestart; hoort zich nu bij de relay te melden)." || true   # 667e: uitkomst naar de relay, zodat het in Veronica te lezen is
    n=$((n+1))
  done <<<"$regels"
  rm -f "$KLAAR_LOCK" 2>/dev/null || true
  verbind_draadloos; onthoud_wifi_adb; overzicht
  # 678m: Tailscale AUTOMATISCH na een geslaagde JARVIS-update. Alleen als er echt is bijgewerkt (BIJWERK_GEDAAN), zodat het niet
  # elke 3 minuten draait; tailscale_telefoon is idempotent (slaat een al geïnstalleerde over), slaat de F8 altijd over en raakt
  # alleen telefoons op de lijst. Zo bereiken de telefoons elkaar na de update op hun vaste 100.x over elk wifi.
  if [ -n "$BIJWERK_GEDAAN" ] && ! ts_authkey_lees >/dev/null; then
    zeg "Nieuwe JARVIS geïnstalleerd -- ik zet er meteen Tailscale op (inloglink-weg; nooit de F8). Tip: met een bewaarde auth-key gaat dit zonder tik."
    tailscale_telefoon || true
  fi
  zeg "== JARVIS-versie per telefoon (na bijwerken) =="   # 678p: de uitkomst -- staat ook in Status (klaarzet-versies)
  jarvis_versies
  if [ "$n" -gt 0 ]; then zeg "Klaar: $n telefoon(s) volledig klaargezet. De kabel mag eruit; ik vind ze terug via 5555 en JARVIS meldt zich bij de relay."; else [ -n "$auto" ] || zeg "Geen telefoon klaargezet (alleen de F8, of niets toegestaan aan de kabel)."; fi
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
# 592j: is er een LOKAAL model ingesteld? Dan is de vangnet-proxy VERPLICHT -- ARTEMIS praat alleen via de proxy met het model.
vangnet_vereist() { [ -s "$REK_MAP/lokaal-model.conf" ] && [ -n "$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1)" ]; }
# 592j: draait de vangnet-proxy ECHT? We toetsen een TCP-verbinding naar de proxy-poort -- pid-levend alleen is te zwak (een proxy
# die net crasht op bind leeft nog heel even tijdens het importeren). De proxy stuurt / door naar het model, dus curl op / is
# onbetrouwbaar; een kale verbinding bewijst dat hij luistert. Terugval: iets luistert op de poort (ss/lsof).
proxy_draait() {
  ( exec 3<>"/dev/tcp/127.0.0.1/$PROXY_POORT" ) 2>/dev/null && return 0
  [ -n "$(pids_op_poort "$PROXY_POORT" 2>/dev/null)" ]
}
# 592j: de echte pid van ARTEMIS -- uit het pid-bestand, anders (pid-bestand leeg/verouderd maar poort 8000 luistert) uit de poort.
artemis_pid() {
  if leeft "$PIDA"; then cat "$PIDA" 2>/dev/null; return; fi
  pids_op_poort "$ARTEMIS_POORT" 2>/dev/null | head -1
}
# 592j: start de vangnet-proxy (her)schrijven + (her)starten + WACHTEN tot hij echt luistert. Geeft 0 als hij draait, anders 1.
# Een alleen-kijken- of handel-taak mag NOOIT zonder vangnet draaien; start_kern weigert ARTEMIS als dit faalt.
start_proxy() {
  local base="$1" token="$2" q i
  [ -n "$base" ] || return 1
  schrijf_artemis_proxy
  if leeft "$PROXY_PIDF"; then kill "$(cat "$PROXY_PIDF")" 2>/dev/null || true; fi
  for q in $(pids_op_poort "$PROXY_POORT" 2>/dev/null); do kill "$q" 2>/dev/null || true; done
  sleep 1
  for q in $(pids_op_poort "$PROXY_POORT" 2>/dev/null); do kill -9 "$q" 2>/dev/null || true; done
  rm -f "$PROXY_PIDF"
  # 592L: de reserve-keten. De Gemini-sleutel (gratis AIza-laag) komt uit ARTEMIS' eigen .env -- geen aankoop, geen nieuwe sleutel.
  # PROXY_RESERVE (reserve-telefoons met dezelfde E4B op het LAN) staat in $REK_MAP/reserve-modellen.json als die er is.
  local gkey=""; [ -f "$ARTEMIS_MAP/.env" ] && gkey="$(sed -n 's/^GEMINI_API_KEY=//p' "$ARTEMIS_MAP/.env" 2>/dev/null | head -1)"
  local reserve="[]"; [ -s "$REK_MAP/reserve-modellen.json" ] && reserve="$(cat "$REK_MAP/reserve-modellen.json")"
  # 592p: is de F8 een LAN-adres (niet 127.0.0.1 via adb)? Dan mag de proxy hem bij een IP-wissel zelf terugvinden op het subnet.
  # Een eerder teruggevonden adres (f8-gevonden.conf) is recenter dan de conf, dus daar beginnen we.
  local f8lan=0; case "$base" in http://127.0.0.1:*|http://localhost:*) : ;; http://*) f8lan=1 ;; esac
  if [ "$f8lan" = 1 ] && [ -s "$F8_GEVONDEN_F" ]; then base="$(cat "$F8_GEVONDEN_F")"; fi
  # 592p: de /24-prefixes van de Chromebook meegeven zodat de proxy de F8 op het LAN kan terugvinden -- GEEN vast IP in de code.
  # 608: scan BEIDE wifi's -- het eigen net van de Chromebook PLUS elk net waar ooit een telefoon zat (hoofdwifi en gastnet),
  # zodat de F8 na een wifi-wissel vanzelf wordt teruggevonden en niet op het oude adres blijft hangen.
  local subnetten=""; if [ "$f8lan" = 1 ]; then local sp; for sp in $(bekende_lan_subnetten); do subnetten="$subnetten$sp,"; done; fi
  ( env PROXY_POORT="$PROXY_POORT" F8_BASE="$base" F8_TOKEN="${token:-local}" \
      ALLEEN_KIJKEN_FILE="$ALLEEN_KIJKEN_F" PROXY_LOG="$PROXY_LOG" \
      GEMINI_KEY="$gkey" GEMINI_MODELLEN="gemini-3.8-flash,gemini-3.6-flash" GEMINI_STAAT_DIR="$REK_MAP" GEMINI_MAX_DAG="$GEMINI_MAX_DAG" \
      AREK_PAD="${BIN_SELF:-artemis-rek}/artemis-rek" \
      PROXY_RESERVE="$reserve" PROXY_ACTIEF_FILE="$ACTIEF_F" PROXY_REDEN_FILE="$REDEN_F" \
      F8_LAN="$f8lan" F8_GEVONDEN_FILE="$F8_GEVONDEN_F" F8_SCAN_POORTEN="8000" F8_SUBNETTEN="$subnetten" \
      setsid python3 "$PROXYF" </dev/null >>"$REK_MAP/proxy.log" 2>&1 & echo $! >"$PROXY_PIDF" )
  for i in 1 2 3 4 5 6 7 8 9 10; do proxy_draait && return 0; sleep 0.5; done
  proxy_draait
}

# De ECHTE start (geen teller-reset, geen AANF-touch). Aangeroepen door start() (mens) en start_stil() (console-lus).
start_kern() {
  [ -d "$ARTEMIS_MAP" ] || { zeg "ARTEMIS staat er niet. Draai eerst installeer.sh."; return 1; }
  [ -s "$TOEG" ] || { zeg "Er staat nog geen rektelefoon op de lijst. Sluit er een aan (kabel + USB-foutopsporing); de console vindt hem vanzelf."; return 1; }
  # 678: ZONDER lokaal model en ZONDER Gemini kan ARTEMIS niet denken -- en we laten hem dan NIET stilletjes op Gemini terugvallen.
  if [ ! -s "$REK_MAP/lokaal-model.conf" ] && [ ! -f "$GEM_AAN_F" ]; then
    zeg "ARTEMIS start niet: er is geen lokaal model gekozen en Gemini staat UIT (standaard, want Gemini is het enige dat iets kan kosten). Kies 'Lokaal model' (de F8 of een rektelefoon), of zet Gemini bewust aan met de knop 'Gemini: uit/aan'."
    return 1
  fi
  # 592j: draait ARTEMIS al? Alleen "draait al" zeggen als er GEEN vangnet nodig is, OF het vangnet ook echt draait. Draait
  # ARTEMIS wel maar het vangnet niet (de oude bug: een herstart liet de oude ARTEMIS zonder proxy doordraaien), dan stop ik
  # ALLES en herstart schoon MET vangnet -- een alleen-kijken-/handel-taak mag nooit zonder vangnet draaien.
  if artemis_draait; then
    if vangnet_vereist && ! proxy_draait; then
      zeg "ARTEMIS draait ZONDER vangnet-proxy -- dat mag niet. Ik stop alles en herstart schoon mét vangnet."
      stop_artemis
    else
      zeg "ARTEMIS draait al: http://$KBHOST:$ARTEMIS_POORT"; return 0
    fi
  fi
  waak_ronde || return 1
  kaart_verhuis   # 678f: repareer cache-symlinks naar de kaart (9p kan geen locks/rename) en verplaats alleen inerte data; caches/venv blijven intern
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
    # 592h: niet rechtstreeks naar de telefoon, maar via de VERTAAL-/VANGNET-proxy op 127.0.0.1:$PROXY_POORT. Die zet Gemma's
    # tekst-acties om naar echte tool_calls EN blokkeert gevaarlijke acties (NOODSTOP/Stop/Verwijder/Uninstall, bank/kluis/
    # betaal/crypto-apps), en in de alleen-kijken-stand laat hij alleen Home door. ARTEMIS praat met de proxy; de proxy met het model.
    # 592j: het vangnet gaat ALTIJD EERST aan, en ik WACHT tot het echt luistert. Lukt dat niet, dan start ik ARTEMIS NIET --
    # een alleen-kijken-/handel-taak mag nooit zonder vangnet draaien.
    if [ -n "$lm_base" ]; then
      if ! start_proxy "$lm_base" "${lm_token:-local}"; then
        zeg "Het vangnet (proxy) start niet -- ik start ARTEMIS NIET. Een alleen-kijken- of handel-taak mag nooit zonder vangnet draaien. Kijk bij Log (proxy.log) en probeer Start opnieuw."
        return 1
      fi
      lok_env="OPENAI_BASE_URL=http://127.0.0.1:$PROXY_POORT/v1 OPENAI_API_KEY=${lm_token:-local}"
    fi
  fi
  # 592fix: via `env` -- een VARIABELE ($lok_env) in prefix-positie wordt door bash als het COMMANDO gelezen (niet als
  # toewijzing), waardoor 'PORT=8000: command not found' kwam. `env` neemt alle KEY=VAL (ook de lege/gevulde $lok_env)
  # gewoon als argumenten, dus het werkt met en zonder lokaal model.
  ( cd "$ARTEMIS_MAP" && env PATH="$REK_MAP/geen-browser:$PATH" BROWSER=true DISPLAY= UV_PYTHON=3.12 $lok_env PORT="$ARTEMIS_POORT" ARTEMIS_PORT="$ARTEMIS_POORT" ARTEMIS_WEB_PORT="$ARTEMIS_POORT" ARTEMIS_NO_OPEN=1 NG_CLI_ANALYTICS=false ARTEMIS_ARTEMIS_JSONC="$REK_MAP/artemis.jsonc" setsid bash start.sh </dev/null >>"$REK_MAP/artemis.log" 2>&1 & echo $! >"$PIDA" )
  sleep 1
  ( setsid "$0" waakhond </dev/null >>"$LOG" 2>&1 & echo $! >"$PIDW" )
  zeg "ARTEMIS start (de eerste keer duurt het een paar minuten). ARTEMIS zelf: http://$KBHOST:$ARTEMIS_POORT"
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
  # 592j: gezond = ARTEMIS draait EN (geen vangnet nodig OF het vangnet draait ook). Draait ARTEMIS zonder verplicht vangnet,
  # dan NIET "gezond" afvinken: val door naar start_kern, dat alles schoon herstart mét vangnet.
  if artemis_draait && { ! vangnet_vereist || proxy_draait; }; then rm -f "$REK_MAP/start-pogingen" "$REK_MAP/start-gestopt"; return 0; fi
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
# 598 (proef increment 1): DE NIEUWSTE JARVIS OOGSTEN EN VERSPREIDEN -- puur lokaal, geen internet, geen sleutel, geen secret.
# Een rektelefoon met een oude JARVIS (zonder het recht in zijn manifest) kon de kabel-koppeling niet afmaken: 'pm grant WRITE_SECURE_SETTINGS'
# mislukt omdat die oude versie het recht niet in zijn manifest heeft, en hij kan zichzelf niet bijwerken. Oplossing: ARTEMIS leest
# de base.apk van de telefoon die AL de nieuwste JARVIS draait (via 'pm path' + 'adb pull') en de versionCode uit dumpsys, cachet
# die in $JAPK_PLEK/jarvis.apk(+.code), en zet hem met 'adb install -r' (gegevens blijven, zelfde vaste sleutel) op de rektelefoons
# met een oudere versie. NOOIT de F8. Zo hoeft maar EEN telefoon ooit de nieuwe versie te krijgen; de rest volgt vanzelf, zonder dat
# iemand iets in de terminal doet. (Niet op echte toestellen geprobeerd vanuit de bouwomgeving; best-effort met eerlijke meldingen.)
jarvis_apk_code() {   # de versionCode van het JARVIS-pakket op EEN telefoon (leeg = onbekend/niet geïnstalleerd)
  "$ADB" -s "$1" shell dumpsys package "$JARVIS_PKG" 2>/dev/null | sed -n 's/.*versionCode=\([0-9]\{1,\}\).*/\1/p' | head -1 | tr -d '\r'
}
jarvis_apk_versie() {   # 678p: de versionName (1.9.xx) van JARVIS op EEN telefoon (leeg = niet geïnstalleerd)
  "$ADB" -s "$1" shell dumpsys package "$JARVIS_PKG" 2>/dev/null | sed -n 's/.*versionName=\([0-9][0-9.]*\).*/\1/p' | head -1 | tr -d '\r'
}
# 678p: DE VERSIE-REGEL PER TELEFOON. Toont van elke rektelefoon aan de kabel (nooit de F8) welke JARVIS er ECHT op staat
# (versionName + versionCode). Wordt bovenaan de uitkomst van 'Telefoon klaarzetten' gezet (zodat hij niet uit het korte
# console-log valt) en bewaard in $REK_MAP/klaarzet-versies, zodat Status hem ook laat zien. Alleen lezen (dumpsys).
JARVIS_VERSIES_F="$REK_MAP/klaarzet-versies"
jarvis_versies() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  local s id naam v c n=0 regel alles=""
  for s in $(verbonden); do
    case "$s" in *:*) continue ;; esac                      # alleen de kabel
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"; naam="${naam:-$id}"
    v="$(jarvis_apk_versie "$s")"; c="$(jarvis_apk_code "$s")"
    if [ -n "$v" ]; then regel="  $naam: JARVIS $v (code ${c:-?})"; else regel="  $naam: JARVIS niet geïnstalleerd"; fi
    zeg "$regel"; alles="$alles$regel"$'\n'; n=$((n+1))
  done
  [ "$n" -gt 0 ] || zeg "  (geen rektelefoon aan de kabel; sluit er een aan en druk op 'Zoek telefoons')"
  printf '%s' "$alles" > "$JARVIS_VERSIES_F" 2>/dev/null || true
}
# 598b/599: BOOTSTRAP zonder dat één telefoon al de nieuwe versie heeft -- ARTEMIS installeert een jarvis.apk die je op de CHROMEBOOK
# downloadde (de JARVIS-downloadlink in Chrome). Een bestand dat op 'jarvis' begint en op '.apk' eindigt (dus ook 'jarvis (1).apk',
# wat Chrome maakt bij een tweede download), uit je eigen downloadmap; we kopiëren de NIEUWSTE naar de cache ZONDER versionCode
# (onbekend) en leiden die pas ná een geslaagde install van de telefoon af. VEILIG: Android weigert een neppe JARVIS op de handtekening
# (het pakket bestaat al, met de echte sleutel), dus een install -r die niet onze JARVIS is faalt. Nooit willekeurige *.apk; nooit een
# ander pakket. 599: toont (als er nog geen cache is) WELKE mappen hij doorzocht en wat hij zag -- ook als een map niet bestaat.
# JARVIS_APK_DIR overschrijft de zoekmap (voor de test).
# 678l: DE PAKKET-BRON -- volledig zonder een mens, en DURABEL. Het pakket (gemma-werk/taken/pakket.json, hetzelfde dat de
# telefoons lezen, §367/§487) draagt update.vast = de VASTE §499-serverlink (server/gemmaWerk.js:203; die link verloopt NOOIT
# zolang de serversleutel niet wisselt). Zet iemand dus EEN keer de pakket-link (de "LRWERK1 <adres>"-link uit de bijwerk-mail,
# §504) in de console bij "APK-link", dan leest ARTEMIS daaruit de durabele §499-link en bewaart die als apk-link -- vanaf dan
# haalt klaarzetten-auto de nieuwste JARVIS vanzelf, ook na de zeven dagen dat de pakket-link zelf geldig is. De pakket-link
# bevat GEEN sleutel (alleen een presigned leesadres), dus hij mag in ~/.artemis-rek staan (600). Faalt het, dan vallen we terug
# op de rechtstreekse serverlink/release/download-map. De live-fetch is vanuit de bouwomgeving niet te testen (de egress-proxy
# weigert de opslag-host, 403); check_artemis toetst de STRUCTUUR (de extractie van update.vast, de validatie, de volgorde).
jarvis_pakket_bron() {
  local toon="${1:-0}"
  command -v curl >/dev/null 2>&1 || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  if [ ! -s "$REK_MAP/pakket-link" ]; then
    [ "$toon" = 1 ] && [ ! -s "$REK_MAP/apk-link" ] && zeg "  pakket: geen pakket-link ingesteld (optioneel). Plak de \"LRWERK1 <adres>\"-link uit de bijwerk-mail in de console bij \"APK-link\" -- dan leest ARTEMIS daaruit de vaste (niet-verlopende) serverlink."
    return 0
  fi
  local link; link="$(head -1 "$REK_MAP/pakket-link" 2>/dev/null | tr -d '[:space:]')"
  printf '%s' "$link" | grep -Eq '^https://[a-z0-9.-]{3,253}/[A-Za-z0-9._~/%=&?-]*pakket\.json(\?[^ ]*)?$' || { [ "$toon" = 1 ] && zeg "  pakket: de pakket-link heeft niet de vorm https://.../pakket.json?..."; return 0; }
  local js vast
  js="$(curl -fsSL --max-time 60 "$link" 2>>"$REK_MAP/artemis.log")" || { [ "$toon" = 1 ] && zeg "  pakket: het pakket is niet op te halen (netwerk, of de pakket-link is verlopen -- hij geldt 7 dagen)."; return 0; }
  vast="$(printf '%s' "$js" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print((d.get("update") or {}).get("vast",""))
except Exception: print("")' 2>/dev/null)"
  if ! printf '%s' "$vast" | grep -Eq '^https://[a-z0-9.-]{3,253}/jarvis-app/[a-z2-9]{10}$'; then
    [ "$toon" = 1 ] && zeg "  pakket: in het pakket staat (nog) geen vaste serverlink (update.vast). Zonder serversleutel komt die er niet; de rechtstreekse apk-link blijft dan de weg."
    return 0
  fi
  # de durabele §499-link bewaren als apk-link, zodat jarvis_serverlink_bron hem gebruikt. Alleen schrijven als hij wijzigt.
  if [ ! -s "$REK_MAP/apk-link" ] || [ "$(head -1 "$REK_MAP/apk-link" 2>/dev/null | tr -d '[:space:]')" != "$vast" ]; then
    printf '%s\n' "$vast" > "$REK_MAP/apk-link"; chmod 600 "$REK_MAP/apk-link" 2>/dev/null || true
    rm -f "$REK_MAP/apk-link.gecheckt" 2>/dev/null || true   # meteen opnieuw ophalen
    [ "$toon" = 1 ] && zeg "  pakket: de vaste §499-serverlink uit het pakket gehaald en bewaard als apk-link (verloopt niet)."
  fi
}
# 673: haal de nieuwste jarvis.apk van de VASTE §499-serverlink (als die bij de installatie is meegegeven). Zo is er geen
# handmatige download meer nodig: zodra een rektelefoon aan de kabel komt, zet de auto-klaarzet-lus de nieuwste JARVIS erop. De link
# verloopt niet en wijst naar ons eigen domein; Android weigert bij install -r een apk met een andere handtekening, dus een
# vervangen bestand komt er niet op. Rate-limit: hoogstens eens per 6 uur, en met curl -z (conditioneel) zodat een ongewijzigd
# bestand niet opnieuw ~50 MB kost. Een niet-apk (geen PK-zip-magie) of een piepklein antwoord wordt weggegooid.
jarvis_serverlink_bron() {
  # 678k: $1 == 1 => leg in het log/console UIT waarom deze bron faalt (zodat een mens ziet wat eraan scheelt),
  # EN sla de 6-uur-rem over (een knopdruk haalt NU op). Zonder toon: stil en met de rem (de minuut-lus).
  local toon="${1:-0}"
  command -v curl >/dev/null 2>&1 || { [ "$toon" = 1 ] && zeg "  serverlink: curl ontbreekt op deze Chromebook."; return 0; }
  if [ ! -s "$REK_MAP/apk-link" ]; then
    [ "$toon" = 1 ] && zeg "  serverlink: geen apk-link ingesteld (~/.artemis-rek/apk-link is leeg). Plak de §499-downloadlink (https://.../jarvis-app/<code>) in de console bij \"APK-link\" -- dan haalt ARTEMIS de nieuwste apk vanzelf van de server."
    return 0
  fi
  local link; link="$(head -1 "$REK_MAP/apk-link" 2>/dev/null | tr -d '[:space:]')"
  # 678k: twee geldige vormen -- (a) de vaste §499-serverlink (.../jarvis-app/<10 tekens>; server stuurt een 302 naar een presigned
  # leesadres) EN (b) een DIRECTE presigned bucket-link (.../jarvis.apk?X-Amz-...), precies zoals in de bijwerk-mail (§504). Beide
  # worden door curl -fsSL afgehandeld (een redirect volgen, of direct downloaden). Een neppe apk wordt sowieso door Android op de
  # handtekening geweigerd (§497), dus een bredere vorm is veilig.
  if ! { printf '%s' "$link" | grep -Eq '^https://[a-z0-9.-]{3,253}/jarvis-app/[a-z2-9]{10}$' \
      || printf '%s' "$link" | grep -Eq '^https://[a-z0-9.-]{3,253}/[A-Za-z0-9._~/%=&?-]*jarvis\.apk(\?[^ ]*)?$'; }; then
    [ "$toon" = 1 ] && zeg "  serverlink: de ingestelde apk-link heeft niet de vorm https://.../jarvis-app/<code> of https://.../jarvis.apk?... . Plak hem opnieuw in de console bij \"APK-link\"."
    return 0
  fi
  local nu stamp=0 stampf="$REK_MAP/apk-link.gecheckt"
  nu="$(date +%s 2>/dev/null || echo 0)"
  [ -s "$stampf" ] && stamp="$(tr -dc 0-9 < "$stampf" 2>/dev/null || echo 0)"
  if [ "$toon" != 1 ] && [ "$stamp" -gt 0 ] && [ $((nu - stamp)) -lt 21600 ]; then return 0; fi   # de minuut-lus: hoogstens eens per 6 uur; een knopdruk (toon=1) haalt altijd op
  printf '%s\n' "$nu" > "$stampf" 2>/dev/null || true
  local tmp="$REK_MAP/jarvis.apk.srv"   # 678h: de temp in het HOKJE (ext4) -- op de kaart (9p) faalt mv/rename, waardoor de serverlink-apk nooit landde
  # conditioneel tegen een eerdere serverlink-download, zodat een ongewijzigde apk een 304 geeft (geen bytes)
  if [ -s "$tmp" ]; then curl -fsSL --max-time 600 -z "$tmp" -o "$tmp.new" "$link" >>"$REK_MAP/artemis.log" 2>&1 || { rm -f "$tmp.new" 2>/dev/null; [ "$toon" = 1 ] && zeg "  serverlink: de server antwoordde niet (netwerk, of de link is verlopen/ongeldig -- een §499-link blijft geldig zolang de serversleutel niet wisselt)."; return 0; }
  else curl -fsSL --max-time 600 -o "$tmp.new" "$link" >>"$REK_MAP/artemis.log" 2>&1 || { rm -f "$tmp.new" 2>/dev/null; [ "$toon" = 1 ] && zeg "  serverlink: de server antwoordde niet (netwerk, of de link is verlopen/ongeldig -- een §499-link blijft geldig zolang de serversleutel niet wisselt)."; return 0; }; fi
  if [ ! -s "$tmp.new" ]; then [ "$toon" = 1 ] && [ -s "$tmp" ] && zeg "  serverlink: de server heeft dezelfde apk als eerder (niets nieuws op te halen)."; return 0; fi   # 304 (niet gewijzigd) of leeg: niets te doen
  # een echte apk? (ZIP begint met PK\x03\x04) en minstens ~1 MB
  if [ "$(head -c2 "$tmp.new" 2>/dev/null)" != "PK" ] || [ "$(wc -c < "$tmp.new" 2>/dev/null || echo 0)" -lt 1000000 ]; then rm -f "$tmp.new" 2>/dev/null; zeg "  serverlink: gaf geen geldige apk (geen ZIP of te klein); genegeerd. Klopt de §499-link?"; return 0; fi
  mv -f "$tmp.new" "$tmp" 2>/dev/null || return 0   # in het hokje: rename mag
  # alleen oppakken als er nog geen cache is, of de serverlink-apk nieuwer is dan de cache
  if [ -s "$JAPK_PLEK/jarvis.apk" ] && [ ! "$tmp" -nt "$JAPK_PLEK/jarvis.apk" ]; then return 0; fi
  cp -f "$tmp" "$JAPK_PLEK/jarvis.apk" 2>/dev/null || return 0
  rm -f "$JAPK_PLEK/jarvis.apk.code" 2>/dev/null || true   # onbekende versionCode: na de install afgeleid
  chmod 600 "$JAPK_PLEK/jarvis.apk" 2>/dev/null || true
  zeg "Nieuwste JARVIS via de serverlink opgehaald -- ik zet hem op de rektelefoons met een oudere versie (Android weigert een neppe op de handtekening)."
}
# 678h: terugval als de serverlink NIET is ingesteld -- de nieuwste jarvis.apk uit de jarvis-updates-RELEASE via de GitHub-API.
# De release-repo is PRIVÉ (de bouw-workflow weigert een openbare), dus een EIGEN lees-token is nodig (fine-grained, Contents read;
# precies zoals de telefoons in §497). NOOIT in de code of op Pages: token uit ARTEMIS_UPDATE_TOKEN of ~/.artemis-rek/update-token,
# repo uit ARTEMIS_UPDATE_REPO of ~/.artemis-rek/update-repo. De apk wordt op de sha256 uit versie.json gecontroleerd; via het hokje
# (mv) en dan met cp naar de (kaart-)plek -- nooit mv op de kaart (9p).
jarvis_release_bron() {
  # 678k: $1 == 1 => leg per stap uit waarom de release-bron niets oplevert (token/repo/404/sha).
  local toon="${1:-0}"
  command -v curl >/dev/null 2>&1 || { [ "$toon" = 1 ] && zeg "  release: curl ontbreekt op deze Chromebook."; return 0; }
  command -v python3 >/dev/null 2>&1 || { [ "$toon" = 1 ] && zeg "  release: python3 ontbreekt op deze Chromebook."; return 0; }
  [ -s "$JAPK_PLEK/jarvis.apk" ] && [ ! -s "$JAPK_PLEK/jarvis.apk.code" ] && return 0   # er ligt al een verse apk
  local tok repo
  tok="${ARTEMIS_UPDATE_TOKEN:-}"; [ -n "$tok" ] || tok="$(head -1 "$REK_MAP/update-token" 2>/dev/null | tr -d '[:space:]')"
  repo="${ARTEMIS_UPDATE_REPO:-}"; [ -n "$repo" ] || repo="$(head -1 "$REK_MAP/update-repo" 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$tok" ] || [ -z "$repo" ]; then
    [ "$toon" = 1 ] && zeg "  release: geen lees-token/repo gezet (de updateplek-repo is PRIVÉ; zonder token kan de apk er niet uit). Zet ~/.artemis-rek/update-token (fine-grained, Contents read) en ~/.artemis-rek/update-repo -- OF gebruik liever de serverlink hierboven (die heeft geen token nodig)."
    return 0
  fi
  printf '%s' "$repo" | grep -Eq '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' || { [ "$toon" = 1 ] && zeg "  release: de repo-naam in ~/.artemis-rek/update-repo is niet de vorm eigenaar/repo."; return 0; }
  local js; js="$(curl -fsSL --max-time 60 -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/releases/latest" 2>>"$REK_MAP/artemis.log")" || { [ "$toon" = 1 ] && zeg "  release: GitHub antwoordde niet (token verlopen/geen toegang, of geen netwerk)."; return 0; }
  local aurl sha
  aurl="$(printf '%s' "$js" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next((a["url"] for a in d.get("assets",[]) if a.get("name")=="jarvis.apk"),""))' 2>/dev/null)"
  sha="$(printf '%s' "$js" | python3 -c 'import sys,json;d=json.load(sys.stdin)
try: print(json.loads(d.get("body","{}")).get("sha256",""))
except Exception: print("")' 2>/dev/null)"
  [ -n "$aurl" ] || { [ "$toon" = 1 ] && zeg "  release: de nieuwste release heeft geen bijlage jarvis.apk."; return 0; }
  local tmp="$REK_MAP/jarvis.apk.rel"
  curl -fsSL --max-time 600 -H "Authorization: Bearer $tok" -H "Accept: application/octet-stream" -o "$tmp.new" "$aurl" >>"$REK_MAP/artemis.log" 2>&1 || { rm -f "$tmp.new" 2>/dev/null; [ "$toon" = 1 ] && zeg "  release: het downloaden van de apk mislukte (token/netwerk)."; return 0; }
  { [ -s "$tmp.new" ] && [ "$(head -c2 "$tmp.new" 2>/dev/null)" = "PK" ]; } || { rm -f "$tmp.new" 2>/dev/null; [ "$toon" = 1 ] && zeg "  release: wat binnenkwam was geen geldige apk."; return 0; }
  if [ -n "$sha" ] && command -v sha256sum >/dev/null 2>&1; then
    local echt; echt="$(sha256sum "$tmp.new" 2>/dev/null | cut -d' ' -f1)"
    [ "$echt" = "$sha" ] || { rm -f "$tmp.new" 2>/dev/null; zeg "  release: apk klopt niet met de controlesom (sha256); genegeerd."; return 0; }
  fi
  mv -f "$tmp.new" "$tmp" 2>/dev/null || return 0   # in het hokje: rename mag
  cp -f "$tmp" "$JAPK_PLEK/jarvis.apk" 2>/dev/null || return 0   # cp naar de (kaart-)plek; NOOIT mv (9p)
  rm -f "$JAPK_PLEK/jarvis.apk.code" 2>/dev/null || true
  chmod 600 "$JAPK_PLEK/jarvis.apk" 2>/dev/null || true
  zeg "Nieuwste JARVIS uit de release opgehaald (controlesom klopt) -- ik zet hem via de kabel op de rektelefoons met een oudere versie."
}
jarvis_download_bron() {
  # 678k: $1 == 1 => een mens drukte op een knop; leg per bron (serverlink/release/download-map) uit waarom hij niets oplevert.
  # Zonder toon (de minuut-lus) blijft het stil, maar als er GEEN apk is zetten we toon alsnog op 1 zodat het log de reden toont.
  local d bron='' nieuwste='' found toon="${1:-0}"
  [ -s "$JAPK_PLEK/jarvis.apk" ] || toon=1   # geen apk klaar: altijd de reden tonen (ook in de lus -- precies de klacht van de eigenaar: welke bron faalde en waarom)
  jarvis_pakket_bron "$toon"       # 678l: als er een pakket-link staat, daaruit de durabele §499-serverlink halen en als apk-link bewaren
  jarvis_serverlink_bron "$toon"   # 673: eerst de vaste serverlink proberen (geen handmatige download nodig)
  [ -s "$JAPK_PLEK/jarvis.apk" ] || jarvis_release_bron "$toon"   # 678h: geen serverlink/apk? probeer de privé release via een lees-token
  for d in "${JARVIS_APK_DIR:-}" "/mnt/chromeos/MyFiles/Downloads" "$HOME/Downloads" "$HOME/Linux files" "$HOME"; do
    [ -n "$d" ] || continue
    if [ ! -d "$d" ]; then [ "$toon" = 1 ] && zeg "  zoek in $d: map bestaat niet (niet gedeeld met Linux?)"; continue; fi
    nieuwste="$(ls -1t "$d"/jarvis*.apk 2>/dev/null | head -1)"
    if [ -n "$nieuwste" ]; then
      found="$(cd "$d" 2>/dev/null && ls -1 jarvis*.apk 2>/dev/null | tr '\n' ',' | sed 's/,$//')"
      [ "$toon" = 1 ] && zeg "  zoek in $d: gevonden ${found}"
      [ -z "$bron" ] && bron="$nieuwste"   # eerste map met een treffer (volgorde = voorkeur), nieuwste bestand daarin
    else
      [ "$toon" = 1 ] && zeg "  zoek in $d: geen jarvis*.apk"
    fi
  done
  if [ -z "$bron" ]; then
    if [ "$toon" = 1 ]; then
      zeg "Geen nieuwere JARVIS-apk te vinden. Snelste weg, kies er één:"
      zeg "  1) De vaste downloadlink (§499) in ~/.artemis-rek/apk-link zetten (of in Veronica plakken) -- dan haalt ARTEMIS de nieuwste apk vanzelf van de server."
      zeg "  2) Een lees-token (fine-grained, Contents read op de updateplek-repo) in ~/.artemis-rek/update-token en de repo-naam in ~/.artemis-rek/update-repo -- dan haalt ARTEMIS hem rechtstreeks uit de release."
      zeg "  3) De JARVIS-apk met de hand op de Chromebook downloaden naar Downloads (deel die map met Linux)."
    fi
    return 0
  fi
  # alleen oppakken als er nog geen cache is, of de download NIEUWER is dan de cache (mtime) -- een stale oude download overschrijft nooit.
  if [ -s "$JAPK_PLEK/jarvis.apk" ] && [ ! "$bron" -nt "$JAPK_PLEK/jarvis.apk" ]; then return 0; fi
  cp -f "$bron" "$JAPK_PLEK/jarvis.apk" 2>/dev/null || { zeg "Kon $bron niet kopiëren."; return 0; }
  rm -f "$JAPK_PLEK/jarvis.apk.code" 2>/dev/null || true   # onbekende versionCode: jarvis_bijwerk_een leidt hem na de install af
  chmod 600 "$JAPK_PLEK/jarvis.apk" 2>/dev/null || true
  zeg "Gedownloade JARVIS gevonden: $bron -- ik zet hem op de rektelefoons met een oudere versie (Android weigert een neppe op de handtekening)."
}
jarvis_oogst() {
  command -v "$ADB" >/dev/null 2>&1 || return 0
  jarvis_download_bron "${1:-0}"   # 598b: eerst een op de Chromebook gedownloade jarvis.apk oppakken (bootstrap zonder dat een telefoon al de nieuwe versie heeft); 678k: toon door naar de bronnen
  # een verse download (apk zonder bekende code) vertrouwen we als de nieuwste: NIET overschrijven met een (mogelijk oudere) telefoon-apk.
  [ -s "$JAPK_PLEK/jarvis.apk" ] && [ ! -s "$JAPK_PLEK/jarvis.apk.code" ] && return 0
  local s id code pad='' best_code=0 best_s=''
  # de cache telt mee als ondergrens: we oogsten alleen iets dat STRIKT nieuwer is dan wat er al klaarligt.
  [ -s "$JAPK_PLEK/jarvis.apk" ] && [ -s "$JAPK_PLEK/jarvis.apk.code" ] && best_code="$(tr -dc 0-9 < "$JAPK_PLEK/jarvis.apk.code")"
  case "$best_code" in ''|*[!0-9]*) best_code=0 ;; esac
  for s in $(verbonden); do
    id="$(toestel_id "$s")"; [ -n "$id" ] || continue
    toegestaan "$id" || continue
    is_f8 "$s" && continue
    code="$(jarvis_apk_code "$s")"
    case "$code" in ''|*[!0-9]*) continue ;; esac
    if [ "$code" -gt "$best_code" ]; then best_code="$code"; best_s="$s"; fi
  done
  [ -n "$best_s" ] || return 0   # niemand heeft iets nieuwers dan de cache
  pad="$("$ADB" -s "$best_s" shell pm path "$JARVIS_PKG" 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | grep -i 'base\.apk' | head -1)"
  [ -n "$pad" ] || pad="$("$ADB" -s "$best_s" shell pm path "$JARVIS_PKG" 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | head -1)"
  [ -n "$pad" ] || return 0
  if "$ADB" -s "$best_s" pull "$pad" "$JAPK_PLEK/jarvis.apk.nieuw" >/dev/null 2>&1 && [ -s "$JAPK_PLEK/jarvis.apk.nieuw" ]; then
    cp -f "$JAPK_PLEK/jarvis.apk.nieuw" "$JAPK_PLEK/jarvis.apk" && rm -f "$JAPK_PLEK/jarvis.apk.nieuw"   # 678f: cp+rm i.p.v. mv -- $JAPK_PLEK kan op de kaart staan en 9p ondersteunt geen rename
    printf '%s\n' "$best_code" > "$JAPK_PLEK/jarvis.apk.code"
    chmod 600 "$JAPK_PLEK/jarvis.apk" 2>/dev/null || true
    zeg "Nieuwste JARVIS geoogst van $(toestel_naam "$best_s") (versionCode $best_code); klaar om op de andere rektelefoons te zetten."
  else
    rm -f "$JAPK_PLEK/jarvis.apk.nieuw" 2>/dev/null || true
  fi
}
# installeert de klaarliggende/geoogste nieuwste JARVIS op EEN telefoon als die ouder is (NOOIT de F8). 0 = telefoon draait nu de
# nieuwste (al goed, of net bijgewerkt); 1 = kon niet bijwerken (geen apk, of install faalde). Alleen -r (gegevens blijven), alleen $JARVIS_PKG.
jarvis_bijwerk_een() {
  local s="$1" naam="$2" apkcode='' opcode='' uit='' nieuw=''
  is_f8 "$s" && return 1
  [ -s "$JAPK_PLEK/jarvis.apk" ] || return 1
  opcode="$(jarvis_apk_code "$s")"
  if [ -s "$JAPK_PLEK/jarvis.apk.code" ]; then
    apkcode="$(tr -dc 0-9 < "$JAPK_PLEK/jarvis.apk.code")"
    case "$apkcode" in *[!0-9]*) apkcode='' ;; esac
  fi
  # bekende code en de telefoon is al gelijk of nieuwer: niets doen.
  if [ -n "$apkcode" ] && [ -n "$opcode" ] && [ "$opcode" -ge "$apkcode" ]; then return 0; fi
  # install -r: gegevens blijven, alleen onze JARVIS (Android weigert een andere handtekening op hetzelfde pakket). 598b: een
  # gedownloade apk heeft nog geen bekende code -- die leiden we hierna van de telefoon af.
  uit="$("$ADB" -s "$s" install -r "$JAPK_PLEK/jarvis.apk" 2>&1)"
  if printf '%s' "$uit" | grep -qi 'Success'; then
    nieuw="$(jarvis_apk_code "$s")"
    [ -n "$nieuw" ] && printf '%s\n' "$nieuw" > "$JAPK_PLEK/jarvis.apk.code"   # onbekende code na de install afgeleid
    BIJWERK_GEDAAN=1   # 678m: echt bijgewerkt -> klaarzetten zet er daarna Tailscale op (nooit de F8)
    zeg "$naam: JARVIS bijgewerkt naar versionCode ${apkcode:-${nieuw:-onbekend}} (was ${opcode:-onbekend})."
    return 0
  fi
  # downgrade / al aanwezig = de telefoon heeft al een gelijke of nieuwere versie: geen fout. Leg de code van de telefoon vast zodat
  # een onbekende (gedownloade) apk-cache niet blijft proberen en de oogst weer op versionCode kan vergelijken.
  if printf '%s' "$uit" | grep -qiE 'VERSION_DOWNGRADE|ALREADY_EXISTS|newer version'; then
    [ -z "$apkcode" ] && [ -n "$opcode" ] && printf '%s\n' "$opcode" > "$JAPK_PLEK/jarvis.apk.code"
    return 0
  fi
  zeg "$naam: JARVIS bijwerken lukte niet ($(printf '%s' "$uit" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-120))."
  return 1
}
# 590 (stap 78 van de lijst): WAAKHOND ZONDER AI -- gewoon adb. Per rektelefoon (NOOIT de F8, NOOIT een niet-toegestane):
# (1) kijkt of JARVIS draait en start hem anders; (2) houdt de batterij op Onbeperkt (geen doze/standby); (3) installeert een
# nieuwere JARVIS als er een klaarligt. Raakt UITSLUITEND het JARVIS-pakket ($JARVIS_PKG) aan -- nooit een bank-, betaal-,
# wachtwoord- of authenticator-app, nooit een force-stop van iets anders. Dat is de veiligheidskern en er staat een test op.
jarvis_waak() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  [ -s "$TOEG" ] || { zeg "Geen rektelefoon op de lijst (sluit er een aan + USB-foutopsporing)."; return 0; }
  jarvis_oogst   # 598: eerst de nieuwste JARVIS oogsten van een telefoon die hem al heeft
  local s id naam draait any=0
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
    # (3) 598: een nieuwere JARVIS installeren ALS er een klaarligt (geoogst of neergezet). Alleen -r (behoudt gegevens); alleen het
    # JARVIS-pakket; nooit de F8. jarvis_bijwerk_een raadt nooit: zonder apk + .code doet hij niets.
    jarvis_bijwerk_een "$s" "$naam"
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
            'RESOURCE_EXHAUSTED', 'quota', 'API key not valid', 'update your code', 'models/gemini', 'error',
            # 592o: time-outs en lege/afgebroken antwoorden horen ook bij "waarom faalde de taak".
            'timeout', 'timed out', 'deadline', 'DEADLINE_EXCEEDED', 'took too long', 'max steps', 'no action',
            'empty response', 'no tool', 'could not parse', 'failed to parse', 'unavailable', 'closed connection']
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
    local gem_aan=0; [ -f "$GEM_AAN_F" ] && gem_aan=1
    python3 - "$lm_model" "$gem_aan" >"$REK_MAP/artemis.jsonc" <<'PY'
import json, sys
m = sys.argv[1]
gem = sys.argv[2] == "1"      # 678: Gemini UIT = GEEN Google-terugval in de config (ARTEMIS belt Google anders zelf, buiten de proxy om)
def lok(temp=None):
    d = {"provider": "openai", "model": m}
    if gem: d["fallback"] = {"provider": "google", "model": "gemini-3.8-flash", "thinking_level": "medium"}
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
  elif [ ! -f "$GEM_AAN_F" ]; then
    # 678: geen lokaal model EN Gemini uit: een config zonder ENIG Google-model (start_kern weigert dan sowieso te starten).
    cat >"$REK_MAP/artemis.jsonc" <<'JSONC'
{
  // 678: Gemini staat UIT en er is geen lokaal model gekozen; dit is een lege config zonder Google. Kies 'Lokaal model' of zet Gemini aan.
  "default": { "provider": "openai", "model": "geen-lokaal-model" }
}
JSONC
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
# 592h: schrijf de vertaal-/vangnet-proxy (puur stdlib). start_kern start hem alleen als er een lokaal model is, en zet
# ARTEMIS' OPENAI_BASE_URL op deze proxy i.p.v. rechtstreeks op de telefoon. De proxy stuurt elke /v1/-aanroep door naar het
# echte model, maar herschrijft het ANTWOORD: tekst-acties -> structurele tool_calls, en een vangnet dat gevaarlijke acties
# nooit doorlaat. De ENE plek die het bestand schrijft (idempotent, elke start opnieuw, zodat updates vanzelf landen).
schrijf_artemis_proxy() {
  cat >"$PROXYF" <<'PROXY'
#!/usr/bin/env python3
# 592h: ARTEMIS <-> lokaal model (OlliteRT/Gemma) vertaal- en vangnet-proxy. ALLEEN 127.0.0.1.
# - Gemma geeft een actie vaak als TEKST terug ("call:click{target: 'NOODSTOP'}", JS-achtige args). ARTEMIS' tekst-parser
#   liep daarop vast. De proxy zet zulke tekst om naar een ECHTE OpenAI-tool_call (valide JSON-args) in choices[0].message.
#   tool_calls -- dan leest ARTEMIS de actie structureel en raakt de fragiele tekst-parser nooit.
# - VANGNET (altijd): nooit een tik op een knop met NOODSTOP/Stop/Verwijder/Delete/Uninstall, en nooit openen/tikken in
#   bank-/kluis-/authenticator-/betaal-/crypto-apps -- wat het model ook kiest. Geblokkeerde acties worden NIET doorgegeven.
# - ALLEEN-KIJKEN (vlag): dan mag ALLEEN Home ingedrukt worden; elke andere apparaat-actie wordt geblokkeerd.
import os, re, json, sys, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

POORT = int(os.environ.get('PROXY_POORT', '8792'))
F8_BASE = (os.environ.get('F8_BASE', '') or '').rstrip('/')          # het LAN-adres van het model, bv. http://<telefoon-ip>:8000/v1
F8_TOKEN = os.environ.get('F8_TOKEN', 'local') or 'local'
# 592h: de alleen-kijken-stand lezen we LIVE uit het bestaan van een bestand, zodat de console-knop meteen werkt zonder herstart.
ALLEEN_KIJKEN_FILE = os.environ.get('ALLEEN_KIJKEN_FILE', '')
def alleen_kijken():
    return bool(ALLEEN_KIJKEN_FILE and os.path.exists(ALLEEN_KIJKEN_FILE))
BLOKLOG = os.environ.get('PROXY_LOG', '')
# 592i: het kleine model (OlliteRT/Gemma op de F8) sluit de verbinding als de vraag te groot is (lange systeemprompt + veel
# geschiedenis + een schermbeeld). We cappen de GEVRAAGDE uitvoer-tokens en krimpen de vraag; bij een afgesloten verbinding
# proberen we het n keer kleiner. OUT_CAP = hoeveel tokens het model hoogstens mag teruggeven (een actie is kort).
OUT_CAP = int(os.environ.get('PROXY_OUT_CAP', '2048'))

# 592L: de vangnet-proxy houdt een GEORDENDE reserve-lijst van modellen bij en kiest per verzoek automatisch het EERSTE
# bereikbare model, met de vangnet-regels rondom ELK model. Volgorde: F8 (lokaal, slimste bereikbaar) -> reserve-telefoons met
# dezelfde E4B (lokaal, LAN) -> Gemini (gemini-3.8-flash, dan gemini-3.6-flash). Per verzoek opnieuw, dus zodra de F8 weer
# antwoordt gaat het vanzelf terug. Geen aankopen: Gemini is de bestaande gratis AIza-sleutel van ARTEMIS.
GEMINI_KEY = os.environ.get('GEMINI_KEY', '') or ''
GEMINI_BASE = (os.environ.get('GEMINI_BASE', 'https://generativelanguage.googleapis.com/v1beta/openai') or '').rstrip('/')
GEMINI_MODELLEN = os.environ.get('GEMINI_MODELLEN', 'gemini-3.8-flash,gemini-3.6-flash')
ACTIEF_FILE = os.environ.get('PROXY_ACTIEF_FILE', '')   # hier noteren we welk model nu antwoordt (Status leest dit)
# 592o/§164: een lokale telefoon die NIET bereikbaar is (de F8 of een rektelefoon weg: No route to host) wordt BREAKER_S seconden
# overgeslagen -- een DODE TELEFOON 30 s overslaan (besluit van de eigenaar, 1 nov) -- zodat niet elke stap opnieuw ~9 s op een dode telefoon wacht
# en de keten meteen door kan naar de volgende (F8 -> rektelefoon -> Gemini). Gemini krijgt een eigen time-out zodat een trage stap
# faalt i.p.v. 351 s te hangen.
BREAKER_S = int(os.environ.get('PROXY_BREAKER_S', '30') or '30')
GEMINI_TIMEOUT = int(os.environ.get('PROXY_GEMINI_TIMEOUT', '90') or '90')

# 678: HARDE GEMINI-BEWAKING. Gemini is het enige dat geld kan kosten of op een limiet loopt. Per verzoek wordt dit gepoort: de vlag moet AAN staan (bestand
# gemini-aan), de sleutel moet een AI Studio-sleutel zijn (AIza..., geen Vertex), er is een dagplafond, en na een 429 of 503 wordt er NIET herhaald maar
# gestopt (gemini-stop) zodat de keten terug naar lokaal valt. Alle toestand staat in bestanden naast artemis-rek, zodat de console-knop het zonder herstart zet.
import time as _gt
GEMINI_DIR = os.environ.get('GEMINI_STAAT_DIR', '') or ''
GEMINI_MAX_DAG = int(os.environ.get('GEMINI_MAX_DAG', '20') or '20')
def _gpad(n):
    return os.path.join(GEMINI_DIR, n) if GEMINI_DIR else ''
def _g_lees(n):
    try:
        with open(_gpad(n)) as f:
            return f.read().strip()
    except Exception:
        return ''
def _g_dag():
    d = _g_lees('gemini-dag').split()
    return int(d[1]) if len(d) == 2 and d[0] == _gt.strftime('%Y-%m-%d') and d[1].isdigit() else 0
def _g_tel():
    n = _g_dag() + 1   # EERST lezen: open(..., 'w') leegt het bestand, anders telt het altijd 1 en doet het dagplafond niets
    try:
        with open(_gpad('gemini-dag'), 'w') as f:
            f.write(_gt.strftime('%Y-%m-%d') + ' ' + str(n))
    except Exception:
        pass
def _g_stop(seconden):
    try:
        with open(_gpad('gemini-stop'), 'w') as f:
            f.write(str(int(_gt.time()) + int(seconden)))
    except Exception:
        pass
def _gemini_mag():
    # (mag, reden). Elke weigering is een reden in gewone taal voor de log.
    if not GEMINI_DIR or not GEMINI_KEY:
        return False, 'geen sleutel of geen staatmap'
    if not os.path.exists(_gpad('gemini-aan')):
        return False, 'Gemini staat uit'
    if not GEMINI_KEY.startswith('AIza'):
        return False, 'geen AI Studio-sleutel (AIza...)'
    st = _g_lees('gemini-stop')
    if st.isdigit() and int(st) > _gt.time():
        return False, 'gestopt na een 429/503'
    if _g_dag() >= GEMINI_MAX_DAG:
        return False, 'dagplafond bereikt (' + str(GEMINI_MAX_DAG) + ')'
    return True, ''
_KAPOT = {}   # base -> tijd tot wanneer dit lokale model wordt overgeslagen
REDEN_FILE = os.environ.get('PROXY_REDEN_FILE', '')   # 592o: de laatste echte reden van een mislukt verzoek (Status leest dit)

# 592p: de F8 (gast-brein) hangt thuis op het LAN en krijgt bij een ander wifi een ANDER IP. Dan is F8_BASE dood ("No route to
# host") en zou de proxy naar Gemini vallen. Daarom: als de F8 een LAN-adres is en onbereikbaar blijkt, scant de proxy het eigen
# subnet op /v1/models met een Gemma-model (E4B/vision), onthoudt het nieuwe adres en gebruikt dat -- NOOIT Gemini zolang de F8 te
# vinden is. F8_LAN=1 zet dit aan (alleen voor een LAN-adres, niet voor 127.0.0.1 via adb). De test geeft F8_SCAN_HOSTS expliciet.
F8_LAN = (os.environ.get('F8_LAN', '') or '') == '1'
F8_SCAN_POORTEN = [int(p) for p in (os.environ.get('F8_SCAN_POORTEN', '8000').split(',')) if p.strip().isdigit()] or [8000]
F8_SCAN_HOSTS = (os.environ.get('F8_SCAN_HOSTS', '') or '').strip()     # expliciete hostlijst (voor de test); leeg = uit F8_SUBNETTEN afleiden
F8_SUBNETTEN = (os.environ.get('F8_SUBNETTEN', '') or '').strip()      # /24-prefixes van de Chromebook (bv. "192.168.178."), door start_proxy gezet -- zo staat er GEEN vast IP in de code
F8_MODEL_HINT = os.environ.get('F8_MODEL_HINT', r'e4b|e2b|gemma|3n|vision|4b|3\.?8b')
F8_GEVONDEN_FILE = os.environ.get('F8_GEVONDEN_FILE', '')              # hier onthouden we het teruggevonden LAN-adres (Status leest dit)

def _backends():
    lijst = []
    if F8_BASE:
        lijst.append({'naam': 'F8', 'soort': 'lokaal', 'base': F8_BASE, 'token': F8_TOKEN, 'model': None})
    try:
        # PROXY_RESERVE: JSON-lijst reserve-telefoons met dezelfde E4B op het LAN, bv. [{"naam":"Cat","base":"http://ip:8081/v1","token":"<rij-code>"}]
        for r in json.loads(os.environ.get('PROXY_RESERVE', '') or '[]'):
            if isinstance(r, dict) and r.get('base'):
                lijst.append({'naam': r.get('naam', 'rektelefoon'), 'soort': 'lokaal',
                              'base': str(r['base']).rstrip('/'), 'token': r.get('token', 'local'), 'model': r.get('model')})
    except Exception:
        pass
    if _gemini_mag()[0]:   # 678: de harde bewaking, per verzoek
        for m in [x.strip() for x in GEMINI_MODELLEN.split(',') if x.strip()]:
            lijst.append({'naam': 'Gemini:' + m, 'soort': 'gemini', 'base': GEMINI_BASE, 'token': GEMINI_KEY, 'model': m})
    return lijst

def _noteer_actief(be):
    # welk model antwoordde het laatst (Status/Veronica leest dit); nooit de sleutel, alleen de naam.
    if ACTIEF_FILE:
        try:
            with open(ACTIEF_FILE, 'w') as f:
                f.write(be.get('naam', '?'))
        except Exception:
            pass
    _notuleer('[actief] ' + be.get('naam', '?'))

def _leesactief():
    try:
        with open(ACTIEF_FILE) as f:
            return f.read().strip()
    except Exception:
        return ''

# 592p: de F8 op het LAN terugvinden na een IP-wissel. We scannen het eigen subnet (of de expliciete F8_SCAN_HOSTS) op poort
# 8000 en vragen /v1/models; het EERSTE adres dat een Gemma-model (E4B/vision) meldt, is de nieuwe F8. Geen mDNS-afhankelijkheid
# (gastnetten blokkeren dat vaak); een kale TCP-scan + /v1/models werkt overal. Alleen aangeroepen als F8_LAN aan staat.
def _scan_hosts():
    # expliciete hosts (test) of de /24-prefixes die start_proxy uit de eigen LAN-adressen afleidde. Geen vast IP in de code.
    if F8_SCAN_HOSTS:
        return [h.strip() for h in F8_SCAN_HOSTS.split(',') if h.strip()]
    hosts = []
    for pre in [p.strip() for p in F8_SUBNETTEN.split(',') if p.strip()]:
        if not pre.endswith('.'):
            pre = pre + '.'
        hosts += [pre + str(n) for n in range(1, 255)]
    return hosts

def _poort_open(host, poort, t=0.4):
    import socket
    try:
        s = socket.create_connection((host, poort), timeout=t); s.close(); return True
    except Exception:
        return False

def _f8_hier(host, poort):
    # geeft de base terug als hier een Gemma-model (E4B/vision) antwoordt op /v1/models, anders None
    base = 'http://%s:%d/v1' % (host, poort)
    try:
        raw = _naar_model(base, F8_TOKEN, '/models', None, False, timeout=3)
        ids = re.findall(r'"id"\s*:\s*"([^"]+)"', raw.decode('utf-8', 'replace'))
        if any(re.search(F8_MODEL_HINT, i, re.I) for i in ids):
            return base
    except Exception:
        return None
    return None

def _vind_f8_lan():
    if not F8_LAN:
        return None
    import concurrent.futures
    hosts = _scan_hosts()
    if not hosts:
        return None
    primair = F8_SCAN_POORTEN[0]
    open_hosts = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=64) as ex:
            for h, res in zip(hosts, ex.map(lambda x: _poort_open(x, primair), hosts)):
                if res:
                    open_hosts.append(h)
    except Exception:
        open_hosts = [h for h in hosts if _poort_open(h, primair)]
    for h in open_hosts:
        for p in F8_SCAN_POORTEN:
            base = _f8_hier(h, p)
            if base:
                _notuleer('[f8] Gemma gevonden op ' + base)
                return base
    return None

def _zet_f8_base(nieuw):
    # onthoud het nieuwe LAN-adres (module-breed + op schijf, zodat Status en een herstart het meteen gebruiken)
    global F8_BASE
    F8_BASE = nieuw.rstrip('/')
    if F8_GEVONDEN_FILE:
        try:
            with open(F8_GEVONDEN_FILE, 'w') as f:
                f.write(F8_BASE)
        except Exception:
            pass

# apparaat-acties van ARTEMIS (action_manifest): die kunnen het toestel VERANDEREN.
DEVICE_ACTIES = {'click', 'click_sequence', 'long_press', 'input_text', 'swipe', 'press_key', 'manage_app',
                 'open_link', 'erase_one_char', 'focus_and_clear_text', 'tap', 'type', 'scroll'}
# knop-labels die NOOIT aangetikt mogen worden (hele-woord, accent-/hoofdletterongevoelig).
VERBODEN_LABEL = re.compile(r'(?<![a-z0-9])(noodstop|nood[ -]?stop|stop|verwijder(?:en)?|delete|uninstall|'
                            r'deinstallier\w*|wis(?:sen)?|erase|remove|afsluiten|force[ -]?stop|forceer[ -]?stop|'
                            r'reset|factory)(?![a-z0-9])', re.I)
# app-/doel-woorden die bank/kluis/authenticator/betaal/crypto aanduiden -- nooit openen of in tikken.
VERBODEN_APP = re.compile(r'(bank|abn|amro|rabo|\bing\b|\bsns\b|\basn\b|bunq|regiobank|knab|revolut|wise|paypal|tikkie|'
                          r'ideal|creditcard|master ?card|\bvisa\b|betaal|payment|google ?pay|apple ?pay|\bwallet\b|'
                          r'authenticator|\bauthy\b|2fa|\botp\b|microsoft authenticator|bitwarden|lastpass|1password|'
                          r'keepass|dashlane|wachtwoord|password|\bvault\b|kluis|digid|crypto|coinbase|binance|kraken|'
                          r'metamask|ledger|trezor|bitcoin|ethereum|blockchain|\bbtc\b|\beth\b)', re.I)
HOME_WAARDEN = {'home', 'keycode_home', 'home_key', '3', 'go_home', 'navigate_home'}

def _norm(name):
    return (name or '').split(':')[-1].strip()

def _notuleer(regel):
    if not BLOKLOG:
        return
    try:
        with open(BLOKLOG, 'a') as f:
            f.write(regel.rstrip() + '\n')
    except Exception:
        pass

def _tolerant_args(s):
    # s is "{...}" in JS-achtige vorm; maak er een dict van. Eerst echte JSON, anders key:value's eruit halen.
    s = (s or '').strip()
    if not s:
        return {}
    try:
        return json.loads(s)
    except Exception:
        pass
    inner = s[1:-1] if s.startswith('{') and s.endswith('}') else s
    d = {}
    for m in re.finditer(r"""([A-Za-z_][\w]*)\s*[:=]\s*('[^']*'|"[^"]*"|[^,}\n]+)""", inner):
        k = m.group(1); v = m.group(2).strip()
        if (v.startswith("'") and v.endswith("'")) or (v.startswith('"') and v.endswith('"')):
            v = v[1:-1]
        else:
            low = v.lower()
            if low in ('true', 'false'):
                v = (low == 'true')
            else:
                try:
                    v = int(v)
                except Exception:
                    try:
                        v = float(v)
                    except Exception:
                        pass
        d[k] = v
    return d

def _uit_tekst(content):
    # haal "call:NAME{...}" acties uit de tekst (ook binnen ``` ``` of met whitespace). geeft [(name, argsdict), ...]
    uit = []
    if not content:
        return uit
    for m in re.finditer(r'call\s*:\s*([A-Za-z_][\w:]*)\s*(\{[^{}]*\})?', content):
        uit.append((_norm(m.group(1)), _tolerant_args(m.group(2) or '{}')))
    return uit

def _argwaarden(args):
    out = []
    def loop(v):
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                loop(x)
        elif isinstance(v, list):
            for x in v:
                loop(x)
    loop(args)
    return ' '.join(out)

def _verboden_reden(name, args):
    # geeft een reden-string als deze actie GEBLOKKEERD moet worden, anders None.
    tekst = _argwaarden(args)
    if name in ('manage_app',):
        if re.search(r'(uninstall|verwijder|delete|remove|stop|force|clear|disable|wis|deinstall)', tekst, re.I):
            return 'manage_app met een gevaarlijke actie (stop/uninstall/clear)'
        if VERBODEN_APP.search(tekst):
            return 'manage_app op een bank-/kluis-/betaal-/crypto-app'
        return None
    if name in ('click', 'click_sequence', 'long_press', 'tap', 'input_text', 'type', 'open_link'):
        if VERBODEN_LABEL.search(tekst):
            return 'knop/label met NOODSTOP/Stop/Verwijder/Delete/Uninstall'
        if VERBODEN_APP.search(tekst):
            return 'bank-/kluis-/authenticator-/betaal-/crypto-app'
    return None

def _is_home(name, args):
    n = (name or '').lower()
    if n in ('press_home', 'go_home', 'navigate_home', 'home'):
        return True
    if n in ('press_key', 'press_button', 'keyevent'):
        tekst = _argwaarden(args).strip().lower()
        return any(w in HOME_WAARDEN or 'home' in w for w in re.split(r'[\s,]+', tekst) if w) or 'home' in tekst
    return False

# 592q: in alleen-kijken-stand drukt een klein model (OlliteRT/Gemma op de F8) soms eindeloos op Home en beschrijft het scherm
# nooit -- de taak liep vast in een lus tot een mens hem stopte (gemeten op een rektelefoon). De proxy telt daarom de Home-drukken PER TAAK:
# na de EERSTE Home geeft hij de opdracht terug om te beschrijven en af te ronden; een TWEEDE Home voert hij NIET nog eens uit maar
# rondt de taak netjes af met wat er op het laatste scherm te zien was. De teller gaat terug zodra het model iets anders doet
# (beschrijven) of zodra er een nieuwe taak begint (andere eerste gebruikersvraag).
_HOME_TEL = 0
_HOME_TAAK = None
HOME_INSTRUCTIE = ('Home is gedaan. Beschrijf nu in TEKST wat je op het scherm ziet en rond daarna af '
                   '(zeg "finish" of "done"). Druk NIET opnieuw op Home.')
def _taak_sleutel(body):
    try:
        for m in (body or {}).get('messages') or []:
            if (m or {}).get('role') == 'user':
                c = m.get('content')
                if isinstance(c, list):
                    c = ' '.join(x.get('text', '') for x in c if isinstance(x, dict) and x.get('type') == 'text')
                if c:
                    return str(c)[:160]
    except Exception:
        pass
    return ''

def _verwerk(calls):
    # calls: [(name, args)]. geeft (toegestane_calls, blokmeldingen).
    ok = []; blok = []
    for name, args in calls:
        n = _norm(name)
        reden = _verboden_reden(n, args)
        if reden:
            blok.append(f'{n}: {reden}'); _notuleer(f'[blok] {n} {json.dumps(args)[:200]} -> {reden}'); continue
        if alleen_kijken() and n in DEVICE_ACTIES and not _is_home(n, args):
            blok.append(f'{n}: alleen-kijken (alleen Home mag)'); _notuleer(f'[alleen-kijken] {n} geblokkeerd'); continue
        ok.append((n, args))
    return ok, blok

def _bouw_toolcalls(calls):
    out = []
    import uuid
    for n, args in calls:
        out.append({'id': 'call_' + uuid.uuid4().hex[:8], 'type': 'function',
                    'function': {'name': n, 'arguments': json.dumps(args)}})
    return out

def _herschrijf(resp, body=None):
    # resp = volledige OpenAI JSON van het model. Herschrijf choices[0].message.
    try:
        ch = resp.get('choices') or []
        if not ch:
            return resp
        msg = ch[0].get('message') or {}
        content = msg.get('content')
        if isinstance(content, list):
            content = ' '.join(x.get('text', '') for x in content if isinstance(x, dict))
        calls = []
        # al structurele tool_calls? neem die over (naam + args), anders uit de tekst halen.
        for tc in (msg.get('tool_calls') or []):
            fn = (tc or {}).get('function') or {}
            a = fn.get('arguments')
            if isinstance(a, str):
                try:
                    a = json.loads(a)
                except Exception:
                    a = _tolerant_args(a)
            calls.append((_norm(fn.get('name')), a or {}))
        if not calls:
            calls = _uit_tekst(content or '')
        ok, blok = _verwerk(calls)
        # de call-regels uit de zichtbare tekst halen (anders leest ARTEMIS ze dubbel).
        tekst = re.sub(r'call\s*:\s*[A-Za-z_][\w:]*\s*(\{[^{}]*\})?', '', content or '').strip()
        # 592q: de Home-lus in alleen-kijken-stand doorbreken (zie boven). Telt per taak; 1e Home mag, 2e Home rondt af.
        global _HOME_TEL, _HOME_TAAK
        afgerond = False
        if alleen_kijken():
            sl = _taak_sleutel(body)
            if sl != _HOME_TAAK:
                _HOME_TAAK = sl; _HOME_TEL = 0
            home_only = bool(ok) and all(_is_home(n, a) for n, a in ok)
            if home_only and _HOME_TEL >= 1:
                # tweede (of latere) Home: NIET nog eens uitvoeren -> taak netjes afronden met het laatste scherm.
                ok = []
                _HOME_TEL += 1
                beschrijving = tekst or 'alleen het beginscherm (Home) is zichtbaar; het model gaf geen verdere beschrijving.'
                tekst = 'Taak afgerond (finish): Home is al ingedrukt en verder niet nodig. Laatste scherm: ' + beschrijving
                afgerond = True
                _notuleer('[home] herhaalde Home geblokkeerd -> taak afgerond')
            elif home_only:
                # eerste Home: wel uitvoeren, maar meteen de opdracht teruggeven om te beschrijven en af te ronden.
                _HOME_TEL = 1
                tekst = (tekst + '\n' if tekst else '') + HOME_INSTRUCTIE
                _notuleer('[home] 1e Home uitgevoerd; opdracht: beschrijf en rond af')
            else:
                _HOME_TEL = 0   # iets anders dan Home (beschrijven/niets) -> lus doorbroken
        nieuw = dict(msg)
        nieuw['role'] = 'assistant'
        if blok:
            tekst = (tekst + '\n' if tekst else '') + 'Geblokkeerd (veiligheid): ' + '; '.join(blok)
        nieuw['content'] = tekst
        if ok:
            nieuw['tool_calls'] = _bouw_toolcalls(ok)
        else:
            nieuw.pop('tool_calls', None)
        ch[0]['message'] = nieuw
        if afgerond:
            ch[0]['finish_reason'] = 'stop'
        elif ch[0].get('finish_reason') in (None, 'stop') and ok:
            ch[0]['finish_reason'] = 'tool_calls'
        resp['choices'] = ch
    except Exception as e:
        _notuleer(f'[proxy-fout] {e}')
    return resp

def _naar_model(base, token, pad, body, is_post, timeout=600):
    url = base + pad
    data = json.dumps(body).encode() if (is_post and body is not None) else None
    req = urllib.request.Request(url, data=data, method='POST' if is_post else 'GET')
    req.add_header('Authorization', 'Bearer ' + token)
    if is_post:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

# 592o: een verbindingsfout (host weg / No route to host / geweigerd / time-out bij het verbinden) betekent dat de BACKEND weg
# is -- dan heeft het geen zin de andere varianten te proberen, en gaat de circuit breaker open. Een RemoteDisconnected (wel
# verbonden, daarna dicht) is juist een request-VORM-weigering (592k) -- dan proberen we wel de volgende variant.
def _onbereikbaar(e):
    import socket
    r = getattr(e, 'reason', e)
    if isinstance(r, (ConnectionRefusedError, socket.timeout, TimeoutError)):
        return True
    if isinstance(r, OSError) and getattr(r, 'errno', None) in (101, 111, 113, 110, 64):  # ENETUNREACH/ECONNREFUSED/EHOSTUNREACH/ETIMEDOUT/EHOSTDOWN
        return True
    t = (str(r) + ' ' + str(e)).lower()
    return any(w in t for w in ('no route to host', 'refused', 'unreachable', 'timed out', 'host is down', 'name or service', 'getaddrinfo', 'connection reset'))

# 592i: de vraag kleiner maken. niveau 0 = alleen de uitvoer-tokens cappen (veilig, altijd); hoger = minder geschiedenis en
# kortere teksten. Een schermbeeld (image_url) blijft ALTIJD staan -- dat is juist wat het model moet zien. In de alleen-kijken-
# stand mag het harder, want dan is er geen geschiedenis nodig (alleen kijken en Home).
def _kort_inhoud(inhoud, maxchars):
    if isinstance(inhoud, str):
        return inhoud if len(inhoud) <= maxchars else inhoud[: maxchars // 2] + ' …(ingekort)… ' + inhoud[-maxchars // 2:]
    if isinstance(inhoud, list):
        uit = []
        for deel in inhoud:
            if isinstance(deel, dict) and deel.get('type') == 'text' and isinstance(deel.get('text'), str) and len(deel['text']) > maxchars:
                d = dict(deel); d['text'] = deel['text'][: maxchars // 2] + ' …(ingekort)… ' + deel['text'][-maxchars // 2:]
                uit.append(d)
            else:
                uit.append(deel)   # een image_url of ander niet-tekstdeel blijft heel
        return uit
    return inhoud

def _krimp(body, niveau):
    b = dict(body)
    msgs = list(b.get('messages') or [])
    cap = [OUT_CAP, 1024, 512][min(niveau, 2)]
    if not isinstance(b.get('max_tokens'), int) or b['max_tokens'] > cap:
        b['max_tokens'] = cap
    if niveau >= 1 and len(msgs) > 2:
        # houd de systeemprompt (als eerste) en de LAATSTE boodschap (met het schermbeeld); gooi de geschiedenis ertussenuit.
        kop = msgs[:1] if msgs and msgs[0].get('role') == 'system' else []
        msgs = kop + msgs[-1:]
    if niveau >= 1:
        maxchars = [0, 16000, 8000][min(niveau, 2)]
        msgs = [dict(m, content=_kort_inhoud(m.get('content'), maxchars)) for m in msgs]
    b['messages'] = msgs
    return b

# 678 (eigenaar 11 nov 17:41): DE GESCHIEDENIS KORT en het SCHERM ALS TEKST. De F8 weigerde door beeld + 60 berichten + gereedschap tegelijk. Daarom gaat er
# standaard maar de systeemprompt + de laatste PROXY_HIST_MAX berichten door (HIST_MAX, 8), en wordt een schermafbeelding vervangen door het scherm als TEKST
# (artemis-rek scherm-tekst, uiautomator) als dat te lezen is. GEWEIGERD door de §565-zeef = geen beeld en geen tekst; niet te lezen = het beeld blijft staan.
import subprocess as _sp
HIST_MAX = int(os.environ.get('PROXY_HIST_MAX', '8') or '8')
SCHERM_TEKST = (os.environ.get('PROXY_SCHERM_TEKST', '1') or '1') != '0'
AREK_PAD = os.environ.get('AREK_PAD', '') or ''
SCHERM_TIMEOUT = int(os.environ.get('PROXY_SCHERM_TIMEOUT', '20') or '20')
def _is_beeld(d):
    return isinstance(d, dict) and d.get('type') in ('image_url', 'image', 'input_image')
def _kort_historie(body, maxn=None):
    maxn = HIST_MAX if maxn is None else maxn
    msgs = list(body.get('messages') or [])
    kop = msgs[:1] if msgs and (msgs[0] or {}).get('role') == 'system' else []
    rest = msgs[len(kop):]
    if maxn > 0 and len(rest) > maxn:
        rest = rest[-maxn:]
        while rest and (rest[0] or {}).get('role') == 'tool':   # een tool-antwoord zonder zijn aanroep is ongeldig: weg
            rest = rest[1:]
    b = dict(body); b['messages'] = kop + rest
    return b
def _scherm_tekst_halen():
    # (status, tekst): status 'tekst' | 'geweigerd' | 'geen'. Elke fout = 'geen' (dan blijft het beeld staan, behalve bij 'geweigerd').
    if not AREK_PAD:
        return 'geen', 'geen artemis-rek-pad'
    try:
        r = _sp.run([AREK_PAD, 'scherm-tekst'], capture_output=True, text=True, timeout=SCHERM_TIMEOUT)
        uit = (r.stdout or '').strip()
    except Exception as e:
        return 'geen', str(e)[:80]
    if uit.startswith('GEWEIGERD'):
        return 'geweigerd', uit[:200]
    if uit.startswith('SCHERM'):
        return 'tekst', uit[:3000]
    return 'geen', uit[:200]
def _scherm_als_tekst(body):
    msgs = list(body.get('messages') or [])
    if not any(isinstance(m, dict) and isinstance(m.get('content'), list) and any(_is_beeld(d) for d in m['content']) for m in msgs):
        return body
    status, tekst = _scherm_tekst_halen()
    if status == 'geen':
        _notuleer('[scherm] niet als tekst te lezen (' + tekst + '): het beeld blijft staan')
        return body
    nieuw = []
    laatste = max([i for i, m in enumerate(msgs) if isinstance(m, dict) and isinstance(m.get('content'), list) and any(_is_beeld(d) for d in m['content'])])
    for i, m in enumerate(msgs):
        c = (m or {}).get('content') if isinstance(m, dict) else None
        if isinstance(c, list) and any(_is_beeld(d) for d in c):
            delen = [d for d in c if not _is_beeld(d)]
            if i == laatste:
                delen.append({'type': 'text', 'text': (tekst if status == 'tekst' else '[schermbeeld niet getoond: ' + tekst + ']')})
            else:
                delen.append({'type': 'text', 'text': '[ouder schermbeeld weggelaten]'})
            m = dict(m, content=delen)
        nieuw.append(m)
    _notuleer('[scherm] ' + ('als TEKST doorgegeven' if status == 'tekst' else 'GEWEIGERD door de zeef: geen beeld en geen tekst') + ' (' + str(len(tekst)) + ' tekens)')
    b = dict(body); b['messages'] = nieuw
    return b

# 592k: velden die een lokale OpenAI-server (OlliteRT/llama.cpp) vaak METEEN weigert (verbinding dicht zonder antwoord). We
# parsen de actie toch uit de TEKST (de systeemprompt vertelt het model al het call:NAME{...}-formaat), dus deze API-velden
# zijn hier overbodig en mogen eruit als het model de volle vorm weigert.
RISICO_VELDEN = ('tools', 'tool_choice', 'functions', 'function_call', 'parallel_tool_calls', 'response_format')
SNEL_MS = 2000   # 592k: sneller dicht dan dit = GEEN groottegrens maar een geweigerde request-VORM.

def _vorm(body):
    # 592k: beschrijf de request-VORM voor de log -- NOOIT met beeld-/audiodata (alleen soorten en tekstlengtes).
    msgs = body.get('messages') or []
    delen = []
    for m in msgs:
        rol = (m or {}).get('role', '?'); c = (m or {}).get('content')
        if isinstance(c, str):
            delen.append(f'{rol}:tekst({len(c)})')
        elif isinstance(c, list):
            soort = {}
            for d in c:
                t = d.get('type', '?') if isinstance(d, dict) else '?'
                soort[t] = soort.get(t, 0) + 1
            delen.append(f'{rol}:[' + ','.join(f'{k}x{v}' for k, v in soort.items()) + ']')
        else:
            delen.append(f'{rol}:{type(c).__name__}')
    top = [k for k in body.keys() if k != 'messages']
    risico = [k for k in RISICO_VELDEN if k in body]
    return f'velden={top} risico-velden={risico} berichten={len(msgs)} [{" | ".join(delen)}]'

def _zonder_risico(body):
    b = dict(body)
    for k in RISICO_VELDEN:
        b.pop(k, None)
    return b

def _zonder_beeld(body):
    # elke niet-tekst inhoud (image_url, input_audio) eruit; de tekst blijft, met een notitie. ALLEEN als laatste redmiddel.
    b = dict(body); uit = []
    for m in b.get('messages') or []:
        c = (m or {}).get('content')
        if isinstance(c, list):
            tekst = ' '.join(d.get('text', '') for d in c if isinstance(d, dict) and d.get('type') == 'text')
            if any(isinstance(d, dict) and d.get('type') != 'text' for d in c):
                tekst = (tekst + ' ' if tekst else '') + '[schermbeeld/audio weggelaten]'
            uit.append(dict(m, content=tekst))
        else:
            uit.append(m)
    b['messages'] = uit
    return b

# 592k: een LOKAAL model (OlliteRT/Gemma) proberen. De F8 sloot ELKE aanvraag al na 18-45 ms -- GEEN groottegrens maar een
# geweigerde request-VORM. We proberen daarom in volgorde: (1) de volle vorm, (2) ZONDER de OpenAI-tool-/response_format-velden
# (die we hier niet nodig hebben -- de actie komt uit de tekst), (3) ook ZONDER beeld/audio (laatste redmiddel). Elke poging met
# de krimp van zijn niveau. Geeft (resp_json | None, info). info: grootte=echte groottegrens; gesloten+snel=direct geweigerd.
def _probeer_lokaal(be, pad, body):
    import time as _t
    start_niveau = 1 if alleen_kijken() else 0
    varianten = [
        (lambda x: x, 'vol'),
        (_zonder_risico, 'zonder tools/response_format'),
        (lambda x: _zonder_beeld(_zonder_risico(x)), 'zonder tools EN zonder beeld/audio'),
    ]
    laatste = {}
    alle_snel = True
    for i, (schoon, naam) in enumerate(varianten):
        niveau = min(start_niveau + i, 2)
        b = schoon(_krimp(body, niveau))
        if be.get('model'):
            b['model'] = be['model']
        t0 = _t.time()
        try:
            raw = _naar_model(be['base'], be['token'], pad, b, True)
            ms = int((_t.time() - t0) * 1000)
            _notuleer(f'[model] ok {be["naam"]} variant "{naam}" niveau {niveau}: {len(raw)} bytes, {ms} ms')
            try:
                return json.loads(raw.decode('utf-8')), {}
            except Exception as e:
                laatste = {'msg': 'ongeldig JSON van het model: ' + str(e)[:200]}
                _notuleer(f'[model-fout] {be["naam"]} variant "{naam}": ongeldig JSON ({ms} ms)')
                continue
        except urllib.error.HTTPError as e:
            ms = int((_t.time() - t0) * 1000); alle_snel = alle_snel and ms < SNEL_MS
            foutlijf = b''
            try:
                foutlijf = e.read()
            except Exception:
                pass
            laatste = {'code': e.code, 'msg': foutlijf.decode('utf-8', 'replace')[:300], 'ms': ms}
            laatste['grootte'] = bool(e.code == 413 or re.search(r'token|context|length|too large|groot', laatste['msg'], re.I))
            _notuleer(f'[model-fout] {be["naam"]} variant "{naam}": HTTP {e.code}, {len(foutlijf)} bytes, {ms} ms: {laatste["msg"][:160]}')
            if e.code in (401, 403, 404):
                break   # auth/endpoint fout: geen enkele variant helpt
        except Exception as e:
            ms = int((_t.time() - t0) * 1000)
            if _onbereikbaar(e):
                # 592o: de backend is WEG (No route to host / geweigerd / time-out). Geen zin de andere varianten te proberen;
                # de circuit breaker in _chat_naar_model slaat hem daarna even over.
                _notuleer(f'[model-fout] {be["naam"]} variant "{naam}": ONBEREIKBAAR na {ms} ms ({str(e)[:120]})')
                return None, {'onbereikbaar': True, 'ms': ms, 'msg': str(e)[:200], 'alle_snel': alle_snel}
            snel = ms < SNEL_MS; alle_snel = alle_snel and snel
            laatste = {'gesloten': True, 'ms': ms, 'snel': snel, 'msg': str(e)[:200]}
            _notuleer(f'[model-fout] {be["naam"]} variant "{naam}": verbinding gesloten na {ms} ms ({"direct geweigerd -- request-vorm" if snel else "mogelijk te groot"}): {str(e)[:120]}')
    laatste['alle_snel'] = alle_snel
    return None, laatste

# 592L: Gemini (gratis AIza-laag) via de OpenAI-compatibele endpoint. Gemini ONDERSTEUNT tools, dus we laten de tool-velden
# staan en zetten alleen het model + de uitvoer-cap. De vangnet-regels gelden daarna net zo goed (_herschrijf draait altijd).
def _probeer_gemini(be, pad, body):
    import time as _t
    # 592o: Gemini duurde 58-351 s per stap. De grootste last is de geschiedenis + een groot schermbeeld. We krimpen daarom
    # ook voor Gemini (geschiedenis eruit, het BEELD blijft -- het model moet kijken), cappen de uitvoer, en zetten een time-out
    # zodat een trage stap FAALT (en de volgende reserve/ARTEMIS het overneemt) i.p.v. 351 s te hangen. Tools blijven staan (Gemini
    # ondersteunt ze); de vangnet-regels gelden daarna via _herschrijf.
    mag, waarom = _gemini_mag()   # 678: ook hier (de lijst kan oud zijn): na een 429/503 of bij het dagplafond geen tweede model proberen
    if not mag:
        _notuleer('[gemini] overgeslagen: ' + waarom)
        return None, {'overgeslagen': True, 'msg': waarom}
    _g_tel()
    b = _krimp(body, 1); b['model'] = be['model']
    t0 = _t.time()
    try:
        raw = _naar_model(be['base'], be['token'], pad, b, True, timeout=GEMINI_TIMEOUT)
        ms = int((_t.time() - t0) * 1000)
        _notuleer(f'[model] ok {be["naam"]}: {len(raw)} bytes, {ms} ms')
        return json.loads(raw.decode('utf-8')), {}
    except urllib.error.HTTPError as e:
        ms = int((_t.time() - t0) * 1000)
        foutlijf = b''
        try:
            foutlijf = e.read()
        except Exception:
            pass
        info = {'code': e.code, 'msg': foutlijf.decode('utf-8', 'replace')[:300], 'ms': ms}
        _notuleer(f'[model-fout] {be["naam"]}: HTTP {e.code}, {ms} ms: {info["msg"][:160]}')
        if e.code in (429, 503):   # 678: NIET herhalen. 429 = quota (tot de volgende dag), 503 = overbelast (een uur). Daarna valt de keten terug naar lokaal.
            _g_stop(86400 if e.code == 429 else 3600)
            _notuleer(f'[gemini] gestopt na HTTP {e.code}: niet herhalen, terug naar lokaal')
        return None, info
    except Exception as e:
        ms = int((_t.time() - t0) * 1000)
        traag = ms >= GEMINI_TIMEOUT * 1000 - 500 or _onbereikbaar(e)
        soort = 'time-out (te traag)' if ms >= GEMINI_TIMEOUT * 1000 - 500 else 'onbereikbaar'
        _notuleer(f'[model-fout] {be["naam"]}: {soort} na {ms} ms ({str(e)[:120]})')
        return None, {'onbereikbaar': True, 'timeout': ms >= GEMINI_TIMEOUT * 1000 - 500, 'ms': ms, 'msg': str(e)[:200]}

# 592L: de GEORDENDE reserve-keten. Per verzoek proberen we de backends op volgorde (F8 -> reserve-E4B -> Gemini) en nemen het
# EERSTE model dat antwoordt; de rest is terugval. Zo werkt het rek door als de F8 weg is, en gaat het vanzelf terug zodra de F8
# weer antwoordt. De request-VORM gaat eenmalig in de log (zonder beelddata). Geeft (resp_json | None, info van de LAATSTE backend).
def _noteer_reden(tekst):
    # 592o: de laatste echte reden (Status leest dit) -- kort, zonder beeld-/sleuteldata.
    if REDEN_FILE:
        try:
            with open(REDEN_FILE, 'w') as f:
                f.write(tekst[:300])
        except Exception:
            pass

def _chat_naar_model(pad, body):
    import time as _t
    _notuleer('[request] ' + _vorm(body))
    backends = _backends()
    nu = _t.time()
    laatste = {'geen_backend': True}
    for be in backends:
        # 592o: circuit breaker -- een lokaal model dat net ONBEREIKBAAR bleek, slaan we BREAKER_S seconden over, zodat niet
        # elke stap opnieuw ~9 s op de dode F8 wacht. (Gemini staat achteraan en heeft een eigen time-out.)
        if be['soort'] == 'lokaal':
            tot = _KAPOT.get(be['base'], 0)
            if tot > nu:
                _notuleer(f'[breaker] {be["naam"]} overgeslagen (recent weg, nog {int(tot - nu)} s)')
                laatste = {'backend': be['naam'], 'onbereikbaar': True, 'overgeslagen': True, 'tot': int(tot - nu)}
                continue
        resp, info = (_probeer_lokaal if be['soort'] == 'lokaal' else _probeer_gemini)(be, pad, body)
        if resp is not None:
            if be['soort'] == 'lokaal':
                _KAPOT.pop(be['base'], None)   # weer bereikbaar: breaker dicht
            _noteer_actief(be)
            return resp, {'naam': be['naam']}
        if be['soort'] == 'lokaal' and info.get('onbereikbaar'):
            # 592p: de F8 is weg -- misschien alleen een ander IP (ander wifi). Scan het LAN, en als de F8 ergens anders
            # antwoordt, gebruik dat adres METEEN. Zo gaan we NOOIT naar Gemini zolang de F8 te vinden is.
            if be['naam'] == 'F8' and F8_LAN:
                nieuw = _vind_f8_lan()
                if nieuw and nieuw.rstrip('/') != be['base']:
                    _notuleer('[f8] nieuw LAN-adres gevonden: ' + nieuw + ' (was ' + be['base'] + ')')
                    _zet_f8_base(nieuw)
                    be2 = dict(be, base=nieuw.rstrip('/'))
                    resp2, info2 = _probeer_lokaal(be2, pad, body)
                    if resp2 is not None:
                        _KAPOT.pop(be2['base'], None)
                        _noteer_actief(be2)
                        return resp2, {'naam': be2['naam']}
                    info = info2
            _KAPOT[be['base']] = nu + BREAKER_S   # breaker open: dit lokale model even overslaan
            _notuleer(f'[breaker] {be["naam"]} {BREAKER_S} s overgeslagen (onbereikbaar)')
        laatste = dict(info, backend=be['naam'])
        if len(backends) > 1:
            _notuleer(f'[backend] {be["naam"]} lukte niet -- volgende reserve proberen')
    return None, laatste

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def _sse(self, resp):
        # een enkele chunk met de volledige boodschap, dan [DONE]. ARTEMIS accumuleert tool_calls over chunks.
        ch = (resp.get('choices') or [{}])[0]; msg = ch.get('message') or {}
        delta = {'role': 'assistant', 'content': msg.get('content') or ''}
        if msg.get('tool_calls'):
            delta['tool_calls'] = [dict(tc, index=i) for i, tc in enumerate(msg['tool_calls'])]
        chunk = {'id': resp.get('id', 'chatcmpl-proxy'), 'object': 'chat.completion.chunk',
                 'model': resp.get('model', 'lokaal'),
                 'choices': [{'index': 0, 'delta': delta, 'finish_reason': ch.get('finish_reason') or 'stop'}]}
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
        self.wfile.write(b'data: [DONE]\n\n')
    def do_GET(self):
        try:
            raw = _naar_model(F8_BASE, F8_TOKEN, self.path[3:] if self.path.startswith('/v1') else self.path, None, False)
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
        except Exception as e:
            self._json(502, {'error': str(e)})
    def do_POST(self):
        ln = int(self.headers.get('Content-Length', 0) or 0)
        ruw = self.rfile.read(ln) if ln else b''
        pad = self.path[3:] if self.path.startswith('/v1') else self.path
        try:
            body = json.loads(ruw.decode('utf-8')) if ruw else {}
        except Exception:
            body = {}
        want_stream = bool(body.get('stream'))
        if isinstance(body, dict) and body.get('stream'):
            body = dict(body); body['stream'] = False
        if '/chat/completions' not in pad:
            # alles behalve chat (bv. /embeddings) ongewijzigd doorgeven
            try:
                raw = _naar_model(F8_BASE, F8_TOKEN, pad, body, True); self.send_response(200)
                self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(raw)))
                self.end_headers(); self.wfile.write(raw)
            except Exception as e:
                self._json(502, {'error': str(e)})
            return
        # 592k: naar het model met shape-logging + variant-opnieuw; de foutmelding is EERLIJK over de oorzaak (niet 'te groot'
        # als de verbinding al in tientallen ms sluit). De echte fout en de request-vorm staan in de Log.
        if SCHERM_TEKST:
            body = _scherm_als_tekst(body)   # 678: een schermafbeelding wordt tekst (of weggelaten bij een geweigerde zeef)
        body = _kort_historie(body)          # 678: standaard een korte geschiedenis
        resp, info = _chat_naar_model(pad, body)
        if resp is None:
            # 592L: alle backends (F8 -> reserve-E4B -> Gemini) faalden. De melding noemt de LAATSTE backend en blijft eerlijk
            # over de oorzaak (een snelle sluiting is GEEN groottegrens). 'kop' zegt dat zelfs de reserves niet lukten.
            kop = 'Geen enkel model lukte (F8, reserve-telefoons en Gemini geprobeerd). ' if _backends() and len(_backends()) > 1 else ''
            if info.get('geen_backend'):
                msg = ('Er is geen model ingesteld: geen F8, geen reserve-telefoon en geen Gemini-sleutel. '
                       'Zet een lokaal model of koppel een reservetelefoon.')
            elif info.get('grootte'):
                msg = (kop + 'Het lokale model gaf een groottegrens aan: ' + str(info.get('msg', ''))[:200] +
                       '. Zet in OlliteRT op de F8 de Max tokens lager (bijv. 8192) en/of de contextlengte hoger.')
            elif info.get('gesloten') and info.get('alle_snel'):
                msg = (kop + 'De F8 (OlliteRT) sloot ELKE aanvraag meteen (~' + str(info.get('ms', '?')) + ' ms), ook zonder de '
                       'tool-velden en zonder het schermbeeld. Dit is GEEN groottegrens maar een geweigerde request-vorm: '
                       'OlliteRT accepteert het verzoek niet. Controleer of function-calling/vision echt werkt op dit model. '
                       'De volledige request-vorm (zonder beelddata) staat in de Log (proxy-blok.log).')
            elif info.get('gesloten'):
                msg = (kop + 'Het lokale model sloot de verbinding na ' + str(info.get('ms', '?')) + ' ms. Mogelijk te groot: zet '
                       'in OlliteRT de Max tokens lager (bijv. 8192) en/of de contextlengte hoger.')
            elif info.get('timeout'):
                msg = (kop + str(info.get('backend', 'het model')) + ' was te traag (time-out na ~' + str(int(info.get('ms', 0) / 1000)) +
                       ' s). De stap is afgebroken i.p.v. lang te hangen; probeer het opnieuw of maak de vraag kleiner.')
            elif info.get('onbereikbaar'):
                msg = (kop + str(info.get('backend', 'het model')) + ' is niet bereikbaar: ' + str(info.get('msg', ''))[:200])
            elif info.get('code'):
                msg = (kop + str(info.get('backend', 'het model')) + ' gaf HTTP ' + str(info.get('code')) + ': ' + str(info.get('msg', ''))[:200])
            else:
                msg = (kop + 'model onbereikbaar: ' + str(info.get('msg', ''))[:200])
            _noteer_reden('verzoek mislukt: ' + msg)
            self._json(502, {'error': msg[:600]})
            return
        resp = _herschrijf(resp, body)
        # 592o: stelde het model ALLEEN geblokkeerde acties voor (alleen-kijken / vangnet) en kwam er geen enkele actie door, dan
        # maakt ARTEMIS geen voortgang -- noteer dat als de echte reden, zodat Status het toont i.p.v. een vage FAILED.
        try:
            _m = ((resp.get('choices') or [{}])[0].get('message') or {})
            if not _m.get('tool_calls') and 'Geblokkeerd' in (_m.get('content') or ''):
                _noteer_reden('model stelde alleen geblokkeerde acties voor (alleen-kijken/vangnet): ' + (_m.get('content') or '')[:200])
            else:
                _noteer_reden('ok: ' + (_leesactief() or '?'))
        except Exception:
            pass
        if want_stream:
            try:
                self._sse(resp)
            except Exception:
                self._json(200, resp)
        else:
            self._json(200, resp)

if __name__ == '__main__':
    if not F8_BASE and not GEMINI_KEY:
        sys.stderr.write('geen F8_BASE en geen Gemini-sleutel\n'); sys.exit(1)
    ThreadingHTTPServer(('127.0.0.1', POORT), H).serve_forever()
PROXY
  chmod 600 "$PROXYF" 2>/dev/null || true
}
# 592h: de alleen-kijken-stand. De proxy leest de vlag LIVE (bestaan van $ALLEEN_KIJKEN_F), dus een tik werkt meteen -- geen herstart.
alleen_kijken_aan() { touch "$ALLEEN_KIJKEN_F"; touch "$REK_MAP/alleen-kijken-beslist"; zeg "Alleen-kijken AAN: het model mag ALLEEN Home indrukken en daarna beschrijven; elke andere tik wordt geblokkeerd. (Het vangnet tegen NOODSTOP/Stop/Verwijder/Uninstall en bank-/kluis-/betaal-/crypto-apps staat sowieso altijd aan.)"; }
alleen_kijken_uit() { rm -f "$ALLEEN_KIJKEN_F"; touch "$REK_MAP/alleen-kijken-beslist"; zeg "Alleen-kijken UIT: het model mag weer handelen. Het vangnet blijft: NOODSTOP/Stop/Verwijder/Delete/Uninstall-knoppen en bank-/kluis-/authenticator-/betaal-/crypto-apps blijven ALTIJD geblokkeerd."; }
# 116b (28 okt): de Cat (geheugen-telefoon) heeft weinig intern vrij (~0,9 GB). Deze stap KIJKT eerst wat ruimte inneemt en ruimt
# dan ALLEEN veilig op: de app-caches via `pm trim-caches` -- dat wist NOOIT gegevens, foto's of documenten, alleen herbruikbare
# cache. Foto's, documenten, downloads en bank-/kluis-/authenticator-apps worden NOOIT aangeraakt zonder dat de eigenaar het
# per onderdeel zegt; die staan alleen in het overzicht. Nooit de F8. Geen rm, geen pm clear, geen uninstall.
cat_serial() {   # serienummer van de Cat (S75) onder de toegestane rektelefoons, of niets
  local s id naam
  for s in $(verbonden); do
    id="$(toestel_id "$s")"; [ -n "$id" ] || continue
    toegestaan "$id" || continue
    is_f8 "$s" && continue
    naam="$(toestel_naam "$s")"
    case "$naam" in *S75*|*s75*|*[Cc][Aa][Tt]*) printf '%s' "$s"; return 0 ;; esac
  done
  return 1
}
_vrij_kb() { "$ADB" -s "$1" shell "df -k $2 2>/dev/null | awk 'NR==2{print \$4}'" 2>/dev/null | tr -d '\r'; }
_du() { "$ADB" -s "$1" shell du -sh "$2" 2>/dev/null | awk '{print $1}' | tr -d '\r'; }
cat_kijk() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  local s; s="$(cat_serial)" || { zeg "Geen Cat (S75) onder de aangesloten rektelefoons gevonden (sluit de Cat aan met kabel + USB-foutopsporing)."; return 1; }
  zeg "Opruimen op de Cat ($(toestel_naam "$s")) -- KIJKEN, er wordt nog niets aangeraakt:"
  zeg "  Intern vrij: $(_vrij_kb "$s" /data) KB (/data)"
  zeg "  Gedeeld geheugen vrij: $(_vrij_kb "$s" /storage/emulated/0) KB"
  zeg "  Download: $(_du "$s" /sdcard/Download) -- alleen opruimen als je het per onderdeel zegt"
  zeg "  Foto's (DCIM): $(_du "$s" /sdcard/DCIM) -- BESCHERMD, wordt niet aangeraakt"
  zeg "  Afbeeldingen: $(_du "$s" /sdcard/Pictures) -- BESCHERMD"
  zeg "  Documenten: $(_du "$s" /sdcard/Documents) -- BESCHERMD"
  zeg "Veilig op te ruimen met 'Cat: caches opruimen' (knop): alle app-caches, zonder gegevens te wissen. Foto's, documenten,"
  zeg "downloads en bank-/kluis-/authenticator-apps blijven ONAANGEROERD tot je per onderdeel zegt dat die ook mogen."
}
# 609: de VEILIGE opruiming op een rektelefoon (de lokale beheerder gebruikt hem vanzelf, en de knop 'Cat: opruimen' handmatig).
# Alleen herbruikbare/wegwerpbare dingen; NOOIT foto's, documenten, media of gegevens, en NOOIT een bank-/kluis-/betaal-/crypto-/
# authenticator-app (we raken hun app-mappen sowieso niet aan -- pm trim-caches gaat via Android, en de rm-paden hieronder staan
# vast op wegwerp-locaties en -extensies). De SD-kaart-AI-opslag (modellen, kennisboek) blijft staan -- die ruimen we juist NIET op.
# Geeft het aantal vrijgemaakte MB terug op stdout (voor de automatische beheerder), en logt wat er gebeurde.
rek_ruim_veilig() {
  local s="$1"; [ -n "$s" ] || return 1
  is_f8 "$s" && return 1                               # NOOIT de F8
  local id; id="$(toestel_id "$s")"; toegestaan "$id" || return 1
  local voor na
  voor="$("$ADB" -s "$s" shell "df -k /data 2>/dev/null | awk 'NR==2{print \$4}'" 2>/dev/null | tr -d '\r')"
  # (1) app-caches: Android wist zoveel als nodig. GEEN gebruikersgegevens, GEEN foto's, GEEN app-data.
  "$ADB" -s "$s" shell pm trim-caches 999999999999 >/dev/null 2>&1 || true
  # (2) adb-kladmap: /data/local/tmp is adb's eigen werkplek (push/pull-restjes). Veilig leeg te maken; nooit app-data.
  "$ADB" -s "$s" shell "rm -rf /data/local/tmp/* 2>/dev/null" >/dev/null 2>&1 || true
  # (3) oude JARVIS-apk's in Download: houd de NIEUWSTE, gooi oudere kopieën weg (jarvis.apk, 'jarvis (1).apk', jarvis-<versie>.apk).
  #     Alleen de bestandsnaam 'jarvis*.apk' in /sdcard/Download -- nooit een andere apk, nooit buiten Download.
  "$ADB" -s "$s" shell "ls -t /sdcard/Download/jarvis*.apk 2>/dev/null | tail -n +2 | while IFS= read -r f; do rm -f \"\$f\"; done" >/dev/null 2>&1 || true
  # (4) duidelijk wegwerpbare resten in Download (mislukte/afgebroken downloads en logs), ouder dan 14 dagen. VAST op deze extensies;
  #     NOOIT een media- of documentextensie. Foto's/documenten/muziek/video blijven altijd staan.
  "$ADB" -s "$s" shell "find /sdcard/Download -maxdepth 1 -type f -mtime +14 \\( -iname '*.tmp' -o -iname '*.crdownload' -o -iname '*.part' -o -iname '*.partial' -o -iname '*.opdownload' -o -iname '*.log' \\) -delete 2>/dev/null" >/dev/null 2>&1 || true
  na="$("$ADB" -s "$s" shell "df -k /data 2>/dev/null | awk 'NR==2{print \$4}'" 2>/dev/null | tr -d '\r')"
  local delta=$(( ${na:-0} - ${voor:-0} )); [ "$delta" -lt 0 ] && delta=0
  printf '%s' "$(( delta / 1024 ))"   # MB vrijgemaakt
}
cat_ruim() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  local s mb; s="$(cat_serial)" || { zeg "Geen Cat (S75) gevonden."; return 1; }
  zeg "Opruimen op de Cat ($(toestel_naam "$s")) -- caches, de adb-kladmap, oude JARVIS-apk's en mislukte downloads. Geen gegevens, geen foto's..."
  mb="$(rek_ruim_veilig "$s")"
  if [ "${mb:-0}" -gt 0 ]; then zeg "Opgeruimd: ongeveer ${mb} MB intern vrijgemaakt."
  else zeg "Opgeruimd; geen meetbare winst. Veel ruimte zit dan in foto's, documenten of app-gegevens -- die raak ik niet aan."; fi
  zeg "NIET aangeraakt: foto's, documenten, media, de SD-kaart-AI-opslag (modellen/kennisboek), en bank-/kluis-/authenticator-/betaal-/crypto-apps (en hun gegevens)."
}

# 628 (deep research 20 nov): DuraSpeed van MediaTek zet achtergrond-apps stil -- op een MediaTek-telefoon kan dat JARVIS doden
# (de "fabrikant"-oorzaak). Deze knop zet het per TOEGESTANE, verbonden telefoon uit, maar ALLEEN nadat is gecontroleerd dat het
# pakket er echt is (pm list packages). Niet aanwezig = niets doen, geen fout. NOOIT de F8, nooit een app verwijderen -- alleen deze
# ene systeemdienst uitschakelen voor de huidige gebruiker (pm disable-user). Het pakket komt terug met pm enable (handmatig).
DURASPEED_PKG='com.mediatek.duraspeed'
duraspeed_uit() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  local s naam uit gedaan=0 gezien=0
  for s in $(verbonden); do
    is_f8 "$s" && { zeg "$(toestel_naam "$s") = F8, overgeslagen (de dagelijkse telefoon raakt ARTEMIS nooit aan)."; continue; }
    gezien=$((gezien+1)); naam="$(toestel_naam "$s")"
    if ! "$ADB" -s "$s" shell pm list packages "$DURASPEED_PKG" 2>/dev/null | grep -q "$DURASPEED_PKG"; then
      zeg "$naam: geen DuraSpeed gevonden -- niets te doen (waarschijnlijk geen MediaTek-toestel)."
      continue
    fi
    uit="$("$ADB" -s "$s" shell pm disable-user --user 0 "$DURASPEED_PKG" 2>&1 | tr -d '\r')"
    if printf '%s' "$uit" | grep -qiE 'new state: disabled|disabled-user'; then
      zeg "$naam: DuraSpeed UIT. JARVIS wordt nu niet meer door DuraSpeed stilgezet (terugzetten kan met: pm enable $DURASPEED_PKG)."
      gedaan=$((gedaan+1))
    else
      zeg "$naam: DuraSpeed uitzetten lukte niet ($(printf '%s' "$uit" | head -c 120)). Op sommige toestellen mag dit alleen met de hand (Instellingen, Apps, DuraSpeed)."
    fi
  done
  [ "$gezien" -eq 0 ] && zeg "Geen verbonden rektelefoon gevonden (en nooit de F8). Koppel er eerst een via de kabel of draadloze adb."
  [ "$gedaan" -gt 0 ] && zeg "Klaar: op $gedaan telefoon(s) staat DuraSpeed uit."
  return 0
}

# §165: HET KENNISBOEK -- een gewone TEKSTMAP op de Cat-SD (/sdcard/veronica-kennisboek). Delen met dufs (MIT, draait op de
# Chromebook, alleen op 127.0.0.1 -- zelfde regel als SearXNG), en elke nacht een VERSLEUTELDE kopie. Alleen de eigen kennisboek-map
# gaat mee (nooit foto's/documenten/bank), alleen de Cat (nooit de F8). De sleutel staat lokaal (chmod 600) en komt nooit in een log.
KENNIS_DIR_CAT="/sdcard/veronica-kennisboek"            # de tekstmap op de Cat-SD
KENNIS_LOKAAL="$REK_MAP/kennisboek"                     # de spiegel op de Chromebook (dufs serveert deze)
KENNIS_BACKUP="$REK_MAP/kennisboek-backup"             # de versleutelde nachtkopieën
KENNIS_SLEUTEL_F="$REK_MAP/kennisboek-sleutel"         # de sleutel van de versleutelde kopie (één keer bedacht)
KENNIS_KOPIE_STAND="$REK_MAP/kennisboek-kopie-dag"     # de dag van de laatste kopie (voor "een keer per nacht")
KENNIS_POORT="${KENNIS_POORT:-5556}"                   # dufs op 127.0.0.1:5556 (de console zit op 8765, ARTEMIS op 8000)
kennis_sleutel() {   # de sleutel van de versleutelde kopie; één keer bedacht, daarna onthouden, nooit getoond
  if [ -s "$KENNIS_SLEUTEL_F" ]; then return 0; fi
  ( umask 077; head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n' > "$KENNIS_SLEUTEL_F" )
  chmod 600 "$KENNIS_SLEUTEL_F" 2>/dev/null || true
}
kennisboek_kijk() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  local s; s="$(cat_serial)" || { zeg "Geen Cat (S75) onder de aangesloten rektelefoons gevonden. Sluit de Cat aan; de F8 doet nooit mee."; return 1; }
  "$ADB" -s "$s" shell "mkdir -p $KENNIS_DIR_CAT" >/dev/null 2>&1 || true
  # een README neerzetten als de map nog leeg is, zodat het duidelijk een tekstmap is
  if [ -z "$("$ADB" -s "$s" shell "ls -A $KENNIS_DIR_CAT 2>/dev/null" | tr -d '\r')" ]; then
    "$ADB" -s "$s" shell "printf 'Dit is het kennisboek van Veronica: gewone tekstbestanden (.txt/.md). Deel ze met dufs op de Chromebook; er wordt elke nacht een versleutelde kopie gemaakt.\\n' > $KENNIS_DIR_CAT/LEESMIJ.txt" >/dev/null 2>&1 || true
  fi
  zeg "Kennisboek op de Cat ($(toestel_naam "$s")) -- $KENNIS_DIR_CAT:"
  "$ADB" -s "$s" shell "ls -la $KENNIS_DIR_CAT 2>/dev/null" | tr -d '\r' | while IFS= read -r r; do [ -n "$r" ] && zeg "  $r"; done
  zeg "Delen in Chrome: druk op 'Kennisboek delen' -> http://$KBHOST:$KENNIS_POORT (dufs, alleen op deze computer)."
}
kennisboek_deel() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  local s; s="$(cat_serial)" || { zeg "Geen Cat (S75) gevonden. Sluit de Cat aan; nooit de F8."; return 1; }
  "$ADB" -s "$s" shell "mkdir -p $KENNIS_DIR_CAT" >/dev/null 2>&1 || true
  mkdir -p "$KENNIS_LOKAAL" 2>/dev/null || true
  "$ADB" -s "$s" pull -a "$KENNIS_DIR_CAT/." "$KENNIS_LOKAAL" >/dev/null 2>&1 || true   # alleen de kennisboek-map, niets anders
  # 620: GEEN deel-server meer installeren. Standaard delen we met de INGEBOUWDE python3-webserver (altijd aanwezig, niets te
  # installeren) -- lezen in de browser kan meteen. dufs wordt ALLEEN gebruikt als hij toevallig al in $PATH staat (dan kun je ook
  # in de browser toevoegen/wijzigen). Niemand hoeft dus ooit nog iets te installeren voor het kennisboek.
  pkill -f "dufs .*$KENNIS_LOKAAL" 2>/dev/null || true
  pkill -f "http.server $KENNIS_POORT" 2>/dev/null || true
  if command -v dufs >/dev/null 2>&1; then
    setsid dufs --bind 127.0.0.1 --port "$KENNIS_POORT" --allow-upload --allow-delete "$KENNIS_LOKAAL" >>"$REK_MAP/kennisboek-deel.log" 2>&1 &
    zeg "Kennisboek gedeeld (dufs): http://$KBHOST:$KENNIS_POORT (alleen op deze computer). Toevoegen/wijzigen mag; druk daarna op 'Kennisboek terugzetten' om het naar de Cat te schrijven."
  elif command -v python3 >/dev/null 2>&1; then
    setsid python3 -m http.server "$KENNIS_POORT" --bind 127.0.0.1 --directory "$KENNIS_LOKAAL" >>"$REK_MAP/kennisboek-deel.log" 2>&1 &
    zeg "Kennisboek gedeeld: http://$KBHOST:$KENNIS_POORT (alleen op deze computer, lezen). Niets te installeren. Wil je óók in de browser toevoegen/wijzigen? Dan is dufs (MIT) een optie, maar nodig is het niet -- je kunt de bestanden ook gewoon in $KENNIS_LOKAAL bewerken en op 'Kennisboek terugzetten' drukken."
  else
    zeg "De map staat klaar in $KENNIS_LOKAAL (python3 ontbreekt om te delen). Je kunt de tekstbestanden daar bewerken en op 'Kennisboek terugzetten' drukken."
  fi
}
kennisboek_terug() {   # de spiegel terug naar de Cat (alleen de kennisboek-map)
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  local s; s="$(cat_serial)" || { zeg "Geen Cat (S75) gevonden; nooit de F8."; return 1; }
  [ -d "$KENNIS_LOKAAL" ] || { zeg "Er is nog geen lokale spiegel. Druk eerst op 'Kennisboek delen'."; return 1; }
  "$ADB" -s "$s" push "$KENNIS_LOKAAL/." "$KENNIS_DIR_CAT/" >/dev/null 2>&1 && zeg "Kennisboek teruggezet naar de Cat ($KENNIS_DIR_CAT)." || zeg "Terugzetten lukte niet (staat de Cat aan?)."
}
kennisboek_kopie() {   # een VERSLEUTELDE nachtkopie; hoogstens één keer per dag (idempotent), houdt de laatste zeven
  local vandaag; vandaag="$(date +%Y-%m-%d)"
  [ "$(cat "$KENNIS_KOPIE_STAND" 2>/dev/null)" = "$vandaag" ] && return 0
  command -v "$ADB" >/dev/null 2>&1 || return 1
  command -v openssl >/dev/null 2>&1 || { zeg "openssl ontbreekt -- geen versleutelde kopie."; return 1; }
  local s; s="$(cat_serial)" || return 1
  mkdir -p "$KENNIS_LOKAAL" "$KENNIS_BACKUP" 2>/dev/null || true
  "$ADB" -s "$s" pull -a "$KENNIS_DIR_CAT/." "$KENNIS_LOKAAL" >/dev/null 2>&1 || true
  kennis_sleutel
  local uit="$KENNIS_BACKUP/kennisboek-$vandaag.tar.enc"
  if ( cd "$KENNIS_LOKAAL" && tar -cf - . 2>/dev/null ) | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$KENNIS_SLEUTEL_F" -out "$uit" 2>/dev/null; then
    chmod 600 "$uit" 2>/dev/null || true
    printf '%s' "$vandaag" > "$KENNIS_KOPIE_STAND"
    # houd de laatste zeven kopieën
    ls -t "$KENNIS_BACKUP"/kennisboek-*.tar.enc 2>/dev/null | tail -n +8 | while IFS= read -r f; do rm -f "$f"; done
    zeg "Versleutelde nachtkopie van het kennisboek gemaakt: $uit"
  else
    zeg "De versleutelde kopie lukte niet."
  fi
}
# 609: DE LOKALE BEHEERDER -- opslag. Kijkt vanzelf (vanuit de console-lus) of een rektelefoon te weinig vrije ruimte heeft en ruimt
# dan VEILIG op (rek_ruim_veilig). Alleen een stabiel verbonden, toegestane, niet-F8 telefoon; getemperd per telefoon; logt het, en
# zet een nette LET OP-regel als het na opruimen nog krap blijft (die toont Status/Log, zodat de eigenaar het ziet). NOOIT de F8.
BEHEERDER_VRIJ_MB_GRENS="${BEHEERDER_VRIJ_MB_GRENS:-1500}"   # onder zoveel MB vrij op /data ruimt de beheerder op
beheerder_opslag() {
  command -v "$ADB" >/dev/null 2>&1 || return 0
  "$ADB" start-server >/dev/null 2>&1 || true
  local s id naam vrijkb vrijmb mb nu laatstf
  for s in $(verbonden); do
    is_f8 "$s" && continue
    case "$s" in *:*) ;; *) continue ;; esac   # alleen een stabiel DRAADLOOS verbonden toestel (ip:poort); een kabeltoestel kan net aangesloten zijn
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"
    vrijkb="$("$ADB" -s "$s" shell "df -k /data 2>/dev/null | awk 'NR==2{print \$4}'" 2>/dev/null | tr -d '\r')"
    case "$vrijkb" in ''|*[!0-9]*) continue ;; esac
    vrijmb=$(( vrijkb / 1024 ))
    [ "$vrijmb" -ge "$BEHEERDER_VRIJ_MB_GRENS" ] && continue   # genoeg ruimte
    # getemperd per telefoon: hoogstens eens per 6 uur (zodat het nooit blijft malen als de ruimte krap blijft)
    laatstf="$REK_MAP/beheerder-ruim-$id.t"; nu="$(date +%s 2>/dev/null || echo 0)"
    if [ -f "$laatstf" ]; then local l; l="$(cat "$laatstf" 2>/dev/null || echo 0)"; case "$l" in *[!0-9]*|'') l=0 ;; esac; [ $(( nu - l )) -lt 21600 ] && continue; fi
    printf '%s\n' "$nu" >"$laatstf" 2>/dev/null || true
    logregel "[Veronica] Ik kijk even naar $naam: nog ${vrijmb} MB vrij, dat is krap. Ik ruim veilig op -- caches en rommel, jouw spullen laat ik staan."
    mb="$(rek_ruim_veilig "$s")"
    vrijkb="$("$ADB" -s "$s" shell "df -k /data 2>/dev/null | awk 'NR==2{print \$4}'" 2>/dev/null | tr -d '\r')"; case "$vrijkb" in ''|*[!0-9]*) vrijkb=0 ;; esac
    vrijmb=$(( vrijkb / 1024 ))
    logregel "[Veronica] Klaar met $naam: ${mb:-0} MB vrijgemaakt, nu ${vrijmb} MB vrij."
    if [ "$vrijmb" -lt "$BEHEERDER_VRIJ_MB_GRENS" ]; then
      printf '%s Veronica: %s is nog krap (%s MB vrij), ook na het opruimen. De rest zijn jouw foto\x27s en documenten, die laat ik staan. Kijk jij even of er iets weg kan?\n' "$(date '+%H:%M:%S')" "$naam" "$vrijmb" >"$REK_MAP/beheerder-melding.txt" 2>/dev/null || true
    else
      rm -f "$REK_MAP/beheerder-melding.txt" 2>/dev/null || true
    fi
  done
}

# 675: DE LOKALE BEHEERDER. Elke paar minuten kijkt ARTEMIS of elke VERWACHTE rektelefoon (op de lijst, nooit de F8) nog verbonden
# is, en haalt een weggevallen telefoon ZELF draadloos terug (opnieuw verbinden via 5555 en de relay-lijst, daarna JARVIS draaiend
# houden via jarvis_waak). Lukt dat meerdere rondes niet, dan is er een KABEL of een TIK nodig -- en pas dan vraagt hij het aan
# de eigenaar via Veronica (relay_meld), hoogstens eens per uur per telefoon. Het "denken" is met opzet GEWONE REGELS (geen model):
# dat is robuust en faalt niet als een Gemma even niet bereikbaar is; de beslissing is simpel (verbonden ja/nee -> herstel -> escaleer).
# NOOIT de F8 (is_f8 + de lijst bevat hem niet). Geen schermfoto, geen besturing: alleen opnieuw-verbinden en JARVIS starten.
BEHEERDER_GEMIST_F="$REK_MAP/beheerder-gemist"
BEHEERDER_ESC_F="$REK_MAP/beheerder-escalatie"
_bh_get() { awk -v k="$1" '$1==k{print $2; exit}' "$2" 2>/dev/null; }
_bh_set() { local k="$1" f="$2" v="$3"; touch "$f" 2>/dev/null; chmod 600 "$f" 2>/dev/null || true; awk -v k="$k" '$1!=k' "$f" 2>/dev/null >"$f.t" || true; printf '%s %s\n' "$k" "$v" >>"$f.t"; mv -f "$f.t" "$f" 2>/dev/null || true; }
# de id's die NU draadloos/kabel verbonden zijn (nooit de F8, nooit een leeg/half-verbonden toestel)
_bh_verbonden_ids() {
  local s id naam
  for s in $(verbonden); do
    naam="$(toestel_naam "$s")"; [ -z "$naam" ] && continue
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; [ -n "$id" ] && printf '%s\n' "$id"
  done
}
# 678 (12 nov): een lijst-regel "adb:<ip>:5555" is een NOODID: toen de telefoon op de lijst kwam kon het serienummer niet gelezen worden. Zodra die telefoon
# verbonden is (of zich laat verbinden) heeft hij zijn echte serienummer; de beheerder bleef de noodregel als "weg" zien en meldde elke ronde dat hij hem
# miste. Nu wordt de noodregel VERVANGEN door het echte serienummer (of weggehaald als dat er al staat). Nooit de F8; alleen de lijst wordt aangepast.
# 678 (12 nov): VOORTGANG. De eigenaar wil dat de lokale AI zelf kan nakijken of het bouwwerk nog doorgaat: de laatste commit-tijd per tak, en een
# melding (via Veronica) als er langer dan VOORTGANG_MAX_MIN minuten niets gepusht is. Bronnen: de Pages-repo, AFGELEID van het bron-adres van de site
# (geen naam in dit bestand), plus de regels "eigenaar/repo tak" in ~/.artemis-rek/voortgang-bronnen. Voor een PRIVE-repo is een token met alleen
# LEESrecht nodig (~/.artemis-rek/voortgang-token, 600, nooit in een logboek of melding). Alleen lezen; er wordt niets gewijzigd of gepusht.
VOORTGANG_BRONNEN_F="$REK_MAP/voortgang-bronnen"; VOORTGANG_TOKEN_F="$REK_MAP/voortgang-token"; VOORTGANG_MELD_F="$REK_MAP/voortgang-melding"
VOORTGANG_MAX_MIN="${VOORTGANG_MAX_MIN:-30}"
voortgang_bronnen() {   # regels "eigenaar/repo tak"; de Pages-repo volgt uit het bron-adres (https://<eigenaar>.<host>/<repo>)
  local b host pad; b="$(cat "$BRONF" 2>/dev/null | head -1 | tr -d '\r\n ')"
  case "$b" in https://*.*/*)
    host="${b#https://}"; pad="${host#*/}"; host="${host%%/*}"; pad="${pad%%/*}"; host="${host%%.*}"
    [ -n "$host" ] && [ -n "$pad" ] && printf '%s/%s main\n' "$host" "$pad" ;; esac
  [ -s "$VOORTGANG_BRONNEN_F" ] && grep -E '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+ [A-Za-z0-9._/-]+$' "$VOORTGANG_BRONNEN_F"
  return 0
}
voortgang_laatste() {   # $1 repo, $2 tak -> epoch van de laatste commit, of leeg
  command -v curl >/dev/null 2>&1 || return 0; command -v python3 >/dev/null 2>&1 || return 0
  local kop=() tok; [ -s "$VOORTGANG_TOKEN_F" ] && { tok="$(head -1 "$VOORTGANG_TOKEN_F" | tr -d '\r\n ')"; [ -n "$tok" ] && kop=(-H "Authorization: Bearer $tok"); }
  curl -fsSL -m 15 -H 'Accept: application/vnd.github+json' "${kop[@]}" "https://api.github.com/repos/$1/commits?sha=$2&per_page=1" 2>/dev/null \
    | python3 -c 'import sys,json,datetime
try:
    d=json.load(sys.stdin)[0]["commit"]["committer"]["date"]
    print(int(datetime.datetime.strptime(d,"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()))
except Exception: pass' 2>/dev/null
}
voortgang_toon() {
  local nu regel repo tak t min nieuwste=0 n=0 ok=0
  nu="$(date +%s)"
  zeg "Voortgang van het bouwwerk (laatste commit per tak, uit GitHub; alleen lezen):"
  while read -r repo tak; do
    [ -n "$repo" ] || continue; n=$((n+1))
    t="$(voortgang_laatste "$repo" "$tak")"
    case "$t" in ''|*[!0-9]*) zeg "  $repo @ $tak: niet te lezen (privé zonder token, of geen internet)."; continue ;; esac
    ok=$((ok+1)); min=$(( (nu - t) / 60 )); [ "$t" -gt "$nieuwste" ] && nieuwste="$t"
    zeg "  $repo @ $tak: laatste commit $(date -d "@$t" '+%d-%m %H:%M' 2>/dev/null) ($min min geleden)$([ "$min" -gt "$VOORTGANG_MAX_MIN" ] && echo " -- LANGER DAN $VOORTGANG_MAX_MIN MIN STIL")"
  done < <(voortgang_bronnen)
  [ "$n" -eq 0 ] && zeg "  Geen bronnen. Zet er een in het veld \"Voortgang-bronnen\" (eigenaar/repo tak)."
  if [ "$ok" -gt 0 ]; then
    min=$(( (nu - nieuwste) / 60 ))
    if [ "$min" -gt "$VOORTGANG_MAX_MIN" ]; then zeg "Er is $min minuten niets gepusht (grens $VOORTGANG_MAX_MIN)."; else zeg "Het werk loopt: de nieuwste push was $min minuten geleden."; fi
  fi
  [ -s "$VOORTGANG_TOKEN_F" ] || zeg "  (Zonder token zie ik alleen openbare repo's; de privé-werktak kan ik pas lezen met een leestoken in het veld \"Voortgang-token\".)"
}
voortgang_controle() {   # stil; hoogstens eens per uur een melding; 23:00-07:00 niet
  local nu uur nieuwste=0 repo tak t min laatst
  nu="$(date +%s)"; uur="$(date +%H)"; uur=$((10#${uur:-12}))
  [ "$uur" -ge 23 ] || [ "$uur" -lt 7 ] && return 0
  while read -r repo tak; do
    [ -n "$repo" ] || continue; t="$(voortgang_laatste "$repo" "$tak")"
    case "$t" in ''|*[!0-9]*) continue ;; esac
    [ "$t" -gt "$nieuwste" ] && nieuwste="$t"
  done < <(voortgang_bronnen)
  [ "$nieuwste" -gt 0 ] || return 0
  min=$(( (nu - nieuwste) / 60 ))
  [ "$min" -gt "$VOORTGANG_MAX_MIN" ] || { rm -f "$VOORTGANG_MELD_F" 2>/dev/null; return 0; }
  laatst="$(cat "$VOORTGANG_MELD_F" 2>/dev/null | head -1)"; case "$laatst" in ''|*[!0-9]*) laatst=0 ;; esac
  [ $((nu - laatst)) -lt 3600 ] && return 0
  printf '%s\n' "$nu" >"$VOORTGANG_MELD_F" 2>/dev/null; chmod 600 "$VOORTGANG_MELD_F" 2>/dev/null || true
  relay_meld "Voortgang: er is $min minuten niets gepusht (grens $VOORTGANG_MAX_MIN). Het bouwwerk staat mogelijk stil -- kijk in de console op Voortgang, of vraag Claude door te gaan."
}
# 678 (12 nov): een telefoon die alleen via Tailscale (127.0.0.1:560x) verbonden was valt weg als die tunnels verdwijnen (console-herstart, Tailscale-sessie). De beheerder
# bouwt de tunnels dan opnieuw (rek_via_tailscale), maar: hoogstens eens per 10 minuten, niet terwijl Snelheid meten een lezer heeft (rek_via_tailscale breekt alle tunnels
# eerst af), en alleen als Tailscale op de Chromebook bestaat en verbonden is. Alleen lezen/verbinden; de F8 blijft uitgesloten (rek_via_tailscale slaat hem al over).
bh_ts_herstel() {
  command -v tailscale >/dev/null 2>&1 || return 0
  tailscale status >/dev/null 2>&1 || return 0
  local f="$REK_MAP/beheerder-ts.t" nu t lock="$REK_MAP/motor-meet.lock" pid
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  nu="$(date +%s 2>/dev/null || echo 0)"; t="$(cat "$f" 2>/dev/null || echo 0)"; case "$t" in ''|*[!0-9]*) t=0 ;; esac
  [ $((nu - t)) -lt "${BEHEERDER_TS_REM:-600}" ] && return 0
  printf '%s\n' "$nu" >"$f" 2>/dev/null || true
  zeg "Beheerder: ik bouw de Tailscale-verbindingen met de rektelefoons opnieuw op."
  rek_via_tailscale >/dev/null 2>&1 || true
}
bh_migreer_adres_ids() {
  [ -s "$TOEG" ] || return 0
  local regel adres echt
  while read -r regel; do
    case "$regel" in adb:*) ;; *) continue ;; esac
    adres="${regel#adb:}"
    case "$adres" in *[!0-9.:]*|'') continue ;; esac
    "$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}' | grep -qxF "$adres" || "$ADB" connect "$adres" >/dev/null 2>&1 || true
    "$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}' | grep -qxF "$adres" || continue
    is_f8 "$adres" && continue
    echt="$("$ADB" -s "$adres" shell getprop ro.serialno 2>/dev/null | tr -d '\r\n ')"
    [ -n "$echt" ] || continue
    if grep -qxF "$echt" "$TOEG" 2>/dev/null; then
      grep -vxF "$regel" "$TOEG" >"$TOEG.t" 2>/dev/null && mv -f "$TOEG.t" "$TOEG" 2>/dev/null || true
    else
      awk -v a="$regel" -v b="$echt" '{ if ($0==a) print b; else print $0 }' "$TOEG" >"$TOEG.t" 2>/dev/null && mv -f "$TOEG.t" "$TOEG" 2>/dev/null || true
    fi
    chmod 600 "$TOEG" 2>/dev/null || true
    zeg "Beheerder: de noodregel $regel is vervangen door het echte serienummer van die telefoon."
  done < "$TOEG"
}
beheerder_ronde() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  "$ADB" start-server >/dev/null 2>&1 || true
  if [ ! -s "$TOEG" ]; then zeg "Beheerder: nog geen rektelefoons op de lijst (druk op 'Zoek telefoons' of zet er een klaar aan de kabel)."; return 0; fi
  local verwacht hersteld=0 weg=0 nodig="" id nu_ids nu_ids2
  bh_migreer_adres_ids
  verwacht="$(grep -cvE '^\s*$' "$TOEG" 2>/dev/null | tr -d ' ')"; case "$verwacht" in ''|*[!0-9]*) verwacht=0 ;; esac
  nu_ids="$(_bh_verbonden_ids | tr '\n' ' ')"
  while read -r id; do
    [ -n "$id" ] || continue
    case " $nu_ids " in *" $id "*) _bh_set "$id" "$BEHEERDER_GEMIST_F" 0; continue ;; esac   # gezond: teller terug op 0
    # weg -> zelf draadloos terughalen (nooit de F8; dit raakt alleen 5555/relay-adressen)
    zeg "Beheerder: $id is weg -- ik haal hem draadloos terug."
    verbind_draadloos >/dev/null 2>&1 || true
    rek_verbind_lijst >/dev/null 2>&1 || true
    bh_ts_herstel   # 678 (12 nov): ook de Tailscale-weg (de telefoons die alleen via hun vaste 100.x bereikbaar zijn), met rem
    nu_ids2="$(_bh_verbonden_ids | tr '\n' ' ')"
    if case " $nu_ids2 " in *" $id "*) true ;; *) false ;; esac; then
      hersteld=$((hersteld+1)); _bh_set "$id" "$BEHEERDER_GEMIST_F" 0
      zeg "Beheerder: $id is weer verbonden."
    else
      weg=$((weg+1)); nodig="$nodig $id"
      local g; g="$(_bh_get "$id" "$BEHEERDER_GEMIST_F")"; case "$g" in ''|*[!0-9]*) g=0 ;; esac
      _bh_set "$id" "$BEHEERDER_GEMIST_F" $((g+1))
    fi
  done < "$TOEG"
  # JARVIS draaiend houden + batterij Onbeperkt op de (weer) verbonden rektelefoons (slaat de F8 zelf over)
  jarvis_waak >/dev/null 2>&1 || true
  # escaleren naar Veronica ALLEEN als een telefoon al meerdere rondes weg is (kabel/tik nodig), hoogstens eens per uur per telefoon
  local now esc g
  now="$(date +%s 2>/dev/null || echo 0)"
  for id in $nodig; do
    g="$(_bh_get "$id" "$BEHEERDER_GEMIST_F")"; case "$g" in ''|*[!0-9]*) g=0 ;; esac
    [ "$g" -ge "${BEHEERDER_ESCALATIE_RONDES:-3}" ] || continue
    esc="$(_bh_get "$id" "$BEHEERDER_ESC_F")"; case "$esc" in ''|*[!0-9]*) esc=0 ;; esac
    [ "$esc" -gt 0 ] && [ $((now - esc)) -lt "${BEHEERDER_ESC_RUST:-3600}" ] && continue
    _bh_set "$id" "$BEHEERDER_ESC_F" "$now"
    relay_meld "Beheerder: ik krijg telefoon $id al $g keer niet draadloos terug. Sluit hem even met de USB-kabel aan de Chromebook aan (dan zet ik hem vanzelf klaar), of zet Tailscale en het scherm op de telefoon aan en tik hem één keer aan. De andere telefoons draaien door." || true
    zeg "Beheerder: $id al $g rondes weg -- aan de eigenaar gevraagd via Veronica (kabel of tik nodig)."
  done
  zeg "Beheerder-ronde klaar: $verwacht verwacht, $hersteld hersteld, $weg nog weg."
}
# 594: HAALBAARHEID -- kan een oude rektelefoon de F8 vervangen voor het zware model (Gemma-4-E4B, 3,7 GB, met beeld)?
# Meet per aangesloten rektelefoon het RAM, de chip en de vrije opslag (adb getprop/meminfo/df) en geef een oordeel. EERST
# METEN: dit draait de echte adb-opvraag zodra de telefoons aan de Chromebook hangen. De F8 blijft ALTIJD uitgesloten.
hardware() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  "$ADB" start-server >/dev/null 2>&1 || true
  local s id naam ramkb ramgb chip android vrijkb vrijmb soc snap oordeel n=0
  zeg "Hardware per rektelefoon (kan een oude telefoon de F8 vervangen voor het zware model, E4B met beeld?):"
  for s in $(verbonden); do
    if is_f8 "$s"; then zeg "  ($(toestel_naam "$s") = F8, overgeslagen -- die blijft de dagelijkse telefoon)"; continue; fi
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"
    ramkb="$("$ADB" -s "$s" shell cat /proc/meminfo 2>/dev/null | awk '/MemTotal/{print $2}' | tr -d '\r')"
    ramgb=$(( ( ${ramkb:-0} + 524288 ) / 1048576 ))
    chip="$("$ADB" -s "$s" shell getprop ro.soc.manufacturer 2>/dev/null | tr -d '\r') $("$ADB" -s "$s" shell getprop ro.soc.model 2>/dev/null | tr -d '\r')"
    [ -n "$(printf '%s' "$chip" | tr -d ' ')" ] || chip="$("$ADB" -s "$s" shell getprop ro.board.platform 2>/dev/null | tr -d '\r') $("$ADB" -s "$s" shell getprop ro.hardware 2>/dev/null | tr -d '\r')"
    android="$("$ADB" -s "$s" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
    vrijkb="$(_vrij_kb "$s" /data)"; vrijmb=$(( ${vrijkb:-0} / 1024 ))
    soc="$(printf '%s' "$chip" | tr 'A-Z' 'a-z')"
    case "$soc" in *qualcomm*|*snapdragon*|*qcom*|*sm[0-9][0-9]*) snap=ja ;; *) snap=nee ;; esac
    if [ "${ramgb:-0}" -ge 7 ] && [ "$snap" = ja ]; then oordeel="KANDIDAAT als F8-vervanger (genoeg RAM + Snapdragon) -- meet de snelheid met 'Lokaal meten' voordat je het besluit."
    elif [ "${ramgb:-0}" -ge 7 ]; then oordeel="genoeg RAM, maar GEEN Snapdragon (Exynos/MediaTek) -> hoogstens een TRAGE reserve, niet real-time als de F8."
    elif [ "${ramgb:-0}" -ge 5 ]; then oordeel="krap voor E4B met beeld -> eerder een klein model dan een F8-vervanger."
    else oordeel="te licht voor het zware model (E4B)."; fi
    zeg "  $naam: ~${ramgb:-?} GB RAM (gemeld ${ramkb:-?} kB), chip: $(printf '%s' "${chip:-onbekend}" | sed 's/^ *//;s/ *$//'), Android ${android:-?}, intern vrij ~${vrijmb:-?} MB"
    zeg "    -> $oordeel"
    n=$((n+1))
  done
  [ "$n" -gt 0 ] || zeg "  Geen rektelefoon op de lijst aangesloten. Sluit er een aan (kabel + USB-foutopsporing) en druk op 'Zoek telefoons'."
  zeg "E4B (3,7 GB) met beeld vraagt een SNELLE GPU; op een niet-Snapdragon is hij vaak te traag om de F8 te vervangen. Uitleg + advies: docs/oude-telefoon-als-f8-vervanger.md."
}
# 678 stap 1b: de ECHTE modelsnelheid van een rektelefoon meten met llama-bench op de GROTE kernen, CPU-only. DRAAIT OP DE KABEL,
# NOOIT de F8. pp512 (prefill) en tg128 (decode) apart, -t 1,2,4,8, -ngl 0 (CPU), grote kernen gepind met taskset (kernnummers uit
# cpuinfo_max_freq), 5 runs; per run accu/temperatuur/klok/scherm gelogd zodat een lage uitkomst te duiden is (hitte/besparing).
# llama-bench moet als arm64-binary op $MEET_BENCH staan (los NDK-doel, zelfde toolchain als libllamaserver.so in de APK); het model
# is een klein GGUF (Qwen3 0.6B Q4_0) in $MEET_MODEL_LOK. Ontbreekt een van beide, dan zegt ARTEMIS precies wat te doen -- nooit een
# verzonnen getal. Resultaten per telefoon in $MEET_MAP/<naam>.log; de console toont ze direct, Status noemt de laatste meting.
MEET_MAP="$REK_MAP/meet"
MEET_TIMEOUT=900                                 # 678 (10 nov): hoogstens zoveel seconden op EEN adb-shell (--help, pushes) wachten; valt de Tailscale-brug weg, dan niet eeuwig hangen
# 678 (10 nov, avond): de meting zelf draait LOSGEKOPPELD op de telefoon (nohup -> bestand), ARTEMIS POLLT het bestand. Zo kost een
# weggevallen brug niets (de meting loopt op de telefoon door) en blijft een deeluitslag (per draden-aantal) bewaard. Nodig omdat
# 3 van de 4 telefoons de hele reeks niet binnen 900 s haalden (de S10 draait zijn grote kernen op 520 MHz -- echt traag).
MEET_MAXW=2400                                   # hoogstens zoveel seconden pollen op EEN telefoon; daarna deeluitslag + de meting loopt los door (druk later Meetuitslag)
MEET_RUN_T=420                                   # hoogstens zoveel seconden PER draden-aantal op de telefoon (timeout); een instortende run (S10) sleept de rest niet mee, de klare getallen blijven bewaard
MEET_POLL=30                                    # elke zoveel seconden het uitvoerbestand ophalen (korte adb-cat; een mislukte poll is geen ramp, de volgende leest de voortgang)
MEET_TEL_UIT="/data/local/tmp/meet.uit"          # waar de losgekoppelde meting op de telefoon naartoe schrijft
MEET_TEL_SH="/data/local/tmp/meet.sh"            # het meetscript op de telefoon
MEET_BENCH="/data/local/tmp/llama-bench"
MEET_MODEL_LOK="$JAPK_PLEK/meet-model.gguf"
MEET_MODEL_TEL="/data/local/tmp/meet-model.gguf"
BENCH_LOK="$JAPK_PLEK/llama-bench"               # 678: de arm64 llama-bench op de Chromebook (uit 'Data bouwen: llama-bench'); ARTEMIS pusht hem zelf naar elke telefoon
# 678: zorg dat BENCH_LOK bestaat -- uit een door Cowork geplakte durable link (~/.artemis-rek/bench-link), anders de lokale file.
# Echoot het pad als het er is, anders niets (1). De link is OPTIONEEL: zonder link volstaat het lokale bestand.
bench_zorg() {
  [ -s "$BENCH_LOK" ] && { printf '%s' "$BENCH_LOK"; return 0; }
  local url=''
  # 1) een geplakte durable bench-link (optioneel; blijft werken).
  [ -s "$REK_MAP/bench-link" ] && url="$(head -1 "$REK_MAP/bench-link" 2>/dev/null | tr -d '\r\n ')"
  # 2) 678 (10 nov): TIK-VRIJ -- de vaste serverlink /meet-bench, AFGELEID van de al-geconfigureerde apk-link
  #    (https://<host>/jarvis-app/<code>). Zo hoeft niemand nog een bench-link te plakken; de server 302't naar de binary in de
  #    bucket. Geen adres hard in de code (dat zou een naam zijn) -- de basis komt uit het apk-link-bestand.
  case "$url" in https://*) : ;; *)
    if [ -s "$REK_MAP/apk-link" ]; then
      local apk basis; apk="$(head -1 "$REK_MAP/apk-link" 2>/dev/null | tr -d '\r\n ')"
      basis="$(printf '%s' "$apk" | sed -n 's#^\(https://[a-z0-9.-]\{3,253\}\)/jarvis-app/[a-z2-9]\{10\}$#\1#p')"
      [ -n "$basis" ] && url="$basis/meet-bench"
    fi ;;
  esac
  case "$url" in https://*) : ;; *) return 1 ;; esac
  curl -fsSL -m 300 "$url" -o "$BENCH_LOK.deel" 2>/dev/null && [ -s "$BENCH_LOK.deel" ] || { rm -f "$BENCH_LOK.deel" 2>/dev/null; return 1; }
  mv -f "$BENCH_LOK.deel" "$BENCH_LOK" 2>/dev/null; chmod 755 "$BENCH_LOK" 2>/dev/null || true
  [ -s "$BENCH_LOK" ] && printf '%s' "$BENCH_LOK"
}
# 678: zorg dat het meetmodel op de Chromebook staat (op de SD-kaart via MEET_MODEL_LOK=$JAPK_PLEK, niet het ext4-hokje). Bron:
# een door Cowork geplakte link (~/.artemis-rek/meet-model-link), anders de STANDAARD -- Qwen3 0.6B Q4_0 GGUF op Hugging Face
# (publiek, stabiel, door Cowork nagekeken op 10 nov). Zo hoeft niemand iets te plakken. We controleren de GGUF-magic, zodat een
# foute download (HTML/redirect) niet als model doorgaat (§517: nooit een verzonnen/verkeerd bestand).
MEET_MODEL_HF="https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf"
model_zorg() {
  [ -s "$MEET_MODEL_LOK" ] && { printf '%s' "$MEET_MODEL_LOK"; return 0; }
  local lf="$REK_MAP/meet-model-link" url
  if [ -s "$lf" ]; then url="$(head -1 "$lf" 2>/dev/null | tr -d '\r\n ')"; else url="$MEET_MODEL_HF"; fi
  case "$url" in https://*) : ;; *) return 1 ;; esac
  mkdir -p "$(dirname "$MEET_MODEL_LOK")" 2>/dev/null || true
  zeg "  meetmodel ophalen (~382 MB, naar de SD-kaart)..."
  curl -fsSL -m 3600 "$url" -o "$MEET_MODEL_LOK.deel" 2>/dev/null && [ -s "$MEET_MODEL_LOK.deel" ] || { rm -f "$MEET_MODEL_LOK.deel" 2>/dev/null; zeg "  meetmodel ophalen lukte niet ($url)."; return 1; }
  # GGUF-magic: de eerste vier tekens horen "GGUF" te zijn; anders is het een foutpagina/redirect, geen model.
  if [ "$(head -c4 "$MEET_MODEL_LOK.deel" 2>/dev/null)" != "GGUF" ]; then rm -f "$MEET_MODEL_LOK.deel" 2>/dev/null; zeg "  de download is geen GGUF-model (foutpagina?). Overgeslagen."; return 1; fi
  mv -f "$MEET_MODEL_LOK.deel" "$MEET_MODEL_LOK" 2>/dev/null
  [ -s "$MEET_MODEL_LOK" ] && printf '%s' "$MEET_MODEL_LOK"
}
motor_meet() {
  mkdir -p "$MEET_MAP" 2>/dev/null || true
  # 678: EEN tegelijk. motor-meet draait op de achtergrond (LOPEND) en haalt een 382 MB-model op; een tweede druk zou dubbel
  # downloaden naar hetzelfde .deel. mkdir is een atomair slot; een verlaten slot (vorige run gedood) ouder dan een uur telt niet.
  local lock="$REK_MAP/motor-meet.lock" oudpid=''
  [ -d "$lock" ] && oudpid="$(cat "$lock/pid" 2>/dev/null || echo '')"
  # het slot vervalt zodra het PROCES niet meer leeft (pid-check) -- anders bleef de knop dood nadat een ronde crashte (de
  # "lock: unbound variable" van 11:18 liet het slot staan, want de oude trap las een lokale var die bij EXIT weg was). Een uur
  # is het vangnet tegen pid-hergebruik.
  if [ -d "$lock" ] && [ -n "$oudpid" ] && kill -0 "$oudpid" 2>/dev/null && [ -z "$(find "$lock" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    zeg "Snelheid meten draait al (op de achtergrond, pid $oudpid). Kijk in Log (console-motor-meet.log); wacht tot het klaar is."; return 0
  fi
  # bij het terugpakken van een verlaten/vastgelopen slot: de oude (hangende) motor-meet eerst doden, zodat de nieuwe run schoon
  # overneemt (een vorige ronde die op een weggevallen adb-shell hing, hield anders de telefoon bezet).
  [ -n "$oudpid" ] && kill "$oudpid" 2>/dev/null || true
  rm -rf "$lock" 2>/dev/null; mkdir "$lock" 2>/dev/null || { zeg "Kon het motor-meet-slot niet zetten."; return 0; }
  echo "$$" >"$lock/pid" 2>/dev/null || true
  date +%s >"$REK_MAP/meet-bezig" 2>/dev/null || true   # 678: markering "er loopt een meting"; wordt pas weggehaald als alle telefoons klaar zijn. Na een console-herstart pakt meet-hervat hem op.
  # LET OP: de EXIT-trap draait in de GLOBALE scope, waar de lokale $lock NIET bestaat -> onder set -u gaf 'rm -rf "$lock"' daar
  # "lock: unbound variable", en dan werd het slot niet opgeruimd. Gebruik het globale $REK_MAP-pad, dat altijd gebonden is.
  trap 'rm -rf "$REK_MAP/motor-meet.lock" 2>/dev/null' EXIT INT TERM
  local s id naam big mask gedaan=0
  zeg "Snelheid meten (llama-bench, CPU, grote kernen) -- dit duurt per telefoon een paar minuten en kan warm worden (het meetmodel is 382 MB; de eerste keer duurt het ophalen even). De F8 wordt nooit gemeten."
  for s in $(verbonden); do
    # 678: OOK draadloos (ip:5555) -- de bench draait op het toestel; adb streamt alleen de uitvoer, dus draadloos kan (alle 5 rektelefoons). De F8 nooit.
    is_f8 "$s" && { zeg "  ($(toestel_naam "$s") = F8, overgeslagen -- de dagelijkse telefoon meten we nooit)"; continue; }
    id="$(toestel_id "$s")"
    naam="$(toestel_naam "$s")"; [ -n "$naam" ] || { sleep 1; naam="$(toestel_naam "$s")"; }   # een verse tunnel antwoordt soms pas de 2e keer
    [ -n "$naam" ] || naam="$id"                                                                 # nooit een lege naam tonen ('()' of ':')
    # 678 (10 nov): een Tailscale-brug (127.0.0.1:560x uit TS_BRUG_F) is per definitie een rektelefoon -- rek_via_tailscale zette hem
    # op (de F8 is daar al uitgesloten en ontdubbeld). Die hoeft niet OOK op de 'Zoek telefoons'-lijst (die alleen de kabel scant);
    # anders is geen enkele Tailscale-telefoon te meten (ze stonden niet op de kabel-lijst -> onterecht "staat niet op de lijst").
    local via_ts=0; case "$s" in 127.0.0.1:56[0-9][0-9]) { [ -f "$TS_BRUG_F" ] && awk -v p="${s##*:}" '$1==p{f=1} END{exit !f}' "$TS_BRUG_F" 2>/dev/null; } && via_ts=1 ;; esac
    if [ "$via_ts" -eq 0 ] && ! toegestaan "$id"; then
      zeg "  ($naam) staat niet op de lijst -- druk eerst op 'Zoek telefoons', of verbind hem via 'Rek via Tailscale'."; continue
    fi
    local bestand="$MEET_MAP/$(printf '%s' "$naam" | tr ' /:' '___').log"
    # de GROTE kernen: de cores met een max-frequentie van minstens 90% van de hoogste (de prime + het grote cluster), als taskset-lijst
    big="$("$ADB" -s "$s" shell 'm=0; for f in /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq; do v=$(cat "$f" 2>/dev/null||echo 0); [ "$v" -gt "$m" ] 2>/dev/null && m=$v; done; t=$(( m*9/10 )); b=""; for f in /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq; do v=$(cat "$f" 2>/dev/null||echo 0); [ "$v" -ge "$t" ] 2>/dev/null || continue; n=${f#/sys/devices/system/cpu/cpu}; n=${n%%/*}; b="$b,$n"; done; echo "${b#,}"' 2>/dev/null | tr -d '\r ')"
    [ -n "$big" ] || big="0,1"
    # 678 (10 nov): de toybox-taskset op Android kent GEEN -c (kernlijst), wel de HEX-MASKER-vorm (taskset <mask> cmd). Zet de
    # komma-lijst van kern-indexen ($big) om naar een masker: 4,5,6,7 -> f0, 0-7 -> ff.
    mask=0; local _c; for _c in ${big//,/ }; do case "$_c" in ''|*[!0-9]*) : ;; *) mask=$(( mask | (1 << _c) )) ;; esac; done
    local hexmask; hexmask="$(printf '%x' "$mask")"
    # 678n: threads = AANTAL GROTE KERNEN. De aanbevolen draden voor de motor is het aantal grote kernen (niet alle cores: de
    # kleine kernen vertragen de decode). We tellen ze en nemen dat getal MEE in de meetreeks (naast 1/2/4/8), zodat de meting
    # bewijst of de big-core-telling echt het snelst is. JARVIS' motor draait daarna standaard op dat aantal (motorinstel.js).
    local bigN tset; bigN="$(printf '%s' "$big" | tr ',' '\n' | grep -c .)"; case "$bigN" in ''|*[!0-9]*) bigN=4 ;; esac
    # 678 (12 nov): NOOIT meer draden dan grote kernen (de S10 heeft er twee: 4 en 8 draden storten daar in en kosten alleen tijd). Minstens 1 draad.
    tset="$(printf '1\n2\n4\n8\n%s\n' "$bigN" | sort -n -u | awk -v m="$bigN" '$1<=m' | paste -sd, -)"; [ -n "$tset" ] || tset=1
    # llama-bench + model aanwezig? (nooit gokken -- eerlijk zeggen wat ontbreekt)
    # 678: ontbreekt llama-bench op de telefoon, maar staat hij op de Chromebook (BENCH_LOK, evt. via bench-link), dan ARTEMIS
    # hem zelf erheen pushen -- zodat "Snelheid meten" niet meer faalt op /data/local/tmp/llama-bench.
    if ! "$ADB" -s "$s" shell "[ -x $MEET_BENCH ]" >/dev/null 2>&1; then
      # eerst llama-bench op de Chromebook (van BENCH_LOK of de bench-link), DAN naar de telefoon pushen -- gesplitst zodat we
      # eerlijk zeggen WAT misging (klaarzetten vs. adb-push), de "didn't use the link"-onduidelijkheid van 11:18.
      if ! bench_zorg >/dev/null 2>&1; then
        zeg "  $naam: kon llama-bench niet klaarzetten op de Chromebook (geen $BENCH_LOK, en de bench-link ontbreekt of werkte niet). Plak de link opnieuw in 'Meet-links' of bouw hem met 'Data bouwen: llama-bench'."
      elif timeout 120 "$ADB" -s "$s" push "$BENCH_LOK" "$MEET_BENCH" >/dev/null 2>&1; then
        "$ADB" -s "$s" shell chmod 755 "$MEET_BENCH" >/dev/null 2>&1 || true
        zeg "  $naam: llama-bench erop gezet (van de Chromebook)."
      else
        zeg "  $naam: llama-bench staat klaar op de Chromebook maar de adb-push mislukte (tunnel traag/afgebroken?)."
      fi
    fi
    if ! "$ADB" -s "$s" shell "[ -x $MEET_BENCH ]" >/dev/null 2>&1; then
      zeg "  $naam: llama-bench ontbreekt op $MEET_BENCH -- overgeslagen (durable https-link in 'Meet-links', of bouw via 'Data bouwen: llama-bench')."
      continue
    fi
    if ! "$ADB" -s "$s" shell "[ -s $MEET_MODEL_TEL ]" >/dev/null 2>&1; then
      if ! model_zorg >/dev/null 2>&1; then
        zeg "  $naam: kon het meetmodel niet klaarzetten op de Chromebook (download van Hugging Face of de geplakte link mislukte)."
      else
        zeg "  $naam: meetmodel erheen zetten (382 MB over adb, kan even duren)..."
        timeout "$MEET_TIMEOUT" "$ADB" -s "$s" push "$MEET_MODEL_LOK" "$MEET_MODEL_TEL" >/dev/null 2>&1 || zeg "  $naam: de adb-push van het meetmodel mislukte of liep vast (382 MB over Tailscale kan afbreken -- probeer opnieuw)."
      fi
    fi
    if ! "$ADB" -s "$s" shell "[ -s $MEET_MODEL_TEL ]" >/dev/null 2>&1; then
      zeg "  $naam: het meetmodel ontbreekt ($MEET_MODEL_TEL) -- overgeslagen. Het staat $([ -s "$MEET_MODEL_LOK" ] && echo wel || echo niet) op de Chromebook; plak evt. een durable https-link in 'Meet-links'."
      continue
    fi
    # de omstandigheden loggen (hitte/besparing verklaren een lage uitkomst) -- accu, temperatuur, klok van de grote kernen, scherm
    local accu temp klok scherm
    # 678 (10 nov): ROBUUST + BEGRENSD -- de oude awk liet op sommige toestellen de HELE dumpsys-batterij in accu staan
    # (level:80 ... protection:0). Nu pakken we alleen het getal van de eerste 'level:'- en 'temperature:'-regel; wat er verder in
    # de dump staat raakt accu nooit meer.
    local bat lvl tmp
    bat="$("$ADB" -s "$s" shell dumpsys battery 2>/dev/null | tr -d '\r')"
    lvl="$(printf '%s\n' "$bat" | grep -m1 -oE 'level: *[0-9]+' | grep -oE '[0-9]+')"
    tmp="$(printf '%s\n' "$bat" | grep -m1 -oE 'temperature: *[0-9]+' | grep -oE '[0-9]+')"
    accu="${lvl:-?}% $([ -n "$tmp" ] && awk "BEGIN{printf \"%.1f\", $tmp/10}" || echo '?')dC"
    temp="$("$ADB" -s "$s" shell 'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -rn | head -1' 2>/dev/null | tr -d '\r')"
    klok="$("$ADB" -s "$s" shell "cat /sys/devices/system/cpu/cpu${big##*,}/cpufreq/scaling_cur_freq 2>/dev/null" 2>/dev/null | tr -d '\r')"
    scherm="$("$ADB" -s "$s" shell dumpsys deviceidle 2>/dev/null | grep -qi 'mScreenOn=true' && echo aan || echo uit)"
    # 678 (10 nov): het .log VERS per run (truncate), zodat Meetuitslag altijd de LAATSTE meting toont (motor_meet werd vaker gedraaid).
    { echo "=== $naam ($id) -- $(date '+%Y-%m-%d %H:%M' 2>/dev/null)"; echo "grote kernen (taskset): $big (masker $hexmask) | aantal grote kernen (aanbevolen threads): $bigN | accu: ${accu:-?} | hoogste thermal: ${temp:-?} mdC | klok grote kern: ${klok:-?} kHz | scherm: $scherm"; } >"$bestand"
    zeg "  $naam: meten op kernen $big ($bigN grote kernen = aanbevolen threads; accu ${accu:-?}, scherm $scherm)..."
    # ZELFTEST: start de binary überhaupt op dit toestel? Een lege meetuitslag kwam doordat llama-bench niets (bruikbaars) schreef
    # -- meestal de verkeerde architectuur/bionic, geen exec-recht, of noexec op /data/local/tmp. --help + exitcode wijst het aan.
    local hulp hrc
    hulp="$(timeout 120 "$ADB" -s "$s" shell "$MEET_BENCH --help 2>&1; echo RC=\$?" 2>/dev/null | tr -d '\r')"
    hrc="$(printf '%s\n' "$hulp" | sed -n 's/^RC=\([0-9][0-9]*\)$/\1/p' | tail -1)"
    { echo "[zelftest] $MEET_BENCH --help -> exitcode ${hrc:-?}:"; printf '%s\n' "$hulp" | grep -vE '^RC=[0-9]*$' | head -6; echo; } >>"$bestand"
    toonUit() { printf '%s\n' "$1" | grep -iE 'draden|pp512|tg128|t/s' | head -24 | while IFS= read -r r; do zeg "    $r"; done; }
    # Staat er al een VOLTOOIDE (losgekoppelde) meting van een eerdere, afgebroken poll? Dan die pakken -- niet opnieuw meten
    # (de S10 kan >40 min doen; zo gaat een in de achtergrond afgemaakte meting niet verloren bij een nieuwe druk).
    # (versie 12 nov: schone meting -- de console meldt 'de oude meetuitslag ... is weggegooid' als dit script draait)
    # 678 (11 nov): ALLEEN een meting die NU nog loopt of van de laatste 20 minuten is wordt overgenomen. Een oud KLAAR-bestand (de
    # twee rektelefoons gaven zo twee keer de vervuilde getallen van 17:29) wordt VERWIJDERD en er wordt echt opnieuw gemeten.
    local vorig loopt leeftijd; vorig="$(timeout 25 "$ADB" -s "$s" shell "cat $MEET_TEL_UIT 2>/dev/null" 2>/dev/null | tr -d '\r')"
    loopt="$(timeout 25 "$ADB" -s "$s" shell "ps -A 2>/dev/null | grep -c '[m]eet.sh'" 2>/dev/null | tr -d '\r ')"
    leeftijd="$(timeout 25 "$ADB" -s "$s" shell 'n=$(date +%s); m=$(stat -c %Y /data/local/tmp/meet.uit 2>/dev/null); [ -n "$m" ] && echo $((n-m)) || echo 999999' 2>/dev/null | tr -d '\r ')"
    case "${leeftijd:-999999}" in ''|*[!0-9]*) leeftijd=999999 ;; esac
    case "$vorig" in
      *KLAAR*)
        if [ "$leeftijd" -le 1200 ]; then
          { echo "[meting] klaar (losgekoppelde meting van ${leeftijd}s geleden):"; printf '%s\n' "$vorig" | grep -v '^KLAAR$'; echo; } >>"$bestand"
          toonUit "$vorig"; zeg "  $naam: klaar (uit een meting van ${leeftijd}s geleden)."; gedaan=$((gedaan+1)); continue
        fi
        zeg "  $naam: de oude meetuitslag (${leeftijd}s oud) is weggegooid; ik meet opnieuw."
        "$ADB" -s "$s" shell "rm -f $MEET_TEL_UIT" >/dev/null 2>&1 || true ;;
    esac
    # 678 (11 nov): SCHOON METEN. JARVIS (en zijn model) stoppen zodat niets meerekent, scherm aan, en eerst afkoelen (hoogstens 10 min tot
    # <= 35 graden). JARVIS wordt na de meting weer gestart. Alleen het eigen JARVIS-pakket; nooit iets anders.
    if [ "${loopt:-0}" -eq 0 ]; then
      "$ADB" -s "$s" shell am force-stop "$JARVIS_PKG" >/dev/null 2>&1 && zeg "  $naam: JARVIS gestopt tijdens de meting (zodat zijn model niet meerekent)."
      "$ADB" -s "$s" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
      # 678 (12 nov, eigenaar): de telefoons op de cooler (de rektelefoons op de ventilator) worden moeilijk heet -> GEEN afkoelwachttijd. Alleen een telefoon die NIET op de
      # cooler ligt (NIET_GEKOELD_MODELLEN, de modelcode) wacht tot hij koel genoeg is.
      local koel=0 tnu mod; mod="$(toestel_naam "$s")"
      case " ${NIET_GEKOELD_MODELLEN:-22041219PG} " in *" $mod "*) koel=0 ;; *) koel=600 ;; esac
      while [ "$koel" -lt 600 ]; do
        tnu="$("$ADB" -s "$s" shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 -oE 'temperature: *[0-9]+' | grep -oE '[0-9]+')"
        [ -z "$tnu" ] || [ "$tnu" -le 350 ] && break
        [ "$koel" -eq 0 ] && zeg "  $naam: te warm ($(awk "BEGIN{printf \"%.1f\", $tnu/10}") graden); even afkoelen voor de meting..."
        sleep 30; koel=$((koel+30))
      done
    fi
    # 678 (10 nov, avond): de meting LOSGEKOPPELD op de telefoon. Een meetscript (per draden-aantal een aparte run, zodat een
    # deeluitslag bewaard blijft) + nohup; ARTEMIS pollt het uitvoerbestand. taskset met het HEX-MASKER, met terugval zonder
    # affiniteit (oude toybox). -r 3 (kortere reeks dan de oude -r 5 -- sneller op de trage telefoons).
    local tset_sp; tset_sp="$(printf '%s' "$tset" | tr ',' ' ')"
    # 678 (12 nov): loopt de meting op de telefoon AL (een console-herstart doodde alleen de lezer, niet de meting), dan sluiten we daarop aan en lezen we verder
    # in plaats van een tweede run te starten die de eerste overschrijft.
    if [ "${loopt:-0}" -gt 0 ]; then zeg "  $naam: de meting loopt al op de telefoon; ik lees gewoon verder mee."
    else
    "$ADB" -s "$s" shell "cat > $MEET_TEL_SH" <<SH
TO=''; command -v timeout >/dev/null 2>&1 && TO="timeout $MEET_RUN_T"
for t in $tset_sp; do
  echo "=== draden \$t ==="
  \$TO taskset $hexmask $MEET_BENCH -m $MEET_MODEL_TEL -ngl 0 -t \$t -p 512 -n 128 -r 3 2>&1; rc=\$?
  if [ \$rc -eq 124 ]; then echo "[timeout] draden \$t na $MEET_RUN_T s -- overgeslagen, de rest gaat door"
  elif [ \$rc -ne 0 ]; then \$TO $MEET_BENCH -m $MEET_MODEL_TEL -ngl 0 -t \$t -p 512 -n 128 -r 3 2>&1; fi
done
echo KLAAR
SH
    timeout 30 "$ADB" -s "$s" shell "chmod 755 $MEET_TEL_SH; rm -f $MEET_TEL_UIT; nohup sh $MEET_TEL_SH >$MEET_TEL_UIT 2>&1 </dev/null & echo gestart" >/dev/null 2>&1
    zeg "  $naam: meting gestart (losgekoppeld op de telefoon, kernen $big masker $hexmask, draden $tset); ik lees de voortgang..."
    fi
    local wacht=0 klaar=0 laatste='' tussen
    while [ "$wacht" -lt "$MEET_MAXW" ]; do
      sleep "$MEET_POLL"; wacht=$((wacht + MEET_POLL))
      # een korte, begrensde poll; valt de brug weg, dan faalt deze poll maar loopt de meting op de telefoon door -> de volgende poll leest 'm
      tussen="$(timeout 25 "$ADB" -s "$s" shell "cat $MEET_TEL_UIT 2>/dev/null" 2>/dev/null | tr -d '\r')"
      [ -n "$tussen" ] && laatste="$tussen"
      case "$tussen" in *KLAAR*) klaar=1; break ;; esac
    done
    { echo "[meting] $([ "$klaar" = 1 ] && echo 'klaar' || echo "deeluitslag na ${wacht}s -- de rest loopt mogelijk nog op de telefoon"):"; printf '%s\n' "$laatste" | grep -v '^KLAAR$'; echo; } >>"$bestand"
    if printf '%s\n' "$laatste" | grep -qiE 'pp512|tg128'; then toonUit "$laatste"
    else zeg "    Nog geen meetregels (zelftest --help: ${hrc:-?}). De meting loopt los op de telefoon; druk later Meetuitslag."; fi
    [ "$klaar" = 1 ] && "$ADB" -s "$s" shell monkey -p "$JARVIS_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    [ "$klaar" = 1 ] && zeg "  $naam: klaar -- volledige meting in $bestand (en in de Log)." \
      || zeg "  $naam: deeluitslag bewaard; de rest loopt los door op de telefoon (een weggevallen brug kost niets). Druk later Meetuitslag voor de volledige uitslag."
    gedaan=$((gedaan+1))
  done
  rm -f "$REK_MAP/meet-bezig" 2>/dev/null || true   # alle telefoons doorlopen: er hoeft niets meer hervat te worden
  if [ "$gedaan" -eq 0 ]; then
    zeg "Geen rektelefoon gemeten. Verbind er een (kabel + 'Zoek telefoons', of 'Rek via Tailscale'), en zorg dat llama-bench + het meetmodel klaarstaan."
  else
    zeg "Klaar. De pure decode-snelheid (tg128) hoort hoger te liggen dan de 0,9 tok/s die JARVIS meldt -- die telt prefill mee en is geschat (zie docs/lokaal-modelsysteem.md stap 1). De t-regel met het aantal grote kernen hoort het snelst (of vrijwel) te zijn: dat is het aantal draden waarop JARVIS' motor standaard draait. Vergelijk daarna met LiteRT-LM via JARVIS' eigen meting."
  fi
}
# 678 (10 nov): de meetuitslag TONEN. motor_meet draait op de achtergrond en de Log toont maar de laatste ~12 regels, dus de
# llama-bench-getallen (pp512/tg128 t/s) scrollen weg. Dit is een SYNCHRONE opdracht (geen LOPEND): subprocess.run geeft de volle
# uitvoer terug aan de console, dus de hele tabel is zichtbaar. Leest alleen de per-telefoon-logs die motor_meet al wegschreef
# ($MEET_MAP/<naam>.log) -- geen adb, geen meting, puur tonen. Zo komt Cowork aan de getallen voor de rollen zonder terminal.
# 678 (12 nov): na een console-herstart is de LEZER van een losgekoppelde meting weg, de meting op de telefoon loopt door. Staat de markering "meet-bezig" er nog
# (jonger dan 3 uur) en draait er geen lezer meer, dan start dit de lezer opnieuw: motor_meet sluit aan op wat al loopt en leest verder.
meet_hervat() {
  local m="$REK_MAP/meet-bezig" lock="$REK_MAP/motor-meet.lock" t nu pid
  [ -s "$m" ] || return 0
  t="$(head -1 "$m" 2>/dev/null)"; case "$t" in ''|*[!0-9]*) rm -f "$m"; return 0 ;; esac
  nu="$(date +%s)"; [ $((nu - t)) -gt 10800 ] && { rm -f "$m"; return 0; }
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0   # er is nog een lezer
  zeg "Snelheid meten: de lezer was weg (console herstart?); ik lees de meting op de telefoon verder."
  motor_meet
}
meetuitslag() {
  if ! ls "$MEET_MAP"/*.log >/dev/null 2>&1; then
    zeg "Nog geen meetuitslag. Druk eerst op 'Snelheid meten (llama-bench)' en wacht tot er per telefoon 'klaar' in de Log staat."
    return 0
  fi
  zeg "== Meetuitslag (llama-bench, CPU) =="
  zeg "tg128 = de pure decode-snelheid (tok/s); pp512 = prefill. De t-regel met het aantal grote kernen hoort het snelst (of vrijwel) -- dat wordt JARVIS' standaard aantal draden."
  local f naam n=0
  for f in "$MEET_MAP"/*.log; do
    [ -f "$f" ] || continue
    naam="$(basename "$f" .log)"
    zeg ""
    zeg "--- $naam ---"
    # het hele (verse) per-telefoon-log: de contextregel + [zelftest] (--help + exitcode) + [meting] (exitcode + de tabel OF de
    # fout). motor_meet trunceert het per run, dus dit is altijd de laatste meting. Direct naar stdout (door de console opgevangen).
    head -40 "$f" 2>/dev/null | sed 's/^/  /'
    n=$((n+1))
  done
  zeg ""
  zeg "($n telefoon(s) gemeten. De volledige meting staat in $MEET_MAP/*.log op de Chromebook.)"
}
lokaal_vind() {   # echoot "SERIAL|PHONEPORT|MODEL" van de eerste werkende lokale server, of niets
  local s id poort model lp="$LOKAAL_POORT" tok="" ids kop
  # 678 (12 nov): staat de rij-code in rek-token.conf (via het veld "Rij-code" in de console), dan telt ook de EIGEN motor van een rektelefoon (poort 8081, die
  # de code als sleutel vraagt). Zonder code blijft het bij de open servers; de code gaat nooit in een logboek of melding.
  [ -s "$REK_MAP/rek-token.conf" ] && tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  for s in $(verbonden); do
    id="$(toestel_id "$s")"; [ -n "$id" ] || continue
    toegestaan "$id" || continue
    is_f8 "$s" && continue
    for poort in 8000 11434 8080 $([ -n "$tok" ] && echo 8081); do
      "$ADB" -s "$s" forward --remove tcp:"$lp" >/dev/null 2>&1 || true
      "$ADB" -s "$s" forward tcp:"$lp" tcp:"$poort" >/dev/null 2>&1 || continue
      kop=(); [ "$poort" = 8081 ] && kop=(-H "Authorization: Bearer $tok")
      ids="$(curl -fsS -m 5 "${kop[@]}" "http://127.0.0.1:$lp/v1/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/')"
      model="$(printf '%s\n' "$ids" | grep -iE 'e4b|e2b|gemma|3n|vision' | head -1)"
      [ -n "$model" ] || model="$(printf '%s\n' "$ids" | head -1)"
      "$ADB" -s "$s" forward --remove tcp:"$lp" >/dev/null 2>&1 || true
      if [ -n "$model" ]; then printf '%s|%s|%s' "$s" "$poort" "$model"; return 0; fi
    done
  done
  return 1
}
# 592p: de F8 (gast-brein) hangt thuis op het LAN (OlliteRT op poort 8000) en krijgt bij een ander wifi een ANDER IP. Dan is het
# oude BASE_URL dood ("No route to host"). Dit zoekt de F8 terug: scan het eigen subnet (of F8_SCAN_HOSTS) op /v1/models met een
# Gemma-model, schrijf het nieuwe adres naar f8-gevonden.conf EN naar BASE_URL in lokaal-model.conf, en herstart de proxy zodat hij
# het meteen gebruikt. Geen aankopen, geen mDNS (gastnetten blokkeren dat); een kale scan werkt overal.
f8_eigen_ips() {
  { ip -4 addr show 2>/dev/null | sed -n 's#.*inet \([0-9.]*\)/.*#\1#p'; hostname -I 2>/dev/null; } \
    | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | sort -u
}
# 608: de /24-prefix van een ip (de eerste drie getallen met een punt erachter; leeg voor een niet-ip).
pref24() { printf '%s' "$1" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+\.' | head -1; }
# 608: onthoud een /24-prefix waar ooit een telefoon te vinden was (dedup, 600).
onthoud_lan_subnet() {
  local p; p="$(pref24 "$1")"; [ -n "$p" ] || return 0
  case "$p" in 127.*|100.115.92.) return 0 ;; esac   # niet de loopback of het Crostini-vmnet (de telefoons zitten daar niet)
  touch "$LAN_SUBNETTEN_F" 2>/dev/null; chmod 600 "$LAN_SUBNETTEN_F" 2>/dev/null || true
  grep -qxF "$p" "$LAN_SUBNETTEN_F" 2>/dev/null || printf '%s\n' "$p" >>"$LAN_SUBNETTEN_F"
}
# 608: ALLE /24-prefixen waar de F8/rek te vinden kan zijn -- het eigen net van de Chromebook PLUS elk net waar ooit een telefoon
# zat (onthouden, en nu uit de levende bronnen). Zo vindt de F8-scan en de 5555-scan de telefoons op BEIDE wifi's (het hoofdwifi
# en gastnet) terug na een wissel, ook al staat de Chromebook zelf in Crostini op 100.115.92.x -- een ander net dan de telefoons.
bekende_lan_subnetten() {
  local ip base p
  { # 1) het eigen net van de Chromebook (vangt het geval dat hij WEL op het LAN zit)
    for ip in $(f8_eigen_ips); do pref24 "$ip"; echo; done
    # 2) het laatst teruggevonden F8-adres, en het met de hand gezette lokaal-model-adres
    [ -s "$F8_GEVONDEN_F" ] && { p="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$F8_GEVONDEN_F" 2>/dev/null | head -1)"; pref24 "$p"; echo; }
    base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"; [ -n "$base" ] && { p="$(printf '%s' "$base" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"; pref24 "$p"; echo; }
    # 3) de onthouden draadloze rektelefoon-endpoints (ip:5555) -- echte LAN-adressen
    [ -s "$DRAADLOOS_F" ] && while read -r ip; do pref24 "${ip%%:*}"; echo; done <"$DRAADLOOS_F"
    # 4) de persistente lijst (elk net waar ooit een telefoon zat, over meerdere wifi-wissels heen)
    [ -s "$LAN_SUBNETTEN_F" ] && cat "$LAN_SUBNETTEN_F"
  } | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.$' | grep -v -e '^127\.' -e '^100\.115\.92\.' | awk '!seen[$0]++'
  # en onthoud de nieuw-geziene nets voor een volgende keer (zodat beide wifi's blijven staan)
  [ -s "$F8_GEVONDEN_F" ] && onthoud_lan_subnet "$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$F8_GEVONDEN_F" 2>/dev/null | head -1)"
  base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"; [ -n "$base" ] && onthoud_lan_subnet "$(printf '%s' "$base" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  [ -s "$DRAADLOOS_F" ] && while read -r ip; do onthoud_lan_subnet "${ip%%:*}"; done <"$DRAADLOOS_F"
}
f8_hosts() {
  # LET OP: onder `set -uo pipefail` is een KALE $F8_SCAN_HOSTS een "unbound variable" zodra de console/knop hem niet
  # exporteert (alleen de test zet hem). Dat liet f8-terugvinden EN rektelefoons-koppelen op het echte wifi crashen op
  # "F8_SCAN_HOSTS: unbound variable". Daarom hier met een lege standaard (${...:-}); leeg = het eigen subnet aftasten.
  if [ -n "${F8_SCAN_HOSTS:-}" ]; then printf '%s\n' ${F8_SCAN_HOSTS:-}; return; fi
  local ip pre p
  # 675: NIET alleen het eigen /24. In Crostini zit de VM vaak op 100.115.92.x (het vmnet), terwijl de telefoons op het thuis-
  # of gastnet zitten (bv. 192.168.178.x) -- dan vond "F8 terugvinden" de F8 nooit (klacht van vanochtend). Scan daarom ook de
  # ONTHOUDEN LAN-subnetten (waar ooit een telefoon te vinden was) en de gangbare thuisnetten. Dubbele prefixes vallen weg.
  {
    for ip in $(f8_eigen_ips); do pref24 "$ip"; done
    [ -s "$LAN_SUBNETTEN_F" ] && cat "$LAN_SUBNETTEN_F" 2>/dev/null
    printf '%s\n' 192.168.178. 192.168.1. 192.168.0. 192.168.68. 192.168.2.
  } | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.$' | grep -v '^127\.' | grep -v '^100\.115\.92\.' | sort -u | while read -r pre; do
    seq 1 254 | sed "s#^#$pre#"
  done
}
f8_zoek() {
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 1; }
  # 592s: de F8 draait nu JARVIS. Die biedt zijn model aan op poort 8081 (de EIGEN motor, met de rij-code als sleutel), niet
  # alleen OlliteRT op 8000. Dus scannen we BEIDE poorten (8000 eerst: open OlliteRT heeft voorrang), en op 8081 sturen we de
  # rij-code uit rek-token.conf mee. We matchen op elk model ("id" in /v1/models), niet meer op een Gemma-naam -- JARVIS kan
  # elk model laden. Het eerste adres dat antwoordt is de primaire (F8).
  local poort gevonden="" model tok="" used=""
  [ -s "$REK_MAP/rek-token.conf" ] && tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  # 678o: EERST het onthouden adres kort toetsen. Antwoordt het niet meer (na een wifi-wissel: bv. een oud .109 op 192.168.178),
  # dan VERGETEN we het en zoeken opnieuw op het hele netwerk (f8_hosts bevat o.a. 192.168.68.x). Zo blijft ARTEMIS niet op een
  # dood adres hangen. Puur lezen (geen besturing van de F8).
  if [ -s "$F8_GEVONDEN_F" ]; then
    local oud_ip oud_poort="" oud_base; oud_base="$(cat "$F8_GEVONDEN_F" 2>/dev/null)"; oud_ip="$(printf '%s' "$oud_base" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    if [ -n "$oud_ip" ]; then
      for poort in ${F8_ZOEK_POORTEN:-8000 8081}; do
        if curl -fsS -m 1 "http://$oud_ip:$poort/v1/models" 2>/dev/null | grep -q '"id"'; then oud_poort="$poort"; break; fi
        [ -n "$tok" ] && curl -fsS -m 1 -H "Authorization: Bearer $tok" "http://$oud_ip:$poort/v1/models" 2>/dev/null | grep -q '"id"' && { oud_poort="$poort"; used="$tok"; break; }
      done
      if [ -n "$oud_poort" ]; then
        zeg "F8 nog op het onthouden adres: $oud_ip:$oud_poort."
        printf 'http://%s:%s/v1' "$oud_ip" "$oud_poort" >"$F8_GEVONDEN_F"; chmod 600 "$F8_GEVONDEN_F" 2>/dev/null || true
        onthoud_lan_subnet "$oud_ip"; return 0
      fi
      zeg "Het onthouden F8-adres ($oud_ip) antwoordt niet meer (ander wifi?); ik vergeet het en zoek opnieuw op het hele netwerk (incl. 192.168.68.x)."
      rm -f "$F8_GEVONDEN_F" 2>/dev/null || true
    fi
  fi
  zeg "F8 zoeken op het lokale netwerk (poorten ${F8_ZOEK_POORTEN:-8000 8081}, /v1/models met een model)..."
  for poort in ${F8_ZOEK_POORTEN:-8000 8081}; do
    gevonden="$(f8_hosts | T="$tok" P="$poort" xargs -P 50 -I{} sh -c '
      u="http://{}:$P/v1/models";
      r="$(curl -fsS -m 1 "$u" 2>/dev/null)";
      if [ -z "$r" ] && [ -n "$T" ]; then r="$(curl -fsS -m 1 -H "Authorization: Bearer $T" "$u" 2>/dev/null)"; fi;
      printf "%s" "$r" | grep -q "\"id\"" && echo "http://{}:$P/v1"' 2>/dev/null | head -1)"
    [ -n "$gevonden" ] && break
  done
  if [ -z "$gevonden" ]; then
    # 678i: geen MODELSERVER gevonden. Draait JARVIS zelf wel ergens (poort 8080, /jarvis/status)? Zo ja, dan hangt de F8 WEL op dit
    # wifi maar staat zijn modelserver uit; zo nee, dan lijkt de F8 niet op dit net te zitten. Dat scheelt zoeken.
    local jarvis_ip; jarvis_ip="$(f8_hosts | xargs -P 50 -I{} sh -c 'curl -fsS -m 1 "http://{}:8080/jarvis/status" 2>/dev/null | grep -q "versie\|rol\|motor" && echo {}' 2>/dev/null | head -1)"
    if [ -n "$jarvis_ip" ]; then
      zeg "Geen MODELSERVER gevonden, maar JARVIS draait wel op $jarvis_ip. De F8 hangt dus op dit wifi -- alleen zijn modelserver staat UIT."
      zeg "Zet op de F8 OlliteRT's 'Start Server' aan (dat kan NIET op afstand -- iemand moet het op de F8 tikken), of zet de eigen JARVIS-motor aan (in Veronica: Motor aan). Druk daarna opnieuw op 'F8 terugvinden'."
    else
      zeg "Geen F8 op het lokale netwerk gevonden (poorten ${F8_ZOEK_POORTEN:-8000 8081}, en geen JARVIS op 8080). Ik zocht op het eigen /24, de onthouden netten en de gangbare thuisnetten (192.168.178/1/0/68/2.x). Controleer of de F8 echt op dit wifi hangt (nu waarschijnlijk 192.168.68.x), en of OlliteRT of de JARVIS-motor aan staat."
    fi
    return 1
  fi
  # Had deze primaire de rij-code nodig (de JARVIS-motor op 8081)? Dan onthouden we die voor de proxy en de conf.
  if ! curl -fsS -m 2 "$gevonden/models" >/dev/null 2>&1 && [ -n "$tok" ] && curl -fsS -m 2 -H "Authorization: Bearer $tok" "$gevonden/models" >/dev/null 2>&1; then used="$tok"; fi
  printf '%s' "$gevonden" >"$F8_GEVONDEN_F"; chmod 600 "$F8_GEVONDEN_F" 2>/dev/null || true
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    sed -i "s#^BASE_URL=.*#BASE_URL=$gevonden#" "$REK_MAP/lokaal-model.conf" 2>/dev/null || true
    if grep -q '^TOKEN=' "$REK_MAP/lokaal-model.conf" 2>/dev/null; then sed -i "s#^TOKEN=.*#TOKEN=${used:-local}#" "$REK_MAP/lokaal-model.conf" 2>/dev/null || true
    else printf 'TOKEN=%s\n' "${used:-local}" >>"$REK_MAP/lokaal-model.conf" 2>/dev/null || true; fi
  fi
  model="$(curl -fsS -m 3 ${used:+-H "Authorization: Bearer $used"} "$gevonden/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | head -1)"
  zeg "F8 gevonden op $gevonden -- een lokaal model antwoordt (model: ${model:-?}${used:+, via de rij-code op poort 8081})."
  # 592r: in dezelfde scan ook de ANDERE rektelefoons koppelen aan de reserve-keten (F8 -> rektelefoons -> Gemini).
  local rj; rj="$(rek_scan_json "$gevonden")"
  printf '%s' "$rj" >"$REK_MAP/reserve-modellen.json"; chmod 600 "$REK_MAP/reserve-modellen.json" 2>/dev/null || true
  local rn; rn="$(printf '%s' "$rj" | grep -oE '"base"' | wc -l | tr -d ' ')"
  [ "${rn:-0}" -gt 0 ] && zeg "$rn extra rektelefoon(s) gekoppeld aan de reserve-keten."
  if proxy_draait; then start_proxy "$gevonden" "local" >/dev/null 2>&1 && zeg "De vangnet-proxy gebruikt nu dit adres (geen Gemini zolang de F8 antwoordt)." || true; fi
  return 0
}
# 678j: de F8 zit AAN DE KABEL -- lees ALLEEN zijn eigen wifi-adres uit (ip addr/route) en zet hem als denker. De F8 wordt NOOIT
# bestuurd: geen input, am, monkey, screencap, uiautomator of pm -- alleen zijn netwerkgegevens LEZEN, en daarna zijn modelserver
# over het netwerk controleren. Zo vindt ARTEMIS na een wifi-verhuizing meteen het nieuwe adres zonder het hele /24 af te tasten.
f8_kabel_adres() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 1; }
  "$ADB" start-server >/dev/null 2>&1 || true
  local s f8=""
  for s in $(verbonden); do case "$s" in *:*) continue ;; esac; is_f8 "$s" && { f8="$s"; break; }; done
  [ -n "$f8" ] || { zeg "Geen F8 aan de kabel gezien. Sluit de F8 met USB aan (USB-foutopsporing aan, op de F8 'Toestaan'). De F8 wordt ALLEEN UITGELEZEN, nooit bestuurd."; return 1; }
  local naam; naam="$(toestel_naam "$f8")"
  # ALLEEN LEZEN: zijn wifi-adres (een thuis/gastnet-adres), nooit 127.* of het Crostini-vmnet 100.115.92.*
  local ip=""
  ip="$("$ADB" -s "$f8" shell 'ip -o -4 addr show scope global 2>/dev/null' 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | grep -vE '^127\.|^100\.115\.92\.' | head -1)"
  [ -n "$ip" ] || ip="$("$ADB" -s "$f8" shell 'ip route 2>/dev/null' 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' | grep -vE '^127\.|^100\.115\.92\.' | head -1)"
  [ -n "$ip" ] || { zeg "Kon het wifi-adres van de F8 niet lezen. Hangt de F8 op het wifi (niet alleen aan de kabel)?"; return 1; }
  zeg "F8 ($naam) heeft wifi-adres $ip. Ik controleer zijn modelserver over het netwerk (alleen lezen, nooit besturen)..."
  onthoud_lan_subnet "$ip"
  local tok="" poort gevonden="" used=""
  [ -s "$REK_MAP/rek-token.conf" ] && tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  for poort in ${F8_ZOEK_POORTEN:-8000 8081}; do
    if curl -fsS -m 2 "http://$ip:$poort/v1/models" 2>/dev/null | grep -q '"id"'; then gevonden="http://$ip:$poort/v1"; break; fi
    if [ -n "$tok" ] && curl -fsS -m 2 -H "Authorization: Bearer $tok" "http://$ip:$poort/v1/models" 2>/dev/null | grep -q '"id"'; then gevonden="http://$ip:$poort/v1"; used="$tok"; break; fi
  done
  if [ -z "$gevonden" ]; then
    zeg "F8 op $ip, maar zijn modelserver antwoordt niet (poorten ${F8_ZOEK_POORTEN:-8000 8081}). Zet OlliteRT's 'Start Server' aan op de F8, of de eigen motor (Veronica: Motor aan), en druk opnieuw. Het adres $ip is onthouden."
    return 1
  fi
  printf '%s' "$gevonden" >"$F8_GEVONDEN_F"; chmod 600 "$F8_GEVONDEN_F" 2>/dev/null || true
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    sed -i "s#^BASE_URL=.*#BASE_URL=$gevonden#" "$REK_MAP/lokaal-model.conf" 2>/dev/null || true
    if grep -q '^TOKEN=' "$REK_MAP/lokaal-model.conf" 2>/dev/null; then sed -i "s#^TOKEN=.*#TOKEN=${used:-local}#" "$REK_MAP/lokaal-model.conf" 2>/dev/null || true
    else printf 'TOKEN=%s\n' "${used:-local}" >>"$REK_MAP/lokaal-model.conf" 2>/dev/null || true; fi
  fi
  local model; model="$(curl -fsS -m 3 ${used:+-H "Authorization: Bearer $used"} "$gevonden/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | head -1)"
  zeg "F8 als denker ingesteld op $gevonden (model: ${model:-?}${used:+, via de rij-code op poort 8081}). ARTEMIS gebruikt hem nu weer. De kabel mag eruit -- het adres staat onthouden."
  if proxy_draait; then start_proxy "$gevonden" "local" >/dev/null 2>&1 && zeg "De vangnet-proxy gebruikt nu dit adres (geen Gemini zolang de F8 antwoordt)." || true; fi
  return 0
}
# 592r: ALLE rektelefoons vloeiend koppelen aan de reserve-keten. Scant het LAN op modelservers (OlliteRT op 8000, de eigen motor
# op 8081, llama.cpp/Ollama op 11434) en bouwt reserve-modellen.json: elke telefoon met zijn adres, model en (indien nodig) token.
# De F8 (de primaire) valt eruit -- die is al de hoofdmotor. Zo valt ARTEMIS netjes terug: F8 -> rektelefoon(s) met Gemma 4/ander
# model -> Gemini, met de vangnet-regels rondom ELK model. Geen vaste IP's in de code; de token voor de eigen motor komt uit
# rek-token.conf (de rij-code) als die er is, anders geen token (OlliteRT is open).
rek_scan_json() {   # argument: de F8-base om uit te sluiten. Echoot een JSON-array met de reserve-telefoons op het LAN.
  command -v curl >/dev/null 2>&1 || { printf '[]'; return 0; }
  local f8="$1" tok="" poorten="${REK_ZOEK_POORTEN:-8000 8081 11434}" p kand b m used naam first=1 out='['
  [ -s "$REK_MAP/rek-token.conf" ] && tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  kand=""
  for p in $poorten; do
    kand="$kand
$(f8_hosts | T="$tok" xargs -P 50 -I{} sh -c 'b="$1"; { curl -fsS -m 1 "$b/models" >/dev/null 2>&1 || { [ -n "$T" ] && curl -fsS -m 1 -H "Authorization: Bearer $T" "$b/models" >/dev/null 2>&1; }; } && echo "$b"' _ "http://{}:$p/v1" 2>/dev/null)"
  done
  for b in $(printf '%s\n' "$kand" | sed '/^$/d' | sort -u); do
    [ "$b" = "$f8" ] && continue
    m="$(curl -fsS -m 3 "$b/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | head -1)"; used=""
    if [ -z "$m" ] && [ -n "$tok" ]; then
      m="$(curl -fsS -m 3 -H "Authorization: Bearer $tok" "$b/models" 2>/dev/null | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | head -1)"
      [ -n "$m" ] && used="$tok"
    fi
    [ -n "$m" ] || continue
    naam="rektelefoon $(printf '%s' "$b" | sed 's#http://##;s#/v1##')"
    [ $first -eq 1 ] || out="$out,"; first=0
    out="$out{\"naam\":\"$naam\",\"base\":\"$b\",\"token\":\"${used:-local}\",\"model\":\"$m\"}"
  done
  printf '%s]' "$out"
}
# §620: DE RELAY-LIJST. De hotspot (§616) is losgelaten als route -- een telefoon zonder simkaart verliest zijn internet zodra zijn
# wifi uit gaat voor een hotspot. In plaats daarvan BLIJVEN de rektelefoons op het huis-wifi en MELDEN ze zelf hun adres+poort in de
# hartslag (die staat er al sinds §539: adressen[] + poort). Die hartslag gaat naar de relay/ntfy, versleuteld. ARTEMIS LEEST die lijst
# en verbindt adb met die adressen (ip:5555) -- en doet de blinde subnet-sweep ALLEEN nog als de lijst leeg is. Nooit de F8: die opent
# 5555 niet (§607) en wordt bovendien na verbinden op model herkend en meteen losgekoppeld. GEEN merk-/modelnaam in dit bestand.
# De crypto is EXACT die van hartslag.js (geen tweede waarheid): onderwerp = 'vh'+sha256('veronica-hartslag:'+O)[:30], sleutel =
# sha256('veronica-hartslag-sleutel:'+O), AES-256-GCM (webcrypto hangt de 16-byte tag achter de data -- python AESGCM verwacht dat ook).
REK_ONDERWERP_F="$REK_MAP/rek-onderwerp.conf"    # het geheime ntfy/relay-onderwerp (jv+30); 600; eenmalig geplakt in de console (Veronica toont het)
REK_RELAY_F="$REK_MAP/rek-relay.conf"            # optioneel het workers.dev-relay-adres; leeg = alleen ntfy.sh
rek_relay_bases() {   # welke bases ARTEMIS afleest: de relay (als geldig) EN ntfy.sh
  local b="https://ntfy.sh" r
  if [ -s "$REK_RELAY_F" ]; then
    r="$(head -1 "$REK_RELAY_F" 2>/dev/null | tr -d '\r\n ')"
    case "$r" in https://*.workers.dev) b="$r https://ntfy.sh";; esac
  fi
  printf '%s' "$b"
}
# 667e: EEN melding naar de relay, zodat Cowork/Veronica de ARTEMIS-uitkomst (bv. "telefoon klaargezet") kan lezen ZONDER de console
# (die is van buiten de Chromebook niet te bereiken). Versleuteld met EXACT de hartslag-crypto (geen tweede waarheid), op een eigen
# 'melding'-topic (soort 'melding' in hartslag.js: vm + sha256('veronica-melding:'+O)[:30], sleutel sha256('veronica-melding-sleutel:'+O)).
# Best-effort en stil: geen onderwerp/crypto/relay = niets doen, nooit een fout. Ook lokaal bewaard, zodat Status/Log het altijd toont.
MELD_F="$REK_MAP/meldingen.log"
relay_meld() {
  local tekst="$1"; [ -n "$tekst" ] || return 0
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$tekst" >>"$MELD_F" 2>/dev/null || true; chmod 600 "$MELD_F" 2>/dev/null || true
  [ -s "$REK_ONDERWERP_F" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  local o; o="$(head -1 "$REK_ONDERWERP_F" 2>/dev/null | tr -d '\r\n ')"
  case "$o" in jv*) : ;; *) return 0 ;; esac
  rek_zorg_crypto >/dev/null 2>&1 || true
  REK_O="$o" REK_BASES="${REK_BASES:-$(rek_relay_bases)}" REK_TEKST="$tekst" "$(rek_py)" - <<'PY' 2>/dev/null || true
import os, re, json, time, hashlib, secrets, urllib.request
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
O = os.environ.get('REK_O', '')
if not re.match(r'^jv[a-z0-9]{30}$', O): raise SystemExit(0)
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    raise SystemExit(0)
bases = [b for b in os.environ.get('REK_BASES', '').split() if b]
if not bases: raise SystemExit(0)
tekst = os.environ.get('REK_TEKST', '')[:400]
topic = 'vm' + hashlib.sha256(('veronica-melding:' + O).encode()).hexdigest()[:30]
key = hashlib.sha256(('veronica-melding-sleutel:' + O).encode()).digest()
iv = secrets.token_bytes(12)
d = json.dumps({'v': 1, 'bron': 'artemis', 'tekst': tekst, 't': int(time.time() * 1000)}).encode()
msg = json.dumps({'iv': iv.hex(), 'data': AESGCM(key).encrypt(iv, d, None).hex()})
body = json.dumps({'topic': topic, 'message': msg}).encode()
for base in bases:
    try:
        req = urllib.request.Request(base.rstrip('/') + '/', data=body, headers={'User-Agent': 'artemis', 'Content-Type': 'application/json'})
        _OPENER.open(req, timeout=6).read()
        break
    except Exception:
        continue
PY
}
REK_PY_VENV="$REK_MAP/pyrelay"                    # 623e: een eigen mini-venv alleen voor de relay-reader (cryptography)
rek_py() {   # welke python de relay-reader gebruikt: de eigen venv als die cryptography heeft, anders de systeem-python3
  if [ -x "$REK_PY_VENV/bin/python3" ] && "$REK_PY_VENV/bin/python3" -c 'import cryptography' >/dev/null 2>&1; then
    printf '%s' "$REK_PY_VENV/bin/python3"; return 0
  fi
  printf 'python3'
}
REK_CRYPTO_LOG="$REK_MAP/crypto-install.log"      # 623f: de ECHTE install-fouten, zodat "mislukt" een oorzaak krijgt
rek_zorg_crypto() {   # 623e/f: zorg dat de relay-reader cryptography heeft -- ZONDER terminal. Geeft een korte uitslag; nooit blokkerend.
  command -v python3 >/dev/null 2>&1 || { printf 'python3-ontbreekt'; return 0; }
  python3 -c 'import cryptography' >/dev/null 2>&1 && { printf 'systeem'; return 0; }
  [ -x "$REK_PY_VENV/bin/python3" ] && "$REK_PY_VENV/bin/python3" -c 'import cryptography' >/dev/null 2>&1 && { printf 'venv'; return 0; }
  : > "$REK_CRYPTO_LOG" 2>/dev/null || true
  # 1) HET DEBIAN-PAKKET via wachtwoordloze sudo (Crostini). De systeem-python heeft hier GEEN pip (fout van 22:55), dus dit is de
  #    betrouwbaarste weg: een klein apt-pakket in de systeem-python, geen pip/ensurepip/wheels nodig. Klein genoeg voor een krappe schijf.
  if command -v sudo >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    { echo '== apt-get install python3-cryptography =='; sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-cryptography \
        || { echo '== apt-get update + opnieuw =='; sudo -n DEBIAN_FRONTEND=noninteractive apt-get update -q && sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-cryptography; }; } >>"$REK_CRYPTO_LOG" 2>&1 || true
    python3 -c 'import cryptography' >/dev/null 2>&1 && { printf 'apt'; return 0; }
  fi
  # 2) een eigen venv (alleen als python3-venv/ensurepip aanwezig is; op deze box vaak niet -- dan faalt dit netjes)
  if python3 -m venv "$REK_PY_VENV" >>"$REK_CRYPTO_LOG" 2>&1; then
    "$REK_PY_VENV/bin/python3" -m pip install --quiet --disable-pip-version-check cryptography >>"$REK_CRYPTO_LOG" 2>&1 || true
    "$REK_PY_VENV/bin/python3" -c 'import cryptography' >/dev/null 2>&1 && { printf 'venv-nieuw'; return 0; }
  fi
  # 3) terugval: pip --user, dan --break-system-packages (werkt alleen als er wel een pip is)
  { echo '== pip --user =='; python3 -m pip install --user --quiet --disable-pip-version-check cryptography \
      || { echo '== pip --break-system-packages =='; python3 -m pip install --break-system-packages --quiet --disable-pip-version-check cryptography; }; } >>"$REK_CRYPTO_LOG" 2>&1 || true
  python3 -c 'import cryptography' >/dev/null 2>&1 && { printf 'user'; return 0; }
  printf 'mislukt'
}
rek_lijst_rauw() {   # echoot per VERSE telefoon: IPCSV<TAB>POORT<TAB>ID<TAB>NAAM<TAB>AGESEC. Leeg = geen onderwerp, geen crypto, of niets vers.
  [ -s "$REK_ONDERWERP_F" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  local o; o="$(head -1 "$REK_ONDERWERP_F" 2>/dev/null | tr -d '\r\n ')"
  case "$o" in jv*) : ;; *) return 0 ;; esac
  rek_zorg_crypto >/dev/null 2>&1 || true   # 623e: zet cryptography vanzelf bij (venv of --user/--break-system-packages); nooit blokkerend
  REK_O="$o" REK_BASES="${REK_BASES:-$(rek_relay_bases)}" REK_VENSTER="${REK_VENSTER:-900}" "$(rek_py)" - <<'PY' 2>/dev/null
import os, sys, re, json, time, hashlib, urllib.request
# ARTEMIS draait lokaal op de Chromebook (geen bedrijfsproxy); negeer elke proxy zodat ntfy.sh/relay (en de test) direct gaan.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
O = os.environ.get('REK_O', '')
if not re.match(r'^jv[a-z0-9]{30}$', O):
    sys.exit(0)
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    sys.exit(0)
bases = [b for b in os.environ.get('REK_BASES', '').split() if b]
venster = int(os.environ.get('REK_VENSTER', '900') or '900')
topic = 'vh' + hashlib.sha256(('veronica-hartslag:' + O).encode()).hexdigest()[:30]
key = hashlib.sha256(('veronica-hartslag-sleutel:' + O).encode()).digest()
aes = AESGCM(key)
IPRE = re.compile(r'^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$')
# 630/#8: het Tailscale-CGNAT-bereik (100.64 t/m 100.127). JARVIS zet dit adres sinds 1.9.80 in de hartslag (veld 'tailscale').
# Op een gastnetwerk zien de telefoons elkaars wifi-adres niet, maar het Tailscale-adres werkt wel: daarom gaat het VOOROP.
TSRE = re.compile(r'^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$')
IDRE = re.compile(r'^[a-z0-9]{12,40}$')
nu = time.time()
best = {}
# 623d: diagnose-tellers, zodat "de lijst is leeg" een OORZAAK krijgt (relay onbereikbaar vs. niets ontsleutelbaar vs. geen adres).
DIAG = os.environ.get('REK_DIAG')
n_raw = 0; n_dec = 0; n_adr = 0; diag_bases = []
for base in bases:
    host = base.split('//')[-1].split('/')[0]
    url = base.rstrip('/') + '/' + topic + '/json?poll=1&since=' + str(venster + 120) + 's'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'artemis'})
        raw = _OPENER.open(req, timeout=6).read().decode('utf-8', 'ignore')
        diag_bases.append(host + ':ok')
    except Exception as e:
        diag_bases.append(host + ':ONBEREIKBAAR(' + type(e).__name__ + ')')
        continue
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            m = json.loads(line)
        except Exception:
            continue
        if m.get('event') and m.get('event') != 'message':
            continue
        msg = m.get('message')
        if not isinstance(msg, str):
            continue
        n_raw += 1
        try:
            b = json.loads(msg)
            iv = bytes.fromhex(b['iv']); data = bytes.fromhex(b['data'])
            d = json.loads(aes.decrypt(iv, data, None).decode('utf-8'))
        except Exception:
            continue
        if d.get('v') != 1:
            continue
        n_dec += 1
        i = str(d.get('id', ''))
        if not IDRE.match(i):
            continue
        t = (d.get('t', 0) / 1000.0) if d.get('t') else float(m.get('time') or 0)
        if t and (nu - t) > venster:
            continue
        ips = [a for a in (d.get('adressen') or []) if isinstance(a, str) and IPRE.match(a)]
        # #8: het Tailscale-adres (100.64-100.127) als EERSTE route, boven de wifi-adressen -- rek_verbind_lijst probeert de IP's
        # in deze volgorde, dus op een gastnetwerk komt de telefoon via Tailscale binnen ook als zijn wifi-adres onbruikbaar is.
        ts = d.get('tailscale')
        if isinstance(ts, str) and TSRE.match(ts):
            ips = [ts] + [a for a in ips if a != ts]
        if ips:
            n_adr += 1
        if not ips:
            continue
        poort = d.get('poort', 8080)
        if not (isinstance(poort, int) and 0 < poort < 65536):
            poort = 8080
        naam = str(d.get('naam', ''))[:40].replace('\t', ' ')
        prev = best.get(i)
        if (prev is None) or (t > prev[0]):
            best[i] = (t, ips, poort, naam)
for i, (t, ips, poort, naam) in best.items():
    age = int(max(0, nu - t)) if t else -1
    print('\t'.join([','.join(ips[:4]), str(poort), i, naam, str(age)]))
if DIAG:
    sys.stderr.write('relay-diagnose: bases=[%s] berichten=%d ontsleuteld=%d met-adres=%d levend=%d\n' % ((' '.join(diag_bases) or 'geen'), n_raw, n_dec, n_adr, len(best)))
PY
}
rek_diag() {   # 623d: zegt WAAROM de relay-lijst leeg is (relay onbereikbaar / niets ontsleutelbaar = fout onderwerp / geen adres in de hartslag).
  [ -s "$REK_ONDERWERP_F" ] || { zeg "Nog geen relay-onderwerp -- open Meer in Veronica op deze computer, dan zet Veronica het vanzelf."; return 0; }
  command -v python3 >/dev/null 2>&1 || { zeg "python3 ontbreekt."; return 0; }
  local c; c="$(rek_zorg_crypto)"   # 623e/f: zet cryptography vanzelf bij voordat we meten; zeg wat eruit kwam
  if [ "$c" = mislukt ]; then
    zeg "cryptography: mislukt (apt/venv/pip lukten geen van alle). Laatste install-regels:"
    tail -n 8 "$REK_CRYPTO_LOG" 2>/dev/null | while IFS= read -r L; do [ -n "$L" ] && zeg "  $L"; done
    [ -s "$REK_CRYPTO_LOG" ] || zeg "  (geen logregels -- apt/pip ontbreken allebei; dan is python3-cryptography met de hand nodig)"
  else
    zeg "cryptography: $c"
  fi
  local o; o="$(head -1 "$REK_ONDERWERP_F" 2>/dev/null | tr -d '\r\n ')"
  local d; d="$(REK_O="$o" REK_BASES="$(rek_relay_bases)" REK_VENSTER="${REK_VENSTER:-900}" REK_DIAG=1 "$(rek_py)" - <<'PY' 2>&1 >/dev/null
import os, sys, re, json, time, hashlib, urllib.request
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
O = os.environ.get('REK_O', '')
if not re.match(r'^jv[a-z0-9]{30}$', O): sys.stderr.write('onderwerp ongeldig in de console\n'); sys.exit(0)
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    sys.stderr.write('cryptography ontbreekt (python3 -m pip install --user cryptography)\n'); sys.exit(0)
bases = [b for b in os.environ.get('REK_BASES', '').split() if b]
venster = int(os.environ.get('REK_VENSTER', '900') or '900')
topic = 'vh' + hashlib.sha256(('veronica-hartslag:' + O).encode()).hexdigest()[:30]
key = hashlib.sha256(('veronica-hartslag-sleutel:' + O).encode()).digest()
aes = AESGCM(key)
IPRE = re.compile(r'^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$')
nu = time.time(); n_raw = n_dec = n_adr = 0; diag_bases = []
for base in bases:
    host = base.split('//')[-1].split('/')[0]
    url = base.rstrip('/') + '/' + topic + '/json?poll=1&since=' + str(venster + 120) + 's'
    try:
        raw = _OPENER.open(urllib.request.Request(url, headers={'User-Agent': 'artemis'}), timeout=6).read().decode('utf-8', 'ignore')
        diag_bases.append(host + ':ok')
    except Exception as e:
        diag_bases.append(host + ':ONBEREIKBAAR(' + type(e).__name__ + ')'); continue
    for line in raw.splitlines():
        line = line.strip()
        if not line: continue
        try: m = json.loads(line)
        except Exception: continue
        if m.get('event') and m.get('event') != 'message': continue
        msg = m.get('message')
        if not isinstance(msg, str): continue
        n_raw += 1
        try:
            b = json.loads(msg); d = json.loads(aes.decrypt(bytes.fromhex(b['iv']), bytes.fromhex(b['data']), None).decode('utf-8'))
        except Exception: continue
        if d.get('v') != 1: continue
        n_dec += 1
        if [a for a in (d.get('adressen') or []) if isinstance(a, str) and IPRE.match(a)]: n_adr += 1
sys.stderr.write('bases=[%s] berichten=%d ontsleuteld=%d met-adres=%d\n' % ((' '.join(diag_bases) or 'geen'), n_raw, n_dec, n_adr))
PY
)"
  zeg "Relay-diagnose: $d"
  case "$d" in
    *ONBEREIKBAAR*) zeg "-> Deze computer (de Linux-VM) bereikt de relay niet, terwijl Chrome dat wel doet. Controleer of de VM internet heeft op dit wifi." ;;
    *"berichten=0"*) zeg "-> De relay heeft op dit onderwerp niets staan: of het onderwerp in de console wijkt af van dat van Veronica, of er klopt op dit moment geen enkele telefoon." ;;
    *"ontsleuteld=0"*) zeg "-> Er staan wel berichten, maar ze zijn niet te ontsleutelen: het onderwerp in de console is NIET hetzelfde als dat van de telefoons." ;;
    *"met-adres=0"*) zeg "-> De hartslag is er en klopt, maar draagt geen bruikbaar wifi-adres (192.168/10.x). De telefoon kent zijn eigen adres op dit net niet; adb kan hem zo niet vinden." ;;
    *) : ;;
  esac
}
# #4: na een herstart van een telefoon is 5555 pas na ~90 s terug (JARVIS zet de poort zelf weer op, §607). ARTEMIS wacht daar NIET
# blokkerend op (dat zou de console vasthouden): de autostart-console draait deze verbind-ronde elke minuut, dus een net herstarte
# telefoon komt binnen een of twee scans (~60-120 s) vanzelf terug zodra zijn verse hartslag met het adres op de relay staat.
rek_verbind_lijst() {   # adb-connect de telefoons uit de relay-lijst (Tailscale eerst, dan wifi; ip:5555); nooit de F8. Echoot het aantal verbonden adressen.
  "$ADB" start-server >/dev/null 2>&1 || true
  local rauw ipcsv poort id naam age ip n=0 serial
  rauw="$(rek_lijst_rauw)"
  [ -n "$rauw" ] || { printf '0'; return 0; }
  while IFS=$'\t' read -r ipcsv poort id naam age; do
    [ -n "$ipcsv" ] || continue
    for ip in ${ipcsv//,/ }; do
      [ -n "$ip" ] || continue
      serial="$ip:5555"
      "$ADB" connect "$serial" >/dev/null 2>&1 || continue
      if is_f8 "$serial"; then "$ADB" disconnect "$serial" >/dev/null 2>&1 || true; continue; fi
      onthoud_lan_subnet "$ip" 2>/dev/null || true   # 623g: onthoud het /24 van een via-de-relay gevonden telefoon, zodat de periodieke 5555-sweep DIT net (bv. een gastnet) voortaan meeneemt -- een rektelefoon zonder hartslag maar met open 5555 komt zo vanzelf binnen
      n=$((n+1))
    done
  done <<< "$rauw"
  printf '%s' "$n"
}
rek_lijst() {   # console-knop: toon de relay-lijst en verbind ermee. Leeg = uitleg (onderwerp plakken), geen fout.
  if [ ! -s "$REK_ONDERWERP_F" ]; then
    zeg "Nog geen relay-onderwerp ingesteld. Plak het geheime onderwerp (begint met 'jv') één keer in het veld 'Relay-onderwerp' hieronder; Veronica toont het bij Instellingen. Zonder onderwerp zoekt ARTEMIS de telefoons zoals voorheen (scannen)."
    return 0
  fi
  local rauw n=0
  rauw="$(rek_lijst_rauw)"
  if [ -z "$rauw" ]; then
    if [ ! -s "$REK_RELAY_F" ]; then
      zeg "De relay-lijst is nu leeg. ARTEMIS leest nu alleen ntfy.sh. Op een GASTNETWERK melden de telefoons zich via de relay -- open Meer in Veronica op deze computer (dan zet Veronica het adres+onderwerp vanzelf), of plak het 'Relay-adres' (eindigt op .workers.dev) hieronder. ARTEMIS valt zolang terug op scannen."
    else
      zeg "De relay-lijst is nu leeg. Ik kijk waarom:"
      rek_diag
    fi
    return 0
  fi
  zeg "Telefoons die zichzelf aan de relay melden (huis-wifi, vers):"
  printf '%s\n' "$rauw" | while IFS=$'\t' read -r ipcsv poort id naam age; do
    zeg "  ${naam:-telefoon} -> $ipcsv (poort $poort, ${age}s geleden)"
  done
  n="$(rek_verbind_lijst)"
  zeg "adb verbonden met $n adres(sen) op poort 5555 (nooit de F8). De blinde subnet-sweep gebeurt alleen nog als deze lijst leeg is."
}
# §616: HET EIGEN REK-NETWERK dat meeverhuist. Eén rektelefoon (de hotspot-basis, NOOIT de F8) draait een hotspot; de andere
# toegestane rektelefoons verbinden zich ermee via adb `cmd wifi connect-network`. Zo zien de rektelefoons elkaar weer op EEN
# eigen netwerk, ook op een gastnetwerk dat clients van elkaar afschermt -- dat is wat de off-wifi rektelefoons terugbrengt in
# het rek. Alleen `cmd wifi` (nooit via de instellingen van de telefoon), nooit de F8, alleen telefoons van de lijst. Wat adb NIET kan en dus een
# mensentik blijft: op de hotspot-telefoon "Wi-Fi delen"/"Wi-Fi sharing" AAN zetten (dan heeft het rek internet van het huis-wifi,
# als het toestel die schakelaar heeft) en de hotspot-time-out UIT; en als de Chromebook op het rek-netwerk moet, sluit die zich er
# één keer bij aan (daarvoor een pushmelding). GEEN merk- of modelnaam in dit bestand (gaat naar de openbare site).
REK_SSID_F="$REK_MAP/rek-net"             # de vaste SSID + het wachtwoord van het rek-netwerk (één keer bedacht, daarna onthouden)
REK_BASIS_F="$REK_MAP/rek-basis"          # het toestel-id van de hotspot-basis (door Veronica/console gekozen; anders de eerste niet-F8)
rek_net_gegevens() {
  if [ -s "$REK_SSID_F" ]; then cat "$REK_SSID_F"; return; fi
  local pw; pw="$(head -c 9 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n' | cut -c1-12)"
  [ -n "$pw" ] || pw="rek$(date +%s | tail -c 10)"
  printf 'rek-net\n%s\n' "$pw" > "$REK_SSID_F"; chmod 600 "$REK_SSID_F" 2>/dev/null || true; cat "$REK_SSID_F"
}
rek_hotspot() {   # rek-hotspot [basis-serial]: zet het eigen rek-netwerk op; basis = arg, of REK_BASIS_F, of de eerste niet-F8 rektelefoon
  "$ADB" start-server >/dev/null 2>&1 || true
  [ -s "$TOEG" ] || { zeg "Eerst rektelefoons toestaan (Zoek telefoons / Koppel via de kabel). De F8 doet nooit mee."; return 1; }
  local geg ssid pw wens="${1:-}" basis="" s id naam bnaam n=0
  geg="$(rek_net_gegevens)"; ssid="$(printf '%s' "$geg" | sed -n 1p)"; pw="$(printf '%s' "$geg" | sed -n 2p)"
  [ -z "$wens" ] && [ -s "$REK_BASIS_F" ] && wens="$(cat "$REK_BASIS_F")"
  # de hotspot-basis kiezen: een toegestane, niet-F8 rektelefoon. Een gewenst toestel-id wint; anders de eerste.
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    if [ -n "$wens" ] && [ "$id" = "$wens" ]; then basis="$s"; break; fi
    [ -z "$basis" ] && basis="$s"
  done
  [ -n "$basis" ] || { zeg "Geen toegestane rektelefoon om de hotspot-basis te zijn (nooit de F8). Koppel er eerst een."; return 1; }
  bnaam="$(toestel_naam "$basis")"
  printf '%s\n' "$(toestel_id "$basis")" > "$REK_BASIS_F" 2>/dev/null || true
  if "$ADB" -s "$basis" shell cmd wifi start-softap "$ssid" wpa2 "$pw" >/dev/null 2>&1; then
    zeg "$bnaam is nu de hotspot-basis: netwerk \"$ssid\"."
  else
    zeg "$bnaam: de hotspot starten lukte niet via adb (cmd wifi start-softap -- niet elke Android-versie kan dit). Zet de hotspot één keer met de hand aan (naam \"$ssid\"; het wachtwoord staat in $REK_SSID_F); daarna verbinden de andere telefoons."
  fi
  for s in $(verbonden); do
    [ "$s" = "$basis" ] && continue
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"
    if "$ADB" -s "$s" shell cmd wifi connect-network "$ssid" wpa2 "$pw" >/dev/null 2>&1; then
      zeg "$naam verbindt met het rek-netwerk \"$ssid\"."; n=$((n+1))
    else
      zeg "$naam: kon niet via adb met \"$ssid\" verbinden (cmd wifi connect-network -- niet elke Android-versie kan dit). Verbind hem één keer met de hand met \"$ssid\"."
    fi
  done
  zeg "Klaar: $n telefoon(s) naar het rek-netwerk \"$ssid\". De basis blijft gewoon meerekenen (alleen de hotspot staat aan)."
  zeg "NOG MET DE HAND op de hotspot-telefoon (dat kan adb niet): zet \"Wi-Fi delen\"/\"Wi-Fi sharing\" AAN (dan heeft het rek internet van het huis-wifi, als dat toestel die schakelaar heeft) en zet de hotspot-time-out UIT."
  zeg "Moet de Chromebook ook op het rek-netwerk? Sluit die er één keer bij aan (naam \"$ssid\")."
}
rek_op() {   # 619/620: in één tik -- scan (nieuwe telefoons op de lijst, ook de Cat van de kabel) + de relay-lijst (telefoons die zichzelf
  # op het huis-wifi melden). De hotspot is GEEN route meer (§620): een telefoon zonder simkaart verliest zijn internet als zijn wifi
  # uit gaat. De hotspot-knop blijft los bestaan voor later. Nooit de F8.
  zeg "Rek opbouwen: telefoons zoeken + de relay-lijst lezen (telefoons op het huis-wifi)..."
  scan
  zeg "---"
  rek_lijst
  # 623g: na de relay-lijst OOK een rechtstreekse 5555-sweep over dit wifi. Zodra EEN telefoon (via de relay) adb-verbonden is, kent
  # adb zijn /24 en neemt scan_5555 dat net mee -- zo komt een rektelefoon die JARVIS draait en 5555 open heeft
  # er vanzelf bij, OOK zonder hartslag. Nooit de F8 (scan_5555 sluit hem uit). De rem resetten zodat deze tik meteen zoekt.
  zeg "---"
  zeg "Ik zoek nu ook rechtstreeks op dit wifi naar telefoons met draadloze adb (poort 5555)..."
  rm -f "$SCAN5555_T" 2>/dev/null || true
  scan_5555
  # 625: EERLIJK TELLEN. Een net gelegde tcp-verbinding (de relay-lijst of de sweep) staat in `adb devices` een paar tellen op
  # 'offline' voordat de adb-handshake rond is. De oude regel telde alleen de 'device'-stand en meldde dan "0 toestel(len)" vlak
  # na "adb verbonden met 1 adres" -- de tegenstrijdigheid uit de melding. We herstellen eerst de offline transports (adb reconnect),
  # laten ze even settelen, en melden daarna de ECHTE standen: klaar (device), nog-aan-het-verbinden (offline), en wachtend op
  # 'toestaan' op de telefoon zelf (unauthorized). "0 toestel(len)" betekent voortaan echt: niets gevonden.
  "$ADB" reconnect offline >/dev/null 2>&1 || true
  sleep 2
  local dev off unauth
  dev="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{c++} END{print c+0}')"
  off="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="offline"{c++} END{print c+0}')"
  unauth="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized"{c++} END{print c+0}')"
  zeg "adb is nu met $dev toestel(len) klaar voor besturing (nooit de F8)."
  [ "$off" -gt 0 ] 2>/dev/null && zeg "$off toestel(len) staan nog op 'offline' -- de verbinding is net gelegd en settelt; Rek opbouwen over een halve minuut nog eens laat ze meestal als 'klaar' zien."
  [ "$unauth" -gt 0 ] 2>/dev/null && zeg "$unauth toestel(len) wachten op 'Toestaan' op de telefoon zelf -- keur daar eenmalig het usb-/draadloze-foutopsporingsvenster goed (vink 'altijd toestaan' aan)."
  [ "$dev" -eq 0 ] 2>/dev/null && [ "$off" -eq 0 ] 2>/dev/null && [ "$unauth" -eq 0 ] 2>/dev/null && zeg "Nog geen enkel toestel. Een rektelefoon die JARVIS 1.9.79 draait opent poort 5555 vanzelf (ook op een gastnetwerk, ook na een herstart); staat 5555 nog dicht, open dan JARVIS op die telefoon en scan de Veronica-QR, dan zet hij draadloze adb aan."
  return 0   # 625: de [ ] && zeg-regels hierboven mogen de exitcode van rek_op niet op 1 zetten
}
rek_zoek() {
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 1; }
  local f8=""; [ -s "$F8_GEVONDEN_F" ] && f8="$(cat "$F8_GEVONDEN_F")"
  [ -z "$f8" ] && [ -s "$REK_MAP/lokaal-model.conf" ] && f8="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
  zeg "Rektelefoons zoeken op het lokale netwerk (poorten ${REK_ZOEK_POORTEN:-8000 8081 11434}, /v1/models met een model)..."
  local json; json="$(rek_scan_json "$f8")"
  printf '%s' "$json" >"$REK_MAP/reserve-modellen.json"; chmod 600 "$REK_MAP/reserve-modellen.json" 2>/dev/null || true
  local n; n="$(printf '%s' "$json" | grep -oE '"base"' | wc -l | tr -d ' ')"
  if [ "${n:-0}" -eq 0 ]; then
    zeg "Geen extra rektelefoons gevonden naast de F8. (Staat op elke telefoon een model aan -- OlliteRT op 8000 of de eigen motor op 8081?)"
  else
    zeg "$n rektelefoon(s) gekoppeld aan de reserve-keten (na de F8, voor Gemini):"
    printf '%s' "$json" | grep -oE '"base":"[^"]*","token":"[^"]*","model":"[^"]*"' \
      | sed 's#"base":"\([^"]*\)","token":"[^"]*","model":"\([^"]*\)"#  \1 -> \2#' | while IFS= read -r r; do zeg "$r"; done
  fi
  if proxy_draait && [ -n "$f8" ]; then start_proxy "$f8" "local" >/dev/null 2>&1 && zeg "De vangnet-proxy gebruikt nu: F8 -> rektelefoon(s) -> Gemini." || true; fi
  return 0
}
lokaal() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 1; }
  [ -s "$TOEG" ] || { zeg "Geen rektelefoon op de lijst."; return 1; }
  local vondst serial poort model lp="$LOKAAL_POORT"
  zeg "Zoek een lokaal model op de rektelefoons (OlliteRT/ollama, zonder sleutel)..."
  vondst="$(lokaal_vind)"
  if [ -z "$vondst" ]; then
    zeg "Geen lokale OpenAI-server gevonden (geprobeerd: 8000/11434/8080 op elke rektelefoon$([ -s "$REK_MAP/rek-token.conf" ] && echo ', en de eigen motor op 8081 met je rij-code' || echo '; de eigen motor op 8081 vraagt de rij-code: zet die in het veld \"Rij-code\" hieronder')). Staat de eigen motor aan (Veronica: Motor aan)?"
    zeg "Twee wegen:"
    zeg "  1) Start OlliteRT op een rektelefoon (Start Server + een multimodaal Gemma, bv. E4B) en druk opnieuw op 'Lokaal model'."
    zeg "  2) Of de F8 thuis als gast-brein (OlliteRT, >30% accu, niet in gebruik): zet met de hand in $REK_MAP/lokaal-model.conf:"
    zeg "       BASE_URL=http://<F8-ip>:8000/v1 | MODEL=<modelnaam> | TOKEN=local   (elk op een eigen regel, = i.p.v. |)"
    zeg "ARTEMIS blijft zolang op Gemini (terugval)."
    return 1
  fi
  serial="${vondst%%|*}"; model="${vondst##*|}"; poort="$(printf '%s' "$vondst" | cut -d'|' -f2)"
  "$ADB" -s "$serial" forward tcp:"$lp" tcp:"$poort" >/dev/null 2>&1 || true
  local conf_tok=local; [ "$poort" = 8081 ] && conf_tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  printf 'BASE_URL=http://127.0.0.1:%s/v1\nMODEL=%s\nTOKEN=%s\nADB_SERIAL=%s\nADB_FORWARD=%s:%s\n' "$lp" "$model" "${conf_tok:-local}" "$serial" "$lp" "$poort" >"$REK_MAP/lokaal-model.conf"
  chmod 600 "$REK_MAP/lokaal-model.conf"
  zeg "Lokaal model AAN: '$model' op $(toestel_naam "$serial") (telefoonpoort $poort, via 127.0.0.1:$lp). Gemini is nu alleen terugval."
  schrijf_artemis_jsonc   # artemis.jsonc -> lokaal-primair
  lokaal_meet
  zeg "Doe nu: Stop, dan Start, dan een taak. (ARTEMIS herstart met het lokale model.)"
}
lokaal_uit() {
  if [ -s "$REK_MAP/lokaal-model.conf" ] && [ ! -f "$GEM_AAN_F" ]; then
    zeg "Het lokale model blijft staan: Gemini staat UIT, dus er is niets om naar terug te vallen. Zet eerst Gemini bewust aan (knop 'Gemini: uit/aan') als je echt van het lokale model af wilt."
    return 1
  fi
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
  zeg "== Vangnet + modelfouten van de proxy (592h/592i) =="
  if [ -s "$PROXY_LOG" ]; then tail -n 25 "$PROXY_LOG"; else zeg "(nog niets -- de proxy liet alles veilig door en het model antwoordde, of ARTEMIS draait nog niet lokaal)"; fi
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
  # 677: TOON ELKE achtergrond-opdracht (LOPEND schrijft naar console-<cmd>.log). Vroeger alleen start/bijwerken/waakhond, dus
  # 'Telefoon klaarzetten', 'Koppel via de kabel', 'Beheerder' en 'Tailscale' gaven in Log "geen uitkomst". Nu: de nieuwste eerst.
  zeg "== waakhond (laatste 10) =="; [ -s "$REK_MAP/waakhond.log" ] && tail -n 10 "$REK_MAP/waakhond.log" || zeg "(nog niets)"
  local cl
  for cl in $(ls -1t "$REK_MAP"/console-*.log 2>/dev/null); do
    [ -s "$cl" ] && { zeg "== $(basename "$cl" .log) (laatste 12) =="; tail -n 12 "$cl"; } || true
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

# gemini_sleutelsoort: wat voor sleutel staat er in ARTEMIS' .env? aistudio (AIza..., kan gratis zijn) | AQ (werkt hier niet) | vertex (betaald project: NOOIT) | geen | onbekend.
# DE FACTURATIE van het project is NIET uit de sleutel te halen: dat moet de eigenaar in Google AI Studio nakijken (de sleutel toont daar "Free tier" of niet).
gemini_sleutelsoort() {
  local env="$ARTEMIS_MAP/.env" k
  [ -f "$env" ] || { printf 'geen'; return; }
  if grep -qE '^(GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_CLOUD_PROJECT|GOOGLE_APPLICATION_CREDENTIALS|VERTEX[A-Z_]*)=' "$env" 2>/dev/null; then printf 'vertex'; return; fi
  k="$(sed -n 's/^GEMINI_API_KEY=//p' "$env" 2>/dev/null | head -1 | tr -d '"'"'"' \r')"
  case "$k" in '') printf 'geen' ;; AIza*) printf 'aistudio' ;; AQ.*|AQ*) printf 'AQ' ;; *) printf 'onbekend' ;; esac
}
gemini_vandaag() { local d="" n=""; { read -r d n <"$GEM_DAG_F"; } 2>/dev/null || true; if [ "$d" = "$(date +%F)" ]; then printf '%s' "${n:-0}"; else printf '0'; fi; }
gemini_stand() {
  local soort="" vandaag="" stop="" nu=""; soort="$(gemini_sleutelsoort)"; vandaag="$(gemini_vandaag)"; nu="$(date +%s)"
  stop="$(cat "$GEM_STOP_F" 2>/dev/null || true)"
  if [ -f "$GEM_AAN_F" ]; then
    zeg "Gemini: AAN (laatste terugval) -- vandaag $vandaag van hoogstens $GEMINI_MAX_DAG, sleutel: $soort."
    case "$stop" in ''|*[!0-9]*) : ;; *) [ "$stop" -gt "$nu" ] && zeg "Gemini is GESTOPT na een 429/503 (tot $(date -d "@$stop" '+%d-%m %H:%M')); er wordt niet herhaald, ARTEMIS blijft lokaal." ;; esac
  else
    zeg "Gemini: UIT (standaard). ARTEMIS gebruikt alleen het lokale model. Vandaag $vandaag van hoogstens $GEMINI_MAX_DAG."
  fi
}
gemini_aan() {
  local soort; soort="$(gemini_sleutelsoort)"
  case "$soort" in
    aistudio) : ;;
    vertex) zeg "Gemini blijft UIT: in ARTEMIS' .env staan Vertex-/projectgegevens, en Vertex rekent af per gebruik. Haal die weg en gebruik alleen een AI Studio-sleutel (AIza...)."; return 1 ;;
    AQ) zeg "Gemini blijft UIT: een AQ-sleutel werkt hier niet (401) en hoort niet bij de gratis laag. Gebruik een AI Studio-sleutel (AIza...)."; return 1 ;;
    geen) zeg "Gemini blijft UIT: er staat geen GEMINI_API_KEY in ARTEMIS' .env."; return 1 ;;
    *) zeg "Gemini blijft UIT: de sleutel in ARTEMIS' .env is geen AI Studio-sleutel (AIza...), dus ik kan niet weten dat hij gratis is."; return 1 ;;
  esac
  : >"$GEM_AAN_F"; chmod 600 "$GEM_AAN_F" 2>/dev/null || true; rm -f "$GEM_STOP_F"
  schrijf_artemis_jsonc 2>/dev/null || true
  zeg "Gemini: AAN, alleen als allerlaatste terugval, hoogstens $GEMINI_MAX_DAG per dag; bij een 429 of 503 stopt het meteen en blijft ARTEMIS lokaal. LET OP: of het project achter deze sleutel facturatie heeft kan ARTEMIS NIET zien -- controleer in Google AI Studio (Get API key) dat deze sleutel op de gratis laag staat. Doe: Stop, dan Start."
}
gemini_uit() {
  rm -f "$GEM_AAN_F"
  schrijf_artemis_jsonc 2>/dev/null || true
  zeg "Gemini: UIT. ARTEMIS gebruikt alleen het lokale model (en de reserve-telefoons). Doe: Stop, dan Start."
}
gemini_wissel() { if [ -f "$GEM_AAN_F" ]; then gemini_uit; else gemini_aan; fi; }
status() {
  gemini_stand
  if artemis_draait; then
    local p poorten open_poort; p="$(artemis_pid)"   # 592j: echte pid -- ook als het pid-bestand leeg/verouderd is maar 8000 luistert
    zeg "ARTEMIS draait (pid ${p:-onbekend})."
    # 592j: draait ARTEMIS wel maar het verplichte vangnet NIET, waarschuw dan LUID -- dan staat de oude ARTEMIS zonder vangnet
    # (de bug van 592j). Een alleen-kijken-/handel-taak mag zo niet draaien; Stop + Start herstelt het schoon.
    if vangnet_vereist && ! proxy_draait; then
      zeg "LET OP: ARTEMIS draait ZONDER vangnet-proxy! Het model kan dan ongefilterd handelen. Start GEEN alleen-kijken-/handel-taak. Druk op Stop en daarna op Start -- dan herstart ARTEMIS schoon mét vangnet."
    fi
    poorten="$(poorten_van "$p")"
    # 586: poorten_van kijkt in de PROCESGROEP van onze pid; ARTEMIS' echte server kan in een EIGEN sessie draaien en dan
    # valt hij buiten die groep ("GEEN poort") terwijl hij wel antwoordt. Spreek elkaar niet tegen: als iets op ARTEMIS_POORT
    # antwoordt, DAT is de poort. Geen "GEEN poort" meer zolang er iets antwoordt.
    open_poort=""
    if [ -n "$poorten" ]; then open_poort="$(printf '%s' "$poorten" | tr -d ' ' | cut -d, -f1)"; fi
    if antwoordt "$ARTEMIS_POORT"; then
      [ -n "$open_poort" ] || open_poort="$ARTEMIS_POORT"
      [ -n "$poorten" ] && zeg "Luistert op poort(en): $poorten" || zeg "Luistert op poort: $ARTEMIS_POORT (ARTEMIS antwoordt daar)."
      zeg "Open ARTEMIS op: http://$KBHOST:$open_poort"
    elif [ -n "$poorten" ]; then
      zeg "Luistert op poort(en): $poorten"
      zeg "Open ARTEMIS op: http://$KBHOST:$open_poort"
      zeg "(http://$KBHOST:$ARTEMIS_POORT antwoordt nog niet -- gebruik de poort hierboven, of kijk bij Log.)"
    else
      zeg "Luistert nog op GEEN enkele poort en http://$KBHOST:$ARTEMIS_POORT antwoordt niet -- hij start nog op (de eerste keer duurt het een paar minuten) of hij is gestopt. Kijk bij Log."
    fi
  elif [ -f "$REK_MAP/start-gestopt" ]; then
    # 583: na 3 mislukte starts stopte de lus met proberen -- zeg dat duidelijk in plaats van stil te blijven.
    zeg "ARTEMIS staat uit. $(cat "$REK_MAP/start-gestopt")"
  elif [ -f "$AANF" ]; then
    zeg "ARTEMIS staat nu uit, maar de gewenste stand is AAN: de console start hem binnen een minuut vanzelf weer (na een Bijwerken of herstart)."
  else
    zeg "ARTEMIS staat uit (de gewenste stand is uit: druk op Start om hem aan te zetten)."
  fi
  if leeft "$PIDW"; then zeg "De waakhond kijkt mee."; fi
  zeg "Console (knoppen): http://$KBHOST:$CONSOLE_POORT"
  zeg "Rektelefoons op de lijst: $(grep -c . "$TOEG" 2>/dev/null || echo 0)"
  # 678c/678d: vrije ruimte in het hokje (interne Linux-schijf) en op de kaart, of de kaart gedeeld is, en hoe je het hokje groter maakt.
  local vrij_hok; vrij_hok="$(df -Pm "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
  zeg "Vrije ruimte in het hokje (interne Linux-schijf): ${vrij_hok:-?} MB. Te klein voor ARTEMIS? Maak het hokje groter in Instellingen > Over ChromeOS > Linux > Schijfgrootte."
  if op_kaart; then
    local vrij_kaart; vrij_kaart="$(df -Pm "$ARTEMIS_KAART" 2>/dev/null | awk 'NR==2{print $4}')"
    zeg "SD-kaart gedeeld met Linux ($ARTEMIS_KAART): ${vrij_kaart:-?} MB vrij -- grote GEWONE bestanden (APK-downloads, modellen, traces, kopieen) gaan hierheen. Caches/venv blijven in het hokje: het kaartje (FAT via 9p) kan geen file-locks of rename, dus uv/pip/npm werken er niet."
  else
    zeg "SD-kaart: NIET gedeeld met Linux. Deel hem eenmalig (Bestanden > SD-kaart > rechtsklik > Delen met Linux) -- dan gebruik ik hem vanzelf voor grote GEWONE bestanden (geen caches: die kunnen niet op de kaart) en blijft het hokje vrijer."
  fi
  # 678f: wat vult het hokje echt? Toon de grootste mappen onder HOME, zodat een mens ziet waar de ruimte heen gaat (du telt alleen deze schijf: -x).
  # 678g: de beschermde (crypto)mappen van de eigenaar HOREN NIET in de "grootste mappen"-lijst -- ARTEMIS mag ze nooit opruimen.
  local alle; alle="$(du -xm --max-depth=2 "$HOME" 2>/dev/null | sort -rn)"
  local top rust="" r w
  top="$(printf '%s\n' "$alle" | awk -v h="$HOME" '$1>=50 && $2!=h{print}' | while read -r mb pad; do beschermd_pad "$pad" || printf '    %s MB  %s\n' "$mb" "$pad"; done | head -6)"
  [ -n "$top" ] && { zeg "Grootste mappen in het hokje (>= 50 MB, de eigen programma's van de eigenaar staan er NIET bij):"; printf '%s\n' "$top"; }
  # wat we met rust laten, wel eerlijk tonen (zodat het schijfbeeld klopt) maar nooit aanraken
  rust="$(printf '%s\n' "$alle" | awk '$1>=50{print}' | while read -r mb pad; do beschermd_pad "$pad" && printf '    %s MB  %s\n' "$mb" "$pad"; done | head -4)"
  [ -n "$rust" ] && { zeg "Met rust gelaten (van de eigenaar -- NOOIT opruimen of verplaatsen):"; printf '%s\n' "$rust"; }
  # 678 stap 1b: de laatste snelheidsmeting(en) per telefoon, als er al gemeten is
  if [ -d "$MEET_MAP" ] && ls "$MEET_MAP"/*.log >/dev/null 2>&1; then
    zeg "Laatste snelheidsmetingen (llama-bench, tg128 = pure decode; 'Snelheid meten' om te verversen):"
    local mf; for mf in "$MEET_MAP"/*.log; do zeg "  $(basename "$mf" .log): $(grep -iE 'tg128' "$mf" 2>/dev/null | tail -1 | sed 's/^ *//' || echo 'nog geen tg128-regel')"; done
  fi
  # 609: de lokale beheerder zet een melding als een telefoon na het veilige opruimen nog krap is (dan kan alleen een mens helpen).
  [ -s "$REK_MAP/beheerder-melding.txt" ] && zeg "$(cat "$REK_MAP/beheerder-melding.txt")"
  sleutel_check   # 584: waarschuw als de Gemini-sleutel een AQ-sleutel is (401) i.p.v. een AIza-sleutel
  # 585/591/592: welk model gebruikt ARTEMIS? Primair + reserve uit onze config; Log toont welk model ECHT werd aangeroepen.
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    zeg "ARTEMIS denkt LOKAAL (592g): $(sed -n 's/^MODEL=//p' "$REK_MAP/lokaal-model.conf" | head -1) via $(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1) voor ELKE rol (planner, operator, checker, keurmeester); Gemini (gemini-3.8-flash) is alleen terugval. 'Lokaal uit' zet hem terug."
  elif [ -s "$REK_MAP/artemis.jsonc" ]; then
    zeg "ARTEMIS-model (onze config): primair $(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" | head -1), reserve $(sed -n 's/.*"model": *"\([^"]*\)".*/\1/p' "$REK_MAP/artemis.jsonc" | sed -n 2p) (gratis Gemini-laag; 'Lokaal model' laat ARTEMIS lokaal denken; Log toont welk model echt werd gebruikt)."
  fi
  # 592h: de vertaal-/vangnet-proxy en de alleen-kijken-stand.
  if [ -s "$REK_MAP/lokaal-model.conf" ]; then
    if proxy_draait; then zeg "Vangnet-proxy (592h) draait (pid $(cat "$PROXY_PIDF" 2>/dev/null || echo '?')): Gemma's tekst-acties worden echte tool_calls, en gevaarlijke acties worden geblokkeerd."
    elif artemis_draait; then zeg "Vangnet-proxy (592h): DRAAIT NIET terwijl ARTEMIS wel draait -- ARTEMIS werkt dan ZONDER vangnet. Stop + Start herstelt dit."
    else zeg "Vangnet-proxy (592h): nog niet gestart (start zodra ARTEMIS lokaal draait)."; fi
    if [ -f "$ALLEEN_KIJKEN_F" ]; then zeg "Alleen-kijken: AAN -- het model mag alleen Home indrukken. ('Alleen kijken: uit' om te laten handelen.)"
    else zeg "Alleen-kijken: uit -- het model mag handelen; het vangnet (NOODSTOP/Stop/Verwijder/Uninstall + bank/kluis/betaal/crypto) blijft altijd aan."; fi
    # 592L/592r: de reserve-keten en welk model nu antwoordt. De vangnet-regels gelden rondom ELK model in de keten.
    local keten="F8"; [ -s "$REK_MAP/reserve-modellen.json" ] && keten="$keten -> rektelefoon(s)"
    [ -f "$ARTEMIS_MAP/.env" ] && grep -q '^GEMINI_API_KEY=.' "$ARTEMIS_MAP/.env" 2>/dev/null && keten="$keten -> Gemini (gemini-3.8-flash, dan 3.6)"
    zeg "Reserve-keten (592L): $keten. Per verzoek wordt het eerste bereikbare model gekozen; zodra de F8 weer antwoordt gaat het vanzelf terug."
    # 592r: elke gekoppelde rektelefoon met zijn model, en of hij nu antwoordt. ('Rektelefoons koppelen' scant het LAN opnieuw.)
    if [ -s "$REK_MAP/reserve-modellen.json" ] && command -v curl >/dev/null 2>&1; then
      printf '%s' "$(cat "$REK_MAP/reserve-modellen.json")" | grep -oE '"base":"[^"]*","token":"[^"]*","model":"[^"]*"' | while IFS= read -r r; do
        local rb rm rt antw; rb="$(printf '%s' "$r" | sed 's#.*"base":"\([^"]*\)".*#\1#')"; rm="$(printf '%s' "$r" | sed 's#.*"model":"\([^"]*\)".*#\1#')"; rt="$(printf '%s' "$r" | sed 's#.*"token":"\([^"]*\)".*#\1#')"
        if [ -n "$rt" ] && [ "$rt" != local ]; then curl -fsS -m 2 -H "Authorization: Bearer $rt" "$rb/models" >/dev/null 2>&1; antw=$?; else curl -fsS -m 2 "$rb/models" >/dev/null 2>&1; antw=$?; fi
        if [ "$antw" -eq 0 ]; then zeg "  rektelefoon $rb -> $rm (antwoordt)"; else zeg "  rektelefoon $rb -> $rm (nu geen antwoord)"; fi
      done
    fi
    [ -s "$ACTIEF_F" ] && zeg "Nu actief model: $(cat "$ACTIEF_F")"
    [ -s "$REDEN_F" ] && zeg "Laatste verzoek: $(cat "$REDEN_F")"   # 592o: de ECHTE reden (time-out, onbereikbaar, alle acties geblokkeerd, of ok)
    # 592p: de F8 op het LAN -- welk adres gebruiken we nu, en antwoordt OlliteRT? (Bij een ander wifi verandert het IP; de knop
    # "F8 terugvinden" scant het subnet opnieuw.) Toon het teruggevonden adres als dat er is, anders het ingestelde BASE_URL.
    local f8base=""; [ -s "$F8_GEVONDEN_F" ] && f8base="$(cat "$F8_GEVONDEN_F")"
    [ -z "$f8base" ] && [ -s "$REK_MAP/lokaal-model.conf" ] && f8base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" | head -1)"
    case "$f8base" in http://127.0.0.1:*|http://localhost:*|'') : ;; http://*)
      [ -s "$F8_GEVONDEN_F" ] && zeg "F8 teruggevonden op: $f8base (na een IP-wissel vanzelf gevonden)."
      if command -v curl >/dev/null 2>&1 && curl -fsS -m 2 "$f8base/models" >/dev/null 2>&1; then
        zeg "F8 ($f8base): OlliteRT ANTWOORDT -- geen Gemini nodig."
      else
        zeg "F8 ($f8base): GEEN antwoord (ander IP? OlliteRT uit?). Druk op 'F8 terugvinden' om het subnet opnieuw te scannen." ; fi ;;
    esac
    # 592o: staat een lokaal model in de circuit breaker (recent weg), zeg dat -- dan slaat de proxy het even over i.p.v. 9 s wachten.
    if [ -s "$PROXY_LOG" ] && tail -n 15 "$PROXY_LOG" | grep -q '\[breaker\].*overgeslagen'; then zeg "Circuit breaker: een lokaal model (F8) is net weg en wordt ${BREAKER_WEG:-60} s overgeslagen -- de reserve neemt het meteen over."; fi
    if [ -s "$PROXY_LOG" ]; then zeg "Proxy (laatste, vangnet + model): $(tail -n 3 "$PROXY_LOG" | tr '\n' ' ')"; fi
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

# 562/676: TAILSCALE (gratis Personal-plan) zodat je van buitenaf bij Veronica, de rektelefoons en de MCP-reserve kunt, ZONDER
# openbare tunnel. Dit script installeert alleen de Linux-kant op de Chromebook en logt in; het ACCOUNT maak je zelf aan.
# 676: BELANGRIJK voor ChromeOS/Crostini -- een kernel-TUN (tailscale0) laat cros-garcon crashen en kan de hele Linux-VM
# onherstelbaar maken. Daarom DWINGEN we userspace-networking af (FLAGS="--tun=userspace-networking" in /etc/default/tailscaled).
# Gevolg (eerlijk): vanuit Crostini is een telefoon op zijn 100.x NIET transparant te bereiken (geen kernel-route) -- dat gaat via
# de SOCKS5-proxy of `tailscale nc`. De WINST van Tailscale zit bij de TELEFOONS onderling en de relay: die hebben wel kernel-TUN
# en bereiken elkaar op de vaste 100.x over elk wifi. ARTEMIS blijft de telefoons voor de SETUP via de kabel/wifi doen.
tailscale_op() {
  if ! command -v tailscale >/dev/null 2>&1; then
    zeg "Tailscale installeren (officieel script van tailscale.com)..."
    curl -fsSL https://tailscale.com/install.sh | sh || { zeg "Installeren lukte niet."; return 1; }
  fi
  # userspace-networking afdwingen VOORDAT we 'up' doen (anders kan een kernel-TUN de Crostini-VM laten crashen).
  if [ -w /etc/default/tailscaled ] || sudo -n test -e /etc/default/tailscaled 2>/dev/null; then
    if ! grep -q 'tun=userspace-networking' /etc/default/tailscaled 2>/dev/null; then
      printf 'FLAGS="--tun=userspace-networking"\n' | sudo -n tee -a /etc/default/tailscaled >/dev/null 2>&1 \
        && { sudo -n systemctl restart tailscaled 2>/dev/null || true; zeg "  - userspace-networking aangezet (veilig voor ChromeOS/Crostini)."; } \
        || zeg "  - LET OP: kon userspace-networking niet zetten; typ EENMALIG: echo 'FLAGS=\"--tun=userspace-networking\"' | sudo tee -a /etc/default/tailscaled && sudo systemctl restart tailscaled"
    fi
  else
    zeg "  - LET OP: zet eenmalig userspace-networking (anders kan Crostini crashen): echo 'FLAGS=\"--tun=userspace-networking\"' | sudo tee -a /etc/default/tailscaled && sudo systemctl restart tailscaled"
  fi
  # 678b: AL ingelogd? Dan niets te doen -- alleen het adres melden.
  local nu_ip; nu_ip="$(tailscale ip -4 2>/dev/null | head -1)"
  if [ -n "$nu_ip" ] && ! tailscale status 2>/dev/null | grep -qiE 'logged out|stopped'; then
    zeg "Deze Chromebook staat al in Tailscale: $nu_ip. Niets te doen."
    relay_meld "Tailscale: deze Chromebook staat al ingelogd ($nu_ip)."
    return 0
  fi
  # 678b: 'tailscale up' print de INLOGLINK en wacht dan tot je in Chrome inlogt. Dat wachten mag de console niet blokkeren, dus
  # draaien we 'up' in een EIGEN sessie (setsid) op de achtergrond, lezen de link uit de uitvoer, en MELDEN hem naar Veronica/console.
  # De eigenaar hoeft dan alleen in de browser te klikken -- geen terminal. 'up' blijft draaien tot de login rond is.
  zeg "Nu inloggen. Ik haal de inloglink op (klik hem in Chrome en log in met je Tailscale-account)..."
  local uit="$REK_MAP/tailscale-up.log"; : >"$uit" 2>/dev/null || uit="$(mktemp 2>/dev/null || echo /tmp/tailscale-up.log)"
  setsid sudo -n tailscale up >"$uit" 2>&1 </dev/null &
  local url='' i=0
  while [ "$i" -lt 45 ]; do
    url="$(grep -oE 'https://login\.tailscale\.com/[A-Za-z0-9._/-]+' "$uit" 2>/dev/null | head -1)"
    [ -n "$url" ] && break
    local ip2; ip2="$(tailscale ip -4 2>/dev/null | head -1)"
    [ -n "$ip2" ] && { zeg "Al ingelogd: $ip2."; relay_meld "Tailscale: deze Chromebook is ingelogd ($ip2)."; return 0; }
    sleep 1; i=$((i+1))
  done
  if [ -n "$url" ]; then
    zeg "INLOGLINK (open in Chrome en log in met je eigen Tailscale-account):"
    zeg "  $url"
    relay_meld "Tailscale Chromebook: open deze inloglink in Chrome en log in -> $url"
  elif grep -qiE 'is already logged in|already running' "$uit" 2>/dev/null; then
    zeg "Al ingelogd. Adres: $(tailscale ip -4 2>/dev/null | head -1)."
  else
    zeg "Geen inloglink gevonden. Kijk in Log; of (eenmalig, als sudo een wachtwoord vraagt) typ: sudo tailscale up"
    zeg "$(tail -3 "$uit" 2>/dev/null)"
  fi
  zeg "De telefoons zet ik zelf erbij met 'Tailscale op de telefoons' (aan de kabel). De F8 blijft erbuiten."
}

# 676: TAILSCALE OP ELKE REKTELEFOON, via de kabel, zonder dat de eigenaar op de telefoon hoeft te tikken. Nooit de F8.
# Stappen (alle via adb, shell-uid, geen root): (1) de OFFICIELE apk van pkgs.tailscale.com installeren (com.tailscale.ipn);
# (2) de VPN-toestemming vooraf geven met appops ACTIVATE_VPN allow (anders komt het systeem-"Verbindingsverzoek"-venster);
# (3) always-on VPN zetten (settings secure always_on_vpn_app + lockdown) ZODAT hij vanzelf opkomt en terugkomt na een herstart;
# (4) de app starten; (5) de inloglink (https://login.tailscale.com/...) uit logcat vissen en NAAR VERONICA sturen, zodat de
# eigenaar hem EEN keer in de browser op de Chromebook goedkeurt -- geen tik op de telefoon. (Een auth-key kan de officiele
# Android-app alleen via MDM/Device-Owner op een fabrieksverse telefoon; dat is te zwaar voor telefoons die al in gebruik zijn.)
TS_INDEX="${TS_INDEX:-https://pkgs.tailscale.com/stable/}"   # de officiele stabiele index; de Android-apk is VERSIE-GEBONDEN (tailscale-android-universal-<versie>.apk)
# pkgs.tailscale.com/stable/ heeft GEEN 'tailscale-latest.apk' (dat gaf 404). We LEZEN de index en pakken de nieuwste android-universal-apk;
# TS_APK_URL overschrijft dat als iemand een vaste URL wil. Nooit een versie gokken -- een geraden versie is een kapotte link (404).
ts_apk_url() {   # echoot de volledige download-URL van de nieuwste officiele Android-apk, of niets
  if [ -n "${TS_APK_URL:-}" ]; then printf '%s' "$TS_APK_URL"; return 0; fi
  local idx file
  idx="$(curl -fsSL --max-time 60 "$TS_INDEX" 2>/dev/null)" || return 1
  file="$(printf '%s' "$idx" | grep -oE 'tailscale-android-universal-[0-9][0-9.]*\.apk' | sort -V | uniq | tail -1)"
  [ -n "$file" ] || return 1
  printf '%s%s' "$TS_INDEX" "$file"
}
# 678: als de inloglink niet in logcat staat, hem uit het SCHERM van de Tailscale-app vissen -- de app toont de login.tailscale.com-url
# als tekst naast de QR. uiautomator dump, door de §565-gate (nooit de F8, nooit een gevoelige app). PUUR lezen; de XML gaat naar
# /sdcard en wordt meteen gewist. Echoot de url of niets. (De QR-afbeelding zelf lezen kan niet uit XML; de url eronder is wat we nodig hebben.)
ts_ui_loginlink() {
  local s="$1" xml
  [ -n "$s" ] || return 1
  is_f8 "$s" && return 1
  wand_gate "$s" >/dev/null 2>&1 || return 1
  "$ADB" -s "$s" shell uiautomator dump /sdcard/artemis-ts.xml >/dev/null 2>&1 || return 1
  xml="$("$ADB" -s "$s" shell cat /sdcard/artemis-ts.xml 2>/dev/null | tr -d '\r')"
  "$ADB" -s "$s" shell rm -f /sdcard/artemis-ts.xml >/dev/null 2>&1 || true
  printf '%s' "$xml" | grep -oE 'https://login\.tailscale\.com/[A-Za-z0-9/._?=-]+' | head -1
}
# 678 (9 nov 21:16): het rek zit in Tailscale met VASTE 100.x-adressen. ARTEMIS draait in Crostini, die de tun van ChromeOS NIET
# deelt, dus adb bereikt een 100.x niet rechtstreeks. Recept (§676/stap-2): tailscaled in Crostini met userspace-networking (dat
# zet `tailscale_op`), en per telefoon een socat-brug van een lokale poort naar `tailscale nc <100.x> 5555`; dan `adb connect
# 127.0.0.1:<lport>`. Zo werkt het rek op ELK netwerk (elke verhuizing): het 100.x-adres is vast. NOOIT de F8. Geen IP/naam hard
# in dit (openbare) script -- de adressen EN de tailnet-hostnamen komen uit `tailscale status` op de Chromebook (runtime; niets
# staat in de code). De hostnaam wordt wél in het LOKALE console-log getoond (127.0.0.1-only) -- nodig om te zien welk 100.x welke
# telefoon is (de S10/Cat-verwarring van 10 nov: twee 100.x kwamen bij dezelfde Cat uit). NIET vanuit de container te verifiëren
# (geen Tailscale/socat/echte telefoons hier); de proef draait op de Chromebook.
rek_via_tailscale() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 1; }
  command -v tailscale >/dev/null 2>&1 || { zeg "Tailscale ontbreekt in Crostini. Druk eerst op 'Tailscale op deze Chromebook (inloggen)'."; return 1; }
  if ! command -v socat >/dev/null 2>&1; then
    sudo -n apt-get install -y socat >/dev/null 2>&1 || { zeg "socat ontbreekt. Installeer het eenmalig: sudo apt-get install -y socat (daarna werkt deze knop)."; return 1; }
  fi
  tailscale status >/dev/null 2>&1 || { zeg "Tailscale is niet verbonden in Crostini. Druk op 'Tailscale op deze Chromebook (inloggen)' en log in; daarna deze knop opnieuw."; return 1; }
  local zelf status_out regel ip host lport pid n=0 model serial gezien_serie=""
  zelf="$(tailscale ip -4 2>/dev/null | head -1)"
  # 678 (10 nov): ELKE ronde eerst ALLE oude tunnels EN adb-verbindingen weg. Anders is `adb connect 127.0.0.1:560x` een no-op
  # ("already connected") die de verbinding van de VORIGE ronde teruggeeft -- met de serie van de telefoon van toen. Zo versprong
  # het doel van een 100.x tussen rondes (de ene ronde de ene telefoon, de andere ronde een andere op dezelfde poort) en werd de S10 nooit echt
  # verbonden: adb onthoudt de serie PER POORT, en een achtergebleven socat/tailscale-nc houdt de poort vast. Dit is NIET een
  # dubbele Tailscale-aanmelding (de eerste hypothese), maar plak-processen tussen rondes. Alles op PID/poort -- nooit pkill -f,
  # dat raakt de eigen shell (de 592o-les).
  local p q
  for p in 5600 5601 5602 5603 5604 5605 5606 5607 5608 5609; do
    "$ADB" disconnect "127.0.0.1:$p" >/dev/null 2>&1 || true          # adb's gecachte verbinding + serie-per-poort weg (de kern van de fix)
  done
  if [ -f "$TS_BRUG_F" ]; then while read -r _lp _ip _pid; do [ -n "$_pid" ] && kill "$_pid" 2>/dev/null || true; done <"$TS_BRUG_F"; fi
  for p in 5600 5601 5602 5603 5604 5605 5606 5607 5608 5609; do
    for q in $(pids_op_poort "$p" 2>/dev/null); do kill "$q" 2>/dev/null || true; done   # een achtergebleven socat-listener op die poort (PID uit het bestand kan verloren zijn)
  done
  sleep 1                                                              # de oude socat/tailscale-nc laten afsterven voor we opnieuw binden
  : >"$TS_BRUG_F" 2>/dev/null || true
  status_out="$(tailscale status 2>/dev/null)"
  zeg "== Rek via Tailscale (vaste 100.x-adressen; werkt op elk netwerk) =="
  # per peer: het 100.x, de tailnet-hostnaam (kolom 2 -- zo zie je WELKE telefoon welk adres heeft) en of hij offline is. We
  # ONTDUBBELEN op serienummer: komen twee 100.x bij hetzelfde toestel uit (dubbele Tailscale-aanmelding), dan houden we er één en
  # melden de andere -- zodat je ziet dat een adres NIET de telefoon is die je verwacht (de S10/Cat-verwarring van 10 nov).
  # LET OP: lees de peer-regels van FD 3, niet van stdin -- anders eet een commando in de lus (adb/socat/tailscale nc, die stdin
  # lezen) de here-string op en valt de lus na de EERSTE peer stil (de 1-telefoon-regressie van 10 nov). Elk stdin-etend commando
  # krijgt bovendien </dev/null.
  while IFS= read -r regel <&3; do
    ip="$(printf '%s' "$regel" | awk '{print $1}')"
    case "$ip" in 100.*) : ;; *) continue ;; esac
    [ "$ip" = "$zelf" ] && continue
    host="$(printf '%s' "$regel" | awk '{print $2}')"
    if printf '%s' "$regel" | grep -qiw offline; then
      zeg "  - $host ($ip): OFFLINE in Tailscale -- niet te bereiken (staat die telefoon aan en verbonden met Tailscale?)."
      continue
    fi
    lport=$(( 5600 + n ))
    socat "TCP-LISTEN:$lport,reuseaddr,fork,bind=127.0.0.1" "EXEC:tailscale nc $ip 5555" </dev/null >/dev/null 2>&1 &
    pid=$!
    printf '%s %s %s\n' "$lport" "$ip" "$pid" >>"$TS_BRUG_F" 2>/dev/null || true
    sleep 1
    if "$ADB" connect "127.0.0.1:$lport" </dev/null 2>/dev/null | grep -qiE 'connected|already'; then
      if is_f8 "127.0.0.1:$lport"; then
        "$ADB" disconnect "127.0.0.1:$lport" >/dev/null 2>&1 || true; kill "$pid" 2>/dev/null || true
        zeg "  - $host ($ip) is de F8 -- losgekoppeld (nooit besturen)."
        continue
      fi
      model="$(toestel_naam "127.0.0.1:$lport")"; serial="$("$ADB" -s "127.0.0.1:$lport" shell getprop ro.serialno </dev/null 2>/dev/null | tr -d '\r')"
      # ONTDUBBELEN: dit serienummer al eerder verbonden via een ander 100.x? Dan is het DEZELFDE telefoon (twee tailnet-nodes voor
      # één toestel) -- die tweede brug loskoppelen en melden; zo blijf je niet twee keer naar hetzelfde toestel pushen.
      if [ -n "$serial" ] && printf ' %s ' "$gezien_serie" | grep -qF " $serial "; then
        "$ADB" -s "127.0.0.1:$lport" disconnect >/dev/null 2>&1; "$ADB" disconnect "127.0.0.1:$lport" >/dev/null 2>&1 || true; kill "$pid" 2>/dev/null || true
        zeg "  - $host ($ip) = DEZELFDE telefoon (serie $serial, $model) als een eerder 100.x -- overgeslagen. Dubbele Tailscale-aanmelding voor dit toestel; de telefoon die je hier verwacht, staat niet (meer) op dit adres."
        continue
      fi
      gezien_serie="$gezien_serie $serial"
      zeg "  - $host: ${model:-?} (serie ${serial:-?}) via Tailscale ($ip) op adb 127.0.0.1:$lport."
      n=$((n+1))
    else
      kill "$pid" 2>/dev/null || true
      zeg "  - $host ($ip) reageert niet op adb 5555 -- adb-over-tcp staat waarschijnlijk uit (na een herstart). Zet 'm weer aan: sluit die telefoon één keer met de kabel aan en druk op 'Telefoon klaarzetten' (dat zet 5555 herstart-vast)."
    fi
  done 3<<< "$status_out"
  [ "$n" -gt 0 ] && zeg "Rek via Tailscale: $n telefoon(s) verbonden. Blijft werken na een verhuizing (het 100.x-adres is vast)." || zeg "Geen telefoon via Tailscale verbonden (is Tailscale op de telefoons aan en adb 5555?)."
}
# de minuut-scan roept dit aan, maar hoogstens eens per ~300 s (de bruggen blijven staan; niet elke minuut herbouwen). Best-effort.
rek_via_tailscale_rem() {
  command -v tailscale >/dev/null 2>&1 || return 0
  local nu laatst; nu="$(date +%s 2>/dev/null || echo 0)"
  if [ -f "$TS_BRUG_T" ]; then laatst="$(cat "$TS_BRUG_T" 2>/dev/null || echo 0)"; else laatst=0; fi
  [ $((nu - laatst)) -lt 300 ] 2>/dev/null && return 0
  printf '%s\n' "$nu" >"$TS_BRUG_T" 2>/dev/null || true
  rek_via_tailscale >/dev/null 2>&1 || true
}
tailscale_telefoon() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 0; }
  "$ADB" start-server >/dev/null 2>&1 || true
  # de officiele apk EEN keer ophalen (naar de ARTEMIS-map), daarna hergebruiken
  local apk="$JAPK_PLEK/tailscale.apk"
  if [ ! -s "$apk" ]; then
    local url; url="$(ts_apk_url)"
    if [ -z "$url" ]; then
      zeg "Kon de Tailscale-apk niet vinden op de officiele index ($TS_INDEX). Open eenmalig https://pkgs.tailscale.com/stable/#android op de Chromebook, download de Android-apk naar Downloads, en noem hem tailscale.apk; of zet Tailscale via de Play Store op de telefoon."
      return 1
    fi
    zeg "Tailscale-apk ophalen (officieel): $url"
    local tmp="$REK_MAP/tailscale.apk.deel"   # naar het HOKJE (ext4): curl schrijft daar; de kaart (9p) kan geen rename
    if ! curl -fsSL --max-time 300 -o "$tmp" "$url" || [ ! -s "$tmp" ] || [ "$(head -c2 "$tmp" 2>/dev/null)" != "PK" ]; then
      rm -f "$tmp" 2>/dev/null
      zeg "Kon de Tailscale-apk niet officieel ophalen ($url). Open eenmalig https://pkgs.tailscale.com/stable/#android op de Chromebook, download de Android-apk naar Downloads, en noem hem tailscale.apk; of zet Tailscale via de Play Store op de telefoon."
      return 1
    fi
    cp -f "$tmp" "$apk" && rm -f "$tmp"   # 678f: cp+rm i.p.v. mv -- $JAPK_PLEK kan op de kaart staan (9p: geen rename)
    chmod 600 "$apk" 2>/dev/null || true
  fi
  local regels s staat id naam n=0
  regels="$("$ADB" devices 2>/dev/null | awk 'NR>1 && NF>=2 {print $1" "$2}')"
  [ -n "$regels" ] || { zeg "Geen telefoon via de kabel te zien. Sluit de telefoon met USB aan en zet USB-foutopsporing aan."; return 1; }
  while read -r s staat; do
    [ -n "$s" ] || continue
    local draadloos=0; case "$s" in *:*) draadloos=1 ;; esac   # 678: OOK over draadloze adb (ip:5555) -- de rektelefoons kunnen zo zonder kabel in Tailscale
    naam="$(toestel_naam "$s")"; [ -z "$naam" ] && continue
    is_f8 "$s" && { zeg "F8 overgeslagen (de dagelijkse telefoon krijgt NOOIT Tailscale van ons)."; continue; }
    [ "$staat" = "device" ] || { zeg "$naam: nog niet toegestaan (tik 'Toestaan' op de telefoon)."; continue; }
    id="$(toestel_id "$s")"; toegestaan "$id" || { zeg "$naam staat niet op de lijst; overgeslagen (druk eerst op Zoek telefoons)."; continue; }
    zeg "== Tailscale op $naam =="
    # 1. apk installeren (bestaat hij al, dan -r = bijwerken; een andere handtekening wordt door Android geweigerd)
    if "$ADB" -s "$s" shell pm path com.tailscale.ipn >/dev/null 2>&1; then zeg "  - Tailscale stond er al."; else
      # 678s: NOOIT de apk vanaf het 9p-kaartje STREAMEN. `adb install` streamt de apk vanaf het hostpad; een 9p/removable-mount
      # (de SD-kaart, /mnt/chromeos/removable/...) kan daar halverwege op vastlopen ("Performing Streamed Install" + een leesfout).
      # Kopieer de apk daarom eerst naar het HOKJE (ext4, $REK_MAP) en installeer van DAAR; lukt de kopie niet, dan het origineel.
      local apkInst="$REK_MAP/tailscale-install.apk"
      if cp -f "$apk" "$apkInst" 2>/dev/null && [ -s "$apkInst" ]; then :; else apkInst="$apk"; fi
      local uit2; uit2="$("$ADB" -s "$s" install -r "$apkInst" 2>&1)"
      [ "$apkInst" = "$REK_MAP/tailscale-install.apk" ] && rm -f "$apkInst" 2>/dev/null
      if printf '%s' "$uit2" | grep -q Success; then zeg "  - Tailscale geinstalleerd (vanaf het hokje, niet gestreamd van de kaart)."
      elif printf '%s' "$uit2" | grep -q INSTALL_FAILED_USER_RESTRICTED; then
        # De telefoon weigert een install via USB (de shell-uid) tot de schakelaar aan staat. Zeg PRECIES welke, en een eerlijke
        # uitweg. GEEN file://-VIEW-"tik"-terugval: dat install-intent is op moderne Android geblokkeerd (werkt toch niet).
        zeg "  - installeren GEWEIGERD door de telefoon (INSTALL_FAILED_USER_RESTRICTED) -- dit is een instelling van de telefoon, niet een fout van ARTEMIS."
        zeg "    Staat 'Installeren via USB' al aan, dan is meestal OOK 'USB-foutopsporing (beveiligingsinstellingen)' nodig (die laat de shell-uid pakketten beheren); die vraagt op sommige toestellen een ingelogd account van de fabrikant + simkaart."
        zeg "    Lukt dat niet: zet Tailscale EEN keer met de hand uit de Play Store op $naam -- de rest (VPN-toestemming, always-on, inloglink) doet ARTEMIS daarna gewoon. (Op een toestel zonder dit slot gaat het vanzelf.)"
        continue
      else
        # de VOLLEDIGE adb-fout tonen (de 'Failure [...]'-regel valt anders weg; niet afkappen tot 160 tekens).
        zeg "  - installeren lukte niet (volledige adb-fout): $(printf '%s' "$uit2" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-600). Overgeslagen."
        continue
      fi
    fi
    # 2. VPN-toestemming vooraf (geen systeemvenster). appops via shell-uid, geen root.
    "$ADB" -s "$s" shell appops set com.tailscale.ipn ACTIVATE_VPN allow >/dev/null 2>&1 && zeg "  - VPN-toestemming vooraf gegeven (geen venster)." || zeg "  - LET OP: VPN-toestemming vooraf lukte niet; mogelijk tikt de telefoon één keer een venster weg."
    # 3. always-on VPN (komt vanzelf op + terug na herstart). LET OP: na de appop, anders blijft hij 'disconnected'.
    "$ADB" -s "$s" shell settings put secure always_on_vpn_app com.tailscale.ipn >/dev/null 2>&1 || true
    # 678: lockdown NIET over draadloze adb -- dat snijdt de LAN (en onze eigen adb op 5555) af zodra de VPN opkomt, en een rektelefoon
    # moet de relay/postbus over het open internet kunnen bereiken (die zitten niet op het tailnet). Over de kabel: ongewijzigd (lockdown 1).
    if [ "$draadloos" = 1 ]; then "$ADB" -s "$s" shell settings put secure always_on_vpn_lockdown 0 >/dev/null 2>&1 || true
    else "$ADB" -s "$s" shell settings put secure always_on_vpn_lockdown 1 >/dev/null 2>&1 || true; fi
    zeg "  - always-on VPN gezet$([ "$draadloos" = 1 ] && echo ' (draadloos: geen lockdown, zodat adb en de relay blijven werken)')."
    # 4. de app starten en de inloglink uit logcat vissen (de eigenaar keurt hem in de browser goed; geen tik op de telefoon)
    "$ADB" -s "$s" logcat -c >/dev/null 2>&1 || true
    "$ADB" -s "$s" shell am start -n com.tailscale.ipn/.MainActivity >/dev/null 2>&1 || true
    local link="" i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      sleep 2
      link="$("$ADB" -s "$s" logcat -d 2>/dev/null | grep -Eo 'https://login\.tailscale\.com/[A-Za-z0-9/._?=-]+' | head -1)"
      [ -n "$link" ] && break
    done
    if [ -n "$link" ]; then
      zeg "  - inloglink: $link"
      relay_meld "Tailscale op $naam: keur hem goed in de browser op de Chromebook -> $link (één klik; op de telefoon hoef je niets te tikken). Daarna krijgt $naam een vast 100.x-adres." || true
    else
      # 678: niet in logcat? Dan de inloglink/QR-url uit het SCHERM van de Tailscale-app vissen (uiautomator), door de §565-gate.
      link="$(ts_ui_loginlink "$s")"
      if [ -n "$link" ]; then
        zeg "  - inloglink (via het scherm): $link"
        relay_meld "Tailscale op $naam: keur hem goed in de browser op de Chromebook -> $link (één klik; op de telefoon hoef je niets te tikken). Daarna krijgt $naam een vast 100.x-adres." || true
      else
        zeg "  - geen inloglink gevonden (logcat + scherm). Open Tailscale één keer op $naam en tik 'Sign in', of log in via de admin console met een pre-approved auth key."
        relay_meld "Tailscale op $naam staat klaar (apk + VPN-toestemming + always-on), maar ik vond geen inloglink. Open Tailscale één keer op de telefoon en tik 'Sign in', of gebruik een pre-approved auth key in de admin console." || true
      fi
    fi
    n=$((n+1))
  done <<<"$regels"
  if [ "$n" -gt 0 ]; then zeg "Klaar: Tailscale op $n telefoon(s) gezet. Keur de inlogkoppeling(en) in de browser goed; daarna bereiken de telefoons elkaar op hun vaste 100.x over elk wifi."; else zeg "Geen telefoon met Tailscale ingericht (alleen de F8, of niets toegestaan aan de kabel)."; fi
}

# 678 stap 1 (AUTH-KEY): Tailscale op de rektelefoons met een HERBRUIKBARE, vooraf goedgekeurde auth-key (tag:rack), ZONDER een
# inloglink per telefoon. De sleutel is GEHEIM en staat NOOIT in dit (openbare) script: hij komt uit ~/.artemis-rek/tailscale-authkey
# (de eigenaar maakt hem in de Tailscale-admin -- Reusable aan, Tags: tag:rack -- en plakt hem één keer in de console; 600). Install
# zoals §678s (kopie naar het ext4-hokje, nooit van de 9p-kaart streamen); daarna appops ACTIVATE_VPN + always-on, en de bring-up
# via de CONNECT_VPN-broadcast met de key als extra. NOOIT de F8. De key komt NOOIT in een logboek (we tonen alleen 'tskey-...').
# LET OP -- NIET vanuit de container te verifiëren: of de Android-app de key via deze broadcast aanneemt, wijst de proef op de kabel
# uit; lukt het niet, dan blijft de inloglink van 'Tailscale op de telefoons' de uitweg.
# tikt het EERSTE tikbare element aan waarvan het label (hoofdletterongevoelig) op het patroon past; via scherm_boom (uiautomator)
# + wand_besturen (de §565-gate: nooit de F8, nooit een gevoelige app). 0 = getikt, 1 = niet gevonden.
_ts_ui_tik() {
  local s="$1" pat="$2" boom regel cx cy TAB; TAB="$(printf '\t')"
  boom="$(scherm_boom "$s")" || return 1
  regel="$(printf '%s\n' "$boom" | awk -F"$TAB" -v p="$pat" 'tolower($4) ~ tolower(p){print; exit}')"
  [ -n "$regel" ] || return 1
  cx="$(printf '%s' "$regel" | cut -f2)"; cy="$(printf '%s' "$regel" | cut -f3)"
  wand_besturen tik "$s" "$cx" "$cy" >/dev/null 2>&1 || return 1
  return 0
}
# leest + valideert de bewaarde auth-key en echo't hem (de beller gebruikt hem meteen, nooit in een log). 1 = geen geldige sleutel.
ts_authkey_lees() {
  local keyf="$REK_MAP/tailscale-authkey" key
  [ -s "$keyf" ] || return 1
  key="$(head -1 "$keyf" 2>/dev/null | tr -d '\r\n ')"
  case "$key" in tskey-*) : ;; *) return 1 ;; esac
  case "$key" in *[!A-Za-z0-9-]*) return 1 ;; esac   # alleen tskey-...[A-Za-z0-9-], veilig voor input text
  printf '%s' "$key"
}
# zorgt dat de Tailscale-apk klaarstaat; echo't het pad, of niets (1).
ts_authkey_apk() {
  local apk="$JAPK_PLEK/tailscale.apk" url tmp
  if [ ! -s "$apk" ]; then
    url="$(ts_apk_url)"; [ -n "$url" ] || return 1
    tmp="$REK_MAP/tailscale.apk.deel"
    curl -fsSL -m 180 "$url" -o "$tmp" 2>/dev/null && [ -s "$tmp" ] || { rm -f "$tmp" 2>/dev/null; return 1; }
    cp -f "$tmp" "$apk" && rm -f "$tmp"; chmod 600 "$apk" 2>/dev/null || true
  fi
  printf '%s' "$apk"
}
# 678: de wifi van DEZE plek doorgeven aan EEN telefoon, zodat de relay/Tailscale werkt. SSID+wachtwoord staan ALLEEN lokaal
# (~/.artemis-rek/wifi.conf, 600), nooit gepusht; het WACHTWOORD komt nooit in het log (de SSID wel -- dat is de lokale console).
# cmd wifi connect-network (Android 11+). Nooit de F8. 0 = klaar/al-wifi, 1 = overgeslagen/mislukt.
wifi_doorgeven() {
  local s="$1" naam="$2" conf="$REK_MAP/wifi.conf" ssid ww
  is_f8 "$s" && return 1
  [ -s "$conf" ] || { zeg "  - geen wifi van deze plek bewaard; plak SSID + wachtwoord in de console als een nieuwe telefoon geen wifi heeft."; return 1; }
  ssid="$(sed -n 's/^SSID=//p' "$conf" | head -1)"; ww="$(sed -n 's/^WW=//p' "$conf" | head -1)"
  [ -n "$ssid" ] || { zeg "  - de bewaarde wifi heeft geen SSID; plak hem opnieuw."; return 1; }
  if "$ADB" -s "$s" shell ip -o -4 addr show wlan0 2>/dev/null | grep -q 'inet '; then zeg "  - $naam heeft al wifi."; return 0; fi
  if "$ADB" -s "$s" shell cmd wifi connect-network "$ssid" wpa2 "$ww" >/dev/null 2>&1; then zeg "  - wifi van deze plek doorgegeven aan $naam (SSID: $ssid; wachtwoord niet getoond)."; else zeg "  - wifi doorgeven lukte niet op $naam (cmd wifi niet beschikbaar of Android < 11?); zet het wifi eenmalig met de hand."; return 1; fi
  sleep 4
  if "$ADB" -s "$s" shell ip -o -4 addr show wlan0 2>/dev/null | grep -q 'inet '; then zeg "  - $naam is nu op het wifi."; else zeg "  - $naam is nog niet op het wifi (kan even duren; controleer SSID/wachtwoord)."; fi
  return 0
}
# 678: kan deze telefoon TEGELIJK op wifi EN een hotspot (STA+AP concurrency)? Dan kan hij later het eigen rek-wifi worden terwijl
# hij zelf op het huis-wifi zit. ALLEEN LEZEN -- er wordt niets aan- of uitgezet. De uitkomst gaat in het log; niet vanuit de
# container te verifiëren (de echte proef is kort de hotspot aanzetten terwijl wifi aan is). Nooit de F8.
wifi_hotspot_test() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  local s naam feat con gedaan=0
  for s in $(verbonden); do
    # 678: lezen mag OOK draadloos (ip:5555) -- er wordt niets aan-/uitgezet. De F8 nooit.
    is_f8 "$s" && { zeg "F8 overgeslagen (nooit aanraken)."; continue; }
    toegestaan "$(toestel_id "$s")" || continue
    naam="$(toestel_naam "$s")"; [ -z "$naam" ] && continue
    zeg "== Wifi + hotspot tegelijk? (alleen lezen) op $naam =="
    feat="$("$ADB" -s "$s" shell cmd wifi get-softap-supported-features 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
    [ -n "$feat" ] && zeg "  - softap-features: $(printf '%s' "$feat" | sed 's/  */ /g' | cut -c1-240)"
    con="$("$ADB" -s "$s" shell dumpsys wifi 2>/dev/null | tr -d '\r' | grep -iE 'concurren|staapconcurrency|sta.?\+?.?ap|bridged' | head -4 | tr '\n' ' ')"
    [ -n "$con" ] && zeg "  - dumpsys-aanwijzingen: $(printf '%s' "$con" | sed 's/  */ /g' | cut -c1-240)"
    if printf '%s %s' "$feat" "$con" | grep -iqE 'sta.?ap.?concurren|STA_AP_CONCURRENCY|bridged'; then zeg "  - LIJKT wifi + hotspot tegelijk te steunen (STA+AP concurrency); de proef op de kabel bevestigt het."
    else zeg "  - geen duidelijke aanwijzing voor wifi + hotspot tegelijk; mogelijk doet dit toestel het NIET (of de melding staat er niet). Niet geverifieerd -- test het op de kabel door kort de hotspot aan te zetten terwijl wifi aan is."; fi
    zeg "  - (er is NIETS aan- of uitgezet; dit was alleen lezen.)"
    gedaan=$((gedaan+1))
  done
  [ "$gedaan" -gt 0 ] || zeg "Geen rektelefoon aan de kabel (nooit de F8). Druk op 'Zoek telefoons'."
}
# EEN telefoon (serial, naam) aanmelden bij Tailscale met de bewaarde auth-key, zonder tik. 0 = gedaan/al, 1 = overgeslagen.
# De key komt NOOIT in het log (alleen 'tskey-...'). Nooit de F8. Via scherm_boom + wand_besturen (§565-gate). NIET vanuit de
# container geverifieerd: de precieze Tailscale-UI-labels/plekken per versie wijst de proef op de kabel uit.
ts_authkey_een() {
  local s="$1" naam="$2" key apk apkInst uit2 ip
  is_f8 "$s" && return 1
  key="$(ts_authkey_lees)" || { zeg "  - geen (geldige) Tailscale-sleutel ingesteld; Tailscale overgeslagen op $naam."; return 1; }
  apk="$(ts_authkey_apk)" || { zeg "  - kon de Tailscale-apk niet vinden; zet hem via de Play Store of de index."; return 1; }
  if "$ADB" -s "$s" shell pm path com.tailscale.ipn >/dev/null 2>&1; then zeg "  - Tailscale stond er al."; else
    apkInst="$REK_MAP/tailscale-install.apk"
    if cp -f "$apk" "$apkInst" 2>/dev/null && [ -s "$apkInst" ]; then :; else apkInst="$apk"; fi
    uit2="$("$ADB" -s "$s" install -r "$apkInst" 2>&1)"
    [ "$apkInst" = "$REK_MAP/tailscale-install.apk" ] && rm -f "$apkInst" 2>/dev/null
    if printf '%s' "$uit2" | grep -q Success; then zeg "  - Tailscale geinstalleerd (vanaf het hokje)."
    elif printf '%s' "$uit2" | grep -q INSTALL_FAILED_USER_RESTRICTED; then zeg "  - installeren GEWEIGERD (INSTALL_FAILED_USER_RESTRICTED): dit toestel blokkeert install via USB -- zet Tailscale op $naam één keer via de Play Store; daarna doet ARTEMIS de rest."; return 1
    else zeg "  - installeren lukte niet (volledige adb-fout): $(printf '%s' "$uit2" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-600). Overgeslagen."; return 1; fi
  fi
  "$ADB" -s "$s" shell appops set com.tailscale.ipn ACTIVATE_VPN allow >/dev/null 2>&1 && zeg "  - VPN-toestemming vooraf gegeven." || zeg "  - LET OP: VPN-toestemming vooraf lukte niet; ik tik het systeemvenster straks zelf weg."
  "$ADB" -s "$s" shell settings put secure always_on_vpn_app com.tailscale.ipn >/dev/null 2>&1 || true
  # 678: geen lockdown over draadloze adb (zou de LAN/adb afsnijden + de relay blokkeren die niet op het tailnet zit). Kabel: ongewijzigd.
  case "$s" in *:*) "$ADB" -s "$s" shell settings put secure always_on_vpn_lockdown 0 >/dev/null 2>&1 || true ;;
              *) "$ADB" -s "$s" shell settings put secure always_on_vpn_lockdown 1 >/dev/null 2>&1 || true ;; esac
  "$ADB" -s "$s" shell am start -n com.tailscale.ipn/.MainActivity >/dev/null 2>&1 || true
  sleep 3
  if ! _ts_ui_tik "$s" 'auth[ -]?key|sleutel'; then
    _ts_ui_tik "$s" 'more options|meer opties|options|opties|menu' >/dev/null 2>&1; sleep 1
    _ts_ui_tik "$s" 'auth[ -]?key|sleutel' >/dev/null 2>&1
  fi
  sleep 1
  "$ADB" -s "$s" shell input text "$key" >/dev/null 2>&1 && zeg "  - auth-key ingevoerd (tskey-...)." || zeg "  - de sleutel invoeren lukte niet; kijk op $naam of het auth-key-veld open staat."
  sleep 1
  _ts_ui_tik "$s" 'connect|verbind|log ?in|inloggen|aanmelden|^ok$' >/dev/null 2>&1; sleep 2
  _ts_ui_tik "$s" '^ok$|toestaan|allow|akkoord' >/dev/null 2>&1; sleep 1
  "$ADB" -s "$s" shell am broadcast -a com.tailscale.ipn.CONNECT_VPN -n com.tailscale.ipn/.IPNReceiver >/dev/null 2>&1 || true
  sleep 3
  ip="$("$ADB" -s "$s" shell ip -o -4 addr 2>/dev/null | tr -d '\r' | grep -oE '100\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -n "$ip" ]; then zeg "  - tailnet-adres van $naam: $ip"; else zeg "  - tailnet-adres nog niet zichtbaar (kan even duren; kijk anders in de Tailscale-admin of $naam verschijnt)."; fi
  return 0
}
tailscale_authkey() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  ts_authkey_lees >/dev/null || { zeg "Geen Tailscale auth-key ingesteld. Maak er één in de Tailscale-admin (Settings > Keys: Reusable aan) en plak hem in het veld 'Tailscale-sleutel' hieronder. Alleen lokaal (600), nooit in code/log/GitHub/relay/Veronica."; return 0; }
  local s naam staat gedaan=0
  for s in $(verbonden); do
    # 678: OOK draadloos (ip:5555) -- zo kunnen de rektelefoons zonder kabel met de auth-key in Tailscale. De F8 nooit.
    staat="$("$ADB" -s "$s" get-state 2>/dev/null | tr -d '\r')"; [ "$staat" = "device" ] || { zeg "$(toestel_naam "$s"): nog niet toegestaan (tik 'Toestaan')."; continue; }
    is_f8 "$s" && { zeg "F8 overgeslagen (nooit Tailscale van ons, nooit besturen)."; continue; }
    naam="$(toestel_naam "$s")"; [ -z "$naam" ] && continue
    toegestaan "$(toestel_id "$s")" || { zeg "$naam staat niet op de lijst; overgeslagen (druk eerst op Zoek telefoons)."; continue; }
    zeg "== Tailscale (auth-key) op $naam =="
    wifi_doorgeven "$s" "$naam"
    ts_authkey_een "$s" "$naam" && gedaan=$((gedaan+1))
  done
  [ "$gedaan" -gt 0 ] || zeg "Geen rektelefoon aan de kabel om te koppelen (nooit de F8). Druk op 'Zoek telefoons'."
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

# =========================================================================
# 602: DE SCHERMENWAND -- alle rektelefoons' schermen DRAADLOOS naast elkaar, en ze kunnen bediend worden (tik/veeg/toets).
# EERST KIJKEN, DAN BEDIENEN. Elke schermfoto EN elke tik gaat eerst door wand_gate(): nooit de F8, alleen een telefoon die op
# de rektelefoon-lijst staat, en NOOIT terwijl er een GEVOELIGE (bank/kluis/authenticator/betaal/crypto) OF een PERSOONLIJKE
# (werk: Gmail/WhatsApp/Foto's/...) app op de voorgrond staat -- dan geen beeld en geen tik, met een reden (dezelfde §565-zeef als
# de waakhond: verboden()). Een NOODSTOP-bestand blokkeert in één keer ALLE besturing (kijken mag dan nog, besturen niet).
WAND_STOP_F="$REK_MAP/wand-noodstop"
json_s() { printf '"%s"' "$(printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
# wand_gate <serial> -- echoot een reden en geeft 1 als het NIET mag; stil + 0 als het mag.
wand_gate() {
  local s="${1:-}" id pkg soort
  [ -n "$s" ] || { printf 'geen telefoon'; return 1; }
  if is_f8 "$s"; then printf 'de F8 (de dagelijkse telefoon) wordt nooit bekeken of bestuurd'; return 1; fi
  id="$(toestel_id "$s")"
  toegestaan "$id" || { printf 'staat niet op de rektelefoon-lijst'; return 1; }
  pkg="$(voorgrond "$s")"
  if soort="$(verboden "$pkg")"; then
    [ "$soort" = streng ] && { printf 'een gevoelige app staat op de voorgrond (%s) -- geen beeld, geen tik' "$pkg"; return 1; }
    printf 'een persoonlijke app staat op de voorgrond (%s) -- geen beeld, geen tik' "$pkg"; return 1
  fi
  return 0
}
# schermfoto <serial> -- schrijft een PNG naar $REK_MAP en print het pad; bij een dichte poort: "GEWEIGERD <reden>" en exit 3.
schermfoto() {
  local s="${1:-}" reden id uit
  if ! reden="$(wand_gate "$s")"; then zeg "GEWEIGERD $reden"; return 3; fi
  id="$(toestel_id "$s")"; uit="$REK_MAP/wand-$(printf '%s' "$id" | tr -c 'A-Za-z0-9_.-' '_').png"
  if "$ADB" -s "$s" exec-out screencap -p >"$uit" 2>/dev/null && [ -s "$uit" ]; then zeg "$uit"; return 0; fi
  rm -f "$uit" 2>/dev/null || true; zeg "GEWEIGERD de schermfoto lukte niet (telefoon vergrendeld of adb kwijt)"; return 3
}
# schermenwand -- JSON van de telefoons die nu op de wand horen (serial, naam, id, en de reden als er nu niets getoond mag worden).
# 678 (punt 22): JSON van de AANWEZIGE rektelefoons voor Veronica ("aanwezig" hangt zo niet alleen van de hartslag af). Alleen LEZEN.
# Per toestel: het typenummer (ro.product.model), hoe het verbonden is (kabel / wifi / tailscale) en een korte sleutel (8 hex van
# een hash van het serienummer -- het serienummer zelf gaat NIET naar buiten). De F8 komt er nooit in. Een toestel in de Tailscale-
# bruggenlijst telt mee ook als het niet op de kabellijst staat (dat is precies het geval dat Veronica miste).
# 678 (12 nov): het JARVIS-toestel-id van een telefoon, door de telefoon ZELF verteld (adb-doorsturing naar JARVIS' eigen poort 8080, /jarvis/status). Dat bindt een
# ARTEMIS-toestel (serienummer) aan de telefoon in Veronica op IDENTITEIT, niet op IP-adres of naam. Alleen lezen, korte time-outs, 10 minuten onthouden (600).
# Antwoordt JARVIS niet (niet geinstalleerd/niet gestart) dan is het antwoord leeg: nooit een id verzinnen.
JARVIS_ID_F="$REK_MAP/jarvis-toestel-ids"; JARVIS_ID_TTL="${JARVIS_ID_TTL:-600}"; JARVIS_ID_POORT="${JARVIS_ID_POORT:-18091}"
jarvis_toestel_id() {
  local s="$1" sl="$2" nu t id regel
  nu="$(date +%s 2>/dev/null || echo 0)"
  regel="$(awk -v k="$sl" '$1==k{print; exit}' "$JARVIS_ID_F" 2>/dev/null)"
  if [ -n "$regel" ]; then
    t="$(printf '%s' "$regel" | awk '{print $3}')"; case "$t" in ''|*[!0-9]*) t=0 ;; esac
    if [ $((nu - t)) -lt "$JARVIS_ID_TTL" ]; then printf '%s' "$regel" | awk '{ if ($2 != "-") print $2 }'; return 0; fi
  fi
  command -v curl >/dev/null 2>&1 || return 0
  "$ADB" -s "$s" forward --remove tcp:"$JARVIS_ID_POORT" >/dev/null 2>&1 || true
  id=""
  if timeout 6 "$ADB" -s "$s" forward tcp:"$JARVIS_ID_POORT" tcp:8080 >/dev/null 2>&1; then
    id="$(curl -fsS -m 3 "http://127.0.0.1:$JARVIS_ID_POORT/jarvis/status" 2>/dev/null | grep -oE '"toestel"[^}]*"id"[[:space:]]*:[[:space:]]*"[a-z0-9]{12,32}"' | grep -oE '"[a-z0-9]{12,32}"$' | tr -d '"' | head -1)"
  fi
  "$ADB" -s "$s" forward --remove tcp:"$JARVIS_ID_POORT" >/dev/null 2>&1 || true
  { awk -v k="$sl" '$1!=k' "$JARVIS_ID_F" 2>/dev/null; printf '%s %s %s\n' "$sl" "${id:--}" "$nu"; } >"$JARVIS_ID_F.t" 2>/dev/null && mv -f "$JARVIS_ID_F.t" "$JARVIS_ID_F" 2>/dev/null || true
  chmod 600 "$JARVIS_ID_F" 2>/dev/null || true
  [ -n "$id" ] && printf '%s' "$id"
  return 0
}
# 678 (12 nov, punt 2/4/5 van de toestellenlijst): WAT DRAAIT ER OP DE REKTELEFOONS? Per telefoon, via een adb-doorsturing (alleen lezen, korte time-outs): de eigen
# motor (poort 8081, vraagt de rij-code uit rek-token.conf; de code gaat nooit in een melding) en de spraakserver (8082: stem en oor). Zo zie je in een regel of
# "Motor aan" gelukt is, of het model geladen is, en of Piper/Whisper klaar staan. De DUURTEST bouwt daarop: elke 5 minuten een meetregel, 24 uur lang.
MOTOR_LOK_POORT="${MOTOR_LOK_POORT:-18092}"
DUUR_F="$REK_MAP/duurtest.log"; DUUR_AAN_F="$REK_MAP/duurtest-aan"
tel_http() {   # $1 serienummer, $2 poort op de telefoon, $3 pad, $4 token (optioneel) -> de body, of niets
  local s="$1" p="$2" pad="$3" tok="${4:-}" out rc
  "$ADB" -s "$s" forward --remove tcp:"$MOTOR_LOK_POORT" >/dev/null 2>&1 || true
  timeout 6 "$ADB" -s "$s" forward tcp:"$MOTOR_LOK_POORT" tcp:"$p" >/dev/null 2>&1 || return 1
  if [ -n "$tok" ]; then out="$(curl -fsS -m 4 -H "Authorization: Bearer $tok" "http://127.0.0.1:$MOTOR_LOK_POORT$pad" 2>/dev/null)"; rc=$?
  else out="$(curl -fsS -m 4 "http://127.0.0.1:$MOTOR_LOK_POORT$pad" 2>/dev/null)"; rc=$?; fi
  "$ADB" -s "$s" forward --remove tcp:"$MOTOR_LOK_POORT" >/dev/null 2>&1 || true
  [ "$rc" -eq 0 ] && [ -n "$out" ] && printf '%s' "$out"
  return 0
}
motor_staat_van() {   # $1 serienummer -> "staat|tps" (staat: klaar|laden|uit|fout|geen-code|niets) ; tps leeg als onbekend
  local s="$1" tok="" body staat tps
  [ -s "$REK_MAP/rek-token.conf" ] && tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  body="$(tel_http "$s" 8081 /health "$tok")"
  if [ -z "$body" ]; then
    if [ -z "$tok" ]; then body="$(tel_http "$s" 8081 /health "")"; [ -n "$body" ] || { printf 'geen-code|'; return 0; }
    else printf 'niets|'; return 0; fi
  fi
  staat="$(printf '%s' "$body" | sed -n 's/.*"staat" *: *"\([a-z]*\)".*/\1/p' | head -1)"
  tps="$(printf '%s' "$body" | sed -n 's/.*"decode_tokens_per_second" *: *\([0-9.]*\).*/\1/p' | head -1)"
  printf '%s|%s' "${staat:-niets}" "$tps"
}
spraak_staat_van() {   # $1 serienummer -> "stem|oor" (klaar|laden|uit|fout|niets)
  local s="$1" tok="" body stem oor
  [ -s "$REK_MAP/rek-token.conf" ] && tok="$(head -1 "$REK_MAP/rek-token.conf" 2>/dev/null | tr -d '\r\n ')"
  body="$(tel_http "$s" 8082 /health "$tok")"
  [ -n "$body" ] || { printf 'niets|niets'; return 0; }
  stem="$(printf '%s' "$body" | sed -n 's/.*"stem" *: *"\([a-z]*\)".*/\1/p' | head -1)"; oor="$(printf '%s' "$body" | sed -n 's/.*"oor" *: *"\([a-z]*\)".*/\1/p' | head -1)"
  printf '%s|%s' "${stem:-niets}" "${oor:-niets}"
}
motor_status() {
  command -v "$ADB" >/dev/null 2>&1 || { zeg "adb ontbreekt."; return 0; }
  command -v curl >/dev/null 2>&1 || { zeg "curl ontbreekt."; return 0; }
  local s id naam m st tps sp stem oor n=0 hint
  zeg "Eigen motor (poort 8081) en spraak (poort 8082) per rektelefoon -- alleen lezen:"
  [ -s "$REK_MAP/rek-token.conf" ] || zeg "  (Zonder rij-code in het veld \"Rij-code\" kan ik de motor alleen zien als hij open staat.)"
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"; naam="${naam:-onbekend}"; n=$((n+1))
    m="$(motor_staat_van "$s")"; st="${m%%|*}"; tps="${m##*|}"
    sp="$(spraak_staat_van "$s")"; stem="${sp%%|*}"; oor="${sp##*|}"
    case "$st" in
      klaar) hint="" ;;
      laden) hint=" -- het model wordt geladen; even wachten" ;;
      uit) hint=" -- zet in Veronica 'Motor aan' (op wifi en aan de lader)" ;;
      geen-code) hint=" -- de motor vraagt de rij-code: zet die in het veld \"Rij-code\"" ;;
      fout) hint=" -- de motor meldt een fout; kijk in Veronica bij deze telefoon" ;;
      *) hint=" -- geen antwoord van de motor (staat JARVIS aan? is de motor aangezet?)" ;;
    esac
    zeg "  $naam: motor $st$([ -n "$tps" ] && echo " (~$tps tok/s geschat)")$hint; stem $stem, oor $oor"
  done
  [ "$n" -gt 0 ] || zeg "  Geen rektelefoon verbonden."
}
# Duurtest: elke 5 minuten (console-lus) een meetregel per telefoon zolang het vlagbestand er is, hoogstens 25 uur. Alleen getallen; geen inhoud.
duurtest_start() { date +%s >"$DUUR_AAN_F"; chmod 600 "$DUUR_AAN_F" 2>/dev/null || true; : >"$DUUR_F"; chmod 600 "$DUUR_F" 2>/dev/null || true; zeg "Duurtest gestart: elke 5 minuten een meting per telefoon, 24 uur lang. Kijk met 'Duurtest-uitslag'; stop met 'Duurtest stop'."; duurtest_tik; }
duurtest_stop() { rm -f "$DUUR_AAN_F"; zeg "Duurtest gestopt. De metingen blijven staan; kijk met 'Duurtest-uitslag'."; }
duurtest_tik() {
  [ -f "$DUUR_AAN_F" ] || return 0
  local t0 nu s id naam sl m st sp stem oor bat lvl tmp
  t0="$(head -1 "$DUUR_AAN_F" 2>/dev/null)"; nu="$(date +%s)"; case "$t0" in ''|*[!0-9]*) t0="$nu" ;; esac
  if [ $((nu - t0)) -gt 90000 ]; then rm -f "$DUUR_AAN_F"; return 0; fi
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s" | tr -cd 'A-Za-z0-9 ._-')"; sl="$(printf '%s' "$id" | sha256sum | cut -c1-8)"
    m="$(motor_staat_van "$s")"; st="${m%%|*}"; sp="$(spraak_staat_van "$s")"; stem="${sp%%|*}"; oor="${sp##*|}"
    bat="$(timeout 8 "$ADB" -s "$s" shell dumpsys battery 2>/dev/null | tr -d '\r')"
    lvl="$(printf '%s\n' "$bat" | grep -m1 -oE 'level: *[0-9]+' | grep -oE '[0-9]+')"; tmp="$(printf '%s\n' "$bat" | grep -m1 -oE 'temperature: *[0-9]+' | grep -oE '[0-9]+')"
    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "$nu" "$sl" "${naam:-onbekend}" "${tmp:--}" "${lvl:--}" "$st" "$stem" "$oor" >>"$DUUR_F"
  done
  [ "$(wc -l <"$DUUR_F" 2>/dev/null || echo 0)" -gt 20000 ] && tail -n 15000 "$DUUR_F" >"$DUUR_F.t" && mv -f "$DUUR_F.t" "$DUUR_F"
  return 0
}
duurtest_uitslag() {
  [ -s "$DUUR_F" ] || { zeg "Nog geen duurtest-metingen. Start met 'Duurtest start'."; return 0; }
  zeg "Duurtest$([ -f "$DUUR_AAN_F" ] && echo ' (loopt nog)'):"
  awk -F'|' '
    { id=$2; n[id]++; naam[id]=$3; if (!(id in t0)) t0[id]=$1; t1[id]=$1;
      if ($4!="-") { if (!(id in tmax) || $4+0>tmax[id]) tmax[id]=$4+0 }
      if ($5!="-") { if (!(id in amin) || $5+0<amin[id]) amin[id]=$5+0 }
      if ($6=="klaar") up[id]++;
      if (id in vorig && vorig[id]=="klaar" && $6!="klaar") uitval[id]++;
      vorig[id]=$6 }
    END { for (id in n) { uren=(t1[id]-t0[id])/3600; pct=int(100*up[id]/n[id]);
        printf "  %s: %d metingen over %.1f uur; motor klaar %d%%; %d keer uitgevallen; hoogste temp %s graden; laagste accu %s%%; %s\n", naam[id], n[id], uren, pct, uitval[id]+0, (id in tmax)? sprintf("%.1f", tmax[id]/10) : "?", (id in amin)? amin[id] : "?", (uren>=23.5 && pct>=95 && uitval[id]+0==0) ? "24 UUR GEHAALD" : (uren>=23.5 ? "24 uur gelopen, maar met uitval" : "nog niet 24 uur") } }' "$DUUR_F"
}
rek_aanwezig() {
  local eerste=1 s naam via sl tmp jid
  printf '['
  for s in $(verbonden); do
    is_f8 "$s" && continue
    naam="$(toestel_naam "$s")"; naam="$(printf '%s' "$naam" | tr -cd 'A-Za-z0-9 ._-')"; [ -n "$naam" ] || naam="onbekend"
    via="kabel"
    case "$s" in
      127.0.0.1:56[0-9][0-9]) via="tailscale" ;;
      *:*) via="wifi" ;;
    esac
    sl="$(printf '%s' "$(toestel_id "$s")" | sha256sum | cut -c1-8)"
    # 678: de BATTERIJTEMPERATUUR (dumpsys geeft tienden van graden). Leeg of onzin = null: nooit een getal verzinnen.
    tmp="$(timeout 8 "$ADB" -s "$s" shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 -oE 'temperature: *[0-9]+' | grep -oE '[0-9]+$')"
    case "$tmp" in ''|*[!0-9]*) tmp="null" ;; *) tmp="$(awk -v t="$tmp" 'BEGIN{printf "%.1f", t/10}')" ;; esac
    [ "$eerste" = 1 ] || printf ','; eerste=0
    jid="$(jarvis_toestel_id "$s" "$sl")"
    printf '{"model":%s,"via":%s,"sleutel":%s,"temp":%s,"toestel":%s}' "$(json_s "$naam")" "$(json_s "$via")" "$(json_s "$sl")" "$tmp" "$([ -n "$jid" ] && json_s "$jid" || echo null)"
  done
  printf ']\n'
}
schermenwand() {
  local eerste=1 s id naam reden
  printf '['
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"; naam="${naam:-onbekend}"
    reden="$(wand_gate "$s")" && reden=""
    [ "$eerste" = 1 ] || printf ','; eerste=0
    printf '{"serial":%s,"naam":%s,"id":%s,"reden":%s}' "$(json_s "$s")" "$(json_s "$naam")" "$(json_s "$id")" "$(json_s "$reden")"
  done
  printf ']\n'
}
wand_maat() { "$ADB" -s "$1" shell wm size 2>/dev/null | tr -d '\r' | sed -n 's/.*Physical size: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1; }
_frac_ok() { case "${1:-}" in ''|*[!0-9.]*) return 1 ;; esac; awk "BEGIN{exit !($1>=0 && $1<=1)}"; }
# wand_besturen tik|veeg|toets <serial> <args...> -- altijd eerst noodstop + wand_gate.
wand_besturen() {
  local wat="${1:-}" s="${2:-}" reden wh w h
  [ -f "$WAND_STOP_F" ] && { zeg "GEWEIGERD de noodstop staat aan (druk op Hervat om weer te besturen)"; return 3; }
  if ! reden="$(wand_gate "$s")"; then zeg "GEWEIGERD $reden"; return 3; fi
  wh="$(wand_maat "$s")"; w="${wh%% *}"; h="${wh##* }"
  case "$wat" in
    tik)
      local xf="${3:-}" yf="${4:-}" x y
      { _frac_ok "$xf" && _frac_ok "$yf" && [ -n "$w" ] && [ -n "$h" ]; } || { zeg "GEWEIGERD onbruikbare tik (maat of plek)"; return 3; }
      x="$(awk "BEGIN{printf \"%d\", $xf*$w}")"; y="$(awk "BEGIN{printf \"%d\", $yf*$h}")"
      "$ADB" -s "$s" shell input tap "$x" "$y" >/dev/null 2>&1 && zeg ok || { zeg "GEWEIGERD de tik lukte niet"; return 3; } ;;
    veeg)
      local xf="${3:-}" yf="${4:-}" xg="${5:-}" yg="${6:-}" ms="${7:-250}" x1 y1 x2 y2
      { _frac_ok "$xf" && _frac_ok "$yf" && _frac_ok "$xg" && _frac_ok "$yg" && [ -n "$w" ] && [ -n "$h" ]; } || { zeg "GEWEIGERD onbruikbare veeg"; return 3; }
      case "$ms" in ''|*[!0-9]*) ms=250 ;; esac
      x1="$(awk "BEGIN{printf \"%d\", $xf*$w}")"; y1="$(awk "BEGIN{printf \"%d\", $yf*$h}")"
      x2="$(awk "BEGIN{printf \"%d\", $xg*$w}")"; y2="$(awk "BEGIN{printf \"%d\", $yg*$h}")"
      "$ADB" -s "$s" shell input swipe "$x1" "$y1" "$x2" "$y2" "$ms" >/dev/null 2>&1 && zeg ok || { zeg "GEWEIGERD de veeg lukte niet"; return 3; } ;;
    toets)
      local kc; case "${3:-}" in terug|BACK) kc=KEYCODE_BACK ;; thuis|HOME) kc=KEYCODE_HOME ;; apps|APP) kc=KEYCODE_APP_SWITCH ;; *) zeg "GEWEIGERD onbekende toets"; return 3 ;; esac
      "$ADB" -s "$s" shell input keyevent "$kc" >/dev/null 2>&1 && zeg ok || { zeg "GEWEIGERD de toets lukte niet"; return 3; } ;;
    typ)
      # tekst typen op de telefoon (bv. een zoekterm). ALLEEN een veilige tekenset (geen ; & $ ` " ' | enz. die de shell op de
      # telefoon zou kunnen herinterpreteren); spaties gaan als %s mee (wat `adb shell input text` verwacht). Wachtwoorden horen
      # hier NIET (die staan in Bitwarden op de zandbak) -- en een gevoelige app op de voorgrond is sowieso al door wand_gate weg.
      local txt="${3:-}"
      [ -n "$txt" ] || { zeg "GEWEIGERD lege tekst"; return 3; }
      case "$txt" in *[!A-Za-z0-9\ ._,:/@?!-]*) zeg "GEWEIGERD alleen gewone tekst (letters, cijfers en . , : / @ ? ! - _ en spaties)"; return 3 ;; esac
      "$ADB" -s "$s" shell input text "${txt// /%s}" >/dev/null 2>&1 && zeg ok || { zeg "GEWEIGERD typen lukte niet"; return 3; } ;;
    *) zeg "GEWEIGERD onbekende besturing"; return 3 ;;
  esac
}
wand_noodstop() { : >"$WAND_STOP_F"; zeg "Noodstop aan: de schermenwand bestuurt niets meer (kijken mag nog)."; }
wand_hervat() { rm -f "$WAND_STOP_F" 2>/dev/null || true; zeg "Noodstop uit: de schermenwand mag weer besturen."; }

# 678 stap 8 (de LEZER): de ENE plek die de schermboom van EEN telefoon uitleest en als machinelijst teruggeeft. uiautomator dump
# -> genummerde tikbare elementen, EEN per regel "N<TAB>cx<TAB>cy<TAB>label" (plek als fractie 0..1). PUUR lezen; de XML gaat naar
# /sdcard, wordt gelezen en METEEN gewist (niets bewaard). De beller (scherm_lees voor een mens, scherm_doe voor het lokale model)
# doet zelf de §565-zeef (wand_gate + is_f8) VOOR hij dit aanroept -- hier staat alleen het lezen+ontleden, geen besturing.
scherm_boom() {
  local s="${1:-}" xml wh w h
  [ -n "$s" ] || return 1
  "$ADB" -s "$s" shell uiautomator dump /sdcard/artemis-ui.xml >/dev/null 2>&1 || return 2
  xml="$("$ADB" -s "$s" shell cat /sdcard/artemis-ui.xml 2>/dev/null | tr -d '\r')"
  "$ADB" -s "$s" shell rm -f /sdcard/artemis-ui.xml >/dev/null 2>&1 || true
  [ -n "$xml" ] || return 3
  wh="$(wand_maat "$s")"; w="${wh%% *}"; h="${wh##* }"
  printf '%s' "$xml" | ARTEMIS_W="${w:-1080}" ARTEMIS_H="${h:-1920}" python3 -c '
import sys, os, re, html
xml = sys.stdin.read()
W = float(os.environ.get("ARTEMIS_W") or 1080); H = float(os.environ.get("ARTEMIS_H") or 1920)
n = 0
for nd in re.findall(r"<node\b[^>]*?/?>", xml):
    def at(k):
        m = re.search(r"\b" + k + r"=\"(.*?)\"", nd); return html.unescape(m.group(1)) if m else ""
    if at("clickable") != "true": continue
    label = (at("text") or at("content-desc")).strip()
    if not label: continue
    b = re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", nd)
    if not b: continue
    x1, y1, x2, y2 = map(int, b.groups())
    if W <= 0 or H <= 0: continue
    cx = (x1 + x2) / 2 / W; cy = (y1 + y2) / 2 / H
    if not (0 <= cx <= 1 and 0 <= cy <= 1): continue
    n += 1
    sys.stdout.write("%d\t%.3f\t%.3f\t%s\n" % (n, cx, cy, label[:48]))
    if n >= 25: break
' 2>/dev/null
}

# 678 stap 8 (voor een MENS): het scherm als tekst, alle rektelefoons aan de kabel. Elke telefoon eerst door wand_gate (nooit de
# F8, alleen op de lijst, nooit bij een gevoelige/persoonlijke app -- de §565-zeef), dan scherm_boom en netjes geformatteerd. De
# uitvoer is een KORTE genummerde lijst tikbare elementen met hun plek als fractie (0..1), zodat het lokale model of een mens
# element N met 'wand-tik <fractie>' kan aantikken. De F8 wordt hier NOOIT gelezen (wand_gate + is_f8).
scherm_lees() {
  local s id naam reden gedaan=0 boom TAB
  TAB="$(printf '\t')"
  zeg "Scherm als tekst lezen (uiautomator) -- alleen de rektelefoons, nooit de F8, en nooit terwijl er een gevoelige of persoonlijke app op de voorgrond staat."
  for s in $(verbonden); do
    case "$s" in *:*) continue ;; esac                      # alleen de kabel
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"; naam="${naam:-$id}"
    if ! reden="$(wand_gate "$s")"; then zeg "== $naam: GEWEIGERD $reden =="; continue; fi
    boom="$(scherm_boom "$s")"
    if [ -z "$boom" ]; then zeg "== $naam: geen tikbare tekst-elementen (scherm uit/vergrendeld of lege boom) =="; continue; fi
    zeg "== $naam -- scherm als tekst (tikbare elementen; tik met de wand of de fractie) =="
    printf '%s\n' "$boom" | while IFS="$TAB" read -r n cx cy label; do
      [ -n "$n" ] && zeg "$(printf '  %2d. %s  [tik %s %s]' "$n" "$label" "$cx" "$cy")"
    done
    gedaan=$((gedaan+1))
  done
  [ "$gedaan" -gt 0 ] || zeg "Geen rektelefoon aan de kabel om te lezen (druk op 'Zoek telefoons'; de F8 wordt nooit gelezen)."
}

# 678 (eigenaar 11 nov 17:41): het scherm als TEKST voor het MODEL in plaats van een schermafbeelding (de proxy roept dit aan). Een tekstmodel kan zo plannen
# zonder beeld, en de F8 weigert niet meer door beeld + 60 berichten + gereedschap. EERSTE regel is een vast woord zodat de proxy het kan lezen:
#   GEWEIGERD <reden>  de §565-zeef (wand_gate) zegt nee (gevoelige/persoonlijke app, de F8, niet op de lijst): er gaat GEEN beeld en GEEN tekst naar het model;
#   GEEN <reden>       niet te lezen (scherm uit/vergrendeld, geen telefoon): de proxy mag het beeld dan laten staan;
#   SCHERM ...         de tekst. Nooit de F8; alleen kabel of een Tailscale-meettunnel (127.0.0.1:56xx), geen draadloos adb.
# Zonder serial: de EERSTE leesbare rektelefoon (ARTEMIS krijgt van ons geen vaste telefoon; met een telefoon aangesloten is dat exact die ene).
scherm_tekst() {
  local want="${1:-}" s naam reden boom TAB tekst
  TAB="$(printf '\t')"
  for s in $(verbonden); do
    is_f8 "$s" && continue
    [ -n "$want" ] && [ "$s" != "$want" ] && continue
    case "$s" in 127.0.0.1:56[0-9][0-9]) : ;; *:*) continue ;; esac
    naam="$(toestel_naam "$s")"; naam="${naam:-telefoon}"
    if ! reden="$(wand_gate "$s")"; then printf 'GEWEIGERD %s\n' "$reden"; return 0; fi
    boom="$(scherm_boom "$s")"
    tekst="$(scherm_zichtbaar "$s")"
    if [ -z "$boom" ] && [ -z "$tekst" ]; then printf 'GEEN het scherm van %s is uit of vergrendeld, of heeft geen tekst\n' "$naam"; return 0; fi
    printf 'SCHERM van %s (als tekst, in plaats van een schermafbeelding). Tikbare elementen, plek als fractie 0..1:\n' "$naam"
    printf '%s\n' "$boom" | while IFS="$TAB" read -r n cx cy label; do [ -n "$n" ] && printf '  %s. %s [%s %s]\n' "$n" "$label" "$cx" "$cy"; done
    [ -n "$tekst" ] && printf 'Overige zichtbare tekst: %s\n' "$tekst"
    return 0
  done
  printf 'GEEN geen leesbare rektelefoon\n'
}
# De zichtbare tekst (ook niet-tikbaar), kort en ontdubbeld; dezelfde uiautomator-dump als scherm_boom en meteen gewist.
scherm_zichtbaar() {
  local s="${1:-}" xml
  [ -n "$s" ] || return 1
  "$ADB" -s "$s" shell uiautomator dump /sdcard/artemis-ui.xml >/dev/null 2>&1 || return 2
  xml="$("$ADB" -s "$s" shell cat /sdcard/artemis-ui.xml 2>/dev/null | tr -d '\r')"
  "$ADB" -s "$s" shell rm -f /sdcard/artemis-ui.xml >/dev/null 2>&1 || true
  printf '%s' "$xml" | python3 -c '
import sys, re, html
xml = sys.stdin.read(); gezien = []; 
for nd in re.findall(r"<node\b[^>]*?/?>", xml):
    for k in ("text", "content-desc"):
        m = re.search(r"\b" + k + r"=\"(.*?)\"", nd)
        t = html.unescape(m.group(1)).strip() if m else ""
        if t and t[:60] not in gezien: gezien.append(t[:60])
sys.stdout.write(" | ".join(gezien[:40]))
' 2>/dev/null
}

# 615: EEN VRAAG -> ELKE REKTELEFOON EEN ANDERE ZOEKMACHINE in zijn eigen browser (am start VIEW). Zo ziet de eigenaar de
# resultaten naast elkaar op de wand. Rouleert de machines; NOOIT de F8, alleen een toegestane telefoon, en wand_gate blokkeert
# als er een gevoelige/persoonlijke app op de voorgrond staat. De vraag gaat URL-gecodeerd mee (geen shell-injectie).
# De machines zijn "openen in de browser om te BEKIJKEN", niet de kassa-scrapers -- daarom mogen DuckDuckGo/Brave/Google hier wel.
ZOEKMACHINES="DuckDuckGo|https://duckduckgo.com/?q= Brave|https://search.brave.com/search?q= Mojeek|https://www.mojeek.com/search?q= Google|https://www.google.com/search?q= Wikipedia|https://nl.wikipedia.org/w/index.php?search="
wand_zoek() {
  local vraag="${1:-}"
  [ -n "$vraag" ] || { zeg "GEWEIGERD geen zoekvraag"; return 3; }
  [ -f "$WAND_STOP_F" ] && { zeg "GEWEIGERD de noodstop staat aan (druk op Hervat)"; return 3; }
  local enc; enc="$(ZQ="$vraag" python3 -c 'import os,urllib.parse;print(urllib.parse.quote_plus(os.environ.get("ZQ","")))' 2>/dev/null)"
  [ -n "$enc" ] || { zeg "GEWEIGERD kon de zoekvraag niet coderen"; return 3; }
  local -a M=($ZOEKMACHINES); local i=0 s id naam reden mach machnaam machurl n=0
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    naam="$(toestel_naam "$s")"
    if ! reden="$(wand_gate "$s")"; then zeg "$naam: overgeslagen ($reden)"; continue; fi
    mach="${M[$(( i % ${#M[@]} ))]}"; machnaam="${mach%%|*}"; machurl="${mach##*|}"
    if "$ADB" -s "$s" shell am start -a android.intent.action.VIEW -d "${machurl}${enc}" >/dev/null 2>&1; then
      zeg "$naam -> $machnaam"; n=$((n+1))
    else zeg "$naam: de zoekmachine openen lukte niet"; fi
    i=$((i+1))
  done
  zeg "Klaar: $n telefoon(s) zoeken nu, elk op een andere zoekmachine. Kijk op de wand."
}
# 615: EEN TIK NAAR ALLE REKTELEFOONS TEGELIJK, in schermprocenten (0..1). Reuse wand_besturen (maat -> pixels, wand_gate, noodstop).
wand_tik_allen() {
  local xf="${1:-}" yf="${2:-}" s id n=0
  [ -f "$WAND_STOP_F" ] && { zeg "GEWEIGERD de noodstop staat aan (druk op Hervat)"; return 3; }
  { _frac_ok "$xf" && _frac_ok "$yf"; } || { zeg "GEWEIGERD onbruikbare plek (0..1)"; return 3; }
  for s in $(verbonden); do
    is_f8 "$s" && continue
    id="$(toestel_id "$s")"; toegestaan "$id" || continue
    wand_besturen tik "$s" "$xf" "$yf" >/dev/null 2>&1 && n=$((n+1))
  done
  zeg "Getikt op $n telefoon(s) tegelijk (nooit de F8)."
}

# 678 stap 8 (ARTEMIS OP TEKST, de LUS): het LOKALE MODEL kiest één element uit de schermlijst, ARTEMIS tikt het aan via de
# bestaande wand (wand_besturen = §565-gate + noodstop). Zo "ziet" het lokale model het scherm als tekst en bestuurt het de
# telefoon zonder beeld. STRIKT: puur lezen met scherm_boom, kiezen door het model, tikken via de wand. Nooit de F8, nooit een
# gevoelige/persoonlijke app (elke ronde opnieuw door wand_gate), hoogstens SCHERM_DOE_MAX stappen, en de noodstop stopt meteen.
# Het model KRIJGT alleen het doel + de genummerde lijst en mag ALLEEN een nummer, KLAAR of GEEN teruggeven -- geen vrije opdracht,
# geen tekst om te typen. Geen model bereikbaar = ARTEMIS doet NIETS (het model is de bestuurder, niet ARTEMIS zelf).
lok_model_klaar() {
  local base token
  base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"
  [ -n "$base" ] || return 1
  token="$(sed -n 's/^TOKEN=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"
  curl -fsS -m 5 ${token:+-H "Authorization: Bearer $token"} "${base%/}/models" >/dev/null 2>&1
}
# vraag het lokale model (OpenAI-compatibel, de rektelefoon-motor of de F8 via lokaal-model.conf) welk genummerd element het wil
# aantikken. Print UITSLUITEND een nummer, KLAAR of GEEN. Alles via env (geen shell-injectie); de JSON bouwt python3.
scherm_vraag_model() {
  local doel="$1" boom base token model
  base="$(sed -n 's/^BASE_URL=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"
  token="$(sed -n 's/^TOKEN=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"
  model="$(sed -n 's/^MODEL=//p' "$REK_MAP/lokaal-model.conf" 2>/dev/null | head -1)"
  boom="$2"
  [ -n "$base" ] || { printf 'GEEN'; return 1; }
  DOEL="$doel" BOOM="$boom" BASE="$base" TOKEN="${token:-local}" MODEL="${model:-local}" python3 -c '
import os, re, json, urllib.request
doel = os.environ["DOEL"]; boom = os.environ["BOOM"]
rij = []
for r in boom.splitlines():
    c = r.split("\t")
    if len(c) >= 4: rij.append("%s. %s" % (c[0], c[3]))
lijst = "\n".join(rij)
sys = ("Je bestuurt een Androidtelefoon door EEN genummerd element aan te tikken. Je krijgt een DOEL en de zichtbare tikbare "
       "elementen. Antwoord met UITSLUITEND het nummer van het element dat je wilt aantikken, of KLAAR als het doel al bereikt "
       "is, of GEEN als geen element past. Geen uitleg, alleen een nummer, KLAAR of GEEN.")
usr = "DOEL: %s\n\nELEMENTEN:\n%s\n\nAntwoord (alleen een nummer, KLAAR of GEEN):" % (doel, lijst)
body = json.dumps({"model": os.environ["MODEL"], "messages": [{"role":"system","content":sys},{"role":"user","content":usr}], "max_tokens": 8, "temperature": 0}).encode()
req = urllib.request.Request(os.environ["BASE"].rstrip("/") + "/chat/completions", data=body, headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["TOKEN"]})
try:
    d = json.load(urllib.request.urlopen(req, timeout=90))
    t = (d["choices"][0]["message"]["content"] or "").strip()
except Exception:
    print("GEEN"); raise SystemExit
tl = t.lower()
m = re.search(r"\d+", t)
if "klaar" in tl or "done" in tl: print("KLAAR")
elif "geen" in tl or "none" in tl: print("GEEN")
elif m: print(m.group(0))
else: print("GEEN")
' 2>/dev/null || printf 'GEEN'
}
scherm_doe() {
  local doel="${1:-}" s="${2:-}" cand reden naam boom keuze regel cx cy label stap=0 max="${SCHERM_DOE_MAX:-8}" TAB
  TAB="$(printf '\t')"
  [ -n "$doel" ] || { zeg "GEWEIGERD geen doel opgegeven (zeg wat ARTEMIS moet bereiken)."; return 3; }
  [ -f "$WAND_STOP_F" ] && { zeg "GEWEIGERD de noodstop staat aan (druk op Hervat)."; return 3; }
  lok_model_klaar || { zeg "Geen lokaal model bereikbaar (zet eerst 'F8 terugvinden' of een rektelefoon-motor aan). ARTEMIS op tekst doet niets zonder model -- het model is de bestuurder."; return 1; }
  if [ -z "$s" ]; then
    for cand in $(verbonden); do case "$cand" in *:*) continue ;; esac; is_f8 "$cand" && continue; toegestaan "$(toestel_id "$cand")" || continue; s="$cand"; break; done
  fi
  [ -n "$s" ] || { zeg "Geen rektelefoon aan de kabel (nooit de F8)."; return 1; }
  is_f8 "$s" && { zeg "GEWEIGERD de F8 wordt nooit bestuurd."; return 3; }
  toegestaan "$(toestel_id "$s")" || { zeg "GEWEIGERD die telefoon staat niet op de rektelefoon-lijst."; return 3; }
  naam="$(toestel_naam "$s")"; naam="${naam:-$(toestel_id "$s")}"
  zeg "ARTEMIS op tekst -- doel: $doel (telefoon: $naam, hoogstens $max stappen). Het lokale model kiest; ARTEMIS tikt via de §565-gate."
  while [ "$stap" -lt "$max" ]; do
    [ -f "$WAND_STOP_F" ] && { zeg "Noodstop -- gestopt (stap $stap)."; return 0; }
    if ! reden="$(wand_gate "$s")"; then zeg "Gestopt: $reden."; return 0; fi
    boom="$(scherm_boom "$s")"
    [ -n "$boom" ] || { zeg "Geen tikbare elementen op het scherm -- gestopt (stap $stap)."; return 0; }
    keuze="$(scherm_vraag_model "$doel" "$boom")"
    case "$keuze" in
      KLAAR) zeg "Het model zegt: doel bereikt (na $stap stap(pen))."; return 0 ;;
      ''|GEEN) zeg "Het model ziet geen passend element -- gestopt (stap $stap)."; return 0 ;;
      *[!0-9]*) zeg "Het model gaf geen bruikbaar nummer ($keuze) -- gestopt."; return 0 ;;
    esac
    regel="$(printf '%s\n' "$boom" | awk -F"$TAB" -v k="$keuze" '$1==k{print; exit}')"
    [ -n "$regel" ] || { zeg "Nummer $keuze staat niet op het scherm -- gestopt."; return 0; }
    cx="$(printf '%s' "$regel" | cut -f2)"; cy="$(printf '%s' "$regel" | cut -f3)"; label="$(printf '%s' "$regel" | cut -f4)"
    zeg "Stap $((stap+1)): tik $keuze ($label) op $naam."
    wand_besturen tik "$s" "$cx" "$cy" >/dev/null 2>&1 || { zeg "De tik lukte niet -- gestopt."; return 0; }
    stap=$((stap+1))
    sleep 1
  done
  zeg "Klaar: $max stappen gedaan (de grens). Kijk op de wand of het doel bereikt is."
}

# 571: bij start en console eerst zichzelf bijwerken vanaf de site, dan opnieuw starten met de nieuwe code (een keer, geen lus).
if { [ "${1:-}" = start ] || [ "${1:-}" = console ]; } && [ -z "${ARTEMIS_HERSTART:-}" ]; then
  # 678 (12 nov): bij het OPSTARTEN (ook na Bijwerken) mag het ophalen de console nooit minuten ophouden: een SNELLE poging (25 s, geen retry, een keer). De grondige
  # vorm (3 pogingen, 90 s) is alleen voor de knop Bijwerken.
  BIJWERK_POGINGEN=1 BIJWERK_TIMEOUT=25 BIJWERK_RETRY=0 zelf_bijwerken >/dev/null 2>&1 || true
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
  schrijf-proxy) schrijf_artemis_proxy ;;   # 592h: de vertaal-/vangnet-proxy (her)schrijven
  alleen-kijken) alleen_kijken_aan ;;       # 592h: alleen-kijken AAN -- het model mag alleen Home indrukken
  alleen-kijken-uit) alleen_kijken_uit ;;   # 592h: alleen-kijken UIT -- het model mag weer handelen (vangnet blijft)
  cat-kijk) cat_kijk ;;                      # 116b: kijken wat ruimte inneemt op de Cat (niets aangeraakt)
  cat-ruim) cat_ruim ;;                      # 609: veilig opruimen op de Cat (caches, kladmap, oude apk's, mislukte downloads)
  duraspeed-uit) duraspeed_uit ;;            # 628: MediaTek DuraSpeed per telefoon uitzetten (na controle), nooit de F8
  kennisboek-kijk) kennisboek_kijk ;;        # 165: de tekstmap van het kennisboek op de Cat-SD bekijken (maakt hem aan als hij er niet is)
  kennisboek-deel) kennisboek_deel ;;        # 165: het kennisboek delen met dufs op 127.0.0.1 (alleen op deze computer)
  kennisboek-terug) kennisboek_terug ;;      # 165: de lokale spiegel terugzetten naar de Cat
  kennisboek-kopie) kennisboek_kopie ;;      # 165: een versleutelde nachtkopie (idempotent per dag)
  beheerder-opslag) beheerder_opslag ;;      # 609: de lokale beheerder -- vanzelf de opslag van de rektelefoons bewaken + veilig opruimen
  beheerder) beheerder_ronde ;;              # 675: de lokale beheerder -- weggevallen rektelefoon zelf draadloos terughalen, anders de eigenaar via Veronica (kabel/tik)
  hardware) hardware ;;                      # 594: RAM/chip/opslag per rektelefoon -- kan een oude telefoon de F8 vervangen?
  motor-meet) motor_meet ;;                   # 678 stap 1b: echte modelsnelheid meten (llama-bench, CPU, grote kernen), nooit de F8
  motor-status) motor_status ;;                  # 678: motor (8081) en spraak (8082) per rektelefoon, alleen lezen
  duurtest-start) duurtest_start ;;              # 678: 24-uurs duurtest: elke 5 minuten een meetregel per telefoon
  duurtest-stop) duurtest_stop ;;
  duurtest-uitslag) duurtest_uitslag ;;
  duurtest-tik) duurtest_tik >/dev/null 2>&1 || true ;;
  voortgang) voortgang_toon ;;                 # 678 (12 nov): laatste commit-tijd per tak, uit de publieke API (en met een token ook van privé-repo's)
  voortgang-controle) voortgang_controle ;;    # 678: stil; een melding als er langer dan 30 minuten niets gepusht is
  meet-hervat) meet_hervat ;;                  # 678 (12 nov): de lezer van een losgekoppelde meting weer starten na een console-herstart
  meetuitslag) meetuitslag ;;                  # 678 (10 nov): de llama-bench-tabel per telefoon tonen (uit ~/.artemis-rek/meet/*.log) -- synchroon, geen 12-regel-afkapping van de Log
  motor-zoek) f8_zoek ;;                        # 592p: de F8 terugvinden op het LAN na een IP-wissel (ander wifi)
  f8-kabel) f8_kabel_adres ;;                   # 678j: de F8 aan de kabel -- lees ALLEEN zijn wifi-adres uit en zet hem als denker (nooit besturen)
  scherm-tekst) scherm_tekst "${2:-}" ;;          # 678: het scherm als tekst voor het MODEL (de proxy roept dit aan)
  scherm-lees) scherm_lees ;;                   # 678 stap 8: het scherm als tekst lezen (uiautomator), alleen de rektelefoons, nooit de F8, nooit een gevoelige app
  scherm-doe) scherm_doe "${2:-}" "${3:-}" ;;   # 678 stap 8: de lus -- het lokale model kiest een element, ARTEMIS tikt het aan via de wand (§565-gate), nooit de F8
  versies) jarvis_versies ;;                    # 678p: welke JARVIS-versie per telefoon echt geïnstalleerd is (alleen lezen, nooit de F8)
  rek-zoek) rek_zoek ;;
  rek-hotspot) rek_hotspot "${2:-}" ;;         # 616: het eigen rek-netwerk opzetten (hotspot-basis + de rest erop), nooit de F8
  rek-op) rek_op "${2:-}" ;;                    # 619/620: in één tik -- scan + relay-lijst (de rektelefoons terug in het rek, op het huis-wifi), nooit de F8
  rek-lijst) rek_lijst ;;                       # 620: lees de relay-lijst (telefoons die zichzelf melden) en verbind adb; scan alleen als de lijst leeg is
  rek-diag) rek_diag ;;                          # 623d: zeg WAAROM de relay-lijst leeg is (relay onbereikbaar / fout onderwerp / geen adres)
  draadloos-auto) draadloos_auto ;;            # 596: een al toegestane telefoon over het wifi besturen (kabel mag eruit)
  kabel-koppel) kabel_koppel ;;                # (4): herstart-vast draadloos via Android 11+ foutopsporing (geen koppelcode nodig)                         # 592r: alle rektelefoons koppelen aan de reserve-keten (Gemma 4 + andere modellen)
  klaarzetten-auto) telefoon_klaarzetten auto ;;   # 667d: de minuut-lus -- alleen een NIEUWE, nog niet klaargezette telefoon aan de kabel
  klaarzetten) telefoon_klaarzetten ;;         # 667c: een rektelefoon aan de kabel volledig klaarzetten (wifi/DNS/batterij/5555/JARVIS), nooit de F8
  overzicht) overzicht ;;
  rek-aanwezig) rek_aanwezig ;;                 # 678 punt 22: JSON van de aanwezige rektelefoons (alleen lezen) voor Veronica
  gemini-aan) gemini_aan ;;                    # 678: Gemini AAN (alleen laatste terugval, gratis AIza-sleutel, dagplafond)
  gemini-uit) gemini_uit ;;
  gemini-wissel) gemini_wissel ;;               # 678: de knop 'Gemini: uit/aan' in de console
  gemini-stand) gemini_stand ;;
  schermenwand) schermenwand ;;                # 602: JSON van de telefoons op de wand (serial, naam, reden als er nu niets mag)
  schermfoto) schermfoto "${2:-}" ;;           # 602: één schermfoto (pad), of GEWEIGERD met reden (§565-zeef, nooit de F8)
  wand-tik) wand_besturen tik "${2:-}" "${3:-}" "${4:-}" ;;
  wand-veeg) wand_besturen veeg "${2:-}" "${3:-}" "${4:-}" "${5:-}" "${6:-}" "${7:-}" ;;
  wand-toets) wand_besturen toets "${2:-}" "${3:-}" ;;
  wand-typ) wand_besturen typ "${2:-}" "${3:-}" ;;
  wand-zoek) wand_zoek "${2:-}" ;;             # 615: elke rektelefoon een andere zoekmachine openen met dezelfde vraag
  wand-tik-allen) wand_tik_allen "${2:-}" "${3:-}" ;;   # 615: één tik naar alle rektelefoons tegelijk (schermprocenten)
  wand-noodstop) wand_noodstop ;;              # 602: alle besturing blokkeren in één keer
  wand-hervat) wand_hervat ;;
  vergeet) vergeet ;;
  bijwerken) bijwerken ;;
  zelf-bijwerken) bijwerken ;;   # 577: de oude console stuurt Bijwerken hierheen -> ook dan venv-rebuild + console-herstart
  zelf-bijwerken-stil) BIJWERK_POGINGEN=1 BIJWERK_TIMEOUT=25 BIJWERK_RETRY=0 zelf_bijwerken >/dev/null 2>&1 || true ;;   # 587: de console-lus; ALLEEN ophalen (geen venv/herstart) -- herstart_als_nieuwer laadt de nieuwe code
  toestellen) toestellen ;;
  draadloos) draadloos ;;
  mcp) mcp ;;
  searxng) searxng ;;
  tailscale) tailscale_op ;;
  tailscale-telefoon) tailscale_telefoon ;;   # 676: Tailscale op elke rektelefoon via de kabel (nooit de F8); inloglink naar Veronica
  rek-tailscale) rek_via_tailscale ;;   # 678: adb de rektelefoons op hun vaste 100.x via Tailscale (socat/tailscale nc) -- werkt op elk netwerk
  tailscale-authkey) tailscale_authkey ;;     # 678 stap 1: Tailscale met een auth-key, volledig zonder tik (toestellen die USB-install toestaan; anders via de Play Store), nooit de F8
  wifi-hotspot-test) wifi_hotspot_test ;;      # 678: kan een telefoon tegelijk wifi + hotspot (STA+AP)? alleen lezen, uitkomst in het log, nooit de F8
  status) status ;;
  log) log ;;
  schijf) schijf ;;
  opruimen) opruimen ;;
  waakhond) waakhond ;;
  waak-een-keer) waakhond een ;;
  verboden) verboden "${2:-}" ;;
  *) zeg "Gebruik: artemis-rek console | start | stop | status | log | scan | bijwerken | toestellen | draadloos | draadloos-auto | kabel-koppel | mcp | searxng | tailscale" ;;
esac
REK
  chmod 755 "$bin/artemis-rek.nieuw"
  # Atomisch vervangen: een lopende artemis-rek (de console) houdt zijn oude inode en blijft heel; de VOLGENDE aanroep is nieuw.
  mv "$bin/artemis-rek.nieuw" "$bin/artemis-rek"
  # 592: artemis.jsonc via de ENE runtime-functie schrijven (lokaal-primair als lokaal-model.conf er is, anders Gemini-primair).
  REK_MAP="$rek" BIN_SELF="$bin" bash "$bin/artemis-rek" schrijf-jsonc >/dev/null 2>&1 || true
  # 592h: de vertaal-/vangnet-proxy alvast schrijven, en de alleen-kijken-stand STANDAARD AAN zetten zolang niemand hem bewust
  # koos (veiligheid eerst -- het model mag dan alleen Home). Een keuze (knop) zet de 'beslist'-markering en blijft daarna staan,
  # ook over zelf-updates (--alleen-bestanden), omdat we hier alleen bij AFWEZIGHEID van die markering de standaard zetten.
  REK_MAP="$rek" BIN_SELF="$bin" bash "$bin/artemis-rek" schrijf-proxy >/dev/null 2>&1 || true
  [ -f "$rek/alleen-kijken-beslist" ] || touch "$rek/alleen-kijken"
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
zeg "Alles gaat nu via de console in Chrome: http://$KBHOST:$CONSOLE_POORT (op ChromeOS NIET localhost -- de Linux-VM heet penguin.linux.test)"
zeg "Daar staan de knoppen Start, Stop, Status, Zoek telefoons en Bijwerken. De console draait voortaan vanzelf,"
zeg "werkt zichzelf bij vanaf de site, en zoekt elke minuut zelf nieuwe rektelefoons. Je hoeft hier niets meer te typen."
# EINDE-ARTEMIS-SCRIPT
