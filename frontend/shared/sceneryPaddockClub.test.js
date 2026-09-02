// frontend/shared/sceneryPaddockClub.test.js
//
// IL CORONAMENTO DELLA FILA DEI BOX (spec 2026-09-02).
//
// Un coronamento vive in quattro posti che non si conoscono fra loro: il
// builder in `backend/tools/circuitAssets/pitClub.py`, il percorso in
// `sceneryAssetPaths.js`, l'ingombro in `sceneryAssetSizes.js` e la posa in
// `trackScenery.js`.
//
// ⚠️ E IL DISALLINEAMENTO E' SILENZIOSO. Un asset senza ingombro non solleva:
// `sizeOf` restituisce il ripiego di 6x6x6, e da li' in poi la porta della
// scenografia giudica un salotto come se fosse un cubo di sei unita' — scarta
// cose che ci starebbero e ne accetta altre che si compenetrano, con tutti i
// test verdi. E' successo davvero, con tredici asset.
//
// ⚠️ Gira con `node --test frontend/shared/`, non con `node --test backend/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Sizes = require('./sceneryAssetSizes.js');
const Paths = require('./sceneryAssetPaths.js');
const { inspectGlb } = require('../../backend/tools/glbInspect.js');

const GLB_DIR = path.join(__dirname, '..', 'assets', 'custom', 'circuit');
const CORONAMENTI = ['pitRoofTerrace', 'pitRoofLounge'];

for (const asset of CORONAMENTI) {
    test(`${asset}: ha un percorso e il file c'e'`, () => {
        const url = Paths.PERCORSI[asset];
        assert.ok(url, `${asset} non e' in PERCORSI`);
        assert.ok(fs.existsSync(path.join(GLB_DIR, asset + '.glb')),
            `manca ${asset}.glb`);
    });

    test(`${asset}: l'ingombro dichiarato coincide col .glb`, () => {
        const dichiarato = Sizes.sizeOf(asset);
        // `size` e' un array [x, y, z] in coordinate gioco: w = X, h = Y, d = Z.
        // La tolleranza e' quella con cui sono scritti gli altri: pitsOffice
        // misura 13.06 ed e' dichiarato 13.1.
        const size = inspectGlb(path.join(GLB_DIR, asset + '.glb')).size;
        for (const [campo, vero] of [['w', size[0]], ['h', size[1]], ['d', size[2]]]) {
            assert.ok(Math.abs(dichiarato[campo] - vero) <= 0.05,
                `${asset}.${campo}: dichiarato ${dichiarato[campo]}, nel .glb ${vero.toFixed(3)}`);
        }
    });
}
