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
// GUIDA — pure pursuit + velocità da curvatura
// ====================================================
const BOT_STEER_GAIN = 1.6;   // guadagno proporzionale errore-angolo -> sterzo
const MAX_CURVATURE_ANGLE = Math.PI / 3;   // 60°: oltre, velocità al minimo
const MIN_SPEED_FRACTION  = 0.35;

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

// Frazione 0.35..1 di velocità massima consentita dalla curvatura futura:
// confronta la tangente in idx con quella `curvatureSamples` più avanti —
// più grande l'angolo tra le due, più stretta la curva, più bassa la
// frazione (mai sotto MIN_SPEED_FRACTION).
function curvatureSpeedFraction(points, idx, curvatureSamples) {
    const n = points.length;
    const aheadIdx = lookaheadIndex(n, idx, curvatureSamples);
    const t1 = TrackGeometry.tangentAt(points, idx, true);
    const t2 = TrackGeometry.tangentAt(points, aheadIdx, true);
    const angle1 = Math.atan2(t1.tx, t1.tz);
    const angle2 = Math.atan2(t2.tx, t2.tz);
    const turn = Math.abs(normalizeAngle(angle2 - angle1));
    const frac = 1 - Math.min(1, turn / MAX_CURVATURE_ANGLE);
    return MIN_SPEED_FRACTION + frac * (1 - MIN_SPEED_FRACTION);
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
const BOT_SPEED_FACTOR_MIN    = 0.85, BOT_SPEED_FACTOR_MAX    = 1.05;
const BOT_PRECISION_NOISE_MIN = 0,    BOT_PRECISION_NOISE_MAX = 0.25;   // rad aggiunti/tolti allo sterzo
const BOT_PIT_THRESHOLD_MIN   = 60,   BOT_PIT_THRESHOLD_MAX   = 80;     // % usura gomme a cui il bot decide di entrare ai box

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
            // --- campi solo-bot ---
            isBot:                  true,
            botSpeedFactor:         randRange(BOT_SPEED_FACTOR_MIN, BOT_SPEED_FACTOR_MAX, rng),
            botPrecisionNoise:      randRange(BOT_PRECISION_NOISE_MIN, BOT_PRECISION_NOISE_MAX, rng),
            botPitThreshold:        randRange(BOT_PIT_THRESHOLD_MIN, BOT_PIT_THRESHOLD_MAX, rng),
            botHeadingToPits:       false,
            botPitReactionScheduled: false
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
const BOT_LOOKAHEAD_M           = 18;    // metri: punto mirato per lo sterzo sulla linea di corsa
const BOT_CURVATURE_LOOKAHEAD_M = 40;    // metri: quanto avanti si giudica la curvatura per la velocità target
const BOT_SPEED_MARGIN          = 0.03;  // isteresi throttle/brake attorno alla velocità target
const BOT_PIT_REACTION_MIN_MS   = 150;
const BOT_PIT_REACTION_MAX_MS   = 700;

function metersToSamples(meters, track) {
    return Math.max(1, Math.round(meters * track.points.length / track.lapLength));
}

function updateBotInputs(game, deps) {
    const { effectiveMaxSpeed, handlePitReactionPress, io, lobbyId, wearLapsAtMedium } = deps;
    const track = game.track;
    const isQuali = game.phase === 'qualifying';

    for (const p of Object.values(game.players)) {
        if (!p.isBot || p.finished) continue;

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
            const lookSamples  = metersToSamples(BOT_LOOKAHEAD_M, track);
            const curveSamples = metersToSamples(BOT_CURVATURE_LOOKAHEAD_M, track);
            const targetIdx = lookaheadIndex(track.points.length, p.trackIndex || 0, lookSamples);
            const target = track.points[targetIdx];
            steer = steerToward(p.x, p.z, p.angle, target.x, target.z);

            const speedFrac = curvatureSpeedFraction(track.points, p.trackIndex || 0, curveSamples);
            const targetSpeed = effectiveMaxSpeed(p, isQuali) * speedFrac * p.botSpeedFactor;
            if (p.speed < targetSpeed * (1 - BOT_SPEED_MARGIN)) throttle = 1;
            else if (p.speed > targetSpeed * (1 + BOT_SPEED_MARGIN)) brake = 1;
        }

        steer += (Math.random() * 2 - 1) * p.botPrecisionNoise;
        steer = Math.max(-1, Math.min(1, steer));

        p.inputs = { throttle, brake, steer };
    }
}

module.exports = {
    PALETTE, MAX_GRID_SIZE,
    normalizeAngle, steerToward, lookaheadIndex, curvatureSpeedFraction,
    pickPostPitCompound, pickBotColors,
    createBots, updateBotInputs
};
