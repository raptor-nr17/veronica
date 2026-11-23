// ===================================================================
// 678 (23 nov, eigenaar: "ja" op het voorstel na de schermafbeelding van 18:08). HET OVERZICHT VAN HET REK: EEN BRON VAN WAARHEID PER TELEFOON.
// Veronica haalde de stand van een telefoon uit drie plekken (haar eigen kijk over het wifi, de hartslag via de relay, en ARTEMIS via adb) en
// zette die als losse regels boven elkaar -- die spraken elkaar tegen ("geen teken van leven" boven "brein klaar"). Hier worden de drie EEN keer
// samengevoegd tot EEN stand per telefoon, met EEN zin waarom:
//   werkt     -- er draait een model en het antwoordt (een rol die ARTEMIS klaar meldt, of de eigen motor van JARVIS)
//   start op  -- hij is in beeld, maar het model is er nog niet (laadt, of ARTEMIS zet het nog klaar)
//   accu laag -- onder 20% en niet aan de lader, of hij wacht zelf op de accu
//   weg       -- geen antwoord over het wifi, geen verse hartslag, en ARTEMIS ziet hem ook niet
//   rust      -- de dagelijkse telefoon, of JARVIS staat uit (een keuze, geen fout)
// Welke bron waarvoor geldt staat vast: IN BEELD = een van de drie wegen; DE ROL en of die klaar is = ARTEMIS (die draait de modellen); ACCU,
// WARMTE en DE EIGEN MOTOR = de hartslag van de telefoon zelf. Zo kan dezelfde vraag nooit twee antwoorden krijgen.
// PUUR rekenen: geen netwerk, geen opslag, geen DOM. Geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Rekoverzicht = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACCU_LAAG = 20;
  const LABEL = Object.freeze({ werkt: 'Werkt', 'start-op': 'Start op', 'accu-laag': 'Accu laag', weg: 'Weg', rust: 'Rust' });
  const KLEUR = Object.freeze({ werkt: 'groen', 'start-op': 'oranje', 'accu-laag': 'oranje', weg: 'rood', rust: 'grijs' });
  const ROL = Object.freeze({ brein: 'het brein', controle: 'de controle', verdeler: 'de verdeler', bibliothecaris: 'de bibliothecaris' });
  const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const komma = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

  // stand(x): x = { naam, rol, rolKlaar, rolModel, artemis (een korte zin "via Tailscale (adb)" of ''), direct, hartVers, accu, laadt,
  //   motor: { aan, klaar, fase, pct, model }, tps, werk (de laatste zin van JARVIS zelf), dagelijks, pauze, laatsteAccu, laatsteLaadt }
  // -> { stand, label, kleur, zin }
  function stand(x) {
    const o = x || {};
    const inBeeld = !!(o.direct || o.hartVers || o.artemis);
    const accu = getal(o.accu);
    const motor = o.motor && typeof o.motor === 'object' ? o.motor : {};
    const model = String(o.rolModel || motor.model || '').replace(/\.gguf$/i, '');
    const tps = getal(o.tps);
    const uit = (s, zin) => ({ stand: s, label: LABEL[s], kleur: s === 'accu-laag' && accu !== null && accu < ACCU_LAAG && !o.laadt ? 'rood' : KLEUR[s], zin });
    if (!inBeeld) {
      const la = getal(o.laatsteAccu);
      const leeg = la !== null && la < 30 && !o.laatsteLaadt ? ` Hij had ${la}% en hing niet aan de lader: waarschijnlijk is de accu leeg.` : '';
      return uit('weg', `Geen antwoord over het wifi, geen hartslag, en ARTEMIS ziet hem ook niet.${leeg}`);
    }
    if (o.pauze) return uit('rust', 'JARVIS staat uit (met de Uit-knop). Zet hem op de telefoon weer aan als hij mee moet doen.');
    if (o.dagelijks) return uit('rust', 'De dagelijkse telefoon: die rust en doet niet mee met het rek.');
    if (accu !== null && accu < ACCU_LAAG && !o.laadt) return uit('accu-laag', `Accu ${accu}% en hij laadt niet. Leg hem aan de lader, anders valt hij straks uit.`);
    const rolKlaar = !!(o.rol && o.rolKlaar);
    if (rolKlaar) return uit('werkt', `Werkt als ${ROL[o.rol] || o.rol}${model ? ` (${model})` : ''}.`);
    if (motor.klaar) return uit('werkt', `Werkt: de eigen motor is klaar${model ? ` (${model})` : ''}${tps !== null && tps > 0 ? `, ±${komma(tps)} tokens per seconde` : ''}.`);
    const werk = String(o.werk || '');
    const grens = /accu onder (\d+)/i.exec(werk);
    if (accu !== null && grens) return uit('accu-laag', `Accu ${accu}%${o.laadt ? ' (laadt)' : ''}: onder ${grens[1]}% neemt hij geen werk aan. Boven ${grens[1]}% rekent hij vanzelf weer.`);
    if (o.rol) return uit('start-op', `Start op als ${ROL[o.rol] || o.rol}: ARTEMIS zet het model klaar.`);
    if (motor.aan) {
      const pct = getal(motor.pct);
      return uit('start-op', `Start op: het model laadt${pct !== null ? ` (${Math.round(pct)}%)` : ''}. Hij neemt werk aan zodra het klaar is.`);
    }
    return uit('start-op', 'In beeld, maar er draait nog geen model op deze telefoon.');
  }

  // waar(x): langs welke weg hij in beeld is, kort ("over het wifi", "via de relay", "via ARTEMIS: via Tailscale (adb)"). Eerst de snelste.
  function waar(x) {
    const o = x || {};
    if (o.direct) return 'rechtstreeks over het wifi';
    if (o.hartVers) return 'via zijn hartslag';
    if (o.artemis) return `via ARTEMIS (${o.artemis})`;
    return '';
  }

  // feiten(x): de korte regel onder de stand -- alleen wat bekend is, nooit een verzonnen getal.
  function feiten(x) {
    const o = x || {};
    const d = [];
    const accu = getal(o.accu); const temp = getal(o.temp); const tps = getal(o.tps);
    if (accu !== null) d.push(`accu ${accu}%${o.laadt ? ' (laadt)' : ''}`);
    if (temp !== null) d.push(`${komma(temp)} °C`);
    const model = String(o.rolModel || (o.motor && o.motor.model) || '').replace(/\.gguf$/i, '');
    if (model) d.push(model);
    if (tps !== null && tps > 0) d.push(`±${komma(tps)} tokens/s`);
    const w = waar(o); if (w) d.push(w);
    return d.join(' · ');
  }

  // kop(lijst): EEN regel over het hele rek, uit dezelfde standen als de kaarten ("Rek: 3 werken · 1 start op").
  function kop(lijst) {
    const l = Array.isArray(lijst) ? lijst : [];
    if (!l.length) return '';
    const tel = (s) => l.filter((x) => x && x.stand === s).length;
    const delen = [];
    const w = tel('werkt'); if (w) delen.push(`${w} ${w === 1 ? 'werkt' : 'werken'}`);
    const so = tel('start-op'); if (so) delen.push(`${so} start op`);
    const al = tel('accu-laag'); if (al) delen.push(`${al} accu laag`);
    const wg = tel('weg'); if (wg) delen.push(`${wg} weg`);
    const r = tel('rust'); if (r) delen.push(`${r} rust`);
    return `Rek: ${delen.join(' · ')}`;
  }

  return { ACCU_LAAG, LABEL, KLEUR, stand, waar, feiten, kop };
}));
