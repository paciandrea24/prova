const { activeGames } = require('../../store/activeGames');
const { lobbies, verificaGettone } = require('../../store/lobbies');
const { loadTrack } = require('./trackLoader');
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const BoxIngresso = require('../../../frontend/shared/f1BoxIngresso.js');
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
    effectiveMaxSpeed, effectiveGrip, effectiveAccel, effectiveBrakeMult, corneringCapacity
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
    applyBarrier, resolveCollisions,
    applyTyreWear
} = VehicleDynamics;

// Fase 4 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md):
// import diretto (non tramite VehicleDynamics/VehiclePhysics, che restano
// la facade solo per la catena updateVelocity/integratePosition/...) per
// consultare la formula scia dietro flag di confronto — vedi
// computeSlipstreamMult più sotto.
const AerodynamicsModel = require('./physics/AerodynamicsModel');

const PHYSICS_TICK_MS = 50;

// Diagnostica costo reale del tick fisico (ms CPU per tickGame), per avere
// numeri concreti su Render invece di giudicare il lag "a sensazione" — ha
// causato un tentativo di ottimizzazione fallito (broadcast diradato) la cui
// vera causa (nessuna predizione client-side, non il costo del tick) non era
// misurabile senza questo. Logga una media ogni TICK_PERF_LOG_EVERY tick,
// per lobby, poi resetta l'accumulo.
const TICK_PERF_LOG_EVERY = 100;   // ~5s a 20Hz
const TICK_STALL_THRESHOLD_MS = 15;   // 30% del budget di 50ms: log immediato, per capire COSA c'era in corso
const tickPerfStats = new Map();   // lobbyId -> { sum, max, count }

function recordTickDuration(lobbyId, playerCount, phase, ms) {
    if (ms >= TICK_STALL_THRESHOLD_MS) {
        const mem = process.memoryUsage();
        console.log(`[F1 perf][STALL] lobby=${lobbyId} phase=${phase} tick=${ms.toFixed(2)}ms heapUsed=${(mem.heapUsed / 1048576).toFixed(1)}MB rss=${(mem.rss / 1048576).toFixed(1)}MB`);
    }
    let s = tickPerfStats.get(lobbyId);
    if (!s) { s = { sum: 0, max: 0, count: 0 }; tickPerfStats.set(lobbyId, s); }
    s.sum += ms;
    if (ms > s.max) s.max = ms;
    s.count++;
    if (s.count >= TICK_PERF_LOG_EVERY) {
        console.log(`[F1 perf] lobby=${lobbyId} players=${playerCount} tick avg=${(s.sum / s.count).toFixed(2)}ms max=${s.max.toFixed(2)}ms (ultimi ${s.count})`);
        tickPerfStats.delete(lobbyId);
    }
}

// Scia: un'auto che segue da vicino un'altra (stessa distanza lungo la
// pista già usata per il "seguire" dei bot, non una posizione laterale)
// ottiene un bonus di velocità massima, tanto più grande quanto più è
// vicina, azzerato oltre SLIPSTREAM_RANGE_M — vale per TUTTI i giocatori
// (umani e bot), stesso meccanismo, richiesto esplicitamente dall'utente
// per rendere più frequenti i sorpassi: chi insegue recupera terreno.
// Solo in GARA (mai in qualifica, dove ogni pilota corre isolato — vedi
// playersVisibleTo — un boost da un'auto invisibile sarebbe incomprensibile).
const SLIPSTREAM_RANGE_M = 25;
const SLIPSTREAM_MAX_BOOST = 0.08;   // fino a +8% di velocità massima quasi a contatto

// Fase 4 (percorso di confronto, F1_AERO_SLIPSTREAM_MODEL=1): SOLO il
// calcolo del moltiplicatore da un gap già noto — la ricerca del gap
// (nearestAheadPlayer), il loop, l'esclusione qualifica e il flag visivo
// p.inSlipstream restano nel tick loop sotto, invariati. A flag spento,
// formula storica invariata bit-per-bit; a flag acceso, delega a
// AerodynamicsModel.slipstreamFactor (unico proprietario del dominio
// aero) invece di ricalcolarla qui. Il guard `gapM >= SLIPSTREAM_RANGE_M`
// qui dentro è ridondante nel tick loop sotto (che già filtra a monte),
// ma rende la funzione autosufficiente per l'uso/test in isolamento —
// zero impatto sul comportamento di gioco reale, unico chiamante invariato.
// Estratta in funzione a parte (invece di restare inline nel tick loop)
// per essere testabile in isolamento,
// stesso motivo di ogni altra voce in module.exports.physics.
function computeSlipstreamMult(gapM) {
    if (gapM >= SLIPSTREAM_RANGE_M) return 1;
    return AerodynamicsModel.isAeroSlipstreamModelActive()
        ? AerodynamicsModel.slipstreamFactor(gapM)
        : 1 + (1 - gapM / SLIPSTREAM_RANGE_M) * SLIPSTREAM_MAX_BOOST;
}
const REJOIN_GRACE = 60000;   // finestra di riconnessione dopo un drop (scheda in background, refresh, rete)
// ── Sequenza fra la fine della qualifica e il semaforo ──────────────────
// Tre momenti, nell'ordine: stacco a tutto schermo (stile sigla TV) →
// scoperta della propria posizione in griglia → riepilogo con la griglia
// completa e il modello dell'auto in pole. Poi il posizionamento sulla
// griglia vera, il semaforo, il via.
//
// Le durate stanno QUI e viaggiano dentro f1QualiEnded: il client le usa per
// i propri tempi invece di tenerne una copia, così non possono divergere
// (stesso criterio di RACE_END_RETURN_MS).
//
// Il totale è lo stesso per tutti — il semaforo scatta insieme per tutti, non
// si può fare altrimenti. Chi fa la pole si prende più tempo sulla scoperta e
// altrettanto meno sul riepilogo: è lo stesso monte, distribuito diverso.
//
// Il passaggio era brusco (richiesta utente 2026-08-18: "appena tutti hanno
// finito la qualifica si viene subito catapultati sulla griglia"). Ora dura
// più del doppio, ed è voluto: serve anche a dare tempo al caricamento.
// 4200 e non 2600: al primo playtest lo stacco e' risultato illeggibile
// ("la velocita' mi e' sembrata un po' troppa, non ci ho capito niente"). Il
// disegno e' stato rifatto piu' calmo, ma serviva anche il tempo — dentro
// questi millisecondi ci sta una SOSTA vera in cui lo schermo e' fermo e si
// legge il nome del circuito, che prima non esisteva.
const SEQ_STACCO_MS = 4200;
// 3900 e non 3400: con sei piloti il conteggio delle posizioni risultava
// "leggermente veloce" al playtest. Gli scatti sono pochi e la curva li
// comprime tutti all'inizio, quindi serve piu' corsa per farli leggere.
const SEQ_POSIZIONE_MS = 3900;
const SEQ_POLE_EXTRA_MS = 1000;   // quanto in più resta a schermo la scoperta della pole
// 10000 e non 7000: al playtest il riepilogo con la griglia e il modello
// dell'auto in pole risultava troppo corto per guardarlo davvero ("io farei
// durare questa schermata qualche secondino in piu'"). E' anche il momento
// che sta piu' comodo ad allungarsi: e' l'ultimo prima del semaforo, quindi
// il tempo in piu' va tutto a chi carica ancora qualcosa.
const SEQ_GRIGLIA_MS = 10000;
const GRID_DISPLAY_MS = SEQ_STACCO_MS + SEQ_POSIZIONE_MS + SEQ_POLE_EXTRA_MS + SEQ_GRIGLIA_MS;
// Finestra di grazia di fine qualifica (Rif. design 2026-08-07): quando
// tutti gli umani connessi finiscono, la sessione NON chiude subito — resta
// aperta fino a QUALI_GRACE_MS in più (o finché anche i bot finiscono,
// quello che avviene prima), dando ai bot ancora in pista una possibilità
// reale di tagliare il traguardo invece di ricevere quasi sempre un tempo
// stimato (vedi estimateFinishTime in endQualifying). Stesso valore di
// GRID_DISPLAY_MS non per necessità tecnica, solo perché è già il tempo a
// cui i giocatori sono abituati tra una fase e l'altra.
const QUALI_GRACE_MS = 8000;
const QUALI_GRACE_TICKS = Math.round(QUALI_GRACE_MS / PHYSICS_TICK_MS);
// Stessa idea per la GARA, con una finestra piu' lunga perche' i distacchi di
// fine gara sono piu' larghi di quelli di un giro secco. Misurato con una
// gara di soli bot: fra il primo e l'ultimo arrivato passano 76 secondi su
// "prova" (5 giri) e 6 su monte-rosso (4 giri). Trenta secondi non bastano a
// prendere tutti sulle piste lunghe — ne' devono: chi resta fuori e' comunque
// in classifica, con la posizione esatta e il tempo proiettato dal suo ritmo.
// Chi non vuole aspettare chiude prima (evento f1ChiudiGara).
const RACE_GRACE_MS = 30000;
const RACE_GRACE_TICKS = Math.round(RACE_GRACE_MS / PHYSICS_TICK_MS);
// Il normale flusso qualifica->griglia->gara ha già una pausa naturale
// (GRID_DISPLAY_MS) tra la fine di una sessione e l'inizio della prossima,
// tempo per staccare il piede dall'acceleratore. "Riprova" (modalità
// singola) invece incatenava resetPlayers/assignGridSpawns e il semaforo
// nello stesso istante, senza alcuna pausa: chi finiva la gara tenendo
// premuto l'acceleratore lo teneva ancora premuto un attimo dopo — falsa
// partenza "vera" secondo la regola, ma percepita come un bug perché non
// c'era mai stato un momento naturale per rilasciare il tasto.
const RESTART_GRACE_MS = 1500;
// Quanto resta a schermo il podio di fine gara in multiplayer prima che il
// client torni da solo in lobby. Il numero sta QUI e viaggia dentro l'evento
// f1RaceEnded: il conto alla rovescia del client lo legge da lì, così non
// esistono due copie che possono divergere.
// ── Premiazione di fine gara ────────────────────────────────────────────
// Stesso schema della sequenza qualifica→gara: le durate stanno qui, il
// client le riceve dentro f1RaceEnded e non ne tiene una copia.
//
// Lo stacco è lo stesso della transizione in griglia (F1Sting): copre il
// salto dalla pista alla premiazione, che altrimenti sarebbe brusco esattamente
// come lo era quello di prima della gara.
const CER_STACCO_MS = 4200;
// Quanto resta a schermo la premiazione vera: podio, le tre auto e la
// classifica finale. Da qui si torna in lobby, col pulsante o lasciando
// scadere il tempo.
const CER_SCENA_MS = 15000;
const RACE_END_RETURN_MS = CER_STACCO_MS + CER_SCENA_MS;
// Margine oltre il rientro prima che il server smonti la partita: al client
// serve il tempo di navigare via, non di essere sfrattato mentre guarda il
// podio.
const RACE_END_TEARDOWN_MS = 2000;

const PIT_AUTO_SPEED = 1.55;   // unità/tick dell'autopilota lungo il percorso box (25% di MAX_SPEED)
const PIT_AUTO_ARRIVE_DIST = 1.0;   // sotto questa distanza dal waypoint, "arrivato"
// Quanti campioni della corsia avanti al proprio box far rientrare l'auto in
// uscita dallo stallo (~10 unità con 300 campioni sulle corsie esistenti).
// Rientrare sul campione del box stesso la rimetterebbe in corsia di traverso,
// ferma davanti al proprio garage.
const PIT_REJOIN_LEAD_SAMPLES = 10;

// Rettangolo orientabile (x,z,halfWidth,halfLength,angle) invece del
// vecchio riquadro assi-allineato: funziona per un rettilineo box con
// qualunque orientamento nel mondo, non solo quelli allineati a X o Z
// (Rif. richiesta utente 2026-08-08, editor trigger orientabile).
function inPitEntryZone(p, track) {
    if (TrackGeometry.pointInOrientedBox(p.x, p.z, track.pitEntryTrigger)) return true;
    return nellaCorsiaBox(p, track);
}

// Frazione INIZIALE della corsia box che vale come "sto entrando": oltre ci
// sono i box e poi l'uscita, che rientra sul nastro — riconoscere lì un
// ingresso rimetterebbe ai box chi ne sta uscendo.
const PIT_ENTRY_LANE_FRACTION = 0.25;

// Rete di sicurezza geometrica: l'auto ha lasciato il nastro ed è dentro la
// corsia box. Allora sta entrando ai box, comunque sia posato il riquadro.
//
// Serve perché il riquadro lo si piazza a mano nell'editor e può finire dove
// non lo prende nessuno: su monte-rosso sta nel vuoto fra bordo pista e
// corsia (7.1 unità dalla corsia, 5.7 dal nastro) e su quella pista NESSUNO
// poteva fermarsi ai box — con in più i 30 secondi di penalità a fine gara
// per non averlo fatto. Le due condizioni insieme (fuori dal nastro E dentro
// la corsia) non possono scattare guidando in pista: c'è un test che le
// prova su tutti e mille i campioni di ogni tracciato.
function nellaCorsiaBox(p, track) {
    const pl = track.pitLanePts;
    if (!pl || !pl.length || !track.pitRoadHalf) return false;
    const finestra = Math.min(pl.length - 1, Math.max(2, Math.floor(pl.length * PIT_ENTRY_LANE_FRACTION)));
    let vicino = Infinity;
    // Dal campione 1: lo 0 è agganciato al BORDO PISTA (snapPitEndpoint), chi
    // passa lì sta ancora correndo.
    for (let i = 1; i <= finestra; i++) {
        const s = pl[i];
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < vicino) vicino = d;
    }
    if (vicino > track.pitRoadHalf) return false;
    return TrackGeometry.nearestPoint(track.points, p.x, p.z).dist > track.roadHalf;
}

// Tempo per scegliere prima che scatti la mescola di default. Da 20s a 45s il
// 2026-08-17: la schermata mostra un carosello di sei inquadrature del
// circuito da ~5s l'una, e in venti secondi non se ne vedeva nemmeno metà.
// Non è un'attesa imposta a nessuno — appena tutti confermano si parte (vedi
// f1TyreChoice); è solo il tetto per chi resta fermo.
const TYRE_SELECT_MS = 45000;

// ====================================================
// MINIGIOCO DI REAZIONE AL PIT STOP
// Il server è autoritativo sul tempo di reazione (misura dal proprio invio
// del segnale "vai" alla ricezione della pressione — include la latenza di
// rete, limite accettato). Premere prima del segnale = falsa partenza, sosta
// alla durata massima.
// ====================================================
// Il gioco di reazione ai box è agganciato a un PUNTO DELLO SPAZIO, non più a
// un'attesa casuale a macchina ferma: mentre l'autopilota porta l'auto verso lo
// stallo, poco prima del punto in cui comincia a sterzare, compare un
// indicatore sull'asfalto della corsia. Tre esiti discreti — perfetta, buona,
// lenta — e non una scala continua: sono più facili da spiegare nel tutorial e
// da leggere in gara (scelta dell'utente, 2026-08-19). Dove cade la zona lo
// decide f1BoxIngresso.js, che è lo stesso modulo che disegna la traiettoria:
// se fossero due calcoli diversi potrebbero scostarsi in silenzio.
const PIT_DURATA_PERFETTA = 2000;
const PIT_DURATA_BUONA = 2600;
const PIT_DURATA_LENTA = 3400;

