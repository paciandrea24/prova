// backend/sockets/games/f1GameSocket.pitReazione.test.js
//
// Il gioco di reazione ai box, rifatto (richiesta utente 2026-08-19): non piu
// un'attesa casuale a macchina ferma con Spazio, ma un indicatore dipinto sulla
// corsia, poco prima del punto in cui l'autopilota comincia a sterzare verso lo
// stallo. Dove si preme decide la durata della sosta, in tre esiti discreti.
//
// Cosa proteggono questi test:
//   - che il giudizio sia sulla POSIZIONE e non sul tempo, cioe' che premere
//     nello stesso punto dia lo stesso esito comunque si sia arrivati li;
//   - la compensazione del ritardo di rete, che a 31 unita/s vale meta della
//     fascia "perfetta" ogni 100 ms e senza la quale il gioco sarebbe ingiusto
//     verso chi ha la connessione peggiore;
//   - che chi non preme non resti bloccato: la sosta parte lo stesso, lenta.
const test = require('node:test');
const assert = require('node:assert/strict');
const f1 = require('./f1GameSocket.js');
const { loadTrack } = require('./trackLoader.js');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const BoxIngresso = require('../../../frontend/shared/f1BoxIngresso.js');

const P = f1.physics;

function ioFinto(raccolti = []) {
    return {
        to: () => ({ emit: (nome, dati) => raccolti.push({ nome, dati }) }),
        raccolti,
    };
}

// Un pilota gia' in corsia box, col piano d'ingresso calcolato, fermo a
// `rimanente` unita dal proprio stallo.
function pilotaInCorsia(trackId = 'prova', boxIndex = 2) {
    const track = loadTrack(trackId);
    const anchors = TrackGeometry.pitBoxAnchors(track.pitPath, track.pitBoxIndex, 8, track.points, track.pitRoadHalf);
    P.addLaneIndices(track, anchors);
    const p = {
        color: '#E74C3C', isBot: false, x: 0, z: 0, angle: 0, speed: 0,
        pitAutoState: 'entering', pitBoxAnchor: anchors[boxIndex], pitPathIndex: 0,
    };
    p.pitPiano = P.pianoIngressoDi(track, p);
    const game = { track, socketByColor: { '#E74C3C': 'sock' }, raceTick: 1000, players: { '#E74C3C': p } };
    return { track, p, game, anchors };
}

// Il valore di `pitRimanente` (misurato sul CENTRO dell'auto) nell'istante in
// cui il MUSO si trova a `scarto` unita dal muro.
function centroQuandoIlMusoE(piano, scarto) {
    return piano.muro + BoxIngresso.SEMILUNGHEZZA_AUTO + scarto;
}

test('premere col muso sul muro vale perfetta, poco fuori buona, lontano lenta', () => {
    const casi = [
        ['col muso sul muro', 0, BoxIngresso.PERFETTA],
        ['appena dentro la tolleranza', BoxIngresso.MURO_PERFETTO - 0.2, BoxIngresso.PERFETTA],
        ['appena fuori', BoxIngresso.MURO_PERFETTO + 0.5, BoxIngresso.BUONA],
        ['al limite della buona', BoxIngresso.MURO_BUONO - 0.3, BoxIngresso.BUONA],
        ['troppo presto', BoxIngresso.MURO_BUONO + 2, BoxIngresso.LENTA],
        ['troppo tardi', -(BoxIngresso.MURO_BUONO + 2), BoxIngresso.LENTA],
    ];
    for (const [nome, scarto, atteso] of casi) {
        const { p, game } = pilotaInCorsia();
        p.pitRimanente = centroQuandoIlMusoE(p.pitPiano, scarto);
        P.handlePitReactionPress(ioFinto(), 'L', game, p);
        assert.equal(p.pitEsito, atteso, `premendo ${nome} (scarto ${scarto}) l esito e ${p.pitEsito}`);
    }
});

test('si giudica il MUSO: col centro dell auto sul muro non e piu perfetta', () => {
    // Il difetto del playtest 2026-08-19: chi gioca mira con la punta, e il
    // centro sta 3.58 unita piu indietro — piu della tolleranza perfetta
    // intera. «Mi e sembrato che stessi sulla porzione verde quando ho premuto
    // spazio ma mi ha sempre dato buona.»
    const { p, game } = pilotaInCorsia();
    p.pitRimanente = p.pitPiano.muro;   // centro sul muro = muso gia oltre
    P.handlePitReactionPress(ioFinto(), 'L', game, p);
    assert.equal(p.pitEsito, BoxIngresso.BUONA);
});

test('l esito si decide una volta sola: premere ancora non lo cambia', () => {
    const { p, game } = pilotaInCorsia();
    p.pitRimanente = centroQuandoIlMusoE(p.pitPiano, 0);
    P.handlePitReactionPress(ioFinto(), 'L', game, p);
    assert.equal(p.pitEsito, BoxIngresso.PERFETTA);
    // Martellare il tasto dopo aver gia' preso "perfetta" non deve poterla
    // rovinare, ne' un secondo tentativo deve poterla migliorare.
    p.pitRimanente = 0;
    P.handlePitReactionPress(ioFinto(), 'L', game, p);
    assert.equal(p.pitEsito, BoxIngresso.PERFETTA);
});

