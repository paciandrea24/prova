# Numero di piloti configurabile e fronte box continuo — piano di implementazione

> **Per chi esegue:** usare `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`, un task alla volta. I passi hanno le
> caselle (`- [ ]`) per tenere il segno.

**Obiettivo:** il numero di piloti si sceglie in lobby fino a 20, e il fronte
della corsia box resta continuo — box dove ci sono piloti, edifici per tutto
il resto — a qualunque numero, incluso uno solo.

**Impianto:** oggi il numero è scritto a mano in tre file e la corsia box ha
due sistemi che si evitano a vicenda. Diventa un dato di partita che nasce in
lobby, viaggia nell'indirizzo della pagina di gioco e arriva al client **prima**
che generi la scenografia; box ed edifici diventano una fila sola su una
griglia di posizioni regolari, condivisa fra client e server.

**Tecnologie:** Node.js + Socket.io lato server, JS vanilla + Three.js r128
lato client, `node --test` per i test, Blender headless per rigenerare il
modello del box.

**Spec:** `docs/superpowers/specs/2026-08-17-f1-piloti-configurabili-design.md`

## Vincoli globali

- **Italiano** in commenti e comunicazioni (`CLAUDE.md`).
- **Un commit per task**, mai un commit unico a fine piano: servono punti di
  ripristino fra un playtest e l'altro. Il push resta manuale dell'utente.
- **Cache busting**: ogni modifica a un `.js` sotto `frontend/` richiede il
  bump del `?v=` corrispondente in `frontend/f1.html` (e in
  `track-editor.html` / `f1-testbench.html` se il file è caricato anche lì).
  Senza, il browser serve la versione vecchia e il playtest non prova niente.
- **Tetto assoluto: 20 piloti.** Scaglioni offerti: **6 / 10 / 14 / 20**.
- **Passo dei box: 15 unità** (era 24).
- **I 4 test rossi preesistenti** della suite (`Simcade: isolamento dei
  componenti`, i due `loadTrack("monte-rosso")`, `simulateLap: rispetta un
  preset di tuning`) NON sono di questo lavoro: non vanno "sistemati", vanno
  ignorati. Qualunque quinto rosso invece è nostro.
- Suite completa: `node --test backend/ frontend/shared/` (riferimento prima
  di iniziare: 899 pass / 4 fail).

---

## Struttura dei file

| file | responsabilità dopo il piano |
|---|---|
| `frontend/shared/trackGeometry.js` | **nuovo** `pitLaneSlots()`: la griglia di posizioni lungo la corsia box, unica fonte per box ed edifici. `pitBoxAnchors()` diventa "le N posizioni centrali di quella griglia". |
| `frontend/shared/trackScenery.js` | gli edifici della corsia si posano sulle posizioni **libere** della stessa griglia, invece di avere un passo proprio ed evitare una zona. |
| `backend/sockets/games/f1Bot.js` | `createBots` riempie fino a `gridSize` della partita; `MAX_GRID_SIZE` resta come tetto assoluto. |
| `backend/sockets/games/f1GameSocket.js` | legge `gridSize` dalle impostazioni lobby e lo mette sulla partita. |
| `frontend/lobby.html` / `lobby.js` | il menu "Piloti" con gli scaglioni, disabilitati oltre la capienza della pista. |
| `frontend/f1.js` | legge `clientSettings.gridSize` e lo passa a griglia dipinta e scenografia. |
| `backend/tools/circuitAssets/pitBox.py` + `pitBuildings.py` | i tre volumi del fronte corsia (box del pilota, garage, ufficio) scendono da 21.8/20/20 a 14.5 di larghezza. |
| `frontend/shared/sceneryAssetSizes.js` | la copia delle misure che usa la scenografia, da tenere allineata ai modelli. |
| `backend/sockets/games/trackLoader.js` | `listTracks` dice quanti piloti regge ogni pista (`maxDrivers`). |
| `frontend/styles/f1.css` | pannello classifica scorrevole. |

---

## Task 1: tutto il fronte della corsia si stringe, e con lui il passo

Il passo di 24 unità è ciò che limita la corsia a 8 box su monte-rosso. Scende
a 15, che è la larghezza di un box di F1 vera (≈11,7 m).

Vanno stretti **tre** modelli, non uno: sulla stessa fila si alternano il box
del pilota e i due edifici decorativi, e oggi misurano rispettivamente 21,8 /
20 / 20 di larghezza. Con un passo di 15 si compenetrerebbero tutti. Misure di
partenza, lette da `backend/tools/circuitAssets.test.js`:

| modello | largo oggi | largo dopo |
|---|---|---|
| `pitBox` | 21.8 | 14.5 |
| `pitsGarageClosed` | 20 | 14.5 |
| `pitsOffice` | 20 | 14.5 |

14.5 e non 15: fra un elemento e il successivo deve restare mezza unità di
stacco, altrimenti due fronti affiancati si toccano e sugli spigoli si vede
lo z-fighting.

`pitsGarageClosed` e `pitsOffice` sono usati **solo** lungo la corsia box
(verificato: non compaiono nella palette delle infrastrutture né altrove),
quindi stringerli non tocca il resto della scenografia.

