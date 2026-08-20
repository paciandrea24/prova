# F1 Stagioni — passo 5: fine stagione e premiazione del campione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando finisce l'ultima gara del calendario, il campionato non si chiude con una riga di classifica: si chiude con una cerimonia che racconta **la stagione intera** — l'annata che scorre gara per gara, le prime tre auto che salgono sul podio una alla volta, e un albo d'oro che resta.

**Architecture:** quattro movimenti in fila, tutti guidati dal **client** dentro la fase `stagione` (il server non sa niente della premiazione: la stagione è già stata salvata dopo l'ultima gara, e non c'è nient'altro da scrivere). I numeri li calcola `shared/f1Stagione.js` come sempre; i tempi e le pose li decide un modulo puro nuovo, `shared/f1Premiazione.js`, che non conosce Three.js e quindi si verifica senza browser; la scena la mette in piedi `f1.js`, riusando il podio, le auto con livrea, le particelle e lo sting che esistono già.

**Tech Stack:** JS vanilla, Three.js r128, anime.js 3.2.1, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-19-f1-stagioni-design.md` (passo 5). Il design della cerimonia è stato concordato con l'utente il 2026-08-20 ed è riassunto qui sotto.

## Il design approvato

L'utente ha scelto il podio del mondiale, **ma non un riuso della cerimonia di fine gara**: «essendo il mondiale una cosa molto più grossa della vittoria di una singola gara, mi piacerebbe qualcosa di più sofisticato». La differenza da mettere in scena è che una cerimonia di gara celebra un pomeriggio e questa celebra una stagione. Quattro movimenti, ~45 s, saltabili:

1. **Lo stacco** — `f1Sting`, ma dice il nome del campionato, non quello di una gara.
2. **L'annata che scorre** — sulla panoramica del circuito le tappe passano una dopo l'altra (pista, vincitore, punti) mentre due barre in basso ricostruiscono il duello per il titolo gara dopo gara. È il movimento che il podio di gara non ha e non può avere.
3. **La consegna** — sul traguardo, le auto salgono sul podio **una alla volta** dalla terza alla prima, ciascuna con la sua inquadratura; le altre schierate ai lati come una parata; quando sale il campione la camera si alza, partono coriandoli e fuochi.
4. **L'albo d'oro** — classifica finale, i numeri della stagione, e l'uscita.

**Il trofeo**: l'asset lo procura l'utente. Il codice va predisposto perché lo carichi **se c'è** e giri identico se non c'è.

## Global Constraints

- **Il codice del weekend non si tocca.** La premiazione vive nella fase `stagione`, dopo l'ultima gara: qualifica, gara, pit stop e podio di fine gara restano come sono.
- **La classifica non si salva, si calcola** — e vale anche per i numeri della stagione (vittorie, podi, margine). Nessun totale nuovo dentro il documento.
- **Il server non partecipa.** Nessun evento socket nuovo, nessuna scrittura: la stagione è già stata salvata dopo l'ultima gara.
- **Niente emoji** nella UI: glifi unicode monocromatici o SVG.
- **Italiano** nei commenti e nella UI del gioco.
- **Cache-busting** in `frontend/f1.html` ad ogni modifica di `f1.js`, `f1.css` o di uno script `shared/`.
- **Commit ad ogni task**, `git add` per nome (mai `-A`: l'utente lavora in parallelo sui file delle piste), push solo dell'utente.
- **Ogni task finisce con un playtest dell'utente** prima del successivo.
- I 4 test rossi preesistenti al 2026-08-20 non sono regressioni: `Simcade: isolamento dei componenti`, i due `loadTrack("monte-rosso")`, `simulateLap … tuning`. Suite: `node --test frontend` dalla radice, `node --test .` da `backend/` (da lì e non dalla radice: due file di test leggono `words.json` con un percorso relativo alla cwd).

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `frontend/shared/f1Stagione.js` | I numeri della fine stagione: `albo()`, `numeriDi()`, `cronaca()`. Nessun totale salvato, tutto ricavato dai risultati. |
| `frontend/shared/f1Stagione.test.js` | I loro test. |
| `frontend/shared/f1Premiazione.js` *(nuovo)* | **La coreografia**: quanto dura ogni movimento, chi entra quando, dove sta la camera in ogni istante. Niente Three.js, niente DOM — così i tempi e le pose si verificano senza browser, che di una cerimonia è l'unica parte verificabile a tavolino. |
| `frontend/shared/f1Premiazione.test.js` *(nuovo)* | I test della coreografia. |
| `frontend/shared/f1StagioneSchermate.js` | L'albo d'oro, e il passaggio dal riepilogo dell'ultima gara alla cerimonia. |
| `frontend/f1.js` | La scena 3D della consegna (podio, auto che salgono, parata, coriandoli, trofeo) e l'annata che scorre sulla panoramica. |
| `frontend/f1.html` + `frontend/styles/f1.css` | Markup e stile dell'albo d'oro e delle sovrimpressioni dei movimenti 1-2. |
| `frontend/assets/custom/circuit/trophy.glb` *(lo consegna l'utente)* | Il trofeo. Opzionale: se manca, la cerimonia gira identica. |

---

### Task 1: I numeri della fine stagione

**Files:**
- Modify: `frontend/shared/f1Stagione.js`
- Test: `frontend/shared/f1Stagione.test.js`

**Interfaces:**
- Consumes: `classifica(stagione, { fermaA })`, `vittorie(riga)` (già esistenti).
- Produces:
  - `albo(stagione)` → `{ campione, classifica, gare, margine }` — `campione` è la riga di classifica prima, `margine` è la differenza di punti sul secondo (0 se la stagione ha un solo pilota).
  - `numeriDi(stagione, idPilota)` → `{ gare, vittorie, podi, punti, miglioreArrivo }` — `miglioreArrivo` è la posizione migliore ottenuta in una gara (`null` se non ha mai corso).
  - `cronaca(stagione)` → un elemento per gara corsa: `{ numero, pista, vincitore, classifica }`, dove `vincitore` è la riga del pilota arrivato primo e `classifica` è quella progressiva **dopo** quella gara.

**Perché per primo:** tutti e quattro i movimenti mostrano questi numeri, e nessuno di essi deve essere calcolato dentro una schermata.

- [ ] **Step 1: Scrivere i test che falliscono**

In coda a `frontend/shared/f1Stagione.test.js`:

```js
// ---- la fine della stagione -------------------------------------------------

test('l albo dice chi e campione e con quanto margine', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });   // 25 / 18 / 15
    s = S.registraRisultato(s, { ordine: ['p1', 'p3', 'p2'] });   // 25 / 18 / 15
    const albo = S.albo(s);
    assert.equal(albo.campione.id, 'p1');
    assert.equal(albo.campione.punti, 50);
    assert.equal(albo.gare, 2);
    // p2 ha 18+15=33, p3 ha 15+18=33: il margine e sul SECONDO, chiunque sia.
    assert.equal(albo.margine, 50 - 33);
    assert.deepEqual(albo.classifica.map(r => r.id), S.classifica(s).map(r => r.id));
});