// Quanto si compensa il ritardo di rete sulla pressione. Il giocatore preme
// guardando DOVE È l'auto sul suo schermo; quando il messaggio arriva, qui
// l'auto è già avanzata. A 31 unità al secondo, 100 ms sono 3 unità: metà della
// fascia "perfetta". Si usa il tempo di gara che il client ha già (elapsedMs,
// la stessa fonte del cronometro), non un timestamp locale che non sarebbe
// confrontabile. Il tetto evita che un client con l'orologio sballato si
// regali un vantaggio.
const PIT_LATENZA_MAX_MS = 300;
// 2.0s-3.0s: range realistico da gioco F1 (richiesto dall'utente, che
// trovava 3.0s-7.0s troppo lento anche a reazione ottima).
const PIT_PENALTY_MS = 30000;   // penalità se non si fa MAI pit stop in gara (regola F1 vera)
const REPAIR_MS_PER_DAMAGE_PCT = 150;   // ms extra di sosta per ogni % di danno riparato

// Semaforo di partenza (solo gara, mai in qualifica): 5 luci, una ogni
// LIGHT_INTERVAL_MS, poi un'attesa casuale prima che si spengano tutte
// insieme = via (come in F1 vera — l'attesa casuale impedisce di "contare"
// il ritmo e accelerare a colpo sicuro).
const LIGHT_COUNT = 5;
const LIGHT_INTERVAL_MS = 1000;
const LIGHTS_ALL_ON_MS = (LIGHT_COUNT - 1) * LIGHT_INTERVAL_MS;   // 4000: tutte accese
const HOLD_MIN_MS = 200, HOLD_MAX_MS = 3000;
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
            // Timbro della sessione: cambia ad OGNI avvio dalla lobby. È ciò
            // che permette a joinF1Game di distinguere "sto rientrando nella
            // partita in corso dopo un F5" da "sto cominciando la gara nuova
            // che l'host ha appena avviato" — due casi che arrivano come lo
            // stesso identico evento (vedi il commento là).
            lobby.sessioneF1 = (lobby.sessioneF1 || 0) + 1;
        }
        io.to(lobbyId).emit('gameSelected', { gameId, settings });
    });

    socket.on('joinF1Game', ({ lobbyId, playerColor: coloreDichiarato, uid, token }) => {
        // Chi sei: o questo socket è già stato riconosciuto in lobby
        // (`joinLobby` col gettone di sessione, che la pagina emette sempre
        // subito prima di questo), oppure lo dimostra qui presentando lo
        // stesso gettone.
        //
        // Il colore scritto nel messaggio, da solo, non vale più niente.
        // Prima invece finiva dritto in `socket.color`: bastava dichiararsi
        // del colore dell'host per scavalcare ogni controllo fatto in lobby e
        // poi chiudere la gara a tutti.
        if (!(socket.color && socket.lobbyId === lobbyId)) {
            if (!verificaGettone(lobbyId, coloreDichiarato, token)) {
                console.warn(`🚫 joinF1Game senza sessione valida (socket ${socket.id}, lobby ${lobbyId})`);
                return;
            }
            socket.color = coloreDichiarato;
            socket.lobbyId = lobbyId;
        }
        const playerColor = socket.color;
        socket.join(lobbyId);
        // Marca QUESTO socket come partecipante reale alla gara. Serve al guard
        // del disconnect qui sotto per distinguerlo dai vecchi socket-lobby.
        socket.data.joinedF1 = true;

        // Una partita di una sessione PRECEDENTE non si riusa mai.
        //
        // La chiusura automatica di fine gara copre solo le sessioni che
        // finiscono. Chi abbandona a metà — F5, tasto indietro, torna in
        // lobby a mano — lascia la partita viva per tutta la grazia di
        // riconnessione (60 s), ed è giusto: serve proprio a rientrare senza
        // perdere posizione e giro. Ma la gara SUCCESSIVA se la ritrovava
        // davanti e ci rientrava dentro invece di crearne una nuova.
        // Segnalato in playtest: il client caricava "prova" e il server
        // continuava a simulare "monte-rosso" — l'auto compariva nel verde,
        // il pannello "qualifica completata, in attesa degli altri piloti"
        // non spariva più (era la grazia della qualifica precedente) e non ci
        // si poteva muovere, perché lato server quel pilota era già arrivato.
        //
        // Il criterio non è come è finita la sessione prima (i modi di
        // abbandonare sono infiniti), ma da quale sessione arriva chi entra.
        {
            const lobby = lobbies.get(lobbyId);
            const sessione = lobby ? (lobby.sessioneF1 || 0) : 0;
            const precedente = activeGames.get(lobbyId);
            if (precedente && precedente.gameId === 'f1' && precedente.sessione !== sessione) {
                console.log(`♻️ [F1] Sessione ${precedente.sessione} sostituita dalla ${sessione} (lobby ${lobbyId})`);
                chiudiPartita(io, lobbyId);
            }
        }

        if (!activeGames.has(lobbyId)) {
            const lobby = lobbies.get(lobbyId);
            const trackId = (lobby && lobby.gameSettings && lobby.gameSettings.trackId) || 'monte-rosso';
            let track;
            try {
                track = loadTrack(trackId);
            } catch (err) {
                console.error(`joinF1Game: impossibile caricare la pista "${trackId}", fallback a "monte-rosso":`, err);
                track = loadTrack('monte-rosso');
            }
            activeGames.set(lobbyId, {
                gameId: 'f1',   // marca il tipo: gli handler condivisi (disconnect) NON devono toccare partite di altri giochi
                // Da quale avvio dalla lobby nasce questa partita (vedi sopra).
                sessione: lobby ? (lobby.sessioneF1 || 0) : 0,
                track: track,
                phase: 'tyre_select',   // tyre_select -> qualifying -> grid_display -> race -> race_end
                players: {},
                socketByColor: {},   // color -> socket.id CORRENTE, per gli emit personalizzati in qualifica
                tick: null,
                raceStarted: false,
                raceEnded: false,
                raceStartTime: null,
                // Tempo di gara "vero" contato in tick fisici, non con
                // Date.now() — Rif. docs/f1-notes.md: setInterval(50ms) non
                // scatta mai con precisione perfetta, quindi Date.now() -
                // raceStartTime gonfia il tempo mostrato rispetto a quello
                // che la fisica ha realmente simulato (misurato: ~27% in più
                // su questa macchina). raceTick * PHYSICS_TICK_MS combacia
                // ESATTAMENTE con backend/tools/f1LapSimulator.js, che conta
                // tick allo stesso modo — necessario perché i tempi umani
                // registrati in game reale siano confrontabili col tempo bot
                // calcolato offline (Rif. Task 11 del piano F1 bot Fase 1).
                raceTick: 0,
                lastGapRecalc: 0,      // timestamp ultimo ricalcolo distacco dal leader (vedi GAP_RECALC_MS)
                endTimeout: null,
                qualiEnded: false,
                qualiEndTimeout: null,   // timer di sicurezza: dà agli altri il tempo di finire il giro se qualcuno resta molto indietro
                tyreSelectTimeout: null,
                tyreConfirmed: new Set(),   // color di chi ha già scelto/confermato la mescola
                // Piloti che questa partita ASPETTA: la fotografia della lobby
                // scattata da startGame, la stessa fonte che createBots usa già
                // per sapere quanti bot servono. Senza, la fase di scelta
                // mescola contava solo i collegati e partiva appena il più
                // veloce confermava — chi stava ancora caricando la pista si
                // ritrovava in qualifica senza aver scelto (bug con due schede).
                attesiAllaPartenza: ((lobby && (lobby.lockedPlayers || lobby.players)) || [playerColor]).slice(),
                // Quanti piloti in tutto, scelto in lobby. Sta sulla PARTITA e
                // non si rilegge dalle impostazioni ad ogni uso: la lobby puo'
                // cambiare mentre la gara e' in corso.
                gridSize: Math.min(20, Math.max(1, parseInt(
                    (lobby && lobby.gameSettings && lobby.gameSettings.gridSize), 10) || 6)),
                grid: null,   // ordine di partenza determinato dalla qualifica (array di colori)
                hostColor: lobby ? lobby.host : playerColor,
                settings: lobby ? (lobby.gameSettings || {}) : {},
                rejoinTimers: {},   // color -> timeout di rimozione definitiva dopo un drop
                // Disattiva trajectoryDiagnostics + p._botDebug in updateBotInputs
                // (f1Bot.js): telemetria IA usata SOLO dal banco prova
                // (f1Testbench.js, che imposta il proprio game senza questo
                // campo e quindi resta al default "on"), mai dal client di
                // gioco vero. Costo reale su Render con più bot attivi
                // (scansione O(101) per bot per tick, sempre gratis prima
                // d'ora) per un dato che nessuno guardava in produzione.
                debugEnabled: false
            });

            // Riempie la griglia con bot fino a MAX_GRID_SIZE (6), se
            // abilitati in lobby (game.settings.botsEnabled, default on).
            // Fisso a questo momento: vedi commento su createBots.
            createBots(activeGames.get(lobbyId), lobby, TYRE_COMPOUNDS);
        }

        const game = activeGames.get(lobbyId);
        // In QUALE partita è entrato questo socket. Serve al disconnect qui
        // sotto: quando il socket muore, "la partita di questa lobby" può già
        // essere un'altra, e agire su quella significa agire su un pilota che
        // non è mai stato di questo socket.
        socket.data.f1Partita = game;
        const totalLaps = game.track.totalLaps;
        const isRejoin = !!game.players[playerColor];

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
            // Riaggiornato ad ogni rientro: nel frattempo l'utente potrebbe
            // essersi loggato (o disconnesso) rispetto al join precedente.
            game.players[playerColor].uid = uid || null;
        } else {
            game.players[playerColor] = {
                color: playerColor,
                uid: uid || null,   // uid Firebase (null per ospiti/bot) — vedi buildPublicState
                x: game.track.qualiSpawn.x,
                z: game.track.qualiSpawn.z,
                angle: game.track.qualiSpawn.angle,
                speed: 0,
                vx: 0,
                vz: 0,
                inputs: { throttle: 0, brake: 0, steer: 0 },
                finished: false,
                time: null,
                lap: 0,
                checkpointA: false,
                inFinishZone: false,
                disconnected: false,
                trackIndex: 0,
                compound: null,   // scelto in tyre_select (null finché non conferma)
                tyreWear: 0,
                pitting: false,   // true = fermo ai box, fisica congelata
                pitEsito: null,    // 'perfetta' | 'buona' | 'lenta' — deciso lungo la corsia
                pitGoTime: null,    // timestamp server di invio del segnale "vai"
                pitGoTimer: null,
                pendingCompound: null,    // mescola scelta ai box, applicata a fine sosta
                hasPitted: false,   // per l'obbligo di almeno un pit stop in gara
                pitPenalty: false,   // true se ha preso la penalità per non aver fatto pit stop
                falseStart: false,   // true se ha accelerato mentre le luci erano accese (resta true per tutta la gara, indicatore storico)
                falseStartServed: false,  // true una volta scontata la penalità al primo pit stop
                gapToLeaderMs: null,    // stima distacco dal leader in ms, null per il leader stesso o prima del primo ricalcolo
                pitAutoState: null,    // 'entering' | 'exiting' | null — autopilota corsia box
                pitPathIndex: 0,       // prossimo waypoint del percorso box (track.pitPath) verso cui puntare
                inSlipstream: false,   // bonus di velocità in scia attivo in questo tick (solo effetto visivo lato client)
                damage: 0,       // 0-100, come tyreWear — solo in gara (vedi assignGridSpawns/checkLap). Derivato dal massimo dei 4 componenti di damageParts.
                damageParts: createDamageParts(),   // { frontWing, floor, engine, suspension }, 0-100 ciascuno — vedi DamageModel.js Cap. 3.8. Ri-creato ad ogni assignGridSpawns/repair ai box, mai condiviso per riferimento.
                collisionPenaltyMs: 0,       // penalità di tempo accumulata per collisioni causate, sommata a p.time al traguardo
                pendingRepair: false,   // scelta fatta ai box, applicata a fine sosta come pendingCompound
                carContacts: new Set(),   // colori con cui è ATTUALMENTE a contatto (rileva un urto NUOVO)
                wallContact: false,   // true se attualmente appoggiato a un muro ponte
                pendingCollisionPenaltyEvents: [],   // ms in attesa di notifica al client, drenata da tickGame
                pendingFinishTime: null,   // vedi checkLap/finalizeSessionFinish: ultimo giro chiuso mentre ancora in manovra ai box
            };
        }

        // La scadenza si (ri)arma PRIMA di rispondere: chi arriva deve
        // ricevere già in f1Setup quanto tempo ha, non scoprirlo al primo
        // aggiornamento successivo. E ri-armarla è ciò che dà al ritardatario
        // il suo tempo pieno invece degli avanzi di chi era già dentro.
        if (game.phase === 'tyre_select' && !isRejoin) armaScadenzaMescola(io, lobbyId, game);

        const scelteMescola = statoScelteMescola(game);
        socket.emit('f1Setup', {
            playerColor,
            hostColor: game.hostColor,
            trackName: game.track.name,
            totalLaps,
            phase: game.phase,
            grid: game.grid,
            raceStarted: game.raceStarted,
            elapsed: game.raceStarted ? (game.raceTick * PHYSICS_TICK_MS) : 0,
            players: buildPublicState(playersVisibleTo(game, playerColor), game.raceStarted, game.track, game),
            compounds: TYRE_COMPOUNDS,
            strategy: suggestStrategy(totalLaps),
            myCompound: game.players[playerColor].compound,
            tyreConfirmed: scelteMescola.count,
            tyreTotal: scelteMescola.total,
            // Chi la partita aspetta, chi è già arrivato e chi ha già scelto:
            // la schermata mescole li elenca, così un pilota vede che l'attesa
            // è di qualcun altro che sta ancora caricando e non della propria
            // connessione.
            tyreAttesi: scelteMescola.attesi,
            tyreArrivati: scelteMescola.arrivati,
            tyreConfermati: scelteMescola.confermati,
            tyreRestaMs: scelteMescola.restaMs,
        });

        // Un pilota è arrivato mentre gli altri erano già alla scelta: gli
        // altri client devono toglierlo dalla riga "in caricamento" e vedere
        // la scadenza aggiornata.
        if (game.phase === 'tyre_select' && !isRejoin) {
            // Il nuovo arrivato cambia l'ordine dei partecipanti, quindi i box
            // si riassegnano: altrimenti resterebbe senza il suo in anteprima.
            assegnaBoxProvvisori(game);
            io.to(lobbyId).emit('f1TyreConfirmed', scelteMescola);
        }

        // Tick e prima fase (scelta mescola) solo al primo giocatore
        if (!game.tick) {
            game.tick = setInterval(() => {
                const t0 = process.hrtime.bigint();
                tickGame(io, lobbyId, game);
                const ms = Number(process.hrtime.bigint() - t0) / 1e6;
                recordTickDuration(lobbyId, Object.keys(game.players).length, game.phase, ms);
            }, PHYSICS_TICK_MS);
            startTyreSelect(io, lobbyId, game);
        }
    });

    // Chiusura anticipata della finestra di cortesia di fine gara: chi ha
    // finito sta girando da fantasma in attesa dei bot e puo' decidere che
    // basta cosi'. Accettata solo a finestra aperta — cioe' quando tutti gli
    // umani hanno gia' tagliato il traguardo, quindi non c'e' modo di
    // troncare la gara di qualcun altro.
    socket.on('f1ChiudiGara', ({ lobbyId }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.raceEnded || !game.raceGraceEndTick) return;
        endRace(io, lobbyId, game);
    });

    // Scelta mescola (fase tyre_select). Se tutti hanno confermato si passa
    // subito alla qualifica, senza aspettare il timeout.
    socket.on('f1TyreChoice', ({ lobbyId, compound }) => {
        // Il colore non arriva dal messaggio: e' quello che il server ha
        // gia' verificato col gettone di sessione in joinLobby. Vedi il
        // commento in joinF1Game.
        const playerColor = socket.color;
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'tyre_select') return;
        if (!TYRE_COMPOUNDS[compound]) return;
        const p = game.players[playerColor];
        if (!p) return;

        p.compound = compound;
        game.tyreConfirmed.add(playerColor);

        io.to(lobbyId).emit('f1TyreConfirmed', Object.assign(
            { playerColor, compound }, statoScelteMescola(game)));

        if (tuttiHannoScelto(game)) {
            if (game.tyreSelectTimeout) { clearTimeout(game.tyreSelectTimeout); game.tyreSelectTimeout = null; }
            game.tyreSelectScadeA = null;
            startQualifying(io, lobbyId, game);
        }
    });

    // Pressione del minigioco di reazione al pit stop. Il server è
    // autoritativo sul tempo (vedi handlePitReactionPress): il client si
    // limita a inoltrare l'evento appena l'utente preme.
    socket.on('f1PitReactionPress', ({ lobbyId, elapsedMs }) => {
        // Il colore non arriva dal messaggio: e' quello che il server ha
        // gia' verificato col gettone di sessione in joinLobby. Vedi il
        // commento in joinF1Game.
        const playerColor = socket.color;
        const game = activeGames.get(lobbyId);
        if (!game) return;
        const p = game.players[playerColor];
        if (!p) return;
        handlePitReactionPress(io, lobbyId, game, p);
    });

    // Cambio mescola durante la sosta ai box: applicata a fine sosta
    // (completePitStop), non subito — non ha senso montare gomme diverse
    // mentre l'auto è ancora sollevata dal cric.
    socket.on('f1PitCompoundChoice', ({ lobbyId, compound }) => {
        // Il colore non arriva dal messaggio: e' quello che il server ha
        // gia' verificato col gettone di sessione in joinLobby. Vedi il
        // commento in joinF1Game.
        const playerColor = socket.color;
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
    socket.on('f1PitRepairChoice', ({ lobbyId, repair }) => {
        // Il colore non arriva dal messaggio: e' quello che il server ha
        // gia' verificato col gettone di sessione in joinLobby. Vedi il
        // commento in joinF1Game.
        const playerColor = socket.color;
        const game = activeGames.get(lobbyId);
        if (!game) return;
        const p = game.players[playerColor];
        if (!p || (!p.pitting && !p.pitAutoState)) return;
        p.pendingRepair = !!repair;
    });

    socket.on('f1Input', ({ lobbyId, inputs }) => {
        // Il colore non arriva dal messaggio: e' quello che il server ha
        // gia' verificato col gettone di sessione in joinLobby. Vedi il
        // commento in joinF1Game.
        const playerColor = socket.color;
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
        // Chi ha finito continua a guidare fino a fine sessione, quindi i
        // suoi comandi valgono ancora. Restano ignorati SOLO a sessione
        // chiusa: il client continua a inviare finché non arriva la sessione
        // successiva (isRacing si azzera con f1Countdown/f1RaceEnded, non al
        // proprio traguardo), e un acceleratore tenuto premuto durante
        // l'attesa veniva letto come falsa partenza al via dopo — bug reale.
        // startRaceCountdown azzera comunque gli input di tutti prima di
        // aprire la finestra di rilevamento.
        // La sessione CORRENTE, non una qualsiasi: `qualiEnded` resta vero
        // per tutta la gara — la qualifica È finita — quindi guardarlo in gara
        // buttava via ogni comando e l'auto non partiva ai semafori spenti
        // (regressione trovata al playtest subito dopo).
        const sessioneChiusa = game.phase === 'race' ? game.raceEnded : game.qualiEnded;
        if (sessioneChiusa) return;
        // Clamp qui perché arriva dal client (analogico, valori liberi):
        // la fisica sotto assume i range dichiarati.
        game.players[playerColor].inputs = {
            throttle: Math.max(0, Math.min(1, Number(inputs.throttle) || 0)),
            brake: Math.max(0, Math.min(1, Number(inputs.brake) || 0)),
            steer: Math.max(-1, Math.min(1, Number(inputs.steer) || 0)),
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
            if (!ancoraViva(lobbyId, game)) return;
            startRaceCountdown(io, lobbyId, game);
        }, RESTART_GRACE_MS);
    });

    socket.on('f1ReturnToLobby', (lobbyId) => {
        const game = activeGames.get(lobbyId);
        if (game && game.gameId !== 'f1') return;   // la partita attiva è di un altro gioco
        chiudiPartita(io, lobbyId);
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
        // Guard 3 (identità): la partita di questa lobby dev'essere ANCORA
        // quella in cui il socket era entrato. Tornare in lobby e ripartire
        // subito — col tasto invio, senza aspettare la finestra di cortesia —
        // fa arrivare questa disconnessione DOPO che la gara nuova è già
        // nata. Senza il controllo, il gestore marcava disconnesso il pilota
        // VIVO (che così smetteva di contare per la chiusura della qualifica:
        // il pannello "in attesa degli altri piloti" non spariva più) e gli
        // armava addosso il timer di rimozione definitiva, che un minuto dopo
        // lo cancellava dalla partita in corso — l'auto si bloccava e il
        // terminale stampava "grazia scaduta". Segnalato in playtest.
        if (socket.data.f1Partita && socket.data.f1Partita !== game) return;
        const p = game.players[color];
        if (!p) return;   // già rimosso definitivamente

        p.disconnected = true;
        p.inputs = { throttle: 0, brake: 0, steer: 0 };

        if (!game.rejoinTimers) game.rejoinTimers = {};
        if (game.rejoinTimers[color]) clearTimeout(game.rejoinTimers[color]);
        console.log(`🔌 [F1] ${color} disconnesso (lobby ${lobbyId}) — grazia ${REJOIN_GRACE / 1000}s`);
        game.rejoinTimers[color] = setTimeout(() => {
            delete game.rejoinTimers[color];
            console.log(`🗑 [F1] grazia scaduta per ${color} → rimozione definitiva`);
            hardRemoveF1Player(io, lobbyId, color);
        }, REJOIN_GRACE);
    });
};

