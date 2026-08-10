# F1 — direzione artistica cel shading: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare al gioco F1 l'aspetto cel-shaded del riferimento *Fortnite × I
Simpson* — luce a fasce, ombre nette e colorate, contorni neri, palette satura,
cielo a gradiente — senza toccare la geometria degli asset.

**Architettura:** cinque moduli nuovi in `frontend/shared/` (palette, stile,
contorni, cielo, pannello) e tre soli agganci in `frontend/f1.js`: cielo
all'avvio, `ToonStyle.convert()` alla fine di ogni caricamento, e il passaggio
dei contorni al posto di `renderer.render` nel loop. Il colore si corregge
dentro lo shader, perché nel gioco arriva da tre meccanismi diversi (colore per
materiale negli asset del circuito, texture-palette più vertex color nell'auto,
soli vertex color in pista e prato) e nessun intervento sui materiali li
copre tutti.

**Tech Stack:** Three.js r128 caricato come script globale da CDN (niente
moduli ES, niente bundler), `MeshToonMaterial` con `gradientMap`,
`onBeforeCompile` per il patch condiviso, `WebGLRenderTarget` con
`DepthTexture` per i contorni, `node:test` per i moduli puri.

**Spec:** `docs/superpowers/specs/2026-08-10-f1-art-direction-cel-shading-design.md`

## Global Constraints

- **Italiano** in commenti, messaggi e testi UI. Niente emoji: solo glifi
  unicode monocromatici (convenzione di progetto).
- **Il commit lo fa l'utente.** Nessun task committa o pusha: ogni task finisce
  con la verifica, poi si aspetta. Non usare `git commit` in nessuno step.
- **Pattern dei moduli condivisi**: IIFE UMD-lite identica a
  `frontend/shared/sceneryHills.js` — `module.exports` in Node, `root.<Nome>`
  nel browser. Nessun modulo ES.
- **Nessun riferimento a `THREE` al livello superiore di un modulo**, solo
  dentro le funzioni: `toonStyle.js` deve poter essere caricato da `node --test`
  in un ambiente senza Three.
- **Cache-busting**: ogni volta che si tocca un file `.js` caricato da
  `frontend/f1.html`, bumpare il suo `?v=` nella riga `<script>`. Senza,
  il browser serve il file vecchio e sembra che la modifica non abbia effetto.
- **Test**: `node --test frontend/shared/<file>.test.js` dalla radice del repo.
- **Avvio del gioco**: `node server.js` dalla cartella `backend/`, poi
  `localhost:3000`. **Il server lo avvia l'utente**, non il worker.
- **Three è fissato a r128**: i nomi dei chunk shader usati nei patch valgono
  per quella versione.
- **I numeri di riga si riferiscono ai file com'erano il 2026-08-10.** Ogni
  task che inserisce righe fa slittare quelli successivi: cercare sempre per
  contenuto (il frammento di codice citato), usando il numero solo come
  indicazione di massima.

---

## Struttura dei file

| file | responsabilità | Three? |
|---|---|---|
| `frontend/shared/toonPalette.js` (nuovo) | colori, gradiente del cielo, correzione di saturazione. Dati e funzioni pure | no |
| `frontend/shared/toonPalette.test.js` (nuovo) | test del modulo puro | no |
| `frontend/shared/toonStyle.js` (nuovo) | conversione dei materiali in toon, patch shader condiviso, audit | sì (solo dentro le funzioni) |
| `frontend/shared/toonStyle.test.js` (nuovo) | test del solo `buildPatch`, con shader finti | no |
| `frontend/shared/toonSky.js` (nuovo) | cupola del cielo a gradiente, nebbia derivata | sì |
| `frontend/shared/toonOutline.js` (nuovo) | passaggio normali+profondità, ricerca bordi, overlay | sì |
| `frontend/shared/toonPanel.js` (nuovo) | pannello di taratura, tasti F8/F9, contatore di frame | no (solo DOM) |
| `frontend/f1.js` (modifica) | i tre agganci | — |
| `frontend/f1.html` (modifica) | caricamento dei nuovi script | — |
| `frontend/shared/trackMeshBuilder.js` (modifica) | costanti di colore prese da `ToonPalette` | — |

---

### Task 1: modulo palette (dati puri)

Il modulo che tutti gli altri consumano. Nessuna dipendenza, quindi
interamente testabile.

**Files:**
- Create: `frontend/shared/toonPalette.js`
- Test: `frontend/shared/toonPalette.test.js`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `ToonPalette.SURFACES` — oggetto con `grass`, `grassDark`, `grassLight`,
    `asphalt`, `pitLane`, `bridge`, `pond` (interi `0xRRGGBB`) e
    `curbNeutral` (array `[r,g,b]` in 0..1, perché i cordoli usano vertex color).
  - `ToonPalette.SKY_STOPS` — array `{ t, color }` ordinato per `t` crescente,
    `t=0` orizzonte, `t=1` zenit.
  - `ToonPalette.skyColorAt(t)` → intero `0xRRGGBB`.
  - `ToonPalette.fogColor()` → intero, per definizione `skyColorAt(0)`.
  - `ToonPalette.FOG_DENSITY` → numero.
  - `ToonPalette.SHADOW_TINT` → intero.
  - `ToonPalette.BANDS` → array crescente di numeri in (0,1].
  - `ToonPalette.SATURATION` → `{ scenery, car, world }`.
  - `ToonPalette.saturate(hex, amount)` → intero.
  - `ToonPalette.hexToRgb(hex)` → `{ r, g, b }` in 0..1;
    `ToonPalette.rgbToHex({r,g,b})` → intero.

- [ ] **Step 1: scrivere il test che fallisce**

