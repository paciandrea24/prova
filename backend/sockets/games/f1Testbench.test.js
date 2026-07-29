// backend/sockets/games/f1Testbench.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTestbenchScenario } = require('./f1Testbench.js');
const { listTracks } = require('./trackLoader.js');

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

test('validateTestbenchScenario: botCount fuori range [2,6] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 1, tyreWear: 0, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 7, tyreWear: 0, compound: 'medium' }).valid, false);
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
    const socket = makeFakeSocket();
    const io = { to: () => ({ emit: () => {} }) };
    registerTestbench(io, socket);

    let racingLine = undefined;
    socket.emit = (event, payload) => { if (event === 'f1tbRacingLine') racingLine = payload; };

    socket.listeners('f1tbStart')[0]({ trackId: 'monte-rosso', botCount: 2, tyreWear: 0, compound: 'medium' });

    assert.equal(racingLine, null);
    done();
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
const VARIANT_FILE = path.join(__dirname, '..', '..', 'tools', `monte-rosso${VARIANT_SUFFIX}-raceline.json`);

function writeVariantFile() {
    fs.writeFileSync(VARIANT_FILE, JSON.stringify({
        trackId: 'monte-rosso', timeMs: 12345, elapsedS: 1,
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
    writeVariantFile();
    try {
        const { loadTrack } = require('./trackLoader.js');
        const { createTestbenchSession } = require('./f1Testbench.js');

        const before = loadTrack('monte-rosso');   // monte-rosso non ha racing line ufficiale (verificato nell'audit)
        assert.equal(before.racingLine, null, 'precondizione: monte-rosso non ha una racing line ufficiale');

        const validation = validateTestbenchScenario({ trackId: 'monte-rosso', botCount: 2, tyreWear: 0, compound: 'medium', racelineVariant: VARIANT_SUFFIX });
        assert.deepEqual(validation, { valid: true });

        const game = createTestbenchSession({ trackId: 'monte-rosso', botCount: 2, tyreWear: 0, compound: 'medium', racelineVariant: VARIANT_SUFFIX });
        assert.ok(Array.isArray(game.track.racingLine) && game.track.racingLine.length > 0, 'la sessione deve avere la racing line sperimentale');

        // La chiamata di verità: ri-chiedere la pista a trackLoader (stesso
        // oggetto cacheato usato da ogni partita vera) deve restituire
        // ANCORA racingLine=null — se questo fallisce, la sessione ha
        // corrotto lo stato condiviso con le partite reali.
        const after = loadTrack('monte-rosso');
        assert.equal(after.racingLine, null, 'la cache di trackLoader NON deve essere mutata dalla sessione sperimentale');
        assert.equal(after, before, 'deve restare lo stesso identico oggetto in cache (===), non solo un valore uguale');
    } finally {
        removeVariantFile();
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
