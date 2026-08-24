// frontend/shared/sceneryCrowd.js
//
// Spettatori sulle tribune. È l'unica categoria di scenografia posizionata
// RELATIVAMENTE a un altro oggetto invece che al tracciato: ogni posto è
// espresso in coordinate locali alla tribuna
// (frontend/assets/custom/circuit/grandStandSeats.json, generato dalla
// stessa funzione che genera i sedili del modello) e va portato in
// coordinate mondo applicando rotazione e posizione della tribuna.
// Modulo puro, nessuna dipendenza da Three.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryCrowd = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Riempimento: mai una tribuna deserta, mai tutte identiche al 100%.
    const FILL_MIN = 0.65;
    const FILL_MAX = 1.0;
    // La tribuna principale è quella inquadrata a ogni partenza e arrivo:
    // resta più piena delle altre.
    const MAIN_FILL_MIN = 0.85;
    const VARIANTS = ['spectatorA', 'spectatorB', 'spectatorC'];

    // Tetto complessivo di figure per tracciato. Le draw call non dipendono
    // dal numero di spettatori (poche InstancedMesh per cella), ma i TRIANGOLI
    // sì: 120 a figura.
    //
    // Era 3000, e la ragione scritta qui era che loadScenery teneva SPENTO il
    // frustum culling — venivano disegnati tutti a ogni frame, anche quelli
    // alle spalle della camera. Da allora `sceneryChunks` divide le istanze in
    // celle da 350 unità con un ingombro proprio e `im.frustumCulled = true`:
    // le celle fuori inquadratura non si disegnano più, né per la camera né
    // per la mappa delle ombre. Quel motivo non vale più.
    //
    // 6000 il 2026-08-13, insieme al raddoppio delle tribune. Il tetto NON è
    // un numero di figure che si vede: è un budget che si spalma su tutte le
    // tribune del circuito (vedi `fillCap`), quindi alzando le tribune senza
    // alzare questo le tribune si SVUOTANO — 115 tribune a 3000 figure fanno
    // 26 spettatori l'una contro i 54 di prima. A 6000 restano 52 l'una,
    // cioè piene come sono sempre state.
    const MAX_TOTAL = 6000;

    function buildCrowd(grandstands, seatAnchors, rng) {
        if (!seatAnchors || !seatAnchors.length) return [];
        const layout = [];

        // Riempimento massimo compatibile col tetto: con poche tribune resta
        // FILL_MAX e non cambia nulla, con molte cala per tutte insieme invece
        // di lasciare deserte le ultime della lista.
        const capacity = grandstands.length * seatAnchors.length;
        const fillCap = capacity > 0 ? Math.min(FILL_MAX, MAX_TOTAL / capacity) : FILL_MAX;

        for (const stand of grandstands) {
            const isMain = stand.category === 'grandstand-main';
            const min = Math.min(isMain ? MAIN_FILL_MIN : FILL_MIN, fillCap);
            const fill = min + rng() * (fillCap - min);

            const rot = stand.rotY || 0;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);

            for (const seat of seatAnchors) {
                if (rng() > fill) continue;
                // Rotazione attorno a Y con la stessa convenzione di
                // THREE.Object3D, che è quella applicata da loadScenery
                // all'istanza della tribuna: solo così lo spettatore finisce
                // sul sedile e non a mezz'aria di fianco.
                const x = stand.x + seat.x * cos + seat.z * sin;
                const z = stand.z - seat.x * sin + seat.z * cos;
                layout.push({
                    asset: VARIANTS[Math.floor(rng() * VARIANTS.length)],
                    category: 'crowd',
                    x, y: (stand.y || 0) + seat.y, z,
                    rotY: rot,
                    scale: 1,
                    // Da CHI dipende questo spettatore. La folla nasce prima
                    // della porta e passa senza ingombro: senza questo
                    // legame, una tribuna scartata dopo lascia i suoi
                    // spettatori seduti a mezz'aria — ed e' esattamente cio'
                    // che l'utente ha visto su shanghai davanti al traguardo
                    // (2026-08-24). Stessa chiave delle reti: posizione a due
                    // decimali.
                    daTribuna: stand.x.toFixed(2) + ',' + stand.z.toFixed(2),
                });
            }
        }
        return layout;
    }

    // Spettatori in piedi sulle terrazze delle infrastrutture. Stessa idea
    // della folla sulle tribune — posizioni locali all'oggetto, portate in
    // coordinate mondo con la rotazione dell'oggetto — ma con budget PROPRIO:
    // le terrazze sono poche e piccole, e farle pescare da MAX_TOTAL le
    // lascerebbe deserte ogni volta che le tribune crescono.
    const TERRACE_VARIANTS = ['spectatorStandA', 'spectatorStandB'];
    const TERRACE_FILL_MIN = 0.5;
    const MAX_TERRACE = 900;

    function buildTerraceCrowd(terrazze, ancorePerAsset, rng) {
        if (!terrazze || !terrazze.length || !ancorePerAsset) return [];
        const layout = [];

        let capacity = 0;
        for (const t of terrazze) {
            const a = ancorePerAsset[t.asset];
            if (a) capacity += a.length;
        }
        if (!capacity) return [];
        const fillCap = Math.min(FILL_MAX, MAX_TERRACE / capacity);

        for (const t of terrazze) {
            const ancore = ancorePerAsset[t.asset];
            if (!ancore || !ancore.length) continue;
            const min = Math.min(TERRACE_FILL_MIN, fillCap);
            const fill = min + rng() * (fillCap - min);
            const rot = t.rotY || 0;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            for (const a of ancore) {
                if (rng() > fill) continue;
                layout.push({
                    asset: TERRACE_VARIANTS[Math.floor(rng() * TERRACE_VARIANTS.length)],
                    category: 'crowd',
                    x: t.x + a.x * cos + a.z * sin,
                    y: (t.y || 0) + a.y,
                    z: t.z - a.x * sin + a.z * cos,
                    rotY: rot,
                    scale: 1,
                    // Vale per le terrazze quanto per le tribune: se la porta
                    // scarta l'infrastruttura, i suoi spettatori se ne vanno
                    // con lei.
                    daTribuna: t.x.toFixed(2) + ',' + t.z.toFixed(2),
                });
            }
        }
        return layout;
    }

    return { buildCrowd, buildTerraceCrowd,
             FILL_MIN, FILL_MAX, MAIN_FILL_MIN, MAX_TERRACE };
});
