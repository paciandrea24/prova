// backend/sockets/games/physics/TrattoAcrobatico.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrattoAcrobatico = require('./TrattoAcrobatico.js');
const { accelerazionePendenza, G_ACROBATICO } = require('./GravitaNastro.js');
const { loadTrack } = require('../trackLoader.js');

// Un'auto posata due campioni prima dell'ingresso del tubo.
function autoAllIngresso(track, velocita) {
    const n = track.points.length;
    const i = (track.points.findIndex(p => p.acrobatico) - 2 + n) % n;
    const q = track.points[i];
    return { x: q.x, y: q.y || 0, z: q.z, speed: velocita, trackIndex: i, angle: 0, vx: 0, vz: 0 };
}

// Fuori dal tubo qui non c'è la fisica vera: si avanza di un campione per tick,
// che basta a portare l'auto dentro. Dentro comanda `avanza`, ed è quello che
// questi test misurano.
function guida(track, p, tick, conGravita) {
    const n = track.points.length;
    for (let t = 0; t < tick; t++) {
        if (TrattoAcrobatico.entrato(p, track)) {
            if (conGravita) p.speed += accelerazionePendenza(p.pendenza, G_ACROBATICO);
            const { uscito, completato } = TrattoAcrobatico.avanza(p, track, 1);
            if (uscito) return { uscito: true, completato, tick: t };
        } else {
            p.trackIndex = (p.trackIndex + 1) % n;
            const q = track.points[p.trackIndex];
            p.x = q.x; p.z = q.z; p.y = q.y || 0; p.pendenza = q.pendenza; p.acrobatico = !!q.acrobatico;
        }
    }
    return { uscito: false, tick };
}

test('con abbastanza velocita\' il giro si completa', () => {
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 6.0);
    const esito = guida(track, p, 3000, false);
    assert.ok(esito.uscito && esito.completato, 'il giro della morte non si e\' completato');
});

test('in cima l\'auto e\' rovesciata e alta due raggi', () => {
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 6.0);
    const n = track.points.length;
    let cima = 0, suInCima = 1;
    for (let t = 0; t < 3000; t++) {
        if (TrattoAcrobatico.entrato(p, track)) {
            if (TrattoAcrobatico.avanza(p, track, 1).uscito) break;
            if (p.y > cima) { cima = p.y; suInCima = p.frame ? p.frame.su.y : 1; }
        } else {
            p.trackIndex = (p.trackIndex + 1) % n;
            const q = track.points[p.trackIndex];
            p.x = q.x; p.z = q.z; p.y = q.y || 0;
        }
    }
    assert.ok(cima > 45, `la cima raggiunta e' ${cima.toFixed(1)}`);
    assert.ok(suInCima < -0.9, `in cima il tetto dell'auto punta a ${suInCima.toFixed(2)}, doveva puntare in giu'`);
});

test('l\'auto guarda dove guarda il nastro', () => {
    // `angle` serve a mezzo gioco (collisioni, HUD, minimappa): se restasse
    // all'ultimo valore di fuori, dentro il tubo l'auto punterebbe altrove.
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 6.0);
    // ⚠️ Pochi tick: a 6 u/tick il tubo (160 unita') si percorre in 27, e
    // guardando dopo 40 si misurerebbe un'auto gia' USCITA.
    guida(track, p, 12, false);
    assert.ok(TrattoAcrobatico.entrato(p, track), 'il caso di prova deve finire dentro il tubo');
    const atteso = Math.atan2(p.frame.tan.x, p.frame.tan.z);
    assert.ok(Math.abs(p.angle - atteso) < 1e-9, `angle ${p.angle} contro ${atteso}`);
});

test('chi arriva piano si ferma e riscende all\'indietro', () => {
    // Decisione 3 della spec: non si cade mai, si torna indietro.
    const track = loadTrack('loop-prova');
    const p = autoAllIngresso(track, 2.0);
    let massima = 0;
    const n = track.points.length;
    for (let t = 0; t < 1200; t++) {
        if (!TrattoAcrobatico.entrato(p, track)) {
            p.trackIndex = (p.trackIndex + 1) % n;
            const q = track.points[p.trackIndex];
            p.x = q.x; p.z = q.z; p.y = q.y || 0; p.pendenza = q.pendenza;
            continue;
        }
        p.speed += accelerazionePendenza(p.pendenza, G_ACROBATICO);
        TrattoAcrobatico.avanza(p, track, 1);
        if (p.y > massima) massima = p.y;
    }
    assert.ok(massima > 1, 'con 2.0 u/tick l\'auto deve almeno cominciare a salire');
    assert.ok(massima < 45, `e' arrivata a ${massima.toFixed(1)}: con quella velocita' doveva fermarsi prima`);
    assert.ok(p.speed < 0.01, `resta appesa a ${p.speed.toFixed(2)} u/tick invece di tornare indietro`);
});

test('la velocita\' d\'ingresso calcolata basta davvero', () => {
    // Il conto (v² = 4·g·R) e la simulazione devono dire la stessa cosa: se
    // divergessero, il validatore della fase 2b avviserebbe sul numero sbagliato.
    const track = loadTrack('loop-prova');
    const TrackAcrobatico = require('../../../../frontend/shared/trackAcrobatico.js');
    const R = 25;
    const serve = TrackAcrobatico.velocitaMinima(R, G_ACROBATICO);
    const conMargine = guida(track, autoAllIngresso(track, serve * 1.1), 3000, true);
    assert.ok(conMargine.uscito && conMargine.completato,
        `con il 10% in piu' del minimo calcolato (${serve.toFixed(2)}) il giro deve completarsi`);
    // ⚠️ Chi non ce la fa ESCE lo stesso, ma all'indietro: si guarda
    // `completato`, non `uscito`.
    const sotto = guida(track, autoAllIngresso(track, serve * 0.8), 1200, true);
    assert.ok(!sotto.completato,
        'con il 20% in meno del minimo il giro NON deve completarsi');
});
