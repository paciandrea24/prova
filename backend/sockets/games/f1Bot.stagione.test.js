// backend/sockets/games/f1Bot.stagione.test.js
//
// In campionato i bot sono SEMPRE gli stessi: stessi colori, stessi nomi, per
// tutte le gare. Senza, la classifica sommerebbe i punti di piloti diversi —
// e "Bot 3" della seconda gara non sarebbe quello della prima.
//
// E' l'unico punto in cui la stagione deve dire qualcosa a chi crea la griglia
// (Rif. docs/superpowers/specs/2026-08-19-f1-stagioni-design.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBots } = require('./f1Bot.js');

const TYRE = { soft: {}, medium: {}, hard: {} };

function partitaFinta(colori) {
    return {
        players: Object.fromEntries(colori.map(c => [c, { color: c, isBot: false }])),
        track: { qualiSpawn: { x: 0, z: 0, angle: 0 }, points: [], totalLaps: 5 },
        gridSize: 4,
        settings: {},
        // I bot si auto-confermano la mescola alla nascita: senza questo Set
        // createBots non arriva in fondo.
        tyreConfirmed: new Set(),
    };
}

test('con una lista di bot della stagione si usano quei colori, non un sorteggio', () => {
    const game = partitaFinta(['#e74c3c']);
    game.botStagione = [
        { colore: '#111111', nome: 'Bot 1' },
        { colore: '#222222', nome: 'Bot 2' },
        { colore: '#333333', nome: 'Bot 3' },
    ];
    createBots(game, { lockedPlayers: ['#e74c3c'] }, TYRE);

    const bot = Object.values(game.players).filter(p => p.isBot);
    assert.deepEqual(bot.map(p => p.color).sort(), ['#111111', '#222222', '#333333']);
    assert.deepEqual(bot.map(p => p.nomeStagione).sort(), ['Bot 1', 'Bot 2', 'Bot 3']);
});

test('senza lista della stagione i bot nascono come sempre', () => {
    const game = partitaFinta(['#e74c3c']);
    createBots(game, { lockedPlayers: ['#e74c3c'] }, TYRE);
    const bot = Object.values(game.players).filter(p => p.isBot);
    assert.equal(bot.length, 3, 'gridSize 4 meno un umano');
    assert.ok(bot.every(p => !p.nomeStagione), 'fuori dal campionato un bot non ha nome');
});

test('se la griglia e piu piccola della lista, si prendono i primi bot della stagione', () => {
    // Non dovrebbe capitare (gridSize della partita viene dalla stagione), ma
    // se capita si prendono i primi in ordine invece di sorteggiare: due gare
    // della stessa stagione devono restare confrontabili.
    const game = partitaFinta(['#e74c3c']);
    game.gridSize = 3;
    game.botStagione = [
        { colore: '#111111', nome: 'Bot 1' },
        { colore: '#222222', nome: 'Bot 2' },
        { colore: '#333333', nome: 'Bot 3' },
    ];
    createBots(game, { lockedPlayers: ['#e74c3c'] }, TYRE);
    const bot = Object.values(game.players).filter(p => p.isBot);
    assert.deepEqual(bot.map(p => p.color).sort(), ['#111111', '#222222']);
});