test('i numeri di un pilota: gare, vittorie, podi, miglior arrivo', () => {
    let s = S.creaStagione({
        nome: 'x', calendario: ['a', 'b', 'c'],
        piloti: [{ uid: 'u' }, { bot: true }, { bot: true }, { bot: true }],
    });
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3', 'p4'] });   // 1o
    s = S.registraRisultato(s, { ordine: ['p2', 'p3', 'p1', 'p4'] });   // 3o
    s = S.registraRisultato(s, { ordine: ['p2', 'p3', 'p4', 'p1'] });   // 4o

    const n = S.numeriDi(s, 'p1');
    assert.equal(n.gare, 3);
    assert.equal(n.vittorie, 1);
    assert.equal(n.podi, 2, 'primo e terzo posto sono due podi');
    assert.equal(n.punti, 25 + 15 + 12);
    assert.equal(n.miglioreArrivo, 1);

    // Un pilota che non ha mai corso non ha un "miglior arrivo" da mostrare:
    // uno zero li' verrebbe letto come una posizione.
    const mai = S.numeriDi(stagioneDiProva(), 'p1');
    assert.equal(mai.gare, 0);
    assert.equal(mai.miglioreArrivo, null);
});

test('la cronaca racconta le gare in ordine, con la classifica di quel momento', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p2', 'p1', 'p3'] });
    s = S.registraRisultato(s, { ordine: ['p1', 'p3', 'p2'] });

    const c = S.cronaca(s);
    assert.equal(c.length, 2, 'una voce per ogni gara CORSA, non per ogni tappa in calendario');
    assert.deepEqual(c.map(x => x.numero), [1, 2]);
    assert.deepEqual(c.map(x => x.pista), ['a', 'b']);
    assert.equal(c[0].vincitore.id, 'p2');
    assert.equal(c[1].vincitore.id, 'p1');
    // Dopo la prima gara comanda p2; alla fine comanda p1. E' il duello che le
    // barre devono raccontare: senza la classifica PROGRESSIVA non si vede.
    assert.equal(c[0].classifica[0].id, 'p2');
    assert.deepEqual(c[1].classifica.map(r => r.id), S.classifica(s).map(r => r.id));
    // Una stagione senza gare corse non ha niente da raccontare.
    assert.deepEqual(S.cronaca(stagioneDiProva()), []);
});
```

- [ ] **Step 2: Lanciarli e vederli rossi**

Run: `node --test frontend/shared/f1Stagione.test.js`
Atteso: 3 falliti, `S.albo is not a function`.

- [ ] **Step 3: Implementare, dopo `vittorie()`**

```js
    // I numeri di un pilota nella stagione. Tutti ricavati dai risultati: un
    // conteggio salvato accanto sarebbe un secondo posto dove vive lo stesso
    // numero.
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
```

E nell'oggetto esportato in fondo al file, accanto a `riepilogoGara`:

```js
        classifica, vittorie, riepilogoGara, garaDaRiepilogare, albo, numeriDi, cronaca, siPuoRiprendere,
```

- [ ] **Step 4: Verde**

Run: `node --test frontend/shared/f1Stagione.test.js`
Atteso: 24 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Stagione.js frontend/shared/f1Stagione.test.js
git commit -m "Stagioni passo 5/1: i numeri della fine stagione"
```

---

### Task 2: L'albo d'oro (movimento 4)

La destinazione prima del viaggio: senza, la cerimonia non ha dove finire. Alla fine di questo task una stagione conclusa mostra già la sua schermata finale — e l'utente può playtestarla concludendo un campionato da 3 gare.

**Files:**
- Modify: `frontend/f1.html` (una `<section>` nuova dentro `#stagione-overlay`, dopo `#stagione-vista-riepilogo`)
- Modify: `frontend/styles/f1.css`
- Modify: `frontend/shared/f1StagioneSchermate.js`

**Interfaces:**
- Consumes: `F1Stagione.albo()`, `F1Stagione.numeriDi()` (Task 1); `rigaPilota()`, `etichettaPilota()`, `mostraVista()` (già nel file).
- Produces: `disegnaAlbo(stagione)` — mostra la vista `albo`; ci si arriva da `disegnaRiepilogo` (ultima gara) e da `mostraStagione` quando si riapre una stagione già conclusa.

- [ ] **Step 1: Il markup**

In `frontend/f1.html`, subito dopo la sezione `#stagione-vista-riepilogo`:

```html
            <!-- 4. ALBO D'ORO: la stagione e' finita.
                 Ci si arriva alla fine della premiazione, e ci si torna ogni
                 volta che si riapre una stagione conclusa: una stagione finita
                 non ha un calendario da mostrare, ha un risultato. -->
            <section class="stagione-vista" id="stagione-vista-albo" style="display:none;">
                <div class="stagione-albo-testa">
                    <span class="stagione-riepilogo-etichetta">Campione</span>
                    <span class="stagione-albo-chi" id="stagione-albo-chi">&mdash;</span>
                    <span class="stagione-albo-punti" id="stagione-albo-punti"></span>
                </div>
                <div class="stagione-colonne">
                    <div class="stagione-col">
                        <div class="stagione-sezione">Classifica finale</div>
                        <ol class="stagione-classifica" id="stagione-albo-classifica"></ol>
                    </div>
                    <div class="stagione-col">
                        <div class="stagione-sezione">La stagione</div>
                        <dl class="stagione-numeri" id="stagione-albo-numeri"></dl>
                    </div>
                </div>
                <div class="stagione-comandi">
                    <p class="stagione-nota" id="stagione-albo-nota"></p>
                    <button type="button" class="stagione-btn stagione-btn-primario" id="stagione-albo-esci">
                        Torna alla lobby
                    </button>
                </div>
            </section>
```

- [ ] **Step 2: Lo stile**

In `frontend/styles/f1.css`, dopo il blocco `--- riepilogo di fine gara ---`:

