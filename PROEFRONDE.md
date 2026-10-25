# Proefronde voor Claude in Chrome op de echte Veronica

Dit is de vaste lijst waarmee Claude (in Chrome op de Chromebook, op de echte Veronica-site (GitHub Pages)) autonoom elke
knop en werking van Veronica nakijkt. Elke knop heeft een vaste `data-proef`-naam, zodat Claude hem betrouwbaar vindt,
ook als de id of de tekst verandert. De lijst en de knoppen worden gelijk gehouden door `check_proefronde.js`: elke
`data-proef` in de pagina staat hier, en elke regel hier wijst een bestaande `data-proef` aan.

## Hoe Claude dit draait

1. Open Veronica, zet `localStorage.taal = 'nl'` en open de **veilige proefstand**: `?proef=1` (of
   `localStorage['veronica-proef'] = '1'`). In die stand doet geen enkele knop iets dat naar buiten gaat of iets wist —
   een roep, een wis, een herstel en elke betaal-/berichtactie worden alleen GEMELD ("proefstand: niet echt gedaan"),
   nooit uitgevoerd. Alles wat alleen de pagina tekent werkt wel echt, zodat je het resultaat ziet.
2. Loop de tabel af. Vind een knop met `document.querySelector('[data-proef="<naam>"]')`, klik hem, en kijk of je ziet
   wat in "verwacht" staat. Groen = je ziet het; rood = niet, of er staat een fout in de console.
3. Meld per regel groen/rood in één zin. Nooit de gevaarlijke rijen buiten de proefstand draaien.

## De lijst zelf is ook in Veronica te zien

Achter **Meer** staat de knop **Proefronde** (`data-proef="proefronde-tonen"`): die toont deze lijst in de pagina, zodat
een mens dezelfde ronde met de hand kan lopen.

## Veilig / niet zomaar te testen

Deze acties raken echte dingen (privé-inhoud wissen, een herstel, geld of berichten). Ze staan in de tabel met
**[veilig-alleen-proefstand]**: draai ze ALLEEN met `?proef=1`, waar ze niet echt uitgevoerd worden.

## De tabel

| data-proef | scherm | wat je doet | verwacht (groen) | let op |
|---|---|---|---|---|
| `tab-live` | kop | klik Live | het hoofdscherm staat vooraan, met de vorm bovenaan | |
| `meer-openen` | kop | klik Meer | het Meer-scherm (`#scherm-meer`) komt in beeld | |
| `vorm` | Live | klik op de levende vorm | Veronica gaat luisteren (de spraakzin verandert naar "Luisteren…" of "kan hier niet") | geen telefoon nodig |
| `mic` | Live | klik de microfoon | zelfde als de vorm: ze luistert (vraagt pas dán toestemming) | |
| `vraag` | Live | typ iets in het hoofdveld en klik Vraag | de vraag verschijnt; zonder telefoon een eerlijke zin "geen telefoon" | |
| `start-stop` | Live | klik Start/Stop | de stand wisselt (aan↔uit), de vorm kleurt mee | |
| `stemproef` | Live | klik Stemproef | je hoort een zin in Veronica's stijl ("De Cat is weer koel…") met de gekozen stem | geluid aan |
| `noodstop` | Live | klik de noodstop | er komt een bevestiging; pas de tweede tik stopt alles | zie `noodstop-bevestig` |
| `noodstop-bevestig` | Live | bevestig de noodstop | alles staat uit; Veronica zegt het in één regel | **[veilig-alleen-proefstand]** buiten proef stopt dit echt werk |
| `rek-vanzelf` | Live | klik "Rek vanzelf" (alleen zichtbaar als hij UIT staat) | hij gaat aan; de knop verdwijnt (563/559-regel) | knop bestaat alleen bij UIT |
| `pantser` | Meer | klik Pantser | de pantserstand wisselt; de tegels tonen wie meedoet | |
| `motor-alle` | Meer | klik "Motor voor iedereen" (alleen met pantser aan) | per klare telefoon een roep `motor-aan` | **[veilig-alleen-proefstand]** stuurt anders echt naar de telefoons |
| `roep` | Meer | klik Roep de rij op | de telefoons worden geroepen | **[veilig-alleen-proefstand]** echte roep naar buiten |
| `wand` | Meer | klik Wandstand | `body` krijgt de klasse `wand`, de vorm vult het scherm | |
| `zoek` | Meer | typ een zoekvraag en klik Zoek | de zoekstapel verschijnt; zonder telefoon een eerlijke zin | **[veilig-alleen-proefstand]** echte zoekopdracht naar de telefoons |
| `proefronde-tonen` | Meer | klik Proefronde | deze lijst verschijnt in de pagina | |

## Nieuwe knop erbij

Een nieuwe knop op Live of Meer krijgt een `data-proef`-naam én een regel in deze tabel; anders valt `check_proefronde.js`
om. Raakt de knop iets echts naar buiten of iets wat wist, zet dan **[veilig-alleen-proefstand]** erbij en zorg dat de
proefstand (`Proef.aan`) hem neutraliseert.
