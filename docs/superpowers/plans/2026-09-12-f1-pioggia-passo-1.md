# F1 — La pioggia, passo 1: si guida sul bagnato

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rendere il bagnato una condizione vera e giocabile — la pista si bagna e si asciuga cella per cella, le cinque mescole hanno la loro finestra, il meteo arriva da un profilo generato a inizio evento, e si prova con F3.

**Architecture:** un modulo condiviso nuovo `frontend/shared/f1Meteo.js` (nessun Three.js, nessun DOM, richiesto anche dal server come `trackGravel.js`) possiede il profilo meteo, la griglia del bagnato e la legge di asciugatura. Il tick del server scrive **un numero su ogni auto** (`p.bagnato`) dentro `updateTrackIndex`, che è già il posto unico dove si scrivono pendenza, rollio e acrobatico. Da lì il bagnato entra in **due consumatori indipendenti** — `AerodynamicsModel.effectiveGrip` e `CorneringGripModel.corneringCapacity` — e in `TyreModel.applyTyreWear`. Il client riceve la stessa griglia impacchettata e la usa come textura sull'asfalto.

**Tech Stack:** Node.js, `node --test` + `node:assert/strict`; moduli UMD condivisi in `frontend/shared/*.js`; Three.js r128 lato client; Socket.io per lo stato di gara; Chrome headless per le verifiche visive.

**Spec:** `docs/superpowers/specs/2026-09-12-f1-pioggia-design.md` — leggerlo prima di cominciare, il piano argomenta da lì.

## Global Constraints

- **Italiano** nei commenti e nelle comunicazioni. Nomi di funzioni e campi in italiano come i moduli recenti (`f1Danni`, `f1Duelli`, `f1Particelle`).
- **Un commit per task**, messaggio in italiano che dice *cosa cambia per il gioco*, non che elenca i file. Il **push è dell'utente**: non pushare mai.
- **Mai `git add -A`**: l'utente lavora in parallelo sui file delle piste. Aggiungere solo i file del task.
- **Baseline dei test da misurare PRIMA di cominciare**, non da dedurre da questo file: `node --test backend/` e `node --test frontend/shared/` dalla radice del repo. Attesa al 2026-09-12: backend **0 rossi** (973 pass, 0 skip), frontend **2 rossi** preesistenti (decoro paddock, e una riga di taratura mancante). Un rosso in più va attribuito solo confrontando con questa baseline.
- **`frontend/shared/` non conosce Three.js né il DOM**: i moduli lì si verificano con `node --test`. Il disegno sta in `f1.js`.
- **Ogni modifica a un JS del gioco richiede il bump di `?v=` in `frontend/f1.html`**, o il browser serve il vecchio e sembra che non sia cambiato niente.
- **Cel shading**: la somma delle intensità di luce resta ~1 e la nebbia è derivata. La pioggia non si fa abbassando le luci.
- **`PASSO_CELLA` e ogni soglia geometrica si esprimono in unità di pista**, mai in numero di campioni: il campione vale 1.18 unità su `monte-rosso` e 5.17 su `prova`.

---

## File Structure

**Creati:**
- `frontend/shared/f1Meteo.js` — profilo meteo, griglia del bagnato, legge di asciugatura, impacchettamento per la rete. Unico proprietario del dato.
- `frontend/shared/f1Meteo.test.js` — la suite del modulo.

**Modificati:**
- `backend/sockets/games/physics/TyreModel.js` — due mescole nuove, la finestra di bagnato, il fattore di vita, la mescola da qualifica.
- `backend/sockets/games/physics/AerodynamicsModel.js` — `effectiveGrip` divide per l'aderenza disponibile.
- `backend/sockets/games/physics/CorneringGripModel.js` — `corneringCapacity` la moltiplica.
- `backend/sockets/games/f1GameSocket.js` — `p.bagnato` in `updateTrackIndex`, `game.meteo` creato prima di `tyre_select`, avanzamento nel tick, evento F3, `meteo` nel payload, whitelist delle mescole.
- `backend/sockets/games/f1Bot.js` — il bot ricontrolla la mescola quando il cielo cambia.
- `frontend/f1.js` — ricezione del meteo, textura dell'asfalto, HUD, F3, pagina mescole.
- `frontend/f1.html` — le due gomme nuove nella pagina mescole, l'indicatore del cielo, bump di `?v=`.
- `frontend/styles/f1.css` — stile dell'indicatore del cielo.
- `frontend/shared/toonPalette.js` — cielo e nebbia di temporale.

---

### Task 1: Il profilo meteo

**Files:**
- Create: `frontend/shared/f1Meteo.js`
- Test: `frontend/shared/f1Meteo.test.js`

**Interfaces:**
- Consumes: niente.
- Produces: `F1Meteo.LIVELLI` (mappa nome → 0..1), `F1Meteo.ARCHETIPI` (array di nomi), `F1Meteo.generaProfilo(seme, durataMs, opzioni)` → `{ archetipo, punti: [{t, pioggia}] }`, `F1Meteo.pioggiaA(profilo, tMs)` → `0..1`, `F1Meteo.previsione(profilo, tMs)` → `'stabile' | 'variabile' | 'arrivo'`.

- [ ] **Step 1: Scrivi il test che falla**

Crea `frontend/shared/f1Meteo.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./f1Meteo.js');

const DURATA = 5 * 60 * 1000;   // una gara da cinque minuti

test('profilo: lo stesso seme da lo stesso profilo, semi diversi danno archetipi diversi', () => {
    const a = M.generaProfilo(12345, DURATA);
    const b = M.generaProfilo(12345, DURATA);
    assert.deepEqual(a, b, 'stesso seme, profilo diverso: non e\' riproducibile');
    const archetipi = new Set();
    for (let s = 0; s < 200; s++) archetipi.add(M.generaProfilo(s, DURATA).archetipo);
    assert.ok(archetipi.size >= 4, `su 200 semi sono usciti solo ${archetipi.size} archetipi`);
});

test('profilo: ogni archetipo ha la forma che promette', () => {
    const di = (nome) => M.generaProfilo(1, DURATA, { archetipo: nome });
    const p = (prof, frazione) => M.pioggiaA(prof, DURATA * frazione);

    assert.equal(p(di('asciutto'), 0.5), 0, 'asciutto non deve piovere mai');

    const scampa = di('bagnatoCheScampa');
    assert.ok(p(scampa, 0) > 0.5, 'bagnatoCheScampa deve partire bagnato');
    assert.ok(p(scampa, 0.9) < 0.1, 'bagnatoCheScampa deve finire asciutto');

    const arriva = di('temporaleCheArriva');
    assert.equal(p(arriva, 0), 0, 'temporaleCheArriva deve partire asciutto');
    assert.ok(p(arriva, 1) > 0.5, 'temporaleCheArriva deve finire sotto la pioggia');
    assert.ok(p(arriva, 0.9) > p(arriva, 0.5), 'temporaleCheArriva deve crescere');

    // ⚠️ Il picco NON si cerca a meta' esatta: `quando` e' pescato fra 0.35 e
    // 0.65, quindi a 0.5 il rovescio puo' essere gia' finito. Si cerca dove
    // cade davvero — e' la forma che conta, non l'istante.
    const rovescio = di('rovescioBreve');
    let picco = 0, dove = 0;
    for (let f = 0; f <= 1; f += 0.01) {
        const v = p(rovescio, f);
        if (v > picco) { picco = v; dove = f; }
    }
    assert.ok(picco > 0.4, `rovescioBreve non ha un picco: ${picco}`);
    assert.ok(dove > 0.2 && dove < 0.85, `il picco del rovescio cade a ${dove}, non in mezzo alla gara`);
    assert.ok(p(rovescio, 0) < 0.1 && p(rovescio, 1) < 0.2, 'rovescioBreve deve cominciare e finire asciutto');
});

test('profilo: fuori dai punti non estrapola, e ogni valore sta fra 0 e 1', () => {
    for (let s = 0; s < 50; s++) {
        const prof = M.generaProfilo(s, DURATA);
        for (let t = -10000; t <= DURATA + 10000; t += DURATA / 40) {
            const v = M.pioggiaA(prof, t);
            assert.ok(v >= 0 && v <= 1, `pioggia fuori scala: ${v} a t=${t} (seme ${s})`);
        }
    }
});

test('previsione: dice che cambiera senza dire quando', () => {
    const asciutto = M.generaProfilo(1, DURATA, { archetipo: 'asciutto' });
    assert.equal(M.previsione(asciutto, 0), 'stabile');

    const arriva = M.generaProfilo(1, DURATA, { archetipo: 'temporaleCheArriva' });
    assert.equal(M.previsione(arriva, 0), 'arrivo', 'con un temporale in arrivo deve avvisare');

    // A gara quasi finita non c'e' piu' niente da prevedere.
    assert.equal(M.previsione(arriva, DURATA * 0.99), 'stabile');
});

test('previsione: al via ogni archetipo dice la verita, e non e una finestra corta', () => {
    // ⚠️ Questo test esiste per un errore vero: la previsione guardava avanti
    // di 90 secondi fissi, gli orologi della F1 vera, e al via di una gara da
    // cinque minuti diceva «stabile» davanti a un temporale che arrivava a
    // meta'. La domanda «che gomme metto» riguarda TUTTA la gara.
    const atteso = {
        asciutto: 'stabile',
        bagnatoCheScampa: 'variabile',   // parte bagnato e schiarisce: cambia
        temporaleCheArriva: 'arrivo',
        rovescioBreve: 'arrivo',         // adesso e' asciutto e sta per piovere
        intermittente: 'arrivo',
    };
    for (const archetipo of M.ARCHETIPI) {
        for (let s = 0; s < 40; s++) {
            const prof = M.generaProfilo(s, DURATA, { archetipo });
            assert.equal(M.previsione(prof, 0), atteso[archetipo],
                `${archetipo} col seme ${s} annuncia il cielo sbagliato`);
        }
    }
});

test('previsione: un rovescio in mezzo non si nasconde dietro gli estremi', () => {
    // Un profilo costruito a mano: comincia e finisce asciutto, diluvia in
    // mezzo. Guardando solo il valore finale si direbbe «stabile» proprio a chi
    // sta per prenderselo in faccia.
    const prof = { archetipo: 'aMano', punti: [
        { t: 0, pioggia: 0 },
        { t: DURATA * 0.5, pioggia: 1 },
        { t: DURATA, pioggia: 0 },
    ] };
    assert.equal(M.previsione(prof, 0), 'arrivo', 'la pioggia in mezzo alla gara e\' passata inosservata');
    assert.equal(M.previsione(prof, DURATA * 0.5), 'variabile', 'sotto il diluvio deve annunciare che schiarisce');
    assert.equal(M.previsione(prof, DURATA), 'stabile');
});
```

- [ ] **Step 2: Esegui il test e verifica che falla**

Run: `node --test frontend/shared/f1Meteo.test.js`
Expected: FAIL con `Cannot find module './f1Meteo.js'`.

- [ ] **Step 3: Scrivi il modulo, solo la parte del profilo**

Crea `frontend/shared/f1Meteo.js`:

```js
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
        const archetipo = o.archetipo || ARCHETIPI[Math.floor(r() * ARCHETIPI.length)];
        const D = Math.max(1, durataMs || 0);
        // Sporcature: quanto forte, e quanto presto. Sempre pescate (anche
        // quando l'archetipo e' imposto) per non cambiare la sequenza del dado.
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

    return { LIVELLI, ARCHETIPI, SOGLIA_CAMBIO, generaProfilo, pioggiaA, previsione };
});
```

- [ ] **Step 4: Esegui il test e verifica che passa**

