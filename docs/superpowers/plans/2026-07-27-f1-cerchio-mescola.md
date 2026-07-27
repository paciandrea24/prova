# F1 — colore cerchio ruota in base alla mescola — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il cerchio della ruota (propria, avversari, bot) assume il colore della mescola montata (rosso=soft, giallo=medium, bianco=hard) e cambia colore ad ogni pit stop, senza toccare il colore delle gomme o della carrozzeria.

**Architecture:** La texture-palette condivisa dell'auto (256×1px) viene ricolorata come già avviene per la livrea, aggiungendo una terza categoria di texel ("cerchio", tonalità 45°-100°) che prende il colore mescola invece di restare neutra. Il server include già `compound` nel payload di stato per ogni giocatore ad ogni tick; il client rileva il cambiamento e rigenera la texture ruota da una copia non processata tenuta in memoria.

**Tech Stack:** Three.js r128 lato client (nessun test automatico per `frontend/f1.js`/`frontend/shared/carLoader.js::recolorLiveryTexture`, richiedono `document`/canvas non mockati nell'infrastruttura di test esistente — stesso limite già presente per il resto del rendering auto).

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente quando vuole (da CLAUDE.md di progetto). Ogni task termina con la verifica, MAI con un comando `git commit`.
- Nessuna modifica al server: `compound` è già trasmesso ad ogni tick e già aggiornato correttamente a fine pit stop.
- Il colore mescola si applica **solo al cerchio**, mai alla gomma (nera) né alla carrozzeria.
- Prima che una mescola sia nota (`compound` `null`, fase `tyre_select`), il cerchio resta al colore originale del modello (verde oliva) — nessun colore inventato.

---

### Task 1: `carLoader.js` — classificazione "cerchio" e rigenerazione texture su richiesta

**Files:**
- Modify: `frontend/shared/carLoader.js:72-115` (funzione `recolorLiveryTexture`)
- Modify: `frontend/shared/carLoader.js:159-192` (traverse in `loadCarModel`)
- Modify: `frontend/shared/carLoader.js:255-257` (dopo l'assegnazione di `group.userData.wheels`)

**Interfaces:**
- Consumes: nessuna da altri task.
- Produces: `group.userData.setCompoundColor(compoundHex)` — funzione attaccata al gruppo auto restituito da `loadCarModel`, richiamabile in qualsiasi momento con un colore mescola (numero esadecimale, es. `0xe74c3c`) per ritingere il cerchio di tutte le ruote di quell'auto. Consumata da Task 2.

- [ ] **Step 1: Aggiungere la costante di classificazione "cerchio" e il nuovo parametro a `recolorLiveryTexture`**

In `frontend/shared/carLoader.js`, subito dopo `const LIVERY_SAT_MIN = 0.2;` (riga 18):

```js
    // Cerchio ruota: tonalità 45°-100° (verde oliva), misurata sulla palette
    // reale — nettamente separata dalla livrea rossa (≤24°) e dal nero/grigio
    // gomma (saturazione quasi nulla, o tonalità <10° con valore molto basso).
    // Usata per ritingere il cerchio col colore mescola (vedi loadCarModel).
    const RIM_HUE_MIN = 45;
    const RIM_HUE_MAX = 100;
```

- [ ] **Step 2: Modificare la firma e la logica di `recolorLiveryTexture`**

Sostituire l'intera funzione (righe 72-115) con:

```js
    function recolorLiveryTexture(sourceTexture, hex, forceNeutral = false, compoundHex = null) {
        const img = sourceTexture.image;
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // targetSat/targetVal: per i texel livrea la saturazione/luminosità
        // finali arrivano dal colore SCELTO dal giocatore, non dalla texture
        // sorgente (quasi sempre un rosso vivido) — altrimenti un colore
        // scuro/poco saturo come il marrone (#795548, H≈16° S≈0.40 V≈0.48,
        // tonalità vicinissima al rosso) viene ricolorato con la vividezza
        // del rosso sorgente e appare rosso invece che marrone. La texture
        // sorgente resta usata come moltiplicatore di ombreggiatura relativa
        // (chiaro/scuro), non come valore assoluto.
        const [targetHue, targetSat, targetVal] = rgbToHsv(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);

        // Stesso principio per il colore mescola sul cerchio (solo quando
        // forceNeutral è attivo, cioè sulle mesh ruota): se compoundHex non è
        // fornito (mescola non ancora nota), isRim resta sempre falso più
        // sotto e il cerchio si comporta come un texel neutro qualsiasi.
        const [compoundHue, compoundSat, compoundVal] = compoundHex != null
            ? rgbToHsv(((compoundHex >> 16) & 0xff) / 255, ((compoundHex >> 8) & 0xff) / 255, (compoundHex & 0xff) / 255)
            : [0, 0, 0];

        for (let i = 0; i < data.length; i += 4) {
            const [h, s, v] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            const isLivery = !forceNeutral && h <= LIVERY_HUE_MAX && s >= LIVERY_SAT_MIN;
            const isRim    = forceNeutral && compoundHex != null && h >= RIM_HUE_MIN && h <= RIM_HUE_MAX;
            const liftedV = liftValue(v);
            let outHue, outSat, outVal;
            if (isLivery) {
                outHue = targetHue; outSat = targetSat; outVal = targetVal * liftedV;
            } else if (isRim) {
                outHue = compoundHue; outSat = compoundSat; outVal = compoundVal * liftedV;
            } else {
                outHue = h; outSat = desaturateForBlack(s); outVal = liftedV;
            }
            const [nr, ng, nb] = hsvToRgb(outHue, outSat, outVal);
            data[i]     = Math.round(nr * 255);
            data[i + 1] = Math.round(ng * 255);
            data[i + 2] = Math.round(nb * 255);
        }
        ctx.putImageData(imageData, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY     = sourceTexture.flipY;
        tex.wrapS     = sourceTexture.wrapS;
        tex.wrapT     = sourceTexture.wrapT;
        tex.magFilter = sourceTexture.magFilter;
        tex.minFilter = sourceTexture.minFilter;
        tex.encoding  = sourceTexture.encoding;
        tex.needsUpdate = true;
        return tex;
    }
```

- [ ] **Step 3: Salvare la texture originale non processata per ogni mesh ruota**

In `loadCarModel`, dentro `model.traverse` (righe 159-192), subito dopo la riga
`const isWheelMesh = nm.includes('wheel') || nm.includes('tyre') || nm.includes('tire');`
e PRIMA del blocco `if (child.material.map) { ... }`, aggiungere:

```js
                if (isWheelMesh && child.material.map) {
                    child.userData.pristineTex = child.material.map;
                }
```

Il resto del traverse (blocco `if (child.material.map) { ... } else { ... }`,
righe 175-185) resta invariato: continua a chiamare
`recolorLiveryTexture(child.material.map, hex, isWheelMesh)` (3 argomenti,
`compoundHex` non passato → resta `null` di default, nessun texel verrà
classificato "cerchio" in questa chiamata iniziale — il cerchio parte
sempre col colore neutro originale, coerente col vincolo "compound non
ancora noto").

- [ ] **Step 4: Esporre `setCompoundColor` sul gruppo auto**

Subito dopo `group.userData.wheelRot = 0;` (riga 257), aggiungere:

```js
            // Rigenera la texture ruota col colore mescola richiesto, partendo
            // sempre dalla copia non processata (mai dalla texture già
            // ricolorata) per evitare degradazione cumulativa ad ogni cambio
            // mescola (es. dopo un pit stop). Nessun effetto su mesh non-ruota
            // (w.userData.pristineTex è undefined per la carrozzeria).
            group.userData.setCompoundColor = function (compoundHex) {
                for (const w of wheels) {
                    if (!w.isMesh || !w.userData.pristineTex) continue;
                    w.material.map = recolorLiveryTexture(w.userData.pristineTex, hex, true, compoundHex);
                    w.material.needsUpdate = true;
                }
            };
```

- [ ] **Step 5: Verifica manuale — nessun test automatico**

`recolorLiveryTexture` richiede `document.createElement('canvas')` e
`THREE.CanvasTexture`, non testabile con `node:test` senza mock del DOM —
stesso limite già presente per il resto di `carLoader.js` (coperto solo
dal test "è una funzione" in `carLoader.test.js`). La verifica avviene nel
Task 2, dopo aver collegato `setCompoundColor` al render loop.

Eseguire comunque `node --test frontend/shared/carLoader.test.js` per
assicurarsi che le modifiche non abbiano rotto la sintassi/i test
preesistenti (nessuna assert dipende dalla firma di `recolorLiveryTexture`,
che non è esportata).

Run: `node --test frontend/shared/carLoader.test.js`
Expected: PASS (stessi test di prima, nessuna regressione)

---

### Task 2: `frontend/f1.js` — applicare il colore mescola quando cambia

**Files:**
- Modify: `frontend/f1.js:1527-1529` (subito dopo il blocco sterzo visivo, nel loop `animate()`)

**Interfaces:**
- Consumes: `target.compound` (già presente nel payload di stato per ogni colore, da `f1GameSocket.js:1186`), `tyreCompoundsInfo` (variabile già esistente in `f1.js`, popolata da `f1Setup`, formato `{ hard:{color,...}, medium:{...}, soft:{...} }`), `carGroup.userData.setCompoundColor` (da Task 1).
- Produces: nessuna (ultimo task della catena — solo effetto visivo finale).

Nessun test automatico: `frontend/f1.js` è uno script browser-only (nessun
`module.exports`, nessuna infrastruttura di test esistente per questo
file, stesso limite già documentato nel piano dello sterzo visivo).
Verifica manuale in localhost.

- [ ] **Step 1: Aggiungere il controllo cambio mescola nel loop di rendering**

In `frontend/f1.js`, dentro il blocco `if (carGroup) { ... }` di `animate()`,
subito dopo il blocco sterzo visivo esistente (righe 1523-1529):

```js
                // Sterzo visivo: solo le ruote anteriori ruotano sull'asse
                // verticale (Y) in base a v.steerAngle (smussato sopra) —
                // effetto puramente cosmetico, la traiettoria reale resta
                // quella calcolata dal server su x/z/angle.
                if (carGroup.userData.frontWheels && carGroup.userData.frontWheels.length > 0) {
                    for (const w of carGroup.userData.frontWheels) w.rotation.y = v.steerAngle;
                }
                // Colore cerchio in base alla mescola montata: si rigenera la
                // texture ruota una sola volta per ogni cambio effettivo (non
                // ad ogni frame), confrontando col valore già applicato
                // memorizzato su carGroup.userData.appliedCompound. Prima che
                // il server sappia la mescola (tyre_select, compound=null) il
                // controllo non scatta e il cerchio resta al colore originale.
                if (target.compound && tyreCompoundsInfo && carGroup.userData.setCompoundColor
                        && carGroup.userData.appliedCompound !== target.compound) {
                    const info = tyreCompoundsInfo[target.compound];
                    if (info) {
                        const compoundHex = parseInt(info.color.replace('#', ''), 16);
                        carGroup.userData.setCompoundColor(compoundHex);
                        carGroup.userData.appliedCompound = target.compound;
                    }
                }
```

- [ ] **Step 2: Verifica manuale in localhost**

1. Avviare il server: `node server.js` dalla cartella `backend/`.
2. Aprire `localhost:3000`, entrare in una lobby, avviare una partita F1
   (anche in modalità singola con bot).
3. Nella schermata di scelta mescola (`tyre_select`), scegliere una
   mescola (es. Soft, rosso) e confermare.
4. Osservare, all'inizio della gara, il cerchio della propria auto: deve
   essere rosso (o giallo/bianco a seconda della scelta), coerente col
   colore mostrato nel dot/badge HUD.
5. Osservare le auto bot: i loro cerchi devono essere colorati in base
   alla mescola scelta per loro (visibile anche nell'eventuale badge
   mescola in HUD/classifica), senza dover fare nulla lato client.
6. Andare ai box e cambiare mescola durante il pit stop. Verificare che,
   una volta ripartiti, il cerchio della propria auto cambi colore di
   conseguenza (senza bisogno di ricaricare la pagina).
7. Verificare che la gomma resti sempre nera/grigia (nessuna tinta
   mescola sulla gomma) e che la carrozzeria non sia influenzata.
8. Verificare da vicino che la gomma (battistrada, parte esterna
   nera/grigia) resti sempre nera/grigia con tutte e tre le mescole —
   in particolare con Soft e Medium (dove un'eventuale tinta rossa/gialla
   è più evidente), controllando anche una ruota posteriore oltre a una
   anteriore.

- [ ] **Step 3: Nessun commit automatico**

Come da Global Constraints — segnalare all'utente che l'implementazione è
pronta per la verifica e attendere che sia lui a decidere se/quando
committare.

---

## Self-Review

**Copertura spec:**
- Classificazione "cerchio" per tonalità (45°-100°) → Task 1 Step 1-2. ✓
- Texture originale conservata per rigenerazione ripetuta → Task 1 Step 3. ✓
- `setCompoundColor` esposto sul gruppo auto → Task 1 Step 4. ✓
- Nessuna modifica server (compound già trasmesso/aggiornato) → non toccato da nessun task, confermato nei Vincoli. ✓
- Applicazione a tutte le auto (propria/avversari/bot) senza casi speciali → Task 2 Step 1, stesso blocco condiviso `if (carGroup)`. ✓
- Caso "compound non ancora noto" (null) → Task 1 Step 3 (nessuna chiamata iniziale con compoundHex) + Task 2 Step 1 (`if (target.compound && ...)` non scatta su null). ✓
- Cambio colore al pit stop senza reload → Task 2 Step 1 (confronto `appliedCompound !== target.compound`, rieseguito ad ogni frame finché non cambia). ✓

**Scansione placeholder:** nessun TBD/TODO; ogni step ha codice completo, non descrizioni generiche.

**Coerenza tipi/nomi:** `recolorLiveryTexture(sourceTexture, hex, forceNeutral, compoundHex)` (Task 1) → stessa firma usata sia nella chiamata esistente (3 argomenti, Task 1 Step 3) sia in `setCompoundColor` (4 argomenti, Task 1 Step 4); `group.userData.setCompoundColor` (prodotta Task 1) → letta come `carGroup.userData.setCompoundColor` (Task 2, `carGroup` è la variabile locale che referenzia lo stesso `group`); `w.userData.pristineTex` (Task 1 Step 3, assegnata) → letta in `setCompoundColor` (Task 1 Step 4). Nessuna discrepanza trovata.
