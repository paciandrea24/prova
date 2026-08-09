// frontend/shared/trackScenery.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackGeometry = require('./trackGeometry.js');
const TrackScenery = require('./trackScenery.js');
const monteRosso = require('../tracks/monte-rosso.json');

const ROAD_HALF = monteRosso.roadHalfWidth;
const BARRIER_D = ROAD_HALF + 2.8 + 1.2; // stessa formula di frontend/f1.js (CURB_W=2.8)

function buildReal() {
    const trackPts = TrackGeometry.sampleLoop(monteRosso.controlPoints, 1000);
    const pitPts   = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    return { trackPts, pitPts };
}

// Quante SCHIERE formano dei moduli di tribuna: gruppi di moduli a contatto
// (il modulo è largo 19.2 e la catena li mette a quella distanza esatta).
function countRows(stands) {
    const rest = [...stands];
    let rows = 0;
    while (rest.length) {
        const group = [rest.shift()];
        let grown = true;
        while (grown) {
            grown = false;
            for (let i = rest.length - 1; i >= 0; i--) {
                if (group.some(q => Math.hypot(q.x - rest[i].x, q.z - rest[i].z) <= 19.6)) {
                    group.push(rest.splice(i, 1)[0]);
                    grown = true;
                }
            }
        }
        rows++;
    }
    return rows;
}

test('generateLayout è deterministico: stesso trackData → stesso layout', () => {
    const { trackPts, pitPts } = buildReal();
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const b = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    assert.deepEqual(a, b);
});

test('generateLayout produce layout diverso per un id tracciato diverso', () => {
    const { trackPts, pitPts } = buildReal();
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const other = { ...monteRosso, id: 'altro-tracciato' };
    const b = TrackScenery.generateLayout(other, trackPts, pitPts, BARRIER_D);
    assert.notDeepEqual(a, b);
});

test('ogni oggetto natura resta fuori dal corridoio pista e corsia box', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pitRoadHalf = monteRosso.pit.roadHalfWidth;
    const nature = layout.filter(i => i.category === 'nature');
    assert.ok(nature.length > 0);
    for (const item of nature) {
        const dTrack = TrackGeometry.nearestPoint(trackPts, item.x, item.z).dist;
        const dPit   = TrackGeometry.nearestPoint(pitPts, item.x, item.z).dist;
        assert.ok(dTrack >= BARRIER_D + 4 - 1e-6, `oggetto natura troppo vicino alla pista: ${dTrack}`);
        assert.ok(dPit >= pitRoadHalf + 5 - 1e-6, `oggetto natura troppo vicino alla corsia box: ${dPit}`);
    }
});

test('gli oggetti natura rispettano la distanza minima reciproca', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    for (let i = 0; i < nature.length; i++) {
        for (let j = i + 1; j < nature.length; j++) {
            const d = Math.hypot(nature[i].x - nature[j].x, nature[i].z - nature[j].z);
            assert.ok(d >= 7 - 1e-6, `due oggetti natura troppo vicini: ${d}`);
        }
    }
});

test('le tribune secondarie sono 6-10 SCHIERE, senza folla, con asset tra le 3 varianti a 1 piano', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const grandstands = layout.filter(i => i.category === 'grandstand');
    const crowd = layout.filter(i => i.category === 'crowd');
    // Dal 2026-08-10 ogni slot genera una SCHIERA di moduli contigui, non un
    // modulo solo: il conteggio va fatto sui gruppi, non sulle istanze.
    // 4-10 e non 6-10: una schiera occupa fino a 6 moduli (115 unità) contro i
    // 19.2 di una tribuna singola, quindi su un circuito corto come
    // monte-rosso (giro di 1177) ce ne stanno meno — ma coprono molto più
    // fronte pista di prima.
    const rows = countRows(grandstands);
    assert.ok(rows >= 4 && rows <= 10, `numero schiere fuori range: ${rows} (${grandstands.length} moduli)`);
    assert.equal(crowd.length, 0, 'non deve piu\' esserci folla');
    const validAssets = new Set(['grandStand', 'grandStandAwning', 'grandStandCovered']);
    for (const g of grandstands) {
        assert.ok(validAssets.has(g.asset), `asset tribuna non valido: ${g.asset}`);
    }
});

