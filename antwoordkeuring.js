// ===================================================================
// 660 (stap 3+4 van "Lokale AI slimmer maken"): DE ANTWOORDKEURING IN DE CODE. Geen scherm, geen netwerk, geen opslag -- alleen rekenen.
// ===================================================================
//
// Twee vaste regels van de eigenaar (7 november), allebei IN DE CODE, nooit via een prompt (een prompt is een verzoek, geen garantie):
//
//  STAP 3 -- GEREEDSCHAP-EERST. Een getal, een datum, een tijd of een koers hoort NOOIT los uit het model te komen; die moeten via het
//    gereedschap (reken, datum, tijd, koers). Zegt het model een los getal in de tekst op zo'n vraag, dan keurt de code dat af -- ook als
//    het toevallig klopt. Dat is waar de rekenfouten en de verzonnen koersen vandaan komen. En een VAST antwoordformaat (een label, ja/nee,
//    een getal, JSON) wordt in de code gecontroleerd op de VORM, niet op een belofte in de prompt.
//
//  STAP 4 -- "IK WEET HET NIET" IN DE CODE. Is er geen bron, of is de tokenkans van het antwoord te laag, dan wordt het antwoord NIET
//    doorgelaten: het wordt "onbekend", of het gaat een TREDE HOGER (naar een sterker model). Nooit een stellig antwoord zonder dekking.
//
// keurAntwoord(vraag, antwoord, opties) -> { status, reden, uit }:
//   status: 'goed' | 'onbekend' | 'escaleer' | 'fout'
//     - goed      : het antwoord mag door (uit = de schone vorm).
//     - onbekend  : geen dekking (geen bron / te lage kans / weet-niet) -> toon "weet ik niet", verzin niets.
//     - escaleer  : een trede hoger (een sterker model) kan het misschien wel; reden zegt waarom.
//     - fout      : een stellig antwoord dat de code afkeurt (los getal waar gereedschap hoort, verkeerde vorm) -> NIET tonen.
//   De DREMPELS staan hier (geen magische getallen in de aanroeper): bron verplicht voor een feit, minimale tokenkans.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.AntwoordKeuring = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De minimale gemiddelde tokenkans (0..1) waaronder we een stellig antwoord niet vertrouwen. Een model dat twijfelt (lage kans) mag
  // geen stellig feit opleveren; dan "onbekend" of een trede hoger. Komt uit de meting van de eigenaar; hier als vaste drempel.
  const MIN_TOKENKANS = 0.35;
  // Een getal/datum/tijd/koers hoort via het gereedschap. Deze woorden in de vraag wijzen daarop.
  const RE_GETAL = /\b(hoeveel|reken|som|optellen|aftrekken|keer|maal|gedeeld|procent|kwadraat|wortel|plus|min|vermenigvuldig|tel\b)\b/i;
  const RE_DATUM = /\b(welke datum|welke dag|hoeveel dagen|over hoeveel dagen|wanneer is|hoeveel weken|schrikkel)\b/i;
  const RE_TIJD = /\b(hoe laat|welke tijd|hoeveel uur|hoeveel minuten)\b/i;
  const RE_KOERS = /\b(koers|wisselkoers|hoeveel kost.*(bitcoin|ethereum|aandeel|euro|dollar)|beurs|aandelenkoers)\b/i;
  const GEREEDSCHAP_SOORT = Object.freeze({ getal: 'reken', datum: 'datum', tijd: 'tijd', koers: 'koers' });

  const laag = (s) => String(s == null ? '' : s).toLowerCase();
  const WEETNIET_RE = /\b(weet ik niet|geen idee|niet bekend|onbekend|dat weet ik niet|kan ik niet|geen gegevens|staat er niet|geen bron)\b/i;
  function zegtWeetNiet(a) { return WEETNIET_RE.test(String(a || '')); }
  function leesJson(a) { const m = String(a || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch (e) { return null; } }
  // Een los getal/bedrag/koers IN DE TEKST (buiten een JSON-gereedschapaanroep).
  function losGetal(a) { return /(^|[^"\w])[-+]?\d[\d.,]*/.test(String(a || '').replace(/\{[^}]*\}/g, '')); }

  // Welke soort antwoord vraagt deze vraag? 'getal'|'datum'|'tijd'|'koers' -> moet via gereedschap; anders 'vrij'.
  function soortVanVraag(vraag) {
    const v = String(vraag || '');
    if (RE_KOERS.test(v)) return 'koers';
    if (RE_GETAL.test(v) && /\d/.test(v)) return 'getal';
    if (RE_DATUM.test(v)) return 'datum';
    if (RE_TIJD.test(v)) return 'tijd';
    if (RE_GETAL.test(v)) return 'getal';
    return 'vrij';
  }

  // opties: { bron (string|false), tokenKans (0..1), vereistBron (bool, default true voor een feitvraag), vorm ({label|jaNee|getal}) }.
  function keurAntwoord(vraag, antwoord, opties) {
    const o = opties || {};
    const a = String(antwoord == null ? '' : antwoord);
    const soort = soortVanVraag(vraag);

    // STAP 4a: het model zegt zelf "weet ik niet" -> dat is eerlijk, status onbekend (niet fout).
    if (zegtWeetNiet(a) && !leesJson(a)) return { status: 'onbekend', reden: 'model-zegt-weet-niet', uit: '' };

    // STAP 3 (vorm): heeft de aanroeper een VAST antwoordformaat opgegeven, dan is DAT de bedoeling (een label, ja/nee of een kaal getal) --
    // dat gaat vóór de gereedschap-eerst-regel (een "hoeveel dagen"-vraag met vorm:getal wil een kaal getal, geen reken-aanroep).
    if (o.vorm) {
      const kaal = laag(a).replace(/[.!"'\s]+$/g, '').trim();
      if (o.vorm.label) return o.vorm.opties && o.vorm.opties.includes(kaal) ? { status: 'goed', reden: 'label', uit: kaal } : { status: 'fout', reden: 'label-niet-in-lijst', uit: '' };
      if (o.vorm.jaNee) { const ja = /^ja\b/.test(kaal), nee = /^nee\b/.test(kaal); return (ja || nee) ? { status: 'goed', reden: 'ja-nee', uit: ja ? 'ja' : 'nee' } : { status: 'fout', reden: 'geen-ja-nee', uit: '' }; }
      if (o.vorm.getal) { const m = a.match(/-?\d+/); return m ? { status: 'goed', reden: 'getal', uit: m[0] } : { status: 'fout', reden: 'geen-getal', uit: '' }; }
    }

    // STAP 3: getal/datum/tijd/koers MOETEN via het gereedschap (JSON). Een los getal in de tekst wordt afgekeurd.
    if (GEREEDSCHAP_SOORT[soort]) {
      const j = leesJson(a);
      const wil = GEREEDSCHAP_SOORT[soort];
      if (j && laag(j.gereedschap) === wil) return { status: 'goed', reden: `via gereedschap ${wil}`, uit: a };
      if (losGetal(a)) return { status: 'fout', reden: `${soort}-zonder-gereedschap`, uit: '' };   // stellig getal in tekst: NIET tonen
      // geen getal, geen juiste aanroep -> het model hoort het gereedschap te kiezen; een trede hoger kan dat beter
      return { status: 'escaleer', reden: `${soort}-geen-gereedschap-gekozen`, uit: '' };
    }

    // STAP 4b: een FEIT zonder bron wordt niet doorgelaten -> onbekend (verzin niets). vereistBron standaard true.
    const vereistBron = o.vereistBron !== false;
    if (vereistBron && !o.bron) return { status: 'onbekend', reden: 'geen-bron', uit: '' };

    // STAP 4c: te lage tokenkans -> niet vertrouwen. Een trede hoger kan het misschien wel (escaleer); is er al geen hoger model, dan onbekend.
    if (typeof o.tokenKans === 'number' && o.tokenKans < MIN_TOKENKANS) {
      return o.hogerBestaat === false ? { status: 'onbekend', reden: 'lage-kans-geen-hoger', uit: '' } : { status: 'escaleer', reden: 'lage-tokenkans', uit: '' };
    }

    if (!a.trim()) return { status: 'onbekend', reden: 'leeg', uit: '' };
    return { status: 'goed', reden: 'met-bron', uit: a };
  }

  // De zin die de gebruiker ziet bij elke status (nooit een foutcode; bij onbekend eerlijk, geen verzinsel).
  function statusZin(r) {
    const s = r && r.status;
    if (s === 'goed') return '';
    if (s === 'onbekend') return 'Dat weet ik niet zeker, dus ik verzin het niet.';
    if (s === 'escaleer') return 'Ik vraag het aan een sterker model.';
    if (s === 'fout') return 'Dit antwoord klopte niet in de vorm; ik laat het niet staan.';
    return '';
  }

  return { MIN_TOKENKANS, GEREEDSCHAP_SOORT, soortVanVraag, zegtWeetNiet, leesJson, losGetal, keurAntwoord, statusZin };
}));
