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

// Le piste si leggono dalla cartella invece di elencarle qui: il punto di
// questo modulo è che funziona su qualunque tracciato, comprese le piste
// disegnate con l'editor dopo che questi test sono stati scritti. Un elenco
// scritto a mano invecchia — e si rompe se una pista viene rimossa.
const TRACCIATI = require('fs')
    .readdirSync(path.join(__dirname, '..', 'tracks'))
    // Le piste finte che altri test creano e cancellano al volo
    // (`test-...`) vanno escluse: la suite gira in parallelo e
    // altrimenti compaiono qui a seconda del momento.
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

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

// ────────────────────────────────────────────────────────────────────────
// LA CAMERA NON DEVE FINIRE DENTRO LA SCENOGRAFIA
//
// Il difetto che questi test proteggono (segnalato in playtest):
// "l'inquadratura del traguardo entra dentro un cartellone pubblicitario, la
// camera entra tipo in uno dei tubi che lo sostengono e gli passa
// all'interno". La causa non era un numero sbagliato: gli scatti si ricavano
// dalla forma della pista, gli oggetti li piazza trackScenery.js, e i due
// moduli usavano lo stesso offset dalla barriera senza sapersi. I cartelloni
// sponsor stanno a barrierDist+6, e lì si metteva la camera del traguardo.
//
// Misurato prima del controllo: su "prova" la camera del traguardo era dentro
// un cartellone per 0.3 unità e quella del punto alto dentro due tribune (4.3
// e 0.3); su monte-rosso il cartellone era sfiorato a 0.3.
// ────────────────────────────────────────────────────────────────────────
const TrackScenery = require('./trackScenery.js');
const seatAnchors = require(path.join(__dirname, '..', 'assets/custom/circuit/grandStandSeats.json')).seats;
const terraceAnchors = require(path.join(__dirname, '..', 'assets/custom/circuit/terraceAnchors.json')).anchors;

function scattiConScenografia(id) {
    const grezzo = JSON.parse(require('fs').readFileSync(
        path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
    const t = loadTrack(id);
    const barrierDist = t.roadHalf + 2.8 + 1.2;
    const layout = TrackScenery.generateLayout(grezzo, t.points, t.pitLanePts,
        barrierDist, 45, seatAnchors, t.barrierProfile, terraceAnchors, { gridSize: 6 });
    return {
        layout,
        solidi: TrackPreviewShots.oggettiSolidi(layout),
        scatti: TrackPreviewShots.buildShots(t.points, t.pitLanePts, {
            startFinishIndex: t.startFinishIndex || 0,
            barrierDist,
            layout,
        }),
    };
}

// Campiona TUTTA la corsa della camera, non i soli estremi: sul punto alto di
// "prova" la camera partiva e arrivava all'aperto ma attraversava due tribune
// a metà strada, perché a offset costante lungo una pista che curva la
// traiettoria non è un segmento.
// Campiona molto piu' fitto di quanto faccia la produzione (~0.5 unita'
// contro 2): cosi' il test e' strettamente piu' severo del controllo che
// verifica, e un buco di campionamento in produzione si vede da qui. E' gia'
// successo: la camera della curva su "prova" scavalcava una rete di sicurezza
// infilandosi fra due campioni consecutivi.
function oggettiSullaCorsa(scatto, solidi) {
    const dentro = [];
    const lunghezza = Math.hypot(scatto.camFine.x - scatto.cam.x,
        scatto.camFine.y - scatto.cam.y, scatto.camFine.z - scatto.cam.z);
    const campioni = Math.max(24, Math.ceil(lunghezza / 0.5));
    for (let k = 0; k <= campioni; k++) {
        const u = k / campioni;
        const p = {
            x: scatto.cam.x + (scatto.camFine.x - scatto.cam.x) * u,
            y: scatto.cam.y + (scatto.camFine.y - scatto.cam.y) * u,
            z: scatto.cam.z + (scatto.camFine.z - scatto.cam.z) * u,
        };
        for (const item of solidi) {
            if (TrackPreviewShots.ostruisce(item, p) && !dentro.includes(item)) dentro.push(item);
        }
    }
    return dentro;
}

for (const id of TRACCIATI) {
    test(`${id}: nessuna inquadratura passa dentro la scenografia`, () => {
        const { scatti, solidi } = scattiConScenografia(id);
        for (const s of scatti) {
            // `suAsse`: lo scatto del rettilineo sta sopra l'asfalto per
            // scelta (vedi trackPreviewShots.js) ed e' l'unico che la
            // produzione non scansa. Passa sotto le passerelle esattamente
            // come le auto, e la scatola d'ingombro di una campata comprende
            // il vuoto sotto: contarlo come compenetrazione sarebbe falso.
            if (s.suAsse) continue;
            const dentro = oggettiSullaCorsa(s, solidi);
            assert.equal(dentro.length, 0,
                `lo scatto "${s.id}" attraversa ${dentro.map(v => `${v.asset}@(${v.x.toFixed(0)},${v.z.toFixed(0)})`).join(', ')}`);
        }
    });
}

test('senza scenografia gli scatti restano quelli nominali', () => {
    // La scenografia e' facoltativa: chi non la passa (strumenti offline,
    // test piu' vecchi) deve ottenere le stesse inquadrature di sempre.
    const t = loadTrack('prova');
    const opzioni = { startFinishIndex: t.startFinishIndex || 0, barrierDist: t.roadHalf + 2.8 + 1.2 };
    const senza = TrackPreviewShots.buildShots(t.points, t.pitLanePts, opzioni);
    const vuota = TrackPreviewShots.buildShots(t.points, t.pitLanePts, Object.assign({ layout: [] }, opzioni));
    assert.deepEqual(vuota.map(s => s.cam), senza.map(s => s.cam));
});

test('con la scenografia la camera del traguardo si sposta davvero', () => {
    // Il controllo non e' decorativo: su "prova" cambia la posizione.
    const t = loadTrack('prova');
    const opzioni = { startFinishIndex: t.startFinishIndex || 0, barrierDist: t.roadHalf + 2.8 + 1.2 };
    const senza = TrackPreviewShots.buildShots(t.points, t.pitLanePts, opzioni)
        .find(s => s.id === 'traguardo');
    const con = scattiConScenografia('prova').scatti.find(s => s.id === 'traguardo');
    const spostamento = Math.hypot(con.cam.x - senza.cam.x, con.cam.z - senza.cam.z);
    assert.ok(spostamento > 0.5,
        `la camera del traguardo non si e' spostata (${spostamento.toFixed(2)} unita): il cartellone e' ancora addosso`);
});
