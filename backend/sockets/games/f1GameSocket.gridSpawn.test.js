// backend/sockets/games/f1GameSocket.gridSpawn.test.js
//
// Un'auto appena schierata non deve muoversi finché nessuno tocca i comandi.
//
// Il difetto che questi test proteggono (segnalato in playtest su
// monte-rosso, "sono stato teletrasportato alla mia sinistra"):
// assignGridSpawns dichiarava `p.trackIndex = 0` per tutti, ma lo
// schieramento sta 48 unità PIÙ AVANTI del traguardo. La fisica cerca il
// punto pista in una finestra di ±20 campioni attorno all'indice dichiarato
// (nearestIndexNear), e su monte-rosso — dove un campione vale 1.18 unità —
// la pole cade sul 41°: fuori finestra. Il muro misurava allora la distanza
// da un punto di pista 25 unità indietro, concludeva che l'auto fosse fuori
// e la spingeva dentro di 11.6 unità al primo tick.
//
// Su prova (5.17 per campione, pole al 9°) e new-monza (3.21, pole al 15°)
// l'indice cadeva dentro la finestra per caso, ed è il motivo per cui il
// difetto si vedeva su un tracciato solo.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const f1 = require('./f1GameSocket.js');
const { loadTrack } = require('./trackLoader.js');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const { TRACK_INDEX_WINDOW } = require('./physics/CollisionResolver.js');

const TRACCIATI = fs
    .readdirSync(path.join(__dirname, '..', '..', '..', 'frontend', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

const MAX_GRID = 6;

// Il minimo indispensabile perché assignGridSpawns e applyBarrier funzionino.
function partitaFinta(trackId) {
    const track = loadTrack(trackId);
    const players = {};
    const colori = [];
    for (let i = 0; i < MAX_GRID; i++) {
        const c = 'c' + i;
        colori.push(c);
        players[c] = {
            color: c, x: 0, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,
            inputs: { throttle: 0, brake: 0, steer: 0 },
            carContacts: new Set(), pendingCollisionPenaltyEvents: [],
            damageParts: f1.physics.createDamageParts(),
        };
    }
    return { track, players, grid: colori, colori };
}

for (const id of TRACCIATI) {
    test(`${id}: lo schieramento dichiara l'indice di pista giusto`, () => {
        const game = partitaFinta(id);
        f1.physics.assignGridSpawns(game);
        const n = game.track.points.length;

        for (const c of game.colori) {
            const p = game.players[c];
            const vero = TrackGeometry.nearestPoint(game.track.points, p.x, p.z).index;
            // Distanza circolare fra l'indice dichiarato e quello vero.
            const scarto = Math.min(((vero - p.trackIndex) % n + n) % n,
                                    ((p.trackIndex - vero) % n + n) % n);
            assert.ok(scarto <= TRACK_INDEX_WINDOW,
                `${c}: dichiara ${p.trackIndex}, sta al ${vero} — ${scarto} campioni di scarto, ` +
                `oltre la finestra di ${TRACK_INDEX_WINDOW} in cui la fisica lo cerca`);
        }
    });

    test(`${id}: a comandi fermi il muro non sposta nessuno dalla griglia`, () => {
        const game = partitaFinta(id);
        f1.physics.assignGridSpawns(game);

        for (const c of game.colori) {
            const p = game.players[c];
            const prima = { x: p.x, z: p.z };
            f1.physics.applyBarrier(p, game.track, true);
            const spostamento = Math.hypot(p.x - prima.x, p.z - prima.z);
            assert.ok(spostamento < 0.01,
                `${c} spostato di ${spostamento.toFixed(2)} unità appena schierato, senza toccare niente`);
        }
    });
}
