const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');

const PHYSICS_TICK_MS = 50;
const MAX_SPEED    = 4.0;
const ACCEL        = 0.12;
const FRICTION     = 0.050;
const TURN_SPEED   = 0.048;
const GRIP         = 0.78;
const ROAD_HALF    = 11;
const REJOIN_GRACE = 60000;   // finestra di riconnessione dopo un drop (scheda in background, refresh, rete)
const GRID_DISPLAY_MS = 8000; // quanto resta a schermo l'animazione POLE + la griglia prima del countdown di gara

// Ingombro reale dell'auto, misurato dal GLB (raceCarWhite.glb, bounding box
// combinata body+ruote applicando le translation dei nodi) × lo scale 3.5 con
// cui il modello viene caricato in f1.js: ~2.6 unità di larghezza (fianchi),
// ~4.7 di lunghezza (muso/coda). Il rettangolo va tenuto orientato con
// l'angolo dell'auto (SAT), altrimenti un cerchio esagera soprattutto i fianchi.
const CAR_HALF_LENGTH  = 2.4;  // metà lunghezza, asse avanti/dietro (locale Z)
const CAR_HALF_WIDTH   = 1.3;  // metà larghezza, asse fianchi (locale X)
const COLLISION_BOUNCE = 0.6;  // quota della velocità normale scambiata all'urto (bump arcade, non elastico puro)

// A MAX_SPEED (4/tick) due auto che si avvicinano chiudono fino a 8 unità in
// un tick — più della zona di contatto minima (~2.6, urto fianco-contro-fianco
// lungo l'asse stretto): senza integrare la posizione in sottostep, il
// rilevamento SAT (fatto una volta a fine tick) può non vedere mai la
// sovrapposizione e le auto si attraversano. 8 sottostep → chiusura massima
// 1 unità/sottostep, ben sotto qualunque zona di contatto possibile.
const COLLISION_SUBSTEPS = 8;

// ====================================================
// CORSIA BOX — vera strada che si stacca dal tracciato principale (punto 0),
// corre ben distante da qualunque chicane (x fino a -58, contro x≈-8/-16
// della chicane: nessuna interferenza) per un lungo tratto, tocca la
// casella box (indice PIT_BOX_INDEX), poi rientra sul tracciato principale
// molto più avanti (punto finale, dopo la chicane). Stessi punti usati anche
// per la mesh 3D lato client (frontend/f1.js).
//
// STERZARE VOLONTARIAMENTE verso il distacco (zona PIT_ENTRY_TRIGGER — una
// porzione stretta ancora dentro la larghezza normale di pista, nessun drag/
// usura da gestire lì) è il trigger d'ingresso: da quel momento il server
// guida l'auto lungo tutto il percorso (autopilota) fino alla casella,
// gestisce la sosta, poi la riporta sulla pista principale. Il giocatore non
// deve più fermarsi con precisione da solo (causa del "blocco troppo lungo/
// impreciso" segnalato in precedenza).
// ====================================================
const PIT_PATH = [
    { x: -30, z:   0 },   // 0: distacco dal tracciato principale
    { x: -42, z:  10 },   // 1
    { x: -55, z:  25 },   // 2
    { x: -58, z:  50 },   // 3
    { x: -58, z:  80 },   // 4: CASELLA BOX
    { x: -58, z: 110 },   // 5
    { x: -55, z: 135 },   // 6
    { x: -42, z: 148 },   // 7
    { x: -30, z: 155 },   // 8: rientro sul tracciato principale
];
const PIT_BOX_INDEX = 4;

// Zona di trigger: stretta e vicina al bordo pista normale (nessuna
// interferenza con la guida normale sul resto del rettilineo).
const PIT_ENTRY_TRIGGER = { xMax: -36, zMin: -3, zMax: 15 };
function inPitEntryZone(p) {
    return p.x <= PIT_ENTRY_TRIGGER.xMax && p.z >= PIT_ENTRY_TRIGGER.zMin && p.z <= PIT_ENTRY_TRIGGER.zMax;
}

