const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');
const { loadTrack } = require('./trackLoader');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const { createBots, updateBotInputs, estimateFinishTime, nearestAheadPlayer } = require('./f1Bot');
const TyreModel = require('./physics/TyreModel');
const {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND, WEAR_LAPS_AT_MEDIUM,
    // WEAR_SPEED_PENALTY/WEAR_GRIP_PENALTY: servono ancora a effectiveMaxSpeed/
    // effectiveGrip, che restano funzioni LOCALI in questo file fino al Task 3
    // (si spostano in VehiclePhysics.js solo lì) — senza questi due
    // nell'import, quelle due funzioni smetterebbero di trovare i nomi non
    // appena rimuoviamo le costanti originali nello Step 3 qui sotto. Vanno
    // tolti da qui nel Task 3 (Step 2), quando effectiveMaxSpeed/effectiveGrip
    // se ne vanno e VehiclePhysics.js li importa per conto proprio.
    WEAR_SPEED_PENALTY, WEAR_GRIP_PENALTY,
    tyreOf, applyTyreWear, suggestStrategy
} = TyreModel;

const PHYSICS_TICK_MS = 50;
// Velocità realistica F1: fattore di scala R=1.55 (+55%) applicato a
// MAX_SPEED/ACCEL/FRICTION rispetto ai valori storici (4.0/0.12/0.050).
// Km/h a schermo = speed * 55 (frontend/f1.js): 6.2 → 341 km/h base Medium,
// 358 Soft, 324 Hard. Vedi docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
const MAX_SPEED    = 6.2;
const ACCEL        = 0.186;
// FRICTION scalato ×R² (non ×R) come la frenata sotto: è un decremento
// costante per tick, quindi lo spazio di "coast-down" va con v²/decel — a
// parità di R, senza lo ×R² il rilascio del gas sembrerebbe non rallentare
// quasi per niente rispetto a oggi.
const FRICTION     = 0.120;
// Velocità di sterzata dipendente dalla velocità dell'auto (non più un
// unico valore fisso): pieno sterzo a bassa velocità per manovre strette
// (tornanti, uscita curva), più contenuto al massimo — come un'auto vera.
// Richiesto esplicitamente dall'utente, che trovava lo sterzo "rigido" sia
// in generale (valore assoluto basso) sia perché identico a ogni velocità
// (nessuna differenza basso/alto regime). Vedi interpolazione in
// updateVelocity in base a |p.speed|/maxSpeed.
const TURN_SPEED_LOW  = 0.075;   // rad/tick a velocità quasi nulla (era 0.048 fisso, +56%)
const TURN_SPEED_HIGH = 0.052;   // rad/tick alla velocità massima (era 0.048 fisso, +8%)
const GRIP         = 0.78;
const BRAKE_MULT   = 2.17;   // moltiplicatore di ACCEL in frenata (era 1.4 a MAX_SPEED=4.0)

// Scia: un'auto che segue da vicino un'altra (stessa distanza lungo la
// pista già usata per il "seguire" dei bot, non una posizione laterale)
// ottiene un bonus di velocità massima, tanto più grande quanto più è
// vicina, azzerato oltre SLIPSTREAM_RANGE_M — vale per TUTTI i giocatori
// (umani e bot), stesso meccanismo, richiesto esplicitamente dall'utente
// per rendere più frequenti i sorpassi: chi insegue recupera terreno.
// Solo in GARA (mai in qualifica, dove ogni pilota corre isolato — vedi
// playersVisibleTo — un boost da un'auto invisibile sarebbe incomprensibile).
const SLIPSTREAM_RANGE_M   = 25;
const SLIPSTREAM_MAX_BOOST = 0.08;   // fino a +8% di velocità massima quasi a contatto
const REJOIN_GRACE = 60000;   // finestra di riconnessione dopo un drop (scheda in background, refresh, rete)
const GRID_DISPLAY_MS = 8000; // quanto resta a schermo l'animazione POLE + la griglia prima del countdown di gara
// Il normale flusso qualifica->griglia->gara ha già una pausa naturale
// (GRID_DISPLAY_MS) tra la fine di una sessione e l'inizio della prossima,
// tempo per staccare il piede dall'acceleratore. "Riprova" (modalità
// singola) invece incatenava resetPlayers/assignGridSpawns e il semaforo
// nello stesso istante, senza alcuna pausa: chi finiva la gara tenendo
// premuto l'acceleratore lo teneva ancora premuto un attimo dopo — falsa
// partenza "vera" secondo la regola, ma percepita come un bug perché non
// c'era mai stato un momento naturale per rilasciare il tasto.
const RESTART_GRACE_MS = 1500;

// Ingombro reale dell'auto, misurato dal GLB (raceCarWhite.glb, bounding box
// combinata body+ruote applicando le translation dei nodi) × lo scale 3.5 con
// cui il modello viene caricato in f1.js: ~2.6 unità di larghezza (fianchi),
// ~4.7 di lunghezza (muso/coda). Il rettangolo va tenuto orientato con
// l'angolo dell'auto (SAT), altrimenti un cerchio esagera soprattutto i fianchi.
// Valori misurati sul modello custom (frontend/assets/custom/f1Car.glb):
// bbox GLB 0.992 x 2.048 (largh. x lungh.) x scale 3.5 = 3.47 x 7.17 in
// gioco -> metà 1.74 x 3.58. Prima erano 1.3/2.4, tarate sul vecchio kart
// Kenney molto più piccolo — con quelle le ruote posteriori del modello
// nuovo restavano fuori dall'hitbox.
const CAR_HALF_LENGTH  = 3.58;  // metà lunghezza, asse avanti/dietro (locale Z)
const CAR_HALF_WIDTH   = 1.74;  // metà larghezza, asse fianchi (locale X)
const COLLISION_BOUNCE = 0.6;  // quota della velocità normale scambiata all'urto (bump arcade, non elastico puro)

// A MAX_SPEED (6.2/tick) due auto che si avvicinano chiudono fino a 12.4
// unità in un tick — più della zona di contatto minima (~2.6, urto
// fianco-contro-fianco lungo l'asse stretto): senza integrare la posizione
// in sottostep, il rilevamento SAT (fatto una volta a fine tick) può non
// vedere mai la sovrapposizione e le auto si attraversano. 13 sottostep →
// chiusura massima ~0.95 unità/sottostep, stesso margine di sicurezza che
// c'era a MAX_SPEED=4.0 con 8 sottostep.
const COLLISION_SUBSTEPS = 13;

// Sui tratti ponte, uscire lateralmente non deve far "cadere" l'auto (senza
// terreno vero sotto finché non ricade sul terrapieno più lontano, vedi
// Fase 2): il bordo diventa un muro rigido. Stessa soglia già usata per il
// fuoripista (roadHalf+2 in applyOffTrackDrag), non una nuova distanza.
const BRIDGE_BARRIER_MARGIN = 2;
// Quanta della componente di velocità che spinge oltre il muro (lungo la
// normale, verso l'esterno) viene rimossa ad ogni contatto — la componente
// parallela al muro non viene mai toccata da questo fattore (vedi
// applyBridgeBarrier: nessun calcolo/scelta di verso, solo rimozione della
// spinta verso l'esterno).
const BRIDGE_BARRIER_SLOWDOWN = 0.5;
// Attrito continuo applicato a tutta la velocità (non solo alla componente
// normale) finché l'auto resta appoggiata al muro — un rallentamento reale
// e sostenuto, non solo un colpo secco al momento dell'urto, richiesto
// esplicitamente dall'utente ("non velocità visibile dal contatore ma
// proprio un rallentamento"). Applicato ad ogni sotto-step di contatto
// (COLLISION_SUBSTEPS per tick): da tarare a vista, un valore troppo alto
// qui si amplifica rapidamente su contatti prolungati.
const BRIDGE_BARRIER_CONTACT_DRAG = 0.01;

const PIT_AUTO_SPEED = 1.55;   // unità/tick dell'autopilota lungo il percorso box (25% di MAX_SPEED)
const PIT_AUTO_ARRIVE_DIST = 1.0;   // sotto questa distanza dal waypoint, "arrivato"

// Riquadro pieno allineato agli assi (xMin/xMax/zMin/zMax): a differenza
// della vecchia versione (solo "x <= xMax", pensata per un rettilineo box
// orientato lungo Z come in Monte Rosso), funziona per un rettilineo con
// qualunque orientamento — es. Monza, dove la corsia box si stacca da un
// rettilineo orientato lungo X.
function inPitEntryZone(p, track) {
    const t = track.pitEntryTrigger;
    return p.x >= t.xMin && p.x <= t.xMax && p.z >= t.zMin && p.z <= t.zMax;
}

// Fuoripista: distanza dal punto più vicino della pista caricata.
function nearestTrackDist(track, x, z) {
    return TrackGeometry.nearestPoint(track.points, x, z).dist;
}

const TYRE_SELECT_MS   = 20000;   // tempo per scegliere prima che scatti la mescola di default

const DAMAGE_GRIP_THRESHOLD    = 33;    // % danno oltre cui inizia la perdita di aderenza
const DAMAGE_STEER_THRESHOLD   = 66;    // % danno oltre cui inizia il rumore sullo sterzo
const DAMAGE_SPEED_PENALTY_MAX = 0.30;  // fino a -30% velocità massima a danno 100%
const DAMAGE_GRIP_PENALTY_MAX  = 0.35;  // fino a -35% aderenza, attivo solo oltre DAMAGE_GRIP_THRESHOLD
const DAMAGE_STEER_NOISE_MAX   = 0.15;  // rumore massimo sterzo (frazione, sommata a inputs.steer), oltre DAMAGE_STEER_THRESHOLD

// ====================================================
// MINIGIOCO DI REAZIONE AL PIT STOP
// Il server è autoritativo sul tempo di reazione (misura dal proprio invio
// del segnale "vai" alla ricezione della pressione — include la latenza di
// rete, limite accettato). Premere prima del segnale = falsa partenza, sosta
// alla durata massima.
// ====================================================
const PIT_GO_DELAY_MIN  = 1000, PIT_GO_DELAY_MAX  = 3000;   // attesa casuale prima del segnale
const PIT_REACTION_BEST = 150,  PIT_REACTION_WORST = 800;   // ms: sotto/sopra questi si satura
// 2.0s-3.0s: range realistico da gioco F1 (richiesto dall'utente, che
// trovava 3.0s-7.0s troppo lento anche a reazione ottima).
const PIT_DURATION_MIN  = 2000, PIT_DURATION_MAX   = 3000;  // durata sosta risultante
const PIT_PENALTY_MS    = 30000;   // penalità se non si fa MAI pit stop in gara (regola F1 vera)
const REPAIR_MS_PER_DAMAGE_PCT = 150;   // ms extra di sosta per ogni % di danno riparato