Crea `frontend/shared/toonPalette.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const ToonPalette = require('./toonPalette.js');

// La regola di sicurezza dell'intero cielo: la nebbia NON è un colore
// scelto a parte, è il gradiente del cielo alla quota dell'orizzonte. Con
// due colori indipendenti resta visibile la linea di stacco fra prato e
// cielo — è già successo il 2026-08-09 e l'utente l'ha segnalata.
test('la nebbia coincide col cielo all orizzonte', () => {
    assert.equal(ToonPalette.fogColor(), ToonPalette.skyColorAt(0));
});

test('il gradiente del cielo rispetta gli estremi dichiarati', () => {
    const stops = ToonPalette.SKY_STOPS;
    assert.equal(ToonPalette.skyColorAt(0), stops[0].color);
    assert.equal(ToonPalette.skyColorAt(1), stops[stops.length - 1].color);
});

test('il gradiente del cielo non ha salti bruschi', () => {
    // Campionandolo fitto, due campioni vicini non devono differire di più
    // di 12 livelli per canale: un salto più grande si vedrebbe come banda
    // netta in cielo.
    let prev = ToonPalette.hexToRgb(ToonPalette.skyColorAt(0));
    for (let i = 1; i <= 200; i++) {
        const cur = ToonPalette.hexToRgb(ToonPalette.skyColorAt(i / 200));
        for (const ch of ['r', 'g', 'b']) {
            const delta = Math.abs(cur[ch] - prev[ch]) * 255;
            assert.ok(delta <= 12, `salto di ${delta.toFixed(1)} sul canale ${ch} a t=${i / 200}`);
        }
        prev = cur;
    }
});

test('t fuori intervallo viene bloccato agli estremi', () => {
    assert.equal(ToonPalette.skyColorAt(-3), ToonPalette.skyColorAt(0));
    assert.equal(ToonPalette.skyColorAt(9), ToonPalette.skyColorAt(1));
});

test('saturare di zero lascia il colore identico', () => {
    for (const hex of [0x3d8b3d, 0xffffff, 0x000000, 0x1e63c8]) {
        assert.equal(ToonPalette.saturate(hex, 0), hex);
    }
});

test('saturare aumenta la distanza dal grigio senza spostare la tinta', () => {
    // Il colore del pilota deve restare riconoscibile: la correzione alza la
    // saturazione ma non ruota la tinta, altrimenti due livree diverse
    // potrebbero avvicinarsi e il pallino della classifica non
    // corrisponderebbe più all'auto in pista.
    const before = ToonPalette.hexToRgb(0x8b3d3d);
    const after = ToonPalette.hexToRgb(ToonPalette.saturate(0x8b3d3d, 0.3));
    const lumaBefore = 0.299 * before.r + 0.587 * before.g + 0.114 * before.b;
    const lumaAfter = 0.299 * after.r + 0.587 * after.g + 0.114 * after.b;
    const spreadBefore = Math.max(before.r, before.g, before.b) - Math.min(before.r, before.g, before.b);
    const spreadAfter = Math.max(after.r, after.g, after.b) - Math.min(after.r, after.g, after.b);
    assert.ok(spreadAfter > spreadBefore, 'la saturazione non è aumentata');
    assert.ok(Math.abs(lumaAfter - lumaBefore) < 0.02, 'la luminosità è cambiata troppo');
    // canale dominante invariato = tinta invariata
    assert.ok(after.r > after.g && after.r > after.b, 'il canale dominante è cambiato');
});

test('saturare non produce mai canali fuori scala', () => {
    for (const hex of [0xff0000, 0x00ff00, 0x0000ff, 0xfefefe, 0x010101]) {
        const out = ToonPalette.saturate(hex, 0.9);
        assert.ok(out >= 0 && out <= 0xffffff, `colore fuori scala: ${out}`);
        const rgb = ToonPalette.hexToRgb(out);
        for (const ch of ['r', 'g', 'b']) {
            assert.ok(rgb[ch] >= 0 && rgb[ch] <= 1, `canale ${ch} fuori da [0,1]`);
        }
    }
});

test('le fasce di luce sono crescenti e arrivano a 1', () => {
    const b = ToonPalette.BANDS;
    assert.ok(b.length >= 2, 'servono almeno due fasce');
    for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1], 'fasce non crescenti');
    assert.equal(b[b.length - 1], 1);
    assert.ok(b[0] > 0, 'la fascia più scura non può essere nera piena');
});

test('i colori delle superfici sono interi validi', () => {
    for (const [nome, hex] of Object.entries(ToonPalette.SURFACES)) {
        if (Array.isArray(hex)) {
            assert.equal(hex.length, 3, `${nome}: servono tre canali`);
            for (const c of hex) assert.ok(c >= 0 && c <= 1, `${nome}: canale fuori da [0,1]`);
        } else {
            assert.ok(Number.isInteger(hex) && hex >= 0 && hex <= 0xffffff, `${nome} non è un colore valido`);
        }
    }
});

test('andata e ritorno fra hex e rgb', () => {
    for (const hex of [0x000000, 0xffffff, 0x3fa86b, 0x5e6b75]) {
        assert.equal(ToonPalette.rgbToHex(ToonPalette.hexToRgb(hex)), hex);
    }
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Comando: `node --test frontend/shared/toonPalette.test.js`
Atteso: FAIL — `Cannot find module './toonPalette.js'`.

- [ ] **Step 3: scrivere il modulo**

Crea `frontend/shared/toonPalette.js`:

```js
// frontend/shared/toonPalette.js
//
// Palette e regole di correzione del colore per il look cel-shaded del gioco
// F1 (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md).
//
// Modulo PURO: nessuna dipendenza da Three.js, quindi è l'unico pezzo del
// motore di stile verificabile con `node --test`. Tutto ciò che qui è un
// numero deve restare un numero: appena un valore ha bisogno di una texture
// o di un materiale, il suo posto è in toonStyle.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function hexToRgb(hex) {
        return {
            r: ((hex >> 16) & 255) / 255,
            g: ((hex >> 8) & 255) / 255,
            b: (hex & 255) / 255,
        };
    }

    function rgbToHex(rgb) {
        const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
        return (q(rgb.r) << 16) | (q(rgb.g) << 8) | q(rgb.b);
    }

    // Colori delle superfici che il gioco genera in JavaScript (non arrivano
    // da un GLB, quindi non basterebbe correggerli nello shader: qui il
    // colore è scritto nel codice ed è giusto cambiarlo alla fonte).
    //
    // L'asfalto è il salto più grosso: da 0x1e1e1e, quasi nero, a un grigio
    // medio bluastro. Non è un vezzo — su un asfalto nero le fasce di luce
    // non hanno spazio per vedersi e l'ombra colorata non ha nulla su cui
    // virare.
    const SURFACES = {
        grass: 0x3fa86b,        // era 0x3d8b3d
        grassDark: 0x2e8f5e,    // chiazza scura del prato dipinto
        grassLight: 0x55be7c,   // chiazza chiara
        asphalt: 0x5e6b75,      // era 0x1e1e1e
        pitLane: 0x6a7681,      // era 0x3a3a3a
        bridge: 0x8b93a0,       // era 0x4a4a4a
        pond: 0x1e63c8,         // era 0x2f6fa8
        curbNeutral: [0.55, 0.57, 0.60],  // era [0.35, 0.35, 0.37] (vertex color)
    };

    // Gradiente del cielo, dall'orizzonte (t=0) allo zenit (t=1).
    //
    // Quattro tappe e non tre: la banda calda crema-pesca sta APPENA SOPRA
    // l'orizzonte, mentre la tappa più bassa — quella che tocca la linea del
    // terreno, e che quindi diventa il colore della nebbia — è un azzurro
    // pallido virato al lilla. Da lì vengono le colline lontane color lilla
    // del riferimento. Mettendo il crema-pesca proprio sull'orizzonte le
    // colline virerebbero al beige.
    const SKY_STOPS = [
        { t: 0.00, color: 0xc9d6ea },
        { t: 0.12, color: 0xf7e3c8 },
        { t: 0.45, color: 0x8fd3f0 },
        { t: 1.00, color: 0x3fa9e8 },
    ];

    const FOG_DENSITY = 0.0016;

    function skyColorAt(t) {
        const x = Math.max(0, Math.min(1, t));
        for (let i = 1; i < SKY_STOPS.length; i++) {
            const a = SKY_STOPS[i - 1], b = SKY_STOPS[i];
            if (x <= b.t) {
                const k = b.t === a.t ? 0 : (x - a.t) / (b.t - a.t);
                // smoothstep invece di lineare: agli attacchi fra due tappe
                // una rampa lineare lascia uno spigolo di luminosità che in
                // cielo si legge come banda.
                const s = k * k * (3 - 2 * k);
                const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
                return rgbToHex({
                    r: ca.r + (cb.r - ca.r) * s,
                    g: ca.g + (cb.g - ca.g) * s,
                    b: ca.b + (cb.b - ca.b) * s,
                });
            }
        }
        return SKY_STOPS[SKY_STOPS.length - 1].color;
    }

    // La nebbia NON è un colore indipendente: è il cielo alla quota
    // dell'orizzonte. Definirla così rende impossibile per costruzione la
    // riga di stacco fra prato e cielo.
    function fogColor() {
        return skyColorAt(0);
    }

    // Tinta verso cui vira la fascia in ombra, invece di scurire in grigio:
    // nel riferimento l'ombra sul muro rosso è rosso scuro, non grigia.
    const SHADOW_TINT = 0x8aa0c8;

    // Le tre fasce del cel shading: valori di irradianza a cui la luce viene
    // agganciata. La più scura non è 0 — a zero le zone in ombra propria
    // diventerebbero nere e perderebbero il colore della superficie.
    const BANDS = [0.45, 0.72, 1.0];

    // Quanta saturazione aggiungere, per famiglia di oggetti. Sull'auto è
    // quasi nulla: il colore identifica il pilota ed è lo stesso pallino
    // della classifica.
    const SATURATION = { scenery: 0.18, world: 0.10, car: 0.04 };

    // Allontana il colore dal proprio luma senza ruotare la tinta: un rosso
    // resta rosso, diventa solo più squillante. amount 0 = identità.
    function saturate(hex, amount) {
        if (!amount) return hex;
        const c = hexToRgb(hex);
        const luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        return rgbToHex({
            r: luma + (c.r - luma) * (1 + amount),
            g: luma + (c.g - luma) * (1 + amount),
            b: luma + (c.b - luma) * (1 + amount),
        });
    }

    return {
        SURFACES, SKY_STOPS, FOG_DENSITY, SHADOW_TINT, BANDS, SATURATION,
        skyColorAt, fogColor, saturate, hexToRgb, rgbToHex,
    };
});
```

- [ ] **Step 4: eseguire i test e verificare che passino**

Comando: `node --test frontend/shared/toonPalette.test.js`
Atteso: PASS su tutti i test (10 test).

Se `saturare non produce mai canali fuori scala` fallisce su `0xff0000`, la
causa è il `Math.min` mancante in `rgbToHex`: il clamp deve stare lì, non nei
chiamanti.

- [ ] **Step 5: consegna**

Nessun commit (lo fa l'utente). Riferire: quanti test passano e i valori di
`fogColor()` e `skyColorAt(1)` in esadecimale, così l'utente vede subito i due
estremi del cielo.

---

### Task 2: cupola del cielo e nebbia

Prima consegna visibile in gioco: cambia il cielo. Da fare prima dello stile
perché il colore della luce va giudicato sotto il cielo definitivo.

**Files:**
- Create: `frontend/shared/toonSky.js`
- Modify: `frontend/f1.js:73-75` (background e nebbia), `frontend/f1.js:1937-2202` (loop)
- Modify: `frontend/f1.html:232-249` (nuovo script + bump versione di `f1.js`)

**Interfaces:**
- Consumes: `ToonPalette.SKY_STOPS`, `ToonPalette.skyColorAt`,
  `ToonPalette.fogColor`, `ToonPalette.FOG_DENSITY`.
- Produces:
  - `ToonSky.install(scene)` → `{ dome, uniforms, update(camera), setEnabled(on) }`.
    `update(camera)` va chiamata una volta per frame; `setEnabled(false)`
    ripristina il cielo piatto precedente.

- [ ] **Step 1: scrivere il modulo**

Crea `frontend/shared/toonSky.js`:

```js
// frontend/shared/toonSky.js
//
// Cupola del cielo a gradiente + nebbia coordinata, per il look cel-shaded
// (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md).
//
// La cupola SEGUE la camera: il gradiente si calcola sulla direzione dal
// centro della cupola, non sulla quota assoluta, quindi il cielo si comporta
// come se fosse infinitamente lontano anche con un raggio di 800 unità (che
// deve restare entro camera.far, 1200).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonSky = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const DOME_RADIUS = 800;

    function install(scene) {
        const stops = ToonPalette.SKY_STOPS;
        const uniforms = {
            uColors: { value: stops.map((s) => new THREE.Color(s.color)) },
            uStops: { value: stops.map((s) => s.t) },
            uOn: { value: 1 },
            uFlat: { value: new THREE.Color(0x87ceeb) },   // il cielo di prima, per il confronto a interruttore spento
        };

        const material = new THREE.ShaderMaterial({
            uniforms,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            vertexShader: [
                'varying vec3 vDir;',
                'void main() {',
                '    vDir = normalize( position );',
                '    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
                '}',
            ].join('\n'),
            fragmentShader: [
                'uniform vec3 uColors[' + stops.length + '];',
                'uniform float uStops[' + stops.length + '];',
                'uniform float uOn;',
                'uniform vec3 uFlat;',
                'varying vec3 vDir;',
                'void main() {',
                // t = 0 all'orizzonte, 1 allo zenit. Sotto l'orizzonte resta
                // il colore dell'orizzonte: là c'è comunque il terreno, e
                // così la cupola non stacca mai dalla nebbia.
                '    float t = clamp( vDir.y, 0.0, 1.0 );',
                '    vec3 col = uColors[0];',
                '    for ( int i = 1; i < ' + stops.length + '; i++ ) {',
                '        float k = clamp( ( t - uStops[i - 1] ) / ( uStops[i] - uStops[i - 1] ), 0.0, 1.0 );',
                '        k = k * k * ( 3.0 - 2.0 * k );',
                '        col = mix( col, uColors[i], k );',
                '    }',
                '    gl_FragColor = vec4( mix( uFlat, col, uOn ), 1.0 );',
                '}',
            ].join('\n'),
        });

        const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 16), material);
        dome.frustumCulled = false;
        dome.renderOrder = -1;
        scene.add(dome);

        // Il colore piatto di prima resta come background: si vede solo se la
        // cupola viene spenta, e non costa nulla tenerlo.
        scene.background = new THREE.Color(0x87ceeb);
        scene.fog = new THREE.FogExp2(ToonPalette.fogColor(), ToonPalette.FOG_DENSITY);

        return {
            dome,
            uniforms,
            update(camera) {
                dome.position.copy(camera.position);
            },
            setEnabled(on) {
                uniforms.uOn.value = on ? 1 : 0;
                dome.visible = true;   // resta visibile: da spenta disegna il colore piatto
                scene.fog.color.set(on ? ToonPalette.fogColor() : 0x87ceeb);
            },
        };
    }

    return { install, DOME_RADIUS };
});
```

- [ ] **Step 2: agganciare il modulo in `f1.js`**

In `frontend/f1.js`, sostituisci le righe 66-75 (il blocco `SKY_COLOR`,
`scene.background`, `scene.fog`) con:

```js
    // Cielo a gradiente e nebbia: il colore della nebbia NON è più scelto a
    // mano ma derivato dal gradiente del cielo alla quota dell'orizzonte
    // (ToonPalette.fogColor), così la riga di stacco fra prato e cielo non
    // può più ricomparire. Rif. spec 2026-08-10-f1-art-direction-cel-shading.
    const toonSky = ToonSky.install(scene);
