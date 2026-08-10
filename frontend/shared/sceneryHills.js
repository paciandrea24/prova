// frontend/shared/sceneryHills.js
//
// Quota del terreno collinare che chiude l'orizzonte oltre il terrapieno.
//
// Vive in un modulo a sé perché serve a DUE consumatori che devono essere
// d'accordo al centimetro: trackMeshBuilder.buildGround, che disegna la mesh
// del terreno, e trackScenery, che ci pianta sopra gli alberi dei boschi. Se
// le due quote divergessero, gli alberi risulterebbero sepolti o sospesi in
// aria. Modulo puro, nessuna dipendenza da Three.js.
//
// Rif. richiesta utente 2026-08-09: "la mappa sembra infinita perché c'è una
// distesa di verde e poi il cielo azzurro che si incontrano — mi piacerebbe
// un mix di elementi ambientali tipo colline, boschi folti".
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryHills = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Le colline iniziano oltre il bordo del terrapieno: la fascia in mezzo è
    // quella dove si finisce davvero uscendo di pista, e deve restare piana e
    // leggibile.
    const HILL_START_MARGIN = 75;
    // Distanza su cui la quota sale dal piano al massimo. Ripida abbastanza da
    // chiudere la vista, non tanto da sembrare un muro.
    const HILL_RAMP = 230;
    // Altezza massima. La tribuna principale è alta 12.3 e la torre di
    // direzione 33.7: le colline devono superarle per chiudere l'orizzonte
    // anche dietro di esse.
    //
    // Alzata da 55 a 130 il 2026-08-10, con inizio anticipato da 120 a 75 e
    // rampa da 300 a 230. Il motivo è misurato, non estetico: alla quota
    // vecchia le colline coprivano 2° scarsi sopra l'orizzonte contro i 30° e
    // passa inquadrati dalla camera, quindi si vedeva il cielo posarsi sul
    // prato. È questa, e non il numero di alberi, la causa della "sensazione
    // di prato infinito": la strada "più alberi ovunque" era già stata
    // provata e annullata (vedi il commento su NATURE_ATTEMPTS in
    // trackScenery.js). Ora sono ~15° nel tipico e 11.6° nel punto peggiore.
    const HILL_MAX_HEIGHT = 130;

    // Rumore deterministico da coordinate: hash intero delle celle +
    // interpolazione bilineare fra i quattro angoli. Non serve un Perlin vero
    // — a queste dimensioni la differenza non si vede, e questo non ha
    // dipendenze né tabelle da inizializzare.
    function hash2(ix, iz) {
        let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        h ^= h >>> 12;
        return (h >>> 0) / 4294967296;
    }

    function valueNoise(x, z, cell) {
        const fx = x / cell, fz = z / cell;
        const ix = Math.floor(fx), iz = Math.floor(fz);
        const tx = fx - ix, tz = fz - iz;
        // Smoothstep sui pesi: senza, le celle si leggono come losanghe.
        const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
        const a = hash2(ix, iz), b = hash2(ix + 1, iz);
        const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
        return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
    }

    // distFromTrack lo passa il chiamante: è la parte costosa (nearestPoint su
    // ~1000 punti) e chi chiama questa funzione l'ha già calcolata per altri
    // motivi. Ricalcolarla qui la pagherebbe due volte per ogni cella.
    function hillHeightAt(x, z, distFromTrack, embankOuter) {
        const start = embankOuter + HILL_START_MARGIN;
        if (distFromTrack <= start) return 0;
        const t = Math.min(1, (distFromTrack - start) / HILL_RAMP);
        const ramp = t * t * (3 - 2 * t);   // parte dolce dal piano, non a scalino
        // Due frequenze: crinali larghi + irregolarità minute.
        const n = valueNoise(x, z, 260) * 0.7 + valueNoise(x, z, 90) * 0.3;
        // Il PAVIMENTO del rilievo conta più della sua cima: con il vecchio
        // 0.35 gli avvallamenti scendevano al 35% dell'altezza e lo sguardo ci
        // passava attraverso, tanto che il punto peggiore del profilo copriva
        // 1.4° di orizzonte mentre la media stava sopra i 4. Alzarlo a 0.62
        // rende il crinale continuo: resta irregolare, ma non ha più buchi da
        // cui si vede il mondo finire.
        return ramp * HILL_MAX_HEIGHT * (0.62 + 0.38 * n);
    }

    return { hillHeightAt, HILL_START_MARGIN, HILL_RAMP, HILL_MAX_HEIGHT };
});
