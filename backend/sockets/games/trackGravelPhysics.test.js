// backend/sockets/games/trackGravelPhysics.test.js
//
// Guardia sulle costanti di fisica che `trackGravel.js` è costretto a
// duplicare.
//
// Perché la duplicazione esiste: `trackGravel.js` sta in `frontend/shared/` ed
// è caricato dal browser con un tag <script>, senza bundler e senza accesso a
// `backend/`. Non può quindi richiedere `PowertrainModel`/`SteeringModel`, che
// sono moduli CommonJS del server. Il precedente in casa è
// `ENGINE_REF_MAX_SPEED` in `f1.js`, tenuto allineato "a mano" da un commento.
//
// Perché serve questo test: la larghezza della ghiaia è calcolata dalla
// velocità di percorrenza delle curve, e quella velocità esce da queste tre
// costanti. Se un giorno la fisica dell'auto cambia e la copia resta indietro,
// niente si rompe in modo visibile — le vie di fuga restano semplicemente
// tarate su un'auto che non esiste più, e nessuno se ne accorge. Questo test
// trasforma quel silenzio in un fallimento.
//
// Se sei qui perché il test è rosso: NON allineare i numeri e basta. Le vie di
// fuga vanno guardate dopo, perché la loro larghezza cambia con la fisica —
// vedi `docs/f1-notes.md`, sezione sulle vie di fuga in ghiaia.
const test = require('node:test');
const assert = require('node:assert/strict');

const TrackGravel = require('../../../frontend/shared/trackGravel.js');
const PowertrainModel = require('./physics/PowertrainModel');
const SteeringModel = require('./physics/SteeringModel');

test('le costanti di fisica copiate in trackGravel.js sono ancora quelle vere', () => {
    assert.equal(TrackGravel.MAX_SPEED, PowertrainModel.MAX_SPEED,
        'MAX_SPEED: la copia in trackGravel.js si è scollegata da PowertrainModel');
    assert.equal(TrackGravel.TURN_SPEED_LOW, SteeringModel.TURN_SPEED_LOW,
        'TURN_SPEED_LOW: la copia in trackGravel.js si è scollegata da SteeringModel');
    assert.equal(TrackGravel.TURN_SPEED_HIGH, SteeringModel.TURN_SPEED_HIGH,
        'TURN_SPEED_HIGH: la copia in trackGravel.js si è scollegata da SteeringModel');
});

test('cornerSpeed riproduce la velocita\' di regime della fisica vera', () => {
    // Non basta che le costanti coincidano: la FORMULA che le usa deve dare
    // la stessa velocità che l'auto tiene davvero. Qui si verifica contro la
    // sterzata reale invece che contro l'algebra — si fa girare l'auto a
    // sterzo pieno alla velocità che cornerSpeed prevede, si misura il raggio
    // che ne esce e lo si confronta con quello di partenza.
    for (const raggio of [25, 45, 70, 100]) {
        const v = TrackGravel.cornerSpeed(raggio);
        const p = {
            speed: v, vx: 0, vz: 0, angle: 0,
            damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
            inputs: { steer: 1 },
        };
        SteeringModel.applySteering(p, false, PowertrainModel.MAX_SPEED);
        // p.angle è la rotazione applicata in un tick a sterzo pieno; con
        // velocità v il raggio percorso è v / rotazione.
        const raggioReale = v / p.angle;
        assert.ok(Math.abs(raggioReale - raggio) < raggio * 0.02,
            `raggio ${raggio}: cornerSpeed dice ${v.toFixed(3)}, ma a quella velocità l'auto gira su ${raggioReale.toFixed(1)}`);
    }
});

test('nessuna curva possibile chiede piu\' ghiaia del massimo dichiarato', () => {
    // CORNER_RADIUS_MAX è la soglia oltre la quale un punto non è più in
    // curva, quindi è il raggio più largo che possa comparire come minRadius.
    // Con spazio illimitato, la larghezza che ne esce è il tetto reale della
    // feature: serve che resti sotto GRAVEL_WIDTH_AT_TOP_SPEED, altrimenti la
    // costante non descrive più quello che il suo nome promette.
    const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
    const tetto = TrackGravel.cornerGravelWidth(TrackGeometry.CORNER_RADIUS_MAX, Infinity);
    assert.ok(tetto <= TrackGravel.GRAVEL_WIDTH_AT_TOP_SPEED + 1e-9,
        `la curva più larga possibile chiede ${tetto.toFixed(1)}, oltre il massimo dichiarato`);
    assert.ok(TrackGravel.cornerGravelWidth(1, Infinity) === TrackGravel.GRAVEL_WIDTH_MIN,
        'un tornante strettissimo si ferma al minimo, non a zero');
});