```

Poi, dentro `animate()` (riga 1937), subito prima di `renderer.render(scene, camera);`
alla riga 2202, aggiungi:

```js
        toonSky.update(camera);
```

- [ ] **Step 3: caricare lo script in `f1.html`**

In `frontend/f1.html`, subito dopo la riga di `shared/trackGeometry.js`,
aggiungi:

```html
    <script src="shared/toonPalette.js?v=20260810a"></script>
    <script src="shared/toonSky.js?v=20260810a"></script>
```

e bumpa la versione di `f1.js` nell'ultima riga (`?v=20260810b` →
`?v=20260810c`).

- [ ] **Step 4: verifica statica**

Comando: `node --check frontend/shared/toonSky.js && node --check frontend/f1.js`
Atteso: nessun output (sintassi valida).

Comando: `node --test frontend/shared/toonPalette.test.js`
Atteso: PASS (nessuna regressione).

- [ ] **Step 5: consegna e verifica dell'utente**

Chiedi all'utente di avviare il server e guardare il cielo dalla griglia di
partenza. Cosa deve vedere: gradiente dall'azzurro pieno in alto a una banda
calda in basso, orizzonte azzurro pallido che si confonde con la foschia,
nessuna riga netta fra prato e cielo. Se compare una riga, il colpevole è la
densità della nebbia, non il gradiente: si tara al Task 5 con lo slider.

---

### Task 3: motore di stile (materiali toon e patch condiviso)

Il cuore del lavoro. Alla fine di questo task il gioco ha la luce a fasce, le
ombre nette e colorate, e la correzione di saturazione.

**Files:**
- Create: `frontend/shared/toonStyle.js`
- Test: `frontend/shared/toonStyle.test.js`
- Modify: `frontend/f1.js` — luci (righe 88-106), `loadScenery` (riga 387),
  laghetto (riga 409-416), chiamate a `TrackMeshBuilder` (righe 175-258),
  `loadCarModel` (riga 447), pit box (riga 712)
- Modify: `frontend/f1.html` (nuovo script + bump)

**Interfaces:**
- Consumes: `ToonPalette.BANDS`, `ToonPalette.SHADOW_TINT`,
  `ToonPalette.SATURATION`.
- Produces:
  - `ToonStyle.buildPatch(shader, opts)` — funzione **pura**: riceve un
    oggetto con `vertexShader`, `fragmentShader`, `uniforms` e lo modifica sul
    posto. `opts = { saturation: number, isGround: boolean }`. Lancia `Error`
    se un chunk atteso non è presente.
  - `ToonStyle.convert(root, opts)` — attraversa un `Object3D` e converte i
    `MeshStandardMaterial` in `MeshToonMaterial` patchati.
    `opts = { saturation, isGround }`, default `{ saturation: SATURATION.scenery, isGround: false }`.
  - `ToonStyle.uniforms` — uniform condivise: `uOn`, `uShadowTint`,
    `uGrassDark`, `uGrassLight`, `uPatchScale`, `uPatchAmount`, `uTuftAmount`.
  - `ToonStyle.setEnabled(on)`.
  - `ToonStyle.audit(scene)` → array di stringhe (nomi delle mesh non convertite).
  - `ToonStyle.OUTLINE_EXCLUDE_LAYER` (numero, `2`) e
    `ToonStyle.excludeFromOutline(object)`.

- [ ] **Step 1: scrivere il test che fallisce**

Crea `frontend/shared/toonStyle.test.js`. Verifica il solo `buildPatch`, che è
puro: è anche il pezzo più rischioso, perché una sostituzione mancata non dà
alcun errore visibile.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const ToonStyle = require('./toonStyle.js');

// Finto shader con i soli chunk a cui il patch si aggancia, negli stessi
// punti in cui compaiono in Three r128.
function fakeShader() {
    return {
        uniforms: {},
        vertexShader: [
            'void main() {',
            '    #include <beginnormal_vertex>',
            '    #include <begin_vertex>',
            '    #include <project_vertex>',
            '}',
        ].join('\n'),
        fragmentShader: [
            '#include <gradientmap_pars_fragment>',
            'void main() {',
            '    #include <map_fragment>',
            '    #include <color_fragment>',
            '    vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
            '}',
        ].join('\n'),
    };
}

test('il patch dichiara le sue uniform', () => {
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    for (const nome of ['uOn', 'uShadowTint', 'uSat', 'uIsGround']) {
        assert.ok(s.uniforms[nome], `manca la uniform ${nome}`);
    }
});

test('la saturazione è privata del materiale, non condivisa', () => {
    // Due materiali con saturazione diversa (scenografia 0.18, auto 0.04)
    // devono poter convivere: se uSat finisse fra le uniform condivise, il
    // secondo materiale sovrascriverebbe il primo e le auto verrebbero
    // saturate come la scenografia.
    const a = fakeShader(), b = fakeShader();
    ToonStyle.buildPatch(a, { saturation: 0.18, isGround: false });
    ToonStyle.buildPatch(b, { saturation: 0.04, isGround: false });
    assert.equal(a.uniforms.uSat.value, 0.18);
    assert.equal(b.uniforms.uSat.value, 0.04);
    assert.notEqual(a.uniforms.uSat, b.uniforms.uSat);
});

test('le uniform globali sono lo STESSO oggetto per tutti i materiali', () => {
    // È ciò che permette agli slider del pannello di muovere tutta la scena
    // senza ricompilare gli shader.
    const a = fakeShader(), b = fakeShader();
    ToonStyle.buildPatch(a, { saturation: 0.18, isGround: false });
    ToonStyle.buildPatch(b, { saturation: 0.18, isGround: false });
    assert.equal(a.uniforms.uOn, b.uniforms.uOn);
    assert.equal(a.uniforms.uShadowTint, b.uniforms.uShadowTint);
});

test('il flag terreno arriva nello shader', () => {
    const terra = fakeShader(), altro = fakeShader();
    ToonStyle.buildPatch(terra, { saturation: 0.1, isGround: true });
    ToonStyle.buildPatch(altro, { saturation: 0.1, isGround: false });
    assert.equal(terra.uniforms.uIsGround.value, 1);
    assert.equal(altro.uniforms.uIsGround.value, 0);
});

test('il patch tiene conto dell instancing per la posizione mondo', () => {
    // La scenografia è tutta InstancedMesh: senza instanceMatrix la posizione
    // mondo di ogni istanza sarebbe quella dell'origine del modello, e le
    // macchie del terreno risulterebbero identiche su tutte le istanze.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    assert.ok(s.vertexShader.includes('USE_INSTANCING'), 'manca il ramo instancing');
    assert.ok(s.vertexShader.includes('instanceMatrix'), 'instanceMatrix non usata');
});

test('la fascia in ombra vira di tinta', () => {
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    assert.ok(s.fragmentShader.includes('getGradientIrradiance'),
        'il patch non ridefinisce la funzione delle fasce');
    assert.ok(s.fragmentShader.includes('uShadowTint'), 'la tinta d ombra non è usata');
});

test('un chunk mancante fa fallire il patch con un messaggio esplicito', () => {
    // È la rete di sicurezza principale: String.replace su una stringa
    // assente non solleva nulla e il materiale resterebbe muto, senza che
    // nessuno se ne accorga.
    const s = fakeShader();
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '');
    assert.throws(
        () => ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false }),
        /color_fragment/,
        'l errore deve nominare il chunk mancante'
    );
});
```

