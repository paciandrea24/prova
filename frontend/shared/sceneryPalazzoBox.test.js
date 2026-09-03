// frontend/shared/sceneryPalazzoBox.test.js
//
// IL PALAZZO DEI BOX (spec 2026-09-03).
//
// Un pezzo del palazzo vive in quattro posti che non si conoscono fra loro: il
// builder in `backend/tools/circuitAssets/pitPalazzo.py`, il percorso in
// `sceneryAssetPaths.js`, l'ingombro in `sceneryAssetSizes.js` e la posa in
// `trackScenery.js`.
//
// ⚠️ E IL DISALLINEAMENTO E' SILENZIOSO. Un asset senza ingombro dichiarato non
// solleva: `sizeOf` restituisce il ripiego di 6x6x6, e da li' in poi la porta
// della scenografia giudica un palazzo alto 18 come un cubo di sei unita' —
// scarta cose che ci starebbero e ne accetta altre che si compenetrano, con
// tutti i test verdi. E' successo davvero, con tredici asset.
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
const PEZZI = ['pitClubBay', 'pitClubSpan', 'pitClubHead', 'pitClubTower'];

// Il passo delle fette: mezzo passo di box. Qui e' scritto per poterlo
// confrontare con la larghezza dichiarata, ma la fonte di verita' e'
// TrackGeometry.PIT_BOX_SPACING / 2.
const PASSO = 7.5;

for (const asset of PEZZI) {
    test(`${asset}: ha un percorso e il file c'e'`, () => {
        assert.ok(Paths.PERCORSI[asset], `${asset} non e' in PERCORSI`);
        assert.ok(fs.existsSync(path.join(GLB_DIR, asset + '.glb')),
            `manca ${asset}.glb`);
    });

    test(`${asset}: l'ingombro dichiarato coincide col .glb`, () => {
        const dichiarato = Sizes.sizeOf(asset);
        // `size` e' un array [x, y, z] in coordinate gioco: w = X, h = Y, d = Z.
        const size = inspectGlb(path.join(GLB_DIR, asset + '.glb')).size;
        for (const [campo, vero] of [['w', size[0]], ['h', size[1]], ['d', size[2]]]) {
            assert.ok(Math.abs(dichiarato[campo] - vero) <= 0.05,
                `${asset}.${campo}: dichiarato ${dichiarato[campo]}, nel .glb ${vero.toFixed(3)}`);
        }
    });

    test(`${asset}: e' piu' stretto del passo`, () => {
        // Il gioco meccanico e' voluto: due lastre piene che si compenetrano
        // danno facce complanari, cioe' z-fighting. E' la stessa regola delle
        // facciate della citta' (8.7 contro un passo di 9).
        assert.ok(Sizes.sizeOf(asset).w < PASSO,
            `${asset} e' largo ${Sizes.sizeOf(asset).w}: al passo di ${PASSO} si compenetra col vicino`);
    });
}
