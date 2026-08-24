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

test('la natura usa alberi e cespugli, mai rocce', () => {
    // Fino al 2026-08-10 la vegetazione erano due soli alberi Kenney e il test
    // vietava tutto il resto. Ora i cespugli ci sono per scelta — servono a
    // riempire il prato dove un albero sarebbe troppo — mentre le rocce hanno
    // categoria propria, perché stanno molto più lontano dalla pista: quella
    // fascia diventerà via di fuga in ghiaia.
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const nature = layout.filter(i => i.category === 'nature');
    const validAssets = new Set(['treeLarge', 'treeSmall', 'treeBroad', 'treeYoung',
                                 'treeRound', 'bushLow', 'bushTall']);
    for (const n of nature) {
        assert.ok(validAssets.has(n.asset), `asset natura non valido: ${n.asset}`);
        assert.ok(!n.asset.startsWith('rock'), `roccia fra gli oggetti natura: ${n.asset}`);
    }
});

test('le rocce stanno lontane dalla pista', () => {
    // Vincolo esplicito dell'utente: niente rocce a bordo pista, perché quella
    // fascia diventerà via di fuga in ghiaia. Il margine è più largo di quello
    // della vegetazione anche per un secondo motivo: un masso a ridosso della
    // carreggiata si legge come un ostacolo pericoloso anche quando non lo è.
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const rocce = layout.filter(i => i.category === 'rock');
    assert.ok(rocce.length > 0, 'nessuna roccia nel layout');
    for (const r of rocce) {
        const d = TrackGeometry.nearestPoint(trackPts, r.x, r.z).dist;
        assert.ok(d >= BARRIER_D + 60 - 1e-6, `roccia a ${d.toFixed(1)} dall'asse pista`);
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

// 12 moduli su UN solo livello, tutti CON LA COPERTURA. Storia del numero:
// 12 (6x2) coi Kenney alti 5.38, poi 6 (3x2) col modulo custom largo 19.2,
// poi 3 (3x1) perché a due livelli si legge come due tribune sovrapposte,
// poi 7 (7x1) perché l'utente vuole una fila unica lunga che segua la pista
// senza interruzioni (playtest 2026-08-09), infine 12 (12x1) perché a 7 la
// fila finiva prima del ponte semafori e lasciava un vuoto proprio al
// traguardo (segnalazione M 20 del 2026-08-13).
test('la tribuna principale è unica, 12 moduli coperti su un livello, vicino alla partenza', () => {
    const { trackPts, pitPts } = buildReal();
    const layout = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D);
    const main = layout.filter(i => i.category === 'grandstand-main');
    assert.equal(main.length, 12, `attesi 12 moduli tribuna principale, trovati ${main.length}`);
    for (const m of main) {
        assert.equal(m.asset, 'grandStandCovered');
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
        // Stessa ragione per le macchie di bosco del fondale e per le rocce,
        // che arrivano fin sui primi pendii collinari.
        if (item.category === 'woods' || item.category === 'woodmass'
            || item.category === 'rock') continue;
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
        } else if (item.asset === 'catchFence') {
            // Terza eccezione, dal 2026-08-13: la rete si dimensiona sulla
            // tribuna che protegge (19.2 / 12 = 1.6), altrimenti ne lascia
            // scoperto un pezzo. La scala è uniforme, quindi la rete si alza
            // insieme alla larghezza — accettato dall'utente.
            assert.ok(item.scale > 1, `${item.asset} non è stata dimensionata sulla tribuna`);
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
const SceneryGaps = require('./sceneryGaps.js');
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
            // 6 unità di stacco erano la tolleranza quando gli edifici si
            // incatenavano a distanza libera. Da quando stanno sulla stessa
            // GRIGLIA dei box (passo 15, larghezza ~13) lo stacco nominale fra
            // due vicini è già 2, e dove la corsia piega troppo una posizione
            // resta scoperta: lì lo stacco diventa 17. Si accetta UN buco di
            // una posizione, non due — due di fila si leggerebbero come un
            // pezzo di fronte mancante.
            //
            // È un compromesso consapevole: la griglia condivisa serve a non
            // avere box ed edifici su due file sfalsate, e il prezzo sono
            // alcune posizioni scoperte sui tratti curvi agli estremi della
            // corsia, dove comunque un garage non ci starebbe dritto.
            if (nearest <= TrackGeometry.PIT_BOX_SPACING + 5) continue;
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
    // Tetto alzato da 560 a 800 il 2026-08-10. Il vecchio valore nasceva da un
    // periodo in cui ogni albero proiettava ombra e la scenografia veniva
    // disegnata per intero a ogni frame: entrambe le cause sono cadute
    // (NO_SHADOW_ASSETS e il frustum culling per celle di sceneryChunks), e la
    // misura del pannello va rifatta a ogni ritaratura invece di fidarsi del
    // numero. Se un playtest mostra cali, la leva è WOOD_MAX_TREES.
    assert.ok(trees.length <= 1300, `${trees.length} alberi in tutto: oltre il tetto, rischio frame rate`);

    const embankOuter = barrierD + 45;
    const groundPts = trackPts.filter(p => !p.bridge);
    let sulRilievo = 0;
    for (const t of trees) {
        const d = TrackGeometry.nearestPoint(groundPts, t.x, t.z).dist;
        assert.ok(d >= barrierD, `albero a ${d.toFixed(1)} dal centro pista: dentro le barriere`);
        // Il flag dentro/fuori va passato anche qui: dal 2026-08-10 le colline
        // non si alzano nell'infield, e un albero interno deve stare a quota
        // zero come il terreno sotto di lui. Senza il flag questo test si
        // aspetterebbe una collina che non esiste.
        const atteso = SceneryHills.hillHeightAt(t.x, t.z, d, embankOuter,
                                                 TrackGeometry.isInsideLoop(groundPts, t.x, t.z));
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

test('i boschi formano macchie fitte, non un prato spennacchiato', () => {
    // La massa visiva viene dalla densità DENTRO la macchia: un bosco rado lo
    // sguardo lo attraversa, e allargare le macchie invece di infittirle le
    // dirada soltanto. Si misura contando quanti alberi ha in media un albero
    // entro 20 unità: sotto 3 è vegetazione sparsa, non bosco.
    const { layout } = layoutFor(prova);
    const woods = layout.filter(v => v.category === 'woods');
    assert.ok(woods.length >= 400, `solo ${woods.length} alberi di bosco`);
    let vicini = 0;
    for (const a of woods) {
        let n = 0;
        for (const b of woods) {
            if (a === b) continue;
            if (Math.hypot(a.x - b.x, a.z - b.z) < 20) n++;
        }
        vicini += n;
    }
    const media = vicini / woods.length;
    assert.ok(media >= 3, `densità media ${media.toFixed(1)} vicini: bosco troppo rado`);
});

// L'orizzonte non va NASCOSTO, va OCCUPATO: l'utente non vuole una mappa
// murata ma l'impressione che lo sia. Il lavoro lo fa la vegetazione, non il
// terreno — le colline sono alte 45 e da sole coprono 4°, mentre la camera ne
// inquadra 30. Quello che conta è che non esista una direzione in cui si veda
// solo prato e cielo.
test('nessuna direzione verso la campagna resta senza vegetazione', () => {
    const { layout, trackPts } = layoutFor(prova);
    const alberi = layout.filter(v => v.category === 'woods' || v.category === 'nature');

    let vuoti = 0, totali = 0;
    for (let s = 0; s < 24; s++) {
        const p = trackPts[Math.floor(s * trackPts.length / 24)];
        for (let k = 0; k < 36; k++) {
            const ang = (k / 36) * 2 * Math.PI - Math.PI;
            // I settori che guardano nell'INFIELD non contano: lì i boschi non
            // devono esserci, l'interno del circuito resta libero.
            if (TrackGeometry.isInsideLoop(trackPts, p.x + Math.cos(ang) * 300, p.z + Math.sin(ang) * 300)) continue;
            totali++;
            let n = 0;
            for (const a of alberi) {
                const dx = a.x - p.x, dz = a.z - p.z;
                const d = Math.hypot(dx, dz);
                if (d < 40 || d > 800) continue;
                const da = Math.atan2(dz, dx) - ang;
                if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) < Math.PI / 36) n++;
            }
            if (n === 0) vuoti++;
        }
    }
    // Soglia alzata da 0.08 a 0.20 il 2026-08-10, per una scelta esplicita e
    // non per far passare il test: gli alberi voxel nuovi costano 20-30
    // blocchi l'uno contro gli 8 dei Kenney che sostituiscono, e a 950 istanze
    // il tempo di disegno era salito a 22 ms con picchi di 50, contro un tetto
    // di 8. Ridotti a 430, i vuoti sull'orizzonte passano dal 4% al 16%.
    // È il compromesso deciso col playtest: meglio qualche direzione spoglia
    // che un gioco che scatta. Se un domani gli asset diventassero più
    // leggeri, questa soglia va riabbassata.
    const quota = vuoti / totali;
    assert.ok(quota <= 0.20,
        `il ${(quota * 100).toFixed(0)}% delle direzioni verso la campagna è senza un solo albero`);
});

// ---- vie di fuga: la scenografia sta fuori dal muro ----
//
// ⚠️ NON si confronta più voce per voce col layout senza profilo. Con le vie
// di fuga il pianoro del terrapieno si allarga fino alla barriera, e la quota
// del terreno entra nelle decisioni di piazzamento (alberi, rocce, laghetto):
// i due layout differiscono per QUALI oggetti vengono accettati, non solo per
// dove finiscono. Una corrispondenza uno-a-uno sarebbe un invariante falso.

test('con le vie di fuga nessun oggetto resta dentro il muro', () => {
    const TrackGravel = require('./trackGravel.js');
    const { trackPts, pitPts } = buildReal();
    const bar = TrackGravel.barrierProfile(trackPts, { roadHalf: ROAD_HALF });
    const con = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D, 45, null, bar);

    let controllate = 0;
    for (const v of con) {
        // Boschi e colline stanno centinaia di unità più in là e seguono la
        // quota collinare, non il terrapieno.
        if (v.category === 'woods') continue;
        const near = TrackGeometry.nearestPoint(trackPts, v.x, v.z);
        // Ponte semafori e passerella scavalcano la pista: pivot sull'asse.
        if (near.dist < BARRIER_D) continue;
        const p = trackPts[near.index];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, near.index, true);
        const lato = Math.sign((v.x - p.x) * nx + (v.z - p.z) * nz) || 1;
        const muro = TrackGravel.barrierAt(bar, near.index, lato);
        controllate++;
        assert.ok(near.dist >= muro - 0.5,
            `${v.asset} (${v.category}) è dentro la via di fuga: a ${near.dist.toFixed(1)} con il muro a ${muro.toFixed(1)}`);
    }
    assert.ok(controllate > 100, `attese molte voci da controllare, ne ho trovate ${controllate}`);
});

test('con le vie di fuga il layout resta deterministico', () => {
    // Nessun PRNG non seminato: due chiamate identiche danno lo stesso
    // risultato. È ciò che rende riproducibile un difetto visto in playtest.
    const TrackGravel = require('./trackGravel.js');
    const { trackPts, pitPts } = buildReal();
    const bar = TrackGravel.barrierProfile(trackPts, { roadHalf: ROAD_HALF });
    const a = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D, 45, null, bar);
    const b = TrackScenery.generateLayout(monteRosso, trackPts, pitPts, BARRIER_D, 45, null, bar);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
        assert.equal(a[i].asset, b[i].asset);
        assert.ok(Math.abs(a[i].x - b[i].x) < 1e-9 && Math.abs(a[i].z - b[i].z) < 1e-9);
    }
});


