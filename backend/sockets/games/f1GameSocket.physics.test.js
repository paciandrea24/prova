// backend/sockets/games/f1GameSocket.physics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const f1GameSocket = require('./f1GameSocket.js');

test('f1GameSocket espone .physics con le costanti attese', () => {
    const { physics } = f1GameSocket;
    assert.ok(physics, 'atteso f1GameSocket.physics definito');
    assert.equal(physics.PHYSICS_TICK_MS, 50);
    assert.equal(physics.ACCEL, 0.186);
    assert.equal(physics.BRAKE_MULT, 2.17);
    assert.equal(physics.TURN_SPEED_HIGH, 0.052);
    assert.equal(typeof physics.COLLISION_SUBSTEPS, 'number');
    assert.equal(typeof physics.HALF_LAP_IDX, 'number');
});

test('f1GameSocket.physics espone le funzioni pure attese', () => {
    const { physics } = f1GameSocket;
    for (const name of [
        'effectiveMaxSpeed', 'updateVelocity', 'integratePosition',
        'applyOffTrackDrag', 'applyBarrier', 'updateTrackIndex',
        'circularWithin', 'checkpointWindowFor', 'finishWindowFor'
    ]) {
        assert.equal(typeof physics[name], 'function', `atteso physics.${name} funzione`);
    }
});

test('effectiveMaxSpeed: in qualifica usa sempre la Soft (speedMult 1.05), a prescindere dalla mescola scelta', () => {
    const { physics } = f1GameSocket;
    const p = { tyreWear: 0, compound: 'hard' };
    const max = physics.effectiveMaxSpeed(p, true);
    assert.ok(Math.abs(max - 6.2 * 1.05) < 1e-9, `atteso ${6.2 * 1.05}, ottenuto ${max}`);
});

test('updateVelocity: da fermo con throttle=1, senza wheelspin, accelera esattamente di ACCEL in un tick', () => {
    // Ancorato a modello spento: da fermo a pieno gas è la condizione in cui
    // il wheelspin (ON di default dal 2026-08-11) morde di più, e qui si
    // verifica la catena di updateVelocity, non la sua taratura.
    process.env.F1_TYRE_SLIP_MODEL = '0';
    try {
        const { physics } = f1GameSocket;
        const p = { inputs: { throttle: 1, brake: 0, steer: 0 }, speed: 0, vx: 0, vz: 0, angle: 0, tyreWear: 0, compound: 'medium' };
        physics.updateVelocity(p, true, 1);
        assert.ok(Math.abs(p.speed - physics.ACCEL) < 1e-9, `atteso ${physics.ACCEL}, ottenuto ${p.speed}`);
    } finally {
        delete process.env.F1_TYRE_SLIP_MODEL;
    }
});

test('integratePosition: sposta x/z in base a vx/vz e dt', () => {
    const { physics } = f1GameSocket;
    const p = { x: 10, z: 20, vx: 2, vz: -3 };
    physics.integratePosition(p, 0.5);
    assert.ok(Math.abs(p.x - 11) < 1e-9 && Math.abs(p.z - 18.5) < 1e-9, `atteso (11,18.5), ottenuto (${p.x},${p.z})`);
});

test('assignGridSpawns: azzera damage/collisionPenaltyMs/pendingRepair/contatti a inizio gara vera', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = {
        gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }),
        pitPath: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }],
        pitBoxIndex: 2
    };
    const p = {
        color: 'red', damage: 42, collisionPenaltyMs: 3000, pendingRepair: true,
        carContacts: new Set(['blue']), wallContact: true,
        pendingCollisionPenaltyEvents: [500, 700],
        finished: false, time: null, lap: 0, checkpointA: false, inFinishZone: false,
        trackIndex: 0, tyreWear: 55, pitGoTimer: null, pitting: false, pitPhase: null,
        pitGoTime: null, pendingCompound: null, hasPitted: false, pitPenalty: false,
        falseStart: false, falseStartServed: false, gapToLeaderMs: null,
        pitAutoState: null, pitPathIndex: 0, inputs: { throttle: 0, brake: 0, steer: 0 }
    };
    const game = { grid: ['red'], players: { red: p }, track: fakeTrack };

    physics.assignGridSpawns(game);

    assert.equal(p.damage, 0);
    assert.equal(p.collisionPenaltyMs, 0);
    assert.equal(p.pendingRepair, false);
    assert.equal(p.carContacts.size, 0);
    assert.equal(p.wallContact, false);
    assert.equal(p.pendingCollisionPenaltyEvents.length, 0);
    assert.equal(p.pitBoxSlot, 0);
    assert.ok(p.pitBoxAnchor && typeof p.pitBoxAnchor.x === 'number', 'atteso pitBoxAnchor assegnato');
});

test('assignGridSpawns: due piloti in griglia ottengono pitBoxAnchor diversi (non più lo stesso punto condiviso)', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = {
        gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }),
        pitPath: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }],
        pitBoxIndex: 2
    };
    function makePlayer(color) {
        return {
            color, damage: 0, collisionPenaltyMs: 0, pendingRepair: false,
            carContacts: new Set(), wallContact: false, pendingCollisionPenaltyEvents: [],
            finished: false, time: null, lap: 0, checkpointA: false, inFinishZone: false,
            trackIndex: 0, tyreWear: 0, pitGoTimer: null, pitting: false, pitPhase: null,
            pitGoTime: null, pendingCompound: null, hasPitted: false, pitPenalty: false,
            falseStart: false, falseStartServed: false, gapToLeaderMs: null,
            pitAutoState: null, pitPathIndex: 0, inputs: { throttle: 0, brake: 0, steer: 0 }
        };
    }
    const red = makePlayer('red'), blue = makePlayer('blue');
    const game = { grid: ['red', 'blue'], players: { red, blue }, track: fakeTrack };

    physics.assignGridSpawns(game);

    assert.notEqual(red.pitBoxSlot, blue.pitBoxSlot);
    assert.ok(red.pitBoxAnchor.x !== blue.pitBoxAnchor.x || red.pitBoxAnchor.z !== blue.pitBoxAnchor.z,
        'i due piloti devono avere pitBoxAnchor in punti diversi');
});

// ---- Box fisso per tutta la sessione (Rif. richiesta utente 2026-08-07:
// "la mappa in qualifica e in gara deve essere la stessa" — prima
// assignGridSpawns ricalcolava SEMPRE l'anchor con l'ordine della griglia
// di partenza (risultato qualifica), diverso dall'ordine puramente di
// lista usato in startQualifying: lo stesso pilota finiva su un box
// diverso tra le due fasi) ----
test('assignGridSpawns: un pilota con pitBoxAnchor già assegnato (da startQualifying) lo mantiene INVARIATO, anche con un ordine di griglia diverso', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = {
        gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }),
        pitPath: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }],
        pitBoxIndex: 2
    };
    function makePlayer(color, existingAnchor) {
        return {
            color, damage: 0, collisionPenaltyMs: 0, pendingRepair: false,
            carContacts: new Set(), wallContact: false, pendingCollisionPenaltyEvents: [],
            finished: false, time: null, lap: 0, checkpointA: false, inFinishZone: false,
            trackIndex: 0, tyreWear: 0, pitGoTimer: null, pitting: false, pitPhase: null,
            pitGoTime: null, pendingCompound: null, hasPitted: false, pitPenalty: false,
            falseStart: false, falseStartServed: false, gapToLeaderMs: null,
            pitAutoState: null, pitPathIndex: 0, inputs: { throttle: 0, brake: 0, steer: 0 },
            pitBoxAnchor: existingAnchor, pitBoxSlot: existingAnchor ? 0 : null
        };
    }
    // "red" ha già un box (come se startQualifying l'avesse assegnato in
    // ordine giocatori 'red' primo -> slot 0); "blue" non ne ha ancora uno
    // (simula un giocatore entrato a qualifica già in corso).
    const preAssignedAnchor = { x: 999, z: 888, tx: 1, tz: 0, fromIdx: 0 };
    const red = makePlayer('red', preAssignedAnchor), blue = makePlayer('blue', null);
    // Griglia di partenza con ORDINE INVERTITO rispetto a prima (blue è
    // arrivato davanti a red in qualifica) — se il bug fosse ancora
    // presente, l'anchor di red cambierebbe per riflettere il nuovo ordine.
    const game = { grid: ['blue', 'red'], players: { red, blue }, track: fakeTrack };

    physics.assignGridSpawns(game);

    assert.deepEqual(red.pitBoxAnchor, preAssignedAnchor, 'il box di red non deve cambiare, anche se la sua posizione in griglia è cambiata');
    assert.ok(blue.pitBoxAnchor, 'blue (senza anchor pregresso) ne riceve comunque uno nuovo come fallback');
});

