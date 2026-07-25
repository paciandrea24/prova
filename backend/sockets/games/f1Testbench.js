// backend/sockets/games/f1Testbench.js
//
// Banco prova bot: fa correre solo bot (nessun giocatore reale) usando la
// STESSA tickGame del gioco vero (esportata da f1GameSocket.js apposta per
// questo), per verificare visivamente le correzioni di comportamento bot
// senza fidarsi solo di script di simulazione semplificati — vedi
// docs/superpowers/specs/2026-07-25-f1-bot-testbench-design.md.
const { listTracks, loadTrack } = require('./trackLoader.js');
const { TYRE_COMPOUNDS } = require('./f1GameSocket.js');
const { createBots, MAX_GRID_SIZE } = require('./f1Bot.js');
const f1GameSocket = require('./f1GameSocket.js');
const { physics } = f1GameSocket;

const MIN_BOT_COUNT = 2;

function validateTestbenchScenario({ trackId, botCount, tyreWear, compound }) {
    const knownTrackIds = listTracks().map(t => t.id);
    if (!knownTrackIds.includes(trackId)) {
        return { valid: false, error: `Pista sconosciuta: "${trackId}"` };
    }
    if (!Number.isInteger(botCount) || botCount < MIN_BOT_COUNT || botCount > MAX_GRID_SIZE) {
        return { valid: false, error: `Numero bot deve essere tra ${MIN_BOT_COUNT} e ${MAX_GRID_SIZE}` };
    }
    if (typeof tyreWear !== 'number' || tyreWear < 0 || tyreWear > 100) {
        return { valid: false, error: 'Usura gomme deve essere tra 0 e 100' };
    }
    if (!Object.keys(TYRE_COMPOUNDS).includes(compound)) {
        return { valid: false, error: `Mescola sconosciuta: "${compound}"` };
    }
    return { valid: true };
}

module.exports.validateTestbenchScenario = validateTestbenchScenario;

// Colori fittizi per "riempire" gli slot umani agli occhi di createBots
// (che calcola quanti bot creare come MAX_GRID_SIZE - humanColors.length):
// nel banco prova non c'è NESSUN giocatore reale, quindi passiamo
// (MAX_GRID_SIZE - botCount) colori fittizi come "già presi da umani" per
// ottenere esattamente botCount bot, invece dei 6 di una partita normale.
function fakeHumanColors(botCount) {
    const count = Math.max(0, MAX_GRID_SIZE - botCount);
    return Array.from({ length: count }, (_, i) => `#TESTBENCH-UNUSED-${i}`);
}

function createTestbenchSession({ trackId, botCount, tyreWear, compound }) {
    const track = loadTrack(trackId);
    const game = {
        track,
        phase: 'race',
        players: {},
        grid: [],
        settings: {},
        tyreConfirmed: new Set(),
        socketByColor: {},
        raceStarted: true,
        raceStartTime: Date.now(),
        raceEnded: false,
        qualiEnded: true,
        lightsSequenceActive: false
    };

    const lobby = { lockedPlayers: fakeHumanColors(botCount) };
    createBots(game, lobby, f1GameSocket.TYRE_COMPOUNDS);

    // Griglia = ordine di creazione dei bot (nessuna qualifica reale in
    // questo strumento): assignGridSpawns la usa per posizionarli in griglia.
    game.grid = Object.keys(game.players);
    physics.assignGridSpawns(game);

    // Override DOPO assignGridSpawns, che resetta tyreWear/compound a
    // "gomme fresche" per ogni bot — l'override va applicato per ultimo.
    for (const p of Object.values(game.players)) {
        p.tyreWear = tyreWear;
        p.compound = compound;
    }

    return game;
}

module.exports.createTestbenchSession = createTestbenchSession;
