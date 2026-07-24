//
// Bot IA per riempire la griglia F1 fino a MAX_GRID_SIZE piloti totali.
// Un bot produce SOLO input (throttle/brake/steer), scritti in p.inputs
// esattamente come farebbe l'evento f1Input di un umano: nessuna via
// privilegiata su posizione/velocità. Fisica, collisioni, usura gomme,
// pit-lane trigger, lap counting restano quelli esistenti in
// f1GameSocket.js, invariati e riusati as-is.
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');

// Palette colori — DEVE restare in sync con frontend/index.js →
// availableColors: i colori sono l'identità del giocatore su tutta la
// piattaforma, non solo in F1.
const PALETTE = [
    '#E74C3C', '#3498DB', '#2ECC71', '#F1C40F',
    '#9B59B6', '#E67E22', '#00BCD4', '#FF4081',
    '#795548', '#CDDC39', '#4B0082', '#455A64'
];

const MAX_GRID_SIZE = 6;   // umani + bot totali per gara

// ====================================================
// GUIDA — pure pursuit per lo sterzo, velocità in curva calcolata dalla
// FISICA REALE del gioco (non più soglie in gradi indovinate a occhio: i
// tentativi precedenti — mai verificabili senza un browser reale — hanno
// prodotto bot ora fuori pista ora troppo lenti su tutto il giro, non solo
// nelle curve). Lo sterzo ha un tasso di rotazione massimo (vedi
// TURN_SPEED_LOW/HIGH in f1GameSocket.js): il raggio di curva che un'auto
// riesce davvero a percorrere a velocità v è raggio = v / tassoDiSterzata.
// Da qui si ricava ESATTAMENTE la velocità massima possibile per una curva
// di raggio noto, con lo stesso identico limite fisico che vale per un
// giocatore umano — vedi cornerTargetSpeed più sotto.
// ====================================================
// Guadagno alto apposta: satura lo sterzo a fondo già per scarti angolari
// moderati (~1/3.0 rad ≈ 19°), per correggere in modo deciso quando il bot
// non è già ben allineato alla linea (es. dopo un urto).
const BOT_STEER_GAIN = 3.0;
// Margine di sicurezza sul limite fisico esatto: la velocità reale (vx/vz)
// insegue l'angolo con un filtro (GRIP<1 in updateVelocity, non
// istantaneo), quindi il raggio davvero percorso è un po' più ampio di
// quello puramente geometrico — un margine copre lo scarto senza dover
// indovinare quanto sia stretta ciascuna curva.
const BOT_CORNER_SPEED_MARGIN = 0.99;

function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

// Sterzo (-1..1) per puntare dalla posizione attuale (px,pz), con heading
// `angle` (stessa convenzione della fisica: vettore = (sin(angle),
// cos(angle))), verso il punto (tx,tz).
function steerToward(px, pz, angle, tx, tz) {
    const dx = tx - px, dz = tz - pz;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
    const desired = Math.atan2(dx, dz);
    const diff = normalizeAngle(desired - angle);
    return Math.max(-1, Math.min(1, diff * BOT_STEER_GAIN));
}

// Indice campionato `lookaheadSamples` avanti (con wrap) rispetto a
// currentIdx, su un loop di `n` campioni.
function lookaheadIndex(n, currentIdx, lookaheadSamples) {
    return ((currentIdx + lookaheadSamples) % n + n) % n;
}

// ====================================================
// TAGLIO CURVE — un bot che segue sempre il centro pista percorre un
// raggio più stretto di quello che un pilota vero ottiene tagliando verso
// l'apice: dato che la velocità in curva è proporzionale al raggio (vedi
// cornerTargetSpeed), seguire sempre il centro costa velocità reale, non
// solo stile — causa concreta del distacco osservato su piste con curve
// strette. apexOffset sposta il punto mirato dallo sterzo verso l'INTERNO
// della curva (mai verso l'esterno: sarebbe uscire di pista, non tagliare),
// in proporzione a quanto è stretta la curva lì, entro il limite di
// BOT_APEX_MAX_FRACTION della mezza larghezza pista (mai fino al bordo).
// ====================================================
const BOT_APEX_REF_ANGLE     = Math.PI / 6;   // 30° sulla finestra locale: oltre, taglio già al massimo consentito
const BOT_APEX_MAX_FRACTION  = 0.85;          // frazione massima della mezza larghezza pista di cui ci si sposta verso l'interno

