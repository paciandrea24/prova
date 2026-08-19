// frontend/shared/f1SensoVelocita.js
//
// Il senso di velocità: tutto ciò che, guardando lo schermo, deve dire "vado
// forte" senza toccare di una virgola la fisica, che sta sul server.
//
// PERCHÉ ESISTE. L'audio del gioco era già fatto bene — loop di motore vero,
// altezza e volume che seguono la velocità con curve diverse fra accelerazione
// e rilascio — mentre la camera nasceva a 65° di campo visivo e non lo cambiava
// mai: nessuno scossone, nessuna molla, niente ai bordi dello schermo. Le
// orecchie dicevano già "vado forte", gli occhi no.
//
// PERCHÉ È UN MODULO A PARTE E NON TRE RIGHE IN f1.js. Perché è tutta
// matematica di smorzamento a tempo, ed è esattamente il genere di cosa che si
// tara a mano dopo un playtest: qui è leggibile in un posto solo e verificabile
// senza browser (le curve, gli estremi, l'indipendenza dal frame rate). Il
// modulo non sa niente di Three.js, del DOM e della partita: prende un
// campione dello stato dell'auto, restituisce numeri.
//
// L'INVARIANTE CHE CONTA. Tutto lo smorzamento è a TEMPO, mai a frame: la
// stessa manovra deve durare uguale a 30 e a 144 fps. Il modo sbagliato
// (`v += (obiettivo - v) * 0.1` per frame) sarebbe due volte più lento a 30
// fps che a 60, e chi tara i numeri su una macchina li starebbe tarando per
// quella macchina. Vedi `passoVersoObiettivo`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1SensoVelocita = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Velocità "a tutta" di riferimento, nelle unità del server (×55 ≈ km/h).
    // È LA STESSA costante che usa già il motore per la sua frazione di regime
    // (ENGINE_REF_MAX_SPEED in f1.js): occhi e orecchie devono chiamare "a
    // tutta velocità" lo stesso punto, altrimenti il picco visivo e il picco
    // sonoro cadono in due momenti diversi dello stesso rettilineo.
    const VEL_RIFERIMENTO = 6.2;

    // Campo visivo: 65° è quello di sempre, con cui è tarato tutto il resto
    // (inquadrature della griglia, vetrina dell'auto in pole, halo-cam).
    const FOV_BASE = 65;
    const FOV_MASSIMO = 82;

    // Sotto questa frazione di velocità il campo visivo non si muove: la
    // corsia box col limitatore, le manovre nello stallo e il rientro in
    // griglia non sono momenti in cui "si va forte", e farli respirare
    // renderebbe il gesto un tic invece di un effetto.
    const SOGLIA_APERTURA = 0.3;

    // Mezzo secondo di ritardo in apertura — l'accelerazione è una cosa che
    // cresce — e più svelto in chiusura, perché la frenata deve essere un
    // gesto: la strada che torna a stringersi ADDOSSO nell'istante in cui
    // stacchi è metà dell'effetto.
    const TAU_APERTURA_MS = 500;
    const TAU_CHIUSURA_MS = 300;

    function clamp01(v) {
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    // Progressione morbida ai due estremi. La stessa già usata altrove nel
    // gioco per lo sguardo verso i semafori: lineare, l'inizio e la fine del
    // movimento si sentono come due scatti.
    function morbida(t) {
        return t * t * (3 - 2 * t);
    }

    // Frazione 0..1 di "quanto sto andando forte", già tenuta sotto la soglia
    // e ammorbidita. È il singolo numero da cui dipendono tutti gli effetti di
    // questo modulo: uno solo, così non possono raccontare cose diverse.
    function frazioneVelocita(velocita, soglia = SOGLIA_APERTURA) {
        const grezza = clamp01(Math.abs(velocita || 0) / VEL_RIFERIMENTO);
        if (soglia >= 1) return 0;
        return morbida(clamp01((grezza - soglia) / (1 - soglia)));
    }

    // Un passo di smorzamento esponenziale verso `obiettivo`, in cui `tau` è
    // il tempo caratteristico in millisecondi (dopo `tau` si è coperto il 63%
    // della distanza). Indipendente dal frame rate per costruzione.
    function passoVersoObiettivo(corrente, obiettivo, tau, dtMs) {
        if (!(tau > 0)) return obiettivo;
        const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
        return corrente + (obiettivo - corrente) * k;
    }

    function creaStato() {
        return { fov: FOV_BASE };
    }

    // Campo visivo desiderato a una data velocità, senza smorzamento.
    function fovObiettivo(velocita) {
        return FOV_BASE + (FOV_MASSIMO - FOV_BASE) * frazioneVelocita(velocita);
    }

    // Fa avanzare lo stato di un frame.
    //
    // `campione`: { velocita, attivo }. `attivo: false` vuol dire "non stiamo
    // guidando" (schermata mescole, panoramica, premiazione): lì il campo
    // visivo torna a FOV_BASE ISTANTANEAMENTE, non smorzato. Non è pigrizia: è
    // l'invariante che protegge tutte le inquadrature tarate a 65° — la
    // vetrina dell'auto in pole calcola la propria posizione DA camera.fov, e
    // un residuo di 70° lasciato lì dalla gara appena finita le sposterebbe
    // l'auto fuori dalla sua colonna.
    function avanza(stato, campione, dtMs) {
        const c = campione || {};
        if (c.attivo === false) {
            stato.fov = FOV_BASE;
            return stato;
        }
        stato.fov = passoVersoObiettivo(
            stato.fov,
            fovObiettivo(c.velocita),
            fovObiettivo(c.velocita) > stato.fov ? TAU_APERTURA_MS : TAU_CHIUSURA_MS,
            dtMs,
        );
        return stato;
    }

    return {
        creaStato, avanza,
        frazioneVelocita, fovObiettivo, passoVersoObiettivo, morbida, clamp01,
        VEL_RIFERIMENTO, FOV_BASE, FOV_MASSIMO, SOGLIA_APERTURA,
        TAU_APERTURA_MS, TAU_CHIUSURA_MS,
    };

});
