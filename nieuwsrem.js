// ===================================================================
// 678 (21 punten, stap 17, de financiële helft: "de nieuwsrem"). Een nieuwskop over een munt of aandeel krijgt EEN categorie uit een vaste
// lijst (hack, insolventie, verbod, delisting, neutraal). Is de rem AAN en de categorie niet neutraal, dan PAUZEERT hij alleen het KOPEN, en
// alleen bij PAPIERHANDEL. Hij verkoopt nooit, plaatst nooit een order, kent geen sleutel en heeft geen netwerk. Elke vlag wordt gelogd met
// de koers op dat moment; na een uur en na een dag wordt de koers erbij gezet, en na drie maanden rekent evaluatie() uit of de rem iets
// opleverde. STANDAARD UIT. PUUR rekenen: geen netwerk, geen opslag, geen DOM, geen model nodig (het model mag een categorie VOORSTELLEN,
// de code houdt hem tegen de lijst aan). De AI beslist NOOIT een order.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Nieuwsrem = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIEEN = Object.freeze(['hack', 'insolventie', 'verbod', 'delisting', 'neutraal']);
  // Signaalwoorden per categorie (nl en en). De volgorde van de lijst is ook de voorrang bij twee treffers.
  const SIGNAAL = Object.freeze({
    hack: ['hack', 'gehackt', 'hacked', 'exploit', 'gestolen', 'stolen', 'drained', 'leeggehaald', 'lek in', 'breach', 'aanval op'],
    insolventie: ['faillissement', 'failliet', 'bankrupt', 'bankruptcy', 'insolvent', 'insolventie', 'surseance', 'chapter 11', 'uitbetalingen stopgezet', 'halts withdrawals', 'withdrawals paused'],
    verbod: ['verbod', 'verboden', 'verbiedt', 'ban ', 'banned', 'bans ', 'illegaal verklaard', 'aanklacht', 'lawsuit', 'sued', 'charges', 'toezichthouder', 'regulator'],
    delisting: ['delisting', 'delist', 'delisted', 'van de beurs gehaald', 'uit de handel', 'handel stopgezet', 'trading halted', 'suspends trading'],
  });
  const UUR = 60 * 60 * 1000, DAG = 24 * UUR, DRIE_MAANDEN = 91 * DAG;
  const tekst = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  const getal = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

  // deel(kop) -> categorie. Alleen woorden uit de vaste lijst; niets gevonden = neutraal (nooit een gok).
  function deel(kop) {
    const t = ` ${tekst(kop).toLowerCase()} `;
    for (const c of ['hack', 'insolventie', 'verbod', 'delisting']) if (SIGNAAL[c].some((w) => t.indexOf(w) >= 0)) return c;
    return 'neutraal';
  }

  // Het verzoek voor een model (optioneel): alleen een van de vijf woorden terug. leesModel() houdt het antwoord tegen de lijst aan.
  function maakPrompt(kop) {
    return 'Deel deze nieuwskop in. Antwoord met precies een woord uit deze lijst: hack, insolventie, verbod, delisting, neutraal.\n'
      + 'Twijfel je, antwoord dan neutraal. Geef geen advies en noem geen koers.\nKop: ' + tekst(kop).slice(0, 300);
  }
  function leesModel(antwoord) {
    const w = tekst(antwoord).toLowerCase().replace(/[^a-z]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return w.length === 1 && CATEGORIEEN.includes(w[0]) ? w[0] : null;
  }
  // De code wint als code en model het oneens zijn over neutraal: een kop met een signaalwoord blijft een vlag (voorzichtiger), en een
  // model kan een kop zonder signaalwoord hoogstens tot vlag maken als het een geldig woord gaf.
  function kies(kop, modelAntwoord) {
    const code = deel(kop); const m = leesModel(modelAntwoord);
    if (code !== 'neutraal') return code;
    return m || 'neutraal';
  }

  // besluit(categorie, instellingen) -> wat de rem doet. Alleen kopen pauzeren, alleen op papier, standaard uit. NOOIT een order.
  function besluit(categorie, o) {
    const op = o || {};
    const aan = op.aan === true;
    const papier = op.papier !== false;   // alleen papierhandel; echte handel kent deze rem niet
    const vlag = CATEGORIEEN.includes(categorie) && categorie !== 'neutraal';
    return Object.freeze({ categorie: CATEGORIEEN.includes(categorie) ? categorie : 'neutraal', vlag,
      pauzeerKopen: aan && papier && vlag, verkoop: false, order: null,
      zin: !aan ? 'De nieuwsrem staat uit; er gebeurt niets.' : !papier ? 'De nieuwsrem werkt alleen bij papierhandel; er gebeurt niets.'
        : vlag ? `Nieuwsrem: ${categorie}. Kopen staat op pauze (alleen op papier); verkopen doet de rem nooit.` : 'Neutraal nieuws: niets te doen.' });
  }

  // vlag(kop, categorie, koers, nu) -> een logregel. De koersen na een uur en een dag zet nakijken() er later bij.
  function vlag(kop, categorie, koers, nu) {
    const t = typeof nu === 'number' ? nu : 0;
    return { t, kop: tekst(kop).slice(0, 200), categorie, koers: getal(koers), koersUur: null, koersDag: null, nakijkenUur: t + UUR, nakijkenDag: t + DAG };
  }
  // nakijken(v, koers, nu) -> een NIEUWE regel met de koers erbij als het moment daar is (nooit eerder; nooit overschrijven).
  function nakijken(v, koers, nu) {
    const x = Object.assign({}, v); const k = getal(koers);
    if (k === null) return x;
    if (x.koersUur === null && nu >= x.nakijkenUur) x.koersUur = k;
    if (x.koersDag === null && nu >= x.nakijkenDag) x.koersDag = k;
    return x;
  }
  // evaluatie(vlaggen, nu, begin) -> pas na drie maanden een uitslag; per categorie het aantal en de gemiddelde verandering (procent) na een
  // uur en na een dag. Een negatief getal = de koers zakte na de vlag (de rem had zin). Alleen gemeten regels tellen; niets geschat.
  function evaluatie(vlaggen, nu, begin) {
    if (typeof nu !== 'number' || typeof begin !== 'number' || nu - begin < DRIE_MAANDEN) return { klaar: false, zin: 'De evaluatie komt pas na drie maanden.' };
    const per = {};
    for (const v of (Array.isArray(vlaggen) ? vlaggen : [])) {
      if (!v || !CATEGORIEEN.includes(v.categorie) || getal(v.koers) === null || v.koers === 0) continue;
      const p = per[v.categorie] = per[v.categorie] || { aantal: 0, uur: [], dag: [] };
      p.aantal++;
      if (getal(v.koersUur) !== null) p.uur.push((v.koersUur - v.koers) / v.koers * 100);
      if (getal(v.koersDag) !== null) p.dag.push((v.koersDag - v.koers) / v.koers * 100);
    }
    const gem = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10 : null);
    const uit = {};
    for (const c of Object.keys(per)) uit[c] = { aantal: per[c].aantal, naUur: gem(per[c].uur), naDag: gem(per[c].dag) };
    return { klaar: true, perCategorie: uit };
  }

  return { CATEGORIEEN, SIGNAAL, deel, maakPrompt, leesModel, kies, besluit, vlag, nakijken, evaluatie };
}));
