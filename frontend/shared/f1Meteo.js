// frontend/shared/f1Meteo.js
//
// IL METEO. Unico proprietario di tre cose: quanto piove adesso, quanto e'
// bagnata la pista punto per punto, e la legge con cui si bagna e si asciuga.
// Rif. docs/superpowers/specs/2026-09-12-f1-pioggia-design.md.
//
// COSA FA E COSA NON FA. Qui non c'e' una riga di Three.js ne' di DOM: la
// fisica lo chiama dal server, il disegno lo chiama dal client, e i test lo
// chiamano senza browser. Chi disegna la pioggia sta in f1.js.
//
// ⚠️ UNA SOLA GRIGLIA, GROSSOLANA, PER TUTTI E DUE. Non una fine per la fisica
// e una riassunta per il disegno: l'asfalto che il giocatore vede asciutto e'
// lo stesso che il server calcola asciutto, per costruzione. Vedi la lezione
// della sosta perfetta irraggiungibile.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Meteo = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // I quattro gradini che cicla F3, e il vocabolario con cui si parla di
    // pioggia in tutto il gioco.
    const LIVELLI = { asciutto: 0, pioviggine: 0.35, pioggia: 0.7, diluvio: 1 };

    const ARCHETIPI = ['asciutto', 'bagnatoCheScampa', 'temporaleCheArriva', 'rovescioBreve', 'intermittente'];

    // Generatore deterministico (xorshift32). Serve che lo stesso seme dia lo
    // stesso meteo: e' l'unico modo di avere un test che verifica una STORIA
    // invece di sperare che il caso la produca.
    function dado(seme) {
        let s = (seme | 0) || 1;
        return function () {
            s ^= s << 13; s |= 0;
            s ^= s >>> 17;
            s ^= s << 5;  s |= 0;
            return ((s >>> 0) % 100000) / 100000;
        };
    }

    // Il profilo e' una polilinea (t, pioggia): pochi punti, letti per
    // interpolazione. Non e' un rumore per tick apposta — una gara deve avere
    // un ARCO (la pioggia che arriva a due terzi e costringe tutti dentro nello
    // stesso momento), e un arco si disegna, non si tira a sorte.
    function generaProfilo(seme, durataMs, opzioni) {
        const r = dado(seme);
        const o = opzioni || {};
        // ⚠️ Il dado si pesca SEMPRE, anche quando l'archetipo e' imposto: se
        // lo si saltasse, `forza` e `quando` leggerebbero il primo numero della
        // sequenza invece del secondo, e una gara di prova con l'archetipo
        // scelto a mano non avrebbe la stessa forma di quella vera con lo stesso
        // seme. Un banco che misura una cosa diversa da quella che gira e' la
        // trappola piu' costosa di questo progetto.
        const pescato = ARCHETIPI[Math.floor(r() * ARCHETIPI.length)];
        const archetipo = o.archetipo || pescato;
        const D = Math.max(1, durataMs || 0);
        const forza = 0.65 + r() * 0.35;        // 0.65..1
        const quando = 0.35 + r() * 0.3;        // 0.35..0.65 della gara
        const p = (frazione, valore) => ({ t: Math.round(D * frazione), pioggia: Math.max(0, Math.min(1, valore)) });

        let punti;
        switch (archetipo) {
            case 'bagnatoCheScampa':
                punti = [p(0, forza), p(quando * 0.6, forza * 0.7), p(quando, 0.08), p(1, 0)];
                break;
            case 'temporaleCheArriva':
                punti = [p(0, 0), p(quando, 0.05), p(quando + 0.2, forza * 0.6), p(1, forza)];
                break;
            case 'rovescioBreve':
                punti = [p(0, 0), p(quando - 0.12, 0.05), p(quando, forza), p(quando + 0.15, 0.1), p(1, 0.02)];
                break;
            case 'intermittente':
                punti = [p(0, 0.05), p(0.25, forza * 0.45), p(0.45, 0.08), p(0.7, forza * 0.5), p(1, 0.1)];
                break;
            case 'asciutto':
            default:
                punti = [p(0, 0), p(1, 0)];
                break;
        }
        return { archetipo, punti };
    }

    // Fuori dagli estremi NON si estrapola: si tiene il primo e l'ultimo
    // valore. Una gara che sfora la durata prevista (giro di rientro, finestra
    // di grazia) non deve far comparire una pioggia che il profilo non ha.
    function pioggiaA(profilo, tMs) {
        const punti = (profilo && profilo.punti) || [];
        if (!punti.length) return 0;
        const t = tMs || 0;
        if (t <= punti[0].t) return punti[0].pioggia;
        const ultimo = punti[punti.length - 1];
        if (t >= ultimo.t) return ultimo.pioggia;
        for (let i = 1; i < punti.length; i++) {
            if (t <= punti[i].t) {
                const a = punti[i - 1], b = punti[i];
                const k = (t - a.t) / Math.max(1, b.t - a.t);
                return a.pioggia + (b.pioggia - a.pioggia) * k;
            }
        }
        return ultimo.pioggia;
    }

    // LA PREVISIONE RISPONDE A «CHE GOMME METTO», NON A «CHE TEMPO FA FRA UN
    // MINUTO»: percio' guarda TUTTO IL RESTO DELLA SESSIONE, non una finestra.
    //
    // ⚠️ Qui c'era una finestra fissa di 90 secondi, come negli orologi della F1
    // vera, e a inizio gara diceva «stabile» davanti a un temporale: una gara
    // dura cinque minuti e il rovescio arriva fra il 35% e il 65%, cioe' sempre
    // FUORI da qualunque finestra abbastanza corta da chiamarsi finestra.
    // Allargarla al 70% della gara la faceva sconfinare oltre il traguardo, e
    // allora non era piu' una finestra: era il residuo. Quindi: il residuo.
    // La richiesta dell'utente era esattamente questa — «non si verificano
    // scenari dove il gioco non dice niente, selezioni le soft e poi invece
    // piove a dirotto».
    //
    // Si guardano il MASSIMO e il MINIMO del residuo, non il valore finale: un
    // rovescio che comincia e finisce nel mezzo della gara torna al punto di
    // partenza, e confrontando solo gli estremi si direbbe «stabile» proprio a
    // chi sta per prenderselo in faccia.
    //
    // NON dice a quale giro: la scelta delle gomme resta una scommessa, ma
    // informata.
    const SOGLIA_CAMBIO = 0.18;

    // Massimo e minimo della pioggia da tMs alla fine del profilo. Basta
    // guardare i VERTICI della polilinea piu' il valore di adesso: fra due
    // vertici la pioggia e' interpolata, quindi non puo' scavalcarli.
    function estremiResidui(profilo, tMs) {
        const punti = (profilo && profilo.punti) || [];
        const ora = pioggiaA(profilo, tMs);
        let max = ora, min = ora;
        const t = tMs || 0;
        for (let i = 0; i < punti.length; i++) {
            if (punti[i].t < t) continue;
            if (punti[i].pioggia > max) max = punti[i].pioggia;
            if (punti[i].pioggia < min) min = punti[i].pioggia;
        }
        return { ora, max, min };
    }

    function previsione(profilo, tMs) {
        const { ora, max, min } = estremiResidui(profilo, tMs);
        const sale = (max - ora) > SOGLIA_CAMBIO;
        const scende = (ora - min) > SOGLIA_CAMBIO;
        // Se sale e scende, il cielo e' solo «variabile»: dire «pioggia in
        // arrivo» a chi vedra' anche schiarire sarebbe meta' della verita'.
        if (sale && scende) return 'variabile';
        if (sale) return 'arrivo';
        if (scende) return 'variabile';
        return 'stabile';
    }

    return { LIVELLI, ARCHETIPI, SOGLIA_CAMBIO, generaProfilo, pioggiaA, previsione };
});