const PIT_AUTO_SPEED = 1.0;   // unità/tick dell'autopilota lungo PIT_PATH (25% di MAX_SPEED)
const PIT_AUTO_ARRIVE_DIST = 1.0;   // sotto questa distanza dal waypoint, "arrivato"

// ====================================================
// PUNTI SPAWN (rettilineo principale x≈-30, z crescente)
// ====================================================
const SPAWN_POINTS = [
    { x: -26, z:  8, angle: 0 },
    { x: -34, z:  8, angle: 0 },
    { x: -26, z: 18, angle: 0 },
    { x: -34, z: 18, angle: 0 },
    { x: -26, z: 28, angle: 0 },
    { x: -34, z: 28, angle: 0 },
    { x: -26, z: 38, angle: 0 },
    { x: -34, z: 38, angle: 0 },
];

// Qualifica: TUTTI dallo stesso identico punto (isolati tra loro — vedi
// playersVisibleTo — quindi condividere la posizione è innocuo, e rende la
// prova di ognuno equa/comparabile fin dal via).
const QUALI_SPAWN = { x: -30, z: 8, angle: 0 };

// ====================================================
// GRIGLIA DI PARTENZA (dopo la qualifica) — a scaglioni, non a righe pari.
// Due corsie alternate (come le due "caselle" di ogni riga F1), ma OGNI
// posizione è leggermente più indietro della precedente — anche il 2° rispetto
// al 1°, non solo riga contro riga — così nessuno parte perfettamente
// affiancato a chi lo precede in griglia.
// ====================================================
const GRID_START_Z   = 40;
const GRID_STAGGER_Z = 5;              // quanto ogni posizione è più indietro della precedente
const GRID_LANE_X    = [-34, -26];     // due corsie alternate, stessa x delle SPAWN_POINTS esistenti

function gridSpawnPoint(i) {
    return {
        x:     GRID_LANE_X[i % 2],
        z:     GRID_START_Z - i * GRID_STAGGER_Z,
        angle: 0
    };
}

// ====================================================
// PUNTI DELLA PISTA (per rilevamento uscita)
// Interpolazione lineare tra i waypoint del frontend
// ====================================================
function leftCX(z) {
    if (z <= 60)  return -30;
    if (z <= 82)  return -30 + (z - 60) / 22 * 14;   // -30 → -16
    if (z <= 100) return -16 + (z - 82) / 18 * 8;    // -16 → -8
    if (z <= 118) return  -8 - (z - 100) / 18 * 8;   // -8 → -16
    if (z <= 145) return -16 - (z - 118) / 27 * 14;  // -16 → -30
    return -30;
}
function rightCX(z) {
    if (z <= 60)  return 130;
    if (z <= 82)  return 130 + (z - 60) / 22 * 16;   // 130 → 146
    if (z <= 100) return 146 - (z - 82) / 18 * 8;    // 146 → 138
    if (z <= 118) return 138 + (z - 100) / 18 * 8;   // 138 → 146
    if (z <= 145) return 146 - (z - 118) / 27 * 16;  // 146 → 130
    return 130;
}

const TRACK_POINTS = (() => {
    const pts = [];
    for (let z = -5; z <= 205; z += 3) pts.push({ x: leftCX(z),  z });
    for (let a = 180; a >= 0; a -= 3) {
        const r = a * Math.PI / 180;
        pts.push({ x: 50 + 80 * Math.cos(r), z: 200 + 80 * Math.sin(r) });
    }
    for (let z = 205; z >= -5; z -= 3) pts.push({ x: rightCX(z), z });
    for (let a = 0; a >= -180; a -= 3) {
        const r = a * Math.PI / 180;
        pts.push({ x: 50 + 80 * Math.cos(r), z: 80 * Math.sin(r) });
    }
    return pts;
})();