```css
/* --- albo d'oro --- */
.stagione-albo-testa { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.stagione-albo-chi { font-size: clamp(20px, 3vh, 32px); font-weight: 800; }
.stagione-albo-punti { font-size: 14px; color: var(--sel-tenue); }
/* I numeri della stagione: etichetta a sinistra, valore a destra, come una
   scheda tecnica. Nessuna icona — sono cifre, si leggono. */
.stagione-numeri { margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.stagione-numeri div {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 8px 12px; border-radius: 8px; background: var(--sel-lavagna);
}
.stagione-numeri dt { font-size: 13px; color: var(--sel-tenue); }
.stagione-numeri dd {
    margin: 0; font-weight: 800; font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: La schermata**

In `frontend/shared/f1StagioneSchermate.js`, aggiungere `albo: null` a `PRECEDENTE`, `'albo'` all'elenco di `mostraVista`, e dopo `disegnaRiepilogo`:

```js
        // ── l'albo d'oro ───────────────────────────────────────────────
        // Una stagione finita non ha un calendario da mostrare: ha un
        // risultato. Ci si arriva a fine premiazione, e ci si torna ogni volta
        // che si riapre quella stagione.
        function disegnaAlbo(stagione) {
            const albo = F1Stagione.albo(stagione);
            testo(el('stagione-titolo'), stagione.nome);
            const campione = albo.campione;
            testo(el('stagione-albo-chi'), campione ? etichettaPilota(campione, mioUid) : '—');
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

            // I numeri sono quelli del CAMPIONE se il campione sono io; se no,
            // i miei accanto ai suoi — a chi guarda interessa come e' andata a
            // lui, non solo a chi ha vinto.
            const mio = albo.classifica.find(r => r.uid && r.uid === mioUid);
            const suoi = campione ? F1Stagione.numeriDi(stagione, campione.id) : null;
            const miei = (mio && (!campione || mio.id !== campione.id))
                ? F1Stagione.numeriDi(stagione, mio.id) : null;
            const numeri = el('stagione-albo-numeri');
            numeri.innerHTML = '';
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
            for (const [etichetta, valore] of voci) {
                const riga = document.createElement('div');
                const dt = document.createElement('dt');
                dt.textContent = etichetta;
                const dd = document.createElement('dd');
                dd.textContent = valore;
                riga.appendChild(dt); riga.appendChild(dd);
                numeri.appendChild(riga);
            }

            testo(el('stagione-albo-nota'), campione && campione.uid && campione.uid === mioUid
                ? 'Campione del mondo.'
                : '');
            mostraVista('albo');
        }
```

E il pulsante, accanto agli altri `addEventListener` di `monta`:

```js
        el('stagione-albo-esci').addEventListener('click', () => versoLobby && versoLobby());
```

- [ ] **Step 4: Arrivarci**

Due sole strade, in `mostraStagione` e in `disegnaRiepilogo`:

```js
            // Una stagione conclusa si apre sul suo albo d'oro: il calendario
            // non ha piu' niente da proporre.
            if (gara != null) disegnaRiepilogo(stagione, gara, ripresa);
            else if (F1Stagione.finita(stagione)) disegnaAlbo(stagione);
            else disegnaCalendario(stagione, ripresa);
```

e in `disegnaRiepilogo`, al posto della riga che assegna `onclick`:

```js
            // Se quella era l'ultima gara, di qui non si torna al calendario:
            // si va alla premiazione. (Per ora dritti all'albo d'oro: i
            // movimenti si inseriscono nei task successivi.)
            const finita = F1Stagione.finita(stagione);
            el('stagione-al-calendario').textContent = finita ? 'La premiazione' : 'Vai al calendario';
            el('stagione-al-calendario').onclick = () => {
                if (finita) disegnaAlbo(stagione);
                else disegnaCalendario(stagione, ripresa);
            };
```

- [ ] **Step 5: Guardarla in headless**

Riusare `scratchpad/genera.js` (estrae il markup vero da `f1.html` e monta il modulo vero) con una stagione a calendario esaurito, e controllare a occhio: il campione in testata, la classifica finale con le vittorie, i numeri a destra.

- [ ] **Step 6: Bump del cache-busting e commit**

In `frontend/f1.html` incrementare `f1.css?v=`, `f1Stagione.js?v=`, `f1StagioneSchermate.js?v=`.

```bash
git add frontend/f1.html frontend/styles/f1.css frontend/shared/f1StagioneSchermate.js
git commit -m "Stagioni passo 5/2: l'albo d'oro di fine stagione"
```

**PLAYTEST:** creare una stagione da 3 gare, correrle tutte. Dopo l'ultima: il riepilogo deve offrire *La premiazione*, e l'albo d'oro deve dire il campione giusto coi numeri giusti. Riaprendo quella stagione dall'elenco si deve tornare all'albo, non al calendario.

---

### Task 3: La coreografia (modulo puro)

**Files:**
- Create: `frontend/shared/f1Premiazione.js`
- Create: `frontend/shared/f1Premiazione.test.js`
- Modify: `frontend/f1.html` (nuovo `<script src="shared/f1Premiazione.js?v=...">` prima di `f1.js`)

**Interfaces:**
- Produces:
  - `F1Premiazione.DURATE` → `{ arrivo: 2600, salita: 900, sosta: 700, apoteosi: 5200 }` (ms).
  - `F1Premiazione.copione(quanti)` → array di battute `{ posto, da, a }` in ms, dal terzo al primo, seguite dalla battuta `{ posto: 0, da, a }` dell'apoteosi. `posto` è la posizione in classifica (3, 2, 1), `posto: 0` è la parte finale senza nessuno che entra.
  - `F1Premiazione.durataTotale(quanti)` → ms.
  - `F1Premiazione.stato(copione, tMs)` → `{ posto, fase, avanzamento }` con `fase` fra `'arrivo' | 'salita' | 'sosta' | 'apoteosi' | 'finita'` e `avanzamento` da 0 a 1 dentro la fase.

**Perché un modulo a sé:** di una cerimonia l'unica parte verificabile a tavolino sono i tempi e l'ordine. Tenuti dentro `f1.js` andrebbero guardati a occhio ad ogni modifica; qui si controllano in mezzo secondo, e `f1.js` — che è già lungo — non cresce di logica.

- [ ] **Step 1: Il test che fallisce**

```js
// frontend/shared/f1Premiazione.test.js
//
// La coreografia della premiazione: chi entra, quando, e per quanto. Sono i
// numeri che in un'animazione non si possono controllare guardandola — a occhio
// si vede se "e' troppo lunga", non se il secondo entra prima del terzo.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./f1Premiazione');

test('si sale dal terzo al primo, mai il contrario', () => {
    const copione = P.copione(3);
    assert.deepEqual(copione.map(b => b.posto), [3, 2, 1, 0]);
    // Nessun buco e nessuna sovrapposizione: ogni battuta comincia dove
    // finisce la precedente.
    for (let i = 1; i < copione.length; i++) {
        assert.equal(copione[i].da, copione[i - 1].a, `battuta ${i} non attaccata alla precedente`);
    }
    assert.equal(copione[0].da, 0);
    assert.equal(copione[copione.length - 1].a, P.durataTotale(3));
});

