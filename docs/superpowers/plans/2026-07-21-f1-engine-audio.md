# F1 — audio motore posizionale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un suono motore posizionale a ogni auto in `frontend/f1.js`, con pitch e volume legati alla velocità reale trasmessa dal server, a partire dal clip fornito dall'utente.

**Architecture:** `THREE.AudioListener` sulla camera esistente + un `THREE.PositionalAudio` per auto (figlio del `group` costruito in `loadCarModel`), modulato ogni frame in base a `target.speed` già presente in `serverState`.

**Tech Stack:** Three.js r128 (già caricato via CDN in `f1.html`), Web Audio API tramite i wrapper `THREE.AudioListener`/`THREE.AudioLoader`/`THREE.PositionalAudio`.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-21-f1-engine-audio-design.md`
- Nessuna modifica al backend (`f1GameSocket.js`): `target.speed` è già trasmesso per ogni auto.
- Nessun taglio del file audio in questa iterazione: si usa il clip intero in loop.
- `ENGINE_REF_MAX_SPEED = 6.2` deve restare sincronizzato a mano con `MAX_SPEED` in `backend/sockets/games/f1GameSocket.js:7` se in futuro cambia ancora.
- Il progetto NON ha test automatici per `f1.js` (nessun `f1.test.js`): verifica manuale in localhost con almeno due tab, come da convenzione di progetto.
- Italiano nei commenti, coerente con lo stile esistente del file.
- Non fare commit se non richiesto esplicitamente dall'utente.

---

### Task 1: Audio motore posizionale in f1.js

**Files:**
- Create: `frontend/assets/audio/engine.mp3` (copia di `C:\Users\pacia\Desktop\audio macchina.mp3`)
- Modify: `frontend/f1.js:109-208` (setup audio + `loadCarModel`)
- Modify: `frontend/f1.js:782-826` (`animate()`)

**Interfaces:**
- Nessuna interfaccia esterna: `listener`/`engineBuffer`/`ENGINE_REF_MAX_SPEED` sono variabili locali al modulo, usate solo dentro `loadCarModel` e `animate()`.
- `group.userData.engineSound` (nuovo campo): `THREE.PositionalAudio` letto in `animate()` per ogni auto (locale e remota), stesso pattern già usato per `group.userData.wheels`/`wheelRot`.

- [ ] **Step 1: Copiare il file audio nel repository**

```bash
mkdir -p "frontend/assets/audio"
cp "/c/Users/pacia/Desktop/audio macchina.mp3" "frontend/assets/audio/engine.mp3"
```

Verificare che il file esista:

Run: `ls -la "frontend/assets/audio/engine.mp3"`
Expected: il file compare con una dimensione > 0

- [ ] **Step 2: Aggiungere il setup audio in f1.js**

In `frontend/f1.js`, subito prima di `const loader = new THREE.GLTFLoader();` (circa riga 112), inserire:

```js
    // ====================================================
    // AUDIO MOTORE — clip fornito dall'utente (accelerazione + cambio
    // marcia + nuova accelerazione), loopato per intero. Pitch e volume
    // seguono la velocità reale di ciascuna auto (vedi animate()): tecnica
    // economica da un solo campione, niente taglio in spezzoni per ora.
    // ====================================================
    const listener = new THREE.AudioListener();
    camera.add(listener);
    // Politica autoplay dei browser: il contesto audio nasce sospeso finché
    // non c'è un gesto dell'utente sulla pagina.
    function resumeAudioContext() {
        if (listener.context.state === 'suspended') listener.context.resume();
    }
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    window.addEventListener('keydown', resumeAudioContext, { once: true });

    const engineBuffer = await new Promise((resolve, reject) => {
        new THREE.AudioLoader().load('/assets/audio/engine.mp3', resolve, undefined, reject);
    });

    // Deve restare in sync a mano con MAX_SPEED in
    // backend/sockets/games/f1GameSocket.js (oggi 6.2): nessun endpoint
    // espone questa costante al client.
    const ENGINE_REF_MAX_SPEED = 6.2;
