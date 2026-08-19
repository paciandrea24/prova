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

    // ── La molla: quanto la camera "sente" accelerazione e frenata ──────────
    //
    // COME SI STIMA L'ACCELERAZIONE SENZA DERIVARE. Il client conosce solo la
    // velocità che arriva dal server, e arriva a 20 Hz: una derivata
    // (dv/dt) calcolata per frame darebbe zero nei frame senza aggiornamento e
    // un picco in quelli con, cioè uno sfarfallio. Qui si tengono due medie
    // mobili esponenziali della stessa velocità, una svelta e una lenta: il
    // loro SCARTO è proporzionale all'accelerazione, non ha divisioni per dt e
    // non ha bisogno di sapere quando è arrivato un pacchetto.
    const TAU_VEL_VELOCE_MS = 80;
    const TAU_VEL_LENTA_MS = 400;

    // Gli scarti che valgono "accelerazione piena" e "frenata piena". NON sono
    // indovinati: misurati con la fisica vera del server (banco prova headless,
    // 3 bot × 200 s su `prova` e `monte-rosso`, tick da 50 ms). L'accelerazione
    // satura a 3.72 u/s² e la frenata a ~8 u/s², cioè la frenata è più del
    // doppio dell'accelerazione — con una scala sola per entrambe, o la molla
    // non si vedeva in accelerazione o sbatteva al fondo in frenata.
    const SCARTO_PIENO_ACCEL = 1.15;
    const SCARTO_PIENO_FRENO = 1.85;

    // Quanto si muove la camera d'inseguimento, in unità di gioco, sull'offset
    // (0, 5.5, -13) da cui parte. Arretra e si abbassa in accelerazione — è
    // l'auto che scappa via — risale e si avvicina in frenata.
    const MOLLA_ARRETRAMENTO = 1.3;
    const MOLLA_ABBASSAMENTO = 0.55;

    // Dall'halo-cam la camera è imbullonata al telaio: spostarla sarebbe la
    // testa del pilota che scivola nell'abitacolo. Lì la molla è un beccheggio
    // di pochi gradi — il muso che si siede in accelerazione e si tuffa in
    // frenata — che è quello che si vede davvero da dentro.
    const MOLLA_BECCHEGGIO_DEG = 1.6;

    // La molla ha una sua inerzia, breve: senza, ogni pacchetto di rete la
    // farebbe tremare. Con lo scarto già filtrato, 120 ms bastano.
    const TAU_MOLLA_MS = 120;

    // ── I micro-scossoni: cordoli e fuoripista ──────────────────────────────
    //
    // PERCHÉ NON UN RUMORE CASUALE. `Math.random()` per frame dà uno sfarfallio
    // bianco che a 60 fps si legge come un difetto dell'immagine, non come una
    // vibrazione, e cambia carattere col frame rate. Qui ogni canale è la somma
    // di due sinusoidi di frequenze in rapporto irrazionale: non si ripete in
    // modo riconoscibile, è continua per costruzione (nessun salto quando cambia
    // la superficie: avanza la FASE, non si riparte da zero) e a parità di tempo
    // fa esattamente la stessa cosa a 30 e a 144 fps.
    //
    // PERCHÉ NON LA FREQUENZA VERA DELLE STECCHE. Un cordolo con una stecca ogni
    // mezza unità, a 340 km/h, sono ~250 Hz: a 60 fps non è rappresentabile e
    // diventerebbe aliasing puro. Si sceglie una frequenza VISIBILE, che è ciò
    // che il giocatore percepisce come "vibrazione", e la si lega alla velocità
    // solo tramite l'ampiezza.
    //
    // PERCHÉ NON PIÙ DI ~16 Hz. Su uno schermo a 60 Hz sono meno di quattro
    // campioni per oscillazione: oltre, la vibrazione non si legge più come tale
    // e su un frame rate ballerino compaiono battimenti lenti che sembrano un
    // difetto. Il gioco gira intorno ai 60 fps, quindi il tetto è quello.
    const SCOSSONE_CORDOLO = {
        // Il cordolo è secco e verticale: le stecche sono un gradino, non sabbia.
        hz1: 11, hz2: 16.4,
        dy: 0.14, dx: 0.05, rollDeg: 0.5,
    };
    const SCOSSONE_FUORI = {
        // Erba e ghiaia sono più lente e più laterali: l'auto galleggia e sbanda.
        hz1: 6.5, hz2: 9.7,
        dy: 0.10, dx: 0.09, rollDeg: 0.75,
    };

    // Dall'halo-cam la camera è imbullonata al telaio e prende tutto quello che
    // prende la scocca; da fuori, la camera d'inseguimento è un'astrazione e
    // scuoterla come il telaio dà la nausea senza dare informazione.
    const SCOSSONE_HALO_MULT = 1.5;

    // Salire su un cordolo e scenderne è un gesto di poche decine di
    // millisecondi: la vibrazione deve attaccare e staccare in fretta, o si
    // sente "in ritardo" rispetto a quello che si vede sotto le ruote.
    const TAU_SCOSSONE_MS = 70;

    // Nomi delle superfici. `fuori` tiene insieme erba e ghiaia: al fine dello
    // scossone sono la stessa cosa (per le PARTICELLE non lo saranno — quello è
    // il prossimo effetto, e distinguerle è compito di chi campiona la mappa,
    // non di questo modulo).
    const ASFALTO = 'asfalto';
    const CORDOLO = 'cordolo';
    const FUORI = 'fuori';

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
        return {
            fov: FOV_BASE,
            // Le due medie mobili della velocità: `null` = "non ho ancora visto
            // niente", e il primo campione le inizializza entrambe a sé stesso
            // invece di far partire un transitorio da zero (che sarebbe una
            // finta accelerazione violenta al primo frame, o al rientro in
            // pista dopo una schermata).
            velVeloce: null,
            velLenta: null,
            // -1 = frenata piena, 0 = velocità costante, +1 = accelerazione piena.
            spinta: 0,
            // Scossoni: due intensità separate — non una sola con la superficie
            // che cambia i parametri sotto — così il passaggio cordolo → erba si
            // FONDE invece di scattare da una vibrazione all'altra.
            intCordolo: 0,
            intFuori: 0,
            // Le fasi avanzano sempre, anche a intensità zero: quando la
            // vibrazione riparte non lo fa da un salto.
            fase1: 0,
            fase2: 0,
        };
    }

    // Che superficie c'è sotto l'auto, dato lo scostamento laterale dall'asse
    // della pista. Si misura sul BORDO ESTERNO dell'auto, non sul suo centro:
    // il cordolo lo prendi con una ruota, e chiedere che il baricentro sia
    // oltre il bordo dell'asfalto vorrebbe dire sentirlo mezza vettura tardi.
    //
    // `semiLarghezza` è la metà larghezza della hitbox del server (CAR_HALF_WIDTH
    // in CollisionResolver.js): la stessa misura con cui l'auto urta i muri.
    function superficieDaScostamento(latAssoluto, roadHalf, curbW, semiLarghezza) {
        const bordo = Math.abs(latAssoluto) + Math.abs(semiLarghezza || 0);
        if (bordo > roadHalf + curbW) return FUORI;
        if (bordo > roadHalf) return CORDOLO;
        return ASFALTO;
    }

    // Metà larghezza della hitbox del server (CAR_HALF_WIDTH in
    // CollisionResolver.js), riportata qui perché è una misura del client tanto
    // quanto del server: è la stessa con cui l'auto urta i muri.
    const SEMI_LARGHEZZA_AUTO = 1.74;

    // Che superficie ha sotto un'auto che sta in (x, z).
    //
    // `TG` è TrackGeometry, passato dal chiamante: questo modulo non vuole
    // dipendere dalla geometria della pista (è il modulo di come si SENTE la
    // velocità), ma la funzione deve poter essere verificata sui tracciati veri
    // e non su una copia della sua logica scritta in uno script a parte.
    //
    // Lo scostamento si prende proiettando sulla NORMALE del campione dove il
    // server dice che siamo (`idxPrecedente`), non con una ricerca del punto più
    // vicino: la proiezione dà la distanza vera dall'asse senza l'errore di
    // campionamento, e partire dall'indice del server evita di agganciarsi al
    // tratto sbagliato dove il tracciato si riavvicina a sé stesso.
    //
    // La corsia box è asfalto per definizione: se il suo tracciato passa più
    // vicino di quello della pista, siamo lì. È lo stesso criterio del pallino
    // della minimappa, che ha lo stesso problema — durante la sosta l'indice di
    // pista resta agganciato all'ingresso box e da solo direbbe "fuoripista".
    function superficieSottoAuto(TG, { trackPts, pitPts, idxPrecedente = 0, x, z, roadHalf, curbW, finestra = 60 }) {
        if (!trackPts || !trackPts.length) return ASFALTO;
        const idx = TG.nearestIndexNear(trackPts, idxPrecedente || 0, x, z, finestra);
        const p = trackPts[idx];
        if (!p) return ASFALTO;

        const distPista = Math.hypot(x - p.x, z - p.z);
        if (pitPts && pitPts.length) {
            const nearPit = TG.nearestPoint(pitPts, x, z);
            if (nearPit.dist < distPista) return ASFALTO;
        }

        const n = TG.normalAt(trackPts, idx, true);
        const lat = (x - p.x) * n.nx + (z - p.z) * n.nz;
        return superficieDaScostamento(lat, roadHalf, curbW, SEMI_LARGHEZZA_AUTO);
    }

    // Lo scossone di questo frame, in unità di gioco e radianti. `dx`/`dy` sono
    // in coordinate locali dell'auto (fianchi / verticale), `rollRad` è la
    // rotazione attorno all'asse di vista.
    function scossone(stato, { halo = false } = {}) {
        const mult = halo ? SCOSSONE_HALO_MULT : 1;
        const s1 = Math.sin(stato.fase1);
        const s2 = Math.sin(stato.fase2 * 1.61 + 1.3);
        const c1 = Math.cos(stato.fase1 * 0.87);
        const cordolo = stato.intCordolo * mult;
        const fuori = stato.intFuori * mult;
        return {
            dy: (cordolo * SCOSSONE_CORDOLO.dy + fuori * SCOSSONE_FUORI.dy) * (s1 * 0.7 + s2 * 0.3),
            dx: (cordolo * SCOSSONE_CORDOLO.dx + fuori * SCOSSONE_FUORI.dx) * s2,
            rollRad: (cordolo * SCOSSONE_CORDOLO.rollDeg + fuori * SCOSSONE_FUORI.rollDeg) * c1 * Math.PI / 180,
        };
    }

    // Dove si sposta la camera per una data spinta. Segni: spinta positiva
    // (accelerazione) arretra — dz negativo, cioè in direzione opposta al muso —
    // e abbassa; spinta negativa (frenata) fa l'opposto.
    //
    // `dz` è in coordinate LOCALI dell'auto, dove +Z è avanti: va bene anche
    // per il "guarda dietro", dove la camera sta davanti al musetto (z = +13).
    // Lì lo stesso segno significa che in accelerazione l'auto si avvicina alla
    // camera — che è esattamente ciò che accade nel mondo.
    function molla(spinta) {
        const s = clamp01(Math.abs(spinta)) * Math.sign(spinta || 0);
        return {
            dz: -MOLLA_ARRETRAMENTO * s,
            dy: -MOLLA_ABBASSAMENTO * s,
            // Aggiunta al beccheggio dell'halo-cam: accelerando lo sguardo si
            // alza (il muso si siede), frenando si abbassa.
            beccheggioDeg: -MOLLA_BECCHEGGIO_DEG * s,
        };
    }

    // Spinta desiderata dallo stato attuale dei due filtri, già normalizzata
    // sulle due scale misurate.
    function spintaObiettivo(stato) {
        if (stato.velVeloce === null) return 0;
        const scarto = stato.velVeloce - stato.velLenta;
        const scala = scarto >= 0 ? SCARTO_PIENO_ACCEL : SCARTO_PIENO_FRENO;
        const v = scarto / scala;
        return v > 1 ? 1 : (v < -1 ? -1 : v);
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
        const v = Math.abs(c.velocita || 0);

        if (c.attivo === false) {
            stato.fov = FOV_BASE;
            stato.spinta = 0;
            stato.intCordolo = 0;
            stato.intFuori = 0;
            // I filtri si scordano tutto: al rientro in pista il primo campione
            // li reinizializza, così una schermata durata dieci secondi non
            // produce una frenata immaginaria nel primo frame di gioco.
            stato.velVeloce = null;
            stato.velLenta = null;
            return stato;
        }

        if (stato.velVeloce === null) {
            stato.velVeloce = v;
            stato.velLenta = v;
        } else {
            stato.velVeloce = passoVersoObiettivo(stato.velVeloce, v, TAU_VEL_VELOCE_MS, dtMs);
            stato.velLenta = passoVersoObiettivo(stato.velLenta, v, TAU_VEL_LENTA_MS, dtMs);
        }
        stato.spinta = passoVersoObiettivo(stato.spinta, spintaObiettivo(stato), TAU_MOLLA_MS, dtMs);

        // Scossoni. L'intensità è proporzionale alla velocità in modo lineare,
        // senza la soglia del campo visivo: un cordolo preso a 60 km/h in uscita
        // dai box si sente poco, ma si sente.
        const fraGrezza = clamp01(v / VEL_RIFERIMENTO);
        stato.intCordolo = passoVersoObiettivo(stato.intCordolo,
            c.superficie === CORDOLO ? fraGrezza : 0, TAU_SCOSSONE_MS, dtMs);
        stato.intFuori = passoVersoObiettivo(stato.intFuori,
            c.superficie === FUORI ? fraGrezza : 0, TAU_SCOSSONE_MS, dtMs);

        // Le fasi avanzano alla frequenza della superficie che sta dominando, e
        // avanzano SEMPRE: nessun salto quando la vibrazione riparte.
        const somma = stato.intCordolo + stato.intFuori;
        const pesoCordolo = somma > 1e-6 ? stato.intCordolo / somma : 1;
        const hz1 = SCOSSONE_CORDOLO.hz1 * pesoCordolo + SCOSSONE_FUORI.hz1 * (1 - pesoCordolo);
        const hz2 = SCOSSONE_CORDOLO.hz2 * pesoCordolo + SCOSSONE_FUORI.hz2 * (1 - pesoCordolo);
        const dtS = Math.max(0, dtMs) / 1000;
        stato.fase1 = (stato.fase1 + 2 * Math.PI * hz1 * dtS) % (2 * Math.PI * 1000);
        stato.fase2 = (stato.fase2 + 2 * Math.PI * hz2 * dtS) % (2 * Math.PI * 1000);

        const obiettivo = fovObiettivo(c.velocita);
        stato.fov = passoVersoObiettivo(
            stato.fov,
            obiettivo,
            obiettivo > stato.fov ? TAU_APERTURA_MS : TAU_CHIUSURA_MS,
            dtMs,
        );
        return stato;
    }

    return {
        creaStato, avanza, molla, spintaObiettivo,
        scossone, superficieDaScostamento, superficieSottoAuto, SEMI_LARGHEZZA_AUTO,
        frazioneVelocita, fovObiettivo, passoVersoObiettivo, morbida, clamp01,
        VEL_RIFERIMENTO, FOV_BASE, FOV_MASSIMO, SOGLIA_APERTURA,
        TAU_APERTURA_MS, TAU_CHIUSURA_MS,
        TAU_VEL_VELOCE_MS, TAU_VEL_LENTA_MS, TAU_MOLLA_MS,
        SCARTO_PIENO_ACCEL, SCARTO_PIENO_FRENO,
        MOLLA_ARRETRAMENTO, MOLLA_ABBASSAMENTO, MOLLA_BECCHEGGIO_DEG,
        SCOSSONE_CORDOLO, SCOSSONE_FUORI, SCOSSONE_HALO_MULT, TAU_SCOSSONE_MS,
        ASFALTO, CORDOLO, FUORI,
    };

});
