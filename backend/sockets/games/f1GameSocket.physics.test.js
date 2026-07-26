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
        'applyOffTrackDrag', 'applyBridgeBarrier', 'updateTrackIndex',
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

test('updateVelocity: da fermo con throttle=1 accelera esattamente di ACCEL in un tick', () => {
    const { physics } = f1GameSocket;
    const p = { inputs: { throttle: 1, brake: 0, steer: 0 }, speed: 0, vx: 0, vz: 0, angle: 0, tyreWear: 0, compound: 'medium' };
    physics.updateVelocity(p, true, 1);
    assert.ok(Math.abs(p.speed - physics.ACCEL) < 1e-9, `atteso ${physics.ACCEL}, ottenuto ${p.speed}`);
});

test('integratePosition: sposta x/z in base a vx/vz e dt', () => {
    const { physics } = f1GameSocket;
    const p = { x: 10, z: 20, vx: 2, vz: -3 };
    physics.integratePosition(p, 0.5);
    assert.ok(Math.abs(p.x - 11) < 1e-9 && Math.abs(p.z - 18.5) < 1e-9, `atteso (11,18.5), ottenuto (${p.x},${p.z})`);
});

test('assignGridSpawns: azzera damage/collisionPenaltyMs/pendingRepair/contatti a inizio gara vera', () => {
    const { physics } = f1GameSocket;
    const fakeTrack = { gridSpawnPoint: (i) => ({ x: i, z: 0, angle: 0 }) };
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

test('applyBridgeBarrier: nuovo urto contro il muro in gara applica danno (nessuna penalità)', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    // Fuori dal limite (roadHalf + margine), spinta forte verso l'esterno lungo x.
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    physics.applyBridgeBarrier(p, track, true);

    assert.ok(p.damage > 0, 'atteso danno da impatto col muro');
    assert.equal(p.collisionPenaltyMs, 0, 'nessuna penalità da barriera');
});

test('applyBridgeBarrier: in qualifica (isRace=false) il muro frena comunque ma non danneggia', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    physics.applyBridgeBarrier(p, track, false);

    assert.equal(p.damage, 0, 'nessun danno in qualifica');
    assert.ok(p.x < 15, 'il muro riporta comunque la posizione sul bordo (fisica invariata)');
});

test('applyBridgeBarrier: senza 3° argomento (retrocompatibile con f1LapSimulator/f1RaceLineOptimizer) non lancia e non danneggia', () => {
    const { physics } = f1GameSocket;
    const track = makeBarrierTrack();
    const p = {
        x: 15, z: 0, angle: 0, speed: 8, vx: 8, vz: 0,
        trackIndex: 0, wallContact: false, damage: 0, collisionPenaltyMs: 0,
        pendingCollisionPenaltyEvents: []
    };

    assert.doesNotThrow(() => physics.applyBridgeBarrier(p, track));
    assert.equal(p.damage, 0);
});

test('effectiveMaxSpeed: il danno al motore riduce la velocità massima in gara, non in qualifica', () => {
    const { physics } = f1GameSocket;
    const pDanneggiato = { tyreWear: 0, compound: 'medium', damageParts: { engine: 100, frontWing: 0, floor: 0, suspension: 0 } };
    const pIlleso       = { tyreWear: 0, compound: 'medium', damageParts: { engine: 0, frontWing: 0, floor: 0, suspension: 0 } };

    const raceDanneggiato = physics.effectiveMaxSpeed(pDanneggiato, false);
    const raceIlleso      = physics.effectiveMaxSpeed(pIlleso, false);
    assert.ok(raceDanneggiato < raceIlleso, 'in gara il danno al motore deve rallentare');

    const qualiDanneggiato = physics.effectiveMaxSpeed(pDanneggiato, true);
    const qualiIlleso      = physics.effectiveMaxSpeed(pIlleso, true);
    assert.ok(Math.abs(qualiDanneggiato - qualiIlleso) < 1e-9, 'in qualifica il danno non deve avere effetto');
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
    assert.ok(Math.abs(physics.effectiveAccel(pDanneggiato, true) - physics.effectiveAccel(pIlleso, true)) < 1e-9,
        'in qualifica il danno non deve avere effetto');
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
            pitAutoState: null, falseStart: false, falseStartServed: false,
            gapToLeaderMs: null, isBot: false, inSlipstream: false
        }
    };
    const track = { points: [{ x: 0, z: 0 }] };
    const state = physics.buildPublicState(players, false, track);

    assert.equal(state.red.damage, 42);
    assert.equal(state.red.collisionPenalty, true);
});