// Offset {dx,dz} da sommare al punto mirato in idx, verso l'interno della
// curva locale (stimata confrontando la tangente `halfWindowSamples` prima
// e dopo idx). {0,0} in rettilineo. Il verso interno/esterno si deduce dal
// segno della curvatura: se la pista gira verso l'angolo crescente (destra
// nella convenzione atan2(tx,tz) di questo file), l'interno è dal lato
// OPPOSTO alla normale di TrackGeometry.normalAt (che punta sempre allo
// stesso lato fisso, non verso l'interno di una curva specifica).
function apexOffset(points, idx, halfWindowSamples, maxOffsetM) {
    const n = points.length;
    const before = ((idx - halfWindowSamples) % n + n) % n;
    const after  = lookaheadIndex(n, idx, halfWindowSamples);
    const t1 = TrackGeometry.tangentAt(points, before, true);
    const t2 = TrackGeometry.tangentAt(points, after, true);
    const angle1 = Math.atan2(t1.tx, t1.tz);
    const angle2 = Math.atan2(t2.tx, t2.tz);
    const turnSigned = normalizeAngle(angle2 - angle1);
    if (turnSigned === 0) return { dx: 0, dz: 0 };
    const severity = Math.min(1, Math.abs(turnSigned) / BOT_APEX_REF_ANGLE);
    const insideSign = turnSigned > 0 ? -1 : 1;
    const normal = TrackGeometry.normalAt(points, idx, true);
    const mag = severity * maxOffsetM * insideSign;
    return { dx: normal.nx * mag, dz: normal.nz * mag };
}

// ====================================================
// RAGGIO IN UNA FINESTRA — helper puro condiviso: la stessa formula
// arco/angolo era duplicata identica in apexOffset e cornerTargetSpeed;
// estratta qui perché cornerApexNear (vedi sotto) e cornerTargetSpeed devono
// misurare la curvatura nello stesso identico modo — sterzo e freno non
// devono mai vedere due stime diverse della stessa curva.
// ====================================================
function windowRadius(points, i1, i2, localArcM) {
    const t1 = TrackGeometry.tangentAt(points, i1, true);
    const t2 = TrackGeometry.tangentAt(points, i2, true);
    const angle1 = Math.atan2(t1.tx, t1.tz);
    const angle2 = Math.atan2(t2.tx, t2.tz);
    const turnSigned = normalizeAngle(angle2 - angle1);
    if (Math.abs(turnSigned) < 1e-4) return null;   // praticamente dritto
    return { radius: localArcM / Math.abs(turnSigned), turnSigned };
}

