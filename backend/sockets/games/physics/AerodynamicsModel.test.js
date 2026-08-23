// backend/sockets/games/physics/AerodynamicsModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { GRIP, effectiveGrip, applyGripBlend, downforceFactor, dragFactor, slipstreamFactor, isAeroDragModelActive, isAeroDownforceModelActive, isAeroDamageModelActive, isAeroSlipstreamModelActive, DRAG_TOP_SPEED_PENALTY_MAX, DOWNFORCE_CAPACITY_BONUS_MAX } = require('./AerodynamicsModel');
const { corneringGripFactor } = require('./TyreForceModel');

test('GRIP: valore storico invariato', () => {
    assert.equal(GRIP, 0.78);
});

test('effectiveGrip: gomma fresca, nessun danno -> GRIP pieno per la mescola medium', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.741) < 1e-9);
});

test('effectiveGrip: fondo danneggiato 50% -> aderenza ridotta (valore aggiornato dopo la promozione a default ON di F1_AERO_DOWNFORCE_MODEL/F1_AERO_DAMAGE_MODEL, Rif. docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md: la penalità danno dentro downforceFactor non dipende da maxSpeed, quindi si applica anche qui pur senza passarlo — 0.611325 storico / downforceFactor(0,false,{floor:50})=0.95 = 0.6435)', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 50, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.6435000000000001) < 1e-9);
});

test('effectiveGrip: gomma usurata 80% -> penalità aderenza applicata (Fase 2B: da TyreForceModel.corneringGripFactor, tarato in 2A.5, non più WEAR_GRIP_PENALTY legacy 0.627534375)', () => {
    const p = { compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    assert.ok(Math.abs(effectiveGrip(p, false) - 0.5815546925320896) < 1e-9);
});

test('effectiveGrip: Fase 2B, il fattore usura proviene sempre da TyreForceModel.corneringGripFactor (nessun ramo legacy residuo)', () => {
    const p = { compound: 'medium', tyreWear: 80, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    const expected = GRIP * 0.95 * corneringGripFactor(80, false);
    assert.ok(Math.abs(effectiveGrip(p, false) - expected) < 1e-9);
});

test('applyGripBlend: vx/vz convergono verso la direzione del muso pesati da grip', () => {
    const p = { angle: 0, speed: 3, vx: 1, vz: 1 };
    applyGripBlend(p, 0.741);
    assert.ok(Math.abs(p.vx - 0.741) < 1e-9);
    assert.ok(Math.abs(p.vz - 1.518) < 1e-9);
});

// ---- Fase 0 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// seam architetturale — placeholder neutri, nessun consumer ancora ----

// ---- Fase 2 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// downforceFactor ha ora una prima formula reale, non più il placeholder Fase 0 ----

test('downforceFactor: velocità zero -> nessun bonus (fattore 1), qualunque qualifica', () => {
    assert.equal(downforceFactor(0, false), 1);
    assert.equal(downforceFactor(0, true), 1);
});

test('downforceFactor: velocità massima -> bonus massimo pari a DOWNFORCE_CAPACITY_BONUS_MAX', () => {
    assert.ok(Math.abs(downforceFactor(1, false) - (1 + DOWNFORCE_CAPACITY_BONUS_MAX)) < 1e-9);
});

test('downforceFactor: monotono crescente al crescere di speedFrac', () => {
    assert.ok(downforceFactor(0.5, false) < downforceFactor(1, false));
    assert.ok(downforceFactor(0.2, false) < downforceFactor(0.5, false));
});

test('downforceFactor: indipendente da isQuali (fenomeno fisico, non penalità da usura/danno)', () => {
    assert.equal(downforceFactor(0.7, false), downforceFactor(0.7, true));
});

// ---- Promozione a default ON (Rif. docs/superpowers/plans/2026-07-28-f1-aerodynamics-playtest-plan.md,
// playtest 2026-07-28): tutti i 4 flag aero sono ora attivi di default dopo
// validazione in playtest. Rollback possibile impostando esplicitamente il
// valore '0' — qualunque altro valore (incluso non impostato) mantiene il
// modello attivo. I test sotto riflettono questa nuova semantica: "non
// impostato" ora significa ATTIVO, non spento. ----

test('isAeroDownforceModelActive: attivo di default (env var non impostata) — promosso dopo playtest', () => {
    assert.equal(process.env.F1_AERO_DOWNFORCE_MODEL, undefined);
    assert.equal(isAeroDownforceModelActive(), true);
});

test("isAeroDownforceModelActive: disattivo SOLO con F1_AERO_DOWNFORCE_MODEL='0' esatto (rollback)", () => {
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    try {
        assert.equal(isAeroDownforceModelActive(), false);
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
    process.env.F1_AERO_DOWNFORCE_MODEL = '1';
    try {
        assert.equal(isAeroDownforceModelActive(), true, "'1' esplicito resta attivo, come prima");
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('effectiveGrip: F1_AERO_DOWNFORCE_MODEL="0" (rollback esplicito) -> comportamento storico anche passando maxSpeed', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, speed: 6.2 };
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    try {
        assert.ok(Math.abs(effectiveGrip(p, false) - 0.741) < 1e-9);
        assert.ok(Math.abs(effectiveGrip(p, false, 6.2) - 0.741) < 1e-9, 'passare maxSpeed non deve cambiare nulla col rollback attivo');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
    }
});

test('effectiveGrip: default ON, maxSpeed OMESSO (retrocompatibilità f1GameSocket.js HUD) -> nessun NaN, valore invariato (speedFrac=0 -> downforceFactor neutro, nessun danno in questo player)', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, speed: 6.2 };
    const grip = effectiveGrip(p, false); // 2 argomenti, come f1GameSocket.js:1201 — flag ON di default, nessuna env var impostata
    assert.ok(!Number.isNaN(grip));
    assert.ok(Math.abs(grip - 0.741) < 1e-9, 'maxSpeed assente -> speedFrac=0 -> downforceFactor neutro (nessun danno su questo player)');
});

test('effectiveGrip: default ON, velocità massima -> grip RIDOTTO in modo misurabile rispetto al rollback esplicito "0" (playtest 2026-07-28: più downforce deve rendere l\'auto più reattiva, cioè grip più vicino a 0 in applyGripBlend, non più vicino a 1 — vedi nota sul segno in AerodynamicsModel.js)', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, speed: 6.2 };
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    const off = effectiveGrip(p, false, 6.2); // rollback esplicito = comportamento storico
    delete process.env.F1_AERO_DOWNFORCE_MODEL; // torna al default ON
    const on = effectiveGrip(p, false, 6.2);
    assert.ok(on < off, `atteso grip ridotto rispetto al rollback: off=${off}, on=${on}`);
    const expected = off / downforceFactor(1, false);
    assert.ok(Math.abs(on - expected) < 1e-9);
});