test('con meno di tre piloti la cerimonia esiste lo stesso', () => {
    // Una stagione si puo' correre in due, o da soli con un bot. Un podio a
    // tre posti fissi si romperebbe proprio nel caso piu' comune del gioco in
    // singolo.
    assert.deepEqual(P.copione(1).map(b => b.posto), [1, 0]);
    assert.deepEqual(P.copione(2).map(b => b.posto), [2, 1, 0]);
    assert.ok(P.durataTotale(1) < P.durataTotale(3));
});

test('lo stato dice sempre chi sta entrando e a che punto e', () => {
    const copione = P.copione(3);
    const D = P.DURATE;

    const inizio = P.stato(copione, 0);
    assert.equal(inizio.posto, 3);
    assert.equal(inizio.fase, 'arrivo');
    assert.ok(inizio.avanzamento < 0.01);

    // A meta' dell'arrivo del terzo.
    const meta = P.stato(copione, D.arrivo / 2);
    assert.equal(meta.posto, 3);
    assert.equal(meta.fase, 'arrivo');
    assert.ok(Math.abs(meta.avanzamento - 0.5) < 0.02);

    // Appena dopo l'arrivo comincia la salita, sempre dello stesso.
    const salita = P.stato(copione, D.arrivo + 10);
    assert.equal(salita.posto, 3);
    assert.equal(salita.fase, 'salita');

    // Il primo entra per ultimo, e dopo di lui c'e' l'apoteosi.
    const battutaPrimo = copione.find(b => b.posto === 1);
    assert.equal(P.stato(copione, battutaPrimo.da + 10).posto, 1);
    assert.equal(P.stato(copione, battutaPrimo.a + 10).fase, 'apoteosi');

    // Oltre la fine non si ricomincia da capo.
    const dopo = P.stato(copione, P.durataTotale(3) + 5000);
    assert.equal(dopo.fase, 'finita');
    assert.equal(dopo.avanzamento, 1);
});
```

- [ ] **Step 2: Rosso**

Run: `node --test frontend/shared/f1Premiazione.test.js`
Atteso: `Cannot find module './f1Premiazione'`.

- [ ] **Step 3: Il modulo**

```js
// frontend/shared/f1Premiazione.js
//
// La coreografia della premiazione di fine mondiale: quanto dura ogni pezzo,
// chi entra quando, a che punto della sua entrata si e'.
//
// Qui non c'e' una riga di Three.js e nemmeno di DOM. Chi disegna chiede
// `stato(copione, tMs)` e sa cosa mettere a schermo in quel millisecondo; i
// tempi si verificano senza browser, che di un'animazione sono la sola parte
// verificabile a tavolino.
//
// La differenza con la cerimonia di fine gara e' tutta qui dentro: li' le tre
// auto sono gia' sul podio quando la scena si apre, qui SALGONO una alla
// volta, dal terzo al primo, e ognuna ha il suo momento.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Premiazione = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Le quattro fasi di ogni entrata, in millisecondi.
    //   arrivo   — l'auto risale il rettilineo e si ferma davanti al podio
    //   salita   — sale sul gradino con un arco (e' un gioco arcade: si alza)
    //   sosta    — resta ferma il tempo di essere guardata
    //   apoteosi — nessuno entra piu': la camera si alza, partono i coriandoli
    const DURATE = { arrivo: 2600, salita: 900, sosta: 700, apoteosi: 5200 };
    const DURATA_ENTRATA = DURATE.arrivo + DURATE.salita + DURATE.sosta;

    // Le battute, dall'ultimo dei premiati al primo. `posto: 0` e' l'apoteosi:
    // non entra nessuno, e per questo non ha un posto.
    function copione(quanti) {
        const posti = [];
        for (let p = Math.max(1, Math.min(3, quanti | 0)); p >= 1; p--) posti.push(p);
        const battute = [];
        let t = 0;
        for (const posto of posti) {
            battute.push({ posto, da: t, a: t + DURATA_ENTRATA });
            t += DURATA_ENTRATA;
        }
        battute.push({ posto: 0, da: t, a: t + DURATE.apoteosi });
        return battute;
    }

    function durataTotale(quanti) {
        const b = copione(quanti);
        return b[b.length - 1].a;
    }

    function stato(copione, tMs) {
        const t = Math.max(0, tMs);
        const ultima = copione[copione.length - 1];
        if (t >= ultima.a) return { posto: 0, fase: 'finita', avanzamento: 1 };

        const battuta = copione.find(b => t < b.a) || ultima;
        const dentro = t - battuta.da;
        if (battuta.posto === 0) {
            return { posto: 0, fase: 'apoteosi', avanzamento: dentro / DURATE.apoteosi };
        }
        if (dentro < DURATE.arrivo) {
            return { posto: battuta.posto, fase: 'arrivo', avanzamento: dentro / DURATE.arrivo };
        }
        if (dentro < DURATE.arrivo + DURATE.salita) {
            return {
                posto: battuta.posto, fase: 'salita',
                avanzamento: (dentro - DURATE.arrivo) / DURATE.salita,
            };
        }
        return {
            posto: battuta.posto, fase: 'sosta',
            avanzamento: (dentro - DURATE.arrivo - DURATE.salita) / DURATE.sosta,
        };
    }

    return { DURATE, copione, durataTotale, stato };
});
```

- [ ] **Step 4: Verde**

Run: `node --test frontend/shared/f1Premiazione.test.js`
Atteso: 3 pass.

- [ ] **Step 5: Caricarlo nella pagina**

In `frontend/f1.html`, accanto agli altri script di `shared/`, **prima** di `f1.js`:

```html
    <script src="shared/f1Premiazione.js?v=20260820a"></script>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/f1Premiazione.js frontend/shared/f1Premiazione.test.js frontend/f1.html