// Un callback differito deve ritrovare LA STESSA partita, non una qualsiasi.
//
// Tutti i timer di fase controllavano solo che una partita esistesse. Ora che
// avviare una gara dalla lobby chiude e rifà la partita, quel controllo non
// basta più: bastava che l'host riavviasse entro la finestra della griglia
// (8 s) e il timer della sessione morta spingeva in fase 'race' la partita
// NUOVA, mentre i piloti stavano ancora scegliendo le gomme.
function ancoraViva(lobbyId, game) {
    return activeGames.get(lobbyId) === game;
}

// ====================================================
// CHIUSURA DELLA PARTITA
// ====================================================
// Unico punto in cui una partita F1 viene smontata: ferma il tick, disarma
// ogni timer e la toglie dagli store. Ci passano sia il pulsante "Torna alla
// Lobby" (modalità singola) sia la chiusura automatica di fine gara. È
// idempotente: chiamarla su una lobby senza partita non fa nulla.
//
// Perché serve una chiusura automatica: in multiplayer il podio riporta in
// lobby da solo con un window.location.href, e il client non dice niente al
// server. Senza questa chiamata la partita conclusa restava in activeGames,
// e il joinF1Game della gara successiva la ritrovava lì invece di crearne
// una nuova — tutti rientravano nella gara finita, sulla pista vecchia.
function chiudiPartita(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Chi se n'era già andato PRIMA della bandiera a scacchi non tornerà in
    // lobby: va tolto dalla lista, altrimenti resta come fantasma fra i
    // partecipanti della gara dopo. Finora ci pensava il timer di grazia, che
    // qui sotto viene disarmato. Chi invece si è disconnesso DOPO la fine non
    // va toccato: quello è il rientro in lobby, il client naviga via e il
    // socket muore, ma la persona è seduta in lobby proprio adesso.
    for (const color of game.abbandoniPrimaDellaFine || []) {
        if (game.rejoinTimers && game.rejoinTimers[color]) {
            clearTimeout(game.rejoinTimers[color]);
            delete game.rejoinTimers[color];
        }
        hardRemoveF1Player(io, lobbyId, color);
    }

    clearInterval(game.tick);
    if (game.endTimeout) clearTimeout(game.endTimeout);
    if (game.qualiEndTimeout) clearTimeout(game.qualiEndTimeout);
    if (game.tyreSelectTimeout) clearTimeout(game.tyreSelectTimeout);
    if (game.chiusuraTimeout) clearTimeout(game.chiusuraTimeout);
    if (game.rejoinTimers) Object.values(game.rejoinTimers).forEach(clearTimeout);
    activeGames.delete(lobbyId);
    tickPerfStats.delete(lobbyId);
}

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
            lobby.host = lobby.players[0];
            game.hostColor = lobby.host;
            io.to(lobbyId).emit('message', {
                message: `👑 ${lobby.host} è il nuovo Host della stanza!`,
                type: 'system'
            });
            io.to(lobbyId).emit('lobbyUpdated', { players: lobby.players, host: lobby.host });
        }
    }

    // Anche a zero UMANI (bot esclusi) la partita va chiusa: i bot non
    // vengono mai rimossi da qui, quindi senza questo controllo una lobby
    // abbandonata (ultimo umano rimosso a grazia scaduta, solo bot rimasti)
    // continuava a ticchettare per sempre a 20Hz — CPU sprecata su Render
    // finché non si riavviava il server, anche con zero client connessi.
    const noHumansLeft = !Object.values(game.players).some(p => !p.isBot);
    if (Object.keys(game.players).length === 0 || noHumansLeft) {
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
// Piloti attesi che non hanno ancora completato joinF1Game: stanno ancora
// caricando la pista (qualche secondo, vedi la schermata di caricamento lato
// client). I bot non compaiono qui — nascono già dentro game.players.
function pilotiMancanti(game) {
    return (game.attesiAllaPartenza || []).filter(c => !game.players[c]);
}

// Si passa alla qualifica solo se sono arrivati TUTTI e hanno TUTTI scelto.
// La seconda condizione da sola faceva partire la gara appena il più veloce
// confermava, perché chi non si era ancora collegato non era contato.
function tuttiHannoScelto(game) {
    return pilotiMancanti(game).length === 0
        && game.tyreConfirmed.size >= Object.keys(game.players).length;
}

// Riepilogo mostrato nella schermata di scelta mescola: le tre liste sono
// ristrette ai piloti attesi (umani), così il client può disegnare una riga
// per ciascuno e dire chi sta ancora caricando. `total` include i mancanti,
// altrimenti "1/1 pronti" mentirebbe mentre un pilota deve ancora arrivare.
function statoScelteMescola(game) {
    const attesi = (game.attesiAllaPartenza || []).slice();
    return {
        count: game.tyreConfirmed.size,
        total: Object.keys(game.players).length + pilotiMancanti(game).length,
        attesi,
        arrivati: attesi.filter(c => !!game.players[c]),
        confermati: attesi.filter(c => game.tyreConfirmed.has(c)),
        // Quanto manca alla partenza d'ufficio. Si manda il RESIDUO e non
        // l'istante di scadenza: l'orologio del client non è quello del
        // server, e una differenza di qualche secondo fra i due farebbe
        // partire il conto alla rovescia da un numero sbagliato.
        restaMs: game.tyreSelectScadeA ? Math.max(0, game.tyreSelectScadeA - Date.now()) : null,
    };
}

// Scadenza di sicurezza: chi non sceglie (o non arriva) entro TYRE_SELECT_MS
// non può bloccare la gara. Ri-armabile: ogni nuovo arrivo la sposta in
// avanti, così il ritardatario ha il suo tempo pieno per scegliere invece
// degli avanzi del tempo consumato dagli altri mentre caricava.
function armaScadenzaMescola(io, lobbyId, game) {
    if (game.tyreSelectTimeout) clearTimeout(game.tyreSelectTimeout);
    game.tyreSelectScadeA = Date.now() + TYRE_SELECT_MS;
    game.tyreSelectTimeout = setTimeout(() => {
        if (!ancoraViva(lobbyId, game) || game.phase !== 'tyre_select') return;
        const g = game;
        for (const p of Object.values(g.players)) {
            if (!p.compound) p.compound = DEFAULT_COMPOUND;
        }
        g.tyreSelectTimeout = null;
        g.tyreSelectScadeA = null;
        startQualifying(io, lobbyId, g);
    }, TYRE_SELECT_MS);
}

// I box colorati dei piloti, assegnati per ORDINE ATTUALE dei partecipanti.
// Chiamata gia' durante la scelta mescola e non piu' solo all'inizio della
// qualifica: l'anteprima del circuito mostra la corsia box, e senza questi il
// giocatore vedeva i garage della scenografia ma nessun box colorato —
// segnalato in playtest ("nella preview i box non vengono ancora
// renderizzati, poi in gioco ci sono").
//
// Sono PROVVISORI: startQualifying li ricalcola sull'ordine definitivo. Qui
// servono solo a far vedere qualcosa di giusto in anteprima.
function assegnaBoxProvvisori(game) {
    const ordine = Object.keys(game.players);
    if (!ordine.length || !game.track.pitPath) return;
    const anchors = TrackGeometry.pitBoxAnchors(
        game.track.pitPath, game.track.pitBoxIndex, ordine.length,
        game.track.points, game.track.pitRoadHalf
    );
    addLaneIndices(game.track, anchors);
    ordine.forEach((color, i) => {
        game.players[color].pitBoxAnchor = anchors[i];
        game.players[color].pitBoxSlot = i;
    });
}

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

    assegnaBoxProvvisori(game);
    armaScadenzaMescola(io, lobbyId, game);
}

