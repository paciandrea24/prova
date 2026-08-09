const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');

// itemsOverlap/createCollisionIndex erano scritti ed esportati ma non usati da
// nessuna riga di codice, e senza test propri. Prima di metterli in servizio
// (trackScenery/sceneryLandmarks) vanno caratterizzati: se uno di questi test
// fallisse, il bug sarebbe nel modulo, non nei chiamanti.

function item(asset, x, z, rotY, y) {
    return { asset, x, z, rotY: rotY || 0, scale: 1, y: y || 0 };
}

test('due oggetti nello stesso punto si sovrappongono', () => {
    assert.equal(SceneryAssetSizes.itemsOverlap(item('podium', 0, 0), item('pitsGarageClosed', 0, 0)), true);
});

test('due oggetti lontani non si sovrappongono', () => {
    assert.equal(SceneryAssetSizes.itemsOverlap(item('podium', 0, 0), item('pitsGarageClosed', 500, 500)), false);
});

// Il caso reale trovato in gioco: podio (12 x 7.1) dentro un garage box
// (20.6 x 14.7), compenetrazione misurata 7.1 unità sul tracciato "prova".
test('riconosce il podio dentro il garage box', () => {
    assert.equal(SceneryAssetSizes.itemsOverlap(item('podium', 0, 0), item('pitsGarageClosed', 8, 0)), true);
});

// Affiancati a distanza pari alla semisomma delle larghezze: si toccano senza
// compenetrarsi, ed è la condizione che deve valere fra due edifici box
// contigui.
test('affiancati esattamente a contatto non risultano sovrapposti', () => {
    const d = (SceneryAssetSizes.sizeOf('pitsGarageClosed').w + SceneryAssetSizes.sizeOf('pitsOffice').w) / 2 + 0.1;
    assert.equal(SceneryAssetSizes.itemsOverlap(item('pitsGarageClosed', 0, 0), item('pitsOffice', d, 0)), false);
});

// La rotazione deve contare davvero: due rettangoli lunghi e stretti a 90
// gradi l'uno dall'altro si intersecano dove, paralleli, non si toccherebbero.
// Il cartellone è 16.4 largo e 1.6 profondo: separandoli di 6 lungo la
// PROFONDITÀ restano distinti da paralleli (6 > 1.6), mentre ruotandone uno
// la sua larghezza invade i 6 (16.4/2 = 8.2 > 6).
test('la rotazione degli oggetti viene applicata', () => {
    const a = item('billboard', 0, 0, 0);
    assert.equal(SceneryAssetSizes.itemsOverlap(a, item('billboard', 0, 6, Math.PI / 2)), true);
    assert.equal(SceneryAssetSizes.itemsOverlap(a, item('billboard', 0, 6, 0)), false);
});

// Due oggetti sovrapposti in pianta ma a quote disgiunte NON collidono: è il
// caso dei moduli impilati della tribuna principale, che condividono x/z per
// costruzione.
test('la quota separa oggetti sovrapposti in pianta', () => {
    const basso = item('grandStand', 0, 0, 0, 0);
    const sopra = item('grandStand', 0, 0, 0, SceneryAssetSizes.heightOf('grandStand') + 0.5);
    assert.equal(SceneryAssetSizes.itemsOverlap(basso, sopra), false);
    assert.equal(SceneryAssetSizes.itemsOverlap(basso, item('grandStand', 0, 0, 0, 1)), true);
});

test('createCollisionIndex rifiuta un oggetto che collide con uno già inserito', () => {
    const index = SceneryAssetSizes.createCollisionIndex();
    const garage = item('pitsGarageClosed', 100, 100);
    assert.equal(index.fits(garage), true, 'indice vuoto: deve accettare');
    index.add(garage);
    assert.equal(index.fits(item('podium', 104, 100)), false, 'podio dentro il garage: da rifiutare');
    assert.equal(index.fits(item('podium', 300, 300)), true, 'podio lontano: da accettare');
});

// La griglia spaziale è un'ottimizzazione: non deve cambiare il risultato.
// Un oggetto grande può ricadere in celle diverse da quello con cui collide.
test('createCollisionIndex trova le collisioni anche a cavallo di più celle', () => {
    const index = SceneryAssetSizes.createCollisionIndex(40);
    // startGantry è largo 34.5: piazzato a cavallo del confine di cella (x=40)
    // occupa due celle, e chi collide con lui può stare in una sola.
    index.add(item('startGantry', 40, 0));
    assert.equal(index.fits(item('marshalPost', 50, 0)), false, 'collisione persa a cavallo di due celle');
});