// ====================================================
// APICE PIÙ VICINO — trova la curva più VICINA a un punto dato (non la più
// stretta in un orizzonte lungo: una versione che cercasse il raggio minimo
// assoluto su una distanza ampia rischierebbe di agganciarsi a un tornante
// lontano invece della curva che il bot sta davvero affrontando ora — vedi
// spec, caso chicane). Cammina da idx verso la prima finestra con curvatura
// significativa (in entrambe le direzioni), poi prosegue in quella direzione
// finché il raggio continua a diminuire: il punto in cui smette di scendere
// è il minimo locale, cioè l'apice di QUELLA curva.
// ====================================================
function cornerApexNear(points, idx, searchSamples, localSamples, metersPerSample) {
    const n = points.length;
    const step = Math.max(1, Math.floor(localSamples / 2));
    const localArcM = localSamples * metersPerSample;
    const halfLocal = Math.floor(localSamples / 2);

    function windowAt(offsetSamples) {
        const i1 = lookaheadIndex(n, idx, offsetSamples);
        const i2 = lookaheadIndex(n, idx, offsetSamples + localSamples);
        const w = windowRadius(points, i1, i2, localArcM);
        return w ? w.radius : null;
    }

    let startOffset = null;
    let startRadius = null;
    let direction = 1;
    for (let d = 0; d <= searchSamples; d += step) {
        const fwd = windowAt(d);
        if (fwd !== null) { startOffset = d; startRadius = fwd; direction = 1; break; }
        if (d > 0) {
            const back = windowAt(-d);
            if (back !== null) { startOffset = -d; startRadius = back; direction = -1; break; }
        }
    }
    if (startOffset === null) return null;   // nessuna curvatura significativa nel raggio di ricerca

    let bestOffset = startOffset;
    let bestRadius = startRadius;
    let cursor = startOffset;
    while (true) {
        const nextOffset = cursor + direction * step;
        const nextRadius = windowAt(nextOffset);
        if (nextRadius === null || nextRadius >= bestRadius) break;
        bestRadius = nextRadius;
        bestOffset = nextOffset;
        cursor = nextOffset;
    }

    const apexIdx = lookaheadIndex(n, idx, bestOffset + halfLocal);
    return { apexIdx, apexRadius: bestRadius, distanceToApexM: (bestOffset + halfLocal) * metersPerSample };
}

// Velocità bersaglio "fisica": resta al massimo (maxSpeed) finché nessuna
// curva nel raggio di scansione impone ancora di iniziare a frenare;
// scende alla velocità massima percorribile dalla curva più vincolante non
// appena la distanza rimanente è pari o inferiore alla distanza di frenata
// REALMENTE necessaria per arrivarci a quella velocità (dalla fisica di
// frenata del gioco: v0²−v1² = 2·decelerazione·distanza — non un tempo di
// anticipo indovinato).
// `localSamples` è la finestra con cui si MISURA quanto è stretta la
// curva in un punto (corta, caratterizza la geometria), `scanSamples` è
// fin dove cercare (lungo, per non scoprire un tornante troppo tardi) —
// restano separati: confrontare solo l'inizio e la fine di una scansione
// lunga confonderebbe una curva dolce spalmata su tanta distanza con un
// tornante stretto. Si scansiona `scanSamples` avanti con finestre locali
// sovrapposte (passo = metà di `localSamples`) e, per ogni curva trovata,
// si valuta se la distanza rimanente basta ancora per non dover già
// frenare.
function cornerTargetSpeed(points, idx, scanSamples, localSamples, metersPerSample, currentSpeed, maxSpeed, brakeDecel, turnRateAtMax, marginFactor) {
    const n = points.length;
    const step = Math.max(1, Math.floor(localSamples / 2));
    const localArcM = localSamples * metersPerSample;
    let target = maxSpeed;
    for (let offset = 0; offset <= scanSamples; offset += step) {
        const i1 = lookaheadIndex(n, idx, offset);
        const i2 = lookaheadIndex(n, idx, offset + localSamples);
        const w = windowRadius(points, i1, i2, localArcM);
        if (!w) continue;   // praticamente dritto, nessun raggio significativo da questa finestra
        const cornerSpeed = Math.min(maxSpeed, w.radius * turnRateAtMax * marginFactor);
        if (cornerSpeed >= currentSpeed) continue;   // già più lenti del necessario per questa curva
        const distanceM = offset * metersPerSample;
        const neededBrakingM = (currentSpeed * currentSpeed - cornerSpeed * cornerSpeed) / (2 * brakeDecel);
        if (distanceM <= neededBrakingM && cornerSpeed < target) target = cornerSpeed;
    }
    return target;
}

