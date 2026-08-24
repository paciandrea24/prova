// Congela la scenografia di un circuito: la genera una volta e la scrive
// accanto al tracciato, così che modificare l'algoritmo di posizionamento per
// un'altra pista non la tocchi più. Rif.
// docs/superpowers/specs/2026-08-23-f1-mappe-immutabili-design.md.
//
// Uso:  node backend/tools/f1-cuoci-scenografia.js <pista> [--grid=6]
//
// Scongelare = cancellare il file. Non c'è nessuno stato altrove.
//
// ⚠️ La chiamata a generateLayout qui sotto è la STESSA di f1.js::loadScenery
// (riga ~1486) e di f1-costo-scenografia.js. Se divergesse, il file cotto
// sarebbe plausibile e sbagliato — e nessun test lo direbbe, perché sarebbe
// coerente con se stesso. Verificato il 2026-08-24, argomento per argomento:
// BARRIER_D è `roadHalfWidth + 2.8 + 1.2` in entrambi, EMBANKMENT_WIDTH è 45,
// e il barrierProfile di loadTrack coincide con quello di f1.js perché il
// `curbW` che f1.js passa esplicitamente è già il default di trackGravel.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TrackScenery = require(path.join(ROOT, 'frontend/shared/trackScenery.js'));
const Cotta = require(path.join(ROOT, 'frontend/shared/scenografiaCotta.js'));
const { loadTrack } = require(path.join(ROOT, 'backend/sockets/games/trackLoader.js'));

const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;
const terraceAnchors = require(path.join(ROOT, 'frontend/assets/custom/circuit/terraceAnchors.json')).anchors;

function cuoci(trackId, gridSize) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', trackId + '.json'), 'utf8'));
    const t = loadTrack(trackId);
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile, terraceAnchors,
        { gridSize });
    return Cotta.comprimi(layout, {
        pista: trackId,
        gridSize,
        impronta: Cotta.improntaDi(raw),
        cottaIl: new Date().toISOString(),
    });
}

function main() {
    const argomenti = process.argv.slice(2);
    const trackId = argomenti.find(a => !a.startsWith('--'));
    const grid = argomenti.find(a => a.startsWith('--grid='));
    const gridSize = grid ? parseInt(grid.slice('--grid='.length), 10) : 6;

    if (!trackId) {
        console.error('Uso: node backend/tools/f1-cuoci-scenografia.js <pista> [--grid=6]');
        process.exitCode = 1;
        return;
    }

    const file = cuoci(trackId, gridSize);
    const dove = path.join(ROOT, 'frontend/tracks', trackId + '-scenografia.json');
    fs.writeFileSync(dove, JSON.stringify(file));
    const kb = (fs.statSync(dove).size / 1024).toFixed(0);
    console.log(`${trackId} congelata: ${file.voci.length} oggetti, ${file.assets.length} asset distinti, gridSize ${gridSize}`);
    console.log(`  ${dove}  (${kb} KB)`);
    console.log('  Per scongelare: cancella questo file.');
}

if (require.main === module) main();

module.exports = { cuoci };
