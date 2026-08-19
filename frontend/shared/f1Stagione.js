// frontend/shared/f1Stagione.js
//
// Le regole del campionato: il calendario, i punti, la classifica, e quando
// una stagione può essere ripresa. Niente database, niente DOM, niente rete —
// solo dati che entrano e dati che escono, così si verifica tutto senza
// browser e senza Mongo.
//
// Sta in `shared/` perché la classifica la mostra il client ma la calcola
// anche il server (per decidere il campione a fine stagione), e due copie
// della stessa somma sono due posti dove il totale può divergere. Vedi
// f1BoxIngresso.js e la lezione che l'ha reso una regola del progetto.
//
// LA COSA DA NON DIMENTICARE: **la classifica non si salva, si calcola.**
// Nel documento della stagione ci sono solo i risultati delle gare corse. Un
// totale salvato accanto ai risultati è un secondo posto dove vive lo stesso
// numero, e prima o poi i due si contraddicono.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Stagione = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Il punteggio vero della F1. Niente punto del giro veloce: oggi il giro
    // veloce non è premiato da nessuna parte nel gioco, e introdurlo qui
    // vorrebbe dire spiegarlo nel tutorial. È una costante in un punto solo.
    const PUNTI = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

    // Quante gare può avere una stagione. Il minimo è un numero; il massimo è
    // quante piste ci sono, perché una pista non si ripete.
    //
    // ⚠️ Il massimo NON è "tutte le piste del gioco per forza": è il tetto.
    // Richiesta esplicita dell'utente — «non voglio che le stagioni siano
    // vincolate al numero totale di piste nel gioco», perché un giorno le
    // piste saranno tante o le creeranno gli utenti, e un campionato da
    // quaranta gare non lo vuole nessuno.
    const MIN_GARE = 3;
    const GARE_CONSIGLIATE = 8;

    function intervalloGare(nPiste) {
        const max = Math.max(1, nPiste | 0);
        const min = Math.min(MIN_GARE, max);
        return { min, max, consigliate: Math.min(Math.max(min, GARE_CONSIGLIATE), max) };
    }

    function puntiPerPosizione(posizione) {
        return PUNTI[posizione - 1] || 0;
    }

    // Mescola una copia (Fisher-Yates). `rng` iniettabile: senza, un test sul
    // sorteggio o è fragile o non esiste.
    function mescola(elenco, rng) {
        const r = rng || Math.random;
        const out = elenco.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            const t = out[i]; out[i] = out[j]; out[j] = t;
        }
        return out;
    }

    // N piste distinte, in ordine sorteggiato. Se se ne chiedono più di quante
    // ce ne sono, si prendono tutte: meglio una stagione più corta di una che
    // ripete una pista, che è la cosa che l'utente ha escluso.
    function sorteggiaCalendario(pisteDisponibili, quante, rng) {
        const n = Math.max(1, Math.min(quante | 0, pisteDisponibili.length));
        return mescola(pisteDisponibili, rng).slice(0, n);
    }

    // ---- il documento della stagione ---------------------------------------

    // L'identità di un pilota DENTRO la stagione. Non l'uid (i bot non ce
    // l'hanno) e non il colore (è un'etichetta di sessione, e la lezione sul
    // colore-come-identità è già stata pagata una volta lato lobby): una
    // stringa stabile assegnata alla creazione e mai più toccata. I risultati
    // delle gare parlano solo di questa.
    function idPilota(indice) {
        return 'p' + (indice + 1);
    }

    function creaStagione({ nome, creataDa, piloti, calendario, impostazioni, adesso }) {
        const ora = adesso || new Date().toISOString();
        return {
            nome: String(nome || '').trim() || 'Stagione senza nome',
            creataDa: creataDa || null,
            creataIl: ora,
            aggiornataIl: ora,
            piloti: (piloti || []).map((p, i) => ({
                id: idPilota(i),
                uid: p.uid || null,
                colore: p.colore || null,
                bot: !!p.bot,
                nome: p.nome || null,
            })),
            calendario: (calendario || []).slice(),
            giro: 0,
            risultati: [],
            impostazioni: impostazioni || {},
        };
    }

    function garaCorrente(stagione) {
        if (!stagione || stagione.giro >= stagione.calendario.length) return null;
        return stagione.calendario[stagione.giro];
    }

    function finita(stagione) {
        return !!stagione && stagione.giro >= stagione.calendario.length;
    }

    // Registra il risultato della gara corrente e avanza. `ordine` è l'elenco
    // degli id dei piloti dal primo all'ultimo.
    //
    // Non muta: restituisce una stagione nuova. Chi salva su Mongo deve poter
    // fallire senza aver già sporcato l'oggetto in memoria.
    function registraRisultato(stagione, { ordine, adesso }) {
        if (finita(stagione)) throw new Error('la stagione è già finita');
        const pista = garaCorrente(stagione);
        return Object.assign({}, stagione, {
            giro: stagione.giro + 1,
            risultati: stagione.risultati.concat([{ pista, ordine: (ordine || []).slice() }]),
            aggiornataIl: adesso || new Date().toISOString(),
        });
    }

    // ---- la classifica ------------------------------------------------------

    // Ordina per punti; a pari punti conta chi ha i piazzamenti migliori (il
    // "countback" della F1 vera: più vittorie, poi più secondi posti, e così
    // via). Senza, due piloti a pari punti si ordinerebbero come capita, e
    // "come capita" in un campionato vuol dire che il campione cambia a
    // seconda di come è stato scritto un ciclo.
    function classifica(stagione) {
        const righe = new Map();
        for (const p of stagione.piloti) {
            righe.set(p.id, {
                id: p.id, uid: p.uid, colore: p.colore, bot: p.bot, nome: p.nome,
                punti: 0, gare: 0, piazzamenti: [],
            });
        }
        for (const gara of stagione.risultati) {
            gara.ordine.forEach((id, i) => {
                const r = righe.get(id);
                if (!r) return;   // un id che non è in `piloti`: dato sporco, non deve far cadere la classifica
                r.punti += puntiPerPosizione(i + 1);
                r.gare += 1;
                r.piazzamenti[i] = (r.piazzamenti[i] || 0) + 1;
            });
        }
        const out = Array.from(righe.values());
        out.sort((a, b) => {
            if (b.punti !== a.punti) return b.punti - a.punti;
            const max = Math.max(a.piazzamenti.length, b.piazzamenti.length);
            for (let i = 0; i < max; i++) {
                const va = a.piazzamenti[i] || 0, vb = b.piazzamenti[i] || 0;
                if (va !== vb) return vb - va;
            }
            return 0;   // davvero indistinguibili: l'ordine di `piloti` fa da spareggio stabile
        });
        out.forEach((r, i) => { r.posizione = i + 1; });
        return out;
    }

    function vittorie(riga) {
        return riga.piazzamenti[0] || 0;
    }

    // ---- riprendere una stagione -------------------------------------------

    // Regola dettata dall'utente: un salvataggio si riprende **solo con
    // esattamente gli stessi giocatori** che l'hanno creato. Né uno in meno
    // (mancherebbe un pilota in classifica) né uno in più (non avrebbe un
    // posto in griglia né punti pregressi).
    //
    // ⚠️ Conseguenza da conoscere: se un amico non torna più, quel salvataggio
    // resta bloccato. Sostituirlo con un bot si potrebbe fare, ma cambia la
    // regola, quindi non si fa senza chiederglielo.
    function siPuoRiprendere(stagione, uidPresenti) {
        const attesi = stagione.piloti.filter(p => !p.bot && p.uid).map(p => p.uid);
        const presenti = new Set(uidPresenti || []);
        const mancanti = attesi.filter(uid => !presenti.has(uid));
        const inPiu = Array.from(presenti).filter(uid => !attesi.includes(uid));
        return { ok: mancanti.length === 0 && inPiu.length === 0, mancanti, inPiu };
    }

    return {
        PUNTI, MIN_GARE, GARE_CONSIGLIATE,
        intervalloGare, puntiPerPosizione, mescola, sorteggiaCalendario,
        idPilota, creaStagione, garaCorrente, finita, registraRisultato,
        classifica, vittorie, siPuoRiprendere,
    };

});