test('collisionDamageAmount: proporzionale alla severità, cappato a DAMAGE_CAP_PER_HIT', () => {
    const { physics } = f1GameSocket;
    assert.ok(Math.abs(physics.collisionDamageAmount(1) - 6) < 1e-9, 'atteso 6% a severità=1 (soglia)');
    assert.equal(physics.collisionDamageAmount(10), 25, 'atteso cap a 25%');
    assert.equal(physics.collisionDamageAmount(-10), 25, 'atteso valore assoluto, cap a 25%');
});

test('applyCarCollisionDamage: chi si avvicina di più è il colpevole, prende danno pieno + penalità; la vittima solo una frazione, nessuna penalità', () => {
    const { physics } = f1GameSocket;
    const a = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    const b = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    // a ferma (avn=0), b si avvicina forte (bvn=-5 => closingB=5)
    physics.applyCarCollisionDamage(a, b, 0, -5, 5);

    // Danno totale invariato (25, cappato) ma ora distribuito per componente:
    // il colpevole (tampona col muso) prende l'80% su frontWing e il 20% su
    // suspension, quindi il danno "generale" (massimo dei componenti) è la
    // quota frontWing.
    assert.ok(Math.abs(b.damageParts.frontWing - 20) < 1e-9, 'colpevole: 80% del danno pieno su frontWing');
    assert.ok(Math.abs(b.damageParts.suspension - 5) < 1e-9, 'colpevole: 20% del danno pieno su suspension');
    assert.ok(Math.abs(b.damage - 20) < 1e-9, 'p.damage derivato = massimo dei componenti (frontWing)');
    // La vittima (colpita da dietro) prende solo la frazione VICTIM_DAMAGE_FRACTION
    // (0.18), distribuita 60% motore / 40% fondo.
    assert.ok(Math.abs(a.damageParts.engine - 25 * 0.18 * 0.6) < 1e-9, 'vittima: 60% della frazione su engine');
    assert.ok(Math.abs(a.damageParts.floor - 25 * 0.18 * 0.4) < 1e-9, 'vittima: 40% della frazione su floor');
    assert.ok(Math.abs(a.damage - 25 * 0.18 * 0.6) < 1e-9, 'p.damage derivato = massimo dei componenti (engine)');
    assert.ok(b.collisionPenaltyMs > 0, 'colpevole penalizzato');
    assert.equal(a.collisionPenaltyMs, 0, 'vittima mai penalizzata');
    assert.equal(b.pendingCollisionPenaltyEvents.length, 1, 'evento di notifica accodato per il colpevole');
});

test('applyBarrierDamage: solo danno, nessuna penalità, nessuna vittima', () => {
    const { physics } = f1GameSocket;
    const p = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    physics.applyBarrierDamage(p, 3);
    assert.ok(p.damage > 0, 'danno aumentato da zero');
    assert.ok(Math.abs(p.damageParts.frontWing - 7.2) < 1e-9, '40% del danno su frontWing');
    assert.ok(Math.abs(p.damageParts.suspension - 5.4) < 1e-9, '30% del danno su suspension');
    assert.ok(Math.abs(p.damageParts.floor - 5.4) < 1e-9, '30% del danno su floor');
    assert.equal(p.collisionPenaltyMs, 0, 'nessuna penalità da barriera');
    assert.equal(p.pendingCollisionPenaltyEvents.length, 0);
});

test('applyCollisionPenalty: ms cappato a COLLISION_PENALTY_CAP_MS, accumula su più chiamate', () => {
    const { physics } = f1GameSocket;
    const p = { collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    physics.applyCollisionPenalty(p, 100);   // severità enorme, deve cappare
    assert.equal(p.collisionPenaltyMs, physics.COLLISION_PENALTY_CAP_MS);
    physics.applyCollisionPenalty(p, 1);   // severità minima valida (soglia)
    assert.ok(p.collisionPenaltyMs > physics.COLLISION_PENALTY_CAP_MS, 'seconda chiamata si accumula, non sostituisce');
    assert.equal(p.pendingCollisionPenaltyEvents.length, 2);
});

test('damage non supera mai 100 (per componente e nello scalare derivato)', () => {
    const { physics } = f1GameSocket;
    const a = { damage: 95, damageParts: { frontWing: 95, floor: 95, engine: 95, suspension: 95 }, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    const b = { damage: 95, damageParts: { frontWing: 95, floor: 95, engine: 95, suspension: 95 }, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    physics.applyCarCollisionDamage(a, b, 0, -10, 10);
    assert.ok(b.damageParts.frontWing <= 100 && b.damageParts.suspension <= 100, 'componenti del colpevole clampati a 100');
    assert.ok(a.damageParts.engine <= 100 && a.damageParts.floor <= 100, 'componenti della vittima clampati a 100');
    assert.ok(b.damage <= 100 && a.damage <= 100, 'scalare derivato mai sopra 100');
});

function makeCollisionPlayer(x, z, angle, vx, vz, color) {
    return {
        color, x, z, angle, vx, vz, speed: Math.hypot(vx, vz),
        damage: 0, collisionPenaltyMs: 0, carContacts: new Set(),
        pendingCollisionPenaltyEvents: []
    };
}

// Offset in z scelto perché il MTV (asse di overlap minimo) del SAT sia
// davvero l'asse z (direzione di marcia), non l'asse x (fianchi): con due
// auto quasi impilate (offset piccolo) l'overlap laterale (fianchi,
// CAR_HALF_WIDTH*2 = 3.48) è più piccolo di quello lungo z, e il rimbalzo
// verrebbe risolto lungo x — dove le velocità di questo test (tutte lungo
// z) hanno componente zero, mascherando qualunque urto. Con questo offset
// (3.7, appena sopra CAR_HALF_WIDTH*2) l'overlap lungo z scende sotto quello
// laterale e il SAT sceglie correttamente l'asse z.
test('resolveCollisions: nuovo urto violento applica danno al colpevole + penalità, danno minore alla vittima', () => {
    const { physics } = f1GameSocket;
    // a ferma, b arriva veloce lungo z e la centra in pieno (stesso orientamento, sovrapposte in x/z)
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 8, 'b');   // avvicinamento forte lungo z

    physics.resolveCollisions([a, b]);

    assert.ok(b.damage > 0, 'colpevole danneggiato');
    assert.ok(a.damage > 0, 'vittima comunque danneggiata (frazione minore)');
    assert.ok(a.damage < b.damage, 'la vittima prende meno danno del colpevole');
    assert.ok(b.collisionPenaltyMs > 0, 'colpevole penalizzato');
    assert.equal(a.collisionPenaltyMs, 0, 'vittima mai penalizzata');
});

test('resolveCollisions: stesso contatto sostenuto per più tick NON riapplica danno (evento singolo)', () => {
    const { physics } = f1GameSocket;
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 8, 'b');

    physics.resolveCollisions([a, b]);
    const damageAfterFirst = b.damage;
    physics.resolveCollisions([a, b]);   // stesso stato, ancora sovrapposte: nessun nuovo evento

    assert.equal(b.damage, damageAfterFirst, 'nessun danno aggiuntivo finché il contatto resta lo stesso');
});

test('resolveCollisions: contatto leggero sotto soglia non danneggia nessuno', () => {
    const { physics } = f1GameSocket;
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 0.05, 'b');   // avvicinamento quasi nullo, stesso asse z del test sopra

    physics.resolveCollisions([a, b]);

    assert.equal(a.damage, 0);
    assert.equal(b.damage, 0);
});

