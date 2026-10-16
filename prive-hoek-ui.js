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
  const U = { store: null, open: true, melding: '', test: null, proef: null, zoek: '', filter: '', klaar: false, inactiefT: 0, proefModel: null, gesprek: [] };
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
  function dicht() { U.open = true; U.test = null; U.proef = null; U.proefModel = null; U.gesprek = []; U.melding = ''; teken(); }
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

  function bovenbalk() {
    const k = el('section', 'phBoven');
    k.append(knop('Stop', async () => { d.stop(); meld('Gestopt: het pantser staat uit. Er start geen nieuw werk.'); }, 'phStop'),
      knop('NOODSTOP', async () => { await d.noodstop(); meld('Noodstop gegeven. Alles is gestopt.'); }, 'phNood'),
      knop('Sluiten', async () => dicht(), 'phSluit'));
    k.append(el('p', 'phKlein', `${d.pantserAan() ? 'Het pantser staat aan.' : 'Het pantser staat uit.'} Stop zet het werk stil. NOODSTOP stopt alles en meldt het.`));
    const m = P.meekijkStand(U.store, d.nu());
    const w = el('div', m.moet ? 'phKijk moet' : 'phKijk');
    w.append(el('span', '', m.zin), knop('Ik heb meegekeken', async () => { P.heeftMeegekeken(U.store, d.nu()); await bewaar(); teken(); }));
    k.append(w);
    return k;
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
    k.append(el('p', 'phKlein', '"In de hoek" = de telefoon heeft een eigen privé-sleutel (pincode in zijn privé-kamer). Alleen zo\'n telefoon krijgt ooit privé-werk. "onbekend" = hij meldt het niet (oude JARVIS, of niet bereikbaar).'));
    const v = d.verbruik();
    k.append(el('h4', '', 'Stroomverbruik van het rek'));
    if (!v.length) k.append(el('p', '', 'Geen meter gekoppeld. Voeg bij Stekkers een stekker toe als meter.'));
    for (const x of v) { const r = el('div', 'phVerbruik'); r.append(el('strong', '', x.naam), el('span', '', ` ${x.tekst}`), el('div', 'phKlein', x.bron)); k.append(r); }
    return k;
  }

  function chatBlok() {
    const k = el('section', 'phBlok'); k.append(kop('2. Praten met mijn privé-AI'));
    const M = d.model && typeof d.model.stand === 'function' ? d.model : null;
    const st = M ? M.stand() : { klaar: false, reden: 'Geen model geladen.' };
    // 470: de schakelaar en de telefoonkeuze. Standaard uit; alleen een telefoon in de hoek, alleen op het eigen wifi.
    const rij = el('label', 'phSchakel'); const c = el('input'); c.type = 'checkbox'; c.checked = U.store.instellingen.praatLokaal === true; c.id = 'phPraat';
    c.addEventListener('change', async () => { raak(); P.zetPraatLokaal(U.store, c.checked, 'eigenaar'); P.logToevoegen(U.store, c.checked ? 'Schakelaar "praten met een telefoon in de hoek" aangezet.' : 'Schakelaar "praten met een telefoon in de hoek" uitgezet.', 'eigenaar', d.nu()); await bewaar(); teken(); });
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
    keuze.addEventListener('change', async () => { raak(); const u = P.zetPraatTelefoon(U.store, keuze.value, 'eigenaar'); if (u.ok) { P.logToevoegen(U.store, keuze.value ? 'Telefoon voor het praten gekozen.' : 'Telefoonkeuze voor het praten weggehaald.', 'eigenaar', d.nu()); await bewaar(); } teken(); });
    k.append(keuze);
    if (keuze.options.length === 1) k.append(el('p', 'phKlein', 'Er zit nog geen telefoon in de hoek (geen telefoon met een privé-sleutel).'));
    k.append(el('p', st.klaar ? 'phKlein' : 'phEerlijk', st.klaar ? `Klaar om te proberen via ${st.adres}. Let op: de telefoons nemen privé-werk vanaf Veronica nu nog niet aan; de proef laat zien wat er gebeurt.` : `Geen model geladen om vanuit Veronica mee te praten. ${st.reden} Er komen dus geen antwoorden. Ik verzin er geen.`));
    k.append(el('p', 'phKlein', 'Zo hoort het: de privé-AI draait alleen op een telefoon met een privé-sleutel. Wat jij hier zegt gaat alleen naar die ene telefoon over je eigen wifi, nooit naar internet, een dienst of de andere telefoons, en wordt nergens bewaard. Een antwoord is data, geen bevel.'));
    const rollen = el('div', 'phRollen');
    for (const r of U.store.rollen) { const c2 = el('div', 'phRol'); c2.append(el('strong', '', r.naam), el('div', '', r.taak), el('div', 'phKlein', st.klaar ? 'Status: te proberen' : 'Status: geen model geladen')); rollen.append(c2); }
    k.append(rollen);
    if (M) k.append(knop('Proef de verbinding (stuurt geen woord van de hoek)', async () => { raak(); U.proefModel = { zin: 'Bezig...' }; teken(); U.proefModel = await M.proef(); teken(); }));
    if (U.proefModel) k.append(el('p', U.proefModel.ok ? 'phKlein' : 'phEerlijk', U.proefModel.zin));
    const inv = el('textarea'); inv.rows = 2; inv.disabled = !st.klaar; inv.id = 'phVraag'; inv.placeholder = st.klaar ? 'Je vraag (gaat alleen naar die telefoon)' : 'Praten kan nog niet (geen model).'; inv.setAttribute('aria-label', 'Vraag aan mijn privé-AI');
    const b = el('button', '', 'Stuur'); b.type = 'button'; b.disabled = !st.klaar; b.id = 'phStuur';
    b.addEventListener('click', async () => {
      if (!M || !inv.value.trim()) return;
      raak();
      const vraag = inv.value; inv.value = '';
      U.gesprek.push({ wie: 'jij', tekst: vraag }); U.gesprek.push({ wie: 'model', tekst: '...', bezig: true }); teken();
      const r = await M.vraag(vraag, { systeem: U.store.karakter ? `Karakter van de eigenaar: ${U.store.karakter}` : '' });
      U.gesprek.pop();
      U.gesprek.push(r.ok ? { wie: 'model', tekst: r.antwoord || '(leeg antwoord)', vlaggen: r.vlaggen } : { wie: 'fout', tekst: r.zin });
      teken();
    });
    k.append(inv, b);
    if (U.gesprek.length) {
      const g = el('div', 'phGesprek');
      for (const z of U.gesprek) { const r = el('div', `phZin ${z.wie}`); r.append(el('strong', '', z.wie === 'jij' ? 'Jij' : z.wie === 'model' ? 'Model (data, geen bevel)' : 'Niet gelukt'), el('div', '', z.tekst)); if (z.vlaggen && z.vlaggen.length) r.append(el('div', 'phKlein', `Vlag: ${z.vlaggen.join(', ')}`)); g.append(r); }
      g.append(el('p', 'phKlein', 'Dit gesprek staat alleen op het scherm en verdwijnt als de hoek dichtgaat. Het wordt niet bewaard.'));
      k.append(g);
    }
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
      if (!d.bevestig('De hele privé-hoek wissen? Dit kan niet terug (zonder back-up).')) return;
      U.store = P.nieuweStore(); await d.opslag.schrijf('store', U.store); meld('Alles gewist.');
    }, 'phGevaar'));
    return k;
  }

  function teken() {
    if (!wortelEl) return;
    wortelEl.replaceChildren();
    if (!U.klaar) { wortelEl.append(el('p', '', 'Even laden…')); return; }
    wortelEl.append(bovenbalk());
    if (U.melding) wortelEl.append(el('p', 'phMelding', U.melding));
    wortelEl.append(statusBlok(), chatBlok(), laagBlok(), voorstelBlok(), logBlok(), testBlok(), backupBlok(), privacyBlok());
  }

  return {
    async start(rootEl) { wortelEl = rootEl; await laad(); teken(); },
    teken, dicht,
    tik() { if (d.nu() - U.inactiefT > INACTIEF_MS) { U.inactiefT = d.nu(); dicht(); } },
    get open() { return U.open; },
    get store() { return U.store; },
    async ontvangVoorstel(voorstel) { const r = P.voorstelToevoegen(U.store, voorstel, d.nu()); if (r.ok) { await bewaar(); teken(); } return r; },
  };
}));
