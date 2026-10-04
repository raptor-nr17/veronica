# Veronica

Een commandostation in Chrome voor je **eigen** telefoons met
[OlliteRT](https://github.com/NightMean/OlliteRT) (Gemma op een Android-telefoon), op je
**eigen netwerk**. Een installeerbare app (PWA) die ook zonder internet opstart.

## Wat Veronica doet

- **Live**: een tegel per telefoon. Je ziet wat hij nu doet, en de tekst die hij op dat
  moment schrijft. Daarbij snelheid, benutting, batterij, temperatuur, hittestand en
  stroomstand. **Alleen echte metingen**: bij elk getal staan de bron en de leeftijd.
  Ouder dan 10 seconden is grijs ("laatst gezien"). Niet gemeten = "onbekend". Nooit een
  voorbeeld- of schatwaarde.
- **Wachtrij**: vragen gaan naar de telefoons die vrij zijn. Valt er een weg, dan gaat zijn
  vraag naar een andere. De wachtrij staat in de browser (IndexedDB).
- **Pantser aan/uit**, **Vervang onderdeel**, en een grote **NOODSTOP**. De noodstop zet de
  wachtrij stil en vraagt elke telefoon om OlliteRT te stoppen, als daar REST API
  Integration aan staat.
- **Scherm meekijken** (keuze): alleen bij een telefoon met de JARVIS-app, die het zelf
  aanzet. Android vraagt elke keer toestemming. Er komt ongeveer één klein beeld per seconde,
  alleen op het eigen netwerk, met de code van die telefoon.

- **Zon en stroom**: zonsopkomst en -ondergang, het zonvenster, de stroomstand, slimme stekkers
  (Tasmota: aan/uit, watt, kWh), de accu-verwachting per telefoon en een dagstaaf met de kWh in
  en buiten het zonvenster. Dat komt allemaal van de hoofdtelefoon, met bron en leeftijd.
  Veronica rekent de zon niet zelf uit, en schakelt geen stekker: ze leest alleen.

## Privacy

- In deze app staan **geen** namen, adressen of andere persoonlijke gegevens. Wat je koppelt
  (telefoons, codes, de wachtrij, uitkomsten) bewaart Veronica **alleen in je eigen
  browser**.
- Veronica praat **rechtstreeks** met de telefoons op je eigen netwerk. Er gaat niets naar
  een server op internet.
- Chrome vraagt de eerste keer of de app het **lokale netwerk** mag gebruiken (Local Network
  Access). Zonder die toestemming kan Veronica de telefoons niet bereiken.

## Eerlijk

- Veronica werkt alleen zolang de computer **aan** is en **niet slaapt**. "Houd het scherm aan"
  helpt (Wake Lock), maar een dichtgeklapte Chromebook slaapt toch.
- Een verzoek van een https-pagina naar een http-adres op je eigen netwerk lukt alleen in een
  Chrome met Local Network Access, en met jouw toestemming. In een oudere Chrome werkt dat niet.
- Merk, model, batterij en hitte van een telefoon zie je alleen als daar ook de JARVIS-app op
  staat. OlliteRT zelf geeft dat niet.

## Installeren

Open de pagina in Chrome en kies in de adresbalk "Installeren". Koppelen doe je bij
**Koppelen**: typ het adres en de code van je hoofdtelefoon, of scan de QR die hij toont.