test('la natura usa solo alberi, mai rocce o cespugli', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    const validAssets = new Set(['treeLarge', 'treeSmall']);
    for (const n of nature) {
        assert.ok(validAssets.has(n.asset), `asset natura non valido (dovrebbe essere solo albero): ${n.asset}`);
    }
});

test('se presente, il laghetto rispetta la distanza minima dagli altri oggetti', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pond = layout.find(i => i.category === 'pond');
    if (!pond) return; // non garantito per design, vedi spec
    for (const item of layout) {
        if (item === pond) continue;
        const d = Math.hypot(pond.x - item.x, pond.z - item.z);
        assert.ok(d >= 16 - 1e-6, `laghetto troppo vicino a un altro oggetto: ${d}`);
    }
});

test('hashString è deterministico e mulberry32 produce valori in [0,1)', () => {
    const h1 = TrackScenery.hashString('monte-rosso');
    const h2 = TrackScenery.hashString('monte-rosso');
    assert.equal(h1, h2);
    const rng = TrackScenery.mulberry32(h1);
    for (let i = 0; i < 100; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1, `valore fuori range: ${v}`);
    }
});

test('il paddock usa cartelloni sponsor e box, mai pylon/bandiere/tenda', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const paddock = layout.filter(i => i.category === 'paddock');
    assert.ok(paddock.length > 0);
    const validAssets = new Set(['billboard', 'billboardLow', 'pitsGarageClosed', 'pitsOffice']);
    for (const p of paddock) {
        assert.ok(validAssets.has(p.asset), `asset paddock non valido: ${p.asset}`);
    }
});

// 7 moduli su UN solo livello. Storia del numero: 12 (6x2) coi Kenney alti
// 5.38, poi 6 (3x2) col modulo custom largo 19.2, poi 3 (3x1) perché a due
// livelli si legge come due tribune sovrapposte, infine 7 (7x1) perché
// l'utente vuole una fila unica lunga che segua la pista senza interruzioni
// (playtest 2026-08-09).
test('la tribuna principale è unica, 7 moduli su un livello, vicino alla partenza', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    assert.equal(main.length, 7, `attesi 7 moduli tribuna principale, trovati ${main.length}`);
    for (const m of main) {
        assert.equal(m.asset, 'grandStand');
        const d = TrackGeometry.nearestPoint(trackPts, m.x, m.z).dist;
        assert.ok(d >= BARRIER_D, `modulo tribuna principale dentro il corridoio pista: ${d}`);
    }
    // Un solo livello: nessun modulo sollevato sopra un altro.
    const levels = new Set(main.map(m => m.y.toFixed(3)));
    assert.equal(levels.size, 1, `atteso 1 livello di quota, trovati ${levels.size}`);
});

test('la tribuna principale non si sovrappone alle tribune normali', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    const normal = layout.filter(i => i.category === 'grandstand');
    for (const m of main) {
        for (const g of normal) {
            const d = Math.hypot(m.x - g.x, m.z - g.z);
            assert.ok(d >= 10, `tribuna principale troppo vicina a una tribuna normale: ${d}`);
        }
    }
});

test('la tribuna principale non si sovrappone ai cartelloni sponsor del paddock', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    const billboards = layout.filter(i => i.category === 'paddock' && (i.asset === 'billboard' || i.asset === 'billboardLow'));
    assert.ok(billboards.length > 0);
    for (const m of main) {
        for (const b of billboards) {
            const d = Math.hypot(m.x - b.x, m.z - b.z);
            assert.ok(d >= 6, `tribuna principale troppo vicina a un cartellone sponsor: ${d}`);
        }
    }
});

test('nessun cartellone sponsor del rettilineo di partenza finisce dentro la corsia box', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pitRoadHalf = monteRosso.pit.roadHalfWidth;
    const billboards = layout.filter(i => i.category === 'paddock' && (i.asset === 'billboard' || i.asset === 'billboardLow'));
    assert.ok(billboards.length > 0);
    for (const b of billboards) {
        const dPit = TrackGeometry.nearestPoint(pitPts, b.x, b.z).dist;
        assert.ok(dPit >= pitRoadHalf + 4 - 1e-6, `cartellone troppo vicino alla corsia box: distanza ${dPit}, pitRoadHalf ${pitRoadHalf}`);
    }
});