Run: `node --test frontend/shared/f1Meteo.test.js`
Expected: PASS, 6 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Meteo.js frontend/shared/f1Meteo.test.js
git commit -m "Il meteo di una gara e' una storia, non un dado a ogni tick"
```

---

### Task 2: La griglia del bagnato e la legge di asciugatura

**Files:**
- Modify: `frontend/shared/f1Meteo.js`
- Test: `frontend/shared/f1Meteo.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `F1Meteo.PASSO_CELLA` (10), `F1Meteo.CORSIE` (5), `F1Meteo.celleDeiCampioni(points)` → `{ nCelle, perCampione: Int32Array }`, `F1Meteo.nuovaGriglia(points, bagnatoIniziale)` → `{ nCelle, perCampione, valori: Float32Array }`, `F1Meteo.bagnatoIn(griglia, campione, scostamentoNorm)` → `0..1`, `F1Meteo.avanza(griglia, dtMs, pioggia, passaggi)` dove `passaggi = [{ campione, scostamentoNorm, distanza }]`.

- [ ] **Step 1: Scrivi i test che fallano**

Aggiungi in coda a `frontend/shared/f1Meteo.test.js`:

```js
// Un anello di raggio R campionato N volte: l'unica pista di cui si conosce a
// mano la lunghezza, quindi l'unica su cui si possono verificare le celle.
function pistaFinta(raggio, campioni, mezza) {
    const pts = [];
    for (let i = 0; i < campioni; i++) {
        const a = (i / campioni) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, halfWidth: mezza });
    }
    return pts;
}

test('celle: il passo si misura sull\'arco, non in campioni', () => {
    const raggio = 200;
    const pts = pistaFinta(raggio, 1000, 11);
    const { nCelle, perCampione } = M.celleDeiCampioni(pts);
    const lunghezza = 2 * Math.PI * raggio;
    const attese = Math.round(lunghezza / M.PASSO_CELLA);
    assert.ok(Math.abs(nCelle - attese) <= 1, `celle ${nCelle}, attese ~${attese}`);
    assert.equal(perCampione.length, pts.length);
    assert.equal(perCampione[0], 0);
    // Due piste con la stessa lunghezza ma un numero di campioni diverso
    // devono avere lo STESSO numero di celle: e' il senso di misurare sull'arco.
    const rade = M.celleDeiCampioni(pistaFinta(raggio, 300, 11));
    assert.ok(Math.abs(rade.nCelle - nCelle) <= 1, 'il numero di celle dipende dai campioni, non dalla lunghezza');
});

test('griglia: la pioggia bagna tutto, il passaggio asciuga solo la sua corsia', () => {
    const pts = pistaFinta(200, 1000, 11);
    const g = M.nuovaGriglia(pts, 0);
    assert.equal(M.bagnatoIn(g, 0, 0), 0, 'una pista nuova deve nascere asciutta');

    // Venti secondi di diluvio: satura.
    for (let i = 0; i < 20; i++) M.avanza(g, 1000, 1, []);
    assert.ok(M.bagnatoIn(g, 0, 0) > 0.95, 'venti secondi di diluvio devono saturare la pista');

    // Smette di piovere e un'auto passa in mezzo, cinquanta volte, mentre al
    // bordo non passa nessuno.
    const prima = M.bagnatoIn(g, 500, 0);
    for (let i = 0; i < 50; i++) {
        M.avanza(g, 20, 0, [{ campione: 500, scostamentoNorm: 0, distanza: M.PASSO_CELLA }]);
    }
    assert.ok(M.bagnatoIn(g, 500, 0) < prima - 0.3, 'i passaggi non asciugano');
    assert.ok(M.bagnatoIn(g, 500, 1) > M.bagnatoIn(g, 500, 0) + 0.2,
        'il bordo si e\' asciugato come la traiettoria: la linea asciutta non si forma');
    assert.ok(M.bagnatoIn(g, 200, 0) > M.bagnatoIn(g, 500, 0) + 0.2,
        'si e\' asciugata anche una cella dove non e\' passato nessuno');
});

test('griglia: la lettura e interpolata, senza scalini fra corsie', () => {
    const pts = pistaFinta(200, 1000, 11);
    const g = M.nuovaGriglia(pts, 1);
    for (let i = 0; i < 40; i++) {
        M.avanza(g, 20, 0, [{ campione: 500, scostamentoNorm: -1, distanza: M.PASSO_CELLA }]);
    }
    // Camminando da un bordo all'altro il valore non deve saltare.
    let precedente = M.bagnatoIn(g, 500, -1);
    for (let t = -1; t <= 1; t += 0.05) {
        const v = M.bagnatoIn(g, 500, t);
        assert.ok(Math.abs(v - precedente) < 0.2, `scalino fra corsie a t=${t.toFixed(2)}`);
        precedente = v;
    }
});

test('griglia: niente valori fuori scala, nemmeno insistendo', () => {
    const pts = pistaFinta(200, 1000, 11);
    const g = M.nuovaGriglia(pts, 0.5);
    for (let i = 0; i < 500; i++) {
        M.avanza(g, 50, 1, [{ campione: 10, scostamentoNorm: 0, distanza: 50 }]);
    }
    for (let i = 0; i < g.valori.length; i++) {
        assert.ok(g.valori[i] >= 0 && g.valori[i] <= 1, `valore fuori scala in cella ${i}: ${g.valori[i]}`);
    }
});
```

- [ ] **Step 2: Esegui i test e verifica che fallano**

Run: `node --test frontend/shared/f1Meteo.test.js`
Expected: FAIL con `M.celleDeiCampioni is not a function`.

- [ ] **Step 3: Aggiungi la griglia al modulo**

In `frontend/shared/f1Meteo.js`, prima del `return` finale:

```js
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
        const delta = p > 0
            ? p * BAGNATURA_AL_SECONDO * dt
            : -EVAPORAZIONE_AL_SECONDO * dt;
        const valori = griglia.valori;
        for (let i = 0; i < valori.length; i++) valori[i] = limita(valori[i] + delta);

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
```

E aggiungi al `return`: `PASSO_CELLA, CORSIE, BAGNATURA_AL_SECONDO, EVAPORAZIONE_AL_SECONDO, ASCIUGATURA_PER_CELLA, celleDeiCampioni, nuovaGriglia, corsiaDi, bagnatoIn, avanza`.

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `node --test frontend/shared/f1Meteo.test.js`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Meteo.js frontend/shared/f1Meteo.test.js
git commit -m "La pista si bagna e si asciuga cella per cella, e le auto disegnano la traiettoria"
```

---

### Task 3: La griglia in rete, impacchettata

**Files:**
- Modify: `frontend/shared/f1Meteo.js`
- Test: `frontend/shared/f1Meteo.test.js`

**Interfaces:**
- Consumes: Task 2.
- Produces: `F1Meteo.impacchetta(griglia)` → `Uint8Array` (due celle per byte, 16 livelli), `F1Meteo.spacchetta(bytes, nCelle)` → `Float32Array`, `F1Meteo.applicaPacchetto(griglia, bytes)`.

- [ ] **Step 1: Scrivi il test che falla**

```js
test('rete: il pacchetto e piccolo e l\'errore di quantizzazione e sotto un sedicesimo', () => {
    const pts = pistaFinta(1200, 1000, 11);   // ~7540 unita': la pista piu' lunga che esista
    const g = M.nuovaGriglia(pts, 0);
    for (let i = 0; i < 12; i++) M.avanza(g, 1000, 1, [{ campione: i * 50, scostamentoNorm: 0, distanza: 6 }]);

    const pacchetto = M.impacchetta(g);
    assert.equal(pacchetto.length, Math.ceil(g.nCelle * M.CORSIE / 2), 'non sono due celle per byte');
    assert.ok(pacchetto.length < 2100, `pacchetto troppo grosso: ${pacchetto.length} byte`);

    const riletti = M.spacchetta(pacchetto, g.nCelle);
    assert.equal(riletti.length, g.valori.length);
    for (let i = 0; i < g.valori.length; i++) {
        assert.ok(Math.abs(riletti[i] - g.valori[i]) <= 1 / 15,
            `cella ${i}: ${g.valori[i]} riletta come ${riletti[i]}`);
    }
});

test('rete: applicaPacchetto non tocca la mappa dei campioni', () => {
    const pts = pistaFinta(200, 1000, 11);
    const server = M.nuovaGriglia(pts, 1);
    const client = M.nuovaGriglia(pts, 0);
    M.applicaPacchetto(client, M.impacchetta(server));
    assert.ok(M.bagnatoIn(client, 500, 0) > 0.9, 'il client non ha ricevuto il bagnato');
    assert.equal(client.perCampione.length, pts.length, 'la mappa dei campioni e\' stata sovrascritta');
});
```

- [ ] **Step 2: Esegui il test e verifica che falla**

Run: `node --test frontend/shared/f1Meteo.test.js`
Expected: FAIL con `M.impacchetta is not a function`.

- [ ] **Step 3: Implementa**

```js
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
```

Aggiungi al `return`: `LIVELLI_RETE, impacchetta, spacchetta, applicaPacchetto`.

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `node --test frontend/shared/f1Meteo.test.js`
Expected: PASS, 10 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Meteo.js frontend/shared/f1Meteo.test.js
git commit -m "La griglia del bagnato sta in meno di 2 KB: il client vede l'asfalto del server"
```

---

### Task 4: Le cinque mescole e la finestra di bagnato

**Files:**
- Modify: `backend/sockets/games/physics/TyreModel.js`
- Test: `backend/sockets/games/physics/TyreModel.bagnato.test.js` (nuovo)

**Interfaces:**
- Consumes: niente (le curve stanno in TyreModel, non in f1Meteo: sono una proprietà della gomma).
- Produces: `TYRE_COMPOUNDS.intermedie`, `TYRE_COMPOUNDS.pioggia`, `MESCOLE_ASCIUTTO` (array dei tre nomi da asciutto), `aderenzaBagnato(compound, bagnato)` → `0..1`, `fattoreVitaBagnato(compound, bagnato)` → `>= 1`, `mescolaPerCielo(bagnato)` → nome, `nomeMescola(p, isQuali)` → nome della mescola **effettiva** (in qualifica quella del cielo, in gara quella scelta).

- [ ] **Step 1: Scrivi i test che fallano**