// ---- Fase 1 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// dragFactor ha ora una prima formula reale, non più il placeholder Fase 0 ----

test('dragFactor: velocità zero -> nessuna penalità (fattore 1), qualunque qualifica', () => {
    assert.equal(dragFactor(0, false), 1);
    assert.equal(dragFactor(0, true), 1);
});

test('dragFactor: velocità massima -> penalità massima pari a DRAG_TOP_SPEED_PENALTY_MAX', () => {
    assert.ok(Math.abs(dragFactor(1, false) - (1 - DRAG_TOP_SPEED_PENALTY_MAX)) < 1e-9);
});

test('dragFactor: monotono decrescente al crescere di speedFrac', () => {
    assert.ok(dragFactor(0.5, false) > dragFactor(1, false));
    assert.ok(dragFactor(0.2, false) > dragFactor(0.5, false));
});

test('dragFactor: indipendente da isQuali (fenomeno fisico, non penalità da usura/danno)', () => {
    assert.equal(dragFactor(0.7, false), dragFactor(0.7, true));
});

test('isAeroDragModelActive: attivo di default (env var non impostata) — promosso dopo playtest', () => {
    assert.equal(process.env.F1_AERO_DRAG_MODEL, undefined);
    assert.equal(isAeroDragModelActive(), true);
});

