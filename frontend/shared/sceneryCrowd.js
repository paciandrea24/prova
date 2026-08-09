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
    // dal numero di spettatori (12 InstancedMesh in tutto), ma i TRIANGOLI sì,
    // e loadScenery disattiva il frustum culling: vengono disegnati tutti a
    // ogni frame, anche quelli alle spalle della camera. Da quando le tribune
    // secondarie sono schiere di 6 moduli invece di singole, i posti
    // disponibili sono passati da ~1600 a ~5900 per tracciato: senza tetto
    // sarebbero ~880.000 triangoli sempre in scena.
    const MAX_TOTAL = 3000;

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
                });
            }
        }
        return layout;
    }

    return { buildCrowd, FILL_MIN, FILL_MAX, MAIN_FILL_MIN };
});