Crea `backend/sockets/games/physics/TyreModel.bagnato.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./TyreModel');

test('mescole: ce ne sono cinque, e le tre da asciutto sono rimaste identiche', () => {
    assert.deepEqual(Object.keys(T.TYRE_COMPOUNDS).sort(),
        ['hard', 'intermedie', 'medium', 'pioggia', 'soft']);
    assert.deepEqual(T.MESCOLE_ASCIUTTO, ['soft', 'medium', 'hard']);
    // Niente regressioni sulla taratura approvata dell'asciutto.
    assert.equal(T.TYRE_COMPOUNDS.soft.speedMult, 1.05);
    assert.equal(T.TYRE_COMPOUNDS.medium.vita, 0.50);
    assert.equal(T.TYRE_COMPOUNDS.hard.gripMult, 0.90);
});

test('aderenza: ogni mescola vince nella sua finestra', () => {
    const migliore = (bagnato) => Object.keys(T.TYRE_COMPOUNDS)
        .map(c => [c, T.aderenzaBagnato(c, bagnato)])
        .sort((a, b) => b[1] - a[1])[0][0];
    assert.ok(['soft', 'medium', 'hard'].includes(migliore(0)), 'sull\'asciutto deve vincere una slick');
    assert.equal(migliore(0.45), 'intermedie', 'sull\'umido deve vincere l\'intermedia');
    assert.equal(migliore(0.95), 'pioggia', 'nel diluvio deve vincere la full wet');
});

test('aderenza: anche con la gomma giusta il bagnato costa', () => {
    const asciutto = T.aderenzaBagnato('soft', 0);
    const giusta = T.aderenzaBagnato('pioggia', 1);
    assert.ok(giusta < asciutto * 0.9,
        `con la gomma giusta il diluvio costa troppo poco: ${giusta} contro ${asciutto}`);
    const sbagliata = T.aderenzaBagnato('soft', 1);
    assert.ok(sbagliata < giusta * 0.8, 'le slick nel diluvio non sono abbastanza punite');
    for (const c of Object.keys(T.TYRE_COMPOUNDS)) {
        for (let b = 0; b <= 1.0001; b += 0.05) {
            const v = T.aderenzaBagnato(c, b);
            assert.ok(v > 0 && v <= 1, `${c} a ${b.toFixed(2)}: aderenza ${v} fuori da (0,1]`);
        }
    }
});

test('vita: la gomma si brucia quando la pista e piu ASCIUTTA della sua finestra, non il contrario', () => {
    assert.ok(T.fattoreVitaBagnato('pioggia', 0) > 2.5, 'la full wet sull\'asciutto deve distruggersi');
    assert.ok(T.fattoreVitaBagnato('intermedie', 0) > 1.8, 'l\'intermedia sull\'asciutto deve consumarsi');
    assert.equal(T.fattoreVitaBagnato('pioggia', 1), 1, 'la full wet nel diluvio deve durare normalmente');
    assert.equal(T.fattoreVitaBagnato('soft', 1), 1,
        'una slick sul bagnato non si BRUCIA: non aderisce, che e\' un\'altra cosa');
});

test('qualifica: la gomma la scegle il cielo, non una costante', () => {
    assert.equal(T.mescolaPerCielo(0), 'soft');
    assert.equal(T.mescolaPerCielo(0.4), 'intermedie');
    assert.equal(T.mescolaPerCielo(0.9), 'pioggia');
    // tyreOf in qualifica deve seguire il cielo scritto sull'auto.
    assert.equal(T.tyreOf({ compound: 'hard', bagnato: 0.9 }, true).label, 'Pioggia');
    assert.equal(T.tyreOf({ compound: 'hard', bagnato: 0 }, true).label, 'Soft');
    // In gara invece comanda la scelta del giocatore, bagnato o no.
    assert.equal(T.tyreOf({ compound: 'hard', bagnato: 0.9 }, false).label, 'Hard');
});
```

- [ ] **Step 2: Esegui i test e verifica che fallano**

Run: `node --test backend/sockets/games/physics/TyreModel.bagnato.test.js`
Expected: FAIL sul primo test (le mescole sono tre).

- [ ] **Step 3: Implementa in `TyreModel.js`**

Aggiungi le due mescole al blocco `TYRE_COMPOUNDS` esistente, sotto `hard`:

```js
    // ── LE DUE DA BAGNATO ───────────────────────────────────────────────────
    // `speedMult` e' COSTANTE anche per queste, non funzione del bagnato: la
    // velocita' di punta passa da PowertrainModel, che e' un terzo consumatore
    // e non guadagnerebbe niente in sensazione. Il cielo entra nell'ADERENZA e
    // nella VITA, e li' entra da un posto solo (vedi aderenzaBagnato).
    // `gripMult` segue la convenzione (rovesciata) di questa tabella, dove piu'
    // alto = piu' scivolata: vedi il FIX SEGNO in AerodynamicsModel.
    intermedie: { label: 'Intermedie', color: '#2ecc71', speedMult: 0.95, gripMult: 0.95, vita: 0.45 },
    pioggia:    { label: 'Pioggia',    color: '#3498db', speedMult: 0.90, gripMult: 0.97, vita: 0.55 },
```

Poi, dopo `DEFAULT_COMPOUND`:

```js
// Le tre da asciutto, in ordine di durata. Esiste perche' mezzo gioco deve
// parlare solo di quelle — il suggerimento di strategia, la previsione dei giri
// in pagina mescole, la tabella dell'editor — e `Object.keys(TYRE_COMPOUNDS)`
// da oggi ne restituisce cinque.
const MESCOLE_ASCIUTTO = ['soft', 'medium', 'hard'];

// ── IL BAGNATO DENTRO LA MESCOLA ────────────────────────────────────────────
//
// Ogni mescola ha una FINESTRA di bagnato dove da' il meglio, e una larghezza
// oltre la quale non lavora piu'. Il fattore che ne esce e' l'ADERENZA
// DISPONIBILE (1 = piena), e viene consultato da DUE consumatori indipendenti:
// AerodynamicsModel.effectiveGrip (come l'auto scivola) e
// CorneringGripModel.corneringCapacity (quanto il bot frena).
//
// ⚠️ DEVONO AVERLO ENTRAMBI. corneringCapacity non legge la mescola: se il
// bagnato entrasse solo nella prima, il bot entrerebbe in curva alla velocita'
// dell'asciutto convinto di avere aderenza che la fisica non gli da'. E' scritto
// nero su bianco in CorneringGripModel per il banking: col fattore da un lato
// solo si e' misurato un giro piu' LENTO del 12%.
const FINESTRE_BAGNATO = {
    soft:       { centro: 0.00, larghezza: 0.20 },
    medium:     { centro: 0.00, larghezza: 0.22 },
    hard:       { centro: 0.00, larghezza: 0.24 },
    intermedie: { centro: 0.45, larghezza: 0.38 },
    pioggia:    { centro: 0.90, larghezza: 0.45 },
};
// Quanto resta con la gomma COMPLETAMENTE sbagliata. Non zero: e' un simcade,
// si deve poter rientrare ai box guidando, non scivolando.
const ADERENZA_FUORI_FINESTRA = 0.55;
// Quanto costa il bagnato ANCHE con la gomma giusta. E' il numero che porta il
// giro al +10%: e' qui che si tara, non nelle finestre.
const ADERENZA_PERSA_SUL_BAGNATO = 0.22;

function aderenzaBagnato(compound, bagnato) {
    const f = FINESTRE_BAGNATO[compound] || FINESTRE_BAGNATO[DEFAULT_COMPOUND];
    const b = Math.max(0, Math.min(1, bagnato || 0));
    const d = Math.abs(b - f.centro) / f.larghezza;
    const perdita = Math.min(1, d * d);       // dentro la finestra si perde poco, fuori crolla
    const finestra = 1 - (1 - ADERENZA_FUORI_FINESTRA) * perdita;
    const assoluto = 1 - ADERENZA_PERSA_SUL_BAGNATO * b;
    return finestra * assoluto;
}

// Quanto piu' in fretta si consuma la gomma sbagliata. ⚠️ Solo in UN verso:
// una gomma da bagnato su una pista asciutta si distrugge (non ha acqua da
// raffreddarla), una slick sul bagnato non si brucia — semplicemente non
// aderisce, che e' gia' punito da aderenzaBagnato.
const VITA_PENALITA_SU_ASCIUTTO = 3;

function fattoreVitaBagnato(compound, bagnato) {
    const f = FINESTRE_BAGNATO[compound] || FINESTRE_BAGNATO[DEFAULT_COMPOUND];
    const b = Math.max(0, Math.min(1, bagnato || 0));
    const troppoAsciutto = Math.max(0, f.centro - b) / f.larghezza;
    return 1 + VITA_PENALITA_SU_ASCIUTTO * Math.min(1, troppoAsciutto);
}

// In qualifica la mescola non la scegle il giocatore: la scegle il gioco, e
// deve scegliere quella giusta per il cielo di ADESSO. Prima era la Soft fissa,
// e sul bagnato voleva dire qualificarsi con le slick.
function mescolaPerCielo(bagnato) {
    const b = bagnato || 0;
    if (b >= 0.65) return 'pioggia';
    if (b >= 0.25) return 'intermedie';
    return 'soft';
}
```

Sostituisci `tyreOf`, e aggiungi accanto la funzione che dice il NOME della mescola effettiva:

```js
// Il NOME della mescola che sta davvero sull'auto adesso. Esiste perche'
// `tyreOf` restituisce lo spec (tre numeri) e chi deve chiedere la finestra di
// bagnato ha bisogno della chiave. ⚠️ Senza questa funzione, in qualifica la
// fisica userebbe la finestra della mescola scelta PER LA GARA mentre le gomme
// montate sono quelle del cielo: due misure per la stessa cosa.
function nomeMescola(p, isQuali) {
    if (isQuali) return mescolaPerCielo(p && p.bagnato);
    return TYRE_COMPOUNDS[p && p.compound] ? p.compound : DEFAULT_COMPOUND;
}

function tyreOf(p, isQuali) {
    return TYRE_COMPOUNDS[nomeMescola(p, isQuali)];
}
```

In `applyTyreWear`, dopo il calcolo di `wear`, moltiplica per il fattore di vita:

```js
    // La gomma sbagliata per il cielo si consuma piu' in fretta. `vitaFrazione`
    // resta il numero dell'asciutto — e' anche quello mostrato al giocatore, e
    // una funzione sola per i due usi e' una regola di questo file.
    const wear = dist * wearPerUnitDist * fuelFactorOf(p) * fattoreVitaBagnato(p.compound, p.bagnato);
```

In `applyTyreWear` la vita passa già da `vitaFrazione`, quindi le due mescole nuove **passano dallo stesso tetto** `VITA_MASSIMA_GARA` delle altre tre: su una pista dolce (abrasività 0.5) la full wet darebbe 0.55/0.5 = 110% della gara e il tetto la riporta a 85%. È il requisito dello spec, soddisfatto per costruzione — non serve codice, serve non aggirare `vitaFrazione`.

Aggiungi agli export: `MESCOLE_ASCIUTTO, FINESTRE_BAGNATO, aderenzaBagnato, fattoreVitaBagnato, mescolaPerCielo, nomeMescola, ADERENZA_PERSA_SUL_BAGNATO`.

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `node --test backend/sockets/games/physics/TyreModel.bagnato.test.js`
Expected: PASS, 5 test.

- [ ] **Step 5: Verifica di non aver rotto l'asciutto**

Run: `node --test backend/sockets/games/physics/`
Expected: nessun rosso nuovo rispetto alla baseline. Se un test itera `Object.keys(TYRE_COMPOUNDS)` e ora ne trova cinque, va corretto usando `MESCOLE_ASCIUTTO` — è il caso che `MESCOLE_ASCIUTTO` esiste per coprire.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/physics/TyreModel.js backend/sockets/games/physics/TyreModel.bagnato.test.js
git commit -m "Cinque mescole: ognuna ha la sua finestra di bagnato, e fuori si brucia"
```

---

### Task 5: Il bagnato arriva alla fisica, in due punti

**Files:**
- Modify: `backend/sockets/games/physics/AerodynamicsModel.js`
- Modify: `backend/sockets/games/physics/CorneringGripModel.js`
- Modify: `backend/sockets/games/physics/VehicleMotionModel.js`
- Test: `backend/sockets/games/physics/bagnato.fisica.test.js` (nuovo)

**Interfaces:**
- Consumes: `TyreModel.aderenzaBagnato` (Task 4).
- Produces: `effectiveGrip(p, isQuali, maxSpeed)` e `corneringCapacity(p, isQuali, maxSpeed)` che leggono `p.bagnato`.

- [ ] **Step 1: Scrivi i test che fallano**

Crea `backend/sockets/games/physics/bagnato.fisica.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Aero = require('./AerodynamicsModel');
const Cornering = require('./CorneringGripModel');

function auto(extra) {
    return Object.assign({
        x: 0, z: 0, angle: 0, speed: 60, vx: 0, vz: 60,
        tyreWear: 0, compound: 'medium', bagnato: 0, rollio: 0,
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { steer: 1, throttle: 1, brake: 0 },
    }, extra || {});
}