// ====================================================
// SORPASSO — un bot che si limita a rallentare dietro un'auto più lenta
// non la supera mai: la "skill" di qualifica diventava una posizione
// fissa per tutta la gara. Quando il bot ha un vero margine di velocità
// libera sull'auto che precede, scarta lateralmente per superarla invece
// di limitarsi a rallentare (vedi updateBotInputs).
// ====================================================
// Da che lato passare: si proietta la posizione REALE dell'auto che
// precede (non il centro pista) sulla normale nel suo trackIndex, per
// sapere da che lato di centro pista si trova, e si punta al lato
// OPPOSTO — se è vicina al centro (nessun lato chiaro), si usa
// `sideFallback` (preferenza fissa del bot, assegnata alla creazione) per
// spareggiare.
function overtakeOffset(points, aheadIdx, aheadX, aheadZ, roadHalf, overtakeFraction, sideFallback) {
    const centerPt = points[aheadIdx];
    const normal = TrackGeometry.normalAt(points, aheadIdx, true);
    const dx = aheadX - centerPt.x, dz = aheadZ - centerPt.z;
    const aheadLateral = dx * normal.nx + dz * normal.nz;
    const side = Math.abs(aheadLateral) < 0.5 ? sideFallback : -Math.sign(aheadLateral);
    const mag = roadHalf * overtakeFraction * side;
    return { dx: normal.nx * mag, dz: normal.nz * mag };
}

// Distanza (in metri, lungo il verso di marcia, con wrap di giro) e
// riferimento all'auto più vicina DAVANTI a p, tra tutti i players
// passati — ignora chi è finito/ai box/in autopilota (non un ostacolo "in
// pista" da seguire/superare). null se nessuno è abbastanza vicino avanti.
function nearestAheadPlayer(p, allPlayers, track) {
    const n = track.points.length;
    const metersPerSample = track.lapLength / n;
    let best = null, bestGap = Infinity;
    for (const q of allPlayers) {
        if (q === p || q.finished || q.pitting || q.pitAutoState) continue;
        const delta = (((q.trackIndex || 0) - (p.trackIndex || 0)) % n + n) % n;
        const gapM = delta * metersPerSample;
        if (gapM < bestGap) { bestGap = gapM; best = q; }
    }
    return best ? { player: best, gapM: bestGap } : null;
}

// ====================================================
// STRATEGIA GOMME POST PIT-STOP
// Pochi giri restanti: la durata non conta più, meglio la mescola più
// veloce (Soft). Molti giri restanti: meglio quella che dura di più
// (Hard), altrimenti un compromesso (Medium).
// ====================================================
function pickPostPitCompound(remainingLaps, wearLapsAtMedium) {
    if (remainingLaps <= 2) return 'soft';
    if (remainingLaps <= wearLapsAtMedium) return 'medium';
    return 'hard';
}

// ====================================================
// TEMPO SIMULATO A FINE SESSIONE
// Qualifica/gara chiudono non appena tutti gli UMANI connessi hanno
// finito (i bot non bloccano più la chiusura). Un bot ancora in pista in
// quel momento non deve comparire come "nessun tempo": si stima un tempo
// plausibile estrapolando dal proprio ritmo osservato fin lì (tempo
// trascorso diviso frazione di sessione completata).
// ====================================================
const SIMULATED_MIN_PROGRESS = 0.05;   // pavimento anti-estrapolazione assurda per chi si è mosso pochissimo

function estimateFinishTime(elapsedMs, progressFraction) {
    const p = Math.max(SIMULATED_MIN_PROGRESS, Math.min(1, progressFraction));
    return Math.round(elapsedMs / p);
}

// ====================================================
// ASSEGNAZIONE COLORI BOT
// ====================================================
function pickBotColors(humanColors, count, rng = Math.random) {
    const taken = new Set(humanColors.map(c => c.toUpperCase()));
    const pool = PALETTE.filter(c => !taken.has(c));
    const n = Math.min(count, pool.length);
    const picked = [];
    for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * pool.length);
        picked.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return picked;
}

