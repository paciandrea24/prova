// frontend/shared/f1Particelle.js
//
// L'unico sistema particellare del gioco. Non ne esisteva nessun altro: c'era
// la scia (i cubetti di vento dietro l'auto in slipstream) scritta su misura
// dentro f1.js, e quando è servito un secondo effetto — la terra e la ghiaia
// che schizzano da sotto l'auto finita fuori pista — la scelta è stata
// generalizzare quella, non copiarla. Un sistema, due configurazioni.
//
// COSA FA E COSA NON FA. Qui vivono lo stato delle particelle e la loro
// evoluzione: nascita, velocità, gravità, turbolenza, invecchiamento,
// dissolvenza. Non c'è dentro una riga di Three.js: chi chiama costruisce la
// InstancedMesh e ci copia dentro le matrici. È il motivo per cui il moto si
// può verificare senza browser, che di un effetto particellare è l'unica parte
// verificabile — l'aspetto si guarda in pista.
//
// DUE SPAZI, LO STESSO CODICE. La scia vive in coordinate LOCALI dell'auto (è
// vento: sta attaccata alla vettura e la segue), i detriti in coordinate
// MONDO (sono terra: restano dove sono stati sollevati e l'auto se ne va). La
// differenza non è nel modulo — è solo quale `ancora` gli si passa e a quale
// oggetto è appesa la mesh.
//
// TUTTO A TEMPO, MAI A FRAME. La scia, prima di questo modulo, si muoveva di
// tot per FRAME: a 144 fps era due volte e mezzo più veloce e più corta che a
// 60, senza che nessuno lo avesse deciso. Qui le velocità sono in unità al
// secondo e le durate in millisecondi. A 60 fps il risultato è identico a
// quello di prima, che è l'aspetto già approvato.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Particelle = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // ── La scia ─────────────────────────────────────────────────────────────
    // Comportamento storico, convertito da "per frame a 60 fps" a "per secondo":
    // 0.09 unità/frame → 5.4 unità/s, 55 frame di vita → 917 ms.
    const SCIA = {
        numero: 22,
        dimensione: 0.16,
        vitaMs: 917,
        // Nasce appena dietro il paraurti, sparsa su tutta la larghezza.
        nascita: {
            avanti: [-5.4, -3.9],   // lungo l'asse dell'auto, negativo = dietro
            lato: [-1.1, 1.1],
            quota: [0.45, 0.95],
        },
        // Il vento scappa all'indietro e basta: nessuna gravità, è aria.
        velocita: { avanti: -5.4, lato: 0, quota: 0 },
        velocitaCasuale: { avanti: 0, lato: 0, quota: 0 },
        turbolenza: 0.72,           // unità/s di scarto casuale, in tutte le direzioni
        gravita: 0,
        scalaBase: [0.6, 1.3],
        // Frazione iniziale di vita in cui la particella cresce invece di
        // dissolversi. La dissolvenza è resa restringendo la scala e non con la
        // trasparenza: una InstancedMesh non ha un'opacità per istanza.
        crescita: 0.15,
        // La scia non tocca terra: nessun pavimento.
        pavimento: null,
    };

    // ── I detriti di erba e ghiaia ──────────────────────────────────────────
    // Nascono sotto l'auto — «che si veda partire dal fondo dell'auto, come a
    // dire sono finito fuori» — e sono l'opposto della scia in tutto: non
    // seguono la vettura, schizzano all'indietro e in alto, e ricadono.
    const DETRITI = {
        numero: 34,
        dimensione: 0.26,
        vitaMs: 900,
        // Sotto il fondo, all'altezza delle ruote posteriori: è da lì che la
        // terra parte davvero, ed è il punto che si vede dalla camera dietro.
        nascita: {
            avanti: [-3.4, -1.6],
            lato: [-1.7, 1.7],
            quota: [0.05, 0.35],
        },
        // Schizzo all'indietro e verso l'alto. La componente all'indietro è
        // molto minore di quella della scia perché queste particelle stanno nel
        // MONDO: è l'auto ad andarsene, non loro a restare indietro.
        velocita: { avanti: -1.5, lato: 0, quota: 3.4 },
        // Ogni zolla parte per conto suo, o sarebbe un ventaglio ordinato.
        velocitaCasuale: { avanti: 3.0, lato: 3.4, quota: 2.6 },
        turbolenza: 0.35,
        // Ricadono. È la sola cosa che dice "questa è materia e non vapore".
        gravita: -9.5,
        scalaBase: [0.5, 1.35],
        crescita: 0.08,
        // Quota sotto la quale una zolla si è posata: smette di cadere e finisce
        // lì la sua vita, invece di sprofondare sotto il prato.
        pavimento: 0,
    };

    function fra(rand, coppia) {
        return coppia[0] + rand() * (coppia[1] - coppia[0]);
    }

    function creaStato(config, rand = Math.random) {
        const n = config.numero;
        const stato = {
            x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
            vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
            eta: new Float32Array(n),          // ms vissuti
            scalaBase: new Float32Array(n),
            viva: new Uint8Array(n),
        };
        return stato;
    }

    // L'ancora è il sistema di riferimento in cui nasce una particella:
    // `{ x, y, z, avantiX, avantiZ }`. Per la scia è l'origine locale dell'auto
    // (0,0,0 con avanti = +Z), per i detriti la posizione dell'auto nel mondo con
    // la direzione in cui sta puntando. Il modulo non sa quale delle due sia.
    const ANCORA_LOCALE = { x: 0, y: 0, z: 0, avantiX: 0, avantiZ: 1 };

    function rinasci(stato, i, config, ancora, rand = Math.random) {
        const a = ancora || ANCORA_LOCALE;
        const ax = a.avantiX, az = a.avantiZ;
        // Destra = avanti ruotato di 90°. Serve a spargere le particelle sui
        // fianchi qualunque sia l'orientamento dell'auto.
        const dx = az, dz = -ax;

        const lungo = fra(rand, config.nascita.avanti);
        const lato = fra(rand, config.nascita.lato);

        stato.x[i] = a.x + ax * lungo + dx * lato;
        stato.z[i] = a.z + az * lungo + dz * lato;
        stato.y[i] = a.y + fra(rand, config.nascita.quota);

        const vLungo = config.velocita.avanti + (rand() - 0.5) * config.velocitaCasuale.avanti;
        const vLato = config.velocita.lato + (rand() - 0.5) * config.velocitaCasuale.lato;
        stato.vx[i] = ax * vLungo + dx * vLato;
        stato.vz[i] = az * vLungo + dz * vLato;
        stato.vy[i] = config.velocita.quota + (rand() - 0.5) * config.velocitaCasuale.quota;

        stato.eta[i] = 0;
        stato.scalaBase[i] = fra(rand, config.scalaBase);
        stato.viva[i] = 1;
    }

    // Sparge il pool su tutta la durata di vita invece di farlo nascere tutto
    // insieme: senza, il primo secondo di effetto è un unico sbuffo compatto che
    // poi sparisce di colpo, e si vede.
    function riempi(stato, config, ancora, rand = Math.random) {
        for (let i = 0; i < config.numero; i++) {
            rinasci(stato, i, config, ancora, rand);
            stato.eta[i] = rand() * config.vitaMs;
        }
        return stato;
    }

    // Fa avanzare tutte le particelle di `dtMs`.
    //
    // `emissione` 0..1 è quante ne rinascono: 1 = l'effetto è in corso e il pool
    // si ricicla tutto, 0 = l'effetto è finito e chi è ancora in aria finisce la
    // sua corsa senza che nessuno rinasca. È ciò che fa ricadere le ultime zolle
    // dopo che sei rientrato in pista, invece di spegnerle a mezz'aria.
    function avanza(stato, config, dtMs, { ancora = null, emissione = 1, rand = Math.random } = {}) {
        const dt = Math.max(0, dtMs) / 1000;
        const turb = config.turbolenza * dt;
        for (let i = 0; i < config.numero; i++) {
            if (!stato.viva[i]) {
                // Posto libero: rinasce solo se l'effetto è ancora acceso.
                if (emissione > 0 && rand() < emissione) rinasci(stato, i, config, ancora, rand);
                continue;
            }
            stato.eta[i] += dtMs;
            if (stato.eta[i] >= config.vitaMs) {
                if (emissione > 0 && rand() < emissione) rinasci(stato, i, config, ancora, rand);
                else stato.viva[i] = 0;
                continue;
            }
            stato.vy[i] += config.gravita * dt;
            stato.x[i] += stato.vx[i] * dt + (rand() - 0.5) * turb;
            stato.y[i] += stato.vy[i] * dt + (rand() - 0.5) * turb;
            stato.z[i] += stato.vz[i] * dt + (rand() - 0.5) * turb;

            if (config.pavimento != null && stato.y[i] < config.pavimento) {
                // Posata: si ferma dov'è invece di sprofondare, e da lì continua
                // solo a rimpicciolire fino a sparire.
                stato.y[i] = config.pavimento;
                stato.vx[i] = 0; stato.vy[i] = 0; stato.vz[i] = 0;
            }
        }
        return stato;
    }

    // Scala con cui disegnare la particella `i`: cresce appena nata, si
    // restringe verso la fine. Zero significa "non disegnarla".
    function scalaDi(stato, i, config) {
        if (!stato.viva[i]) return 0;
        const t = stato.eta[i] / config.vitaMs;
        const f = t < config.crescita
            ? (config.crescita > 0 ? t / config.crescita : 1)
            : 1 - (t - config.crescita) / (1 - config.crescita);
        return config.dimensione * stato.scalaBase[i] * Math.max(0, f);
    }

    return {
        SCIA, DETRITI,
        creaStato, riempi, rinasci, avanza, scalaDi,
        ANCORA_LOCALE,
    };

});
