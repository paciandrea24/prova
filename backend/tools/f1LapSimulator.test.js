// backend/tools/f1LapSimulator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTrack, listTracks } = require('../sockets/games/trackLoader.js');
const { simulateLap, slowestPoints } = require('./f1LapSimulator.js');

const DEFAULT_OPTS = { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 60 };

// Da quando esiste la gravità lungo il nastro (fase 1a), una pista può avere
// una salita che NESSUNA auto sale: sopra un certo angolo la gravità supera
// tutta l'accelerazione del motore, la macchina si ferma e riscende. Pretendere
// che il bot chiuda comunque il giro sarebbe pretendere l'impossibile.
//
// Il limite non è un elenco di piste da saltare — quello divergerebbe al primo
// tracciato nuovo — ma la soglia fisica calcolata da GravitaNastro: se domani
// G_NASTRO cambia, le piste rientrano o escono da sole. Oggi lascia fuori solo
// `test`, che ha pendenze dell'89% (una parete) ed è un tracciato di prova.
const { pistaPercorribile } = require('../sockets/games/physics/GravitaNastro.js');

// Quanto puo' durare al massimo un giro prima di dire "qui e' bloccata".
// NON un numero di secondi uguale per tutte: i tracciati vanno da 1177 a 7485
// unita', un fattore sei, e un tetto fisso a 60s bocciava shanghai (84s veri)
// e suzuka (62s veri) senza che avessero niente che non va — mentre su
// monte-rosso, che il giro lo chiude in 13s, lasciava passare qualunque
// disastro. Il tetto e' la lunghezza del giro divisa per una velocita' media
// che nessuna auto sana scende sotto: il giro piu' lento misurato viaggia a
// 66 unita' al secondo, quindi 40 e' gia' meta' del peggiore.
// Stessa regola delle altre soglie geometriche del progetto: si esprimono per
// unita' di pista, mai in valori assoluti che valgono per una pista sola.
const VELOCITA_MINIMA_PLAUSIBILE = 40;   // unita'/s

function tettoDiSicurezzaS(track) {
    let giro = 0;
    for (let i = 0; i < track.points.length; i++) {
        const a = track.points[i], b = track.points[(i + 1) % track.points.length];
        giro += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return Math.max(30, giro / VELOCITA_MINIMA_PLAUSIBILE);
}

for (const { id } of listTracks()) {
    test(`simulateLap: ${id} completa il giro entro il tetto di sicurezza (tuning di default)`, (t) => {
        const track = loadTrack(id);
        if (!pistaPercorribile(track.points)) {
            t.skip(`${id}: ha una salita che nessuna auto sale, con la gravità lungo il nastro attiva`);
            return;
        }
        const safetyCapS = tettoDiSicurezzaS(track);
        const result = simulateLap(track, { ...DEFAULT_OPTS, safetyCapS });
        assert.ok(result.finished, `${id}: giro non completato entro ${safetyCapS.toFixed(0)}s simulati`);
        assert.ok(result.timeMs > 0, `${id}: tempo non valido (${result.timeMs})`);
        assert.ok(result.telemetry.length > 0, `${id}: telemetria vuota`);
    });
}

test('simulateLap: un preset di tuning passato in opts.tuning arriva davvero alla guida', () => {
    // ⚠️ DUE cose sbagliate, entrambe invisibili finche' il test moriva prima
    // di arrivare in fondo.
    //
    // 1. La pista era scritta a mano: "monza", rifatta nel frattempo col nome
    //    "new-monza". Da allora il test moriva di ENOENT invece di provare quel
    //    che dice il titolo. Le piste le crea e le rinomina l'utente: un test
    //    sul comportamento del simulatore non deve dipendere dai nomi di oggi.
    //
    // 2. Il preset va provato dove si SENTE. Sulle piste che hanno un file
    //    -raceline.json comanda `track.racingLineTuning` e opts.tuning non
    //    cambia un millisecondo: misurato 0.00% su prova e su monte-rosso,
    //    contro il 17.8% di banking-prova, che la racing line non ce l'ha. Un
    //    test che fosse finito su prova sarebbe passato senza provare niente.
    //
    // E si misura un preset TIMIDO (margini stretti => giro piu' lento), non
    // uno spavaldo: fra il default e i margini al massimo ci sono 50 ms su
    // 21400, lo 0.23%, cioe' il rumore del banco. Il preset timido costa il
    // 17.8%, che non e' rumore.
    const id = listTracks().map(t => t.id).find(t => {
        const track = loadTrack(t);
        return pistaPercorribile(track.points) && !track.racingLine;
    });
    assert.ok(id, 'nessuna pista percorribile senza racing line su cui provare il preset');
    const track = loadTrack(id);
    const opts = { ...DEFAULT_OPTS, safetyCapS: tettoDiSicurezzaS(track) };
    const base = simulateLap(track, opts);
    const timido = simulateLap(track, {
        ...opts,
        tuning: { cornerSpeedMargin: 0.5, apexMaxFraction: 0.3, brakingDistanceMargin: 2.0 }
    });
    assert.ok(base.finished && timido.finished, 'entrambe le simulazioni devono completare il giro');
    assert.ok(timido.timeMs > base.timeMs * 1.05,
        `${id}: un preset timido deve costare almeno il 5% (default ${base.timeMs}ms, timido ${timido.timeMs}ms)`);
});

test('slowestPoints: ritorna al massimo `count` voci, ordinate dalla più lenta', () => {
    const telemetry = [
        { idx: 0, speedKmh: 300 }, { idx: 200, speedKmh: 50 }, { idx: 400, speedKmh: 80 }
    ];
    const track = { points: { length: 1000 } };
    const result = slowestPoints(telemetry, track, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].speedKmh, '50.0');
    assert.equal(result[1].speedKmh, '80.0');
});