test('il bagnato entra in ENTRAMBI i consumatori, non in uno solo', () => {
    const maxSpeed = 100;
    const asciutta = auto({ bagnato: 0 });
    const bagnata  = auto({ bagnato: 1, compound: 'medium' });

    const gripAsciutto = Aero.effectiveGrip(asciutta, false, maxSpeed);
    const gripBagnato  = Aero.effectiveGrip(bagnata, false, maxSpeed);
    assert.ok(gripBagnato > gripAsciutto,
        'effectiveGrip non cambia sul bagnato: l\'auto non scivola di piu\'');

    const capAsciutto = Cornering.corneringCapacity(asciutta, false, maxSpeed);
    const capBagnato  = Cornering.corneringCapacity(bagnata, false, maxSpeed);
    assert.ok(capBagnato < capAsciutto * 0.85,
        'corneringCapacity non cala sul bagnato: il bot entrerebbe in curva alla velocita\' dell\'asciutto');
});

test('il coefficiente di miscela non arriva mai a 1, o la fisica diverge', () => {
    const maxSpeed = 100;
    // Il caso peggiore che il gioco possa produrre: slick nel diluvio, gomme
    // finite, fondo distrutto, alla massima velocita'.
    const disastro = auto({
        bagnato: 1, compound: 'soft', tyreWear: 100,
        damageParts: { frontWing: 100, floor: 100, engine: 100, suspension: 100 },
        speed: maxSpeed,
    });
    const grip = Aero.effectiveGrip(disastro, false, maxSpeed);
    assert.ok(grip < 1, `coefficiente ${grip}: sopra 1 applyGripBlend amplifica invece di smorzare`);
    // E la miscela deve restare una media pesata, cioe' entrambi i pesi positivi.
    assert.ok(1 - grip > 0);
});

test('con la gomma giusta si perde meno che con quella sbagliata', () => {
    const maxSpeed = 100;
    const giusta = Cornering.corneringCapacity(auto({ bagnato: 1, compound: 'pioggia' }), false, maxSpeed);
    const slick  = Cornering.corneringCapacity(auto({ bagnato: 1, compound: 'soft' }), false, maxSpeed);
    assert.ok(giusta > slick * 1.3, `la gomma giusta rende troppo poco: ${giusta} contro ${slick}`);
});

test('un\'auto senza il campo bagnato si comporta come sull\'asciutto', () => {
    const maxSpeed = 100;
    const senza = auto(); delete senza.bagnato;
    assert.equal(Aero.effectiveGrip(senza, false, maxSpeed), Aero.effectiveGrip(auto({ bagnato: 0 }), false, maxSpeed));
    assert.equal(Cornering.corneringCapacity(senza, false, maxSpeed),
        Cornering.corneringCapacity(auto({ bagnato: 0 }), false, maxSpeed));
});
```

- [ ] **Step 2: Esegui i test e verifica che fallano**

Run: `node --test backend/sockets/games/physics/bagnato.fisica.test.js`
Expected: FAIL sul primo test, entrambe le assert.

- [ ] **Step 3: Implementa in `AerodynamicsModel.js`**

Aggiungi `aderenzaBagnato, nomeMescola` all'import da `./TyreModel` e, dentro `effectiveGrip`, dopo la riga della downforce:

```js
    // IL BAGNATO. Meno aderenza disponibile = piu' ancoraggio alla direzione
    // vecchia = convergenza piu' lenta verso il muso = piu' scivolata (vedi il
    // FIX SEGNO qui sopra): il bagnato deve ALZARE questo coefficiente.
    // Consumatore INDIPENDENTE dello stesso fatto letto da
    // CorneringGripModel.corneringCapacity: nessun doppio conteggio, ed e'
    // obbligatorio che ci siano entrambi.
    // ⚠️ `nomeMescola` e non `p.compound`: in qualifica sull'auto ci sono le
    // gomme del cielo, non quelle scelte per la gara.
    //
    // ⚠⚠ NON SI DIVIDE PER L'ADERENZA, SI INTERPOLA. Il disegno diceva
    // «dividi come la downforce, poi taglia al tetto», e misurandolo il tetto
    // cancellava proprio l'informazione che serve: con GRIP a 0.78 la divisione
    // supera 0.95 gia' con aderenza 0.82, quindi le slick nell'umido e le slick
    // nel diluvio finivano ENTRAMBE al tetto — identiche — e la gomma giusta nel
    // diluvio (0.941) era indistinguibile da quella sbagliata (0.950). Il
    // giocatore non avrebbe sentito ne' il cielo che peggiora ne' di aver
    // montato la gomma giusta.
    //
    // Interpolando verso il massimo guidabile l'escursione si usa tutta, il
    // valore resta monotono e non puo' per costruzione superare il tetto — che
    // e' un vincolo duro, non prudenza: sopra 1 questo coefficiente non smorza,
    // AMPLIFICA. In applyGripBlend `vx*grip + fx*(1-grip)` con grip > 1 ha il
    // secondo peso NEGATIVO e la velocita' viene spinta VIA dal muso: l'auto
    // parte per la tangente. La pioggia e' la prima cosa in questo gioco che
    // alza questo numero, percio' il tetto non e' mai servito prima.
    //
    // Con aderenza piena il risultato e' `grip` esatto: l'asciutto non cambia di
    // un bit.
    const aderenza = aderenzaBagnato(nomeMescola(p, isQuali), p.bagnato);
    grip = Math.min(GRIP_MAX, grip + (GRIP_MAX - grip) * (1 - aderenza));
```

E, accanto a `const GRIP = 0.78`:

```js
// ⚠️ RIVISTO IN CORSO D'OPERA: il tetto resta, ma non e' piu' la via
// principale — si interpola verso di lui invece di dividere e tagliare (vedi il
// commento in effectiveGrip: tagliando, slick nell'umido e slick nel diluvio
// risultavano identiche).
// Il massimo che il coefficiente di miscela puo' raggiungere. Oltre 1 la
// miscela diverge (vedi effectiveGrip); 0.95 lascia un'auto pesantissima da
// girare ma ancora guidabile, che e' il punto: con la gomma sbagliata sotto la
// pioggia si deve poter rientrare ai box, non volare nel prato.
const GRIP_MAX = 0.95;
```

- [ ] **Step 4: Implementa in `CorneringGripModel.js`**

Importa `aderenzaBagnato, nomeMescola` da `./TyreModel` (non da `./TyreForceModel`: le finestre stanno in TyreModel). Poi, in `corneringCapacity`, prima del `return`:

```js
    // IL BAGNATO. Qui il bot DECIDE quanto frenare per la curva, in
    // effectiveGrip la scivolata si ESEGUE: stessa separazione del banking e
    // della downforce. ⚠️ Senza questa riga i bot girerebbero sul bagnato coi
    // riferimenti dell'asciutto — il difetto che per il banking e' costato un
    // giro piu' lento del 12%.
    capacity *= aderenzaBagnato(nomeMescola(p, isQuali), p.bagnato);
```

- [ ] **Step 5: L'erba e la ghiaia bagnate**

In `VehicleMotionModel.applyOffTrackDrag`, il freno del fuoripista cresce col bagnato. Un moltiplicatore modesto, non un modello nuovo:

```js
    // Fuori pista bagnato: l'erba e la ghiaia costano di piu' quando sono
    // piene d'acqua. Il numero e' volutamente piccolo — il fuoripista e' gia'
    // una penalita' forte, qui si aggiunge solo il fatto che sul bagnato ci si
    // rientra peggio. `p.bagnato` assente = asciutto.
    const FUORIPISTA_BAGNATO_EXTRA = 0.35;
    const drag = (0.04 + k * 0.08) * (1 + FUORIPISTA_BAGNATO_EXTRA * (p.bagnato || 0));
```

Il test, nello stesso file del task:

```js
test('fuoripista: sul bagnato frena di piu che sull\'asciutto', () => {
    const { applyOffTrackDrag } = require('./VehicleMotionModel');
    const track = require('../trackLoader').loadTrack('prova');
    const fuori = (bagnato) => {
        const punto = track.points[100];
        const p = auto({ x: punto.x + 60, z: punto.z + 60, speed: 50, vx: 0, vz: 50, bagnato });
        applyOffTrackDrag(p, track);
        return p.speed;
    };
    assert.ok(fuori(1) < fuori(0), 'il bagnato non cambia il fuoripista');
});
```

⚠️ Se il punto scelto cade su una pista dove a +60/+60 c'è ancora asfalto, il test misura zero: verifica che `applyOffTrackDrag` restituisca `offTrack: true` prima di credere al confronto.

- [ ] **Step 6: Esegui i test e verifica che passano**

Run: `node --test backend/sockets/games/physics/bagnato.fisica.test.js`
Expected: PASS, 5 test.

- [ ] **Step 7: Verifica che l'asciutto non sia cambiato**

Run: `node --test backend/`
Expected: nessun rosso nuovo rispetto alla baseline. `aderenzaBagnato(compound, 0)` con le slick vale 1 esatto, quindi la fisica dell'asciutto è bit-identica: se qualcosa è rosso, è una regressione vera.

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/physics/AerodynamicsModel.js backend/sockets/games/physics/CorneringGripModel.js backend/sockets/games/physics/VehicleMotionModel.js backend/sockets/games/physics/bagnato.fisica.test.js
git commit -m "Sul bagnato l'auto scivola, il bot frena prima e l'erba frena di piu'"
```

---

### Task 6: Il server possiede il meteo

> ✅ **DECISO (2026-09-12): asciutto nel 60% delle gare.** I cinque archetipi
> erano equiprobabili e facevano l'80% di gare bagnate. Pesi in
> `PESI_ARCHETIPI` dentro `f1Meteo.js`: asciutto 60%, temporale 12%, bagnato
> che scampa 10%, rovescio 10%, intermittente 8% — misurati su 4000 semi,
> 41.3% di gare con pioggia vera.

> ✅ **Falso allarme, verificato: `distanza` va bene com'e'.** Avevo annotato
> qui che `Math.hypot(p.vx, p.vz)` fosse una velocita' e asciugasse 50 volte
> troppo. Non lo e': in questo progetto `vx`/`vz` sono unita' per TICK, non al
> secondo — `integratePosition(p, 1/COLLISION_SUBSTEPS)` sommato sui sotto-passi
> fa `p.x += p.vx` per tick, ed e' la stessa grandezza che `applyTyreWear` chiama
> «distanza percorsa in questo tick». Nessuna moltiplicazione per `dtMs/1000`.

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`
- Test: `backend/sockets/games/f1GameSocket.meteo.test.js` (nuovo)

**Interfaces:**
- Consumes: `F1Meteo` (Task 1-3), `TyreModel.mescolaPerCielo` (Task 4).
- Produces: `game.meteo = { profilo, griglia, t0, scavalco }`, `p.bagnato` scritto in `updateTrackIndex`, export `creaMeteo(game, opzioni)` e `avanzaMeteo(game, dtMs, players)` per i test.

- [ ] **Step 1: Scrivi i test che fallano**

Crea `backend/sockets/games/f1GameSocket.meteo.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const F1 = require('./f1GameSocket');
const { loadTrack } = require('./trackLoader');

function partita() {
    const track = loadTrack('prova');
    return { track, phase: 'race', raceTick: 0, players: {}, meteo: null };
}

test('meteo: nasce prima della scelta gomme e la pista parte bagnata se piove', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'bagnatoCheScampa' });
    assert.ok(g.meteo && g.meteo.griglia, 'nessun meteo creato');
    assert.ok(g.meteo.pioggia > 0.5, 'l\'archetipo bagnato non parte bagnato');
    const M = require('../../../frontend/shared/f1Meteo.js');
    assert.ok(M.bagnatoIn(g.meteo.griglia, 0, 0) > 0.5,
        'il cielo dice pioggia ma la pista e\' asciutta: la griglia non e\' stata inizializzata');
});

