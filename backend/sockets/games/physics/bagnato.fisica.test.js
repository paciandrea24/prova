const test = require('node:test');
const assert = require('node:assert/strict');
const Aero = require('./AerodynamicsModel');
const Cornering = require('./CorneringGripModel');

function auto(extra) {
    return Object.assign({
        x: 0, z: 0, angle: 0, speed: 60, vx: 0, vz: 60,
        tyreWear: 0, compound: 'medium', bagnato: 0, rollio: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { steer: 1, throttle: 1, brake: 0 },
    }, extra || {});
}

test('il bagnato entra in ENTRAMBI i consumatori, non in uno solo', () => {
    const maxSpeed = 100;
    const asciutta = auto({ bagnato: 0 });
    const bagnata  = auto({ bagnato: 1, compound: 'medium' });

    const gripAsciutto = Aero.effectiveGrip(asciutta, false, maxSpeed);
    const gripBagnato  = Aero.effectiveGrip(bagnata, false, maxSpeed);
    assert.ok(gripBagnato > gripAsciutto,
        'effectiveGrip non cambia sul bagnato: l\'auto non scivola di piu\'');

    const capAsciutto = Cornering.corneringCapacity(asciutta, false, maxSpeed);
    const capBagnato  = Cornering.corneringCapacity(bagnata, false, maxSpeed);
    assert.ok(capBagnato < capAsciutto * 0.85,
        'corneringCapacity non cala sul bagnato: il bot entrerebbe in curva alla velocita\' dell\'asciutto');
});

test('il coefficiente di miscela non arriva mai a 1, o la fisica diverge', () => {
    const maxSpeed = 100;
    // Il caso peggiore che il gioco possa produrre: slick nel diluvio, gomme
    // finite, fondo distrutto, alla massima velocita'.
    const disastro = auto({
        bagnato: 1, compound: 'soft', tyreWear: 100,
        damageParts: { frontWing: 100, floor: 100, engine: 100, suspension: 100 },
        speed: maxSpeed,
    });
    const grip = Aero.effectiveGrip(disastro, false, maxSpeed);
    assert.ok(grip < 1, `coefficiente ${grip}: sopra 1 applyGripBlend amplifica invece di smorzare`);
    // E la miscela deve restare una media pesata, cioe' entrambi i pesi positivi.
    assert.ok(1 - grip > 0);
});

test('con la gomma giusta si perde meno che con quella sbagliata', () => {
    const maxSpeed = 100;
    const giusta = Cornering.corneringCapacity(auto({ bagnato: 1, compound: 'pioggia' }), false, maxSpeed);
    const slick  = Cornering.corneringCapacity(auto({ bagnato: 1, compound: 'soft' }), false, maxSpeed);
    assert.ok(giusta > slick * 1.3, `la gomma giusta rende troppo poco: ${giusta} contro ${slick}`);
});

test('un\'auto senza il campo bagnato si comporta come sull\'asciutto', () => {
    const maxSpeed = 100;
    const senza = auto(); delete senza.bagnato;
    assert.equal(Aero.effectiveGrip(senza, false, maxSpeed), Aero.effectiveGrip(auto({ bagnato: 0 }), false, maxSpeed));
    assert.equal(Cornering.corneringCapacity(senza, false, maxSpeed),
        Cornering.corneringCapacity(auto({ bagnato: 0 }), false, maxSpeed));
});

test('fuoripista: sul bagnato frena di piu che sull\'asciutto', () => {
    const { applyOffTrackDrag } = require('./VehicleMotionModel');
    const track = require('../trackLoader').loadTrack('prova');
    const fuori = (bagnato) => {
        const punto = track.points[100];
        const p = auto({ x: punto.x + 60, z: punto.z + 60, speed: 50, vx: 0, vz: 50, bagnato });
        applyOffTrackDrag(p, track);
        return p.speed;
    };
    assert.ok(fuori(1) < fuori(0), 'il bagnato non cambia il fuoripista');
});