test("isAeroDragModelActive: disattivo SOLO con F1_AERO_DRAG_MODEL='0' esatto (rollback)", () => {
    process.env.F1_AERO_DRAG_MODEL = '0';
    try {
        assert.equal(isAeroDragModelActive(), false);
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
    process.env.F1_AERO_DRAG_MODEL = 'true';
    try {
        assert.equal(isAeroDragModelActive(), true, "qualunque valore diverso da '0' resta attivo, incluse stringhe non standard");
    } finally {
        delete process.env.F1_AERO_DRAG_MODEL;
    }
});

// ---- Fase 4 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// slipstreamFactor ha ora la formula reale, non più il placeholder Fase 0 ----

test('slipstreamFactor: gap >= SLIPSTREAM_RANGE_M (25) -> nessun effetto (fattore 1)', () => {
    assert.equal(slipstreamFactor(25), 1);
    assert.equal(slipstreamFactor(30), 1);
    assert.equal(slipstreamFactor(1000), 1);
});

test('slipstreamFactor: gap piccolo -> stesso boost della formula storica (closeness = 1 - gap/25, boost max 0.08)', () => {
    // gap=12.5 (metà del range): closeness=0.5, mult atteso = 1 + 0.5*0.08 = 1.04
    assert.ok(Math.abs(slipstreamFactor(12.5) - 1.04) < 1e-9);
    // gap=0 (a contatto): closeness=1, mult atteso = 1.08 (boost massimo)
    assert.ok(Math.abs(slipstreamFactor(0) - 1.08) < 1e-9);
});

test('slipstreamFactor: monotono decrescente al crescere del gap (più lontano = meno scia)', () => {
    assert.ok(slipstreamFactor(0) > slipstreamFactor(10));
    assert.ok(slipstreamFactor(10) > slipstreamFactor(20));
});

test('isAeroSlipstreamModelActive: attivo di default (env var non impostata) — promosso dopo playtest', () => {
    assert.equal(process.env.F1_AERO_SLIPSTREAM_MODEL, undefined);
    assert.equal(isAeroSlipstreamModelActive(), true);
});

test("isAeroSlipstreamModelActive: disattivo SOLO con F1_AERO_SLIPSTREAM_MODEL='0' esatto (rollback)", () => {
    process.env.F1_AERO_SLIPSTREAM_MODEL = '0';
    try {
        assert.equal(isAeroSlipstreamModelActive(), false);
    } finally {
        delete process.env.F1_AERO_SLIPSTREAM_MODEL;
    }
});

// ---- Fase 3 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// danno aerodinamico, riusa frontWing/floor via DamageModel ----

test('isAeroDamageModelActive: attivo di default (env var non impostata) — promosso dopo playtest', () => {
    assert.equal(process.env.F1_AERO_DAMAGE_MODEL, undefined);
    assert.equal(isAeroDamageModelActive(), true);
});

test("isAeroDamageModelActive: disattivo SOLO con F1_AERO_DAMAGE_MODEL='0' esatto (rollback)", () => {
    process.env.F1_AERO_DAMAGE_MODEL = '0';
    try {
        assert.equal(isAeroDamageModelActive(), false);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: default ON -> il danno HA effetto (a differenza di prima della promozione), passando damageParts il fattore cambia', () => {
    assert.notEqual(dragFactor(1, false), dragFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 }));
});

test('dragFactor: F1_AERO_DAMAGE_MODEL="0" (rollback) -> comportamento identico a prima anche passando damageParts', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '0';
    try {
        assert.equal(dragFactor(1, false), dragFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 }));
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: F1_AERO_DAMAGE_MODEL="1", danno zero -> nessuna penalità aggiuntiva', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        assert.ok(Math.abs(dragFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 }) - dragFactor(1, false)) < 1e-9);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: F1_AERO_DAMAGE_MODEL="1", ala anteriore distrutta -> drag aumentato in modo misurabile (fattore ridotto)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = dragFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const damaged = dragFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
        assert.ok(damaged < healthy, `atteso più drag (fattore minore) con ala rotta: sana=${healthy}, danneggiata=${damaged}`);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