// Semaforo di partenza (solo gara, mai in qualifica): 5 luci, una ogni
// LIGHT_INTERVAL_MS, poi un'attesa casuale prima che si spengano tutte
// insieme = via (come in F1 vera — l'attesa casuale impedisce di "contare"
// il ritmo e accelerare a colpo sicuro).
const LIGHT_COUNT       = 5;
const LIGHT_INTERVAL_MS = 1000;
const LIGHTS_ALL_ON_MS  = (LIGHT_COUNT - 1) * LIGHT_INTERVAL_MS;   // 4000: tutte accese
const HOLD_MIN_MS       = 200, HOLD_MAX_MS = 3000;
const FALSE_START_PENALTY_MS = 5000;

const GAP_RECALC_MS = 3500;   // ricalcolo distacco dal leader — non serve più frequente, è una stima


// p.damage va letto come (p.damage || 0): gli strumenti offline
// (f1LapSimulator.js, f1RaceLineOptimizer.js) costruiscono i loro player di
// simulazione senza campo damage — con una lettura diretta p.damage/100
// darebbe NaN e romperebbe la simulazione. Per i giocatori reali damage è
// sempre un numero (mai undefined, vedi init in joinF1Game/createBots).
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    const damageFactor = isQuali ? 1 : 1 - ((p.damage || 0) / 100) * DAMAGE_SPEED_PENALTY_MAX;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * damageFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    const gripDamageFrac = isQuali ? 0
        : Math.max(0, (p.damage || 0) - DAMAGE_GRIP_THRESHOLD) / (100 - DAMAGE_GRIP_THRESHOLD);
    const damageFactor = 1 - gripDamageFrac * DAMAGE_GRIP_PENALTY_MAX;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * damageFactor;
}

// Rumore sullo sterzo da danno grave (>DAMAGE_STEER_THRESHOLD), solo in
// gara. rng iniettabile per test deterministici (stesso pattern di
// randRange in f1Bot.js). Stesso fallback (p.damage || 0) di
// effectiveMaxSpeed/effectiveGrip per i player senza il campo (strumenti offline).
function applyDamageSteerNoise(p, isQuali, rng = Math.random) {
    const damage = p.damage || 0;
    if (isQuali || damage <= DAMAGE_STEER_THRESHOLD) return 0;
    const frac = (damage - DAMAGE_STEER_THRESHOLD) / (100 - DAMAGE_STEER_THRESHOLD);
    return (rng() * 2 - 1) * frac * DAMAGE_STEER_NOISE_MAX;
}