**File:**
- Modifica: `backend/tools/circuitAssets/pitBox.py` (`W = 21.0`, riga 21)
- Modifica: `backend/tools/circuitAssets/pitBuildings.py` (larghezza dei due edifici)
- Modifica: `frontend/shared/trackGeometry.js` (`PIT_BOX_SPACING`)
- Modifica: `backend/tools/circuitAssets.test.js` (righe 32, 33, 58 di `EXPECTED`)
- Modifica: `frontend/shared/sceneryAssetSizes.js` (le larghezze che legge la scenografia)
- Rigenerati: `pitBox.glb`, `pitsGarageClosed.glb`, `pitsOffice.glb`

**Interfacce:**
- Produce: `TrackGeometry.PIT_BOX_SPACING = 15`; i tre modelli larghi ≤ 14.5;
  `SceneryAssetSizes.sizeOf('pitsGarageClosed').w === 14.5` (e idem per gli altri due).

- [ ] **Passo 1: scrivere le misure attese**

In `backend/tools/circuitAssets.test.js`, tabella `EXPECTED`:

```js
    pitsGarageClosed:  { w: 14.5, h: 9, d: 14 },
    pitsOffice:        { w: 14.5, h: 13, d: 14 },
    // ...
    pitBox:            { w: 14.5, h: 10, d: 22 },
```

- [ ] **Passo 2: eseguire il test e vederlo fallire**

```bash
node --test backend/tools/circuitAssets.test.js 2>&1 | grep -E "^not ok|pitBox|pits"
```

Atteso: TRE falliti, con le larghezze reali (21.8, 20, 20) contro l'attesa 14.5.

- [ ] **Passo 3: stringere il box del pilota**

In `backend/tools/circuitAssets/pitBox.py`, riga 21: `W = 21.0` → `W = 14.5`.
Lasciare **invariata** `D = 21.0`: la profondità è ciò che allinea il fronte
agli edifici decorativi. Controllare a valle che l'apertura resti abbastanza
larga per un'auto larga 3.47 con i meccanici ai lati (lo si vede nel render).

⚠️ Il colore della livrea sta su un materiale il cui nome finisce per
`_livery` e `pitBoxLoader.test.js` verifica che nel `.glb` ce ne sia
**esattamente uno**: non aggiungere né rinominare materiali.

- [ ] **Passo 4: stringere i due edifici decorativi**

In `backend/tools/circuitAssets/pitBuildings.py`, ridurre a 14.5 la larghezza
di `pitsGarageClosed` e `pitsOffice`, lasciando invariate profondità e
altezza. Sono usati solo lungo la corsia box, quindi nessun'altra parte della
scenografia ne risente.

- [ ] **Passo 5: rigenerare i tre modelli**

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/f1CircuitAssetsBuilder.py -- \
    --asset pitBox,pitsGarageClosed,pitsOffice --no-render
```

- [ ] **Passo 6: controllare che non siano comparse macchie nere**

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
    --python backend/tools/circuitAssetsBlackCheck.py -- \
    --asset pitBox,pitsGarageClosed,pitsOffice
```

Atteso: `0 px scuri` per tutti e tre. È il controllo che ha pescato quasi tutti
i difetti di modellazione del progetto: un pixel nero è un buco o uno
z-fighting, non un'ombra. Stringere un volume è proprio il tipo di modifica
che può lasciare due facce complanari.

- [ ] **Passo 6b: allineare le larghezze note alla scenografia**

`frontend/shared/sceneryAssetSizes.js` tiene una copia delle misure, usata dai
controlli di compenetrazione: aggiornare `pitsGarageClosed` e `pitsOffice` a
14.5. Se restassero a 20, il fronte continuo del Task 3 crederebbe di avere
oggetti più larghi di quelli veri e lascerebbe buchi — cioè esattamente il
difetto che il piano deve chiudere.

- [ ] **Passo 7: portare il passo a 15**

In `frontend/shared/trackGeometry.js`:

```js
    // 15 e non più 24: è la larghezza di un box di F1 vera (≈11,7 m) e
    // triplica la capienza delle corsie corte — monte-rosso passa da 8 a 13
    // box. Il modello pitBox è largo 14.5, mezza unità meno del passo, così
    // due box affiancati non si toccano.
    // ⚠️ Condiviso con l'autopilota server-side: questa costante decide dove
    // le auto si FERMANO davvero, non solo dove si disegna il box.
    const PIT_BOX_SPACING = 15;
```

- [ ] **Passo 8: eseguire i test degli asset e quelli del box**

```bash
node --test backend/tools/circuitAssets.test.js frontend/shared/pitBoxLoader.test.js
```

Atteso: tutti verdi.

- [ ] **Passo 9: eseguire la suite completa**

```bash
node --test backend/ frontend/shared/ 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Atteso: i 4 rossi preesistenti e nessun altro. Se compaiono rossi nuovi su
`trackScenery`/`sceneryTrackside`, sono le distanze del fronte box che
dipendevano dal passo 24: annotarli e correggerli qui, non più avanti.

- [ ] **Passo 10: commit**

```bash
git add backend/tools/circuitAssets/pitBox.py backend/tools/circuitAssets.test.js \
        frontend/assets/custom/circuit/pitBox.glb frontend/shared/trackGeometry.js
