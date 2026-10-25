// ===================================================================
// 549: AVENGERS ASSEMBLE -- EEN knop die alle telefoons bij elkaar roept, met een lijst van MODI om uit te kiezen.
// ===================================================================
//
// Wens van de eigenaar (24 oktober): een grote knop in Veronica. Drukken = alle telefoons melden zich en worden klaargezet om
// rekenkracht te delen; daarna kies je op dezelfde pagina wat ze doen. Dit bestand REKENT alleen (geen scherm, geen netwerk, geen
// opslag): wie doet mee en waarom niet, welke stap er per telefoon nodig is, en welke modi er zijn. Het netwerk (roepen, motor aan,
// Pantser) doet veronica.js met de BESTAANDE functies van "Roep de rij op" en "Pantser aan".
//
// De vaste regels, ook voor elke modus die later bijkomt:
//  - EERST tonen wie meedoet en wie niet, met de reden; pas na een tik gebeurt er iets.
//  - Een modus heeft effect 'geen' (alleen rekenen/zoeken) of 'voorstel' (de AI stelt voor, de eigenaar keurt). Een modus die iets in
//    de echte wereld doet (versturen, kopen, publiceren, instellingen van anderen) bestaat niet en wordt door registreer() geweigerd.
//  - De knop zet NOOIT een telefoon aan die met de Uit-knop is stilgezet, maakt NOOIT een beheerder werker, laat NOOIT vanzelf een
//    nieuwe telefoon toe (dat blijft "Laat toe" van een mens) en doet niets met de zandbak of de dagelijkse telefoon (behalve het
//    gast-brein zoals gastbrein.js zegt).
//  - Geen merknaam en geen naam van een persoon in dit bestand (het staat in Veronica).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Avengers = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AANWEZIG_MS = 15 * 60 * 1000;      // een hartslag van hoogstens een kwartier oud telt als aanwezig (via de relay komt hij elke 30 s)
  const EFFECTEN = Object.freeze(['geen', 'voorstel']);
  const ROLLEN = Object.freeze(['werker', 'beheerder', 'gast', 'bewaker']);
  const tekst = (x) => (typeof x === 'string' ? x : '');
  const minZin = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.round(m / 60)} uur`; };
  const versieGetal = (v) => tekst(v).split('.').map((x) => Number(x) || 0).reduce((s, x, i) => s + x * [1e6, 1e3, 1][i], 0);

  // ---- De modi. Een nieuwe modus = een regel hier (of registreer() van buiten) EN een handler in veronica.js (AvV.handlers). ----
  const MODI = [];
  function registreer(m) {
    const x = m || {};
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(tekst(x.id))) throw new Error('modus: id');
    if (MODI.some((y) => y.id === x.id)) throw new Error(`modus: ${x.id} bestaat al`);
    if (!tekst(x.titel).trim() || !tekst(x.uitleg).trim()) throw new Error('modus: titel en uitleg');
    if (!EFFECTEN.includes(x.effect)) throw new Error('modus: alleen effect geen of voorstel; iets in de echte wereld doen bestaat niet');
    const rollen = (Array.isArray(x.rollen) ? x.rollen : []).filter((r) => ROLLEN.includes(r));
    if (!rollen.length) throw new Error('modus: rollen');
    const modus = Object.freeze({ id: x.id, titel: x.titel, uitleg: x.uitleg, effect: x.effect, rollen: Object.freeze(rollen), fenna: tekst(x.fenna) });
    MODI.push(modus);
    return modus;
  }
  registreer({ id: 'rekenkracht', titel: 'Rekenkracht delen', effect: 'geen', rollen: ['werker', 'beheerder', 'gast'],
    uitleg: 'De telefoons rekenen samen aan de opdrachten in de wachtrij (Pantser aan). Het zware werk gaat naar het gast-brein als dat mag.',
    fenna: 'de telefoons rekenen samen aan opdrachten' });
  registreer({ id: 'zoekmachines', titel: 'Privé-hoek: elke telefoon een eigen zoekmachine', effect: 'geen', rollen: ['werker', 'beheerder', 'bewaker'],
    uitleg: 'Elke telefoon zoekt zijn eigen deel van je vraag. De schermenwand zet de beelden van de telefoons aan een USB-kabel naast elkaar.',
    fenna: 'elke telefoon zoekt als eigen zoekmachine' });
  registreer({ id: 'opdrachten', titel: 'Andere opdrachten', effect: 'voorstel', rollen: ['werker', 'beheerder', 'gast'],
    uitleg: 'Voorstellen van de AI-kern. Jij keurt; goedkeuren voert niets uit in de echte wereld.',
    fenna: 'de AI-kern doet voorstellen die de eigenaar keurt' });
  // 553: de trap van klein naar groot -- alle telefoons tegelijk, elk een stukje, groter alleen als de controle faalt.
  registreer({ id: 'trap', titel: 'Samen van klein naar groot', effect: 'geen', rollen: ['werker', 'beheerder', 'gast'],
    uitleg: 'Veronica knipt een doel in stukjes; alle telefoons doen tegelijk een stukje met het kleinste model dat goed genoeg is.',
    fenna: 'alle telefoons tegelijk een stukje, van klein naar groot' });
  const modus = (id) => MODI.find((m) => m.id === id) || null;

  // ---- Wie doet mee? Een lid = { id, naam, hart (hartslag of null), wifi (true = JARVIS antwoordt nu over het wifi), status } ----
  // Uitslag: { id, naam, mee, rol, reden, stappen: ['motor-aan'] }.
  function beoordeel(lid, tijd, gastZinnen) {
    const l = lid || {};
    const h = l.hart && typeof l.hart === 'object' ? l.hart : null;
    const naam = tekst(l.naam) || (h && tekst(h.naam)) || 'Een telefoon';
    const uit = (reden) => ({ id: l.id || null, naam, mee: false, rol: null, reden, stappen: [] });
    const vers = !!(h && typeof h.t === 'number' && tijd - (h.ontvangen || h.t) <= AANWEZIG_MS);
    if (!vers && l.wifi !== true) {
      const laatst = h && typeof h.t === 'number' ? h.ontvangen || h.t : 0;
      return uit(laatst ? `niet aanwezig: laatste teken ${minZin(tijd - laatst)} geleden (staat hij uit, of slaapt JARVIS?)` : 'niet aanwezig: nog nooit een teken gezien');
    }
    // Wat de telefoon zelf meldt: de verse hartslag wint; anders wat /jarvis/status over het wifi zei (onbekend = weglaten).
    const x = {};
    for (const [k, w] of Object.entries(l.status || {})) if (w !== null && w !== undefined) x[k] = w;
    if (vers) Object.assign(x, h);
    if (x.pauze) return uit('JARVIS staat uit op de telefoon zelf (de Uit-knop). Aanzetten doe je daar, of met "Noodstop opheffen" bij die telefoon op Live; deze knop doet dat nooit vanzelf.');
    if (x.zandbak) return uit('zandbak (veilig browsen): doet nooit mee');
    if (x.gast && typeof x.gast === 'object') {
      if (x.gast.mag === true) return { id: l.id || null, naam, mee: true, rol: 'gast', reden: 'gast-brein: rekent mee aan het zware werk', stappen: [] };
      return uit(`gast-brein, rust nu: ${(gastZinnen && gastZinnen[x.gast.reden]) || 'onbekend'}`);
    }
    if (x.dagelijks) return uit('dagelijkse telefoon: rust (niet in het rek)');
    if (x.sparen) return uit('Sparen staat aan op die telefoon (alleen daar uit te zetten)');
    const oud = x.versie && versieGetal(x.versie) < versieGetal('1.9.64') ? ` Oude JARVIS (${x.versie}): werkt zichzelf bij aan de lader.` : '';
    const m = x.motor && typeof x.motor === 'object' ? x.motor : null;
    const beheerder = x.voorkeur === 'kern';
    const rol = beheerder ? 'beheerder' : 'werker';
    const pre = beheerder ? 'beheerder (blijft beheerder; alleen een mens maakt hem werker)' : 'werker';
    if (m && (m.teOud || m.soort === 'te-oud')) return { id: l.id || null, naam, mee: true, rol: 'bewaker', reden: `te oud voor een model: zoekt en bewaakt mee.${oud}`, stappen: [] };
    if (m && m.klaar) return { id: l.id || null, naam, mee: true, rol, reden: `${pre}: eigen motor klaar${m.model ? ` (${m.model})` : ''}.${oud}`, stappen: [] };
    if (m && m.aan) return { id: l.id || null, naam, mee: true, rol, reden: `${pre}: eigen motor start (${tekst(m.fase) || 'bezig'}${typeof m.procent === 'number' ? `, model ${m.procent}%` : ''}).${oud}`, stappen: [] };
    if (beheerder) return { id: l.id || null, naam, mee: true, rol, reden: `${pre}: geen eigen motor aan; hij regelt de rij.${oud}`, stappen: [] };
    return { id: l.id || null, naam, mee: true, rol, reden: `werker: de eigen motor gaat aan (het model komt er alleen op wifi en aan de lader).${oud}`, stappen: ['motor-aan'] };
  }
  // De hele lijst, plus de telefoons die zich net aanmelden (Bluetooth-vraag): die worden NOOIT vanzelf toegelaten.
  function voorschouw(leden, aanmelders, tijd, gastZinnen) {
    const gezien = new Set();
    const lijst = [];
    for (const l of Array.isArray(leden) ? leden : []) {
      if (l && l.id && gezien.has(l.id)) continue;
      if (l && l.id) gezien.add(l.id);
      lijst.push(beoordeel(l, tijd, gastZinnen));
    }
    lijst.sort((a, b) => (a.mee === b.mee ? a.naam.localeCompare(b.naam) : a.mee ? -1 : 1));
    const nieuw = (Array.isArray(aanmelders) ? aanmelders : []).filter((w) => w && w.id).map((w) => ({ id: w.id, naam: tekst(w.wie) || 'Een nieuwe telefoon',
      reden: 'wil meedoen: tik bij Koppelen op "Laat toe" als het getal klopt (een mens laat toe, de knop niet)' }));
    return { lijst, nieuw, mee: lijst.filter((x) => x.mee).length, niet: lijst.filter((x) => !x.mee).length };
  }
  // Wie doet mee in een modus.
  function inModus(id, lijst) {
    const m = modus(id);
    return m ? (Array.isArray(lijst) ? lijst : []).filter((x) => x.mee && m.rollen.includes(x.rol)) : [];
  }
  // Telefoons die NA de knop aanwezig werden en meedoen (in de oude lijst niet mee, of er niet).
  function laatkomers(vorigeIds, lijst) {
    const oud = new Set(Array.isArray(vorigeIds) ? vorigeIds : []);
    return (Array.isArray(lijst) ? lijst : []).filter((x) => x.mee && x.id && !oud.has(x.id));
  }
  // EEN zin voor de pagina en voor het logboek (geen getal dat niet geteld is).
  function samenvatting(v) {
    if (!v) return '';
    const n = v.nieuw && v.nieuw.length ? ` ${v.nieuw.length} ${v.nieuw.length === 1 ? 'nieuwe telefoon wacht' : 'nieuwe telefoons wachten'} op "Laat toe".` : '';
    return `${v.mee} ${v.mee === 1 ? 'telefoon doet' : 'telefoons doen'} mee, ${v.niet} niet.${n}`;
  }
  // Voor het lange geheugen van Fenna: een gebeurtenis van een regel (geen inhoud, alleen wat en wie).
  function gebeurtenis(dag, modusId, lijst) {
    const m = modus(modusId);
    const namen = (Array.isArray(lijst) ? lijst : []).filter((x) => x.mee).map((x) => x.naam).slice(0, 8);
    return { op: 'gebeurtenis', dag, tekst: `Avengers assemble${m ? `, modus ${m.titel}` : ''}: ${namen.length ? namen.join(', ') : 'niemand'} deed mee.` };
  }
  function modiVoorFenna() { return MODI.map((m) => `${m.titel}: ${m.fenna || m.uitleg}`).join('; '); }

  return { AANWEZIG_MS, EFFECTEN, ROLLEN, MODI, registreer, modus, beoordeel, voorschouw, inModus, laatkomers, samenvatting, gebeurtenis, modiVoorFenna };
}));
