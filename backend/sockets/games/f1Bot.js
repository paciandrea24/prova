//
// Bot IA per riempire la griglia F1 fino a MAX_GRID_SIZE piloti totali.
// Un bot produce SOLO input (throttle/brake/steer), scritti in p.inputs
// esattamente come farebbe l'evento f1Input di un umano: nessuna via
// privilegiata su posizione/velocità. Fisica, collisioni, usura gomme,
// pit-lane trigger, lap counting restano quelli esistenti in
// f1GameSocket.js, invariati e riusati as-is.
const TrackGeometry = require('../../../frontend/shared/trackGeometry.js');
const BoxIngresso = require('../../../frontend/shared/f1BoxIngresso.js');
const Stagione = require('./f1Stagione.server.js');
const F1Difficolta = require('../../../frontend/shared/f1Difficolta.js');
const F1Duelli = require('../../../frontend/shared/f1Duelli.js');

// Palette colori — DEVE restare in sync con frontend/index.js →
// availableColors: i colori sono l'identità del giocatore su tutta la
// piattaforma, non solo in F1.
const PALETTE = [
    '#E74C3C', '#3498DB', '#2ECC71', '#F1C40F',
    '#9B59B6', '#E67E22', '#00BCD4', '#FF4081',
    '#795548', '#CDDC39', '#4B0082', '#455A64'
];

// TETTO ASSOLUTO di piloti per gara, non la dimensione della griglia: quella
// si sceglie in lobby e arriva su `game.gridSize` (vedi f1GameSocket). Prima
// questa costante era 6 ed ERA la griglia, scritta a mano qui e in altri due
// file che nessun test confrontava.
const MAX_GRID_SIZE = 20;
// Quanti piloti se la lobby non lo dice (partite vecchie, test storici).
const GRID_SIZE_DEFAULT = 6;

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
// NON SI MIRA MAI DENTRO NE' OLTRE UN GIRO DELLA MORTE.
//
// ⚠️ Visti dall'alto i campioni del tubo si spostano verso l'USCITA, che sta di
// fianco all'ingresso, e quelli dopo l'uscita ci stanno del tutto: puntandoli,
// il bot sterza verso l'altra corsia mentre dovrebbe imboccare il loop dritto.
// Lo ha visto l'utente in gioco — «prima di salire e fare il loop si orientano
// verso l'altra parte di pista» — e la telemetria gli ha dato ragione: il
// bersaglio cadeva sui campioni 135-153, dentro il tubo, e l'auto derivava di
// lato da 0.4 a 7.4 unita' negli ultimi venti campioni.
//
// Si guarda TUTTO il tratto fino al bersaglio, non solo il bersaglio: col
// lookahead lungo il punto mirato scavalca il tubo per intero.
//
// Dentro il tubo non c'e' niente da mirare: la traiettoria la impone il nastro.
function mirinoPrimaDelTubo(track, da, targetIdx) {
    const n = track.points.length;
    const quanti = ((targetIdx - da) % n + n) % n;
    for (let k = 0; k <= quanti; k++) {
        const i = (da + k) % n;
        if (track.points[i].acrobatico) return i;    // l'imbocco: sta sull'asse
    }
    return targetIdx;
}

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
// La velocita' piu' alta a cui si percorre una curva di raggio `raggio`.
//
// ⚠️ IL TURN RATE DIPENDE DALLA VELOCITA', e la velocita' da lui: e' un punto
// fisso, non un prodotto. La fisica interpola fra il turn rate a fermo e
// quello alla velocita' massima (SteeringModel: 0.075 e 0.052 rad/tick, il
// 44% di differenza), quindi
//
//     v = raggio . ( wFermo + (wMax - wFermo) . v/vMax )
//
// che si risolve in forma chiusa. Il denominatore e' sempre > 1 perche'
// wFermo > wMax: nessuna divisione per zero, nessuna iterazione.
//
// Prima si usava `wMax` e basta, cioe' il turn rate MINIMO che l'auto ha —
// quello delle velocita' alte — proprio per calcolare quanto si va piano in
// curva. Il bot si negava un quinto dello sterzo disponibile: misurato su
// `prova` contro il giro di una persona (2026-09-05), passava un apice a 140
// km/h dove l'utente passava a 279, e seguendo bene la propria traiettoria.
//
// Un chiamante che non passa `turnRateAtRest` ottiene il conto di prima. E'
// voluto e c'e' un test che lo fissa: gli strumenti offline non aggiornati
// devono dare il vecchio numero in modo evidente, non un ripiego che gli
// somiglia — o le loro misure sarebbero false senza dirlo.
function velocitaSostenibile(raggio, maxSpeed, turnRateAtMax, turnRateAtRest) {
    if (!(turnRateAtRest > turnRateAtMax) || !(maxSpeed > 0)) {
        return raggio * turnRateAtMax;
    }
    const calo = turnRateAtRest - turnRateAtMax;
    return (raggio * turnRateAtRest) / (1 + (raggio * calo) / maxSpeed);
}