// ====================================================
// SOCKET HANDLER
// ====================================================
module.exports = function (io, socket) {

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId !== 'f1') return;
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
            lobby.gameSettings = settings;
            lobby.lockedPlayers = [...lobby.players];
        }
        io.to(lobbyId).emit('gameSelected', { gameId, settings });
    });

    socket.on('joinF1Game', ({ lobbyId, playerColor }) => {
        socket.join(lobbyId);
        socket.lobbyId = lobbyId;
        socket.color   = playerColor;
        // Marca QUESTO socket come partecipante reale alla gara. Serve al guard
        // del disconnect qui sotto per distinguerlo dai vecchi socket-lobby.
        socket.data.joinedF1 = true;

        if (!activeGames.has(lobbyId)) {
            const lobby   = lobbies.get(lobbyId);
            const trackId = (lobby && lobby.gameSettings && lobby.gameSettings.trackId) || 'monte-rosso';
            let track;
            try {
                track = loadTrack(trackId);
            } catch (err) {
                console.error(`joinF1Game: impossibile caricare la pista "${trackId}", fallback a "monte-rosso":`, err);
                track = loadTrack('monte-rosso');
            }
            activeGames.set(lobbyId, {
                gameId:            'f1',   // marca il tipo: gli handler condivisi (disconnect) NON devono toccare partite di altri giochi
                track:             track,
                phase:             'tyre_select',   // tyre_select -> qualifying -> grid_display -> race -> race_end
                players:           {},
                socketByColor:     {},   // color -> socket.id CORRENTE, per gli emit personalizzati in qualifica
                tick:              null,
                raceStarted:       false,
                raceEnded:         false,
                raceStartTime:     null,
                lastGapRecalc:     0,      // timestamp ultimo ricalcolo distacco dal leader (vedi GAP_RECALC_MS)
                endTimeout:        null,
                qualiEnded:        false,
                qualiEndTimeout:   null,   // timer di sicurezza: dà agli altri il tempo di finire il giro se qualcuno resta molto indietro
                tyreSelectTimeout: null,
                tyreConfirmed:     new Set(),   // color di chi ha già scelto/confermato la mescola
                grid:              null,   // ordine di partenza determinato dalla qualifica (array di colori)
                hostColor:         lobby ? lobby.host : playerColor,
                settings:          lobby ? (lobby.gameSettings || {}) : {},
                rejoinTimers:      {}   // color -> timeout di rimozione definitiva dopo un drop
            });

            // Riempie la griglia con bot fino a MAX_GRID_SIZE (6), se
            // abilitati in lobby (game.settings.botsEnabled, default on).
            // Fisso a questo momento: vedi commento su createBots.
            createBots(activeGames.get(lobbyId), lobby, TYRE_COMPOUNDS);
        }

        const game       = activeGames.get(lobbyId);
        const totalLaps  = game.track.totalLaps;
        const isRejoin   = !!game.players[playerColor];

        // Aggiornato ad OGNI join/rejoin: il socket.id cambia ad ogni riconnessione,
        // serve sempre l'ultimo per gli emit personalizzati durante la qualifica.
        game.socketByColor[playerColor] = socket.id;

        if (isRejoin) {
            // Rientro entro la grazia: annulla la rimozione definitiva e riprende
            // dallo stato attuale (posizione/giro), NIENTE reset allo spawn.
            if (game.rejoinTimers && game.rejoinTimers[playerColor]) {
                clearTimeout(game.rejoinTimers[playerColor]);
                delete game.rejoinTimers[playerColor];
                console.log(`♻️ [F1] ${playerColor} rientrato entro la grazia (lobby ${lobbyId})`);
            }
            game.players[playerColor].disconnected = false;
        } else {
            game.players[playerColor] = {
                color:           playerColor,
                x:               game.track.qualiSpawn.x,
                z:               game.track.qualiSpawn.z,
                angle:           game.track.qualiSpawn.angle,
                speed:           0,
                vx:              0,
                vz:              0,
                inputs:          { throttle: 0, brake: 0, steer: 0 },
                finished:        false,
                time:            null,
                lap:             0,
                checkpointA:     false,
                inFinishZone:    false,
                disconnected:    false,
                trackIndex:      0,
                compound:        null,   // scelto in tyre_select (null finché non conferma)
                tyreWear:        0,
                pitting:         false,   // true = fermo ai box, fisica congelata
                pitPhase:        null,    // waiting -> go -> done (null fuori dal pit stop)
                pitGoTime:       null,    // timestamp server di invio del segnale "vai"
                pitGoTimer:      null,
                pendingCompound: null,    // mescola scelta ai box, applicata a fine sosta
                hasPitted:       false,   // per l'obbligo di almeno un pit stop in gara
                pitPenalty:      false,   // true se ha preso la penalità per non aver fatto pit stop
                falseStart:      false,   // true se ha accelerato mentre le luci erano accese (resta true per tutta la gara, indicatore storico)
                falseStartServed: false,  // true una volta scontata la penalità al primo pit stop
                gapToLeaderMs:   null,    // stima distacco dal leader in ms, null per il leader stesso o prima del primo ricalcolo
                pitAutoState:    null,    // 'entering' | 'exiting' | null — autopilota corsia box
                pitPathIndex:    0,       // prossimo waypoint del percorso box (track.pitPath) verso cui puntare
                inSlipstream:    false,   // bonus di velocità in scia attivo in questo tick (solo effetto visivo lato client)
                damage:                  0,       // 0-100, come tyreWear — solo in gara (vedi assignGridSpawns/checkLap)
                collisionPenaltyMs:      0,       // penalità di tempo accumulata per collisioni causate, sommata a p.time al traguardo
                pendingRepair:           false,   // scelta fatta ai box, applicata a fine sosta come pendingCompound
                carContacts:             new Set(),   // colori con cui è ATTUALMENTE a contatto (rileva un urto NUOVO)
                wallContact:             false,   // true se attualmente appoggiato a un muro ponte
                pendingCollisionPenaltyEvents: [],   // ms in attesa di notifica al client, drenata da tickGame
            };
        }

        socket.emit('f1Setup', {
            playerColor,
            hostColor:     game.hostColor,
            trackName:     game.track.name,
            totalLaps,
            phase:         game.phase,
            grid:          game.grid,
            raceStarted:   game.raceStarted,
            elapsed:       (game.raceStarted && game.raceStartTime) ? (Date.now() - game.raceStartTime) : 0,
            players:       buildPublicState(playersVisibleTo(game, playerColor), game.raceStarted, game.track),
            compounds:     TYRE_COMPOUNDS,
            strategy:      suggestStrategy(totalLaps),
            myCompound:    game.players[playerColor].compound,
            tyreConfirmed: game.tyreConfirmed.size,
            tyreTotal:     Object.keys(game.players).length
        });

        // Tick e prima fase (scelta mescola) solo al primo giocatore
        if (!game.tick) {
            game.tick = setInterval(() => tickGame(io, lobbyId, game), PHYSICS_TICK_MS);
            startTyreSelect(io, lobbyId, game);
        }
    });

    // Scelta mescola (fase tyre_select). Se tutti hanno confermato si passa
    // subito alla qualifica, senza aspettare il timeout.
    socket.on('f1TyreChoice', ({ lobbyId, playerColor, compound }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'tyre_select') return;
        if (!TYRE_COMPOUNDS[compound]) return;
        const p = game.players[playerColor];
        if (!p) return;

        p.compound = compound;
        game.tyreConfirmed.add(playerColor);

        io.to(lobbyId).emit('f1TyreConfirmed', {
            playerColor,
            compound,
            count: game.tyreConfirmed.size,
            total: Object.keys(game.players).length
        });

        if (game.tyreConfirmed.size >= Object.keys(game.players).length) {
            if (game.tyreSelectTimeout) { clearTimeout(game.tyreSelectTimeout); game.tyreSelectTimeout = null; }
            startQualifying(io, lobbyId, game);
        }
    });

    // Pressione del minigioco di reazione al pit stop. Il server è
    // autoritativo sul tempo (vedi handlePitReactionPress): il client si
    // limita a inoltrare l'evento appena l'utente preme.
    socket.on('f1PitReactionPress', ({ lobbyId, playerColor }) => {
        const game = activeGames.get(lobbyId);
        if (!game) return;
        const p = game.players[playerColor];
        if (!p) return;
        handlePitReactionPress(io, lobbyId, game, p);
    });

    // Cambio mescola durante la sosta ai box: applicata a fine sosta
    // (completePitStop), non subito — non ha senso montare gomme diverse
    // mentre l'auto è ancora sollevata dal cric.
    socket.on('f1PitCompoundChoice', ({ lobbyId, playerColor, compound }) => {
        const game = activeGames.get(lobbyId);
        if (!game) return;
        if (!TYRE_COMPOUNDS[compound]) return;
        const p = game.players[playerColor];
        // Accettata per tutta la visita ai box: durante il tragitto d'ingresso
        // (pitAutoState==='entering'), durante la sosta (pitting) e anche
        // durante l'uscita, se ci ripensa — applicata comunque solo a fine
        // sosta (completePitStop).
        if (!p || (!p.pitting && !p.pitAutoState)) return;
        p.pendingCompound = compound;
    });

    // Scelta riparazione danni durante la sosta ai box: applicata a fine
    // sosta (completePitStop), non subito — stesso pattern di
    // f1PitCompoundChoice. Default se non si sceglie mai: NON riparare.
    socket.on('f1PitRepairChoice', ({ lobbyId, playerColor, repair }) => {
        const game = activeGames.get(lobbyId);
        if (!game) return;
        const p = game.players[playerColor];
        if (!p || (!p.pitting && !p.pitAutoState)) return;
        p.pendingRepair = !!repair;
    });

    socket.on('f1Input', ({ lobbyId, playerColor, inputs }) => {
        const game = activeGames.get(lobbyId);
        if (!game || !game.players[playerColor] || !inputs) return;
        // Un giocatore già "finished" (giro di qualifica o gara completati)
        // resta escluso dalla fisica (vedi filtro `racing` in tickGame), ma
        // il client continua comunque a inviare finché non arriva la
        // prossima sessione (isRacing lato client si azzera solo con
        // f1Countdown/f1RaceEnded, non al MIO traguardo individuale) — se
        // tiene premuto l'acceleratore durante l'attesa/l'animazione POLE,
        // quell'input restava scritto in p.inputs e veniva letto come falsa
        // partenza al via successivo (bug reale, non solo un valore stantio
        // da un singolo istante: il client lo riscriveva di continuo).
        // Ignorarlo qui, alla fonte, non richiede fidarsi del client.
        if (game.players[playerColor].finished) return;
        // Clamp qui perché arriva dal client (analogico, valori liberi):
        // la fisica sotto assume i range dichiarati.
        game.players[playerColor].inputs = {
            throttle: Math.max(0, Math.min(1, Number(inputs.throttle) || 0)),
            brake:    Math.max(0, Math.min(1, Number(inputs.brake)    || 0)),
            steer:    Math.max(-1, Math.min(1, Number(inputs.steer)   || 0)),
        };
    });

    // "Riprova" (modalità single): rilancia la GARA con la stessa griglia già
    // determinata dalla qualifica, senza rifare la qualifica stessa.
    socket.on('f1RestartRace', (lobbyId) => {
        const game = activeGames.get(lobbyId);
        if (!game) return;
        if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }
        game.raceEnded = false;
        if (game.grid && game.grid.length) {
            assignGridSpawns(game);
        } else {
            resetPlayers(game);   // difensivo, non dovrebbe capitare (la qualifica gira sempre prima)
        }
        // Pausa di cortesia prima del semaforo (vedi RESTART_GRACE_MS):
        // annunciata SUBITO al client con questo evento dedicato, così può
        // coprirla con una dissolvenza a nero invece di lasciare il podio a
        // schermo fino all'ultimo istante (vedi f1RestartTransition in f1.js).
        io.to(lobbyId).emit('f1RestartTransition', { graceMs: RESTART_GRACE_MS });
        setTimeout(() => {
            const g = activeGames.get(lobbyId);
            if (!g) return;
            startRaceCountdown(io, lobbyId, g);
        }, RESTART_GRACE_MS);
    });

    socket.on('f1ReturnToLobby', (lobbyId) => {
        const game = activeGames.get(lobbyId);
        if (game && game.gameId !== 'f1') return;   // la partita attiva è di un altro gioco
        if (game) {
            clearInterval(game.tick);
            if (game.endTimeout) clearTimeout(game.endTimeout);
            if (game.qualiEndTimeout) clearTimeout(game.qualiEndTimeout);
            if (game.tyreSelectTimeout) clearTimeout(game.tyreSelectTimeout);
            if (game.rejoinTimers) Object.values(game.rejoinTimers).forEach(clearTimeout);
            activeGames.delete(lobbyId);
        }
        io.to(lobbyId).emit('f1RedirectToLobby');
    });

    // NB: questo handler scatta per OGNI socket che muore (anche i vecchi socket
    // della pagina lobby, che il browser tiene congelati per minuti dopo la
    // navigazione e hanno socket.lobbyId/color settati da joinLobby).
    // Guard 1 (joinedF1): solo il socket che ha realmente fatto joinF1Game può
    //   toccare il giocatore. Senza, il vecchio socket-lobby — che ha lo stesso
    //   socket.color del giocatore vivo — quando moriva a metà gara toccava
    //   l'auto viva: era la causa di "auto sparite / lobby distrutta mentre si corre".
    // Guard 2 (gameId): non toccare partite di ALTRI giochi (bug storico FPS).
    //
    // GRAZIA: la rimozione non è immediata. L'auto resta ferma in pista (input
    // azzerati, decelera per attrito) e visibile a tutti per REJOIN_GRACE ms —
    // un browser che congela la scheda in background la riattiva e ri-emette
    // joinF1Game, che annulla il timer qui sotto senza perdere posizione/giro.
    // Solo se la grazia scade scatta la rimozione definitiva.
    socket.on('disconnect', () => {
        if (!socket.data.joinedF1) return;
        const { lobbyId, color } = socket;
        if (!lobbyId || !color) return;
        const game = activeGames.get(lobbyId);
        if (!game || game.gameId !== 'f1') return;
        const p = game.players[color];
        if (!p) return;   // già rimosso definitivamente

        p.disconnected = true;
        p.inputs = { throttle: 0, brake: 0, steer: 0 };

        if (!game.rejoinTimers) game.rejoinTimers = {};
        clearTimeout(game.rejoinTimers[color]);
        console.log(`🔌 [F1] ${color} disconnesso (lobby ${lobbyId}) — grazia ${REJOIN_GRACE / 1000}s`);
        game.rejoinTimers[color] = setTimeout(() => {
            delete game.rejoinTimers[color];
            console.log(`🗑 [F1] grazia scaduta per ${color} → rimozione definitiva`);
            hardRemoveF1Player(io, lobbyId, color);
        }, REJOIN_GRACE);
    });
};

// ====================================================
// RIMOZIONE DEFINITIVA (grazia scaduta)
// ====================================================
function hardRemoveF1Player(io, lobbyId, color) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    const removedPlayer = game.players[color];
    if (removedPlayer && removedPlayer.pitGoTimer) clearTimeout(removedPlayer.pitGoTimer);

    delete game.players[color];
    delete game.socketByColor[color];
    io.to(lobbyId).emit('f1PlayerLeft', color);

    const lobby = lobbies.get(lobbyId);
    if (lobby) {
        lobby.players = lobby.players.filter(c => c !== color);
        if (lobby.host === color && lobby.players.length > 0) {
            lobby.host     = lobby.players[0];
            game.hostColor = lobby.host;
            io.to(lobbyId).emit('message', {
                message: `👑 ${lobby.host} è il nuovo Host della stanza!`,
                type:    'system'
            });
            io.to(lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
        }
    }

    if (Object.keys(game.players).length === 0) {
        clearInterval(game.tick);
        if (game.endTimeout) clearTimeout(game.endTimeout);
        if (game.qualiEndTimeout) clearTimeout(game.qualiEndTimeout);
        if (game.tyreSelectTimeout) clearTimeout(game.tyreSelectTimeout);
        if (game.rejoinTimers) Object.values(game.rejoinTimers).forEach(clearTimeout);
        activeGames.delete(lobbyId);
    }
}

// ====================================================
// FASE: SCELTA MESCOLA — ogni giocatore sceglie Hard/Medium/Soft prima della
// qualifica. Chi non sceglie entro TYRE_SELECT_MS riceve la mescola di
// default. Se tutti confermano prima, si passa subito (vedi f1TyreChoice).
// ====================================================
function startTyreSelect(io, lobbyId, game) {
    game.phase = 'tyre_select';
    game.tyreConfirmed.clear();
    // I bot si auto-confermano già alla creazione (vedi createBots, chiamata
    // prima di questa funzione nello stesso joinF1Game): il clear() sopra
    // svuota anche la loro conferma, quindi va ripristinata qui — altrimenti
    // un giocatore umano da solo con 5 bot restava bloccato a "1/6 pronti"
    // dopo la propria scelta, perché i bot non confermano una seconda volta.
    for (const color of Object.keys(game.players)) {
        if (game.players[color].isBot) game.tyreConfirmed.add(color);
    }

    game.tyreSelectTimeout = setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g || g.phase !== 'tyre_select') return;
        for (const p of Object.values(g.players)) {
            if (!p.compound) p.compound = DEFAULT_COMPOUND;
        }
        g.tyreSelectTimeout = null;
        startQualifying(io, lobbyId, g);
    }, TYRE_SELECT_MS);
}