// Lunghezza reale del giro, derivata da TRACK_POINTS (non un numero fisso a
// mano): usata per calibrare l'usura delle gomme in "quanti giri dura una
// mescola" invece che in unità di distanza astratte.
const TRACK_LAP_LENGTH = (() => {
    let len = 0;
    for (let i = 0; i < TRACK_POINTS.length; i++) {
        const a = TRACK_POINTS[i], b = TRACK_POINTS[(i + 1) % TRACK_POINTS.length];
        len += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return len;
})();

function nearestTrackDist(x, z) {
    let min = Infinity;
    for (const pt of TRACK_POINTS) {
        const d = (x - pt.x) ** 2 + (z - pt.z) ** 2;
        if (d < min) min = d;
    }
    return Math.sqrt(min);
}

// ====================================================
// MESCOLE E USURA GOMME
// Soft/Medium/Hard differiscono sia in prestazioni (velocità massima e
// aderenza) sia in velocità di usura — come nella F1 vera: la Soft è più
// veloce ma dura meno, la Hard il contrario. L'usura cresce SOLO con la
// distanza percorsa (fermo = zero usura, richiesta esplicita), con un piccolo
// extra fuoripista; a gomme esaurite si perde fino a WEAR_SPEED_PENALTY di
// velocità massima e WEAR_GRIP_PENALTY di aderenza (più derapate).
// ====================================================
const TYRE_COMPOUNDS = {
    soft:   { label: 'Soft',   color: '#e74c3c', speedMult: 1.05, gripMult: 1.00, wearRate: 1.5 },
    medium: { label: 'Medium', color: '#f1c40f', speedMult: 1.00, gripMult: 0.95, wearRate: 1.0 },
    hard:   { label: 'Hard',   color: '#ecf0f1', speedMult: 0.95, gripMult: 0.90, wearRate: 0.6 },
};
const DEFAULT_COMPOUND = 'medium';
const TYRE_SELECT_MS   = 20000;   // tempo per scegliere prima che scatti la mescola di default

const WEAR_LAPS_AT_MEDIUM = 5;   // quanti giri dura una Medium (wearRate=1) prima del 100% di usura
const WEAR_PER_UNIT_DIST  = 100 / (WEAR_LAPS_AT_MEDIUM * TRACK_LAP_LENGTH);
const WEAR_OFFTRACK_EXTRA = 0.02; // piccolo extra per tick fuori pista (oltre a quello da distanza)
const WEAR_SPEED_PENALTY  = 0.25; // fino a -25% velocità massima a gomme esaurite
const WEAR_GRIP_PENALTY   = 0.35; // fino a -35% aderenza a gomme esaurite (più derapate)

// ====================================================
// MINIGIOCO DI REAZIONE AL PIT STOP
// Il server è autoritativo sul tempo di reazione (misura dal proprio invio
// del segnale "vai" alla ricezione della pressione — include la latenza di
// rete, limite accettato). Premere prima del segnale = falsa partenza, sosta
// alla durata massima.
// ====================================================
const PIT_GO_DELAY_MIN  = 1000, PIT_GO_DELAY_MAX  = 3000;   // attesa casuale prima del segnale
const PIT_REACTION_BEST = 150,  PIT_REACTION_WORST = 800;   // ms: sotto/sopra questi si satura
const PIT_DURATION_MIN  = 3000, PIT_DURATION_MAX   = 7000;  // durata sosta risultante
const PIT_PENALTY_MS    = 30000;   // penalità se non si fa MAI pit stop in gara (regola F1 vera)

// In qualifica TUTTI usano lo spec della Soft (gomma da qualifica, come in F1
// vera), gomme fresche, a prescindere dalla mescola scelta per la gara — la
// scelta conta solo una volta iniziata la gara vera.
function tyreOf(p, isQuali) {
    if (isQuali) return TYRE_COMPOUNDS.soft;
    return TYRE_COMPOUNDS[p.compound] || TYRE_COMPOUNDS[DEFAULT_COMPOUND];
}

function effectiveMaxSpeed(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor;
}

// Suggerimento di strategia (solo indicativo, mostrato in selezione mescola):
// parte da una mescola durevole per il primo stint, poi via via più
// prestazionali per i restanti — quante ne servono dipende dai giri totali.
function suggestStrategy(totalLaps) {
    const life = {
        hard:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.hard.wearRate)),
        medium: WEAR_LAPS_AT_MEDIUM,
        soft:   Math.max(1, Math.round(WEAR_LAPS_AT_MEDIUM / TYRE_COMPOUNDS.soft.wearRate)),
    };
    const order  = ['hard', 'medium', 'soft'];
    const stints = [];
    let remaining = totalLaps;
    let i = 0;
    while (remaining > 0 && stints.length < 6) {
        const compound = order[Math.min(i, order.length - 1)];
        stints.push(compound);
        remaining -= life[compound];
        i++;
    }
    return stints;
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
            const lobby = lobbies.get(lobbyId);
            activeGames.set(lobbyId, {
                gameId:            'f1',   // marca il tipo: gli handler condivisi (disconnect) NON devono toccare partite di altri giochi
                phase:             'tyre_select',   // tyre_select -> qualifying -> grid_display -> race -> race_end
                players:           {},
                socketByColor:     {},   // color -> socket.id CORRENTE, per gli emit personalizzati in qualifica
                tick:              null,
                raceStarted:       false,
                raceEnded:         false,
                raceStartTime:     null,
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
        }

        const game       = activeGames.get(lobbyId);
        const totalLaps  = parseInt((game.settings || {}).laps) || 3;
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
                x:               QUALI_SPAWN.x,
                z:               QUALI_SPAWN.z,
                angle:           QUALI_SPAWN.angle,
                speed:           0,
                vx:              0,
                vz:              0,
                inputs:          { w: false, a: false, s: false, d: false },
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
                pitAutoState:    null,    // 'entering' | 'exiting' | null — autopilota corsia box
                pitPathIndex:    0,       // prossimo waypoint di PIT_PATH verso cui puntare
            };
        }

        socket.emit('f1Setup', {
            playerColor,
            hostColor:     game.hostColor,
            trackName:     'Monte Rosso',
            totalLaps,
            phase:         game.phase,
            grid:          game.grid,
            raceStarted:   game.raceStarted,
            elapsed:       (game.raceStarted && game.raceStartTime) ? (Date.now() - game.raceStartTime) : 0,
            players:       buildPublicState(playersVisibleTo(game, playerColor), game.raceStarted),
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

    socket.on('f1Input', ({ lobbyId, playerColor, inputs }) => {
        const game = activeGames.get(lobbyId);
        if (!game || !game.players[playerColor]) return;
        game.players[playerColor].inputs = inputs;
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
        startRaceCountdown(io, lobbyId, game);
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
        p.inputs = { w: false, a: false, s: false, d: false };

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
    // Tutti allo stesso identico punto (vedi QUALI_SPAWN), a prescindere da
    // dove fossero prima (già impostato alla creazione, ma qui è garantito
    // anche per chi era entrato con uno stato diverso).
    for (const p of Object.values(game.players)) {
        p.x = QUALI_SPAWN.x; p.z = QUALI_SPAWN.z; p.angle = QUALI_SPAWN.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
    }
    io.to(lobbyId).emit('f1Countdown', { trackName: 'Monte Rosso', label: 'QUALIFICA — 1 GIRO' });
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

    // Chi non ha completato il giro (null) va in fondo alla griglia, in ordine
    // di apparizione (nessun'altra informazione disponibile per ordinarli).
    const ranked = Object.values(game.players).slice().sort((a, b) => {
        if (a.time === null && b.time === null) return 0;
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time - b.time;
    });
    game.grid = ranked.map(p => p.color);

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
    io.to(lobbyId).emit('f1QualiEnded', {
        grid: ranked.map(p => ({ color: p.color, time: p.time }))
    });

    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        startRaceCountdown(io, lobbyId, g);
    }, GRID_DISPLAY_MS);
}

function startRaceCountdown(io, lobbyId, game) {
    game.phase          = 'race';
    game.raceEnded      = false;
    game.raceStarted    = false;
    game.raceStartTime  = null;
    io.to(lobbyId).emit('f1Countdown', { trackName: 'Monte Rosso', label: 'GARA' });
    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        g.raceStarted   = true;
        g.raceStartTime = Date.now();
        console.log(`🚦 [F1] Gara avviata (lobby ${lobbyId})`);
        io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0, phase: 'race' });
    }, 3000);
}