test('fuori dalla fase di ingresso la pressione non conta e non brucia nulla', () => {
    const { p, game } = pilotaInCorsia();
    p.pitRimanente = centroQuandoIlMusoE(p.pitPiano, 0);
    p.pitAutoState = null;              // gia' fermo nello stallo, o ancora in pista
    P.handlePitReactionPress(ioFinto(), 'L', game, p);
    assert.equal(p.pitEsito, undefined, 'ha giudicato una pressione fuori tempo');
});

test('il ritardo di rete si compensa: si e giudicati dove si era, non dove si e arrivati', () => {
    // Il giocatore preme vedendo l'auto al centro della zona. Il messaggio
    // arriva 100 ms dopo, quando l'auto e' gia' avanzata di ~3 unita: senza
    // compensazione il server la giudicherebbe li, e con una fascia perfetta
    // larga 6 unita basterebbe questo a trasformare una perfetta in una buona.
    const { p, game } = pilotaInCorsia();
    const centro = centroQuandoIlMusoE(p.pitPiano, 0);
    const ritardoMs = 100;
    const avanzamento = (ritardoMs / 50) * P.PIT_AUTO_SPEED;   // 50 ms per tick fisico

    // Dove si trova l'auto ADESSO, sul server: gia' oltre il centro.
    p.pitRimanente = centro - avanzamento;
    // Il client dichiara il tempo di gara che aveva quando ha premuto.
    P.handlePitReactionPress(ioFinto(), 'L', game, p, { elapsedMs: game.raceTick * 50 - ritardoMs });
    assert.equal(p.pitEsito, BoxIngresso.PERFETTA, 'la compensazione non ha recuperato il ritardo');

    // Senza dichiarare nulla, lo stesso istante vale meno: e' la prova che la
    // compensazione stia davvero facendo qualcosa.
    const secondo = pilotaInCorsia();
    secondo.p.pitRimanente = centro - avanzamento;
    P.handlePitReactionPress(ioFinto(), 'L', secondo.game, secondo.p);
    assert.notEqual(secondo.p.pitEsito, BoxIngresso.PERFETTA);
});

test('un client che dichiara un tempo assurdo non si regala una perfetta', () => {
    const { p, game } = pilotaInCorsia();
    const centro = centroQuandoIlMusoE(p.pitPiano, 0);
    // Preme quando e' gia' arrivatissimo, ma dichiara di aver premuto dieci
    // secondi fa: la compensazione e' tappata, quindi il recupero massimo e'
    // di PIT_LATENZA_MAX_MS e non basta a coprire la distanza.
    p.pitRimanente = 0;
    P.handlePitReactionPress(ioFinto(), 'L', game, p, { elapsedMs: game.raceTick * 50 - 10000 });
    const recuperoMassimo = (P.PIT_LATENZA_MAX_MS / 50) * P.PIT_AUTO_SPEED;
    assert.ok(recuperoMassimo < centro - BoxIngresso.MURO_PERFETTO,
        'il tetto alla compensazione non protegge la fascia perfetta');
    assert.equal(p.pitEsito, BoxIngresso.LENTA);
});

test('chi non preme si prende la sosta lenta, e la sosta parte lo stesso', () => {
    const { p, game } = pilotaInCorsia();
    const io = ioFinto();
    P.startPitStop(io, 'L', game, p);
    assert.equal(p.pitting, true, 'la sosta non e partita');
    const avvio = io.raccolti.find(m => m.nome === 'f1PitStopStarted');
    assert.ok(avvio, 'nessun annuncio di inizio sosta');
    assert.equal(avvio.dati.esito, BoxIngresso.LENTA);
    assert.equal(avvio.dati.durationMs, P.PIT_DURATA_LENTA);
});

test('le tre durate sono distinte e ordinate', () => {
    assert.equal(P.durataPerEsito(BoxIngresso.PERFETTA), P.PIT_DURATA_PERFETTA);
    assert.equal(P.durataPerEsito(BoxIngresso.BUONA), P.PIT_DURATA_BUONA);
    assert.equal(P.durataPerEsito(BoxIngresso.LENTA), P.PIT_DURATA_LENTA);
    assert.equal(P.durataPerEsito(null), P.PIT_DURATA_LENTA, 'senza esito si paga la piu lunga');
    assert.ok(P.PIT_DURATA_PERFETTA < P.PIT_DURATA_BUONA && P.PIT_DURATA_BUONA < P.PIT_DURATA_LENTA);
});

test('il muro sta dove lo vede il giocatore: prima della sterzata, sulla corsia', () => {
    // Il disegno (client) e il giudizio (server) vengono dallo STESSO piano: se
    // fossero due calcoli diversi si scosterebbero in silenzio, e si verrebbe
    // giudicati su un muro diverso da quello che si vede.
    for (const id of ['prova', 'monte-rosso']) {
        const { track, p } = pilotaInCorsia(id, 3);
        const muro = BoxIngresso.muroReazione(track.pitLanePts, p.pitPiano);
        const d = TrackGeometry.nearestPoint(track.pitLanePts, muro.x, muro.z).dist;
        assert.ok(d < 1.5, `${id}: il muro e piantato a ${d.toFixed(2)} unita dalla corsia`);
        assert.ok(p.pitPiano.muro > p.pitPiano.inizioRaccordo,
            `${id}: il muro cade dopo l inizio della sterzata`);
    }
});