// ====================================================
// CREAZIONE BOT — fissa al primo joinF1Game della lobby (creazione del
// game object): eventuali umani disconnessi a gara in corso NON vengono
// sostituiti da un bot (riempimento singolo, non dinamico).
// ====================================================
// Range 0.8..1.0 (non oltre 1.0): la velocità reale è comunque limitata da
// effectiveMaxSpeed, quindi un fattore >1.0 non produceva alcuna differenza
// osservabile in rettilineo (sempre a tutto gas contro lo stesso tetto) —
// tutta la variabilità reale finiva compressa nella sola metà 0.85..1.0,
// che contribuiva ai bot "tutti uguali" in gruppo (effetto trenino).
const BOT_SPEED_FACTOR_MIN    = 0.8,  BOT_SPEED_FACTOR_MAX    = 1.0;
const BOT_PRECISION_NOISE_MIN = 0,    BOT_PRECISION_NOISE_MAX = 0.25;   // rad aggiunti/tolti allo sterzo
const BOT_PIT_THRESHOLD_MIN   = 60,   BOT_PIT_THRESHOLD_MAX   = 80;     // % usura gomme a cui il bot decide di entrare ai box
// botSpeedFactor è fisso per tutta la gara: da solo produce una griglia
// già ordinata per ritmo (chi parte davanti è sempre il più veloce), quasi
// nessun sorpasso tra bot per tutta la gara — richiesto esplicitamente
// dall'utente. Un moltiplicatore ri-estratto ad ogni giro (giorno buono/
// giorno storto, come un pilota vero) rompe l'ordine statico anche a
// parità di usura gomme/strategia.
const BOT_LAP_PACE_VARIANCE   = 0.04;   // ±4% di variazione di ritmo da un giro all'altro

function randRange(min, max, rng) {
    return min + rng() * (max - min);
}

function createBots(game, lobby, TYRE_COMPOUNDS, rng = Math.random) {
    const botsEnabled = !game.settings || game.settings.botsEnabled !== 'false';
    if (!botsEnabled) return;

    const humanColors = (lobby && (lobby.lockedPlayers || lobby.players)) || [];
    const botsNeeded = MAX_GRID_SIZE - humanColors.length;
    if (botsNeeded <= 0) return;

    const colors = pickBotColors(humanColors, botsNeeded, rng);
    const compoundKeys = Object.keys(TYRE_COMPOUNDS);

    for (const color of colors) {
        game.players[color] = {
            color,
            x: game.track.qualiSpawn.x, z: game.track.qualiSpawn.z, angle: game.track.qualiSpawn.angle,
            speed: 0, vx: 0, vz: 0,
            inputs:          { throttle: 0, brake: 0, steer: 0 },
            finished:        false,
            time:            null,
            lap:             0,
            checkpointA:     false,
            inFinishZone:    false,
            disconnected:    false,
            trackIndex:      0,
            compound:        compoundKeys[Math.floor(rng() * compoundKeys.length)],
            tyreWear:        0,
            pitting:         false,
            pitPhase:        null,
            pitGoTime:       null,
            pitGoTimer:      null,
            pendingCompound: null,
            hasPitted:       false,
            pitPenalty:      false,
            falseStart:      false,
            falseStartServed: false,
            gapToLeaderMs:   null,
            pitAutoState:    null,
            pitPathIndex:    0,
            inSlipstream:    false,
            // --- campi solo-bot ---
            isBot:                  true,
            botSpeedFactor:         randRange(BOT_SPEED_FACTOR_MIN, BOT_SPEED_FACTOR_MAX, rng),
            botPrecisionNoise:      randRange(BOT_PRECISION_NOISE_MIN, BOT_PRECISION_NOISE_MAX, rng),
            botPitThreshold:        randRange(BOT_PIT_THRESHOLD_MIN, BOT_PIT_THRESHOLD_MAX, rng),
            botHeadingToPits:       false,
            botPitReactionScheduled: false,
            botOvertakeSide:        rng() < 0.5 ? 1 : -1,   // spareggio quando l'auto da superare è vicina al centro pista
            botLapSeen:             0,
            botLapPaceMult:         randRange(1 - BOT_LAP_PACE_VARIANCE, 1 + BOT_LAP_PACE_VARIANCE, rng)
        };
        // Auto-conferma la mescola: riusa il gate esistente in f1TyreChoice
        // (game.tyreConfirmed.size >= Object.keys(game.players).length),
        // nessuna logica nuova da scrivere per la fase tyre_select.
        game.tyreConfirmed.add(color);
    }
}

