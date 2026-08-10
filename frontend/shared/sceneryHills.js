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
    // LE COLLINE NON SONO UN MURO, SONO UN PIEDISTALLO PER IL BOSCO.
    //
    // Il 2026-08-10 erano state portate a 130 per chiudere l'orizzonte da
    // sole. L'utente le ha viste e le ha descritte come un cerchio di mura
    // verdi a scaloni, tipo la barriera di Game of Thrones. L'obiettivo non è
    // nascondere l'orizzonte ma OCCUPARLO: dare l'impressione che la mappa sia
    // chiusa, senza murarla.
    //
    // A quel lavoro pensa la vegetazione, e le colline la sollevano: gli
    // alberi in gioco sono alti 9 e 6.4 unità (i Kenney a scala 6), quindi da
    // soli, su terreno piatto, spariscono in lontananza. In cima a un rilievo
    // di 45 occupano l'orizzonte come se fossero alti 54, e il terreno resta
    // un'ondulazione invece di una parete.
    const HILL_BASE_HEIGHT = 45;
    // Quanto le zone alte svettano SOPRA la base: il rilievo a grande scala
    // moltiplica per un fattore fra 1 e 1.62, mai sotto. La variazione va
    // verso l'alto e non verso il basso perché la base è già il minimo che
    // serve a chiudere l'orizzonte: se le zone basse scendessero sotto,
    // tornerebbe il difetto che tutto questo doveva risolvere.
    const HILL_ZONE_BOOST = 0.62;
    // Quota massima raggiungibile, dove zona e rumore fine sono entrambi al
    // massimo. Non è un parametro: è una conseguenza, esportata perché i
    // consumatori e i test hanno bisogno di un tetto vero.
    const HILL_PEAK_HEIGHT = HILL_BASE_HEIGHT * (1 + HILL_ZONE_BOOST);

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
    // `insideLoop`: il punto sta dentro l'anello del tracciato? Se sì la quota
    // è ZERO, qualunque sia la distanza dall'asfalto.
    //
    // Senza questo, su un tracciato tortuoso il centro di un'ansa — che può
    // trovarsi a 170 unità dalla pista quanto un prato esterno — si solleva
    // come una collina, e il terreno emerge in mezzo al circuito attraversando
    // l'asfalto. Difetto reale, fotografato dall'utente il 2026-08-10: 17
    // celle sollevate dentro "prova", fino a 7 unità di quota.
    // Il chiamante calcola il flag con TrackGeometry.isInsideLoop; qui arriva
    // già pronto perché il test costa un ray casting su ~1000 punti e chi
    // disegna il terreno lo fa una volta per cella, non una per consumatore.
    function hillHeightAt(x, z, distFromTrack, embankOuter, insideLoop) {
        if (insideLoop) return 0;
        const start = embankOuter + HILL_START_MARGIN;
        if (distFromTrack <= start) return 0;
        const t = Math.min(1, (distFromTrack - start) / HILL_RAMP);
        const ramp = t * t * (3 - 2 * t);   // parte dolce dal piano, non a scalino
        // Rilievo a GRANDE SCALA: decide, zona per zona, quanto in alto
        // arrivano le colline. Senza di esso la quota dipende solo dalla
        // distanza dalla pista e cresce identica in ogni direzione: il
        // risultato è un anello concentrico, cioè un catino di mura verdi
        // attorno al circuito — è così che l'utente l'ha descritto vedendolo
        // il 2026-08-10. Con una cella di 950 unità, sull'arco di un
        // tracciato si attraversano due o tre zone diverse: qui rilievi alti,
        // là quasi pianura.
        const zona = 1 + HILL_ZONE_BOOST * valueNoise(x + 3100, z - 1700, 950);
        // Due frequenze fini: crinali larghi + irregolarità minute.
        const n = valueNoise(x, z, 260) * 0.7 + valueNoise(x, z, 90) * 0.3;
        // Il PAVIMENTO del rilievo conta più della sua cima: con il vecchio
        // 0.35 gli avvallamenti scendevano al 35% dell'altezza e lo sguardo ci
        // passava attraverso, tanto che il punto peggiore del profilo copriva
        // 1.4° di orizzonte mentre la media stava sopra i 4. Alzarlo a 0.62
        // rende il crinale continuo: resta irregolare, ma non ha più buchi da
        // cui si vede il mondo finire.
        return ramp * HILL_BASE_HEIGHT * zona * (0.78 + 0.22 * n);
    }

    return { hillHeightAt, HILL_START_MARGIN, HILL_RAMP, HILL_BASE_HEIGHT, HILL_PEAK_HEIGHT };
});