// ====================================================
// FASI: QUALIFICA (tutti in pista IN PARALLELO, ma isolati: vedi
// playersVisibleTo — ognuno vede solo la propria auto, nessuno quelle
// altrui) → GRIGLIA → GARA
// ====================================================
function startQualifying(io, lobbyId, game) {
    game.phase       = 'qualifying';
    game.qualiEnded  = false;
    game.raceStarted = false;
    // Tutti allo stesso identico punto (vedi game.track.qualiSpawn), a
    // prescindere da dove fossero prima (già impostato alla creazione, ma qui
    // è garantito anche per chi era entrato con uno stato diverso).
    for (const p of Object.values(game.players)) {
        p.x = game.track.qualiSpawn.x; p.z = game.track.qualiSpawn.z; p.angle = game.track.qualiSpawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
    }
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'QUALIFICA — 1 GIRO', phase: 'qualifying' });
    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        g.raceStarted   = true;
        g.raceStartTime = Date.now();
        console.log(`🏎️ [F1] Qualifica avviata (lobby ${lobbyId})`);
        io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0, phase: 'qualifying' });
    }, 3000);
}

function endQualifying(io, lobbyId, game) {
    if (game.qualiEnded) return;
    game.qualiEnded = true;
    if (game.qualiEndTimeout) { clearTimeout(game.qualiEndTimeout); game.qualiEndTimeout = null; }

    // La qualifica chiude non appena tutti gli UMANI connessi hanno finito
    // (vedi il gate in tickGame, i bot non la bloccano più): un bot ancora
    // in pista in quel momento riceve un tempo simulato realistico,
    // estrapolato dal proprio ritmo osservato fin lì, invece di comparire
    // come "nessun tempo" — non è un'anomalia, è normale che un bot non
    // abbia ancora finito quando la sessione chiude sul giocatore umano.
    const n = game.track.points.length;
    for (const p of Object.values(game.players)) {
        if (p.time === null && p.isBot) {
            const elapsed  = Date.now() - game.raceStartTime;
            const progress = (p.lap * n + (p.trackIndex || 0)) / n;   // totalLaps quali = 1
            p.time = estimateFinishTime(elapsed, progress);
        }
    }

    // Chi non ha completato il giro (null, solo umani disconnessi: i bot
    // hanno sempre un tempo ormai, vedi sopra) va in fondo alla griglia, in
    // ordine di apparizione (nessun'altra informazione disponibile per
    // ordinarli).
    const ranked = Object.values(game.players).slice().sort((a, b) => {
        if (a.time === null && b.time === null) return 0;
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time - b.time;
    });
    game.grid = ranked.map(p => p.color);
    // Catturati QUI, prima di assignGridSpawns qui sotto: quella funzione
    // azzera p.time in preparazione della gara (stessi oggetti giocatore
    // referenziati da `ranked`), quindi leggerlo dopo restituirebbe sempre
    // null nel pannello griglia.
    const qualiTimes = ranked.map(p => ({ color: p.color, time: p.time }));

    game.phase       = 'grid_display';
    game.raceStarted = false;
    // Assegnati SUBITO, non alla fine della finestra di visualizzazione: senza
    // questo, per tutta la durata di GRID_DISPLAY_MS i giocatori restavano
    // fermi dove li aveva lasciati il proprio giro di qualifica (magari fuori
    // pista) — e playersVisibleTo() smette di filtrare non appena finisce
    // 'qualifying', quindi ricomparivano lì finché non scattava questo reset,
    // qualche secondo dopo. Ora quando tornano visibili sono già pronti.
    assignGridSpawns(game);

    console.log(`🏁 [F1] Qualifica conclusa (lobby ${lobbyId}) — griglia: ${game.grid.join(', ')}`);
    io.to(lobbyId).emit('f1QualiEnded', { grid: qualiTimes });

    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        startRaceCountdown(io, lobbyId, g);
    }, GRID_DISPLAY_MS);
}

function startRaceCountdown(io, lobbyId, game) {
    game.phase                = 'race';
    game.raceEnded            = false;
    game.raceStarted          = false;
    game.raceStartTime        = null;
    game.lightsSequenceActive = true;   // finestra di rilevamento falsa partenza, vedi tickGame

    // Azzera l'input di TUTTI prima di aprire la finestra di rilevamento:
    // senza questo, un giocatore che finisce la sessione precedente tenendo
    // premuto l'acceleratore (il client smette di inviare non appena la
    // sessione finisce, ma il server non lo sapeva mai azzerare da solo)
    // risultava marcato falsa partenza al via successivo senza aver toccato
    // nulla — bug reale trovato dalla review finale.
    for (const p of Object.values(game.players)) p.inputs = { throttle: 0, brake: 0, steer: 0 };

    // holdMs resta SOLO lato server, per il proprio setTimeout: il client
    // non ha bisogno di conoscerlo, gli basta reagire al vero evento
    // f1RaceStarted per spegnere le luci — evita qualunque rischio di
    // disallineamento dovuto alla latenza di rete rispetto a un timer
    // locale indipendente.
    const holdMs  = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    const totalMs = LIGHTS_ALL_ON_MS + holdMs;

    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'GARA', phase: 'race' });

    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        g.lightsSequenceActive = false;
        g.raceStarted   = true;
        g.raceStartTime = Date.now();
        // Reazione al via per i bot: ognuno resta fermo per un ritardo
        // casuale (nessuna correlazione col ritmo di gara, richiesto
        // esplicitamente) prima che updateBotInputs inizi a guidarlo — senza
        // questo tutti i bot spingono sull'acceleratore nell'esatto stesso
        // tick, una griglia troppo "meccanica" (vedi BOT_RACE_START_REACTION_*
        // in f1Bot.js).
        for (const p of Object.values(g.players)) {
            if (p.isBot) {
                p.botRaceReactionUntil = g.raceStartTime +
                    BOT_RACE_START_REACTION_MIN_MS + Math.random() * (BOT_RACE_START_REACTION_MAX_MS - BOT_RACE_START_REACTION_MIN_MS);
            }
        }
        console.log(`🚦 [F1] Gara avviata (lobby ${lobbyId})`);
        io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0, phase: 'race' });
    }, totalMs);
}

// Assegna gli spawn secondo l'ordine di griglia (pole = posizione 0, la PIÙ
// AVANZATA — vedi gridSpawnPoint). Eventuali giocatori non presenti in
// game.grid (entrati dopo la fine della qualifica) vengono accodati in fondo.
function assignGridSpawns(game) {
    const order = [...game.grid, ...Object.keys(game.players).filter(c => !game.grid.includes(c))];
    order.forEach((color, i) => {
        const p = game.players[color];
        if (!p) return;
        const spawn = game.track.gridSpawnPoint(i);
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
        p.tyreWear = 0;   // gomme fresche per la gara vera (l'usura conta solo in gara, non in qualifica)
        p.damage = 0;   // auto perfetta a inizio gara vera — stesso confine di tyreWear
        p.collisionPenaltyMs = 0;
        p.pendingRepair = false;
        p.carContacts.clear();
        p.wallContact = false;
        p.pendingCollisionPenaltyEvents.length = 0;
        if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }
        p.pitting = false; p.pitPhase = null; p.pitGoTime = null;
        p.pendingCompound = null; p.hasPitted = false; p.pitPenalty = false;
        p.falseStart = false; p.falseStartServed = false;
        p.gapToLeaderMs = null;
        p.pitAutoState = null; p.pitPathIndex = 0;
        p.inputs = { throttle: 0, brake: 0, steer: 0 };
        // Stato bot transitorio: un bot ancora diretto ai box (non ancora
        // entrato nel trigger) alla fine della gara precedente non deve
        // ripartire già puntato alla corsia box con gomme appena montate.
        if (p.isBot) { p.botHeadingToPits = false; p.botPitReactionScheduled = false; }
    });
}

// ====================================================
// PIT STOP — autopilota ingresso/uscita + minigioco di reazione
// Il giocatore STERZA volontariamente nella corsia (sotto il suo controllo);
// appena entra, il server prende il volante: lo guida fino alla casella,
// gestisce la sosta, poi lo riporta sulla pista principale. Niente più
// bisogno di fermarsi con precisione da soli.
// ====================================================

// Trigger d'ingresso: il giocatore è entrato di sua iniziativa nella corsia
// mentre correva normalmente. Da qui in poi non legge più i suoi input (vedi
// il filtro "racing" in tickGame) finché l'intera visita ai box non finisce.
// Riparte dal waypoint 1 (il waypoint 0 è il punto di distacco, dove più o
// meno già si trova).
function startPitLaneEntry(io, lobbyId, game, p) {
    p.pitAutoState = 'entering';
    p.pitPathIndex = 1;
    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitLaneEntered');
}

// Sposta l'auto verso il prossimo waypoint del percorso box (track.pitPath) a velocità fissa e
// bassa — apposta lenta, per dare tempo di scegliere la mescola durante il
// tragitto (soprattutto in ingresso).
function updatePitAutopilot(io, lobbyId, game, p) {
    const track  = game.track;
    const target = track.pitPath[p.pitPathIndex];
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < PIT_AUTO_ARRIVE_DIST) {
        p.x = target.x; p.z = target.z;
        p.speed = 0; p.vx = 0; p.vz = 0;

        if (p.pitPathIndex === track.pitBoxIndex && p.pitAutoState === 'entering') {
            p.pitAutoState = null;   // arrivato: la sosta prende il posto dell'autopilota
            startPitStop(io, lobbyId, game, p);
            return;
        }

        p.pitPathIndex++;
        if (p.pitPathIndex >= track.pitPath.length) {
            p.pitAutoState = null;   // fine autopilota: comandi restituiti al giocatore
            const sid = game.socketByColor[p.color];
            if (sid) io.to(sid).emit('f1PitLaneExited');
        }
        return;
    }

    p.angle = Math.atan2(dx, dz);   // stessa convenzione usata dalla fisica normale (sin=x, cos=z)
    p.x += (dx / dist) * PIT_AUTO_SPEED;
    p.z += (dz / dist) * PIT_AUTO_SPEED;
    p.speed = PIT_AUTO_SPEED;   // solo per HUD velocità/rotazione ruote lato client
    p.vx = 0; p.vz = 0;
}