// ====================================================
// FASI: QUALIFICA (tutti in pista IN PARALLELO, ma isolati: vedi
// playersVisibleTo — ognuno vede solo la propria auto, nessuno quelle
// altrui) → GRIGLIA → GARA
// ====================================================
function startQualifying(io, lobbyId, game) {
    game.phase = 'qualifying';
    game.qualiEnded = false;
    game.qualiGraceEndTick = null;
    game.qualiLastWaitingFinished = null;
    game.raceStarted = false;
    // Tutti allo stesso identico punto (vedi game.track.qualiSpawn), a
    // prescindere da dove fossero prima (già impostato alla creazione, ma qui
    // è garantito anche per chi era entrato con uno stato diverso).
    game.bestSectorTimes = [Infinity, Infinity, Infinity];
    // Box visibili anche in qualifica, per coerenza visiva (Rif. richiesta
    // utente 2026-08-07: "i box in qualifica non funzionano" — p.pitBoxAnchor
    // non veniva mai assegnato prima della fine qualifica/assignGridSpawns,
    // quindi il client non aveva nulla da renderizzare). Nessun pit stop
    // reale può avvenire in qualifica (giro secco, inPitEntryZone è già
    // gated su game.phase==='race' in tickGame) — questo ordine è quindi
    // puramente estetico, NON la griglia di partenza vera (quella si
    // calcola solo a fine qualifica, in endQualifying → assignGridSpawns,
    // che sovrascrive questi anchor con quelli reali all'inizio della gara).
    const qualiOrder = Object.keys(game.players);
    const qualiBoxAnchors = TrackGeometry.pitBoxAnchors(
        game.track.pitPath, game.track.pitBoxIndex, qualiOrder.length,
        game.track.points, game.track.pitRoadHalf
    );
    addLaneIndices(game.track, qualiBoxAnchors);
    qualiOrder.forEach((color, i) => {
        game.players[color].pitBoxAnchor = qualiBoxAnchors[i];
        game.players[color].pitBoxSlot = i;
    });
    for (const p of Object.values(game.players)) {
        p.x = game.track.qualiSpawn.x; p.z = game.track.qualiSpawn.z; p.angle = game.track.qualiSpawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.curLapCurve = null; p.prevLapCurve = null;
        p.curLapSectorTimes = [null, null, null]; p.prevLapSectorTimes = null;
        p.deltaToPreviousLapMs = null; p.lapTrulyStarted = false;
        p.lapRecapSectorTimes = null; p.lapRecapExpiresAtMs = null;
        p.pendingFinishTime = null;
        p.trackIndex = 0;
    }
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'QUALIFICA — 1 GIRO', phase: 'qualifying' });
    setTimeout(() => {
        if (!ancoraViva(lobbyId, game)) return;
        const g = game;
        g.raceStarted = true;
        g.raceStartTime = Date.now();
        g.raceTick = 0;
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
            const elapsed = game.raceTick * PHYSICS_TICK_MS;
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
    // `uid` serve al riepilogo: il client lo usa per chiedere la livrea
    // personalizzata di chi ha fatto la pole e mostrarne il modello vero.
    // null per bot e ospiti, come ovunque.
    const qualiTimes = ranked.map(p => ({
        color: p.color, time: p.time, uid: p.uid || null, isBot: !!p.isBot,
    }));

    game.phase = 'grid_display';
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
        grid: qualiTimes,
        trackName: game.track.name,
        // Tempi della sequenza, decisi dal server (vedi le costanti SEQ_*):
        // il client ci scandisce stacco, scoperta e riepilogo invece di
        // tenerne una copia propria.
        sequenza: {
            staccoMs: SEQ_STACCO_MS,
            posizioneMs: SEQ_POSIZIONE_MS,
            poleExtraMs: SEQ_POLE_EXTRA_MS,
            grigliaMs: SEQ_GRIGLIA_MS,
            totaleMs: GRID_DISPLAY_MS,
        },
    });

    setTimeout(() => {
        if (!ancoraViva(lobbyId, game)) return;
        startRaceCountdown(io, lobbyId, game);
    }, GRID_DISPLAY_MS);
}

