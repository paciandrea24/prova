// frontend/shared/f1StagioneSchermate.js
//
// Le schermate del campionato dentro la pagina di gioco: scegli o crea, poi
// calendario e classifica.
//
// Qui non vive NESSUNA regola. I punti, l'ordine della classifica e il
// sorteggio del calendario li fa shared/f1Stagione.js, che gira uguale sul
// server (backend/routes/f1Stagioni.js richiede lo stesso file): due copie
// della stessa somma sono due posti dove il totale puo' divergere. Questo file
// disegna e chiede, e basta.
//
// E non conosce Firebase: riceve una `tokenDi()` da chi lo monta. L'unico
// posto che sa dell'autenticazione resta f1.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1StagioneSchermate = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const el = (id) => document.getElementById(id);

    function testo(nodo, valore) { if (nodo) nodo.textContent = valore; }

    // Chi ospita E ha un account. Letta da mostraVista, che gira anche prima
    // che monta() la calcoli: parte falsa, cioe' dal caso piu' prudente.
    let puoScegliere = false;

    // Da dove si torna indietro, e dove si va. L'elenco e' la radice: di li'
    // non c'e' un "indietro" dentro il campionato, si esce e basta — e per
    // uscire c'e' gia' il pulsante accanto.
    // Solo CHI OSPITA naviga: e' lui che sceglie il campionato, e la scelta
    // vale per tutti. Gli altri non hanno un elenco da sfogliare — aspettano,
    // e vengono portati dentro quando lui sceglie. Dal calendario si torna
    // all'elenco solo se quell'elenco e' tuo.
    const PRECEDENTE = { calendario: 'scelta', scelta: null, attesa: null, account: null };
    let vistaCorrente = 'attesa';

    // Il titolo dice dove SEI, e non e' sempre "le tue stagioni": a chi non ha
    // un account, e a chi sta aspettando che scelga qualcun altro, quella
    // frase prometteva una cosa che non poteva avere.
    const TITOLO = {
        scelta: 'Le tue stagioni',
        attesa: 'Campionato',
        account: 'Serve un account',
    };

    function mostraVista(quale) {
        vistaCorrente = quale;
        // Il calendario scrive il nome della stagione da se', appena l'ha
        // letta: non c'e' un titolo fisso da mettere qui.
        if (TITOLO[quale]) testo(el('stagione-titolo'), TITOLO[quale]);
        for (const v of ['scelta', 'calendario', 'attesa', 'account']) {
            const n = el('stagione-vista-' + v);
            if (n) n.style.display = (v === quale) ? '' : 'none';
        }
        const indietro = el('stagione-indietro');
        // Chi non ospita non ha un elenco a cui tornare: per lui "indietro"
        // non porta da nessuna parte.
        if (indietro) indietro.style.display = (PRECEDENTE[quale] && puoScegliere) ? '' : 'none';
        // Una conferma di cancellazione aperta non deve sopravvivere al cambio
        // di schermata: riapparirebbe puntata su una stagione diversa.
        const conferma = el('stagione-conferma');
        if (conferma) conferma.style.display = 'none';
    }

    // Ogni chiamata alle rotte porta il token: e' l'unica cosa che dice al
    // server chi sei. Senza, la rotta risponde 401 — ed e' giusto cosi'.
    async function chiedi(tokenDi, percorso, opzioni) {
        const token = await tokenDi();
        const intestazioni = Object.assign(
            { 'Authorization': 'Bearer ' + token },
            (opzioni && opzioni.headers) || {}
        );
        const risposta = await fetch(percorso, Object.assign({}, opzioni, { headers: intestazioni }));
        const dati = await risposta.json().catch(() => null);
        if (!risposta.ok) throw new Error((dati && dati.error) || 'Richiesta fallita');
        return dati;
    }

    function nomePista(piste, id) {
        const t = piste.find(p => p.id === id);
        return (t && t.name) || id;
    }

    /**
     * @param {object} opzioni
     * @param {object} opzioni.socket       il socket della partita
     * @param {string} opzioni.lobbyId
     * @param {boolean} opzioni.sonoHost    solo chi ospita sceglie il campionato
     * @param {() => Promise<string>} opzioni.tokenDi   token Firebase corrente
     * @param {Array<{id:string,name:string}>} opzioni.piste   da GET /api/f1/tracks
     * @param {string|null} opzioni.mioUid   per riconoscersi in classifica
     * @param {() => void} opzioni.versoLobby  come si esce dalla partita
     * @returns {{chiudi: () => void}}
     */
    function monta(opzioni) {
        const { socket, lobbyId, sonoHost, tokenDi, piste, mioUid, versoLobby } = opzioni;
        const overlay = el('stagione-overlay');
        overlay.style.display = 'flex';
        // Le due condizioni per poter scegliere un campionato: ospitare la
        // partita e avere un account. Senza account non si puo' nemmeno
        // guardare — la rotta che legge una stagione chiede di esserci dentro,
        // e chi non ha un uid non e' dentro da nessuna parte.
        puoScegliere = !!sonoHost && !!mioUid;

        // Quanti piloti si corre decide QUALI PISTE possono entrare in
        // calendario: una corsia box corta non ospita venti box (maxDrivers),
        // quindi con venti piloti quella pista non si corre. Non e' un tetto
        // sui piloti — quella strada bloccava ogni campionato appena esisteva
        // una pista stretta, e le piste le disegna l'utente.
        //
        // Di conseguenza il numero massimo di GARE dipende dal numero di
        // piloti, e va ricalcolato ogni volta che si cambia scaglione.
        const selPiloti = el('stagione-piloti');
        const selGare = el('stagione-gare');

        function pisteAdatteA(quantiPiloti) {
            return piste.filter(p => (p.maxDrivers || 20) >= quantiPiloti);
        }

        function aggiornaGare() {
            const quanti = parseInt(selPiloti.value, 10) || 6;
            const adatte = pisteAdatteA(quanti);
            const intervallo = F1Stagione.intervalloGare(adatte.length);
            const primaValore = parseInt(selGare.value, 10);
            selGare.min = intervallo.min;
            selGare.max = intervallo.max;
            // Si tiene la scelta di prima se ci sta ancora, invece di
            // rimetterla al consigliato ad ogni cambio di scaglione.
            selGare.value = (primaValore >= intervallo.min && primaValore <= intervallo.max)
                ? primaValore : intervallo.consigliate;
            testo(el('stagione-gare-aiuto'), adatte.length === piste.length
                ? `da ${intervallo.min} a ${intervallo.max} — una pista non si ripete`
                : `da ${intervallo.min} a ${intervallo.max} — con ${quanti} piloti solo ${adatte.length} piste su ${piste.length} hanno i box per tutti`);
        }

        // Uno scaglione che lascia meno piste del minimo di gare non e'
        // giocabile: resta VISIBILE e spiegato invece di sparire, perche'
        // sparendo sembrerebbe un limite del gioco e non delle piste. Stessa
        // scelta gia' fatta in lobby (vedi aggiornaScaglioniPiloti).
        let ripiego = null;
        for (const opt of selPiloti.options) {
            const n = parseInt(opt.value, 10);
            const adatte = pisteAdatteA(n).length;
            opt.disabled = adatte < F1Stagione.MIN_GARE;
            opt.textContent = opt.disabled
                ? `${n} — solo ${adatte} ${adatte === 1 ? 'pista ha' : 'piste hanno'} i box per tutti`
                : String(n);
            if (!opt.disabled) ripiego = opt.value;
        }
        if (selPiloti.selectedOptions[0] && selPiloti.selectedOptions[0].disabled && ripiego) {
            selPiloti.value = ripiego;
        }
        selPiloti.addEventListener('change', aggiornaGare);
        aggiornaGare();

        function errore(messaggio) {
            const n = el('stagione-errore');
            n.textContent = messaggio || '';
            n.style.display = messaggio ? '' : 'none';
        }

        async function caricaElenco() {
            const lista = el('stagione-elenco');
            lista.innerHTML = '';
            let stagioni = [];
            try {
                stagioni = (await chiedi(tokenDi, '/api/f1/stagioni')).stagioni || [];
            } catch (e) {
                errore('Non riesco a leggere le tue stagioni: ' + e.message);
                return;
            }
            el('stagione-elenco-vuoto').style.display = stagioni.length ? 'none' : '';
            for (const s of stagioni) {
                const li = document.createElement('li');
                li.className = 'stagione-voce';
                const conclusa = s.giro >= s.calendario.length;
                // textContent e mai innerHTML per il nome: lo scrive un
                // giocatore, e finisce sotto gli occhi degli altri.
                const nome = document.createElement('span');
                nome.className = 'stagione-voce-nome';
                nome.textContent = s.nome;
                const stato = document.createElement('span');
                stato.className = 'stagione-voce-stato';
                stato.textContent = conclusa
                    ? 'conclusa'
                    : `gara ${s.giro + 1} di ${s.calendario.length}`;
                li.appendChild(nome);
                li.appendChild(stato);
                li.addEventListener('click', () => scegli(s._id));
                lista.appendChild(li);
            }
        }

        async function crea() {
            errore('');
            el('stagione-crea').disabled = true;
            try {
                const { stagione } = await chiedi(tokenDi, '/api/f1/stagioni', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lobbyId,
                        nome: el('stagione-nome').value,
                        quanteGare: Number(el('stagione-gare').value),
                        gridSize: Number(el('stagione-piloti').value),
                    }),
                });
                scegli(stagione._id);
            } catch (e) {
                errore(e.message);
            } finally {
                el('stagione-crea').disabled = false;
            }
        }

        // Sceglierla e' un atto di chi ospita e vale per TUTTI: si passa dal
        // server, che la rimbalza a tutta la lobby (f1StagioneScelta). Anche
        // per se stessi — cosi' esiste un solo percorso, e chi ospita vede
        // esattamente quello che vedono gli altri.
        function scegli(id) {
            socket.emit('f1StagioneScelta', { lobbyId, stagioneId: id });
        }

        let apertaId = null;

        async function mostraStagione(id) {
            let stagione, ripresa;
            try {
                const risposta = await chiedi(tokenDi, '/api/f1/stagioni/'
                    + encodeURIComponent(id) + '?lobbyId=' + encodeURIComponent(lobbyId));
                stagione = risposta.stagione;
                ripresa = risposta.ripresa;
            } catch (e) {
                // Chi non ospita non ha un elenco su cui ripiegare: torna ad
                // aspettare, con scritto cosa e' andato storto.
                if (puoScegliere) {
                    errore('Non riesco ad aprire la stagione: ' + e.message);
                    mostraVista('scelta');
                } else {
                    testo(el('stagione-attesa-testo'), 'Non riesco ad aprire il campionato: ' + e.message);
                    mostraVista('attesa');
                }
                return;
            }
            apertaId = stagione._id;
            testo(el('stagione-titolo'), stagione.nome);

            // Elimina compare solo a chi l'ha creata (il server rifiuta gli
            // altri comunque, ma un pulsante che non funziona e' peggio di un
            // pulsante che non c'e').
            const puoiEliminare = !!(mioUid && stagione.creataDa === mioUid);
            el('stagione-elimina').style.display = puoiEliminare ? '' : 'none';

            const cal = el('stagione-calendario');
            cal.innerHTML = '';
            stagione.calendario.forEach((pistaId, i) => {
                const li = document.createElement('li');
                li.className = 'stagione-tappa'
                    + (i < stagione.giro ? ' corsa' : '')
                    + (i === stagione.giro ? ' prossima' : '');
                const n = document.createElement('span');
                n.className = 'stagione-tappa-n';
                n.textContent = String(i + 1);
                const nome = document.createElement('span');
                nome.className = 'stagione-tappa-nome';
                nome.textContent = nomePista(piste, pistaId);
                li.appendChild(n);
                li.appendChild(nome);
                cal.appendChild(li);
            });

            const cls = el('stagione-classifica');
            cls.innerHTML = '';
            for (const riga of F1Stagione.classifica(stagione)) {
                const li = document.createElement('li');
                li.className = 'stagione-riga';
                const pos = document.createElement('span');
                pos.className = 'stagione-pos';
                pos.textContent = String(riga.posizione);
                const pallino = document.createElement('span');
                pallino.className = 'stagione-pallino';
                pallino.style.background = riga.colore || '#888';
                const nome = document.createElement('span');
                nome.className = 'stagione-nome';
                // I piloti umani non hanno un nome: la piattaforma li
                // identifica col COLORE, ed e' una scelta gia' presa altrove
                // (mai nickname, solo colore). Il pallino accanto fa il
                // riconoscimento; qui basta distinguere se stessi dagli altri.
                nome.textContent = riga.bot ? (riga.nome || 'Bot')
                    : (riga.uid && riga.uid === mioUid ? 'Tu' : 'Pilota');
                const punti = document.createElement('span');
                punti.className = 'stagione-punti';
                punti.textContent = String(riga.punti);
                li.appendChild(pos); li.appendChild(pallino);
                li.appendChild(nome); li.appendChild(punti);
                cls.appendChild(li);
            }

            const finita = F1Stagione.finita(stagione);
            const prossima = F1Stagione.garaCorrente(stagione);
            testo(el('stagione-prossima'), finita
                ? 'Stagione conclusa'
                : `Prossima: ${nomePista(piste, prossima)}`);

            // Si corre se: la stagione non e' finita, la si puo' riprendere con
            // i giocatori che ci sono adesso, e sei tu a ospitare. Le tre
            // condizioni le fa rispettare il server comunque — qui servono
            // solo a non offrire un pulsante che poi non fa niente.
            const puoiCorrere = !finita && (!ripresa || ripresa.ok) && puoScegliere;
            el('stagione-corri').disabled = !puoiCorrere;
            // A chi non ospita il pulsante non si mostra affatto: la gara la
            // lancia chi ospita, e gli altri vengono portati in pista con lui.
            el('stagione-corri').style.display = puoScegliere ? '' : 'none';

            if (ripresa && !ripresa.ok) {
                const quanti = ripresa.mancanti.length;
                testo(el('stagione-nota'), quanti
                    ? `Manca ${quanti === 1 ? 'un pilota' : quanti + ' piloti'} di questa stagione: si riprende solo con gli stessi giocatori.`
                    : 'In pista c’è qualcuno che non fa parte di questa stagione: si riprende solo con gli stessi giocatori.');
            } else if (finita) {
                testo(el('stagione-nota'), 'Tutte le gare sono state corse.');
            } else if (!puoScegliere) {
                testo(el('stagione-nota'), 'La gara la lancia chi ospita.');
            } else {
                testo(el('stagione-nota'), '');
            }
            mostraVista('calendario');
        }

        // ── navigazione ────────────────────────────────────────────────
        function tornaIndietro() {
            const dove = PRECEDENTE[vistaCorrente];
            if (!dove) return;
            // Vale anche per Esc, non solo per il pulsante: chi non ospita non
            // ha un elenco a cui tornare, e non deve poterci finire premendo
            // un tasto.
            if (!puoScegliere) return;
            if (dove === 'scelta') {
                // Rientrando nell'elenco lo si rilegge: una stagione appena
                // creata o appena cancellata deve trovarsi al posto giusto.
                apertaId = null;
                errore('');
                caricaElenco();
            }
            mostraVista(dove);
        }

        el('stagione-indietro').addEventListener('click', tornaIndietro);
        el('stagione-esci').addEventListener('click', () => versoLobby && versoLobby());

        // Esc fa la stessa cosa del pulsante: e' il gesto che chiunque prova
        // per primo per tornare indietro.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (el('stagione-overlay').style.display === 'none') return;
            if (el('stagione-conferma').style.display !== 'none') {
                el('stagione-conferma').style.display = 'none';
                return;
            }
            tornaIndietro();
        });

        // ── eliminazione ───────────────────────────────────────────────
        el('stagione-elimina').addEventListener('click', () => {
            el('stagione-conferma').style.display = 'flex';
        });
        el('stagione-conferma-no').addEventListener('click', () => {
            el('stagione-conferma').style.display = 'none';
        });
        el('stagione-conferma-si').addEventListener('click', async () => {
            if (!apertaId) return;
            el('stagione-conferma-si').disabled = true;
            try {
                await chiedi(tokenDi, '/api/f1/stagioni/' + encodeURIComponent(apertaId), { method: 'DELETE' });
                apertaId = null;
                mostraVista('scelta');
                caricaElenco();
            } catch (e) {
                errore('Non riesco a cancellarla: ' + e.message);
            } finally {
                el('stagione-conferma-si').disabled = false;
                el('stagione-conferma').style.display = 'none';
            }
        });

        el('stagione-corri').addEventListener('click', () => {
            // Un solo via, anche se si preme due volte: il secondo clic
            // arriverebbe mentre la pagina sta gia' per ricaricarsi.
            el('stagione-corri').disabled = true;
            testo(el('stagione-nota'), 'Si va in pista…');
            socket.emit('f1StagioneCorri', { lobbyId });
        });

        el('stagione-crea').addEventListener('click', crea);
        // Chi ospita ha scelto: da qui in poi il campionato e' quello, per
        // tutti. Anche chi sta aspettando viene portato dentro — e' la
        // richiesta dell'utente: "appena l'host la avvia, anche gli altri
        // giocatori inclusi vengono portati verso la stagione".
        socket.on('f1StagioneScelta', ({ stagioneId }) => {
            if (!stagioneId) return;
            // Senza account non c'e' niente da mostrargli: la stagione si
            // legge solo se ci si corre dentro, e lui non e' dentro da
            // nessuna parte. Resta sulla sua schermata, che spiega perche'.
            if (!mioUid) return;
            mostraStagione(stagioneId);
        });

        // Quale schermata si apre. Le tre condizioni sono in ordine di
        // precedenza: senza account non si fa niente comunque, poi conta se
        // ospiti.
        if (!mioUid) {
            mostraVista('account');
        } else if (sonoHost) {
            mostraVista('scelta');
            caricaElenco();
        } else {
            mostraVista('attesa');
        }

        return {
            chiudi() { overlay.style.display = 'none'; },
        };
    }

    return { monta };
});
