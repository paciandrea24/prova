// frontend/shared/f1Tutorial.js
//
// COME SI GIOCA: le regole dell'F1 in cinque schermate, per chi entra la prima
// volta. Voce J della roadmap 1.0, chiesta dall'utente il 2026-08-18 e tenuta
// per ultima di proposito — cambia con ogni cosa che la precede, e da allora
// sono arrivate la frizione alla partenza, il volume e le tre mescole che ora
// sono una scelta vera.
//
// ⚠️ IN ITALIANO, dentro una lobby che e' in inglese. Non e' una svista: la
// regola del progetto e' hub in inglese, giochi in italiano, e questo racconta
// le regole di un gioco che il giocatore vedra' tutto in italiano — dal
// pannello dei box agli avvisi in pista. Il pulsante che lo richiama, che
// invece e' parte della lobby, resta in inglese.
//
// ⚠️ SI PORTA DIETRO IL PROPRIO STILE. Vive nella lobby ma potrebbe servire
// anche altrove (dentro il gioco, in una schermata di pausa): dipendere dal
// CSS della pagina che lo ospita vorrebbe dire che al secondo posto in cui lo
// metti si vede storto, e nessuno capisce perche'.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Tutorial = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const ID_NODO = 'f1-tutorial';
    // Dove stanno le fotografie di cio' che si vedra' in gioco. ⚠️ Se un file
    // manca, la sua immagine si nasconde da sola e il passo resta leggibile:
    // cosi' il tutorial e' utile da subito e migliora quando le foto
    // arrivano, invece di aspettarle per esistere.
    const CARTELLA_FOTO = 'assets/tutorial/';
    // Quali foto esistono davvero. ⚠️ Si scopre CARICANDOLE, non con un elenco
    // scritto a mano: un elenco si scollerebbe dalla cartella al primo file
    // aggiunto, e il tutorial mostrerebbe un rettangolo vuoto o nasconderebbe
    // uno schema che invece serviva.
    const FOTO_PRESENTI = {};
    const ID_STILE = 'f1-tutorial-stile';

    // I tre colori delle mescole, gli stessi del gioco (TyreModel.TYRE_COMPOUNDS).
    const MESCOLE = [
        { k: 'S', nome: 'Soft', colore: '#e74c3c', dice: 'la piu’ veloce, dura poco' },
        { k: 'M', nome: 'Medium', colore: '#f1c40f', dice: 'la via di mezzo' },
        { k: 'H', nome: 'Hard', colore: '#ecf0f1', dice: 'la piu’ lenta, dura tanto' },
    ];

    // ── LE CINQUE SCHERMATE ─────────────────────────────────────────────
    //
    // ⚠️ Ogni passo dice UNA cosa e la dice intera. La tentazione e' di
    // aggiungere il dettaglio interessante in fondo al passo che gli somiglia,
    // e dopo tre giri di aggiunte il primo passo e' lungo il triplo dell'ultimo
    // e nessuno arriva in fondo.
    const PASSI = [
        {
            titolo: 'Il weekend',
            foto: 'weekend.png',
            occhiello: 'Come si svolge',
            corpo: [
                'Prima la <b>qualifica</b>: un giro secco, da solo in pista. Il tempo che fai decide da dove parti.',
                'Poi la <b>gara</b>, con tutti in griglia. Vince chi taglia per primo il traguardo all’ultimo giro.',
                'I danni presi in qualifica non ti seguono in gara: la squadra ripara nella notte.',
            ],
            figura: figuraWeekend,
        },
        {
            titolo: 'La partenza',
            foto: 'partenza.png',
            occhiello: 'Cinque luci, poi buio',
            corpo: [
                'Tieni premuta la <b>frizione</b> mentre i semafori si accendono, e <b>rilasciala</b> quando si spengono: e’ il rilascio che mette in moto l’auto.',
                'Finche’ la tieni giu’ il gas non muove nulla, quindi quanto sei pronto decide quanto guadagni — non c’e’ nessun aiuto e nessuna zavorra.',
                'Toccare il gas <b>prima</b> che si spengano e’ falsa partenza: cinque secondi, che sconti alla prima sosta.',
            ],
            figura: figuraSemaforo,
        },
        {
            titolo: 'La sosta',
            foto: 'sosta.png',
            occhiello: 'Almeno una, sempre',
            corpo: [
                'Ogni gara richiede <b>almeno una sosta</b> ai box. Chi non si ferma si prende <b>30 secondi</b> sul tempo finale.',
                'Mentre arrivi vedi un muro che conta alla rovescia e <b>si accende</b>: premi il tasto della sosta nell’istante giusto e la fermata e’ piu’ corta.',
                'Le penalita’ si pagano qui: si sommano al tempo della sosta, e da li’ in poi sei pulito.',
            ],
            figura: figuraBox,
        },
        {
            titolo: 'Le gomme',
            // ⚠️ Questo passo NON ha fotografia, ed e' una scelta. La schermata
            // di scelta mescola e' verticale, e qui le immagini stanno in una
            // striscia larga e bassa — il tetto d'altezza serve a non far
            // scorrere il tutorial. Tagliata in striscia perderebbe due carte
            // su tre; rimpicciolita per intero sarebbe alta 190 px e larga
            // altrettanto, con le scritte illeggibili. Lo schemetto qui sotto
            // dice la stessa cosa e si legge.
            occhiello: 'Tre mescole, tre strategie',
            corpo: [
                '<b>Nessuna arriva in fondo alla gara</b>: la scelta non e’ quale sia la migliore, ma come dividere la gara fra due treni.',
                'Piu’ la gomma si consuma, piu’ perdi — e oltre una certa soglia il calo <b>accelera</b>. Fermarsi un giro prima di chi ti sta davanti puo’ bastare a passarlo.',
                'Ogni circuito consuma a modo suo: la schermata di scelta ti dice quanti giri dura ciascuna mescola <b>su quella pista</b>.',
            ],
            figura: figuraMescole,
        },
        {
            titolo: 'I comandi',
            occhiello: 'Tastiera e controller',
            corpo: [],
            figura: figuraComandi,
        },
    ];

    // ⚠️ LA GRAMMATICA E' QUELLA DELLA LOBBY, non un tema mio: carta chiara,
    // bordo spesso scuro, e l'ombra piena nel COLORE DELL'HOST — che nella
    // lobby e' cio' che fa da bordo colorato (`box-shadow: 7px 7px 0
    // var(--host-color)` su .modal-content). Segnalato dall'utente: «dato che
    // il tutorial si vede in lobby, deve avere lo stile tipico della lobby».
    //
    // Si usano le VARIABILI della lobby con un ripiego accanto: dove quelle
    // non esistono — se un giorno questo modulo servisse dentro il gioco — il
    // riquadro resta leggibile invece di diventare invisibile.
    function iniettaStile() {
        if (document.getElementById(ID_STILE)) return;
        const st = document.createElement('style');
        st.id = ID_STILE;
        st.textContent = `
            #${ID_NODO} {
                position: fixed; inset: 0; z-index: 9000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(13, 12, 20, 0.85);
                padding: 24px;
                font-family: 'Fredoka', 'Segoe UI', system-ui, sans-serif;
            }
            #${ID_NODO} .tut-box {
                width: min(620px, 100%);
                /* ⚠️ ALTEZZA FISSA, non «al massimo». Con max-height il riquadro si
                   ridimensionava a ogni passo, seguendo il testo di quella
                   schermata: da fuori sembrava che saltasse. Segnalato
                   dall'utente. Fissandola, cambia solo il contenuto — che e'
                   quel che deve cambiare — e quando le fotografie arriveranno
                   il riquadro non ricomincera' a ballare. Quel che eccede
                   scorre dentro il corpo. */
                height: min(620px, 88vh);
                display: flex; flex-direction: column;
                background: var(--card, #fff);
                color: var(--ink, #16141E);
                border: 3px solid var(--ink, #16141E);
                border-radius: 20px;
                box-shadow: 7px 7px 0 var(--host-color, #16141E);
                overflow: hidden;
            }
            #${ID_NODO} .tut-testa {
                display: flex; align-items: baseline; gap: 12px;
                padding: 20px 22px 8px;
            }
            #${ID_NODO} .tut-occhiello {
                font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
                text-transform: uppercase; color: var(--muted, #6B6878);
            }
            #${ID_NODO} .tut-titolo {
                font-size: 24px; font-weight: 700; margin: 0;
                color: var(--ink, #16141E);
            }
            #${ID_NODO} .tut-conta {
                margin-left: auto; font-size: 13px; font-weight: 600;
                color: var(--muted, #6B6878); font-variant-numeric: tabular-nums;
            }
            #${ID_NODO} .tut-corpo {
                padding: 4px 22px 18px;
                /* Prende tutto lo spazio che avanza, cosi' il piede resta
                   INCOLLATO IN FONDO invece di seguire il testo. Senza,
                   l'altezza fissa toglie il salto del riquadro ma lascia
                   ballare i pulsanti, che e' lo stesso difetto piu' in
                   piccolo. */
                flex: 1 1 auto;
                overflow-y: auto;
                display: flex; flex-direction: column; gap: 12px;
            }
            #${ID_NODO} .tut-riga { font-size: 15px; line-height: 1.5; }

            /* LA TRANSIZIONE FRA UN PASSO E L'ALTRO. Il riquadro non si
               ridimensiona piu', ma il contenuto si sostituiva in un fotogramma
               e si leggeva come uno scatto — segnalato dall'utente. Ora esce
               nella direzione in cui stai andando ed entra dalla parte opposta,
               che e' anche cio' che dice da che parte ti sei mosso.
               ⚠️ Si muovono TESTA e CORPO insieme: animare solo il corpo
               lascerebbe il titolo a cambiare di scatto, cioe' lo stesso
               difetto spostato due centimetri piu' su. */
            #${ID_NODO} .tut-mobile {
                transition: opacity 130ms ease, transform 130ms ease;
            }
            #${ID_NODO} .tut-box.esce-avanti .tut-mobile { opacity: 0; transform: translateX(-14px); }
            #${ID_NODO} .tut-box.esce-indietro .tut-mobile { opacity: 0; transform: translateX(14px); }
            /* ⚠️ L'ENTRATA E' UN'ANIMAZIONE, NON UNA CLASSE DA TOGLIERE. La
               prima stesura posava il contenuto nuovo a opacita' zero e
               contava su requestAnimationFrame per riaccenderlo: se quello non
               scatta — scheda in secondo piano, o un browser che lo sospende —
               il tutorial resta BIANCO, e il difetto e' peggiore di quello che
               stavo curando. Con un'animazione lo stato finale e' quello
               naturale: se non parte, si vede lo stesso. */
            @keyframes tutEntraAvanti {
                from { opacity: 0; transform: translateX(14px); }
                to   { opacity: 1; transform: none; }
            }
            @keyframes tutEntraIndietro {
                from { opacity: 0; transform: translateX(-14px); }
                to   { opacity: 1; transform: none; }
            }
            #${ID_NODO} .tut-box.entra-avanti .tut-mobile { animation: tutEntraAvanti 150ms ease; }
            #${ID_NODO} .tut-box.entra-indietro .tut-mobile { animation: tutEntraIndietro 150ms ease; }
            /* Chi ha chiesto meno movimento al sistema operativo non lo
               riceve: resta lo stacco netto, che e' comunque leggibile. */
            @media (prefers-reduced-motion: reduce) {
                #${ID_NODO} .tut-mobile { transition: none; animation: none !important; }
                #${ID_NODO} .tut-box[class*="esce-"] .tut-mobile { opacity: 1; transform: none; }
            }
            #${ID_NODO} .tut-riga b { font-weight: 700; }

            /* La fotografia di cio' che si vedra' in gioco. ⚠️ Se il file non
               c'e' si nasconde da sola (onerror), cosi' il tutorial funziona
               anche prima che le immagini siano state scattate. */
            /* ⚠️ LA FOTO HA UN TETTO DI ALTEZZA, e serve a una cosa sola: NON
               FAR SCORRERE il tutorial. «Non voglio scroll»: a tutta larghezza
               una 16:9 alta 320 px lascia meno spazio di quanto ne chiedano tre
               paragrafi, e il corpo comincia a scorrere. Con 190 px di tetto e
               object-fit: cover l'immagine si taglia invece di spingere fuori
               il testo. */
            #${ID_NODO} .tut-foto {
                width: 100%; display: block; border-radius: 12px;
                border: 3px solid var(--ink, #16141E);
                aspect-ratio: 16 / 9; max-height: 190px; object-fit: cover;
                background: var(--surface, #F2F1EF);
            }
            #${ID_NODO} .tut-figura {
                display: flex; flex-direction: column; gap: 10px;
                padding: 14px; border-radius: 12px;
                background: var(--surface, #F2F1EF);
                border: 3px solid var(--ink, #16141E);
            }
            #${ID_NODO} .tut-mescola { display: flex; align-items: center; gap: 12px; }
            #${ID_NODO} .tut-pallina {
                width: 32px; height: 32px; flex-shrink: 0;
                border-radius: 50%; border: 3px solid currentColor;
                display: flex; align-items: center; justify-content: center;
                font-size: 14px; font-weight: 700;
                background: var(--ink, #16141E);
            }
            #${ID_NODO} .tut-mescola span { font-size: 14.5px; }
            #${ID_NODO} .tut-comandi {
                display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px;
            }
            #${ID_NODO} .tut-colonna h4 {
                margin: 0 0 8px; font-size: 11px; font-weight: 700;
                letter-spacing: 0.14em; text-transform: uppercase;
                color: var(--muted, #6B6878);
            }
            #${ID_NODO} .tut-comando {
                display: flex; align-items: center; gap: 7px;
                padding: 3px 0; font-size: 14px;
            }
            #${ID_NODO} kbd {
                display: inline-flex; align-items: center; justify-content: center;
                min-width: 28px; height: 26px; padding: 0 7px;
                border-radius: 8px;
                background: var(--surface, #F2F1EF);
                border: 2px solid var(--ink, #16141E);
                box-shadow: 2px 2px 0 var(--ink, #16141E);
                font-family: inherit; font-size: 12.5px; font-weight: 700;
                color: var(--ink, #16141E);
            }
            #${ID_NODO} .tut-piede {
                display: flex; align-items: center; gap: 10px;
                padding: 14px 22px; border-top: 3px solid var(--ink, #16141E);
                background: var(--surface, #F2F1EF);
            }
            #${ID_NODO} .tut-punti { display: flex; gap: 7px; margin-right: auto; }
            #${ID_NODO} .tut-punto {
                width: 10px; height: 10px; border-radius: 50%;
                border: 2px solid var(--ink, #16141E);
                background: transparent;
            }
            #${ID_NODO} .tut-punto.qui { background: var(--host-color, #16141E); }
            /* I pulsanti sono quelli della lobby: bordo spesso e ombra piena. */
            #${ID_NODO} button {
                font-family: inherit; font-size: 14px; font-weight: 700;
                padding: 8px 16px; border-radius: 12px; cursor: pointer;
                border: 3px solid var(--ink, #16141E);
                background: var(--card, #fff); color: var(--ink, #16141E);
                box-shadow: 3px 3px 0 var(--ink, #16141E);
            }
            #${ID_NODO} button:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink, #16141E); }
            #${ID_NODO} button[disabled] { opacity: 0.35; cursor: default; box-shadow: none; }
            #${ID_NODO} button.tut-avanti {
                background: var(--host-color, #16141E); color: #fff;
            }
            #${ID_NODO} button.tut-salta {
                border-color: transparent; box-shadow: none;
                background: transparent; color: var(--muted, #6B6878);
            }
            #${ID_NODO} button.tut-salta:hover { color: var(--ink, #16141E); }
        `;
        document.head.appendChild(st);
    }

    // ── LE FIGURE ───────────────────────────────────────────────────────
    // Niente illustrazioni nuove: si riusa la grammatica che il gioco ha gia'
    // (i pallini delle mescole, i tasti disegnati come tasti). Scelta
    // dell'utente, e ha il vantaggio di non andare fuori sincrono col gioco
    // ogni volta che cambia una regola.

    function figuraWeekend() {
        return `<div class="tut-figura">
            <div class="tut-riga" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <b>Qualifica</b> <span style="color:#7b8794">→</span>
                <b>Griglia</b> <span style="color:#7b8794">→</span>
                <b>Gara</b> <span style="color:#7b8794">→</span>
                <b>Podio</b>
            </div>
        </div>`;
    }

    function figuraSemaforo() {
        const bulbo = (acceso) => `<span style="width:20px;height:20px;border-radius:50%;
            background:${acceso ? '#e74c3c' : 'rgba(255,255,255,0.12)'};
            border:1px solid rgba(0,0,0,0.5); display:inline-block;"></span>`;
        return `<div class="tut-figura">
            <div style="display:flex;gap:7px;">${[1,1,1,1,1].map(() => bulbo(true)).join('')}</div>
            <div class="tut-riga" style="font-size:13px;color:#7b8794;">tutte accese — tieni premuto</div>
            <div style="display:flex;gap:7px;">${[0,0,0,0,0].map(() => bulbo(false)).join('')}</div>
            <div class="tut-riga" style="font-size:13px;color:#7b8794;">spente — rilascia e accelera</div>
        </div>`;
    }

    function figuraBox() {
        return `<div class="tut-figura">
            <div class="tut-riga" style="font-size:13px;">
                <span style="color:#7b8794">arrivi in corsia</span> →
                <b style="color:#39c7f2">il muro si accende</b> →
                <span style="color:#7b8794">premi</span> →
                <b>sosta piu’ corta</b>
            </div>
        </div>`;
    }

    function figuraMescole() {
        return `<div class="tut-figura">${MESCOLE.map(m => `
            <div class="tut-mescola">
                <span class="tut-pallina" style="color:${m.colore}">${m.k}</span>
                <span><b>${m.nome}</b> — ${m.dice}</span>
            </div>`).join('')}</div>`;
    }

    // ⚠️ QUESTO ELENCO SI CONTROLLA NEL CODICE, NON A MEMORIA. Scrivendolo la
    // prima volta avevo messo RT/Y/LB per gas, riparazione e specchietto: nel
    // gioco sono R2, R1 e B (f1Gamepad.js, le costanti BTN_*). Un tutorial che
    // insegna il tasto sbagliato e' peggio di nessun tutorial — il giocatore
    // prova, non succede niente, e conclude che e' rotto il gioco.
    function figuraComandi() {
        const riga = (tasti, cosa) =>
            `<div class="tut-comando">${tasti.map(t => `<kbd>${t}</kbd>`).join('')}<span>${cosa}</span></div>`;
        return `<div class="tut-comandi">
            <div class="tut-colonna">
                <h4>Tastiera</h4>
                ${riga(['W'], 'accelera')}
                ${riga(['S'], 'frena e retromarcia')}
                ${riga(['A', 'D'], 'sterza')}
                ${riga(['Spazio'], 'frizione alla partenza, e la reazione ai box')}
                ${riga(['R'], 'ripara i danni alla prossima sosta')}
                ${riga(['T'], 'apri il pannello gomme')}
                ${riga(['C'], 'cambia visuale')}
                ${riga(['B', '↓'], 'guarda dietro')}
                ${riga(['−', '+'], 'volume')}
            </div>
            <div class="tut-colonna">
                <h4>Controller</h4>
                ${riga(['R2'], 'accelera')}
                ${riga(['L2'], 'frena e retromarcia')}
                ${riga(['◄►'], 'sterza, con la levetta sinistra')}
                ${riga(['X'], 'frizione alla partenza, e la reazione ai box')}
                ${riga(['R1'], 'ripara i danni alla prossima sosta')}
                ${riga(['L1'], 'apri il pannello gomme')}
                ${riga(['Y'], 'cambia visuale')}
                ${riga(['B'], 'guarda dietro')}
            </div>
        </div>`;
    }

    // ── L'INTERFACCIA ───────────────────────────────────────────────────

    function chiudi() {
        const n = document.getElementById(ID_NODO);
        if (n) n.remove();
        document.removeEventListener('keydown', suTasto);
    }

    let vaiA = null;   // riempita da apri(), serve a suTasto

    // Le frecce e Esc: chi legge un percorso a passi le prova, e non trovarle
    // fa sembrare rotto qualcosa che invece funziona.
    function suTasto(e) {
        if (e.key === 'Escape') { e.preventDefault(); chiudi(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); if (vaiA) vaiA(+1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); if (vaiA) vaiA(-1); }
    }

    /**
     * Apre il tutorial. Risolve quando viene chiuso, in qualunque modo.
     * @param {{onChiuso?: function}} [opz]
     */
    function apri(opz) {
        const o = opz || {};
        if (typeof document === 'undefined') return Promise.resolve();
        iniettaStile();
        chiudi();   // mai due copie sovrapposte

        // Chi c'e' e chi no, prima di disegnare: un colpo solo all'apertura.
        PASSI.forEach((p, k) => {
            if (!p.foto || p.foto in FOTO_PRESENTI) return;
            const prova = new Image();
            const risposto = (c1e) => {
                FOTO_PRESENTI[p.foto] = c1e;
                // ⚠️ E SI RIDISEGNA, se la risposta riguarda il passo che si sta
                // guardando. La prima schermata viene disegnata SUBITO, prima
                // che l'immagine abbia risposto: senza questo, al primo passo
                // si vedevano la foto E lo schemetto insieme, che e' esattamente
                // il doppione che il controllo doveva evitare. Si nota solo
                // sul primo, perche' dal secondo in poi la risposta e' gia'
                // arrivata — il difetto peggiore, quello che sembra casuale.
                if (k === i) disegna();
            };
            prova.onload = () => risposto(true);
            prova.onerror = () => risposto(false);
            prova.src = CARTELLA_FOTO + p.foto;
        });

        const box = document.createElement('div');
        box.id = ID_NODO;
        box.innerHTML = `<div class="tut-box" role="dialog" aria-modal="true" aria-label="Come si gioca">
            <div class="tut-testa">
                <div class="tut-mobile">
                    <div class="tut-occhiello"></div>
                    <h3 class="tut-titolo"></h3>
                </div>
                <div class="tut-conta"></div>
            </div>
            <div class="tut-corpo tut-mobile"></div>
            <div class="tut-piede">
                <div class="tut-punti"></div>
                <button type="button" class="tut-salta">Salta</button>
                <button type="button" class="tut-indietro">‹ Indietro</button>
                <button type="button" class="tut-avanti">Avanti ›</button>
            </div>
        </div>`;
        document.body.appendChild(box);

        const el = {
            occhiello: box.querySelector('.tut-occhiello'),
            titolo: box.querySelector('.tut-titolo'),
            conta: box.querySelector('.tut-conta'),
            corpo: box.querySelector('.tut-corpo'),
            punti: box.querySelector('.tut-punti'),
            salta: box.querySelector('.tut-salta'),
            indietro: box.querySelector('.tut-indietro'),
            avanti: box.querySelector('.tut-avanti'),
        };

        let i = 0;
        function disegna() {
            const p = PASSI[i];
            el.occhiello.textContent = p.occhiello;
            el.titolo.textContent = p.titolo;
            el.conta.textContent = `${i + 1} / ${PASSI.length}`;
            // ⚠️ O la foto o lo schema, mai tutti e due: dicono la stessa cosa, e
            // insieme non ci starebbero senza far scorrere il corpo. Lo schema
            // resta come ripiego finche' la foto non c'e' — e per i comandi,
            // che una foto non ce l'hanno mai.
            const haFoto = !!(p.foto && FOTO_PRESENTI[p.foto]);
            el.corpo.innerHTML =
                (p.foto ? `<img class="tut-foto" alt="" src="${CARTELLA_FOTO}${p.foto}"
                            onerror="this.remove(); this.dispatchEvent(new Event('mancata'))">` : '') +
                (haFoto ? '' : (p.figura ? p.figura() : '')) +
                p.corpo.map(t => `<div class="tut-riga">${t}</div>`).join('');
            el.corpo.scrollTop = 0;
            el.punti.innerHTML = PASSI
                .map((_, k) => `<span class="tut-punto${k === i ? ' qui' : ''}"></span>`).join('');
            el.indietro.disabled = i === 0;
            // All'ultimo passo il pulsante chiude, e lo dice: «Avanti» su una
            // schermata che non ha un dopo e' una promessa non mantenuta.
            el.avanti.textContent = (i === PASSI.length - 1) ? 'Ho capito' : 'Avanti ›';
            el.salta.style.visibility = (i === PASSI.length - 1) ? 'hidden' : 'visible';
        }

        return new Promise(risolvi => {
            const finisci = () => { chiudi(); if (o.onChiuso) o.onChiuso(); risolvi(); };
            const scatola = box.querySelector('.tut-box');
            let inMovimento = false;

            vaiA = (d) => {
                const prossimo = i + d;
                if (prossimo < 0) return;
                if (prossimo >= PASSI.length) { finisci(); return; }
                // ⚠️ Una transizione per volta: tenendo premuta la freccia
                // partirebbero dieci sostituzioni sovrapposte e il contenuto
                // finirebbe a meta' dissolvenza, fermo li'.
                if (inMovimento) return;
                inMovimento = true;

                const verso = d > 0 ? 'avanti' : 'indietro';
                scatola.classList.add('esce-' + verso);
                setTimeout(() => {
                    i = prossimo;
                    disegna();
                    scatola.classList.remove('esce-' + verso);
                    scatola.classList.add('entra-' + verso);
                    // La classe si toglie per poter riattaccare l'animazione al
                    // passo dopo. Se questo timer tardasse non succede niente di
                    // grave: l'animazione e' gia' finita e il contenuto e' a
                    // posto — e' il motivo per cui l'entrata e' un'animazione e
                    // non uno stato trasparente da spegnere.
                    setTimeout(() => {
                        scatola.classList.remove('entra-' + verso);
                        inMovimento = false;
                    }, 160);
                }, 130);
            };
            el.avanti.addEventListener('click', () => vaiA(+1));
            el.indietro.addEventListener('click', () => vaiA(-1));
            el.salta.addEventListener('click', finisci);
            // Il velo scuro chiude: e' quel che si prova d'istinto, e non
            // funzionare sarebbe peggio che non averlo.
            box.addEventListener('click', (e) => { if (e.target === box) finisci(); });
            document.addEventListener('keydown', suTasto);
            disegna();
        });
    }

    return { apri, chiudi, PASSI, MESCOLE, ID_NODO };
});