const { parseArgs } = require('./f1LapSimulator.js');

test('parseArgs: valori di default quando non si passa nulla', () => {
    const args = parseArgs([]);
    assert.equal(args.trackId, null);
    assert.equal(args.allTracks, false);
    assert.equal(args.preset, 'default');
    assert.equal(args.speedFactor, 1);
    assert.equal(args.safetyCapS, 60);
});

test('parseArgs: trackId posizionale + flag --all-tracks/--preset/--speed-factor', () => {
    const args = parseArgs(['monza', '--all-tracks', '--preset=zero-margin', '--speed-factor=0.9']);
    assert.equal(args.trackId, 'monza');
    assert.equal(args.allTracks, true);
    assert.equal(args.preset, 'zero-margin');
    assert.equal(args.speedFactor, 0.9);
});

// Il banco deve poter pesare l'auto, altrimenti il peso del carburante non e'
// misurabile: simulateLap gira in modalita' qualifica, e li' il tick di gara
// non arriva mai a riempire il serbatoio.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
test('parseArgs: --fuel finisce in opts.fuelFactor', () => {
    const args = parseArgs(['--fuel=1.08']);
    assert.equal(args.fuelFactor, 1.08);
});

test('parseArgs: senza --fuel il campo resta assente (auto scarica)', () => {
    const args = parseArgs([]);
    assert.ok(args.fuelFactor === undefined || args.fuelFactor === 1,
        `atteso assente o 1, ottenuto ${args.fuelFactor}`);
});

test('simulateLap: --fuel arriva davvero al giocatore simulato', () => {
    // Senza questo, un A/B che non mostra differenze verrebbe letto come
    // "il peso e' troppo piccolo" invece che "l'opzione non passa".
    const { loadTrack } = require('../sockets/games/trackLoader.js');
    const track = loadTrack('prova');
    const r = simulateLap(track, { speedFactor: 1, paceMult: 1, precisionNoise: 0, fuelFactor: 1.08 });
    assert.ok(r.telemetry.length > 0, 'la simulazione deve produrre telemetria');
    assert.equal(r.fuelFactor, 1.08, 'simulateLap deve dichiarare con che carico ha girato');
});
