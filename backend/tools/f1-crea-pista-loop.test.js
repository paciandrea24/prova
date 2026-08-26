// backend/tools/f1-crea-pista-loop.test.js
//
// La pista di prova della fase 2a. Non prova il generatore: prova che il
// risultato COMMITTATO sia ancora quello che serve al banco di prova — se un
// giorno il tubo diventa impercorribile, meglio saperlo da qui che dal
// playtest.
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackAcrobatico = require('../../frontend/shared/trackAcrobatico.js');
const { MAX_SPEED, ACCEL } = require('../sockets/games/physics/PowertrainModel.js');
const { G_ACROBATICO } = require('../sockets/games/physics/GravitaNastro.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');
const { RAGGIO } = require('./f1-crea-pista-loop.js');

test('loop-prova ha un giro della morte alto due raggi', () => {
    const track = loadTrack('loop-prova');
    const tubo = track.points.filter(p => p.acrobatico);
    assert.ok(tubo.length > 20, `il tubo ha ${tubo.length} campioni`);
    const cima = tubo.reduce((a, b) => (b.y > a.y ? b : a));
    assert.ok(Math.abs(cima.y - 2 * RAGGIO) < 2, `la cima sta a ${cima.y.toFixed(1)}, non a ${2 * RAGGIO}`);
});

test('la velocita\' che il giro chiede e\' raggiungibile, con margine', () => {
    const serve = TrackAcrobatico.velocitaMinima(RAGGIO, G_ACROBATICO);
    assert.ok(serve < MAX_SPEED * 0.85,
        `servono ${serve.toFixed(2)} u/tick su ${MAX_SPEED}: senza margine non lo completa nessuno`);
});

test('il rettilineo prima del giro basta per arrivarci lanciati', () => {
    // Partendo da fermo con ACCEL, per raggiungere la velocita' d'ingresso
    // servono v²/(2·a) unita'. Il test ne pretende almeno il doppio: non ci si
    // arriva mai da fermi, ma un banco di prova deve poter essere sbagliato dal
    // giocatore, non dalla pista.
    const serve = Math.pow(TrackAcrobatico.velocitaMinima(RAGGIO, G_ACROBATICO), 2) / (2 * ACCEL);
    const track = loadTrack('loop-prova');
    const n = track.points.length;
    const primoTubo = track.points.findIndex(p => p.acrobatico);
    assert.ok(primoTubo >= 0, 'la pista non ha nessun campione acrobatico');
    const passo = track.lapLength / n;
    let dritto = 0;
    for (let k = 1; k < n; k++) {
        const i = (primoTubo - k + n) % n;
        if (track.points[i].acrobatico) break;
        dritto += passo;
    }
    assert.ok(dritto > serve * 2,
        `prima del giro ci sono ${dritto.toFixed(0)} unita', ne servono ${(serve * 2).toFixed(0)}`);
});

test('dentro il tubo la carreggiata non cambia', () => {
    // Decisione dell'utente: «gia' sara' un tratto difficile da percorrere in
    // gara, se poi restringiamo anche la corsia e' finita».
    const track = loadTrack('loop-prova');
    for (const p of track.points.filter(x => x.acrobatico)) {
        assert.equal(p.halfWidth, track.roadHalf, 'un campione del tubo ha una larghezza sua');
    }
});
