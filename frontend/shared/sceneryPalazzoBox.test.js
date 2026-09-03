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

// --- La posa, su ogni pista della cartella --------------------------------
const TrackScenery = require('./trackScenery.js');
const TG = require('./trackGeometry.js');
const Profilo = require('./pitClubProfilo.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');
const seats = require('../assets/custom/circuit/grandStandSeats.json').seats;
const terraceAnchors = require('../assets/custom/circuit/terraceAnchors.json').anchors;

const PISTE = fs.readdirSync(path.join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

// Una pista si genera una volta sola: sono migliaia di oggetti per pista.
const cachePista = new Map();
function scenografiaDi(id, gridSize) {
    const chiave = id + ':' + gridSize;
    if (!cachePista.has(chiave)) {
        const raw = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'tracks', id + '.json'), 'utf8'));
        const t = loadTrack(id);
        cachePista.set(chiave, {
            layout: TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
                raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile,
                terraceAnchors, { gridSize }),
            t, raw, half: raw.pit.roadHalfWidth,
        });
    }
    return cachePista.get(chiave);
}

const DEL_PALAZZO = new Set(PEZZI);

for (const id of PISTE) {
    test(`${id}: il palazzo c'e', ed e' tutto di categoria paddock-club`, () => {
        const { layout } = scenografiaDi(id, 6);
        const palazzo = layout.filter(v => DEL_PALAZZO.has(v.asset));
        assert.ok(palazzo.length >= 8, `${id}: solo ${palazzo.length} fette in pista`);
        for (const v of palazzo) {
            assert.equal(v.category, 'paddock-club',
                `${id}: ${v.asset} ha categoria ${v.category}`);
            assert.equal(v.natoSullaCorsia, true,
                `${id}: ${v.asset} verrebbe traslato come se fosse nato sulla pista`);
        }
    });

    test(`${id}: nessuna fetta invade la corsia box, angoli compresi`, () => {
        const { layout, t, half } = scenografiaDi(id, 6);
        const dentro = [];
        for (const v of layout.filter(x => DEL_PALAZZO.has(x.asset))) {
            const vicino = Math.min(...Sizes.footprintCorners(v)
                .map(c => TG.nearestPoint(t.pitLanePts, c.x, c.z).dist));
            if (vicino < half + 1) dentro.push(`${v.asset} a ${vicino.toFixed(2)}`);
        }
        assert.deepEqual(dentro, []);
    });

    test(`${id}: nessun buco fra due fette consecutive`, () => {
        const { layout } = scenografiaDi(id, 6);
        // ⚠️ NELL'ORDINE IN CUI STANNO NEL LAYOUT, che e' quello di posa.
        // Incatenandole invece per vicinanza — partendo da una testa e saltando
        // ogni volta alla piu' vicina — il test gridava «buco di 22.5» su
        // shanghai e suzuka: la, dove le prime fette hanno un box sotto, la
        // testa non e' al capo ma la terza, e la catena arrivata a un capo
        // saltava dall'altra parte del palazzo. Era il percorso a essere
        // sbagliato, non il palazzo. Che l'ordine si conservi e' una proprieta'
        // che vale la pena provare comunque, ed e' questa a provarla.
        const fette = layout.filter(v => DEL_PALAZZO.has(v.asset));
        const salti = [];
        for (let i = 1; i < fette.length; i++) {
            const d = Math.hypot(fette[i].x - fette[i - 1].x, fette[i].z - fette[i - 1].z);
            // 1.7 volte il passo: la stessa banda entro cui il profilo accetta
            // un tratto. Piu' stretto qui vorrebbe dire chiedere alla posa una
            // regolarita' che la geometria della corsia non concede.
            if (d > Profilo.PASSO * 1.7) salti.push(`fra la ${i - 1} e la ${i}: ${d.toFixed(2)}`);
        }
        assert.deepEqual(salti, [], `${id}: buchi nel fronte del palazzo`);
    });

    test(`${id}: dentro il palazzo non nasce nessun edificio decorativo`, () => {
        const { layout } = scenografiaDi(id, 6);
        const palazzo = layout.filter(v => DEL_PALAZZO.has(v.asset));
        const intrusi = layout
            .filter(v => v.asset === 'pitsGarageClosed' || v.asset === 'pitsOffice')
            .filter(v => palazzo.some(f => Math.hypot(f.x - v.x, f.z - v.z) < 12));
        assert.deepEqual(intrusi.map(v => `${v.asset} a (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`), []);
    });

    test(`${id}: fuori dal palazzo gli edifici tengono i loro tetti`, () => {
        const { layout } = scenografiaDi(id, 6);
        const edifici = layout.filter(v => v.asset === 'pitsGarageClosed' || v.asset === 'pitsOffice');
        const tetti = layout.filter(v => v.asset === 'pitRoofTerrace' || v.asset === 'pitRoofLounge');
        // Il lavoro del 02-09 vale per gli edifici rimasti fuori, ed e' li' che
        // finisce: uno per uno, nessuno in piu' e nessuno in meno.
        assert.equal(tetti.length, edifici.length,
            `${id}: ${edifici.length} edifici fuori dal palazzo ma ${tetti.length} tetti`);
    });

    test(`${id}: sulle balconate c'e' gente`, () => {
        const { layout } = scenografiaDi(id, 6);
        const conAncore = layout.filter(v => DEL_PALAZZO.has(v.asset) && terraceAnchors[v.asset]);
        const folla = layout.filter(v => v.category === 'crowd');
        const abitate = conAncore.filter(f => folla.some(s => Math.hypot(s.x - f.x, s.z - f.z) < 16));
        assert.ok(abitate.length >= conAncore.length * 0.8,
            `${id}: solo ${abitate.length} balconate abitate su ${conAncore.length}`);
    });

    test(`${id}: il palazzo non e' piu' alto della fila di prima`, () => {
        const { layout } = scenografiaDi(id, 6);
        for (const v of layout.filter(x => DEL_PALAZZO.has(x.asset))) {
            const alto = Sizes.sizeOf(v.asset).h * (v.scale || 1);
            // ⚠️ LA QUOTA SI LEGGE DALLA VOCE, non si da' per scontata. Qui
            // c'era un 11 scritto a mano: mentre il codice posava lo Span a
            // terra, questo test calcolava la cima come se stesse in alto e
            // restava verde. Un'ipotesi dentro un test non e' piu' un'ipotesi.
            const cima = (v.y || 0) + alto;
            const limite = v.asset === 'pitClubTower' ? 21.5 : 19.5;
            assert.ok(cima <= limite,
                `${v.asset} su ${id} arriva a ${cima.toFixed(1)} sopra il piede del palazzo`);
        }
    });
}

