// ===================================================================
// 501 (18 oktober): DE MOTOR-INSTELLINGEN OP AFSTAND -- byte-gelijk in JARVIS (www/) en Veronica (tools/veronica/)
// ===================================================================
//
// "Wij stellen het in, niet ik": elke telefoon krijgt vanzelf veilige instellingen die bij hem passen, en Veronica kan ze per
// telefoon aanpassen (een roep 'motor-instel', over het wifi of via de brievenbus). Dit bestand is de ENE plek met:
//  - standaard(cap): wat een telefoon krijgt als niemand iets koos (geheugen, Android, dagelijkse telefoon of rek);
//  - schoon(i): alleen geldige waarden, binnen vaste grenzen (een roep met onzin doet niets geks);
//  - zin(i): de instellingen in gewone taal, voor Veronica.
// Wat de motor zelf doet staat in JarvisMotorBeheer (model, CPU/GPU, draden, context, temperatuur); de veiligheidsgrenzen
// (accu, warmte, alleen aan de lader) bewaakt JARVIS bij elke motor-tik. De dagelijkse telefoon houdt daarnaast ALTIJD zijn eigen
// harde regels (495: lader, scherm uit, 80%, 35 graden); een instelling kan die niet versoepelen.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.MotorInstel = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODELLEN = ['auto', 'E2B', 'E4B'];
  const GPU_MIN_RAM_MB = 11000;   // gelijk aan JarvisMotorKern.GPU_MIN_RAM_MB: daaronder nooit GPU en nooit E4B
  const GRENS = { draden: [1, 8], context: [1024, 8192], temp: [0, 1.5], denk: [0, 4096], accuMin: [20, 95], tempMax: [30, 45] };
  const binnen = (x, [min, max], std) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : std);

  // cap: { ramMb, sdk, dagelijks }. De rektelefoons: het gewone model (E2B) op de CPU, ook met veel geheugen (zuinig en koel).
  // De dagelijkse telefoon: het zwaardere model en de GPU alleen als het geheugen het toelaat, en strenge grenzen.
  function standaard(cap) {
    const c = cap || {};
    const ram = Number(c.ramMb) || 0;
    if (c.dagelijks) {
      return { bron: 'standaard', model: ram >= GPU_MIN_RAM_MB ? 'E4B' : 'E2B', gpu: ram >= GPU_MIN_RAM_MB, draden: 4, context: 4096, temp: 0.4, denk: 0,
        accuMin: 80, tempMax: 35, alleenLader: true };
    }
    return { bron: 'standaard', model: 'E2B', gpu: false, draden: 4, context: 4096, temp: 0.4, denk: 0, accuMin: 50, tempMax: 38, alleenLader: false };
  }

  // Een instelling van Veronica (of uit de opslag) -> alleen geldige waarden; wat ontbreekt komt uit de standaard.
  function schoon(i, cap) {
    const s = standaard(cap);
    const x = i && typeof i === 'object' ? i : {};
    const ram = Number((cap || {}).ramMb) || 0;
    let model = MODELLEN.includes(x.model) ? x.model : s.model;
    if (model === 'E4B' && ram && ram < GPU_MIN_RAM_MB) model = 'E2B';   // past niet: geen 4 GB-model op een telefoon van 8 GB
    return {
      bron: x.bron === 'veronica' ? 'veronica' : 'standaard',
      model,
      gpu: typeof x.gpu === 'boolean' ? (x.gpu && (!ram || ram >= GPU_MIN_RAM_MB)) : s.gpu,
      draden: Math.round(binnen(x.draden, GRENS.draden, s.draden)),
      context: Math.round(binnen(x.context, GRENS.context, s.context) / 256) * 256,
      temp: Math.round(binnen(x.temp, GRENS.temp, s.temp) * 100) / 100,
      denk: Math.round(binnen(x.denk, GRENS.denk, s.denk)),
      accuMin: Math.round(binnen(x.accuMin, GRENS.accuMin, s.accuMin)),
      tempMax: Math.round(binnen(x.tempMax, GRENS.tempMax, s.tempMax)),
      alleenLader: typeof x.alleenLader === 'boolean' ? x.alleenLader : s.alleenLader,
    };
  }

  // Waarom de motor nu NIET mag rekenen volgens de grenzen, of null. b = { procent, laadt, temperatuur } (null = onbekend).
  function grensReden(i, b) {
    if (!i || !b) return null;
    if (i.alleenLader && b.laadt === false) return 'niet aan de lader (instelling)';
    if (typeof b.procent === 'number' && b.laadt !== true && b.procent < i.accuMin) return `accu onder ${i.accuMin}% (instelling)`;
    if (typeof b.temperatuur === 'number' && b.temperatuur > i.tempMax) return `warmer dan ${i.tempMax} °C (instelling)`;
    return null;
  }

  // Wat de motor moet weten (JarvisNet.motorZet): alleen dit, zodat een verandering in de grenzen hem niet opnieuw laat laden.
  function voorMotor(i) { return { gpu: !!i.gpu, instel: { model: i.model, draden: i.draden, context: i.context, temp100: Math.round(i.temp * 100) } }; }

  // In gewone taal: "E2B op de CPU · 4 draden · 4096 tokens · temperatuur 0,4 · denken uit · pauze onder 50% accu of boven 38 °C
  // (standaard voor deze telefoon)". toegepast = { draden, temperatuur } van de motor (false = deze motorversie nam het niet aan).
  function zin(i, toegepast) {
    if (!i) return 'Instellingen: nog onbekend.';
    const t = toegepast || {};
    const komma = (x) => String(x).replace('.', ',');
    const delen = [
      `${i.model === 'auto' ? 'model naar geheugen' : i.model} op de ${i.gpu ? 'GPU' : 'CPU'}`,
      `${i.draden} draden${t.draden === false ? ' (niet aangenomen door deze motor)' : ''}`,
      `${i.context} tokens`,
      `temperatuur ${komma(i.temp)}${t.temperatuur === false ? ' (niet aangenomen door deze motor)' : ''}`,
      i.denk ? `denkbudget ${i.denk} (nog niet in deze motor)` : 'denken uit',
      `pauze onder ${i.accuMin}% accu of boven ${i.tempMax} °C${i.alleenLader ? ', alleen aan de lader' : ''}`,
    ];
    return `Instellingen: ${delen.join(' · ')} (${i.bron === 'veronica' ? 'gekozen in Veronica' : 'standaard voor deze telefoon'}).`;
  }

  return { MODELLEN, GRENS, GPU_MIN_RAM_MB, standaard, schoon, grensReden, voorMotor, zin };
}));