// Assegna gli spawn secondo l'ordine di griglia (pole = posizione 0, la PIÙ
// AVANZATA — vedi gridSpawnPoint). Eventuali giocatori non presenti in
// game.grid (entrati dopo la fine della qualifica) vengono accodati in fondo.
function assignGridSpawns(game) {
    const order = [...game.grid, ...Object.keys(game.players).filter(c => !game.grid.includes(c))];
    order.forEach((color, i) => {
        const p = game.players[color];
        if (!p) return;
        const spawn = gridSpawnPoint(i);
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
        p.tyreWear = 0;   // gomme fresche per la gara vera (l'usura conta solo in gara, non in qualifica)
        if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }
        p.pitting = false; p.pitPhase = null; p.pitGoTime = null;
        p.pendingCompound = null; p.hasPitted = false; p.pitPenalty = false;
        p.pitAutoState = null; p.pitPathIndex = 0;
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

// Sposta l'auto verso il prossimo waypoint di PIT_PATH a velocità fissa e
// bassa — apposta lenta, per dare tempo di scegliere la mescola durante il
// tragitto (soprattutto in ingresso).
function updatePitAutopilot(io, lobbyId, game, p) {
    const target = PIT_PATH[p.pitPathIndex];
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < PIT_AUTO_ARRIVE_DIST) {
        p.x = target.x; p.z = target.z;
        p.speed = 0; p.vx = 0; p.vz = 0;

        if (p.pitPathIndex === PIT_BOX_INDEX && p.pitAutoState === 'entering') {
            p.pitAutoState = null;   // arrivato: la sosta prende il posto dell'autopilota
            startPitStop(io, lobbyId, game, p);
            return;
        }

        p.pitPathIndex++;
        if (p.pitPathIndex >= PIT_PATH.length) {
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
    const durationMs = PIT_DURATION_MIN + t * (PIT_DURATION_MAX - PIT_DURATION_MIN);

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

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopFinished', { compound: p.compound });

    p.pitAutoState = 'exiting';
    p.pitPathIndex = PIT_BOX_INDEX + 1;   // continua dal waypoint successivo alla casella
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
            io.to(sid).emit('f1StateUpdate', buildPublicState(playersVisibleTo(game, color), raceStartedFlag));
        }
        return;
    }
    io.to(lobbyId).emit('f1StateUpdate', buildPublicState(playersVisibleTo(game, null), raceStartedFlag));
}

// ====================================================
// TICK FISICO
// ====================================================
function tickGame(io, lobbyId, game) {
    if (!game.raceStarted) {
        broadcastState(io, lobbyId, game, false);
        return;
    }
    const isQuali  = game.phase === 'qualifying';
    // In qualifica si fa UN giro secco; in gara i giri sono quelli impostati in lobby.
    const totalLaps = isQuali ? 1 : (parseInt((game.settings || {}).laps) || 3);
    const players    = Object.values(game.players);
    // In qualifica corrono TUTTI in parallelo (isolati solo visivamente, non
    // fisicamente: nessuna collisione tra loro — vedi sotto). Chi è fermo ai
    // box (pitting) o guidato dall'autopilota (pitAutoState) resta escluso
    // dalla fisica normale come un giocatore finished, ma — come i finished —
    // resta un ostacolo per resolveCollisions.
    const racing      = players.filter(p => !p.finished && !p.pitting && !p.pitAutoState);
    const autoPiloted = players.filter(p => p.pitAutoState);

    // Velocità (accelerazione/freno/sterzo/grip): una volta per tick, come prima.
    for (const p of racing) updateVelocity(p, isQuali);

    // Posizione: in SOTTOSTEP, con risoluzione collisioni ad ogni sottostep
    // (vedi commento su COLLISION_SUBSTEPS). Le auto ferme (finite o in grazia)
    // restano ostacoli fisici, quindi resolveCollisions lavora su TUTTI i
    // giocatori non-in-qualifica, non solo su chi corre.
    const prevZ = {};
    for (const p of racing) prevZ[p.color] = p.z;

    for (let s = 0; s < COLLISION_SUBSTEPS; s++) {
        for (const p of racing) integratePosition(p, 1 / COLLISION_SUBSTEPS);
        if (!isQuali) resolveCollisions(players);
    }

    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p);
        updateTrackIndex(p);
        // L'usura conta solo in GARA: in qualifica le gomme restano quelle
        // scelte ma "fresche" fino al via vero (resettate in assignGridSpawns).
        if (game.phase === 'race') applyTyreWear(p, offTrack);
        checkLap(p, prevZ[p.color], totalLaps, io, lobbyId, game);

        // Ingresso volontario nella corsia box (solo in gara: sterzare lì è
        // una scelta del giocatore). Da qui il server prende il volante — vedi
        // startPitLaneEntry/updatePitAutopilot — fino a fine visita ai box.
        if (game.phase === 'race' && inPitEntryZone(p)) {
            startPitLaneEntry(io, lobbyId, game, p);
        }
    }

    // Autopilota ingresso/uscita corsia box: movimento dedicato, non passa
    // per updateVelocity/integratePosition (niente input del giocatore).
    for (const p of autoPiloted) {
        updatePitAutopilot(io, lobbyId, game, p);
        updateTrackIndex(p);
    }

    // Fine sessione (qualifica o gara): tutti i giocatori CONNESSI hanno finito
    // (chi è in grazia con l'auto ferma non blocca la chiusura; c'è comunque un
    // timer di sicurezza per chi resta indietro senza essersi disconnesso).
    const connected = players.filter(p => !p.disconnected);
    if (isQuali) {
        if (!game.qualiEnded && connected.length > 0 && connected.every(p => p.finished)) {
            endQualifying(io, lobbyId, game);
            return;
        }
    } else if (game.phase === 'race') {
        if (!game.raceEnded && connected.length > 0 && connected.every(p => p.finished)) {
            endRace(io, lobbyId, game);
            return;
        }
    }

    broadcastState(io, lobbyId, game, true);
}

