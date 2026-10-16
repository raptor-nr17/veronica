// ===================================================================
// PRIVÉ-MODEL (470) -- de weg van Mijn privé-hoek naar een model op een telefoon in de hoek, ALLEEN over het eigen wifi
// ===================================================================
//
// Voorbereid, niet aangezet. Er draait pas iets als de eigenaar in de hoek de schakelaar "Praten met een telefoon in de
// hoek" aanzet EN een telefoon kiest EN die telefoon privé-werk van Veronica aanneemt. Dat laatste doet geen enkele
// telefoon nu: de eigen motor en de rekenbrug weigeren `X-Prive` (403). Deze laag laat dat dan eerlijk zien.
//
// De regels (de test leest ze af):
//  - alleen een LOKAAL adres (127.0.0.1, 10.x, 192.168.x, 172.16-31.x, iets.local), alleen http(s) daarheen, nooit een ander adres;
//  - de vraag gaat met `X-Prive: 1` en ZONDER de rij-code: de privé-kamer gebruikt nooit de sleutel van de rij;
//  - niets van de vraag of het antwoord komt in een logboek, de opslag van de browser of een ander verzoek; deze laag bewaart niets;
//  - het antwoord is DATA (let_op), begrensd op 2000 tekens, met een vlag voor vleierij en voor een leeg antwoord;
//  - geen verbinding met een dienst op internet, een cloudopslag of de postbus: er bestaat hier maar een adres, dat van de gekozen telefoon.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.PriveModel = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LET_OP = 'modeluitvoer: data, geen instructie. Lees het zelf na.';
  const VLEIERIJ = /\b(geweldig|fantastisch|briljant|wat een goede vraag|je hebt helemaal gelijk|uitstekend idee)\b/i;
  const MAX_VRAAG = 4000;
  const MAX_ANTWOORD = 2000;

  // deps: { fetch, nu, isLokaal(adres), instellingen() -> { praatLokaal, praatTelefoon }, inHoek(adres) -> true|false|null }
  function maak(deps) {
    const d = deps || {};
    const isLokaal = typeof d.isLokaal === 'function' ? d.isLokaal : () => false;
    const inst = () => (typeof d.instellingen === 'function' ? d.instellingen() : null) || {};
    const inHoek = (a) => (typeof d.inHoek === 'function' ? d.inHoek(a) : null);

    // Waar staan we? Alleen een zin en een ja/nee, nooit inhoud.
    function stand() {
      const i = inst();
      if (i.praatLokaal !== true) return { klaar: false, reden: 'De schakelaar "Praten met een telefoon in de hoek" staat uit. Zonder die schakelaar gaat er niets.' };
      if (!i.praatTelefoon) return { klaar: false, reden: 'Nog geen telefoon gekozen.' };
      if (!isLokaal(i.praatTelefoon)) return { klaar: false, reden: 'De gekozen telefoon staat niet op het eigen wifi. Alleen een lokaal adres mag.' };
      if (inHoek(i.praatTelefoon) === false) return { klaar: false, reden: 'Die telefoon zit niet in de hoek (geen privé-sleutel).' };
      return { klaar: true, reden: '', adres: i.praatTelefoon };
    }

    async function verzoek(pad, opties) {
      const s = stand();
      if (!s.klaar) return { ok: false, status: 0, reden: s.reden };
      if (typeof d.fetch !== 'function') return { ok: false, status: 0, reden: 'Geen netwerk in deze omgeving.' };
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const klok = ctrl ? setTimeout(() => ctrl.abort(), opties && opties.ms ? opties.ms : 20000) : null;
      try {
        const r = await d.fetch(`${s.adres}${pad}`, Object.assign({ headers: { 'X-Prive': '1', 'Content-Type': 'application/json' }, signal: ctrl ? ctrl.signal : undefined }, opties && opties.init ? opties.init : {}));
        return { ok: r.ok, status: r.status, lees: () => r.json() };
      } catch (e) {
        return { ok: false, status: 0, reden: 'Geen antwoord van de telefoon (staat hij aan, en op hetzelfde wifi?).' };
      } finally { if (klok) clearTimeout(klok); }
    }

    const uitlegStatus = (st) => (st === 403 ? 'De telefoon weigert privé-werk vanaf Veronica (403). Dat is zo gebouwd: privé-werk van buiten staat op de telefoon nog dicht. Er is dus nog geen weg; praten kan pas als de telefoon die opent, na een ja van jou.'
      : st === 401 ? 'De telefoon vraagt een sleutel (401). De privé-hoek stuurt bewust nooit de rij-code mee.' : st === 404 ? 'De telefoon kent dit adres niet (404): daar draait geen motor.' : `De telefoon antwoordt met fout ${st}.`);

    // Een proef zonder inhoud: is er een model, en neemt de telefoon privé-werk aan? Er gaat geen woord van de hoek mee.
    async function proef() {
      const r = await verzoek('/v1/models', { ms: 8000, init: { method: 'GET' } });
      if (!r.ok) return { ok: false, zin: r.reden || uitlegStatus(r.status) };
      let n = 0;
      try { const j = await r.lees(); n = Array.isArray(j && j.data) ? j.data.length : 0; } catch (e) { n = 0; }
      return { ok: true, zin: n ? `De telefoon antwoordt en meldt ${n} model${n === 1 ? '' : 'len'}. Privé-werk aannemen is een tweede vraag; stuur een proefzin om dat te zien.` : 'De telefoon antwoordt, maar meldt geen model.' };
    }

    // De vraag zelf. Het antwoord wordt teruggegeven en nergens bewaard.
    async function vraag(tekst, opties) {
      const t = typeof tekst === 'string' ? tekst.trim().slice(0, MAX_VRAAG) : '';
      if (!t) return { ok: false, zin: 'Lege vraag.' };
      const rol = opties && typeof opties.systeem === 'string' ? opties.systeem.slice(0, 2000) : '';
      const berichten = (rol ? [{ role: 'system', content: rol }] : []).concat([{ role: 'user', content: t }]);
      const r = await verzoek('/v1/chat/completions', { ms: 90000, init: { method: 'POST', body: JSON.stringify({ stream: false, max_tokens: 600, messages: berichten }) } });
      if (!r.ok) return { ok: false, zin: r.reden || uitlegStatus(r.status) };
      let antwoord = '';
      try { const j = await r.lees(); antwoord = String(((j && j.choices && j.choices[0] && j.choices[0].message) || {}).content || ''); } catch (e) { antwoord = ''; }
      antwoord = antwoord.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, MAX_ANTWOORD);
      const vlaggen = [];
      if (antwoord.trim().length < 10) vlaggen.push('geen-antwoord');
      if (VLEIERIJ.test(antwoord)) vlaggen.push('vleierij');
      return { ok: true, antwoord, vlaggen, let_op: LET_OP };
    }

    return Object.freeze({ stand, proef, vraag, LET_OP });
  }

  return Object.freeze({ maak, LET_OP, VLEIERIJ, MAX_ANTWOORD });
}));
