/*
 * 485 (17 oktober): WIE GEBRUIKT DE REKENKRACHT? De baas telt per afnemer hoeveel klussen er het afgelopen uur klaar kwamen:
 * Claude (de rekenpostbus en het rekenpool-adres), de verhalengids (de postbus met vertaal- en keurklussen) en de eigen vragen.
 * Alleen getallen: geen inhoud, geen namen, geen tijdstippen naar buiten. Mijn-AI telt NIET mee: de privé-hoek praat
 * rechtstreeks met een motor en laat niets na, ook geen teller.
 */
(function (wereld) {
  'use strict';
  const AFNEMERS = ['claude', 'gids', 'eigen'];
  const UUR_MS = 60 * 60 * 1000;
  const MAX = 2000;
  // 495: LOKAAL EERST. Elke klus die hier geteld wordt is LOKAAL gedaan, op een Gemma in huis. Daarom tellen we ook de tokens
  // (uit het antwoord, anders geschat op tekens / 4) en hoe vaak er een grotere Gemma nodig was (opgeschaald) of het lokaal
  // niet lukte (dan wordt er NIETS vanzelf naar buiten gestuurd: de beheerder beslist).
  const MAX_TOKENS = 1e12;
  function maak() {
    const tijden = { claude: [], gids: [], eigen: [] };
    const totaal = { claude: 0, gids: 0, eigen: 0 };
    const tokens = { claude: 0, gids: 0, eigen: 0 };
    const lokaal = { opgeschaald: 0, nietGelukt: 0 };
    return {
      tel(afnemer, nu, aantalTokens) {
        if (!AFNEMERS.includes(afnemer)) return false;
        tijden[afnemer].push(nu);
        if (tijden[afnemer].length > MAX) tijden[afnemer].shift();
        totaal[afnemer] += 1;
        if (Number.isFinite(aantalTokens) && aantalTokens > 0) tokens[afnemer] = Math.min(MAX_TOKENS, tokens[afnemer] + Math.round(aantalTokens));
        return true;
      },
      // Tokens zonder een klus te tellen (de verhalengids telt zijn klus per ronde, de tokens per vraag).
      telTokens(afnemer, n) { if (AFNEMERS.includes(afnemer) && Number.isFinite(n) && n > 0) tokens[afnemer] = Math.min(MAX_TOKENS, tokens[afnemer] + Math.round(n)); },
      telOpgeschaald() { lokaal.opgeschaald += 1; },
      telNietGelukt() { lokaal.nietGelukt += 1; },
      stand(nu) {
        const uur = {};
        for (const a of AFNEMERS) { tijden[a] = tijden[a].filter((t) => nu - t <= UUR_MS); uur[a] = tijden[a].length; }
        return { uur, totaal: Object.assign({}, totaal), tokens: Object.assign({}, tokens), lokaal: Object.assign({}, lokaal) };
      },
    };
  }
  // Tokens van een antwoord: wat het model zelf opgaf, anders een schatting (tekens / 4).
  function tokensVan(antwoord, vraagTekens) {
    const u = antwoord && antwoord.usage;
    const t = u && (Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0));
    if (t > 0) return t;
    const c = antwoord && Array.isArray(antwoord.choices) && antwoord.choices[0] && antwoord.choices[0].message ? String(antwoord.choices[0].message.content || '') : '';
    return Math.ceil(((Number(vraagTekens) || 0) + c.length) / 4);
  }
  // Voor Veronica: alleen gehele getallen 0..99999 per bekende afnemer; al het andere valt weg.
  function lees(x) {
    if (!x || typeof x !== 'object' || !x.uur || typeof x.uur !== 'object') return null;
    const g = (v) => (Number.isInteger(v) && v >= 0 && v <= 99999 ? v : 0);
    const gt = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_TOKENS ? v : 0);
    const uur = {};
    const totaal = {};
    const tokens = {};
    for (const a of AFNEMERS) { uur[a] = g(x.uur[a]); totaal[a] = g(x.totaal && x.totaal[a]); tokens[a] = gt(x.tokens && x.tokens[a]); }
    const lokaal = { opgeschaald: g(x.lokaal && x.lokaal.opgeschaald), nietGelukt: g(x.lokaal && x.lokaal.nietGelukt) };
    return { uur, totaal, tokens, lokaal };
  }
  // 495: wat het lokaal doen ongeveer scheelt. De prijs per miljoen tokens is een SCHATTING die de beheerder zelf instelt;
  // er wordt nergens een extern model aangeroepen, ook niet om te vergelijken.
  function bespaard(s, prijsPerMiljoen) {
    if (!s) return null;
    const klussen = AFNEMERS.reduce((n, a) => n + (s.totaal[a] || 0), 0);
    const tokens = AFNEMERS.reduce((n, a) => n + ((s.tokens && s.tokens[a]) || 0), 0);
    const prijs = Number.isFinite(prijsPerMiljoen) && prijsPerMiljoen >= 0 ? prijsPerMiljoen : 0;
    return { klussen, tokens, euro: Math.round((tokens / 1e6) * prijs * 100) / 100, prijs };
  }
  const tokensTekst = (n) => (n >= 1e6 ? `${String(Math.round(n / 1e5) / 10).replace('.', ',')} miljoen` : n >= 1000 ? `${Math.round(n / 1000)} duizend` : String(n));
  function bespaardZin(s, prijsPerMiljoen) {
    const b = bespaard(s, prijsPerMiljoen);
    if (!b) return '';
    const l = (s && s.lokaal) || { opgeschaald: 0, nietGelukt: 0 };
    const euro = b.euro.toFixed(2).replace('.', ',');
    const prijs = String(b.prijs).replace('.', ',');
    return `Lokaal gedaan op de Gemma's in huis: ${b.klussen} klussen, ongeveer ${tokensTekst(b.tokens)} tokens. Bij een betaald model had dat ongeveer EUR ${euro} gekost (bij benadering, bij EUR ${prijs} per miljoen tokens). `
      + `${l.opgeschaald} keer was een grotere Gemma nodig; ${l.nietGelukt} keer lukte het lokaal niet (dan ging er niets vanzelf naar buiten).`;
  }
  function zin(s) {
    if (!s) return '';
    const u = s.uur;
    return `Klussen het afgelopen uur via de baas: Claude ${u.claude}, verhalengids ${u.gids}, eigen vragen ${u.eigen}. Mijn-AI telt niet mee (privé).`;
  }
  const uit = { AFNEMERS, UUR_MS, maak, lees, zin, tokensVan, bespaard, bespaardZin };
  if (typeof module !== 'undefined' && module.exports) module.exports = uit;
  else wereld.Afnemers = uit;
})(typeof window !== 'undefined' ? window : globalThis);