- [ ] **Step 2: eseguire il test e verificare che fallisca**

Comando: `node --test frontend/shared/toonStyle.test.js`
Atteso: FAIL — `Cannot find module './toonStyle.js'`.

- [ ] **Step 3: scrivere il modulo**

Crea `frontend/shared/toonStyle.js`:

```js
// frontend/shared/toonStyle.js
//
// Motore di stile cel-shaded del gioco F1: converte i materiali della scena
// in MeshToonMaterial e inietta in tutti lo stesso patch shader — luce a
// fasce, fascia d'ombra colorata, correzione di saturazione, terreno dipinto.
// Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md.
//
// PERCHÉ NELLO SHADER: nel gioco il colore arriva da tre meccanismi diversi
// (colore per materiale negli asset del circuito, texture-palette + vertex
// color nell'auto, soli vertex color in pista e prato). Correggerlo dopo che
// texture e vertex color hanno detto la loro è l'unico punto in cui la regola
// vale per tutti e tre.
//
// Nessun riferimento a THREE fuori dalle funzioni: così `node --test` può
// caricare questo file per verificare buildPatch senza Three.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonStyle = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const Palette = (typeof module === 'object' && module.exports)
        ? require('./toonPalette.js')
        : null;   // nel browser è il globale ToonPalette

    function palette() {
        return Palette || ToonPalette;
    }

    // Layer riservato agli oggetti che non devono avere il contorno (effetti,
    // segnalatori): il passaggio delle normali di toonOutline lo salta.
    //
    // ATTENZIONE, due conseguenze non ovvie:
    //  - `layers.set` SPOSTA l'oggetto su questo layer togliendolo dal layer 0,
    //    quindi la camera deve abilitare anche il layer 2 per continuare a
    //    vederlo (lo fa ToonOutline.init). Con `layers.enable` l'oggetto
    //    resterebbe anche sul layer 0 e continuerebbe a comparire nel
    //    passaggio delle normali: l'esclusione non avrebbe alcun effetto.
    //  - un oggetto fuori dal layer 0 non proietta più ombra (la shadow map
    //    confronta i layer dell'oggetto con quelli della luce). Va bene per gli
    //    effetti, che ombra non ne fanno: non usarlo su oggetti solidi.
    const OUTLINE_EXCLUDE_LAYER = 2;

    // ── uniform CONDIVISE ────────────────────────────────────────────
    // Un solo oggetto per uniform, copiato per riferimento in ogni materiale:
    // muovere .value qui (dal pannello o dalla console) aggiorna tutta la
    // scena senza ricompilare nulla.
    let shared = null;

    function sharedUniforms() {
        if (!shared) {
            const P = palette();
            shared = {
                uOn: { value: 1 },
                uShadowTint: { value: new THREE.Color(P.SHADOW_TINT) },
                uGrassDark: { value: new THREE.Color(P.SURFACES.grassDark) },
                uGrassLight: { value: new THREE.Color(P.SURFACES.grassLight) },
                uPatchScale: { value: 0.012 },   // 1/unità: una chiazza ogni ~80 unità
                uPatchAmount: { value: 0.55 },   // quanto le chiazze si discostano dal verde base
                uTuftAmount: { value: 0.0 },     // ciuffi d'erba: accesi al Task 7
                uTuftScale: { value: 0.35 },
            };
        }
        return shared;
    }

    // Test-friendly: in Node THREE non esiste, quindi le uniform condivise
    // usano un finto Color che espone solo ciò che serve al patch.
    function sharedUniformsForTest() {
        if (!shared) {
            const fakeColor = () => ({ r: 0, g: 0, b: 0, set() {} });
            shared = {
                uOn: { value: 1 },
                uShadowTint: { value: fakeColor() },
                uGrassDark: { value: fakeColor() },
                uGrassLight: { value: fakeColor() },
                uPatchScale: { value: 0.012 },
                uPatchAmount: { value: 0.55 },
                uTuftAmount: { value: 0.0 },
                uTuftScale: { value: 0.35 },
            };
        }
        return shared;
    }

    // Sostituzione che NON fallisce in silenzio. String.replace su una
    // stringa assente restituisce l'originale senza sollevare nulla: il
    // materiale resterebbe senza patch e nessuno se ne accorgerebbe.
    function replaceOrThrow(source, needle, replacement) {
        if (source.indexOf(needle) === -1) {
            throw new Error(`[ToonStyle] chunk non trovato nello shader: ${needle} — ` +
                'la versione di Three è cambiata? Il patch va aggiornato.');
        }
        return source.replace(needle, replacement);
    }

    function buildPatch(shader, opts) {
        const o = opts || {};
        const globals = (typeof THREE === 'undefined') ? sharedUniformsForTest() : sharedUniforms();
        Object.assign(shader.uniforms, globals);
        // Uniform PRIVATE del materiale: la saturazione è diversa fra
        // scenografia e auto, il flag terreno vale per le sole mesh del prato.
        shader.uniforms.uSat = { value: o.saturation || 0 };
        shader.uniforms.uIsGround = { value: o.isGround ? 1 : 0 };

        // ── vertex: posizione e normale in coordinate MONDO ───────────
        // Serve l'instanceMatrix: la scenografia è tutta InstancedMesh e
        // senza di essa ogni istanza userebbe la posizione dell'origine del
        // modello (chiazze identiche su tutti gli oggetti, e sul terreno
        // niente affatto).
        shader.vertexShader = 'varying vec3 vToonPos;\nvarying vec3 vToonNorm;\n' +
            replaceOrThrow(shader.vertexShader, '#include <begin_vertex>', [
                '#include <begin_vertex>',
                '#ifdef USE_INSTANCING',
                '    vToonPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;',
                '    vToonNorm = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );',
                '#else',
                '    vToonPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
                '    vToonNorm = normalize( mat3( modelMatrix ) * objectNormal );',
                '#endif',
            ].join('\n'));

        // ── fragment ──────────────────────────────────────────────────
        let f = 'uniform float uOn;\nuniform vec3 uShadowTint;\nuniform float uSat;\n' +
            'uniform float uIsGround;\nuniform vec3 uGrassDark;\nuniform vec3 uGrassLight;\n' +
            'uniform float uPatchScale;\nuniform float uPatchAmount;\n' +
            'uniform float uTuftAmount;\nuniform float uTuftScale;\n' +
            'varying vec3 vToonPos;\nvarying vec3 vToonNorm;\n' +
            // rumore a valore, due frequenze: chiazze larghe + irregolarità
            'float toonHash( vec2 p ) {\n' +
            '    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );\n' +
            '}\n' +
            'float toonNoise( vec2 p ) {\n' +
            '    vec2 i = floor( p ), f = fract( p );\n' +
            '    f = f * f * ( 3.0 - 2.0 * f );\n' +
            '    float a = toonHash( i ), b = toonHash( i + vec2( 1.0, 0.0 ) );\n' +
            '    float c = toonHash( i + vec2( 0.0, 1.0 ) ), d = toonHash( i + vec2( 1.0, 1.0 ) );\n' +
            '    return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );\n' +
            '}\n' + shader.fragmentShader;

        // Fascia in ombra COLORATA: la funzione che mappa l'angolo di luce
        // sulla fascia viene ridefinita per lerpare verso la tinta invece di
        // restare grigia.
        f = replaceOrThrow(f, '#include <gradientmap_pars_fragment>', [
            '#ifdef USE_GRADIENTMAP',
            '    uniform sampler2D gradientMap;',
            '#endif',
            'vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {',
            '    float dotNL = dot( normal, lightDirection );',
            '    vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );',
            '    #ifdef USE_GRADIENTMAP',
            '        float band = texture2D( gradientMap, coord ).r;',
            '    #else',
            '        float band = ( coord.x < 0.7 ) ? 0.7 : 1.0;',
            '    #endif',
            '    vec3 tinted = mix( uShadowTint, vec3( 1.0 ), band );',
            '    return mix( vec3( band ), tinted, uOn );',
            '}',
        ].join('\n'));

        // Correzione del colore BASE (dopo map e vertex color, prima
        // dell'illuminazione) + terreno dipinto.
        f = replaceOrThrow(f, '#include <color_fragment>', [
            '#include <color_fragment>',
            '{',
            '    float luma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
            '    vec3 sat = luma + ( diffuseColor.rgb - luma ) * ( 1.0 + uSat );',
            '    diffuseColor.rgb = mix( diffuseColor.rgb, clamp( sat, 0.0, 1.0 ), uOn );',
            '    if ( uIsGround > 0.5 && uOn > 0.5 ) {',
            // chiazze: due frequenze in coordinate mondo XZ (il terreno non
            // ha UV, è generato senza coordinate di texture)
            '        float n = toonNoise( vToonPos.xz * uPatchScale ) * 0.65',
            '                + toonNoise( vToonPos.xz * uPatchScale * 3.1 ) * 0.35;',
            '        vec3 chiazza = mix( uGrassDark, uGrassLight, smoothstep( 0.35, 0.65, n ) );',
            '        diffuseColor.rgb = mix( diffuseColor.rgb, chiazza, uPatchAmount );',
            // ciuffi: tratti scuri minuti, spenti finché uTuftAmount è 0
            '        float tuft = toonNoise( vToonPos.xz * uTuftScale );',
            '        float tratto = smoothstep( 0.86, 0.94, tuft ) * uTuftAmount;',
            '        diffuseColor.rgb *= 1.0 - tratto * 0.45;',
            '    }',
            '}',
        ].join('\n'));

        shader.fragmentShader = f;
        return shader;
    }

    // ── conversione dei materiali ────────────────────────────────────
    let gradientMap = null;

    function bandGradientMap() {
        if (!gradientMap) {
            const P = palette();
            const data = new Uint8Array(P.BANDS.map((v) => Math.round(v * 255)));
            gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.LuminanceFormat);
            gradientMap.minFilter = THREE.NearestFilter;
            gradientMap.magFilter = THREE.NearestFilter;
            gradientMap.generateMipmaps = false;
            gradientMap.needsUpdate = true;
        }
        return gradientMap;
    }

    // Stato di render comune a tutti i Material che il materiale nuovo deve
    // EREDITARE: senza, il toon riparte dai valori di fabbrica.
    //
    // `visible` è la più insidiosa e ha causato un bug reale al primo
    // playtest (2026-08-10): carLoader.js:293 nasconde la carrozzeria
    // originale sotto il vestito voxel spegnendo il MATERIALE e non la mesh —
    // la mesh deve restare in scena per la fisica. Un materiale nuovo con
    // visible=true faceva riemergere la carrozzeria, che ha ancora la texture
    // sorgente rossa, e le due superfici compenetrate si contendevano ogni
    // pixel: puntini rossi che cambiavano durante la marcia.
    const MATERIAL_STATE = [
        'visible', 'side', 'transparent', 'opacity', 'alphaTest', 'depthTest',
        'depthWrite', 'colorWrite', 'blending', 'premultipliedAlpha', 'dithering',
        'toneMapped', 'fog', 'flatShading', 'wireframe', 'shadowSide',
        'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
    ];

    function copyMaterialState(src, dst) {
        for (const chiave of MATERIAL_STATE) {
            // Una proprietà assente nel sorgente non deve sovrascrivere il
            // default del materiale nuovo con undefined.
            if (src[chiave] !== undefined) dst[chiave] = src[chiave];
        }
        return dst;
    }

    function toonFrom(std, opts) {
        const m = new THREE.MeshToonMaterial({
            color: std.color ? std.color.clone() : undefined,
            map: std.map || null,
            gradientMap: bandGradientMap(),
            vertexColors: std.vertexColors === true,
        });
        copyMaterialState(std, m);
        m.name = std.name;
        m.userData = Object.assign({}, std.userData);
        // Tutti i materiali ricevono una closure con lo STESSO corpo: Three
        // include `onBeforeCompile.toString()` nella chiave di cache del
        // programma, quindi il testo identico fa condividere a tutti un unico
        // programma GL compilato, come vuole la spec. Ciò che varia fra un
        // materiale e l'altro (saturazione, flag terreno) sta nelle uniform
        // private, non nel codice — se finisse nel codice, ogni materiale
        // otterrebbe un programma diverso e la compilazione si moltiplicherebbe.
        m.onBeforeCompile = (shader) => buildPatch(shader, opts);
        m.userData.toonified = true;
        return m;
    }

    function convert(root, opts) {
        const o = Object.assign(
            { saturation: palette().SATURATION.scenery, isGround: false },
            opts || {}
        );
        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            const out = mats.map((m) => (m && m.isMeshStandardMaterial ? toonFrom(m, o) : m));
            child.material = Array.isArray(child.material) ? out : out[0];
        });
        return root;
    }

    function setEnabled(on) {
        sharedUniforms().uOn.value = on ? 1 : 0;
    }

    // Rete di sicurezza contro l'errore più probabile: un punto di
    // caricamento dimenticato lascia un oggetto col materiale vecchio, che
    // stona senza motivo apparente.
    function audit(scene) {
        const rimasti = [];
        scene.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) {
                if (m && m.isMeshStandardMaterial) {
                    rimasti.push(child.name || m.name || '(senza nome)');
                    break;
                }
            }
        });
        return rimasti;
    }

    function excludeFromOutline(object) {
        object.traverse((c) => c.layers.set(OUTLINE_EXCLUDE_LAYER));
    }

    return {
        buildPatch, convert, setEnabled, audit, excludeFromOutline,
        OUTLINE_EXCLUDE_LAYER,
        get uniforms() { return sharedUniforms(); },
    };
});
```