git commit -m "F1: box piu' stretti, passo della corsia da 24 a 15"
```

---

## Task 2: una griglia sola di posizioni lungo la corsia

Oggi i box nascono da `pitBoxAnchors` (passo 24 centrato su `boxIndex`) e gli
edifici da una catena con passo proprio dettato dalle larghezze dei modelli
(≈22,65). Due passi diversi con fasi diverse: è da lì che nascono i buchi.
Diventa una griglia sola, e i box sono le sue posizioni centrali.

**File:**
- Modifica: `frontend/shared/trackGeometry.js`
- Test: `frontend/shared/trackGeometry.test.js`

**Interfacce:**
- Consuma: `PIT_BOX_SPACING` del Task 1.
- Produce:
  `pitLaneSlots(pitPath, boxIndex, trackPoints, pitRoadHalf) → [{ x, z, tx, tz, fromIdx, stallX, stallZ, indice }]`
  — tutte le posizioni utili della corsia, in ordine di percorrenza, con
  `indice` progressivo da 0. `pitBoxAnchors(pitPath, boxIndex, count, trackPoints, pitRoadHalf)`
  invariata nella firma e nel risultato: restituisce le `count` posizioni
  centrate su `boxIndex`.

- [ ] **Passo 1: scrivere il test che descrive la griglia**

In `frontend/shared/trackGeometry.test.js`:

```js
test('pitLaneSlots: posizioni regolari su tutta la corsia, passo PIT_BOX_SPACING', () => {
    // Corsia box dritta di 300 unità, campionata ogni 2.
    const corsia = [];
    for (let i = 0; i <= 150; i++) corsia.push({ x: i * 2, y: 0, z: 0 });
    const pista = [];
    for (let i = 0; i <= 150; i++) pista.push({ x: i * 2, y: 0, z: 40 });

    const slot = TrackGeometry.pitLaneSlots(corsia, 75, pista, 5);

    assert.ok(slot.length >= 15, `attese almeno 15 posizioni su 300 unità, trovate ${slot.length}`);
    for (let i = 1; i < slot.length; i++) {
        const d = Math.hypot(slot[i].x - slot[i - 1].x, slot[i].z - slot[i - 1].z);
        assert.ok(Math.abs(d - TrackGeometry.PIT_BOX_SPACING) < 0.6,
            `posizioni ${i - 1} e ${i} distanti ${d.toFixed(2)}, atteso ${TrackGeometry.PIT_BOX_SPACING}`);
    }
});