// ====================================================
// PROGRESSO LUNGO IL TRACCIATO (per le posizioni in gara)
// TRACK_POINTS è già ordinato nel verso di marcia (rettilineo sx → parabolica
// alta → rettilineo dx → parabolica bassa). Ricerca LOCALE nell'intorno
// dell'indice precedente (con wrap) invece che globale: evita l'ambiguità nel
// punto di saldatura fine/inizio giro, dove l'ultimo punto della parabolica
// bassa e il primo del rettilineo sx sono quasi coincidenti nello spazio.
// ====================================================
const TRACK_INDEX_WINDOW = 20;

function updateTrackIndex(p) {
    const n    = TRACK_POINTS.length;
    const prev = p.trackIndex || 0;
    let bestIdx  = prev;
    let bestDist = Infinity;
    for (let d = -TRACK_INDEX_WINDOW; d <= TRACK_INDEX_WINDOW; d++) {
        const idx = ((prev + d) % n + n) % n;
        const pt  = TRACK_POINTS[idx];
        const dist = (p.x - pt.x) ** 2 + (p.z - pt.z) ** 2;
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    }
    p.trackIndex = bestIdx;
}

// Punteggio di avanzamento: lap*N+indice cresce in modo continuo attraverso il
// giro (l'indice si azzera esattamente quando lap incrementa, stesso tick,
// perché entrambi derivano dalla stessa p.x/p.z). Un giocatore finished ha
// sempre punteggio più alto di uno ancora in gara (lap==totalLaps domina).
function progressScore(p) {
    return p.lap * TRACK_POINTS.length + (p.trackIndex || 0);
}

