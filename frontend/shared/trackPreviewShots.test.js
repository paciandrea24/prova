// frontend/shared/trackPreviewShots.test.js
//
// Le inquadrature dell'anteprima si ricavano dalla forma del circuito, quindi
// devono reggere su QUALUNQUE tracciato — comprese le piste che qualcuno
// disegnerà domani con l'editor. Questi test le rifanno sui quattro tracciati
// reali e verificano le proprietà che non si possono guardare a occhio senza
// aprire il gioco: che la camera non finisca sotto terra o in mezzo alla
// carreggiata, che il bersaglio sia sempre sul tracciato, e che la panoramica
// sia centrata sul circuito VERO (era esattamente il difetto di prima: un
// punto fisso a centinaia di unità di distanza).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const TrackPreviewShots = require('./trackPreviewShots.js');
const TrackGeometry = require('./trackGeometry.js');
const { loadTrack } = require(path.join(__dirname, '..', '..', 'backend/sockets/games/trackLoader.js'));

const TRACCIATI = ['prova', 'monte-rosso', 'new-monza', 'baku'];

function scattiDi(id) {
    const t = loadTrack(id);
    return {
        // Stessi ingressi che passa f1.js: `roadHalf` (non `roadHalfWidth`,
        // che è il nome nel JSON grezzo e su loadTrack è undefined), più
        // cordolo e stacco della barriera.
        scatti: TrackPreviewShots.buildShots(t.points, t.pitLanePts, {
            startFinishIndex: t.startFinishIndex || 0,
            barrierDist: t.roadHalf + 2.8 + 1.2,
        }),
        track: t,
    };
}