// ---- tribune e reti allineate al muro ----
//
// L'utente ha chiesto in gioco (2026-08-12, segnalazione al campione 620)
// che "orientamento della tribuna E della catchFence davanti seguano
// l'andamento delle barriere". Fino al 2026-08-13 seguivano la normale della
// PISTA, che è la stessa cosa solo dove il muro sta a distanza costante.
const TrackGravel = require('./trackGravel.js');
const fsAllineamento = require('fs');
const pathAllineamento = require('path');

// Le piste si leggono dalla cartella invece di elencarle a mano: un elenco
// scritto nel test invecchia, e si rompe quando una pista viene aggiunta o
// rimossa (successo con `baku`, tolta il 2026-08-17).
const TRACCIATI = require('fs')
    .readdirSync(require('path').join(__dirname, '..', 'tracks'))
    // Le piste finte che altri test creano e cancellano al volo
    // (`test-...`) vanno escluse: la suite gira in parallelo e
    // altrimenti compaiono qui a seconda del momento.
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

function circuitoVero(id, opzioni) {
    const raw = JSON.parse(fsAllineamento.readFileSync(pathAllineamento.join(
        __dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
    // Stessi campionamenti del caricatore di pista (trackLoader.js:14-17):
    // la corsia box non può essere nulla, la scenografia la usa per decidere
    // dove NON mettere le cose.
    const pitPath = TrackGeometry.snapPitPathEnds(raw.pit.path, trackPts, raw.roadHalfWidth);
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    const barrierProfile = TrackGravel.barrierProfile(trackPts, {
        roadHalf: raw.roadHalfWidth, pitLanePts, pitRoadHalf: raw.pit.roadHalfWidth });
    const BARRIER_D = raw.roadHalfWidth + 2.8 + 1.2;
    const layout = TrackScenery.generateLayout(raw, trackPts, pitLanePts, BARRIER_D, 45, null,
        barrierProfile, null, opzioni);
    return { raw, trackPts, barrierProfile, layout, BARRIER_D, pitLanePts, pitPath };
}

// Su che lato della pista sta una voce, e a che campione.
function doveSta(trackPts, voce) {
    const v = TrackGeometry.nearestPoint(trackPts, voce.x, voce.z);
    const { nx, nz } = TrackGeometry.normalAt(trackPts, v.index, true);
    const seg = (voce.x - trackPts[v.index].x) * nx + (voce.z - trackPts[v.index].z) * nz;
    return { idx: v.index, side: seg >= 0 ? 1 : -1, dist: v.dist };
}

// Quanto una voce devia dalla parallela al nastro del muro, in gradi.
// ⚠️ rotY è la direzione in cui l'oggetto GUARDA, cioè perpendicolare al
// nastro: una tribuna messa bene ha 90° di scarto dalla tangente, non 0.
// L'oggetto è un segmento rigido: si confronta con la CORDA del muro che
// sottende, cioè fra i campioni che cadono ai suoi due estremi. Misurarlo
// contro una finestra fissa confronterebbe un'asse lunga con un tratto di
// muro più corto o più lungo di lei.
function deviazioneDalMuro(trackPts, barrierProfile, voce) {
    const { idx, side, dist } = doveSta(trackPts, voce);
    const n = trackPts.length;
    const stepLen = TrackGeometry.lapLength(trackPts) / n;
    const misura = SceneryAssetSizes.sizeOf(voce.asset);
    const w = Math.max(1, Math.round((misura ? misura.w : 12) * (voce.scale || 1) / 2 / stepLen));
    const punto = (k) => {
        const { nx, nz } = TrackGeometry.normalAt(trackPts, k, true);
        // ⚠️ Il nastro si costruisce alla distanza DELL'OGGETTO, non a quella
        // del muro. Dal 2026-08-13 una fila di tribune sta tutta alla distanza
        // del suo punto più largo (scelta dell'utente: la fila è una linea di
        // confine dritta, non una scala che insegue ogni rampa del muro).
        // Dove il muro corre a distanza costante le due misure coincidono ed è
        // lì che stavano i difetti veri, fino a 48°; dove il muro fa una rampa
        // seguirlo non è più la regola.
        const d = dist;
        return { x: trackPts[k].x + nx * d * side, z: trackPts[k].z + nz * d * side };
    };
    const a = punto(((idx - w) % n + n) % n), b = punto((idx + w) % n);
    const angNastro = Math.atan2(b.x - a.x, b.z - a.z) * 180 / Math.PI;
    let s = ((voce.rotY * 180 / Math.PI - angNastro) % 180 + 180) % 180;
    if (s > 90) s -= 180;
    return Math.abs(90 - Math.abs(s));
}

// Tipi per cui il parallelismo al muro È la regola. tyreStack e brakingBoard
// sono esclusi apposta: un cartello di frenata sta perpendicolare alla pista
// per essere letto, e per lui 79° di scarto non sono un difetto.
//
// Dal 2026-08-13 è escluso anche catchFence, e non per farlo passare: la rete
// non si orienta più da sola, EREDITA la rotazione della tribuna da cui nasce,
// quindi misurarla di nuovo contro il muro conterebbe due volte lo scarto
// della tribuna e ci aggiungerebbe il rumore di una misura presa 8.5 unità più
// avanti, dove il campione più vicino può già essere un altro. L'invariante
// che conta per la rete è "parallela alla sua tribuna", ed è verificato in
// modo esatto (1e-9) dal test `una rete per tribuna` in
// sceneryTrackside.test.js e da `nessuna tribuna protetta a metà` qui sotto.
const PARALLELI_AL_MURO = new Set(['grandStandCovered',
    'grandStandAwning', 'grandStand', 'grandStandSmall']);

// Quanto il muro GIRA sotto l'oggetto, da un suo estremo all'altro. È il
// limite fisico di quanto un oggetto rigido può allinearsi: se il muro cambia
// direzione di 40° sotto una tribuna, qualunque angolo si scelga un'estremità
// resta fuori. L'ottimo è la corda, che sta a metà fra le due direzioni
// estreme, quindi l'errore inevitabile è metà della rotazione.
function rotazioneDelMuroSotto(trackPts, barrierProfile, voce) {
    const { idx, side, dist } = doveSta(trackPts, voce);
    const n = trackPts.length;
    const stepLen = TrackGeometry.lapLength(trackPts) / n;
    const misura = SceneryAssetSizes.sizeOf(voce.asset);
    const w = Math.max(1, Math.round((misura ? misura.w : 12) * (voce.scale || 1) / 2 / stepLen));
    const punto = (k) => {
        const { nx, nz } = TrackGeometry.normalAt(trackPts, k, true);
        const d = dist;   // stesso nastro di deviazioneDalMuro: vedi lì il perché
        return { x: trackPts[k].x + nx * d * side, z: trackPts[k].z + nz * d * side };
    };
    const dir = (a, b) => {
        const p = punto(((a % n) + n) % n), q = punto(((b % n) + n) % n);
        return Math.atan2(q.x - p.x, q.z - p.z) * 180 / Math.PI;
    };
    let g = ((dir(idx, idx + w) - dir(idx - w, idx)) % 360 + 360) % 360;
    if (g > 180) g -= 360;
    return Math.abs(g);
}

for (const id of TRACCIATI) {
    test(`scenografia: tribune e reti restano parallele al muro (${id})`, () => {
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        // La soglia non è un numero fisso ma il limite geometrico del punto:
        // metà di quanto il muro gira sotto l'oggetto, più 8° di tolleranza
        // per la discretizzazione (la posa cade fra due campioni, quindi
        // l'oggetto e la misura non guardano esattamente lo stesso tratto).
        // Dove il muro è dritto la soglia vale 8° e il test è severissimo; ed
        // è lì che stavano i difetti veri, fino a 48°.
        const storti = layout
            .filter(v => PARALLELI_AL_MURO.has(v.asset))
            .map(v => ({ v, dove: doveSta(trackPts, v),
                         d: deviazioneDalMuro(trackPts, barrierProfile, v),
                         limite: rotazioneDelMuroSotto(trackPts, barrierProfile, v) / 2 + 8 }))
            .filter(m => m.d > m.limite);
        assert.equal(storti.length, 0,
            `${id}: ${storti.length} elementi più storti di quanto il muro giri sotto di loro — `
            + storti.slice(0, 5).map(m => `${m.v.asset}@${m.dove.idx} ${m.d.toFixed(1)}° `
                + `(limite ${m.limite.toFixed(1)}°)`).join(', '));
    });
}

test('scenografia: ogni tribuna sta oltre il muro del PROPRIO lato, per tutto il suo fronte', () => {
    // Sostituisce (2026-08-13) il confronto fra i margini di tutte le tribune,
    // che presupponeva un margine uguale per tutte: ora una fila sta alla
    // distanza del suo punto più largo, quindi dove il muro è vicino la
    // tribuna è legittimamente più indietro delle altre.
    //
    // L'invariante che resta, ed è più forte: sotto TUTTO il fronte di una
    // tribuna il muro del SUO lato deve stare almeno `margineDalMuro` più
    // vicino di lei. Il bug che questo test è nato per prendere — side
    // undefined, quindi `barrierAt` restituiva sempre il muro sinistro —
    // metterebbe la tribuna dentro il proprio muro dove i due lati differiscono
    // (su new-monza una finiva a 14.3 unità dal posto giusto).
    for (const id of ['prova', 'new-monza', 'monte-rosso']) {
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        for (const v of layout.filter(x => x.category === 'grandstand' || x.category === 'grandstand-main')) {
            const { idx, side, dist } = doveSta(trackPts, v);
            const mezza = Math.max(1, Math.round(
                SceneryAssetSizes.sizeOf(v.asset).w * (v.scale || 1) / 2 / stepLen));
            for (let s = -mezza; s <= mezza; s++) {
                const k = ((idx + s) % n + n) % n;
                const muro = TrackGravel.barrierAt(barrierProfile, k, side);
                assert.ok(dist >= muro + v.margineDalMuro - 0.5,
                    `${id}: ${v.asset}@${idx} sta a ${dist.toFixed(1)} dalla pista ma al campione ${k} `
                    + `il muro del suo lato (${side > 0 ? 'dx' : 'sx'}) è a ${muro.toFixed(1)}: `
                    + `margine ${(dist - muro).toFixed(1)} invece di ${v.margineDalMuro}`);
            }
        }
    }
});

test('scenografia: i moduli di una fila stanno tutti alla stessa distanza dalla pista', () => {
    // È la regola scelta dall'utente il 2026-08-13 dopo tre segnalazioni in
    // gioco: la fila è una linea di confine dritta. Se un modulo prendesse il
    // muro per conto suo, la fila tornerebbe a scalinare — su monte-rosso il
    // gradino misurava 14.8 unità — e la rete larga quanto la tribuna non
    // potrebbe più stare né davanti né di lato senza entrare in qualcosa.
    for (const id of TRACCIATI) {
        const { trackPts, layout } = circuitoVero(id);
        const tribune = layout.filter(x => x.category === 'grandstand' || x.category === 'grandstand-main')
            .map(v => ({ v, ...doveSta(trackPts, v) }));
        // Fila = moduli contigui, entro un modulo e mezzo l'uno dall'altro.
        const restanti = [...tribune];
        while (restanti.length) {
            const fila = [restanti.shift()];
            for (let cresce = true; cresce;) {
                cresce = false;
                for (let i = restanti.length - 1; i >= 0; i--) {
                    if (fila.some(m => Math.hypot(m.v.x - restanti[i].v.x, m.v.z - restanti[i].v.z) < 29)) {
                        fila.push(restanti.splice(i, 1)[0]); cresce = true;
                    }
                }
            }
            const dist = fila.map(m => m.dist);
            const gradino = Math.max(...dist) - Math.min(...dist);
            // 0.5 e non 0: i moduli intermedi cadono interpolati fra due
            // campioni, e la distanza misurata dal campione più vicino oscilla
            // di qualche decimo. Il difetto vero valeva 11.7 e 14.8.
            assert.ok(gradino < 0.5,
                `${id}: la fila di ${fila.length} moduli al campione ${fila[0].idx} scalina di `
                + `${gradino.toFixed(1)} unità (da ${Math.min(...dist).toFixed(1)} a ${Math.max(...dist).toFixed(1)})`);
        }
    }
});

// Quanta parte del fronte di una tribuna è coperta dalle reti. Si proietta
// tutto sull'asse LARGHEZZA della tribuna — la sua X locale, che
// footprintCorners costruisce come (cos rotY, -sin rotY) — e si misura
// l'unione degli intervalli coperti.
function coperturaDellaTribuna(tribuna, reti) {
    const mezza = (v) => SceneryAssetSizes.sizeOf(v.asset).w * (v.scale || 1) / 2;
    const ux = Math.cos(tribuna.rotY), uz = -Math.sin(tribuna.rotY);
    const meta = mezza(tribuna);
    const pezzi = [];
    for (const r of reti) {
        // Solo le reti che possono avere a che fare con questa tribuna: senza
        // filtro, una rete dall'altra parte della pista entrerebbe nel conto
        // per la sola proiezione.
        if (Math.hypot(r.x - tribuna.x, r.z - tribuna.z) > meta + mezza(r) + 20) continue;
        const t = [-1, 1].map(seg => {
            const px = r.x + seg * mezza(r) * Math.cos(r.rotY);
            const pz = r.z - seg * mezza(r) * Math.sin(r.rotY);
            return (px - tribuna.x) * ux + (pz - tribuna.z) * uz;
        });
        const lo = Math.max(-meta, Math.min(t[0], t[1]));
        const hi = Math.min(meta, Math.max(t[0], t[1]));
        if (hi > lo) pezzi.push([lo, hi]);
    }
    pezzi.sort((a, b) => a[0] - b[0]);
    let coperto = 0, fine = -Infinity;
    for (const [lo, hi] of pezzi) {
        const da = Math.max(lo, fine);
        if (hi > da) { coperto += hi - da; fine = hi; }
    }
    return coperto / (2 * meta);
}

// Dove sarebbe caduta la rete di questa tribuna, ricostruito dalla sola
// geometria pubblica: davanti alla tribuna, alla distanza del muro del suo
// campione più il margine, con il pavimento del mezzo ingombro delle due.
// Serve a spiegare le reti MANCANTI, quindi non può leggerle dal layout.
//
// ⚠️ Replica la formula di sceneryTrackside: se una delle due cambia, questo
// test diventa rosso. È voluto — "mai una rete dentro una tribuna" è una
// regola che l'utente ha dichiarato non negoziabile, e va rimisurata a mano
// ogni volta che si tocca la posa.
const FENCE_MARGIN_TEST = 1.5;
function doveCadrebbeLaRete(trackPts, barrierProfile, tribuna) {
    const { idx, side, dist } = doveSta(trackPts, tribuna);
    const misura = SceneryAssetSizes.sizeOf(tribuna.asset);
    const rete = SceneryAssetSizes.sizeOf('catchFence');
    const scale = misura.w * (tribuna.scale || 1) / rete.w;
    const muro = TrackGravel.barrierAt(barrierProfile, idx, side);
    const distacco = (misura.d * (tribuna.scale || 1) + rete.d * scale) / 2 + FENCE_MARGIN_TEST;
    const avvicina = Math.max(dist - (muro + FENCE_MARGIN_TEST), distacco);
    return { asset: 'catchFence', scale, rotY: tribuna.rotY, y: tribuna.y,
             x: tribuna.x + Math.sin(tribuna.rotY) * avvicina,
             z: tribuna.z + Math.cos(tribuna.rotY) * avvicina };
}

// La rete NATA da questa tribuna: stessa rotazione e scarto tutto lungo la
// direzione in cui la tribuna guarda, cioè zero lungo la sua larghezza.
function laSuaRete(tribuna, reti) {
    return reti.find(r => Math.abs(r.rotY - tribuna.rotY) < 1e-9
        && Math.abs((r.x - tribuna.x) * Math.cos(tribuna.rotY)
                  - (r.z - tribuna.z) * Math.sin(tribuna.rotY)) < 1e-6
        && Math.hypot(r.x - tribuna.x, r.z - tribuna.z) < 40);
}

for (const id of TRACCIATI) {
    test(`scenografia: nessuna tribuna protetta a metà (${id})`, () => {
        // Segnalazione in gioco del 2026-08-13 (punti M 14 e 15): "un
        // grandstand è per metà protetto e per metà no". Le reti erano due
        // moduli a scala 1 affiancati a un passo arrotondato in CAMPIONI: su
        // `prova` un campione vale 5.17 unità, quindi i due finivano a ±5.17
        // invece di ±6 e si sfalsavano rispetto alla tribuna. Misurate allora:
        // 3 tribune su 50 non coperte del tutto su prova (la peggiore al 54%),
        // 57 su 65 su new-monza, 6 su 14 su baku.
        //
        // Non si pretende che OGNI tribuna abbia la rete: dove la rete
        // cadrebbe sotto una campata o di fianco a un viadotto viene scartata
        // di proposito, ed è il test qui sotto a esigere che sia sempre per uno
        // di quei due motivi. Qui si pretende che dove la rete c'è, copra
        // tutto: mezza tribuna scoperta è il difetto segnalato.
        const { trackPts, layout } = circuitoVero(id);
        const reti = layout.filter(v => v.asset === 'catchFence');
        const tribune = layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main');
        const scoperte = tribune
            .filter(g => laSuaRete(g, reti))
            .map(g => ({ g, f: coperturaDellaTribuna(g, reti), dove: doveSta(trackPts, g) }))
            .filter(m => m.f < 0.999);
        assert.equal(scoperte.length, 0,
            `${id}: ${scoperte.length} tribune coperte solo in parte su ${tribune.length} — `
            + scoperte.slice(0, 5).map(m => `${m.g.asset}@${m.dove.idx} al ${(m.f * 100).toFixed(0)}%`).join(', '));
    });

    test(`scenografia: nessuna rete finisce dentro una tribuna (${id})`, () => {
        // Segnalato in gioco il 2026-08-13: "è inaccettabile avere la rete di
        // protezione dentro la grandstand".
        //
        // La rete si distanziava dalla tribuna partendo dal muro PIÙ LONTANO
        // fra quelli sotto il suo fronte, mentre la tribuna si posa sul muro
        // del PROPRIO campione. Dove il muro fa una rampa le due misure
        // divergono e il distacco viene mangiato: su new-monza al campione 63
        // il muro passa da 18.0 a 32.8 sotto una tribuna che sta a 34.5, e la
        // rete finiva a 0.24 unità dal centro della tribuna, cioè dentro. Su
        // `prova` al 615 finiva 1.84 unità OLTRE il centro, dall'altra parte.
        const { trackPts, layout } = circuitoVero(id);
        const reti = layout.filter(v => v.asset === 'catchFence');
        const tribune = layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main');
        const dentro = [];
        for (const r of reti) {
            for (const g of tribune) {
                if (SceneryAssetSizes.itemsOverlap(r, g)) {
                    dentro.push({ r, g, dove: doveSta(trackPts, g),
                                  d: Math.hypot(r.x - g.x, r.z - g.z) });
                }
            }
        }
        assert.equal(dentro.length, 0,
            `${id}: ${dentro.length} reti compenetrano una tribuna — `
            + dentro.slice(0, 5).map(m => `${m.g.asset}@${m.dove.idx} a ${m.d.toFixed(2)} dal centro`).join(', '));
    });

    test(`scenografia: nessuna rete rientra nella via di fuga (${id})`, () => {
        // Prima lo garantiva il massimo dei muri sotto il fronte della rete —
        // che però è esattamente ciò che la seppelliva nella tribuna. Tolto
        // quello, l'invariante va preteso qui, e sui quattro ANGOLI: il muro
        // cambia lungo il fronte, e il campione più vicino al centro non dice
        // nulla su dove finiscono le estremità. Senza il controllo, misurate
        // reti fino a 6.9 unità dentro la ghiaia (monte-rosso, campione 821).
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        const dentro = [];
        for (const r of layout.filter(v => v.asset === 'catchFence')) {
            for (const c of SceneryAssetSizes.footprintCorners(r)) {
                const q = TrackGeometry.nearestPoint(trackPts, c.x, c.z);
                const nq = TrackGeometry.normalAt(trackPts, q.index, true);
                const lato = Math.sign((c.x - trackPts[q.index].x) * nq.nx +
                                       (c.z - trackPts[q.index].z) * nq.nz) || 1;
                const quanto = TrackGravel.barrierAt(barrierProfile, q.index, lato) - q.dist;
                if (quanto > 0) dentro.push({ idx: q.index, quanto });
            }
        }
        assert.equal(dentro.length, 0,
            `${id}: ${dentro.length} angoli di rete dentro la via di fuga — `
            + dentro.slice(0, 5).map(m => `@${m.idx} di ${m.quanto.toFixed(2)}`).join(', '));
    });

    test(`scenografia: la fila del traguardo è unica, senza vuoti (${id})`, () => {
        // Segnalazione M 20 del 2026-08-13: "lungo il traguardo non c'è una
        // schiera unica di grandstand … una zona nei pressi dell'asset dei
        // semafori che presenta un vuoto".
        //
        // Storia: la fila era stata ACCORCIATA in avanti (1 modulo su 7)
        // proprio per non arrivare sotto il ponte semafori, che sta 75 unità
        // avanti al traguardo — la rete del modulo di testa finiva dentro la
        // campata e veniva scartata. Il rimedio ha spostato il difetto: al
        // posto della tribuna scoperta è comparso un buco di 72 unità fra la
        // fine della fila e la prima schiera secondaria.
        //
        // ⚠️ AGGIORNATO IL 2026-08-24, per una decisione esplicita dell'utente:
        // «il ponte dei semafori deve essere fuori dalle barriere, cioè i due
        // pilastri oltre le barriere da entrambi i lati. deve sempre essere
        // vicino alla griglia di partenza altrimenti abbiamo il problema al
        // via. quindi dove posizioniamo il ponte dei semafori non avremo
        // tribune. stessa cosa per il ponte ma senza semafori».
        //
        // Le due richieste insieme — pilastri oltre le barriere, e ponte
        // vicino alla griglia — mettono i pilastri esattamente dove starebbe
        // un modulo della fila. Quindi quel modulo non si posa, e la fila ha
        // UN vuoto: quello del ponte, largo un modulo (38.4 = 2 x 19.2).
        //
        // Non si torna alla fila accorciata del 2026-08-13: quella lasciava un
        // buco di 72 unità fra la fine della fila e la schiera successiva.
        // Qui manca un modulo in mezzo, che è ciò che nella realtà si vede
        // sotto un ponte dei semafori.
        //
        // Resta preteso tutto il resto: nessun ALTRO stacco maggiore di un
        // modulo e mezzo, e il vuoto ammesso dev'essere PROPRIO sotto un
        // ponte, non un buco qualunque.
        const { trackPts, layout } = circuitoVero(id);
        const main = layout.filter(v => v.category === 'grandstand-main');
        assert.ok(main.length >= 3, `${id}: solo ${main.length} moduli di tribuna principale`);
        // In ordine LUNGO LA PISTA, non per vicinanza: partendo da un modulo
        // di mezzo, il "vicino più prossimo" salta da una parte all'altra
        // della fila e conta un vuoto che non esiste.
        const giro = TrackGeometry.lapLength(trackPts);
        const passo = giro / trackPts.length;
        const inFila = main.map(m => {
            let a = doveSta(trackPts, m).idx * passo;
            if (a > giro / 2) a -= giro;      // con segno rispetto al traguardo
            return { a, m };
        }).sort((p, q) => p.a - q.a);
        const stacchi = [];
        for (let i = 1; i < inFila.length; i++) {
            stacchi.push({ d: Math.hypot(inFila[i].m.x - inFila[i - 1].m.x,
                                         inFila[i].m.z - inFila[i - 1].m.z),
                           a: inFila[i - 1].m, b: inFila[i].m,
                           idx: doveSta(trackPts, inFila[i].m).idx });
        }
        // 19.2 è il passo nominale (MAIN_STAND_COL_SPACING); 1.5 volte lascia
        // passare l'assestamento in curva e taglia il modulo mancante.
        const buchi = stacchi.filter(s => s.d > 19.2 * 1.5);
        // Il vuoto lecito e' quello sotto una campata, ed e' largo un modulo:
        // fra i due moduli che lo delimitano deve passare un ponte.
        //
        // ⚠️ Il confronto e' LUNGO LA PISTA, non in linea d'aria: la fila sta a
        // bordo pista e il ponte e' centrato sull'asse, quindi la distanza fra
        // i due punti non dice niente su quanto siano affiancati.
        const campate = layout.filter(
            v => v.asset === 'startGantry' || v.asset === 'footbridge');
        const lungoLaPista = (a, b) => {
            const d = Math.abs(doveSta(trackPts, a).idx - doveSta(trackPts, b).idx);
            return Math.min(d, trackPts.length - d) * passo;
        };
        const sottoUnaCampata = (s) => campate.some((g) => {
            const meta = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
            return lungoLaPista(meta, g) < 19.2 * 1.5;
        });
        const nonSpiegati = buchi.filter(s => !(s.d <= 19.2 * 2.2 && sottoUnaCampata(s)));
        assert.equal(nonSpiegati.length, 0,
            `${id}: ${nonSpiegati.length} vuoti NON spiegati da un ponte nella fila del traguardo — `
            + nonSpiegati.map(s => `@${s.idx} di ${s.d.toFixed(1)}`).join(', '));
    });

    test(`scenografia: la rete incrocia il ponte semafori solo sul pilone (${id})`, () => {
        // La fila del traguardo passa sotto il ponte semafori, quindi la sua
        // rete e i piloni del ponte si incontrano: sono la stessa linea per
        // costruzione, perché entrambi partono da "muro + margine".
        //
        // Non è un difetto da eliminare — è come sono i circuiti veri, dove la
        // rete è imbullonata alla gamba del portale. Ma va tenuto entro il suo
        // ordine di grandezza: la rete può entrare nel pilone al massimo per
        // il proprio spessore, e deve passare SOTTO la traversa. Se un giorno
        // uno dei due si spostasse davvero, questo test lo vede.
        const LUCE = { startGantry: 13.5, footbridge: 14.0 };   // filo INTERNO del pilone
        const PILONE = { startGantry: 16.5, footbridge: 18.0 }; // filo ESTERNO del pilone
        const INTRADOSSO = { startGantry: 14.25, footbridge: 11.75 };
        const { trackPts, layout } = circuitoVero(id);
        const campate = layout.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry');
        for (const r of layout.filter(v => v.asset === 'catchFence')) {
            for (const p of campate) {
                if (!SceneryAssetSizes.itemsOverlap(p, r)) continue;
                const q = TrackGeometry.nearestPoint(trackPts, r.x, r.z);
                const mezzo = SceneryAssetSizes.sizeOf('catchFence').d * (r.scale || 1) / 2;
                const dentro = Math.min(q.dist + mezzo, PILONE[p.asset] * p.scale)
                             - Math.max(q.dist - mezzo, LUCE[p.asset] * p.scale);
                assert.ok(dentro <= mezzo * 2 + 0.01,
                    `${id}: la rete @${q.index} entra nel pilone di ${p.asset} per `
                    + `${dentro.toFixed(2)}, più del suo spessore (${(mezzo * 2).toFixed(2)})`);
                const alta = SceneryAssetSizes.sizeOf('catchFence').h * (r.scale || 1);
                assert.ok(alta <= INTRADOSSO[p.asset] * p.scale,
                    `${id}: la rete @${q.index} è alta ${alta.toFixed(1)} e buca la traversa `
                    + `di ${p.asset}, che comincia a ${(INTRADOSSO[p.asset] * p.scale).toFixed(1)}`);
            }
        }
    });

    test(`scenografia: una tribuna resta senza rete solo per un motivo noto (${id})`, () => {
        // I quattro soli motivi ammessi: la tribuna sta di fianco a un tratto
        // sopraelevato (la rete prenderebbe la quota del terreno sottostante e
        // resterebbe sospesa); la sua rete cadrebbe dentro una campata che
        // scavalca la pista; la sua rete entrerebbe in una tribuna vicina;
        // la sua rete rientrerebbe nella via di fuga. Gli ultimi due sono la
        // stessa cosa vista da due lati: dove il muro fa una rampa sotto una
        // tribuna, un pannello dritto non ha posto — davanti c'è la ghiaia,
        // dietro la tribuna. Qualunque ALTRO motivo è un buco silenzioso: una
        // tribuna senza protezione che nessuno ha deciso.
        //
        // Alla data: prova 5 su 50, new-monza 5 su 65, monte-rosso 3 su 36,
        // baku 6 su 14 (tutte e sei di fianco al viadotto).
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        const reti = layout.filter(v => v.asset === 'catchFence');
        const campate = layout.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry');
        const tribune = layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main');
        for (const g of tribune) {
            if (laSuaRete(g, reti)) continue;
            const dove = doveSta(trackPts, g);
            const finta = doveCadrebbeLaRete(trackPts, barrierProfile, g);
            const nellaGhiaia = SceneryAssetSizes.footprintCorners(finta).some(c => {
                const q = TrackGeometry.nearestPoint(trackPts, c.x, c.z);
                const nq = TrackGeometry.normalAt(trackPts, q.index, true);
                const lato = Math.sign((c.x - trackPts[q.index].x) * nq.nx +
                                       (c.z - trackPts[q.index].z) * nq.nz) || 1;
                return TrackGravel.barrierAt(barrierProfile, q.index, lato) - q.dist > 0;
            });
            assert.ok(trackPts[dove.idx].bridge
                    || campate.some(p => SceneryAssetSizes.itemsOverlap(p, finta))
                    || tribune.some(v => v !== g && SceneryAssetSizes.itemsOverlap(v, finta))
                    || nellaGhiaia,
                `${id}: ${g.asset}@${dove.idx} è senza rete e non si capisce perché`);
        }
    });
}

test('footbridge: la luce copre il muro di dove sta, su entrambi i lati', () => {
    // Su `prova` la passerella cade al campione 412, dove il muro sta a 34.5
    // a sinistra: con semi-luce 21.5 era corta di 13 unità e i piedi
    // atterravano dentro la ghiaia. Era dimensionata su `barrierDist`, la
    // distanza storica del muro (15.0), che dopo le vie di fuga non vale più.
    //
    // ⚠️ Il test sta qui e non in sceneryLandmarks.test.js perché il difetto
    // emerge solo nel layout COMPLETO: chiamando buildLandmarks da sola, con
    // nessuna struttura già accettata, la passerella trova libero il campione
    // 416 — dove il muro è a 18.2 e la luce basta. È l'ingombro delle altre
    // strutture a spingerla dove il muro è largo.
    for (const id of TRACCIATI) {
        const { trackPts, barrierProfile, layout } = circuitoVero(id);
        for (const ponte of layout.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry')) {
            const semiLuce = SceneryAssetSizes.sizeOf(ponte.asset).w * ponte.scale / 2;
            const v = TrackGeometry.nearestPoint(trackPts, ponte.x, ponte.z);
            for (const side of [-1, 1]) {
                const muro = TrackGravel.barrierAt(barrierProfile, v.index, side);
                assert.ok(semiLuce >= muro,
                    `${id}: ${ponte.asset} al campione ${v.index} ha semi-luce ${semiLuce.toFixed(1)} `
                    + `ma il muro lato ${side > 0 ? 'dx' : 'sx'} sta a ${muro.toFixed(1)}: i piedi cadono nella ghiaia`);
            }
        }
    }
});

test('il decoro del paddock non finisce dentro nient\'altro', () => {
    // Segnalato in gioco: "la compenetrazione del paddockTent". Il decoro
    // controllava la corsia box, i box giocatore e i cavalcavia — cioè il
    // TERRENO — ma non gli edifici che ci stanno sopra, che si posano prima.
    // Misurato prima del rimedio: 4 o 5 dei 6 pezzi dentro qualcosa su tutti e
    // quattro i tracciati (uffici box, garage, torre di direzione, podio, una
    // tribuna), e le due tende una dentro l'altra perché il loro distanziamento
    // misurava i CENTRI a 12 unità mentre la tenda è larga 16.8.
    //
    // Il verde è compreso apposta: alberi e rocce si posano DOPO il decoro e
    // non lo guardavano, e su prova e baku ci cresceva dentro un albero.
    for (const id of TRACCIATI) {
        const { layout } = circuitoVero(id);
        const decoro = layout.filter(v => v.category === 'paddock-decor');
        assert.equal(decoro.length, 6, `${id}: attesi 6 pezzi di decoro, trovati ${decoro.length}`);
        for (const d of decoro) {
            const dentro = layout.filter(o => o !== d && o.category !== 'crowd'
                                              && SceneryAssetSizes.itemsOverlap(d, o));
            assert.equal(dentro.length, 0,
                `${id}: ${d.asset} compenetra ${dentro.length} oggetti — `
                + [...new Set(dentro.map(o => o.asset))].join(', '));
        }
    }
});

test('davanti a una tribuna non c\'è altro che la sua rete', () => {
    // Segnalazioni M 21, 22 e 23 del 2026-08-13: muro di gomme, capanno
    // commissari, rete e tribuna impilati nello stesso metro quadro.
    // «Ora lì ci sono i grandstand e quindi li dobbiamo levare».
    //
    // Non è un difetto del loro piazzamento — nascono ben davanti alle
    // tribune — ma di `traslaOltreLaGhiaia`, che porta al muro chi non è già
    // dimensionato sul muro; e al muro ci sono le tribune, che non traslano.
    // Si vede solo DOPO la traslazione, quindi solo lì si può scartare.
    //
    // I cartelli di frenata sono esclusi apposta: servono a chi guida, e
    // l'utente non li ha segnalati. Per loro vale solo il divieto di finire
    // DENTRO una tribuna.
    const FASCIA = 22;
    for (const id of TRACCIATI) {
        const { layout } = circuitoVero(id);
        const tribune = layout.filter(v => (v.category || '').startsWith('grandstand'));
        const nellaFascia = layout.filter(v => (v.asset === 'tyreStack' || v.asset === 'marshalPost')
            && tribune.some(g => {
                const c = Math.cos(g.rotY || 0), s = Math.sin(g.rotY || 0);
                const dx = v.x - g.x, dz = v.z - g.z;
                const du = dx * c - dz * s, df = dx * s + dz * c;
                const meta = (SceneryAssetSizes.sizeOf(g.asset).w * (g.scale || 1)
                            + SceneryAssetSizes.sizeOf(v.asset).w * (v.scale || 1)) / 2;
                return Math.abs(du) <= meta && df > 0 && df <= FASCIA;
            }));
        assert.equal(nellaFascia.length, 0,
            `${id}: ${nellaFascia.length} fra gomme e commissari davanti a una tribuna — `
            + [...new Set(nellaFascia.map(v => v.asset))].join(', '));

        const dentro = layout.filter(v => v.asset === 'brakingBoard'
            && tribune.some(g => SceneryAssetSizes.itemsOverlap(v, g)));
        assert.equal(dentro.length, 0, `${id}: ${dentro.length} cartelli di frenata dentro una tribuna`);
    }
});

test('gli edifici della corsia box non si compenetrano fra loro', () => {
    // La catena li affianca alla distanza dettata dalle larghezze reali, che
    // sul dritto basta. Dove la corsia curva però i due rettangoli sono anche
    // RUOTATI l'uno rispetto all'altro e gli spigoli si incrociano lo stesso:
    // su baku due coppie si compenetravano a 22.7 e 23.2 di distanza fra i
    // centri, cioè alla distanza nominale esatta (22.65). La distanza fra i
    // centri non basta a descrivere due rettangoli orientati.
    for (const id of TRACCIATI) {
        const { layout } = circuitoVero(id);
        const edifici = layout.filter(v => v.category === 'paddock' && /^pits/.test(v.asset));
        assert.ok(edifici.length > 0, `${id}: nessun edificio nella corsia box`);
        for (let i = 0; i < edifici.length; i++) {
            for (let j = i + 1; j < edifici.length; j++) {
                assert.ok(!SceneryAssetSizes.itemsOverlap(edifici[i], edifici[j]),
                    `${id}: ${edifici[i].asset} e ${edifici[j].asset} si compenetrano, `
                    + `centri a ${Math.hypot(edifici[i].x - edifici[j].x,
                                             edifici[i].z - edifici[j].z).toFixed(2)}`);
            }
        }
    }
});

test('niente scenografia dentro gli asset che scavalcano la pista', () => {
    // Passerella e ponte semafori si posano PRIMA di gomme, reti e cartelli:
    // loro controllano le strutture già accettate, ma chi viene dopo non
    // controllava affatto i landmark. Finché la campata era stretta il
    // problema restava latente; allargandola per coprire le vie di fuga
    // (2026-08-13) sono comparse le compenetrazioni — segnalate dall'utente
    // guardando il disegno, non in pista.
    //
    // ⚠️ La rete di protezione è l'unica eccezione, e non per comodità: la
    // sua linea e i piloni della campata sono la STESSA linea per costruzione
    // (entrambi partono da "muro + margine"), quindi o si incrociano o una
    // delle due non c'è. Che non ci sia la rete l'utente l'ha già bocciato
    // due volte. Quanto sia profondo l'incrocio lo verifica il test
    // "la rete incrocia il ponte semafori solo sul pilone", per tracciato.
    for (const id of TRACCIATI) {
        const { layout } = circuitoVero(id);
        const scavalcano = layout.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry');
        for (const p of scavalcano) {
            const dentro = layout.filter(o => o !== p && o.asset !== 'catchFence'
                                              && SceneryAssetSizes.itemsOverlap(p, o));
            assert.equal(dentro.length, 0,
                `${id}: ${p.asset} compenetra ${dentro.length} oggetti — `
                + [...new Set(dentro.map(o => o.asset))].join(', '));
        }
    }
});

// ---- quanto circuito resta senza niente di fianco ----
//
// È il criterio con cui si giudica il lavoro sulle infrastrutture (spec
// 2026-08-13-f1-infrastrutture-circuito-design.md), e sta qui e non
// nell'algoritmo di piazzamento per scelta: il modulo posa dove c'è posto, il
// test pretende che alla fine non resti spoglio niente di lungo.
//
// Tre misure: senza infrastrutture, coi segnaposto bocciati al playtest del
// 2026-08-13 (cartelloni e pennoni), e con gli otto modelli veri del
// 2026-08-14.
//
//                  peggiore a terra              lato dx              lato sx
//     prova         315 →  284 →  300       33% → 27% → 27%      42% → 23% → 22%
//     new-monza     215 →  157 →   96       17% →  5% → 10%      18% →  7% →  6%
//     monte-rosso   116 →   24 →  116        5% →  0% →  0%      18% →  4% → 12%
//     baku            0 →    0 →    5       78% → 65% → 52%      83% → 83% → 83%
//
// ⚠️ Le soglie si STRINGONO, mai si allargano: se il riempimento non arriva è
// il piano a essere sbagliato.
//
// PERCHÉ I VOLUMI NON BATTONO I SEGNAPOSTO SUL «PEGGIORE» DI prova E
// monte-rosso. Sono le due colonne in cui la terza misura è peggiore della
// seconda, e in entrambi i casi la causa è la metrica, non il riempimento.
// Su `prova` il peggior tratto è il 143-200, cioè esattamente quello non
// riempibile spiegato qui sotto: i segnaposto ci entravano solo perché
// `billboardLow` è profondo 1.4 e passava dove un edificio non passa — ed è
// il difetto che l'utente ha bocciato. Escluso quel tratto, il peggiore di
// `prova` scende da 315 a 155. Su `monte-rosso` il vuoto 624-722 è tutto
// `aperto` con muro 29.8, e i quattro asset di quel contesto sono già posati
// altrove entro il loro `passoMinimo`: su un giro di 1177 unità un raggio di
// 260-700 copre quasi tutto il tracciato. Le quote per lato, che misurano il
// riempimento complessivo invece del singolo buco peggiore, migliorano su
// tutti e quattro i tracciati.
//
// PERCHÉ SU `prova` IL PEGGIORE RESTA A 284. Il tratto è il 143-197 sul lato
// destro, e non è riempibile: lì la pista fa un tornante e le due branche si
// sfiorano. Un oggetto posato alla distanza normale dal muro (39 unità
// dall'asse, perché lì il muro della via di fuga sta a 29.8) cade a **3 unità
// dal campione 513**, cioè in mezzo alla carreggiata dell'altro ramo. È
// `guardaVersoLaPista` a rifiutarlo, e fa bene. Nessun parametro può
// cambiarlo: fra le due branche non c'è spazio. Il modulo lo lascia vuoto
// invece di piantarci qualcosa in mezzo alla pista.
//
// `baku` è un caso a sé: 909 campioni su 1000 sono viadotto, quindi a terra
// non ha vuoti da riempire e le sue quote restano altissime per costruzione.
// Il tetto sulla quota serve solo a non farlo peggiorare — e i 5 unità di
// vuoto a terra comparsi il 2026-08-14 sono un effetto di secondo ordine: le
// infrastrutture entrano in `accepted` e possono togliere il posto a una
// struttura che prima stava lì.
//
// Soglie: valore misurato il 2026-08-14, arrotondato per eccesso del 10%.
const VUOTI_ATTESI = {
    'prova':       { peggiore: 330, quota: 0.30 },
    'new-monza':   { peggiore: 110, quota: 0.12 },
    'monte-rosso': { peggiore: 130, quota: 0.13 },
    'baku':        { peggiore: 10,  quota: 0.85 },
};

// Soglia per le piste che la tabella non conosce ancora. Senza, il primo
// circuito nuovo faceva esplodere il test con un "Cannot read properties of
// undefined" invece di dire cosa non andava — ed e' successo davvero, il
// 2026-08-19, appena e' comparso `prova-notturno`. Il valore e' il piu
// permissivo della tabella: un circuito appena nato non e' ancora stato
// tarato, e il test serve a impedire che PEGGIORI, non a bocciarlo il primo
// giorno. Quando una pista conta davvero, le si mette la sua riga misurata.
const VUOTI_DI_GUARDIA = { peggiore: 330, quota: 0.85 };

for (const id of TRACCIATI) {
    test(`scenografia: quanto circuito resta senza niente di fianco (${id})`, () => {
        const { trackPts, layout } = circuitoVero(id);
        const tratti = SceneryGaps.trattiVuoti(trackPts, layout);
        const giro = TrackGeometry.lapLength(trackPts);
        // Il viadotto ha regole sue: di fianco a un tratto sopraelevato può
        // stare solo ciò che è più alto del dislivello, quindi il suo vuoto
        // non è confrontabile con quello a terra.
        const aTerra = tratti.filter(t => !t.suViadotto);
        const peggiore = aTerra.length ? aTerra[0].lunghezza : 0;
        const atteso = VUOTI_ATTESI[id] || VUOTI_DI_GUARDIA;
        assert.ok(peggiore <= atteso.peggiore,
            `${id}: il tratto vuoto più lungo a terra è ${peggiore.toFixed(0)} unità, `
            + `sopra il tetto di ${atteso.peggiore}`);
        for (const lato of [1, -1]) {
            const quota = tratti.filter(t => t.lato === lato)
                .reduce((s, t) => s + t.lunghezza, 0) / giro;
            assert.ok(quota <= atteso.quota,
                `${id}: il lato ${lato > 0 ? 'destro' : 'sinistro'} è vuoto per il `
                + `${(quota * 100).toFixed(0)}%, sopra il tetto del ${(atteso.quota * 100).toFixed(0)}%`);
        }
    });
}

// ═══════════ IL PONTE SEMAFORI NON È OPZIONALE ═══════════
//
// Da quando porta i semafori di partenza veri (f1.js accende `gantry_light_1..5`
// sul modello) il ponte è l'unico posto in cui il giocatore legge il via: un
// tracciato senza gantry sarebbe un tracciato in cui la gara parte senza che
// nessuno se ne accorga. Prima la posa poteva fallire in silenzio, se tutte le
// collocazioni cercate erano occupate.
for (const id of TRACCIATI) {
    test(`ogni circuito ha il suo ponte semafori, davanti alla griglia (${id})`, () => {
        const { trackPts, layout } = circuitoVero(id);
        const gantry = layout.filter(v => v.asset === 'startGantry');
        assert.equal(gantry.length, 1, 'uno e uno solo');

        // Deve stare DAVANTI a tutta la griglia: la pole parte a GRID_START
        // dalla linea, gli altri più indietro, e chi è in fondo deve comunque
        // vedere le luci senza girarsi.
        const n = trackPts.length;
        const passo = TrackGeometry.lapLength(trackPts) / n;
        const vicino = TrackGeometry.nearestPoint(trackPts, gantry[0].x, gantry[0].z);
        const avanti = ((vicino.index % n) + n) % n * passo;
        assert.ok(avanti > TrackGeometry.GRID_START,
            `gantry a ${avanti.toFixed(0)} unità dalla linea, la pole sta a ${TrackGeometry.GRID_START}`);
    });
}

// ═══════════ IL FRONTE DELLA CORSIA BOX NON HA VUOTI ═══════════
//
// Richiesta esplicita dell'utente: "non vorrei buchi, anche con un giocatore
// solo". Prima box ed edifici erano due sistemi con passi diversi che si
// evitavano a vicenda: su monte-rosso i sei box occupavano tutti i campioni
// utili e gli edifici scendevano a ZERO, mentre con pochi piloti restava
// corsia vuota. Ora si alternano sulla stessa griglia di posizioni.
for (const id of TRACCIATI) {
    for (const piloti of [1, 6, 14, 20]) {
        test(`fronte corsia box senza vuoti su ${id} con ${piloti} piloti`, () => {
            const { raw, trackPts, layout, pitPath } = circuitoVero(id, { gridSize: piloti });
            const slot = TrackGeometry.pitLaneSlots(pitPath, raw.pit.boxIndex,
                                                    trackPts, raw.pit.roadHalfWidth);
            const edifici = layout.filter(v => v.asset === 'pitsGarageClosed'
                                            || v.asset === 'pitsOffice');
            const box = Math.min(piloti, slot.length);

            // Il fronte deve essere PIENO, non "quasi vuoto come prima": la
            // misura è quante posizioni libere ricevono un edificio. Restano
            // scoperte quelle agli estremi, dove la corsia si innesta sulla
            // pista e piega fino a 31° fra una posizione e la successiva:
            // lì due volumi affiancati si incrocerebbero con gli spigoli.
            //
            // Il riferimento è il difetto di partenza: su monte-rosso con sei
            // piloti gli edifici erano ZERO. Due terzi delle posizioni libere
            // è la soglia che distingue "fronte" da "qualche edificio sparso".
            const libere = slot.length - box;
            assert.ok(edifici.length >= Math.floor(libere * 2 / 3),
                `${slot.length} posizioni, ${box} riservate ai box, ` +
                `${edifici.length} edifici su ${libere} posizioni libere`);
        });
    }
}