test('meteo: scrive p.bagnato sotto ogni auto, e il bordo e piu bagnato della traiettoria', () => {
    const g = partita();
    // ⚠️ Un archetipo che parte BAGNATO: su uno che parte asciutto non c'e'
    // acqua da togliere e il test misurerebbe zero contro zero.
    F1.creaMeteo(g, { seme: 7, archetipo: 'bagnatoCheScampa' });
    const punti = g.track.points;
    const inTraiettoria = { x: punti[300].x, z: punti[300].z, trackIndex: 300, compound: 'intermedie', tyreWear: 0 };
    // Cento passaggi in traiettoria, nessuno al bordo.
    for (let i = 0; i < 100; i++) {
        F1.avanzaMeteo(g, 20, [Object.assign({}, inTraiettoria, { vx: 0, vz: 6 })]);
    }
    F1.updateTrackIndex(inTraiettoria, g.track);
    assert.equal(typeof inTraiettoria.bagnato, 'number', 'p.bagnato non e\' stato scritto');
    const M = require('../../../frontend/shared/f1Meteo.js');
    const centro = M.bagnatoIn(g.meteo.griglia, 300, 0);
    const bordo  = M.bagnatoIn(g.meteo.griglia, 300, 1);
    assert.ok(bordo > centro, 'la traiettoria non si e\' asciugata piu\' del bordo');
});

test('meteo: lo scavalco di F3 vince sul profilo e non lo cancella', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'asciutto' });
    g.meteo.scavalco = 1;
    F1.avanzaMeteo(g, 1000, []);
    assert.equal(g.meteo.pioggia, 1, 'lo scavalco non comanda');
    g.meteo.scavalco = null;
    F1.avanzaMeteo(g, 1000, []);
    assert.equal(g.meteo.pioggia, 0, 'togliendo lo scavalco il profilo non e\' tornato a comandare');
});
```

- [ ] **Step 2: Esegui i test e verifica che fallano**

Run: `node --test backend/sockets/games/f1GameSocket.meteo.test.js`
Expected: FAIL con `F1.creaMeteo is not a function`.

- [ ] **Step 3: Implementa in `f1GameSocket.js`**

In cima, accanto agli altri require di moduli condivisi:

```js
const F1Meteo = require('../../../frontend/shared/f1Meteo.js');
```

Poi, accanto alle altre funzioni di ciclo di vita della gara:

```js
// ── IL METEO DELLA GARA ─────────────────────────────────────────────────────
//
// Nasce PRIMA della scelta gomme, perche' la pagina delle mescole deve poter
// dire che cielo c'e' e cosa sta per cambiare: «non si verificano scenari dove
// il gioco non dice niente, selezioni le soft e poi invece piove a dirotto».
// Rif. docs/superpowers/specs/2026-09-12-f1-pioggia-design.md.
//
// Un profilo per EVENTO: la qualifica ne consuma la prima parte e la griglia
// attraversa le due sessioni, quindi una gara puo' cominciare su una pista che
// si sta ancora asciugando dalla qualifica.
function creaMeteo(game, opzioni) {
    const o = opzioni || {};
    const durata = Math.max(60000, (game.track.totalLaps || 5) * 60000);
    const seme = (o.seme !== undefined) ? o.seme : (Date.now() % 100000);
    const profilo = F1Meteo.generaProfilo(seme, durata, { archetipo: o.archetipo });
    const pioggia = F1Meteo.pioggiaA(profilo, 0);
    game.meteo = {
        profilo, seme, durata,
        tMs: 0,
        pioggia,
        previsione: F1Meteo.previsione(profilo, 0),
        // La pista parte bagnata quanto dice il cielo a t=0: se si parte sotto
        // la pioggia non deve bagnarsi nei primi venti secondi.
        griglia: F1Meteo.nuovaGriglia(game.track.points, pioggia),
        scavalco: null,      // F3: quando c'e', comanda lui e il profilo tace
    };
    // ⚠️ La griglia si appende anche alla PISTA, perche' `updateTrackIndex`
    // riceve `track` e non `game`, ed e' chiamata da sei punti: cambiarle la
    // firma per portarci il meteo costerebbe piu' di questo riferimento.
    game.track.meteoGriglia = game.meteo.griglia;
    return game.meteo;
}

// ⚠️ UN PROFILO PER EVENTO, non per sessione: `creaMeteo` si chiama UNA volta,
// entrando in `tyre_select`, e la gara NON lo rigenera. La qualifica consuma la
// prima parte del profilo e la griglia attraversa le due sessioni, quindi una
// gara puo' cominciare su una pista che si sta ancora asciugando. Chi ricrea il
// meteo all'inizio della gara azzera anche l'acqua della qualifica.
function assicuraMeteo(game, opzioni) {
    return game.meteo || creaMeteo(game, opzioni);
}

// Un tick di meteo. `players` sono le auto che hanno percorso strada in questo
// tick: ognuna asciuga la cella dove sta, in proporzione a quanta ne ha fatta.
function avanzaMeteo(game, dtMs, players) {
    const m = game.meteo;
    if (!m) return;
    m.tMs += dtMs;
    m.pioggia = (m.scavalco !== null && m.scavalco !== undefined)
        ? Math.max(0, Math.min(1, m.scavalco))
        : F1Meteo.pioggiaA(m.profilo, m.tMs);
    m.previsione = (m.scavalco !== null && m.scavalco !== undefined)
        ? 'stabile'
        : F1Meteo.previsione(m.profilo, m.tMs);
    // Il cielo anche sulla pista: lo legge `updateTrackIndex` per chi sta in
    // corsia box, dove la griglia non vale.
    game.track.meteoPioggia = m.pioggia;
    const passaggi = [];
    for (const p of (players || [])) {
        if (p.acrobatico) continue;   // nel tubo non piove: non c'e' cielo sopra
        passaggi.push({
            campione: p.trackIndex || 0,
            scostamentoNorm: scostamentoNormalizzato(p, game.track),
            distanza: Math.hypot(p.vx || 0, p.vz || 0),
        });
    }
    F1Meteo.avanza(m.griglia, dtMs, m.pioggia, passaggi);
}

// Dove sta l'auto in larghezza, da -1 (bordo destro) a +1 (sinistro).
// Normalizzato QUI sulla mezza carreggiata di questo campione, che cambia per
// tratto: passare a valle uno scostamento in unita' vorrebbe dire passare anche
// la larghezza, e un giorno passarla sbagliata.
function scostamentoNormalizzato(p, track) {
    const i = p.trackIndex || 0;
    const punto = track.points[i];
    if (!punto) return 0;
    const { nx, nz } = TrackGeometry.normalAt(track.points, i, true);
    const scostamento = (p.x - punto.x) * nx + (p.z - punto.z) * nz;
    const mezza = (typeof punto.halfWidth === 'number' && punto.halfWidth > 0)
        ? punto.halfWidth : track.roadHalf;
    return Math.max(-1, Math.min(1, scostamento / mezza));
}
```

In `updateTrackIndex`, in coda, accanto a pendenza/rollio/acrobatico:

```js
    // E il bagnato sotto le ruote. Stesso schema degli altri tre campi: scritto
    // da un posto solo, letto da chi serve, mai ricalcolato a valle. Senza
    // meteo il campo resta 0, che e' esattamente «asciutto».
    //
    // ⚠️ NELLA CORSIA BOX vale il bagnato del CIELO, non la griglia: la'
    // `p.trackIndex` e' quello della pista accanto, quindi leggere la griglia
    // darebbe l'acqua di un pezzo di asfalto dove l'auto non e'. In corsia box
    // non corre nessuno: un valore uniforme e' la misura giusta, non un ripiego.
    p.bagnato = !track.meteoGriglia ? 0
        : (p.pitting || p.pitAutoState)
            ? (track.meteoPioggia || 0)
            : F1Meteo.bagnatoIn(track.meteoGriglia, p.trackIndex, scostamentoNormalizzato(p, track));
```

⚠️ **CORRETTO IN CORSO D'OPERA: la griglia NON si appende alla pista.** Il
disegno lo prevedeva per non toccare la firma di `updateTrackIndex`, che ha
**due** chiamanti e non sei. Ed è un bene averlo verificato: `trackLoader`
**cachea le piste per id**, quindi l'oggetto `track` è lo stesso per ogni
partita su quel circuito — l'acqua di una gara sarebbe finita in quella dopo, e
due lobby sullo stesso tracciato si sarebbero scambiate il meteo in diretta. Il
meteo appartiene alla partita: `updateTrackIndex(p, track, meteo)`.

Nel tick, subito dopo il ciclo `for (const p of racing)` che fa usura e giri, chiama:

```js
        avanzaMeteo(game, PHYSICS_TICK_MS, racing);
```

Dove si entra in `tyre_select`, chiama `assicuraMeteo(game, { archetipo: impostazioniLobby.meteo })`. **Non** chiamarlo anche all'inizio della gara: rigenerarlo là azzererebbe l'acqua della qualifica.

A fine gara, dove si ripulisce lo stato della partita, togli i due riferimenti appesi alla pista (`delete game.track.meteoGriglia; delete game.track.meteoPioggia`): l'oggetto pista arriva dal caricatore e può essere condiviso fra partite, e una griglia dimenticata farebbe cominciare la gara dopo su una pista misteriosamente bagnata.

Aggiungi `creaMeteo, assicuraMeteo, avanzaMeteo, scostamentoNormalizzato` agli export del modulo.

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `node --test backend/sockets/games/f1GameSocket.meteo.test.js`
Expected: PASS, 3 test.

- [ ] **Step 5: Esegui tutta la suite backend**

Run: `node --test backend/`
Expected: nessun rosso nuovo rispetto alla baseline.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.meteo.test.js
git commit -m "Il meteo della gara vive sul server, e ogni auto sa quanto e' bagnato sotto le sue ruote"
```

---

### Task 7: F3 accende la pioggia, e solo a un amministratore

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js`
- Modify: `frontend/f1.js`
- Modify: `frontend/f1.html` (bump `?v=`)
- Test: `backend/sockets/games/f1GameSocket.meteo.test.js`

**Interfaces:**
- Consumes: `game.meteo.scavalco` (Task 6), `require('../../routes/admin').eAdmin`.
- Produces: evento socket `f1MeteoScavalco` con payload `{ livello }` dove `livello` è una chiave di `F1Meteo.LIVELLI` o `null`.

- [ ] **Step 1: Scrivi il test che falla**

```js
test('F3: solo un amministratore puo cambiare il cielo', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'asciutto' });
    // Nessun uid amministratore configurato: la richiesta non deve passare.
    delete process.env.F1_ADMIN_UIDS;
    assert.equal(F1.applicaScavalcoMeteo(g, 'nessuno', 'diluvio'), false);
    assert.equal(g.meteo.scavalco, null);

    process.env.F1_ADMIN_UIDS = 'uid-capo';
    assert.equal(F1.applicaScavalcoMeteo(g, 'uid-capo', 'diluvio'), true);
    assert.equal(g.meteo.scavalco, 1);
    assert.equal(F1.applicaScavalcoMeteo(g, 'uid-capo', null), true);
    assert.equal(g.meteo.scavalco, null);
    // Un livello inventato non deve diventare NaN nella fisica.
    assert.equal(F1.applicaScavalcoMeteo(g, 'uid-capo', 'grandine'), false);
    delete process.env.F1_ADMIN_UIDS;
});
```

- [ ] **Step 2: Esegui il test e verifica che falla**

Run: `node --test backend/sockets/games/f1GameSocket.meteo.test.js`
Expected: FAIL con `F1.applicaScavalcoMeteo is not a function`.

- [ ] **Step 3: Implementa il lato server**

```js
const { eAdmin } = require('../../routes/admin');