git commit -m "Stagioni passo 5/3: la coreografia della premiazione"
```

---

### Task 4: La consegna sul podio (movimento 3)

**Files:**
- Modify: `frontend/f1.js` (accanto al blocco della cerimonia di fine gara, `CER_*` e `costruisciCerimonia`)
- Modify: `frontend/shared/f1StagioneSchermate.js` (il pulsante *La premiazione* chiama la cerimonia invece dell'albo)
- Modify: `frontend/styles/f1.css` (la fascia dei nomi durante la consegna)
- Modify: `frontend/f1.html` (la fascia + il suggerimento «Esc per saltare»)

**Interfaces:**
- Consumes: `F1Premiazione.copione/stato/durataTotale`, `F1Stagione.albo()`; e da `f1.js`: `loadCarModel(colore, cb, livrea)`, `fetchLiveryForUid(uid)`, `applicaStile(mesh, {saturation})`, `smaltisciAuto(gruppo)`, `assiDelTraguardo()`, `SCENERY_ASSET_PATHS.podium`, `CER_SCALA`, `CER_GRADINI`, `misto(a,b,t)`, `PANORAMICA_NEAR`, `mostraAutoDiGara(false)`.
- Produces: `window.f1PremiazioneAvvia(righe)` → Promise che si risolve a cerimonia finita (o saltata). `righe` sono le prime tre della classifica finale: `[{ uid, colore, bot, etichetta, punti }]`.

**La scena, in numeri.** Il podio è lo stesso della cerimonia di gara (`podium.glb`, `CER_SCALA = 1.6`, gradini in `CER_GRADINI`), posato sul traguardo con il fronte verso chi arriva. Le differenze:

- ogni auto parte **fuori campo**, a 60 unità dietro il podio lungo il rettilineo, e arriva alla sua **piazzola a terra** davanti al gradino (stesso `x` del gradino, `z` del fronte del podio + 9);
- poi **sale** al gradino con un arco: quota interpolata più una campana `4·a·(1-a)·1.2` che le fa scavalcare il bordo;
- le auto **non premiate** (dalla quarta in giù, fino a 8) stanno schierate ai lati come una parata, ferme dall'inizio;
- la **camera** cambia per ogni entrata: bassa e ravvicinata sul gradino di chi entra (distanza 16, quota 3.2), poi durante l'apoteosi sale a 12 e arretra a 30 inquadrando tutto il podio.

- [ ] **Step 1: Le costanti e il gruppo**

In `frontend/f1.js`, dopo `CER_AVVICINAMENTO`:

```js
    // ── PREMIAZIONE DI FINE MONDIALE ────────────────────────────────────
    // Non e' la cerimonia di fine gara con un titolo diverso: li' le tre auto
    // sono gia' sul podio quando si apre la scena, qui SALGONO una alla volta.
    // Il podio e la sua scala sono gli stessi (CER_*): a cambiare e' chi c'e'
    // sopra, quando ci arriva e da dove lo si guarda.
    const PRE_ARRIVO_LONTANO = 60;   // da quanto indietro entra un'auto, sul rettilineo
    const PRE_PIAZZOLA_Z = 9;        // dove si ferma prima di salire, davanti al podio
    const PRE_ARCO = 1.2;            // quanto scavalca il bordo del gradino salendo
    const PRE_CAM_VICINO = { distanza: 16, quota: 3.2, mira: 3.4 };
    const PRE_CAM_LARGO = { distanza: 30, quota: 12, mira: 5.5 };
    const PRE_PARATA_MAX = 8;        // quante auto non premiate si schierano ai lati
    const PRE_PARATA_PASSO = 5.2;    // distanza fra un'auto e l'altra della parata
```

- [ ] **Step 2: Costruire la scena**

Sempre in `f1.js`, dopo `costruisciCerimonia`:

```js
    // Costruisce podio, auto dei premiati (fuori campo) e parata. Restituisce
    // il necessario per animarle: le auto premiate in ordine di posto, e le
    // pose di partenza e arrivo di ognuna.
    function costruisciPremiazione(righe, tutte) {
        const premiati = (righe || []).slice(0, 3);
        if (!premiati.length) return Promise.resolve(null);
        const miaSequenza = sequenzaCorrente;

        const caricaPodio = new Promise((risolvi, rifiuta) => {
            new THREE.GLTFLoader().load(SCENERY_ASSET_PATHS.podium,
                (gltf) => risolvi(gltf.scene), undefined, rifiuta);
        });
        const caricaAuto = (riga) => fetchLiveryForUid(riga.bot ? null : riga.uid)
            .then((livrea) => new Promise((risolvi) => loadCarModel(riga.colore, risolvi, livrea)));

        const contorno = (tutte || []).slice(3, 3 + PRE_PARATA_MAX);
        return Promise.all([
            caricaPodio,
            Promise.all(premiati.map(caricaAuto)),
            Promise.all(contorno.map(caricaAuto)),
        ]).then(([podioMesh, auto, parata]) => {
            const gruppo = new THREE.Group();
            gruppo.visible = false;

            podioMesh.scale.setScalar(CER_SCALA);
            applicaStile(podioMesh, { saturation: ToonPalette.SATURATION.scenery });
            gruppo.add(podioMesh);

            const attori = auto.map((car, k) => {
                zittisci(car);
                const g = CER_GRADINI[k];
                const gradino = {
                    x: g.x * CER_SCALA, y: g.y * CER_SCALA, z: g.z * CER_SCALA,
                };
                const piazzola = { x: gradino.x, y: 0, z: PRE_PIAZZOLA_Z };
                const lontano = { x: gradino.x, y: 0, z: -PRE_ARRIVO_LONTANO };
                car.rotation.set(0, 0, 0);
                car.position.set(lontano.x, lontano.y, lontano.z);
                car.visible = false;      // entra quando tocca a lei
                gruppo.add(car);
                return { car, posto: k + 1, lontano, piazzola, gradino };
            });

            // La parata: ferme ai due lati, muso verso il podio. Non entrano e
            // non si muovono — sono il campo, e servono a dire che quello che
            // sta finendo e' un campionato e non una gara.
            parata.forEach((car, k) => {
                zittisci(car);
                const lato = (k % 2 === 0) ? -1 : 1;
                const fila = Math.floor(k / 2);
                car.position.set(lato * (12 + fila * 1.2), 0, PRE_PIAZZOLA_Z + 4 + fila * PRE_PARATA_PASSO);
                car.rotation.set(0, lato * -Math.PI / 2, 0);
                gruppo.add(car);
            });

            const { p, avanti } = assiDelTraguardo();
            gruppo.position.set(p.x, p.y || 0, p.z);
            gruppo.rotation.set(0, Math.atan2(-avanti.x, -avanti.z), 0);

            if (miaSequenza !== sequenzaCorrente) { smaltisciAuto(gruppo); return null; }
            scene.add(gruppo);
            return { gruppo, attori, base: { p, avanti, quota: p.y || 0 } };
        }).catch(() => null);
    }

    // Un'auto in mostra non deve rombare: e' la stessa cosa che fa la
    // cerimonia di fine gara, tirata fuori perche' ora la fanno in due.
    function zittisci(car) {
        if (!car.userData.engineSound) return;
        try { car.userData.engineSound.stop(); } catch (e) { /* mai partito */ }
        car.remove(car.userData.engineSound);
        delete car.userData.engineSound;
    }
