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

    // ---- il parco chiuso ----------------------------------------------------
    //
    // Come per la classifica: nel documento stanno gli EVENTI, non i totali.
    // Un'usura salvata accanto agli eventi sarebbe un secondo posto dove vive
    // la stessa verità, e i due prima o poi divergono. Rif.
    // docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
    const COMPONENTI = ['frontWing', 'floor', 'engine', 'suspension'];

    // L'ala anteriore NON è del parco chiuso: è nuova ad ogni via e si cambia
    // ai box. Le altre tre si trascinano, e sono le uniche che l'officina può
    // sostituire.
    const COMPONENTI_PARCO_CHIUSO = ['floor', 'engine', 'suspension'];

    function vetturaNuova() {
        return { frontWing: 0, floor: 0, engine: 0, suspension: 0 };
    }

    // 0-100, e mai NaN: questi numeri arrivano dal server e finiscono nella
    // fisica, dove un NaN non si ferma più (stessa trappola documentata in
    // TyreModel.getWearPenaltyFactor).
    function percentuale(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    function normalizzaUsura(grezza) {
        const out = vetturaNuova();
        if (!grezza) return out;
        for (const c of COMPONENTI) out[c] = percentuale(grezza[c]);
        return out;
    }

    // Com'è ridotta la macchina di questo pilota ADESSO.
    //
    // L'usura registrata è già il TOTALE alla bandiera, non l'incremento di
    // quella gara: si prende l'ULTIMA, non si somma. Sommare la conterebbe due
    // volte, e dopo tre gare la macchina sarebbe distrutta senza motivo.
    //
    // I ricambi decisi in officina azzerano il loro componente, e vengono
    // applicati DOPO l'usura della gara a cui sono agganciati: è l'ordine in
    // cui i fatti sono successi.
    function statoVettura(stagione, idPilota) {
        const stato = vetturaNuova();
        for (const gara of (stagione && stagione.risultati) || []) {
            const registrata = gara.usura && gara.usura[idPilota];
            if (registrata) Object.assign(stato, normalizzaUsura(registrata));
            const ricambi = gara.ricambiDopo && gara.ricambiDopo[idPilota];
            for (const c of ricambi || []) {
                if (COMPONENTI.indexOf(c) >= 0) stato[c] = 0;
            }
        }
        return stato;
    }

    // Quante gare copre un ricambio. Su sei gare fa UN motore solo, ed e' il
    // freno vero: con un consumo del 18% a gara (USURA_MOTORE_PER_GARA in
    // f1GameSocket.js) il motore non arriva in fondo alla stagione, quindi il
    // ricambio SERVE — ma ne hai uno, e se lo spendi presto il secondo costa
    // cinque posizioni. La domanda diventa QUANDO, non SE.
    //
    // ⚠️ Questo numero e quello dell'usura sono la stessa manopola vista da due
    // lati: se un giorno l'usura cambia, questo va rifatto insieme. Una
    // dotazione larga con un'usura docile spegne l'economia in silenzio — la
    // penalita' non scatterebbe mai e l'officina sarebbe una formalita'.
    const DOTAZIONE_OGNI_N_GARE = 6;

    // Quanto costa sforare, in posizioni sulla griglia della gara successiva.
    // Tarati su griglie da 6-10 auto: mordono senza essere letali.
    const PENALITA_GRIGLIA = { engine: 5, suspension: 3, floor: 2 };

    function dotazione(stagione) {
        const gare = ((stagione && stagione.calendario) || []).length;
        const quanti = Math.max(1, Math.ceil(gare / DOTAZIONE_OGNI_N_GARE));
        const out = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) out[c] = quanti;
        return out;
    }

    // I ricambi decisi dopo la gara, ripuliti: solo componenti del parco
    // chiuso, senza duplicati. L'ala non passa di qui — e' gia' nuova ad ogni
    // via, non ha dotazione e non ha penalita'.
    function ricambiPuliti(elenco) {
        const visti = [];
        for (const c of elenco || []) {
            if (COMPONENTI_PARCO_CHIUSO.indexOf(c) >= 0 && visti.indexOf(c) < 0) visti.push(c);
        }
        return visti;
    }

    function ricambiUsati(stagione, idPilota) {
        const out = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) out[c] = 0;
        for (const gara of (stagione && stagione.risultati) || []) {
            for (const c of ricambiPuliti(gara.ricambiDopo && gara.ricambiDopo[idPilota])) out[c]++;
        }
        return out;
    }

    function ricambiRimasti(stagione, idPilota) {
        const totale = dotazione(stagione);
        const usati = ricambiUsati(stagione, idPilota);
        const out = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) out[c] = Math.max(0, totale[c] - usati[c]);
        return out;
    }

    // L'officina NON e' un momento, e' uno STATO: "questa stagione e' fra due
    // gare e per l'ultima corsa non risulta ancora una decisione". Chi chiude
    // il browser la ritrova riaprendo la stagione, senza aver perso la gara
    // appena corsa — e "nessun ricambio" e' comunque una decisione, che e' cio'
    // che la chiude.
    //
    // A stagione finita non si apre: non c'e' nessuna gara dopo da preparare.
    function officinaDaFare(stagione) {
        if (!stagione || !(stagione.risultati || []).length || finita(stagione)) return false;
        const ultima = stagione.risultati[stagione.risultati.length - 1];
        return !ultima.ricambiDopo;
    }

    // Attacca la decisione all'ULTIMA gara corsa. Riaprire l'officina e
    // cambiare idea SOSTITUISCE la decisione invece di sommarsi: altrimenti
    // un ripensamento consumerebbe due ricambi.
    //
    // Non muta: come registraRisultato, chi salva su Mongo deve poter fallire
    // senza aver gia' sporcato l'oggetto in memoria.
    function registraOfficina(stagione, { ricambi, adesso }) {
        if (!stagione || !(stagione.risultati || []).length) {
            throw new Error("non c'è nessuna gara da cui uscire");
        }
        const puliti = {};
        for (const id in (ricambi || {})) puliti[id] = ricambiPuliti(ricambi[id]);
        const risultati = stagione.risultati.slice();
        const ultimo = risultati[risultati.length - 1];
        risultati[risultati.length - 1] = Object.assign({}, ultimo, { ricambiDopo: puliti });
        return Object.assign({}, stagione, {
            risultati,
            aggiornataIl: adesso || new Date().toISOString(),
        });
    }

    // Quante posizioni perde questo pilota sulla griglia della PROSSIMA gara.
    //
    // Guarda solo l'ULTIMA officina: una penalita' gia' scontata non si paga
    // due volte. Si paga solo cio' che ha sforato la dotazione, e la dotazione
    // si conta ESCLUDENDO l'ultima officina — altrimenti il ricambio appena
    // deciso risulterebbe gia' speso e sembrerebbe sempre fuori quota.
    function penalitaGriglia(stagione, idPilota) {
        const risultati = (stagione && stagione.risultati) || [];
        if (!risultati.length) return 0;
        const ultimaOfficina = risultati[risultati.length - 1].ricambiDopo;
        const ultima = ricambiPuliti(ultimaOfficina && ultimaOfficina[idPilota]);
        if (!ultima.length) return 0;

        const totale = dotazione(stagione);
        const primaDiAdesso = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) primaDiAdesso[c] = 0;
        for (let i = 0; i < risultati.length - 1; i++) {
            for (const c of ricambiPuliti(risultati[i].ricambiDopo && risultati[i].ricambiDopo[idPilota])) {
                primaDiAdesso[c]++;
            }
        }

        let posizioni = 0;
        for (const c of ultima) {
            primaDiAdesso[c]++;
            if (primaDiAdesso[c] > totale[c]) posizioni += PENALITA_GRIGLIA[c] || 0;
        }
        return posizioni;
    }

    // Cosa sostituisce un bot fra una gara e l'altra. Regola dichiarata, non
    // un'IA: sopra la prima soglia finche' ha dotazione, sopra la seconda
    // anche accettando la penalita'. La seconda soglia serve a impedire che si
    // autopenalizzi ogni gara per un fondo mezzo consumato.
    //
    // La differenziazione per livello di difficolta' appartiene al blocco H
    // (bot competitivi) e qui non si fa.
    const SOGLIA_BOT_CON_DOTAZIONE = 60;
    const SOGLIA_BOT_SENZA_DOTAZIONE = 85;

    function ricambiDelBot(stagione, idPilota) {
        const stato = statoVettura(stagione, idPilota);
        const rimasti = ricambiRimasti(stagione, idPilota);
        const scelti = [];
        for (const c of COMPONENTI_PARCO_CHIUSO) {
            const soglia = rimasti[c] > 0 ? SOGLIA_BOT_CON_DOTAZIONE : SOGLIA_BOT_SENZA_DOTAZIONE;
            if (stato[c] > soglia) scelti.push(c);
        }
        return scelti;
    }

    // Registra il risultato della gara corrente e avanza. `ordine` è l'elenco
    // degli id dei piloti dal primo all'ultimo.
    //
    // Non muta: restituisce una stagione nuova. Chi salva su Mongo deve poter
    // fallire senza aver già sporcato l'oggetto in memoria.
    function registraRisultato(stagione, { ordine, usura, adesso }) {
        if (finita(stagione)) throw new Error('la stagione è già finita');
        const pista = garaCorrente(stagione);
        // L'usura si normalizza QUI, una volta, all'ingresso: da qui in poi
        // nessun altro deve chiedersi se quei numeri sono buoni.
        const usuraPulita = {};
        for (const id in (usura || {})) usuraPulita[id] = normalizzaUsura(usura[id]);
        return Object.assign({}, stagione, {
            giro: stagione.giro + 1,
            risultati: stagione.risultati.concat([{
                pista,
                ordine: (ordine || []).slice(),
                usura: usuraPulita,
            }]),
            aggiornataIl: adesso || new Date().toISOString(),
        });
    }

    // ---- la classifica ------------------------------------------------------

    // Ordina per punti; a pari punti conta chi ha i piazzamenti migliori (il
    // "countback" della F1 vera: più vittorie, poi più secondi posti, e così
    // via). Senza, due piloti a pari punti si ordinerebbero come capita, e
    // "come capita" in un campionato vuol dire che il campione cambia a
    // seconda di come è stato scritto un ciclo.
    //
    // `fermaA` conta solo le prime N gare: serve a mostrare la classifica
    // com'era PRIMA dell'ultima gara accanto a quella di adesso. È la stessa
    // somma fermata un passo indietro, non un secondo calcolo — due formule
    // per lo stesso totale sono due posti dove i numeri possono divergere.
    function classifica(stagione, opzioni) {
        const fermaA = (opzioni && opzioni.fermaA != null) ? opzioni.fermaA : Infinity;
        const righe = new Map();
        for (const p of stagione.piloti) {
            righe.set(p.id, {
                id: p.id, uid: p.uid, colore: p.colore, bot: p.bot, nome: p.nome,
                punti: 0, gare: 0, piazzamenti: [],
            });
        }
        for (const gara of stagione.risultati.slice(0, fermaA)) {
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

    // ---- la fine della stagione --------------------------------------------

    // I numeri di un pilota nella stagione. Tutti ricavati dai risultati: un
    // conteggio salvato accanto sarebbe un secondo posto dove vive lo stesso
    // numero, e prima o poi i due si contraddicono.
    function numeriDi(stagione, idPilota) {
        let gare = 0, vittorie = 0, podi = 0, punti = 0, miglioreArrivo = null;
        for (const gara of (stagione && stagione.risultati) || []) {
            const i = gara.ordine.indexOf(idPilota);
            if (i < 0) continue;
            const posizione = i + 1;
            gare += 1;
            punti += puntiPerPosizione(posizione);
            if (posizione === 1) vittorie += 1;
            if (posizione <= 3) podi += 1;
            if (miglioreArrivo === null || posizione < miglioreArrivo) miglioreArrivo = posizione;
        }
        // `miglioreArrivo` resta null per chi non ha mai corso: uno zero lì
        // verrebbe letto come una posizione.
        return { gare, vittorie, podi, punti, miglioreArrivo };
    }

    // Chi ha vinto il campionato, con quanto margine, e la classifica finale.
    function albo(stagione) {
        const finale = classifica(stagione);
        const campione = finale[0] || null;
        const secondo = finale[1] || null;
        return {
            campione,
            classifica: finale,
            gare: (stagione && stagione.risultati.length) || 0,
            margine: (campione && secondo) ? campione.punti - secondo.punti : 0,
        };
    }

    // La stagione raccontata gara per gara: serve al movimento in cui l'annata
    // scorre. La classifica di ogni voce è quella di QUEL momento, non quella
    // finale — è la sola cosa che permette di vedere il duello per il titolo
    // invece del suo risultato.
    function cronaca(stagione) {
        const piloti = new Map(((stagione && stagione.piloti) || []).map(p => [p.id, p]));
        return ((stagione && stagione.risultati) || []).map((gara, i) => {
            const progressiva = classifica(stagione, { fermaA: i + 1 });
            const vincitore = progressiva.find(r => r.id === gara.ordine[0])
                || piloti.get(gara.ordine[0]) || null;
            return { numero: i + 1, pista: gara.pista, vincitore, classifica: progressiva };
        });
    }

    // Tutto quello che serve alla schermata di riepilogo dopo una gara: com'è
    // finita quella gara, e cosa ha cambiato in campionato.
    //
    // Sta qui e non nella schermata perché è ancora aritmetica del campionato:
    // i punti presi sono `puntiPerPosizione`, e il movimento è la differenza
    // fra la stessa classifica fermata a due momenti diversi. Nella UI non
    // deve esistere nessuna somma — quella regola è già costata una volta
    // (vedi il commento in testa a questo file).
    //
    // `indice` è la gara nel calendario (0 = la prima), e deve essere una gara
    // già corsa: di una non ancora disputata non c'è niente da riepilogare.
    function riepilogoGara(stagione, indice) {
        if (!stagione || !(indice >= 0) || indice >= stagione.risultati.length) return null;
        const gara = stagione.risultati[indice];
        const anagrafica = new Map(stagione.piloti.map(p => [p.id, p]));

        const arrivo = gara.ordine.map((id, i) => {
            const p = anagrafica.get(id) || {};
            return {
                id, uid: p.uid || null, colore: p.colore || null,
                bot: !!p.bot, nome: p.nome || null,
                posizione: i + 1,
                puntiPresi: puntiPerPosizione(i + 1),
            };
        }).filter(r => anagrafica.has(r.id));   // un id sconosciuto non si disegna, ma la sua posizione resta occupata

        const prima = classifica(stagione, { fermaA: indice });
        const posizionePrima = new Map(prima.map(r => [r.id, r.posizione]));
        const presi = new Map(arrivo.map(r => [r.id, r.puntiPresi]));

        // Prima della PRIMA gara non esiste una classifica: sono tutti a pari
        // merito e l'ordine è solo quello in cui i piloti sono scritti.
        // Mostrare frecce rispetto a quello racconterebbe scalate mai
        // avvenute.
        const primaGara = indice === 0;

        const dopo = classifica(stagione, { fermaA: indice + 1 }).map((r) => {
            // Alla prima gara "dov'era prima" è dove è adesso: non esisteva una
            // classifica, e qualunque altro valore farebbe scorrere le righe da
            // un ordine che non ha mai voluto dire niente.
            const dovEra = primaGara ? r.posizione : (posizionePrima.get(r.id) || r.posizione);
            return Object.assign({}, r, {
                puntiPresi: presi.get(r.id) || 0,
                posizionePrima: dovEra,
                movimento: dovEra - r.posizione,
            });
        });

        return {
            pista: gara.pista,
            numero: indice + 1,
            totale: stagione.calendario.length,
            ultima: indice + 1 >= stagione.calendario.length,
            primaGara,
            arrivo, prima, dopo,
        };
    }

    // Di quale gara va mostrato il riepilogo, dato il segno lasciato prima di
    // tornare al calendario ({ stagioneId, pista }).
    //
    // Non basta "c'è un segno": deve essere il segno di QUESTA stagione e della
    // gara che risulta davvero corsa. Un segno rimasto in giro da un'altra
    // partita, o una gara il cui risultato non è stato registrato, darebbero il
    // riepilogo di una gara che non hai appena corso — ed è la stessa forma di
    // errore che nel progetto è già costata quattro volte: controllare che una
    // cosa esista invece di controllare che sia quella giusta.
    function garaDaRiepilogare(stagione, segno) {
        if (!stagione || !segno || !segno.stagioneId) return null;
        if (stagione._id !== segno.stagioneId) return null;
        const i = stagione.risultati.length - 1;
        if (i < 0) return null;
        if (segno.pista && stagione.risultati[i].pista !== segno.pista) return null;
        return i;
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
        COMPONENTI, COMPONENTI_PARCO_CHIUSO, vetturaNuova, statoVettura,
        DOTAZIONE_OGNI_N_GARE, PENALITA_GRIGLIA, dotazione,
        ricambiUsati, ricambiRimasti, registraOfficina, officinaDaFare, penalitaGriglia,
        SOGLIA_BOT_CON_DOTAZIONE, SOGLIA_BOT_SENZA_DOTAZIONE, ricambiDelBot,
        classifica, vittorie, riepilogoGara, garaDaRiepilogare,
        albo, numeriDi, cronaca, siPuoRiprendere,
    };

});
