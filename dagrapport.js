// ===================================================================
// 678 / 21-punten stap 0: HET DAGRAPPORT 08:00 NL. De CODE bouwt een overzicht van de getallen; een model schrijft er één alinea bij
// met PLEKHOUDERS; de CODE vult de getallen in. Zo staat er nooit een verzonnen getal in (dezelfde regel als de gids, §320).
// Rekent alleen: geen netwerk, geen opslag, geen model. Veronica/JARVIS levert de per-telefoon-feiten; het versturen om 08:00 is
// device-/relay-werk (een haak), niet deze module.
// ===================================================================
//
// Afspraak met de eigenaar (8 nov): een rapport dat je 's ochtends leest. Het model maakt er een leesbare zin van, maar DE GETALLEN
// KOMEN UIT DE CODE. Zonder model werkt het ook: codeZin() is een volwaardige, kale zin uit dezelfde getallen.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Dagrapport = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De plekhouders die het model mag gebruiken; de code vult ze. Een getal staat NOOIT los in de modeltekst (de zeef controleert dat).
  const PLEKHOUDERS = Object.freeze(['datum', 'aantal', 'bereikbaar', 'motorAan', 'warmste', 'warmsteNaam', 'laagsteAccu', 'laagsteAccuNaam', 'werkKlaar', 'werkAfgekeurd']);

  const tekst = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  const naam = (x) => tekst(x).slice(0, 40) || 'een telefoon';
  const getal = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const nlGetal = (x) => (x === null ? '?' : String(x).replace('.', ','));

  // DE GETALLEN. telefoons = [{ naam, bereikbaar, motorAan, temp, accu, gidsKlaar, gidsAfgekeurd }]; o = { datum, nu }.
  // Alles wat niet gemeld is blijft null -- nooit verzonnen.
  function samenvatting(telefoons, o) {
    const op = o || {};
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    let bereikbaar = 0, motorAan = 0, werkKlaar = 0, werkAfgekeurd = 0;
    let warmste = null, warmsteNaam = null, laagsteAccu = null, laagsteAccuNaam = null;
    for (const t of lijst) {
      const x = t || {};
      if (x.bereikbaar === true) bereikbaar++;
      if (x.motorAan === true) motorAan++;
      const k = getal(x.gidsKlaar); if (k !== null) werkKlaar += k;
      const a = getal(x.gidsAfgekeurd); if (a !== null) werkAfgekeurd += a;
      const temp = getal(x.temp);
      if (temp !== null && (warmste === null || temp > warmste)) { warmste = temp; warmsteNaam = naam(x.naam); }
      const accu = getal(x.accu);
      if (accu !== null && (laagsteAccu === null || accu < laagsteAccu)) { laagsteAccu = accu; laagsteAccuNaam = naam(x.naam); }
    }
    return {
      datum: tekst(op.datum) || new Date(typeof op.nu === 'number' ? op.nu : Date.now()).toISOString().slice(0, 10),
      aantal: lijst.length, bereikbaar, motorAan, werkKlaar, werkAfgekeurd,
      warmste, warmsteNaam, laagsteAccu, laagsteAccuNaam,
    };
  }

  // DE KALE ZIN (geen model) -- het rapport werkt altijd, ook zonder een telefoon die een alinea schrijft.
  function codeZin(s) {
    const o = s || {};
    const d = [];
    d.push(`${o.datum}: ${nlGetal(o.aantal)} telefoon${o.aantal === 1 ? '' : 's'}, ${nlGetal(o.bereikbaar)} bereikbaar, ${nlGetal(o.motorAan)} met de motor aan.`);
    if (o.warmste !== null) d.push(`Warmste: ${o.warmsteNaam} ${nlGetal(o.warmste)} graden.`);
    if (o.laagsteAccu !== null) d.push(`Laagste accu: ${o.laagsteAccuNaam} ${nlGetal(o.laagsteAccu)} procent.`);
    if (o.werkKlaar || o.werkAfgekeurd) d.push(`Werk: ${nlGetal(o.werkKlaar)} klaar, ${nlGetal(o.werkAfgekeurd)} afgekeurd.`);
    return d.join(' ');
  }

  // HET VERZOEK voor het model: schrijf ÉÉN alinea, in het Nederlands, met de plekhouders tussen accolades -- NOOIT zelf een getal.
  function maakPrompt(s) {
    const o = s || {};
    return 'Schrijf één korte, rustige alinea (hoogstens drie zinnen) voor een ochtendrapport over een rek telefoons, in het Nederlands.\n'
      + 'Gebruik voor ELK getal een plekhouder tussen accolades; schrijf NOOIT zelf een getal of een naam.\n'
      + 'Beschikbare plekhouders: {datum}, {aantal}, {bereikbaar}, {motorAan}, {warmste}, {warmsteNaam}, {laagsteAccu}, {laagsteAccuNaam}, {werkKlaar}, {werkAfgekeurd}.\n'
      + `De getallen (alleen ter informatie, zet ze niet zelf in de tekst): ${aantalRegel(o)}\n`
      + 'Geef alleen de alinea.';
  }
  function aantalRegel(o) {
    return `aantal=${nlGetal(o.aantal)}, bereikbaar=${nlGetal(o.bereikbaar)}, motor aan=${nlGetal(o.motorAan)}`
      + (o.warmste !== null ? `, warmste=${nlGetal(o.warmste)} (${o.warmsteNaam})` : '')
      + (o.laagsteAccu !== null ? `, laagste accu=${nlGetal(o.laagsteAccu)} (${o.laagsteAccuNaam})` : '')
      + `, werk klaar=${nlGetal(o.werkKlaar)}, afgekeurd=${nlGetal(o.werkAfgekeurd)}`;
  }

  // Staat er een RAUW getal in de modeltekst dat NIET uit een plekhouder komt? Dan is de regel geschonden (§320-discipline).
  // We kijken naar cijfers buiten {plekhouders}; een cijfer in een plekhoudernaam telt niet (die bestaan niet, maar veilig).
  function heeftRauwGetal(alinea) {
    const zonderPlek = tekst(alinea).replace(/\{[a-zA-Z]+\}/g, '');
    return /\d/.test(zonderPlek);
  }

  // DE CODE VULT DE GETALLEN IN. alinea met {plekhouders} -> echte getallen. Een onbekende plekhouder blijft staan (zichtbaar fout).
  function vulIn(alinea, s) {
    const o = s || {};
    const waarde = {
      datum: tekst(o.datum), aantal: nlGetal(o.aantal), bereikbaar: nlGetal(o.bereikbaar), motorAan: nlGetal(o.motorAan),
      warmste: nlGetal(o.warmste), warmsteNaam: o.warmsteNaam || '?', laagsteAccu: nlGetal(o.laagsteAccu), laagsteAccuNaam: o.laagsteAccuNaam || '?',
      werkKlaar: nlGetal(o.werkKlaar), werkAfgekeurd: nlGetal(o.werkAfgekeurd),
    };
    return tekst(alinea).replace(/\{([a-zA-Z]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(waarde, k) ? waarde[k] : m));
  }

  // De regel die het rapport oplevert: is de modeltekst bruikbaar (plekhouders, geen rauw getal), dan de ingevulde alinea; anders de
  // kale codeZin. Zo komt er NOOIT een verzonnen getal uit, met of zonder model.
  function rapport(s, alinea) {
    const o = s || {};
    const a = tekst(alinea).trim();
    if (a && !heeftRauwGetal(a) && /\{[a-zA-Z]+\}/.test(a)) return { tekst: vulIn(a, o), bron: 'model' };
    return { tekst: codeZin(o), bron: 'code' };
  }

  return { PLEKHOUDERS, samenvatting, codeZin, maakPrompt, heeftRauwGetal, vulIn, rapport };
}));