// Il giocatore è arrivato alla casella (via autopilota): attesa casuale, poi
// il segnale "vai" SOLO al suo socket (nessuno spoiler per gli altri).
function startPitStop(io, lobbyId, game, p) {
    p.pitting  = true;
    p.speed = 0; p.vx = 0; p.vz = 0;
    p.pitPhase = 'waiting';

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopStarted');

    const delay = PIT_GO_DELAY_MIN + Math.random() * (PIT_GO_DELAY_MAX - PIT_GO_DELAY_MIN);
    p.pitGoTimer = setTimeout(() => {
        if (!p.pitting) return;   // nel frattempo la sosta è già finita/annullata
        p.pitPhase  = 'go';
        p.pitGoTime = Date.now();
        const s = game.socketByColor[p.color];
        if (s) io.to(s).emit('f1PitReactionGo');
    }, delay);
}

// Pressione ricevuta dal client: il server è autoritativo sul tempo di
// reazione (dal proprio invio del segnale alla ricezione di questa press).
// Una pressione PRIMA del segnale ('waiting') viene IGNORATA — niente
// penalità, niente blocco: il giocatore può tranquillamente premere in
// anticipo per curiosità/impazienza senza bruciarsi l'unico tentativo buono
// (bug segnalato: qualunque pressione anticipata registrava sempre la
// sosta massima, perché consumava il tentativo prima ancora che partisse
// il vero segnale). Ignora anche pressioni doppie/tardive (pitPhase già 'done').
function handlePitReactionPress(io, lobbyId, game, p) {
    if (!p.pitting || p.pitPhase !== 'go') return;
    p.pitPhase = 'done';
    if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }

    const reactionMs = Date.now() - p.pitGoTime;
    const clamped = Math.min(Math.max(reactionMs, PIT_REACTION_BEST), PIT_REACTION_WORST);
    const t = (clamped - PIT_REACTION_BEST) / (PIT_REACTION_WORST - PIT_REACTION_BEST);
    let durationMs = PIT_DURATION_MIN + t * (PIT_DURATION_MAX - PIT_DURATION_MIN);

    // Penalità falsa partenza scontata QUI, alla PRIMA sosta: stesso
    // minigioco di reazione, sosta più lunga di 5s — nessun secondo
    // meccanismo da imparare per il giocatore.
    if (p.falseStart && !p.falseStartServed) {
        durationMs += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }

    // Riparazione danni: tempo extra proporzionale al danno che c'era al
    // momento della scelta (non al danno originale ad inizio sosta, ma è lo
    // stesso valore: durante la sosta il danno non cambia, l'auto è ferma).
    if (p.pendingRepair && p.damage > 0) {
        durationMs += p.damage * REPAIR_MS_PER_DAMAGE_PCT;
    }

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopTiming', { durationMs });

    setTimeout(() => completePitStop(io, lobbyId, game, p), durationMs);
}

// Fine sosta: gomme cambiate, poi l'autopilota riprende per l'uscita (non
// restituisce subito i comandi — il giocatore deve ancora essere riportato
// fuori dalla corsia).
function completePitStop(io, lobbyId, game, p) {
    if (!p.pitting) return;   // difensivo (es. gara finita nel frattempo)
    p.pitting   = false;
    p.pitPhase  = null;
    p.pitGoTime = null;
    p.tyreWear  = 0;
    p.hasPitted = true;
    if (p.pendingCompound) { p.compound = p.pendingCompound; p.pendingCompound = null; }
    if (p.pendingRepair) { p.damage = 0; }
    p.pendingRepair = false;

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopFinished', { compound: p.compound });

    p.pitAutoState = 'exiting';
    p.pitPathIndex = game.track.pitBoxIndex + 1;   // continua dal waypoint successivo alla casella
}

// Stato visibile ad UN determinato giocatore (viewerColor):
// - qualifying: TUTTI corrono in parallelo, ma ognuno vede SOLO la propria
//   auto — "da solo in pista" è isolamento visivo, non un turno a testa.
//   Per questo lo stato non può essere un'unica trasmissione condivisa (vedi
//   broadcastState): ogni giocatore riceve un payload diverso, con dentro
//   solo se stesso.
// - tyre_select / grid_display: NESSUNO — il focus è sulla UI (selezione
//   mescola, modal griglia), non sulla scena di gioco. IMPORTANTE: senza
//   questo, in tyre_select la trasmissione di gruppo (vedi broadcastState,
//   che per questa fase non personalizza) manda a TUTTI la posizione di
//   TUTTI — i client creano comunque i modelli delle altre auto
//   (otherCars), e quando poi si passa a 'qualifying' — che filtra
//   correttamente — quei modelli non vengono mai rimossi: restano fermi in
//   scena, "fantasma" (bug segnalato dall'utente).
// - race/altre fasi: tutti, in un'unica trasmissione condivisa.
function playersVisibleTo(game, viewerColor) {
    if (game.phase === 'qualifying') {
        return game.players[viewerColor] ? { [viewerColor]: game.players[viewerColor] } : {};
    }
    if (game.phase === 'tyre_select' || game.phase === 'grid_display') return {};
    return game.players;
}

// Trasmette f1StateUpdate. In qualifica NON è un'unica emit di gruppo: ogni
// giocatore riceve un payload personalizzato (solo se stesso) via il proprio
// socket.id (game.socketByColor). Nelle altre fasi resta una singola emit
// condivisa alla room, come prima.
function broadcastState(io, lobbyId, game, raceStartedFlag) {
    if (game.phase === 'qualifying') {
        for (const color of Object.keys(game.players)) {
            const sid = game.socketByColor[color];
            if (!sid) continue;
            io.to(sid).emit('f1StateUpdate', buildPublicState(playersVisibleTo(game, color), raceStartedFlag, game.track));
        }
        return;
    }
    io.to(lobbyId).emit('f1StateUpdate', buildPublicState(playersVisibleTo(game, null), raceStartedFlag, game.track));
}

