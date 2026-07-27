# F1 — bot più aggressivi: pressione e sorpassi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far sì che i bot F1 restino a ridosso dell'auto che precede invece di staccarsi subito quando non hanno ancora margine per sorpassare, e tentino il sorpasso con una soglia più realistica — riducendo l'effetto "fila indiana" osservato in gara, senza toccare scia/gerarchia di base già esistenti.

**Architecture:** Tuning di tre costanti già esistenti in `backend/sockets/games/f1Bot.js` (`BOT_FOLLOW_MIN_FRACTION`, `BOT_OVERTAKE_PACE_MARGIN`, `BOT_FOLLOW_GAP_M`), dichiarate una sola volta e già condivise da entrambi i rami di guida bot (racing-line e geometrico) — nessuna duplicazione di codice, nessuna nuova logica.

**Tech Stack:** Node.js, `node:test` (suite esistente `f1Bot.test.js`).

## Global Constraints

- Non toccare `botSpeedFactor` (0.93-1.0) né `botLapPaceMult` (±4%/giro): la gerarchia di fondo e la variabilità di ritmo restano come sono, decisione esplicita dell'utente.
- Non estendere l'effetto visivo scia (lineette) ad altre auto: resta solo sulla propria, decisione esplicita dell'utente.
- Non toccare `BOT_OVERTAKE_MAX_CORNER_SEVERITY` (0.4) né `BOT_OVERTAKE_FRACTION` (0.55): nessun problema osservato lì.
- Nessun commit/push automatico: per convenzione di progetto lo fa l'utente, quando vuole (vedi `CLAUDE.md`).

---

## Task 1: Tuning pressione/sorpasso bot

**Files:**
- Modify: `backend/sockets/games/f1Bot.js:488-495`

**Interfaces:**
- Consumes: nessuna nuova dipendenza — sono le stesse tre costanti già lette da entrambi i rami di `updateBotInputs` (righe ~680-702 e ~767-788), nessuna firma di funzione cambia.
- Produces: nessuna nuova interfaccia — comportamento di guida bot invariato nella struttura, cambiano solo i valori soglia.

- [x] **Step 1: Leggere il contesto esatto delle tre costanti**

Le costanti sono dichiarate una sola volta in `backend/sockets/games/f1Bot.js`, righe 483-502 circa. Verificare che il testo attuale sia:

```js
const BOT_FOLLOW_GAP_M        = 15;
const BOT_FOLLOW_MIN_FRACTION = 0.55;   // frazione minima di velocità quando si è praticamente addosso a chi precede
// ...
const BOT_OVERTAKE_PACE_MARGIN = 1.05;   // serve almeno il 5% di velocità libera in più per tentare
```

Se i numeri sono diversi da questi (modificati da un'altra sessione), fermarsi e segnalarlo prima di procedere — i nuovi valori sotto assumono questa base.

- [x] **Step 2: Modificare le tre costanti**

```js
const BOT_FOLLOW_GAP_M        = 22;
const BOT_FOLLOW_MIN_FRACTION = 0.85;   // frazione minima di velocità quando si è praticamente addosso a chi precede — alta apposta: il bot talloona invece di staccarsi, per restare a ridosso e cercare l'occasione di sorpasso (vedi spec 2026-07-24-f1-bot-aggressivita-sorpassi-design.md)
// ...
const BOT_OVERTAKE_PACE_MARGIN = 1.02;   // serve almeno il 2% di velocità libera in più per tentare (era 5%: troppo alto rispetto a ±4%/giro di botLapPaceMult, produceva quasi zero tentativi)
```

- [x] **Step 3: Eseguire la suite di test esistente** — 36/36 pass, confermato

Run (da `backend/`): `node --test sockets/games/f1Bot.test.js`

Expected: `# pass 36`, `# fail 0` (stesso esito di prima della modifica — nessun test referenzia queste tre costanti per nome o per valore esatto, verificato in fase di analisi; l'unico test che chiama `updateBotInputs` usa `phase: 'qualifying'`, che salta il ramo di sorpasso/tallonamento).

- [ ] **Step 4: Verifica in localhost (utente)**

Avviare il server (`node server.js` da `backend/`), giocare una gara con bot su una pista con almeno un rettilineo lungo (es. Monza). Verificare che:
- i bot restino visibilmente più vicini tra loro quando non stanno sorpassando (non si staccano più al primo tentativo fallito);
- si vedano più sorpassi tra bot durante la gara, non solo un ordine fisso dalla partenza alla fine;
- nessun aumento vistoso di collisioni/testacoda tra bot ravvicinati, specialmente in frenata prima delle curve strette.

Se emergono troppe collisioni tra bot ravvicinati, il valore da smorzare per primo è `BOT_FOLLOW_MIN_FRACTION` (provare 0.75 invece di 0.85) prima di toccare gli altri due.

Questo è il punto di verifica dell'utente richiesto dalla convenzione di progetto. Nessun commit: per convenzione di progetto committa/pusha solo l'utente, quando vuole.

---

## Iterazione 2 (stessa sessione, dopo verifica utente)

Playtest su Monza (3 giri): un solo sorpasso osservato ("è stato bello, ma uno solo"). Causa probabile: gara corta, `botLapPaceMult` si ripescava una sola volta a giro → solo 3 occasioni totali di distacco reale in tutta la gara. L'utente ha chiesto esplicitamente di spingere ulteriormente le soglie E di toccare anche la frequenza di ripesca del ritmo (non l'ampiezza, resta ±4%) — deroga esplicita al vincolo "non toccare botLapPaceMult" della spec originale.

Modifiche aggiuntive in `backend/sockets/games/f1Bot.js`:
- `BOT_LAP_PACE_SEGMENTS = 4` (nuova costante): `botLapPaceMult` ora si ripesca 4 volte a giro invece di 1, usando un identificativo di segmento (`p.lap * 4 + floor(trackIndex / (n/4))`) al posto del solo cambio giro. Stessa ampiezza ±4%, solo più occasioni.
- `BOT_FOLLOW_GAP_M`: 22 → 30.
- `BOT_OVERTAKE_PACE_MARGIN`: 1.02 → 1.01 (1%).

Verificato: 36/36 test esistenti ancora OK; controllo headless dedicato conferma ~13 ripesche di ritmo su una gara di 3 giri (contro le ~3 di prima), nessun errore, gara completata normalmente.

- [x] **Verifica in localhost (utente), round 2** — confermato dall'utente ("ok va bene adesso") — CHIUSO.
