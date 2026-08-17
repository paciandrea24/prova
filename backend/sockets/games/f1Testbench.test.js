// backend/sockets/games/f1Testbench.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTestbenchScenario } = require('./f1Testbench.js');
const { listTracks } = require('./trackLoader.js');

// Pista temporanea SENZA racing line precalcolata, usata dai test che
// verificano il comportamento "nessuna racing line" — Rif. Task 6 del piano
// F1 bot Fase 1: prima monte-rosso non aveva una racing line ufficiale e
// fungeva da fixture per questo caso, ma ora ce l'ha (regenerata insieme
// alle altre 3 piste reali), quindi questi test devono costruirsi la
// propria pista senza racing line invece di dipendere da quale pista reale
// non ne ha una in un dato momento (fragile: si è già rotto una volta).
const NO_RACELINE_TRACK_ID = 'test-no-raceline-fixture';
function buildNoRacelineTrackData() {
    const n = 12;
    const controlPoints = Array.from({ length: n }, (_, i) => {
        const theta = (i / n) * 2 * Math.PI;
        return { x: 100 * Math.cos(theta), z: 100 * Math.sin(theta) };
    });
    return {
        id: NO_RACELINE_TRACK_ID,
        name: 'Test No Raceline',
        targetKm: 1,
        roadHalfWidth: 10,
        controlPoints,
        pit: {
            roadHalfWidth: 5,
            boxIndex: 1,
            entryTrigger: { x: 100, z: 0, halfWidth: 10, halfLength: 10, angle: 0 },
            path: [
                { x: 100, z: 0 },
                { x: 105, z: 5 },
                { x: 110, z: 10 }
            ]
        }
    };
}

test('validateTestbenchScenario: scenario valido passa', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 30, compound: 'medium' });
    assert.deepEqual(result, { valid: true });
});

test('validateTestbenchScenario: trackId inesistente viene rifiutato', () => {
    const result = validateTestbenchScenario({ trackId: 'pista-che-non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });
    assert.equal(result.valid, false);
    assert.match(result.error, /pista/i);
});

test('validateTestbenchScenario: botCount fuori range [2, MAX_GRID_SIZE] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    // Il limite alto si legge dalla costante: era 6 e dal 2026-08-17 e' 20,
    // da quando il numero di piloti si sceglie in lobby. Un 7 scritto a mano
    // qui diceva "fuori range" per un valore che ora e' legittimo.
    const { MAX_GRID_SIZE } = require('./f1Bot.js');
    assert.equal(validateTestbenchScenario({ trackId, botCount: 1, tyreWear: 0, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: MAX_GRID_SIZE + 1, tyreWear: 0, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: tyreWear fuori range [0,100] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: -1, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 101, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: mescola sconosciuta viene rifiutata', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 0, compound: 'ultrasoft' });
    assert.equal(result.valid, false);
    assert.match(result.error, /mescola/i);
});

// ---- Danno di partenza per componente (Priorità 0 dell'audit banco prova:
// gli slider esistevano nell'HTML senza alcun wiring — o si cablano fino in
// fondo, o si tolgono; qui si cablano). Opzionale: se assente, equivale a
// {frontWing:0, floor:0, engine:0, suspension:0} (nessuna rottura per chi
// chiama senza specificarlo, come già gli altri test sopra). ----

test('validateTestbenchScenario: damageParts assente => valido (default nessun danno)', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 0, compound: 'medium' });
    assert.deepEqual(result, { valid: true });
});

test('validateTestbenchScenario: damageParts con tutti i componenti in [0,100] è valido', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({
        trackId, botCount: 4, tyreWear: 0, compound: 'medium',
        damageParts: { frontWing: 20, floor: 100, engine: 0, suspension: 55 }
    });
    assert.deepEqual(result, { valid: true });
});

test('validateTestbenchScenario: componente danno fuori range [0,100] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({
        trackId, botCount: 4, tyreWear: 0, compound: 'medium',
        damageParts: { frontWing: 101, floor: 0, engine: 0, suspension: 0 }
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /danno/i);
});

test('validateTestbenchScenario: componente danno non numerico viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({
        trackId, botCount: 4, tyreWear: 0, compound: 'medium',
        damageParts: { frontWing: 0, floor: 'tanto', engine: 0, suspension: 0 }
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /danno/i);
});

const { createTestbenchSession } = require('./f1Testbench.js');
const { physics } = require('./f1GameSocket.js');

test('createTestbenchSession: crea esattamente botCount bot con usura/mescola richieste', () => {
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 4, tyreWear: 45, compound: 'hard' });

    const players = Object.values(game.players);
    assert.equal(players.length, 4);
    for (const p of players) {
        assert.equal(p.isBot, true);
        assert.equal(p.tyreWear, 45);
        assert.equal(p.compound, 'hard');
    }
    assert.equal(game.phase, 'race');
    assert.equal(game.raceStarted, true);
});