- [ ] **Step 4: eseguire i test e verificare che passino**

Comando: `node --test frontend/shared/toonStyle.test.js`
Atteso: PASS su tutti i test (7 test).

- [ ] **Step 5: ritarare le luci in `f1.js`**

Sostituisci il blocco luci (righe 88-106) con:

```js
    // ====================================================
    // LUCI — tarate per il cel shading
    // ====================================================
    // L'emisferica è la sola luce che arriva dove il sole non batte: è lei a
    // dare il colore alle ombre PROIETTATE (quelle proprie le colora la
    // fascia dello shader). Cielo freddo e terra verde satura, intensità
    // alzata perché con la luce a fasce le zone in ombra piena
    // resterebbero altrimenti troppo cupe per un look a colori piatti.
    scene.add(new THREE.HemisphereLight(0x9ec8f0, 0x3f7a52, 0.95));

    const sun = new THREE.DirectionalLight(0xfff6e2, 1.15);
    sun.position.set(150, 200, 50);
    sun.target.position.set(50, 0, 100);  // punta al centro del circuito
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = -300;
    sun.shadow.camera.right = 300;
    sun.shadow.camera.top = 300;
    sun.shadow.camera.bottom = -300;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
```

E alla riga 83 sostituisci il tipo di ombra:

```js
    // Ombra NETTA ma non scalettata: PCF semplice con raggio 1 dà un bordo
    // stretto: PCFSoftShadowMap lo sfuma troppo per un look cel-shaded,
    // BasicShadowMap lo rende netto ma a scaletta (si vedrebbe la griglia
    // dei texel della mappa).
    renderer.shadowMap.type = THREE.PCFShadowMap;
```

e subito dopo la creazione del sole aggiungi `sun.shadow.radius = 1;`.

- [ ] **Step 6: agganciare `convert()` a tutti i punti di caricamento**

Sei punti, tutti in `frontend/f1.js`. Nessuno può essere saltato: l'audit dello
step 8 li verifica.

1. **Scenografia** — in `loadScenery`, subito dopo la creazione
   dell'`InstancedMesh` (riga 387 circa), prima di `container.add(im)`:

```js
                    ToonStyle.convert(im);
```

2. **Laghetto** — nella creazione del `pond` (riga 409), dopo `pond.receiveShadow = true;`:

```js
            ToonStyle.convert(pond, { saturation: ToonPalette.SATURATION.world });
```

3. **Prato — PRIMA di tutto il resto.** `buildGround` (riga 175) aggiunge le
   sue mesh direttamente alla scena senza restituirle: si catturano
   confrontando `scene.children` prima e dopo la chiamata. Sostituisci la riga
   175 con:

```js
    // Le mesh del prato (e delle colline, che condividono la stessa griglia)
    // servono più avanti per marcarle come terreno: buildGround non le
    // restituisce, quindi si prendono per differenza. Identificarle dal colore
    // sarebbe fragile — il colore del prato cambia al Task 6 e il confronto
    // smetterebbe di trovarle senza che nulla lo segnali.
    const primaDelPrato = scene.children.length;
    TrackMeshBuilder.buildGround(scene, trackPts, BARRIER_D + EMBANKMENT_WIDTH, 3000);
    const mesheTerreno = scene.children.slice(primaDelPrato);
```

   Poi, dopo l'ultima chiamata a `TrackMeshBuilder` (riga 258,
   `buildStartingGrid`), aggiungi:

```js
    // ORDINE OBBLIGATORIO: il terreno si converte PRIMA della conversione
    // generale qui sotto. Facendolo dopo, i suoi materiali non sarebbero più
    // MeshStandardMaterial, la marcatura non avrebbe effetto, le chiazze non
    // comparirebbero e non ci sarebbe alcun errore a dirlo.
    // Solo buildGround, non il terrapieno: quello sfuma dal colore della
    // pista al verde con i vertex color, e le chiazze verdi gli
    // ricoprirebbero il bordo asfaltato.
    for (const mesh of mesheTerreno) {
        ToonStyle.convert(mesh, { saturation: ToonPalette.SATURATION.world, isGround: true });
    }
```