// --- LA QUOTA DEL PRIMO PIANO, UNA VOLTA IN PISTA -------------------------

test('la quota del solaio e\' la differenza fra un vano intero e il solo primo piano', () => {
    // Il numero vive in due mondi che non si parlano: `SOLAIO_Z` in
    // `pitPalazzo.py`, che scolpisce, e `QUOTA_SOLAIO` in `pitClubProfilo.js`,
    // che posa. Non c'e' modo di importarlo dall'uno all'altro, ma c'e' modo di
    // MISURARLO: un vano intero e' il piano terra piu' lo stesso primo piano
    // dello Span, quindi la differenza fra le due altezze E' la quota del
    // solaio. Se domani il palazzo cambia in Blender, questo test lo dice.
    const bay = Sizes.sizeOf('pitClubBay').h;
    const span = Sizes.sizeOf('pitClubSpan').h;
    assert.ok(Math.abs(Profilo.QUOTA_SOLAIO - (bay - span)) <= 0.05,
        `QUOTA_SOLAIO e' ${Profilo.QUOTA_SOLAIO}, ma fra Bay (${bay}) e Span (${span}) ci sono ${(bay - span).toFixed(2)}`);
});

for (const id of PISTE) {
    test(`${id}: in pista il primo piano sta in alto, non dentro i box`, () => {
        // La posa copia la quota dal profilo: qui si prova che non la
        // appiattisce per strada. Un `pitClubSpan` a terra e' alto 7.2 e i box
        // dei piloti 10: si compenetrano per tutta la loro altezza.
        const { layout } = scenografiaDi(id, 6);
        const fette = layout.filter(v => DEL_PALAZZO.has(v.asset));
        const terra = fette.filter(v => v.asset !== 'pitClubSpan');
        assert.ok(terra.length, `${id}: nessuna fetta a terra con cui confrontare`);
        const base = terra[0].y || 0;
        for (const v of fette.filter(x => x.asset === 'pitClubSpan')) {
            assert.ok(Math.abs((v.y || 0) - base - Profilo.QUOTA_SOLAIO) <= 0.05,
                `${id}: uno Span in pista sta a quota ${(v.y || 0).toFixed(2)} invece di ${(base + Profilo.QUOTA_SOLAIO).toFixed(2)}`);
        }
    });
}