// ---- Immunità box (Rif. richiesta utente 2026-08-07: un'auto ferma ai box
// (pitting) non deve mai essere spinta/danneggiata da un'altra auto — zona
// protetta, come un box reale) ----
test('resolveCollisions: un\'auto ferma ai box (pitting) NON viene spinta né danneggiata da un urto violento', () => {
    const { physics } = f1GameSocket;
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    a.pitting = true;
    const originalX = a.x, originalZ = a.z;
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 8, 'b');   // urto violento verso a, come il test sopra

    physics.resolveCollisions([a, b]);

    assert.equal(a.x, originalX, 'la posizione dell\'auto ferma ai box non deve mai cambiare');
    assert.equal(a.z, originalZ, 'la posizione dell\'auto ferma ai box non deve mai cambiare');
    assert.equal(a.damage, 0, 'nessun danno all\'auto ferma ai box');
    assert.equal(b.damage, 0, 'nessun danno neanche a chi la urta (coppia saltata del tutto)');
    assert.equal(a.vx, 0, 'nessun impulso di velocità sull\'auto ferma ai box');
});

test('resolveCollisions: due auto entrambe pitting non interagiscono tra loro', () => {
    const { physics } = f1GameSocket;
    const a = makeCollisionPlayer(0, 0, 0, 0, 0, 'a');
    a.pitting = true;
    const b = makeCollisionPlayer(0, -3.7, 0, 0, 0, 'b');
    b.pitting = true;

    physics.resolveCollisions([a, b]);

    assert.equal(a.damage, 0);
    assert.equal(b.damage, 0);
});

function makeBarrierTrack() {
    // 3 punti allineati lungo z (bridge:true): servono almeno 3 punti perché
    // normalAt/tangentAt calcolino una tangente/normale reale dal vicino
    // precedente/successivo — con un solo punto la tangente sarebbe (0,0)
    // (degenere) e vn sarebbe sempre 0, mascherando qualunque danno a
    // prescindere dalla logica sotto test. Con questi 3 punti, il punto più
    // vicino a (15,0) è l'indice 1 (0,0), e la tangente lì punta lungo z →
    // normale lungo x, coerente con uno sconfinamento laterale in x.
    return {
        points: [
            { x: 0, z: -10, bridge: true },
            { x: 0, z: 0,   bridge: true },
            { x: 0, z: 10,  bridge: true }
        ],
        roadHalf: 10
    };
}

test('applyBarrier: nuovo urto contro il muro in gara applica danno (nessuna penalità)', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    // Fuori dal limite (roadHalf + margine), spinta forte verso l'esterno lungo x.
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    physics.applyBarrier(p, track, true);

    assert.ok(p.damage > 0, 'atteso danno da impatto col muro');
    assert.equal(p.collisionPenaltyMs, 0, 'nessuna penalità da barriera');
});

test('applyBarrier: in qualifica (isRace=false) il muro frena comunque ma non danneggia', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    physics.applyBarrier(p, track, false);

    assert.equal(p.damage, 0, 'nessun danno in qualifica');
    assert.ok(p.x < 15, 'il muro riporta comunque la posizione sul bordo (fisica invariata)');
});

test('applyBarrier: senza 3° argomento (retrocompatibile con f1LapSimulator/f1RaceLineOptimizer) non lancia e non danneggia', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    assert.doesNotThrow(() => physics.applyBarrier(p, track));
    assert.equal(p.damage, 0);
});

// Pista circolare tutta a terra, col profilo del muro come lo calcola il
// server: serve a verificare che il muro esista anche fuori dai ponti.
function makeClosedTrack({ muro = 15, varco = [] } = {}) {
    const points = [];
    for (let i = 0; i < 200; i++) {
        const a = i / 200 * Math.PI * 2;
        points.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, y: 0, bridge: false });
    }
    const banda = new Float64Array(200).fill(muro);
    return {
        points, roadHalf: 11,
        barrierProfile: { left: banda, right: banda },
        pitGapPts: varco,
    };
}

