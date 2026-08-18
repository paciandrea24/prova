// frontend/shared/f1Sting.js
//
// Stacco a tutto schermo in stile sigla televisiva: una lastra scura entra di
// taglio coprendo la scena, si ferma il tempo di far leggere due righe, poi
// esce dall'altra parte. Astratto di proposito — non c'è un logo da mostrare,
// e uno inventato invecchierebbe male.
//
// Nasce per la transizione fra qualifica e gara (richiesta utente
// 2026-08-18), ma è scritto per essere riusato ovunque serva coprire un
// cambio di scena o un caricamento: non sa niente di F1, di Three.js o della
// partita in corso. Si dà una durata, opzionalmente due righe di testo, e
// restituisce una Promise che si risolve quando lo schermo è di nuovo libero.
//
// Perché DOM e non un rendering nel canvas: deve poter coprire anche i
// momenti in cui il canvas non c'è ancora (caricamenti, cambi pagina), ed è
// esattamente lì che servirà la prossima volta.
//
// ── Cosa NON funzionava nella prima versione (playtest 2026-08-18) ──
// Sette bande orizzontali in cinque colori diversi, ognuna con la sua
// partenza sfalsata. L'utente l'ha vista come "un fascio di linee sull'azzurro
// giallo e nero, la velocità mi è sembrata un po' troppa, non ci ho capito
// niente" — ed è esattamente ciò che era: tanti elementi piccoli, tanti
// colori, nessuno abbastanza a lungo a schermo da essere letto. Il testo,
// che è l'unica informazione vera dello stacco, competeva con lo sfondo
// invece di essere servito da lui.
//
// Da cui le tre regole di questa versione:
//   1. POCHI elementi grandi, non tanti piccoli. Tre lastre, non sette bande.
//   2. UN accento solo su base scura. Il giallo è sparito: nero + azzurro si
//      legge come una sigla, nero + azzurro + giallo come un monoscopio.
//   3. La SOSTA è il momento più lungo. È lì che si legge, e prima non
//      esisteva davvero.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Sting = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const ID_STILE = 'f1-sting-style';
    const ID_NODO = 'f1-sting';

    // Durata di riferimento quando il chiamante non ne passa una.
    const DURATA_DEFAULT = 4200;
    // Sotto questa soglia non è uno stacco, è un lampo.
    const DURATA_MINIMA = 1200;

    // Frazioni della durata totale. La sosta si prende la fetta più grande:
    // è il momento in cui lo schermo è fermo e il testo si legge. Entrata e
    // uscita servono solo ad arrivarci e ad andarsene.
    const F_ENTRATA = 0.28;
    const F_SOSTA = 0.44;

    // Di quanto le due lastre secondarie precedono quella principale, in
    // frazione della durata d'entrata. Serve a dare spessore al movimento
    // senza aggiungere elementi che si notino da soli.
    const ANTICIPO = 0.18;

    function iniettaStile() {
        if (document.getElementById(ID_STILE)) return;
        const st = document.createElement('style');
        st.id = ID_STILE;
        st.textContent = `
            #${ID_NODO} {
                position: fixed; inset: 0; z-index: 200;
                overflow: hidden; pointer-events: none;
            }
            /* Le lastre sono più larghe dello schermo e inclinate: il taglio
               obliquo è ciò che le fa leggere come una sigla e non come una
               tendina, ma va sempre fuori quadro o si vedrebbero gli angoli
               scoperti mentre passa. */
            #${ID_NODO} .sting-lastra {
                position: absolute;
                top: -30vh; height: 160vh;
                left: -40vw; width: 180vw;
                transform: translateX(-200vw) skewX(-9deg);
                will-change: transform;
            }
            #${ID_NODO} .sting-l-principale { background: var(--hud-screen-bg, #12151b); }
            #${ID_NODO} .sting-l-mezza      { background: var(--hud-surface, #1c212a); }
            #${ID_NODO} .sting-l-accento    {
                background: var(--f1-telemetry, #39c7f2);
                width: 26vw; left: -13vw;
            }

            #${ID_NODO} .sting-testo {
                position: absolute; inset: 0;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 18px; text-align: center;
                font-family: 'Segoe UI', system-ui, sans-serif;
                padding: 0 6vw;
            }
            #${ID_NODO} .sting-titolo {
                font-size: clamp(34px, 7.5vw, 86px);
                font-weight: 900; letter-spacing: 0.12em; line-height: 1.05;
                color: var(--hud-text, #eef2f6);
                text-transform: uppercase;
                opacity: 0;
            }
            /* Filo d'accento sotto il titolo: cresce dal centro durante la
               sosta ed è l'unico elemento che si muove mentre si legge. */
            #${ID_NODO} .sting-filo {
                width: min(420px, 60vw); height: 3px;
                background: var(--f1-telemetry, #39c7f2);
                box-shadow: 0 0 18px var(--f1-telemetry, #39c7f2);
                transform: scaleX(0);
            }
            #${ID_NODO} .sting-sottotitolo {
                font-size: clamp(13px, 1.7vw, 20px);
                font-weight: 700; letter-spacing: 0.4em;
                color: var(--f1-text-dim, #8b96a3);
                text-transform: uppercase;
                opacity: 0;
            }
        `;
        document.head.appendChild(st);
    }

    function lastra(classe) {
        const d = document.createElement('div');
        d.className = 'sting-lastra ' + classe;
        return d;
    }

    function costruisci(titolo, sottotitolo) {
        const box = document.createElement('div');
        box.id = ID_NODO;

        // Ordine di sovrapposizione: l'accento è il bordo d'attacco, quindi
        // sta sotto alle altre due e sporge davanti a loro nel movimento.
        const accento = lastra('sting-l-accento');
        const mezza = lastra('sting-l-mezza');
        const principale = lastra('sting-l-principale');
        box.append(accento, mezza, principale);

        const testo = document.createElement('div');
        testo.className = 'sting-testo';
        const elTitolo = document.createElement('div');
        elTitolo.className = 'sting-titolo';
        elTitolo.textContent = titolo || '';
        const filo = document.createElement('div');
        filo.className = 'sting-filo';
        const elSotto = document.createElement('div');
        elSotto.className = 'sting-sottotitolo';
        elSotto.textContent = sottotitolo || '';
        testo.append(elTitolo, filo, elSotto);
        box.appendChild(testo);

        return { box, accento, mezza, principale, elTitolo, filo, elSotto };
    }

    // Ripiego senza anime.js: lo stacco non è mai un motivo per non far
    // proseguire ciò che copriva. Aspetta la durata e basta.
    function senzaAnimazioni(durata) {
        return new Promise(r => setTimeout(r, durata));
    }

    /**
     * Riproduce lo stacco.
     *
     * @param {object} opz
     * @param {number} [opz.durataMs]     quanto dura in tutto
     * @param {string} [opz.titolo]       riga grande al centro
     * @param {string} [opz.sottotitolo]  riga piccola sotto, spaziata
     * @returns {Promise<void>} risolta quando lo schermo è di nuovo libero
     */
    function play(opz) {
        const o = opz || {};
        const durata = Math.max(DURATA_MINIMA, o.durataMs || DURATA_DEFAULT);
        if (typeof document === 'undefined') return Promise.resolve();
        if (typeof anime !== 'function') return senzaAnimazioni(durata);

        iniettaStile();
        // Un solo stacco per volta: se ne parte un altro mentre uno è a
        // schermo, il primo sparisce invece di lasciare due strati sovrapposti.
        const precedente = document.getElementById(ID_NODO);
        if (precedente) precedente.remove();

        const el = costruisci(o.titolo, o.sottotitolo);
        document.body.appendChild(el.box);

        const tEntrata = durata * F_ENTRATA;
        const tSosta = durata * F_SOSTA;
        const tUscita = durata - tEntrata - tSosta;

        return new Promise(risolvi => {
            const linea = anime.timeline({
                complete: () => { el.box.remove(); risolvi(); },
            });

            // ── ENTRATA ────────────────────────────────────────────────
            // Le tre lastre attraversano da sinistra e si fermano a coprire
            // lo schermo. L'accento arriva per primo e si ferma poco oltre il
            // bordo destro: durante la sosta non si vede, ha già fatto il suo
            // lavoro passando.
            linea.add({
                targets: el.accento,
                translateX: ['-200vw', '120vw'],
                duration: tEntrata * 1.15,
                easing: 'easeInOutQuart',
            }, 0);
            linea.add({
                targets: el.mezza,
                translateX: ['-200vw', '0vw'],
                duration: tEntrata,
                easing: 'easeOutQuart',
            }, tEntrata * ANTICIPO);
            linea.add({
                targets: el.principale,
                translateX: ['-200vw', '0vw'],
                duration: tEntrata,
                easing: 'easeOutQuart',
            }, tEntrata * ANTICIPO * 2);

            // ── SOSTA ──────────────────────────────────────────────────
            // Lo schermo è fermo. Entra il titolo con le lettere che si
            // stringono, cresce il filo sotto, poi il sottotitolo. È il
            // momento più lungo dei tre: è qui che si legge.
            const inizioSosta = tEntrata + tEntrata * ANTICIPO * 2;
            if (o.titolo) {
                linea.add({
                    targets: el.elTitolo,
                    opacity: [0, 1],
                    letterSpacing: ['0.34em', '0.12em'],
                    duration: tSosta * 0.42,
                    easing: 'easeOutExpo',
                }, inizioSosta);
            }
            linea.add({
                targets: el.filo,
                scaleX: [0, 1],
                duration: tSosta * 0.5,
                easing: 'easeOutExpo',
            }, inizioSosta + tSosta * 0.16);
            if (o.sottotitolo) {
                linea.add({
                    targets: el.elSotto,
                    opacity: [0, 1], translateY: [12, 0],
                    duration: tSosta * 0.38,
                    easing: 'easeOutQuad',
                }, inizioSosta + tSosta * 0.3);
            }

            // ── USCITA ─────────────────────────────────────────────────
            // Tutto se ne va nella stessa direzione in cui è arrivato, come
            // un unico blocco: è l'uscita che "consegna" la scena sotto, e
            // due movimenti diversi la spezzerebbero. Il testo parte per
            // primo, così non lo si vede scorrere via deformato.
            const inizioUscita = inizioSosta + tSosta;
            linea.add({
                targets: [el.elTitolo, el.elSotto],
                opacity: 0,
                duration: tUscita * 0.28,
                easing: 'easeInQuad',
            }, inizioUscita);
            linea.add({
                targets: el.filo,
                scaleX: 0,
                duration: tUscita * 0.28,
                easing: 'easeInQuad',
            }, inizioUscita);
            linea.add({
                targets: [el.principale, el.mezza],
                translateX: ['0vw', '200vw'],
                delay: anime.stagger(tUscita * 0.12),
                duration: tUscita * 0.8,
                easing: 'easeInOutQuart',
            }, inizioUscita + tUscita * 0.2);
        });
    }

    // Toglie subito uno stacco a schermo, senza aspettare che finisca: serve
    // a chi deve annullare la transizione (una gara che riparte, un errore).
    function stop() {
        const n = document.getElementById(ID_NODO);
        if (n) n.remove();
    }

    return { play, stop, DURATA_DEFAULT, DURATA_MINIMA, F_ENTRATA, F_SOSTA };

});
