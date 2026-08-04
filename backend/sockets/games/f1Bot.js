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

// Esponente di scala tra corneringCapacity (moltiplicatore relativo alla
// capacità laterale, tarato come termine di corneringExcess — MAI
// validato come moltiplicatore diretto di una velocità) e cornerTargetSpeed
// (limite cinematico di tasso di sterzata, non di accelerazione laterale):
// assumere una proporzionalità 1:1 tra i due è una scelta di design, non
// un fatto derivato (un vero limite v=√(a_lat×r) scalerebbe con la radice,
// non linearmente). Valore di partenza 1 (proporzionalità diretta),
// verificato via simulazione headless prima del playtest — stesso stile
// di DOWNFORCE_EXPONENT/CORNERING_EXPONENT in AerodynamicsModel.js/
// TyreForceModel.js. Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md.
const BOT_GRIP_CAPACITY_EXPONENT = 1;


function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

// Sterzo (-1..1) per puntare dalla posizione attuale (px,pz), con heading
// `angle` (stessa convenzione della fisica: vettore = (sin(angle),
// cos(angle))), verso il punto (tx,tz). `gain` opzionale (default
// BOT_STEER_GAIN, comportamento invariato): la racing line precalcolata
// (vedi updateBotInputs) porta il proprio steerGain ottimizzato per pista,
// diverso dalla costante fissa usata dal calcolo geometrico a runtime.
function steerToward(px, pz, angle, tx, tz, gain = BOT_STEER_GAIN) {
    const dx = tx - px, dz = tz - pz;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
    const desired = Math.atan2(dx, dz);
    const diff = normalizeAngle(desired - angle);
    return Math.max(-1, Math.min(1, diff * gain));
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
// strette. apexOffset (sotto) sposta il punto mirato dallo sterzo con un
// vero andamento fuori-dentro-fuori, entro il limite di BOT_APEX_MAX_FRACTION
// della mezza larghezza pista (mai fino al bordo).
// ====================================================
const BOT_APEX_REF_ANGLE     = Math.PI / 6;   // 30° sulla finestra locale: oltre, taglio già al massimo consentito
const BOT_APEX_MAX_FRACTION  = 0.85;          // frazione massima della mezza larghezza pista di cui ci si sposta verso l'interno

// ====================================================
// TAGLIO CURVE FUORI-DENTRO-FUORI — a differenza della versione precedente
// (uno scalino: zero in rettilineo, salta a un taglio fisso verso l'interno
// appena c'è curvatura), l'offset è ora una funzione a S della distanza con
// segno dall'apice della curva più vicina (vedi cornerApexNear): negativo
// (verso l'ESTERNO) ben prima e ben dopo l'apice, positivo (verso
// l'INTERNO) esattamente all'apice — il classico fuori-dentro-fuori di un
// pilota vero. L'ampiezza è proporzionale a quanto la curva è stretta
// rispetto alla larghezza pista (severity), non più una frazione fissa
// uguale per ogni curva — vedi spec
// docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md.
// ====================================================
function apexOffset(points, idx, searchSamples, localSamples, metersPerSample, roadHalf, maxOffsetFraction) {
    const apex = cornerApexNear(points, idx, searchSamples, localSamples, metersPerSample);
    if (!apex) return { dx: 0, dz: 0 };

    // Zona di influenza fuori-dentro-fuori: più ampia su una curva ampia,
    // più stretta su un tornante — stessa logica dell'angolo di riferimento
    // già usato per "severity" nella versione precedente.
    const halfSpanM = apex.apexRadius * BOT_APEX_REF_ANGLE;
    const x = Math.max(-1, Math.min(1, apex.distanceToApexM / halfSpanM));
    let shape;
    if (Math.abs(apex.distanceToApexM) <= halfSpanM) {
        shape = Math.cos(x * Math.PI);   // +1 all'apice, -1 ai bordi della zona di influenza
    } else {
        // Oltre la zona di influenza: rampa lineare da -1 a 0 su una seconda
        // finestra della stessa ampiezza — mai restare "allargati"
        // all'infinito dopo l'uscita o ben prima dell'ingresso.
        const beyond = (Math.abs(apex.distanceToApexM) - halfSpanM) / halfSpanM;
        shape = -Math.max(0, 1 - Math.min(1, beyond));
    }

    const severity = Math.min(1, roadHalf / apex.apexRadius);
    const mag = shape * severity * maxOffsetFraction * roadHalf;

    // Verso: come nella versione precedente, dal segno della curvatura
    // all'apice (turnSigned>0 = curva a destra nella convenzione
    // atan2(tx,tz) di questo file => l'interno è dal lato opposto alla
    // normale). apexRadius/turnSigned non sono nello stesso oggetto:
    // recupera il segno con una windowRadius alla posizione dell'apice.
    const apexNext = lookaheadIndex(points.length, apex.apexIdx, Math.max(1, Math.floor(localSamples / 2)));
    const w = windowRadius(points, apex.apexIdx, apexNext, localSamples * metersPerSample);
    const insideSign = (w && w.turnSigned > 0) ? -1 : 1;

    const normal = TrackGeometry.normalAt(points, idx, true);
    return { dx: normal.nx * mag * insideSign, dz: normal.nz * mag * insideSign };
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
// spec, caso chicane). Trova la prima finestra con curvatura significativa
// (in entrambe le direzioni da idx), poi cammina in ENTRAMBE le direzioni da
// lì finché il raggio continua a diminuire: il punto in cui smette di
// scendere, su ciascun lato, è il minimo locale, cioè l'apice di QUELLA
// curva. Camminare in una sola direzione (quella "scoperta" per prima)
// mancava sistematicamente l'apice quando si trovava dal lato opposto — es.
// idx già all'altezza o oltre l'apice reale, dove la finestra più stretta è
// INDIETRO rispetto a idx — riportando distanceToApexM mai vicino a zero
// nemmeno esattamente sull'apice (bug verificato: su una curva stretta
// questo spingeva l'offset fuori-dentro-fuori a "sforare" la zona di
// influenza dal lato sbagliato proprio nel punto più critico della curva).
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
    for (let d = 0; d <= searchSamples; d += step) {
        const fwd = windowAt(d);
        if (fwd !== null) { startOffset = d; startRadius = fwd; break; }
        if (d > 0) {
            const back = windowAt(-d);
            if (back !== null) { startOffset = -d; startRadius = back; break; }
        }
    }
    if (startOffset === null) return null;   // nessuna curvatura significativa nel raggio di ricerca

    let bestOffset = startOffset;
    let bestRadius = startRadius;
    for (const direction of [1, -1]) {
        let cursor = startOffset;
        let radius = startRadius;
        while (true) {
            const nextOffset = cursor + direction * step;
            const nextRadius = windowAt(nextOffset);
            if (nextRadius === null || nextRadius >= radius) break;
            radius = nextRadius;
            cursor = nextOffset;
            if (radius < bestRadius) { bestRadius = radius; bestOffset = cursor; }
        }
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
function cornerTargetSpeed(points, idx, scanSamples, localSamples, metersPerSample, currentSpeed, maxSpeed, brakeDecel, turnRateAtMax, marginFactor, gripCapacityFactor = 1) {
    const n = points.length;
    const step = Math.max(1, Math.floor(localSamples / 2));
    const localArcM = localSamples * metersPerSample;
    let target = maxSpeed;
    for (let offset = 0; offset <= scanSamples; offset += step) {
        const i1 = lookaheadIndex(n, idx, offset);
        const i2 = lookaheadIndex(n, idx, offset + localSamples);
        const w = windowRadius(points, i1, i2, localArcM);
        if (!w) continue;   // praticamente dritto, nessun raggio significativo da questa finestra
        // gripCapacityFactor arriva già scalato dal chiamante (vedi
        // BOT_GRIP_CAPACITY_EXPONENT in updateBotInputs) — qui è solo un
        // moltiplicatore diretto, nessuna logica di scala in questa funzione.
        const cornerSpeed = Math.min(maxSpeed, w.radius * turnRateAtMax * marginFactor * gripCapacityFactor);
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

// Velocità-obiettivo "vera" (guardando avanti sulla propria traiettoria) di
// UN'ALTRA auto nella sua posizione attuale — usata per decidere il
// sorpasso (vedi updateBotInputs). Confrontare la propria velocità-obiettivo
// con lo scalare ISTANTANEO dell'auto davanti (com'era prima) dava falsi
// positivi enormi ogni volta che quell'auto stava frenando per una curva
// che anche l'inseguitore doveva ancora affrontare: misurato con una
// simulazione headless (Monza, 6 bot, 8 giri) che la mediana della velocità
// di avvicinamento nei tentativi era ~50m/s (quasi il tetto di velocità del
// gioco, impossibile come vero margine di ritmo) — un'illusione dovuta al
// fotogramma sbagliato, mai un vantaggio reale abbastanza a lungo da
// completare un sorpasso (finestra media del tentativo ~0.5s). Confrontando
// invece ritmo-contro-ritmo (questa funzione) la mediana scende a ~7m/s, un
// vantaggio fisicamente sensato.
function otherCarTargetSpeed(other, laneSource, track, metersPerSample, brakeDecel, turnRateHigh, effectiveMaxSpeed, cornerSpeedMargin, brakingDistanceMargin) {
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const maxSpeed = effectiveMaxSpeed(other, false);
    const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * brakingDistanceMargin;
    const scanSamples = metersToSamples(scanM, track);
    return cornerTargetSpeed(
        laneSource, other.trackIndex || 0, scanSamples, localSamples, metersPerSample,
        other.speed, maxSpeed, brakeDecel, turnRateHigh, cornerSpeedMargin
    ) * (other.botSpeedFactor || 1) * (other.botLapPaceMult || 1);
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

const BOT_REPAIR_DAMAGE_THRESHOLD = 20;   // % danno oltre cui il bot ripara sempre ai box

function shouldBotRepair(damage, threshold) {
    return damage >= threshold;
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
// Range ristretto a 0.93..1.0 (non oltre 1.0: la racing line precalcolata è
// già ottimizzata al limite fisico di aderenza — cornerSpeedMargin=1.0 sulle
// piste con dati precalcolati — un fattore >1.0 chiede all'auto di prendere
// le curve più veloce del limite reale, verificato che non produce alcun
// guadagno di tempo, solo rumore statistico, vedi report). Il vecchio range
// 0.8..1.0 era tarato sul tetto pre-linea-offline (24.2s): con il nuovo
// tetto (21.35s su Monza) uno spread così ampio (0.8) produceva un bot
// fortunato vicino all'umano e gli altri quattro staccatissimi — nessuna
// vera lotta. 0.93 mantiene comunque un ventaglio di ritmi diversi (assieme
// a BOT_LAP_PACE_VARIANCE, che abilita i sorpassi) senza spalancare il
// distacco tra il migliore e il peggiore del gruppo.
const BOT_SPEED_FACTOR_MIN    = 0.93, BOT_SPEED_FACTOR_MAX    = 1.0;
const BOT_PRECISION_NOISE_MIN = 0,    BOT_PRECISION_NOISE_MAX = 0.25;   // rad aggiunti/tolti allo sterzo
const BOT_PIT_THRESHOLD_MIN   = 60,   BOT_PIT_THRESHOLD_MAX   = 80;     // % usura gomme a cui il bot decide di entrare ai box
// Distanza (metri, lungo il giro) entro cui un bot che ha deciso di entrare
// ai box comincia a sfumare il bersaglio dello sterzo verso pitPath[0]
// invece di seguire solo la traiettoria normale. BUG REALE misurato con una
// simulazione headless (Monza, 3 giri): puntare la corsia box in linea
// d'aria da QUALUNQUE punto del circuito nel momento esatto in cui l'usura
// supera la soglia manda il bot fuori pista per il resto della gara (mai
// più recuperato, verificato >90s consecutivi fuori pista in simulazione).
// Restando sulla traiettoria normale finché non si è vicini al vero punto
// di distacco (pitEntryIndex, precalcolato in trackLoader.js), il bot
// "punta ai box" solo nell'ultimo tratto, esattamente come farebbe un
// pilota vero avvicinandosi al box. Valore tarato con la stessa
// simulazione: 200m dava una correzione troppo stretta (mancava spesso il
// riquadro d'ingresso, ~40% delle volte), 300m converge in modo affidabile.
const BOT_PIT_APPROACH_M = 300;
// Sotto questa distanza (metri) da pitPath[0] si passa dal bersaglio
// sfumato all'inseguimento diretto di pitPath[1] (dentro il vero riquadro-
// trigger, verificato) — evita di "arrivare" su pitPath[0] e poi tornare
// verso la traiettoria normale prima di aver davvero attraversato il
// riquadro che fa scattare l'ingresso ai box.
const BOT_PIT_LANE_FOLLOW_M = 25;
// Su una pista corta (es. Monza, 3 giri) l'usura non arriva mai a
// botPitThreshold (60-80%) con mescole medium/hard entro fine gara — non è
// casualità, è la matematica di WEAR_LAPS_AT_MEDIUM/wearRate (misurato: fino
// a ~58%/~35% di usura a fine gara per medium/hard su Monza, sempre sotto
// soglia). Un bot così non farebbe mai un pit stop e chiuderebbe sempre in
// penalità. Rete di sicurezza: se resta solo l'ultimo giro e il bot non ha
// ancora pittato, forza comunque l'ingresso ai box (un pilota vero, pur con
// gomme non al limite, sceglierebbe di scontare la sosta obbligatoria
// piuttosto che la penalità in tempo) — stesso percorso di avvicinamento
// sicuro sopra, nessuna logica di sterzo duplicata.
const BOT_FORCE_PIT_LAPS_REMAINING = 1;
// Durante l'avvicinamento finale ai box la precisione conta più che in
// pista aperta (il trigger d'ingresso è stretto, ~30×15m): lo stesso
// rumore di sterzo usato per la guida normale a volte fa mancare il
// riquadro sul primo passaggio (osservato in simulazione), quindi va
// ridotto SOLO in quella fase, non ovunque.
const BOT_PIT_APPROACH_NOISE_SCALE = 0.15;
// botSpeedFactor è fisso per tutta la gara: da solo produce una griglia
// già ordinata per ritmo (chi parte davanti è sempre il più veloce), quasi
// nessun sorpasso tra bot per tutta la gara — richiesto esplicitamente
// dall'utente. Un moltiplicatore ri-estratto ad ogni giro (giorno buono/
// giorno storto, come un pilota vero) rompe l'ordine statico anche a
// parità di usura gomme/strategia.
const BOT_LAP_PACE_VARIANCE   = 0.04;   // ±4% di variazione di ritmo da un giro all'altro
// Su gare corte (es. Monza, 3 giri) ri-estrarre una sola volta a giro dava
// solo 3 occasioni totali per l'intera gara di un vero distacco di ritmo —
// pochissime, un solo sorpasso osservato in playtest (richiesta esplicita
// dell'utente di ripescare più spesso, stessa ampiezza ±4%, non toccata).
const BOT_LAP_PACE_SEGMENTS   = 4;   // quante volte a giro si ripesca botLapPaceMult

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
            damage:                  0,
            collisionPenaltyMs:      0,
            pendingRepair:           false,
            carContacts:             new Set(),
            wallContact:             false,
            pendingCollisionPenaltyEvents: [],
            // --- campi solo-bot ---
            isBot:                  true,
            botSpeedFactor:         randRange(BOT_SPEED_FACTOR_MIN, BOT_SPEED_FACTOR_MAX, rng),
            botPrecisionNoise:      randRange(BOT_PRECISION_NOISE_MIN, BOT_PRECISION_NOISE_MAX, rng),
            botPitThreshold:        randRange(BOT_PIT_THRESHOLD_MIN, BOT_PIT_THRESHOLD_MAX, rng),
            botHeadingToPits:       false,
            botPitReactionScheduled: false,
            botOvertakeSide:        rng() < 0.5 ? 1 : -1,   // spareggio quando l'auto da superare è vicina al centro pista
            botLapSeen:             0,
            botLapPaceMult:         randRange(1 - BOT_LAP_PACE_VARIANCE, 1 + BOT_LAP_PACE_VARIANCE, rng),
            botRaceReactionUntil:   null   // impostato da startRaceCountdown al via vero (f1GameSocket.js)
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

// Fase 1 — lookahead adattivo alla curvatura (Rif.
// docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md,
// ipotesi H1/H2/H3 — NON ancora validate). k è un CANDIDATO da verificare
// con backend/tools/f1AdaptiveLookaheadCheck.js, non un valore derivato o
// confermato: resta sovrascrivibile per test tramite
// tuning.adaptiveLookaheadK / racingLineTuning.adaptiveLookaheadK (stessa
// plumbing già esistente per lookaheadTimeS/steerGain), il valore qui sotto
// è solo il default quando nessuno lo sovrascrive.
const BOT_ADAPTIVE_LOOKAHEAD_K     = 0.1;
// Tetto sui rettilinei (R_locale non misurabile, windowRadius nullo): stesso
// ordine di grandezza del lookahead attuale a velocità di punta con
// lookaheadTimeS ufficiale di New Monza (~90 m/s * 0.98s ~= 88m).
const BOT_ADAPTIVE_LOOKAHEAD_MAX_M = 120;


// Floor dinamico L_speed(v) = max(5, v_ms * BOT_ADAPTIVE_LOOKAHEAD_T_MIN),
// SOLO sul ramo racing-line (Rif. audit diagnostico round 1-4, sessione
// odierna: il floor fisso BOT_LOOKAHEAD_MIN_M sottoperforma sistematicamente
// lì — su 5 run/pista, tempo/distanza-media/head-std migliorano oltre il
// rumore run-to-run su New Monza e Prova, senza mai peggiorare — mentre sul
// ramo geometrico il floor fisso resta l'opzione migliore, in modo
// altrettanto robusto — verificato con lo stesso protocollo su
// monte-rosso/baku). Costante GLOBALE apposta (non per pista, non per
// track.racingLineTuning): rappresenta un limite dinamico di veicolo/loop
// di controllo, non un parametro di tracciato — Rif. review teorica
// pure-pursuit della stessa sessione.
const BOT_ADAPTIVE_LOOKAHEAD_T_MIN = 0.3;

// L = sqrt(2 * R_locale * e_target), e_target = k * roadHalf (ipotesi H1/H2,
// vedi spec). R_locale misurato con windowRadius sulla stessa finestra
// locale già usata per la severità di sorpasso/apexOffset
// (BOT_CURVATURE_LOCAL_M) — nessuna nuova misura di curvatura introdotta.
// Su un rettilineo (windowRadius nullo, curvatura indistinguibile da zero)
// si usa direttamente il tetto massimo, mai una divisione per curvatura ~0.
// `laneSource` è la linea che il bot sta davvero seguendo in quel ramo
// (track.racingLine o track.points), stessa convenzione già in uso altrove
// in questo file. `speedMs` (5° parametro, opzionale): usato SOLO dal floor
// dinamico del ramo racing-line sotto — il ramo geometrico lo ignora, resta
// esattamente la formula originaria (floor fisso).
function adaptiveLookaheadMeters(laneSource, trackIndex, track, k, speedMs) {
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const metersPerSample = track.lapLength / track.points.length;
    const localArcM = localSamples * metersPerSample;
    const i2 = lookaheadIndex(track.points.length, trackIndex, localSamples);
    const w = windowRadius(laneSource, trackIndex, i2, localArcM);
    if (!w) return BOT_ADAPTIVE_LOOKAHEAD_MAX_M;
    const eTarget = k * track.roadHalf;
    const raw = Math.sqrt(2 * w.radius * eTarget);
    // Stessa condizione che già seleziona il ramo in updateBotInputs: qui
    // vale solo per la SORGENTE di lookahead effettivamente in uso in
    // questa chiamata, non per l'esistenza della pista in astratto.
    const isRacingLine = !!track.racingLine && laneSource === track.racingLine;
    if (isRacingLine) {
        const lSpeed = Math.max(5, (speedMs || 0) * BOT_ADAPTIVE_LOOKAHEAD_T_MIN);
        return Math.min(BOT_ADAPTIVE_LOOKAHEAD_MAX_M, Math.max(lSpeed, raw));
    }
    return Math.max(BOT_LOOKAHEAD_MIN_M, Math.min(BOT_ADAPTIVE_LOOKAHEAD_MAX_M, raw));
}

// Fase 1 — cervello di guida condiviso (Rif.
// docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md):
// decide sterzo e velocità-obiettivo per seguire al meglio la racing line DA
// SOLO — nessuna dipendenza da altri giocatori, pit stop, socket. Estratta
// dal ramo racing-line di updateBotInputs per essere riusata IDENTICA anche
// da backend/tools/f1RaceLineOptimizer.js (Task 5): prima l'ottimizzatore
// valutava le candidate di linea con una propria copia più vecchia
// (lookahead a tempo fisso) — le due implementazioni si erano scollegate.
// `track.racingLine` è la linea da seguire: nel gioco vero è sempre la
// stessa caricata da trackLoader.js; l'ottimizzatore la sostituisce con ogni
// candidata in valutazione tramite una vista del tracciato (stesso campo).
// Non include botSpeedFactor/botLapPaceMult (varianza di ritmo per-bot, un
// concetto di gara) né l'aggiustamento sorpasso/scia (multi-auto): il
// chiamante reale li applica DOPO aver ricevuto targetSpeed da qui.
function computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor) {
    const metersPerSample = track.lapLength / track.points.length;
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const speedMs = Math.max(5, botSpeedMs(p.speed));
    const lookM = adaptiveLookaheadMeters(track.racingLine, p.trackIndex || 0, track, rt.adaptiveLookaheadK, speedMs);
    const lookSamples = metersToSamples(lookM, track);
    const targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
    const target = track.racingLine[targetIdx];

    const steer = steerToward(p.x, p.z, p.angle, target.x, target.z, rt.steerGain);

    const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * rt.brakingDistanceMargin;
    const scanSamples = metersToSamples(scanM, track);
    const targetSpeed = cornerTargetSpeed(
        track.racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
        p.speed, maxSpeed, brakeDecel, turnRateHigh, rt.cornerSpeedMargin, gripCapacityFactor
    );

    return { steer, target, targetSpeed, localSamples };
}

// Margine sulla distanza di frenata calcolata dalla fisica: oltre il
// margine "matematico" già insito nel calcolo (v0²−v1²=2·decel·distanza),
// un 20% extra copre l'imprecisione del rilevamento a campioni discreti.
const BOT_BRAKING_DISTANCE_MARGIN    = 1.2;
const BOT_SPEED_MARGIN          = 0.03;  // isteresi throttle/brake attorno alla velocità target
const BOT_PIT_REACTION_MIN_MS   = 150;
const BOT_PIT_REACTION_MAX_MS   = 700;
// Reazione al via (spegnimento semafori): senza questo, tutti i bot
// iniziano a spingere sull'acceleratore nell'ESATTO stesso tick fisico in
// cui game.raceStarted diventa true (tickGame ritorna subito se non è
// ancora true, quindi updateBotInputs non viene mai chiamata prima — vedi
// f1GameSocket.js), mentre un umano ha sempre una reazione naturalmente
// variabile — risultato: griglia di partenza troppo "meccanica". Nessuna
// correlazione col ritmo di gara del bot (richiesto esplicitamente
// dall'utente: solo variabilità, non "il più veloce parte apposta peggio").
// Stesso ordine di grandezza di BOT_PIT_REACTION_MIN/MAX_MS (reazione umana
// plausibile a uno stimolo atteso).
const BOT_RACE_START_REACTION_MIN_MS = 150;
const BOT_RACE_START_REACTION_MAX_MS = 500;

// Distanza di scia: senza questo, più bot che seguono la stessa linea di
// corsa e frenano/accelerano secondo la stessa curvatura convergono a
// velocità quasi identiche nello stesso punto pista, risultando in gruppetti
// che si muovono "in blocco" (effetto trenino osservato in playtest). Un bot
// che si accorge di un'altra auto entro BOT_FOLLOW_GAP_M subito avanti lungo
// il tracciato rallenta proporzionalmente, invece di tallonarla identico.
const BOT_FOLLOW_GAP_M        = 30;
const BOT_FOLLOW_MIN_FRACTION = 0.85;   // frazione minima di velocità quando si è praticamente addosso a chi precede — alta apposta: il bot talloona invece di staccarsi, per restare a ridosso e cercare l'occasione di sorpasso (vedi spec 2026-07-24-f1-bot-aggressivita-sorpassi-design.md)
// Sorpasso: entro BOT_FOLLOW_GAP_M, se il bot avrebbe margine di velocità
// libera vero sull'auto che precede (non solo momentaneo, es. lei in
// frenata per una curva) tenta di superarla scartando di lato invece di
// limitarsi a rallentare — altrimenti la "skill" di qualifica diventa una
// posizione fissa per tutta la gara, nessun sorpasso si verifica mai.
const BOT_OVERTAKE_PACE_MARGIN = 1.01;   // serve almeno l'1% di velocità libera in più per tentare (era 5%, poi 2%: un solo sorpasso osservato in playtest su Monza/3 giri, spinto ancora più giù su richiesta esplicita)
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
    brakingDistanceMargin: BOT_BRAKING_DISTANCE_MARGIN,
    // lookaheadTimeS/steerGain (Rif. audit generalizzazione 2026-07-29,
    // esperimento f1RacingLineAblation.js): stessi due parametri già
    // sovrascrivibili per pista via racingLineTuning nel ramo racing-line,
    // ora sovrascrivibili anche qui per confrontarli sul ramo geometrico
    // (piste senza racing line precalcolata) — nessun nuovo comportamento
    // di default, il call site reale non passa mai deps.tuning.
    lookaheadTimeS:        BOT_LOOKAHEAD_TIME_S,
    steerGain:             BOT_STEER_GAIN,
    adaptiveLookaheadK:    BOT_ADAPTIVE_LOOKAHEAD_K
};

// Default per track.racingLineTuning quando il file generato da
// f1RaceLineOptimizer.js non specifica un campo (robustezza, non un caso
// atteso in pratica): stessi valori usati come punto di partenza
// dell'ottimizzatore stesso, così un campo mancante degrada al
// comportamento "non ancora ottimizzato" invece di un crash o un NaN.
const DEFAULT_RACELINE_TUNING = {
    lookaheadTimeS:        BOT_LOOKAHEAD_TIME_S,
    steerGain:             BOT_STEER_GAIN,
    adaptiveLookaheadK:    BOT_ADAPTIVE_LOOKAHEAD_K,
    cornerSpeedMargin:     BOT_CORNER_SPEED_MARGIN,
    brakingDistanceMargin: BOT_BRAKING_DISTANCE_MARGIN,
    deadband:              0.01,
    ramp:                  0.06
};

// Raggio di ricerca (in campioni) del punto più vicino sulla linea per
// trajectoryDiagnostics sotto — deve coprire lo sfasamento di indice tra
// centro pista e racing line: track.trackIndex è sempre calcolato sul
// CENTRO pista (updateTrackIndex in f1GameSocket.js), ma un offset laterale
// ampio in curva (misurato fino a ~13m su new-monza) sposta di molti
// campioni quale indice della racing line corrisponde davvero alla
// posizione più vicina — usare lo stesso indice del centro pista
// sottostimerebbe grossolanamente quanto bene il bot segue la linea
// proprio nelle curve più strette (bug reale, trovato durante il primo
// audit con questo strumento: distanze fino a 40m su una pista larga
// roadHalf=14m). 50 campioni * ~3.2m/campione (new-monza) ≈ 160m di
// margine, ben oltre lo sfasamento osservato.
const TRAJECTORY_DIAG_SEARCH_WINDOW = 50;

// ====================================================
// DIAGNOSTICA DI TRAIETTORIA (Rif. richiesta utente 2026-07-29, audit guida
// via banco prova) — SOLA LETTURA: due numeri derivati dallo stato già
// esistente (p.x/z/angle, p.trackIndex, track.racingLine/points), MAI
// consultati per decidere throttle/brake/steer. Rispondono a "il bot sta
// davvero seguendo la linea?" senza dover indovinare guardando lo schermo:
// - distanceFromRacingLine: distanza dal punto REALMENTE più vicino sulla
//   linea che il bot dovrebbe seguire (racing line se la pista ne ha una,
//   altrimenti il centro pista — la stessa `laneSource` usata più sotto per
//   il lookahead) — ricerca locale attorno al proprio trackIndex, non lo
//   stesso indice (vedi TRAJECTORY_DIAG_SEARCH_WINDOW sopra sul perché).
// - headingVsTangentDeg: quanto la prua (p.angle) è ruotata rispetto alla
//   tangente della linea in quel punto più vicino — vicino a 0° = punta
//   dritto lungo la linea, valori grandi = sta correggendo/derivando molto.
// ====================================================
function trajectoryDiagnostics(p, track) {
    const laneSource = track.racingLine || track.points;
    const n = laneSource.length;
    const seedIdx = p.trackIndex || 0;
    let bestIdx = seedIdx, bestDist = Infinity;
    for (let d = -TRAJECTORY_DIAG_SEARCH_WINDOW; d <= TRAJECTORY_DIAG_SEARCH_WINDOW; d++) {
        const idx = ((seedIdx + d) % n + n) % n;
        const pt = laneSource[idx];
        const dist = Math.hypot(p.x - pt.x, p.z - pt.z);
        if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    }
    const tangent = TrackGeometry.tangentAt(laneSource, bestIdx, true);
    const tangentAngle = Math.atan2(tangent.tx, tangent.tz);
    return {
        distanceFromRacingLine: bestDist,
        headingVsTangentDeg: normalizeAngle(p.angle - tangentAngle) * 180 / Math.PI
    };
}

function updateBotInputs(game, deps) {
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh, tuning: tuningOverrides, slipstreamMaxBoost,
        effectiveBrakeMult, corneringCapacity
    } = deps;
    const tuning = { ...DEFAULT_TUNING, ...(tuningOverrides || {}) };
    const track = game.track;
    const isQuali = game.phase === 'qualifying';
    const metersPerSample = track.lapLength / track.points.length;
    // Decelerazione "storica" (costante, non wear-aware): resta l'unica
    // usata da otherCarTargetSpeed (stima del ritmo dell'auto avanti per i
    // sorpassi, esplicitamente fuori scope in questa fase — vedi
    // docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md)
    // per garantire che quel calcolo resti byte-identico a prima.
    const legacyBrakeDecel = accel * brakeMult;

    // Diagnostica/telemetria IA (trajectoryDiagnostics + p._botDebug): SOLO
    // lettura, mai consultata per decidere throttle/brake/steer (vedi i
    // commenti sopra trajectoryDiagnostics), ma trajectoryDiagnostics scansiona
    // fino a 101 campioni pista con Math.hypot per bot ogni tick — costo reale
    // e non trascurabile su Render con più bot attivi, per un dato che serve
    // SOLO al banco prova (frontend/f1-testbench.js, unico consumatore di
    // botDebug — mai letto dal client di gioco vero, frontend/f1.js). Attiva
    // per default (game.debugEnabled !== false) così i test esistenti e il
    // banco prova (che non impostano il campo) restano invariati; le partite
    // reali lo disattivano esplicitamente (vedi activeGames.set in
    // f1GameSocket.js).
    const debugEnabled = game.debugEnabled !== false;

    for (const p of Object.values(game.players)) {
        if (!p.isBot || p.finished) continue;

        // Calcolata una volta per bot, prima di ogni ramo/uscita anticipata:
        // pura diagnostica, non entra in nessuna decisione più sotto.
        const diag = debugEnabled ? trajectoryDiagnostics(p, track) : null;

        // Reazione al via ancora in corso (vedi BOT_RACE_START_REACTION_MIN/MAX_MS
        // e startRaceCountdown in f1GameSocket.js, che imposta questo timestamp
        // nell'esatto istante in cui si accende il verde): auto ferma, nessun
        // input, come un pilota che non ha ancora reagito al semaforo.
        if (p.botRaceReactionUntil && Date.now() < p.botRaceReactionUntil) {
            p.inputs = { throttle: 0, brake: 0, steer: 0 };
            p._botDebug = debugEnabled ? {
                state: 'WAITING_START', speed: p.speed,
                targetSpeed: null, maxSpeed: null, gripCapacityFactor: null, brakeDecel: null,
                throttle: 0, brake: 0, steer: 0, target: null, gapToAhead: null,
                ...diag
            } : null;
            continue;
        }

        // Ri-estrae il ritmo BOT_LAP_PACE_SEGMENTS volte a giro (non più solo
        // al cambio giro): un identificativo che cresce ad ogni frazione di
        // giro percorsa (giorno buono/giorno storto più frequente, come un
        // pilota vero che varia ritmo anche dentro lo stesso giro) — rompe
        // l'ordine altrimenti statico di una griglia già ordinata per ritmo
        // fisso, con più occasioni di distacco reale anche su gare corte.
        const paceSegmentSamples = Math.ceil(track.points.length / BOT_LAP_PACE_SEGMENTS);
        const paceSegment = p.lap * BOT_LAP_PACE_SEGMENTS + Math.floor((p.trackIndex || 0) / paceSegmentSamples);
        if (paceSegment !== p.botLapSeen) {
            p.botLapSeen = paceSegment;
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
            // Nessun input di guida scritto qui (il server/autopilota guida
            // direttamente): throttle/brake/steer non sono applicabili questo
            // tick, non si riportano valori residui del tick precedente.
            p._botDebug = debugEnabled ? {
                state: 'PIT_LANE', speed: p.speed,
                targetSpeed: null, maxSpeed: null, gripCapacityFactor: null, brakeDecel: null,
                throttle: null, brake: null, steer: null, target: null, gapToAhead: null,
                ...diag
            } : null;
            continue;
        }

        // Soglia usura superata (solo in gara, l'usura non conta in
        // quali): il bot punta al distacco della corsia box invece che
        // alla linea principale — appena entra nel trigger d'ingresso
        // (inPitEntryZone, già controllato per tutti in tickGame), il
        // server prende il volante come farebbe con un umano.
        if (game.phase === 'race' && !p.botHeadingToPits && !p.hasPitted) {
            const remainingLaps = Math.max(0, track.totalLaps - p.lap);
            const wearThresholdHit = p.tyreWear >= p.botPitThreshold;
            const mustPitNow = remainingLaps <= BOT_FORCE_PIT_LAPS_REMAINING;
            if (wearThresholdHit || mustPitNow) {
                p.botHeadingToPits = true;
                p.pendingCompound = pickPostPitCompound(remainingLaps, wearLapsAtMedium);
                p.pendingRepair = shouldBotRepair(p.damage, BOT_REPAIR_DAMAGE_THRESHOLD);
            }
        }

        // Vicino al vero punto di distacco della corsia box? Distanza IN
        // AVANTI lungo il giro (non la più corta nei due versi: appena
        // superato l'ingresso, "vicino" nel verso sbagliato vorrebbe dire
        // aver già mancato l'entrata, serve aspettare il prossimo giro) —
        // vedi commento su BOT_PIT_APPROACH_M.
        const n = track.points.length;
        const idxUntilPitEntry = ((track.pitEntryIndex - (p.trackIndex || 0)) % n + n) % n;
        const nearPitEntry = p.botHeadingToPits &&
            idxUntilPitEntry <= metersToSamples(BOT_PIT_APPROACH_M, track);

        // Grip-awareness ora permanente (Fase 1 — cervello di guida
        // unificato): niente più flag, brakeDecel riflette sempre l'usura
        // reale della gomma. legacyBrakeDecel resta solo per otherCarTargetSpeed
        // (stima del ritmo dell'auto avanti, esplicitamente fuori scope qui).
        const brakeDecel = accel * effectiveBrakeMult(p, isQuali);

        // Canale di debug (Rif. docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md):
        // puro snapshot di valori GIÀ calcolati più sotto, popolato dal ramo
        // che viene davvero eseguito — nessun ricalcolo, nessuna nuova
        // formula. `botState` riassume QUALE ramo/percorso è stato preso,
        // non introduce una decisione nuova.
        let botState = 'CRUISE';
        let debugTargetSpeed = null, debugMaxSpeed = null, debugGripCapacityFactor = null;
        let debugTarget = null, debugGapToAhead = null;

        let steer, throttle = 0, brake = 0;
        if (nearPitEntry) {
            botState = 'PIT_ENTRY';
            // pitPath[0] è il punto di raccordo NATURALE (misurato: solo
            // ~12.5m di scostamento laterale dal centro pista a
            // pitEntryIndex, contro gli 11m di mezza carreggiata — quindi
            // praticamente al bordo pista, non un taglio). Il centro del
            // riquadro-trigger (pitEntryTarget, ~30m di scostamento) era
            // troppo lontano dalla pista: puntarlo tagliava dritto per il
            // prato ignorando la curva (segnalato dall'utente in localhost,
            // "salta l'ultima curva"). Finché non si è molto vicini a
            // pitPath[0], il bersaglio è sfumato dal punto di inseguimento
            // NORMALE sulla pista (stesso calcolo della guida normale sotto)
            // verso pitPath[0] — nessun taglio, solo un cambio di corsia
            // graduale verso il bordo. Una volta arrivati (distanza < 25m),
            // si passa a inseguire pitPath[1] (verificato dentro il vero
            // riquadro-trigger) per attraversarlo con sicurezza, invece di
            // fermarsi su pitPath[0] che gli sta appena fuori.
            const distToPitPath0 = Math.hypot(p.x - track.pitPath[0].x, p.z - track.pitPath[0].z);
            if (distToPitPath0 < BOT_PIT_LANE_FOLLOW_M && track.pitPath[1]) {
                const wp = track.pitPath[1];
                steer = steerToward(p.x, p.z, p.angle, wp.x, wp.z);
                debugTarget = { x: wp.x, z: wp.z };
            } else {
                const approachSamples = metersToSamples(BOT_PIT_APPROACH_M, track);
                const tLinear = 1 - idxUntilPitEntry / approachSamples;   // 0 appena entrati nella finestra, 1 al distacco
                // Cubica invece di lineare: per la maggior parte della
                // finestra il bersaglio resta quasi quello della guida
                // normale (segue la curva reale), lo spostamento vero verso
                // pitPath[0] si concentra negli ultimi metri — altrimenti
                // (peso lineare) si taglia l'ultima curva di Monza prima
                // ancora di essere vicini ai box (segnalato dall'utente).
                const t = tLinear * tLinear * tLinear;
                const laneSource   = track.racingLine || track.points;
                const speedMs      = Math.max(5, botSpeedMs(p.speed));
                const lookM        = Math.max(BOT_LOOKAHEAD_MIN_M, speedMs * BOT_LOOKAHEAD_TIME_S);
                const laneTargetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, metersToSamples(lookM, track));
                const laneTarget   = laneSource[laneTargetIdx];
                const targetX = laneTarget.x * (1 - t) + track.pitPath[0].x * t;
                const targetZ = laneTarget.z * (1 - t) + track.pitPath[0].z * t;
                steer = steerToward(p.x, p.z, p.angle, targetX, targetZ);
                debugTarget = { x: targetX, z: targetZ };
            }
            throttle = 0.6;   // rallenta in ingresso corsia box
        } else if (track.racingLine) {
            // Racing line precalcolata OFFLINE (vedi
            // backend/tools/f1RaceLineOptimizer.js +
            // docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md):
            // il bot punta un lookahead sulla linea già pronta (pure
            // pursuit) e frena in base alla curvatura DELLA LINEA STESSA
            // (cornerTargetSpeed riusato as-is) — nessun calcolo di
            // apice/severity dal vivo, quello era il punto fragile
            // (chicane) del calcolo geometrico a runtime nel ramo sotto,
            // qui sostituito da un percorso già misurato e validato offline
            // (mai un tempo peggiore del centro pista, per costruzione
            // dell'ottimizzatore). rt = i parametri di sterzo/frenata
            // trovati per QUESTA pista specifica, non le costanti fisse
            // valide per il ramo geometrico.
            const rt = { ...DEFAULT_RACELINE_TUNING, ...(track.racingLineTuning || {}) };
            // p.inSlipstream è il valore del tick FISICO precedente (la scia
            // viene ricalcolata in tickGame dopo updateBotInputs, non prima —
            // 20ms di ritardo, trascurabile): senza questo il bot calcola un
            // tetto di velocità-obiettivo che ignora la scia, e non appena la
            // fisica lo spinge oltre (fino a +8%, contro un margine di
            // frenata del 3%) FRENA per tornare al proprio target, buttando
            // via il vantaggio invece di sfruttarlo per rimontare.
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            // Grip-awareness ora permanente (Fase 1 — cervello di guida
            // unificato): niente più flag, il bot conosce sempre il proprio
            // grip reale. corneringCapacity è un moltiplicatore RELATIVO alla
            // capacità laterale (non un grip assoluto) — vedi BOT_GRIP_CAPACITY_EXPONENT.
            const gripCapacityFactor = Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT);
            debugMaxSpeed = maxSpeed;
            debugGripCapacityFactor = gripCapacityFactor;

            // Lookahead adattivo ora permanente in questo ramo (Fase 1 —
            // cervello di guida unificato): niente più flag, e la logica è
            // condivisa con l'ottimizzatore offline via computeSoloRacingLineInputs.
            const solo = computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor);
            const target = solo.target;
            const localSamples = solo.localSamples;   // riusato più sotto per il sorpasso (windowRadius) — evita di ricalcolarlo
            steer = solo.steer;
            debugTarget = { x: target.x, z: target.z };

            let targetSpeed = solo.targetSpeed * p.botSpeedFactor * p.botLapPaceMult;

            if (!isQuali) {
                const ahead = nearestAheadPlayer(p, Object.values(game.players), track);
                if (ahead && ahead.gapM < BOT_FOLLOW_GAP_M) {
                    // Stessa idea del ramo geometrico (sorpasso solo su
                    // rettilinei/curve dolci), ma la "severity" qui non
                    // viene da apexOffset (non calcolato in questo ramo) —
                    // si misura direttamente il raggio della racing line
                    // davanti alla posizione reale con lo stesso
                    // windowRadius condiviso.
                    const localArcM = localSamples * metersPerSample;
                    const i1 = p.trackIndex || 0;
                    const i2 = lookaheadIndex(track.points.length, i1, localSamples);
                    const w = windowRadius(track.racingLine, i1, i2, localArcM);
                    const severity = w ? Math.min(1, track.roadHalf / w.radius) : 0;
                    const cornerIsMild = severity < BOT_OVERTAKE_MAX_CORNER_SEVERITY;
                    // Ritmo-contro-ritmo, non ritmo-contro-fotogramma-a-caso
                    // (vedi otherCarTargetSpeed).
                    const leaderTargetSpeed = otherCarTargetSpeed(
                        ahead.player, track.racingLine, track, metersPerSample, legacyBrakeDecel, turnRateHigh,
                        effectiveMaxSpeed, rt.cornerSpeedMargin, rt.brakingDistanceMargin
                    );
                    debugGapToAhead = ahead.gapM;
                    if (cornerIsMild && targetSpeed > leaderTargetSpeed * BOT_OVERTAKE_PACE_MARGIN) {
                        const overtake = overtakeOffset(
                            track.points, ahead.player.trackIndex || 0, ahead.player.x, ahead.player.z,
                            track.roadHalf, BOT_OVERTAKE_FRACTION, p.botOvertakeSide
                        );
                        steer = steerToward(p.x, p.z, p.angle, target.x + overtake.dx, target.z + overtake.dz, rt.steerGain);
                        debugTarget = { x: target.x + overtake.dx, z: target.z + overtake.dz };
                        botState = 'OVERTAKING';
                    } else {
                        const closeness = 1 - ahead.gapM / BOT_FOLLOW_GAP_M;
                        targetSpeed *= 1 - closeness * (1 - BOT_FOLLOW_MIN_FRACTION);
                        botState = 'FOLLOWING';
                    }
                }
            }
            debugTargetSpeed = targetSpeed;

            // Controllo proporzionale (non on/off): la racing line è stata
            // ottimizzata assumendo questo tipo di controllo — vedi report,
            // frenare a scatti costava tempo misurabile anche a parità di
            // traiettoria. Zona morta (rt.deadband) prima della rampa:
            // qualunque brake>0 applica comunque lo scrub laterale ×0.94 in
            // updateVelocity, frenare per un fuorigiri minimo costerebbe
            // aderenza senza motivo.
            const err = (p.speed - targetSpeed) / maxSpeed;
            if (err > rt.deadband) brake = Math.min(1, (err - rt.deadband) / rt.ramp);
            else if (err < -rt.deadband) throttle = Math.min(1, (-err - rt.deadband) / rt.ramp);
        } else {
            // Vedi commento sul ramo racing-line sopra: senza il fattore
            // scia qui il bot frena via il vantaggio della scia invece di
            // sfruttarlo.
            const maxSpeed = effectiveMaxSpeed(p, isQuali) * (p.inSlipstream ? (1 + (slipstreamMaxBoost || 0)) : 1);
            // Grip-awareness: stessa logica del ramo racing-line sopra.
            const gripCapacityFactor = Math.pow(corneringCapacity(p, isQuali, maxSpeed), BOT_GRIP_CAPACITY_EXPONENT);
            debugMaxSpeed = maxSpeed;
            debugGripCapacityFactor = gripCapacityFactor;
            const speedMs  = Math.max(5, botSpeedMs(p.speed));   // floor: niente lookahead quasi-zero da fermi (es. alla partenza)
            // Lookahead adattivo ora permanente anche qui (Fase 1 — cervello
            // di guida unificato): niente più flag. Non estratto in
            // computeSoloRacingLineInputs — l'ottimizzatore offline non
            // simula mai questo ramo (nessun file -raceline.json prodotto).
            const lookM    = adaptiveLookaheadMeters(track.points, p.trackIndex || 0, track, tuning.adaptiveLookaheadK, speedMs);
            const lookSamples  = metersToSamples(lookM, track);
            const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
            const targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
            const target = track.points[targetIdx];

            // Distanza di scansione = il caso peggiore possibile: da tutto
            // gas a quasi fermo con la vera decelerazione di frenata del
            // gioco — oltre questa distanza nessuna curva può comunque
            // imporre di frenare adesso, quindi non serve cercare più
            // lontano (niente "quanti secondi di anticipo" indovinati).
            // Calcolata QUI (prima di apexOffset, non più dopo): apexOffset
            // ora ha bisogno dello stesso raggio di ricerca di
            // cornerTargetSpeed per trovare l'apice della curva più vicina.
            const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * tuning.brakingDistanceMargin;
            const scanSamples = metersToSamples(scanM, track);

            // apexOffset riusa scanSamples come raggio di ricerca dell'apice
            // (stesso ordine di grandezza della distanza di frenata: copre
            // una curva tipica senza agganciare tornanti troppo lontani) —
            // niente calcolo duplicato, un solo raggio di ricerca condiviso.
            // La FASE nella curva (quanto siamo vicini all'apice, quindi se
            // allargarsi o tagliare) va misurata sulla posizione REALE
            // dell'auto (p.trackIndex), non sul punto mirato in anticipo
            // (targetIdx, fino a decine di metri avanti ad alta velocità):
            // valutarla sul lookahead faceva sì che, mentre l'auto era
            // ancora dentro la curva, il punto mirato avesse già superato
            // l'apice e "ordinasse" di allargarsi verso il bordo esterno —
            // un comando di sterzo molto più stretto della curva reale, che
            // mandava l'auto fuori pista durante l'uscita (drag pesante,
            // causa reale del rallentamento misurato, non il sign-flip di
            // cornerApexNear). L'offset risultante resta comunque sommato al
            // punto mirato in anticipo, per una guida fluida.
            const apex = apexOffset(track.points, p.trackIndex || 0, scanSamples, localSamples, metersPerSample, track.roadHalf, tuning.apexMaxFraction);
            steer = steerToward(p.x, p.z, p.angle, target.x + apex.dx, target.z + apex.dz, tuning.steerGain);
            debugTarget = { x: target.x + apex.dx, z: target.z + apex.dz };

            let targetSpeed = cornerTargetSpeed(
                track.points, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
                p.speed, maxSpeed, brakeDecel, turnRateHigh, tuning.cornerSpeedMargin, gripCapacityFactor
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
                    // Ritmo-contro-ritmo, non ritmo-contro-fotogramma-a-caso
                    // (vedi otherCarTargetSpeed).
                    const leaderTargetSpeed = otherCarTargetSpeed(
                        ahead.player, track.points, track, metersPerSample, legacyBrakeDecel, turnRateHigh,
                        effectiveMaxSpeed, tuning.cornerSpeedMargin, tuning.brakingDistanceMargin
                    );
                    debugGapToAhead = ahead.gapM;
                    if (cornerIsMild && targetSpeed > leaderTargetSpeed * BOT_OVERTAKE_PACE_MARGIN) {
                        const overtake = overtakeOffset(
                            track.points, ahead.player.trackIndex || 0, ahead.player.x, ahead.player.z,
                            track.roadHalf, BOT_OVERTAKE_FRACTION, p.botOvertakeSide
                        );
                        steer = steerToward(p.x, p.z, p.angle, target.x + overtake.dx, target.z + overtake.dz, tuning.steerGain);
                        debugTarget = { x: target.x + overtake.dx, z: target.z + overtake.dz };
                        botState = 'OVERTAKING';
                    } else {
                        const closeness = 1 - ahead.gapM / BOT_FOLLOW_GAP_M;   // 0 = al limite, 1 = praticamente addosso
                        targetSpeed *= 1 - closeness * (1 - BOT_FOLLOW_MIN_FRACTION);
                        botState = 'FOLLOWING';
                    }
                }
            }
            debugTargetSpeed = targetSpeed;

            if (p.speed < targetSpeed * (1 - BOT_SPEED_MARGIN)) throttle = 1;
            else if (p.speed > targetSpeed * (1 + BOT_SPEED_MARGIN)) brake = 1;
        }

        // Rifinitura finale dello stato: se nessun ramo sopra ha già
        // assegnato uno stato più specifico (PIT_ENTRY/OVERTAKING/FOLLOWING)
        // e il bot sta effettivamente frenando quel tick, lo stato di
        // default CRUISE viene precisato in BRAKE_FOR_CORNER — solo una
        // lettura del valore `brake` già deciso sopra, nessun nuovo calcolo.
        if (botState === 'CRUISE' && brake > 0) botState = 'BRAKE_FOR_CORNER';

        const noiseScale = nearPitEntry ? BOT_PIT_APPROACH_NOISE_SCALE : 1;
        steer += (Math.random() * 2 - 1) * p.botPrecisionNoise * noiseScale;
        steer = Math.max(-1, Math.min(1, steer));

        p.inputs = { throttle, brake, steer };
        p._botDebug = debugEnabled ? {
            state: botState,
            speed: p.speed,
            targetSpeed: debugTargetSpeed,
            maxSpeed: debugMaxSpeed,
            gripCapacityFactor: debugGripCapacityFactor,
            brakeDecel,
            throttle, brake, steer,
            target: debugTarget,
            gapToAhead: debugGapToAhead,
            ...diag
        } : null;
    }
}

module.exports = {
    PALETTE, MAX_GRID_SIZE, DEFAULT_TUNING,
    BOT_RACE_START_REACTION_MIN_MS, BOT_RACE_START_REACTION_MAX_MS,
    normalizeAngle, steerToward, lookaheadIndex, apexOffset, windowRadius, cornerApexNear, cornerTargetSpeed, overtakeOffset,
    nearestAheadPlayer, otherCarTargetSpeed, pickPostPitCompound, pickBotColors, estimateFinishTime,
    createBots, updateBotInputs, shouldBotRepair,
    BOT_CURVATURE_LOCAL_M, BOT_APEX_MAX_FRACTION, trajectoryDiagnostics,
    adaptiveLookaheadMeters, BOT_ADAPTIVE_LOOKAHEAD_K, BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M,
    BOT_ADAPTIVE_LOOKAHEAD_T_MIN, computeSoloRacingLineInputs
};