test('applyBarrier: il muro trattiene l\'auto anche fuori dai ponti', () => {
    const { physics } = f1GameSocket;
    const track = makeClosedTrack();
    // Ben oltre il muro (raggio 115), spinta verso l'esterno.
    const p = {
        x: 130, z: 0, angle: 0, speed: 5, vx: 5, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(p, track, false);

    // Muro a 115, auto di fianco: si ferma la FIANCATA, quindi il centro sta
    // mezza larghezza più in qua (1.74).
    const distanza = Math.hypot(p.x, p.z);
    assert.ok(Math.abs(distanza - (115 - 1.74)) < 0.5,
        `l'auto va appoggiata al muro con la fiancata (113.26), sta a ${distanza.toFixed(1)}`);
    assert.ok(p.vx < 5, 'la spinta verso l\'esterno è stata smorzata');
});

test('applyBarrier: si ferma la MACCHINA, non il suo centro', () => {
    // Segnalato in gioco il 2026-08-12: "mezza macchina ci passa e poi si
    // blocca". Il muro vincolava il centro dell'auto e ignorava il suo
    // ingombro, mentre le collisioni fra auto usano da sempre il rettangolo
    // orientato. Con l'auto di muso contro il muro, metà lunghezza — 3.58
    // unità, più di mezza vettura — finiva oltre.
    const { physics } = f1GameSocket;
    const track = makeClosedTrack();          // muro a 115 dal centro pista
    const p = {
        // angle = PI/2: il muso punta lungo +x, cioè dritto contro il muro.
        x: 130, z: 0, angle: Math.PI / 2, speed: 5, vx: 5, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(p, track, false);

    const centro = Math.hypot(p.x, p.z);
    const muso = centro + 3.58;               // CAR_HALF_LENGTH, di muso
    assert.ok(muso <= 115.1,
        `il muso sfonda il muro di ${(muso - 115).toFixed(2)} unità (centro a ${centro.toFixed(1)})`);

    // Di fianco l'auto è più stretta e deve poter arrivare più vicina: se si
    // fermasse sempre alla stessa distanza, resterebbe un vuoto visibile fra
    // fiancata e muro.
    const q = {
        x: 130, z: 0, angle: 0, speed: 5, vx: 5, vz: 0,   // muso lungo +z, fianco al muro
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(q, track, false);
    const centroDiFianco = Math.hypot(q.x, q.z);
    assert.ok(centroDiFianco > centro + 1,
        `di fianco deve avvicinarsi di più: ${centroDiFianco.toFixed(1)} contro ${centro.toFixed(1)}`);
    assert.ok(centroDiFianco + 1.74 <= 115.1, 'ma la fiancata non sfonda');
});

test('applyBarrier: dove il muro è più lontano l\'auto non lo tocca', () => {
    const { physics } = f1GameSocket;
    const track = makeClosedTrack({ muro: 45 });
    const p = {
        x: 130, z: 0, angle: 0, speed: 5, vx: 5, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(p, track, false);
    assert.ok(Math.abs(p.x - 130) < 1e-6, 'con la via di fuga larga il muro è oltre: nessuno spostamento');
});

test('applyBarrier: nel varco della corsia box non c\'è muro', () => {
    const { physics } = f1GameSocket;
    // Varco proprio dove sta l'auto del test: la soglia si misura dalla
    // posizione dell'auto, non dal muro.
    const track = makeClosedTrack({ varco: [{ x: 127, z: 0 }] });
    const p = {
        x: 130, z: 0, angle: 0, speed: 5, vx: 5, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(p, track, false);
    assert.ok(Math.abs(p.x - 130) < 1e-6, 'nel varco si passa');
});

test('applyBarrier: senza profilo (editor, test storici) vale solo sui ponti, come prima', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();       // tratto a ponte, nessun barrierProfile
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(p, track, false);
    assert.ok(p.x < 15, 'sul ponte il muro c\'è comunque');

    // Stessa pista ma a terra: senza profilo non c'è muro da nessuna parte.
    const aTerra = makeBarrierTrack();
    for (const pt of aTerra.points) pt.bridge = false;
    const q = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };
    physics.applyBarrier(q, aTerra, false);
    assert.equal(q.x, 15, 'senza profilo e fuori dai ponti si comporta come prima');
});

// ASSERZIONE CAPOVOLTA il 2026-08-23: prima diceva «in qualifica il danno non
// deve avere effetto». Serviva alle stagioni, dove al giro secco si arriva con
// la macchina con cui si è finita la gara precedente — ma la regola giusta non
// è «tranne in stagione»: è che chi decide se c'è danno è chi riempie
// damageParts, non la formula. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
test('effectiveMaxSpeed: il danno al motore riduce la velocità massima, in gara come in qualifica', () => {
    const { physics } = f1GameSocket;
    const pDanneggiato = { tyreWear: 0, compound: 'medium', damageParts: { engine: 100, frontWing: 0, floor: 0, suspension: 0 } };
    const pIlleso       = { tyreWear: 0, compound: 'medium', damageParts: { engine: 0, frontWing: 0, floor: 0, suspension: 0 } };

    const raceDanneggiato = physics.effectiveMaxSpeed(pDanneggiato, false);
    const raceIlleso      = physics.effectiveMaxSpeed(pIlleso, false);
    assert.ok(raceDanneggiato < raceIlleso, 'in gara il danno al motore deve rallentare');

    const qualiDanneggiato = physics.effectiveMaxSpeed(pDanneggiato, true);
    const qualiIlleso      = physics.effectiveMaxSpeed(pIlleso, true);
    assert.ok(qualiDanneggiato < qualiIlleso, 'anche in qualifica il danno al motore deve rallentare');
});

test("effectiveGrip: il danno al fondo riduce l'aderenza in modo proporzionale, nessuna soglia", () => {
    const { physics } = f1GameSocket;
    const pIlleso = { tyreWear: 0, compound: 'medium', damageParts: { engine: 0, frontWing: 0, floor: 0, suspension: 0 } };
    const pLieve  = { tyreWear: 0, compound: 'medium', damageParts: { engine: 0, frontWing: 0, floor: 10, suspension: 0 } };
    const pGrave  = { tyreWear: 0, compound: 'medium', damageParts: { engine: 0, frontWing: 0, floor: 90, suspension: 0 } };

    assert.ok(physics.effectiveGrip(pLieve, false) < physics.effectiveGrip(pIlleso, false),
        'già a basso danno al fondo, aderenza ridotta (nessuna soglia netta)');
    assert.ok(physics.effectiveGrip(pGrave, false) < physics.effectiveGrip(pLieve, false),
        'più danno al fondo, più aderenza ridotta');
});

test('effectiveAccel: il danno al motore riduce anche l\'accelerazione, non solo la velocità massima', () => {
    const { physics } = f1GameSocket;
    const pDanneggiato = { tyreWear: 0, compound: 'medium', damageParts: { engine: 100, frontWing: 0, floor: 0, suspension: 0 } };
    const pIlleso       = { tyreWear: 0, compound: 'medium', damageParts: { engine: 0, frontWing: 0, floor: 0, suspension: 0 } };

    assert.ok(physics.effectiveAccel(pDanneggiato, false) < physics.effectiveAccel(pIlleso, false),
        'motore danneggiato: accelerazione ridotta in gara');
    // Capovolta il 2026-08-23, vedi effectiveMaxSpeed sopra.
    assert.ok(physics.effectiveAccel(pDanneggiato, true) < physics.effectiveAccel(pIlleso, true),
        'motore danneggiato: accelerazione ridotta anche in qualifica');
});

test('Simcade: isolamento dei componenti — ala anteriore riduce lo sterzo ma non velocità/accelerazione; motore riduce velocità/accelerazione ma non lo sterzo', () => {
    const { physics } = f1GameSocket;
    const base = { tyreWear: 0, compound: 'medium', damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const frontWingDanneggiato = { tyreWear: 0, compound: 'medium', damageParts: { frontWing: 80, floor: 0, engine: 0, suspension: 0 } };
    const engineDanneggiato    = { tyreWear: 0, compound: 'medium', damageParts: { frontWing: 0, floor: 0, engine: 80, suspension: 0 } };

    // Ala all'80%: sottosterzo marcato, ma velocità/accelerazione IDENTICHE al sano.
    assert.ok(physics.getFrontWingSteerPenalty(frontWingDanneggiato.damageParts) > 0, 'ala danneggiata: penalità sterzo attiva');
    assert.ok(Math.abs(physics.effectiveMaxSpeed(frontWingDanneggiato, false) - physics.effectiveMaxSpeed(base, false)) < 1e-9,
        'ala danneggiata: MAX_SPEED invariata');
    assert.ok(Math.abs(physics.effectiveAccel(frontWingDanneggiato, false) - physics.effectiveAccel(base, false)) < 1e-9,
        'ala danneggiata: accelerazione invariata');

    // Motore all'80%: velocità/accelerazione ridotte, ma sterzo IDENTICO al sano.
    assert.ok(physics.effectiveMaxSpeed(engineDanneggiato, false) < physics.effectiveMaxSpeed(base, false),
        'motore danneggiato: MAX_SPEED ridotta');
    assert.ok(physics.effectiveAccel(engineDanneggiato, false) < physics.effectiveAccel(base, false),
        'motore danneggiato: accelerazione ridotta');
    assert.ok(Math.abs(physics.getFrontWingSteerPenalty(engineDanneggiato.damageParts) - physics.getFrontWingSteerPenalty(base.damageParts)) < 1e-9,
        'motore danneggiato: penalità sterzo invariata (zero in entrambi i casi)');
});

test('buildPublicState: espone anche damageParts (per evoluzioni future HUD)', () => {
    const { physics } = f1GameSocket;
    const parts = { frontWing: 10, floor: 20, engine: 30, suspension: 40 };
    const players = {
        red: {
            x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, finished: false, time: null, lap: 0,
            compound: 'medium', tyreWear: 0, damage: 40, damageParts: parts, collisionPenaltyMs: 0,
            pitAutoState: null, falseStart: false, falseStartServed: false,
            gapToLeaderMs: null, isBot: false, inSlipstream: false,
            inputs: { throttle: 0, brake: 0, steer: 0 }
        }
    };
    const track = { points: [{ x: 0, z: 0 }] };
    const state = physics.buildPublicState(players, false, track, { raceTick: 0 });
    assert.deepEqual(state.red.damageParts, parts);
});

test('applyDamageSteerNoise: zero sotto soglia o in qualifica, non-zero sopra soglia in gara', () => {
    const { physics } = f1GameSocket;
    const rngAlways1 = () => 1;   // rng deterministico, sempre al massimo dell'intervallo

    assert.equal(physics.applyDamageSteerNoise({ damage: 10 }, false, rngAlways1), 0, 'sotto soglia, nessun rumore');
    assert.equal(physics.applyDamageSteerNoise({ damage: 90 }, true, rngAlways1), 0, 'in qualifica, nessun rumore');
    const noise = physics.applyDamageSteerNoise({ damage: 90 }, false, rngAlways1);
    assert.ok(noise !== 0, 'sopra soglia in gara, rumore non nullo');
    assert.ok(Math.abs(noise) <= physics.DAMAGE_STEER_NOISE_MAX, 'rumore entro il massimo dichiarato');
});

test('buildPublicState: espone damage e collisionPenalty (bool) per giocatore', () => {
    const { physics } = f1GameSocket;
    const players = {
        red: {
            x: 0, z: 0, angle: 0, trackIndex: 0, speed: 0, finished: false, time: null, lap: 0,
            compound: 'medium', tyreWear: 0, damage: 42, collisionPenaltyMs: 1500,
            damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
            pitAutoState: null, falseStart: false, falseStartServed: false,
            gapToLeaderMs: null, isBot: false, inSlipstream: false,
            inputs: { throttle: 0, brake: 0, steer: 0 }
        }
    };
    const track = { points: [{ x: 0, z: 0 }] };
    const state = physics.buildPublicState(players, false, track, { raceTick: 0 });

    assert.equal(state.red.damage, 42);
    assert.equal(state.red.collisionPenalty, true);
});

function makeMockIo() {
    return { to: () => ({ emit: () => {} }) };
}

test('checkLap: con startFinishIndex non-zero, la zona traguardo e il checkpoint si spostano di conseguenza (non restano fissi a 0/500)', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = {
        points,
        lapLength: n, // 1 unità per campione, così checkpointWindowFor/finishWindowFor restano piccoli e prevedibili
        startFinishIndex
    };
    const game = { track };
    const io = makeMockIo();

    // Il giocatore parte esattamente al traguardo esplicito (300), tocca il
    // checkpoint a metà giro RELATIVO (300+500=800, non il fisso 500) e poi
    // rientra nella zona traguardo (300): un giro deve contare.
    const p = { color: 'red', lap: 0, trackIndex: startFinishIndex, checkpointA: false, inFinishZone: false };
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 0, 'non deve contare un giro solo stando fermi al traguardo (nessun checkpoint toccato)');

    p.trackIndex = (startFinishIndex + physics.HALF_LAP_IDX) % n; // 800
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.checkpointA, true, 'checkpoint a metà giro relativo deve scattare');

    p.trackIndex = startFinishIndex; // torna a 300
    p.inFinishZone = false; // simula "appena entrato" nella zona
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 1, 'giro completato tornando al traguardo esplicito (300), non a 0');
});