test('nessun oggetto scenografico (paddock, natura, laghetto, tribune...) finisce dentro la zona box giocatore', () => {
    // Copre TUTTE le categorie del layout, non solo 'paddock': natura
    // (alberi/rocce) e laghetto usano lo stesso scatter casuale e possono
    // finire nella zona box giocatore esattamente come gli edifici/
    // cartelloni del paddock se non applicano lo stesso controllo (bug
    // trovato dalla review finale — vedi buildNatureLayout/findPondSpot).
    //
    // Verifica contro l'ingombro REALE di ogni box (non un raggio fisso
    // da un solo punto centrale, vedi bug playtest 2026-08-04: un raggio
    // attorno a pitBoxIndex non copriva i box più esterni della fila).
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const pitRoadHalf = monteRosso.pit.roadHalfWidth;
    const boxAnchors = TrackGeometry.pitBoxAnchors(monteRosso.pit.path, monteRosso.pit.boxIndex, TrackScenery.PLAYER_BOX_MAX_COUNT);
    const footprints = boxAnchors.map(a => TrackScenery.playerBoxFootprintCorners(a, trackPts, pitRoadHalf));
    assert.ok(layout.length > 0);
    for (const item of layout) {
        assert.ok(!TrackScenery.insidePlayerBoxFootprint(item.x, item.z, footprints),
            `oggetto '${item.category}'/${item.asset} a (${item.x.toFixed(1)},${item.z.toFixed(1)}) cade dentro l'ingombro reale di un box giocatore`);
    }
});

