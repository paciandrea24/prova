// backend/tools/f1LapSimulator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTrack, listTracks } = require('../sockets/games/trackLoader.js');
const { simulateLap, slowestPoints } = require('./f1LapSimulator.js');

const DEFAULT_OPTS = { speedFactor: 1, paceMult: 1, precisionNoise: 0, safetyCapS: 60 };

for (const { id } of listTracks()) {
    test(`simulateLap: ${id} completa il giro entro il tetto di sicurezza (tuning di default)`, () => {
        const track = loadTrack(id);
        const result = simulateLap(track, DEFAULT_OPTS);
        assert.ok(result.finished, `${id}: giro non completato entro ${DEFAULT_OPTS.safetyCapS}s simulati`);
        assert.ok(result.timeMs > 0, `${id}: tempo non valido (${result.timeMs})`);
        assert.ok(result.telemetry.length > 0, `${id}: telemetria vuota`);
    });
}

test('simulateLap: rispetta un preset di tuning passato in opts.tuning (margini rilassati => non più lento del default)', () => {
    const track = loadTrack('monza');
    const base = simulateLap(track, DEFAULT_OPTS);
    const relaxed = simulateLap(track, {
        ...DEFAULT_OPTS,
        tuning: { cornerSpeedMargin: 1.0, apexMaxFraction: 1.0, brakingDistanceMargin: 1.0 }
    });
    assert.ok(base.finished && relaxed.finished, 'entrambe le simulazioni devono completare il giro');
    assert.ok(relaxed.timeMs <= base.timeMs, `atteso tempo <= default (${base.timeMs}ms), ottenuto ${relaxed.timeMs}ms`);
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