// ====================================================
// TICK FISICO
// ====================================================
function tickGame(io, lobbyId, game) {
    if (!game.raceStarted) {
        // Falsa partenza: il client inizia a inviare l'input dell'acceleratore
        // già durante la sequenza luci (vedi Task 3), ma la fisica qui sotto
        // resta comunque congelata finché raceStarted è false — ricevere
        // l'input in anticipo serve SOLO al rilevamento, non fa muovere nessuno.
        if (game.lightsSequenceActive) {
            for (const p of Object.values(game.players)) {
                if (!p.falseStart && p.inputs.throttle > 0.05) p.falseStart = true;
            }
        }
        broadcastState(io, lobbyId, game, false);
        return;
    }

    updateBotInputs(game, {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId,
        wearLapsAtMedium: WEAR_LAPS_AT_MEDIUM,
        accel: ACCEL, brakeMult: BRAKE_MULT, turnRateHigh: TURN_SPEED_HIGH,
        slipstreamMaxBoost: SLIPSTREAM_MAX_BOOST
    });

    const isQuali  = game.phase === 'qualifying';
    // In qualifica si fa UN giro secco; in gara i giri sono quelli della pista caricata.
    const totalLaps = isQuali ? 1 : game.track.totalLaps;
    const players    = Object.values(game.players);
    // In qualifica corrono TUTTI in parallelo (isolati solo visivamente, non
    // fisicamente: nessuna collisione tra loro — vedi sotto). Chi è fermo ai
    // box (pitting) o guidato dall'autopilota (pitAutoState) resta escluso
    // dalla fisica normale come un giocatore finished, ma — come i finished —
    // resta un ostacolo per resolveCollisions.
    const racing      = players.filter(p => !p.finished && !p.pitting && !p.pitAutoState);
    const autoPiloted = players.filter(p => p.pitAutoState);

    // Velocità (accelerazione/freno/sterzo/grip): una volta per tick, come prima.
    // Scia solo in gara (mai in quali, dove ogni pilota è isolato).
    // Azzerato per TUTTI (non solo chi corre) prima del ricalcolo: senza
    // questo un'auto che entra ai box/finisce manterrebbe congelato
    // l'ultimo valore letto in gara, mostrando l'effetto visivo cliente
    // anche da ferma ai box.
    for (const p of players) p.inSlipstream = false;
    for (const p of racing) {
        let slipstreamMult = 1;
        if (!isQuali) {
            const ahead = nearestAheadPlayer(p, players, game.track);
            if (ahead && ahead.gapM < SLIPSTREAM_RANGE_M) {
                const closeness = 1 - ahead.gapM / SLIPSTREAM_RANGE_M;
                slipstreamMult = 1 + closeness * SLIPSTREAM_MAX_BOOST;
                p.inSlipstream = true;   // solo per il badge/effetto visivo lato client, vedi buildPublicState
            }
        }
        updateVelocity(p, isQuali, slipstreamMult);
    }

    // Posizione: in SOTTOSTEP, con risoluzione collisioni ad ogni sottostep
    // (vedi commento su COLLISION_SUBSTEPS). Le auto ferme (finite o in grazia)
    // restano ostacoli fisici, quindi resolveCollisions lavora su TUTTI i
    // giocatori non-in-qualifica, non solo su chi corre.
    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) integratePosition(p, 1 / COLLISION_SUBSTEPS);
        if (!isQuali) resolveCollisions(players);
        // A differenza di resolveCollisions (disabilitata in qualifica: le
        // collisioni auto-auto sono una questione di fair-play multiplayer),
        // il muro dei tratti ponte si applica sempre, anche in qualifica —
        // è un limite fisico della pista, non un'interazione tra giocatori.
        for (const p of racing) applyBridgeBarrier(p, game.track, !isQuali);
    }

    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p, game.track);
        updateTrackIndex(p, game.track);
        // L'usura conta solo in GARA: in qualifica le gomme restano quelle
        // scelte ma "fresche" fino al via vero (resettate in assignGridSpawns).
        if (game.phase === 'race') applyTyreWear(p, offTrack, game.track);
        checkLap(p, totalLaps, io, lobbyId, game);

        // Ingresso volontario nella corsia box (solo in gara: sterzare lì è
        // una scelta del giocatore). Da qui il server prende il volante — vedi
        // startPitLaneEntry/updatePitAutopilot — fino a fine visita ai box.
        if (game.phase === 'race' && inPitEntryZone(p, game.track)) {
            startPitLaneEntry(io, lobbyId, game, p);
        }
    }

    // Autopilota ingresso/uscita corsia box: movimento dedicato, non passa
    // per updateVelocity/integratePosition (niente input del giocatore).
    for (const p of autoPiloted) {
        updatePitAutopilot(io, lobbyId, game, p);
        updateTrackIndex(p, game.track);
    }

    // Distacco dal leader: stima da distanza/velocità, ricalcolata ogni
    // GAP_RECALC_MS e riusata fino al prossimo giro — non serve precisione
    // al millisecondo, un vero timing per-checkpoint sarebbe uno sforzo
    // sproporzionato per quello che serve qui (esplicitamente accettato).
    // Ricalcolata ANCHE subito, fuori dal timer, quando l'ordine in classifica
    // cambia (sorpasso): altrimenti la position si aggiorna a ogni tick ma i
    // gap restano congelati ai valori pre-sorpasso fino a 3.5s, mostrando
    // temporaneamente un ordine con gap non monotoni (es. P3 +2.5s, P4 +1.9s).
    if (game.phase === 'race') {
        const ranked = [...players].sort((a, b) => progressScore(b, game.track) - progressScore(a, game.track));
        const newRankOrder = ranked.map(p => p.color);
        const orderChanged = !game.lastRankOrder ||
            newRankOrder.length !== game.lastRankOrder.length ||
            newRankOrder.some((c, i) => game.lastRankOrder[i] !== c);
        const timerElapsed = Date.now() - (game.lastGapRecalc || 0) >= GAP_RECALC_MS;

        if (orderChanged || timerElapsed) {
            game.lastGapRecalc = Date.now();
            game.lastRankOrder = newRankOrder;
            const leader = ranked[0];
            const metersPerUnit = game.track.lapLength / game.track.points.length;
            for (const p of ranked) {
                if (p === leader) { p.gapToLeaderMs = null; continue; }
                const distanceBehindUnits = progressScore(leader, game.track) - progressScore(p, game.track);
                const distanceBehindM = Math.max(0, distanceBehindUnits) * metersPerUnit;
                // Ritmo di riferimento = velocità del LEADER, non dell'inseguitore:
                // usare p.speed produceva distacchi di minuti ogni volta che
                // l'inseguitore era momentaneamente fermo/lento nell'istante esatto
                // del ricalcolo (contro una barriera, in un testacoda, in pit box,
                // in griglia dopo falsa partenza) — la stima proiettava quella
                // velocità istantanea quasi nulla all'infinito. Il leader è quasi
                // sempre in movimento normale, quindi è un riferimento molto più
                // stabile per "quanto ci metterebbe a coprire questa distanza".
                // speed è in unità/tick fisico; conversione a m/s: la stessa
                // usata dal client per mostrare i km/h (speed*55), portata a m/s (/3.6).
                const speedMs = Math.max(0.5, Math.abs(leader.speed) * 55 / 3.6);   // pavimento anti-divisione-per-zero
                p.gapToLeaderMs = Math.round((distanceBehindM / speedMs) * 1000);
            }
        }
    }

    // Trasmesso PRIMA del controllo di fine sessione qui sotto: altrimenti
    // l'ultimo giocatore che finisce (tipicamente chi non fa la pole, essendo
    // il più lento) innesca endQualifying/endRace nello stesso tick in cui il
    // suo `finished` diventa true, e quel `return` faceva saltare proprio la
    // trasmissione con il suo stato finale — il client non riceveva mai
    // finished/time e il cronometro continuava a scorrere sullo sfondo.
    broadcastState(io, lobbyId, game, true);

    // Notifica live di ogni penalità da collisione appena accumulata (Task
    // 2/3): DOPO broadcastState, non prima — il client deve già avere il
    // badge "!" nel DOM (aggiunto da renderStandingRowContent in risposta a
    // collisionPenalty:true nello stato appena ricevuto) prima di ricevere
    // il trigger di animazione, altrimenti sul primissimo incidente della
    // gara l'elemento .collision-badge non esisterebbe ancora e l'animazione
    // verrebbe silenziosamente ignorata. Una alla volta, nell'ordine in cui
    // sono avvenute nel tick — la coda resta quasi sempre vuota (0-1
    // elementi), niente di costoso qui.
    for (const p of players) {
        if (!p.pendingCollisionPenaltyEvents.length) continue;
        for (const penaltyMs of p.pendingCollisionPenaltyEvents) {
            io.to(lobbyId).emit('f1CollisionPenalty', {
                color: p.color, penaltyMs, totalMs: p.collisionPenaltyMs
            });
        }
        p.pendingCollisionPenaltyEvents.length = 0;
    }

    // Fine sessione (qualifica o gara): tutti i giocatori UMANI CONNESSI
    // hanno finito (chi è in grazia con l'auto ferma non blocca la
    // chiusura; c'è comunque un timer di sicurezza per chi resta indietro
    // senza essersi disconnesso). I bot NON bloccano la chiusura: un bot
    // lento o fuori pista non deve tenere in attesa un giocatore umano che
    // ha già finito — i bot restano comunque in gara, semplicemente non
    // contano per questo gate.
    const connectedHumans = players.filter(p => !p.disconnected && !p.isBot);
    if (isQuali) {
        if (!game.qualiEnded && connectedHumans.length > 0 && connectedHumans.every(p => p.finished)) {
            endQualifying(io, lobbyId, game);
            return;
        }
    } else if (game.phase === 'race') {
        if (!game.raceEnded && connectedHumans.length > 0 && connectedHumans.every(p => p.finished)) {
            endRace(io, lobbyId, game);
            return;
        }
    }
}

// ====================================================
// PROGRESSO LUNGO IL TRACCIATO (per le posizioni in gara)
// game.track.points è già ordinato nel verso di marcia. Ricerca LOCALE
// nell'intorno dell'indice precedente (con wrap) invece che globale: evita
// l'ambiguità nel punto di saldatura fine/inizio giro, dove l'ultimo punto e
// il primo sono quasi coincidenti nello spazio.
// ====================================================
const TRACK_INDEX_WINDOW = 20;
// Il numero di campioni è sempre SAMPLES=1000 (vedi trackLoader.js),
// indipendentemente dalla pista: questo indice resta una costante globale.
const N_SAMPLES     = 1000;
const HALF_LAP_IDX  = Math.floor(N_SAMPLES / 2);
// Tolleranze del checkpoint anti-taglio e del traguardo espresse in METRI
// fisici, convertite in campioni in base alla lunghezza REALE della pista
// caricata (vedi checkpointWindowFor()/finishWindowFor()) — invariata su
// piste più lunghe, a differenza delle vecchie percentuali fisse del giro.
//
// CHECKPOINT_WINDOW_M resta largo apposta (era il 12% di Monte Rosso, ~112m):
// serve solo a non penalizzare chi taglia leggermente a metà giro, non è mai
// visibile al giocatore.
//
// FINISH_WINDOW_M era il 3% di Monte Rosso (~28m, ~6 lunghezze di monoposto):
// troppo presto — "POLE"/fine giro comparivano ben prima di attraversare
// davvero la linea a scacchi. Ridotto al minimo che serve solo a non perdere
// il rilevamento tra un tick e l'altro del server (l'auto percorre al
// massimo ~4 unità/tick a velocità massima).
const CHECKPOINT_WINDOW_M = 112;
const FINISH_WINDOW_M     = 6;

function updateTrackIndex(p, track) {
    p.trackIndex = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
}

function checkpointWindowFor(track) {
    return Math.max(1, Math.round(CHECKPOINT_WINDOW_M * track.points.length / track.lapLength));
}

function finishWindowFor(track) {
    return Math.max(1, Math.round(FINISH_WINDOW_M * track.points.length / track.lapLength));
}

// Punteggio di avanzamento: lap*N+indice cresce in modo continuo attraverso il
// giro (l'indice si azzera esattamente quando lap incrementa, stesso tick,
// perché entrambi derivano dalla stessa p.x/p.z). Un giocatore finished ha
// sempre punteggio più alto di uno ancora in gara (lap==totalLaps domina).
function progressScore(p, track) {
    return p.lap * track.points.length + (p.trackIndex || 0);
}

// Distanza circolare minima tra due indici su un loop di `n` campioni.
function circularWithin(idx, target, n, halfWidth) {
    let d = Math.abs(idx - target);
    if (d > n / 2) d = n - d;
    return d <= halfWidth;
}