test('checkLap: senza startFinishIndex (pista senza startFinish, comportamento odierno), traguardo resta indice 0', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const track = { points, lapLength: n }; // startFinishIndex assente, come le piste esistenti
    const game = { track };
    const io = makeMockIo();

    const p = { color: 'red', lap: 0, trackIndex: 0, checkpointA: false, inFinishZone: false };
    p.trackIndex = physics.HALF_LAP_IDX;
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.checkpointA, true);

    p.trackIndex = 0;
    p.inFinishZone = false;
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 1);
});

test('checkLap: tempo finale interpola la frazione esatta di tick in cui si attraversa il traguardo, non arrotonda al bordo del tick da 50ms', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 })); // rettilineo lungo x, tangente (1,0) in ogni punto interno
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20 };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 9, checkpointA: true, inFinishZone: false,
        trackIndex: startFinishIndex,
        // Attraversamento esattamente a metà tra la posizione dell'inizio
        // tick (prevX, prima della linea a x=300) e quella di fine tick
        // (x, dopo la linea): il traguardo (x=300) cade a metà strada.
        prevX: 299.5, prevZ: 0, x: 300.5, z: 0
    };
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.lap, 10);
    assert.equal(p.finished, true);
    // raceTick=20 -> il tick copre l'intervallo [950,1000]ms; attraversamento
    // a metà -> 975ms, non 1000ms (game.raceTick * 50 puro).
    assert.equal(p.time, 975);
});

test('checkLap: senza prevX/prevZ (compatibilità con chiamate esistenti), il tempo finale resta il vecchio raceTick*PHYSICS_TICK_MS', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20 };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 9, checkpointA: true, inFinishZone: false,
        trackIndex: startFinishIndex
    };
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.finished, true);
    assert.equal(p.time, 1000);
});

// ---- Chiusura sessione rimandata (Rif. richiesta utente 2026-08-07: bug
// reale trovato con una simulazione dinamica — un bot poteva diventare
// "finished" mentre era ancora in manovra ai box (entrata/sosta/uscita),
// facendogli smettere per sempre di ricevere input IA e restare bloccato
// a metà manovra) ----
test('checkLap: se l\'ultimo giro si chiude mentre l\'auto è in autopilota (pitAutoState), NON diventa finished subito — rimanda con pendingFinishTime', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20, phase: 'race' };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 9, checkpointA: true, inFinishZone: false, finished: false, time: null,
        trackIndex: startFinishIndex, pitAutoState: 'entering', pitting: false,
        hasPitted: false, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0
    };
    physics.checkLap(p, 10, io, 'lobby1', game);

    assert.equal(p.finished, false, 'NON deve diventare finished mentre è ancora in autopilota ai box');
    assert.equal(p.time, null, 'il tempo finale non deve essere impostato finché non è davvero libera');
    assert.equal(p.pendingFinishTime, 1000, 'il momento del vero attraversamento resta memorizzato per dopo');
});

test('checkLap: se l\'ultimo giro si chiude mentre l\'auto è ferma ai box (pitting), NON diventa finished subito', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20, phase: 'race' };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 9, checkpointA: true, inFinishZone: false, finished: false, time: null,
        trackIndex: startFinishIndex, pitAutoState: null, pitting: true,
        hasPitted: false, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0
    };
    physics.checkLap(p, 10, io, 'lobby1', game);

    assert.equal(p.finished, false);
    assert.equal(p.pendingFinishTime, 1000);
});

test('resolvePendingFinish: nessun effetto finché l\'auto resta in autopilota o ferma ai box', () => {
    const { physics } = f1GameSocket;
    const game = { phase: 'race' };
    const io = makeMockIo();

    const p1 = { color: 'a', pendingFinishTime: 5000, pitAutoState: 'exiting', pitting: false, finished: false, time: null, hasPitted: true, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0 };
    physics.resolvePendingFinish(p1, game, io, 'lobby1');
    assert.equal(p1.finished, false);
    assert.equal(p1.pendingFinishTime, 5000, 'resta in sospeso, non consumato');

    const p2 = { color: 'b', pendingFinishTime: 5000, pitAutoState: null, pitting: true, finished: false, time: null, hasPitted: true, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0 };
    physics.resolvePendingFinish(p2, game, io, 'lobby1');
    assert.equal(p2.finished, false);
});

test('resolvePendingFinish: chiude la sessione (finished+time) non appena l\'auto è DAVVERO libera (né autopilota né pitting)', () => {
    const { physics } = f1GameSocket;
    const game = { phase: 'race' };
    const io = makeMockIo();

    const p = {
        color: 'red', pendingFinishTime: 5000, pitAutoState: null, pitting: false,
        finished: false, time: null, hasPitted: true, falseStart: false, falseStartServed: false, collisionPenaltyMs: 0
    };
    physics.resolvePendingFinish(p, game, io, 'lobby1');
    // finalizeSessionFinish arma un vero setTimeout di sicurezza (60s,
    // endRace) quando game.phase==='race' — va ripulito subito, stesso
    // pattern già in uso altrove in questo file per pitGoTimer.
    if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }

    assert.equal(p.finished, true);
    assert.equal(p.time, 5000, 'il tempo finale è quello del VERO attraversamento del traguardo, non di adesso');
    assert.equal(p.pendingFinishTime, null, 'consumato dopo la risoluzione');
});

test('resolvePendingFinish: nessun effetto se non c\'è nulla in sospeso (no-op sicuro per il caso normale)', () => {
    const { physics } = f1GameSocket;
    const game = { phase: 'race' };
    const io = makeMockIo();
    const p = { color: 'red', pendingFinishTime: null, pitAutoState: null, pitting: false, finished: false, time: null };
    physics.resolvePendingFinish(p, game, io, 'lobby1');
    assert.equal(p.finished, false);
});

