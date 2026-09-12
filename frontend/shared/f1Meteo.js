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

    // Quanto spesso esce ognuno. NON equiprobabili: a pari peso venivano
    // quattro gare bagnate su cinque, e la pioggia diventava la norma invece di
    // un evento. Scelta dell'utente il 2026-09-12: asciutto nel 60% delle gare.
    // I pesi stanno qui e non in chi chiama perche' il meteo di una gara lo
    // decide questo modulo: al passo 3 diventeranno una probabilita' per pista,
    // e allora questa tabella sara' il valore di partenza da cui si scosta.
    const PESI_ARCHETIPI = {
        asciutto:           0.60,
        bagnatoCheScampa:   0.10,
        temporaleCheArriva: 0.12,
        rovescioBreve:      0.10,
        intermittente:      0.08,
    };

    // Pesca un archetipo secondo i pesi. ⚠️ Consuma UN solo numero del dado,
    // come la scelta uniforme che ha sostituito: cambiare quanti ne consuma
    // cambierebbe `forza` e `quando` di ogni gara gia' generata da un seme.
    function archetipoPesato(sorte) {
        let somma = 0;
        for (const nome of ARCHETIPI) somma += PESI_ARCHETIPI[nome] || 0;
        let soglia = (sorte || 0) * somma;
        for (const nome of ARCHETIPI) {
            soglia -= PESI_ARCHETIPI[nome] || 0;
            if (soglia < 0) return nome;
        }
        return ARCHETIPI[0];
    }

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
        const pescato = archetipoPesato(r());
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


    // ── LA GRIGLIA ──────────────────────────────────────────────────────────
    //
    // Una cella ogni PASSO_CELLA unita' di pista misurate SULL'ARCO (non ogni
    // N campioni: il campione vale 1.18 unita' su monte-rosso e 5.17 su prova,
    // e a campioni fissi la stessa taratura darebbe due cose diverse), per
    // CORSIE fasce in larghezza.
    //
    // Cinque corsie: due per la traiettoria larga, due per i bordi, una in
    // mezzo. Con tre la linea asciutta sarebbe larga mezza pista, con nove i
    // byte da mandare triplicherebbero senza che si veda la differenza.
    const PASSO_CELLA = 10;
    const CORSIE = 5;

    // Quanto bagna un diluvio: da asciutta a satura in venti secondi.
    // ⚠️ Il cielo dice il livello di EQUILIBRIO, non una spinta verso il
    // diluvio: con pioggia a 0.5 la pista si ferma a meta' bagnata e ci resta.
    // Spingendo sempre verso 1, una pioviggine residua da 0.02 teneva il bordo
    // pista saturo per SEMPRE, perche' l'evaporazione partiva solo a cielo
    // esattamente asciutto (trovato simulando una gara intera). Cosi' invece i
    // gradini di F3 si leggono direttamente come acqua sull'asfalto.
    const BAGNATURA_AL_SECONDO = 1 / 20;
    // L'evaporazione naturale: cinque minuti per asciugare da sola. Lavora
    // sempre, ma e' lenta quanto basta per non contare finche' piove.
    const EVAPORAZIONE_AL_SECONDO = 1 / 300;
    // Quanto porta via un'auto che attraversa UNA cella intera. Misurato per
    // DISTANZA e non per tempo: e' la gomma che spreme l'acqua, non il tempo
    // che passa — cosi' il risultato non dipende dal ritmo del tick.
    const ASCIUGATURA_PER_CELLA = 0.08;
    // Un'auto e' larga circa mezza corsia: bagna anche le vicine, o la linea
    // asciutta avrebbe un bordo a scalino invece di una sfumatura.
    const ASCIUGATURA_CORSIE_VICINE = 0.25;

    // Per ogni campione, in quale cella cade. Calcolato una volta per pista e
    // usato IDENTICO da server e client: e' la funzione che tiene allineata la
    // fisica col disegno.
    function celleDeiCampioni(points) {
        const n = points.length;
        const perCampione = new Int32Array(n);
        let arco = 0;
        for (let i = 0; i < n; i++) {
            perCampione[i] = Math.floor(arco / PASSO_CELLA);
            const b = points[(i + 1) % n];
            const a = points[i];
            arco += Math.hypot(b.x - a.x, b.z - a.z);
        }
        const nCelle = Math.max(1, Math.floor(arco / PASSO_CELLA) + 1);
        // L'ultima cella puo' essere piu' corta: i campioni che ci cadono
        // dentro vanno riportati nell'intervallo, o si leggerebbe fuori array.
        for (let i = 0; i < n; i++) if (perCampione[i] >= nCelle) perCampione[i] = nCelle - 1;
        return { nCelle, perCampione };
    }

    function nuovaGriglia(points, bagnatoIniziale) {
        const { nCelle, perCampione } = celleDeiCampioni(points);
        const valori = new Float32Array(nCelle * CORSIE);
        const v = Math.max(0, Math.min(1, bagnatoIniziale || 0));
        valori.fill(v);
        return { nCelle, perCampione, valori };
    }

    // Lo scostamento arriva NORMALIZZATO (-1 bordo destro, +1 sinistro) perche'
    // la mezza carreggiata cambia per tratto: normalizzare a valle vorrebbe
    // dire passare qui anche la larghezza, e prima o poi passarla sbagliata.
    function corsiaDi(scostamentoNorm) {
        const t = Math.max(-1, Math.min(1, scostamentoNorm || 0));
        return ((t + 1) / 2) * (CORSIE - 1);
    }

    function bagnatoIn(griglia, campione, scostamentoNorm) {
        const c = griglia.perCampione[Math.max(0, Math.min(griglia.perCampione.length - 1, campione | 0))] | 0;
        const f = corsiaDi(scostamentoNorm);
        const i0 = Math.floor(f), i1 = Math.min(CORSIE - 1, i0 + 1), k = f - i0;
        const base = c * CORSIE;
        return griglia.valori[base + i0] * (1 - k) + griglia.valori[base + i1] * k;
    }

    function limita(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    // Un tick di meteo: prima la pioggia (o l'evaporazione) su tutta la pista,
    // poi i passaggi delle auto. In quest'ordine, o un'auto asciugherebbe acqua
    // che in questo tick non e' ancora caduta.
    function avanza(griglia, dtMs, pioggia, passaggi) {
        const dt = Math.max(0, dtMs || 0) / 1000;
        const p = limita(pioggia);
        // Quanto ci si puo' muovere verso l'equilibrio in questo tick: bagnarsi
        // e' rapido (un diluvio satura in venti secondi), asciugarsi da soli e'
        // lento (cinque minuti). Sono due velocita' diverse, non due segni
        // della stessa.
        const suGiu = p * BAGNATURA_AL_SECONDO * dt;
        const giu = EVAPORAZIONE_AL_SECONDO * dt;
        const valori = griglia.valori;
        for (let i = 0; i < valori.length; i++) {
            const v = valori[i];
            if (v < p) valori[i] = limita(Math.min(p, v + suGiu));
            else if (v > p) valori[i] = limita(Math.max(p, v - giu));
        }

        for (const auto of (passaggi || [])) {
            const c = griglia.perCampione[Math.max(0, Math.min(griglia.perCampione.length - 1, auto.campione | 0))] | 0;
            const quota = Math.min(1, Math.abs(auto.distanza || 0) / PASSO_CELLA);
            if (quota <= 0) continue;
            const f = corsiaDi(auto.scostamentoNorm);
            const centro = Math.round(f);
            const base = c * CORSIE;
            for (let d = -1; d <= 1; d++) {
                const corsia = centro + d;
                if (corsia < 0 || corsia >= CORSIE) continue;
                const peso = d === 0 ? 1 : ASCIUGATURA_CORSIE_VICINE;
                const via = ASCIUGATURA_PER_CELLA * quota * peso;
                valori[base + corsia] = limita(valori[base + corsia] * (1 - via));
            }
        }
    }

    // ── LA RETE ─────────────────────────────────────────────────────────────
    //
    // Sedici livelli, due celle per byte. Nel caso peggiore (la pista piu'
    // lunga che esista, 7485 unita') sono 3745 celle in 1873 byte, mandati una
    // volta al secondo: meno del 3% di quel che il gioco manda gia' per le
    // posizioni a 20 Hz.
    //
    // ⚠️ Griglia INTERA e non differenze, per scelta: una differenza va
    // riapplicata nell'ordine giusto o il client divergerebbe in silenzio, e un
    // client che si aggancia a meta' gara dovrebbe comunque ricevere tutto.
    // Sedici livelli bastano: l'occhio non distingue un sedicesimo di lucido, e
    // la fisica legge la griglia del SERVER, non questa.
    const LIVELLI_RETE = 16;

    function impacchetta(griglia) {
        const v = griglia.valori;
        const out = new Uint8Array(Math.ceil(v.length / 2));
        for (let i = 0; i < v.length; i += 2) {
            const a = Math.round(limita(v[i]) * (LIVELLI_RETE - 1));
            const b = i + 1 < v.length ? Math.round(limita(v[i + 1]) * (LIVELLI_RETE - 1)) : 0;
            out[i >> 1] = (a << 4) | b;
        }
        return out;
    }

    function spacchetta(bytes, nCelle) {
        const totale = nCelle * CORSIE;
        const out = new Float32Array(totale);
        for (let i = 0; i < totale; i++) {
            const byte = bytes[i >> 1] || 0;
            const nibble = (i % 2 === 0) ? (byte >> 4) : (byte & 0x0f);
            out[i] = nibble / (LIVELLI_RETE - 1);
        }
        return out;
    }

    function applicaPacchetto(griglia, bytes) {
        const letti = spacchetta(bytes, griglia.nCelle);
        griglia.valori.set(letti.subarray(0, griglia.valori.length));
    }

    return {
        LIVELLI, ARCHETIPI, PESI_ARCHETIPI, SOGLIA_CAMBIO, generaProfilo, pioggiaA, previsione,
        PASSO_CELLA, CORSIE, BAGNATURA_AL_SECONDO, EVAPORAZIONE_AL_SECONDO, ASCIUGATURA_PER_CELLA,
        celleDeiCampioni, nuovaGriglia, corsiaDi, bagnatoIn, avanza,
        LIVELLI_RETE, impacchetta, spacchetta, applicaPacchetto,
    };
});
