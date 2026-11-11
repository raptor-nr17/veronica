// ===================================================================
// 678 (lokale AI op het rek, onderdeel 1): DE TRAP PER VRAAG, als cascade met een meetbaar signaal. Een vraag loopt in deze volgorde:
//   geheugen -> regels -> verdeler (de telefoon met die rol) -> het slimste model dat kan (brein of bibliothecaris) -> F8 -> Gemini
// en stopt bij de EERSTE stap die een antwoord geeft dat de controle haalt. Omhoog gaat alleen op een NAKIJKBAAR signaal (trap.controle
// faalt, of niemand kan het), nooit op wat een model over zichzelf zegt (Trap.magOpschalen).
// PUUR rekenen en beslissen in CODE: geen netwerk, geen opslag, geen model. De telefoons, het geheugen en de regels komen binnen als
// uitvoerders (functies) die veronica.js aanlevert; hier zit alleen de volgorde, de poort en de boekhouding.
//
// Uit het onderzoek van 11 nov, GECORRIGEERD door de eigenaar (17:36): lokale modellen kosten geen tokens, alleen stroom, en de telefoons
// liggen op de cooler. Daarom:
//  - een model over meerdere telefoons verdelen telt alleen het geheugen op, niet de snelheid: deze route doet dat NOOIT. Elke telefoon is
//    een eigen werker voor een eigen vraag (zie Trap.plan voor stukjes).
//  - omhoog sturen kost alleen TIJD. Een vraag ZONDER haast mag rustig het hele rek af en daarna omhoog; bij een vraag MET haast (ctx.haast)
//    gaat hij niet dubbel en niet langs een tweede controle, zodat niemand onnodig wacht. Antwoordlog bewaakt de wachttijd van snelle vragen.
//  - STILSTAANDE rekenkracht wordt gebruikt (alleen zonder haast): dezelfde vraag aan twee telefoons met het beste antwoord (ctx.dubbel), een
//    tweede model dat het antwoord nakijkt (ctx.tweedeControle), en achtergrondklussen voor stilstaande telefoons (achtergrondPlan).
//  - GEMINI is het enige dat echt iets kost of op een limiet loopt: altijd de LAATSTE stap, met een dagplafond (ctx.geminiDag).
//  - NIET ELKE TELEFOON LIGT OP DE COOLER (eigenaar, 17:38): de verdeler niet, de telefoons voor het zware werk wel. De verdeler doet daarom alleen
//    LICHT werk (indelen, korte antwoorden, korte proefjes) en nooit een lange achtergrondklus; lange klussen gaan naar gekoelde telefoons.
//    Per telefoon wordt de batterijtemperatuur bewaakt (warmte()): te warm = rustiger (geen dubbel, geen achtergrondwerk, achteraan in de rij),
//    veel te warm = overslaan. Een gekoelde telefoon mag warmer worden dan een niet-gekoelde. Onbekende temperatuur blokkeert niets.
//  - ALTIJD 4 DRADEN (DRADEN): 8 draden stortte in op een rektelefoon met 8 grote kernen (0,65 tok/s tegen 17,71 op 4 draden). De uitvoerder krijgt dit getal mee.
//
// HARDE REGELS (dezelfde als overal):
//  - GEHEUGEN levert ALLEEN een antwoord MET bron (Kennisbank.zoek geeft nooit een feit zonder bron). Geen bron = geen antwoord.
//  - REGELS (stekker, wekker, ...) geven een VOORSTEL met bevestiging: niets wordt hier uitgevoerd.
//  - GEMINI (buiten het rek) NOOIT bij een privé-vraag, NOOIT bij Vol lokaal, en alleen als de eigenaar het toestond (standaard UIT).
//  - De F8 alleen als hij nu mag (ctx.f8.beschikbaar) en alleen na de kleinere modellen, met de reden erbij (Trap.F8_REDEN).
//  - Een model dat een fout geeft of niet antwoordt telt als gefaald, de route gaat door; er wordt nooit een antwoord verzonnen.
// Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./trap.js'), require('./antwoordlog.js'));
  else wortel.Cascade = fabriek(wortel.Trap, wortel.Antwoordlog);
}(typeof self !== 'undefined' ? self : this, function (Trap, Antwoordlog) {
  'use strict';

  const STAPPEN = Object.freeze(['geheugen', 'regels', 'verdeler', 'model', 'f8', 'gemini']);
  const MAX_MODELPOGINGEN = 2;     // MET haast: hoogstens twee verschillende telefoons uit het rek; daarna omhoog
  const MAX_ZONDER_HAAST = 3;      // ZONDER haast mag het hele rek langs voor het omhoog gaat
  const DRADEN = 4;                // gemeten beste aantal draden; nooit meer (8 stortte in)
  // Welke rol gaat bij welke soort klus voorop (de rol is het begin; Antwoordlog.rangschik stuurt bij met wat er gemeten is).
  const ROL_VOOR = Object.freeze({ algemeen: ['brein', 'bibliothecaris'], json: ['brein', 'bibliothecaris'], labelen: ['brein', 'bibliothecaris'],
    samenvatten: ['bibliothecaris', 'brein'], feit: ['bibliothecaris', 'brein'] });

  const tekst = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));

  // telefoonsUitRollen(telefoons, rollen): hangt de rol (uit Rekrollen, per toestel-id) aan elke telefoon. Een telefoon zonder rol krijgt er geen.
  function telefoonsUitRollen(telefoons, rollen) {
    const r = rollen && typeof rollen === 'object' ? rollen : {};
    return (Array.isArray(telefoons) ? telefoons : []).filter((t) => t && t.id).map((t) => Object.assign({}, t, { rol: r[t.id] || t.rol || null }));
  }
  const klaar = (t) => t && t.klaar === true && t.bezig !== true && !t.dagelijks && t.f8 !== true;   // de F8/dagelijkse telefoon is nooit "het rek"

  // warmte(temp, gekoeld): 'onbekend' | 'ok' | 'rustig' | 'over' voor een batterijtemperatuur in graden. Grenzen: gekoeld 39 (rustig) en 42 (over, gelijk aan de
  // rek-grens van de motor-instellingen); niet gekoeld 36 en 39. Dit is een REGEL, geen model: pure vergelijking van een gemeten getal.
  const WARMTE = Object.freeze({ gekoeld: { rustig: 39, over: 42 }, ongekoeld: { rustig: 36, over: 39 } });
  function warmte(temp, gekoeld) {
    if (typeof temp !== 'number' || !isFinite(temp)) return 'onbekend';
    const g = gekoeld === true ? WARMTE.gekoeld : WARMTE.ongekoeld;
    return temp >= g.over ? 'over' : temp >= g.rustig ? 'rustig' : 'ok';
  }
  const warmteVan = (t) => warmte(t && t.temp, t && t.gekoeld);

  // kandidaten(soort, telefoons, log): de telefoons uit het rek die dit nu kunnen, in volgorde: eerst de rol, daarna bijgestuurd door metingen.
  function kandidaten(soort, telefoons, log) {
    const rollen = ROL_VOOR[soort] || ROL_VOOR.algemeen;
    const rek = (telefoons || []).filter(klaar).filter((t) => t.rol === 'brein' || t.rol === 'bibliothecaris');
    const opRol = rollen.map((r) => rek.filter((t) => t.rol === r)).reduce((a, b) => a.concat(b), []).filter((t) => warmteVan(t) !== 'over');   // veel te warm: overslaan
    const gerangschikt = Antwoordlog.rangschik(log, soort, opRol.map((t) => ({ id: t.id }))).map((x) => rek.find((t) => t.id === x.id));
    // een telefoon die al warm is gaat achteraan (stabiel: de volgorde van de rol en van het geleerde blijft binnen elke groep)
    return gerangschikt.filter((t) => warmteVan(t) !== 'rustig').concat(gerangschikt.filter((t) => warmteVan(t) === 'rustig'));
  }

  async function veilig(fn) { try { return await fn(); } catch (e) { return { fout: String((e && e.message) || e).slice(0, 80) }; } }

  // route(vraag, ctx, uitv): loopt de trap. ctx = { prive, volLokaal, geminiToegestaan, f8: {beschikbaar}, telefoons: [{id, naam, rol, klaar, bezig, backend}],
  // log, nu }. uitv = { geheugen(vraag), regels(vraag), verdeel(vraag, tel), model(tel, vraag, {soort}), f8(vraag, {reden}), gemini(vraag) }.
  // Terug: { antwoord, bron, telefoon, soort, stappen, records, geescaleerd, alarm, voorstel }. records = de nieuwe regels voor Antwoordlog.
  async function route(vraag, ctx, uitv) {
    const c = ctx || {}; const u = uitv || {}; const q = tekst(vraag).trim();
    const nu = typeof c.nu === 'number' ? c.nu : 0;
    const stappen = []; const records = []; let soort = 'algemeen';
    const stap = (naam, ok, reden, extra) => stappen.push(Object.assign({ stap: naam, ok: ok, reden: reden || '' }, extra || {}));
    const klaarMet = (bron, antwoord, telefoon, extra) => {
      const geescaleerd = bron === 'f8' || bron === 'gemini' || bron === 'niemand';
      records.push({ s: 'vraag', t: nu, soort: soort, bron: bron, geescaleerd: geescaleerd, pogingen: records.filter((r) => r.s === 'poging').length,
        haast: c.haast === true, wacht: records.filter((r) => r.s === 'poging').reduce((a, r) => a + (typeof r.ms === 'number' ? r.ms : 0), 0) });
      const log = Antwoordlog.lees((c.log || []).concat(records));
      return Object.assign({ antwoord: antwoord, bron: bron === 'niemand' ? null : bron, telefoon: telefoon || null, soort: soort, stappen: stappen, records: records,
        geescaleerd: geescaleerd, alarm: Antwoordlog.alarm(log) }, extra || {});
    };
    if (!q) { stap('geheugen', false, 'lege vraag'); return klaarMet('niemand', null, null, { reden: 'lege vraag' }); }

    // 1. GEHEUGEN -- alleen met bron.
    if (u.geheugen) {
      const g = await veilig(() => u.geheugen(q));
      if (g && g.antwoord && g.bron) { stap('geheugen', true, 'gevonden in het eigen geheugen', { bron: tekst(g.bron).slice(0, 120) }); return klaarMet('geheugen', tekst(g.antwoord), null, { bronTekst: tekst(g.bron) }); }
      stap('geheugen', false, g && g.antwoord && !g.bron ? 'antwoord zonder bron telt niet' : 'niets gevonden');
    }
    // 2. REGELS -- een VOORSTEL, nooit uitvoeren.
    if (u.regels) {
      const r = await veilig(() => u.regels(q));
      if (r && (r.antwoord || r.actie) && !r.fout) { stap('regels', true, 'vaste regel herkend'); return klaarMet('regels', tekst(r.antwoord), null, { voorstel: r.actie ? { actie: r.actie, bevestiging: true } : null }); }
      stap('regels', false, 'geen regel');
    }
    // 3. VERDELER -- bepaalt de soort klus. Zonder verdeler (of als hij faalt) doet gewone code dat met Trap.raadSoort.
    const verdelers = (c.telefoons || []).filter((t) => klaar(t) && t.rol === 'verdeler');
    let zwaar = false; let verdeeld = 'code';
    if (verdelers.length && u.verdeel) {
      const v = await veilig(() => u.verdeel(q, verdelers[0]));
      if (v && !v.fout && Trap.SOORTEN[v.soort]) { soort = v.soort; zwaar = v.zwaar === true; verdeeld = verdelers[0].id; stap('verdeler', true, 'ingedeeld door de verdeler', { telefoon: verdelers[0].id, soort: soort }); }
      else stap('verdeler', false, 'de verdeler gaf geen bruikbare indeling; gewone code deelt in');
    }
    if (verdeeld === 'code') { soort = Trap.raadSoort(q); stap('verdeler', true, verdelers.length ? 'ingedeeld door gewone code (de verdeler hoeft er geen model voor te gebruiken)' : 'ingedeeld door gewone code (geen verdeler klaar)', { soort: soort }); }

    // 4. HET SLIMSTE MODEL DAT KAN -- brein of bibliothecaris. MET haast: hoogstens twee telefoons, een voor een. ZONDER haast: het hele rek,
    //    en (als de eigenaar dat wil) dezelfde vraag aan twee telefoons tegelijk met een tweede model dat het antwoord nakijkt.
    const haast = c.haast === true;
    let reden = 'vol';
    const kand = kandidaten(soort, c.telefoons, c.log);
    for (const t of (c.telefoons || []).filter((x) => klaar(x) && (x.rol === 'brein' || x.rol === 'bibliothecaris') && warmteVan(x) === 'over')) stap('model', false, `te warm (${t.temp} °C): overgeslagen`, { telefoon: t.id, rol: t.rol });
    if (!kand.length) reden = 'geen-groter';
    const grens = haast ? MAX_MODELPOGINGEN : MAX_ZONDER_HAAST;
    // een poging: de telefoon rekent (op 4 draden), de gewone controle kijkt na, en zonder haast kijkt een ANDERE telefoon het ook na.
    const poging = async (t) => {
      const m = await veilig(() => u.model(t, q, { soort: soort, draden: DRADEN }));
      const a = m && !m.fout ? tekst(m.antwoord) : '';
      let chk = m && !m.fout ? Trap.controle(soort, q, a) : { ok: false, reden: m && m.fout ? 'telefoon gaf een fout' : 'geen antwoord' };
      let score = null; let tweede = null;
      if (chk.ok && !haast && c.tweedeControle === true && u.beoordeel) {
        // een ANDERE telefoon kijkt na: bij voorkeur een rek-telefoon die niet warm is; de (niet-gekoelde) verdeler alleen als laatste redmiddel
        const anders = kand.filter((x) => warmteVan(x) === 'ok' || warmteVan(x) === 'onbekend').concat((c.telefoons || []).filter((x) => klaar(x) && x.rol === 'verdeler' && warmteVan(x) !== 'over' && warmteVan(x) !== 'rustig')).find((x) => x.id !== t.id);
        if (anders) {
          const b = await veilig(() => u.beoordeel(anders, q, a, { soort: soort, draden: DRADEN }));
          if (b && !b.fout && b.ok === false) { chk = { ok: false, reden: 'het tweede model keurt het af' }; tweede = anders.id; }
          else if (b && !b.fout) { score = typeof b.score === 'number' ? b.score : null; tweede = anders.id; }
        }
      }
      records.push({ s: 'poging', t: nu, soort: soort, telefoon: t.id, ok: chk.ok, ms: m && m.ms, tokens: m && m.tokens, backend: (m && m.backend) || t.backend, gevraagd: t.gevraagd });
      stap('model', chk.ok, chk.ok ? 'antwoord haalt de controle' + (tweede ? ' (nagekeken door een tweede model)' : '') : chk.reden, { telefoon: t.id, rol: t.rol, nagekeken: tweede });
      return { t: t, a: a, ok: chk.ok, score: score, ms: m && typeof m.ms === 'number' ? m.ms : null };
    };
    if (u.model && kand.length) {
      const dubbel = !haast && c.dubbel === true && kand.length >= 2 && warmteVan(kand[0]) !== 'rustig' && warmteVan(kand[1]) !== 'rustig';   // een warme telefoon krijgt geen extra werk
      let rest = kand.slice(0, grens);
      while (rest.length) {
        const groep = dubbel && rest.length >= 2 ? rest.splice(0, 2) : rest.splice(0, 1);
        const uit = await Promise.all(groep.map(poging));
        const goed = uit.filter((x) => x.ok);
        if (goed.length) {
          // het beste antwoord: hoogste score van het tweede model, bij gelijk de snelste
          goed.sort((x, y) => ((y.score == null ? 0.5 : y.score) - (x.score == null ? 0.5 : x.score)) || ((x.ms == null ? 1e9 : x.ms) - (y.ms == null ? 1e9 : y.ms)));
          return klaarMet('model', goed[0].a, goed[0].t.id, { dubbelGevraagd: groep.length === 2 });
        }
        reden = 'controle';
      }
    }
    // 5. DE F8 -- alleen als hij nu mag, met de reden erbij.
    const f8Reden = Trap.F8_REDEN[reden] || Trap.F8_REDEN.controle;
    if (c.f8 && c.f8.beschikbaar === true && u.f8) {
      const f = await veilig(() => u.f8(q, { reden: f8Reden, soort: soort }));
      const a = f && !f.fout ? tekst(f.antwoord) : '';
      const chk = a ? Trap.controle(soort, q, a) : { ok: false, reden: 'geen antwoord' };
      records.push({ s: 'poging', t: nu, soort: soort, telefoon: 'f8', ok: chk.ok, ms: f && f.ms, tokens: f && f.tokens, backend: (f && f.backend) || 'onbekend' });
      stap('f8', chk.ok, chk.ok ? 'de F8 antwoordde (' + f8Reden + ')' : chk.reden, { reden: f8Reden });
      if (chk.ok) return klaarMet('f8', a, 'f8', { f8Reden: f8Reden });
    } else stap('f8', false, c.f8 && c.f8.beschikbaar === true ? 'geen F8-uitvoerder' : 'de F8 mag nu niet (thuis, niet in gebruik, accu, warmte)');
    // 6. GEMINI -- als LAATSTE, nooit privé, nooit bij Vol lokaal, alleen als de eigenaar het toestond.
    const dag = c.geminiDag && typeof c.geminiDag === 'object' ? c.geminiDag : null;     // { gebruikt, max }: de limiet van Gemini
    const opDagMax = !!dag && typeof dag.max === 'number' && typeof dag.gebruikt === 'number' && dag.gebruikt >= dag.max;
    const mag = !c.prive && !c.volLokaal && c.geminiToegestaan === true && !!u.gemini && !opDagMax;
    if (mag) {
      const g = await veilig(() => u.gemini(q));
      const a = g && !g.fout ? tekst(g.antwoord) : '';
      const chk = a ? Trap.controle(soort, q, a) : { ok: false, reden: 'geen antwoord' };
      stap('gemini', chk.ok, chk.ok ? 'buiten het rek beantwoord' : chk.reden);
      if (chk.ok) return klaarMet('gemini', a, null, { buitenHetRek: true });
    } else stap('gemini', false, c.prive ? 'privé: gaat nooit buiten het rek' : c.volLokaal ? 'Vol lokaal staat aan' : c.geminiToegestaan !== true ? 'niet toegestaan (standaard uit)' : opDagMax ? 'het dagplafond van Gemini is bereikt' : 'geen uitvoerder');
    return klaarMet('niemand', null, null, { reden: 'niemand kon dit (nog) beantwoorden' });
  }

  // achtergrondPlan(ctx, klussen): gebruikt STILSTAANDE rekenkracht. Wijst klussen toe aan telefoons die nu niets doen. Lokale modellen kosten geen tokens,
  // dus een telefoon die wacht mag werken -- maar NOOIT als er een vraag wacht (ctx.wachtVragen > 0), nooit op een telefoon die niet klaar of
  // bezig is, nooit op de F8 of de dagelijkse telefoon, en hoogstens een klus per telefoon. LANGE klussen (kennis opbouwen, embedden, antwoorden
  // nakijken) alleen op een telefoon die OP DE COOLER ligt en niet warm is; de niet-gekoelde verdeler krijgt alleen KORTE klussen (een proefje).
  // De bibliothecaris bouwt kennis op (embedden), het brein controleert antwoorden na. Terug: [{ klus, telefoon, rol }]. Voert niets uit.
  const ROL_KLUS = Object.freeze({ bibliothecaris: ['embedden', 'kennis'], brein: ['controleren', 'proef'], verdeler: ['proef'] });
  const LANG = Object.freeze(['embedden', 'kennis', 'controleren']);
  function achtergrondPlan(ctx, klussen) {
    const c = ctx || {};
    if ((c.wachtVragen || 0) > 0) return [];
    const vrij = (c.telefoons || []).filter((t) => klaar(t) && ROL_KLUS[t.rol] && (warmteVan(t) === 'ok' || warmteVan(t) === 'onbekend'));   // warm = geen extra werk
    const rest = (Array.isArray(klussen) ? klussen : []).slice();
    const uit = [];
    for (const t of vrij) {
      const i = rest.findIndex((k) => k && ROL_KLUS[t.rol].indexOf(k.soort) >= 0 && !(c.prive && k.prive !== true) && (LANG.indexOf(k.soort) < 0 || t.gekoeld === true));
      if (i >= 0) { uit.push({ klus: rest[i], telefoon: t.id, rol: t.rol }); rest.splice(i, 1); }
    }
    return uit;
  }

  return { route, kandidaten, telefoonsUitRollen, achtergrondPlan, warmte, STAPPEN, ROL_VOOR, ROL_KLUS, LANG, WARMTE, MAX_MODELPOGINGEN, MAX_ZONDER_HAAST, DRADEN };
}));
