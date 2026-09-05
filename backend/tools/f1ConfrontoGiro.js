// backend/tools/f1ConfrontoGiro.js
//
// Dove un bot perde tempo rispetto a una persona, lungo il giro.
//
// ⚠️ I DUE GIRI SI ALLINEANO PER POSIZIONE SUL TRACCIATO, NON PER TEMPO: per
// ogni indice campionato si sa quando ciascuno dei due c'e' arrivato, e la
// differenza fra le due curve dice dove nasce il divario. Allinearli per tempo
// confronterebbe punti diversi della pista.
//
// Il giro umano lo registra `f1Telemetria.js` (F1_TELEMETRIA=1 sul server);
// quello del bot lo produce `f1LapSimulator.js`. Le due telemetrie hanno la
// stessa base tempo — il tick di fisica — e la stessa conversione di velocita'.
//
// Uso:
//   node backend/tools/f1ConfrontoGiro.js <file-telemetria.json> [pista] [tratti]
//   node backend/tools/f1ConfrontoGiro.js <file> prova --zoom=440,510
//
// La prima forma da' la mappa del giro tratto per tratto; la seconda entra in
// un tratto e mostra il profilo di velocita' campione per campione — serve a
// distinguere «il bot frena prima» da «il bot esce piu' piano», che il tempo
// totale confonde.
const fs = require('fs');
const path = require('path');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');
const { simulateLap } = require('./f1LapSimulator.js');

const OPTS_QUALIFICA = { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 90 };

// Il tempo a cui un giro raggiunge ogni indice del tracciato. Si tiene il
// PRIMO passaggio e si riempiono i buchi: a 300 km/h un tick salta piu'
// campioni, e senza riempirli i tratti risulterebbero vuoti a caso.
function tempiPerIndice(campioni, n, indiceDi, tempoDi) {
    const t = new Array(n).fill(null);
    for (const c of campioni) {
        const i = ((indiceDi(c) % n) + n) % n;
        if (t[i] === null) t[i] = tempoDi(c);
    }
    let ultimo = -1;
    for (let i = 0; i < n; i++) {
        if (t[i] === null) continue;
        if (ultimo >= 0 && i - ultimo > 1) {
            const passo = (t[i] - t[ultimo]) / (i - ultimo);
            for (let k = ultimo + 1; k < i; k++) t[k] = t[ultimo] + passo * (k - ultimo);
        }
        ultimo = i;
    }
    return t;
}

function valorePerIndice(campioni, n, indiceDi, prendi) {
    const v = new Array(n).fill(null);
    for (const c of campioni) {
        const i = ((indiceDi(c) % n) + n) % n;
        if (v[i] === null) v[i] = prendi(c);
    }
    return v;
}

// Distanza dall'asse pista col segno del lato: dice CHE traiettoria ha tenuto
// ciascuno dei due, non solo quanto ci ha messo.
function scostamenti(campioni, pts, n, indiceDi, xDi, zDi) {
    const d = new Array(n).fill(null);
    for (const c of campioni) {
        const i = ((indiceDi(c) % n) + n) % n;
        if (d[i] !== null) continue;
        const q = TrackGeometry.nearestPoint(pts, xDi(c), zDi(c));
        const nrm = TrackGeometry.normalAt(pts, q.index, true);
        const segno = Math.sign((xDi(c) - pts[q.index].x) * nrm.nx +
                                (zDi(c) - pts[q.index].z) * nrm.nz) || 1;
        d[i] = q.dist * segno;
    }
    return d;
}

// Il raggio di curvatura locale, per riconoscere dove sta la curva.
function raggioIn(pts, i) {
    const n = pts.length;
    const a = pts[(i - 6 + n) % n], b = pts[i], c = pts[(i + 6) % n];
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    if (area < 1e-6) return Infinity;
    return (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) *
            Math.hypot(c.x - a.x, c.z - a.z)) / (4 * area);
}

