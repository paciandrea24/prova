// backend/sockets/games/f1GameSocket.pitEntry.test.js
//
// Entrando in corsia box l'auto non deve tornare indietro.
//
// Il difetto che questi test proteggono (segnalato in playtest, presente da
// sempre): `startPitLaneEntry` puntava l'autopilota al campione 1 della
// corsia box, sempre, chiunque fosse la pista. Ma il trigger d'ingresso non
// sta sopra il campione 1: sta dove il tracciato lo mette. Misurato, la
// distanza fra il campione 1 e quello sotto il trigger:
//
//   prova         campione 25 di 300  ->  42.3 unità INDIETRO
//   new-monza     campione 47         ->  41.4 unità indietro
//   monte-rosso   campione  8         ->   4.5 unità indietro
//
// L'auto entrava, tornava indietro fino all'imbocco e solo dopo ripartiva —
// e su monte-rosso, dove lo scarto è piccolo, quasi non si notava.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const f1 = require('./f1GameSocket.js');
const { loadTrack } = require('./trackLoader.js');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

const TRACCIATI = fs
    .readdirSync(path.join(__dirname, '..', '..', '..', 'frontend', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

const ioFinto = { to: () => ({ emit: () => { } }) };

for (const id of TRACCIATI) {
    test(`${id}: entrando ai box l'autopilota riparte da dove sei, non dall'imbocco`, () => {
        const track = loadTrack(id);
        const trigger = track.pitEntryTrigger;
        // L'auto è dove il gioco fa scattare l'ingresso: sul trigger.
        const p = { color: 'red', x: trigger.x, z: trigger.z, angle: 0, speed: 2 };

        f1.physics.startPitLaneEntry(ioFinto, 'L', { track, socketByColor: {} }, p);

        const mira = track.pitLanePts[p.pitPathIndex];
        const distanza = Math.hypot(mira.x - p.x, mira.z - p.z);
        assert.ok(distanza < 20,
            `l'autopilota punta a ${distanza.toFixed(1)} unità dall'auto: ` +
            `campione ${p.pitPathIndex}, mentre l'auto sta sul ${TrackGeometry.nearestPoint(track.pitLanePts, p.x, p.z).index}`);
    });

    test(`${id}: il punto mirato all'ingresso sta AVANTI, non dietro`, () => {
        const track = loadTrack(id);
        const trigger = track.pitEntryTrigger;
        const p = { color: 'red', x: trigger.x, z: trigger.z, angle: 0, speed: 2 };

        f1.physics.startPitLaneEntry(ioFinto, 'L', { track, socketByColor: {} }, p);

        const dove = TrackGeometry.nearestPoint(track.pitLanePts, p.x, p.z).index;
        assert.ok(p.pitPathIndex >= dove,
            `mira il campione ${p.pitPathIndex} mentre l'auto è già al ${dove}: ` +
            `l'autopilota la farebbe tornare indietro`);
    });
}
