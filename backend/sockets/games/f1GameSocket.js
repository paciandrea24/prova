const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');
const { loadTrack } = require('./trackLoader');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const { createBots, updateBotInputs, estimateFinishTime, nearestAheadPlayer, BOT_RACE_START_REACTION_MIN_MS, BOT_RACE_START_REACTION_MAX_MS } = require('./f1Bot');
const TyreModel = require('./physics/TyreModel');
const {
    TYRE_COMPOUNDS, DEFAULT_COMPOUND, WEAR_LAPS_AT_MEDIUM,
    tyreOf, suggestStrategy
} = TyreModel;

const DamageModel = require('./physics/DamageModel');
const {
    DAMAGE_STEER_NOISE_MAX,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    applyDamageSteerNoise, collisionDamageAmount, applyCollisionPenalty,
    applyCarCollisionDamage, applyBarrierDamage,
    createDamageParts, FRONT_WING_STEER_PENALTY_MAX,
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise
} = DamageModel;

const VehiclePhysics = require('./physics/VehiclePhysics');
const {
    ACCEL, BRAKE_MULT, TURN_SPEED_HIGH,
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult
} = VehiclePhysics;

const CollisionResolver = require('./physics/CollisionResolver');
const { TRACK_INDEX_WINDOW } = CollisionResolver;

// Facade: unico punto da cui il tick loop qui sotto invoca la simulazione
// vettura — vedi VehicleDynamics.js. Le altre costanti/funzioni sopra
// (TYRE_COMPOUNDS, DAMAGE_*, ACCEL, ecc.) restano importate direttamente dai
// moduli originali: servono altrove in questo file (buildPublicState,
// module.exports.physics) — e in parte ANCHE dentro tickGame, ma non dalla
// sequenza principale di simulazione vettura: effectiveMaxSpeed/ACCEL/
// BRAKE_MULT/TURN_SPEED_HIGH sono usate dal deps object del bot AI
// (updateBotInputs) più sotto, non dalla catena updateVelocity/
// integratePosition/... che ora passa per VehicleDynamics.
const VehicleDynamics = require('./physics/VehicleDynamics');
const {
    COLLISION_SUBSTEPS,
    updateVelocity, integratePosition, applyOffTrackDrag,
    applyBridgeBarrier, resolveCollisions,
    applyTyreWear
} = VehicleDynamics;

const PHYSICS_TICK_MS = 50;

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

const TYRE_SELECT_MS   = 20000;   // tempo per scegliere prima che scatti la mescola di default

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
                damage:                  0,       // 0-100, come tyreWear — solo in gara (vedi assignGridSpawns/checkLap). Derivato dal massimo dei 4 componenti di damageParts.
                damageParts:             createDamageParts(),   // { frontWing, floor, engine, suspension }, 0-100 ciascuno — vedi DamageModel.js Cap. 3.8. Ri-creato ad ogni assignGridSpawns/repair ai box, mai condiviso per riferimento.
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
        p.damageParts = createDamageParts();   // fresco ad ogni gara — mai riutilizzare l'oggetto precedente
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
    if (p.pendingRepair) { p.damage = 0; p.damageParts = createDamageParts(); }
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
// TRACK_INDEX_WINDOW è importato da CollisionResolver.js — stesso valore usato da
// applyBridgeBarrier e updateTrackIndex, unica fonte di verità.
// ====================================================
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
            steerInput: p.inputs?.steer ?? 0,
            finished: p.finished,
            time:     p.time,
            lap:      p.lap,
            position: raceStarted ? ranked.findIndex(r => r.color === color) + 1 : null,
            compound: p.compound,
            tyreWear: p.tyreWear,
            damage:   p.damage,
            damageParts: p.damageParts,
            // Debug usura/danno (tasto G lato client, vedi frontend/f1.js):
            // percentuale del potenziale RESIDUO rispetto alla condizione
            // perfetta (effectiveXxx(p, true) = come se fosse tutto sano,
            // stesso trucco già usato per bypassare usura/danno in
            // qualifica), non un valore assoluto — più leggibile per capire
            // "quanto mi manca" a colpo d'occhio. isQuali=false qui è safe
            // anche durante una vera qualifica: tyreWear/damageParts sono
            // sempre a zero in quel contesto, quindi il risultato combacia.
            debug: {
                maxSpeedPct: Math.round((effectiveMaxSpeed(p, false) / effectiveMaxSpeed(p, true)) * 100),
                gripPct:     Math.round((effectiveGrip(p, false) / effectiveGrip(p, true)) * 100),
                accelPct:    Math.round((effectiveAccel(p, false) / effectiveAccel(p, true)) * 100),
                brakePct:    Math.round((effectiveBrakeMult(p, false) / effectiveBrakeMult(p, true)) * 100),
                steerPct:    Math.round((1 - getFrontWingSteerPenalty(p.damageParts)) * 100),
            },
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
    effectiveMaxSpeed, effectiveAccel, effectiveBrakeMult, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBridgeBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor,
    assignGridSpawns,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCarCollisionDamage, applyBarrierDamage, applyCollisionPenalty,
    resolveCollisions,
    applyDamageSteerNoise, DAMAGE_STEER_NOISE_MAX, effectiveGrip,
    createDamageParts, FRONT_WING_STEER_PENALTY_MAX,
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise,
    buildPublicState
};

module.exports.tickGame = tickGame;
module.exports.TYRE_COMPOUNDS = TYRE_COMPOUNDS;