// ====================================================
// GUIDA PER TICK — chiamata una volta per tick da tickGame, per TUTTI i
// bot (anche quelli fermi ai box o guidati dall'autopilota, per gestire
// la reazione al minigioco pit-stop). Scrive solo p.inputs (throttle/
// brake/steer): la fisica/collisioni/pit-lane restano quelle esistenti.
// ====================================================
// Lookahead in METRI ma proporzionale alla velocità reale del bot (secondi
// di anticipo × velocità), non un valore fisso: un valore fisso tarato a
// bassa velocità (es. 18-40m) diventa una frazione di secondo ad alta
// velocità (le auto superano i 90 m/s) — troppo poco per accorgersi di una
// curva stretta in tempo per frenare, causa reale di uscite di pista molto
// frequenti osservate in playtest. Il punto mirato dallo sterzo resta un
// anticipo breve (tracciamento preciso della linea), la curvatura — che
// decide QUANDO iniziare a rallentare — guarda molto più avanti apposta,
// perché la conseguenza di guardare troppo poco è frenare troppo tardi.
const BOT_LOOKAHEAD_TIME_S           = 0.6;   // s di anticipo per il punto mirato dallo sterzo
const BOT_LOOKAHEAD_MIN_M            = 10;
// Finestra con cui si MISURA quanto è stretta una curva — fissa, non
// proporzionale alla velocità: caratterizza la geometria della pista in
// quel punto, non la distanza di frenata (calcolata dalla fisica reale in
// updateBotInputs, non più un tempo di anticipo indovinato).
const BOT_CURVATURE_LOCAL_M          = 12;
// Margine sulla distanza di frenata calcolata dalla fisica: oltre il
// margine "matematico" già insito nel calcolo (v0²−v1²=2·decel·distanza),
// un 20% extra copre l'imprecisione del rilevamento a campioni discreti.
const BOT_BRAKING_DISTANCE_MARGIN    = 1.2;
const BOT_SPEED_MARGIN          = 0.03;  // isteresi throttle/brake attorno alla velocità target
const BOT_PIT_REACTION_MIN_MS   = 150;
const BOT_PIT_REACTION_MAX_MS   = 700;

// Distanza di scia: senza questo, più bot che seguono la stessa linea di
// corsa e frenano/accelerano secondo la stessa curvatura convergono a
// velocità quasi identiche nello stesso punto pista, risultando in gruppetti
// che si muovono "in blocco" (effetto trenino osservato in playtest). Un bot
// che si accorge di un'altra auto entro BOT_FOLLOW_GAP_M subito avanti lungo
// il tracciato rallenta proporzionalmente, invece di tallonarla identico.
const BOT_FOLLOW_GAP_M        = 15;
const BOT_FOLLOW_MIN_FRACTION = 0.55;   // frazione minima di velocità quando si è praticamente addosso a chi precede
// Sorpasso: entro BOT_FOLLOW_GAP_M, se il bot avrebbe margine di velocità
// libera vero sull'auto che precede (non solo momentaneo, es. lei in
// frenata per una curva) tenta di superarla scartando di lato invece di
// limitarsi a rallentare — altrimenti la "skill" di qualifica diventa una
// posizione fissa per tutta la gara, nessun sorpasso si verifica mai.
const BOT_OVERTAKE_PACE_MARGIN = 1.05;   // serve almeno il 5% di velocità libera in più per tentare
const BOT_OVERTAKE_FRACTION    = 0.55;   // quanto ci si sposta lateralmente (frazione della mezza larghezza pista)
// Il sorpasso si somma allo spazio pista già "consumato" dal taglio curva
// (apexOffset): tentarlo mentre si è già in curva stretta può superare la
// larghezza pista reale e mandare il bot fuori — segnalato in playtest.
// Si tenta solo se la curvatura locale (misurata dallo stesso apexOffset
// già calcolato per lo sterzo) è sotto questa frazione del taglio massimo,
// cioè su rettilinei o curve dolci — come farebbe un pilota vero.
const BOT_OVERTAKE_MAX_CORNER_SEVERITY = 0.4;