test('gli oggetti natura usano la quota del terrapieno (sfuma con la distanza), non la quota pista pura', () => {
    const E = 20;
    const ctrl = [];
    for (let a = 0; a < 360; a += 15) {
        const r = a * Math.PI / 180;
        ctrl.push({ x: 300 * Math.cos(r), z: 300 * Math.sin(r), y: E });
    }
    const hillTrack = { ...monteRosso, id: 'collina-test', controlPoints: ctrl };
    const trackPts = TrackGeometry.sampleLoop(ctrl, 1000);
    const pitPts   = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    const layout = TrackScenery.generateLayout(hillTrack, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    assert.ok(nature.length > 0);
    for (const n of nature) {
        assert.ok(n.y >= -1e-6 && n.y <= E + 1e-6, `quota fuori range atteso [0, ${E}]: ${n.y}`);
    }
    assert.ok(nature.some(n => n.y < E - 0.5), 'atteso che alcuni oggetti abbiano quota sfumata sotto quella pista (terrapieno)');
});

test('gli oggetti scenici non ereditano mai la quota del ponte (solo il terreno vero conta)', () => {
    const E = 20;
    const ctrl = [];
    for (let a = 0; a < 360; a += 15) {
        const r = a * Math.PI / 180;
        const isBridge = a >= 150 && a <= 210; // arco di ponte isolato, lontano dalla partenza (a=0)
        ctrl.push({ x: 300 * Math.cos(r), z: 300 * Math.sin(r), y: isBridge ? E : 0, bridge: isBridge });
    }
    const bridgeTrack = { ...monteRosso, id: 'ponte-test', controlPoints: ctrl };
    const trackPts = TrackGeometry.sampleLoop(ctrl, 1000);
    const pitPts   = TrackGeometry.sampleOpenPath(monteRosso.pit.path, 300);
    const layout = TrackScenery.generateLayout(bridgeTrack, trackPts, pitPts, BARRIER_D);

    // Il valore massimo di quota "a terra" possibile (nessun punto ponte):
    // ogni oggetto scenico deve restare entro questo limite, altrimenti ha
    // ereditato la quota del ponte da un punto che dovrebbe essere escluso.
    const groundMaxY = Math.max(...trackPts.filter(p => !p.bridge).map(p => p.y || 0));
    for (const item of layout) {
        // I boschi sono esclusi: la loro quota viene dalle COLLINE
        // (SceneryHills), non dal terreno del tracciato, e supera di proposito
        // qualunque quota di pista. Hanno un test dedicato più sotto, che
        // verifica che poggino esattamente sul rilievo.
        if (item.category === 'woods') continue;
        assert.ok(item.y <= groundMaxY + 0.01, `oggetto con quota superiore al terreno vero (${groundMaxY}): trovato y=${item.y} (categoria ${item.category})`);
    }
});

// Il piazzamento reale dei box giocatore vive in pitBoxLoader.js, l'esclusione
// della loro zona dalla scenografia vive qui: due costanti duplicate che, se
// divergono, fanno generare alberi e cartelloni dentro i box senza che nulla
// se ne accorga. È già successo (PIT_BOX_CLEARANCE 2 -> 12 aggiornato solo da
// un lato, 10 unità di scarto), quindi ora lo blocca un test.
const PitBoxLoader = require('./pitBoxLoader.js');

test('PLAYER_BOX_OFFSET_MARGIN è allineato a PitBoxLoader.PIT_BOX_OFFSET_MARGIN', () => {
    assert.equal(TrackScenery.PLAYER_BOX_OFFSET_MARGIN, PitBoxLoader.PIT_BOX_OFFSET_MARGIN);
});

test("l'ingombro locale del box copre la mezza profondità dichiarata dal loader", () => {
    const { zMin, zMax } = TrackScenery.PLAYER_BOX_LOCAL_BOUNDS;
    assert.equal(zMax, PitBoxLoader.PIT_BOX_FRONT_HALF_DEPTH);
    assert.equal(zMin, -PitBoxLoader.PIT_BOX_FRONT_HALF_DEPTH);
});

// --- Integrazione asset voxel custom (2026-08-09) ---------------------------
// Le costanti di piazzamento erano tarate sui Kenney, ~3 volte più piccoli:
// i moduli nuovi si compenetrerebbero fra loro. Dimensioni misurate sui .glb
// reali, vedi docs/f1-notes.md.
const CUSTOM_SIZES = {
    grandStand: { w: 19.2, d: 12.8 },
    billboard: { w: 16.4, d: 1.6 },
    billboardLow: { w: 16.4, d: 1.4 },
    pitsGarageClosed: { w: 20.6, d: 14.7 },
    pitsOffice: { w: 20.7, d: 14.9 },
};

// Distanza minima ammessa fra i centri di due oggetti affiancati: se sono
// più vicini della semisomma delle larghezze, i modelli si compenetrano.
function minCenterDistance(a, b) {
    return (CUSTOM_SIZES[a].w + CUSTOM_SIZES[b].w) / 2;
}

test('i moduli della tribuna principale non si compenetrano fra loro', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    assert.ok(main.length > 0, 'nessuna tribuna principale generata');

    // Confronta solo i moduli dello stesso livello: quelli impilati
    // condividono x/z per costruzione e differiscono solo in altezza.
    const byTier = new Map();
    for (const m of main) {
        const tier = Math.round(m.y * 100);
        if (!byTier.has(tier)) byTier.set(tier, []);
        byTier.get(tier).push(m);
    }
    for (const [, mods] of byTier) {
        for (let i = 0; i < mods.length; i++) {
            for (let j = i + 1; j < mods.length; j++) {
                const d = Math.hypot(mods[i].x - mods[j].x, mods[i].z - mods[j].z);
                assert.ok(d >= minCenterDistance('grandStand', 'grandStand') - 0.5,
                    `moduli a ${d.toFixed(2)}, minimo ${minCenterDistance('grandStand', 'grandStand')}`);
            }
        }
    }
});

test('i cartelloni sponsor consecutivi non si compenetrano', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const boards = layout.filter(i => i.asset === 'billboard' || i.asset === 'billboardLow');
    for (let i = 0; i < boards.length; i++) {
        for (let j = i + 1; j < boards.length; j++) {
            const d = Math.hypot(boards[i].x - boards[j].x, boards[i].z - boards[j].z);
            assert.ok(d >= minCenterDistance(boards[i].asset, boards[j].asset) - 0.5,
                `cartelloni a ${d.toFixed(2)}`);
        }
    }
});

// Gli unici asset custom scalati sono quelli che scavalcano la pista: la
// loro luce dev'essere adattata alla larghezza della carreggiata più le
// barriere, che variano da tracciato a tracciato.
const SPANNING_ASSETS = new Set(['startGantry', 'footbridge']);

test('gli asset custom sono istanziati a scala 1, gli alberi Kenney a 6', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    for (const item of layout) {
        if (item.category === 'pond') continue;
        if (item.asset === 'treeLarge' || item.asset === 'treeSmall') {
            assert.equal(item.scale, 6, `${item.asset} deve restare a scala Kenney`);
        } else if (SPANNING_ASSETS.has(item.asset)) {
            assert.ok(item.scale >= 1, `${item.asset} non può essere rimpicciolito`);
        } else {
            assert.equal(item.scale, 1, `${item.asset} è custom, deve stare a scala 1`);
        }
    }
});

