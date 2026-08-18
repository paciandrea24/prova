// frontend/shared/f1Sting.js
//
// Stacco a tutto schermo in stile sigla televisiva: bande diagonali che
// spazzano lo schermo, si comprimono in una lama di luce al centro dove si
// legge dove siamo, poi si riaprono. Astratto di proposito — non c'è un logo
// da mostrare, e uno inventato invecchierebbe male.
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
// ── Due cose imparate dai playtest, che sembrano dettagli e non lo sono ──
//
// COPRIRE E ANIMARE SONO DUE LAVORI DIVERSI. Una versione intermedia faceva
// entrare le lastre da fuori schermo senza nient'altro sotto: finché non
// arrivavano — più di un secondo — la scena restava visibile, e si vedeva il
// riposizionamento delle auto in griglia che il server fa nello stesso
// istante ("ho visto per un secondo il riposizionamento in griglia e anche un
// rumore di motori, e poi è partita l'animazione"). Il fondo qui sotto va
// opaco in 120 ms, praticamente uno stacco netto: da lì in poi le bande
// hanno tutto il tempo che vogliono, perché non stanno più coprendo niente.
//
// LA SOSTA È IL MOMENTO PIÙ LUNGO. Nella prima versione entrata e uscita si
// mangiavano quasi tutto e il testo non faceva in tempo a essere letto ("la
// velocità mi è sembrata un po' troppa, non ci ho capito niente"). Le bande
// piacevano, il ritmo no: ora la sosta si prende la fetta maggiore e lo
// schermo ci sta fermo sopra.
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

    // Quante bande diagonali. Sotto le 5 si legge come una tendina, sopra le
    // 9 diventano un pettine grigio: nessuna singola banda si distingue più.
    const BANDE = 7;

    // Quanto ci mette il fondo a diventare opaco. NON è una frazione della
    // durata: è il taglio, e un taglio è istantaneo per definizione. Vedi la
    // nota in testa al file sul perché.
    const COPERTURA_MS = 120;

    // Frazioni della durata totale. La sosta si prende la fetta più grande:
    // è il momento in cui lo schermo è fermo e il testo si legge.
    const F_ENTRATA = 0.30;
    const F_SOSTA = 0.42;

    function iniettaStile() {
        if (document.getElementById(ID_STILE)) return;
        const st = document.createElement('style');
        st.id = ID_STILE;
        st.textContent = `
            #${ID_NODO} {
                position: fixed; inset: 0; z-index: 200;
                overflow: hidden; pointer-events: none;
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
                gap: 14px; text-align: center; padding: 0 6vw;
                font-family: 'Segoe UI', system-ui, sans-serif;
            }
            #${ID_NODO} .sting-titolo {
                font-size: clamp(32px, 7vw, 76px);
                font-weight: 900; letter-spacing: 0.12em; line-height: 1.05;
                color: var(--hud-text, #eef2f6);
                text-transform: uppercase;
                text-shadow: 0 4px 26px rgba(0, 0, 0, 0.75);
                opacity: 0;
            }
            #${ID_NODO} .sting-sottotitolo {
                font-size: clamp(13px, 1.7vw, 20px);
                font-weight: 700; letter-spacing: 0.4em;
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
                easing: 'easeOutQuad',
                complete: () => { el.box.remove(); risolvi(); },
            });

            // ── IL TAGLIO ──────────────────────────────────────────────
            // Fuori dalle frazioni: copre subito, in 120 ms. Da qui in poi
            // niente di ciò che c'è sotto è più visibile, e il resto della
            // sigla può prendersi il tempo che vuole.
            linea.add({
                targets: el.fondo, opacity: [0, 1],
                duration: COPERTURA_MS, easing: 'linear',
            }, 0);

            // ── ENTRATA ────────────────────────────────────────────────
            // Le bande spazzano da sinistra, sfalsate.
            linea.add({
                targets: el.bande,
                translateX: ['-120vw', '-10vw'],
                delay: anime.stagger(tEntrata * 0.075),
                duration: tEntrata * 0.62,
                easing: 'easeOutExpo',
            }, COPERTURA_MS);

            // ── SOSTA ──────────────────────────────────────────────────
            // Le bande si comprimono verso il centro e restano una lama di
            // luce; il testo entra qui, quando lo schermo è fermo. È il
            // momento più lungo dei tre.
            const inizioSosta = COPERTURA_MS + tEntrata;
            linea.add({
                targets: el.bande,
                scaleY: [1, 0.02],
                opacity: [1, 0.22],
                duration: tSosta * 0.34,
                easing: 'easeInOutQuart',
            }, inizioSosta);
            linea.add({
                targets: el.lama,
                opacity: [0, 1], scaleX: [0, 1],
                duration: tSosta * 0.34,
                easing: 'easeOutExpo',
            }, inizioSosta);
            if (o.titolo) {
                linea.add({
                    targets: el.elTitolo,
                    opacity: [0, 1], letterSpacing: ['0.34em', '0.12em'],
                    duration: tSosta * 0.4,
                    easing: 'easeOutExpo',
                }, inizioSosta + tSosta * 0.16);
            }
            if (o.sottotitolo) {
                linea.add({
                    targets: el.elSotto,
                    opacity: [0, 1], translateY: [12, 0],
                    duration: tSosta * 0.32,
                }, inizioSosta + tSosta * 0.34);
            }

            // ── USCITA ─────────────────────────────────────────────────
            // Lampo, poi le bande si riaprono e spazzano via scoprendo la
            // scena. È l'uscita che "consegna" ciò che c'è sotto.
            const inizioUscita = inizioSosta + tSosta;
            linea.add({
                targets: el.lampo,
                opacity: [0, 0.45, 0],
                duration: tUscita * 0.3,
            }, inizioUscita);
            linea.add({
                targets: [el.elTitolo, el.elSotto, el.lama],
                opacity: 0,
                duration: tUscita * 0.3,
            }, inizioUscita + tUscita * 0.06);
            linea.add({
                targets: el.bande,
                translateX: ['-10vw', '120vw'],
                scaleY: [0.02, 1],
                opacity: [0.22, 1],
                delay: anime.stagger(tUscita * 0.06, { from: 'last' }),
                duration: tUscita * 0.58,
                easing: 'easeInExpo',
            }, inizioUscita + tUscita * 0.22);
            // Il fondo se ne va per ultimo, e solo quando le bande hanno già
            // quasi finito: se scomparisse prima, sotto le bande residue si
            // rivedrebbe la scena a strisce.
            linea.add({
                targets: el.fondo,
                opacity: [1, 0],
                duration: tUscita * 0.34,
            }, inizioUscita + tUscita * 0.6);
        });
    }

    // Toglie subito uno stacco a schermo, senza aspettare che finisca: serve
    // a chi deve annullare la transizione (una gara che riparte, un errore).
    function stop() {
        const n = document.getElementById(ID_NODO);
        if (n) n.remove();
    }

    return { play, stop, DURATA_DEFAULT, DURATA_MINIMA, COPERTURA_MS, BANDE, F_ENTRATA, F_SOSTA };

});
