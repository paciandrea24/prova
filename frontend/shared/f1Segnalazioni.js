// frontend/shared/f1Segnalazioni.js
//
// Composizione del record di una segnalazione in gioco (tasto M): dove sta
// l'auto e dove sta guardando, per poter localizzare in fretta i difetti
// scenografici visti in playtest.
//
// Modulo puro — niente Three, niente DOM, niente fetch — così la conversione
// dell'angolo, che se sbagliata manda a cercare l'oggetto dalla parte opposta
// della pista, è verificabile con `node --test`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Segnalazioni = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Convenzione del gioco per l'angolo di un'auto: atan2(tangente.x,
    // tangente.z), vedi trackScenery.js:917. Zero guarda verso +Z e l'angolo
    // cresce verso +X. Qui si passa solo a gradi: la convenzione non si tocca,
    // perché il tool di lettura confronta questi valori con tangenti calcolate
    // con lo stesso atan2.
    function gradiDaRotY(rotY) {
        const gradi = rotY * 180 / Math.PI;
        return ((gradi % 360) + 360) % 360;
    }

    function arrotonda(valore, decimali) {
        const fattore = Math.pow(10, decimali);
        return Math.round(valore * fattore) / fattore;
    }

    // Distingue i giri di ricognizione fra loro e dà a Shift+M un bersaglio
    // non ambiguo. `rnd` è iniettata (Math.random in gioco) per poter essere
    // deterministica nei test.
    function nuovaSessioneId(now, rnd) {
        const pad = (n, l) => String(n).padStart(l, '0');
        const data = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`;
        const ora = `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
        const coda = Math.floor(rnd() * 46656).toString(36).padStart(3, '0');   // 36^3
        return `${data}-${ora}-${coda}`;
    }

    // stato: { sessione, t, trackId, pos:{x,y,z}, rotY, camera, guardaDietro,
    //          velocita, giro }
    //
    // Il record esce SENZA `n`: il progressivo lo assegna il server, che è
    // l'unico a vedere il file. Un contatore locale divergerebbe dal file
    // appena si aprono due schede o si ricarica la pagina.
    function componiSegnalazione(stato) {
        return {
            sessione: stato.sessione,
            t: stato.t,
            trackId: stato.trackId,
            pos: {
                x: arrotonda(stato.pos.x, 2),
                y: arrotonda(stato.pos.y, 2),
                z: arrotonda(stato.pos.z, 2)
            },
            headingDeg: arrotonda(gradiDaRotY(stato.rotY), 1),
            camera: stato.camera,
            guardaDietro: !!stato.guardaDietro,
            velocita: Math.round(stato.velocita || 0),
            giro: Number.isFinite(stato.giro) ? stato.giro : null
        };
    }

    return { gradiDaRotY, nuovaSessioneId, componiSegnalazione };
});
