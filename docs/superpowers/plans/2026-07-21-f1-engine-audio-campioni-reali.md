# F1 — campioni motore reali (sostituzione pacchetto CC0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i 6 campioni CC0 (bocciati dall'utente, "sembra un'auto elettrica") con gli 8 campioni reali di motore F1 (Alpine 2023) già tagliati dall'utente, mantenendo invariata l'architettura di crossfade esistente in `frontend/f1.js`.

**Architecture:** Nessun cambio architetturale — `createEngineRpmSynth` già usa `synth.gains.length` (non un valore hardcoded) per calcolare `bandPos`, quindi passare da 6 a 8 buffer è assorbito automaticamente. Cambiano solo: quali file vengono caricati, da dove, e i commenti che ne descrivono l'origine.

**Tech Stack:** Three.js r128 (`THREE.AudioLoader`, Web Audio API `decodeAudioData` — supporta mp3 senza differenze di codice rispetto a wav).

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-21-f1-engine-audio-campioni-reali-design.md`
- Nessuna modifica a crossfade, marce, isteresi, clunk di cambio marcia o logica di volume: solo sorgente/numero dei campioni e i commenti che li descrivono.
- Nessuna modifica al backend: `target.speed` è già trasmesso per ogni auto.
- I file sorgente sono già pronti in `C:\Users\pacia\Desktop\audio f1\` (`accel_0.mp3` … `accel_7.mp3`, confermati con checksum distinti nella conversazione di brainstorming).
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente (convenzione di progetto in `CLAUDE.md`).

---

### Task 1: Sostituire gli asset audio nel repo

**Files:**
- Create: `frontend/assets/audio/engine_rpm/accel_0.mp3` … `accel_7.mp3` (copiati da `C:\Users\pacia\Desktop\audio f1\`)
- Delete: `frontend/assets/audio/engine_rpm/loop_0.wav` … `loop_5.wav`
- Delete: `frontend/assets/audio/engine_loop.mp3`
- Delete: `frontend/assets/audio/engine_shift.mp3`

**Interfaces:**
- Produce: gli 8 file `frontend/assets/audio/engine_rpm/accel_${i}.mp3` (i = 0..7) che Task 2 carica via `THREE.AudioLoader`.

- [ ] **Step 1: Copiare gli 8 file accel nel repo**

```bash
cp "/c/Users/pacia/Desktop/audio f1/accel_0.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_1.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_2.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_3.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_4.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_5.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_6.mp3" \
   "/c/Users/pacia/Desktop/audio f1/accel_7.mp3" \
   "frontend/assets/audio/engine_rpm/"
```

Verificare che tutti e 8 i file siano presenti e non vuoti:

Run: `ls -la frontend/assets/audio/engine_rpm/accel_*.mp3`
Expected: 8 righe, ciascuna con size > 0 (atteso ~23KB ciascuno, dato che i file sorgente erano tutti intorno a 23031 byte in CBR)

- [ ] **Step 2: Rimuovere i 6 campioni CC0 sostituiti**

```bash
rm frontend/assets/audio/engine_rpm/loop_0.wav \
   frontend/assets/audio/engine_rpm/loop_1.wav \
   frontend/assets/audio/engine_rpm/loop_2.wav \
   frontend/assets/audio/engine_rpm/loop_3.wav \
   frontend/assets/audio/engine_rpm/loop_4.wav \
   frontend/assets/audio/engine_rpm/loop_5.wav
```

Verificare che la cartella contenga solo gli 8 nuovi file:

Run: `ls frontend/assets/audio/engine_rpm/`
Expected: solo `accel_0.mp3` … `accel_7.mp3`, nessun `loop_*.wav`

- [ ] **Step 3: Rimuovere i due file orfani (mai referenziati nel codice attuale)**

```bash
rm frontend/assets/audio/engine_loop.mp3 frontend/assets/audio/engine_shift.mp3
```

Verificare:

Run: `ls frontend/assets/audio/`
Expected: solo la sottocartella `engine_rpm/` (nessun `engine_loop.mp3` o `engine_shift.mp3` residuo)

---

### Task 2: Aggiornare `frontend/f1.js` per caricare gli 8 campioni reali

**Files:**
- Modify: `frontend/f1.js:109-116` (commento introduttivo del blocco audio)
- Modify: `frontend/f1.js:138-146` (commento + caricamento buffer)

**Interfaces:**
- Consumes: gli 8 file prodotti da Task 1 (`frontend/assets/audio/engine_rpm/accel_${i}.mp3`).
- Nessuna nuova interfaccia esposta: `engineRpmBuffers` resta un array di `AudioBuffer` (ora lunghezza 8 invece di 6), consumato invariato da `createEngineRpmSynth` più sotto nello stesso file.

- [ ] **Step 1: Aggiornare il commento introduttivo del blocco audio**

Il blocco attuale (circa `frontend/f1.js:109-116`):

```js
    // ====================================================
    // AUDIO MOTORE — come nei giochi F1 veri: non un loop singolo
    // pitch-shiftato, non sintesi da zero, ma PIÙ campioni reali a pitch
    // crescente, con crossfade continuo tra i due più vicini alla velocità
    // attuale (i giochi veri ne registrano decine per banda di RPM,
    // editati in studio per essere seamless; qui 6, un pacchetto CC0
    // pensato apposta per il loop).
    // ====================================================