test('checkLap: caso REALE — finishWindowFor è larga diversi metri, "appena entrato in zona" scatta PRIMA della vera linea, il tempo va estrapolato oltre il bordo del tick (frazione > 1), non prima', () => {
    // Bug trovato simulando una sessione vera end-to-end (non dal test sopra,
    // che aveva l'attraversamento e l'ingresso finestra coincidenti nello
    // stesso tick per costruzione — caso raro nella realtà). Qui l'auto è
    // ENTRATA nella finestra (idx=295, dentro il margine di finishWindowFor)
    // ma è ancora 5 unità (prevX=293) / 3 unità (x=296) PRIMA della vera
    // linea (300): il vecchio codice avrebbe timbrato il tempo qui, troppo
    // presto. La frazione corretta stima quanti tick servono ANCORA, alla
    // velocità di questo tick, per raggiungere davvero la linea.
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20 };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 9, checkpointA: true, inFinishZone: false,
        trackIndex: 295,   // dentro finishWindowFor (finestra di alcune unità attorno a 300)
        prevX: 293, prevZ: 0, x: 296, z: 0   // moto di 3 unità/tick verso la linea (300), ancora non raggiunta
    };
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.finished, true);
    // s0=-7, s1=-4, denom=3, t=7/3 -> tempo = (19 + 7/3)*50 = 1066.67 -> 1067ms
    assert.equal(p.time, 1067);
    // Sopra al vecchio raceTick*PHYSICS_TICK_MS (1000ms): la vera linea viene
    // raggiunta DOPO il tick di ingresso finestra, mai prima.
    assert.ok(p.time > game.raceTick * physics.PHYSICS_TICK_MS);
});

test('checkLap: estrapolazione fuori da ogni limite plausibile (>40 tick) ricade sul vecchio comportamento, mai un numero inventato', () => {
    const { physics } = f1GameSocket;
    const n = 1000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
    const startFinishIndex = 300;
    const track = { points, lapLength: n, startFinishIndex };
    const game = { track, raceTick: 20 };
    const io = makeMockIo();

    const p = {
        color: 'red', lap: 9, checkpointA: true, inFinishZone: false,
        trackIndex: 295,
        // Spostamento di 1 unità/tick da molto lontano (s0=-101): servirebbero
        // >40 tick per raggiungere la linea, oltre il limite di fiducia.
        prevX: 198, prevZ: 0, x: 199, z: 0
    };
    physics.checkLap(p, 10, io, 'lobby1', game);
    assert.equal(p.finished, true);
    assert.equal(p.time, 1000);
});

// ---- Fase 4 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// migrazione scia — solo il calcolo del moltiplicatore, non la ricerca del gap ----
const AerodynamicsModel = require('./physics/AerodynamicsModel');

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL non impostato -> formula storica invariata (gap=12.5 -> 1.04)', () => {
    assert.equal(process.env.F1_AERO_SLIPSTREAM_MODEL, undefined);
    const { physics } = f1GameSocket;
    assert.ok(Math.abs(physics.computeSlipstreamMult(12.5) - 1.04) < 1e-9);
});

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL non impostato, gap grande -> nessun effetto (formula storica)', () => {
    const { physics } = f1GameSocket;
    assert.equal(physics.computeSlipstreamMult(30), 1);
});

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL="1" -> stesso valore di AerodynamicsModel.slipstreamFactor(gapM)', () => {
    const { physics } = f1GameSocket;
    process.env.F1_AERO_SLIPSTREAM_MODEL = '1';
    try {
        assert.equal(physics.computeSlipstreamMult(12.5), AerodynamicsModel.slipstreamFactor(12.5));
        assert.equal(physics.computeSlipstreamMult(0), AerodynamicsModel.slipstreamFactor(0));
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
    }
});

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL="1" -> delega DAVVERO a slipstreamFactor (spy, non una reimplementazione)', () => {
    const { physics } = f1GameSocket;
    const orig = AerodynamicsModel.slipstreamFactor;
    let calls = 0;
    AerodynamicsModel.slipstreamFactor = (gapM) => { calls++; return 42; };
    process.env.F1_AERO_SLIPSTREAM_MODEL = '1';
    try {
        const result = physics.computeSlipstreamMult(12.5);
        assert.equal(calls, 1, 'atteso esattamente una chiamata a slipstreamFactor');
        assert.equal(result, 42, 'atteso il valore restituito dallo spy, non un ricalcolo locale');
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
        AerodynamicsModel.slipstreamFactor = orig;
    }
});

test('computeSlipstreamMult: F1_AERO_SLIPSTREAM_MODEL="1", gap grande (>= 25) -> nessun effetto', () => {
    const { physics } = f1GameSocket;
    process.env.F1_AERO_SLIPSTREAM_MODEL = '1';
    try {
        assert.equal(physics.computeSlipstreamMult(30), 1);
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
    }
});

// ---- Review finale (Fix 3): autopilota pit-stop a due tratti, per non
// tagliare la curva della corsia box su pitBoxIndex ----
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

test('updatePitAutopilot: con una piega di 90° esattamente su pitBoxIndex, l\'ingresso verso l\'anchor personale resta vicino alla corsia (non taglia la curva)', () => {
    const { physics } = f1GameSocket;

    // Corsia box a L: piega di 90° ESATTAMENTE nel punto pitBoxIndex (1) —
    // lo scenario worst-case descritto dalla review finale (misurato fino
    // a 32° su baku.json; qui esagerato a 90° per un margine di sicurezza
    // netto nell'asserzione).
    const pitPath = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 50, z: 50 }];
    const pitBoxIndex = 1;
    const roadHalfWidth = 3.5;

    // Slot fuori centro (indice 2 su 3, il più lontano dal vertice): con la
    // vecchia logica (salto diretto da un waypoint lontano all'anchor,
    // saltando l'intero vertice) è esattamente lo slot che tagliava di più
    // la curva — vedi backend/sockets/games/f1GameSocket.js pre-fix e lo
    // script di verifica in docs/superpowers/sdd/.../final-review-fix-report.md.
    const anchor = TrackGeometry.pitBoxAnchors(pitPath, pitBoxIndex, 3)[2];
    const sampledPitPts = TrackGeometry.sampleOpenPath(pitPath, 300);   // per misurare la distanza dalla vera sede stradale
    // L'autopilota cammina sulla corsia CAMPIONATA (track.pitLanePts, vedi
    // trackLoader.buildTrack) e localizza il box con anchor.laneIdx, indice
    // su quella stessa numerazione: qui la fixture riproduce entrambi.
    anchor.laneIdx = TrackGeometry.nearestPoint(sampledPitPts, anchor.x, anchor.z).index;

    const fakeTrack = { pitPath, pitLanePts: sampledPitPts, pitBoxIndex, roadHalfWidth };
    const io = { to: () => ({ emit: () => {} }) };
    const game = { track: fakeTrack, socketByColor: {} };

    // Il giocatore entra nella corsia box: pitPathIndex parte da 1 (il
    // waypoint 0 è il punto di distacco, dove più o meno si trova già —
    // vedi startPitLaneEntry), posizione iniziale vicino a pitPath[0].
    const p = {
        color: 'red', x: 0, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,
        pitAutoState: 'entering', pitPathIndex: 1, pitBoxFinalApproach: false,
        pitBoxAnchor: anchor, pitting: false, pitPhase: null
    };

    const tolerance = roadHalfWidth + 1;   // stessa tolleranza indicata nel piano di fix
    let maxDeviation = 0;
    let ticks = 0;
    // Fino a quando l'autopilota di INGRESSO non ha finito (diventa 'null' e
    // avvia la sosta, vedi startPitStop) o al massimo 500 tick di sicurezza.
    while (p.pitAutoState === 'entering' && ticks < 500) {
        physics.updatePitAutopilot(io, 'testLobby', game, p);
        const nearest = TrackGeometry.nearestPoint(sampledPitPts, p.x, p.z);
        maxDeviation = Math.max(maxDeviation, nearest.dist);
        ticks++;
    }
    // startPitStop (chiamata dall'ultimo tick sopra) arma un vero
    // setTimeout casuale (PIT_GO_DELAY_MIN..MAX): va ripulito subito, non
    // deve restare pendente dopo la fine del test.
    if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }

    assert.ok(ticks < 500, 'autopilota non ha mai raggiunto la casella (loop infinito?)');
    assert.ok(p.pitting, 'atteso che la sosta sia partita (arrivo confermato all\'anchor)');
    assert.ok(maxDeviation <= tolerance,
        `l'auto si è allontanata ${maxDeviation.toFixed(2)} unità dalla corsia box (tolleranza ${tolerance}) — sintomo esatto del bug pre-fix: taglio diretto della curva su pitBoxIndex`);
});