// ====================================================
// LAP CHECK — zona-based (più robusto del crossing)
// Checkpoint A: z ∈ [150,210] sul rettilineo sx (x < 50)
// Traguardo:    z ∈ [0, 10]  sul rettilineo sx (x < 50), dopo aver passato A
// ====================================================
function checkLap(p, prevZ, totalLaps, io, lobbyId, game) {
    const onLeftSide = p.x < 50;   // esclude il rettilineo dx (x≈130)

    // Checkpoint A: il driver ha superato metà giro
    if (onLeftSide && p.z >= 150 && p.z <= 210 && !p.checkpointA) {
        p.checkpointA = true;
    }

    // Zona traguardo: z ∈ [0,10] sul rettilineo sx, dopo il checkpoint A
    const inFinishZone = onLeftSide && p.z >= 0 && p.z <= 10;
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
    const podium = Object.values(game.players)
        .filter(p => p.time !== null)
        .sort((a, b) => a.time - b.time)
        .map(p => ({ color: p.color, totalTime: p.time, pitPenalty: !!p.pitPenalty }));
    io.to(lobbyId).emit('f1RaceEnded', {
        podium,
        isFinal:      true,
        isSingleMode: (game.settings || {}).mode === 'single',
        trackName:    'Monte Rosso'
    });
}

