// ===================================================================
// 542: DE PRIVÉ-HOEK ALS EIGEN PAGINA (index.html#hoek) -- de regels, zonder scherm, zonder netwerk en zonder opslag
// ===================================================================
//
// Vier zones: Veiligheid (vast bovenaan), Rek, Zoeken en Modellen. Dit bestand zegt WAT er staat; veronica.js tekent het en voert
// de knoppen uit met de functies die er al waren (noodstop, Pantser, Vol lokaal, motor-uit, de motorinstellingen, het zoeken).
//
//  - STATUS NOOIT ALLEEN MET KLEUR: elke kaart draagt een woord EN een teken (goed te lezen, ook op een scherm in de zon).
//  - EEN statuszin bovenaan: "Vol lokaal AAN · Pantser UIT · 5 van 6 telefoons bereikbaar".
//  - ALLES UIT zet alle motoren uit, wist niets, en vraagt bevestiging MET het aantal telefoons.
//  - ZOEKEN: Privé en Algemeen apart. Onder Algemeen een vinkje per bron die AL in de code staat, met een statuswoord. Openverse
//    alleen bij de soort vraag Foto's. De weigerlijst van zoekmachines staat in zoekkassa.js en blijft daar.
//  - MODELLEN: per telefoon model, tokens per seconde en bezig of vrij. Een model wisselen op een telefoon die bezig is vraagt
//    eerst bevestiging. Geen stroom per telefoon en geen model per rol (later, besluit van de eigenaar).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Hoek = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ZONES = Object.freeze([
    { id: 'veilig', naam: 'Veiligheid', teken: '⛔' },
    { id: 'rek', naam: 'Rek', teken: '📱' },
    { id: 'zoek', naam: 'Zoeken', teken: '🔎' },
    { id: 'model', naam: 'Modellen', teken: '🧠' },
  ]);
  // Woord + teken per stand. Het woord is wat telt; het teken helpt het oog.
  const STANDEN = Object.freeze({
    rekent: { woord: 'rekent', teken: '⚙️' },
    klaar: { woord: 'klaar', teken: '✅' },
    laadt: { woord: 'laadt model', teken: '⏳' },
    uit: { woord: 'motor uit', teken: '⏻' },
    rust: { woord: 'rust', teken: '💤' },
    nood: { woord: 'noodstop', teken: '⛔' },
    stil: { woord: 'geen hartslag', teken: '❓' },
  });
  const BRONNEN_ALGEMEEN = Object.freeze(['wikipedia', 'wikidata', 'marginalia', 'pdok', 'osm', 'arxiv']);
  const FOTO_BRON = 'openverse';
  const BRON_NAAM = Object.freeze({ wikipedia: 'Wikipedia', wikidata: 'Wikidata', marginalia: 'Marginalia', pdok: 'PDOK (adressen)', osm: 'OpenStreetMap', arxiv: 'arXiv', openverse: "Openverse (foto's)" });

  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const komma = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

  // h = een hartslag (hartslag.js schoonHartslag), afh = { rolNaam(h), tps(h), versMs, bezig(id) }.
  function kaart(h, tijd, afh) {
    const a = afh || {};
    const vers = !!(h && typeof h.t === 'number' && tijd - h.t <= (a.versMs || 0));
    const m = h && h.motor && typeof h.motor === 'object' ? h.motor : null;
    let stand = 'stil';
    if (vers) {
      if (h.pauze) stand = 'nood';
      else if (h.dagelijks || h.sparen) stand = 'rust';
      else if (!m || !m.aan) stand = 'uit';
      else if (m.klaar) stand = a.bezig && a.bezig(h.id) ? 'rekent' : 'klaar';
      else stand = 'laadt';
    }
    const tps = typeof a.tps === 'function' ? getal(a.tps(h)) : null;
    const st = STANDEN[stand];
    return {
      id: h && h.id, naam: (h && h.naam) || 'Een telefoon', rol: typeof a.rolNaam === 'function' && h ? a.rolNaam(h) : '',
      stand, woord: st.woord, teken: st.teken, vers,
      accu: vers ? getal(h.accu) : null, laadt: vers && h.laadt === true, temp: vers ? getal(h.temp) : null,
      model: vers && m && m.model ? String(m.model).slice(0, 60) : null, tps: vers && tps > 0 ? tps : null,
      motorAan: vers && !!(m && m.aan), bezig: stand === 'rekent',
    };
  }
  function kaarten(harten, tijd, afh) {
    return (Array.isArray(harten) ? harten : []).filter((h) => h && h.id).map((h) => kaart(h, tijd, afh))
      .sort((x, y) => (y.vers ? 1 : 0) - (x.vers ? 1 : 0) || x.naam.localeCompare(y.naam));
  }
  // De regels onder de naam, kort en altijd met een woord: "accu 82% (laadt) · 34 °C · ±3,4 tokens/s".
  function kaartRegel(k) {
    if (!k.vers) return 'geen verse hartslag';
    const d = [];
    d.push(k.accu == null ? 'accu onbekend' : `accu ${k.accu}%${k.laadt ? ' (laadt)' : ''}`);
    d.push(k.temp == null ? 'warmte onbekend' : `${komma(k.temp)} °C`);
    if (k.tps) d.push(`±${komma(k.tps)} tokens/s`);
    return d.join(' · ');
  }

  // De statuszin bovenaan.
  function statusZin(o) {
    const x = o || {};
    const n = Math.max(0, Number(x.totaal) || 0); const b = Math.min(n, Math.max(0, Number(x.bereikbaar) || 0));
    return `Vol lokaal ${x.volLokaal ? 'AAN' : 'UIT'} · Pantser ${x.pantser ? 'AAN' : 'UIT'} · ${n ? `${b} van ${n} telefoons bereikbaar` : 'nog geen telefoons'}`;
  }
  function allesUitVraag(n) {
    return n === 1 ? 'De motor van 1 telefoon uitzetten? Er wordt niets gewist; aanzetten kan daarna weer.'
      : `De motoren van ${n} telefoons uitzetten? Er wordt niets gewist; aanzetten kan daarna weer.`;
  }

  // ---- Zoeken ----
  // standVan(bron) = zoekkassa.stand(bron).stand (ok | rust | uit); telefoons = hoeveel telefoons er nu kunnen zoeken.
  function bronStatus(stand, telefoons) {
    if (stand === 'uit') return { woord: 'uit', teken: '⏻' };
    if (!telefoons) return { woord: 'niet bereikbaar', teken: '❌' };
    if (stand === 'rust') return { woord: 'even rust', teken: '💤' };
    return { woord: 'OK', teken: '✅' };
  }
  function bronnenLijst(standVan, telefoons, soort) {
    const lijst = soort === 'fotos' ? [FOTO_BRON] : BRONNEN_ALGEMEEN;
    return lijst.map((b) => Object.assign({ bron: b, naam: BRON_NAAM[b] || b }, bronStatus(typeof standVan === 'function' ? standVan(b) : 'ok', telefoons)));
  }
  // Wat er echt gevraagd wordt: bij Foto's alleen Openverse; anders de aangevinkte bronnen uit de lijst (nooit een bron die er niet in
  // staat, ook niet als iemand hem in de opslag zet). Niets aangevinkt = niets gevraagd (en dat zegt het scherm).
  function gekozenBronnen(vinkjes, soort) {
    if (soort === 'fotos') return [FOTO_BRON];
    const v = Array.isArray(vinkjes) ? vinkjes : [];
    return BRONNEN_ALGEMEEN.filter((b) => v.includes(b));
  }

  // ---- Modellen ----
  function modelRegels(lijst) {
    return (Array.isArray(lijst) ? lijst : []).map((k) => ({ id: k.id, naam: k.naam, model: k.model || 'onbekend', tps: k.tps,
      bezig: k.bezig, zin: `${k.naam}: ${k.model || 'model onbekend'} · ${k.tps ? `±${komma(k.tps)} tokens/s` : 'tempo nog niet gemeten'} · ${k.bezig ? 'bezig' : (k.vers ? 'vrij' : 'geen hartslag')}` }));
  }
  function modelWisselVraag(k) {
    return k && k.bezig ? `${k.naam} is nu bezig. Toch het model wisselen? De klus die nu loopt stopt dan en gaat naar een andere telefoon.` : null;
  }

  // ---- 657: AI HELPT ----
  // Een schakelaar in de privé-hoek (standaard UIT). Staat die aan, dan kiest de lokale AI zelf per telefoon de zoekbron, zet de
  // zoekbalk aan het werk en laat de F8 samenvatten -- alles ZICHTBAAR op het scherm, en de eigenaar kan altijd overnemen. Dit bestand
  // zegt alleen WAT de AI kiest en WAT hij nooit mag; veronica.js voert het uit met de bestaande zoekstapel en samenvoeging (656).
  // De gekozen bronnen, GEEN DuckDuckGo (§462): Wikipedia, Marginalia, Mojeek, SearXNG. Een bron die niet beschikbaar is slaat de AI over.
  const AI_BRONNEN = Object.freeze(['wikipedia', 'marginalia', 'mojeek', 'searxng']);
  const AI_BRON_NAAM = Object.freeze({ wikipedia: 'Wikipedia', marginalia: 'Marginalia', mojeek: 'Mojeek', searxng: 'SearXNG' });
  // DE HARDE GRENS VOOR BESTUREN. Een telefoon besturen mag ALLEEN na een uitdrukkelijke ja van de eigenaar, NOOIT de F8 (de dagelijkse
  // telefoon) en NOOIT een telefoon met een bank- of kluis-app. De merkers staan hier zodat een telefoon die zo'n app draagt herkend
  // wordt aan wat hij meldt (apps-lijst) -- geen telefoonnaam en geen merknaam in de code. Markeren kan de eigenaar ook met de hand.
  const BANK_KLUIS_MERKERS = Object.freeze(['ing', 'revolut', 'bybit', 'bitwarden', 'kluis', 'bank', 'crypto', 'wallet', 'authenticator', 'authy']);
  function heeftBankKluis(telefoon) {
    const t = telefoon || {};
    if (t.bankKluis === true) return true;
    const apps = Array.isArray(t.apps) ? t.apps : [];
    return apps.some((a) => { const s = String(a || '').toLowerCase(); return BANK_KLUIS_MERKERS.some((m) => s.includes(m)); });
  }
  // true = de AI/de wand mag deze telefoon besturen (nog steeds alleen na een ja); false = NOOIT besturen (alleen kijken).
  function aiMagBesturen(telefoon) {
    const t = telefoon || {};
    if (t.f8 === true || t.dagelijks === true) return false;   // de F8 / dagelijkse telefoon: nooit besturen (546/637)
    if (heeftBankKluis(t)) return false;                        // bank- of kluis-app aan boord: nooit besturen
    return true;
  }
  // De AI verdeelt de bronnen om de beurt over de telefoons (elke telefoon een andere zoekmachine). beschikbaar(bron) -> bool laat een
  // bron weg die nu niet kan (Mojeek zonder sleutel, SearXNG zonder adres). Zuiver en los te testen; de echte zoekstapel doet het werk.
  function aiBronnenBeschikbaar(beschikbaar) {
    const kan = typeof beschikbaar === 'function' ? beschikbaar : () => true;
    const lijst = AI_BRONNEN.filter((b) => kan(b));
    return lijst.length ? lijst : ['wikipedia'];   // Wikipedia is de vaste terugval; de AI valt nooit stil
  }
  function aiPlan(telefoons, beschikbaar) {
    const tels = (Array.isArray(telefoons) ? telefoons : []).filter((t) => t && (t.id || t.toestel));
    const bronnen = aiBronnenBeschikbaar(beschikbaar);
    return tels.map((t, i) => ({
      telefoon: t.id || t.toestel, naam: t.naam || t.id || 'een telefoon',
      bron: bronnen[i % bronnen.length], bronNaam: AI_BRON_NAAM[bronnen[i % bronnen.length]] || bronnen[i % bronnen.length],
      model: t.model || null, magBesturen: aiMagBesturen(t),
    }));
  }
  function aiPlanZin(plan) {
    const p = Array.isArray(plan) ? plan : [];
    if (!p.length) return 'Geen telefoon in de hoek om mee te zoeken.';
    return p.map((x) => `${x.naam}: ${x.bronNaam}${x.model ? ` · ${x.model}` : ''}`).join(' · ');
  }

  return { ZONES, STANDEN, BRONNEN_ALGEMEEN, FOTO_BRON, BRON_NAAM, kaart, kaarten, kaartRegel, statusZin, allesUitVraag, bronStatus, bronnenLijst, gekozenBronnen, modelRegels, modelWisselVraag,
    AI_BRONNEN, AI_BRON_NAAM, BANK_KLUIS_MERKERS, heeftBankKluis, aiMagBesturen, aiBronnenBeschikbaar, aiPlan, aiPlanZin };
}));