test('createTestbenchSession: senza damageParts, i bot restano illesi (0 su tutti i componenti)', () => {
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    for (const p of Object.values(game.players)) {
        assert.deepEqual(p.damageParts, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        assert.equal(p.damage, 0);
    }
});

test('createTestbenchSession: damageParts richiesto viene applicato a OGNI bot, con oggetti indipendenti (no riferimento condiviso)', () => {
    const trackId = listTracks()[0].id;
    const damageParts = { frontWing: 80, floor: 10, engine: 0, suspension: 40 };
    const game = createTestbenchSession({ trackId, botCount: 3, tyreWear: 0, compound: 'medium', damageParts });

    const players = Object.values(game.players);
    for (const p of players) {
        assert.deepEqual(p.damageParts, damageParts);
        // p.damage è derivato come massimo dei 4 componenti (stesso invariante
        // di DamageModel.addComponentDamage) — deve riflettersi anche qui,
        // altrimenti l'HUD/debug che legge p.damage vedrebbe 0 nonostante
        // danno reale sui componenti.
        assert.equal(p.damage, 80);
    }
    // Mutare l'oggetto di un bot non deve toccare gli altri (oggetto fresco
    // per bot, mai lo stesso riferimento — stesso principio di
    // DamageModel.createDamageParts).
    players[0].damageParts.frontWing = 5;
    assert.equal(players[1].damageParts.frontWing, 80, 'i bot non devono condividere lo stesso oggetto damageParts per riferimento');
});

test('createTestbenchSession: il game risultante funziona con la vera tickGame (le auto si muovono)', () => {
    const { tickGame } = require('./f1GameSocket.js');
    const trackId = listTracks()[0].id;
    const game = createTestbenchSession({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    const fakeIo = { to: () => ({ emit: () => {} }) };

    const before = Object.values(game.players).map(p => ({ x: p.x, z: p.z }));
    for (let i = 0; i < 50; i++) tickGame(fakeIo, 'TESTBENCH', game);
    const after = Object.values(game.players).map(p => ({ x: p.x, z: p.z }));

    const anyMoved = before.some((b, i) => Math.abs(b.x - after[i].x) > 0.001 || Math.abs(b.z - after[i].z) > 0.001);
    assert.ok(anyMoved, 'atteso che almeno un bot si sia mosso dopo 50 tick della vera tickGame');
});

const { EventEmitter } = require('node:events');
const registerTestbench = require('./f1Testbench.js');

// Fake socket/io minimi: solo quello che f1Testbench.js usa davvero
// (socket.on/emit/join, io.to().emit) — stesso pattern già usato nei test
// di f1Bot.js per deps.io/deps.handlePitReactionPress.
function makeFakeSocket() {
    const s = new EventEmitter();
    s.join = () => {};
    s.emit = () => {};
    return s;
}

test('f1tbStart con scenario non valido emette f1tbError e non crea sessione', (t, done) => {
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    let errorMsg = null;
    socket.emit = (event, payload) => { if (event === 'f1tbError') errorMsg = payload; };

    socket.emit('___trigger___');   // no-op, solo per chiarezza del test
    socket.listeners('f1tbStart')[0]({ trackId: 'non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });

    assert.ok(errorMsg && errorMsg.error, 'atteso un f1tbError con messaggio');
    done();
});

// ---- f1tbRacingLine (debug visuale traiettoria, Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md): pura
// inoltro al client di dati già caricati da loadTrack — nessun nuovo calcolo,
// nessuna influenza sulla guida del bot (questo test verifica solo cosa
// viene emesso, non il comportamento fisico/IA). ----

test('f1tbStart su pista CON racing line precalcolata -> emette f1tbRacingLine con l\'array di punti', (t, done) => {
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    let racingLine = undefined;
    socket.emit = (event, payload) => { if (event === 'f1tbRacingLine') racingLine = payload; };

    socket.listeners('f1tbStart')[0]({ trackId: 'new-monza', botCount: 2, tyreWear: 0, compound: 'medium' });

    assert.ok(Array.isArray(racingLine) && racingLine.length > 0, 'atteso un array di punti non vuoto');
    done();
});

test('f1tbStart su pista SENZA racing line precalcolata -> emette f1tbRacingLine null', (t, done) => {
    const { saveTrack, deleteTrack } = require('./trackLoader.js');
    saveTrack(buildNoRacelineTrackData());
    try {
        const socket = makeFakeSocket();
        const io = { to: () => ({ emit: () => {} }) };
        registerTestbench(io, socket);

        let racingLine = undefined;
        socket.emit = (event, payload) => { if (event === 'f1tbRacingLine') racingLine = payload; };

        socket.listeners('f1tbStart')[0]({ trackId: NO_RACELINE_TRACK_ID, botCount: 2, tyreWear: 0, compound: 'medium' });

        assert.equal(racingLine, null);
        done();
    } finally {
        deleteTrack(NO_RACELINE_TRACK_ID);
    }
});

// ---- racelineVariant (verifica C, prototipo shape-prior — Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md): il
// banco prova deve poter caricare una racing line sperimentale SENZA mai
// toccare il file/oggetto ufficiale (letto e cacheato da trackLoader.js,
// condiviso con le partite vere). Questi test creano/rimuovono un file di
// controlli temporaneo, non dipendono dai file sperimentali generati
// durante l'analisi (che potrebbero non esistere più in futuro). ----

const fs = require('node:fs');
const path = require('node:path');
const VARIANT_SUFFIX = '-f1testbench-testvariant';
const VARIANT_FILE = path.join(__dirname, '..', '..', 'tools', `${NO_RACELINE_TRACK_ID}${VARIANT_SUFFIX}-raceline.json`);

function writeVariantFile() {
    fs.writeFileSync(VARIANT_FILE, JSON.stringify({
        trackId: NO_RACELINE_TRACK_ID, timeMs: 12345, elapsedS: 1,
        tuning: { lookaheadTimeS: 0.6, steerGain: 3.0, cornerSpeedMargin: 0.99, brakingDistanceMargin: 1.2, deadband: 0.01, ramp: 0.06 },
        lineControls: [3, -3, 3, -3, 3, -3, 3, -3, 3, -3, 3, -3, 3, -3, 3]
    }, null, 2));
}
function removeVariantFile() {
    if (fs.existsSync(VARIANT_FILE)) fs.unlinkSync(VARIANT_FILE);
}

test('validateTestbenchScenario: racelineVariant che non corrisponde a nessun file viene rifiutato', () => {
    const result = validateTestbenchScenario({ trackId: 'monte-rosso', botCount: 2, tyreWear: 0, compound: 'medium', racelineVariant: '-non-esiste' });
    assert.equal(result.valid, false);
    assert.match(result.error, /racing line/i);
});

test('validateTestbenchScenario + createTestbenchSession: racelineVariant valido viene applicato SENZA mutare la cache di trackLoader', () => {
    const { loadTrack, saveTrack, deleteTrack } = require('./trackLoader.js');
    saveTrack(buildNoRacelineTrackData());
    writeVariantFile();
    try {
        const { createTestbenchSession } = require('./f1Testbench.js');

        const before = loadTrack(NO_RACELINE_TRACK_ID);
        assert.equal(before.racingLine, null, 'precondizione: la pista di test non ha una racing line ufficiale');

        const validation = validateTestbenchScenario({ trackId: NO_RACELINE_TRACK_ID, botCount: 2, tyreWear: 0, compound: 'medium', racelineVariant: VARIANT_SUFFIX });
        assert.deepEqual(validation, { valid: true });

        const game = createTestbenchSession({ trackId: NO_RACELINE_TRACK_ID, botCount: 2, tyreWear: 0, compound: 'medium', racelineVariant: VARIANT_SUFFIX });
        assert.ok(Array.isArray(game.track.racingLine) && game.track.racingLine.length > 0, 'la sessione deve avere la racing line sperimentale');

        // La chiamata di verità: ri-chiedere la pista a trackLoader (stesso
        // oggetto cacheato usato da ogni partita vera) deve restituire
        // ANCORA racingLine=null — se questo fallisce, la sessione ha
        // corrotto lo stato condiviso con le partite reali.
        const after = loadTrack(NO_RACELINE_TRACK_ID);
        assert.equal(after.racingLine, null, 'la cache di trackLoader NON deve essere mutata dalla sessione sperimentale');
        assert.equal(after, before, 'deve restare lo stesso identico oggetto in cache (===), non solo un valore uguale');
    } finally {
        removeVariantFile();
        deleteTrack(NO_RACELINE_TRACK_ID);
    }
});

test('f1tbStart valido avvia il timer, f1tbStop lo ferma (nessuna eccezione)', (t, done) => {
    const { listTracks } = require('./trackLoader.js');
    const trackId = listTracks()[0].id;
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    socket.listeners('f1tbStart')[0]({ trackId, botCount: 2, tyreWear: 0, compound: 'medium' });
    socket.listeners('f1tbPause')[0]();
    socket.listeners('f1tbStep')[0]();
    socket.listeners('f1tbSetSpeed')[0]({ multiplier: 2 });
    socket.listeners('f1tbResume')[0]();
    socket.listeners('f1tbStop')[0]();

    done();   // il vero obiettivo del test è che nessuna delle chiamate sopra lanci un'eccezione
});