```

(e in `costruisciCerimonia` sostituire il blocco che ferma il motore con `zittisci(car)`).

- [ ] **Step 3: Animarla**

```js
    let premiazione = null;   // { scena, copione, da, righe, risolvi, saltata }

    // La posizione di un'auto premiata al tempo t: fuori campo finche' non
    // tocca a lei, poi arrivo, salita ad arco, e ferma sul gradino.
    function posaPremiato(attore, stato) {
        const suo = stato.posto === attore.posto;
        const gia = stato.posto === 0 || stato.posto < attore.posto;   // i posti scendono: 3, 2, 1
        if (gia) return { visibile: true, pos: attore.gradino };
        if (!suo) return { visibile: false, pos: attore.lontano };
        if (stato.fase === 'arrivo') {
            const e = stato.avanzamento * stato.avanzamento * (3 - 2 * stato.avanzamento);
            return {
                visibile: true,
                pos: {
                    x: attore.piazzola.x,
                    y: 0,
                    z: misto(attore.lontano.z, attore.piazzola.z, e),
                },
            };
        }
        if (stato.fase === 'salita') {
            const a = stato.avanzamento;
            return {
                visibile: true,
                pos: {
                    x: attore.gradino.x,
                    y: misto(0, attore.gradino.y, a) + 4 * a * (1 - a) * PRE_ARCO,
                    z: misto(attore.piazzola.z, attore.gradino.z, a),
                },
            };
        }
        return { visibile: true, pos: attore.gradino };
    }

    function aggiornaPremiazione() {
        if (!premiazione) return;
        const t = performance.now() - premiazione.da;
        const stato = F1Premiazione.stato(premiazione.copione, t);

        for (const attore of premiazione.scena.attori) {
            const posa = posaPremiato(attore, stato);
            attore.car.visible = posa.visibile;
            attore.car.position.set(posa.pos.x, posa.pos.y, posa.pos.z);
        }

        // La camera: addosso a chi sta entrando, larga sull'apoteosi. Durante
        // l'apoteosi si ALZA piano invece di scattare, e per questo la sua
        // posizione e' una miscela fra le due pose, non una delle due.
        const { p, avanti, quota } = premiazione.scena.base;
        const vicino = stato.posto !== 0;
        const apertura = vicino ? 0 : Math.min(1, stato.avanzamento * 1.4);
        const distanza = misto(PRE_CAM_VICINO.distanza, PRE_CAM_LARGO.distanza, apertura);
        const altezza = misto(PRE_CAM_VICINO.quota, PRE_CAM_LARGO.quota, apertura);
        // Di lato quando entra qualcuno che non sta al centro: guardarlo
        // frontalmente lo metterebbe dietro il gradino piu' alto.
        const scarto = vicino ? (CER_GRADINI[stato.posto - 1].x * CER_SCALA) * 0.6 : 0;
        const destra = { x: -avanti.z, z: avanti.x };
        camera.position.set(
            p.x - avanti.x * distanza + destra.x * scarto,
            quota + altezza,
            p.z - avanti.z * distanza + destra.z * scarto,
        );
        camera.lookAt(p.x, quota + misto(PRE_CAM_VICINO.mira, PRE_CAM_LARGO.mira, apertura), p.z);

        aggiornaFasciaPremiazione(stato);
        if (stato.fase === 'finita') fermaPremiazione();
    }
```

- [ ] **Step 4: Avvio, fascia e uscita**

```js
    // Avvia la cerimonia e si risolve quando e' finita (o quando la si salta).
    // La chiama la schermata della stagione: e' il client a decidere tutto,
    // il server la stagione l'ha gia' salvata dopo l'ultima gara.
    window.f1PremiazioneAvvia = function (righe, tutte) {
        return costruisciPremiazione(righe, tutte).then((scena) => {
            if (!scena) return null;   // niente scena: si va all'albo d'oro e basta
            scena.gruppo.visible = true;
            mostraAutoDiGara(false);
            camera.near = PANORAMICA_NEAR;
            camera.updateProjectionMatrix();
            document.getElementById('stagione-overlay').style.display = 'none';
            document.getElementById('premiazione-fascia').style.display = '';
            premiazione = {
                scena, righe,
                copione: F1Premiazione.copione(Math.min(3, righe.length)),
                da: performance.now(),
                risolvi: null,
            };
            return new Promise((risolvi) => { premiazione.risolvi = risolvi; });
        });
    };

    function aggiornaFasciaPremiazione(stato) {
        const fascia = document.getElementById('premiazione-fascia');
        const riga = stato.posto ? premiazione.righe[stato.posto - 1] : premiazione.righe[0];
        if (!riga) return;
        document.getElementById('premiazione-posto').textContent =
            stato.posto ? `${stato.posto}°` : 'Campione';
        document.getElementById('premiazione-chi').textContent = riga.etichetta;
        document.getElementById('premiazione-pallino').style.background = riga.colore || '#888';
        document.getElementById('premiazione-punti').textContent = `${riga.punti} punti`;
        fascia.classList.toggle('campione', stato.posto === 0);
    }

    function fermaPremiazione() {
        if (!premiazione) return;
        const finita = premiazione;
        premiazione = null;
        document.getElementById('premiazione-fascia').style.display = 'none';
        document.getElementById('stagione-overlay').style.display = 'flex';
        if (finita.scena) {
            scene.remove(finita.scena.gruppo);
            smaltisciAuto(finita.scena.gruppo);
        }
        mostraAutoDiGara(true);
        camera.near = nearDiGioco;
        camera.updateProjectionMatrix();
        if (finita.risolvi) finita.risolvi(true);
    }
```

Nel ciclo di `animate()`, accanto a `else if (cerimoniaAttiva) aggiornaCameraCerimonia();`:

```js
        else if (premiazione) aggiornaPremiazione();
```

E il salto, accanto agli altri `keydown` di `f1.js`:

```js
    // Si puo' saltare: una cerimonia che non si puo' interrompere e' una
    // cerimonia che la seconda volta si subisce.
    document.addEventListener('keydown', (e) => {
        if (!premiazione) return;
        if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
        fermaPremiazione();
    });
```

- [ ] **Step 5: Il markup della fascia**

In `frontend/f1.html`, fuori da `#stagione-overlay` (è una grafica sopra la scena 3D, non una schermata):

