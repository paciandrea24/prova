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

// --- La posa, su ogni pista della cartella --------------------------------
const TrackScenery = require('./trackScenery.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');
const seats = require('../assets/custom/circuit/grandStandSeats.json').seats;
const terraceAnchors = require('../assets/custom/circuit/terraceAnchors.json').anchors;

const PISTE = fs.readdirSync(path.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

// Una pista si genera una volta sola: sono migliaia di oggetti per pista e
// piu' test per pista.
const cache = new Map();
function scenografiaDi(id) {
    if (!cache.has(id)) {
        const raw = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const t = loadTrack(id);
        cache.set(id, TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
            raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile,
            terraceAnchors, { gridSize: 6 }));
    }
    return cache.get(id);
}

const SOPRA = { pitsGarageClosed: 'pitRoofTerrace', pitsOffice: 'pitRoofLounge' };
const chiave = (v) => v.x.toFixed(2) + ',' + v.z.toFixed(2);

for (const id of PISTE) {
    test(`${id}: ogni edificio della corsia box ha il suo coronamento`, () => {
        const layout = scenografiaDi(id);
        const corone = new Map(layout
            .filter(v => v.category === 'paddock-club').map(v => [chiave(v), v]));
        const senza = layout
            .filter(v => SOPRA[v.asset])
            .filter(v => {
                const c = corone.get(chiave(v));
                return !c || c.asset !== SOPRA[v.asset];
            });
        assert.deepEqual(
            senza.map(v => `${v.asset} a (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`), []);
    });

    test(`${id}: nessun coronamento orfano, ne' storto`, () => {
        const layout = scenografiaDi(id);
        const edifici = new Map(layout
            .filter(v => SOPRA[v.asset]).map(v => [chiave(v), v]));
        const guai = [];
        for (const c of layout.filter(v => v.category === 'paddock-club')) {
            const e = edifici.get(chiave(c));
            if (!e) { guai.push(`${c.asset} senza edificio sotto`); continue; }
            // Stesso orientamento: un tetto ruotato rispetto al suo edificio
            // sporgerebbe da un lato e lascerebbe scoperto l'altro.
            if (Math.abs((c.rotY || 0) - (e.rotY || 0)) > 1e-9) {
                guai.push(`${c.asset} ruotato rispetto al suo edificio`);
            }
            // Ne' sospeso ne' affondato: la quota e' quella dell'edificio piu'
            // la sua altezza, letta dall'ingombro dichiarato.
            const atteso = (e.y || 0) + Sizes.sizeOf(e.asset).h * (e.scale || 1);
            if (Math.abs((c.y || 0) - atteso) > 1e-6) {
                guai.push(`${c.asset} a quota ${c.y} invece di ${atteso}`);
            }
        }
        assert.deepEqual(guai, []);
    });
}

// --- La gente affacciata --------------------------------------------------
test('sulle terrazze dei box c\'e\' gente, e sta sul piano della terrazza', () => {
    const layout = scenografiaDi('citta-prova');
    const terrazze = layout.filter(v => v.asset === 'pitRoofTerrace');
    assert.ok(terrazze.length >= 5, `solo ${terrazze.length} terrazze`);
    const persone = layout.filter(v => v.category === 'crowd');
    const abitate = terrazze.filter(t => persone.some(p => p.daTribuna === chiave(t)));
    assert.ok(abitate.length >= terrazze.length / 2,
        `gente su ${abitate.length} terrazze su ${terrazze.length}`);
    // In piedi sul piano, non a mezz'aria ne' dentro il solaio: le ancore sono
    // locali all'oggetto, e se qualcuno le applicasse a un oggetto non ancora
    // spostato la gente resterebbe indietro (e' successo con le tribune).
    for (const t of abitate) {
        for (const p of persone.filter(p => p.daTribuna === chiave(t))) {
            assert.ok(p.y > t.y && p.y < t.y + 1.0,
                `spettatore a ${p.y} con la terrazza a ${t.y}`);
        }
    }
});

test('chi ha le ancore ha gente sopra, senza bisogno di essere in elenco', () => {
    // ⚠️ LA REGOLA VERA: chi ha ancore ha gente. Prima trackScenery teneva una
    // lista di asset scritta a mano, e un asset nuovo con la sua terrazza
    // nasceva deserto senza che niente lo dicesse — che e' il modo in cui
    // questa voce sarebbe fallita in silenzio.
    const conAncore = Object.keys(terraceAnchors);
    assert.ok(conAncore.includes('pitRoofTerrace') && conAncore.includes('pitRoofLounge'),
        `terraceAnchors.json contiene ${conAncore.join(', ')}`);
    const layout = scenografiaDi('prova');
    const sorgenti = new Set(layout.filter(v => v.category === 'crowd').map(p => p.daTribuna));
    for (const asset of conAncore) {
        const esemplari = layout.filter(v => v.asset === asset);
        if (!esemplari.length) continue;
        // Non TUTTI devono avere gente (il riempimento e' casuale), ma
        // un'intera famiglia deserta e' il difetto.
        assert.ok(esemplari.some(v => sorgenti.has(chiave(v))),
            `${asset}: nessuno dei ${esemplari.length} esemplari ha gente sopra`);
    }
});
