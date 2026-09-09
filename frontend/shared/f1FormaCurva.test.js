// frontend/shared/f1FormaCurva.test.js
//
// La racing line ottimizzata entra in curva gia' all'interno e ci resta.
// Questo modulo le rimette la forma che ha una traiettoria vera: largo,
// stretto all'apice, largo.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
// ⚠️ PRIMA di caricare trackLoader: da quando la forma e' cablata li' dentro,
// `loadTrack` restituirebbe la linea GIA' allargata e questi test
// misurerebbero il proprio effetto due volte. Qui serve la linea grezza
// dell'ottimizzatore, che e' cio' su cui il modulo lavora.
process.env.F1_FORMA_CURVA = '0';
const F1FormaCurva = require('./f1FormaCurva.js');
const TrackGeometry = require('./trackGeometry.js');
const { loadTrack } = require(path.join(__dirname, '../../backend/sockets/games/trackLoader.js'));

// Gli offset veri della racing line di `prova`, col segno dell'INTERNO curva
// positivo, misurati in ingresso / apice / uscita di ogni curva.
function profilo(points, offsets) {
    const n = points.length;
    const corners = TrackGeometry.findCorners(points);
    const righe = [];
    for (const c of corners) {
        const len = ((c.endIdx - c.startIdx) % n + n) % n;
        let iApice = c.startIdx, rMin = Infinity;
        for (let k = 0; k <= len; k++) {
            const j = (c.startIdx + k) % n;
            const { radius } = TrackGeometry.curvatureAt(points, j);
            if (radius < rMin) { rMin = radius; iApice = j; }
        }
        const versoInterno = -(c.side || 1);
        righe.push({
            ingresso: offsets[c.startIdx] * versoInterno,
            apice: offsets[iApice] * versoInterno,
            uscita: offsets[c.endIdx] * versoInterno,
            iApice,
        });
    }
    return righe;
}

const media = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test('ampiezza zero non tocca niente', () => {
    const track = loadTrack('prova');
    const off = F1FormaCurva.offsetDellaLinea(track.points, track.racingLine);
    const dopo = F1FormaCurva.allargaIngressoUscita(track.points, off, track.roadHalf, 0);
    for (let i = 0; i < off.length; i++) {
        assert.ok(Math.abs(dopo[i] - off[i]) < 1e-9, `campione ${i} cambiato con ampiezza 0`);
    }
});

// ⚠️ IL TEST CHE DESCRIVE IL DIFETTO (playtest 2026-09-06).
// «Le macchine seguono la racing line che e' sempre e solo interna, e quindi
// anche se si spostano per difendere lo spazio e' tantissimo.» Misurato su
// `prova`: 10 curve su 13 percorse sempre dall'interno, ingresso medio +4.84
// e uscita +4.16 col segno dell'interno positivo — una traiettoria vera
// entrerebbe ed uscirebbe NEGATIVA, cioe' dall'esterno.
test('dopo la forma si entra e si esce dall\'esterno', () => {
    const track = loadTrack('prova');
    const off = F1FormaCurva.offsetDellaLinea(track.points, track.racingLine);
    const prima = profilo(track.points, off);
    assert.ok(media(prima.map(r => r.ingresso)) > 2,
        'la linea di partenza non e\' quella «sempre interna» che il test descrive');

    const dopo = profilo(track.points,
        F1FormaCurva.allargaIngressoUscita(track.points, off, track.roadHalf, 0.7));
    assert.ok(media(dopo.map(r => r.ingresso)) < 0,
        `ingresso medio ancora interno: ${media(dopo.map(r => r.ingresso)).toFixed(2)}`);
    assert.ok(media(dopo.map(r => r.uscita)) < 0,
        `uscita media ancora interna: ${media(dopo.map(r => r.uscita)).toFixed(2)}`);
});

test('l\'apice resta dov\'era: e\' il punto che la linea ottimizzata azzecca', () => {
    const track = loadTrack('prova');
    const off = F1FormaCurva.offsetDellaLinea(track.points, track.racingLine);
    const prima = profilo(track.points, off);
    const dopo = profilo(track.points,
        F1FormaCurva.allargaIngressoUscita(track.points, off, track.roadHalf, 0.7));
    for (let k = 0; k < prima.length; k++) {
        assert.ok(Math.abs(dopo[k].apice - prima[k].apice) < 0.6,
            `curva ${k + 1}: apice spostato da ${prima[k].apice.toFixed(2)} a ` +
            `${dopo[k].apice.toFixed(2)} — la forma deve allargare gli estremi, non l'apice`);
    }
});

test('la linea allargata resta dentro la carreggiata', () => {
    const track = loadTrack('prova');
    const off = F1FormaCurva.offsetDellaLinea(track.points, track.racingLine);
    for (const ampiezza of [0.3, 0.7, 1.0]) {
        const dopo = F1FormaCurva.allargaIngressoUscita(track.points, off, track.roadHalf, ampiezza);
        const peggiore = Math.max.apply(null, dopo.map(Math.abs));
        assert.ok(peggiore <= track.roadHalf + 1e-9,
            `ampiezza ${ampiezza}: la linea arriva a ${peggiore.toFixed(2)} su una ` +
            `mezza carreggiata di ${track.roadHalf}`);
    }
});

test('non si creano scalini: la linea resta continua', () => {
    // ⚠️ Un offset che salta fa sterzate a scatto e manda i bot fuori. Il
    // passo fra due campioni non deve crescere piu' di quanto gia' faccia la
    // linea ottimizzata, se non di poco.
    const track = loadTrack('prova');
    const off = F1FormaCurva.offsetDellaLinea(track.points, track.racingLine);
    const n = off.length;
    const saltoMax = (a) => {
        let m = 0;
        for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[(i + 1) % n] - a[i]));
        return m;
    };
    const dopo = F1FormaCurva.allargaIngressoUscita(track.points, off, track.roadHalf, 0.7);
    assert.ok(saltoMax(dopo) < saltoMax(off) * 2 + 0.2,
        `salto massimo fra campioni ${saltoMax(dopo).toFixed(3)} contro ` +
        `${saltoMax(off).toFixed(3)} della linea originale`);
});