```html
    <!-- PREMIAZIONE — la fascia dei nomi, come una grafica televisiva. Non e'
         un modale: coprirebbe il podio, che e' l'unica cosa da guardare. -->
    <div id="premiazione-fascia" style="display:none;">
        <span id="premiazione-posto">3°</span>
        <span id="premiazione-pallino"></span>
        <span id="premiazione-chi">&mdash;</span>
        <span id="premiazione-punti"></span>
        <span id="premiazione-salta">Esc per saltare</span>
    </div>
```

```css
/* La fascia della premiazione: in basso, larga, come una grafica TV. */
#premiazione-fascia {
    position: fixed; left: 50%; bottom: 7vh; transform: translateX(-50%);
    z-index: 41; display: flex; align-items: center; gap: 14px;
    padding: 12px 22px; border-radius: 12px;
    background: rgba(8, 25, 30, 0.86); border: 1px solid rgba(255, 255, 255, 0.12);
    color: #E9F3F5; font-family: 'Fredoka', 'Trebuchet MS', sans-serif;
}
#premiazione-posto { font-size: 22px; font-weight: 800; color: #8CAEB6; }
#premiazione-pallino { width: 14px; height: 14px; border-radius: 50%; }
#premiazione-chi { font-size: 22px; font-weight: 800; }
#premiazione-punti { font-size: 14px; color: #8CAEB6; }
#premiazione-salta { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #8CAEB6; opacity: 0.7; margin-left: 10px; }
#premiazione-fascia.campione { border-color: #E23127; }
#premiazione-fascia.campione #premiazione-posto { color: #E23127; }
```

- [ ] **Step 6: Collegare il pulsante**

In `f1StagioneSchermate.js`, dentro `disegnaRiepilogo`, al posto del salto diretto all'albo:

```js
            el('stagione-al-calendario').onclick = () => {
                if (!finita) { disegnaCalendario(stagione, ripresa); return; }
                const albo = F1Stagione.albo(stagione);
                const righe = albo.classifica.slice(0, 3).map(r => ({
                    uid: r.uid, colore: r.colore, bot: r.bot, punti: r.punti,
                    etichetta: etichettaPilota(r, mioUid),
                }));
                const tutte = albo.classifica.map(r => ({
                    uid: r.uid, colore: r.colore, bot: r.bot,
                }));
                // Se la cerimonia non si puo' costruire (asset mancante, WebGL
                // in ginocchio) si va all'albo lo stesso: la fine di una
                // stagione non puo' dipendere da un modello 3D.
                const cerimonia = (typeof window !== 'undefined' && window.f1PremiazioneAvvia)
                    ? window.f1PremiazioneAvvia(righe, tutte)
                    : Promise.resolve(null);
                cerimonia.catch(() => null).then(() => disegnaAlbo(stagione));
            };
```

- [ ] **Step 7: Bump, suite, commit**

```bash
node --test frontend
git add frontend/f1.js frontend/f1.html frontend/styles/f1.css frontend/shared/f1StagioneSchermate.js
git commit -m "Stagioni passo 5/4: le auto salgono sul podio del mondiale"
```

**PLAYTEST:** finire una stagione da 3 gare. Guardare: le auto entrano dal fondo del rettilineo una alla volta (3ª, 2ª, 1ª), salgono sul gradino giusto, la livrea è quella vera, la fascia dice i nomi giusti, l'inquadratura non finisce dentro un cartellone, Esc salta e porta all'albo d'oro.

---

### Task 5: Lo stacco e l'annata che scorre (movimenti 1 e 2)