4. **Pista, cordoli, barriere, linee, griglia** — subito dopo il blocco
   precedente:

```js
    // Le mesh di TrackMeshBuilder sono aggiunte alla scena in modo sincrono:
    // una sola conversione qui le copre tutte. A questo punto dell'esecuzione
    // la scena contiene SOLO mesh sincrone — scenografia, auto e box arrivano
    // da callback asincrone, che non possono essersi inserite prima —, quindi
    // nessun oggetto rischia di prendere la saturazione sbagliata.
    ToonStyle.convert(scene, { saturation: ToonPalette.SATURATION.world });
```

5. **Auto** — in `loadCarModel` (riga 447), dentro il wrapper, avvolgi la
   callback `onReady`:

```js
    function loadCarModel(playerColor, onReady, liveryColors) {
        CarLoader.loadCarModel(playerColor, (car) => {
            // Saturazione quasi nulla sull'auto: il colore identifica il
            // pilota ed è lo stesso pallino della classifica.
            ToonStyle.convert(car, { saturation: ToonPalette.SATURATION.car });
            onReady(car);
        }, { scene, listener, engineBuffer }, liveryColors);
    }
```

6. **Box del giocatore** — nella callback di `PitBoxLoader.loadPitBoxModel`
   (riga 712), come prima riga del corpo:

```js
            ToonStyle.convert(model);
```

- [ ] **Step 7: caricare lo script in `f1.html`**

Aggiungi dopo `shared/toonSky.js`:

```html
    <script src="shared/toonStyle.js?v=20260810a"></script>
```

e bumpa di nuovo la versione di `f1.js`.

- [ ] **Step 8: verifica**

Comando: `node --check frontend/f1.js && node --test frontend/shared/toonStyle.test.js frontend/shared/toonPalette.test.js`
Atteso: nessun errore di sintassi, tutti i test PASS.

Poi chiedi all'utente di avviare il gioco e di eseguire in console del browser:

```js
ToonStyle.audit(scene)
```

