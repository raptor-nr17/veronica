// ===================================================================
// 678 (21 punten, stap 13 -> punt 6 "stekkers en laden met stem"): EEN GESPROKEN ZIN -> EEN TASMOTA-OPDRACHT, in CODE.
// "zet de ventilator aan", "lader uit", "stop met opladen" -> {actie:'aan'|'uit', doel:'ventilator'|'laden'}. PUUR rekenen:
// geen netwerk, geen model, geen opslag, geen DOM. De woordherkenning zit HIER in code; alleen als die NIETS herkent gaat de
// zin naar een klein model (Granite) met AFGEDWONGEN JSON {actie, doel}, en ook dan valideert deze code het doel tegen de
// allowlist. Bij twijfel (zeker:false) hoort de beller een gesproken BEVESTIGING te vragen voor hij schakelt.
//
// Dit bepaalt ALLEEN wat er gezegd werd. Het UITVOEREN gaat via de bestaande stekker-roep (schakelOpdracht in stekkers.js), en de
// automatische laadregel (aan bij 30%, uit bij 80%, uit boven de temperatuurgrens) blijft `laadBesluit` in stekkers.js -- die
// wordt hier NIET overgedaan (één bron). De doel-namen ('laden', 'ventilator') zijn exact de schakelbare ROLLEN uit stekkers.js;
// 'meter' schakelt nooit en staat dus NIET op de allowlist.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Stekkerstem = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DOELEN = ['laden', 'ventilator'];   // exact de schakelbare ROLLEN uit stekkers.js; 'meter' hoort er bewust NIET bij
  // woorden die naar een doel wijzen (synoniemen in gewone spreektaal)
  const DOELWOORDEN = {
    laden: ['laad', 'laden', 'lader', 'opladen', 'oplaad', 'accu', 'batterij'],
    ventilator: ['ventilator', 'ventilatie', 'ventilatorstekker', 'koeling', 'koeler', 'fan', 'waaier'],
  };
  const AAN = ['aan', 'aanzetten', 'aanzet', 'aandoen', 'inschakelen', 'inschakel', 'start', 'starten', 'begin', 'beginnen', 'op'];
  const UIT = ['uit', 'uitzetten', 'uitzet', 'uitdoen', 'uitschakelen', 'uitschakel', 'stop', 'stoppen', 'klaar'];

  function woordenVan(zin) { return String(zin || '').toLowerCase().replace(/[.,!?;:]/g, ' ').split(/\s+/).filter(Boolean); }

  // herken(zin) -> { actie:'aan'|'uit', doel:'laden'|'ventilator', zeker:bool } of null (niets herkend -> de beller vraagt het model).
  // zeker:false = er is twijfel (bv. alleen een doel of alleen een actie, of een tegenstrijdigheid): vraag een gesproken bevestiging.
  function herken(zin) {
    const w = woordenVan(zin);
    if (!w.length) return null;
    const set = new Set(w);

    // doel zoeken (per woord, zodat "opladen" niet ook "op" als actie telt)
    const gevondenDoelen = [];
    for (const doel of DOELEN) if (DOELWOORDEN[doel].some((d) => set.has(d) || w.some((x) => x.startsWith(d) && x.length <= d.length + 3))) gevondenDoelen.push(doel);

    // actie zoeken -- maar "op" alleen als actie tellen als het niet in "opladen/oplader" zit (dat is een doelwoord)
    const heeftLaadDoelwoord = w.some((x) => x.startsWith('oplaad') || x.startsWith('opladen'));
    const aan = w.some((x) => AAN.includes(x) && !(x === 'op' && heeftLaadDoelwoord));
    const uit = w.some((x) => UIT.includes(x));

    let actie = null;
    if (aan && !uit) actie = 'aan';
    else if (uit && !aan) actie = 'uit';
    // "stop met opladen"/"klaar met laden" = laden uit (uit-woord + laad-doel), al gedekt door uit.

    const doel = gevondenDoelen.length === 1 ? gevondenDoelen[0] : null;

    if (actie && doel) return { actie: actie, doel: doel, zeker: true };
    // genoeg om een voorstel te doen, maar met twijfel -> gesproken bevestiging
    if (actie && gevondenDoelen.length > 1) return { actie: actie, doel: null, zeker: false };   // welke stekker?
    if (!actie && doel) return { actie: null, doel: doel, zeker: false };                          // aan of uit?
    return null;                                                                                   // niets bruikbaars -> model
  }

  function opAllowlist(doel) { return DOELEN.indexOf(doel) >= 0; }

  // De vaste prompt voor het kleine model (Granite), ALLEEN als herken() niets gaf. Dwingt JSON af; nooit vrije tekst.
  function maakPrompt(zin) {
    return 'Je zet een gesproken opdracht om in een stekker-actie. Antwoord met UITSLUITEND JSON in de vorm '
      + '{"actie":"aan"|"uit","doel":"laden"|"ventilator"}. Geen uitleg. Kun je het niet bepalen, antwoord dan {"actie":null,"doel":null}.\n'
      + 'Opdracht: ' + String(zin || '');
  }

  // Lees het model-antwoord en VALIDEER: actie in {aan,uit}, doel op de allowlist. Anders null (geen gok uitvoeren).
  function leesModelJson(json) {
    let o;
    try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    const actie = o.actie === 'aan' || o.actie === 'uit' ? o.actie : null;
    const doel = opAllowlist(o.doel) ? o.doel : null;
    if (!actie || !doel) return null;
    // het model is minder zeker dan de code: altijd met twijfel (gesproken bevestiging)
    return { actie: actie, doel: doel, zeker: false };
  }

  // Een gesproken bevestigingszin, of een vraag als er nog twijfel is welke/welk.
  function bevestigZin(cmd) {
    if (!cmd) return 'Dat verstond ik niet. Welke stekker, en aan of uit?';
    const naam = cmd.doel === 'laden' ? 'de lader' : cmd.doel === 'ventilator' ? 'de ventilator' : 'welke stekker';
    if (!cmd.actie && cmd.doel) return `Wil je ${naam} aan- of uitzetten?`;
    if (cmd.actie && !cmd.doel) return `Welke stekker wil je ${cmd.actie === 'aan' ? 'aanzetten' : 'uitzetten'}?`;
    return `Ik zet ${naam} ${cmd.actie === 'aan' ? 'aan' : 'uit'}. Klopt dat?`;
  }

  return { herken: herken, opAllowlist: opAllowlist, maakPrompt: maakPrompt, leesModelJson: leesModelJson, bevestigZin: bevestigZin, DOELEN: DOELEN };
}));