**Files:**
- Modify: `frontend/f1.js` (avvio della sequenza: sting → annata → consegna)
- Modify: `frontend/f1.html` + `frontend/styles/f1.css` (la sovrimpressione dell'annata)

**Interfaces:**
- Consumes: `F1Sting.play({ titolo, sottotitolo, durataMs })`, `F1Stagione.cronaca()`, `avviaPanoramica(durataMs)` (già in `f1.js`, usata dalla schermata mescole).
- Produces: `window.f1PremiazioneAvvia(righe, tutte, cronaca, nome)` — la firma cresce di due argomenti; chi la chiama è un punto solo.

**Come si compone.** `f1PremiazioneAvvia` diventa una sequenza di tre promesse in fila: lo sting (4.2 s), l'annata (1.7 s per gara, minimo 6 s, sulla panoramica del circuito già esistente), poi la consegna del Task 4. La scena 3D della consegna si **precarica durante lo sting** — è la stessa lezione dell'auto in pole, che arrivava tre secondi tardi perché veniva caricata quando serviva.

L'annata è una sovrimpressione DOM sopra la panoramica: per ogni gara, pista e vincitore in grande e due barre in basso — i primi due della classifica **di quel momento** — che crescono verso i punti finali. Le barre si misurano sul punteggio massimo raggiunto a fine stagione, così l'ultima gara riempie lo schermo e non c'è un riscalamento a metà racconto.

- [ ] **Step 1: Il markup**

```html
    <!-- PREMIAZIONE — l'annata che scorre. Sopra la panoramica del circuito:
         una gara alla volta, e in basso il duello per il titolo che si
         ricostruisce. E' il pezzo che una cerimonia di fine gara non puo'
         avere: racconta la stagione, non il pomeriggio. -->
    <div id="premiazione-annata" style="display:none;">
        <div class="pa-tappa">
            <span class="pa-numero" id="pa-numero">Gara 1</span>
            <span class="pa-pista" id="pa-pista">&mdash;</span>
        </div>
        <div class="pa-vincitore">
            <span class="pa-pallino" id="pa-pallino"></span>
            <span id="pa-chi">&mdash;</span>
            <span class="pa-punti" id="pa-punti"></span>
        </div>
        <div class="pa-barre">
            <div class="pa-barra"><span class="pa-riempie" id="pa-barra-1"></span><span class="pa-etichetta" id="pa-nome-1"></span></div>
            <div class="pa-barra"><span class="pa-riempie" id="pa-barra-2"></span><span class="pa-etichetta" id="pa-nome-2"></span></div>
        </div>
    </div>
```

Stile: stessa famiglia della fascia (fondo scuro traslucido, Fredoka, colori `--sel-*` ricopiati come già fatto per `#premiazione-fascia`); `.pa-riempie` è un `<span>` a larghezza percentuale con `transition: width 600ms ease`; il colore lo mette JS dal colore del pilota.

- [ ] **Step 2: La sequenza**

```js
    const PRE_STING_MS = 4200;
    const PRE_GARA_MS = 1700;      // quanto resta a schermo ogni tappa dell'annata
    const PRE_ANNATA_MIN = 6000;

    window.f1PremiazioneAvvia = function (righe, tutte, cronaca, nome) {
        // La scena si carica DURANTE lo stacco: costruirla quando serve la
        // farebbe arrivare in ritardo sulla musica, ed e' l'errore gia' fatto
        // con l'auto in pole del riepilogo griglia.
        const scenaPronta = costruisciPremiazione(righe, tutte);
        return F1Sting.play({
            titolo: 'Campione del mondo',
            sottotitolo: nome || '',
            durataMs: PRE_STING_MS,
        })
            .then(() => mostraAnnata(cronaca || []))
            .then(() => scenaPronta)
            .then((scena) => avviaConsegna(scena, righe));
    };
```

```js
    // L'annata, una tappa alla volta, sulla panoramica del circuito. Le barre
    // si misurano sul punteggio FINALE del capoclassifica: cosi' l'ultima gara
    // riempie la barra e non c'e' un riscalamento a meta' racconto, che
    // renderebbe illeggibile proprio il confronto che si vuole mostrare.
    function mostraAnnata(cronaca) {
        if (!cronaca.length) return Promise.resolve();
        const durata = Math.max(PRE_ANNATA_MIN, cronaca.length * PRE_GARA_MS);
        const finale = cronaca[cronaca.length - 1].classifica;
        const massimo = Math.max(1, finale[0] ? finale[0].punti : 1);
        const box = document.getElementById('premiazione-annata');
        box.style.display = '';
        avviaPanoramica(durata);

        return new Promise((risolvi) => {
            let i = 0;
            const scrivi = () => {
                const voce = cronaca[i];
                document.getElementById('pa-numero').textContent = `Gara ${voce.numero}`;
                document.getElementById('pa-pista').textContent = nomeDellaPista(voce.pista);
                document.getElementById('pa-chi').textContent = etichettaDi(voce.vincitore);
                document.getElementById('pa-pallino').style.background = voce.vincitore.colore || '#888';
                document.getElementById('pa-punti').textContent = '+25';
                for (const k of [0, 1]) {
                    const riga = voce.classifica[k];
                    const barra = document.getElementById('pa-barra-' + (k + 1));
                    const nome = document.getElementById('pa-nome-' + (k + 1));
                    if (!riga) { barra.style.width = '0%'; nome.textContent = ''; continue; }
                    barra.style.width = Math.round((riga.punti / massimo) * 100) + '%';
                    barra.style.background = riga.colore || '#888';
                    nome.textContent = `${etichettaDi(riga)} ${riga.punti}`;
                }
                i += 1;
                if (i < cronaca.length && premiazioneInCorso) {
                    setTimeout(scrivi, durata / cronaca.length);
                    return;
                }
                setTimeout(() => { box.style.display = 'none'; risolvi(); },
                    premiazioneInCorso ? durata / cronaca.length : 0);
            };
            scrivi();
        });
    }
```

`premiazioneInCorso` è una variabile di modulo messa a `false` da Esc: il salto deve interrompere anche questo movimento, non solo la consegna. `nomeDellaPista` ed `etichettaDi` sono due funzioncine locali — la prima legge l'elenco piste già scaricato per la schermata della stagione, la seconda ripete la regola di sempre (nome del bot, oppure «Tu»/«Pilota»).

**Aggiornare anche il chiamante**: in `f1StagioneSchermate.js` la chiamata diventa

```js
                    ? window.f1PremiazioneAvvia(righe, tutte, F1Stagione.cronaca(stagione), stagione.nome)
```

- [ ] **Step 3: Playtest e commit**

```bash
git add frontend/f1.js frontend/f1.html frontend/styles/f1.css
git commit -m "Stagioni passo 5/5: lo stacco e l'annata che scorre"
```

**PLAYTEST:** la sequenza intera, dall'ultimo traguardo all'albo d'oro. Guardare che lo stacco dica il nome del proprio campionato, che le tappe scorrano leggibili (né troppo veloci né troppo lente), che le barre finiscano dove dice la classifica finale, e che Esc salti tutto e porti all'albo.

---

### Task 6: Il trofeo (quando l'asset arriva)

L'asset lo procura l'utente. Il codice va scritto **prima**, e deve girare identico se il file non c'è.

**Files:**
- Modify: `frontend/f1.js`
- L'asset: `frontend/assets/custom/circuit/trophy.glb`

**Cosa serve all'asset** (da dire all'utente):
- un GLB, stile voxel/boxy come il resto del circuito;
- in piedi lungo **+Y**, fronte verso **+Z**, origine **alla base** (come `podium.glb`);
- **qualsiasi dimensione**: il codice lo normalizza da sé a 2.2 unità di altezza col bounding box, così non serve concordare una scala.

- [ ] **Step 1: Caricamento opzionale**

```js
    const PRE_TROFEO_PATH = '/assets/custom/circuit/trophy.glb';
    const PRE_TROFEO_ALTEZZA = 2.2;   // unità di mondo, misurate sul gradino piu' alto

    // Il trofeo e' facoltativo: se il file non c'e', la cerimonia gira
    // identica. Un 404 in console non e' un errore da mostrare — e' la
    // risposta giusta alla domanda "c'e' un trofeo?".
    function caricaTrofeo() {
        return new Promise((risolvi) => {
            new THREE.GLTFLoader().load(PRE_TROFEO_PATH,
                (gltf) => risolvi(gltf.scene),
                undefined,
                () => risolvi(null));
        });
    }

    // Normalizzato dal bounding box: cosi' va bene qualunque scala abbia il
    // file, e non serve mettersi d'accordo con chi lo ha modellato.
    function posaTrofeo(mesh, gradino) {
        const box = new THREE.Box3().setFromObject(mesh);
        const altezza = Math.max(0.001, box.max.y - box.min.y);
        mesh.scale.setScalar(PRE_TROFEO_ALTEZZA / altezza);
        mesh.position.set(gradino.x, gradino.y, gradino.z - 2.6);
        applicaStile(mesh, { saturation: ToonPalette.SATURATION.scenery });
    }
```

- [ ] **Step 2: Metterlo in scena**

In `costruisciPremiazione`, aggiungere `caricaTrofeo()` alle promesse e, se torna un modello, posarlo davanti al gradino più alto **nascosto**; renderlo visibile in `aggiornaPremiazione` quando `stato.posto === 0` (l'apoteosi): il trofeo appare quando il campione è sul podio, non prima.

- [ ] **Step 3: Playtest e commit**

```bash
git add frontend/f1.js
git commit -m "Stagioni passo 5/6: il trofeo del campione, se c'e'"
```

---

## Dopo l'ultimo task

- Aggiornare `project_f1_stagioni.md` (passo 5 chiuso, cosa è stato deciso e perché) e `project_f1_roadmap_1_0.md` (step 7 chiuso → resta lo step 6, il tutorial).
- Il merge in `main` e il push li decide l'utente.
