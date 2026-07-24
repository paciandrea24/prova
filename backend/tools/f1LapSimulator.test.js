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