// ====================================================
// FISICA
// Velocità (accelerazione/freno/sterzo/grip) e integrazione della posizione
// sono separate apposta: la velocità si calcola una volta per tick, la
// posizione viene integrata in sottostep da tickGame (vedi COLLISION_SUBSTEPS)
// per dare alla risoluzione collisioni più occasioni di vedere un contatto.
// ====================================================
function updateVelocity(p, isQuali) {
    const { inputs } = p;
    const maxSpeed = effectiveMaxSpeed(p, isQuali);   // dipende da mescola + usura (Soft fissa in qualifica)
    const grip     = effectiveGrip(p, isQuali);

    if (inputs.w)      p.speed = Math.min(p.speed + ACCEL, maxSpeed);
    else if (inputs.s) {
        // Frenata/retromarcia: più pronta dell'accelerazione ma non aggressiva
        // (prima era 2× + uno smorzamento laterale del 16%/tick, troppo brusca
        // e difficile da controllare — segnalato dall'utente).
        p.speed = Math.max(p.speed - ACCEL * 1.4, -maxSpeed / 2);
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
        if (inputs.a) p.angle += TURN_SPEED * dir;
        if (inputs.d) p.angle -= TURN_SPEED * dir;
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
function applyOffTrackDrag(p) {
    const dist = nearestTrackDist(p.x, p.z);
    const offTrack = dist > ROAD_HALF + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - ROAD_HALF - 2) / 8);  // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

// Usura gomme: SOLO dalla distanza percorsa nel tick (fermo = zero usura,
// nessun caso speciale necessario) + un piccolo extra fisso se fuori pista.
function applyTyreWear(p, offTrack) {
    const dist = Math.hypot(p.vx, p.vz);   // distanza percorsa in questo tick
    p.tyreWear = Math.min(100, p.tyreWear + dist * WEAR_PER_UNIT_DIST * tyreOf(p).wearRate);
    if (offTrack) p.tyreWear = Math.min(100, p.tyreWear + WEAR_OFFTRACK_EXTRA);
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
            if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) continue;   // troppo distanti, salta il SAT

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
            if (separated) continue;

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
function buildPublicState(players, raceStarted) {
    const out = {};

    // Classifica: calcolata solo a gara avviata (prima non ha senso, tutti fermi
    // allo spawn). ranked.indexOf è O(M) per giocatore ma M è al più 8 → irrilevante.
    let ranked = [];
    if (raceStarted) {
        ranked = Object.values(players).sort((a, b) => progressScore(b) - progressScore(a));
    }

    for (const [color, p] of Object.entries(players)) {
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            speed:    p.speed,
            finished: p.finished,
            time:     p.time,
            lap:      p.lap,
            position: raceStarted ? ranked.findIndex(r => r.color === color) + 1 : null,
            compound: p.compound,
            tyreWear: p.tyreWear
        };
    }
    return out;
}

function resetPlayers(game) {
    let i = 0;
    for (const p of Object.values(game.players)) {
        const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.trackIndex = 0;
        i++;
    }
}
