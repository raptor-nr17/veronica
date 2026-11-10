// ===================================================================
// 678 (21 punten, stap 17 -> punt 14 "storing uitleggen + herstel kiezen", de NIET-financiële helft): kies een HERSTELACTIE uit
// een vaste allowlist op basis van de laatste logregels en de meest gelijkende storingen uit het storingenboek. PUUR rekenen:
// geen netwerk, geen model, geen opslag, geen DOM. De code doet twee veilige dingen: (1) de 3 meest gelijkende storingen vinden
// (woord-overlap; op het toestel mag EmbeddingGemma dit vervangen -- dezelfde vorm), en (2) het model-antwoord VALIDEREN tegen de
// allowlist (één actie-id, 0 of 1 veld, uitleg hoogstens 2 zinnen). Het model (E2B) KIEST de actie; deze code voert NOOIT iets uit
// en verzint nooit een actie buiten de allowlist. Kan het niet worden bepaald, dan is de veilige uitweg 'niets_doen_melden'.
//
// LET OP: de NIEUWSREM (het financiële deel van stap 17) staat HIER bewust NIET in -- dat is een apart, geparkeerd besluit.
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Storingsadvies = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De vaste allowlist van herstelacties. Alledrie OMKEERBAAR/veilig; 'niets_doen_melden' is de veilige uitweg (alleen melden).
  const ACTIES = ['herstart_app', 'wifi_opnieuw', 'stekker_cyclus', 'niets_doen_melden'];
  const MAX_LOG = 50;          // hoogstens de laatste 50 logregels mee in de prompt
  const MAX_UITLEG_ZINNEN = 2; // de uitleg naar ntfy is hoogstens twee zinnen
  const MAX_VELD = 40;         // een optioneel veld is een kort, veilig token (geen injectie)

  function woorden(tekst) {
    return String(tekst == null ? '' : tekst).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  }

  // laatste(logregels): de laatste MAX_LOG regels (nieuwste onderaan), als array van strings.
  function laatste(logregels) {
    const a = (Array.isArray(logregels) ? logregels : String(logregels || '').split('\n')).map((x) => String(x == null ? '' : x)).filter((x) => x.trim());
    return a.slice(-MAX_LOG);
  }

  // gelijkende(logregels, storingenboek, n): de n meest gelijkende storingen (woord-overlap met de recente logregels). Een storing
  // is { id, tekst?|trefwoorden?, actie? }. Puur; op het toestel mag EmbeddingGemma dit vervangen (zelfde vorm in/uit). Gelijke
  // score -> de oorspronkelijke volgorde (stabiel). Score 0 valt af.
  function gelijkende(logregels, storingenboek, n) {
    const top = typeof n === 'number' && n > 0 ? n : 3;
    const logset = new Set();
    for (const r of laatste(logregels)) for (const w of woorden(r)) logset.add(w);
    const boek = (Array.isArray(storingenboek) ? storingenboek : []).filter((s) => s && typeof s === 'object');
    const scored = boek.map((s, i) => {
      const bron = s.trefwoorden ? (Array.isArray(s.trefwoorden) ? s.trefwoorden.join(' ') : s.trefwoorden) : s.tekst;
      let score = 0; const gezien = new Set();
      for (const w of woorden(bron)) { if (!gezien.has(w) && logset.has(w)) { score += 1; gezien.add(w); } }
      return { s: s, score: score, i: i };
    }).filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.slice(0, top).map((x) => x.s);
  }

  function opAllowlist(actie) { return ACTIES.indexOf(actie) >= 0; }

  // kortUitleg(tekst): hoogstens twee zinnen, bijgeknipt. Nooit null -> lege string.
  function kortUitleg(tekst) {
    const t = String(tekst == null ? '' : tekst).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const zinnen = t.split(/(?<=[.!?])\s+/).slice(0, MAX_UITLEG_ZINNEN);
    return zinnen.join(' ').slice(0, 280);
  }

  // veiligVeld(v): een optioneel veld mag alleen een kort, veilig token zijn (letters/cijfers/._-), anders null (0 veld).
  function veiligVeld(v) {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (!s || s.length > MAX_VELD) return null;
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) ? s : null;
  }

  // De vaste prompt voor E2B: laatste logregels + de kandidaat-storingen -> UITSLUITEND JSON met één actie-id uit de allowlist,
  // 0 of 1 veld, en een uitleg van hoogstens twee zinnen. Geen vrije tekst buiten de JSON.
  function maakPrompt(logregels, storingen) {
    const log = laatste(logregels).join('\n');
    const kand = (Array.isArray(storingen) ? storingen : []).map((s, i) => `${i + 1}. ${s && (s.tekst || (Array.isArray(s.trefwoorden) ? s.trefwoorden.join(', ') : s.trefwoorden)) || ''}`).join('\n');
    return 'Je kiest EEN herstelactie bij een storing op een telefoon. Antwoord met UITSLUITEND JSON in de vorm '
      + '{"actie":"herstart_app"|"wifi_opnieuw"|"stekker_cyclus"|"niets_doen_melden","veld":null,"uitleg":"hoogstens twee zinnen"}. '
      + 'Kies alleen uit die vier acties. Weet je het niet, kies dan "niets_doen_melden". Geen tekst buiten de JSON.\n'
      + 'Laatste logregels:\n' + log + '\n\nMogelijk gelijkende storingen:\n' + kand;
  }

  // Lees + VALIDEER het model-antwoord. actie moet op de allowlist; veld is optioneel en veilig; uitleg hoogstens twee zinnen.
  // Een ongeldig/onbepaald antwoord -> null (de beller valt dan terug op niets_doen_melden via veiligeUitweg()).
  function leesModelJson(json) {
    let o;
    try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    if (!opAllowlist(o.actie)) return null;
    return { actie: o.actie, veld: veiligVeld(o.veld), uitleg: kortUitleg(o.uitleg) };
  }

  // De veilige uitweg als er niets te kiezen valt: alleen melden, nooit een ingreep.
  function veiligeUitweg(uitleg) {
    return { actie: 'niets_doen_melden', veld: null, uitleg: kortUitleg(uitleg) || 'Geen duidelijke oorzaak; ik meld het alleen.' };
  }

  // Een korte, menselijke zin bij een gekozen advies (voor ntfy / het logboek).
  function adviesZin(advies) {
    if (!advies || !opAllowlist(advies.actie)) return 'Geen advies.';
    const naam = {
      herstart_app: 'de app opnieuw starten', wifi_opnieuw: 'het wifi opnieuw verbinden',
      stekker_cyclus: 'de stekker uit- en weer aanzetten', niets_doen_melden: 'niets doen, alleen melden',
    }[advies.actie];
    const veld = advies.veld ? ` (${advies.veld})` : '';
    const uit = advies.uitleg ? ` ${advies.uitleg}` : '';
    return `Advies: ${naam}${veld}.${uit}`.trim();
  }

  return {
    ACTIES: ACTIES, MAX_LOG: MAX_LOG,
    woorden: woorden, laatste: laatste, gelijkende: gelijkende,
    opAllowlist: opAllowlist, kortUitleg: kortUitleg, veiligVeld: veiligVeld,
    maakPrompt: maakPrompt, leesModelJson: leesModelJson, veiligeUitweg: veiligeUitweg, adviesZin: adviesZin,
  };
}));