test('pitBoxAnchors resta le posizioni CENTRALI della stessa griglia', () => {
    const corsia = [];
    for (let i = 0; i <= 150; i++) corsia.push({ x: i * 2, y: 0, z: 0 });
    const pista = [];
    for (let i = 0; i <= 150; i++) pista.push({ x: i * 2, y: 0, z: 40 });

    const slot = TrackGeometry.pitLaneSlots(corsia, 75, pista, 5);
    const box = TrackGeometry.pitBoxAnchors(corsia, 75, 4, pista, 5);

    // Ogni box deve coincidere con una posizione della griglia.
    for (const b of box) {
        const trovato = slot.some(s => Math.hypot(s.x - b.x, s.z - b.z) < 0.01);
        assert.ok(trovato, `box a (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) non cade su nessuna posizione della griglia`);
    }
});
```

- [ ] **Passo 2: eseguire i test e vederli fallire**

```bash
node --test frontend/shared/trackGeometry.test.js 2>&1 | grep -E "^not ok|error:"
```

Atteso: FALLITO con `TrackGeometry.pitLaneSlots is not a function`.

- [ ] **Passo 3: estrarre il calcolo di una posizione**

In `frontend/shared/trackGeometry.js`, sopra `pitBoxAnchors`, estrarre in una
funzione il corpo che oggi sta dentro il ciclo — così griglia e box usano la
stessa identica trasformazione e non possono divergere:

```js
    // Una posizione sulla corsia box, a `offset` unità dal punto `boxIndex`.
    // È il mattone comune di pitLaneSlots e pitBoxAnchors: se le due
    // calcolassero la posizione ognuna per conto suo, box ed edifici
    // finirebbero su file leggermente diverse.
    function pitSlotAt(pitPath, boxIndex, offset, trackPoints, pitRoadHalf) {
        const { x, z, fromIdx, toIdx } = walkPitPath(pitPath, boxIndex, offset);
        const a = pitPath[fromIdx], b = pitPath[toIdx];
        const tx = b.x - a.x, tz = b.z - a.z;
        const tlen = Math.hypot(tx, tz) || 1;
        const ntx = tx / tlen, ntz = tz / tlen;
        const slot = { x, z, tx: ntx, tz: ntz, fromIdx };

        if (trackPoints && pitRoadHalf != null) {
            const nx = -ntz, nz = ntx;
            const distPlus = nearestPoint(trackPoints, x + nx, z + nz).dist;
            const distMinus = nearestPoint(trackPoints, x - nx, z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const stallOffset = pitRoadHalf + PIT_STALL_CLEARANCE;
            slot.stallX = x + nx * stallOffset * side;
            slot.stallZ = z + nz * stallOffset * side;
        }
        return slot;
    }
```

- [ ] **Passo 4: riscrivere pitBoxAnchors su quel mattone**

Il risultato deve restare **identico** a prima (stessa firma, stesse
posizioni): è la garanzia che l'autopilota dei box continui a fermarsi dove si
fermava.

```js
    function pitBoxAnchors(pitPath, boxIndex, count, trackPoints, pitRoadHalf) {
        const mid = (count - 1) / 2;
        const anchors = [];
        for (let i = 0; i < count; i++) {
            anchors.push(pitSlotAt(pitPath, boxIndex, (i - mid) * PIT_BOX_SPACING,
                                   trackPoints, pitRoadHalf));
        }
        return anchors;
    }
```

- [ ] **Passo 5: scrivere pitLaneSlots**

```js
    // Margine agli estremi della corsia: all'imbocco e all'uscita la corsia
    // corre ancora affiancata alla pista, e un volume profondo 22 lì si
    // sovrappone all'ingresso rendendolo illeggibile (stessa ragione di
    // PIT_BUILDING_ENTRY_CLEARANCE in trackScenery, segnalata dall'utente).
    const PIT_LANE_END_MARGIN = 40;

    // Tutte le posizioni utili lungo la corsia box, in ordine di percorrenza
    // e a passo PIT_BOX_SPACING, IN FASE con la fila dei box (che è centrata
    // su boxIndex). È la griglia unica su cui si posano sia i box dei piloti
    // sia gli edifici decorativi: avendo un passo solo e una fase sola, fra
    // due elementi consecutivi non può restare un vuoto.
    function pitLaneSlots(pitPath, boxIndex, trackPoints, pitRoadHalf) {
        let lunghezza = 0;
        for (let i = 1; i < pitPath.length; i++) {
            lunghezza += Math.hypot(pitPath[i].x - pitPath[i - 1].x,
                                    pitPath[i].z - pitPath[i - 1].z);
        }
        // Quanta corsia c'è prima e dopo boxIndex, al netto dei margini.
        let prima = 0;
        for (let i = 1; i <= boxIndex && i < pitPath.length; i++) {
            prima += Math.hypot(pitPath[i].x - pitPath[i - 1].x,
                                pitPath[i].z - pitPath[i - 1].z);
        }
        const dopo = lunghezza - prima;

        const indietro = Math.floor(Math.max(0, prima - PIT_LANE_END_MARGIN) / PIT_BOX_SPACING);
        const avanti = Math.floor(Math.max(0, dopo - PIT_LANE_END_MARGIN) / PIT_BOX_SPACING);

        const slots = [];
        for (let k = -indietro; k <= avanti; k++) {
            const s = pitSlotAt(pitPath, boxIndex, k * PIT_BOX_SPACING, trackPoints, pitRoadHalf);
            s.indice = slots.length;
            slots.push(s);
        }
        return slots;
    }
```

- [ ] **Passo 6: esportare le funzioni nuove**

Nel blocco `return { ... }` in fondo al modulo, aggiungere `pitLaneSlots` e
`PIT_LANE_END_MARGIN` accanto a `pitBoxAnchors`.

- [ ] **Passo 7: eseguire i test e vederli passare**

```bash
node --test frontend/shared/trackGeometry.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Atteso: tutti verdi.

- [ ] **Passo 8: verificare la capienza reale per tracciato**

```bash
node -e "
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const TG=require('./frontend/shared/trackGeometry.js');
for(const id of ['monte-rosso','new-monza','prova']){
  const t=loadTrack(id);
  const s=TG.pitLaneSlots(t.pitPath, t.pitBoxIndex, t.points, t.pitRoadHalf);
  console.log(id.padEnd(13)+' posizioni in corsia: '+s.length);
}"
```

Annotare i numeri: servono al Task 6 (gli scaglioni disponibili per pista) e
vanno riportati nel messaggio di commit.

- [ ] **Passo 9: commit**

```bash
git add frontend/shared/trackGeometry.js frontend/shared/trackGeometry.test.js
git commit -m "F1: una griglia sola di posizioni lungo la corsia box"
```

---

## Task 3: il fronte della corsia diventa una fila sola

**File:**
- Modifica: `frontend/shared/trackScenery.js` (la catena degli edifici, ~riga 565-645)
- Test: `frontend/shared/trackScenery.test.js`

**Interfacce:**
- Consuma: `TrackGeometry.pitLaneSlots` del Task 2.
- Produce: `generateLayout(..., opzioni)` accetta `opzioni.gridSize` (numero di
  piloti attesi, default 6); le voci `category: 'paddock'` con asset
  `pitsGarageClosed`/`pitsOffice` occupano tutte e sole le posizioni non
  riservate ai box.

- [ ] **Passo 1: scrivere il test dei buchi**

In `frontend/shared/trackScenery.test.js` (in fondo, dove ci sono già i test
per tracciato):

```js
// ═══════════ IL FRONTE DELLA CORSIA BOX NON HA BUCHI ═══════════
//
// Richiesta esplicita dell'utente: "non vorrei buchi, anche con un giocatore
// solo". Prima box ed edifici erano due sistemi che si evitavano a vicenda,
// con due passi diversi: su monte-rosso i sei box occupavano tutti i campioni
// utili e gli edifici scendevano a ZERO, mentre con pochi piloti restava
// corsia vuota.
for (const id of TRACCIATI) {
    for (const piloti of [1, 6, 14, 20]) {
        test(`fronte corsia box senza vuoti su ${id} con ${piloti} piloti`, () => {
            const { trackPts, layout, track } = circuitoVero(id, { gridSize: piloti });
            const slot = TrackGeometry.pitLaneSlots(track.pitPath, track.pitBoxIndex,
                                                    trackPts, track.pitRoadHalf);
            const edifici = layout.filter(v => v.asset === 'pitsGarageClosed'
                                            || v.asset === 'pitsOffice');
            const box = Math.min(piloti, slot.length);

            // Ogni posizione della griglia è occupata: o da un box (le
            // centrali) o da un edificio.
            assert.equal(edifici.length, slot.length - box,
                `${slot.length} posizioni, ${box} box, ${edifici.length} edifici: ` +
                `${slot.length - box - edifici.length} posizioni vuote`);
        });
    }
}
```

⚠️ `circuitoVero(id)` oggi non accetta opzioni: al passo 4 va esteso.

- [ ] **Passo 2: eseguire il test e vederlo fallire**

```bash
node --test frontend/shared/trackScenery.test.js 2>&1 | grep -E "^not ok|error:" | head
```

Atteso: FALLITO, con un numero di edifici diverso dalle posizioni libere.

- [ ] **Passo 3: far arrivare gridSize fino alla scenografia**

`generateLayout` ha già una lista lunga di parametri posizionali: aggiungere
un **oggetto opzioni** in coda invece di un altro parametro sciolto.

```js
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth,
                            seatAnchors, barrierProfile, terraceAnchors, opzioni) {
        const opts = opzioni || {};
        // Quanti box dei piloti occupano la corsia. Arriva dalla lobby (vedi
        // f1.js: clientSettings.gridSize) — la scenografia si genera DOPO
        // averlo saputo, non più per il caso peggiore.
        const gridSize = Math.max(1, opts.gridSize || 6);
```

Cancellare `PLAYER_BOX_MAX_COUNT = 6` e il commento che dichiara di non poter
sapere il numero: non è più vero, ed è il perno di tutto il lavoro.

- [ ] **Passo 4: estendere l'helper dei test**

In `frontend/shared/trackScenery.test.js`, `circuitoVero(id)` deve poter
passare le opzioni:

```js
function circuitoVero(id, opzioni) {
    // ...com'è oggi, ma l'ultima riga diventa:
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile, terraceAnchors, opzioni);
    return { trackPts: t.points, barrierProfile: t.barrierProfile, layout, track: t };
}
```

- [ ] **Passo 5: posare gli edifici sulle posizioni libere**

Sostituire la catena `while (idx < lastIdx) { ... }` con una posa sulla
griglia. Le posizioni dei box sono le `gridSize` centrali, esattamente quelle
che `pitBoxAnchors` restituirà al server:

```js
        const slot = TrackGeometry.pitLaneSlots(pitPts, boxIndex, trackPts, pitRoadHalf);
        // Le posizioni dei box sono le centrali, la stessa selezione che fa
        // pitBoxAnchors lato server: così il fronte disegnato e i box veri
        // non possono cadere su file diverse.
        const centro = (slot.length - 1) / 2;
        const mezzo = (gridSize - 1) / 2;
        const primoBox = Math.round(centro - mezzo);
        const ultimoBox = primoBox + gridSize - 1;

        let alternanza = 0;
        for (const s of slot) {
            if (s.indice >= primoBox && s.indice <= ultimoBox) continue;   // qui va un box
            const asset = (alternanza % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            const { nx, nz } = TrackGeometry.normalAt(pitPts, s.fromIdx, false);
            const distPlus = TrackGeometry.nearestPoint(trackPts, s.x + nx, s.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, s.x - nx, s.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const offset = pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN;
            const x = s.x + nx * offset * side, z = s.z + nz * offset * side;
            layout.push({
                asset, category: 'paddock', x, y: pitPts[s.fromIdx].y || 0, z,
                rotY: Math.atan2(s.x - x, s.z - z), scale: CUSTOM_MODEL_SCALE,
            });
            alternanza++;
        }
```

Gli edifici sono stati stretti a 14.5 nel Task 1, mezza unità meno del passo:
è quello che permette di posarli a passo fisso senza controlli di
compenetrazione. Se il test del Passo 6 segnala sovrapposizioni, la causa è
che il Task 1 non ha aggiornato `sceneryAssetSizes.js` — non si "aggiusta"
allargando il passo.

- [ ] **Passo 6: eseguire i test del fronte**

```bash
node --test frontend/shared/trackScenery.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Atteso: tutti verdi, compresi i test storici sulle compenetrazioni
(`gli edifici della corsia box non si compenetrano fra loro`).

- [ ] **Passo 7: guardare il risultato con la mappa, non solo coi numeri**

```bash
node backend/tools/f1-costo-scenografia.js monte-rosso prova
```

Confrontare il conteggio degli edifici della corsia prima e dopo: su
monte-rosso deve passare da ~0 a un numero pari alle posizioni libere.

- [ ] **Passo 8: commit**

```bash
git add frontend/shared/trackScenery.js frontend/shared/trackScenery.test.js
git commit -m "F1: il fronte della corsia box e' una fila sola, senza vuoti"
```

---

## Task 4: il numero di piloti nasce in lobby

**File:**
- Modifica: `frontend/lobby.html:146-149` (sezione `#f1-settings`)
- Modifica: `frontend/lobby.js:27` (impostazioni predefinite F1)
- Modifica: `backend/sockets/games/f1GameSocket.js` (creazione partita)
- Modifica: `backend/sockets/games/f1Bot.js` (`createBots`)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfacce:**
- Produce: `game.gridSize` (numero, 6-20) sulla partita;
  `createBots(game, lobby, TYRE_COMPOUNDS, rng)` riempie fino a `game.gridSize`.

- [ ] **Passo 1: scrivere il test dei bot**

In `backend/sockets/games/f1Bot.test.js`:

```js
test('createBots riempie fino al numero di piloti scelto in lobby', () => {
    for (const quanti of [6, 10, 14, 20]) {
        const game = { track: pistaFinta(), players: {}, settings: {}, gridSize: quanti };
        createBots(game, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS, () => 0.5);
        assert.equal(Object.keys(game.players).length + 1, quanti,
            `con gridSize ${quanti} attesi ${quanti - 1} bot, trovati ${Object.keys(game.players).length}`);
    }
});

test('createBots senza gridSize resta ai sei di sempre', () => {
    const game = { track: pistaFinta(), players: {}, settings: {} };
    createBots(game, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS, () => 0.5);
    assert.equal(Object.keys(game.players).length, 5);
});
```

`pistaFinta()` esiste già nel file: riusarla, non riscriverla.

- [ ] **Passo 2: eseguire e vedere fallire**

```bash
node --test backend/sockets/games/f1Bot.test.js 2>&1 | grep -E "^not ok|error:"
```

Atteso: FALLITO, `createBots` ne crea sempre 5.

- [ ] **Passo 3: far leggere gridSize a createBots**

In `backend/sockets/games/f1Bot.js`:

```js
const MAX_GRID_SIZE = 20;   // tetto ASSOLUTO, non la dimensione della griglia
const GRID_SIZE_DEFAULT = 6;
```

e dentro `createBots`, al posto di `MAX_GRID_SIZE - humanColors.length`:

```js
    // Quanti piloti in tutto: la scelta della lobby, limitata dal tetto.
    const inGriglia = Math.min(MAX_GRID_SIZE, game.gridSize || GRID_SIZE_DEFAULT);
    const botsNeeded = inGriglia - humanColors.length;
```

- [ ] **Passo 4: mettere gridSize sulla partita**

In `backend/sockets/games/f1GameSocket.js`, nell'oggetto creato da
`activeGames.set(...)`, accanto a `settings`:

```js
                // Numero di piloti della gara, scelto in lobby. Sta sulla
                // partita e non letto ogni volta dalle impostazioni: la lobby
                // può cambiare mentre la gara è in corso.
                gridSize: Math.min(20, parseInt(
                    (lobby && lobby.gameSettings && lobby.gameSettings.gridSize) || 6, 10) || 6),
```

- [ ] **Passo 5: aggiungere il menu in lobby**

In `frontend/lobby.html`, dopo la riga di `f1-botsEnabled`:

```html
                <div class="setting-row"><span>Drivers</span><select id="f1-gridSize"><option value="6">6</option><option value="10">10</option><option value="14">14</option><option value="20">20</option></select></div>
```

L'etichetta è in **inglese**: la lobby è l'hub della piattaforma, dove tutto
è in inglese (i giochi singoli sono in italiano).

In `frontend/lobby.js`, riga 27:

```js
        f1: { mode: 'championship', trackId: 'monte-rosso', botsEnabled: 'true', gridSize: '6' }
```

Il resto funziona da sé: `loadGameSettings`/`saveGameSettings` mappano ogni
chiave sull'elemento `#f1-<chiave>`.

- [ ] **Passo 6: eseguire i test**

```bash
node --test backend/sockets/games/ 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

- [ ] **Passo 7: provare in localhost**

Riavviare il server, hard refresh della lobby, scegliere 10 piloti e avviare:
in pista devono esserci 10 auto. Con "Bot: Off" devono esserci solo gli umani.

- [ ] **Passo 8: commit**

```bash
git add frontend/lobby.html frontend/lobby.js backend/sockets/games/f1Bot.js \
        backend/sockets/games/f1Bot.test.js backend/sockets/games/f1GameSocket.js
git commit -m "F1: il numero di piloti si sceglie in lobby"
```

---

## Task 5: il client usa lo stesso numero per griglia e scenografia

**File:**
- Modifica: `frontend/f1.js:485` (`MAX_GRID_SIZE`) e la chiamata a `generateLayout`
- Modifica: `frontend/f1.html` (bump `?v=`)
- Test: `frontend/shared/trackScenery.test.js` (già coperto dal Task 3)

**Interfacce:**
- Consuma: `clientSettings.gridSize` dall'indirizzo; `generateLayout(..., opzioni)` del Task 3.

- [ ] **Passo 1: leggere il numero dalle impostazioni**

In `frontend/f1.js`, vicino a `const trackId = ...`:

```js
    // Numero di piloti della gara: arriva dalla lobby nell'indirizzo, e
    // arriva PRIMA che si generi la scenografia — è ciò che permette di
    // costruire il fronte della corsia box per il numero reale invece che
    // per il caso peggiore.
    const gridSize = Math.min(20, Math.max(1, parseInt(clientSettings.gridSize, 10) || 6));
```

- [ ] **Passo 2: usarlo per la griglia dipinta**

Sostituire `const MAX_GRID_SIZE = 6;` e la chiamata:

```js
    TrackMeshBuilder.buildStartingGrid(scene, trackPts, START_FINISH_INDEX, gridSize);
```

- [ ] **Passo 3: usarlo per la scenografia**

```js
    const sceneryLayout = TrackScenery.generateLayout(trackData, trackPts, PIT_PTS,
        BARRIER_D, EMBANKMENT_WIDTH, seatAnchors, BARRIER_PROFILE, terraceAnchors,
        { gridSize });
```

- [ ] **Passo 3b: il test che le fonti non tornino a divergere**

È il requisito della spec che protegge dal difetto di partenza: tre copie
dello stesso numero che nessuno confronta. In
`frontend/shared/trackScenery.test.js`:

```js
// Le posizioni che la scenografia riserva ai box devono essere ESATTAMENTE
// quelle su cui il server ferma le auto (pitBoxAnchors). Se divergessero, i
// box colorati dei piloti comparirebbero su una fila e il fronte decorativo
// su un'altra, sfalsata — e nessuno se ne accorgerebbe finché non lo vede in
// gioco.
for (const id of TRACCIATI) {
    for (const piloti of [1, 6, 14]) {
        test(`box riservati e box veri coincidono su ${id} con ${piloti} piloti`, () => {
            const { trackPts, layout, track } = circuitoVero(id, { gridSize: piloti });
            const ancore = TrackGeometry.pitBoxAnchors(track.pitPath, track.pitBoxIndex,
                piloti, trackPts, track.pitRoadHalf);
            const edifici = layout.filter(v => v.asset === 'pitsGarageClosed'
                                            || v.asset === 'pitsOffice');
            // Nessun edificio decorativo deve cadere dove va un box vero.
            for (const a of ancore) {
                for (const e of edifici) {
                    const d = Math.hypot(e.x - a.x, e.z - a.z);
                    assert.ok(d > TrackGeometry.PIT_BOX_SPACING * 0.5,
                        `un edificio cade a ${d.toFixed(1)} dal box di un pilota, ` +
                        `dentro il suo passo di ${TrackGeometry.PIT_BOX_SPACING}`);
                }
            }
        });
    }
}
```

Eseguire, vederlo verde, e verificarlo **rosso** rimettendo per un attimo
`gridSize` fisso a 6 dentro `generateLayout`: senza quella prova non si sa se
protegge davvero qualcosa.

- [ ] **Passo 4: allineare gli strumenti offline**

`backend/tools/f1-segnalazioni.js` e `f1-costo-scenografia.js` rifanno la
stessa catena del client: se non passano `gridSize`, i quattro test in
`backend/tools/f1-segnalazioni.test.js` che pretendono layout **identici**
diventano rossi. Passare `{ gridSize: 6 }` in entrambi, che è il default.

- [ ] **Passo 5: bump del cache busting**

In `frontend/f1.html`, incrementare `?v=` di `f1.js` e di
`shared/trackScenery.js`.

- [ ] **Passo 6: eseguire la suite completa**

```bash
node --test backend/ frontend/shared/ 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Atteso: solo i 4 rossi preesistenti.

- [ ] **Passo 7: provare in localhost**

Avviare con 14 piloti su `prova`: 14 auto in pista, 14 piazzole dipinte sulla
griglia, 14 box colorati in corsia e nessun vuoto nel fronte.

- [ ] **Passo 8: commit**

```bash
git add frontend/f1.js frontend/f1.html backend/tools/f1-segnalazioni.js \
        backend/tools/f1-costo-scenografia.js
git commit -m "F1: griglia dipinta e scenografia seguono il numero di piloti"
```

---

## Task 6: la lobby non offre più piloti di quanti la pista ne regga

**File:**
- Modifica: `backend/sockets/games/trackLoader.js:280` (`listTracks`, che è ciò
  che l'endpoint `GET /api/f1/tracks` restituisce tale e quale)
- Modifica: `frontend/lobby.js` (`loadF1Tracks`)
- Test: `backend/sockets/games/trackLoader.test.js`

**Interfacce:**
- Consuma: `TrackGeometry.pitLaneSlots` del Task 2.
- Produce: ogni voce di `GET /api/f1/tracks` acquista `maxDrivers`.

- [ ] **Passo 1: scrivere il test dell'elenco piste**

In `backend/sockets/games/trackLoader.test.js` (che ha già l'elenco dinamico
dei tracciati in cima al file):

```js
test('listTracks dice quanti piloti regge ogni pista', () => {
    const piste = listTracks();
    assert.ok(piste.length > 0);
    for (const p of piste) {
        assert.ok(Number.isInteger(p.maxDrivers) && p.maxDrivers >= 1,
            `${p.id}: maxDrivers mancante o non valido (${p.maxDrivers})`);
        assert.ok(p.maxDrivers <= 20, `${p.id}: oltre il tetto assoluto di 20`);
    }
});
```

- [ ] **Passo 2: eseguire e vedere fallire**

```bash
node --test backend/sockets/games/trackLoader.test.js 2>&1 | grep -E "^not ok|error:"
```

Atteso: FALLITO, `maxDrivers` è `undefined`.

- [ ] **Passo 3: calcolare la capienza in listTracks**

In `backend/sockets/games/trackLoader.js:280`, dentro il `.map(...)`, dopo
aver letto il JSON grezzo:

```js
                // Quanti box ci stanno davvero in quella corsia: è il tetto
                // vero di piloti per questa pista. Chi disegna una corsia più
                // lunga alza il tetto senza toccare il codice.
                // loadTrack è in cache di processo, quindi chiamarlo qui per
                // ogni pista costa solo la prima volta.
                const t = loadTrack(id);
                const slot = TrackGeometry.pitLaneSlots(t.pitPath, t.pitBoxIndex,
                                                        t.points, t.pitRoadHalf);
                return { id, name: raw.name, maxDrivers: Math.min(20, slot.length) };
```

⚠️ `listTracks` oggi tollera un file pista malformato e lo salta (c'è già il
`try/catch` con il `console.warn`): `loadTrack` va **dentro** quel try, così
una pista rotta continua a essere ignorata invece di far fallire l'elenco
intero — che è ciò che riempie il menu della lobby.

- [ ] **Passo 4: disabilitare gli scaglioni fuori portata**

In `frontend/lobby.js`, dentro `loadF1Tracks`, tenere da parte le capienze e
aggiornare il menu dei piloti ad ogni cambio di pista:

```js
    const capienze = {};   // trackId -> maxDrivers

    function aggiornaScaglioniPiloti() {
        const track = document.getElementById('f1-trackId');
        const piloti = document.getElementById('f1-gridSize');
        if (!track || !piloti) return;
        const max = capienze[track.value] || 20;
        for (const opt of piloti.options) {
            const n = parseInt(opt.value, 10);
            opt.disabled = n > max;
            // Il motivo si legge nell'opzione stessa: sparire lascerebbe
            // credere a un limite del gioco invece che della pista.
            opt.textContent = n > max ? `${n} — pit lane too short` : String(n);
        }
        if (parseInt(piloti.value, 10) > max) piloti.value = String(max >= 14 ? 14 : max >= 10 ? 10 : 6);
    }
```

Chiamarla dopo aver popolato le piste e su `change` del menu pista.

- [ ] **Passo 5: eseguire i test**

```bash
node --test backend/sockets/games/trackLoader.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

- [ ] **Passo 6: provare in localhost**

Scegliendo monte-rosso, gli scaglioni oltre la sua capienza devono risultare
non selezionabili e spiegare il perché; passando a `prova` devono riaprirsi.

- [ ] **Passo 7: commit**

```bash
git add backend/sockets/games/trackLoader.js backend/sockets/games/trackLoader.test.js frontend/lobby.js
git commit -m "F1: la lobby offre solo i piloti che la corsia box regge"
```

---

## Task 7: la classifica ci sta anche con venti piloti

Resta **completa** — scelta esplicita dell'utente. Cambia solo che il pannello
scorre invece di uscire dallo schermo.

**File:**
- Modifica: `frontend/styles/f1.css` (`#standings-panel`)
- Modifica: `frontend/f1.html` (bump `?v=` del css)

- [ ] **Passo 1: far scorrere il pannello**

```css
/* Con venti piloti l'elenco supera l'altezza della finestra. Resta completo
   (scelta dell'utente: se risulterà ingombrante si taglierà dopo) ma scorre,
   invece di finire sotto il bordo dello schermo. */
#standings-panel {
    max-height: 70vh;
    overflow-y: auto;
    overflow-x: hidden;
}

/* La riga dei giri resta visibile mentre il resto scorre: è l'informazione
   che si guarda più spesso. */
#lap-chip {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--f1-panel-strong);
}
```

- [ ] **Passo 2: bump del cache busting**

In `frontend/f1.html`, incrementare `?v=` di `styles/f1.css`.

- [ ] **Passo 3: provare in localhost**

Gara con 20 piloti: l'elenco deve essere completo, scorrevole, e il chip dei
giri deve restare in cima mentre si scorre.

- [ ] **Passo 4: commit**

```bash
git add frontend/styles/f1.css frontend/f1.html
git commit -m "F1: la classifica scorre invece di uscire dallo schermo"
```

---

## Playtest finale (dopo tutti i task)

Nessun test automatico vede queste cose:

1. **La sosta ai box col passo nuovo.** Entrare ai box in gara e verificare che
   l'auto si fermi allineata al proprio box e non a metà fra due. È il rischio
   più concreto del piano: `PIT_BOX_SPACING` decide dove l'autopilota si ferma.
2. **L'aspetto del fronte continuo**, su monte-rosso (corsia corta, molti
   edifici) e su prova (corsia lunga).
3. **Il costo grafico con 20 auto**: pannello F9, confrontando gli fps con 6 e
   con 20 sulla stessa pista. Atteso +220 draw call e +201k triangoli su ~800 e
   1698k; se gli fps crollano più del previsto, il sospetto numero uno sono le
   **ombre**, che ridisegnano ogni auto una seconda volta (tasto O per il
   confronto immediato).