// F3 in gara. ⚠️ Non e' una barriera di sicurezza e non pretende di esserlo
// (vedi il commento in cima a routes/admin.js): serve a non mettere il meteo in
// mano a chi sta giocando una gara vera. Il livello si valida qui perche' un
// valore inventato diventerebbe NaN dentro la fisica.
function applicaScavalcoMeteo(game, uid, livello) {
    if (!game || !game.meteo) return false;
    if (!eAdmin(uid)) return false;
    if (livello === null || livello === undefined) { game.meteo.scavalco = null; return true; }
    const v = F1Meteo.LIVELLI[livello];
    if (typeof v !== 'number') return false;
    game.meteo.scavalco = v;
    return true;
}
```

Registra l'ascoltatore accanto agli altri `socket.on` della partita:

```js
    socket.on('f1MeteoScavalco', (data) => {
        const game = gameOf(socket);            // stessa risoluzione usata dagli altri eventi di gara
        const p = game && giocatoreDelSocket(game, socket.id);
        if (!game || !p) return;
        applicaScavalcoMeteo(game, p.uid, data && data.livello);
    });
```

Aggiungi `applicaScavalcoMeteo` agli export.

- [ ] **Step 4: Implementa il lato client**

In `frontend/f1.js`, accanto agli altri tasti da amministratore (cerca il gestore di `F9`/`F10`):

```js
    // F3 — il cielo, per tarare il bagnato. Cicla i quattro gradini e li manda
    // al server, che e' l'unico che possiede il meteo: qui non si simula
    // niente, o il client vedrebbe un bagnato che la fisica non ha.
    const CIELI_F3 = ['asciutto', 'pioviggine', 'pioggia', 'diluvio'];
    let cieloF3 = 0;
    // (dentro il keydown, nel ramo che gia' controlla `strumentiAdmin`)
    if (e.key === 'F3' && strumentiAdmin) {
        e.preventDefault();
        cieloF3 = (cieloF3 + 1) % CIELI_F3.length;
        const livello = CIELI_F3[cieloF3];
        socket.emit('f1MeteoScavalco', { livello: livello === 'asciutto' && cieloF3 === 0 ? 'asciutto' : livello });
        mostraAvviso(`Cielo: ${livello}`);
    }
```

- [ ] **Step 5: `?meteo=pioggia` per partire già bagnati**

```js
    // L'indirizzo, come `?notte=on|off`: comodo per riaprire dieci volte la
    // stessa condizione senza premere F3 a ogni giro.
    // ⚠️ Lo legge il CLIENT e lo manda come scavalco, non il server: il meteo ha
    // un proprietario solo, e una gara in due schede con due indirizzi diversi
    // non puo' avere due cieli.
    const meteoUrl = new URLSearchParams(location.search).get('meteo');
    if (meteoUrl && F1Meteo.LIVELLI[meteoUrl] !== undefined) {
        cieloF3 = CIELI_F3.indexOf(meteoUrl);
        socket.emit('f1MeteoScavalco', { livello: meteoUrl });
    }
```

Va emesso **dopo** che il socket è entrato nella partita (nello stesso punto dove il client manda le altre preferenze di gara), o il server non ha ancora un `game` a cui applicarlo.

- [ ] **Step 6: Bump della versione e prova a mano**

Modifica `?v=` di `f1.js` in `frontend/f1.html`. Poi: `node backend/server.js`, apri `localhost:3000`, entra in una gara con un account che sta in `F1_ADMIN_UIDS`, premi F3 quattro volte e verifica che nel pannello F9 il valore del bagnato cambi.

- [ ] **Step 7: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.meteo.test.js frontend/f1.js frontend/f1.html
git commit -m "F3 apre il cielo: quattro gradini di pioggia per tarare, solo da amministratore"
```

---

### Task 8: Il meteo arriva al client

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`buildPublicState`)
- Modify: `frontend/f1.js`
- Test: `backend/sockets/games/f1GameSocket.meteo.test.js`

**Interfaces:**
- Consumes: `F1Meteo.impacchetta` (Task 3), `game.meteo` (Task 6).
- Produces: nel payload di `f1StateUpdate` il campo `meteo = { pioggia, previsione, nCelle, celle }` dove `celle` è un `Uint8Array`, presente **solo** nell'invio periodico (una volta al secondo) e in quello di aggancio.

- [ ] **Step 1: Scrivi il test che falla**

```js
test('rete: la griglia viaggia una volta al secondo, il cielo a ogni stato', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'rovescioBreve' });
    const primo = F1.statoMeteoPerRete(g, { forza: true });
    assert.ok(primo.celle && primo.celle.length > 100, 'il primo stato deve portare la griglia intera');
    assert.equal(typeof primo.pioggia, 'number');
    assert.equal(typeof primo.previsione, 'string');

    const subito = F1.statoMeteoPerRete(g, {});
    assert.equal(subito.celle, undefined, 'la griglia e\' stata rimandata dopo pochi ms');
    g.meteo.tMs += 1100;
    const dopo = F1.statoMeteoPerRete(g, {});
    assert.ok(dopo.celle, 'dopo un secondo la griglia deve ripartire');
});
```

- [ ] **Step 2: Esegui e verifica che falla**

Run: `node --test backend/sockets/games/f1GameSocket.meteo.test.js`
Expected: FAIL con `F1.statoMeteoPerRete is not a function`.

- [ ] **Step 3: Implementa il lato server**

```js
// Ogni quanto la griglia intera riparte verso i client. Una volta al secondo:
// 1873 byte nel caso peggiore, meno del 3% di quel che il gioco manda gia' per
// le posizioni. L'asciugatura e' lenta, un secondo di ritardo non si vede.
const METEO_GRIGLIA_OGNI_MS = 1000;

function statoMeteoPerRete(game, opzioni) {
    const m = game.meteo;
    if (!m) return null;
    const out = { pioggia: m.pioggia, previsione: m.previsione, nCelle: m.griglia.nCelle };
    const forza = !!(opzioni && opzioni.forza);
    if (forza || m.tMs - (m.ultimoInvio || -Infinity) >= METEO_GRIGLIA_OGNI_MS) {
        m.ultimoInvio = m.tMs;
        out.celle = F1Meteo.impacchetta(m.griglia);
    }
    return out;
}
```

In `buildPublicState`, in coda al payload: `payload.meteo = statoMeteoPerRete(game, {})` (e `{ forza: true }` nell'invio che segue un aggancio o l'inizio di una fase). Esporta `statoMeteoPerRete`.

- [ ] **Step 4: Implementa il lato client**

In `frontend/f1.js`, nel gestore di `f1StateUpdate`:

```js
    // IL METEO. La griglia arriva impacchettata e si applica a quella locale,
    // costruita dagli STESSI punti pista con la STESSA funzione: cosi' la cella
    // che il client colora e' la cella che il server usa per frenare l'auto.
    if (state.meteo) {
        meteoCielo = state.meteo.pioggia || 0;
        meteoPrevisione = state.meteo.previsione || 'stabile';
        if (state.meteo.celle) {
            if (!meteoGriglia) meteoGriglia = F1Meteo.nuovaGriglia(trackData.points, 0);
            F1Meteo.applicaPacchetto(meteoGriglia, new Uint8Array(state.meteo.celle));
            bagnatoDaRidisegnare = true;
        }
    }
```

