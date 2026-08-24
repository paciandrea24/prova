// frontend/shared/sceneryAssetSizes.js
//
// Ingombro reale di ogni asset scenico, in unità di gioco, misurato sui .glb
// esportati (vedi la tabella in docs/f1-notes.md). Fonte unica: i moduli di
// scenografia devono sapere quanto è grande un oggetto per non piazzarne due
// sovrapposti e per non infilarne uno alto sotto un tratto di pista
// sopraelevata.
//
// w = larghezza (X locale), h = altezza, d = profondità (Z locale, il fronte).
// Se si rigenerano gli asset con dimensioni diverse, aggiornare qui: un
// valore sbagliato non rompe nulla in modo evidente, produce solo
// compenetrazioni che si notano soltanto guardando il circuito.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryAssetSizes = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const SIZES = {
        grandStand:        { w: 19.2, h: 12.3, d: 12.8 },
        grandStandAwning:  { w: 19.2, h: 16.0, d: 13.3 },
        grandStandCovered: { w: 19.2, h: 14.7, d: 13.2 },
        billboard:         { w: 16.4, h: 12.9, d: 1.6 },
        billboardLow:      { w: 16.4, h: 4.5,  d: 1.4 },
        pitsGarageClosed:  { w: 12.9, h: 8.3,  d: 14.7 },
        pitsOffice:        { w: 13.0, h: 13.1, d: 14.9 },
        raceControlTower:  { w: 14.6, h: 33.7, d: 12.6 },
        startGantry:       { w: 34.5, h: 16.0, d: 2.4 },
        podium:            { w: 12.0, h: 9.0,  d: 7.1 },
        tyreStack:         { w: 7.0,  h: 1.9,  d: 2.4 },
        catchFence:        { w: 12.0, h: 9.0,  d: 0.5 },
        marshalPost:       { w: 5.5,  h: 8.9,  d: 4.5 },
        pylon:             { w: 6.4,  h: 26.2, d: 3.0 },
        flagPole:          { w: 5.4,  h: 15.0, d: 1.6 },
        paddockTent:       { w: 16.8, h: 7.2,  d: 13.0 },
        brakingBoard:      { w: 2.2,  h: 3.1,  d: 0.7 },
        concreteBarrier:   { w: 6.0,  h: 1.4,  d: 1.4 },
        footbridge:        { w: 36.5, h: 13.3, d: 4.5 },
        // Infrastrutture di circuito (spec 2026-08-13), misurate sui .glb dal
        // test qui accanto: se qualcuno rigenera un modello con dimensioni
        // diverse e si dimentica di aggiornare questa riga, il test lo dice.
        giantScreen:       { w: 15.0, h: 17.9, d: 2.5 },
        floodlightTower:   { w: 7.6,  h: 32.5, d: 4.0 },
        hospitalityDeck:   { w: 16.0, h: 9.7,  d: 11.0 },
        vipSuite:          { w: 16.3, h: 12.1, d: 12.5 },
        serviceBuilding:   { w: 13.6, h: 16.1, d: 12.1 },
        tvTower:           { w: 4.8,  h: 15.2, d: 5.4 },
        recoveryCrane:     { w: 10.3, h: 15.0, d: 12.4 },
        trackGate:         { w: 9.3,  h: 5.2,  d: 1.5 },
        // Spettatori in piedi: i modelli e il caricamento esistevano già dal
        // 2026-08-09, ma non li piazzava nessuno. Li usa il Task 5.
        spectatorStandA:   { w: 0.9,  h: 2.3,  d: 0.4 },
        spectatorStandB:   { w: 0.9,  h: 2.3,  d: 0.4 },
        spectatorA:        { w: 0.6,  h: 1.4,  d: 0.7 },
        spectatorB:        { w: 0.6,  h: 1.4,  d: 0.7 },
        spectatorC:        { w: 0.6,  h: 1.4,  d: 0.7 },
        // Paddock e area logistica. Mancavano tutti: erano giudicati col
        // FALLBACK, cioè come cubi 6x6x6. Il camion è lungo 19.1 e ne
        // dichiarava 6, il container 7.7 e ne dichiarava 6 — ed è cosi' che
        // due container sono finiti dentro la pista di monte-rosso senza che
        // nessun test se ne accorgesse (2026-08-24).
        containerStack:    { w: 7.7,  h: 6.4,  d: 3.4 },
        motorhome:         { w: 15.2, h: 4.5,  d: 5.1 },
        truck:             { w: 19.1, h: 5.0,  d: 4.0 },
        parkedCarRed:      { w: 5.2,  h: 2.2,  d: 2.3 },
        parkedCarBlue:     { w: 5.2,  h: 2.2,  d: 2.3 },
        parkedCarWhite:    { w: 5.2,  h: 2.2,  d: 2.3 },
        // Lo striscione è sottile come un cartellone: 0.3 di profondità, non
        // 6. Col fallback occupava venti volte il suo spessore reale.
        banner:            { w: 9.6,  h: 3.0,  d: 0.3 },
        // Vegetazione e massi. La misura è quella della CHIOMA, non del
        // tronco: è cio' che si vede sporgere sull'asfalto. Fra loro le
        // chiome possono intrecciarsi — vedi VEGETAZIONE in sceneryRegistro.
        treeBroad:         { w: 10.3, h: 11.0, d: 9.7 },
        treeRound:         { w: 9.3,  h: 9.6,  d: 9.7 },
        treeYoung:         { w: 6.9,  h: 6.9,  d: 7.1 },
        treePine:          { w: 5.8,  h: 16.8, d: 5.2 },
        rockCluster:       { w: 4.6,  h: 2.2,  d: 3.7 },
        rockSingle:        { w: 3.1,  h: 1.6,  d: 2.9 },
    };

    const FALLBACK = { w: 6, h: 6, d: 6 };

    function sizeOf(asset) {
        return SIZES[asset] || FALLBACK;
    }

    function heightOf(asset) {
        return sizeOf(asset).h;
    }

    // Raggio del cerchio che contiene il footprint: serve per i test di
    // distanza minima fra due oggetti, che non conoscono l'orientamento
    // reciproco.
    function footprintRadius(asset) {
        const s = sizeOf(asset);
        return Math.hypot(s.w, s.d) / 2;
    }

    // Angoli del footprint in coordinate mondo, con la stessa convenzione di
    // rotazione che loadScenery applica all'istanza (THREE.Object3D.rotation.y).
    function footprintCorners(item) {
        const s = sizeOf(item.asset);
        const sc = item.scale > 1 ? item.scale : 1;
        const hw = (s.w * sc) / 2, hd = (s.d * sc) / 2;
        const c = Math.cos(item.rotY || 0), sn = Math.sin(item.rotY || 0);
        return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(function (p) {
            return { x: item.x + p[0] * c + p[1] * sn, z: item.z - p[0] * sn + p[1] * c };
        });
    }

    function topOf(item) {
        const sc = item.scale > 1 ? item.scale : 1;
        return (item.y || 0) + heightOf(item.asset) * sc;
    }

    // Test SAT fra due rettangoli orientati. Serve un test vero e non un
    // confronto fra raggi: con oggetti lunghi e sottili (reti, cartelloni) il
    // raggio circolare dà falsi positivi a raffica e finisce per nascondere
    // le collisioni reali.
    function polysOverlap(a, b) {
        const polys = [a, b];
        for (let k = 0; k < 2; k++) {
            const poly = polys[k];
            for (let i = 0; i < poly.length; i++) {
                const j = (i + 1) % poly.length;
                const nx = -(poly[j].z - poly[i].z), nz = poly[j].x - poly[i].x;
                let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
                for (const p of a) { const d = p.x * nx + p.z * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
                for (const p of b) { const d = p.x * nx + p.z * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
                if (maxA < minB || maxB < minA) return false;   // asse separatore
            }
        }
        return true;
    }

    // Due oggetti si compenetrano se i footprint si sovrappongono E i loro
    // intervalli di quota si intersecano: un cartellone sospeso sopra una
    // barriera bassa non è una collisione.
    function itemsOverlap(a, b) {
        if ((a.y || 0) >= topOf(b) || (b.y || 0) >= topOf(a)) return false;
        return polysOverlap(footprintCorners(a), footprintCorners(b));
    }

    // Registro spaziale degli oggetti già piazzati. Senza griglia il
    // controllo sarebbe quadratico sulle ~800 voci solide di un layout.
    function createCollisionIndex(cellSize) {
        const cell = cellSize || 40;
        const grid = new Map();
        const keysOf = (item) => {
            const r = footprintRadius(item.asset) * (item.scale > 1 ? item.scale : 1);
            const keys = [];
            for (let gx = Math.floor((item.x - r) / cell); gx <= Math.floor((item.x + r) / cell); gx++) {
                for (let gz = Math.floor((item.z - r) / cell); gz <= Math.floor((item.z + r) / cell); gz++) {
                    keys.push(gx + ':' + gz);
                }
            }
            return keys;
        };
        return {
            fits(item) {
                for (const k of keysOf(item)) {
                    const bucket = grid.get(k);
                    if (!bucket) continue;
                    for (const other of bucket) if (itemsOverlap(item, other)) return false;
                }
                return true;
            },
            add(item) {
                for (const k of keysOf(item)) {
                    if (!grid.has(k)) grid.set(k, []);
                    grid.get(k).push(item);
                }
                return item;
            },
        };
    }

    return {
        SIZES, sizeOf, heightOf, footprintRadius,
        footprintCorners, itemsOverlap, polysOverlap, createCollisionIndex,
    };
});
