// backend/sockets/games/f1GameSocket.partenza.test.js
//
// LA PARTENZA CON LA FRIZIONE (richiesta dell'utente, 2026-09-11).
//
// La procedura: tieni premuto Spazio (o X col controller) mentre i semafori
// sono accesi, rilascia allo spegnimento, accelera. Quando la prendi non
// conta — puoi anche premerla un secondo prima del verde, o mollarla e
// riprenderla: e' strategia tua. Conta il RILASCIO dopo lo spegnimento.
//
// ⚠️ NESSUN BONUS E NESSUNA PENALITA' INVENTATA, decisione esplicita
// dell'utente: «non voglio boost o rallentamenti alle partenze, e' la
// reazione allo spegnimento del semaforo che stabilisce quanto e' buona la
// partenza». Quindi il meccanismo e' un CANCELLO: finche' la frizione e' giu'
// l'acceleratore non muove l'auto, e il ritardo che ci rimetti e' solo quello
// che ti sei preso davvero.
const test = require('node:test');
const assert = require('node:assert/strict');
const f1 = require('./f1GameSocket.js');

const P = f1.physics;

function pilota(extra = {}) {
    return {
        color: '#E74C3C', isBot: false,
        inputs: { throttle: 0, brake: 0, steer: 0, frizione: false },
        partenzaSbloccata: false, frizionePrec: false, reazionePartenzaMs: null,
        ...extra,
    };
}

// `tick` e' il numero di tick fisici dallo spegnimento dei semafori.
function gara(tick = 0) {
    return { phase: 'race', raceTick: tick, raceStarted: true };
}

test('con la frizione giu\' l\'acceleratore non muove l\'auto', () => {
    const p = pilota();
    p.inputs.frizione = true;
    p.inputs.throttle = 1;
    P.aggiornaFrizione(p, gara(1));
    assert.equal(p.partenzaSbloccata, false, 'il cancello deve restare chiuso');
    assert.equal(p.inputs.throttle, 0, 'il gas non deve arrivare alla fisica');
});

test('rilasciata la frizione, si parte', () => {
    const p = pilota();
    p.inputs.frizione = true;
    P.aggiornaFrizione(p, gara(1));      // la tiene
    p.inputs.frizione = false;
    p.inputs.throttle = 1;
    P.aggiornaFrizione(p, gara(2));      // la molla
    assert.equal(p.partenzaSbloccata, true);
    assert.equal(p.inputs.throttle, 1, 'da qui in poi il gas passa');
});

test('ripremerla dopo essere partiti non richiude niente', () => {
    // «Se la rilasci e poi la ripremi non succede niente»: una volta in moto
    // il tasto della frizione torna a essere un tasto qualunque. Un cancello
    // che si richiude sarebbe un modo di bloccare un avversario per sbaglio.
    const p = pilota();
    p.inputs.frizione = true;  P.aggiornaFrizione(p, gara(1));
    p.inputs.frizione = false; P.aggiornaFrizione(p, gara(2));
    assert.equal(p.partenzaSbloccata, true);

    p.inputs.frizione = true; p.inputs.throttle = 1;
    P.aggiornaFrizione(p, gara(20));
    assert.equal(p.inputs.throttle, 1, 'il gas deve continuare a passare');
});

test('chi non tocca mai la frizione resta fermo col gas premuto', () => {
    // E' la scelta dell'utente fra tre: «senza frizione non parti». Non e' una
    // penalita' aggiunta — e' che la frizione E' il modo di mettersi in moto.
    const p = pilota();
    p.inputs.throttle = 1;
    for (let t = 1; t <= 40; t++) P.aggiornaFrizione(p, gara(t));
    assert.equal(p.partenzaSbloccata, false);
    assert.equal(p.inputs.throttle, 0, 'due secondi di gas a vuoto, e l\'auto e\' ferma');

    // Poi capisce, preme e rilascia: parte, col ritardo che si e' preso.
    p.inputs.frizione = true;  P.aggiornaFrizione(p, gara(41));
    p.inputs.frizione = false; p.inputs.throttle = 1;
    P.aggiornaFrizione(p, gara(42));
    assert.equal(p.partenzaSbloccata, true);
    assert.equal(p.inputs.throttle, 1);
});

test('il tempo di reazione e\' quello dallo spegnimento al rilascio', () => {
    const p = pilota();
    p.inputs.frizione = true;
    for (let t = 1; t <= 5; t++) P.aggiornaFrizione(p, gara(t));
    p.inputs.frizione = false;
    P.aggiornaFrizione(p, gara(6));          // 6 tick = 300 ms
    assert.equal(p.reazionePartenzaMs, 6 * P.PHYSICS_TICK_MS);
});

test('mollare la frizione PRIMA del verde non apre niente: il cancello guarda dopo', () => {
    // ⚠️ Il caso si prova dove la finestra e' davvero chiusa: prima dello
    // spegnimento tickGame non arriva neanche qui, la fisica e' congelata.
    // Quello che deve reggere e' che al via il cancello sia chiuso comunque,
    // anche per chi ha passato la sequenza luci a pigiare il tasto.
    const p = pilota({ frizionePrec: false });
    p.inputs.throttle = 1;
    P.aggiornaFrizione(p, gara(1));
    assert.equal(p.partenzaSbloccata, false);
    assert.equal(p.inputs.throttle, 0);
});

test('i bot non hanno frizione: partono e basta', () => {
    // La loro reazione al via esiste gia' ed e' casuale (150-500 ms): e' la
    // stessa cosa, modellata da un'altra parte. Un bot col cancello chiuso
    // resterebbe fermo per sempre, perche' nessuno gli preme un tasto.
    const p = pilota({ isBot: true, partenzaSbloccata: true });
    p.inputs.throttle = 1;
    P.aggiornaFrizione(p, gara(1));
    assert.equal(p.inputs.throttle, 1);
});

test('l\'acceleratore a luci accese resta falsa partenza anche con la frizione giu\'', () => {
    // Decisione dell'utente: «se oltre a questo si preme anche l'acceleratore
    // e' falsa partenza». La frizione non e' un salvacondotto.
    const game = {
        phase: 'race', raceStarted: false, lightsSequenceActive: true,
        players: {
            conFrizione: pilota({ inputs: { throttle: 0.5, brake: 0, steer: 0, frizione: true } }),
            pulito:      pilota({ inputs: { throttle: 0, brake: 0, steer: 0, frizione: true } }),
        },
    };
    const io = { to: () => ({ emit: () => {} }) };
    f1.tickGame(io, 'L', game);
    assert.equal(game.players.conFrizione.falseStart, true, 'gas a luci accese: falsa partenza');
    assert.equal(!!game.players.pulito.falseStart, false, 'la sola frizione non e\' falsa partenza');
});
