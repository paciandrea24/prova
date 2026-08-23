// backend/sockets/games/physics/TyreModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND,
    WEAR_LAPS_AT_MEDIUM, WEAR_OFFTRACK_EXTRA, WEAR_SPEED_PENALTY,
    WEAR_CLIFF_THRESHOLD, WEAR_CLIFF_GENTLE_FRACTION,
    tyreOf, applyTyreWear, suggestStrategy, getWearPenaltyFactor, giriPerMescola
} = require('./TyreModel.js');

test('getWearPenaltyFactor: zero wear ha fattore zero', () => {
    const factor = getWearPenaltyFactor(0);
    assert.ok(Math.abs(factor - 0) < 1e-9, `atteso 0, ottenuto ${factor}`);
});

test('getWearPenaltyFactor: 100% wear ha fattore 1', () => {
    const factor = getWearPenaltyFactor(100);
    assert.ok(Math.abs(factor - 1) < 1e-9, `atteso 1, ottenuto ${factor}`);
});

test('getWearPenaltyFactor: esattamente alla soglia (60%) il fattore è WEAR_CLIFF_GENTLE_FRACTION', () => {
    const wearAtThreshold = WEAR_CLIFF_THRESHOLD * 100;
    const factor = getWearPenaltyFactor(wearAtThreshold);
    assert.ok(
        Math.abs(factor - WEAR_CLIFF_GENTLE_FRACTION) < 1e-9,
        `atteso ${WEAR_CLIFF_GENTLE_FRACTION}, ottenuto ${factor}`
    );
});

test('getWearPenaltyFactor: curva cliff accelera il degradamento oltre la soglia', () => {
    // Tratto dolce: usura 30->60 (30 punti) nel gentile
    const factor30 = getWearPenaltyFactor(30);
    const factor60 = getWearPenaltyFactor(60);
    const increaseGentile = factor60 - factor30;

    // Tratto cliff: usura 70->100 (30 punti) nel cliff
    const factor70 = getWearPenaltyFactor(70);
    const factor100 = getWearPenaltyFactor(100);
    const increaseCliff = factor100 - factor70;

    assert.ok(increaseCliff > increaseGentile,
        `aumento cliff (${increaseCliff}) deve essere > aumento gentile (${increaseGentile})`);
});

test('getWearPenaltyFactor: monotonamente non-decrescente su tutta l\'usura', () => {
    const samples = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (let i = 1; i < samples.length; i++) {
        const prev = getWearPenaltyFactor(samples[i - 1]);
        const curr = getWearPenaltyFactor(samples[i]);
        assert.ok(curr >= prev - 1e-9,
            `curva non decrescente attesa: f(${samples[i-1]})=${prev} <= f(${samples[i]})=${curr}`);
    }
});

test('getWearPenaltyFactor: usura negativa è clampata come 0', () => {
    const factorNeg10 = getWearPenaltyFactor(-10);
    const factor0 = getWearPenaltyFactor(0);
    assert.ok(Math.abs(factorNeg10 - factor0) < 1e-9,
        `usura negativa deve comportarsi come zero: ${factorNeg10} vs ${factor0}`);
});

test('getWearPenaltyFactor: usura oltre 100 è clampata come 100', () => {
    const factor150 = getWearPenaltyFactor(150);
    const factor100 = getWearPenaltyFactor(100);
    assert.ok(Math.abs(factor150 - factor100) < 1e-9,
        `usura >100 deve comportarsi come 100: ${factor150} vs ${factor100}`);
});

test('WEAR_CLIFF_THRESHOLD: costante è 0.60 (60%)', () => {
    assert.equal(WEAR_CLIFF_THRESHOLD, 0.60);
});

test('WEAR_CLIFF_GENTLE_FRACTION: costante è 0.25', () => {
    assert.equal(WEAR_CLIFF_GENTLE_FRACTION, 0.25);
});

test('tyreOf: in qualifica ritorna la Soft indipendentemente dal compound scelto', () => {
    const player = { compound: 'hard' };
    const tyre = tyreOf(player, true);
    assert.equal(tyre.label, 'Soft', 'atteso Soft in qualifica');
});

test('tyreOf: in gara ritorna il compound scelto dal giocatore', () => {
    const player = { compound: 'hard' };
    const tyre = tyreOf(player, false);
    assert.equal(tyre.label, 'Hard', 'atteso Hard in gara');
});

test('tyreOf: compound sconosciuto usa il default (medium)', () => {
    const player = { compound: 'unknown' };
    const tyre = tyreOf(player, false);
    assert.equal(tyre.label, 'Medium', 'atteso Medium di default');
});

test('applyTyreWear: incrementa l\'usura proporzionalmente alla distanza percorsa', () => {
    const track = { lapLength: 5000 };
    const player = {
        tyreWear: 0,
        vx: 3,
        vz: 4,  // distanza = 5
        compound: 'medium'
    };
    applyTyreWear(player, false, track);
    assert.ok(player.tyreWear > 0, 'usura deve aumentare');
    assert.ok(player.tyreWear < 100, 'usura non deve superare 100');
});

test('applyTyreWear: aggiunge un extra se fuori pista', () => {
    const track = { lapLength: 5000 };
    const onTrack = { tyreWear: 0, vx: 1, vz: 1, compound: 'medium' };
    const offTrack = { tyreWear: 0, vx: 1, vz: 1, compound: 'medium' };

    applyTyreWear(onTrack, false, track);
    applyTyreWear(offTrack, true, track);

    assert.ok(offTrack.tyreWear > onTrack.tyreWear,
        `off-track (${offTrack.tyreWear}) deve avere più usura di on-track (${onTrack.tyreWear})`);
});