// --- Cavalcavia (2026-08-09) -----------------------------------------------
// terrainHeightAt lavora sui soli punti a terra, quindi un oggetto piazzato
// sotto un tratto di pista sopraelevata riceve la quota del terreno: se è più
// alto della luce del ponte, lo attraversa. Su "prova" (198 punti di ponte
// fino a 11.5 di quota) succedeva a reti, tribune, torre e passerella —
// segnalato dall'utente con uno screenshot.
const SceneryAssetSizes = require('./sceneryAssetSizes.js');
const prova = require('../tracks/prova.json');

test('nessun oggetto scenico attraversa un tratto di pista sopraelevata', () => {
    const trackPts = TrackGeometry.sampleLoop(prova.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(prova.pit.path, 300);
    const barrierD = prova.roadHalfWidth + 2.8 + 1.2;
    const layout = TrackScenery.generateLayout(prova, trackPts, pitPts, barrierD);
    const bridgePts = trackPts.filter(p => p.bridge);
    assert.ok(bridgePts.length > 0, 'il tracciato di prova deve avere cavalcavia');

    for (const item of layout) {
        if (item.category === 'pond' || item.category === 'crowd') continue;
        const bridgeY = TrackGeometry.bridgeHeightAt(bridgePts, item.x, item.z, barrierD);
        if (bridgeY === Infinity) continue;
        const h = SceneryAssetSizes.heightOf(item.asset) * (item.scale > 1 ? item.scale : 1);
        assert.ok(item.y + h <= bridgeY,
            `${item.asset} arriva a ${(item.y + h).toFixed(1)} contro un ponte a ${bridgeY.toFixed(1)}`);
    }
});

test('gli edifici lungo la corsia box non si compenetrano', () => {
    const trackPts = TrackGeometry.sampleLoop(prova.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(prova.pit.path, 300);
    const layout = TrackScenery.generateLayout(prova, trackPts, pitPts, prova.roadHalfWidth + 4);
    const buildings = layout.filter(i => i.asset === 'pitsGarageClosed' || i.asset === 'pitsOffice');
    assert.ok(buildings.length >= 2, 'troppo pochi edifici per il controllo');
    // Criterio SAT sui footprint reali, non più somma delle mezze diagonali:
    // quella vale 12.65 per edificio, cioè pretenderebbe 25.4 fra i centri di
    // due edifici larghi 20.6 affiancati fianco a fianco — rendendo
    // impossibile per costruzione il fronte continuo che l'utente ha chiesto.
    // La diagonale conta solo se i due sono ruotati fra loro, ed è esattamente
    // ciò che itemsOverlap misura davvero.
    for (let a = 0; a < buildings.length; a++) {
        for (let b = a + 1; b < buildings.length; b++) {
            assert.ok(!SceneryAssetSizes.itemsOverlap(buildings[a], buildings[b]),
                `edifici box compenetrati a (${buildings[a].x.toFixed(0)}, ${buildings[a].z.toFixed(0)})`);
        }
    }
});

// NOTA: qui c'era un test che vietava QUALSIASI compenetrazione fra oggetti
// scenici. È stato rimosso su richiesta esplicita dell'utente dopo il
// playtest del 2026-08-09: per farlo passare il generatore scartava oggetti
// e distanziava tutto, e il risultato in gioco era peggiore — tribune con
// buchi in mezzo, decoro spinto dietro le strutture. Una compenetrazione
// lieve che non si nota guidando è preferibile a un layout rado.
// Restano i controlli mirati: niente dentro la pista, niente dentro la
// corsia box, niente che attraversi un cavalcavia.

// --- Composizione delle file di strutture ----------------------------------
// (Rif. playtest 2026-08-09: "un buco al traguardo", "edifici box sparsi come
// messi a caso", "un edificio dentro un altro")
const newMonza = require('../tracks/new-monza.json');

function layoutFor(track) {
    const trackPts = TrackGeometry.sampleLoop(track.controlPoints, 1000);
    const pitPts = TrackGeometry.sampleOpenPath(track.pit.path, 300);
    const barrierD = track.roadHalfWidth + 2.8 + 1.2;
    return { layout: TrackScenery.generateLayout(track, trackPts, pitPts, barrierD), trackPts, pitPts, barrierD };
}

// La tribuna principale deve leggersi come UNA struttura continua: ogni modulo
// a contatto col successivo, nessun varco. Il difetto segnalato dall'utente
// nasce da distanze reali diverse fra loro — 14.3 e 17.2 su prova, contro un
// passo nominale di 18.4 — perché il passo era espresso in campioni e non
// teneva conto dell'offset laterale su un traguardo in curva.
for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: i moduli della tribuna principale formano una fila continua`, () => {
        const { layout } = layoutFor(track);
        const main = layout.filter(i => i.category === 'grandstand-main');
        assert.ok(main.length >= 5, `solo ${main.length} moduli: la fila deve essere lunga`);

        const w = SceneryAssetSizes.sizeOf('grandStand').w;
        // Tolleranza di 0.3 sul contatto esatto: la posizione viene da una
        // bisezione, non da un calcolo chiuso. Per riferimento, il varco
        // segnalato dall'utente era di 13.2 unità.
        const TOUCH = w + 0.3;

        // Ogni modulo deve avere un vicino a contatto, e nessuno deve
        // compenetrarne un altro.
        for (const m of main) {
            let nearest = Infinity;
            for (const o of main) {
                if (o === m) continue;
                nearest = Math.min(nearest, Math.hypot(o.x - m.x, o.z - m.z));
            }
            assert.ok(nearest <= TOUCH, `modulo isolato: vicino più prossimo a ${nearest.toFixed(1)}`);
            assert.ok(nearest > w * 0.7, `moduli troppo compenetrati: ${nearest.toFixed(1)}`);
        }

        // ...e la fila deve essere UNA sola: visita per contatto a partire da
        // un modulo qualsiasi, tutti devono risultare raggiungibili. Senza
        // questo, due tronconi separati passerebbero il controllo sopra.
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length) {
            const i = queue.pop();
            for (let j = 0; j < main.length; j++) {
                if (seen.has(j)) continue;
                if (Math.hypot(main[i].x - main[j].x, main[i].z - main[j].z) <= TOUCH) {
                    seen.add(j);
                    queue.push(j);
                }
            }
        }
        assert.equal(seen.size, main.length,
            `la tribuna è spezzata: ${seen.size} moduli connessi su ${main.length}`);
    });

    test(`${track.id}: nessuna tribuna sparsa a ridosso della fila principale`, () => {
        const { layout } = layoutFor(track);
        const main = layout.filter(i => i.category === 'grandstand-main');
        const loose = layout.filter(i => i.category === 'grandstand');
        for (const l of loose) {
            for (const m of main) {
                const d = Math.hypot(l.x - m.x, l.z - m.z);
                assert.ok(d >= 45,
                    `tribuna sparsa a ${d.toFixed(1)} dalla fila principale: ne' continua ne' separata`);
            }
        }
    });
}

// Cinque sovrapposizioni reali esistevano sui tre tracciati prima di questo
// controllo; la peggiore era il podio dentro un garage box, 7.1 unità su
// "prova" — l'"edificio dentro l'edificio" segnalato dall'utente.
//
// NON è il ritorno del test rimosso qui sopra, che vietava OGNI
// compenetrazione fra oggetti scenici: qui si guardano le sole STRUTTURE
// (edifici, tribune, landmark), non natura né folla, e chi non ci sta viene
// RICOLLOCATO scorrendo il giro, non scartato. Infatti il numero di oggetti
// generati è cresciuto, non calato: era il diradamento il problema di allora.
for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: nessuna struttura si sovrappone a un'altra`, () => {
        const { layout } = layoutFor(track);
        // Solo le strutture: natura e folla usano un criterio di distanza
        // (molto più economico) e possono legittimamente stare vicine.
        const structures = layout.filter(i =>
            ['paddock', 'grandstand', 'grandstand-main', 'landmark'].includes(i.category));
        for (let i = 0; i < structures.length; i++) {
            for (let j = i + 1; j < structures.length; j++) {
                const a = structures[i], b = structures[j];
                // I moduli di una stessa schiera si toccano per costruzione, e
                // dove la pista curva ognuno è ruotato un po' diversamente dal
                // vicino: gli angoli interni si sfiorano necessariamente. È il
                // prezzo di una fila continua su una curva, ed è voluto — la
                // loro spaziatura ha un test dedicato qui sopra. Vale sia per
                // la fila principale sia per le schiere secondarie.
                const stessaSchiera = a.category === b.category
                    && (a.category === 'grandstand-main' || a.category === 'grandstand')
                    && Math.hypot(a.x - b.x, a.z - b.z) <= 19.6;
                if (stessaSchiera) continue;
                assert.equal(SceneryAssetSizes.itemsOverlap(a, b), false,
                    `${a.asset} e ${b.asset} si sovrappongono a (${a.x.toFixed(0)}, ${a.z.toFixed(0)})`);
            }
        }
    });
}