for (const id of TRACCIATI) {
    test(`${id}: produce un carosello con panoramica, traguardo e curva`, () => {
        const { scatti } = scattiDi(id);
        const ids = scatti.map(s => s.id);
        assert.ok(scatti.length >= 4, `attesi almeno 4 scatti, trovati ${scatti.length}`);
        assert.ok(ids.includes('panoramica'));
        assert.ok(ids.includes('traguardo'));
        assert.ok(ids.includes('curva'));
        assert.equal(new Set(ids).size, ids.length, 'nessuno scatto duplicato');
    });

    test(`${id}: ogni scatto ha coordinate finite e un indice di pista valido`, () => {
        const { scatti, track } = scattiDi(id);
        for (const s of scatti) {
            for (const chiave of ['cam', 'camFine', 'target', 'targetFine']) {
                const p = s[chiave];
                assert.ok(p, `${s.id}.${chiave} mancante`);
                for (const asse of ['x', 'y', 'z']) {
                    assert.ok(Number.isFinite(p[asse]), `${s.id}.${chiave}.${asse} non finito`);
                }
            }
            assert.ok(s.idx >= 0 && s.idx < track.points.length, `${s.id}: idx fuori dai campioni`);
            assert.ok(s.durata > 0, `${s.id}: durata non positiva`);
            assert.ok(s.etichetta && s.etichetta.length, `${s.id}: etichetta vuota`);
        }
    });

    test(`${id}: la camera non finisce sotto il livello della pista`, () => {
        const { scatti, track } = scattiDi(id);
        for (const s of scatti) {
            for (const chiave of ['cam', 'camFine']) {
                assert.ok(s[chiave].y > 0, `${s.id}.${chiave} sotto quota zero: ${s[chiave].y}`);
            }
        }
        assert.ok(track.points.length > 0);
    });

    // Il vincolo che i primi tentativi violavano senza che nessun test lo
    // dicesse: guardavano fino a 866 unità di distanza, dove la nebbia del
    // gioco (densità 0.0016) ha già coperto tutto e camera.far (1200) taglia.
    // Un'inquadratura "bella sulla carta" e vuota a schermo.
    test(`${id}: nessuna inquadratura guarda oltre la distanza utile`, () => {
        const { scatti } = scattiDi(id);
        for (const s of scatti) {
            for (const [dove, bersaglio] of [['cam', s.target], ['camFine', s.targetFine]]) {
                const d = Math.hypot(bersaglio.x - s[dove].x, bersaglio.y - s[dove].y, bersaglio.z - s[dove].z);
                assert.ok(d <= TrackPreviewShots.DISTANZA_UTILE * 1.05,
                    `${s.id} (${dove}): bersaglio a ${d.toFixed(0)} unità, oltre le ${TrackPreviewShots.DISTANZA_UTILE} utili`);
            }
        }
    });

    test(`${id}: le camere esterne stanno FUORI dalla carreggiata`, () => {
        const { scatti, track } = scattiDi(id);
        const mezzaPista = track.roadHalf;
        for (const s of scatti) {
            // 'rettilineo' è deliberatamente sull'asse della pista (serve la
            // prospettiva in fuga) e 'panoramica' è lontanissima da tutto.
            if (s.id === 'rettilineo' || s.id === 'panoramica') continue;
            const d = TrackGeometry.nearestPoint(track.points, s.cam.x, s.cam.z).dist;
            assert.ok(d > mezzaPista, `${s.id}: camera a ${d.toFixed(1)} dall'asse, dentro la pista`);
        }
    });

    test(`${id}: il bersaglio dello scatto è sul tracciato, non nel vuoto`, () => {
        const { scatti, track } = scattiDi(id);
        for (const s of scatti) {
            if (s.id === 'panoramica') continue;   // guarda il centro del circuito
            const suPista = TrackGeometry.nearestPoint(track.points, s.target.x, s.target.z).dist;
            const suCorsia = track.pitLanePts && track.pitLanePts.length
                ? TrackGeometry.nearestPoint(track.pitLanePts, s.target.x, s.target.z).dist
                : Infinity;
            assert.ok(Math.min(suPista, suCorsia) < 12,
                `${s.id}: bersaglio a ${Math.min(suPista, suCorsia).toFixed(1)} da pista e corsia box`);
        }
    });

    // La veduta aerea guarda il TRAGUARDO di questa pista. Il difetto che
    // sostituisce è il contrario: guardava (50, 100), un punto scritto nel
    // codice che su "prova" cade a 828 unità dal circuito e su "baku" a 584.
    test(`${id}: la veduta aerea è agganciata al traguardo di questa pista`, () => {
        const { scatti, track } = scattiDi(id);
        const pan = scatti.find(s => s.id === 'panoramica');
        const linea = track.points[track.startFinishIndex || 0];
        assert.ok(Math.hypot(pan.target.x - linea.x, pan.target.z - linea.z) < 1,
            'deve guardare il traguardo, non un punto fisso');
        assert.ok(pan.cam.y > 100, 'deve essere una veduta dall\'alto');
        const fissoStorico = Math.hypot(pan.target.x - 50, pan.target.z - 100);
        assert.ok(fissoStorico > 1 || (linea.x === 50 && linea.z === 100),
            'il bersaglio non deve essere il vecchio punto fisso per caso');
    });
}

test('una pista in piano non produce lo scatto del dislivello', () => {
    // Anello circolare sintetico, quota costante: niente da mostrare in alto.
    const punti = [];
    for (let i = 0; i < 200; i++) {
        const a = (i / 200) * Math.PI * 2;
        punti.push({ x: Math.cos(a) * 300, y: 0, z: Math.sin(a) * 300 });
    }
    const scatti = TrackPreviewShots.buildShots(punti, [], { startFinishIndex: 0, barrierDist: 15 });
    assert.equal(scatti.find(s => s.id === 'quota'), undefined);
    assert.equal(scatti.find(s => s.id === 'box'), undefined, 'senza corsia box niente scatto ai box');
});

test('"prova" ha un dislivello e quindi ottiene lo scatto in quota', () => {
    const { scatti } = scattiDi('prova');
    const quota = scatti.find(s => s.id === 'quota');
    assert.ok(quota, 'su "prova" (dislivello 11.5) lo scatto in quota deve esserci');
    assert.ok(quota.cam.y < quota.target.y,
        'la camera deve stare più in basso della pista, che le passa sopra');
});

test('un tracciato vuoto non fa esplodere il carosello', () => {
    assert.deepEqual(TrackPreviewShots.buildShots([], [], {}), []);
});
