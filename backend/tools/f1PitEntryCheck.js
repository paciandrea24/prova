// backend/tools/f1PitEntryCheck.js
//
// Riproduzione headless (nessun browser): per ogni pista, forza l'usura
// gomme sopra la soglia di pit-stop di tutti i bot e verifica che ognuno
// attraversi FISICAMENTE track.pitEntryTrigger entro un numero di tick
// generoso — Rif. docs/superpowers/specs/2026-08-04-f1-bot-unified-driving-policy-design.md,
// punto 4 (ingresso ai box come parte della stessa traiettoria). Loop
// sincrono stretto: sufficiente per vedere SE il bot attraversa il
// rettangolo-trigger (nessuna fisica a tempo di parete reale coinvolta in
// questa parte — il minigioco di reazione pit stop usa setTimeout, qui
// irrilevante: si misura solo l'ingresso, non la sosta completa).
const { createTestbenchSession } = require('../sockets/games/f1Testbench.js');
const f1GameSocket = require('../sockets/games/f1GameSocket.js');
const { listTracks } = require('../sockets/games/trackLoader.js');

const FAKE_IO = { to: () => ({ emit: () => {} }) };
const MAX_TICKS = 30000;   // 30000 * 20ms = 10 minuti simulati, ben oltre qualunque giro

function checkPitEntry(trackId) {
    const game = createTestbenchSession({ trackId, botCount: 6, tyreWear: 85, compound: 'medium' });
    const results = {};
    for (const color of Object.keys(game.players)) results[color] = { entered: false, tick: null };

    for (let tick = 0; tick < MAX_TICKS; tick++) {
        f1GameSocket.tickGame(FAKE_IO, 'TESTBENCH', game);
        for (const p of Object.values(game.players)) {
            if (!results[p.color].entered && p.pitAutoState === 'entering') {
                results[p.color] = { entered: true, tick };
            }
        }
        if (Object.values(results).every(r => r.entered)) break;
    }
    return results;
}

function main() {
    const argTracks = process.argv.slice(2);
    const ids = argTracks.length > 0 ? argTracks : listTracks().map(t => t.id);
    let anyFailed = false;
    for (const trackId of ids) {
        const results = checkPitEntry(trackId);
        const entries = Object.entries(results);
        const failed = entries.filter(([, r]) => !r.entered);
        console.log(`\n=== ${trackId} ===`);
        for (const [color, r] of entries) {
            console.log(`  ${color}: ${r.entered ? `entrato al tick ${r.tick}` : 'MAI ENTRATO'}`);
        }
        if (failed.length > 0) {
            anyFailed = true;
            console.log(`[${trackId}] FALLITO: ${failed.length}/${entries.length} bot non sono mai entrati ai box`);
        }
    }
    process.exitCode = anyFailed ? 1 : 0;
}

if (require.main === module) main();

module.exports = { checkPitEntry };