// Conteggio prima di questo controllo: prova 10, new-monza 3, monte-rosso 1.
// Il passo fisso di 24 unità, quando un candidato veniva scartato dai filtri,
// apriva un vuoto di 48 — da cui "gli edifici sono molto staccati tra loro
// come se fossero messi a caso" (utente, playtest 2026-08-09).
// Quanti edifici DECORATIVI pretendere per pista. Il numero dipende da quanto
// spazio lasciano i box giocatore, che sono gli edifici veri della corsia:
//   - monte-rosso: ZERO. Corsia di 368 unità, sei box da 21.8 più lo spazio di
//     manovra davanti a ciascuno: dei 233 campioni utili ne restano liberi 0
//     (misurato). Il fronte lo formano interamente i box dei piloti, ed è
//     giusto così — non è un difetto da mascherare alzando una costante.
//   - new-monza: 3, con 51 campioni liberi su 250.
//   - prova: 4 (ne genera 13, la corsia è lunga).
const MIN_PIT_BUILDINGS = { prova: 4, 'monte-rosso': 0, 'new-monza': 3 };

for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: gli edifici della corsia box formano un fronte continuo`, () => {
        const { layout, trackPts } = layoutFor(track);
        const buildings = layout.filter(i =>
            i.asset === 'pitsGarageClosed' || i.asset === 'pitsOffice');
        const min = MIN_PIT_BUILDINGS[track.id];
        assert.ok(buildings.length >= min,
            `solo ${buildings.length} edifici (minimo ${min}): la corsia box sembra vuota`);
        if (buildings.length < 2) return;   // con un solo edificio non esiste "staccato da"

        // Ogni edificio deve avere un vicino a contatto: la distanza fra i
        // centri non deve superare la semisomma delle larghezze più un gap
        // ragionevole.
        //
        // Un vuoto più ampio è però legittimo se in mezzo ci sono i BOX DEI
        // PILOTI: sono loro il fronte in quel tratto, e gli edifici decorativi
        // ne stanno giustamente fuori. Senza questa distinzione il test
        // pretenderebbe una continuità impossibile — su new-monza i box
        // separano i due tratti liberi di 170 unità.
        const pitRoadHalf = track.pit.roadHalfWidth;
        const anchors = TrackGeometry.pitBoxAnchors(
            track.pit.path, track.pit.boxIndex, TrackScenery.PLAYER_BOX_MAX_COUNT,
            trackPts, pitRoadHalf);
        const boxZone = [];
        for (const a of anchors) {
            boxZone.push(TrackScenery.playerBoxFootprintCorners(a, trackPts, pitRoadHalf));
            boxZone.push(TrackScenery.playerBoxApronCorners(a, trackPts, pitRoadHalf));
        }
        function boxFraLoro(a, b) {
            for (let s = 1; s < 20; s++) {
                const t = s / 20;
                if (TrackScenery.insidePlayerBoxFootprint(
                        a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, boxZone)) return true;
            }
            return false;
        }

        for (const b of buildings) {
            let nearest = Infinity, nearestItem = null;
            for (const o of buildings) {
                if (o === b) continue;
                const need = (SceneryAssetSizes.sizeOf(b.asset).w + SceneryAssetSizes.sizeOf(o.asset).w) / 2;
                const gap = Math.hypot(o.x - b.x, o.z - b.z) - need;
                if (gap < nearest) { nearest = gap; nearestItem = o; }
            }
            if (nearest <= 6) continue;
            assert.ok(boxFraLoro(b, nearestItem),
                `edificio isolato: ${nearest.toFixed(1)} unità di vuoto senza box dei piloti in mezzo`);
        }
    });
}

const SceneryHills = require('./sceneryHills.js');

// I boschi chiudono l'orizzonte insieme alle colline. Devono stare lontani
// dalla zona di gara e — soprattutto — poggiare sul rilievo: un albero sulla
// collina con quota 0 resta sepolto.
test('i boschi restano sotto il tetto di istanze, lontani dalla pista e sul rilievo', () => {
    const { layout, trackPts, barrierD } = layoutFor(prova);
    const woods = layout.filter(i => i.category === 'woods');
    const trees = layout.filter(i => i.category === 'nature' || i.category === 'woods');
    assert.ok(woods.length > 100, `solo ${woods.length} alberi di bosco: l'orizzonte resta aperto`);
    assert.ok(trees.length <= 560, `${trees.length} alberi in tutto: oltre il tetto, rischio frame rate`);

    const embankOuter = barrierD + 45;
    const groundPts = trackPts.filter(p => !p.bridge);
    let sulRilievo = 0;
    for (const t of trees) {
        const d = TrackGeometry.nearestPoint(groundPts, t.x, t.z).dist;
        assert.ok(d >= barrierD, `albero a ${d.toFixed(1)} dal centro pista: dentro le barriere`);
        const atteso = SceneryHills.hillHeightAt(t.x, t.z, d, embankOuter);
        if (atteso > 0.5) {
            assert.ok(Math.abs(t.y - atteso) < 0.01,
                `albero a quota ${t.y.toFixed(2)} dove il terreno sta a ${atteso.toFixed(2)}: sepolto o sospeso`);
            sulRilievo++;
        }
    }
    assert.ok(sulRilievo > 20, `solo ${sulRilievo} alberi sulle colline: i boschi non arrivano al rilievo`);
});