```

va sostituito con:

```js
    // ====================================================
    // AUDIO MOTORE — come nei giochi F1 veri: non un loop singolo
    // pitch-shiftato, non sintesi da zero, ma PIÙ campioni reali a pitch
    // crescente, con crossfade continuo tra i due più vicini alla velocità
    // attuale (i giochi veri ne registrano decine per banda di RPM,
    // editati in studio per essere seamless; qui 8, tagliati a mano
    // dall'utente da una registrazione reale di un motore Alpine F1 2023,
    // uno per marcia — vedi
    // docs/superpowers/specs/2026-07-21-f1-engine-audio-campioni-reali-design.md).
    // ====================================================
```

- [ ] **Step 2: Aggiornare commento e caricamento dei buffer**

Il blocco attuale (circa `frontend/f1.js:138-146`):

```js
    // 6 campioni reali di motore a pitch crescente, CC0 (OpenGameArt,
    // "Racing Car Engine Sound Loops" — editing di un suono di avviamento
    // auto di pubblico dominio, pensati apposta per il loop, non ritagliati
    // a mano da noi): https://opengameart.org/content/racing-car-engine-sound-loops
    const engineRpmBuffers = await Promise.all(
        [0, 1, 2, 3, 4, 5].map(i => new Promise((resolve, reject) => {
            new THREE.AudioLoader().load(`/assets/audio/engine_rpm/loop_${i}.wav`, resolve, undefined, reject);
        }))
    );
```

va sostituito con:

```js
    // 8 campioni reali di motore a pitch crescente, uno per marcia
    // (ENGINE_N_GEARS = 8 più sotto): tagliati a mano dall'utente da una
    // registrazione reale di un motore Alpine F1 2023 (24s), 0.5s ogni
    // 1.5s lungo i primi 12s del file originale (giri che salgono passando
    // per i cambi marcia).
    const engineRpmBuffers = await Promise.all(
        [0, 1, 2, 3, 4, 5, 6, 7].map(i => new Promise((resolve, reject) => {
            new THREE.AudioLoader().load(`/assets/audio/engine_rpm/accel_${i}.mp3`, resolve, undefined, reject);
        }))
    );
```

- [ ] **Step 3: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/f1.js`
Expected: nessun output (exit code 0)

- [ ] **Step 4: Verificare che non restino riferimenti ai vecchi file**

Run: `grep -n "loop_\|OpenGameArt\|opengameart" frontend/f1.js`
Expected: nessun match (exit code 1 / nessuna riga stampata)

---

### Task 3: Verifica manuale in localhost (gate utente)

**Files:** nessuno (verifica, non modifica)

- [ ] **Step 1: Avviare il server**

```bash
cd backend && node server.js
```

- [ ] **Step 2: Aprire due tab su `localhost:3000`, entrare in una partita F1**

Su ciascuna tab:
- Cliccare/premere un tasto per sbloccare l'audio (policy autoplay browser).
- Accelerare da fermo a tutta velocità: il timbro deve essere riconoscibile
  come motore F1 (non elettrico) lungo tutta la salita di giri, senza click
  o suoni fastidiosi ai punti di giunzione tra campioni.
- Rilasciare/frenare: il volume deve scendere come già in precedenza
  (nessun nuovo comportamento atteso su questo punto).
- Con due tab aperte, allontanare/avvicinare l'altra auto e verificare che
  il suo motore si senta più forte da vicino e più debole da lontano
  (invariato dall'architettura esistente).

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 3: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/f1.js frontend/assets/audio/
git commit -m "$(cat <<'EOF'
F1: sostituisci campioni motore CC0 con registrazione reale Alpine F1 2023

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