// ====================================================
// LAP CHECK — basato sull'indice campionato (generico per qualunque pista):
// la linea di partenza è sempre l'indice 0 dei punti campionati; il
// checkpoint anti-taglio è l'indice a metà giro (HALF_LAP_IDX). Un giro conta
// solo se il giocatore ha toccato il checkpoint dall'ultimo passaggio sul
// traguardo (evita falsi giri per jitter vicino al traguardo), derivato dai
// dati invece che da coordinate scritte a mano per una singola pista.
// ====================================================
function checkLap(p, totalLaps, io, lobbyId, game) {
    const n   = game.track.points.length;
    const idx = p.trackIndex || 0;

    if (!p.checkpointA && circularWithin(idx, HALF_LAP_IDX, n, checkpointWindowFor(game.track))) {
        p.checkpointA = true;
    }

    const inFinishZone = circularWithin(idx, 0, n, finishWindowFor(game.track));
    if (p.checkpointA && inFinishZone && !p.inFinishZone) {
        // Il giocatore ha appena ENTRATO nella zona traguardo → giro completato
        p.lap++;
        p.checkpointA  = false;
        console.log(`🏁 [F1] ${p.color} giro ${p.lap}/${totalLaps} (lobby ${lobbyId})`);

        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time     = Date.now() - game.raceStartTime;
            // Obbligo di almeno un pit stop in gara (regola vera F1): chi non
            // ha mai cambiato gomme prende una penalità in tempo a fine gara,
            // non viene bloccato né squalificato.
            if (game.phase === 'race' && !p.hasPitted) {
                p.time += PIT_PENALTY_MS;
                p.pitPenalty = true;
            }
            // Rete di sicurezza: se la falsa partenza non è mai stata scontata
            // ai box (il giocatore non si è mai fermato), si somma comunque
            // qui al tempo finale — mai persa in silenzio.
            if (game.phase === 'race' && p.falseStart && !p.falseStartServed) {
                p.time += FALSE_START_PENALTY_MS;
                p.falseStartServed = true;
            }
            // Penalità collisioni: accumulo di TUTTI gli incidenti causati in
            // gara (non un flag singolo), già notificati live uno per uno
            // (vedi drenaggio in tickGame) — qui solo la somma finale.
            if (game.phase === 'race' && p.collisionPenaltyMs > 0) {
                p.time += p.collisionPenaltyMs;
            }
            // Timer di sicurezza di gruppo: dà agli altri il tempo di finire la
            // sessione (giro di qualifica o gara, entrambe corse in parallelo)
            // anche se qualcuno resta molto indietro senza essersi disconnesso
            // (la grazia copre solo i disconnessi). Uno per fase.
            if (game.phase === 'qualifying' && !game.qualiEndTimeout) {
                game.qualiEndTimeout = setTimeout(() => {
                    if (!game.qualiEnded) endQualifying(io, lobbyId, game);
                }, 60000);
            } else if (game.phase === 'race' && !game.endTimeout) {
                game.endTimeout = setTimeout(() => {
                    if (!game.raceEnded) endRace(io, lobbyId, game);
                }, 60000);
            }
        }

        io.to(lobbyId).emit('f1LapUpdate', { color: p.color, lap: p.lap, totalLaps, phase: game.phase });
    }
    p.inFinishZone = inFinishZone;
}

function endRace(io, lobbyId, game) {
    game.raceEnded = true;
    if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }
    // La gara chiude non appena tutti gli UMANI connessi hanno finito (vedi
    // il gate in tickGame): un bot ancora in pista in quel momento NON va
    // omesso dal podio (a differenza di prima) — mantiene la sua posizione
    // attuale, calcolata dallo stesso progressScore usato per la classifica
    // live. Chi ha finito viene sempre prima (progressScore più alto per
    // costruzione: totalLaps*n domina), poi chi è ancora in pista in
    // ordine di posizione corrente. totalTime resta null per questi ultimi
    // — il client mostra la posizione, non un tempo inventato.
    const finished   = Object.values(game.players).filter(p => p.time !== null);
    const unfinished = Object.values(game.players).filter(p => p.time === null);
    const podium = [
        ...finished.sort((a, b) => a.time - b.time),
        ...unfinished.sort((a, b) => progressScore(b, game.track) - progressScore(a, game.track))
    ].map(p => ({ color: p.color, totalTime: p.time, pitPenalty: !!p.pitPenalty, falseStart: !!p.falseStart, collisionPenaltyMs: p.collisionPenaltyMs || 0 }));
    io.to(lobbyId).emit('f1RaceEnded', {
        podium,
        isFinal:      true,
        isSingleMode: (game.settings || {}).mode === 'single',
        trackName:    game.track.name
    });
}

// ====================================================
// FISICA
// Velocità (accelerazione/freno/sterzo/grip) e integrazione della posizione
// sono separate apposta: la velocità si calcola una volta per tick, la
// posizione viene integrata in sottostep da tickGame (vedi COLLISION_SUBSTEPS)
// per dare alla risoluzione collisioni più occasioni di vedere un contatto.
// ====================================================
function updateVelocity(p, isQuali, slipstreamMult) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali) * (slipstreamMult || 1);   // dipende da mescola + usura (Soft fissa in qualifica) + scia
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.throttle > 0) p.speed = Math.min(p.speed + ACCEL * inputs.throttle, maxSpeed);
    else if (inputs.brake > 0) {
        // Frenata/retromarcia. La decelerazione in frenata è un decremento
        // costante per tick, quindi lo spazio d'arresto va con v²/decel: per
        // tenerlo vicino a quello di prima dell'aumento di velocità (R=1.55),
        // BRAKE_MULT scala di R² rispetto al vecchio 1.4 (non solo ×R) — vedi
        // docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md.
        p.speed = Math.max(p.speed - ACCEL * BRAKE_MULT * inputs.brake, -maxSpeed / 2);
        p.vx *= 0.94;
        p.vz *= 0.94;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }
    // Il tetto di velocità può essersi abbassato (usura aumentata da fermo non
    // succede, ma cambiando mescola in futuro pit stop sì): non lasciare mai
    // p.speed sopra il nuovo massimo.
    if (p.speed > maxSpeed) p.speed = maxSpeed;

    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
        const turnRate  = TURN_SPEED_LOW + (TURN_SPEED_HIGH - TURN_SPEED_LOW) * speedFrac;
        const steer = inputs.steer + applyDamageSteerNoise(p, isQuali);
        p.angle += turnRate * dir * steer;
    }

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * grip + fx * (1 - grip);
    p.vz = p.vz * grip + fz * (1 - grip);
}

function integratePosition(p, dt) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
}

// Ghiaia: rallentamento fuori pista. Ritorna se il giocatore è fuori pista in
// questo tick, riusato da applyTyreWear per il piccolo extra di usura.
// (Chi è nella corsia box vera e propria è guidato dall'autopilota, escluso
// da questa funzione — vedi il filtro "racing" in tickGame — quindi non
// serve più un'esenzione qui: la zona di trigger d'ingresso è comunque
// abbastanza vicina al bordo pista normale da non scattare mai.)
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - track.roadHalf - 2) / 8);  // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

// Muro rigido sui tratti ponte (Fase 3): a differenza di applyOffTrackDrag
// (che si applica ovunque e frena soltanto), qui — solo dove il punto pista
// più vicino è bridge:true — si impedisce fisicamente di superare la
// soglia. La sicurezza (non superare mai il muro) viene prima di tutto: la
// posizione è sempre riportata sul bordo.
//
// Redesign 2026-07-23 (vedi
// docs/superpowers/specs/2026-07-23-f1-barriera-ponte-redesign-design.md):
// tutti i tentativi precedenti provavano a CALCOLARE un verso "giusto" lungo
// il muro (dalla velocità d'impatto, poi da p.speed, poi da orientamento×
// p.speed) — ma qualunque calcolo è di fatto un "aiuto" che decide per il
// giocatore, e quando quel calcolo assume il verso canonico della pista
// (invece del verso reale di marcia) redirige in modo indesiderato chi va
// contromano o in retromarcia (bug segnalato dall'utente). Il fix corretto
// è più semplice: NON scegliere mai un verso. Si rimuove solo la componente
// di velocità che spinge oltre il muro (lungo la normale, verso l'esterno);
// qualunque componente parallela al muro l'auto avesse già — in qualunque
// verso, anche debole o ambigua — resta esattamente quella, senza alcuna
// correzione di direzione o di orientamento.
function applyBridgeBarrier(p, track, isRace) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];
    if (!pt.bridge) return;

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);
    const limit = track.roadHalf + BRIDGE_BARRIER_MARGIN;

    if (dist <= limit) {
        p.wallContact = false;
        return;
    }

    const { nx, nz } = TrackGeometry.normalAt(track.points, idx, true);
    // normalAt punta sempre verso lo stesso lato fisso: va orientata verso
    // il lato da cui l'auto è effettivamente uscita.
    const side = (dx * nx + dz * nz) >= 0 ? 1 : -1;
    const wallNx = nx * side, wallNz = nz * side;

    // Riporta l'auto ESATTAMENTE sul bordo sottraendo solo l'eccesso lungo
    // la normale dalla sua posizione ATTUALE (non ricostruendola da zero sul
    // punto pista campionato pt): con una formula "p.x = pt.x + wallNx*limit"
    // ogni contatto ripiazzerebbe l'auto sullo stesso punto campionato più un
    // offset fisso, scartando qualunque avanzamento tangenziale reale appena
    // fatto — se il contatto scatta ad ogni sotto-step (equilibrio stabile
    // lungo il muro, confermato via log: l'indice pista restava congelato
    // per centinaia di tick nonostante una velocità sana) l'auto resterebbe
    // bloccata esattamente nello stesso punto per sempre. Sottrarre solo
    // l'eccesso preserva l'esatta posizione tangenziale raggiunta, azzerando
    // solo la componente radiale in più.
    const overshoot = dist - limit;
    p.x -= wallNx * overshoot;
    p.z -= wallNz * overshoot;

    // Componente della velocità lungo la normale (con segno: positiva se
    // punta ancora verso l'esterno, cioè sta ancora spingendo l'auto oltre
    // il muro). Si rimuove/smorza SOLO questa componente — quella
    // parallela al muro (vx/vz meno la parte normale) non viene mai
    // toccata: qualunque direzione avesse già l'auto lungo il bordo (avanti,
    // contromano, retromarcia) resta quella, senza alcun calcolo che scelga
    // un verso "giusto" al posto del giocatore.
    const vn = p.vx * wallNx + p.vz * wallNz;
    if (vn > 0) {
        const remove = vn * BRIDGE_BARRIER_SLOWDOWN;
        p.vx -= wallNx * remove;
        p.vz -= wallNz * remove;
    }

    if (!p.wallContact) {
        p.wallContact = true;
        if (isRace && Math.abs(vn) >= MIN_COLLISION_SEVERITY) {
            applyBarrierDamage(p, vn);
        }
    }

    // Attrito continuo mentre l'auto resta appoggiata al muro (non solo un
    // colpo secco al momento dell'urto): un rallentamento REALE e sostenuto
    // finché il contatto persiste — non solo un numero diverso sul
    // contachilometri — richiesto esplicitamente dall'utente.
    const contactKeep = 1 - BRIDGE_BARRIER_CONTACT_DRAG;
    p.vx *= contactKeep;
    p.vz *= contactKeep;

    // p.speed (lo scalare usato da updateVelocity per ricostruire
    // fx/fz = sin/cos(angle)*speed ad ogni tick, vedi blend col grip) va
    // risincronizzato: si proietta la nuova vx/vz sul muso dell'auto
    // (stessa convenzione di updateVelocity), non ricostruito da un verso
    // scelto — altrimenti riappare il disallineamento "velocità fantasma"
    // già diagnosticato e corretto in precedenza.
    p.speed = p.vx * Math.sin(p.angle) + p.vz * Math.cos(p.angle);
}