Atteso: array vuoto, o solo nomi di effetti che usano `MeshBasicMaterial` (che
non compaiono nell'audit). Qualsiasi altro nome è un punto di aggancio
dimenticato: va aggiunto prima di proseguire.

- [ ] **Step 9: consegna e playtest**

Cosa deve vedere l'utente: superfici a campiture nette invece che sfumate,
ombre proiettate con bordo stretto e virate all'azzurro, colori più squillanti.
Le cose ancora "sbagliate" a questo punto e che NON vanno corrette qui:
l'asfalto è ancora quasi nero (Task 6) e non ci sono contorni (Task 5).

---

### Task 4: pannello di taratura e tasti

Serve prima dei contorni: senza gli slider, tarare le fasce significa
modificare il codice e ricaricare a ogni tentativo.

**Files:**
- Create: `frontend/shared/toonPanel.js`
- Modify: `frontend/f1.js` (una chiamata dopo gli agganci del Task 3), `frontend/f1.html`

**Interfaces:**
- Consumes: `ToonStyle.uniforms`, `ToonStyle.setEnabled`, `ToonStyle.audit`,
  `ToonSky.install(...)` (l'oggetto restituito), e più avanti `ToonOutline`.
- Produces: `ToonPanel.install({ style, sky, outline, scene })` → `{ dispose() }`.
  `outline` può essere `null` finché il Task 5 non esiste.

- [ ] **Step 1: scrivere il modulo**

Crea `frontend/shared/toonPanel.js`:

```js
// frontend/shared/toonPanel.js
//
// Pannello di taratura del look cel-shaded (F9) e interruttore rapido dei
// contorni (F8). Nascosto di default, agisce in tempo reale sulle uniform
// condivise: nessun refresh, nessuna ricompilazione degli shader.
//
// Testo e glifi monocromatici, niente emoji (convenzione di progetto).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonPanel = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function riga(padre, etichetta, min, max, valore, passo, onChange) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;font:11px monospace;color:#dfe3e6;';
        const nome = document.createElement('span');
        nome.textContent = etichetta;
        nome.style.cssText = 'flex:0 0 130px;';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min; slider.max = max; slider.step = passo; slider.value = valore;
        slider.style.cssText = 'flex:1;';
        const eco = document.createElement('span');
        eco.textContent = Number(valore).toFixed(3);
        eco.style.cssText = 'flex:0 0 52px;text-align:right;';
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            eco.textContent = v.toFixed(3);
            onChange(v);
        });
        wrap.append(nome, slider, eco);
        padre.appendChild(wrap);
    }

    function interruttore(padre, etichetta, acceso, onToggle) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;font:11px monospace;color:#dfe3e6;';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = acceso;
        box.addEventListener('change', () => onToggle(box.checked));
        const nome = document.createElement('span');
        nome.textContent = etichetta;
        wrap.append(box, nome);
        padre.appendChild(wrap);
        return box;
    }

    function install({ style, sky, outline, scene }) {
        const u = style.uniforms;

        const box = document.createElement('div');
        box.style.cssText = [
            'position:fixed;top:12px;left:12px;z-index:9999;display:none;',
            'background:rgba(16,18,22,0.92);border:1px solid #3a4048;border-radius:6px;',
            'padding:10px 12px;width:330px;font:11px monospace;color:#dfe3e6;',
        ].join('');

        const titolo = document.createElement('div');
        titolo.textContent = 'STILE — F9 chiude, F8 contorni';
        titolo.style.cssText = 'font-weight:bold;margin-bottom:6px;letter-spacing:0.5px;';
        box.appendChild(titolo);

        const fps = document.createElement('div');
        fps.style.cssText = 'margin-bottom:8px;color:#8fd3f0;';
        fps.textContent = 'fps —';
        box.appendChild(fps);

        interruttore(box, 'luce a fasce e palette', true, (on) => style.setEnabled(on));
        interruttore(box, 'cielo a gradiente', true, (on) => sky.setEnabled(on));
        const boxContorni = interruttore(box, 'contorni', !!outline, (on) => { if (outline) outline.setEnabled(on); });
        if (!outline) boxContorni.disabled = true;

        riga(box, 'saturazione ombra', 0, 1, 1, 0.01, (v) => {
            // scurisce o schiarisce la tinta della fascia in ombra senza
            // cambiarne il colore
            u.uShadowTint.value.setRGB(
                0.541 * v, 0.627 * v, 0.784 * v   // 0x8aa0c8 scalato
            );
        });
        riga(box, 'chiazze prato', 0, 1, u.uPatchAmount.value, 0.01, (v) => { u.uPatchAmount.value = v; });
        riga(box, 'scala chiazze', 0.002, 0.05, u.uPatchScale.value, 0.001, (v) => { u.uPatchScale.value = v; });
        riga(box, 'ciuffi erba', 0, 1, u.uTuftAmount.value, 0.01, (v) => { u.uTuftAmount.value = v; });
        riga(box, 'nebbia', 0, 0.005, scene.fog ? scene.fog.density : 0.0016, 0.0001, (v) => {
            if (scene.fog) scene.fog.density = v;
        });
        if (outline) {
            riga(box, 'spessore contorno', 0.5, 3, outline.uniforms.uThickness.value, 0.1,
                (v) => { outline.uniforms.uThickness.value = v; });
            riga(box, 'sensibilità normali', 0.05, 1, outline.uniforms.uNormalBias.value, 0.01,
                (v) => { outline.uniforms.uNormalBias.value = v; });
            riga(box, 'sensibilità profondità', 0.001, 0.2, outline.uniforms.uDepthBias.value, 0.001,
                (v) => { outline.uniforms.uDepthBias.value = v; });
        }

        const audit = document.createElement('button');
        audit.textContent = 'elenca materiali non convertiti';
        audit.style.cssText = 'margin-top:8px;width:100%;font:11px monospace;padding:4px;cursor:pointer;';
        audit.addEventListener('click', () => {
            const rimasti = style.audit(scene);
            console.log(rimasti.length ? `[ToonStyle] non convertiti: ${rimasti.join(', ')}` :
                '[ToonStyle] tutti i materiali sono convertiti');
        });
        box.appendChild(audit);

        document.body.appendChild(box);

        // Contatore di frame: media mobile sull'ultimo secondo, così accendere
        // un effetto mostra subito quanto costa.
        let frame = 0, t0 = performance.now();
        function tick() {
            frame++;
            const ora = performance.now();
            if (ora - t0 >= 500) {
                fps.textContent = `fps ${Math.round(frame * 1000 / (ora - t0))}`;
                frame = 0; t0 = ora;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);

        function onKey(e) {
            if (e.code === 'F9') {
                e.preventDefault();
                box.style.display = box.style.display === 'none' ? 'block' : 'none';
            } else if (e.code === 'F8') {
                e.preventDefault();
                if (outline) {
                    outline.setEnabled(!outline.enabled);
                    boxContorni.checked = outline.enabled;
                }
            }
        }
        window.addEventListener('keydown', onKey);

        return {
            dispose() {
                window.removeEventListener('keydown', onKey);
                box.remove();
            },
        };
    }

    return { install };
});
```

- [ ] **Step 2: agganciare in `f1.js`**

Dopo il blocco di conversione del Task 3 (dopo lo step 6 punto 4), aggiungi:

```js
    // Pannello di taratura: F9 lo apre, F8 accende e spegne i contorni.
    // outline resta null finché toonOutline non è in gioco.
    const toonPanel = ToonPanel.install({ style: ToonStyle, sky: toonSky, outline: null, scene });
```

- [ ] **Step 3: caricare lo script in `f1.html`**

```html
    <script src="shared/toonPanel.js?v=20260810a"></script>
```

più il bump di `f1.js`.

- [ ] **Step 4: verifica**

Comando: `node --check frontend/shared/toonPanel.js && node --check frontend/f1.js`
Atteso: nessun errore.

- [ ] **Step 5: consegna e playtest**

L'utente apre il pannello con F9 e verifica: il contatore di frame si aggiorna,
spegnere "luce a fasce e palette" riporta l'aspetto di prima (utile per il
confronto A/B), spegnere "cielo a gradiente" riporta l'azzurro piatto, il
pulsante di audit stampa in console. La casella "contorni" è disabilitata: è
prevista, arriva al task successivo.

**Questa è la fine della Fase 1.** Fermarsi, far giudicare all'utente luce,
ombre e cielo dai tre punti di ripresa (griglia, curva veloce, corsia box), e
tarare con gli slider prima di passare ai contorni.

---

### Task 5: contorni neri

**Files:**
- Create: `frontend/shared/toonOutline.js`
- Modify: `frontend/f1.js` (loop di render, riga 2202; pannello, Task 4 step 2;
  esclusione della scia), `frontend/f1.html`

**Interfaces:**
- Consumes: `ToonStyle.OUTLINE_EXCLUDE_LAYER`.
- Produces:
  - `ToonOutline.init(renderer, camera)` → inizializza i buffer e abilita sulla
    camera il layer degli oggetti esclusi; da chiamare una volta.
  - `ToonOutline.render(renderer, scene, camera)` — sostituisce
    `renderer.render(scene, camera)`.
  - `ToonOutline.setEnabled(on)`, `ToonOutline.enabled` (booleano),
    `ToonOutline.setSize(renderer)`.
  - `ToonOutline.uniforms` — `uThickness`, `uNormalBias`, `uDepthBias`,
    `uFadeStart`, `uFadeEnd`.

- [ ] **Step 1: scrivere il modulo**

Crea `frontend/shared/toonOutline.js`:

```js
// frontend/shared/toonOutline.js
//
// Contorni neri su silhouette E spigoli interni, per il look cel-shaded
// (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md).
//
// Come funziona: la scena viene disegnata una seconda volta con
// MeshNormalMaterial su un buffer fuori schermo che porta con sé anche la
// profondità; un rettangolo a schermo intero confronta ogni pixel con i
// vicini e dove normale o profondità saltano disegna nero sopra il canvas.
//
// DUE SCELTE NON OVVIE:
//  1. la scena a colori resta disegnata DIRETTAMENTE sul canvas, che ha
//     l'antialias del browser: passando per un render target lo perderemmo, e
//     con campiture piatte la scalettatura si vedrebbe moltissimo. Il
//     contorno è quindi un overlay trasparente, non un filtro.
//  2. il passaggio delle normali NON deve ricalcolare le ombre: Three
//     rigenera la shadow map a ogni render() e con migliaia di istanze è la
//     parte più cara della scena. Si spegne shadowMap.autoUpdate per quel
//     passaggio (non shadowMap.enabled: cambiarlo a runtime cambia i define
//     dei materiali e ne forza la ricompilazione).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonOutline = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    let target = null, normalMat = null, quad = null, quadScene = null, quadCam = null;
    let enabled = true, ready = false;

    const uniforms = {
        uNormal: { value: null },
        uDepth: { value: null },
        uResolution: { value: null },      // THREE.Vector2, creato in init
        uThickness: { value: 1.3 },        // in pixel
        uNormalBias: { value: 0.35 },      // quanto deve girare la normale per fare bordo
        uDepthBias: { value: 0.02 },       // salto di profondità relativo
        uFadeStart: { value: 260 },        // unità: da qui il contorno inizia a sparire
        uFadeEnd: { value: 620 },          // ... e qui è sparito del tutto
        uNear: { value: 0.1 },
        uFar: { value: 1200 },
    };

    function init(renderer, camera) {
        // La profondità in una texture richiede WebGL2 oppure l'estensione
        // WEBGL_depth_texture. Senza, i contorni restano spenti e il resto del
        // look continua a funzionare (fallback previsto dalla spec).
        const caps = renderer.capabilities;
        if (!caps.isWebGL2 && !renderer.extensions.get('WEBGL_depth_texture')) {
            console.warn('[ToonOutline] profondità non disponibile: contorni disattivati');
            enabled = false;
            return;
        }

        // La camera deve vedere anche il layer degli oggetti esclusi dal
        // contorno: excludeFromOutline li SPOSTA fuori dal layer 0, e senza
        // questa riga sparirebbero del tutto dalla scena.
        camera.layers.enable(2);   // ToonStyle.OUTLINE_EXCLUDE_LAYER

        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        const w = Math.floor(size.x * pr), h = Math.floor(size.y * pr);

        const depth = new THREE.DepthTexture(w, h);
        depth.type = THREE.UnsignedIntType;   // 24 bit: a 16 la profondità lontana è troppo grossolana
        target = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            depthTexture: depth,
            depthBuffer: true,
            stencilBuffer: false,
        });

        normalMat = new THREE.MeshNormalMaterial();
        uniforms.uNormal.value = target.texture;
        uniforms.uDepth.value = depth;
        uniforms.uResolution.value = new THREE.Vector2(w, h);

        const mat = new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            vertexShader: [
                'varying vec2 vUv;',
                'void main() {',
                '    vUv = uv;',
                '    gl_Position = vec4( position.xy, 0.0, 1.0 );',
                '}',
            ].join('\n'),
            fragmentShader: [
                'uniform sampler2D uNormal;',
                'uniform sampler2D uDepth;',
                'uniform vec2 uResolution;',
                'uniform float uThickness;',
                'uniform float uNormalBias;',
                'uniform float uDepthBias;',
                'uniform float uFadeStart;',
                'uniform float uFadeEnd;',
                'uniform float uNear;',
                'uniform float uFar;',
                'varying vec2 vUv;',
                // dalla profondità del buffer (non lineare) alla distanza in
                // unità di gioco: senza linearizzare, la soglia di salto
                // varrebbe solo a pochi metri dalla camera
                'float lin( float d ) {',
                '    float z = d * 2.0 - 1.0;',
                '    return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );',
                '}',
                'void main() {',
                '    vec2 px = uThickness / uResolution;',
                '    float dC = lin( texture2D( uDepth, vUv ).x );',
                '    vec3 nC = texture2D( uNormal, vUv ).xyz * 2.0 - 1.0;',
                '    float bordoN = 0.0;',
                '    float bordoD = 0.0;',
                '    vec2 offs[4];',
                '    offs[0] = vec2( px.x, 0.0 );',
                '    offs[1] = vec2( -px.x, 0.0 );',
                '    offs[2] = vec2( 0.0, px.y );',
                '    offs[3] = vec2( 0.0, -px.y );',
                '    for ( int i = 0; i < 4; i++ ) {',
                '        vec2 uv = vUv + offs[i];',
                '        vec3 n = texture2D( uNormal, uv ).xyz * 2.0 - 1.0;',
                '        bordoN = max( bordoN, 1.0 - clamp( dot( normalize( n ), normalize( nC ) ), 0.0, 1.0 ) );',
                '        float d = lin( texture2D( uDepth, uv ).x );',
                // salto RELATIVO alla distanza: a 300 unità un dislivello di
                // mezza unità non è un bordo, a 3 unità lo è
                '        bordoD = max( bordoD, abs( d - dC ) / max( dC, 1.0 ) );',
                '    }',
                '    float e = max( smoothstep( uNormalBias, uNormalBias * 1.6, bordoN ),',
                '                   smoothstep( uDepthBias, uDepthBias * 1.8, bordoD ) );',
                // attenuazione con la distanza: da vicino tratto pieno, sul
                // fondo niente, altrimenti le tribune lontane diventano una
                // macchia nera
                '    float fade = 1.0 - smoothstep( uFadeStart, uFadeEnd, dC );',
                '    gl_FragColor = vec4( 0.0, 0.0, 0.0, e * fade );',
                '}',
            ].join('\n'),
        });

        quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        quad.frustumCulled = false;
        quadScene = new THREE.Scene();
        quadScene.add(quad);
        quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        ready = true;
    }

    function setSize(renderer) {
        if (!ready) return;
        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        const w = Math.floor(size.x * pr), h = Math.floor(size.y * pr);
        target.setSize(w, h);
        uniforms.uResolution.value.set(w, h);
    }

    function render(renderer, scene, camera) {
        if (!ready || !enabled) {
            renderer.render(scene, camera);
            return;
        }

        uniforms.uNear.value = camera.near;
        uniforms.uFar.value = camera.far;

        // 1. normali + profondità, senza luci né ombre
        const shadowAuto = renderer.shadowMap.autoUpdate;
        const layerMask = camera.layers.mask;
        const bg = scene.background;
        renderer.shadowMap.autoUpdate = false;
        camera.layers.disable(ToonStyle.OUTLINE_EXCLUDE_LAYER);
        scene.background = null;
        scene.overrideMaterial = normalMat;
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, camera);
        scene.overrideMaterial = null;
        renderer.setRenderTarget(null);
        scene.background = bg;
        camera.layers.mask = layerMask;
        renderer.shadowMap.autoUpdate = shadowAuto;

        // 2. scena a colori, direttamente sul canvas (con antialias)
        renderer.render(scene, camera);

        // 3. contorni sopra, senza cancellare quello che c'è
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(quadScene, quadCam);
        renderer.autoClear = autoClear;
    }

    return {
        init, render, setSize, uniforms,
        get enabled() { return enabled; },
        setEnabled(on) { enabled = !!on; },
    };
});
```

- [ ] **Step 2: agganciare nel loop di `f1.js`**

Dopo la creazione della camera e del renderer (riga 86, subito dopo
`document.body.appendChild(renderer.domElement);`), aggiungi:

```js
    ToonOutline.init(renderer, camera);
```

Sostituisci la riga 2202 `renderer.render(scene, camera);` con:

```js
        ToonOutline.render(renderer, scene, camera);
```

Nel gestore di ridimensionamento (righe 2207-2218), aggiungi come **ultima**
riga del callback, fuori dall'`if/else` — il buffer dei contorni va
ridimensionato in entrambi i rami:

```js
        ToonOutline.setSize(renderer);
```

- [ ] **Step 3: escludere gli effetti dal contorno**

I cubetti della scia d'aria sono un effetto, non un oggetto solido: con il
contorno diventerebbero coriandoli neri. In `buildSlipstreamEffect()`
(riga 491), subito prima di `return mesh;`:

```js
        // Effetto, non oggetto solido: niente contorno. Perde anche la
        // proiezione d'ombra, che comunque non aveva (MeshBasicMaterial,
        // castShadow mai attivato).
        ToonStyle.excludeFromOutline(mesh);
```

- [ ] **Step 4: collegare il pannello**

Nella chiamata `ToonPanel.install` del Task 4, sostituisci `outline: null` con
`outline: ToonOutline`.

- [ ] **Step 5: caricare lo script in `f1.html`**

```html
    <script src="shared/toonOutline.js?v=20260810a"></script>
```

più il bump di `f1.js`. **Nota d'ordine**: `toonOutline.js` usa `ToonStyle`, va
quindi caricato dopo `toonStyle.js` e prima di `f1.js`.

- [ ] **Step 6: verifica**

Comando: `node --check frontend/shared/toonOutline.js && node --check frontend/f1.js`
Atteso: nessun errore.

- [ ] **Step 7: consegna e playtest**

Cosa deve verificare l'utente, in quest'ordine:

1. i contorni ci sono su auto, tribune, alberi, e anche sugli spigoli fra due
   facce dello stesso oggetto;
2. **F8** li accende e spegne senza scatti;
3. il contatore di frame nel pannello: annotare il valore con contorni accesi e
   spenti nello stesso punto pista;
4. gli alberi lontani non diventano una macchia nera (se lo sono, alzare
   `uFadeStart` dallo slider... che non esiste: si tara da console con
   `ToonOutline.uniforms.uFadeStart.value = 180`);
5. la scia d'aria dietro l'auto non ha contorni.

Se le linee risultano tratteggiate o sfarfallano in lontananza, la causa è la
precisione della profondità con `camera.near = 0.1`: alzare `near` a `0.3`
migliora molto, ma va verificato che non tagli l'auto nelle inquadrature più
strette. È un ritocco da fare solo se il difetto si vede.

**Questa è la fine della Fase 2.**

---

### Task 6: palette delle superfici

**Files:**
- Modify: `frontend/shared/trackMeshBuilder.js:12` (`GRASS_COLOR`),
  `:127` (`CURB_NEUTRAL_COLOR`), `:452` (`PIT_COLOR`), `:936` (`BRIDGE_COLOR`),
  `:608` e `:628` (il default `trackColorHex`)
- Modify: `frontend/f1.js:232` e `:244` (colore dell'asfalto passato a
  `buildRibbon` e `buildPitLane`), `:411` (laghetto)
- Modify: `frontend/f1.html` (bump di `trackMeshBuilder.js` e `f1.js`)

**Interfaces:**
- Consumes: `ToonPalette.SURFACES`.
- Produces: nessuna nuova API.

- [ ] **Step 1: dichiarare la dipendenza in `trackMeshBuilder.js`**

`trackMeshBuilder.js` è caricato sia in Node (dai test) sia nel browser. In
testa al factory, aggiungi:

```js
    const Palette = (typeof module === 'object' && module.exports)
        ? require('./toonPalette.js')
        : ToonPalette;
```

- [ ] **Step 2: sostituire le costanti**

- riga 12: `const GRASS_COLOR = Palette.SURFACES.grass;`
- riga 127: `const CURB_NEUTRAL_COLOR = Palette.SURFACES.curbNeutral;`
- riga 452: `const PIT_COLOR = Palette.SURFACES.pitLane;`
- riga 936: `const BRIDGE_COLOR = Palette.SURFACES.bridge;`
- riga 628: il parametro `trackColorHex = 0x1e1e1e` diventa
  `trackColorHex = Palette.SURFACES.asphalt`; aggiorna di conseguenza il
  commento alla riga 608, che cita il vecchio valore.

- [ ] **Step 3: sostituire i colori passati da `f1.js`**

- riga 232: `new THREE.MeshStandardMaterial({ color: ToonPalette.SURFACES.asphalt, roughness: 0.95, side: THREE.DoubleSide })`
- riga 244: il settimo argomento `0x1e1e1e` diventa `ToonPalette.SURFACES.asphalt`
- riga 411: `new THREE.MeshStandardMaterial({ color: ToonPalette.SURFACES.pond, roughness: 0.35, metalness: 0.05 })`

- [ ] **Step 4: verifica**

Comando: `node --test frontend/shared/trackScenery.test.js frontend/shared/sceneryHills.test.js frontend/shared/toonPalette.test.js`
Atteso: PASS. `trackMeshBuilder.js` non ha test propri, ma è richiesto dai
test della scenografia: se il `require` di `toonPalette.js` fosse sbagliato,
questi fallirebbero al caricamento.

- [ ] **Step 5: consegna e playtest**

Cosa deve vedere l'utente: asfalto grigio-bluastro invece di nero, prato verde
smeraldo, laghetto cobalto, cordoli più chiari. È il cambiamento più forte
rispetto al gioco di prima — è previsto. Da giudicare in particolare: la
leggibilità delle linee bianche sul nuovo asfalto e il contrasto fra pista e
prato in curva.

---

### Task 7: terreno dipinto (chiazze e ciuffi)

Il patch è già scritto nel Task 3 ma i ciuffi sono a zero e le chiazze non sono
mai state tarate: qui si accendono e si sceglie il valore.

**Files:**
- Modify: `frontend/shared/toonStyle.js` (soli valori di default delle uniform)

**Interfaces:** nessuna nuova API.

- [ ] **Step 1: verificare che il terreno sia marcato**

Con il gioco avviato, in console del browser:

```js
ToonStyle.uniforms.uPatchAmount.value = 1;
```

Atteso: il prato diventa vistosamente chiazzato di due verdi. Se non cambia
nulla, la marcatura `isGround` non ha preso: verificare che `mesheTerreno` del
Task 3 non sia vuoto (`console.log(mesheTerreno.length)` — deve essere almeno
1) e che la conversione del terreno preceda quella generale.

Rimetti poi il valore a `0.55` prima di proseguire con la taratura.

- [ ] **Step 2: tarare i valori con l'utente**

Dal pannello (F9), con l'utente che guarda: `chiazze prato`, `scala chiazze`,
`ciuffi erba`. Partire da `chiazze 0.55`, `scala 0.012`, `ciuffi 0.6`.

- [ ] **Step 3: fissare i valori scelti nel modulo**

Riporta i tre valori approvati nei default di `sharedUniforms()` in
`frontend/shared/toonStyle.js`, e bumpa la versione dello script in `f1.html`.

- [ ] **Step 4: verifica**

Comando: `node --test frontend/shared/toonStyle.test.js frontend/shared/toonPalette.test.js`
Atteso: PASS.

- [ ] **Step 5: consegna**

**Fine della Fase 3.** Riferire all'utente: valori finali dei tre parametri,
FPS con e senza contorni, e l'elenco degli asset che a look completo risultano
ancora fuori tono — è l'input della Fase 4, che avrà un piano proprio.

---

## Note per chi esegue

- **Non committare.** Il commit lo fa l'utente, sempre.
- **Non avviare il server.** Chiedere all'utente di farlo e di riferire cosa
  vede: l'ambiente non ha un browser per la verifica visiva.
- **Bumpare `?v=` in `f1.html`** a ogni modifica di un `.js`, altrimenti la
  verifica dell'utente misura il file vecchio.
- Se un playtest boccia un aspetto, **non ritoccare i numeri alla cieca**:
  chiedere quale dei tre punti di ripresa e quale ingrediente, e usare gli
  interruttori del pannello per isolare la causa prima di cambiare valori.