// ASSERZIONE CAPOVOLTA il 2026-08-23: prima il danno era esente in qualifica.
// Ora vale sempre — in stagione al giro secco si arriva con la macchina che si
// ha. Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
test('dragFactor: F1_AERO_DAMAGE_MODEL="1", isQuali=true -> il danno vale lo stesso', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = dragFactor(1, true, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const damaged = dragFactor(1, true, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
        assert.ok(damaged < healthy, 'anche in qualifica l\'ala rotta deve aumentare la resistenza');
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('dragFactor: floor danneggiato NON influenza il drag (isolamento per componente)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = dragFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const floorDamaged = dragFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 });
        assert.equal(healthy, floorDamaged, 'floor non deve influenzare dragFactor, solo frontWing');
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('downforceFactor: default ON -> il danno HA effetto (a differenza di prima della promozione), passando damageParts il fattore cambia', () => {
    assert.notEqual(downforceFactor(1, false), downforceFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 }));
});

test('downforceFactor: F1_AERO_DAMAGE_MODEL="0" (rollback) -> comportamento identico a prima anche passando damageParts', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '0';
    try {
        assert.equal(downforceFactor(1, false), downforceFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 }));
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('downforceFactor: F1_AERO_DAMAGE_MODEL="1", fondo distrutto -> downforce ridotto in modo misurabile', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = downforceFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const damaged = downforceFactor(1, false, { frontWing: 0, floor: 100, engine: 0, suspension: 0 });
        assert.ok(damaged < healthy, `atteso downforce ridotto con fondo rotto: sano=${healthy}, danneggiato=${damaged}`);
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('downforceFactor: frontWing danneggiata NON influenza il downforce (isolamento per componente)', () => {
    process.env.F1_AERO_DAMAGE_MODEL = '1';
    try {
        const healthy = downforceFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        const wingDamaged = downforceFactor(1, false, { frontWing: 100, floor: 0, engine: 0, suspension: 0 });
        assert.equal(healthy, wingDamaged, 'frontWing non deve influenzare downforceFactor, solo floor');
    } finally {
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});

test('nessun doppio conteggio: getFloorGripPenalty (meccanico, floorFactor) e getFloorDownforcePenalty (aero, downforceFactor) sono penalità indipendenti, ciascuna applicata una sola volta', () => {
    const p = { compound: 'medium', tyreWear: 0, damageParts: { frontWing: 0, floor: 50, engine: 0, suspension: 0 }, speed: 6.2 };
    // Base puramente meccanica: rollback esplicito ("0") su entrambi i flag aero (default ON
    // dopo la promozione, quindi va disattivato esplicitamente per isolare), isola
    // GRIP*gripMult*wearFactor*floorFactor senza alcun contributo downforce (né base né da
    // danno) — non deve MAI includere downforceFactor.
    process.env.F1_AERO_DOWNFORCE_MODEL = '0';
    process.env.F1_AERO_DAMAGE_MODEL = '0';
    const mechanicalBaseGrip = effectiveGrip(p, false, 6.2);
    delete process.env.F1_AERO_DOWNFORCE_MODEL;
    delete process.env.F1_AERO_DAMAGE_MODEL;

    // Tornati al default ON per entrambi (nessuna env var impostata):
    try {
        const gripWithAeroDamage = effectiveGrip(p, false, 6.2);
        // atteso: la base meccanica (floorFactor, invariata) divisa UNA SOLA VOLTA
        // per downforceFactor (che include anch'esso il danno al fondo UNA SOLA VOLTA
        // internamente) — non due applicazioni separate della stessa penalità floor.
        // Divisione, non moltiplicazione (playtest 2026-07-28, fix del segno): vedi test
        // "grip RIDOTTO" sopra e la nota in AerodynamicsModel.js.
        const expected = mechanicalBaseGrip / downforceFactor(1, false, p.damageParts);
        assert.ok(Math.abs(gripWithAeroDamage - expected) < 1e-9, 'la penalità aero deve applicarsi UNA VOLTA sopra alla base meccanica, non sostituirla né duplicarla');
        // conferma esplicita che il danno al fondo pesa DUE VOLTE nel risultato finale
        // (una volta via floorFactor meccanico, una volta via downforceFactor aereo) ma
        // ciascuna delle due SOLO una volta, non di più: sono penalità indipendenti che si
        // compongono, non lo stesso numero applicato due volte.
        const noDamageDownforce = downforceFactor(1, false, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
        assert.ok(downforceFactor(1, false, p.damageParts) < noDamageDownforce, 'il danno al fondo deve ridurre downforceFactor rispetto a fondo sano');
    } finally {
        delete process.env.F1_AERO_DOWNFORCE_MODEL;
        delete process.env.F1_AERO_DAMAGE_MODEL;
    }
});
