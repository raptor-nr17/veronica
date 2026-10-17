// ===================================================================
// 478: HET VERBRUIKSVERSLAG -- wat de telefoons aan stroom kosten, in gewone woorden, voor wie de rekening betaalt
// ===================================================================
//
// Veronica schrijft bij elke meting van de meter-stekker een regeltje in een dagboek (alleen in deze browser). Uit dat dagboek komt een
// verslag dat je kunt voorlezen of kopieren. Alles wat erin staat is GEMETEN door de meter-stekker (Tasmota Status 8); kosten zijn
// gemeten kWh x het tarief dat de mens zelf instelt. Niets wordt geschat, behalve dat er bij staat waar een gat in zit.
//
//  - De KOPREGEL rekent met het totaalstand-getal van de meter (Total, loopt altijd op): eerste meting in de periode tot de laatste. Dat is
//    juist ook als Veronica een tijd dicht stond, want de meter telde door.
//  - De DAGLIJST gebruikt het "vandaag"-getal van de meter (Today, begint elke nacht opnieuw): het hoogste dat Veronica die dag zag. Een dag
//    waarop Veronica 's avonds dicht stond kan dus te laag staan; zo'n dag krijgt een sterretje.
//  - Het ZON-AANDEEL komt van de dagstaaf van de baas (de laders: kWh in het zonvenster tegenover erbuiten). Alleen over dagen die zo bekend zijn.
//
// Geen netwerk, geen innerHTML. De opslag is een haak (lees/schrijf van JSON-tekst).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Verslag = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_DAGEN = 90;
  const MIN_TUSSEN_MS = 10 * 60 * 1000;      // hoogstens eens per tien minuten een regeltje
  const TARIEF_STANDAARD = 0.30;
  const g = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const afr = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  const kw = (v) => String(afr(v, 2)).replace('.', ',');
  const euro = (x) => `€ ${afr(x, 2).toFixed(2).replace('.', ',')}`;
  function tariefVan(t) {
    const n = Number(String(t === undefined || t === null ? '' : t).trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n <= 5 ? afr(n, 3) : TARIEF_STANDAARD;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function dagVan(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  function dagTekst(sleutel) {
    const [j, m, d] = sleutel.split('-').map(Number);
    const x = new Date(j, m - 1, d);
    return `${DAGEN[x.getDay()]} ${d}-${m}`;
  }

  // o: { opslag: { lees() -> tekst|null, schrijf(tekst) }, nu? }
  function maakDagboek(o) {
    const opt = o || {};
    const nu = opt.nu || (() => Date.now());
    let data = null;     // { dagen: { 'jjjj-mm-dd': { eerste: {t,kwh}, laatste: {t,kwh}, vandaagMax, zon, buiten } } }

    async function laad() {
      if (data) return data;
      let ruw = null;
      try { ruw = opt.opslag && opt.opslag.lees ? await opt.opslag.lees() : null; } catch (e) { ruw = null; }
      try { data = ruw ? JSON.parse(ruw) : null; } catch (e) { data = null; }
      if (!data || typeof data.dagen !== 'object' || !data.dagen) data = { dagen: {} };
      return data;
    }
    async function bewaar() {
      const sleutels = Object.keys(data.dagen).sort();
      while (sleutels.length > MAX_DAGEN) delete data.dagen[sleutels.shift()];
      try { if (opt.opslag && opt.opslag.schrijf) await opt.opslag.schrijf(JSON.stringify(data)); } catch (e) { /* een gemak, geen vereiste */ }
    }

    // m: { kwh (Total), vandaag (Today), zon, buiten (dagstaaf van de baas, mag ontbreken) }
    async function noteer(m) {
      await laad();
      const t = nu();
      const kwh = g(m && m.kwh);
      const vandaag = g(m && m.vandaag);
      if (kwh === null && vandaag === null) return false;
      const sl = dagVan(t);
      const dag = data.dagen[sl] || (data.dagen[sl] = { eerste: null, laatste: null, vandaagMax: null, zon: null, buiten: null });
      if (dag.laatste && t - dag.laatste.t < MIN_TUSSEN_MS && !(vandaag !== null && (dag.vandaagMax === null || vandaag > dag.vandaagMax))) return false;
      if (kwh !== null) {
        if (!dag.eerste) dag.eerste = { t, kwh };
        // Een meter die opnieuw begint (Total daalt) start een nieuwe reeks: de eerste telt dan opnieuw.
        if (dag.laatste && kwh < dag.laatste.kwh) dag.eerste = { t, kwh };
        dag.laatste = { t, kwh };
      }
      if (vandaag !== null && (dag.vandaagMax === null || vandaag > dag.vandaagMax)) dag.vandaagMax = vandaag;
      const zon = g(m && m.zon); const buiten = g(m && m.buiten);
      if (zon !== null && buiten !== null) { dag.zon = Math.max(dag.zon || 0, zon); dag.buiten = Math.max(dag.buiten || 0, buiten); }
      await bewaar();
      return true;
    }

    // Het verslag over de laatste `dagen` dagen (inclusief vandaag).
    async function verslag(dagen, tarief) {
      await laad();
      const n = Math.max(1, Math.min(MAX_DAGEN, Math.round(dagen) || 7));
      const t = tariefVan(tarief);
      const nuMs = nu();
      const sleutels = [];
      for (let i = n - 1; i >= 0; i--) sleutels.push(dagVan(nuMs - i * 86400000));
      const rijen = [];
      for (const sl of sleutels) {
        const d = data.dagen[sl];
        if (!d || d.vandaagMax === null) { rijen.push({ dag: sl, tekst: dagTekst(sl), kwh: null, euro: null, onvolledig: false }); continue; }
        // Alleen een dag in het verleden waarvan de laatste meting ver voor middernacht lag kan te laag staan.
        const laatsteUur = d.laatste ? new Date(d.laatste.t).getHours() : 0;
        const onvolledig = sl !== dagVan(nuMs) && laatsteUur < 21;
        rijen.push({ dag: sl, tekst: dagTekst(sl), kwh: afr(d.vandaagMax, 3), euro: afr(d.vandaagMax * t, 2), onvolledig });
      }
      // De kopregel: van de eerste tot de laatste totaalstand in de periode.
      let eerste = null; let laatste = null;
      for (const sl of sleutels) {
        const d = data.dagen[sl];
        if (!d || !d.eerste || !d.laatste) continue;
        if (!eerste) eerste = d.eerste;
        laatste = d.laatste;
      }
      let totaal = null;
      if (eerste && laatste && laatste.t - eerste.t >= 3600 * 1000 && laatste.kwh >= eerste.kwh) {
        const kwh = afr(laatste.kwh - eerste.kwh, 3);
        const dagenTussen = (laatste.t - eerste.t) / 86400000;
        totaal = { kwh, euro: afr(kwh * t, 2), van: eerste.t, tot: laatste.t, perDag: afr(kwh / Math.max(dagenTussen, 1 / 24), 2), perDagEuro: afr((kwh * t) / Math.max(dagenTussen, 1 / 24), 2) };
      }
      let zon = 0; let buiten = 0; let dagenMetZon = 0;
      for (const sl of sleutels) { const d = data.dagen[sl]; if (d && d.zon !== null && d.buiten !== null) { zon += d.zon; buiten += d.buiten; dagenMetZon += 1; } }
      const zonAandeel = dagenMetZon && zon + buiten > 0 ? Math.round((zon / (zon + buiten)) * 100) : null;
      const metGegevens = rijen.filter((r) => r.kwh !== null).length;
      return { dagen: n, tarief: t, rijen, totaal, zon: zonAandeel === null ? null : { aandeel: zonAandeel, dagen: dagenMetZon, zon: afr(zon, 2), buiten: afr(buiten, 2) }, metGegevens, tekst: maakTekst({ n, t, rijen, totaal, zonAandeel, metGegevens }) };
    }
    async function wisAlles() { data = { dagen: {} }; await bewaar(); }
    async function aantalDagen() { await laad(); return Object.keys(data.dagen).length; }
    return Object.freeze({ noteer, verslag, wisAlles, aantalDagen });
  }

  function maakTekst(v) {
    const r = [];
    r.push(`Stroomverbruik van de telefoons, laatste ${v.n} ${v.n === 1 ? 'dag' : 'dagen'}`);
    if (!v.metGegevens && !v.totaal) { r.push('Er zijn nog geen metingen van de meter-stekker. Zodra Veronica openstaat en de meter antwoordt, vult dit zich vanzelf.'); return r.join('\n'); }
    if (v.totaal) {
      r.push(`Samen: ${kw(v.totaal.kwh)} kWh, dat is ${euro(v.totaal.euro)} tegen ${euro(v.t)} per kWh.`);
      r.push(`Gemiddeld ${kw(v.totaal.perDag)} kWh per dag (${euro(v.totaal.perDagEuro)} per dag).`);
      r.push('Gemeten van de eerste tot de laatste meterstand in deze periode; ook de uren dat Veronica dicht stond zitten erin.');
    } else r.push('Voor een totaal is nog te weinig gemeten (minstens een uur tussen de eerste en de laatste meterstand).');
    if (v.zonAandeel !== null) r.push(`Van het laden gebeurde ${v.zonAandeel}% in de zonuren (de rest erbuiten).`);
    r.push('');
    for (const x of v.rijen) {
      r.push(x.kwh === null ? `${x.tekst}: niet gemeten` : `${x.tekst}: ${kw(x.kwh)} kWh (${euro(x.euro)})${x.onvolledig ? ' *' : ''}`);
    }
    if (v.rijen.some((x) => x.onvolledig)) r.push('* Veronica stond die avond niet meer open: deze dag kan te laag staan.');
    r.push('');
    r.push('Alle getallen komen van de meter-stekker. Kosten zijn gemeten kWh keer het tarief; er wordt niets geschat.');
    return r.join('\n');
  }

  return { maakDagboek, maakTekst, dagVan, tariefVan, TARIEF_STANDAARD, MAX_DAGEN };
}));
