// frontend/shared/cittaProfilo.js
//
// DOVE STA LA FACCIATA E QUANTO È ALTO OGNI PALAZZO.
//
// ⚠️ LA CITTÀ NON È FATTA DI EDIFICI, È UN NASTRO. Prendere N modelli di
// palazzo e disporli lungo il bordo ha due difetti che non si curano: la curva
// (un edificio è un parallelepipedo, il tracciato gira — ogni giunzione diventa
// uno spigolo aperto o una compenetrazione) e il costo, perché questo gioco è
// GPU-bound sui pixel e un muro che chiude la vista è esattamente ciò che
// riempie lo schermo. La facciata si estrude sul tracciato come già fanno
// asfalto, cordoli e barriere: segue la curva PER COSTRUZIONE.
//
// Qui si decide soltanto: a che distanza dall'asse comincia, quanto è alta, di
// che colore. La mesh la costruisce TrackMeshBuilder.buildCitta leggendo questo
// — la stessa separazione che nel banking ha tenuto insieme mesh, fisica e
// camera, e che qui rende la città provabile con `node --test` invece che a
// occhio.
// Rif. docs/superpowers/specs/2026-08-26-f1-ambientazione-cittadina-design.md
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGravel.js'), require('./trackGeometry.js'),
                                 require('./trackScenery.js'), require('./toonPalette.js'));
    } else {
        root.CittaProfilo = factory(root.TrackGravel, root.TrackGeometry, root.TrackScenery, root.ToonPalette);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGravel, TrackGeometry, TrackScenery, ToonPalette) {

    // Quanto marciapiede sta fra il muro e la prima facciata. Poco: la città
    // deve chiudere la vista, e a Monaco fra il guard-rail e le case ci sta
    // giusto la gente in piedi.
    const MARCIAPIEDE = 6;

    // Un palazzo più basso della carreggiata non chiude niente; oltre i 45 si
    // vede solo muro anche dall'abitacolo, e ogni unità in più è schermo
    // riempito — che su questo gioco è il costo che conta davvero.
    const ALTEZZA_MIN = 14;
    const ALTEZZA_MAX = 45;

    // Quanto è lungo un palazzo, in unità di pista. Sotto le 25 la fila si legge
    // come una scalinata, sopra le 60 come un capannone unico.
    const PALAZZO_LUNGHEZZA = 38;

    // Le tinte delle facciate, dalla palette: un colore scritto a mano qui è un
    // colore che un giorno divergerà dal resto della scena.
    function tinte() {
        return ToonPalette.CITTA_FACCIATE;
    }

    // Il profilo della città, campione per campione e lato per lato.
    //
    // ⚠️ DETERMINISTICO E SENZA STATO: il seme viene dalla GEOMETRIA (le
    // coordinate del campione in cui il palazzo comincia), non da Math.random né
    // da un contatore. La stessa pista deve dare la stessa città ad ogni
    // caricamento — se cambiasse, il circuito avrebbe una faccia diversa ad ogni
    // partita — e due piste diverse città diverse. È lo stesso patto già in uso
    // per la scenografia.
    function profilo(trackPts, barrierProfile) {
        const n = trackPts.length;
        const distanza = new Float64Array(n * 2);
        const altezza = new Float64Array(n * 2);
        const colore = new Array(n * 2);
        if (!n) return { distanza, altezza, colore };

        const passo = TrackGeometry.lapLength(trackPts) / n;
        const perPalazzo = Math.max(2, Math.round(PALAZZO_LUNGHEZZA / passo));
        const palette = tinte();

        for (const side of [1, -1]) {
            for (let i = 0; i < n; i++) {
                const k = i * 2 + (side > 0 ? 0 : 1);
                // La facciata si posa sul muro VERO di quel punto: dove la via
                // di fuga allarga, la città arretra con lei invece di tagliarla.
                distanza[k] = TrackGravel.barrierAt(barrierProfile, i, side) + MARCIAPIEDE;

                // Il palazzo a cui questo campione appartiene: un blocco di
                // campioni consecutivi, così l'altezza resta ferma e poi salta.
                const inizio = Math.floor(i / perPalazzo) * perPalazzo;
                const q = trackPts[inizio % n];
                // Il lato entra nel seme, o i due bordi sarebbero uno lo
                // specchio dell'altro per tutto il giro.
                const seme = TrackScenery.hashString(
                    `${q.x.toFixed(1)}:${q.z.toFixed(1)}:${side > 0 ? 'd' : 's'}`);
                const rng = TrackScenery.mulberry32(seme);
                altezza[k] = ALTEZZA_MIN + rng() * (ALTEZZA_MAX - ALTEZZA_MIN);
                colore[k] = palette[Math.floor(rng() * palette.length) % palette.length];
            }
        }
        return { distanza, altezza, colore };
    }

    return { profilo, MARCIAPIEDE, ALTEZZA_MIN, ALTEZZA_MAX, PALAZZO_LUNGHEZZA };
});