// ---- Fix "avanti-indietro" (segnalato in playtest, 2026-08-04): un box
// PRIMA di pitBoxIndex nel verso di marcia non deve mai far superare il
// proprio box all'auto per poi farla tornare indietro ----
test('updatePitAutopilot: un pilota col box PRIMA di pitBoxIndex si ferma lì senza mai proseguire fino al vertice condiviso', () => {
    const { physics } = f1GameSocket;

    // Corsia box dritta, waypoint ogni 10 unità: pitBoxIndex a metà (5).
    const pitPath = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, z: 0 }));
    const pitBoxIndex = 5;
    const roadHalfWidth = 3.5;

    // Slot 0 su 3: offset negativo (mid=1 -> (0-1)*24=-24), il box
    // personale finisce PRIMA di pitBoxIndex lungo il verso di marcia —
    // esattamente il caso che con la vecchia logica (target fisso
    // pitPath[pitBoxIndex]) costringeva l'auto a superare il proprio box e
    // poi tornare indietro nel balzo finale.
    const anchor = TrackGeometry.pitBoxAnchors(pitPath, pitBoxIndex, 3)[0];
    assert.ok(anchor.fromIdx < pitBoxIndex, 'precondizione del test: il box deve trovarsi prima del vertice');

    // Corsia campionata + laneIdx: è su quella numerazione che l'autopilota
    // cammina e riconosce il proprio box (vedi trackLoader.buildTrack).
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    anchor.laneIdx = TrackGeometry.nearestPoint(pitLanePts, anchor.x, anchor.z).index;

    const fakeTrack = { pitPath, pitLanePts, pitBoxIndex, roadHalfWidth };
    const io = { to: () => ({ emit: () => {} }) };
    const game = { track: fakeTrack, socketByColor: {} };

    const p = {
        color: 'red', x: 0, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,
        pitAutoState: 'entering', pitPathIndex: 1, pitBoxFinalApproach: false,
        pitBoxAnchor: anchor, pitting: false, pitPhase: null
    };

    let maxPitPathIndexSeen = p.pitPathIndex;
    let ticks = 0;
    while (p.pitAutoState === 'entering' && ticks < 500) {
        physics.updatePitAutopilot(io, 'testLobby', game, p);
        maxPitPathIndexSeen = Math.max(maxPitPathIndexSeen, p.pitPathIndex);
        ticks++;
    }
    if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }

    assert.ok(ticks < 500, 'autopilota non ha mai raggiunto la casella (loop infinito?)');
    assert.ok(p.pitting, 'atteso che la sosta sia partita');
    // Il confronto è sulla numerazione della corsia CAMPIONATA (dove
    // l'autopilota cammina davvero), non più sui punti di controllo:
    // anchor.laneIdx e anchor.fromIdx indicizzano due sequenze diverse — 300
    // campioni contro 11 vertici — e confonderle qui darebbe un falso
    // fallimento. Il senso del test non cambia: l'auto si ferma al PROPRIO
    // box e non tira dritto fino al vertice condiviso pitBoxIndex.
    const vertexLaneIdx = TrackGeometry.nearestPoint(
        pitLanePts, pitPath[pitBoxIndex].x, pitPath[pitBoxIndex].z).index;
    assert.equal(maxPitPathIndexSeen, anchor.laneIdx,
        `l'autopilota ha camminato fino al campione ${maxPitPathIndexSeen} invece che al proprio box (${anchor.laneIdx})`);
    assert.ok(maxPitPathIndexSeen < vertexLaneIdx,
        `l'autopilota è arrivato al vertice condiviso pitBoxIndex (campione ${vertexLaneIdx}) invece di fermarsi prima, al proprio box`);
});

// ---- Stallo laterale + orientamento parallelo (Rif. richiesta utente
// 2026-08-07, 2° round: "vero stallo", auto ferma parallela al senso di
// marcia, non più sulla linea centrale della corsia) ----
test('updatePitAutopilot: con lo stallo disponibile (trackPoints/pitRoadHalf), l\'auto si ferma sullo STALLO (non più sulla linea centrale) e parallela alla corsia', () => {
    const { physics } = f1GameSocket;

    const pitPath = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }];
    const pitBoxIndex = 2;
    const roadHalfWidth = 5;
    const trackPoints = [{ x: 100, z: 50 }];   // tracciato principale "in su": lo stallo deve andare verso -z

    const anchor = TrackGeometry.pitBoxAnchors(pitPath, pitBoxIndex, 1, trackPoints, roadHalfWidth)[0];
    assert.notEqual(anchor.stallX, undefined, 'precondizione: lo stallo deve essere calcolato con trackPoints/pitRoadHalf');

    // Corsia campionata + laneIdx: è su quella numerazione che l'autopilota
    // cammina e riconosce il proprio box (vedi trackLoader.buildTrack).
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    anchor.laneIdx = TrackGeometry.nearestPoint(pitLanePts, anchor.x, anchor.z).index;

    const fakeTrack = { pitPath, pitLanePts, pitBoxIndex, roadHalfWidth };
    const io = { to: () => ({ emit: () => {} }) };
    const game = { track: fakeTrack, socketByColor: {} };

    const p = {
        color: 'red', x: 0, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,
        pitAutoState: 'entering', pitPathIndex: 1, pitBoxFinalApproach: false,
        pitBoxAnchor: anchor, pitting: false, pitPhase: null
    };

    let ticks = 0;
    while (p.pitAutoState === 'entering' && ticks < 500) {
        physics.updatePitAutopilot(io, 'testLobby', game, p);
        ticks++;
    }
    if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }

    assert.ok(p.pitting, 'atteso che la sosta sia partita');
    assert.ok(Math.abs(p.x - anchor.stallX) < 1e-6 && Math.abs(p.z - anchor.stallZ) < 1e-6,
        `atteso fermo sullo stallo (${anchor.stallX?.toFixed(2)}, ${anchor.stallZ?.toFixed(2)}), trovato (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    assert.ok(Math.hypot(p.x - anchor.x, p.z - anchor.z) > 1,
        'non deve fermarsi più sulla linea centrale della corsia (anchor.x/z), deve essere sullo stallo spostato lateralmente');
    const expectedAngle = Math.atan2(anchor.tx, anchor.tz);
    assert.ok(Math.abs(p.angle - expectedAngle) < 1e-6,
        `atteso angolo parallelo alla corsia (${expectedAngle.toFixed(4)}), trovato ${p.angle.toFixed(4)}`);
});

// ---- Deadlock tra auto in autopilota (Rif. richiesta utente 2026-08-07:
// "due macchine nella corsia dei box si sono unite e hanno iniziato a
// roteare all'infinito") — bug reale trovato SOLO con una simulazione
// dinamica multi-auto (mai visibile in un test a 2 sole auto isolate):
// quando più auto entrano insieme e puntano allo stesso waypoint
// condiviso di pitPath (prima di divergere verso il proprio box), la
// spinta di separazione di resolveCollisions poteva annullare esattamente
// il passo fisso di updatePitAutopilot ad ogni tick, creando un equilibrio
// stabile — le auto restavano bloccate nello stesso punto per sempre ----
test('resolveCollisions + updatePitAutopilot: 4 auto entrate insieme (posizioni sovrapposte) verso 4 box diversi arrivano TUTTE, nessun deadlock', () => {
    const { physics } = f1GameSocket;
    const pitPath = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 150, z: 0 }, { x: 200, z: 0 }];
    const boxIndex = 2;
    const trackPoints = [{ x: 100, z: 50 }];
    const pitRoadHalf = 5;
    const anchors = TrackGeometry.pitBoxAnchors(pitPath, boxIndex, 4, trackPoints, pitRoadHalf);
    // Corsia campionata + laneIdx: è su quella numerazione che l'autopilota
    // cammina e riconosce il proprio box (vedi trackLoader.buildTrack).
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    for (const a of anchors) {
        a.laneIdx = TrackGeometry.nearestPoint(pitLanePts, a.x, a.z).index;
    }

    const io = { to: () => ({ emit: () => {} }) };
    const game = { track: { pitPath, pitLanePts, pitBoxIndex: boxIndex, pitRoadHalf }, socketByColor: {} };

    function makePlayer(color, anchor) {
        return {
            color, x: 5, z: 0, angle: 0, speed: 0, vx: 0, vz: 0,   // TUTTE nella STESSA posizione, come se entrate insieme in gruppo
            pitAutoState: 'entering', pitPathIndex: 1, pitBoxFinalApproach: false,
            pitBoxAnchor: anchor, pitting: false, pitPhase: null,
            damage: 0, collisionPenaltyMs: 0, carContacts: new Set(),
            pendingCollisionPenaltyEvents: []
        };
    }
    const players = anchors.map((a, i) => makePlayer(String.fromCharCode(97 + i), a));

    let ticks = 0;
    while (players.some(p => p.pitAutoState === 'entering') && ticks < 500) {
        for (let s = 0; s < physics.COLLISION_SUBSTEPS; s++) physics.resolveCollisions(players);
        for (const p of players) if (p.pitAutoState === 'entering') physics.updatePitAutopilot(io, 'lobby1', game, p);
        ticks++;
    }
    for (const p of players) if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }

    assert.ok(ticks < 500, `autopilota in deadlock: non tutte le auto sono arrivate entro 500 tick (fermo dopo ${ticks})`);
    for (const p of players) assert.ok(p.pitting, `${p.color} non ha mai raggiunto il proprio box`);
});

// L'autopilota camminava sui punti di CONTROLLO grezzi (7 su "prova"), mentre
// la corsia disegnata è la spline campionata: muovendosi in retta fra un
// controllo e l'altro tagliava le curve. Scarto misurato prima del fix: 3.35
// unità su una semilarghezza di corsia di 5, cioè l'auto passava a 1.65 dal
// bordo ("il pilota automatico non segue esattamente la corsia", utente
// 2026-08-09).
test('l\'autopilota d\'ingresso resta dentro la corsia box su tutte le piste', () => {
    const { physics } = f1GameSocket;
    const trackLoader = require('./trackLoader.js');

    for (const id of ['prova', 'monte-rosso', 'new-monza']) {
        const track = trackLoader.loadTrack(id);
        const anchors = TrackGeometry.pitBoxAnchors(
            track.pitPath, track.pitBoxIndex, 3, track.points, track.pitRoadHalf);
        for (const a of anchors) {
            a.laneIdx = TrackGeometry.nearestPoint(track.pitLanePts, a.x, a.z).index;
        }

        const io = { to: () => ({ emit: () => {} }) };
        const game = { track, socketByColor: {} };
        const p = {
            color: 'red', x: track.pitLanePts[0].x, z: track.pitLanePts[0].z,
            angle: 0, speed: 0, vx: 0, vz: 0,
            pitBoxAnchor: anchors[2], pitting: false, pitPhase: null,
            pitAutoState: 'entering', pitPathIndex: 1, pitBoxFinalApproach: false,
        };

        let worst = 0;
        let ticks = 0;
        while (p.pitAutoState === 'entering' && !p.pitBoxFinalApproach && ticks < 4000) {
            physics.updatePitAutopilot(io, 'testLobby', game, p);
            // Il balzo finale verso lo stallo esce di proposito dalla corsia
            // (lo stallo è spostato di lato): si misura solo il tragitto.
            if (p.pitBoxFinalApproach) break;
            worst = Math.max(worst, TrackGeometry.nearestPoint(track.pitLanePts, p.x, p.z).dist);
            ticks++;
        }
        assert.ok(ticks > 5, `${id}: l'autopilota si è fermato subito (${ticks} tick)`);
        assert.ok(worst < track.pitRoadHalf,
            `${id}: l'auto si è allontanata di ${worst.toFixed(2)} dalla linea della corsia (semilarghezza ${track.pitRoadHalf})`);
    }
});