test('suggestStrategy: suggerisce una sequenza di mescole per una gara', () => {
    const stints = suggestStrategy(10);
    assert.ok(Array.isArray(stints), 'atteso array');
    assert.ok(stints.length > 0, 'atteso almeno un stint');
    for (const stint of stints) {
        assert.ok(['hard', 'medium', 'soft'].includes(stint), `stint deve essere hard/medium/soft, ottenuto ${stint}`);
    }
});

test('TYRE_COMPOUNDS: contiene soft, medium, hard con proprietà attese', () => {
    assert.ok(TYRE_COMPOUNDS.soft, 'atteso soft');
    assert.ok(TYRE_COMPOUNDS.medium, 'atteso medium');
    assert.ok(TYRE_COMPOUNDS.hard, 'atteso hard');

    for (const [name, spec] of Object.entries(TYRE_COMPOUNDS)) {
        assert.equal(typeof spec.label, 'string', `${name}.label deve essere stringa`);
        assert.equal(typeof spec.color, 'string', `${name}.color deve essere stringa`);
        assert.equal(typeof spec.speedMult, 'number', `${name}.speedMult deve essere numero`);
        assert.equal(typeof spec.gripMult, 'number', `${name}.gripMult deve essere numero`);
        assert.equal(typeof spec.wearRate, 'number', `${name}.wearRate deve essere numero`);
    }
});

test('DEFAULT_COMPOUND: è "medium"', () => {
    assert.equal(DEFAULT_COMPOUND, 'medium');
});

// L'auto piena mangia piu' gomma: e' la ragione fisica per cui il primo stint
// e' il piu' duro, e insieme all'alleggerimento produce da sola la piattezza
// dei tempi sul giro (vedi FuelModel.js). Non va programmata, va lasciata
// emergere.
test('applyTyreWear: l\'auto piena consuma piu\' dell\'auto scarica', () => {
    const track = { lapLength: 1000 };
    const base = () => ({ vx: 0, vz: 10, tyreWear: 0, compound: 'medium' });
    const scarica = base();
    const piena = { ...base(), fuelFactor: 1.08 };
    applyTyreWear(scarica, false, track);
    applyTyreWear(piena, false, track);
    assert.ok(piena.tyreWear > scarica.tyreWear,
        `attesa piu' usura da piena, ottenuto ${piena.tyreWear} vs ${scarica.tyreWear}`);
});

test('applyTyreWear: senza fuelFactor il consumo e\' identico a prima', () => {
    const track = { lapLength: 1000 };
    const senza = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium' };
    const uno   = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium', fuelFactor: 1 };
    applyTyreWear(senza, false, track);
    applyTyreWear(uno, false, track);
    assert.equal(senza.tyreWear, uno.tyreWear);
});

// ---- Abrasivita' del circuito --------------------------------------------
// Quanto quell'asfalto mangia le gomme. E' l'unica cosa che rende under-cut e
// over-cut una scelta invece che una teoria: non li implementiamo, diamo al
// giocatore i numeri con cui li calcola.
test("applyTyreWear: una pista abrasiva consuma di piu'", () => {
    const dolce      = { lapLength: 1000, abrasivita: 0.75 };
    const aggressiva = { lapLength: 1000, abrasivita: 1.35 };
    const base = () => ({ vx: 0, vz: 10, tyreWear: 0, compound: 'medium' });
    const a = base(), b = base();
    applyTyreWear(a, false, dolce);
    applyTyreWear(b, false, aggressiva);
    assert.ok(b.tyreWear > a.tyreWear,
        `attesa piu' usura sull'aggressiva, ottenuto ${b.tyreWear} vs ${a.tyreWear}`);
});

test("applyTyreWear: senza abrasivita' nella pista il consumo e' quello di sempre", () => {
    const senza = { lapLength: 1000 };
    const uno   = { lapLength: 1000, abrasivita: 1 };
    const a = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium' };
    const b = { vx: 0, vz: 10, tyreWear: 0, compound: 'medium' };
    applyTyreWear(a, false, senza);
    applyTyreWear(b, false, uno);
    assert.equal(a.tyreWear, b.tyreWear);
});

test('giriPerMescola: a riferimento la Medium dura WEAR_LAPS_AT_MEDIUM giri', () => {
    assert.equal(giriPerMescola(20, 1).medium, WEAR_LAPS_AT_MEDIUM);
});

test('giriPerMescola: su pista aggressiva ogni mescola dura meno', () => {
    const riferimento = giriPerMescola(20, 1);
    const aggressiva  = giriPerMescola(20, 1.35);
    for (const k of ['hard', 'medium', 'soft']) {
        assert.ok(aggressiva[k] < riferimento[k],
            `${k}: attesa vita minore, ottenuto ${aggressiva[k]} vs ${riferimento[k]}`);
    }
});

test("giriPerMescola: la Hard dura sempre piu' della Soft", () => {
    for (const abr of [0.75, 1, 1.35]) {
        const g = giriPerMescola(20, abr);
        assert.ok(g.hard > g.soft, `abrasivita' ${abr}: hard ${g.hard} deve battere soft ${g.soft}`);
    }
});

test("suggestStrategy: su pista aggressiva servono piu' stint", () => {
    const dolce      = suggestStrategy(20, 0.75);
    const aggressiva = suggestStrategy(20, 1.35);
    assert.ok(aggressiva.length > dolce.length,
        `attesi piu' stint sull'aggressiva, ottenuti ${aggressiva.length} vs ${dolce.length}`);
});

test("suggestStrategy: senza abrasivita' il consiglio e' quello di sempre", () => {
    assert.deepEqual(suggestStrategy(20), suggestStrategy(20, 1));
});
