// ===================================================================
// METERS: ronde meters, een thermometer en een batterij, als SVG-tekst
// ===================================================================
//
// Voor het prestatiescherm van JARVIS en de Live modus van Veronica. Dit bestand staat
// TWEE keer in de repo: in de app (www/meters.js) en in tools/veronica/meters.js. Een test
// eist dat ze gelijk zijn: één ontwerp, geen twee versies die uit elkaar lopen.
//
// ALLEEN ECHTE DATA. geen = er is geen meting: dan een grijze meter met "geen meting", nooit
// een getal. oud = de meting is ouder dan 10 s: dan grijs, met het getal van toen.
// Alles wat hier tekst wordt, gaat door schoon() (geen HTML uit een meting).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Meters = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GRIJS = '#5d6b78';
  const SPOOR = '#2a3440';
  const KLEUR = { groen: '#2ecc71', geel: '#f1c40f', oranje: '#e67e22', rood: '#e74c3c', blauw: '#4fc3f7' };
  const schoon = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const komma = (x, d) => String(Math.round(x * 10 ** (d || 0)) / 10 ** (d || 0)).replace('.', ',');
  const kleurNaam = (k) => (KLEUR[k] ? KLEUR[k] : (/^#[0-9a-f]{6}$/i.test(String(k)) ? k : KLEUR.blauw));

  // Een punt op de halve cirkel: f = 0 (links) .. 1 (rechts).
  function punt(cx, cy, r, f) {
    const hoek = Math.PI * (1 - f);
    return [cx + r * Math.cos(hoek), cy - r * Math.sin(hoek)];
  }
  const p = (xy) => `${xy[0].toFixed(1)} ${xy[1].toFixed(1)}`;

  // Een ronde meter (zoals de snelheidsmeter van een auto): boog, naald en groot getal.
  // o = { waarde, max, eenheid, decimalen, kleur, oud, geen }
  function meter(o) {
    const w = getal(o.waarde);
    const geen = !!o.geen || w === null;
    const max = getal(o.max) && o.max > 0 ? o.max : 100;
    const f = geen ? 0 : Math.max(0, Math.min(1, w / max));
    const kleur = geen || o.oud ? GRIJS : kleurNaam(o.kleur);
    const cx = 100; const cy = 100; const r = 80;
    const boog = (tot) => `M ${p(punt(cx, cy, r, 0))} A ${r} ${r} 0 0 1 ${p(punt(cx, cy, r, tot))}`;
    const naald = punt(cx, cy, r - 14, f);
    const tekst = geen ? 'geen meting' : komma(w, o.decimalen || 0);
    return `<svg class="meter${geen ? ' geen' : ''}${o.oud ? ' oud' : ''}" viewBox="0 0 200 130" role="img" aria-label="${schoon(geen ? 'geen meting' : `${tekst} ${o.eenheid || ''}`)}">`
      + `<path d="${boog(1)}" fill="none" stroke="${SPOOR}" stroke-width="16" stroke-linecap="round"/>`
      + (f > 0.001 ? `<path d="${boog(f)}" fill="none" stroke="${kleur}" stroke-width="16" stroke-linecap="round"/>` : '')
      + (geen ? '' : `<line x1="${cx}" y1="${cy}" x2="${naald[0].toFixed(1)}" y2="${naald[1].toFixed(1)}" stroke="#e8f3ff" stroke-width="5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="8" fill="#e8f3ff"/>`)
      + `<text x="${cx}" y="${geen ? 92 : 126}" text-anchor="middle" font-size="${geen ? 22 : 30}" font-weight="800" fill="${geen ? GRIJS : '#e8f3ff'}">${schoon(tekst)}</text>`
      + (geen ? '' : `<text x="190" y="126" text-anchor="end" font-size="16" fill="${GRIJS}">${schoon(o.eenheid || '')}</text>`)
      + '</svg>';
  }

  // Een thermometer: hoe hoger, hoe voller (20-50 °C), in de kleur van de hittestand.
  // o = { temp, stand ('groen'|'geel'|'oranje'|'rood'), oud, geen }
  function thermometer(o) {
    const t = getal(o.temp);
    const geen = !!o.geen || t === null;
    const f = geen ? 0 : Math.max(0.04, Math.min(1, (t - 20) / 30));
    const kleur = geen || o.oud ? GRIJS : kleurNaam(o.stand || 'groen');
    const hoog = 84 * f;
    return `<svg class="thermo${geen ? ' geen' : ''}${o.oud ? ' oud' : ''}" viewBox="0 0 150 130" role="img" aria-label="${schoon(geen ? 'geen meting' : `${komma(t, 1)} graden`)}">`
      + `<rect x="18" y="8" width="24" height="96" rx="12" fill="${SPOOR}"/>`
      + `<circle cx="30" cy="108" r="18" fill="${geen ? SPOOR : kleur}"/>`
      + (geen ? '' : `<rect x="22" y="${(100 - hoog).toFixed(1)}" width="16" height="${(hoog + 4).toFixed(1)}" rx="8" fill="${kleur}"/>`)
      + `<text x="62" y="${geen ? 64 : 72}" font-size="${geen ? 16 : 30}" font-weight="800" fill="${geen ? GRIJS : '#e8f3ff'}">${schoon(geen ? 'geen' : komma(t, 1))}</text>`
      + `<text x="62" y="${geen ? 84 : 96}" font-size="16" fill="${GRIJS}">${geen ? 'meting' : '°C'}</text>`
      + '</svg>';
  }

  // Een batterij met het percentage erin, en een bliksem als hij laadt.
  // o = { procent, laadt, oud, geen }
  function batterij(o) {
    const pr = getal(o.procent);
    const geen = !!o.geen || pr === null;
    const f = geen ? 0 : Math.max(0, Math.min(1, pr / 100));
    const kleur = geen || o.oud ? GRIJS : (pr < 15 ? KLEUR.rood : pr < 30 ? KLEUR.oranje : KLEUR.groen);
    return `<svg class="accu${geen ? ' geen' : ''}${o.oud ? ' oud' : ''}" viewBox="0 0 130 130" role="img" aria-label="${schoon(geen ? 'geen meting' : `${pr} procent${o.laadt ? ', laadt' : ''}`)}">`
      + '<rect x="8" y="30" width="100" height="56" rx="10" fill="none" stroke="#e8f3ff" stroke-width="5"/>'
      + '<rect x="110" y="46" width="10" height="24" rx="3" fill="#e8f3ff"/>'
      + (geen ? '' : `<rect x="15" y="37" width="${(86 * f).toFixed(1)}" height="42" rx="5" fill="${kleur}"/>`)
      + (o.laadt === true && !geen ? '<path d="M66 22 L46 62 L60 62 L52 96 L76 52 L62 52 L70 22 Z" fill="#ffd400" stroke="#04070c" stroke-width="3"/>' : '')
      + `<text x="58" y="${geen ? 116 : 120}" text-anchor="middle" font-size="${geen ? 18 : 28}" font-weight="800" fill="${geen ? GRIJS : '#e8f3ff'}">${schoon(geen ? 'geen meting' : `${pr}%`)}</text>`
      + '</svg>';
  }

  // Hoe oud, kort: "nu", "4 s", "2 min". null = niets.
  function leeftijd(ms) {
    if (!(getal(ms) >= 0)) return '';
    const s = Math.round(ms / 1000);
    if (s < 2) return 'nu';
    if (s < 60) return `${s} s oud`;
    return `${Math.round(s / 60)} min oud`;
  }

  return { meter, thermometer, batterij, leeftijd, schoon, KLEUR, GRIJS };
}));