Aggiungi `<script src="shared/f1Meteo.js?v=1"></script>` in `frontend/f1.html` **prima** di `f1.js` (l'ordine degli script ha un test: `frontend/shared/ordineScript.test.js`).

- [ ] **Step 5: Esegui i test**

Run: `node --test backend/sockets/games/f1GameSocket.meteo.test.js frontend/shared/ordineScript.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.meteo.test.js frontend/f1.js frontend/f1.html
git commit -m "Il bagnato del server arriva al client in 1873 byte al secondo"
```

---

### Task 9: L'asfalto che si asciuga

**Files:**
- Modify: `frontend/f1.js`
- Test: verifica visiva con Chrome headless (nessun test automatico: è un'immagine)

**Interfaces:**
- Consumes: `meteoGriglia` (Task 8), `F1Meteo.celleDeiCampioni` (Task 2).
- Produces: `aggiornaTexturaBagnato()`, chiamata dal ciclo di disegno quando `bagnatoDaRidisegnare`.

- [ ] **Step 1: Costruisci la textura**

⚠️ **Le righe della textura sono i CAMPIONI, non le celle.** Il nastro dell'asfalto ha `v = i / (n - 1)`, cioè è uniforme nell'indice di campione, mentre le celle sono uniformi nell'arco: indicizzare per cella farebbe slittare la linea asciutta rispetto alla pista. La mappa campione → cella è la stessa del server (`griglia.perCampione`).

```js
    // L'ASFALTO CHE SI ASCIUGA.
    //
    // Il nastro della carreggiata ha gia' le UV giuste: `u` attraversa la
    // pista (0 = bordo destro, 1 = sinistro), `v` corre lungo il tracciato.
    // Sono esattamente gli assi della griglia del bagnato, quindi la linea
    // asciutta e' una TEXTURA e non serve toccare la geometria.
    //
    // Bianco = asciutto, grigio scuro = bagnato: il colore dell'asfalto lo
    // moltiplica la `map`, quindi la tinta resta quella di ToonPalette e qui si
    // decide solo quanto scurirla.
    const BAGNATO_SCURO = 0.52;      // quanto scende la luminosita' a pista satura
    let bagnatoCanvas = null, bagnatoTexture = null;

    function preparaTexturaBagnato(nCampioni) {
        bagnatoCanvas = document.createElement('canvas');
        bagnatoCanvas.width = F1Meteo.CORSIE;
        bagnatoCanvas.height = nCampioni;
        // ⚠️ f1.css ha una regola globale `canvas { position: fixed; width:
        // 100vw !important }` per il canvas del gioco: QUALUNQUE canvas nuovo
        // la eredita. Questo non entra nel DOM, quindi non la prende — se un
        // giorno ci entrasse, va disdetta esplicitamente.
        bagnatoTexture = new THREE.CanvasTexture(bagnatoCanvas);
        bagnatoTexture.wrapS = THREE.ClampToEdgeWrapping;
        bagnatoTexture.wrapT = THREE.ClampToEdgeWrapping;
        bagnatoTexture.minFilter = THREE.LinearFilter;
        bagnatoTexture.generateMipmaps = false;
        return bagnatoTexture;
    }

    function aggiornaTexturaBagnato() {
        if (!bagnatoCanvas || !meteoGriglia) return;
        const ctx = bagnatoCanvas.getContext('2d');
        const img = ctx.createImageData(F1Meteo.CORSIE, bagnatoCanvas.height);
        const dati = img.data;
        for (let riga = 0; riga < bagnatoCanvas.height; riga++) {
            const cella = meteoGriglia.perCampione[riga] | 0;
            for (let corsia = 0; corsia < F1Meteo.CORSIE; corsia++) {
                const bagnato = meteoGriglia.valori[cella * F1Meteo.CORSIE + corsia];
                const luce = Math.round(255 * (1 - BAGNATO_SCURO * bagnato));
                const k = (riga * F1Meteo.CORSIE + corsia) * 4;
                dati[k] = luce; dati[k + 1] = luce; dati[k + 2] = luce; dati[k + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        bagnatoTexture.needsUpdate = true;
    }
```

- [ ] **Step 2: Attacca la textura al materiale dell'asfalto**

Il nastro nasce in `frontend/shared/f1Scena.js`, dentro `costruisciCircuito(scene, trackData, opzioni)`, con un `MeshStandardMaterial` creato sul posto. Il costruttore accetta già un oggetto `opzioni` (`const o = opzioni || {}`): aggiungi una voce e usala **solo se c'è**, così editor e anteprima continuano a funzionare senza meteo.

```js
        // L'asfalto bagnato. La textura arriva da fuori (la costruisce chi ha
        // il meteo, cioe' il gioco): qui si sa solo che se c'e' va montata.
        // `map` scurisce moltiplicando il colore, `roughnessMap` usa LA STESSA
        // immagine e viene gratis — dove e' scuro, cioe' bagnato, la ruvidita'
        // e' bassa, cioe' lucido. Un canvas, due effetti.
        builder.buildRibbon(scene, trackPts, roadHalf, new THREE.MeshStandardMaterial(Object.assign({
            color: ToonPalette.SURFACES.asphalt, roughness: 0.95, side: THREE.DoubleSide,
        }, o.mapBagnato ? { map: o.mapBagnato, roughnessMap: o.mapBagnato } : {})));
```

⚠️ **La stilizzazione toon rifà i materiali** (il confine è `buildStartingGrid`, e le superfici vengono restituite per essere stilizzate a parte): verifica che `map` e `roughnessMap` sopravvivano al passaggio. Se lo stile le perde, vanno ricopiate come si ricopia `visible` — stessa trappola già documentata per la sostituzione dei materiali.

- [ ] **Step 3: Chiama l'aggiornamento nel ciclo di disegno**

```js
        if (bagnatoDaRidisegnare) { aggiornaTexturaBagnato(); bagnatoDaRidisegnare = false; }
```

- [ ] **Step 4: Verifica con Chrome headless**

```bash
# Con il server acceso e una gara in corso con F3 su "diluvio", poi su "asciutto"
# dopo qualche giro: due scatti da confrontare.
chrome.exe --headless --screenshot=scratchpad/bagnato-diluvio.png --window-size=1280,720 "http://localhost:3000/f1.html?lobby=..."
```

Expected: nel primo scatto l'asfalto è visibilmente più scuro; nel secondo si vede una fascia più chiara lungo la traiettoria.

- [ ] **Step 5: Commit**

```bash
git add frontend/f1.js frontend/shared/f1Scena.js frontend/f1.html
git commit -m "La traiettoria asciutta si vede nascere: e' la stessa griglia che frena l'auto"
```

---

### Task 10: Cielo e nebbia di temporale

**Files:**
- Modify: `frontend/shared/toonPalette.js`
- Modify: `frontend/f1.js`
- Test: `frontend/shared/toonPalette.test.js` (se non esiste, crealo)

**Interfaces:**
- Consumes: `meteoCielo` (Task 8).
- Produces: `ToonPalette.applicaMeteo(pioggia)` che aggiorna colore del cielo e densità della nebbia.

- [ ] **Step 1: Scrivi il test che falla**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./toonPalette.js');

test('temporale: la luce non cala, cambiano cielo e nebbia', () => {
    P.impostaOrario('giorno');
    P.applicaMeteo(0);
    const soleAsciutto = P.orario().sole.intensita;
    const hemiAsciutto = P.orario().hemi.intensita;
    const cieloAsciutto = P.skyColorAt(0.5);
    const nebbiaAsciutto = P.fogDensity();

    P.applicaMeteo(1);
    assert.equal(P.orario().sole.intensita, soleAsciutto,
        'la pioggia ha abbassato il sole: il cel shading si spegne, le fasce si schiacciano');
    assert.equal(P.orario().hemi.intensita, hemiAsciutto, 'la pioggia ha toccato la luce d\'ambiente');
    assert.notEqual(P.skyColorAt(0.5), cieloAsciutto, 'il cielo non e\' cambiato');
    assert.ok(P.fogDensity() > nebbiaAsciutto * 1.5, 'la nebbia non si e\' avvicinata');

    // Il cielo del temporale deve essere GRIGIO, non azzurro sporco: le tre
    // componenti stanno vicine fra loro.
    const c = P.hexToRgb(P.skyColorAt(0.5));
    assert.ok(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.12,
        `il cielo del temporale ha una dominante: ${JSON.stringify(c)}`);
});

test('temporale: quattro tappe di cielo, sempre — la cupola compila su quel numero', () => {
    P.impostaOrario('notte');
    P.applicaMeteo(0.7);
    assert.equal(P.SKY_STOPS.length, 4);
    P.impostaOrario('giorno');
    assert.equal(P.SKY_STOPS.length, 4);
});

test('temporale: cambiare orario non dimentica la pioggia', () => {
    P.impostaOrario('giorno');
    P.applicaMeteo(1);
    const sottoLaPioggia = P.skyColorAt(0.5);
    P.impostaOrario('giorno');   // riapplicare l'orario non deve asciugare il cielo
    assert.equal(P.skyColorAt(0.5), sottoLaPioggia);
});
```

- [ ] **Step 2: Esegui e verifica che falla**

Run: `node --test frontend/shared/toonPalette.test.js`
Expected: FAIL con `P.applicaMeteo is not a function`.

- [ ] **Step 3: Implementa in `toonPalette.js`**

Il temporale si fa come la notte: **sul colore, mai sulle intensità**. Accanto a `ORARI`:

```js
    // ── IL TEMPORALE ──────────────────────────────────────────────────
    //
    // Si fa come la notte, e per la stessa ragione: il cel shading aggancia la
    // luce a tre fasce fisse e la somma delle intensita' deve restare intorno a
    // 1 — sotto, le fasce si schiacciano e ogni superficie diventa una macchia
    // piatta. Quindi qui si muovono DUE cose sole, il colore del cielo e la
    // densita' della nebbia, e nessuna luce.
    //
    // Quattro tappe come gli orari: la cupola compila lo shader su quel numero.
    // Grigio e non azzurro: l'orizzonte E' ANCHE il colore della nebbia (vedi
    // fogColor), e una dominante fredda tingerebbe tutto cio' che e' lontano —
    // lo stesso difetto costato due tarature al notturno.
    const TEMPORALE_STOPS = [
        { t: 0.00, color: 0x9aa0a8 },
        { t: 0.06, color: 0x868c95 },
        { t: 0.30, color: 0x6d737c },
        { t: 1.00, color: 0x565b63 },
    ];
    // Piu' densa del giorno ma meno della notte: il temporale accorcia la
    // vista, non la chiude.
    const TEMPORALE_FOG = 0.0026;
    let pioggiaCorrente = 0;

    function mescolaHex(a, b, k) {
        const ca = hexToRgb(a), cb = hexToRgb(b);
        return rgbToHex({
            r: ca.r + (cb.r - ca.r) * k,
            g: ca.g + (cb.g - ca.g) * k,
            b: ca.b + (cb.b - ca.b) * k,
        });
    }

    // `pioggia` 0..1. Si puo' chiamare a ogni tick: non alloca nulla di nuovo e
    // riscrive SKY_STOPS in posto, come impostaOrario, perche' chi lo ha già in
    // mano (la cupola del cielo) deve vedere il cambio.
    function applicaMeteo(pioggia) {
        pioggiaCorrente = Math.max(0, Math.min(1, pioggia || 0));
        const base = ORARI[orarioCorrente].skyStops;
        SKY_STOPS.length = 0;
        for (let i = 0; i < base.length; i++) {
            SKY_STOPS.push({ t: base[i].t, color: mescolaHex(base[i].color, TEMPORALE_STOPS[i].color, pioggiaCorrente) });
        }
        return pioggiaCorrente;
    }
```

Poi `fogDensity` tiene conto della pioggia, e `impostaOrario` la riapplica in coda (senza questa riga, cambiare orario asciugherebbe il cielo di colpo):

```js
    function fogDensity() {
        const base = orario().fogDensity;
        return base + (TEMPORALE_FOG - base) * pioggiaCorrente;
    }
```

In fondo a `impostaOrario`, prima del `return`: `applicaMeteo(pioggiaCorrente);`

Aggiungi `applicaMeteo, TEMPORALE_STOPS, TEMPORALE_FOG` agli export.

- [ ] **Step 4: Chiama `applicaMeteo` dal gioco**

In `frontend/f1.js`, dove arriva il meteo (Task 8), se `meteoCielo` è cambiato di più di 0.02 chiama `ToonPalette.applicaMeteo(meteoCielo)` e aggiorna cupola e nebbia della scena con gli stessi punti che usa il notturno. ⚠️ Non a ogni tick per lo stesso valore: ricostruire la cupola sessanta volte al secondo costa, e la pioggia si muove piano.

- [ ] **Step 5: Esegui il test**

Run: `node --test frontend/shared/toonPalette.test.js`
Expected: PASS, 3 test.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/toonPalette.js frontend/shared/toonPalette.test.js frontend/f1.js frontend/f1.html
git commit -m "Il cielo del temporale: grigio e nebbia vicina, senza toccare le luci"
```

---

### Task 11: La pagina delle gomme dice il cielo

**Files:**
- Modify: `frontend/f1.html` (le due gomme nuove, l'indicatore in testata)
- Modify: `frontend/styles/f1.css`
- Modify: `frontend/f1.js`
- Modify: `backend/sockets/games/f1GameSocket.js` (whitelist della mescola scelta)

**Interfaces:**
- Consumes: `state.meteo` (Task 8), `F1Pneumatico.svg(compound, color)`, `TyreModel.MESCOLE_ASCIUTTO` (Task 4).
- Produces: nella testata `#tyre-meteo` con il cielo e la previsione; cinque gomme selezionabili.

- [ ] **Step 1: Le due gomme nuove**

Aggiungi due voci nella colonna destra (`.mescole-col` delle mescole) con gli stessi attributi delle tre esistenti e `data-compound="intermedie"` / `"pioggia"`. Il disegno lo fa `f1Pneumatico.svg`, che ha già un test che prevede le intermedie: il battistrada più aperto è l'unico segno che resta se il colore non si distingue.

- [ ] **Step 2: L'indicatore del cielo**

In `.mescole-testata`, accanto al nome del circuito:

```html
<span class="mescole-meteo" id="tyre-meteo" hidden>
    <span class="mescole-meteo-cielo" id="tyre-meteo-cielo">Asciutto</span>
    <span class="mescole-meteo-prev" id="tyre-meteo-prev"></span>
</span>
```

Testi: cielo = `Asciutto` / `Pioviggine` / `Pioggia` / `Diluvio`; previsione = vuoto se `stabile`, `Variabile` se variabile, `Pioggia in arrivo` se arrivo. ⚠️ **Niente emoji**: glifi unicode monocromatici o SVG, è una regola del progetto.

- [ ] **Step 3: Il server accetta le mescole nuove**

Dove il server assegna `p.compound` e `p.pendingCompound` da un evento del client, la whitelist deve includere le cinque chiavi di `TYRE_COMPOUNDS` — **non** una lista scritta a mano, o al prossimo cambio divergerebbero.

- [ ] **Step 4: L'anteprima si vede bagnata**

L'anteprima al centro usa lo stesso costruttore di scena del gioco: passa `pioggia` e la griglia iniziale, così l'asfalto è scuro se sta piovendo.

- [ ] **Step 5: L'indicatore in gara e l'avviso dal muretto**

In gara servono due cose, perché il giocatore non può aprire la pagina delle gomme mentre guida:

```js
    // L'indicatore del cielo nell'HUD: compare solo quando c'e' qualcosa da
    // dire, cioe' quando piove o sta per cambiare. Un'icona sempre a schermo
    // che dice «asciutto» e' rumore.
    function aggiornaHudMeteo() {
        const dice = meteoCielo > 0.05 || meteoPrevisione !== 'stabile';
        hudMeteo.hidden = !dice;
        if (!dice) return;
        hudMeteo.textContent = testoCielo(meteoCielo);
        hudMeteo.classList.toggle('in-arrivo', meteoPrevisione === 'arrivo');
    }

    // L'AVVISO DAL MURETTO. Una riga sola, quando la previsione CAMBIA: non e'
    // un cronometro, non dice a quale giro. Passa dallo stesso pannello degli
    // altri messaggi di gara, cosi' non ne nasce un secondo sistema di avvisi.
    let previsioneVista = 'stabile';
    function avvisaSeIlCieloCambia() {
        if (meteoPrevisione === previsioneVista) return;
        previsioneVista = meteoPrevisione;
        if (meteoPrevisione === 'arrivo') mostraAvviso('Muretto: pioggia in arrivo');
        else if (meteoPrevisione === 'variabile') mostraAvviso('Muretto: il cielo sta cambiando');
    }
```

⚠️ `mostraAvviso` è la funzione che il gioco usa già per i messaggi di gara: usarla e non inventarne un'altra. ⚠️ **Niente emoji** nell'indicatore.

- [ ] **Step 6: Verifica con Chrome headless**

Scatta la pagina con `pioggia = 0.8` e verifica: cinque gomme, indicatore in testata, anteprima scura, e **niente scroll** (vincolo dell'utente sul tutorial e sulle schermate a pieno schermo).

- [ ] **Step 7: Commit**

```bash
git add frontend/f1.html frontend/styles/f1.css frontend/f1.js backend/sockets/games/f1GameSocket.js
git commit -m "Nella pagina delle gomme si vede che cielo c'e', e le gomme sono cinque"
```

---

### Task 12: I bot cambiano gomma quando il cielo cambia

**Files:**
- Modify: `backend/sockets/games/f1Bot.js`
- Test: `backend/sockets/games/f1Bot.meteo.test.js` (nuovo)

**Interfaces:**
- Consumes: `p.bagnato` (Task 6), `TyreModel.aderenzaBagnato` (Task 4), la logica di ingresso ai box già esistente in `f1Bot.js`.
- Produces: `mescolaVolutaDalBot(p, bagnato)` → nome mescola, e la decisione di rientro quando quella montata non è più la giusta.

- [ ] **Step 1: Scrivi i test che fallano**

```js
test('bot: vuole la mescola che rende di piu col cielo di adesso', () => {
    const B = require('./f1Bot');
    assert.equal(B.mescolaVolutaDalBot({ compound: 'medium' }, 0), 'medium', 'sull\'asciutto non deve cambiare per niente');
    assert.equal(B.mescolaVolutaDalBot({ compound: 'medium' }, 0.5), 'intermedie');
    assert.equal(B.mescolaVolutaDalBot({ compound: 'intermedie' }, 0.95), 'pioggia');
});

test('bot: venti bot non entrano tutti nello stesso giro', () => {
    const B = require('./f1Bot');
    const giri = new Set();
    for (let i = 0; i < 20; i++) giri.add(B.ritardoRientroMeteo({ colore: `c${i}`, difficolta: 'media' }));
    assert.ok(giri.size >= 3, `tutti i bot reagiscono con lo stesso ritardo: ${[...giri]}`);
});
```

- [ ] **Step 2: Esegui e verifica che fallano**

Run: `node --test backend/sockets/games/f1Bot.meteo.test.js`

- [ ] **Step 3: Implementa in `f1Bot.js`**

```js
const { TYRE_COMPOUNDS, aderenzaBagnato } = require('./physics/TyreModel');

// Quale gomma vorrebbe addosso questo bot col cielo di adesso: quella che rende
// di piu'. ⚠️ Nessuna soglia scritta a mano — la tabella delle finestre in
// TyreModel e' gia' la verita', e una soglia qui divergerebbe alla prima
// ritaratura. Vedi la lezione delle due manopole tarate l'una sull'altra.
function mescolaVolutaDalBot(p, bagnato) {
    let migliore = p.compound, resa = -1;
    for (const nome of Object.keys(TYRE_COMPOUNDS)) {
        const r = aderenzaBagnato(nome, bagnato);
        if (r > resa) { resa = r; migliore = nome; }
    }
    return migliore;
}

// Quanto tarda a reagire, in giri. ⚠️ Deterministico e derivato dal COLORE:
// venti bot che reagiscono tutti nello stesso giro trasformano la corsia box in
// una sala d'attesa, e un ritardo casuale non si potrebbe riprodurre in un test.
const RITARDO_METEO_MAX = 3;
function ritardoRientroMeteo(p) {
    let somma = 0;
    for (const ch of String(p.colore || p.color || '')) somma += ch.charCodeAt(0);
    const base = somma % RITARDO_METEO_MAX;          // 0..2 giri
    const fretta = (p.difficolta === 'difficile' || p.difficolta === 'estrema') ? 1 : 0;
    return Math.max(0, base - fretta);
}

// Quanto deve rendere di piu' la gomma voluta prima di spendere una sosta: sotto
// questa differenza si resta fuori. Senza margine il bot rientrerebbe per un
// guadagno che la sosta stessa si mangia.
const GUADAGNO_MINIMO_PER_RIENTRARE = 0.12;

function vuoleRientrarePerIlMeteo(p) {
    const bagnato = p.bagnato || 0;
    const voluta = mescolaVolutaDalBot(p, bagnato);
    if (voluta === p.compound) return false;
    const guadagno = aderenzaBagnato(voluta, bagnato) - aderenzaBagnato(p.compound, bagnato);
    if (guadagno < GUADAGNO_MINIMO_PER_RIENTRARE) return false;
    if (p.botMeteoGiroVisto === undefined) p.botMeteoGiroVisto = p.lap;
    return (p.lap - p.botMeteoGiroVisto) >= ritardoRientroMeteo(p);
}
```

Aggancia `vuoleRientrarePerIlMeteo` accanto alla condizione che già manda il bot ai box (quella che guarda l'usura), e imposta `p.pendingCompound = mescolaVolutaDalBot(p, p.bagnato)` quando decide di entrare — è lo stesso campo che usa il giocatore, applicato alla sosta. ⚠️ Azzera `p.botMeteoGiroVisto` dopo la sosta, o il bot si ricorderebbe per sempre di una decisione già presa.

Esporta `mescolaVolutaDalBot, ritardoRientroMeteo, vuoleRientrarePerIlMeteo`.

- [ ] **Step 4: Gli errori crescono col bagnato**

Il reparto duelli ha già una probabilità di errore per bot. Moltiplicala per `1 + ERRORI_BAGNATO_EXTRA * p.bagnato`, con `ERRORI_BAGNATO_EXTRA` intorno a 0.5 come valore di partenza.

⚠️ **Si misura in larghezze d'auto e per episodio**, non in percentuale per tick: è la lezione già pagata tre volte su difesa, errori e trenino. Il test deve contare **quanti episodi** di errore accadono in una gara simulata a bagnato 0 e a bagnato 1, non leggere la costante.

- [ ] **Step 5: Esegui i test**

Run: `node --test backend/sockets/games/f1Bot.meteo.test.js backend/sockets/games/f1Bot.test.js`
Expected: PASS, nessun rosso nuovo.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.meteo.test.js
git commit -m "Quando arriva la pioggia i bot vanno a cambiare gomma, ognuno col suo tempo"
```

---

### Task 13: La taratura al banco

**Files:**
- Create: `backend/tools/f1MeteoBanco.js`
- Modify: `backend/sockets/games/physics/TyreModel.js` (solo i due numeri della taratura)

**Interfaces:**
- Consumes: `backend/tools/f1LapSimulator.js`, `TyreModel.ADERENZA_PERSA_SUL_BAGNATO`.
- Produces: una tabella tempo sul giro × mescola × bagnato, e i due numeri tarati.

- [ ] **Step 1: Scrivi lo strumento**

```js
// backend/tools/f1MeteoBanco.js
//
// Tempo sul giro per ogni combinazione di mescola e bagnato, su piste vere.
// Serve a tarare DUE numeri di TyreModel: ADERENZA_PERSA_SUL_BAGNATO (quanto
// costa il bagnato con la gomma giusta) e le larghezze delle finestre (quale
// mescola vince a quale cielo).
const { simulateLap } = require('./f1LapSimulator.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');
const F1Meteo = require('../../frontend/shared/f1Meteo.js');
const { TYRE_COMPOUNDS } = require('../sockets/games/physics/TyreModel.js');

// ⚠️⚠️ DUE TRAPPOLE, entrambe silenziose.
//
// 1. `simulateLap` gira in modalita' QUALIFICA, e in qualifica la mescola la
//    decide il CIELO (vedi TyreModel.nomeMescola): misurare le mescole senza
//    `gara: true` darebbe cinque volte lo stesso numero, quello della gomma che
//    il cielo impone. E' la stessa forma del difetto gia' documentato sul banco
//    («insensibile alla taratura, isQuali hardcoded true»).
// 2. `updateTrackIndex` RISCRIVE `p.bagnato` a ogni tick leggendo la griglia
//    appesa alla pista. Impostarlo sul player non serve a niente: va appesa una
//    griglia UNIFORME alla pista, che e' anche il percorso vero del gioco.
function giro(pista, mescola, bagnato) {
    const track = loadTrack(pista);
    track.meteoGriglia = F1Meteo.nuovaGriglia(track.points, bagnato);
    track.meteoPioggia = bagnato;
    return simulateLap(track, { mescola, gara: true, usura: 0 });
}

const PISTE = ['prova', 'monte-rosso'];
const CIELI = [0, 0.25, 0.5, 0.75, 1];

for (const pista of PISTE) {
    console.log(`\n=== ${pista} ===`);
    console.log(['bagnato', ...Object.keys(TYRE_COMPOUNDS)].join('\t'));
    for (const b of CIELI) {
        const riga = [b.toFixed(2)];
        for (const m of Object.keys(TYRE_COMPOUNDS)) {
            const r = giro(pista, m, b);
            riga.push(r && r.timeMs ? (r.timeMs / 1000).toFixed(3) : 'fuori');
        }
        console.log(riga.join('\t'));
    }
}
```

Nota: il banco **non fa avanzare il meteo** (non chiama `avanzaMeteo`), quindi il bagnato resta costante per tutto il giro. È esattamente quel che serve a una taratura: una condizione ferma, non una che si asciuga sotto la misura.

⚠️ **I banchi sono rumorosi**: mai fidarsi di un run singolo, e confrontare solo run appaiati (stessa pista, stessi parametri, un solo numero cambiato). ⚠️ **Non rigenerare la racing line** durante la taratura: si riottimizza sul parametro che stai misurando e ti mente. Su `prova` e `monte-rosso` esiste un `-raceline.json` e comanda quello: è la condizione giusta per misurare, ma va sapendolo.

- [ ] **Step 2: Misura la baseline dell'asciutto**

Run: `node backend/tools/f1MeteoBanco.js --asciutto`
Expected: gli stessi tempi di oggi (nessuna regressione sull'asciutto). Se differiscono, il bagnato è entrato dove non doveva.

- [ ] **Step 3: Tara `ADERENZA_PERSA_SUL_BAGNATO`**

Bersaglio: **+10%** sul giro con la mescola giusta a bagnato 1. Muovi solo quel numero e rimisura.

- [ ] **Step 4: Verifica il criterio delle finestre**

A ogni livello di bagnato deve **vincere la mescola giusta**: slick a 0-0.2, intermedie a 0.3-0.6, pioggia a 0.7-1. Se a 0.5 vince ancora una slick, le larghezze delle finestre sono sbagliate, non l'aderenza persa.

- [ ] **Step 5: Suite completa**

Run: `node --test backend/` poi `node --test frontend/shared/`
Expected: nessun rosso nuovo rispetto alla baseline misurata all'inizio.

- [ ] **Step 6: Commit**

```bash
git add backend/tools/f1MeteoBanco.js backend/sockets/games/physics/TyreModel.js
git commit -m "Il bagnato tarato al banco: +10% sul giro con la gomma giusta, e ogni finestra vince la sua"
```

---

## Fine del passo 1: cosa chiedere all'utente

Il playtest da chiedere, in quest'ordine — sono le tre cose che il passo 1 mette in discussione:

1. **La sensazione di guida sul bagnato** con la mescola giusta: troppo o troppo poco?
2. **La punizione della mescola sbagliata**: uscire con le slick sotto il diluvio deve essere un errore evidente ma non ingiocabile.
3. **La linea asciutta**: si vede nascere? Serve a qualcosa guidarci dentro?

Poi il passo 2 (pioggia che cade, spray, luce rossa, visiera, suono) e il passo 3 (probabilità per pista, campionato, sesta schermata del tutorial).