function confronta(fileUmano, trackId, opzioni) {
    const o = opzioni || {};
    const umano = JSON.parse(fs.readFileSync(fileUmano, 'utf8'));
    const track = loadTrack(trackId || umano.pista);
    const pts = track.points;
    const n = pts.length;
    const bot = simulateLap(track, OPTS_QUALIFICA);

    const tU = tempiPerIndice(umano.campioni, n, c => c.i, c => c.t);
    const tB = tempiPerIndice(bot.telemetry, n, c => c.idx, c => c.tick * 50);
    const vU = valorePerIndice(umano.campioni, n, c => c.i, c => Math.abs(c.v) * 55);
    const vB = valorePerIndice(bot.telemetry, n, c => c.idx, c => c.speedKmh);
    const gasU = valorePerIndice(umano.campioni, n, c => c.i, c => c.gas);
    const frenoU = valorePerIndice(umano.campioni, n, c => c.i, c => c.freno);
    const dB = valorePerIndice(bot.telemetry, n, c => c.idx, c => c.distanceFromRacingLine);
    const sU = scostamenti(umano.campioni, pts, n, c => c.i, c => c.x, c => c.z);
    const sB = scostamenti(bot.telemetry, pts, n, c => c.idx, c => c.x, c => c.z);

    if (o.zoom) {
        const [da, a] = o.zoom;
        console.log('indici ' + da + '..' + a + ' su ' + track.id);
        console.log('idx'.padStart(5) + 'raggio'.padStart(8) + 'v.uomo'.padStart(8) + 'v.bot'.padStart(7) +
                    'delta'.padStart(7) + '  uomo(gas/freno)  scarto bot dalla sua linea');
        for (let i = da; i <= a; i += 2) {
            if (vU[i] === null || vB[i] === null) continue;
            const r = raggioIn(pts, i);
            console.log(String(i).padStart(5) + (r > 9999 ? '  dritto' : r.toFixed(0).padStart(8)) +
                        vU[i].toFixed(0).padStart(8) + vB[i].toFixed(0).padStart(7) +
                        ((vB[i] - vU[i] >= 0 ? '+' : '') + (vB[i] - vU[i]).toFixed(0)).padStart(7) +
                        '        ' + (gasU[i] !== null ? gasU[i].toFixed(1) : ' - ') +
                        ' / ' + (frenoU[i] !== null ? frenoU[i].toFixed(1) : ' - ') +
                        '        ' + (dB[i] != null ? dB[i].toFixed(1) : '-'));
        }
        return;
    }

    const tratti = o.tratti || 20;
    const durataUmano = tU[n - 1] - tU[0];
    console.log('giro umano  ' + (durataUmano / 1000).toFixed(2) + ' s   (' + path.basename(fileUmano) + ')');
    console.log('giro bot    ' + (bot.timeMs / 1000).toFixed(2) + ' s');
    console.log('divario     ' + ((bot.timeMs - durataUmano) / 1000).toFixed(2) + ' s');
    console.log('');
    console.log('tratto'.padEnd(9) + '% giro'.padStart(8) + 'perde'.padStart(9) +
                'v.uomo'.padStart(9) + 'v.bot'.padStart(8) + '   traiettoria (dall\'asse, + a destra)');
    const passo = Math.floor(n / tratti);
    const righe = [];
    for (let s = 0; s < tratti; s++) {
        const da = s * passo, a = Math.min(n - 1, (s + 1) * passo);
        if (tU[da] === null || tU[a] === null || tB[da] === null || tB[a] === null) continue;
        const media = (arr) => {
            const v = [];
            for (let i = da; i <= a; i++) if (arr[i] !== null) v.push(arr[i]);
            return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
        };
        righe.push({ da, a, perde: (tB[a] - tB[da]) - (tU[a] - tU[da]),
                     vU: media(vU), vB: media(vB), sU: media(sU), sB: media(sB) });
    }
    for (const r of righe) {
        const barra = r.perde > 0 ? '#'.repeat(Math.min(20, Math.round(r.perde / 25))) : '';
        console.log((r.da + '-' + r.a).padEnd(9) + ((100 * r.da / n).toFixed(0) + '%').padStart(8) +
                    ((r.perde >= 0 ? '+' : '') + r.perde.toFixed(0) + 'ms').padStart(9) +
                    r.vU.toFixed(0).padStart(9) + r.vB.toFixed(0).padStart(8) +
                    '   uomo ' + r.sU.toFixed(1).padStart(6) + '  bot ' + r.sB.toFixed(1).padStart(6) + '  ' + barra);
    }
    const peggiori = righe.slice().sort((x, y) => y.perde - x.perde).slice(0, 5);
    console.log('');
    console.log('i cinque tratti peggiori: ' +
        peggiori.map(r => (100 * r.da / n).toFixed(0) + '% (+' + r.perde.toFixed(0) + 'ms)').join(', '));
    console.log('perde in tutto ' + righe.filter(r => r.perde > 0).reduce((s, r) => s + r.perde, 0).toFixed(0) +
                ' ms, di cui ' + peggiori.reduce((s, r) => s + r.perde, 0).toFixed(0) + ' nei cinque peggiori');
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const file = args[0];
    if (!file) {
        console.error('Uso: node backend/tools/f1ConfrontoGiro.js <file-telemetria.json> [pista] [--zoom=da,a] [--tratti=N]');
        process.exitCode = 1;
    } else {
        const pista = args[1] && !args[1].startsWith('--') ? args[1] : null;
        const zoomArg = args.find(a => a.startsWith('--zoom='));
        const trattiArg = args.find(a => a.startsWith('--tratti='));
        confronta(file, pista, {
            zoom: zoomArg ? zoomArg.slice(7).split(',').map(Number) : null,
            tratti: trattiArg ? Number(trattiArg.slice(9)) : 20,
        });
    }
}

module.exports = { confronta };