function cornerTargetSpeed(points, idx, scanSamples, localSamples, metersPerSample, currentSpeed, maxSpeed, brakeDecel, turnRateAtMax, marginFactor, gripCapacityFactor = 1, turnRateAtRest = 0) {
    const n = points.length;
    const step = Math.max(1, Math.floor(localSamples / 2));
    const localArcM = localSamples * metersPerSample;
    let target = maxSpeed;
    for (let offset = 0; offset <= scanSamples; offset += step) {
        const i1 = lookaheadIndex(n, idx, offset);
        const i2 = lookaheadIndex(n, idx, offset + localSamples);
        // ⚠️ IL GIRO DELLA MORTE NON E' UNA CURVA DA FRENARE. In pianta il tubo
        // va avanti e torna indietro sullo stesso segmento, quindi qualunque
        // finestra che lo tocchi misura un raggio ridicolo e questa funzione
        // ordinerebbe di rallentare fino a fermarsi — proprio dove invece
        // bisogna arrivare lanciati, o non si sale. Li' dentro non c'e' niente
        // da decidere: la traiettoria la impone il nastro.
        if (points[i1].acrobatico || points[i2].acrobatico) continue;
        const w = windowRadius(points, i1, i2, localArcM);
        if (!w) continue;   // praticamente dritto, nessun raggio significativo da questa finestra
        // gripCapacityFactor arriva già scalato dal chiamante (vedi
        // BOT_GRIP_CAPACITY_EXPONENT in updateBotInputs) — qui è solo un
        // moltiplicatore diretto, nessuna logica di scala in questa funzione.
        const cornerSpeed = Math.min(maxSpeed,
            velocitaSostenibile(w.radius, maxSpeed, turnRateAtMax, turnRateAtRest)
            * marginFactor * gripCapacityFactor);
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

// Il simmetrico: chi mi sta INSEGUENDO, quanto e' vicino e da che parte
// arriva.
//
// ⚠️ Serve anche il LATO, che a nearestAheadPlayer non serviva: una difesa
// che non sa da dove arriva l'attacco copre a caso, e coprire il lato
// sbagliato e' peggio che non coprire — gli si apre la porta.
const BOT_AFFIANCATO_M = 8;   // lunghezza di un'auto piu' un margine

// DA QUANTO LONTANO CI SI COMINCIA A COPRIRE, in secondi di distacco.
//
// ⚠️ IN TEMPO, NON IN UNITA' DI PISTA, e con una costante SUA. Prima era
// BOT_FOLLOW_GAP_M (30 unita'), condivisa con la scia e i sorpassi: su
// `prova`, a 5.5 unita' per tick, sono 0.27 secondi — il bot cominciava a
// coprirti quando gli eri a quattro lunghezze d'auto, e a 8 unita' (0.07 s)
// scattava gia' l'affiancamento, che congela lo scostamento. La difesa non
// faceva in tempo ad esistere, ed e' il playtest del 2026-09-05 ad averlo
// detto: «ad hard mi e' sembrato che non si spostano piu' i bot per
// difendere».
//
// Separata da BOT_FOLLOW_GAP_M apposta: quella soglia governa scia e
// sorpassi, tarati nel blocco H2, e allargarla li cambierebbe tutti.
const BOT_DIFESA_FINESTRA_S = 1.0;
const TICK_MS = 50;   // il passo del server, lo stesso di aggiornaErrore
function nearestBehindPlayer(p, allPlayers, track) {
    const n = track.points.length;
    const metersPerSample = track.lapLength / n;
    let best = null, bestGap = Infinity;
    for (const q of allPlayers) {
        if (q === p || q.finished || q.pitting || q.pitAutoState) continue;
        // Distanza INDIETRO lungo il giro: quanto quello dietro deve ancora
        // percorrere per arrivare dove sono io.
        const delta = (((p.trackIndex || 0) - (q.trackIndex || 0)) % n + n) % n;
        const gapM = delta * metersPerSample;
        if (gapM < bestGap) { bestGap = gapM; best = q; }
    }
    if (!best) return null;
    // Da che lato dell'asse sta, misurato NEL MIO PUNTO di pista: e' li' che
    // dovro' spostarmi, non dove si trova lui adesso.
    const idx = p.trackIndex || 0;
    const centro = track.points[idx];
    const nrm = TrackGeometry.normalAt(track.points, idx, true);
    const lato = Math.sign((best.x - centro.x) * nrm.nx + (best.z - centro.z) * nrm.nz) || 1;
    return { player: best, gapM: bestGap, lato, affiancato: bestGap < BOT_AFFIANCATO_M };
}

// LA DIFESA: chi ho dietro, da che parte arriva, e di quanto mi sposto per
// coprirlo.
//
// ⚠️ SI SPOSTA LA TRAIETTORIA, MAI LA VELOCITA'. Un bot che frena per restare
// davanti e' cio' che i giocatori riconoscono come «AI che bara»: qui dentro
// `targetSpeed` non compare, ed e' voluto.
//
// Vive in una funzione e non dentro updateBotInputs perche' i rami di guida
// sono DUE — con racing line e geometrico, per le piste che non ce l'hanno —
// e una difesa che valesse solo su uno funzionerebbe a seconda della pista.
//
// Restituisce null se non c'e' niente da fare: chi chiama tiene il suo sterzo.
function difendiSePossibile(p, game, track, aggro, target, steerGain) {
    const dietro = nearestBehindPlayer(p, Object.values(game.players), track);
    const adessoMs = (game.raceTick || 0) * 50;
    const difesa = F1Duelli.scostamentoDifensivo({
        latoAttaccante: dietro ? dietro.lato : 0,
        gapM: dietro ? dietro.gapM : Infinity,
        // Un secondo di distacco alla velocita' di adesso: chi corre si
        // copre da piu' lontano, chi arranca in una curva lenta no.
        //
        // ⚠️ MAI OLTRE MEZZO GIRO. Il gap «indietro» si misura col wrap del
        // tracciato: oltre meta' giro, chi risulta a un passo dietro di te e'
        // in realta' quello che hai DAVANTI, e il bot si metterebbe a
        // difendersi da lui. Su una pista corta la finestra di un secondo ci
        // arriva davvero (120 unita' di giro, 120 di finestra), e l'ha trovato
        // il test del sorpasso, non il gioco.
        finestraM: Math.min(
            Math.max(p.speed * BOT_DIFESA_FINESTRA_S * 1000 / TICK_MS, BOT_AFFIANCATO_M * 2),
            track.lapLength / 2),
        // In unita' di pista, dalla frazione di mezza carreggiata del
        // livello: una difesa tarata in unita' fisse vale meta' su una pista
        // larga il doppio (vedi f1Difficolta.js).
        forza: aggro.frazioneDifesa * track.roadHalf,
        scostamentoAttuale: p.botScostamentoDifesa || 0,
        affiancato: !!(dietro && dietro.affiancato),
        ultimoCambioMs: p.botUltimoCambioDifesa || 0,
        adessoMs,
    });
    const prima = p.botScostamentoDifesa || 0;
    if (difesa.scostamento !== 0 && Math.sign(difesa.scostamento) !== Math.sign(prima)) {
        p.botUltimoCambioDifesa = adessoMs;
    }
    p.botScostamentoDifesa = difesa.scostamento;
    if (difesa.scostamento === 0) return null;
    const nrm = TrackGeometry.normalAt(track.points, p.trackIndex || 0, true);
    const bersaglio = {
        x: target.x + nrm.nx * difesa.scostamento,
        z: target.z + nrm.nz * difesa.scostamento,
    };
    return {
        steer: steerToward(p.x, p.z, p.angle, bersaglio.x, bersaglio.z, steerGain),
        debugTarget: bersaglio,
    };
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
function otherCarTargetSpeed(other, laneSource, track, metersPerSample, brakeDecel, turnRateHigh, effectiveMaxSpeed, cornerSpeedMargin, brakingDistanceMargin, turnRateAtRest = 0) {
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const maxSpeed = effectiveMaxSpeed(other, false);
    const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * brakingDistanceMargin;
    const scanSamples = metersToSamples(scanM, track);
    return cornerTargetSpeed(
        laneSource, other.trackIndex || 0, scanSamples, localSamples, metersPerSample,
        other.speed, maxSpeed, brakeDecel, turnRateHigh, cornerSpeedMargin, 1, turnRateAtRest
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
// Colori in più per i BOT soltanto. La PALETTE sopra sono i colori che un
// giocatore può scegliere in lobby e deve restare in sync con
// frontend/index.js: sono dodici, e con venti piloti in griglia non bastano —
// se ne servono fino a diciannove per i soli bot. Questi non compaiono nella
// scelta colore: nessuno li "possiede", servono solo a distinguere le auto in
// pista e i pallini in classifica.
const PALETTE_BOT_EXTRA = [
    '#16A085', '#D35400', '#8E44AD', '#C0392B',
    '#27AE60', '#F39C12', '#7F8C8D', '#1ABC9C',
    '#E91E8C', '#A0522D', '#2C3E50', '#BDC3C7',
];

function pickBotColors(humanColors, count, rng = Math.random) {
    const taken = new Set(humanColors.map(c => c.toUpperCase()));
    // Prima i colori della piattaforma, poi la riserva: con pochi bot le auto
    // restano quelle di sempre, e i colori in più entrano solo quando servono.
    const pool = PALETTE.concat(PALETTE_BOT_EXTRA).filter(c => !taken.has(c));
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
// ⚠️ IL VENTAGLIO DEI BOT ORA VIENE DAL LIVELLO (f1Difficolta.js), non da
// qui: `BOT_SPEED_FACTOR_MIN/MAX` e `BOT_PRECISION_NOISE_MIN` sono state tolte
// il 2026-09-05 perche' non decidevano piu' niente, e una costante che resta
// scritta senza comandare fa credere al prossimo lettore che sia lei a farlo.
//
// Resta questa, che ha un altro mestiere: normalizzare quanto un bot e'
// impreciso per decidere di quanto sbaglia la mira ai box (vedi sotto). E' il
// riferimento storico del rumore massimo, non piu' il massimo che un bot puo'
// avere — a `facile` il piu' impreciso arriva a 0.22.
const BOT_PRECISION_NOISE_MAX = 0.25;   // rad aggiunti/tolti allo sterzo

// La traiettoria PROPRIA di un bot: quanto si scosta dalla linea buona, in
// unita' di pista. Serve a non avere sei copie sulla stessa riga — e a dare
// alla difesa qualcosa da cui muoversi.
//
// ⚠️ PICCOLO. La racing line e' gia' ottimizzata: ogni unita' di scostamento
// costa tempo sul giro, e una varieta' generosa diventerebbe solo lentezza.
// Quanto costi davvero e' misurato nel commit che lo introduce.
const BOT_LINEA_OFFSET_MAX = 1.5;

// Quanto lontano dall'asse puo' arrivare il bersaglio, in frazione della
// mezza carreggiata: il resto e' il margine che il pure-pursuit si mangia
// tagliando fra se' e il punto che insegue.
const BOT_BERSAGLIO_MAX_FRAZIONE = 0.92;
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
// Quanti metri di anticipo servono, PER METRO di scostamento laterale tra
// linea principale e corsia box, per convergere in tempo dentro il
// rettangolo-trigger — misurato: new-monza (scostamento minore) funzionava
// già con l'anticipo fisso precedente, monte-rosso/prova (scostamento
// maggiore) no (Rif. backend/tools/f1PitEntryCheck.js, Task 7). Candidato
// iniziale, da verificare/aumentare con quello strumento su tutte le piste
// prima di considerare questo task chiuso — non un valore derivato
// matematicamente, una misura empirica come BOT_ADAPTIVE_LOOKAHEAD_K.
const PIT_CONVERGENCE_LEAD_FACTOR = 5;
// Sotto questa distanza (metri) da pitPath[0] si passa dal bersaglio
// sfumato all'inseguimento diretto di pitPath[1] (dentro il vero riquadro-
// trigger, verificato) — evita di "arrivare" su pitPath[0] e poi tornare
// verso la traiettoria normale prima di aver davvero attraversato il
// riquadro che fa scattare l'ingresso ai box.
const BOT_PIT_LANE_FOLLOW_M = 25;
// Il bersaglio dell'imbocco si cerca solo nella prima METÀ della corsia box:
// più avanti ci sono i box e poi l'uscita, che rientra sul nastro — un'auto
// sul rettilineo potrebbe avere lì il suo campione di corsia più vicino e
// verrebbe tirata all'indietro.
const PIT_LANE_ENTRY_HALF = 0.5;
// Lookahead dell'ingresso ai box, in unità di mondo — sempre in metri e mai
// in campioni: la corsia ne ha 300 su ogni pista ma NON equispaziati, e su
// monte-rosso i primi 34 coprono 20 unità (tuckPitEndsToTrack addensa il
// raccordo). Un lookahead "a campioni" valeva lì 7 unità, un bersaglio a un
// palmo dal muso che il bot non riusciva a inseguire.
//
// Più corto di quello di gara: qui si sta girando dentro un varco largo
// quanto una corsia, e un lookahead lungo taglia l'angolo del muro.
const PIT_ENTRY_LOOKAHEAD_MIN_M = 16;
const PIT_ENTRY_LOOKAHEAD_TIME_S = 0.55;
// Dentro la corsia lo sguardo si accorcia ancora e il gas cala: il raccordo
// gira stretto, e un lookahead lungo su una curva stretta fa tagliare
// l'angolo — misurato, il bot entrava sulla corsia a 2.4 unità e ne usciva a
// 10.1 in cinque tick, rientrando in pista. Non è una taratura a sentimento:
// è la stessa relazione fra raggio e velocità che governa tutta la guida.
const PIT_LANE_LOOKAHEAD_MIN_M = 7;
const PIT_LANE_LOOKAHEAD_TIME_S = 0.25;
// Velocita' a cui affrontare il raccordo dei box. Non e' una taratura a
// sentimento: l'autopilota del server percorre la corsia a 1.55 unita'/tick
// (25% del massimo), e il raccordo ha lo stesso raggio. Un bot che ci arriva
// a 4.7 - misurato - non puo' seguirlo comunque sterzi: taglia e rientra in
// pista. Si frena PRIMA, come fa un pilota vero all'ingresso dei box.
const PIT_ENTRY_SPEED = 1.9;
// Da quanti metri prima del raccordo iniziare a rallentare.
const PIT_ENTRY_BRAKE_M = 70;
// Quanto dentro il bordo pista tenere il bersaglio dell'avvicinamento.
const PIT_ENTRY_ASPHALT_MARGIN = 2;
// Quanto oltre la semilarghezza della corsia si è ancora "sulla corsia": mezza
// vettura di tolleranza, perché il bersaglio è un centro-corsia e l'auto lo
// insegue, non ci sta incollata.
const PIT_LANE_ON_LANE_MARGIN = 3;

// Il campione dell'IMBOCCO della corsia box più vicino all'auto, e quanto
// dista. Cercato solo nella prima metà: più avanti c'è l'uscita, che rientra
// sul nastro, e un'auto sul rettilineo verrebbe agganciata a quella.
function campioneImboccoPiuVicino(p, track) {
    const pl = track.pitLanePts;
    if (!pl || pl.length < 2) return null;
    const finestra = Math.min(pl.length - 1, Math.max(1, Math.floor(pl.length * PIT_LANE_ENTRY_HALF)));
    let vicino = 0, minD = Infinity;
    for (let i = 0; i <= finestra; i++) {
        const s = pl[i];
        const d = (p.x - s.x) ** 2 + (p.z - s.z) ** 2;
        if (d < minD) { minD = d; vicino = i; }
    }
    return { indice: vicino, dist: Math.sqrt(minD) };
}

// Riporta un punto dentro il nastro, se ne è uscito. Il margine tiene conto
// del fatto che l'auto insegue il bersaglio con un ritardo: mirare esattamente
// il bordo vuol dire passarci sopra.
function riportaSullAsfalto(x, z, track) {
    const limite = (track.roadHalf || 11) - PIT_ENTRY_ASPHALT_MARGIN;
    const c = TrackGeometry.nearestPoint(track.points, x, z);
    if (c.dist <= limite || c.dist === 0) return { x, z };
    const k = limite / c.dist;
    return { x: c.x + (x - c.x) * k, z: c.z + (z - c.z) * k };
}

// L'auto è arrivata sull'imbocco della corsia box: da qui in poi segue la
// corsia e basta, la linea di gara non c'entra più.
//
// Non serve escludere il raccordo (campione 0, agganciato al bordo pista):
// misurato, fuori dalla zona d'ingresso la linea di gara non si avvicina mai
// a meno di 60 unità dai primi 150 campioni di corsia su nessuna pista, e
// questa prova si fa solo su un bot che ha già deciso di fermarsi.
function suImboccoCorsia(p, track) {
    const q = campioneImboccoPiuVicino(p, track);
    return !!q && q.dist <= (track.pitRoadHalf || 5) + PIT_LANE_ON_LANE_MARGIN;
}

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
// ⚠️ DUE e non uno. `remainingLaps <= 1` vuol dire «sta correndo l'ultimo
// giro»: con quel valore, su una pista corta dove l'usura non arriva mai alla
// soglia, TUTTI i bot finivano per entrare ai box proprio li'. Segnalato
// dall'utente il 2026-09-05: «non voglio che i bot vadano ai box all'ultimo
// giro, massimo al penultimo. non si puo' finire la gara passando ai box».
const BOT_FORCE_PIT_LAPS_REMAINING = 2;
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

    // Il livello scelto in lobby decide ritmo e precisione di TUTTA la
    // griglia. Prima del 2026-09-05 ogni bot pescava per conto suo fra
    // 0.93-1.00 e 0-0.25, quindi la difficolta' cambiava da una gara
    // all'altra senza che nessuno la scegliesse.
    const intervalli = F1Difficolta.intervalliDi(game.settings && game.settings.botDifficolta);
    if (!botsEnabled) return;

    const humanColors = (lobby && (lobby.lockedPlayers || lobby.players)) || [];
    // Quanti piloti in tutto: la scelta della lobby, limitata dal tetto.
    const inGriglia = Math.min(MAX_GRID_SIZE, game.gridSize || GRID_SIZE_DEFAULT);
    const botsNeeded = inGriglia - humanColors.length;
    if (botsNeeded <= 0) return;

    // In CAMPIONATO i bot non si sorteggiano: sono quelli fissati alla
    // creazione della stagione, con lo stesso colore e lo stesso nome per tutte
    // le gare. E' l'unico punto in cui la stagione parla a chi crea la griglia
    // (Rif. docs/superpowers/specs/2026-08-19-f1-stagioni-design.md). Senza,
    // la classifica sommerebbe i punti di piloti diversi: "Bot 3" della seconda
    // gara non sarebbe quello della prima.
    const daStagione = Array.isArray(game.botStagione) ? game.botStagione.slice(0, botsNeeded) : null;
    const colors = daStagione ? daStagione.map(b => b.colore) : pickBotColors(humanColors, botsNeeded, rng);
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
            pitEsito:        null,
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
            // Parco chiuso: anche i bot arrivano al weekend con la macchina
            // che avevano alla bandiera precedente. Se ripartissero nuovi ogni
            // volta il campionato sarebbe una discesa. Null in gara veloce.
            usuraIniziale:           Stagione.usuraEreditata(game, color),
            collisionPenaltyMs:      0,
            pendingRepair:           false,
            carContacts:             new Set(),
            wallContact:             false,
            pendingCollisionPenaltyEvents: [],
            // --- campi solo-bot ---
            isBot:                  true,
            // Il nome vale SOLO in campionato, dove serve a distinguere i bot
            // in classifica fra una gara e l'altra. Fuori resta null e il
            // gioco continua a identificare i piloti dal colore, come ha
            // sempre fatto (mai nickname, solo colore).
            nomeStagione:           daStagione ? (daStagione.find(b => b.colore === color) || {}).nome || null : null,
            botSpeedFactor:         randRange(intervalli.ritmoMin, intervalli.ritmoMax, rng),
            botPrecisionNoise:      randRange(intervalli.rumoreMin, intervalli.rumoreMax, rng),
            // La sua idea di traiettoria: chi taglia un filo piu' stretto, chi
            // sta un filo piu' largo.
            botLineaOffset:         randRange(-BOT_LINEA_OFFSET_MAX, BOT_LINEA_OFFSET_MAX, rng),
            // Quanto prende male l'apice: 0 = passa dove passa la linea buona,
            // 0.35 = si allarga di un terzo di carreggiata. E' il carattere
            // del pilota, e si paga in tempo sul giro — per questo
            // l'intervallo dipende dal livello (vedi f1Difficolta.js).
            botAllargamento:        randRange(intervalli.allargaMin, intervalli.allargaMax, rng),
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
function computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor, turnRateAtRest = 0) {
    const metersPerSample = track.lapLength / track.points.length;
    const localSamples = metersToSamples(BOT_CURVATURE_LOCAL_M, track);
    const speedMs = Math.max(5, botSpeedMs(p.speed));
    const lookM = adaptiveLookaheadMeters(track.racingLine, p.trackIndex || 0, track, rt.adaptiveLookaheadK, speedMs);
    const lookSamples = metersToSamples(lookM, track);
    let targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
    // ⚠️ NON SI MIRA MAI DENTRO IL TUBO. Visti dall'alto i campioni di un giro
    // della morte si spostano verso l'USCITA, che sta di fianco all'ingresso:
    // puntandoli, il bot sterzava verso l'altra corsia invece di imboccare il
    // loop dritto — «prima di salire e fare il loop si orientano verso l'altra
    // parte di pista» (visto in gioco dall'utente il 2026-08-26). Si mira
    // all'imbocco, che sta sull'asse; da lì in poi la traiettoria non è più
    // affare suo, la impone il nastro.
    targetIdx = mirinoPrimaDelTubo(track, p.trackIndex || 0, targetIdx);
    const target = track.racingLine[targetIdx];

    const steer = steerToward(p.x, p.z, p.angle, target.x, target.z, rt.steerGain);

    const scanM = (maxSpeed * maxSpeed) / (2 * brakeDecel) * rt.brakingDistanceMargin;
    const scanSamples = metersToSamples(scanM, track);
    const targetSpeed = cornerTargetSpeed(
        track.racingLine, p.trackIndex || 0, scanSamples, localSamples, metersPerSample,
        p.speed, maxSpeed, brakeDecel, turnRateHigh, rt.cornerSpeedMargin, gripCapacityFactor, turnRateAtRest
    );

    // scanSamples esce di qui perche' e' gia' calcolato: chi corregge la
    // linea con apexOffset ha bisogno dello stesso raggio di ricerca.
    return { steer, target, targetSpeed, localSamples, scanSamples, targetIdx };
}

// Margine sulla distanza di frenata calcolata dalla fisica: oltre il
// margine "matematico" già insito nel calcolo (v0²−v1²=2·decel·distanza),
// un 20% extra copre l'imprecisione del rilevamento a campioni discreti.
const BOT_BRAKING_DISTANCE_MARGIN    = 1.2;
const BOT_SPEED_MARGIN          = 0.03;  // isteresi throttle/brake attorno alla velocità target
// Dove "preme" un bot dentro la zona dell'indicatore, in unità di scarto dal
// punto perfetto: un bot preciso ci va vicino, uno impreciso lo manca. Sono
// unità di SPAZIO e non millisecondi, perché adesso il gioco di reazione è
// agganciato a un punto della corsia — e il bot passa esattamente dallo stesso
// giudizio dei giocatori (handlePitReactionPress), invece di avere una sua
// scala di durate: se un bot facesse soste che un umano non può fare, o
// viceversa, non se ne accorgerebbe nessuno finché non conta.
const BOT_PIT_SCARTO_MAX = 11;
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
// ⚠️ Il valore che era scritto qui vive ora nella tabella dei livelli
// (frontend/shared/f1Difficolta.js), col suo perche': era una costante, ed e'
// diventata una delle cose che cambiano fra facile e difficile.
// Sorpasso: entro BOT_FOLLOW_GAP_M, se il bot avrebbe margine di velocità
// libera vero sull'auto che precede (non solo momentaneo, es. lei in
// frenata per una curva) tenta di superarla scartando di lato invece di
// limitarsi a rallentare — altrimenti la "skill" di qualifica diventa una
// posizione fissa per tutta la gara, nessun sorpasso si verifica mai.
// ⚠️ Il valore che era scritto qui vive ora nella tabella dei livelli
// (frontend/shared/f1Difficolta.js), col suo perche': era una costante, ed e'
// diventata una delle cose che cambiano fra facile e difficile.
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

// ═══════════ IL PROFILO DI ALLARGAMENTO ═══════════
//
// Per ogni campione della pista: QUANTO ci si deve allargare li' (0 = siamo
// all'apice, la traiettoria buona e' quella della linea; 1 = siamo lontani da
// ogni apice, qui si sta larghi) e DA CHE PARTE sta l'interno della curva.
//
// ⚠️ PERCHE' NON `apexOffset`. La forma a S esiste gia' nel ramo geometrico,
// e il primo tentativo e' stato riusarla prendendone la meta' che spinge
// fuori. Non funziona, e la misura dice perche': su `prova` quella funzione
// lavora con una finestra di 12 METRI, che sono 2 campioni (il passo e' 5.17
// unita'), e il segnale che ne esce salta a scatti — 0, 0, 0.97, 0, 0.97 —
// perche' la curvatura su due campioni e' rumore. In piu' la sua `severity`
// vale roadHalf/raggio, cioe' 11/88 = 0.125 sulle curve di `prova`: anche
// quando il segnale c'e', l'effetto e' mezzo metro. E' tarata per decidere
// l'apice quando NON c'e' una racing line, non per correggerne una.
//
// Qui invece: curvatura su una finestra in UNITA' DI PISTA (60), che sono 12
// campioni su `prova` e 51 su monte-rosso — liscia in entrambi i casi — e
// confronto con la curvatura massima nella curva in cui si sta. Verificato
// che l'intorno di +-60 unita' e' quello giusto: agli apici veri il fattore
// esce 0.02, mentre a +-186 unita' esce 0.26 perche' sconfina nella curva
// successiva e non riconosce piu' l'apice locale.
//
// Si calcola UNA VOLTA per pista (la pista non cambia mai) e si tiene in una
// WeakMap: mai scritto dentro `track`, che e' l'oggetto condiviso e cacheato
// da trackLoader.
const PROFILO_ALLARGAMENTO = new WeakMap();
const BOT_FASE_CURVA_M = 60;      // finestra di curvatura E ampiezza dell'intorno
// Sotto questa curvatura non e' una curva ma un rettilineo con del rumore
// dentro: 20 volte la mezza carreggiata e' una piega, non una staccata.
const BOT_CURVA_MINIMA_RAGGI = 20;

function profiloAllargamento(track) {
    const gia = PROFILO_ALLARGAMENTO.get(track);
    if (gia) return gia;
    const n = track.points.length;
    const passo = track.lapLength / n;
    const finestra = Math.max(4, Math.round(BOT_FASE_CURVA_M / passo));
    const curvatura = new Array(n), versoLocale = new Array(n);
    for (let i = 0; i < n; i++) {
        const c = TrackGeometry.curvatureAt(track.points, i, finestra);
        curvatura[i] = (c && isFinite(c.radius) && c.radius > 0) ? 1 / c.radius : 0;
        versoLocale[i] = c ? Math.sign(c.turnSigned) : 0;
    }
    const soglia = 1 / (track.roadHalf * BOT_CURVA_MINIMA_RAGGI);
    const fattore = new Array(n), verso = new Array(n);
    for (let i = 0; i < n; i++) {
        let massima = 0, dovE = i;
        for (let d = -finestra; d <= finestra; d++) {
            const j = (i + d + n) % n;
            if (curvatura[j] > massima) { massima = curvatura[j]; dovE = j; }
        }
        fattore[i] = massima > soglia ? Math.max(0, 1 - curvatura[i] / massima) : 0;
        // Il verso lo detta l'APICE, non il punto in cui si sta: in ingresso
        // la pista e' quasi dritta e il suo verso locale e' rumore.
        verso[i] = versoLocale[dovE];
    }
    const profilo = { fattore, verso };
    PROFILO_ALLARGAMENTO.set(track, profilo);
    return profilo;
}

// ═══════════ L'ERRORE UMANO ═══════════
//
// Un errore dura poco e costa qualche decimo: il bot allarga in uscita di
// curva o frena troppo tardi. Non finisce in ghiaia.
//
// ⚠️ COSTA TEMPO, NON LA GARA (spec 2026-09-05, invariante 6). Un bot che
// sbaglia deve restare dentro i limiti della pista: e' la differenza fra un
// avversario divertente e uno rotto. Se questi numeri crescono, la misura da
// rifare e' quella dei tick fuori dal cordolo, non la sensazione.
const BOT_ERRORE_DURATA_MS = 900;
const BOT_ERRORE_STERZO = 0.25;    // quanto allarga, in frazione di sterzo
const BOT_ERRORE_FRENO = 0.15;     // quanto ritarda la frenata

// Decide se comincia un errore, e lo fa scadere. Restituisce true nel tick in
// cui un errore COMINCIA — cosi' si puo' contare senza guardare dentro `p`.
//
// `giroMs` e' quanto dura un giro: chi chiama lo stima dalla velocita' di
// adesso (lapLength / speed * tickMs), e non da un tempo fisso, perche'
// «un errore e mezzo a giro» deve valere uguale su una pista da 50 secondi
// e su una da tre minuti.
//
// `rng` esiste per i test: con Math.random il conteggio degli errori sarebbe
// statistico, e un test statistico su una soglia bassa e' un rosso che arriva
// una volta ogni venti esecuzioni senza voler dire niente.
function aggiornaErrore(p, erroriPerGiro, tickMs, giroMs, rng) {
    const caso = rng || Math.random;
    p.botOrologioMs = (p.botOrologioMs || 0) + tickMs;
    // Un errore alla volta: dentro uno che dura non ne parte un altro sopra.
    if (p.botErroreFinoMs && p.botErroreFinoMs >= p.botOrologioMs) return false;
    const perTick = (erroriPerGiro || 0) * tickMs / (giroMs || 50000);
    if (caso() >= perTick) return false;
    p.botErroreFinoMs = p.botOrologioMs + BOT_ERRORE_DURATA_MS;
    // Meta' delle volte allarga, meta' frena tardi.
    p.botErroreTipo = caso() < 0.5 ? 'allarga' : 'frenata';
    return true;
}

function updateBotInputs(game, deps) {
    const {
        effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium,
        accel, brakeMult, turnRateHigh, turnRateLow = 0, tuning: tuningOverrides, slipstreamMaxBoost,
        effectiveBrakeMult, corneringCapacity
    } = deps;
    const tuning = { ...DEFAULT_TUNING, ...(tuningOverrides || {}) };
    // Quanto sono aggressivi, secondo il livello scelto in lobby: con quanto
    // margine tentano un sorpasso e quanto restano attaccati a chi precede.
    // I valori di `medio` sono quelli storici (1.01 e 0.85).
    const aggro = F1Difficolta.soglieDi(game.settings && game.settings.botDifficolta);
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
        // `p.finished` NON esclude piu': chi ha tagliato il traguardo continua
        // a girare fino a fine sessione. Prima si fermava sulla linea, e
        // seguendo tutti la stessa traiettoria i bot arrivati formavano una
        // fila ferma in mezzo alla pista (segnalato in playtest).
        //
        // Tengono il ritmo di gara e non rallentano: un treno lento di auto
        // gia' arrivate davanti a chi corre ancora sarebbe lo stesso ingorgo,
        // in movimento.
        if (!p.isBot) continue;

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
        // SOLO in gara: in qualifica (giro secco) un pilota vero spinge
        // sempre al massimo, nessun "giorno storto" — il bot corre sempre
        // al proprio ritmo migliore (botSpeedFactor puro, mai penalizzato
        // né gonfiato dalla variazione). Senza questo isQuali, il valore
        // ereditato dalla griglia (già randomizzato in createBots) e le
        // ri-estrazioni a metà giro rendevano il tempo di qualifica di ogni
        // bot dipendente anche da QUANDO l'umano tagliava il traguardo
        // (endQualifying stima il tempo dei bot non ancora arrivati
        // estrapolando dal progresso in quell'istante) — scoperto indagando
        // una correlazione segnalata dall'utente tra il proprio tempo e
        // quello dei bot.
        if (isQuali) {
            p.botLapPaceMult = 1;
        } else {
            const paceSegmentSamples = Math.ceil(track.points.length / BOT_LAP_PACE_SEGMENTS);
            const paceSegment = p.lap * BOT_LAP_PACE_SEGMENTS + Math.floor((p.trackIndex || 0) / paceSegmentSamples);
            if (paceSegment !== p.botLapSeen) {
                p.botLapSeen = paceSegment;
                p.botLapPaceMult = 1 + (Math.random() * 2 - 1) * BOT_LAP_PACE_VARIANCE;
            }
        }

        // Fermo ai box o guidato dall'autopilota corsia box: nessun input
        // di guida da scrivere, il server ha già il volante. L'unica cosa
        // che un bot deve ancora fare qui è "premere" il minigioco di
        // reazione al segnale di via, con un ritardo simulato realistico.
        if (p.pitAutoState || p.pitting) {
            p.botHeadingToPits = false;
            if (!p.pitAutoState) p.botPitReactionScheduled = false;
            // "Preme" quando la corsia lo porta sul punto che si è scelto: il
            // bersaglio è il centro della zona, spostato di quanto quel bot è
            // impreciso. Il verdetto lo dà il server, come per un umano.
            if (p.pitAutoState === 'entering' && p.pitPiano && !p.botPitReactionScheduled) {
                // Il bot mira al muro come un umano, sbagliando di quanto e'
                // impreciso, e passa dallo stesso giudizio: la sua distanza dal
                // muro e' misurata con la STESSA funzione.
                const t = p.botPrecisionNoise / BOT_PRECISION_NOISE_MAX;
                const segno = (p.color.charCodeAt(1) % 2) ? 1 : -1;
                const bersaglio = segno * t * BOT_PIT_SCARTO_MAX;
                const distanza = BoxIngresso.distanzaDalMuro(p.pitPiano, p.x, p.z, p.angle);
                if (distanza != null && distanza <= bersaglio) {
                    p.botPitReactionScheduled = true;
                    handlePitReactionPress(io, lobbyId, game, p);
                }
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
            // Nell'ultimo giro non si entra ai box per nessuna ragione: chi e'
            // arrivato fin qui senza pittare si tiene la penalita', ma la gara
            // non si chiude passando dalla corsia. ⚠️ Su una gara di un giro
            // solo non esiste un penultimo: li' il vincolo non si puo'
            // rispettare e non si applica, o il bot non sosterebbe mai.
            const ultimoGiro = track.totalLaps > 1 && remainingLaps <= 1;
            if ((wearThresholdHit || mustPitNow) && !ultimoGiro) {
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
        // ...oppure ci sono già sopra. La finestra misurata sull'indice di
        // pista si chiude nell'istante in cui lo si supera, ma su monte-rosso
        // la corsia resta agganciata al bordo pista ancora per una trentina di
        // campioni oltre quel punto: chiudere lì rimandava il bot in pista
        // proprio mentre era arrivato sulla corsia, e il varco non scattava
        // mai. Finché si è FISICAMENTE sull'imbocco della corsia, si continua a
        // seguirla — è il server, non l'indice, a decidere quando l'ingresso
        // è avvenuto.
        const giaSullImbocco = p.botHeadingToPits && suImboccoCorsia(p, track);
        const nearPitEntry = p.botHeadingToPits &&
            (idxUntilPitEntry <= metersToSamples(BOT_PIT_APPROACH_M, track) || giaSullImbocco);

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

        let steer, throttle = 0, brake = 0, inCorsiaBox = false;
        if (nearPitEntry) {
            botState = 'PIT_ENTRY';
            // ═══════════ INSEGUIRE UN PERCORSO, NON UN PUNTO ═══════════
            //
            // Entrare ai box è pure pursuit su un percorso solo: il nastro
            // fino al raccordo, poi la corsia box. Il bersaglio è il punto a
            // `lookahead` metri PIÙ AVANTI SU QUEL PERCORSO — quando il
            // lookahead supera la distanza che manca al raccordo, sconfina
            // sulla corsia e prosegue lì. Nient'altro: nessuna miscela, nessun
            // punto d'ancoraggio, nessuna finestra di convergenza.
            //
            // La formulazione precedente (miscela cubica fra la linea di gara
            // e un punto FISSO scelto sulla corsia o sul riquadro-trigger) è
            // stata riscritta perché ha fallito in tutti i modi possibili, uno
            // per pista: un punto fisso a 90 unità di distanza si raggiunge in
            // linea retta, e in linea retta fra il nastro e la corsia c'è la
            // BARRIERA. Al playtest del 2026-08-17 i bot ci si puntavano
            // contro e ci scivolavano lungo fino al varco — misurato: una
            // botta da 4.2 di danno, poi distanza dal nastro inchiodata a
            // 12-13 unità per 70 unità di strada, a velocità 2. Il bersaglio
            // di un pure pursuit sta sul percorso per definizione, e il
            // percorso passa dal varco.
            // Un pure pursuit puro però non basta da solo: all'imbocco la
            // linea di gara può passare dal LATO OPPOSTO del nastro rispetto
            // ai box (misurato su monte-rosso: l'auto a 4.8 dal centro pista
            // e a 12.8 dalla corsia, cioè larga dall'altra parte), e un
            // lookahead corto non fa in tempo ad attraversare. Serve anche uno
            // spostamento laterale ANTICIPATO — ma verso il RACCORDO, che sta
            // sul bordo pista dove la barriera si apre, non verso un punto in
            // fondo alla corsia che sta oltre il muro.
            const pl = track.pitLanePts;
            const laneSource = track.racingLine || track.points;
            const speedMs = Math.max(5, botSpeedMs(p.speed));
            const lookM = Math.max(PIT_ENTRY_LOOKAHEAD_MIN_M, speedMs * PIT_ENTRY_LOOKAHEAD_TIME_S);

            if (giaSullImbocco) {
                // Fase 2 — sulla corsia: il percorso è solo la corsia, e la
                // linea di gara non conta più niente.
                const q = campioneImboccoPiuVicino(p, track);
                const lookCorsiaM = Math.max(PIT_LANE_LOOKAHEAD_MIN_M, speedMs * PIT_LANE_LOOKAHEAD_TIME_S);
                const wp = TrackGeometry.walkPitPath(pl, q.indice, lookCorsiaM);
                steer = steerToward(p.x, p.z, p.angle, wp.x, wp.z);
                debugTarget = { x: wp.x, z: wp.z };
                inCorsiaBox = true;
            } else {
                // Fase 1 — avvicinamento: si scivola dalla linea di gara al
                // raccordo, con peso cubico. Cubico e non lineare perché per
                // quasi tutta la finestra il bersaglio deve restare quello
                // della guida normale (segue la curva vera): con peso lineare
                // si taglia l'ultima curva prima ancora di essere ai box
                // (segnalato dall'utente su New Monza).
                // Le fixture dei test costruiscono piste senza corsia
                // campionata: lì il raccordo è il primo punto del percorso
                // disegnato, come prima di questa riscrittura.
                const raccordo = (pl && pl.length) ? pl[0] : track.pitPath[0];
                const approachSamples = metersToSamples(BOT_PIT_APPROACH_M, track);
                const mainAtEntry = laneSource[track.pitEntryIndex] || laneSource[laneSource.length - 1];
                // Quanto è largo lo scostamento fra linea di gara e raccordo:
                // più è largo, più anticipo serve per traversare in tempo.
                const splitGapM = Math.hypot(mainAtEntry.x - raccordo.x, mainAtEntry.z - raccordo.z);
                const convergenceLeadSamples = metersToSamples(Math.max(BOT_PIT_LANE_FOLLOW_M, splitGapM * PIT_CONVERGENCE_LEAD_FACTOR), track);
                const denomSamples = Math.max(1, approachSamples - convergenceLeadSamples);
                const tLinear = idxUntilPitEntry <= convergenceLeadSamples
                    ? 1
                    : Math.max(0, 1 - (idxUntilPitEntry - convergenceLeadSamples) / denomSamples);
                const t = tLinear * tLinear * tLinear;
                const avanti = laneSource[lookaheadIndex(track.points.length, p.trackIndex || 0, metersToSamples(lookM, track))];
                // Il bersaglio è la MEDIA di due punti che stanno su una
                // curva: la media di due punti di una curva cade fuori dalla
                // curva, ed è finita fuori dall'asfalto (misurato: 15.1 dal
                // centro pista su prova, semilarghezza 11; 30.2 su new-monza,
                // semilarghezza 14 — con la barriera lì in mezzo). Si riporta
                // dentro il nastro per costruzione, invece di sperare che ci
                // resti: il raccordo stesso sta sul bordo, quindi questo
                // vincolo non gli toglie niente.
                const mira = riportaSullAsfalto(
                    avanti.x * (1 - t) + raccordo.x * t,
                    avanti.z * (1 - t) + raccordo.z * t,
                    track);
                steer = steerToward(p.x, p.z, p.angle, mira.x, mira.z);
                debugTarget = mira;
            }
            // Arrivare gia' lenti al raccordo: dentro la corsia non c'e'
            // sterzata che tenga se si entra a velocita' di gara.
            const mancaAlRaccordoM = idxUntilPitEntry * track.lapLength / track.points.length;
            if (inCorsiaBox || mancaAlRaccordoM <= PIT_ENTRY_BRAKE_M) {
                if (p.speed > PIT_ENTRY_SPEED) { brake = 1; throttle = 0; }
                else { brake = 0; throttle = 0.35; }
            } else {
                throttle = 0.6;   // rallenta in avvicinamento
            }
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
            const solo = computeSoloRacingLineInputs(p, track, rt, maxSpeed, brakeDecel, turnRateHigh, gripCapacityFactor, turnRateLow);
            // LA LINEA DI QUESTO BOT: quella buona piu' il suo scostamento
            // personale. Sei bot sulla stessa riga sono sei copie, e da una
            // riga sola la difesa non avrebbe da che parte muoversi.
            // L'INGRESSO LARGO. La racing line precalcolata entra in curva
            // gia' all'interno: misurato su `prova`, l'ingresso medio sta a
            // +4.3 verso il cordolo interno (un fuori-dentro-fuori entrerebbe
            // NEGATIVO), e tre curve su undici stanno a 10.5-10.8 su 11
            // dall'ingresso all'uscita. E' il motivo per cui i bot si vedono
            // «sempre all'interno curva» e li si supera dal lato libero.
            //
            // Il rimedio riusa la forma che il ramo geometrico ha gia'
            // (`apexOffset`, cos(x*pi): +1 all'apice, -1 ai bordi della zona
            // d'influenza) prendendone SOLO la meta' negativa: dove la forma
            // dice «qui si sta larghi» il bersaglio va verso l'esterno, dove
            // dice «qui c'e' l'apice» non si tocca niente. L'apice la linea
            // ottimizzata lo fa bene — e' l'ingresso che sbaglia, e sommare
            // due volte l'interno porterebbe soltanto fuori pista.
            // Tutto quello che segue si valuta NEL PUNTO MIRATO, non dove sta
            // il bot: e' li' che il bersaglio verra' spostato, e in una curva
            // stretta la normale di qui e quella di venti campioni piu' avanti
            // guardano da due parti diverse.
            const iBers = solo.targetIdx;
            // Quanto allargarsi qui, e da che parte sta l'interno: lo dice il
            // profilo della pista, calcolato una volta sola (vedi sopra).
            // ⚠️ Si legge dove sta IL BOT, non nel punto mirato: e' il bot che
            // deve trovarsi largo in ingresso.
            const profilo = profiloAllargamento(track);
            const iQui = p.trackIndex || 0;
            // Verso l'ESTERNO:  punta all'interno, e il segno meno e'
            // tutta la differenza fra allargare e tagliare ancora di piu'.
            // ⚠️ Quanto allargarsi e' del BOT, non della pista: due auto nello
            // stesso punto di curva prendono l'apice in modo diverso, ed e'
            // questo che le mette su una fascia invece che in fila. Chi non ha
            // un carattere (il banco prova, un test) resta sulla linea.
            const latLargo = -profilo.verso[iQui] * profilo.fattore[iQui] *
                             track.roadHalf * (p.botAllargamento || 0);
                        const nrmBers = TrackGeometry.normalAt(track.points, iBers, true);
            const centroBers = track.points[iBers];
            const suo = p.botLineaOffset || 0;
            // I due scostamenti (il suo e l'ingresso largo) si sommano in UNA
            // laterale sola e si tagliano insieme: sommare due vettori e
            // sperare che il totale resti in pista e' come non avere limite.
            const latLinea = (solo.target.x - centroBers.x) * nrmBers.nx +
                             (solo.target.z - centroBers.z) * nrmBers.nz;
            // ⚠️ Il tetto non e' 0.92 secco: la racing line ottimizzata arriva
            // da sola a 10.7 su 11 (il 98%), e un tetto piu' basso la
            // taglierebbe — cambiando la traiettoria di tutti, che non e' quel
            // che si sta facendo qui. Si tiene il piu' largo fra il 92% e dove
            // la linea gia' passa: gli scostamenti non portano MAI piu' fuori
            // di lei.
            const tetto = Math.max(Math.abs(latLinea), track.roadHalf * BOT_BERSAGLIO_MAX_FRAZIONE);
            const latVoluta = Math.max(-tetto, Math.min(tetto, latLinea + suo + latLargo));
            const scarto = latVoluta - latLinea;
            const target = scarto === 0 ? solo.target : {
                x: solo.target.x + nrmBers.nx * scarto,
                z: solo.target.z + nrmBers.nz * scarto,
            };
            const localSamples = solo.localSamples;   // riusato più sotto per il sorpasso (windowRadius) — evita di ricalcolarlo
            // ⚠️ Lo sterzo va RICALCOLATO sul bersaglio nuovo: `solo.steer`
            // punta alla linea di tutti, e un bot che crede di stare sulla sua
            // mentre sterza verso l'altra non ci arriva mai.
            steer = scarto === 0 ? solo.steer
                : steerToward(p.x, p.z, p.angle, target.x, target.z, rt.steerGain);
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
                        effectiveMaxSpeed, rt.cornerSpeedMargin, rt.brakingDistanceMargin, turnRateLow
                    );
                    debugGapToAhead = ahead.gapM;
                    if (cornerIsMild && targetSpeed > leaderTargetSpeed * aggro.margineSorpasso) {
                        const overtake = overtakeOffset(
                            track.points, ahead.player.trackIndex || 0, ahead.player.x, ahead.player.z,
                            track.roadHalf, BOT_OVERTAKE_FRACTION, p.botOvertakeSide
                        );
                        steer = steerToward(p.x, p.z, p.angle, target.x + overtake.dx, target.z + overtake.dz, rt.steerGain);
                        debugTarget = { x: target.x + overtake.dx, z: target.z + overtake.dz };
                        botState = 'OVERTAKING';
                    } else {
                        const closeness = 1 - ahead.gapM / BOT_FOLLOW_GAP_M;
                        targetSpeed *= 1 - closeness * (1 - aggro.frazioneMinimaInScia);
                        botState = 'FOLLOWING';
                    }
                }
            }

            // La difesa vale su tutti e due i rami di guida: una pista senza
            // racing line non e' una pista dove non ci si difende.
            if (!isQuali && botState !== 'OVERTAKING') {
                const dif = difendiSePossibile(p, game, track, aggro, target, rt.steerGain);
                if (dif) { steer = dif.steer; debugTarget = dif.debugTarget; botState = 'DEFENDING'; }
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
            const targetIdx = mirinoPrimaDelTubo(track, p.trackIndex || 0,
                lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples));
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
                p.speed, maxSpeed, brakeDecel, turnRateHigh, tuning.cornerSpeedMargin, gripCapacityFactor, turnRateLow
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
                        effectiveMaxSpeed, tuning.cornerSpeedMargin, tuning.brakingDistanceMargin, turnRateLow
                    );
                    debugGapToAhead = ahead.gapM;
                    if (cornerIsMild && targetSpeed > leaderTargetSpeed * aggro.margineSorpasso) {
                        const overtake = overtakeOffset(
                            track.points, ahead.player.trackIndex || 0, ahead.player.x, ahead.player.z,
                            track.roadHalf, BOT_OVERTAKE_FRACTION, p.botOvertakeSide
                        );
                        steer = steerToward(p.x, p.z, p.angle, target.x + overtake.dx, target.z + overtake.dz, tuning.steerGain);
                        debugTarget = { x: target.x + overtake.dx, z: target.z + overtake.dz };
                        botState = 'OVERTAKING';
                    } else {
                        const closeness = 1 - ahead.gapM / BOT_FOLLOW_GAP_M;   // 0 = al limite, 1 = praticamente addosso
                        targetSpeed *= 1 - closeness * (1 - aggro.frazioneMinimaInScia);
                        botState = 'FOLLOWING';
                    }
                }
            }
            // La difesa vale su tutti e due i rami di guida: una pista senza
            // racing line non e' una pista dove non ci si difende.
            if (!isQuali && botState !== 'OVERTAKING') {
                const dif = difendiSePossibile(p, game, track, aggro, target, tuning.steerGain);
                if (dif) { steer = dif.steer; debugTarget = dif.debugTarget; botState = 'DEFENDING'; }
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

        // L'ERRORE UMANO (spec 2026-09-05): ai livelli bassi ogni tanto il
        // bot allarga l'uscita o ritarda la frenata. La durata dell'errore
        // scorre sull'orologio del bot, quindi qui si chiama SEMPRE, anche
        // quando non ne sta facendo uno.
        //
        // ⚠️ Mai in qualifica: un giro secco rovinato dal caso falsa la
        // griglia, e la griglia decide la gara. Mai in corsia box: li'
        // sbagliare non costa decimi, costa una penalita'.
        if (!isQuali && !inCorsiaBox) {
            // Quanto dura un giro, alla velocita' di adesso: cosi'
            // `erroriPerGiro` vale uguale su piste di lunghezza diversa.
            const giroMs = track.lapLength / Math.max(p.speed, 0.5) * 50;
            aggiornaErrore(p, aggro.erroriPerGiro, 50, giroMs);
            if (p.botErroreFinoMs >= (p.botOrologioMs || 0)) {
                if (p.botErroreTipo === 'allarga') steer *= 1 - BOT_ERRORE_STERZO;
                else brake *= 1 - BOT_ERRORE_FRENO;
                botState = 'MISTAKE';
            }
        }

        const noiseScale = nearPitEntry ? BOT_PIT_APPROACH_NOISE_SCALE : 1;
        steer += (Math.random() * 2 - 1) * p.botPrecisionNoise * noiseScale;
        steer = Math.max(-1, Math.min(1, steer));

        p.inputs = { throttle, brake, steer };
        p._botDebug = debugEnabled ? {
            state: botState,
            // Di quanto si sta spostando per coprire chi ha dietro: serve al
            // banco prova per contare le difese, e al Bot Inspector per
            // farle vedere mentre succedono.
            scostamentoDifensivo: p.botScostamentoDifesa || 0,
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
    PALETTE, PALETTE_BOT_EXTRA, MAX_GRID_SIZE, GRID_SIZE_DEFAULT, DEFAULT_TUNING,
    BOT_RACE_START_REACTION_MIN_MS, BOT_RACE_START_REACTION_MAX_MS,
    normalizeAngle, steerToward, lookaheadIndex, mirinoPrimaDelTubo, apexOffset, windowRadius, cornerApexNear, cornerTargetSpeed, overtakeOffset,
    nearestAheadPlayer, nearestBehindPlayer, otherCarTargetSpeed, pickPostPitCompound, pickBotColors, estimateFinishTime,
    createBots, updateBotInputs, shouldBotRepair,
    BOT_CURVATURE_LOCAL_M, BOT_APEX_MAX_FRACTION, trajectoryDiagnostics,
    adaptiveLookaheadMeters, BOT_ADAPTIVE_LOOKAHEAD_K, BOT_ADAPTIVE_LOOKAHEAD_MAX_M, BOT_LOOKAHEAD_MIN_M,
    BOT_ADAPTIVE_LOOKAHEAD_T_MIN, computeSoloRacingLineInputs, BOT_GRIP_CAPACITY_EXPONENT, aggiornaErrore, profiloAllargamento
};
