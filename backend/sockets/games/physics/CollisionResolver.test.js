// Il muro ferma l'auto dove il giocatore VEDE qualcosa. Dal 2026-09-04, sull'
// arco esterno delle curve, quel qualcosa sono le gomme: stanno davanti al
// muro e fermano loro. Rif. docs/superpowers/specs/2026-09-04-f1-barriere-sponsor-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGravel = require('../../../../frontend/shared/trackGravel.js');
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');
const { loadTrack } = require('../trackLoader.js');
const {
    applyBarrier, CAR_HALF_LENGTH, CAR_HALF_WIDTH,
} = require('./CollisionResolver.js');

// Il primo campione col cuscinetto, e da che lato.
function campioneConGomme(track) {
    for (let i = 0; i < track.points.length; i++) {
        for (const side of [1, -1]) {
            const banda = side > 0 ? track.barrierProfile.gomme.right
                                   : track.barrierProfile.gomme.left;
            if (banda[i]) return { i, side };
        }
    }
    return null;
}

// Un'auto ferma, lanciata oltre il bordo, con il muso lungo +Z.
function autoOltreIlBordo(track, i, side, distanza) {
    const pt = track.points[i];
    const { nx, nz } = TrackGeometry.normalAt(track.points, i, true);
    return {
        p: {
            x: pt.x + nx * side * distanza, z: pt.z + nz * side * distanza,
            vx: 0, vz: 0, speed: 0, angle: 0, trackIndex: i,
            damage: { front: 0, floor: 0, engine: 0, suspension: 0 },
        },
        pt, nx: nx * side, nz: nz * side,
    };
}

// Quanto sporge l'auto verso il muro: e' la stessa proiezione che usa
// applyBarrier, e senza tenerne conto il test misurerebbe il centro della
// vettura invece del suo spigolo.
function sporgenza(angle, wallNx, wallNz) {
    const musoX = Math.sin(angle), musoZ = Math.cos(angle);
    return Math.abs(CAR_HALF_LENGTH * (musoX * wallNx + musoZ * wallNz))
         + Math.abs(CAR_HALF_WIDTH * (musoZ * wallNx - musoX * wallNz));
}

test('sul cuscinetto di gomme l\'auto si ferma prima del muro', () => {
    const track = loadTrack('melbourne');
    const dove = campioneConGomme(track);
    assert.ok(dove, 'melbourne non ha un solo campione col cuscinetto');

    const muro = TrackGravel.barrierAt(track.barrierProfile, dove.i, dove.side);
    const impatto = TrackGravel.impattoAt(track.barrierProfile, dove.i, dove.side);
    const { p, pt, nx, nz } = autoOltreIlBordo(track, dove.i, dove.side, muro + 5);

    applyBarrier(p, track, false);

    const dist = Math.hypot(p.x - pt.x, p.z - pt.z);
    const sp = sporgenza(0, nx, nz);
    assert.ok(Math.abs(dist - (impatto - sp)) < 0.05,
        `l'auto si e' fermata a ${dist.toFixed(2)}: attesa a ${(impatto - sp).toFixed(2)} (gomme ${impatto.toFixed(2)}, muro ${muro.toFixed(2)})`);
    // E si e' fermata DAVVERO prima di dove la fermava il muro: senza questo
    // il test passerebbe anche con le gomme profonde zero.
    assert.ok(dist < muro - sp - 0.5,
        `l'auto si ferma a ${dist.toFixed(2)}, come se il cuscinetto non ci fosse`);
});

test('dove il cuscinetto non c\'e\' si sbatte sul muro come sempre', () => {
    const track = loadTrack('melbourne');
    // Un campione in rettilineo: nessuna gomma su nessuno dei due lati.
    let scelto = -1;
    for (let i = 0; i < track.points.length; i++) {
        if (!track.barrierProfile.gomme.right[i] && !track.barrierProfile.gomme.left[i]) {
            scelto = i; break;
        }
    }
    assert.ok(scelto >= 0, 'melbourne ha il cuscinetto ovunque');

    const muro = TrackGravel.barrierAt(track.barrierProfile, scelto, 1);
    const { p, pt, nx, nz } = autoOltreIlBordo(track, scelto, 1, muro + 5);
    applyBarrier(p, track, false);

    const dist = Math.hypot(p.x - pt.x, p.z - pt.z);
    const sp = sporgenza(0, nx, nz);
    assert.ok(Math.abs(dist - (muro - sp)) < 0.05,
        `senza gomme l'auto deve fermarsi al muro (${(muro - sp).toFixed(2)}), invece sta a ${dist.toFixed(2)}`);
});