```

- [ ] **Step 3: Attaccare il PositionalAudio a ogni auto in loadCarModel**

Nella stessa funzione `loadCarModel`, sostituire (circa righe 203-206):

```js
            group.userData.wheels   = wheels;
            group.userData.wheelRot = 0;
            scene.add(group);
            onReady(group);
```

con:

```js
            group.userData.wheels   = wheels;
            group.userData.wheelRot = 0;

            const engineSound = new THREE.PositionalAudio(listener);
            engineSound.setBuffer(engineBuffer);
            engineSound.setLoop(true);
            engineSound.setRefDistance(15);
            engineSound.setRolloffFactor(1.5);
            engineSound.setVolume(0.15);
            group.add(engineSound);
            group.userData.engineSound = engineSound;
            engineSound.play();   // in coda silenziosa finché il contesto non è "running"

            scene.add(group);
            onReady(group);
```

- [ ] **Step 4: Modulare pitch/volume in base alla velocità in animate()**

Nel gestore `animate()`, subito dopo il blocco di rotazione ruote esistente
(circa righe 814-819), ancora dentro `if (carGroup) { ... }`, sostituire:

```js
                // Rotazione ruote basata sulla velocità
                if (carGroup.userData.wheels && carGroup.userData.wheels.length > 0) {
                    carGroup.userData.wheelRot = (carGroup.userData.wheelRot || 0) + Math.abs(target.speed || 0) * 1.4;
                    const wr = -carGroup.userData.wheelRot;
                    for (const w of carGroup.userData.wheels) w.rotation.x = wr;
                }
            }
```

con:

```js
                // Rotazione ruote basata sulla velocità
                if (carGroup.userData.wheels && carGroup.userData.wheels.length > 0) {
                    carGroup.userData.wheelRot = (carGroup.userData.wheelRot || 0) + Math.abs(target.speed || 0) * 1.4;
                    const wr = -carGroup.userData.wheelRot;
                    for (const w of carGroup.userData.wheels) w.rotation.x = wr;
                }
                // Motore: pitch/volume in continuo in base alla velocità
                // reale, niente on/off (eviterebbe click quando l'auto
                // rallenta/si ferma).
                if (carGroup.userData.engineSound) {
                    const frac = Math.min(1, Math.abs(target.speed || 0) / ENGINE_REF_MAX_SPEED);
                    carGroup.userData.engineSound.setPlaybackRate(0.7 + frac * 0.9);
                    carGroup.userData.engineSound.setVolume(0.15 + frac * 0.85);
                }
            }
```

- [ ] **Step 5: Verificare che il file non abbia errori di sintassi**

Run: `node -c frontend/f1.js`
Expected: nessun output (exit code 0)

- [ ] **Step 6: Verifica manuale in localhost (utente)**

Avviare il server (`node server.js` dalla cartella `backend/`), aprire due
tab su `localhost:3000` ed entrare in una partita F1. Controllare:
- Cliccare/premere un tasto per sbloccare l'audio (necessario per la
  policy dei browser), poi accelerare: il motore deve sentirsi, con pitch
  e volume che salgono con la velocità.
- Rilasciare/frenare: pitch e volume devono scendere.
- Con due tab, allontanare/avvicinare l'altra auto e verificare che il suo
  motore si senta più forte da vicino e più debole da lontano.
- Ascoltare se il punto di giunzione del loop (fine/inizio del file) produce
  un click udibile: se sì, da rivedere in un'iterazione successiva (fade o
  taglio in spezzoni), non bloccante per questo task.

Questo step è manuale e non ha un comando da eseguire: è il gate di
approvazione dell'utente prima di considerare il task chiuso.

- [ ] **Step 7: Commit (solo su richiesta esplicita dell'utente)**

```bash
git add frontend/f1.js frontend/assets/audio/engine.mp3
git commit -m "$(cat <<'EOF'
F1: audio motore posizionale legato alla velocità (pitch/volume su ogni auto)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Non eseguire questo step finché l'utente non lo chiede esplicitamente.