function startRaceCountdown(io, lobbyId, game) {
    game.phase = 'race';
    game.raceEnded = false;
    game.raceStarted = false;
    game.raceStartTime = null;
    game.raceTick = 0;
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
    const holdMs = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    const totalMs = LIGHTS_ALL_ON_MS + holdMs;

    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'GARA', phase: 'race' });

    setTimeout(() => {
        if (!ancoraViva(lobbyId, game)) return;
        const g = game;
        g.lightsSequenceActive = false;
        g.raceStarted = true;
        g.raceStartTime = Date.now();
        g.raceTick = 0;
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
    // Un box giocatore per partecipante (vedi TrackGeometry.pitBoxAnchors +
    // docs/superpowers/specs/2026-08-03-f1-pit-boxes-design.md): calcolato
    // una volta per gara, sullo stesso ordine di griglia usato per lo
    // spawn, così due piloti ai box insieme non finiscono più nello stesso
    // punto fisico (prima: tutti su track.pitBoxIndex).
    const boxAnchors = TrackGeometry.pitBoxAnchors(
        game.track.pitPath, game.track.pitBoxIndex, order.length,
        game.track.points, game.track.pitRoadHalf
    );
    addLaneIndices(game.track, boxAnchors);
    game.bestSectorTimes = [Infinity, Infinity, Infinity];
    order.forEach((color, i) => {
        const p = game.players[color];
        if (!p) return;
        const spawn = game.track.gridSpawnPoint(i);
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.curLapCurve = null; p.prevLapCurve = null;
        p.curLapSectorTimes = [null, null, null]; p.prevLapSectorTimes = null;
        p.deltaToPreviousLapMs = null; p.lapTrulyStarted = false;
        p.lapRecapSectorTimes = null; p.lapRecapExpiresAtMs = null;
        p.pendingFinishTime = null;
        // L'indice VERO dello schieramento, non 0: vedi il commento in
        // TrackGeometry.gridSpawnPoint. Dichiarando 0 mentre l'auto sta al
        // campione 41 (monte-rosso), la fisica cercava il punto pista attorno
        // a quello sbagliato e il muro spingeva l'auto di lato al primo tick
        // di gara — misurato, 11.6 unità.
        p.trackIndex = spawn.index || 0;
        p.tyreWear = 0;   // gomme fresche per la gara vera (l'usura conta solo in gara, non in qualifica)
        p.damage = 0;   // auto perfetta a inizio gara vera — stesso confine di tyreWear
        p.damageParts = createDamageParts();   // fresco ad ogni gara — mai riutilizzare l'oggetto precedente
        p.collisionPenaltyMs = 0;
        p.pendingRepair = false;
        p.carContacts.clear();
        p.wallContact = false;
        p.pendingCollisionPenaltyEvents.length = 0;
        if (p.pitGoTimer) { clearTimeout(p.pitGoTimer); p.pitGoTimer = null; }
        p.pitting = false; p.pitEsito = null;
        p.pendingCompound = null; p.hasPitted = false; p.pitPenalty = false;
        p.falseStart = false; p.falseStartServed = false;
        p.gapToLeaderMs = null;
        p.pitAutoState = null; p.pitPathIndex = 0; p.pitBoxFinalApproach = false;
        p.pitPiano = null; p.pitRimanente = null;
        // Box FISSO per tutta la sessione (Rif. richiesta utente
        // 2026-08-07: "la mappa in qualifica e in gara deve essere la
        // stessa" — prima il box "saltava" di slot tra qualifica e gara,
        // perché l'ordine qui è quello della griglia di partenza (risultato
        // qualifica) mentre in startQualifying è un ordine diverso,
        // puramente di lista giocatori). Se il pilota ha già un anchor
        // (assegnato in startQualifying), resta invariato — boxAnchors/i
        // sotto sono solo un fallback per chi ne fosse sprovvisto (es.
        // entrato a qualifica già in corso, mai passato da startQualifying
        // in questa sessione).
        if (!p.pitBoxAnchor) {
            p.pitBoxSlot = i;
            p.pitBoxAnchor = boxAnchors[i];
        }
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
// Indice di ciascun box sulla corsia CAMPIONATA (track.pitLanePts), dove
// cammina l'autopilota. anchor.fromIdx è un indice sui punti di CONTROLLO e
// resta valido solo per chi ragiona su quelli: le due numerazioni non sono
// intercambiabili. La posizione fisica degli anchor non cambia — è già stata
// verificata e approvata, qui si aggiunge solo il modo di raggiungerla.
function addLaneIndices(track, anchors) {
    if (!track.pitLanePts) return;   // fixture di test senza corsia campionata
    for (const a of anchors) {
        a.laneIdx = TrackGeometry.nearestPoint(track.pitLanePts, a.x, a.z).index;
    }
    // Quanto è spostato di lato lo stallo del vicino che si supera entrando: è
    // da lui che la traiettoria d'ingresso deve tenersi lontana, e senza
    // l'elenco completo dei box non lo si può sapere (vedi f1BoxIngresso.js).
    for (const a of anchors) {
        a.scostamentoVicini = BoxIngresso.scostamentoViciniPrecedenti(track.pitLanePts, a.laneIdx, anchors);
    }
}

// Il piano d'ingresso di un pilota: la forma della manovra e dove cade la zona
// dell'indicatore di reazione. Si calcola una volta sola, quando l'auto imbocca
// la corsia, e non cambia più.
function pianoIngressoDi(track, p) {
    const a = p.pitBoxAnchor;
    if (!track.pitLanePts || !a || a.laneIdx == null || a.stallX == null) return null;
    return BoxIngresso.pianoIngresso(track.pitLanePts, a.laneIdx,
        { x: a.stallX, z: a.stallZ }, { scostamentoVicini: a.scostamentoVicini });
}

function startPitLaneEntry(io, lobbyId, game, p) {
    p.pitAutoState = 'entering';
    p.pitPiano = pianoIngressoDi(game.track, p);
    p.pitRimanente = null;
    // L'autopilota riparte da DOVE L'AUTO È, non dall'imbocco della corsia.
    //
    // Prima puntava sempre al campione 1, ma il trigger d'ingresso non sta
    // sopra il campione 1: sta dove il tracciato lo mette. Misurato, la
    // distanza fra i due: 42.3 unità su prova, 41.4 su new-monza, 4.5 su
    // monte-rosso. L'auto entrava, tornava INDIETRO fino all'imbocco e solo
    // dopo ripartiva — segnalato in playtest, e presente da sempre; su
    // monte-rosso quasi non si notava proprio perché lì lo scarto è piccolo.
    //
    // +1 sul campione più vicino: si punta al successivo, non a quello su cui
    // si è già sopra, altrimenti il primo passo dell'autopilota non ha una
    // direzione in cui andare.
    const pl = game.track.pitLanePts;
    p.pitPathIndex = pl
        ? Math.min(pl.length - 1, TrackGeometry.nearestPoint(pl, p.x, p.z).index + 1)
        : 1;
    const sid = game.socketByColor[p.color];
    if (sid) {
        io.to(sid).emit('f1PitLaneEntered');
        // Dove piantare il muro del gioco di reazione: si manda una volta sola,
        // all'ingresso in corsia. È nel MONDO — il client ci costruisce il
        // pannello — ma la geometria la decide il server, che è anche chi
        // giudica: se il disegno venisse da un altro calcolo, si verrebbe
        // giudicati su un muro diverso da quello che si vede.
        if (p.pitPiano && game.track.pitLanePts) {
            io.to(sid).emit('f1PitIndicatore', Object.assign(
                BoxIngresso.muroReazione(game.track.pitLanePts, p.pitPiano),
                {
                    larghezza: (game.track.pitRoadHalf || 5) * 2,
                    // Il client ne ricava il conto alla rovescia: sa quanto manca
                    // in unità e a che velocità le sta consumando.
                    velocitaPerTick: PIT_AUTO_SPEED,
                    tickMs: PHYSICS_TICK_MS,
                }));
        }
    }
}

// Sposta l'auto verso il prossimo waypoint del percorso box (track.pitPath) a velocità fissa e
// bassa — apposta lenta, per dare tempo di scegliere la mescola durante il
// tragitto (soprattutto in ingresso).
//
// Due tratti (Fix review finale, vedi
// docs/superpowers/specs/2026-08-03-f1-pit-boxes-design.md): il walk sui
// waypoint grezzi (track.pitPath) arriva fino a p.pitBoxAnchor.fromIdx —
// esattamente come prima di questa feature, preservando la sterzata già
// corretta/testata sulle curve condivise — poi UN solo hop breve, locale
// al segmento [fromIdx, fromIdx+1] che contiene l'anchor, verso/dall'anchor
// personale del pilota (p.pitBoxFinalApproach). Un salto diretto da un
// waypoint precedente/successivo lontano fino all'anchor (versione
// precedente) tagliava fuori l'eventuale curva della corsia proprio in
// quel punto, portando l'auto fuori dalla sede stradale (misurato: fino a
// 7 unità su una corsia larga 3.5 di roadHalfWidth, su piste con un
// piegone marcato a boxIndex).
//
// IMPORTANTE: si usa fromIdx del box personale, NON il vertice condiviso
// pitBoxIndex — pitBoxAnchors distribuisce i box SIMMETRICAMENTE attorno a
// boxIndex (metà prima, metà dopo lungo il verso di marcia). Instradare
// tutti fino al vertice condiviso prima del balzo finale (versione
// precedente) faceva sì che un pilota col box PRIMA del vertice ci
// arrivasse comunque, superando così il proprio box, per poi dover
// tornare indietro nel balzo finale — bug segnalato in playtest ("va
// avanti e poi indietro"). Con fromIdx proprio del pilota, il walk in
// avanti si ferma esattamente al segmento del proprio box, mai oltre.
function updatePitAutopilot(io, lobbyId, game, p) {
    const track = game.track;

    // Ingresso nello stallo: non più un balzo di 90 gradi all'altezza del
    // proprio box, ma la traiettoria a due tempi di f1BoxIngresso.js. Si avanza
    // di PIT_AUTO_SPEED lungo la corsia e la posizione la dà il modulo; la
    // direzione dell'auto è semplicemente quella in cui si sta muovendo, che è
    // ciò che elimina la rotazione sul posto.
    if (p.pitBoxFinalApproach && p.pitAutoState === 'entering' && p.pitPiano) {
        const lane = track.pitLanePts;
        const prossimo = Math.max(0, (p.pitRimanente != null ? p.pitRimanente : p.pitPiano.lunghezza) - PIT_AUTO_SPEED);
        const pos = BoxIngresso.posizioneIngresso(lane, p.pitPiano, prossimo);
        const dx = pos.x - p.x, dz = pos.z - p.z;
        if (Math.hypot(dx, dz) > 1e-6) p.angle = Math.atan2(dx, dz);
        p.x = pos.x; p.z = pos.z;
        p.pitRimanente = prossimo;
        p.speed = PIT_AUTO_SPEED; p.vx = 0; p.vz = 0;

        if (prossimo <= 0) {
            // Arrivata: allineata al senso di marcia della corsia (Rif.
            // richiesta utente 2026-08-07, "la macchina si deve fermare in
            // maniera parallela"). Ora però non è più una rotazione da
            // raddrizzare: la traiettoria ci arriva già dritta, a meno di un
            // grado misurato, e questa riga toglie solo il residuo.
            p.x = p.pitBoxAnchor.stallX; p.z = p.pitBoxAnchor.stallZ;
            p.angle = Math.atan2(p.pitBoxAnchor.tx, p.pitBoxAnchor.tz);
            p.speed = 0; p.vx = 0; p.vz = 0;
            p.pitBoxFinalApproach = false;
            p.pitRimanente = null;
            p.pitAutoState = null;   // la sosta prende il posto dell'autopilota
            startPitStop(io, lobbyId, game, p);
        }
        return;
    }

    if (p.pitBoxFinalApproach && p.pitBoxAnchor) {
        // 'entering': balzo dal waypoint fromIdx verso lo STALLO personale
        // (spostato lateralmente dalla corsia condivisa — Rif. richiesta
        // utente 2026-08-07: prima l'anchor era sulla linea centrale della
        // corsia, quindi un'auto diretta a un box più lontano guidava il
        // proprio ingombro sopra un'auto già ferma più vicina, spingendola).
        // Fallback a pitBoxAnchor grezzo se stallX/stallZ non sono
        // disponibili (retrocompatibilità, es. fixture di test che non
        // passano trackPoints/pitRoadHalf a pitBoxAnchors).
        // 'exiting': balzo inverso, dallo stallo verso pitPath[fromIdx+1] —
        // il waypoint SUCCESSIVO al proprio box (non più il vertice
        // condiviso pitBoxIndex: un box con fromIdx < pitBoxIndex deve
        // rientrare in avanti verso il proprio segmento, non verso un
        // vertice che potrebbe trovarsi oltre, dietro di sé).
        // In uscita si rientra su un punto della corsia CAMPIONATA poco più
        // avanti del proprio box (non più il punto di controllo successivo:
        // sulla lane campionata quello non ha più significato). Un box con
        // laneIdx prima del vertice condiviso deve comunque rientrare in
        // avanti, mai indietro.
        const rejoinIdx = Math.min(track.pitLanePts.length - 1,
                                   p.pitBoxAnchor.laneIdx + PIT_REJOIN_LEAD_SAMPLES);
        const target = (p.pitAutoState === 'entering')
            ? {
                x: p.pitBoxAnchor.stallX != null ? p.pitBoxAnchor.stallX : p.pitBoxAnchor.x,
                z: p.pitBoxAnchor.stallZ != null ? p.pitBoxAnchor.stallZ : p.pitBoxAnchor.z
            }
            : track.pitLanePts[rejoinIdx];
        const dx = target.x - p.x, dz = target.z - p.z;
        const dist = Math.hypot(dx, dz);

        if (dist < PIT_AUTO_ARRIVE_DIST) {
            p.x = target.x; p.z = target.z;
            p.speed = 0; p.vx = 0; p.vz = 0;
            p.pitBoxFinalApproach = false;

            if (p.pitAutoState === 'entering') {
                // Ferma allineata al senso di marcia della corsia (Rif.
                // richiesta utente 2026-08-07: "la macchina si deve fermare
                // in maniera parallela"), non più lasciata diagonale verso
                // lo stallo — stessa convenzione atan2(x,z) usata ovunque
                // per l'angolo, applicata alla tangente della corsia invece
                // che alla direzione di avvicinamento.
                p.angle = Math.atan2(p.pitBoxAnchor.tx, p.pitBoxAnchor.tz);
                p.pitAutoState = null;   // arrivato alla casella personale: la sosta prende il posto dell'autopilota
                startPitStop(io, lobbyId, game, p);
            }
            // se 'exiting': arrivato al waypoint fromIdx+1, il prossimo tick
            // riprende il walk normale dei waypoint successivi (pitPathIndex
            // è già puntato la waypoint giusto, vedi completePitStop)
            return;
        }

        p.angle = Math.atan2(dx, dz);
        p.x += (dx / dist) * PIT_AUTO_SPEED;
        p.z += (dz / dist) * PIT_AUTO_SPEED;
        p.speed = PIT_AUTO_SPEED;
        p.vx = 0; p.vz = 0;
        return;
    }

    // Avanzamento lungo la POLILINEA CAMPIONATA della corsia (track.pitLanePts,
    // gli stessi punti che il frontend usa per disegnarla): si consuma
    // PIT_AUTO_SPEED unità per tick attraversando quanti waypoint servono.
    //
    // Non si "punta al waypoint e ci si ferma" come si faceva sui punti di
    // CONTROLLO: quelli erano 7 su "prova" e andarci in retta tagliava le
    // curve della corsia (scarto misurato 3.35 su una semilarghezza di 5).
    // Con 300 campioni a ~1 unità l'uno dall'altro, invece, l'auto
    // raggiungerebbe più waypoint per tick e il vecchio azzeramento di
    // speed/vx/vz ad ogni arrivo la farebbe procedere a scatti.
    const lane = track.pitLanePts;
    let budget = PIT_AUTO_SPEED;
    while (budget > 0 && p.pitPathIndex < lane.length) {
        const wp = lane[p.pitPathIndex];
        const dx = wp.x - p.x, dz = wp.z - p.z;
        const dist = Math.hypot(dx, dz);

        if (dist > budget) {
            p.angle = Math.atan2(dx, dz);   // stessa convenzione della fisica normale (sin=x, cos=z)
            p.x += (dx / dist) * budget;
            p.z += (dz / dist) * budget;
            budget = 0;
            break;
        }

        p.x = wp.x; p.z = wp.z;
        budget -= dist;
        if (dist > 1e-6) p.angle = Math.atan2(dx, dz);

        // Si comincia a sterzare QUANDO MANCA la lunghezza della manovra, non
        // quando si è già all'altezza del box: è tutta qui la differenza fra
        // "si arriva dritti dentro" e la svolta secca di prima.
        if (p.pitAutoState === 'entering' && p.pitPiano
            && BoxIngresso.distanzaLungoLane(lane, p.pitPathIndex, p.pitPiano.laneIdx) <= p.pitPiano.lunghezza) {
            p.pitRimanente = BoxIngresso.distanzaLungoLane(lane, p.pitPathIndex, p.pitPiano.laneIdx);
            p.speed = PIT_AUTO_SPEED; p.vx = 0; p.vz = 0;
            p.pitBoxFinalApproach = true;
            return;
        }

        // Vecchia condizione, tenuta per le fixture di test che non hanno una
        // corsia campionata (nessun piano d'ingresso): lì si arriva all'altezza
        // del box e si fa il balzo, come prima.
        if (p.pitAutoState === 'entering' && !p.pitPiano && p.pitBoxAnchor
            && p.pitBoxAnchor.laneIdx != null && p.pitPathIndex >= p.pitBoxAnchor.laneIdx) {
            p.speed = PIT_AUTO_SPEED; p.vx = 0; p.vz = 0;
            p.pitBoxFinalApproach = true;
            return;
        }

        p.pitPathIndex++;
    }

    p.speed = PIT_AUTO_SPEED;   // solo per HUD velocità/rotazione ruote lato client
    p.vx = 0; p.vz = 0;

    if (p.pitPathIndex >= lane.length) {
        p.pitAutoState = null;   // fine autopilota: comandi restituiti al giocatore
        // Il controllo torna al giocatore con la velocità EFFETTIVA
        // dell'autopilota (PIT_AUTO_SPEED, ~85 km/h) invece che da fermo
        // (Rif. richiesta utente 2026-08-08): senza questo la fisica normale
        // del tick successivo ripartiva da p.speed=0 nonostante l'auto stesse
        // viaggiando un istante prima. p.angle punta già nel verso di marcia,
        // stessa convenzione sin/cos usata da AerodynamicsModel.applyGripBlend.
        p.vx = Math.sin(p.angle) * PIT_AUTO_SPEED;
        p.vz = Math.cos(p.angle) * PIT_AUTO_SPEED;
        const sid = game.socketByColor[p.color];
        if (sid) io.to(sid).emit('f1PitLaneExited');
    }
}

// Il giocatore è arrivato alla casella (via autopilota): attesa casuale, poi
// il segnale "vai" SOLO al suo socket (nessuno spoiler per gli altri).
function startPitStop(io, lobbyId, game, p) {
    p.pitting = true;
    p.speed = 0; p.vx = 0; p.vz = 0;

    // Niente più attesa casuale a macchina ferma: quando l'auto arriva nello
    // stallo il gioco di reazione è GIÀ stato giocato, lungo la corsia. Chi non
    // ha premuto si prende la sosta lenta, che è anche il caso di chi non ha
    // ancora imparato il meccanismo.
    const esito = p.pitEsito || BoxIngresso.LENTA;
    let durationMs = durataPerEsito(esito);

    // Penalità falsa partenza scontata QUI, alla PRIMA sosta: nessun secondo
    // meccanismo da imparare per il giocatore.
    if (p.falseStart && !p.falseStartServed) {
        durationMs += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }

    // Riparazione danni: tempo extra proporzionale al danno.
    if (p.pendingRepair && p.damage > 0) {
        durationMs += p.damage * REPAIR_MS_PER_DAMAGE_PCT;
    }

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopStarted', { esito, durationMs });

    setTimeout(() => {
        // Anche qui l'identità: senza, la fine di una sosta della sessione
        // precedente annunciava un pit stop ai client di quella nuova.
        if (!ancoraViva(lobbyId, game)) return;
        completePitStop(io, lobbyId, game, p);
    }, durationMs);
}

function handlePitReactionPress(io, lobbyId, game, p, { elapsedMs } = {}) {
    // Si preme MENTRE si arriva, non da fermi: fuori da quella finestra — o se
    // l'esito è già stato deciso — la pressione non conta e non brucia nulla.
    // Premere in anticipo per curiosità resta gratis, come prima.
    if (p.pitAutoState !== 'entering' || !p.pitPiano || p.pitEsito) return;
    const lane = game.track.pitLanePts;
    if (!lane) return;

    // Quanto manca al proprio box nell'istante della pressione. Durante la
    // manovra il valore è già mantenuto tick per tick; prima, lo si misura
    // lungo la corsia.
    let rimanente = p.pitRimanente != null
        ? p.pitRimanente
        : BoxIngresso.distanzaLungoLane(lane, p.pitPathIndex, p.pitPiano.laneIdx);

    // Compensazione del ritardo: quando il messaggio arriva, l'auto è già
    // avanzata rispetto a dov'era sullo schermo di chi ha premuto.
    if (typeof elapsedMs === 'number') {
        const ritardo = Math.max(0, Math.min(PIT_LATENZA_MAX_MS, (game.raceTick * PHYSICS_TICK_MS) - elapsedMs));
        rimanente += (ritardo / PHYSICS_TICK_MS) * PIT_AUTO_SPEED;
    }

    p.pitEsito = BoxIngresso.esitoDaRimanente(p.pitPiano, rimanente);
    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitEsito', { esito: p.pitEsito });
}

// La durata della sosta che consegue all'esito del gioco di reazione.
function durataPerEsito(esito) {
    if (esito === BoxIngresso.PERFETTA) return PIT_DURATA_PERFETTA;
    if (esito === BoxIngresso.BUONA) return PIT_DURATA_BUONA;
    return PIT_DURATA_LENTA;
}

// Fine sosta: gomme cambiate, poi l'autopilota riprende per l'uscita (non
// restituisce subito i comandi — il giocatore deve ancora essere riportato
// fuori dalla corsia).
function completePitStop(io, lobbyId, game, p) {
    if (!p.pitting) return;   // difensivo (es. gara finita nel frattempo)
    p.pitting = false;
    p.pitEsito = null;
    p.tyreWear = 0;
    p.hasPitted = true;
    if (p.pendingCompound) { p.compound = p.pendingCompound; p.pendingCompound = null; }
    if (p.pendingRepair) { p.damage = 0; p.damageParts = createDamageParts(); }
    p.pendingRepair = false;

    const sid = game.socketByColor[p.color];
    if (sid) io.to(sid).emit('f1PitStopFinished', { compound: p.compound });

    p.pitAutoState = 'exiting';
    // Primo tick di uscita: hop dall'anchor personale a pitPath[fromIdx+1] —
    // non più il vertice condiviso pitBoxIndex (vedi updatePitAutopilot):
    // un box con fromIdx < pitBoxIndex deve rientrare in avanti sul proprio
    // segmento, non su un vertice che potrebbe stargli dietro.
    p.pitBoxFinalApproach = true;
    // Campione della corsia da cui riprende il walk normale dopo il rientro
    // dallo stallo (vedi PIT_REJOIN_LEAD_SAMPLES in updatePitAutopilot).
    p.pitPathIndex = Math.min(game.track.pitLanePts.length - 1,
                              p.pitBoxAnchor.laneIdx + PIT_REJOIN_LEAD_SAMPLES);
}

// Stato visibile ad UN determinato giocatore (viewerColor):
// - qualifying: TUTTI corrono in parallelo, ma ognuno vede SOLO la propria
//   auto — "da solo in pista" è isolamento visivo, non un turno a testa.
//   Per questo lo stato non può essere un'unica trasmissione condivisa (vedi
//   broadcastState): ogni giocatore riceve un payload diverso, con dentro
//   solo se stesso.
// - tyre_select: NESSUNO — il focus è sulla UI (selezione mescola) e le auto
//   non sono ancora schierate. IMPORTANTE: senza
//   questo, in tyre_select la trasmissione di gruppo (vedi broadcastState,
//   che per questa fase non personalizza) manda a TUTTI la posizione di
//   TUTTI — i client creano comunque i modelli delle altre auto
//   (otherCars), e quando poi si passa a 'qualifying' — che filtra
//   correttamente — quei modelli non vengono mai rimossi: restano fermi in
//   scena, "fantasma" (bug segnalato dall'utente).
//   Il problema dei fantasmi NON si ripresenta con grid_display, che è
//   sempre seguita da 'race': dopo di lei nessuna fase filtra più.
// - grid_display/race/altre fasi: tutti, in un'unica trasmissione condivisa.
function playersVisibleTo(game, viewerColor) {
    if (game.phase === 'qualifying') {
        return game.players[viewerColor] ? { [viewerColor]: game.players[viewerColor] } : {};
    }
    // grid_display SÌ, a differenza di tyre_select: le auto sono già state
    // schierate (assignGridSpawns gira all'inizio di questa fase), e senza
    // mandarne la posizione il client continua a disegnarle dove le aveva
    // lasciate il giro di qualifica. Riapparivano al posto giusto solo al
    // primo aggiornamento della fase 'race', cioè quando comparivano i
    // semafori: l'auto scivolava di lato sotto gli occhi del giocatore
    // (segnalato in playtest su monte-rosso, "teletrasportato alla mia
    // sinistra"). Ora lo spostamento avviene mentre l'animazione della pole
    // copre lo schermo, che è il momento in cui deve avvenire.
    if (game.phase === 'tyre_select') return {};
    return game.players;
}

// Trasmette f1StateUpdate. In qualifica NON è un'unica emit di gruppo: ogni
// giocatore riceve un payload personalizzato (solo se stesso) via il proprio
// socket.id (game.socketByColor). Nelle altre fasi resta una singola emit
// condivisa alla room, come prima.
function broadcastState(io, lobbyId, game, raceStartedFlag) {
    if (game.phase === 'qualifying') {
        // Layout box (Rif. richiesta utente 2026-08-07: "la mappa in
        // qualifica e in gara deve essere la stessa"): playersVisibleTo
        // isola ogni giocatore alla propria auto per non rivelare tempi/
        // posizione degli avversari (spoiler), ma la posizione STATICA del
        // box di ognuno non è un'informazione di gara — nessuno spoiler nel
        // mostrarla. Trasmessa a parte, fuori dall'isolamento, sotto una
        // chiave speciale che il client riconosce (vedi frontend/f1.js,
        // socket.on('f1StateUpdate')) invece che dentro lo stato per-colore
        // isolato.
        const boxLayout = {};
        for (const [color, p] of Object.entries(game.players)) {
            if (p.pitBoxAnchor) boxLayout[color] = p.pitBoxAnchor;
        }
        for (const color of Object.keys(game.players)) {
            const sid = game.socketByColor[color];
            if (!sid) continue;
            const payload = buildPublicState(playersVisibleTo(game, color), raceStartedFlag, game.track, game);
            payload.__boxLayout = boxLayout;
            io.to(sid).emit('f1StateUpdate', payload);
        }
        return;
    }
    const payload = buildPublicState(playersVisibleTo(game, null), raceStartedFlag, game.track, game);
    // In scelta mescola lo stato per-colore e' vuoto (le auto non sono ancora
    // schierate), ma i BOX si: l'anteprima del circuito ha un'inquadratura
    // sulla corsia, e li' devono esserci.
    if (game.phase === 'tyre_select') {
        const boxLayout = {};
        for (const [color, p] of Object.entries(game.players)) {
            if (p.pitBoxAnchor) boxLayout[color] = p.pitBoxAnchor;
        }
        payload.__boxLayout = boxLayout;
    }
    io.to(lobbyId).emit('f1StateUpdate', payload);
}

// Contatore live "X su N piloti al traguardo" durante la finestra di grazia
// di fine qualifica (Rif. design 2026-08-07): NON rivela chi è arrivato né
// con che tempo (playersVisibleTo isola comunque ognuno alla propria auto
// in qualifica — questo è un evento a parte, apposta neutro) — solo per
// dare un segnale vero che qualcosa sta succedendo, invece di uno schermo
// fermo. Trasmesso a tutta la lobby (nessuna informazione sensibile), solo
// quando il conteggio cambia rispetto all'ultimo emesso: il gate cambia al
// massimo una volta per bot arrivato, non serve spammare un evento ogni
// tick per 8 secondi buoni.
function broadcastQualiWaitingCount(io, lobbyId, game) {
    const players = Object.values(game.players);
    const finished = players.filter(p => p.finished).length;
    const total = players.length;
    if (game.qualiLastWaitingFinished === finished) return;
    game.qualiLastWaitingFinished = finished;
    io.to(lobbyId).emit('f1QualiWaiting', { finished, total });
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

    // Contatore di tick fisici dalla partenza — Rif. game.raceTick sopra:
    // usato al posto di Date.now() ovunque serva un tempo di gara
    // confrontabile col simulatore.
    game.raceTick++;

    updateBotInputs(game, {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId,
        wearLapsAtMedium: WEAR_LAPS_AT_MEDIUM,
        accel: ACCEL, brakeMult: BRAKE_MULT, turnRateHigh: TURN_SPEED_HIGH,
        slipstreamMaxBoost: SLIPSTREAM_MAX_BOOST,
        // Grip-awareness (Rif. docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md):
        // passate sempre, il flag F1_BOT_GRIP_AWARENESS che decide se il
        // bot le consulta vive SOLO in f1Bot.js, mai qui.
        effectiveBrakeMult, corneringCapacity
    });

    const isQuali = game.phase === 'qualifying';
    // In qualifica si fa UN giro secco; in gara i giri sono quelli della pista caricata.
    const totalLaps = isQuali ? 1 : game.track.totalLaps;
    const players = Object.values(game.players);
    // Posizione "di inizio tick", prima di qualunque integrazione: unico
    // input per interpolare la frazione esatta di tick in cui si attraversa
    // il traguardo (vedi checkLap/computeFinishCrossingFraction) — senza
    // questo il tempo finale può solo cadere sul bordo del tick (multiplo
    // di PHYSICS_TICK_MS), che è quanto segnalato dall'utente come "scarti
    // di 50/150ms, non tempi reali" nel riepilogo griglia.
    for (const p of players) { p.prevX = p.x; p.prevZ = p.z; }
    // In qualifica corrono TUTTI in parallelo (isolati solo visivamente, non
    // fisicamente: nessuna collisione tra loro — vedi sotto). Chi è fermo ai
    // box (pitting) o guidato dall'autopilota (pitAutoState) resta escluso
    // dalla fisica normale, ma resta un ostacolo per resolveCollisions.
    //
    // Chi ha FINITO invece continua a guidare fino a fine sessione: prima
    // veniva escluso di qui e si inchiodava sul traguardo — con i bot, che
    // seguono tutti la stessa traiettoria, si formava una fila ferma in mezzo
    // alla pista. Da questo dipendeva anche il difetto delle ruote che
    // continuavano a girare da ferme: la fisica non girava più e `speed`
    // restava congelata all'ultimo valore, che il client usa per far ruotare
    // le ruote e per il tono del motore.
    const racing = players.filter(p => !p.pitting && !p.pitAutoState);
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
                slipstreamMult = computeSlipstreamMult(ahead.gapM);
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
        // Chi ha finito è un FANTASMA: si vede e continua a girare, ma non
        // urta più nessuno e nessuno urta lui. A gara conclusa non rischia
        // più niente, quindi un suo contatto costerebbe la posizione solo
        // all'altro — scelta dell'utente al playtest.
        if (!isQuali) resolveCollisions(players.filter(p => !p.finished));
        // A differenza di resolveCollisions (disabilitata in qualifica: le
        // collisioni auto-auto sono una questione di fair-play multiplayer),
        // il muro dei tratti ponte si applica sempre, anche in qualifica —
        // è un limite fisico della pista, non un'interazione tra giocatori.
        for (const p of racing) applyBarrier(p, game.track, !isQuali);
    }

    for (const p of racing) {
        const offTrack = applyOffTrackDrag(p, game.track);
        updateTrackIndex(p, game.track);
        // L'usura conta solo in GARA: in qualifica le gomme restano quelle
        // scelte ma "fresche" fino al via vero (resettate in assignGridSpawns).
        // Usura e cronometraggio si fermano al traguardo: il giro di
        // rientro non consuma gomme e non ha settori da misurare.
        if (game.phase === 'race' && !p.finished) applyTyreWear(p, offTrack, game.track);
        checkLap(p, totalLaps, io, lobbyId, game);
        if (!p.finished) updateSectorTiming(p, game);

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
        // checkLap MANCAVA qui (girava solo per `racing`): il tracciato del
        // traguardo può passare vicino/attraverso la corsia box, quindi un
        // giro completato mentre l'autopilota guida verso/fuori dai box non
        // veniva mai rilevato — segnalato dall'utente come "giro perso" ai
        // box. trackIndex è già aggiornato dalla riga sopra, checkLap lo usa.
        checkLap(p, totalLaps, io, lobbyId, game);
        updateSectorTiming(p, game);
        resolvePendingFinish(p, game, io, lobbyId);
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

    // Fine sessione: tutti i giocatori UMANI CONNESSI hanno finito (chi è in
    // grazia con l'auto ferma non blocca la chiusura; c'è comunque un timer
    // di sicurezza per chi resta indietro senza essersi disconnesso). I bot
    // NON bloccano la chiusura: un bot lento o fuori pista non deve tenere
    // in attesa un giocatore umano che ha già finito — i bot restano
    // comunque in gara, semplicemente non contano per questo gate.
    //
    // In QUALIFICA questo non chiude subito la sessione: apre invece una
    // finestra di grazia (QUALI_GRACE_TICKS) durante cui i bot continuano a
    // guidare normalmente, con una possibilità reale di tagliare il
    // traguardo invece di ricevere quasi sempre un tempo stimato (vedi
    // estimateFinishTime in endQualifying) — Rif. design 2026-08-07.
    const connectedHumans = players.filter(p => !p.disconnected && !p.isBot);
    if (isQuali) {
        if (!game.qualiEnded) {
            if (!game.qualiGraceEndTick && connectedHumans.length > 0 && connectedHumans.every(p => p.finished)) {
                game.qualiGraceEndTick = game.raceTick + QUALI_GRACE_TICKS;
            }
            if (game.qualiGraceEndTick) {
                broadcastQualiWaitingCount(io, lobbyId, game);
                const allFinished = players.every(p => p.finished);
                if (allFinished || game.raceTick >= game.qualiGraceEndTick) {
                    endQualifying(io, lobbyId, game);
                    return;
                }
            }
        }
    } else if (game.phase === 'race') {
        // Come in qualifica: quando gli umani hanno finito la gara NON chiude
        // subito, resta aperta fino a RACE_GRACE_MS. In quella finestra tutti
        // continuano a girare (chi ha finito da fantasma) e i bot che tagliano
        // il traguardo prendono il tempo VERO invece di quello proiettato.
        if (!game.raceEnded) {
            if (!game.raceGraceEndTick && connectedHumans.length > 0 && connectedHumans.every(p => p.finished)) {
                game.raceGraceEndTick = game.raceTick + RACE_GRACE_TICKS;
                io.to(lobbyId).emit('f1RaceGrace', { restaMs: RACE_GRACE_MS });
            }
            if (game.raceGraceEndTick) {
                const tuttiArrivati = players.every(p => p.finished);
                if (tuttiArrivati || game.raceTick >= game.raceGraceEndTick) {
                    endRace(io, lobbyId, game);
                    return;
                }
            }
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
// applyBarrier e updateTrackIndex, unica fonte di verità.
// ====================================================
// Il numero di campioni è sempre SAMPLES=1000 (vedi trackLoader.js),
// indipendentemente dalla pista: questo indice resta una costante globale.
const N_SAMPLES = 1000;
const HALF_LAP_IDX = Math.floor(N_SAMPLES / 2);
// Confini settore (Rif. docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md):
// divisione puramente geometrica per indice campionato, identica per ogni
// pista. A differenza di HALF_LAP_IDX (offset da sommare a startFinishIndex
// per un indice ASSOLUTO in game.track.points), questi sono già indici
// RELATIVI all'inizio del giro corrente (0 = startFinishIndex) — vedi
// updateSectorTiming, che lavora nello spazio "indice-relativo-al-giro".
const SECTOR1_REL_IDX = Math.round(N_SAMPLES / 3);
const SECTOR2_REL_IDX = Math.round(2 * N_SAMPLES / 3);
// Quanto restano visibili le 3 barre settore del giro APPENA chiuso prima
// di azzerarsi per il nuovo giro (Rif. richiesta utente 2026-08-07 dopo
// playtest: senza questa finestra il settore 3, conoscibile solo a fine
// giro, o sparisce subito o resta fisso per l'intero giro successivo —
// nessuna delle due era quella voluta). Passata questa finestra, le barre
// tornano grigie e si riempiono di nuovo mano a mano che il nuovo giro
// attraversa i 3 settori, esattamente come il primo giro in gara.
const SECTOR_RECAP_DURATION_MS = 3500;
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
const FINISH_WINDOW_M = 6;
// Sotto questa distanza (in metri di progressScore) un cambio di posizione
// in classifica NON viene accettato: due auto molto vicine possono scavalcarsi
// avanti e indietro di pochissimo tick dopo tick (frenata, sterzata, scia),
// senza questa soglia la classifica live "sfarfalla" — segnalato dall'utente
// come "salti" nel pannello classifica, più visibili quando il gruppo si
// compatta (uscita pit, subito dopo un giro). Il tempo/risultato finale di
// gara non dipende da questo: viene da checkLap/p.time, non da position.
const RANK_SWAP_HYSTERESIS_M = 2.5;

function updateTrackIndex(p, track) {
    p.trackIndex = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
}

function checkpointWindowFor(track) {
    return Math.max(1, Math.round(CHECKPOINT_WINDOW_M * track.points.length / track.lapLength));
}

function finishWindowFor(track) {
    return Math.max(1, Math.round(FINISH_WINDOW_M * track.points.length / track.lapLength));
}

// Punteggio di avanzamento: lap*N+indice, pensato per crescere in modo
// continuo attraverso il giro. MA l'indice NON si azzera per forza nello
// stesso tick in cui checkLap incrementa lap: la finestra traguardo è
// circolare (vedi finishWindowFor) e accetta il lato "appena prima" del giro
// (es. indice 995 su 1000) tanto quanto il lato "appena dopo" (indice 5) —
// se il giro scatta mentre l'indice è ancora sul lato "prima", per un tick
// il punteggio include un giro intero di troppo (+N), poi si autocorregge al
// tick dopo quando l'indice raggiunge davvero lo zero. Sintomo osservato:
// la classifica live scavalca tutti per un istante e torna giù da sola —
// MAI un vero sorpasso che si disfa (lap non decrementa mai). Corretto
// riconoscendo la stessa finestra "ambigua" usata da checkLap e trattandola
// come fine del giro PRECEDENTE ai fini del punteggio. Non applicato ai
// giocatori finished: il loro trackIndex resta congelato per sempre da quel
// tick in poi (mai più aggiornato), quindi se corretto qui rischierebbe di
// restare sbagliato in permanenza invece di autocorreggersi al tick dopo.
function progressScore(p, track) {
    const n = track.points.length;
    const idx = p.trackIndex || 0;
    if (p.finished || p.lap <= 0) return p.lap * n + idx;
    // Distanza circolare percorsa oltre il traguardo (non necessariamente
    // indice 0 — vedi startFinishIndex, es. test2.json usa 2): un valore
    // piccolo è appena dopo il traguardo (giro corrente, nessuna correzione);
    // un valore vicino a N è ancora "appena prima" nel giro precedente.
    const sf = track.startFinishIndex || 0;
    const distPastFinish = ((idx - sf) % n + n) % n;
    const ambiguousHighSide = distPastFinish >= n - finishWindowFor(track);
    const effectiveLap = ambiguousHighSide ? p.lap - 1 : p.lap;
    return effectiveLap * n + idx;
}

function rankHysteresisWindow(track) {
    return Math.max(1, Math.round(RANK_SWAP_HYSTERESIS_M * track.points.length / track.lapLength));
}

// Ordina i colori per progressScore, ma sotto RANK_SWAP_HYSTERESIS_M
// preserva l'ordine precedente (prevOrder) invece di scambiarli — vedi
// commento sulla costante. Comparator non rigorosamente transitivo (il
// classico compromesso di ogni classifica con isteresi), accettabile con
// pochi giocatori quasi mai in terna quasi-pari esatta.
function stableRankOrder(prevOrder, players, track) {
    const scores = {};
    for (const p of Object.values(players)) scores[p.color] = progressScore(p, track);
    const prevRank = {};
    (prevOrder || []).forEach((color, i) => { prevRank[color] = i; });
    const window = rankHysteresisWindow(track);

    return Object.keys(players).sort((colorA, colorB) => {
        const diff = scores[colorB] - scores[colorA];   // ordine decrescente per punteggio
        if (Math.abs(diff) > window) return diff;
        const ra = prevRank[colorA], rb = prevRank[colorB];
        if (ra === undefined || rb === undefined) return diff;   // nuovo in classifica: nessun ordine precedente da preservare
        return ra - rb;
    });
}

// Distanza circolare minima tra due indici su un loop di `n` campioni.
function circularWithin(idx, target, n, halfWidth) {
    let d = Math.abs(idx - target);
    if (d > n / 2) d = n - d;
    return d <= halfWidth;
}

// Quanti tick al massimo ci si fida dell'estrapolazione in
// computeFinishCrossingFraction prima di considerarla inaffidabile (vedi
// sotto) — 40 tick = 2s, ben oltre il tempo che serve a qualunque velocità
// di gioco plausibile per coprire i pochi metri di FINISH_WINDOW_M.
const FINISH_CROSS_EXTRAPOLATION_MAX_TICKS = 40;

// Frazione di tick (può essere >1) in cui il giocatore attraversa DAVVERO la
// linea del traguardo, per dare al tempo finale precisione reale invece di
// scattare sempre sul bordo del tick fisico (50ms) — Rif. 2026-08-07,
// segnalato dall'utente come "scarti di 50/150ms, non tempi reali" nel
// riepilogo griglia. Puramente geometrico (nessun orologio di sistema): la
// linea è il piano perpendicolare alla tangente della pista nel punto
// startFinishIndex.
//
// ATTENZIONE (bug reale trovato simulando una sessione vera end-to-end, un
// unit test con attraversamento e ingresso-finestra coincidenti nello stesso
// tick non lo copriva): finishWindowFor è larga qualche metro, non un punto
// — "appena entrato in zona" (l'edge-trigger in checkLap che fissa
// p.finished/p.time) scatta quasi sempre mentre il giocatore è ancora PRIMA
// della vera linea, non esattamente su di essa. E siccome un giocatore
// finished esce dalla simulazione fisica dal tick successivo (vedi filtro
// `racing` in tickGame), non arriverà MAI a un tick successivo in cui
// ricalcolare da capo troverebbe il vero attraversamento — va quindi
// ESTRAPOLATO in avanti da questo stesso tick: dati le due proiezioni
// s0 (inizio tick) e s1 (fine tick) sulla tangente, la frazione di tick a
// cui s=0 può cadere oltre 1 (il giocatore raggiungerà la linea vera solo
// qualche tick dopo quello dell'edge-trigger, alla velocità osservata in
// questo tick) — è un'estrapolazione a velocità costante, non una misura
// diretta, ma correttamente più vicina alla realtà del vecchio
// comportamento (che marcava il tempo ancora prima, all'ingresso finestra).
// Ricade su 1 (vecchio comportamento esatto, bordo del tick) se manca
// prevX/prevZ, il movimento lungo la tangente è ~zero (fermo o laterale), o
// l'estrapolazione supera FINISH_CROSS_EXTRAPOLATION_MAX_TICKS (mai
// un'invenzione oltre un limite ragionevole).
function computeFinishCrossingFraction(p, track, startFinishIndex) {
    if (typeof p.prevX !== 'number' || typeof p.prevZ !== 'number') return 1;
    const g = track.points[startFinishIndex];
    if (!g) return 1;
    const { tx, tz } = TrackGeometry.tangentAt(track.points, startFinishIndex, true);
    const s0 = (p.prevX - g.x) * tx + (p.prevZ - g.z) * tz;
    const s1 = (p.x - g.x) * tx + (p.z - g.z) * tz;
    const denom = s1 - s0;
    if (Math.abs(denom) < 1e-9) return 1;
    const t = -s0 / denom;
    if (!Number.isFinite(t) || t < 0 || t > FINISH_CROSS_EXTRAPOLATION_MAX_TICKS) return 1;
    return t;
}

// fillGaps: riempie i "buchi" (-1, indice del tracciato mai raggiunto in
// questo giro — tipico sui rettilinei ad alta velocità, dove si saltano
// 1-2 campioni tra un tick e l'altro su 1000 campioni/giro) con
// interpolazione lineare tra i due valori noti più vicini. Un run
// iniziale (prima del primo valore noto) prende 0 — il giro parte sempre
// da lì. Un run finale (dopo l'ultimo valore noto) prende il valore noto
// più vicino, costante — non c'è un valore successivo con cui
// interpolare prima del wraparound a fine giro. Chiamata una sola volta
// a fine giro (vedi checkLap), mai per tick.
function fillGaps(curve) {
    const n = curve.length;
    const out = new Float32Array(n);
    let lastKnownIdx = -1;
    let lastKnownVal = 0;
    for (let i = 0; i < n; i++) {
        if (curve[i] >= 0) {
            if (lastKnownIdx >= 0 && i - lastKnownIdx > 1) {
                const span = i - lastKnownIdx;
                for (let j = lastKnownIdx + 1; j < i; j++) {
                    const t = (j - lastKnownIdx) / span;
                    out[j] = lastKnownVal + (curve[i] - lastKnownVal) * t;
                }
            } else if (lastKnownIdx < 0 && i > 0) {
                for (let j = 0; j < i; j++) out[j] = 0;
            }
            out[i] = curve[i];
            lastKnownIdx = i;
            lastKnownVal = curve[i];
        }
    }
    if (lastKnownIdx >= 0 && lastKnownIdx < n - 1) {
        for (let j = lastKnownIdx + 1; j < n; j++) out[j] = lastKnownVal;
    }
    return out;
}

// updateSectorTiming: aggiorna la curva posizione→tempo del giro corrente
// e ne deriva i due confini di settore + il delta continuo rispetto al
// giro precedente. Chiamata una volta per giocatore per tick, subito
// DOPO checkLap (Rif. tickGame) — così se checkLap ha appena chiuso un
// giro, questa funzione registra il primo campione del giro NUOVO nello
// stesso tick, invece di perderlo. Rif. design completo:
// docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md.
function updateSectorTiming(p, game) {
    if (game.phase !== 'race') return;

    const n = game.track.points.length;
    const nowMs = game.raceTick * PHYSICS_TICK_MS;

    // Difensivo: giocatore entrato a gara già iniziata (mai passato da
    // assignGridSpawns/resetPlayers in questa sessione) — invece di un
    // quarto punto di reset speciale, il primo tick in gara vale come
    // inizio di un giro "proprio" per lui, da qui in poi identico a tutti.
    // p.trackIndex qui è già la posizione vera (nessun giro precedente da
    // cui ereditare ambiguità), quindi nessuna quarantena necessaria.
    if (!p.curLapCurve) {
        p.curLapCurve = new Float32Array(n).fill(-1);
        p.curLapCurve[0] = 0;
        p.curLapSectorTimes = [null, null, null];
        p.lapStartMs = nowMs;
        p.lapTrulyStarted = true;
    }

    const startFinishIndex = game.track.startFinishIndex || 0;
    const relIdx = (p.trackIndex - startFinishIndex + n) % n;

    // Quando checkLap chiude un giro, p.trackIndex NON viene toccato — resta
    // sulla posizione di CODA del giro appena finito (vicino al wrap, es.
    // ~996-999/1000) finché updateTrackIndex (motore fisico) non lo
    // ricalcola per la posizione vera del nuovo giro. Quanti tick ci
    // vogliono NON è fisso (dipende dalla finestra di ricerca locale di
    // nearestIndexNear e da quanto la finestra del traguardo anticipa la
    // vera linea) — misurato fino a 2 tick in simulazione, non affidabile
    // saltarne uno solo a un numero fisso. Restiamo in "quarantena" finché
    // non osserviamo relIdx davvero basso (sotto il primo confine settore):
    // solo allora la posizione riflette con certezza il NUOVO giro, non la
    // coda del vecchio. Bug reale misurato con una simulazione multi-giro:
    // senza questo, bestSectorTimes[0]/[1] restavano contaminati a un
    // valore vicino a 0 (relIdx enorme + tempo trascorso ~0), imbattibile
    // per sempre — sintomo osservato in playtest 2026-08-07 come "settore
    // sempre fucsia".
    if (!p.lapTrulyStarted) {
        if (relIdx < SECTOR1_REL_IDX) {
            p.lapTrulyStarted = true;
        } else {
            return;
        }
    }

    const lapElapsedMs = nowMs - p.lapStartMs;

    if (p.curLapCurve[relIdx] < 0) p.curLapCurve[relIdx] = lapElapsedMs;

    if (relIdx >= SECTOR1_REL_IDX && p.curLapSectorTimes[0] == null) {
        p.curLapSectorTimes[0] = lapElapsedMs;
        game.bestSectorTimes[0] = Math.min(game.bestSectorTimes[0], lapElapsedMs);
    }
    if (relIdx >= SECTOR2_REL_IDX && p.curLapSectorTimes[1] == null) {
        p.curLapSectorTimes[1] = lapElapsedMs - p.curLapSectorTimes[0];
        game.bestSectorTimes[1] = Math.min(game.bestSectorTimes[1], p.curLapSectorTimes[1]);
    }

    p.deltaToPreviousLapMs = p.prevLapCurve ? (lapElapsedMs - p.prevLapCurve[relIdx]) : null;
}

// finalizeSessionFinish: chiude DAVVERO la sessione per un giocatore (tempo
// finale + penalità + timer di sicurezza di gruppo) — estratta da checkLap
// per essere richiamabile anche in differita (vedi tickGame, subito dopo
// updatePitAutopilot nel loop autoPiloted) quando l'ultimo giro si
// completa mentre l'auto è ancora in manovra ai box (Rif. richiesta utente
// 2026-08-07 — vedi il commento nel punto di chiamata in checkLap).
// Le penalità in tempo che si sommano a fine gara, in un posto solo.
//
// Chiamata sia da chi taglia il traguardo sia da chi la gara la chiude
// ancora in pista (endRace, tempo proiettato): se le due strade non
// applicano le stesse penalità, la classifica finisce per confrontare
// grandezze diverse. È successo davvero — segnalazione dell'utente del
// 2026-08-17: primo sotto la bandiera a scacchi con 43 secondi, classificato
// dietro a bot proiettati a 50, perché i suoi +30 per il pit stop mancato
// c'erano e quelli dei bot no.
function applicaPenalitaFineGara(p, game) {
    if (game.phase !== 'race') return 0;
    let extra = 0;
    // Obbligo di almeno un pit stop in gara (regola vera F1): chi non ha mai
    // cambiato gomme prende una penalità in tempo, non viene bloccato né
    // squalificato.
    if (!p.hasPitted) {
        extra += PIT_PENALTY_MS;
        p.pitPenalty = true;
    }
    // Rete di sicurezza: se la falsa partenza non è mai stata scontata ai box
    // (il giocatore non si è mai fermato), si somma comunque qui — mai persa
    // in silenzio.
    if (p.falseStart && !p.falseStartServed) {
        extra += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }
    // Penalità collisioni: accumulo di TUTTI gli incidenti causati in gara
    // (non un flag singolo), già notificati live uno per uno (vedi drenaggio
    // in tickGame) — qui solo la somma finale.
    if (p.collisionPenaltyMs > 0) extra += p.collisionPenaltyMs;
    return extra;
}

function finalizeSessionFinish(p, crossingElapsedMs, game, io, lobbyId) {
    p.finished = true;
    p.time = crossingElapsedMs + applicaPenalitaFineGara(p, game);
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

// resolvePendingFinish: se checkLap ha rimandato la chiusura sessione
// (ultimo giro completato mentre l'auto era ancora in manovra ai box),
// controlla se ORA l'auto è tornata DAVVERO libera (né in autopilota né
// ferma ai box) e, in tal caso, la chiude per davvero. Va chiamata dopo
// updatePitAutopilot/checkLap nello stesso tick (vedi tickGame, loop
// autoPiloted) — un no-op immediato se non c'è nulla in sospeso.
function resolvePendingFinish(p, game, io, lobbyId) {
    if (p.pendingFinishTime != null && !p.pitAutoState && !p.pitting) {
        finalizeSessionFinish(p, p.pendingFinishTime, game, io, lobbyId);
        p.pendingFinishTime = null;
    }
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
    // Chi ha gia' finito continua a girare (vedi il filtro `racing` in
    // tickGame) ma il suo tempo e' scritto: ripassare sul traguardo non deve
    // contargli un altro giro ne' richiudergli la sessione.
    if (p.finished) return;
    const n = game.track.points.length;
    const idx = p.trackIndex || 0;
    const startFinishIndex = game.track.startFinishIndex || 0;

    if (!p.checkpointA && circularWithin(idx, (startFinishIndex + HALF_LAP_IDX) % n, n, checkpointWindowFor(game.track))) {
        p.checkpointA = true;
    }

    const inFinishZone = circularWithin(idx, startFinishIndex, n, finishWindowFor(game.track));
    if (p.checkpointA && inFinishZone && !p.inFinishZone) {
        // Il giocatore ha appena ENTRATO nella zona traguardo → giro completato
        p.lap++;
        p.checkpointA = false;
        console.log(`🏁 [F1] ${p.color} giro ${p.lap}/${totalLaps} (lobby ${lobbyId})`);

        // Frazione esatta di attraversamento (vedi computeFinishCrossingFraction):
        // calcolata una sola volta per giro, riusata sia dal tempo finale
        // (ultimo giro, sotto) sia dalla chiusura settori (Rif.
        // docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md, ogni
        // giro in gara) — prima venivano ricalcolate due formule diverse per
        // lo stesso istante.
        const frac = computeFinishCrossingFraction(p, game.track, startFinishIndex);
        const crossingElapsedMs = Math.round((game.raceTick - 1 + frac) * PHYSICS_TICK_MS);

        if (p.lap >= totalLaps) {
            if (p.pitAutoState || p.pitting) {
                // L'ultimo giro si chiude mentre l'auto è ancora IN MANOVRA
                // ai box (entrata/sosta/uscita) — rimandiamo la vera
                // chiusura sessione a quando l'autopilota si libera del
                // tutto (vedi tickGame, subito dopo updatePitAutopilot nel
                // loop autoPiloted). Se segnassimo p.finished=true già qui,
                // updateBotInputs (che salta i bot finished fin dalla prima
                // riga) smetterebbe per sempre di servire la sosta in
                // corso — il bot resta bloccato a metà manovra per il
                // resto della partita. Bug reale, trovato con una
                // simulazione dinamica multi-tick (Rif. richiesta utente
                // 2026-08-07). Il tempo finale resta comunque quello del
                // VERO attraversamento del traguardo (crossingElapsedMs),
                // non di quando la manovra si libera più tardi.
                p.pendingFinishTime = crossingElapsedMs;
            } else {
                finalizeSessionFinish(p, crossingElapsedMs, game, io, lobbyId);
            }
        }

        // Chiusura settori (solo in gara, mai in qualifica): il settore 3 è
        // tutto ciò che resta del giro dopo i primi due; la curva
        // posizione→tempo appena chiusa diventa il riferimento per il
        // prossimo giro (delta continuo + confronto settore). `p.curLapCurve`
        // è sempre presente qui se `game.phase === 'race'` (allocata al
        // primo tick da updateSectorTiming, che gira prima di ogni lap
        // completo possibile) — il controllo resta comunque per sicurezza.
        if (game.phase === 'race' && p.curLapCurve) {
            const s1 = p.curLapSectorTimes[0] || 0;
            const s2 = p.curLapSectorTimes[1] || 0;
            const s3 = crossingElapsedMs - p.lapStartMs - s1 - s2;
            game.bestSectorTimes[2] = Math.min(game.bestSectorTimes[2], s3);
            p.prevLapSectorTimes = [p.curLapSectorTimes[0], p.curLapSectorTimes[1], s3];
            // "Recap" del giro appena chiuso: buildPublicState lo trasmette
            // al posto dei dati (azzerati sotto) del nuovo giro per
            // SECTOR_RECAP_DURATION_MS — il giocatore vede per qualche
            // secondo il risultato dell'ultimo giro prima che le barre
            // tornino grigie e ricomincino a riempirsi col giro nuovo.
            p.lapRecapSectorTimes = [p.curLapSectorTimes[0], p.curLapSectorTimes[1], s3];
            p.lapRecapExpiresAtMs = crossingElapsedMs + SECTOR_RECAP_DURATION_MS;
            p.prevLapCurve = fillGaps(p.curLapCurve);
            p.curLapCurve = new Float32Array(n).fill(-1);
            p.curLapCurve[0] = 0;
            p.curLapSectorTimes = [null, null, null];
            p.lapStartMs = crossingElapsedMs;
            // Vedi updateSectorTiming: p.trackIndex non viene toccato qui,
            // resta sulla coda del giro appena chiuso finché il motore
            // fisico non lo ricalcola sui prossimi tick (numero variabile,
            // non un tick fisso) — updateSectorTiming resta in "quarantena"
            // finché non osserva relIdx davvero basso.
            p.lapTrulyStarted = false;
        }

        io.to(lobbyId).emit('f1LapUpdate', { color: p.color, lap: p.lap, totalLaps, phase: game.phase });
    }
    p.inFinishZone = inFinishZone;
}

function endRace(io, lobbyId, game) {
    game.raceEnded = true;
    if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }

    // Chi era già disconnesso quando è caduta la bandiera a scacchi ha
    // davvero abbandonato. Va fotografato ORA: fra pochi secondi si
    // disconnetteranno anche tutti gli altri, ma quelli staranno solo
    // tornando in lobby col podio (vedi chiudiPartita, che usa questa lista
    // per distinguere i due casi).
    game.abbandoniPrimaDellaFine = Object.values(game.players)
        .filter(p => !p.isBot && p.disconnected)
        .map(p => p.color);
    // La gara chiude non appena tutti gli UMANI connessi hanno finito (vedi
    // il gate in tickGame): un bot ancora in pista in quel momento NON va
    // omesso dal podio (a differenza di prima) — mantiene la sua posizione
    // attuale, calcolata dallo stesso progressScore usato per la classifica
    // live. Chi ha finito viene sempre prima (progressScore più alto per
    // costruzione: totalLaps*n domina), poi chi è ancora in pista in
    // ordine di posizione corrente. totalTime resta null per questi ultimi
    // — il client mostra la posizione, non un tempo inventato.
    const finished = Object.values(game.players).filter(p => p.time !== null);
    const unfinished = Object.values(game.players).filter(p => p.time === null);

    // Chi non ha finito non resta senza tempo: si proietta il suo dal RITMO
    // che ha davvero tenuto (tempo trascorso diviso la frazione di gara
    // percorsa — estimateFinishTime, la stessa funzione che la qualifica usa
    // da sempre per lo stesso motivo). Non è una simulazione: è la sua misura
    // estesa fino al traguardo.
    //
    // Serve al campionato, dove una classifica con "non arrivato" al posto di
    // un tempo non si può sommare né rileggere a distanza di gare. La
    // POSIZIONE resta comunque quella vera, calcolata sul progresso: il tempo
    // proiettato non riordina nessuno, si limita a esistere.
    const n = game.track.points.length;
    const distanzaGara = game.track.totalLaps * n;
    const elapsed = game.raceTick * PHYSICS_TICK_MS;
    const stime = new Map();
    for (const p of unfinished) {
        // Stesse penalità di chi ha tagliato il traguardo: un pit stop non
        // fatto pesa 30 secondi anche se la gara ti ha colto in pista, se no
        // restare indietro conviene.
        stime.set(p.color, estimateFinishTime(elapsed, progressScore(p, game.track) / distanzaGara)
            + applicaPenalitaFineGara(p, game));
    }

    const podium = [
        ...finished.sort((a, b) => a.time - b.time),
        ...unfinished.sort((a, b) => progressScore(b, game.track) - progressScore(a, game.track))
    ].map(p => ({
        color: p.color,
        totalTime: p.time !== null ? p.time : stime.get(p.color),
        // Il client lo segna come proiezione invece di spacciarlo per un
        // tempo cronometrato.
        stimato: p.time === null,
        pitPenalty: !!p.pitPenalty, falseStart: !!p.falseStart,
        collisionPenaltyMs: p.collisionPenaltyMs || 0,
        // Servono alla premiazione: i primi tre vengono costruiti col loro
        // modello vero e la livrea personalizzata, chiesta per uid come nel
        // riepilogo della griglia.
        uid: p.uid || null,
        isBot: !!p.isBot,
    }));
    // isFinal = questa era l'ultima gara della sessione. Resta fisso a true
    // finché non arriva il campionato, dove una gara intermedia dovrà valere
    // false: lì la partita NON va chiusa, si prosegue verso la pista dopo.
    const isFinal = true;
    const isSingleMode = (game.settings || {}).mode === 'single';

    io.to(lobbyId).emit('f1RaceEnded', {
        podium,
        isFinal,
        isSingleMode,
        // Il client ci fa il conto alla rovescia del rientro automatico:
        // il valore ha un proprietario solo, ed è questo.
        returnMs: RACE_END_RETURN_MS,
        // Scansione della premiazione, come per la sequenza di griglia.
        cerimonia: {
            staccoMs: CER_STACCO_MS,
            scenaMs: CER_SCENA_MS,
            totaleMs: RACE_END_RETURN_MS,
        },
        trackName: game.track.name
    });

    // In multiplayer il podio riporta in lobby da solo, e il client non dice
    // niente al server: la sessione la chiude il server allo scadere di
    // quella finestra, senza dipendere da un messaggio che non arriverebbe
    // comunque se la scheda venisse chiusa. In modalità singola no — lì il
    // podio resta a schermo e "Riprova" riusa questa stessa partita, che
    // viene smontata dal pulsante "Torna alla Lobby".
    if (isFinal && !isSingleMode) {
        game.chiusuraTimeout = setTimeout(() => {
            // Identità, non presenza: se nel frattempo la lobby ha già
            // avviato un'altra gara, quella è una partita NUOVA e questo
            // timer non deve toccarla.
            if (activeGames.get(lobbyId) !== game) return;
            console.log(`🧹 [F1] Sessione conclusa, partita smontata (lobby ${lobbyId})`);
            chiudiPartita(io, lobbyId);
        }, RACE_END_RETURN_MS + RACE_END_TEARDOWN_MS);
    }
}

// ====================================================
// HELPERS
// ====================================================
function buildPublicState(players, raceStarted, track, game) {
    const out = {};

    // Classifica: calcolata solo a gara avviata (prima non ha senso, tutti fermi
    // allo spawn). ranked.indexOf è O(M) per giocatore ma M è al più 8 → irrilevante.
    // Ordine con isteresi (vedi stableRankOrder/RANK_SWAP_HYSTERESIS_M):
    // persistito su game.stableRankOrder tra una chiamata e l'altra, altrimenti
    // l'isteresi non avrebbe memoria di cosa preservare.
    let ranked = [];
    if (raceStarted) {
        const order = stableRankOrder(game.stableRankOrder, players, track);
        game.stableRankOrder = order;
        ranked = order.map(color => players[color]).filter(Boolean);
    }

    for (const [color, p] of Object.entries(players)) {
        // Vedi checkLap: nella finestra SECTOR_RECAP_DURATION_MS dopo un
        // giro chiuso si trasmette lo "scatto" del giro appena finito
        // (lapRecapSectorTimes) al posto dei dati — ancora azzerati — del
        // nuovo giro, così le barre restano visibili per qualche secondo
        // invece di sparire nello stesso istante in cui vengono calcolate.
        const sectorTimesDisplay = (game.phase === 'race' && p.lapRecapExpiresAtMs != null
            && (game.raceTick * PHYSICS_TICK_MS) < p.lapRecapExpiresAtMs)
            ? p.lapRecapSectorTimes
            : p.curLapSectorTimes;
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            trackIndex: p.trackIndex,
            speed: p.speed,
            steerInput: p.inputs?.steer ?? 0,
            finished: p.finished,
            time: p.time,
            // Tempo trascorso "vero" (conteggio di tick fisici, la STESSA
            // fonte usata per calcolare p.time a fine giro — vedi checkLap)
            // — il client lo usa per il timer HUD live invece di Date.now(),
            // altrimenti deriva dall'imprecisione di setInterval e non
            // combacia più col tempo finale mostrato a fine sessione (bug
            // segnalato dall'utente, Rif. 2026-08-07: due timer discordanti).
            elapsedMs: game.raceTick * PHYSICS_TICK_MS,
            lap: p.lap,
            position: raceStarted ? ranked.findIndex(r => r.color === color) + 1 : null,
            compound: p.compound,
            tyreWear: p.tyreWear,
            damage: p.damage,
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
                gripPct: Math.round((effectiveGrip(p, false) / effectiveGrip(p, true)) * 100),
                accelPct: Math.round((effectiveAccel(p, false) / effectiveAccel(p, true)) * 100),
                brakePct: Math.round((effectiveBrakeMult(p, false) / effectiveBrakeMult(p, true)) * 100),
                steerPct: Math.round((1 - getFrontWingSteerPenalty(p.damageParts)) * 100),
            },
            // Autopilota corsia box (entrata/uscita): velocità del
            // limitatore, non del giocatore — il client la usa per un
            // rumore motore fisso invece che legato all'accelerazione,
            // anche quando non è lui a "guidare" in quella fase.
            pitLimiter: !!p.pitAutoState,
            // Sosta obbligatoria fatta o no: il client ne ricava l'avviso in
            // HUD. Senza, la regola dei 30 secondi si scopriva solo nel
            // pannello finale, a penalità già presa (segnalato dall'utente il
            // 2026-08-17: primo in pista, ultimo in classifica).
            hasPitted: !!p.hasPitted,
            // falseStartServed: il client lo usa per nascondere il badge
            // "!" in classifica live una volta scontata la penalità ai box
            // (resta invece visibile, senza questo campo, nel riepilogo di
            // fine gara — record storico, non un avviso "da pagare").
            falseStart: !!p.falseStart,
            falseStartServed: !!p.falseStartServed,
            gapToLeaderMs: (p.gapToLeaderMs != null) ? p.gapToLeaderMs : null,
            // Settori/delta (Rif. docs/superpowers/specs/2026-08-07-f1-sector-timing-design.md):
            // solo in gara, mai in qualifica — vedi updateSectorTiming/checkLap.
            // Infinity (nessun record ancora) convertito esplicitamente in
            // null: non è JSON-safe e non deve dipendere da un dettaglio del
            // serializzatore socket.io per arrivare "pulito" al client.
            sectorTimes: (game.phase === 'race' && sectorTimesDisplay) ? sectorTimesDisplay : [null, null, null],
            prevSectorTimes: (game.phase === 'race') ? (p.prevLapSectorTimes || null) : null,
            bestSectorTimes: (game.phase === 'race' && game.bestSectorTimes)
                ? game.bestSectorTimes.map(t => (t === Infinity ? null : t))
                : [null, null, null],
            deltaToPreviousLapMs: (game.phase === 'race' && p.deltaToPreviousLapMs != null) ? p.deltaToPreviousLapMs : null,
            isBot: !!p.isBot,
            // Indice del box assegnato per questa gara (vedi
            // assignGridSpawns/TrackGeometry.pitBoxAnchors) — il client lo
            // usa per posizionare il modello 3D del box di questo pilota
            // (frontend/f1.js, loadPlayerPitBox).
            pitBoxSlot: (p.pitBoxSlot != null) ? p.pitBoxSlot : null,
            // Anchor {x,z,tx,tz} già calcolato server-side (assignGridSpawns
            // → TrackGeometry.pitBoxAnchors): il client lo usa direttamente
            // per posizionare/ruotare il modello 3D del box (frontend/f1.js,
            // loadPlayerPitBox), invece di ricalcolarlo da pitBoxSlot +
            // conteggio giocatori LATO CLIENT — quel conteggio poteva
            // disallinearsi da game.grid.length dopo una rimozione a gara in
            // corso (game.grid non viene mai potato), causando box
            // disegnati nel punto sbagliato o un accesso fuori indice che
            // mandava in eccezione l'handler f1StateUpdate (vedi review
            // finale). pitBoxSlot resta comunque, utile per debug/HUD.
            pitBoxAnchor: p.pitBoxAnchor || null,
            // uid Firebase del giocatore (null per ospiti/bot): il client lo
            // usa per recuperare la LIVREA VERA di ogni avversario via
            // GET /api/livery/:uid, invece di riapplicare la propria a tutti
            // (vedi frontend/f1.js, loadOtherCar) — bug reale osservato con
            // più giocatori umani in lobby.
            uid: p.uid || null,
            slipstream: !!p.inSlipstream,
            collisionPenalty: p.collisionPenaltyMs > 0,
            // Snapshot delle decisioni IA del tick corrente (Rif.
            // docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md),
            // popolato SOLO per i bot da updateBotInputs — mai ricalcolato
            // qui, solo inoltrato. null per i giocatori umani (p._botDebug
            // non esiste per loro).
            botDebug: p._botDebug || null
        };
    }
    return out;
}

function resetPlayers(game) {
    let i = 0;
    game.bestSectorTimes = [Infinity, Infinity, Infinity];
    for (const p of Object.values(game.players)) {
        const spawn = game.track.gridSpawnPoint(i);
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        p.curLapCurve = null; p.prevLapCurve = null;
        p.curLapSectorTimes = [null, null, null]; p.prevLapSectorTimes = null;
        p.deltaToPreviousLapMs = null; p.lapTrulyStarted = false;
        p.lapRecapSectorTimes = null; p.lapRecapExpiresAtMs = null;
        p.pendingFinishTime = null;
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
    SECTOR1_REL_IDX, SECTOR2_REL_IDX, SECTOR_RECAP_DURATION_MS, fillGaps,
    effectiveMaxSpeed, effectiveAccel, effectiveBrakeMult, corneringCapacity, updateVelocity, integratePosition,
    applyOffTrackDrag, applyBarrier, updateTrackIndex,
    circularWithin, checkpointWindowFor, finishWindowFor,
    assignGridSpawns, resetPlayers,
    MIN_COLLISION_SEVERITY, DAMAGE_CAP_PER_HIT, COLLISION_PENALTY_CAP_MS,
    collisionDamageAmount, applyCarCollisionDamage, applyBarrierDamage, applyCollisionPenalty,
    resolveCollisions,
    applyDamageSteerNoise, DAMAGE_STEER_NOISE_MAX, effectiveGrip,
    createDamageParts, FRONT_WING_STEER_PENALTY_MAX,
    getEnginePowerPenalty, getFloorGripPenalty, getFrontWingSteerPenalty, getSuspensionNoise,
    buildPublicState, playersVisibleTo, startPitLaneEntry, inPitEntryZone, checkLap, updateSectorTiming, finalizeSessionFinish, resolvePendingFinish,
    computeSlipstreamMult,
    updatePitAutopilot, PIT_AUTO_SPEED, PIT_AUTO_ARRIVE_DIST,
    handlePitReactionPress, startPitStop, durataPerEsito, addLaneIndices, pianoIngressoDi,
    PIT_DURATA_PERFETTA, PIT_DURATA_BUONA, PIT_DURATA_LENTA, PIT_LATENZA_MAX_MS
};

module.exports.tickGame = tickGame;
module.exports.TYRE_COMPOUNDS = TYRE_COMPOUNDS;
// Ciclo di vita della partita, esposto ai test del rientro in lobby.
module.exports.endRace = endRace;
module.exports.endQualifying = endQualifying;
module.exports.chiudiPartita = chiudiPartita;
module.exports.RACE_END_RETURN_MS = RACE_END_RETURN_MS;
