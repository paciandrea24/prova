// backend/sockets/games/f1Testbench.js
//
// Banco prova bot: fa correre solo bot (nessun giocatore reale) usando la
// STESSA tickGame del gioco vero (esportata da f1GameSocket.js apposta per
// questo), per verificare visivamente le correzioni di comportamento bot
// senza fidarsi solo di script di simulazione semplificati — vedi
// docs/superpowers/specs/2026-07-25-f1-bot-testbench-design.md.
const { listTracks } = require('./trackLoader.js');
const { TYRE_COMPOUNDS } = require('./f1GameSocket.js');
const { MAX_GRID_SIZE } = require('./f1Bot.js');

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