// ====================================================
// DANNO DA COLLISIONE — modello unico 0-100%, come tyreWear. Si accumula
// SOLO in gara (le funzioni che lo applicano sono chiamate solo dai punti
// di resolveCollisions/applyBridgeBarrier già ristretti alla gara vera, vedi
// docs/superpowers/specs/2026-07-25-f1-danno-collisioni-design.md).
// ====================================================
const MIN_COLLISION_SEVERITY         = 1.0;   // sotto questa velocità di avvicinamento, nessun danno/penalità
const DAMAGE_PER_SEVERITY            = 6;     // % danno per unità di severità oltre soglia
const DAMAGE_CAP_PER_HIT             = 25;    // % danno massimo da un singolo urto
const VICTIM_DAMAGE_FRACTION         = 0.18;  // quota di danno che prende la vittima di un tamponamento
const COLLISION_PENALTY_PER_SEVERITY = 400;   // ms di penalità per unità di severità oltre soglia
const COLLISION_PENALTY_CAP_MS       = 5000;  // penalità massima da un singolo urto

function collisionDamageAmount(severity) {
    return Math.min(DAMAGE_CAP_PER_HIT, Math.abs(severity) * DAMAGE_PER_SEVERITY);
}

function applyCollisionPenalty(culprit, severity) {
    // Arrotondato a ms interi: severity è un float di fisica, e senza questo
    // collisionPenaltyMs (sommato a p.time in checkLap) diventa un numero
    // non intero — il tempo finale mostrato a schermo finiva con una sfilza
    // di decimali (es. "3:16.10.848209412244614", il resto del float dentro
    // ms % 1000 nel client).
    const ms = Math.round(Math.min(COLLISION_PENALTY_CAP_MS, Math.abs(severity) * COLLISION_PENALTY_PER_SEVERITY));
    culprit.collisionPenaltyMs += ms;
    culprit.pendingCollisionPenaltyEvents.push(ms);   // drenata da tickGame per l'emit f1CollisionPenalty
}

// avn/bvn: componenti di velocità di a/b lungo la normale d'urto (orientata
// da a verso b, vedi resolveCollisions) — avn>0: a si avvicina a b; -bvn>0:
// b si avvicina ad a. Chi si avvicina di più è il colpevole. closingRate è
// la violenza totale dell'urto (somma dei due avvicinamenti), già filtrata
// da MIN_COLLISION_SEVERITY dal chiamante.
function applyCarCollisionDamage(a, b, avn, bvn, closingRate) {
    const closingA = avn, closingB = -bvn;
    const faultIsA = closingA >= closingB;
    const culprit = faultIsA ? a : b;
    const victim  = faultIsA ? b : a;

    const dmg = collisionDamageAmount(closingRate);
    culprit.damage = Math.min(100, culprit.damage + dmg);
    victim.damage  = Math.min(100, victim.damage + dmg * VICTIM_DAMAGE_FRACTION);

    applyCollisionPenalty(culprit, closingRate);
}

function applyBarrierDamage(p, vn) {
    p.damage = Math.min(100, p.damage + collisionDamageAmount(vn));
    // nessuna penalità: contro il muro ci si fa male da soli.
}

// ====================================================
// COLLISIONI TRA AUTO — rettangoli orientati (OBB), niente danno
// Un cerchio esagera i fianchi rispetto al muso/coda (l'auto è molto più
// stretta che lunga): serve un rettangolo allineato con l'angolo di ciascuna
// auto. Rilevamento con SAT (Separating Axis Theorem, 4 assi: i due assi
// locali di ciascun box) + risoluzione con l'MTV (asse di overlap minimo).
// Correzione posizionale (evita compenetrazione) + scambio parziale della
// componente di velocità lungo la normale (bump arcade). La GRIP di
// updateVelocity riassorbe naturalmente la spinta nei tick successivi, quindi
// non serve alcuno stato dedicato: la fisica esistente fa già "recuperare"
// l'auto dopo l'urto.
// ====================================================
function carAxes(p) {
    const s = Math.sin(p.angle), c = Math.cos(p.angle);
    return {
        forward: { x: s, z: c },    // asse lunghezza (muso/coda)
        right:   { x: c, z: -s }    // asse larghezza (fianchi)
    };
}

// Proietta il box di p sull'asse dato: ritorna [min,max] dell'intervallo occupato
function projectOBB(p, axes, axis) {
    const centerProj = p.x * axis.x + p.z * axis.z;
    const radius =
        Math.abs(axes.forward.x * axis.x + axes.forward.z * axis.z) * CAR_HALF_LENGTH +
        Math.abs(axes.right.x   * axis.x + axes.right.z   * axis.z) * CAR_HALF_WIDTH;
    return { min: centerProj - radius, max: centerProj + radius };
}

const CAR_MAX_REACH = (CAR_HALF_LENGTH + CAR_HALF_WIDTH) * 2;   // scarto rapido, upper bound grossolano

function resolveCollisions(players) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];

            const dx = b.x - a.x, dz = b.z - a.z;
            if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;   // troppo distanti, salta il SAT
            }

            const axesA = carAxes(a);
            const axesB = carAxes(b);
            const axes  = [axesA.forward, axesA.right, axesB.forward, axesB.right];

            let minOverlap = Infinity;
            let mtvAxis    = null;

            let separated = false;
            for (const axis of axes) {
                const pa = projectOBB(a, axesA, axis);
                const pb = projectOBB(b, axesB, axis);
                const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
                if (overlap <= 0) { separated = true; break; }
                if (overlap < minOverlap) { minOverlap = overlap; mtvAxis = axis; }
            }
            if (separated) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;
            }

            // Normale dell'MTV, orientata da a verso b
            let nx = mtvAxis.x, nz = mtvAxis.z;
            if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }

            // Separazione posizionale: metà per uno, per non compenetrarsi
            const push = minOverlap * 0.5;
            a.x -= nx * push; a.z -= nz * push;
            b.x += nx * push; b.z += nz * push;

            // Impulso solo se si stanno avvicinando lungo la normale
            const avn = a.vx * nx + a.vz * nz;
            const bvn = b.vx * nx + b.vz * nz;
            const rel = bvn - avn;

            // Danno/penalità SOLO al primo contatto (transizione da "non a
            // contatto" a "a contatto"): uno struscio prolungato non deve
            // riaccumulare danno ad ogni sotto-step. resolveCollisions è
            // chiamata solo `if (!isQuali)` in tickGame, quindi tutto qui è
            // già implicitamente "solo in gara" — nessun controllo fase
            // aggiuntivo necessario.
            const wasInContact = a.carContacts.has(b.color);
            if (!wasInContact) {
                a.carContacts.add(b.color);
                b.carContacts.add(a.color);

                const closingRate = -rel;   // violenza totale dell'urto (rel<0 = si avvicinano)
                if (closingRate >= MIN_COLLISION_SEVERITY) {
                    applyCarCollisionDamage(a, b, avn, bvn, closingRate);
                }
            }

            if (rel < 0) {
                const delta = rel * COLLISION_BOUNCE;
                a.vx += nx * delta; a.vz += nz * delta;
                b.vx -= nx * delta; b.vz -= nz * delta;
            }
        }
    }
}

// ====================================================
// HELPERS
// ====================================================
function buildPublicState(players, raceStarted, track) {
    const out = {};

    // Classifica: calcolata solo a gara avviata (prima non ha senso, tutti fermi
    // allo spawn). ranked.indexOf è O(M) per giocatore ma M è al più 8 → irrilevante.
    let ranked = [];
    if (raceStarted) {
        ranked = Object.values(players).sort((a, b) => progressScore(b, track) - progressScore(a, track));
    }

    for (const [color, p] of Object.entries(players)) {
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            trackIndex: p.trackIndex,
            speed:    p.speed,
            finished: p.finished,
            time:     p.time,
            lap:      p.lap,
            position: raceStarted ? ranked.findIndex(r => r.color === color) + 1 : null,
            compound: p.compound,
            tyreWear: p.tyreWear,
            damage:   p.damage,
            // Autopilota corsia box (entrata/uscita): velocità del
            // limitatore, non del giocatore — il client la usa per un
            // rumore motore fisso invece che legato all'accelerazione,
            // anche quando non è lui a "guidare" in quella fase.
            pitLimiter: !!p.pitAutoState,
            // falseStartServed: il client lo usa per nascondere il badge
            // "!" in classifica live una volta scontata la penalità ai box
            // (resta invece visibile, senza questo campo, nel riepilogo di
            // fine gara — record storico, non un avviso "da pagare").
            falseStart: !!p.falseStart,
            falseStartServed: !!p.falseStartServed,
            gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null,
            isBot: !!p.isBot,
            slipstream: !!p.inSlipstream,
            collisionPenalty: p.collisionPenaltyMs > 0
        };
    }
    return out;
}

function resetPlayers(game) {
    let i = 0;
    for (const p of Object.values(game.players)) {
        const spawn = game.track.gridSpawnPoint(i);
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
        p.inputs = { throttle: 0, brake: 0, steer: 0 };
        if (p.isBot) { p.botHeadingToPits = false; p.botPitReactionScheduled = false; }
        i++;
    }
}

// ====================================================
// EXPORT PRIMITIVE FISICHE — additivo, non tocca la firma dell'handler
// socket esistente (module.exports resta chiamabile come module.exports(io,
// socket)). Serve a strumenti offline (vedi backend/tools/f1LapSimulator.js)
// che devono riprodurre la fisica ESATTA del server senza duplicarla.
// ====================================================
module.exports.physics = {
    PHYSICS_TICK_MS, COLLISION_SUBSTEPS,
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH, HALF_LAP_IDX,
    effectiveMaxSpeed, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor,
    assignGridSpawns,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCarCollisionDamage, applyBarrierDamage, applyCollisionPenalty,
    resolveCollisions,
    applyDamageSteerNoise, DAMAGE_STEER_NOISE_MAX, effectiveGrip,
    buildPublicState
};

module.exports.tickGame = tickGame;
module.exports.TYRE_COMPOUNDS = TYRE_COMPOUNDS;