// --- gravità lungo il nastro (fase 1a) ---

// ⚠️ La gravità è ACCESA di default: per spegnerla serve '0', non basta
// togliere la variabile (passare null qui la lascia accesa).
function conFlagGravita(valore, fn) {
    const prima = process.env.F1_GRAVITA_NASTRO;
    if (valore === null) delete process.env.F1_GRAVITA_NASTRO;
    else process.env.F1_GRAVITA_NASTRO = valore;
    try { return fn(); }
    finally {
        if (prima === undefined) delete process.env.F1_GRAVITA_NASTRO;
        else process.env.F1_GRAVITA_NASTRO = prima;
    }
}

// Un giocatore lanciato a metà velocità col gas premuto, su una pendenza data:
// si guarda solo quanto vale p.speed dopo UN tick di updateVelocity.
function velocitaDopoUnTick(pendenza, flag) {
    const { physics } = f1GameSocket;
    return conFlagGravita(flag, () => {
        const p = {
            speed: 3, vx: 0, vz: 3, angle: 0, x: 0, z: 0,
            inputs: { throttle: 1, brake: 0, steer: 0 },
            compound: 'medium', tyreWear: 0, pendenza
        };
        physics.updateVelocity(p, true, 1);
        return p.speed;
    });
}

test('a flag spento la pendenza non cambia niente', () => {
    const piano = velocitaDopoUnTick(0, '0');
    assert.equal(velocitaDopoUnTick(0.2, '0'), piano);
    assert.equal(velocitaDopoUnTick(-0.2, '0'), piano);
});

test('a flag acceso la salita toglie velocità e la discesa la aggiunge', () => {
    const piano = velocitaDopoUnTick(0, '1');
    const salita = velocitaDopoUnTick(0.2, '1');
    const discesa = velocitaDopoUnTick(-0.2, '1');
    assert.ok(salita < piano, `salita ${salita} non è sotto piano ${piano}`);
    assert.ok(discesa > piano, `discesa ${discesa} non è sopra piano ${piano}`);
    assert.ok(Math.abs((piano - salita) - (discesa - piano)) < 1e-12,
        'salita e discesa non sono simmetriche');
});

// In discesa il tetto di velocità resta quello dell'auto: la gravità non deve
// poter spingere nessuno oltre il massimo della sua mescola.
test('la discesa non fa superare la velocità massima', () => {
    const { physics } = f1GameSocket;
    conFlagGravita('1', () => {
        // Il tetto NON è una costante esposta (physics.MAX_SPEED non esiste):
        // dipende da mescola e usura, e lo dice effectiveMaxSpeed.
        const p = {
            speed: 0, vx: 0, vz: 0, angle: 0, x: 0, z: 0,
            inputs: { throttle: 1, brake: 0, steer: 0 },
            compound: 'medium', tyreWear: 0, pendenza: -0.4
        };
        const massimo = physics.effectiveMaxSpeed(p, true);
        p.speed = massimo; p.vz = massimo;
        physics.updateVelocity(p, true, 1);
        assert.ok(p.speed <= massimo + 1e-12, `${p.speed} oltre il massimo ${massimo}`);
    });
});

// Un giocatore senza il campo (test storici, strumenti offline che non chiamano
// updateTrackIndex) deve comportarsi come in piano, mai NaN.
test('senza p.pendenza la fisica resta quella di prima', () => {
    const { physics } = f1GameSocket;
    conFlagGravita('1', () => {
        const p = {
            speed: 3, vx: 0, vz: 3, angle: 0, x: 0, z: 0,
            inputs: { throttle: 1, brake: 0, steer: 0 },
            compound: 'medium', tyreWear: 0
        };
        physics.updateVelocity(p, true, 1);
        assert.ok(Number.isFinite(p.speed));
        assert.equal(p.speed, velocitaDopoUnTick(0, '1'));
    });
});

test('updateTrackIndex porta la pendenza del campione su p', () => {
    const { physics } = f1GameSocket;
    const { loadTrack } = require('./trackLoader.js');
    const track = loadTrack('prova');
    const p = { x: track.points[10].x, z: track.points[10].z, trackIndex: 10 };
    physics.updateTrackIndex(p, track);
    assert.equal(p.pendenza, track.points[p.trackIndex].pendenza);
});
