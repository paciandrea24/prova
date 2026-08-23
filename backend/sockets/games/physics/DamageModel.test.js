// backend/sockets/games/physics/DamageModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const DamageModel = require('./DamageModel.js');

test('createDamageParts: restituisce un oggetto fresco e indipendente ad ogni chiamata', () => {
    const p1 = DamageModel.createDamageParts();
    const p2 = DamageModel.createDamageParts();
    assert.deepEqual(p1, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    assert.notEqual(p1, p2, 'devono essere due oggetti distinti, non lo stesso riferimento condiviso');
    p1.frontWing = 50;
    assert.equal(p2.frontWing, 0, 'mutare uno non deve toccare l\'altro');
});

test('addComponentDamage: distribuisce secondo lo split e deriva p.damage come massimo dei componenti', () => {
    const p = { damage: 0 };
    DamageModel.addComponentDamage(p, 100, { frontWing: 0.8, suspension: 0.2 });
    assert.ok(Math.abs(p.damageParts.frontWing - 80) < 1e-9);
    assert.ok(Math.abs(p.damageParts.suspension - 20) < 1e-9);
    assert.equal(p.damageParts.floor, 0);
    assert.equal(p.damageParts.engine, 0);
    assert.ok(Math.abs(p.damage - 80) < 1e-9, 'p.damage = massimo dei 4 componenti');
});

test('addComponentDamage: crea damageParts al volo se assente, e clampa ogni componente a 100', () => {
    const p = {};
    DamageModel.addComponentDamage(p, 200, { frontWing: 1.0 });
    assert.equal(p.damageParts.frontWing, 100, 'clampato a 100 anche con danno grezzo oltre soglia');
    assert.equal(p.damage, 100);
});

test('getEnginePowerPenalty/getFloorGripPenalty/getFrontWingSteerPenalty: 0 a componente sano, MAX a componente distrutto, fallback sicuro senza damageParts', () => {
    const { getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty,
        DAMAGE_SPEED_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX, FRONT_WING_STEER_PENALTY_MAX } = DamageModel;

    assert.equal(getEnginePowerPenalty(undefined), 0, 'fallback sicuro senza damageParts (tool offline)');
    assert.equal(getEnginePowerPenalty({ engine: 0 }), 0);
    assert.ok(Math.abs(getEnginePowerPenalty({ engine: 100 }) - DAMAGE_SPEED_PENALTY_MAX) < 1e-9);

    assert.equal(getFloorGripPenalty(undefined), 0);
    assert.ok(Math.abs(getFloorGripPenalty({ floor: 100 }) - DAMAGE_GRIP_PENALTY_MAX) < 1e-9);

    assert.equal(getFrontWingSteerPenalty(undefined), 0);
    assert.ok(Math.abs(getFrontWingSteerPenalty({ frontWing: 100 }) - FRONT_WING_STEER_PENALTY_MAX) < 1e-9);
});

test('getEnginePowerPenalty: scala linearmente col danno motore, ignora gli altri componenti', () => {
    const { getEnginePowerPenalty, DAMAGE_SPEED_PENALTY_MAX } = DamageModel;
    const half = getEnginePowerPenalty({ engine: 50, frontWing: 100, floor: 100, suspension: 100 });
    assert.ok(Math.abs(half - DAMAGE_SPEED_PENALTY_MAX / 2) < 1e-9, 'legge solo engine, non gli altri componenti');
});

test('getSuspensionNoise: zero a sospensioni sane, progressivo (nessuna soglia) fino al massimo a sospensioni distrutte', () => {
    const { getSuspensionNoise, DAMAGE_STEER_NOISE_MAX } = DamageModel;
    const rngAlways1 = () => 1;   // deterministico, sempre al massimo dell'intervallo

    assert.equal(getSuspensionNoise(undefined, rngAlways1), 0, 'fallback sicuro senza damageParts');
    assert.equal(getSuspensionNoise({ suspension: 0 }, rngAlways1), 0);
    const low = getSuspensionNoise({ suspension: 10 }, rngAlways1);
    assert.ok(low > 0, 'già non-zero a bassissimo danno, niente soglia');
    const high = getSuspensionNoise({ suspension: 100 }, rngAlways1);
    assert.ok(Math.abs(high - DAMAGE_STEER_NOISE_MAX) < 1e-9, 'massimo raggiunto a sospensioni distrutte');
    assert.ok(high > low, 'monotono crescente col danno');
});

// ---- Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// penalità aero da danno — riusano frontWing/floor, nessun quinto componente ----

test('getFrontWingDragPenalty: 0 a componente sano, MAX a componente distrutto, fallback sicuro', () => {
    const { getFrontWingDragPenalty, FRONT_WING_DRAG_PENALTY_MAX } = DamageModel;
    assert.equal(getFrontWingDragPenalty(undefined), 0, 'fallback sicuro senza damageParts (tool offline)');
    assert.equal(getFrontWingDragPenalty({ frontWing: 0 }), 0);
    assert.ok(Math.abs(getFrontWingDragPenalty({ frontWing: 100 }) - FRONT_WING_DRAG_PENALTY_MAX) < 1e-9);
});

test('getFrontWingDragPenalty: lineare nel danno (50% -> metà penalità massima), ignora gli altri componenti', () => {
    const { getFrontWingDragPenalty, FRONT_WING_DRAG_PENALTY_MAX } = DamageModel;
    const half = getFrontWingDragPenalty({ frontWing: 50, floor: 100, engine: 100, suspension: 100 });
    assert.ok(Math.abs(half - FRONT_WING_DRAG_PENALTY_MAX / 2) < 1e-9, 'legge solo frontWing, non gli altri componenti');
});

test('getFloorDownforcePenalty: 0 a componente sano, MAX a componente distrutto, fallback sicuro', () => {
    const { getFloorDownforcePenalty, FLOOR_DOWNFORCE_PENALTY_MAX } = DamageModel;
    assert.equal(getFloorDownforcePenalty(undefined), 0, 'fallback sicuro senza damageParts (tool offline)');
    assert.equal(getFloorDownforcePenalty({ floor: 0 }), 0);
    assert.ok(Math.abs(getFloorDownforcePenalty({ floor: 100 }) - FLOOR_DOWNFORCE_PENALTY_MAX) < 1e-9);
});

test('getFloorDownforcePenalty: ignora frontWing/engine/suspension (isolato al proprio componente)', () => {
    const { getFloorDownforcePenalty } = DamageModel;
    assert.equal(getFloorDownforcePenalty({ floor: 0, frontWing: 100, engine: 100, suspension: 100 }), 0);
});

test('getFloorDownforcePenalty è indipendente da getFloorGripPenalty (costanti diverse, nessuna derivazione incrociata)', () => {
    const { getFloorDownforcePenalty, getFloorGripPenalty, FLOOR_DOWNFORCE_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX } = DamageModel;
    assert.notEqual(FLOOR_DOWNFORCE_PENALTY_MAX, DAMAGE_GRIP_PENALTY_MAX);
    assert.notEqual(getFloorDownforcePenalty({ floor: 50 }), getFloorGripPenalty({ floor: 50 }));
});

test('createDamageParts: resta a 4 componenti, nessun quinto campo aero introdotto', () => {
    const parts = DamageModel.createDamageParts();
    assert.deepEqual(Object.keys(parts).sort(), ['engine', 'floor', 'frontWing', 'suspension']);
});

test('applyCarCollisionDamage/applyBarrierDamage: continuano a mantenere p.damage come numero valido (retrocompatibilità HUD/tool offline)', () => {
    const { applyCarCollisionDamage, applyBarrierDamage } = DamageModel;
    const a = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    const b = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    applyCarCollisionDamage(a, b, 0, -5, 5);
    assert.equal(typeof a.damage, 'number');
    assert.equal(typeof b.damage, 'number');

    const p = { damage: 0, collisionPenaltyMs: 0, pendingCollisionPenaltyEvents: [] };
    applyBarrierDamage(p, 3);
    assert.equal(typeof p.damage, 'number');
});

// ---- Il danno vale ANCHE in qualifica (2026-08-23) -------------------------
// Prima di questa modifica `isQuali` spegneva due cose insieme: l'usura delle
// gomme (giusto: in qualifica le gomme sono nuove) e il danno alle componenti
// (residuo). Questi test bloccano il ritorno della seconda: chi arriva al
// weekend con la macchina consumata la sente anche sul giro secco.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
const PowertrainModel   = require('./PowertrainModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const SteeringModel     = require('./SteeringModel');

function playerDanneggiato(parts) {
    return {
        speed: 2, angle: 0, vx: 0, vz: 2,
        inputs: { throttle: 0, brake: 0, steer: 1 },
        compound: 'medium', tyreWear: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0, ...parts },
    };
}

const SANO = { frontWing: 0, floor: 0, engine: 0, suspension: 0 };

test('in qualifica il motore rotto toglie velocita\' massima', () => {
    const sano  = PowertrainModel.effectiveMaxSpeed(playerDanneggiato({}), true);
    const rotto = PowertrainModel.effectiveMaxSpeed(playerDanneggiato({ engine: 100 }), true);
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica il motore rotto toglie accelerazione', () => {
    const sano  = PowertrainModel.effectiveAccel(playerDanneggiato({}), true);
    const rotto = PowertrainModel.effectiveAccel(playerDanneggiato({ engine: 100 }), true);
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica il fondo rotto cambia il grip', () => {
    const sano  = AerodynamicsModel.effectiveGrip(playerDanneggiato({}), true, 6.2);
    const rotto = AerodynamicsModel.effectiveGrip(playerDanneggiato({ floor: 100 }), true, 6.2);
    assert.notEqual(rotto, sano, 'il danno al fondo deve avere effetto anche in qualifica');
});

// Queste due non dicono più "in qualifica" perché le funzioni aero non
// sanno più cosa sia una qualifica: dopo la rimozione dell'esenzione,
// `isQuali` è uscito anche dalle loro firme. Restano qui, accanto alle altre
// del danno, perché l'ala e il fondo rotti sono ciò che verificano.
test('l\'ala rotta aumenta la resistenza, sempre', () => {
    const sano  = AerodynamicsModel.dragFactor(1, SANO);
    const rotto = AerodynamicsModel.dragFactor(1, { ...SANO, frontWing: 100 });
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('il fondo rotto toglie deportanza, sempre', () => {
    const sano  = AerodynamicsModel.downforceFactor(1, SANO);
    const rotto = AerodynamicsModel.downforceFactor(1, { ...SANO, floor: 100 });
    assert.ok(rotto < sano, `atteso rotto < sano, ottenuto ${rotto} vs ${sano}`);
});

test('in qualifica l\'ala rotta fa sterzare di meno', () => {
    const sano  = playerDanneggiato({});
    const rotto = playerDanneggiato({ frontWing: 100 });
    SteeringModel.applySteering(sano, true, 6.2);
    SteeringModel.applySteering(rotto, true, 6.2);
    assert.ok(Math.abs(rotto.angle) < Math.abs(sano.angle),
        `atteso meno sterzata da rotto, ottenuto ${rotto.angle} vs ${sano.angle}`);
});

test('in qualifica le sospensioni rotte sporcano lo sterzo', () => {
    // getSuspensionNoise e' casuale: si confrontano 200 campioni e si guarda se
    // ALMENO UNO devia. Con rumore spento devierebbero zero volte.
    let deviato = 0;
    for (let i = 0; i < 200; i++) {
        const pulito = playerDanneggiato({});
        const rotto  = playerDanneggiato({ suspension: 100 });
        SteeringModel.applySteering(pulito, true, 6.2);
        SteeringModel.applySteering(rotto, true, 6.2);
        if (rotto.angle !== pulito.angle) deviato++;
    }
    assert.ok(deviato > 0, 'le sospensioni rotte devono sporcare lo sterzo anche in qualifica');
});

// ---- Il fondo si rovina fuori pista ---------------------------------------
// E' la prima fonte di danno che non viene da un urto: fino a qui la macchina
// si rompeva solo sbattendo. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
//
// NB: questo file importa il modulo INTERO come `DamageModel` (riga 4), non
// destrutturato — seguire quella convenzione.
test("applyOffTrackFloorDamage: la ghiaia costa piu' dell'erba sfiorata", () => {
    const sfiora  = { damageParts: DamageModel.createDamageParts() };
    const affonda = { damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(sfiora, 0.1);
    DamageModel.applyOffTrackFloorDamage(affonda, 1);
    assert.ok(affonda.damageParts.floor > sfiora.damageParts.floor,
        `attesa piu' rottura affondando, ottenuto ${affonda.damageParts.floor} vs ${sfiora.damageParts.floor}`);
});

test("applyOffTrackFloorDamage: rovina SOLO il fondo", () => {
    const p = { damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(p, 1);
    assert.ok(p.damageParts.floor > 0, 'il fondo deve rovinarsi');
    assert.equal(p.damageParts.frontWing, 0, "l'ala non c'entra");
    assert.equal(p.damageParts.engine, 0, "il motore non c'entra");
    assert.equal(p.damageParts.suspension, 0, "le sospensioni non c'entrano");
});

test("applyOffTrackFloorDamage: profondita' zero non fa niente", () => {
    const p = { damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(p, 0);
    assert.equal(p.damageParts.floor, 0);
});

test("applyOffTrackFloorDamage: aggiorna anche p.damage, che l'HUD mostra", () => {
    // Senza questo l'indicatore dei danni resterebbe fermo mentre il fondo si
    // rovina: p.damage e' DERIVATO dal massimo dei quattro componenti, e chi
    // lo scrive e' addComponentDamage.
    const p = { damage: 0, damageParts: DamageModel.createDamageParts() };
    DamageModel.applyOffTrackFloorDamage(p, 1);
    assert.equal(p.damage, p.damageParts.floor);
});

test("applyOffTrackFloorDamage: il fondo non supera mai 100", () => {
    const p = { damageParts: DamageModel.createDamageParts() };
    for (let i = 0; i < 100000; i++) DamageModel.applyOffTrackFloorDamage(p, 1);
    assert.equal(p.damageParts.floor, 100);
});
