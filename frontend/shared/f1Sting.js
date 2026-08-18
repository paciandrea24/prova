// frontend/shared/f1Sting.js
//
// Stacco a tutto schermo in stile sigla televisiva: bande diagonali che
// spazzano lo schermo, si comprimono in una lama di luce al centro e si
// riaprono. Astratto di proposito — non c'è un logo da mostrare, e uno
// inventato invecchierebbe male.
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
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Sting = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const ID_STILE = 'f1-sting-style';
    const ID_NODO = 'f1-sting';

    // Quante bande diagonali. Sotto le 5 si legge come una tendina, sopra le
    // 9 diventano un pettine grigio: nessuna singola banda si distingue più.
    const BANDE = 7;

    // Frazioni della durata totale. Il senso: entrata rapida (una sigla
    // comincia sempre di scatto), sosta breve, uscita più lenta della
    // entrata — è l'uscita che deve "consegnare" la scena sotto.
    const F_ENTRATA = 0.34;
    const F_SOSTA = 0.26;

    function iniettaStile() {
        if (document.getElementById(ID_STILE)) return;
        const st = document.createElement('style');
        st.id = ID_STILE;
        st.textContent = `
            #${ID_NODO} {
                position: fixed; inset: 0; z-index: 200;
                overflow: hidden; pointer-events: none;
                background: transparent;
            }
            #${ID_NODO} .sting-fondo {
                position: absolute; inset: 0;
                background: var(--hud-screen-bg, #12151b);
                opacity: 0;
            }
            /* Le bande sono più larghe dello schermo e ruotate: così i bordi
               obliqui non lasciano mai scoperti gli angoli mentre spazzano. */
            #${ID_NODO} .sting-banda {
                position: absolute;
                left: -60vw; width: 220vw;
                transform-origin: center center;
                will-change: transform, opacity;
            }
            #${ID_NODO} .sting-lama {
                position: absolute; left: 0; right: 0;
                top: 50%; height: 2px; margin-top: -1px;
                background: linear-gradient(90deg,
                    transparent, var(--f1-telemetry, #39c7f2), #fff,
                    var(--f1-telemetry, #39c7f2), transparent);
                opacity: 0; transform: scaleX(0);
                box-shadow: 0 0 24px var(--f1-telemetry, #39c7f2);
            }
            #${ID_NODO} .sting-testo {
                position: absolute; inset: 0;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 10px; text-align: center;
                font-family: 'Segoe UI', system-ui, sans-serif;
            }
            #${ID_NODO} .sting-titolo {
                font-size: clamp(28px, 6vw, 64px);
                font-weight: 900; letter-spacing: 0.14em;
                color: var(--hud-text, #eef2f6);
                text-transform: uppercase;
                opacity: 0;
            }
            #${ID_NODO} .sting-sottotitolo {
                font-size: clamp(12px, 1.6vw, 18px);
                font-weight: 700; letter-spacing: 0.42em;
                color: var(--f1-telemetry, #39c7f2);
                text-transform: uppercase;
                opacity: 0;
            }
            /* Lampo finale: copre lo stacco fra l'ultima banda e la scena. */
            #${ID_NODO} .sting-lampo {
                position: absolute; inset: 0;
                background: #fff; opacity: 0;
            }
        `;
        document.head.appendChild(st);
    }

    // Colori delle bande: due accenti e tre grigi di scena. Non un arcobaleno
    // — una sigla si regge sul ritmo, non sulla varietà cromatica.
    function coloreBanda(i) {
        const stile = getComputedStyle(document.documentElement);
        const leggi = (nome, ripiego) => (stile.getPropertyValue(nome) || '').trim() || ripiego;
        const tavolozza = [
            leggi('--f1-telemetry', '#39c7f2'),
            leggi('--hud-surface', '#1c212a'),
            leggi('--f1-wear-mid', '#f1c40f'),
            leggi('--hud-screen-bg', '#12151b'),
            leggi('--hud-surface', '#1c212a'),
        ];
        return tavolozza[i % tavolozza.length];
    }

    function costruisci(titolo, sottotitolo) {
        const box = document.createElement('div');
        box.id = ID_NODO;

        const fondo = document.createElement('div');
        fondo.className = 'sting-fondo';
        box.appendChild(fondo);

        const bande = [];
        const altezza = 100 / BANDE;
        for (let i = 0; i < BANDE; i++) {
            const b = document.createElement('div');
            b.className = 'sting-banda';
            b.style.top = `${i * altezza - 12}vh`;
            b.style.height = `${altezza + 24}vh`;
            b.style.background = coloreBanda(i);
            // Inclinazione alternata leggerissima: perfettamente orizzontali
            // sembrerebbero una serranda.
            b.style.transform = `translateX(-120vw) rotate(${i % 2 ? -3.5 : -2.2}deg)`;
            box.appendChild(b);
            bande.push(b);
        }

        const lama = document.createElement('div');
        lama.className = 'sting-lama';
        box.appendChild(lama);

        const testo = document.createElement('div');
        testo.className = 'sting-testo';
        const elTitolo = document.createElement('div');
        elTitolo.className = 'sting-titolo';
        elTitolo.textContent = titolo || '';
        const elSotto = document.createElement('div');
        elSotto.className = 'sting-sottotitolo';
        elSotto.textContent = sottotitolo || '';
        testo.append(elTitolo, elSotto);
        box.appendChild(testo);

        const lampo = document.createElement('div');
        lampo.className = 'sting-lampo';
        box.appendChild(lampo);

        return { box, fondo, bande, lama, elTitolo, elSotto, lampo };
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
     * @param {number} opz.durataMs  quanto dura in tutto (default 2600)
     * @param {string} [opz.titolo]       riga grande al centro
     * @param {string} [opz.sottotitolo]  riga piccola sotto, spaziata
     * @returns {Promise<void>} risolta quando lo schermo è di nuovo libero
     */
    function play(opz) {
        const o = opz || {};
        const durata = Math.max(600, o.durataMs || 2600);
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
                easing: 'easeOutQuad',
                complete: () => { el.box.remove(); risolvi(); },
            });

            // ENTRATA — le bande spazzano da sinistra, sfalsate.
            linea.add({
                targets: el.fondo, opacity: [0, 1],
                duration: tEntrata * 0.5,
            }).add({
                targets: el.bande,
                translateX: ['-120vw', '-10vw'],
                delay: anime.stagger(tEntrata * 0.055),
                duration: tEntrata * 0.7,
                easing: 'easeOutExpo',
            }, 0);

            // SOSTA — le bande si comprimono verso il centro e restano una
            // lama di luce; il testo entra qui, quando lo schermo e' fermo.
            linea.add({
                targets: el.bande,
                scaleY: [1, 0.02],
                opacity: [1, 0.25],
                duration: tSosta * 0.6,
                easing: 'easeInOutQuart',
            }, tEntrata);
            linea.add({
                targets: el.lama,
                opacity: [0, 1], scaleX: [0, 1],
                duration: tSosta * 0.6,
                easing: 'easeOutExpo',
            }, tEntrata);
            if (o.titolo) {
                linea.add({
                    targets: el.elTitolo,
                    opacity: [0, 1], letterSpacing: ['0.34em', '0.14em'],
                    duration: tSosta * 0.75,
                }, tEntrata + tSosta * 0.2);
            }
            if (o.sottotitolo) {
                linea.add({
                    targets: el.elSotto,
                    opacity: [0, 1], translateY: [10, 0],
                    duration: tSosta * 0.6,
                }, tEntrata + tSosta * 0.42);
            }

            // USCITA — lampo, poi la lama si riapre in verticale e scopre la
            // scena. E' l'uscita che "consegna" cio' che c'e' sotto, quindi e'
            // piu' lenta dell'entrata.
            const inizioUscita = tEntrata + tSosta;
            linea.add({
                targets: el.lampo,
                opacity: [0, 0.5, 0],
                duration: tUscita * 0.3,
                easing: 'easeOutQuad',
            }, inizioUscita);
            linea.add({
                targets: [el.elTitolo, el.elSotto, el.lama],
                opacity: 0,
                duration: tUscita * 0.35,
            }, inizioUscita + tUscita * 0.1);
            linea.add({
                targets: el.bande,
                translateX: ['-10vw', '120vw'],
                scaleY: [0.02, 1],
                opacity: [0.25, 1],
                delay: anime.stagger(tUscita * 0.05, { from: 'last' }),
                duration: tUscita * 0.62,
                easing: 'easeInExpo',
            }, inizioUscita + tUscita * 0.18);
            linea.add({
                targets: el.fondo,
                opacity: [1, 0],
                duration: tUscita * 0.5,
            }, inizioUscita + tUscita * 0.45);
        });
    }

    // Toglie subito uno stacco a schermo, senza aspettare che finisca: serve
    // a chi deve annullare la transizione (una gara che riparte, un errore).
    function stop() {
        const n = document.getElementById(ID_NODO);
        if (n) n.remove();
    }

    return { play, stop, BANDE, F_ENTRATA, F_SOSTA };

});
