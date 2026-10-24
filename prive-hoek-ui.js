// ===================================================================
// MIJN PRIVÉ-HOEK, het scherm (466)
// ===================================================================
// Bouwt het hele paneel met textContent (nooit innerHTML), in eenvoudige taal. De regels staan in prive-hoek.js.
//
// OPSLAG: een EIGEN database in deze browser ("veronica-prive"), los van de rest van Veronica. Er gaat NIETS van de inhoud naar een
// telefoon, ntfy, een server, Drive of een andere dienst; dit bestand heeft geen netwerkaanroep. De opgeslagen hoek is NIET
// versleuteld in de browser (de back-up wel). 476b: GEEN slot meer (besluit van de eigenaar, 16 oktober): geen pincode,
// geen wachtwoord, geen extra inlog -- de inlog van de Chromebook beschermt de hoek. Wat blijft: alleen deze browser, niets
// op internet, niets bewaard buiten de browser.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek;
  else wortel.PriveHoekUI = { maak: fabriek };
}(typeof self !== 'undefined' ? self : this, function (P, d) {
  'use strict';
  // d = { doc, nu(), opslag{lees,schrijf,wis}, rijen(), verbruik(), noodstopKern(), noodstop(), stop(), pantserAan(), crypto?, downloadBestand(naam, tekst), bevestig(zin), model? }
  const doc = d.doc;
  const el = (tag, klasse, tekst) => { const e = doc.createElement(tag); if (klasse) e.className = klasse; if (tekst !== undefined) e.textContent = tekst; return e; };
  const U = { store: null, open: true, melding: '', test: null, proef: null, zoek: '', filter: '', klaar: false, inactiefT: 0, proefModel: null, gesprek: [], rijGesprek: [] };
  let wortelEl = null;
  const INACTIEF_MS = 10 * 60 * 1000;

  async function laad() {
    const s = await d.opslag.lees('store');
    U.store = P.leesStore(s);
    try { await d.opslag.wis('slot'); } catch (e) { /* een oud slot uit 466: weg ermee */ }
    U.klaar = true;
  }
  async function bewaar() { await d.opslag.schrijf('store', U.store); }
  function raak() { U.inactiefT = d.nu(); }
  // 476b: 'dicht' ruimt alleen het tijdelijke op (gesprek, proef); de hoek zelf blijft open, er is geen slot.
  function dicht() { U.open = true; U.test = null; U.proef = null; U.proefModel = null; U.koppelQr = null; U.gesprek = []; U.rijGesprek = []; U.melding = ''; teken(); }
  function meld(zin) { U.melding = zin || ''; teken(); }

  function kop(tekst) { return el('h3', '', tekst); }
  function knop(tekst, klik, klasse) {
    const b = el('button', klasse || '', tekst); b.type = 'button';
    b.addEventListener('click', () => { raak(); Promise.resolve().then(klik).catch((e) => meld(`Er ging iets mis: ${e && e.message ? e.message : 'onbekend'}`)); });
    return b;
  }
  function veld(label, type, id) {
    const w = el('div', 'phVeld'); const l = el('label', '', label); l.htmlFor = id;
    const i = el('input'); i.type = type; i.id = id; i.autocomplete = 'off'; i.spellcheck = false;
    w.append(l, i); return { w, i };
  }

  function statusBlok() {
    const k = el('section', 'phBlok'); k.append(kop('1. Status in een oogopslag'));
    const rijen = d.rijen();
    const kern = d.noodstopKern();
    k.append(el('p', '', kern === null ? 'Noodstop AI-kern: onbekend (de baas meldt het nog niet).' : kern ? 'Noodstop AI-kern: AAN. Er start niets.' : 'Noodstop AI-kern: UIT.'));
    const t = el('table', 'phTabel');
    const kopR = el('tr'); for (const h of ['Telefoon', 'In de hoek', 'Versie', 'Accu', 'Temp.', 'Model']) kopR.append(el('th', '', h)); t.append(kopR);
    if (!rijen.length) { const r = el('tr'); const c = el('td', '', 'Nog geen telefoons gekoppeld.'); c.colSpan = 6; r.append(c); t.append(r); }
    for (const r of rijen) {
      const tr = el('tr');
      for (const x of [r.naam, r.priveSleutel === true ? 'ja' : r.priveSleutel === false ? 'nee' : 'onbekend', r.versie, r.accu, r.temp, r.model]) tr.append(el('td', '', x));
      t.append(tr);
    }
    k.append(t);
    k.append(el('p', 'phKlein', '"In de hoek" = de telefoon heeft een eigen privé-sleutel (zijn privé-kamer, zonder pincode). Alleen zo\'n telefoon krijgt ooit privé-werk. "onbekend" = hij meldt het niet (oude JARVIS, of niet bereikbaar).'));
    const v = d.verbruik();
    k.append(el('h4', '', 'Stroomverbruik van het rek'));
    if (!v.length) k.append(el('p', '', 'Geen meter gekoppeld. Voeg bij Stekkers een stekker toe als meter.'));
    for (const x of v) { const r = el('div', 'phVerbruik'); r.append(el('strong', '', x.naam), el('span', '', ` ${x.tekst}`), el('div', 'phKlein', x.bron)); k.append(r); }
    return k;
  }

  // 536: PRAAT MET DE RIJ. Een vraag gaat (versleuteld met de privé-sleutel van de hoek) via de RELAY naar een vrije rektelefoon die
  // aan de hoek gekoppeld is; nooit via de brievenbus. Het netwerk zit NIET in dit bestand: d.rij (veronica.js, privepost.js) doet het.
  // "Onthoud dat ..." gaat niet naar een telefoon: dat zet deze code zelf onderaan je kern (jij typt het, dus jij schrijft het).
  // 545: fenna.js (in de browser een globale; zonder: de oude weg met alleen het geheugen).
  // 556: "onthoud dat" en "vergeet dat" (het vraagveld en Praat met de rij gebruiken dezelfde code).
  async function onthoudDoe(vraag, gesprek) {
    // 551: "vergeet dat ..." gaat alleen naar het lange geheugen (een grafsteen met een versie); de kern zelf pas je aan in de hoek
    const vg = /^\s*vergeet\s+(dat\s+)?(.{3,300})$/i.exec(vraag);
    if (vg && d.lang) {
      const voor = d.lang.stand ? d.lang.stand().tellingen : null;
      await d.lang.schrijf({ op: 'vergeet', t: d.nu(), tekst: vg[2].trim() });
      const na = d.lang.stand ? d.lang.stand().tellingen : null;
      const weg = voor && na ? voor.feiten - na.feiten : null;
      gesprek.push({ wie: 'hoek', tekst: weg ? `Vergeten: ${weg} ${weg === 1 ? 'regel' : 'regels'} uit Fenna's lange geheugen (met een versienummer, niet stil gewist).` : 'Daar vond ik geen regel over in het lange geheugen. Staat het in je kern, haal het daar weg.' });
      return true;
    }
    const o = P.onthoud(U.store, vraag, 'eigenaar');
    if (o.ok) { P.logToevoegen(U.store, 'Een regel aan de kern toegevoegd ("onthoud dat").', 'eigenaar', d.nu()); await bewaar(); }
    if (o.ok && d.lang) await d.lang.schrijf({ op: 'onthoud', t: d.nu(), tekst: o.regel });   // 547: ook in Fenna's lange geheugen
    gesprek.push(o.ok ? { wie: 'hoek', tekst: `Onthouden: ${o.regel}` } : { wie: 'fout', tekst: o.fout === 'vol' ? 'Je kern is vol; haal er eerst iets uit.' : 'Dat kon ik niet onthouden.' });
    return true;
  }
  function Fn() { return (typeof window !== 'undefined' && window.Fenna) || null; }
  function rijBlok() {
    const Fenna = Fn();
    const k = el('section', 'phBlok'); k.id = 'phRijBlok'; k.append(kop('Praat met de rij'));
    const R = d.rij && typeof d.rij.stand === 'function' ? d.rij : null;
    const st = R ? R.stand() : { klaar: false, reden: 'Deze Veronica kent de weg naar de rij nog niet.' };
    k.append(el('p', st.klaar ? 'phKlein' : 'phEerlijk', st.klaar ? 'Je vraag gaat versleuteld via de relay naar een vrije rektelefoon die aan de hoek gekoppeld is. Het antwoord komt hier terug.' : `Praten met de rij kan nu niet: ${st.reden}`));
    k.append(el('p', 'phKlein', 'Typ "onthoud dat ..." om iets aan je geheugen toe te voegen: dat komt onderaan je kern (hierboven) en gaat voortaan als achtergrond mee. Dat gaat niet naar een telefoon.'));
    const inv = el('textarea'); inv.rows = 2; inv.id = 'phRijVraag'; inv.placeholder = 'Je vraag aan de rij, of "onthoud dat ..."'; inv.setAttribute('aria-label', 'Vraag aan de rij');
    const b = el('button', '', 'Stuur naar de rij'); b.type = 'button'; b.id = 'phRijStuur';
    b.addEventListener('click', async () => {
      const vraag = inv.value.trim();
      if (!vraag) return;
      raak();
      inv.value = '';
      U.rijGesprek.push({ wie: 'jij', tekst: vraag });
      if (P.leesOnthoud(vraag)) { await onthoudDoe(vraag, U.rijGesprek); teken(); return; }
      if (!R || !R.stand().klaar) { U.rijGesprek.push({ wie: 'fout', tekst: `Niet verstuurd: ${R ? R.stand().reden : 'geen weg naar de rij.'}` }); teken(); return; }
      U.rijGesprek.push({ wie: 'model', tekst: 'Even wachten op een rektelefoon...', bezig: true }); teken();
      const g = P.geheugenVoorVraag(U.store, vraag);
      // 545: FENNA. Elke beurt opnieuw opgebouwd: de kaart vooraan, de laatste beurten, de rest als samenvatting, de slotregel als
      // laatste. Via de relay = kanaal 'relay': het blok Stijl gaat dan NIET mee.
      const gr = U.gereedschap && Fenna && Fenna.GEREEDSCHAP[U.gereedschap] ? U.gereedschap : '';
      const eerder = U.rijGesprek.slice(0, -2).filter((z) => (z.wie === 'jij' || z.wie === 'model') && !z.bezig).map((z) => ({ wie: z.wie === 'jij' ? 'jij' : 'fenna', tekst: z.tekst }));
      // 547: het lange geheugen (feiten, samenvattingen, onthoud, stijl) komt van de geheugen-telefoon, of uit de laatste kopie.
      const lang = d.lang ? await d.lang.laad() : null;
      const lv = lang && window.FennaGeheugen ? window.FennaGeheugen.voorFenna(lang) : null;
      const persona = Object.assign({}, U.store.persona, lv ? { feiten: lv.feiten, samenvatting: [U.store.persona && U.store.persona.samenvatting, lv.samenvatting].filter(Boolean).join(' '), stijl: lv.stijl } : {});
      const f = Fenna ? Fenna.bouw({ persona, beurten: eerder, vraag: gr ? `${Fenna.GEREEDSCHAP[gr].opdracht}\n\n${vraag}` : vraag, kanaal: 'relay', geheugen: g.systeem }) : { systeem: g.systeem, vraag };
      const start = d.nu();
      const r = await R.vraag(f.vraag, { systeem: f.systeem });
      U.rijGesprek.pop();
      let vorm = '';
      if (r.ok && gr) { const c = Fenna.controleer(gr, r.antwoord); if (!c.ok) vorm = ` (De vorm klopt niet: ${c.reden}.)`; }
      U.rijGesprek.push(r.ok ? { wie: 'model', tekst: (r.antwoord || '(leeg antwoord)') + vorm, telefoon: r.telefoon } : { wie: 'fout', tekst: r.zin });
      if (r.ok && d.lang && Fenna) {   // 547: de samenvatting van het gesprek van vandaag (door de code, niet door het model)
        const alle = U.rijGesprek.filter((z) => (z.wie === 'jij' || z.wie === 'model') && !z.bezig).map((z) => ({ wie: z.wie === 'jij' ? 'jij' : 'fenna', tekst: z.tekst }));
        const sam = Fenna.samenvatBeurten(alle);
        if (sam) d.lang.schrijf({ op: 'samenvatting', dag: new Date(d.nu()).toISOString().slice(0, 10), tekst: sam }).catch(() => {});
      }
      if (r.ok && typeof d.spreek === 'function' && U.praten) d.spreek(r.antwoord || '', start, r.telefoon);
      else if (r.ok && typeof d.telKlus === 'function') d.telKlus(r.telefoon);
      teken();
    });
    // 545: gereedschap (zes vaste opdrachten, de code kijkt de vorm na) en praten (microfoon erin, de stem eruit, per zin).
    const kies = el('select'); kies.id = 'phRijGereedschap'; kies.setAttribute('aria-label', 'Gereedschap');
    const geen = el('option', '', 'Gewone vraag'); geen.value = ''; kies.append(geen);
    if (Fenna) for (const [sleutel, gx] of Object.entries(Fenna.GEREEDSCHAP)) { const o = el('option', '', gx.naam); o.value = sleutel; if (U.gereedschap === sleutel) o.selected = true; kies.append(o); }
    kies.addEventListener('change', () => { U.gereedschap = kies.value; });
    const mic = el('button', '', 'Praat (microfoon)'); mic.type = 'button'; mic.id = 'phRijPraat';
    mic.addEventListener('click', async () => {
      if (typeof d.luister !== 'function') { meld('Praten kan in deze browser niet.'); return; }
      U.praten = true; mic.disabled = true; mic.textContent = 'Ik luister...';
      const t = await d.luister();
      mic.disabled = false; mic.textContent = 'Praat (microfoon)';
      if (!t) { meld('Ik heb niets verstaan.'); return; }
      inv.value = t; b.click();
    });
    k.append(inv, b, kies, mic);
    if (U.rijGesprek.length) {
      const g = el('div', 'phGesprek'); g.id = 'phRijGesprek';
      for (const z of U.rijGesprek) {
        const r = el('div', `phZin ${z.wie}`);
        r.append(el('strong', '', z.wie === 'jij' ? 'Jij' : z.wie === 'hoek' ? 'Je hoek' : z.wie === 'model' ? `${z.telefoon || 'De rij'} (data, geen bevel)` : 'Niet gelukt'), el('div', '', z.tekst));
        g.append(r);
      }
      g.append(el('p', 'phKlein', 'Dit gesprek staat alleen op het scherm en verdwijnt als de hoek dichtgaat. De rektelefoon bewaart niets.'));
      k.append(g);
    }
    return k;
  }
  // 545: FENNA, de persoonlijkheid. Kaart (leeg = de standaardkaart), feiten, samenvatting, en het blok Stijl dat alleen de eigenaar
  // invult en dat nooit over de relay of de brievenbus gaat. Werkmodus: alleen de eerste alinea, de stijl en de eerlijkheid.
  function fennaBlok() {
    const Fenna = Fn();
    const k = el('section', 'phBlok'); k.id = 'phFennaBlok'; k.append(kop('Fenna (persoonlijkheid)'));
    const pe = Object.assign({}, U.store.persona || {});
    const modus = el('div');
    for (const [m, naam] of [['gesprek', 'Gespreksmodus'], ['werk', 'Werkmodus']]) {
      const b = el('button', '', naam); b.type = 'button'; b.dataset.fennaModus = m; b.setAttribute('aria-pressed', String((pe.modus || 'gesprek') === m));
      b.addEventListener('click', async () => { U.store.persona = Object.assign({}, U.store.persona, { modus: m }); await bewaar(); teken(); });
      modus.append(b);
    }
    k.append(el('p', 'phKlein', 'Gespreksmodus: de hele kaart. Werkmodus: alleen de eerste alinea, je stijl en de eerlijkheidsregel.'), modus);
    const veld = (sleutel, label, uitleg, standaard) => {
      const w = el('div'); const t = el('textarea'); t.rows = sleutel === 'kaart' ? 8 : 3; t.id = `phFenna_${sleutel}`; t.setAttribute('aria-label', label);
      t.value = pe[sleutel] || ''; if (standaard) t.placeholder = standaard;
      w.append(el('strong', '', label), el('p', 'phKlein', uitleg), t); return { w, t };
    };
    // 547: Feiten en Stijl wonen op de geheugen-telefoon; hier staat de laatst gelezen versie.
    const ls = d.lang ? d.lang.stand() : null;
    if (ls) { pe.feiten = ls.geheugen.feiten; pe.stijl = ls.geheugen.stijl; }
    k.append(el('p', 'phKlein', ls ? `${ls.zin}. Feiten, samenvattingen, "onthoud dat" en je stijl staan op de geheugen-telefoon (versleuteld, alleen via je eigen wifi).` : 'Feiten en stijl gaan naar de geheugen-telefoon zodra die er is (versleuteld, alleen via je eigen wifi).'));
    const kaart = veld('kaart', 'Kaart', 'Leeg = de standaardkaart (ongeveer 400 tokens, acht voorbeeldzinnen).', Fenna ? Fenna.KAART : '');
    const feiten = veld('feiten', 'Feiten', 'Wat Fenna als waar mag aannemen.');
    const sam = veld('samenvatting', 'Samenvatting', 'Waar eerdere gesprekken over gingen.');
    const stijl = veld('stijl', 'Stijl (alleen van jou)', 'Gaat NOOIT via de brievenbus of het internet, ook niet via de relay: alleen als Fenna rechtstreeks over je eigen wifi praat.');
    // 556: Fenna bewaart zelf (na elke wijziging); de knop "Bewaar Fenna" is weg.
    const bewaarFenna = async () => {
      // 547: feiten en stijl gaan naar de geheugen-telefoon (eerst in de wachtrij); in de hoek blijft alleen de kaart en de samenvatting.
      if (d.lang) { await d.lang.schrijf({ op: 'feiten', tekst: feiten.t.value.slice(0, 2000) }); await d.lang.schrijf({ op: 'stijl', tekst: stijl.t.value.slice(0, 2000) }); }
      U.store.persona = { kaart: kaart.t.value.slice(0, 3000), feiten: d.lang ? '' : feiten.t.value.slice(0, 2000), samenvatting: sam.t.value.slice(0, 2000), stijl: d.lang ? '' : stijl.t.value.slice(0, 2000), modus: (U.store.persona || {}).modus === 'werk' ? 'werk' : 'gesprek' };
      P.logToevoegen(U.store, 'Fenna bijgewerkt (persoonlijkheid).', 'eigenaar', d.nu()); await bewaar(); meld('Fenna is bewaard. De volgende vraag gebruikt het al.');
    };
    for (const v of [kaart, feiten, sam, stijl]) v.t.addEventListener('change', () => { bewaarFenna().catch(() => {}); });
    k.append(kaart.w, feiten.w, sam.w, stijl.w);
    return k;
  }
  // 557: een andere telefoon of de schakelaar om = meteen proeven (niet pas binnen het uur van tik). Er gaat geen woord van de hoek mee.
  function proefNu() {
    const M = d.model && typeof d.model.proef === 'function' ? d.model : null;
    if (!M) return;
    U.proefT = d.nu();
    Promise.resolve(M.proef()).then((r) => { U.proefModel = r; teken(); }).catch(() => {});
  }
  function chatBlok() {
    const k = el('section', 'phBlok'); k.append(kop('2. Praten met mijn privé-AI'));
    const M = d.model && typeof d.model.stand === 'function' ? d.model : null;
    const st = M ? M.stand() : { klaar: false, reden: 'Geen model geladen.' };
    // 470: de schakelaar en de telefoonkeuze. Standaard uit; alleen een telefoon in de hoek, alleen op het eigen wifi.
    const rij = el('label', 'phSchakel'); const c = el('input'); c.type = 'checkbox'; c.checked = U.store.instellingen.praatLokaal === true; c.id = 'phPraat';
    c.addEventListener('change', async () => { raak(); P.zetPraatLokaal(U.store, c.checked, 'eigenaar'); P.logToevoegen(U.store, c.checked ? 'Schakelaar "praten met een telefoon in de hoek" aangezet.' : 'Schakelaar "praten met een telefoon in de hoek" uitgezet.', 'eigenaar', d.nu()); await bewaar(); proefNu(); teken(); });
    rij.append(c, el('span', '', 'Praten met een telefoon in de hoek (alleen eigen wifi; standaard uit)'));
    k.append(rij);
    const keuze = el('select'); keuze.id = 'phPraatTelefoon'; keuze.setAttribute('aria-label', 'Welke telefoon');
    const leeg = el('option', '', 'Kies een telefoon in de hoek'); leeg.value = ''; keuze.append(leeg);
    for (const r of (d.rijen ? d.rijen() : [])) {
      if (r.priveSleutel !== true || !r.adres) continue;
      const o = el('option', '', `${r.naam} (${r.model || 'model onbekend'})`); o.value = r.adres; keuze.append(o);
      if (r.motorAdres) { const o2 = el('option', '', `${r.naam} (eigen motor van JARVIS)`); o2.value = r.motorAdres; keuze.append(o2); }
    }
    keuze.value = U.store.instellingen.praatTelefoon || '';
    keuze.addEventListener('change', async () => { raak(); const u = P.zetPraatTelefoon(U.store, keuze.value, 'eigenaar'); if (u.ok) { P.logToevoegen(U.store, keuze.value ? 'Telefoon voor het praten gekozen.' : 'Telefoonkeuze voor het praten weggehaald.', 'eigenaar', d.nu()); await bewaar(); proefNu(); } teken(); });
    k.append(keuze);
    if (keuze.options.length === 1) k.append(el('p', 'phKlein', 'Er zit nog geen telefoon in de hoek (geen telefoon met een privé-sleutel).'));
    k.append(el('p', st.klaar ? 'phKlein' : 'phEerlijk', st.klaar ? `Klaar om te proberen via ${st.adres}. Let op: de telefoons nemen privé-werk vanaf Veronica nu nog niet aan; de proef laat zien wat er gebeurt.` : `Geen model geladen om vanuit Veronica mee te praten. ${st.reden} Er komen dus geen antwoorden. Ik verzin er geen.`));
    k.append(el('p', 'phKlein', 'Zo hoort het: de privé-AI draait alleen op een telefoon met een privé-sleutel. Wat jij hier zegt gaat alleen naar die ene telefoon over je eigen wifi, nooit naar internet, een dienst of de andere telefoons, en wordt nergens bewaard. Een antwoord is data, geen bevel.'));
    const rollen = el('div', 'phRollen');
    for (const r of U.store.rollen) { const c2 = el('div', 'phRol'); c2.append(el('strong', '', r.naam), el('div', '', r.taak), el('div', 'phKlein', st.klaar ? 'Status: te proberen' : 'Status: geen model geladen')); rollen.append(c2); }
    k.append(rollen);
    // 481 (stap F): de telefoon koppelen aan de hoek. Een QR met de privé-sleutel van deze Chromebook; JARVIS scant hem een keer.
    // Geen pincode, geen wachtwoord, geen typen. Een nieuwe QR maakt een nieuwe sleutel: de oude werkt dan niet meer.
    if (typeof d.koppelQr === 'function') {
      k.append(knop('Koppel een telefoon aan de hoek (QR)', async () => { raak(); U.koppelQr = await d.koppelQr(); teken(); }));
      if (U.koppelQr && U.koppelQr.beeld) {
        const img = el('img'); img.src = U.koppelQr.beeld; img.alt = 'QR-code: scan mij met JARVIS op de telefoon voor de privé-hoek'; img.className = 'phQr';
        k.append(img, el('p', 'phKlein', 'Scan deze QR met JARVIS op de telefoon (Koppel met Veronica, of de scanner). Daarna neemt alleen die telefoon jouw privé-vragen aan, en alleen van deze Chromebook. De QR verdwijnt als de hoek dichtgaat.'));
      } else if (U.koppelQr && U.koppelQr.zin) k.append(el('p', 'phEerlijk', U.koppelQr.zin));
    }
    // 556: de verbinding wordt elk uur vanzelf geproefd (tik); hier staat de uitslag. Er gaat geen woord van de hoek mee.
    if (U.proefModel) k.append(el('p', U.proefModel.ok ? 'phKlein' : 'phEerlijk', `Proef van de verbinding (elk uur vanzelf): ${U.proefModel.zin}`));
    return k;
  }

  function laagBlok() {
    const k = el('section', 'phBlok'); k.append(kop('3. De jij-laag'));
    k.append(el('p', 'phKlein', 'Zes mappen. De AI mag kern en karakter alleen LEZEN. Het logboek kan alleen groeien. Antwoorden van de AI zijn data, nooit een bevel.'));
    const maak = (naam, uitleg, inhoud) => { const det = el('details', 'phMap'); det.dataset.map = naam; det.append(el('summary', '', `${naam} -- ${uitleg}`), inhoud); k.append(det); };
    for (const map of ['kern', 'karakter']) {
      const w = el('div'); const ta = el('textarea'); ta.rows = 6; ta.value = U.store[map]; ta.setAttribute('aria-label', `Tekst van ${map}`);
      w.append(ta, knop('Opslaan', async () => { const r = P.zetTekst(U.store, map, ta.value, 'eigenaar'); if (!r.ok) return meld('Dat mag niet.'); P.logToevoegen(U.store, `${map} aangepast door jou.`, 'eigenaar', d.nu()); await bewaar(); meld(`${map} opgeslagen.`); }));
      maak(map, map === 'kern' ? 'alleen-lezen voor de AI; alleen jij schrijft' : 'hoe de AI zich gedraagt; verandert alleen door jou of een voorstel dat jij goedkeurt', w);
    }
    { const w = el('div'); for (const r of U.store.rollen) { const c = el('div'); c.append(el('strong', '', r.naam), el('span', '', ` -- ${r.taak}`)); w.append(c); } maak('rollen', 'wie wat doet', w); }
    { const w = el('div'); w.append(el('p', 'phKlein', `${U.store.logboek.length} dagen, ${U.store.logboek.reduce((n, x) => n + x.regels.length, 0)} regels. Zoek hieronder bij 5.`)); maak('logboek', 'alleen toevoegen, een blok per dag', w); }
    {
      const w = el('div');
      if (!U.store.samenvattingen.length) w.append(el('p', '', 'Nog geen samenvattingen.'));
      for (const s of U.store.samenvattingen.slice(-20).reverse()) { const c = el('div'); c.append(el('strong', '', `${s.dag} (${P.HERKOMST_NAAM[s.door]})`), el('div', '', s.tekst)); w.append(c); }
      const ta = el('textarea'); ta.rows = 3; ta.setAttribute('aria-label', 'Nieuwe samenvatting');
      w.append(ta, knop('Samenvatting toevoegen', async () => { const r = P.samenvattingToevoegen(U.store, ta.value, 'eigenaar', d.nu()); if (!r.ok) return meld(P.FOUTZIN.leeg); await bewaar(); meld('Samenvatting toegevoegd.'); }));
      maak('samenvattingen', 'korte stukjes per dag', w);
    }
    { const w = el('div'); w.append(el('p', '', `${P.openVoorstellen(U.store).length} wachten op jou, ${U.store.voorstellen.length} in totaal. Zie hieronder bij 4.`)); maak('voorstellen', 'wat de AI voorstelt', w); }
    return k;
  }

  function voorstelBlok() {
    const k = el('section', 'phBlok'); k.append(kop('4. Voorstellen van de AI'));
    k.append(el('p', 'phKlein', 'De kern en het karakter veranderen NOOIT zonder jouw klik. Goedkeuren of Afkeuren, meer is er niet.'));
    const open = P.openVoorstellen(U.store);
    if (!open.length) k.append(el('p', '', 'Er zijn geen voorstellen die op jou wachten.'));
    for (const v of open) {
      const c = el('div', 'phVoorstel'); c.dataset.id = v.id;
      c.append(el('strong', '', `${v.titel} (${v.soort})`), el('p', '', v.tekst));
      const r = el('div', 'phRij');
      r.append(knop('Goedkeuren', async () => { const x = P.keurVoorstel(U.store, v.id, true, d.nu()); if (x.ok) await bewaar(); meld(x.ok ? 'Goedgekeurd.' : 'Dat ging niet.'); }, 'phJa'),
        knop('Afkeuren', async () => { const x = P.keurVoorstel(U.store, v.id, false, d.nu()); if (x.ok) await bewaar(); meld(x.ok ? 'Afgekeurd.' : 'Dat ging niet.'); }, 'phNee'));
      c.append(r); k.append(c);
    }
    const klaar = U.store.voorstellen.filter((v) => v.status !== null).slice(-10).reverse();
    if (klaar.length) { const det = el('details'); det.append(el('summary', '', 'Eerder besloten')); for (const v of klaar) det.append(el('div', '', `${v.status ? 'Goedgekeurd' : 'Afgekeurd'}: ${v.titel}`)); k.append(det); }
    return k;
  }

  // 523: ZOEKEN OP BETEKENIS. De rekenlaag (d.betekenis, prive-betekenis.js) komt van Veronica; dit blok raakt geen netwerk.
  function betekenisBlok() {
    const k = el('section', 'phBlok'); k.append(kop('Zoek op betekenis in mijn hoek'));
    if (!d.betekenis) { k.append(el('p', 'phKlein', 'Niet beschikbaar in deze versie.')); return k; }
    k.append(el('p', 'phKlein', `Zoekt in je kern, karakter, samenvattingen, logboek en voorstellen naar wat er in betekenis bij past, niet alleen naar dezelfde woorden. Alles op deze Chromebook; er gaat niets naar buiten. Rekent nu met: ${d.betekenis.methode()}.`));
    const vraag = el('input'); vraag.type = 'search'; vraag.id = 'phBetekenis'; vraag.placeholder = 'bijvoorbeeld: wat zei ik over de boot?'; vraag.setAttribute('aria-label', 'Zoek op betekenis');
    const lijst = el('div', 'phLog'); lijst.id = 'phBetekenisLijst';
    const zoek = async () => {
      raak();
      const r = await d.betekenis.zoek(U.store, vraag.value, 10);
      lijst.replaceChildren();
      if (!vraag.value.trim()) return;
      if (!r.resultaten.length) { lijst.append(el('p', '', 'Niets gevonden dat in betekenis dichtbij ligt.')); return; }
      for (const x of r.resultaten) { const c = el('div', 'phLogRegel'); c.append(el('span', 'phLabel', x.soort), el('span', 'phKlein', ` ${x.dag ? `${x.dag} ` : ''}(${Math.round(x.score * 100)}%) `), el('span', '', x.tekst)); lijst.append(c); }
      lijst.append(el('p', 'phKlein', `Gerekend met ${r.methode}.`));
    };
    k.append(vraag, knop('Zoek', zoek), lijst);
    vraag.addEventListener('keydown', (e) => { if (e.key === 'Enter') zoek(); });
    // 523b: het betekenismodel (EmbeddingGemma) ophalen kan alleen met een tik; het halen zelf doet Veronica, niet dit blok.
    const m = d.betekenis.model;
    if (m) {
      const stand = el('p', 'phKlein', m.zin()); stand.id = 'phBetekenisModel';
      const haal = knop('Haal het betekenismodel (een keer)', async () => {
        raak(); haal.disabled = true;
        const tik = setInterval(() => { stand.textContent = m.zin(); }, 1000);
        try { await m.laad(); } finally { clearInterval(tik); stand.textContent = m.zin(); haal.disabled = m.stand() === 'klaar'; }
      });
      haal.id = 'phBetekenisHaal'; haal.disabled = m.stand() === 'klaar';
      k.append(stand, haal);
    }
    return k;
  }
  function logBlok() {
    const k = el('section', 'phBlok'); k.append(kop('5. Logboek inzien en zoeken'));
    const zoek = el('input'); zoek.type = 'search'; zoek.id = 'phZoek'; zoek.value = U.zoek; zoek.placeholder = 'zoek in het logboek'; zoek.setAttribute('aria-label', 'Zoek in het logboek');
    const filter = el('select'); filter.id = 'phFilter'; filter.setAttribute('aria-label', 'Herkomst');
    for (const [w, t] of [['', 'alle herkomst'], ['eigenaar', 'jij'], ['web', 'web'], ['rol', 'rol']]) { const o = el('option', '', t); o.value = w; filter.append(o); }
    filter.value = U.filter;
    const lijst = el('div', 'phLog');
    const ververs = () => {
      U.zoek = zoek.value; U.filter = filter.value;
      const res = P.logZoek(U.store, U.zoek, U.filter || null);
      lijst.replaceChildren();
      if (!res.length) lijst.append(el('p', '', 'Niets gevonden.'));
      for (const r of res.slice(0, 50)) { const c = el('div', `phLogRegel h-${r.herkomst}`); c.append(el('span', 'phLabel', r.label), el('span', 'phKlein', ` ${r.dag} `), el('span', '', r.tekst)); lijst.append(c); }
      if (res.length > 50) lijst.append(el('p', 'phKlein', `Er zijn ${res.length} treffers; de eerste 50 staan hier. Zoek verder om te verkleinen.`));
    };
    zoek.addEventListener('input', () => { raak(); ververs(); }); filter.addEventListener('change', () => { raak(); ververs(); });
    const nieuw = el('textarea'); nieuw.rows = 2; nieuw.setAttribute('aria-label', 'Nieuwe logregel');
    k.append(zoek, filter, lijst, nieuw, knop('Aan het logboek toevoegen', async () => { const r = P.logToevoegen(U.store, nieuw.value, 'eigenaar', d.nu()); if (!r.ok) return meld(P.FOUTZIN.leeg); await bewaar(); meld('Toegevoegd.'); }));
    k.append(el('p', 'phKlein', 'Regels kunnen niet worden aangepast of weggehaald. Dat is de bedoeling.'));
    ververs();
    return k;
  }

  function testBlok() {
    const k = el('section', 'phBlok'); k.append(kop('6. Het karakter testen'));
    k.append(el('p', 'phKlein', 'Vijf vaste vragen. Elke vraag laat zien waar je op let.'));
    const ol = el('ol'); for (const q of P.TESTVRAGEN) { const li = el('li'); li.append(el('div', '', q.vraag), el('div', 'phKlein', `Let op: ${q.let_op}`)); ol.append(li); }
    k.append(ol);
    k.append(knop('Test het karakter', async () => {
      const M = d.model && typeof d.model.stand === 'function' && d.model.stand().klaar ? d.model : null;
      U.test = await P.testKarakter(M ? { vraag: async (q) => { const r = await M.vraag(q); return r.ok ? r.antwoord : ''; } } : null);
      if (U.test.gedraaid) { P.logToevoegen(U.store, `Karaktertest gedraaid: ${U.test.vlaggenTotaal} vlag(gen).`, 'eigenaar', d.nu()); await bewaar(); }
      teken();
    }));
    if (U.test) {
      if (!U.test.gedraaid) k.append(el('p', 'phEerlijk', U.test.reden));
      else for (const r of U.test.resultaten) { const c = el('div', 'phAntwoord'); c.append(el('strong', '', r.vraag), el('p', '', r.antwoord || '(geen antwoord)'), el('div', 'phKlein', r.vlaggen.length ? `Vlag: ${r.vlaggen.join(', ')}` : 'Geen vlag')); k.append(c); }
    }
    return k;
  }

  function backupBlok() {
    const k = el('section', 'phBlok'); k.append(kop('7. Back-up'));
    k.append(el('p', '', P.backupDatumZin(U.store, d.nu())));
    k.append(el('p', 'phKlein', `De back-up is versleuteld (AES-256, sleutel uit jouw wachtwoord). Kies zelf een wachtwoord van minstens ${P.MIN_WACHTWOORD} tekens. Ik bedenk er geen en bewaar het nergens: ben je het kwijt, dan is de back-up niet meer te openen.`));
    const w = veld('Wachtwoord voor de back-up', 'password', 'phBw');
    k.append(w.w, knop('Maak back-up', async () => {
      const r = await P.maakBackup(U.store, w.i.value, d.nu(), d.crypto);
      w.i.value = '';
      if (!r.ok) return meld(P.FOUTZIN[r.fout] || 'Dat lukte niet.');
      d.downloadBestand(`prive-hoek-${P.dagVan(d.nu())}.json`, JSON.stringify(r.bestand));
      U.store.instellingen.laatsteBackup = d.nu(); P.logToevoegen(U.store, 'Back-up gemaakt.', 'eigenaar', d.nu()); await bewaar(); meld('Back-up gemaakt en bewaard als bestand.');
    }));
    k.append(el('h4', '', 'Herstelproef'));
    k.append(el('p', 'phKlein', 'Kies een back-upbestand en typ het wachtwoord. Ik open het en vergelijk het met wat er nu staat. Er wordt niets overschreven.'));
    const bestand = el('input'); bestand.type = 'file'; bestand.accept = '.json,application/json'; bestand.id = 'phBestand'; bestand.setAttribute('aria-label', 'Back-upbestand');
    const w2 = veld('Wachtwoord van die back-up', 'password', 'phBw2');
    k.append(bestand, w2.w, knop('Herstelproef', async () => {
      const f = bestand.files && bestand.files[0];
      if (!f) return meld('Kies eerst een back-upbestand.');
      let ruw = null; try { ruw = JSON.parse(await f.text()); } catch (e) { ruw = null; }
      const r = await P.herstelProef(ruw, w2.i.value, U.store, d.crypto); w2.i.value = '';
      U.proef = r; teken();
    }));
    if (U.proef) {
      if (!U.proef.ok) k.append(el('p', 'phMelding', P.FOUTZIN[U.proef.fout] || 'De proef mislukte.'));
      else {
        const t = U.proef.inBackup;
        k.append(el('p', U.proef.zelfdeInhoud ? 'phGoed' : 'phEerlijk', U.proef.zelfdeInhoud ? 'De back-up opent en is gelijk aan wat er nu staat.' : 'De back-up opent. Hij verschilt van wat er nu staat (nieuwer of ouder).'));
        k.append(el('p', 'phKlein', `In de back-up: ${t.logDagen} logdagen, ${t.logRegels} regels, ${t.samenvattingen} samenvattingen, ${t.voorstellen} voorstellen.`));
      }
    }
    const det = el('details'); det.append(el('summary', '', 'Het bestandsformaat (om naar een nieuw model te verhuizen)'));
    det.append(el('p', 'phKlein', `JSON met: formaat "${P.FORMAAT}", versie ${P.FORMAAT_VERSIE}, kdf (PBKDF2-SHA256, ${P.KDF_ITER} rondes, zout), versleuteling (AES-256-GCM, iv) en data. Na het ontsleutelen staat er gewone JSON in met de mappen kern, karakter, rollen, logboek (per dag), samenvattingen en voorstellen. Dat is gewone tekst: elk model kan hem lezen. Zie docs/prive-hoek.md.`));
    k.append(det);
    return k;
  }

  function privacyBlok() {
    const k = el('section', 'phBlok'); k.append(kop('9. Privacy'));
    for (const z of ['Eigen opslag en eigen logboek in deze browser, los van de gids-AI en de rest van Veronica.', 'Niets uit de privé-hoek gaat naar een server, Drive, ntfy of een andere dienst. Dit scherm doet geen enkele netwerkaanroep.', 'De andere telefoons rekenen NIET mee voor privé-vragen.']) k.append(el('p', '', z));
    const rij = el('label', 'phSchakel'); const c = el('input'); c.type = 'checkbox'; c.checked = U.store.instellingen.deelPrive === true; c.id = 'phDeel';
    c.addEventListener('change', async () => { raak(); P.zetDeelPrive(U.store, c.checked, 'eigenaar'); P.logToevoegen(U.store, c.checked ? 'Wens "andere telefoons rekenen mee" aangezet.' : 'Wens "andere telefoons rekenen mee" uitgezet.', 'eigenaar', d.nu()); await bewaar(); teken(); });
    rij.append(c, el('span', '', ' Andere telefoons laten meerekenen voor privé (standaard uit)'));
    k.append(rij);
    k.append(el('p', 'phEerlijk', 'Let op: dit bewaart alleen jouw wens. Aanzetten doet nu nog NIETS: de telefoons weigeren privé-werk van anderen, en die weg is niet gebouwd. Zodra dat wel kan, zeg ik het hier.'));
    // 476b: geen pincode en geen wachtwoord op deze hoek (besluit van de eigenaar). Wissen kan wel, met een bevestiging.
    k.append(el('p', '', 'Er zit geen pincode op deze hoek: wie aan deze computer mag, mag hier. De inlog van de Chromebook is het slot.'));
    k.append(knop('Wis de hele privé-hoek', async () => {
      if (!(await d.bevestig('De hele privé-hoek wissen? Dit kan niet terug (zonder back-up).'))) return;   // 526: mag een belofte zijn
      U.store = P.nieuweStore(); await d.opslag.schrijf('store', U.store); meld('Alles gewist.');
    }, 'phGevaar'));
    return k;
  }

  // 496: VEILIG BROWSEN. Surfen gebeurt op de zandbak-telefoon (scherm op de Chromebook via scrcpy). Hier staan alleen de favorieten
  // (naam en adres, als TEKST: een link openen op de Chromebook zou de zandbak omzeilen) en de vinkjes. Geen wachtwoorden.
  const VINKJE_ZIN = Object.freeze({
    manager: 'Bitwarden op de zandbak, met een eigen account op het aparte mailadres (wachtwoorden staan daar, niet hier)',
    gastnet: 'De zandbak zit op het gastnetwerk van de router en is het gewone wifi vergeten',
    dns: 'Privé-DNS op de zandbak: security.cloudflare-dns.com of dns.quad9.net (alleen malware, geen volwassenenfilter)',
    scherm: 'scrcpy werkt via de USB-kabel vanuit Linux op de Chromebook',
  });
  function veiligBlok() {
    const k = el('section', 'phBlok'); k.append(kop('10. Veilig browsen'));
    k.append(el('p', '', 'Je surft op de zandbak-telefoon; zijn scherm staat via de kabel op deze Chromebook. Downloads en installaties blijven op die telefoon. De zandbak kies je op Live, bij de tegel van een werker ("Maak zandbak").'));
    k.append(el('p', 'phEerlijk', 'Wachtwoorden bewaar je NIET hier, niet in Veronica en niet in Mijn-AI. Die staan in Bitwarden op de zandbak.'));
    k.append(el('p', 'phKlein', 'Scherm doorsturen, in de Terminal van Linux: scrcpy --no-clipboard-autosync --turn-screen-off --stay-awake'));
    for (const sleutel of P.VEILIG_VINKJES) {
      const rij = el('label', 'phSchakel'); const c = el('input'); c.type = 'checkbox'; c.checked = U.store.veilig[sleutel] === true; c.id = `phVeilig-${sleutel}`;
      c.addEventListener('change', async () => { raak(); P.zetVeiligVinkje(U.store, sleutel, c.checked, 'eigenaar'); await bewaar(); });
      rij.append(c, el('span', '', ` ${VINKJE_ZIN[sleutel]}`));
      k.append(rij, el('br'));
    }
    k.append(el('h4', '', 'Favorieten (naam en adres, alleen op deze Chromebook)'));
    if (!U.store.favorieten.length) k.append(el('p', 'phKlein', 'Nog geen favorieten.'));
    for (const f of U.store.favorieten) {
      const r = el('div', 'phLogRegel');
      r.append(el('span', 'phLabel', `${f.naam}: `), el('span', '', f.adres),
        knop('Weg', async () => { P.favorietWeg(U.store, f.adres, 'eigenaar'); await bewaar(); teken(); }));
      k.append(r);
    }
    const n = veld('Naam', 'text', 'phFavNaam'); const a = veld('Adres', 'text', 'phFavAdres');
    k.append(n.w, a.w, knop('Favoriet bewaren', async () => {
      const uit = P.favorietToevoegen(U.store, n.i.value, a.i.value, 'eigenaar');
      if (!uit.ok) { meld(uit.fout === 'geen-adres' ? 'Dat adres bewaar ik niet: geen geldig adres, of er staan inloggegevens of een sleutel in.' : 'Dat lukte niet.'); return; }
      await bewaar(); meld(`Bewaard: ${uit.adres}`);
    }));
    return k;
  }

  // ===================================================================
  // 556: DE HOEK IN ACHT DINGEN. Een statusregel, EEN vraagveld (Fenna snapt zelf wat je bedoelt), de schakelaar Gesprek/Werk, de drie
  // rollen als statusregels, voorstellen alleen als er een is, en Meer voor de rest (kern, karakter, logboek, zoeken, karakter testen,
  // back-up, herstelproef, wissen). De tweede NOODSTOP, Stop, Sluiten, "Ik heb meegekeken" en "Bewaar Fenna" zijn weg: de NOODSTOP staat
  // EEN keer rechtsboven, de hoek ruimt op als je weggaat, en Fenna bewaart zelf.
  // ===================================================================
  function priveStatus() {
    const rijen = d.rijen ? d.rijen() : [];
    const inHoek = rijen.filter((r) => r.priveSleutel === true).length;
    const M = d.model && typeof d.model.stand === 'function' ? d.model : null;
    const st = M ? M.stand() : { klaar: false };
    const zin = `${d.pantserAan() ? 'Pantser aan' : 'Pantser uit'} · ${inHoek} ${inHoek === 1 ? 'telefoon' : 'telefoons'} in de hoek · ${st.klaar ? 'praten kan, alleen over je eigen wifi' : 'praten kan nog niet: geen telefoon in de hoek klaar'}`;
    const p = el('p', 'phStatus', zin); p.id = 'phStatus';
    return p;
  }
  function vraagBlok() {
    const k = el('section', 'phBlok phVraagBlok');
    const M = d.model && typeof d.model.stand === 'function' ? d.model : null;
    const st = M ? M.stand() : { klaar: false, reden: 'Geen model geladen.' };
    const modus = ((U.store.persona || {}).modus === 'werk') ? 'werk' : 'gesprek';
    const sch = el('button', '', modus === 'werk' ? 'Werk' : 'Gesprek'); sch.type = 'button'; sch.id = 'phModus'; sch.setAttribute('aria-pressed', String(modus === 'werk'));
    sch.title = 'Gesprek: Fenna met haar hele karakter. Werk: kort en zakelijk.';
    sch.addEventListener('click', async () => { raak(); U.store.persona = Object.assign({}, U.store.persona, { modus: modus === 'werk' ? 'gesprek' : 'werk' }); await bewaar(); teken(); });
    const inv = el('textarea'); inv.rows = 2; inv.id = 'phVraag'; inv.placeholder = 'Vraag het Fenna, of zeg "onthoud dat ..."'; inv.setAttribute('aria-label', 'Vraag aan Fenna');
    const b = el('button', '', 'Stuur'); b.type = 'button'; b.id = 'phStuur';
    b.addEventListener('click', async () => {
      const vraag = inv.value.trim();
      if (!vraag) return;
      raak(); inv.value = '';
      U.gesprek.push({ wie: 'jij', tekst: vraag });
      if (P.leesOnthoud(vraag)) { await onthoudDoe(vraag, U.gesprek); teken(); return; }
      // Alleen over het eigen wifi, naar een telefoon in de hoek. Is er geen, dan gaat er NIETS: niet via de relay of de brievenbus.
      if (!M || !M.stand().klaar) { U.gesprek.push({ wie: 'fout', tekst: `Niet verstuurd: praten kan nu alleen met een telefoon in de hoek over je eigen wifi, en die is er nog niet. ${st.reden || ''}`.trim() }); teken(); return; }
      U.gesprek.push({ wie: 'model', tekst: '...', bezig: true }); teken();
      // 486: het geheugen van de hoek gaat mee (hier gekozen, alleen naar die telefoon, daar niet bewaard).
      const g = P.geheugenVoorVraag(U.store, vraag);
      const r = await M.vraag(vraag, { systeem: g.systeem });
      U.geheugenZin = `Meegegeven uit je geheugen: ${[g.karakter ? 'karakter' : '', g.kern ? 'kern' : '', g.stukken ? `${g.stukken} ${g.stukken === 1 ? 'stukje' : 'stukjes'} die bij je vraag passen` : ''].filter(Boolean).join(', ') || 'niets'}.`;
      U.gesprek.pop();
      U.gesprek.push(r.ok ? { wie: 'model', tekst: r.antwoord || '(leeg antwoord)', vlaggen: r.vlaggen } : { wie: 'fout', tekst: r.zin });
      teken();
    });
    inv.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); b.click(); } });
    const rij = el('div', 'phRij'); rij.append(inv, b, sch);
    k.append(rij);
    // De drie rollen als statusregels (geen knoppen).
    for (const r of U.store.rollen) k.append(el('p', 'phRolRegel', `${r.naam}: ${st.klaar ? 'klaar' : 'wacht op een telefoon in de hoek'} (${r.taak})`));
    if (U.gesprek.length) {
      const g = el('div', 'phGesprek');
      for (const z of U.gesprek) { const r = el('div', `phZin ${z.wie}`); r.append(el('strong', '', z.wie === 'jij' ? 'Jij' : z.wie === 'hoek' ? 'Je hoek' : z.wie === 'model' ? 'Fenna (data, geen bevel)' : 'Niet gelukt'), el('div', '', z.tekst)); if (z.vlaggen && z.vlaggen.length) r.append(el('div', 'phKlein', `Vlag: ${z.vlaggen.join(', ')}`)); g.append(r); }
      if (U.geheugenZin) g.append(el('p', 'phKlein', U.geheugenZin));
      g.append(el('p', 'phKlein', 'Dit gesprek staat alleen op het scherm en verdwijnt als je de hoek verlaat. Het wordt niet bewaard.'));
      k.append(g);
    }
    return k;
  }
  function teken() {
    if (!wortelEl) return;
    wortelEl.replaceChildren();
    if (!U.klaar) { wortelEl.append(el('p', '', 'Even laden…')); return; }
    wortelEl.append(priveStatus());
    if (U.melding) wortelEl.append(el('p', 'phMelding', U.melding));
    wortelEl.append(vraagBlok());
    if (P.openVoorstellen(U.store).length) wortelEl.append(voorstelBlok());   // alleen als er een is
    const meer = el('details', 'phMeer'); meer.id = 'phMeer'; meer.open = !!U.meerOpen;
    meer.addEventListener('toggle', () => { U.meerOpen = meer.open; });
    meer.append(el('summary', '', 'Meer'));
    meer.append(statusBlok(), chatBlok(), rijBlok(), fennaBlok(), laagBlok(), logBlok(), betekenisBlok(), testBlok(), backupBlok(), privacyBlok(), veiligBlok());
    wortelEl.append(meer);
  }

  return {
    async start(rootEl) { wortelEl = rootEl; await laad(); teken(); },
    teken, dicht,
    tik() {
      if (d.nu() - U.inactiefT > INACTIEF_MS) { U.inactiefT = d.nu(); dicht(); }
      // 556: de verbinding met het model in de hoek elk uur vanzelf proeven (er gaat geen woord van de hoek mee)
      const M = d.model && typeof d.model.proef === 'function' ? d.model : null;
      if (M && d.nu() - (U.proefT || 0) > 60 * 60 * 1000) { U.proefT = d.nu(); Promise.resolve(M.proef()).then((r) => { U.proefModel = r; teken(); }).catch(() => {}); }
    },
    meer(open) { U.meerOpen = open !== false; teken(); },
    get open() { return U.open; },
    get store() { return U.store; },
    async ontvangVoorstel(voorstel) { const r = P.voorstelToevoegen(U.store, voorstel, d.nu()); if (r.ok) { await bewaar(); teken(); } return r; },
  };
}));
