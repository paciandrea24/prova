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
    // Dal riepilogo non si torna indietro: si va AVANTI al calendario, e il
    // pulsante per farlo e' li' in mezzo alla schermata. La gara e' finita, non
    // c'e' niente a cui tornare.
    // Dall'albo d'oro nemmeno: una stagione finita non ha un calendario a cui
    // tornare. Si esce, e basta.
    const PRECEDENTE = {
        calendario: 'scelta', scelta: null, attesa: null, account: null,
        riepilogo: null, officina: null, albo: null,
    };
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
        for (const v of ['scelta', 'calendario', 'riepilogo', 'officina', 'albo', 'attesa', 'account']) {
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

    // I piloti umani non hanno un nome: la piattaforma li identifica col
    // COLORE, ed e' una scelta gia' presa altrove (mai nickname, solo colore).
    // Il pallino accanto fa il riconoscimento; qui basta distinguere se stessi
    // dagli altri.
    function etichettaPilota(riga, mioUid) {
        if (riga.bot) return riga.nome || 'Bot';
        return (riga.uid && riga.uid === mioUid) ? 'Tu' : 'Pilota';
    }

    // Una riga di elenco: posizione, colore, chi e', e un valore a destra.
    // La usano tutte e tre le liste (classifica del calendario, ordine
    // d'arrivo, classifica del riepilogo) — sono la stessa cosa vista in tre
    // momenti diversi, e tenerle uguali e' quello che le rende confrontabili
    // a colpo d'occhio.
    //
    // Fra il nome e il valore ci sta UNA colonna in piu', e le due che la
    // occupano non convivono mai: il movimento (in alto/in basso) e' roba del
    // riepilogo, le vittorie sono roba del calendario. Stessa griglia per
    // entrambe, cosi' le liste restano allineate anche affiancate.
    function rigaPilota({ posizione, colore, etichetta, valore, mio, delta, vittorie }) {
        const li = document.createElement('li');
        const colonnaInPiu = delta != null || vittorie != null;
        li.className = 'stagione-riga' + (mio ? ' sono-io' : '') + (colonnaInPiu ? ' con-colonna' : '');

        const pos = document.createElement('span');
        pos.className = 'stagione-pos';
        pos.textContent = String(posizione);

        const pallino = document.createElement('span');
        pallino.className = 'stagione-pallino';
        pallino.style.background = colore || '#888';

        const nome = document.createElement('span');
        nome.className = 'stagione-nome';
        // textContent e mai innerHTML: il nome di un bot lo decide il server,
        // ma questa funzione la useranno anche liste che non lo fanno.
        nome.textContent = etichetta;

        li.appendChild(pos);
        li.appendChild(pallino);
        li.appendChild(nome);

        if (delta != null) {
            const d = document.createElement('span');
            d.className = 'stagione-delta';
            li.appendChild(d);
            scriviDelta(d, delta);
        } else if (vittorie != null) {
            const w = document.createElement('span');
            w.className = 'stagione-vitt';
            // Zero vittorie si scrive con un trattino: una colonna di zeri
            // nasconde le poche righe che hanno un numero, che sono l'unica
            // ragione per cui la colonna esiste.
            w.textContent = vittorie ? String(vittorie) : '–';
            li.appendChild(w);
        }

        const val = document.createElement('span');
        val.className = 'stagione-punti';
        val.textContent = String(valore);
        li.appendChild(val);
        return li;
    }

    // L'intestazione della classifica: stessa griglia delle righe, cosi' ogni
    // colonna cade esattamente sopra i suoi numeri.
    function intestazioneClassifica() {
        const li = document.createElement('li');
        li.className = 'stagione-riga con-colonna stagione-testa';
        const colonne = [
            ['stagione-pos', '#'], ['stagione-pallino-vuoto', ''],
            ['stagione-nome', 'Pilota'], ['stagione-vitt', 'Vitt.'],
            ['stagione-punti', 'Punti'],
        ];
        for (const colonna of colonne) {
            const span = document.createElement('span');
            span.className = colonna[0];
            span.textContent = colonna[1];
            li.appendChild(span);
        }
        return li;
    }

    // ▲/▼ e di quanto. Glifi geometrici, non emoji (regola del progetto).
    function scriviDelta(nodo, delta) {
        if (!nodo) return;
        const su = delta > 0, giu = delta < 0;
        nodo.className = 'stagione-delta ' + (su ? 'su' : giu ? 'giu' : 'fermo');
        nodo.textContent = su ? '▲' + delta : giu ? '▼' + Math.abs(delta) : '–';
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
     * @param {string|null} opzioni.stagioneIniziale  la stagione gia' in corso,
     *        se si rientra dopo una sua gara: si apre direttamente su quella
     * @param {{stagioneId:string,pista:string}|null} opzioni.garaAppenaCorsa
     *        il segno lasciato prima di tornare al calendario: se c'e' ed e'
     *        di questa stagione, invece del calendario si apre il RIEPILOGO
     *        della gara. Chi lo raccoglie e lo cancella e' f1.js — qui non si
     *        sa niente di dove sia scritto.
     * @returns {{chiudi: () => void}}
     */
    function monta(opzioni) {
        const { socket, lobbyId, sonoHost, tokenDi, piste, mioUid, versoLobby,
            stagioneIniziale, garaAppenaCorsa } = opzioni;
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

        // Leggere una stagione e disegnarla sono due cose diverse: dal
        // riepilogo si passa al calendario senza rileggere niente, perche' la
        // stagione e' gia' in mano.
        async function mostraStagione(id, opzioni) {
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

            // Ci si arriva in due modi: rientrando da una gara appena corsa, e
            // allora si passa dal riepilogo; oppure aprendo la stagione, e
            // allora si va dritti al calendario. Quale dei due lo dice il segno
            // lasciato prima di ricaricare la pagina — e se quel segno vale
            // davvero lo dice F1Stagione.garaDaRiepilogare.
            const gara = (opzioni && opzioni.daGara)
                ? F1Stagione.garaDaRiepilogare(stagione, opzioni.daGara)
                : null;
            if (gara != null) disegnaRiepilogo(stagione, gara, ripresa);
            // Una stagione conclusa si apre sul suo albo d'oro: il calendario
            // non ha piu' niente da proporre.
            else if (F1Stagione.finita(stagione)) disegnaAlbo(stagione);
            // Chi ha chiuso il browser in officina la ritrova riaprendo la
            // stagione, senza aver perso la gara appena corsa: e' cio' che
            // rende vero "l'officina e' uno stato, non un momento".
            else if (F1Stagione.officinaDaFare(stagione)) disegnaOfficina(stagione, ripresa);
            else disegnaCalendario(stagione, ripresa);
        }

        function disegnaCalendario(stagione, ripresa) {
            testo(el('stagione-titolo'), stagione.nome);

            // Elimina compare solo a chi l'ha creata (il server rifiuta gli
            // altri comunque, ma un pulsante che non funziona e' peggio di un
            // pulsante che non c'e').
            const puoiEliminare = !!(mioUid && stagione.creataDa === mioUid);
            el('stagione-elimina').style.display = puoiEliminare ? '' : 'none';

            // A che punto si e' del campionato, accanto al titolo della
            // colonna: prima lo si poteva sapere solo contando le tappe
            // sbiadite.
            testo(el('stagione-a-che-punto'), F1Stagione.finita(stagione)
                ? `${stagione.calendario.length} gare, tutte corse`
                : `gara ${stagione.giro + 1} di ${stagione.calendario.length}`);

            const cal = el('stagione-calendario');
            cal.innerHTML = '';
            const anagrafica = new Map(stagione.piloti.map(p => [p.id, p]));
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
                // Su una tappa gia' corsa si scrive CHI L'HA VINTA: sbiadirla e
                // basta diceva che era passata, non com'e' andata.
                const gara = stagione.risultati[i];
                const vincitore = gara && anagrafica.get(gara.ordine[0]);
                if (vincitore) {
                    const chi = document.createElement('span');
                    chi.className = 'stagione-tappa-vinta';
                    const pallino = document.createElement('span');
                    pallino.className = 'stagione-pallino';
                    pallino.style.background = vincitore.colore || '#888';
                    const etichetta = document.createElement('span');
                    etichetta.textContent = etichettaPilota(vincitore, mioUid);
                    chi.appendChild(pallino);
                    chi.appendChild(etichetta);
                    li.appendChild(chi);
                }
                cal.appendChild(li);
            });

            const cls = el('stagione-classifica');
            cls.innerHTML = '';
            // L'intestazione esiste per una colonna sola: quella delle
            // VITTORIE. Senza, due piloti a pari punti stanno uno sopra
            // l'altro e non si capisce perche' — a decidere e' il countback, e
            // le vittorie sono la sua prima parola.
            cls.appendChild(intestazioneClassifica());
            for (const riga of F1Stagione.classifica(stagione)) {
                cls.appendChild(rigaPilota({
                    posizione: riga.posizione,
                    colore: riga.colore,
                    etichetta: etichettaPilota(riga, mioUid),
                    valore: riga.punti,
                    vittorie: F1Stagione.vittorie(riga),
                    mio: !!(riga.uid && riga.uid === mioUid),
                }));
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

        // ── il riepilogo di fine gara ──────────────────────────────────
        // Com'e' finita la gara appena corsa, e cosa ha cambiato in campionato.
        // Ci si passa soltanto: non e' una schermata che si possa riaprire.
        function disegnaRiepilogo(stagione, indice, ripresa) {
            const r = F1Stagione.riepilogoGara(stagione, indice);
            // Niente da riepilogare non e' un errore: e' una stagione aperta
            // normalmente, e il calendario e' esattamente dove si voleva
            // andare.
            if (!r) { disegnaCalendario(stagione, ripresa); return; }

            testo(el('stagione-titolo'), stagione.nome);
            testo(el('stagione-riepilogo-gara'),
                `Gara ${r.numero} di ${r.totale} · ${nomePista(piste, r.pista)}`);

            const arrivo = el('stagione-arrivo');
            arrivo.innerHTML = '';
            for (const x of r.arrivo) {
                const li = rigaPilota({
                    posizione: x.posizione,
                    colore: x.colore,
                    etichetta: etichettaPilota(x, mioUid),
                    // Fuori dai punti si scrive un trattino e non uno zero: da
                    // undicesimo in giu' non e' che hai preso zero punti, e'
                    // che i punti finiscono prima di te.
                    valore: x.puntiPresi ? '+' + x.puntiPresi : '–',
                    mio: !!(x.uid && x.uid === mioUid),
                });
                if (x.posizione === 1) li.classList.add('vincitore');
                arrivo.appendChild(li);
            }

            // Le righe nascono nell'ordine e coi numeri di PRIMA della gara:
            // e' da li' che parte l'animazione.
            const cls = el('stagione-riepilogo-classifica');
            cls.innerHTML = '';
            const righe = r.dopo.map((x) => {
                const li = rigaPilota({
                    posizione: x.posizionePrima,
                    colore: x.colore,
                    etichetta: etichettaPilota(x, mioUid),
                    valore: x.punti - x.puntiPresi,
                    mio: !!(x.uid && x.uid === mioUid),
                    // La colonna del movimento c'e' da subito anche se vuota:
                    // farla comparire alla fine sposterebbe tutte le altre.
                    delta: r.primaGara ? null : 0,
                });
                cls.appendChild(li);
                return { li, dati: x };
            });

            testo(el('stagione-riepilogo-nota'), r.ultima
                ? 'Era l’ultima gara del calendario.'
                : `Prossima: ${nomePista(piste, stagione.calendario[stagione.giro])}`);

            // Se quella era l'ultima gara di qui non si torna al calendario: si
            // va alla premiazione.
            const conclusa = F1Stagione.finita(stagione);
            const avanti = el('stagione-al-calendario');
            // Fra la gara e il calendario c'e' l'officina, se c'e' ancora da
            // decidere cosa sostituire. Il pulsante lo dice, invece di
            // promettere un calendario e portare altrove.
            const passaDaOfficina = !conclusa && F1Stagione.officinaDaFare(stagione);
            avanti.textContent = conclusa ? 'La premiazione'
                : (passaDaOfficina ? 'Vai in officina' : 'Vai al calendario');
            avanti.onclick = () => {
                if (passaDaOfficina) { disegnaOfficina(stagione, ripresa); return; }
                if (!conclusa) { disegnaCalendario(stagione, ripresa); return; }
                // La premiazione la mette in scena la pagina di gioco: qui si
                // sa chi ha vinto, non come si accende un podio. Se non si
                // puo' fare (WebGL in ginocchio, modello mancante) si va
                // all'albo lo stesso: la fine di una stagione non puo'
                // dipendere da un file .glb.
                const albo = F1Stagione.albo(stagione);
                const podio = albo.classifica.slice(0, 3).map(r => ({
                    uid: r.uid, colore: r.colore, bot: r.bot, punti: r.punti,
                    etichetta: etichettaPilota(r, mioUid),
                }));
                const tutti = albo.classifica.map(r => ({
                    uid: r.uid, colore: r.colore, bot: r.bot,
                }));
                // La cronaca arriva alla pagina di gioco gia' pronta da
                // scrivere a schermo: li' non si sa chi sia l'utente ne' come
                // si chiamino i circuiti, e non e' il caso di insegnarglielo.
                const cronaca = F1Stagione.cronaca(stagione).map(v => ({
                    numero: v.numero,
                    // L'id serve a caricare il file della pista per disegnarne
                    // la mappa; il nome serve a scriverlo a schermo.
                    pistaId: v.pista,
                    pista: nomePista(piste, v.pista),
                    vincitore: {
                        etichetta: v.vincitore ? etichettaPilota(v.vincitore, mioUid) : '—',
                        colore: v.vincitore ? v.vincitore.colore : null,
                    },
                    // I primi cinque, non i primi due: la schermata nuova ha
                    // una riga a barra per ciascuno, e cinque righe raccontano
                    // un campionato meglio di due.
                    testa: v.classifica.slice(0, 5).map(r => ({
                        etichetta: etichettaPilota(r, mioUid), colore: r.colore,
                        punti: r.punti, posizione: r.posizione,
                    })),
                }));
                const cerimonia = (typeof window !== 'undefined' && window.f1PremiazioneAvvia)
                    ? window.f1PremiazioneAvvia(podio, tutti, cronaca, stagione.nome)
                    : Promise.resolve(null);
                Promise.resolve(cerimonia).catch(() => null).then(() => disegnaAlbo(stagione));
            };

            // Prima si mostra, poi si anima: a schermata nascosta le righe non
            // hanno un'altezza, e l'animazione non saprebbe di quanto spostarle.
            mostraVista('riepilogo');
            animaClassifica(cls, righe);
        }

        // ── l'officina ────────────────────────────────────────────────
        // Fra il riepilogo della gara e il calendario. In stagione la macchina
        // non rinasce: qui si decide cosa sostituire sapendo che costa
        // posizioni in griglia.
        //
        // Nessuna regola vive qui, come in tutto questo file: quanto e'
        // consumata la macchina, quanti ricambi restano e quanto costa sforare
        // lo dice F1Stagione. Questa funzione disegna e chiede.
        //
        // L'ala anteriore non compare: e' gia' nuova ad ogni via, e si cambia
        // ai box durante la gara.
        const PEZZI = [
            { id: 'floor', nome: 'Fondo' },
            { id: 'engine', nome: 'Motore' },
            { id: 'suspension', nome: 'Sospensioni' },
        ];

        function disegnaOfficina(stagione, ripresa) {
            testo(el('stagione-titolo'), stagione.nome);
            const ultima = stagione.risultati[stagione.risultati.length - 1];
            testo(el('stagione-officina-gara'),
                ultima ? 'dopo ' + nomePista(piste, ultima.pista) : '—');
            testo(el('stagione-officina-errore'), '');

            const mio = (stagione.piloti || []).find(p => !p.bot && p.uid === mioUid);
            const stato = mio ? F1Stagione.statoVettura(stagione, mio.id) : F1Stagione.vetturaNuova();
            const totale = F1Stagione.dotazione(stagione);
            const rimasti = mio ? F1Stagione.ricambiRimasti(stagione, mio.id) : totale;
            testo(el('stagione-officina-dotazione'),
                'dotazione: ' + totale.engine
                + (totale.engine === 1 ? ' ricambio' : ' ricambi') + ' per componente');

            // La selezione vive QUI, non nel documento: finche' non si conferma
            // non e' successo niente, e riaprendo l'officina si riparte da come
            // sta davvero la macchina.
            let scelti = [];

            // La penalita' si vede PRIMA di confermare, e si aggiorna ad ogni
            // clic: e' la decisione, non la sua conseguenza.
            function penalitaScelta() {
                let somma = 0;
                for (const c of scelti) {
                    if ((rimasti[c] || 0) <= 0) somma += F1Stagione.PENALITA_GRIGLIA[c] || 0;
                }
                return somma;
            }

            function aggiornaNota() {
                const n = penalitaScelta();
                let frase;
                if (n) {
                    frase = 'Partirai ' + n + (n === 1 ? ' posizione' : ' posizioni')
                        + ' più indietro nella prossima gara.';
                } else if (scelti.length) {
                    frase = 'Nessuna penalità: sei dentro la dotazione.';
                } else {
                    frase = 'Puoi anche non toccare niente e correre così.';
                }
                testo(el('stagione-officina-nota'), frase);
            }

            const elenco = el('stagione-officina-pezzi');
            elenco.innerHTML = '';
            for (const pezzo of PEZZI) {
                const usura = Math.round(stato[pezzo.id] || 0);
                const quanti = rimasti[pezzo.id] || 0;
                const costo = F1Stagione.PENALITA_GRIGLIA[pezzo.id] || 0;

                const li = document.createElement('li');
                li.className = 'stagione-officina-pezzo' + (quanti > 0 ? '' : ' senza-ricambi');

                const nome = document.createElement('div');
                nome.className = 'stagione-officina-nome';
                nome.textContent = pezzo.nome;

                const colonna = document.createElement('div');
                colonna.className = 'stagione-officina-stato';
                const barra = document.createElement('div');
                barra.className = 'stagione-officina-barra';
                const riempimento = document.createElement('span');
                riempimento.style.width = Math.max(0, Math.min(100, usura)) + '%';
                barra.appendChild(riempimento);
                const cifre = document.createElement('div');
                cifre.className = 'stagione-officina-cifre';
                const consumo = document.createElement('span');
                consumo.textContent = 'consumato al ' + usura + '%';
                const scorta = document.createElement('span');
                scorta.textContent = quanti > 0 ? quanti + ' in dotazione' : 'dotazione esaurita';
                cifre.appendChild(consumo);
                cifre.appendChild(scorta);
                colonna.appendChild(barra);
                colonna.appendChild(cifre);

                // Il costo sta DENTRO il pulsante: e' l'informazione che decide
                // se premerlo, non una nota da cercare altrove.
                const bottone = document.createElement('button');
                bottone.type = 'button';
                bottone.className = 'stagione-btn';
                const scrivi = function () {
                    const preso = scelti.indexOf(pezzo.id) >= 0;
                    bottone.textContent = preso ? 'Sostituito' : 'Sostituisci';
                    const etichetta = document.createElement('span');
                    etichetta.className = 'stagione-officina-costo';
                    etichetta.textContent = quanti > 0 ? 'gratis' : '−' + costo + ' posizioni';
                    bottone.appendChild(etichetta);
                    li.classList.toggle('scelto', preso);
                };
                bottone.onclick = function () {
                    const i = scelti.indexOf(pezzo.id);
                    if (i >= 0) scelti.splice(i, 1); else scelti.push(pezzo.id);
                    scrivi();
                    aggiornaNota();
                };
                scrivi();

                li.appendChild(nome);
                li.appendChild(colonna);
                li.appendChild(bottone);
                elenco.appendChild(li);
            }
            aggiornaNota();

            const conferma = el('stagione-officina-conferma');
            conferma.disabled = false;
            conferma.onclick = async function () {
                conferma.disabled = true;
                testo(el('stagione-officina-errore'), '');
                try {
                    const risposta = await chiedi(tokenDi,
                        '/api/f1/stagioni/' + encodeURIComponent(stagione._id) + '/officina',
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ricambi: scelti }),
                        });
                    disegnaCalendario(risposta.stagione, ripresa);
                } catch (e) {
                    // Non si avanza. L'officina e' uno STATO: riaprendo la
                    // stagione ci si ritorna, quindi non c'e' niente da perdere
                    // a restare qui con l'errore scritto.
                    testo(el('stagione-officina-errore'),
                        'Non riesco a registrare i ricambi: ' + e.message);
                    conferma.disabled = false;
                }
            };

            mostraVista('officina');
        }

        // ── l'albo d'oro ───────────────────────────────────────────────
        // Una stagione finita non ha un calendario da mostrare: ha un
        // risultato. Ci si arriva a fine premiazione, e ci si torna ogni volta
        // che si riapre quella stagione.
        function disegnaAlbo(stagione) {
            const albo = F1Stagione.albo(stagione);
            const campione = albo.campione;
            testo(el('stagione-titolo'), stagione.nome);
            testo(el('stagione-albo-chi'), campione ? etichettaPilota(campione, mioUid) : '—');
            el('stagione-albo-pallino').style.background = (campione && campione.colore) || '#888';
            testo(el('stagione-albo-punti'), campione
                ? `${campione.punti} punti in ${albo.gare} ${albo.gare === 1 ? 'gara' : 'gare'}`
                : '');

            const cls = el('stagione-albo-classifica');
            cls.innerHTML = '';
            cls.appendChild(intestazioneClassifica());
            for (const riga of albo.classifica) {
                cls.appendChild(rigaPilota({
                    posizione: riga.posizione,
                    colore: riga.colore,
                    etichetta: etichettaPilota(riga, mioUid),
                    valore: riga.punti,
                    vittorie: F1Stagione.vittorie(riga),
                    mio: !!(riga.uid && riga.uid === mioUid),
                }));
            }

            // I numeri del campione, e — se il campione non sono io — anche i
            // miei: a chi guarda interessa com'e' andata a lui, non solo a chi
            // ha vinto.
            const mio = albo.classifica.find(r => r.uid && r.uid === mioUid);
            const suoi = campione ? F1Stagione.numeriDi(stagione, campione.id) : null;
            const miei = (mio && (!campione || mio.id !== campione.id))
                ? F1Stagione.numeriDi(stagione, mio.id) : null;
            const voci = [
                ['Gare corse', String(albo.gare)],
                ['Vittorie del campione', suoi ? String(suoi.vittorie) : '—'],
                ['Podi del campione', suoi ? String(suoi.podi) : '—'],
                ['Margine sul secondo', albo.margine ? `${albo.margine} punti` : 'nessuno'],
            ];
            if (miei) {
                voci.push(['I tuoi punti', String(miei.punti)]);
                voci.push(['Le tue vittorie', String(miei.vittorie)]);
                voci.push(['Il tuo miglior arrivo', miei.miglioreArrivo ? `${miei.miglioreArrivo}°` : '—']);
            }
            const numeri = el('stagione-albo-numeri');
            numeri.innerHTML = '';
            for (const voce of voci) {
                const riga = document.createElement('div');
                const dt = document.createElement('dt');
                dt.textContent = voce[0];
                const dd = document.createElement('dd');
                dd.textContent = voce[1];
                riga.appendChild(dt);
                riga.appendChild(dd);
                numeri.appendChild(riga);
            }

            testo(el('stagione-albo-nota'), campione && campione.uid && campione.uid === mioUid
                ? 'Campione del mondo.'
                : '');
            mostraVista('albo');
        }

        // Ogni riga sta gia' al suo posto FINALE nel DOM: quello che si anima
        // e' uno scostamento verticale che parte da dov'era prima e va a zero.
        // Riordinare i nodi a meta' corsa vorrebbe dire spostarli mentre si
        // stanno gia' muovendo.
        function animaClassifica(lista, righe) {
            const ATTESA = 550, DURATA = 900;

            function stampaFinale(x) {
                x.li.style.transform = '';
                x.li.querySelector('.stagione-pos').textContent = String(x.dati.posizione);
                x.li.querySelector('.stagione-punti').textContent = String(x.dati.punti);
                scriviDelta(x.li.querySelector('.stagione-delta'), x.dati.movimento);
            }

            const passo = righe.length > 1
                ? righe[1].li.getBoundingClientRect().top - righe[0].li.getBoundingClientRect().top
                : 0;
            const daMostrare = righe.some(x => x.dati.movimento !== 0 || x.dati.puntiPresi > 0);
            // Senza anime.js, o senza niente da animare, si va dritti allo
            // stato finale: una schermata ferma sui numeri VECCHI direbbe il
            // falso, ed e' peggio di una senza animazione.
            if (typeof anime !== 'function' || passo <= 0 || !daMostrare) {
                righe.forEach(stampaFinale);
                return;
            }

            lista.classList.add('in-movimento');
            for (const x of righe) {
                x.li.style.transform =
                    `translateY(${(x.dati.posizionePrima - x.dati.posizione) * passo}px)`;
            }

            // UN solo tempo per tutto: lo scorrimento delle righe, i punti che
            // salgono e la stampa dello stato finale. Con animazioni separate
            // piu' un setTimeout a chiuderle, l'ultima a terminare riscrive
            // quello che le altre hanno gia' finito — ed e' successo davvero:
            // le posizioni erano quelle nuove e i punti erano rimasti vecchi.
            const stato = { t: 0 };
            anime({
                targets: stato, t: 1,
                duration: DURATA, delay: ATTESA, easing: 'easeInOutQuad',
                update: () => {
                    const resta = 1 - stato.t;
                    for (const x of righe) {
                        const scarto = (x.dati.posizionePrima - x.dati.posizione) * passo * resta;
                        x.li.style.transform = `translateY(${scarto}px)`;
                        if (!x.dati.puntiPresi) continue;
                        x.li.querySelector('.stagione-punti').textContent =
                            String(Math.round(x.dati.punti - x.dati.puntiPresi * resta));
                    }
                },
                // Posizioni e frecce si scrivono solo qui: durante il movimento
                // direbbero un posto in cui la riga non e' ancora arrivata.
                complete: () => {
                    lista.classList.remove('in-movimento');
                    righe.forEach(stampaFinale);
                },
            });
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
        el('stagione-albo-esci').addEventListener('click', () => versoLobby && versoLobby());

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

        // Quale schermata si apre. Le condizioni sono in ordine di precedenza:
        // senza account non si fa niente comunque; poi, se si rientra da una
        // gara, si va DIRITTI su quella stagione; infine conta se ospiti.
        if (!mioUid) {
            mostraVista('account');
        } else if (stagioneIniziale) {
            // Rientro dopo una gara di campionato. Aprire l'elenco e passare
            // al calendario solo dopo la lettura faceva lampeggiare per un
            // paio di secondi la schermata "crea una nuova stagione", che e'
            // la cosa piu' lontana da quello che si sta facendo — segnalato in
            // playtest. Si aspetta in silenzio, con scritto cosa si aspetta.
            testo(el('stagione-attesa-testo'), 'Un momento…');
            mostraVista('attesa');
            mostraStagione(stagioneIniziale, { daGara: garaAppenaCorsa });
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