function metersToSamples(meters, track) {
    return Math.max(1, Math.round(meters * track.points.length / track.lapLength));
}

// Distanza (in metri, lungo il verso di marcia, con wrap di giro) fino
// p.speed è lo scalare interno di fisica; stessa conversione a m/s già
// usata altrove nel gioco per i km/h a schermo (speed*55) e per il
// distacco dal leader (speed*55/3.6) — vedi f1GameSocket.js.
function botSpeedMs(speed) {
    return Math.abs(speed) * 55 / 3.6;
}

// Margini di taratura resi configurabili (invece di sole costanti di modulo)
// per poter confrontare, da uno strumento esterno (vedi
// backend/tools/f1LapSimulator.js), "margini di oggi" vs "margini rilassati"
// sulla stessa pista senza editare questo file. Il call site in
// f1GameSocket.js non passa mai `deps.tuning`, quindi il comportamento in
// partita resta identico a prima di questo cambiamento.
const DEFAULT_TUNING = {
    cornerSpeedMargin:     BOT_CORNER_SPEED_MARGIN,
    apexMaxFraction:       BOT_APEX_MAX_FRACTION,
    brakingDistanceMargin: BOT_BRAKING_DISTANCE_MARGIN
};

function updateBotInputs(game, deps) {
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh, tuning: tuningOverrides
    } = deps;
    const tuning = { ...DEFAULT_TUNING, ...(tuningOverrides || {}) };
    const track = game.track;
    const isQuali = game.phase === 'qualifying';
    const metersPerSample = track.lapLength / track.points.length;
    const brakeDecel = accel * brakeMult;   // stessa decelerazione di frenata usata dalla fisica reale

    for (const p of Object.values(game.players)) {
        if (!p.isBot || p.finished) continue;

        // Ri-estrae il ritmo del giro ad ogni cambio di p.lap (giorno
        // buono/giorno storto, come un pilota vero) — rompe l'ordine
        // altrimenti statico di una griglia già ordinata per ritmo fisso.
        if (p.lap !== p.botLapSeen) {
            p.botLapSeen = p.lap;
            p.botLapPaceMult = 1 + (Math.random() * 2 - 1) * BOT_LAP_PACE_VARIANCE;
        }

        // Fermo ai box o guidato dall'autopilota corsia box: nessun input
        // di guida da scrivere, il server ha già il volante. L'unica cosa
        // che un bot deve ancora fare qui è "premere" il minigioco di
        // reazione al segnale di via, con un ritardo simulato realistico.
        if (p.pitAutoState || p.pitting) {
            p.botHeadingToPits = false;
            if (p.pitPhase === 'waiting') p.botPitReactionScheduled = false;
            if (p.pitting && p.pitPhase === 'go' && !p.botPitReactionScheduled) {
                p.botPitReactionScheduled = true;
                const t = p.botPrecisionNoise / BOT_PRECISION_NOISE_MAX;
                const delay = BOT_PIT_REACTION_MIN_MS + t * (BOT_PIT_REACTION_MAX_MS - BOT_PIT_REACTION_MIN_MS);
                setTimeout(() => handlePitReactionPress(io, lobbyId, game, p), delay);
            }
            continue;
        }

        // Soglia usura superata (solo in gara, l'usura non conta in
        // quali): il bot punta al distacco della corsia box invece che
        // alla linea principale — appena entra nel trigger d'ingresso
        // (inPitEntryZone, già controllato per tutti in tickGame), il
        // server prende il volante come farebbe con un umano.
        if (game.phase === 'race' && !p.botHeadingToPits && p.tyreWear >= p.botPitThreshold) {
            p.botHeadingToPits = true;
            const remainingLaps = Math.max(0, track.totalLaps - p.lap);
            p.pendingCompound = pickPostPitCompound(remainingLaps, wearLapsAtMedium);
        }

        let steer, throttle = 0, brake = 0;
        if (p.botHeadingToPits) {
            const target = track.pitPath[0];
            steer = steerToward(p.x, p.z, p.angle, target.x, target.z);
            throttle = 0.6;   // rallenta in ingresso corsia box
        } else {
            const maxSpeed = effectiveMaxSpeed(p, isQuali);
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
            const lookM    = Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * BOT_LOOKAHEAD_TIME_S);
            const lookSamples  = metersToSamples(lookM, track);
            const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
            const targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
            const target = track.points[targetIdx];
            const apex = apexOffset(track.points, targetIdx, localSamples, track.roadHalf * tuning.apexMaxFraction);
            steer = steerToward(p.x, p.z, p.angle, target.x + apex.dx, target.z + apex.dz);

            // Distanza di scansione = il caso peggiore possibile: da tutto
            // gas a quasi fermo con la vera decelerazione di frenata del
            // gioco — oltre questa distanza nessuna curva può comunque
            // imporre di frenare adesso, quindi non serve cercare più
            // lontano (niente "quanti secondi di anticipo" indovinati).
            const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * tuning.brakingDistanceMargin;
            const scanSamples = metersToSamples(scanM, track);

            let targetSpeed = cornerTargetSpeed(
                track.points, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, tuning.cornerSpeedMargin
            ) * p.botSpeedFactor * p.botLapPaceMult;

            // Solo in gara: in qualifica ogni pilota corre isolato (un vero
            // giro veloce, anche visivamente ognuno vede solo se stesso —
            // vedi playersVisibleTo in f1GameSocket.js), rallentare per un
            // altro bot vicino durante il giro secco non avrebbe senso e
            // contribuiva a tempi di qualifica troppo lenti.
            if (!isQuali) {
                const ahead = nearestAheadPlayer(p, Object.values(game.players), track);
                if (ahead && ahead.gapM < BOT_FOLLOW_GAP_M) {
                    // Margine di velocità VERO (target fisico, non lo
                    // scalare istantaneo dell'auto che precede — potrebbe
                    // star frenando per una curva in quel preciso istante):
                    // solo se il bot avrebbe davvero un ritmo superiore
                    // tenta il sorpasso, altrimenti resta dietro sicuro.
                    // In curva stretta lo spazio è già "occupato" dal
                    // taglio (apex): niente sorpasso lì, solo su rettilinei
                    // o curve dolci (stessa logica di un pilota vero).
                    const apexMag = Math.hypot(apex.dx, apex.dz);
                    const cornerIsMild = apexMag < track.roadHalf * tuning.apexMaxFraction * BOT_OVERTAKE_MAX_CORNER_SEVERITY;
                    if (cornerIsMild && targetSpeed > ahead.player.speed * BOT_OVERTAKE_PACE_MARGIN) {
                        const overtake = overtakeOffset(
                            track.points, ahead.player.trackIndex || 0, ahead.player.x, ahead.player.z,
                            track.roadHalf, BOT_OVERTAKE_FRACTION, p.botOvertakeSide
                        );
                        steer = steerToward(p.x, p.z, p.angle, target.x + overtake.dx, target.z + overtake.dz);
                    } else {
                        const closeness = 1 - ahead.gapM / BOT_FOLLOW_GAP_M;   // 0 = al limite, 1 = praticamente addosso
                        targetSpeed *= 1 - closeness * (1 - BOT_FOLLOW_MIN_FRACTION);
                    }
                }
            }

            if (p.speed < targetSpeed * (1 - BOT_SPEED_MARGIN)) throttle = 1;
            else if (p.speed > targetSpeed * (1 + BOT_SPEED_MARGIN)) brake = 1;
        }

        steer += (Math.random() * 2 - 1) * p.botPrecisionNoise;
        steer = Math.max(-1, Math.min(1, steer));

        p.inputs = { throttle, brake, steer };
    }
}

module.exports = {
    PALETTE, MAX_GRID_SIZE, DEFAULT_TUNING,
    normalizeAngle, steerToward, lookaheadIndex, apexOffset, windowRadius, cornerApexNear, cornerTargetSpeed, overtakeOffset,
    nearestAheadPlayer, pickPostPitCompound, pickBotColors, estimateFinishTime,
    createBots, updateBotInputs
};