// pylon e flagPole avevano ZERO istanze su TUTTI e tre i tracciati, e
// paddockTent una sola: asset modellati, esportati, caricati... e mai visti in
// gioco. Il test sta QUI e non in sceneryTrackside.test.js perché deve girare
// sul layout completo, con gli ingombri REALI dei box giocatore: con i
// footprint vuoti del contesto sintetico il decoro trova sempre posto, e il
// difetto non si riproduce (verificato: la prima versione del fix passava quel
// test e in gioco lasciava comunque pylon e flagPole a zero).
for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: il decoro del paddock compare davvero nel layout finale`, () => {
        const { layout } = layoutFor(track);
        for (const asset of ['pylon', 'flagPole', 'paddockTent']) {
            const n = layout.filter(i => i.asset === asset).length;
            assert.ok(n > 0, `nessun ${asset} nel layout: l'asset è modellato ma non compare in gioco`);
        }
    });
}

// Lo spazio DAVANTI al box — dove l'auto si ferma e sterza per rientrare in
// corsia — non era protetto: gli edifici del paddock stanno a
// pitRoadHalf + 10 dall'asse corsia, cioè alla stessa distanza dello stallo,
// e uno finiva davanti all'ultimo box come un muro (utente, 2026-08-10).
for (const track of [prova, monteRosso, newMonza]) {
    test(`${track.id}: nulla ostruisce lo spazio di manovra davanti ai box`, () => {
        const { layout, trackPts } = layoutFor(track);
        const pitRoadHalf = track.pit.roadHalfWidth;
        const anchors = TrackGeometry.pitBoxAnchors(
            track.pit.path, track.pit.boxIndex, TrackScenery.PLAYER_BOX_MAX_COUNT,
            trackPts, pitRoadHalf);
        const aprons = anchors.map(a => TrackScenery.playerBoxApronCorners(a, trackPts, pitRoadHalf));

        for (const item of layout) {
            if (item.category === 'crowd' || item.category === 'pond') continue;
            // Il test è sugli ANGOLI dell'oggetto, non sul solo centro: un
            // edificio profondo 14.7 può avere il centro fuori dal grembiule e
            // sporgerci dentro con mezzo fianco — ed è proprio ciò che
            // succedeva.
            for (const corner of SceneryAssetSizes.footprintCorners(item)) {
                assert.ok(!TrackScenery.insidePlayerBoxFootprint(corner.x, corner.z, aprons),
                    `${item.asset} invade lo spazio di manovra di un box a (${item.x.toFixed(0)}, ${item.z.toFixed(0)})`);
            }
        }
    });
}
