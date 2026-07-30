# F1 — 4b/D: schermata di personalizzazione/salvataggio livrea — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una pagina `livery.html` dove il giocatore autenticato sceglie
pattern/colori (manualmente o via generazione AI) per la propria livrea F1,
vede un'anteprima 3D dal vivo identica all'algoritmo già validato in B', e
salva tramite l'API già pronta da A (`POST /api/livery`).

**Architecture:** riuso invariato di `frontend/shared/liveryPattern.js`
(algoritmo pattern+ombreggiatura) e delle rotte/store backend già costruiti
in A. Nuovo: un loader modello leggero dedicato (non
`carLoader.js::loadCarModel`, che porta audio/ruote/mescola non pertinenti
qui) e un modulo backend `themeGenerator.js` che proxa la generazione AI
(Gemini) — chiave mai esposta al client, `patternStyle` vincolato ai 4
pattern supportati in questa fase (racing_stripes, split_sides, checkers,
solid).

**Tech Stack:** Node.js/Express (backend), JavaScript vanilla + Three.js
r128 da CDN (stesso stack del resto del frontend), `node:test` solo per la
parte di `themeGenerator.js` che non dipende da un servizio esterno vero.

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente — nessuno
  step `git commit` in questo piano (stessa convenzione dei piani precedenti).
- Riferimento: `docs/superpowers/specs/2026-07-30-f1-livery-editor-page-design.md`.
- **Solo 4 pattern supportati**: `racing_stripes`, `split_sides`, `checkers`,
  `solid`. Gli altri 14 pattern dell'editor esterno e il sistema sponsor sono
  fuori scope — non aggiungerli.
- **`GEMINI_API_KEY` letta da `process.env`, mai scritta in nessun file di
  questo piano o del codice** — il valore verrà impostato direttamente
  dall'utente/orchestratore in `backend/.env` dopo l'implementazione, fuori
  da questo piano (stessa convenzione già usata per `MONGODB_URI`/
  `FIREBASE_SERVICE_ACCOUNT_JSON`).
- **`POST /api/livery/generate-theme` protetta da `verifyFirebaseToken`**
  (stesso middleware già esistente da A) — la chiamata Gemini ha un costo
  reale, non va lasciata pubblica.
- **Non toccare**: `backend/store/liveryStore.js`, `backend/auth/verifyFirebaseToken.js`,
  `POST /api/livery`/`GET /api/livery/:uid` esistenti, `carLoader.js`,
  `f1.js`, l'algoritmo dentro `liveryPattern.js` (solo il commento di
  intestazione cambia).
- Riferimento esterno per il porting: `C:\Users\pacia\Desktop\livery\voxel_livery_studio.html`
  (NON nel repo, NON git) — righe ~498 (`mulberry32`), ~1559-1665
  (`PATTERNS`/`LOCAL_THEMES`/`localTheme`/`generateTheme`).

---

### Task 1: `backend/services/themeGenerator.js` — generazione tema (AI + fallback locale)

**Files:**
- Create: `backend/services/themeGenerator.js`
- Test: `backend/services/themeGenerator.test.js`

**Interfaces:**
- Produces: `generateTheme(prompt) -> Promise<{themeName, primaryPaint,
  secondaryPaint, accentPaint, patternStyle}>`, `localTheme(prompt) ->
  {themeName, primaryPaint, secondaryPaint, accentPaint, patternStyle}`,
  `SUPPORTED_PATTERNS -> string[]` (4 elementi). Consumati da Task 2
  (`routes/livery.js`).

- [ ] **Step 1: Scrivere i test che falliscono**

```js
// backend/services/themeGenerator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTheme, localTheme, SUPPORTED_PATTERNS } = require('./themeGenerator');

test('SUPPORTED_PATTERNS: esattamente i 4 pattern di questa fase', () => {
    assert.deepEqual([...SUPPORTED_PATTERNS].sort(),
        ['checkers', 'racing_stripes', 'solid', 'split_sides'].sort());
});

test('localTheme: stesso prompt due volte -> stesso risultato (deterministico)', () => {
    const a = localTheme('un tema qualsiasi non nella lista');
    const b = localTheme('un tema qualsiasi non nella lista');
    assert.deepEqual(a, b);
});

test('localTheme: prompt generico -> patternStyle sempre tra i 4 supportati', () => {
    const prompts = ['blu oceano', 'foresta di notte', 'xyz123', 'una macchina veloce'];
    for (const p of prompts) {
        const t = localTheme(p);
        assert.ok(SUPPORTED_PATTERNS.includes(t.patternStyle),
            `patternStyle "${t.patternStyle}" non supportato per prompt "${p}"`);
        assert.match(t.primaryPaint, /^#[0-9a-f]{6}$/i);
        assert.match(t.secondaryPaint, /^#[0-9a-f]{6}$/i);
        assert.match(t.accentPaint, /^#[0-9a-f]{6}$/i);
    }
});

test('localTheme: tema nominato con pattern originale GIA\' supportato (ferrari -> racing_stripes)', () => {
    const t = localTheme('voglio uno stile ferrari');
    assert.equal(t.themeName, 'ferrari');
    assert.equal(t.patternStyle, 'racing_stripes');
    assert.equal(t.primaryPaint, '#d40000');
});

test('localTheme: tema nominato con pattern originale NON supportato viene rimappato (cyberpunk era "diagonal")', () => {
    const t = localTheme('atmosfera cyberpunk');
    assert.equal(t.themeName, 'cyberpunk');
    assert.ok(SUPPORTED_PATTERNS.includes(t.patternStyle));
    assert.notEqual(t.patternStyle, 'diagonal');
    // Stesso colore palette originale, solo il pattern cambia
    assert.equal(t.primaryPaint, '#12043a');
});

test('generateTheme: senza GEMINI_API_KEY -> stesso risultato di localTheme (fallback immediato, nessuna chiamata di rete)', async () => {
    delete process.env.GEMINI_API_KEY;
    delete require.cache[require.resolve('./themeGenerator')];
    const mod = require('./themeGenerator');
    const viaGenerate = await mod.generateTheme('prompt di prova identico');
    const viaLocal = mod.localTheme('prompt di prova identico');
    assert.deepEqual(viaGenerate, viaLocal);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/services/themeGenerator.test.js`
Expected: FAIL — `./themeGenerator` non esiste ancora.

- [ ] **Step 3: Implementazione**

```js
// backend/services/themeGenerator.js
//
// Genera un tema livrea (nome + 3 colori + pattern) da una descrizione
// testuale. Porting di generateTheme/localTheme/LOCAL_THEMES da
// C:\Users\pacia\Desktop\livery\voxel_livery_studio.html (tool esterno,
// non nel repo) — stessa logica, con due differenze deliberate:
// 1. La chiamata a Gemini avviene qui (backend), mai dal client: nell'editor
//    esterno la chiave era in chiaro nel JS (va bene lì, quel file non è
//    online) — qui lo sarebbe, quindi la chiave resta server-side
//    (process.env.GEMINI_API_KEY), mai spedita al browser.
// 2. patternStyle è vincolato ai 4 pattern che questa fase (4b/D) supporta
//    (racing_stripes, split_sides, checkers, solid), non tutti e 18
//    dell'editor esterno — vedi
//    docs/superpowers/specs/2026-07-30-f1-livery-editor-page-design.md.
const SUPPORTED_PATTERNS = ['racing_stripes', 'split_sides', 'checkers', 'solid'];

// Stessa PRNG deterministica dell'editor esterno (riga ~498 del file
// sorgente) — usata solo dal fallback locale, non dalla chiamata Gemini.
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Stessa conversione HSL->RGB già in frontend/shared/liveryPattern.js —
// duplicata qui (non condivisibile: quel file gira nel browser e usa
// THREE.Color per la stessa conversione, questo è un modulo Node puro
// senza dipendenze DOM/THREE).
function hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h / 360;
    function hue2rgb(t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }
    return [hue2rgb(hk + 1 / 3), hue2rgb(hk), hue2rgb(hk - 1 / 3)];
}

function toHex(rgb01) {
    const toByte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + toByte(rgb01[0]) + toByte(rgb01[1]) + toByte(rgb01[2]);
}

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

// Se il pattern originale dell'editor esterno non è tra i 4 supportati qui,
// lo rimappiamo deterministicamente (stessa chiave -> stesso pattern
// sempre) invece di scartare l'intero tema — la palette colori resta
// quella originale, cambia solo il pattern.
function remapPattern(pattern, seedKey) {
    if (SUPPORTED_PATTERNS.includes(pattern)) return pattern;
    const idx = hashString(seedKey) % SUPPORTED_PATTERNS.length;
    return SUPPORTED_PATTERNS[idx];
}

// Stessi 15 temi nominati e stesse palette dell'editor esterno (righe
// ~1560-1575 del file sorgente) — pattern rimappato dove necessario.
const LOCAL_THEMES_RAW = {
    ferrari: ['#d40000', '#ffffff', '#101010', 'racing_stripes'],
    rossa: ['#d40000', '#ffe600', '#101010', 'split_sides'],
    cyberpunk: ['#12043a', '#00e5ff', '#ff007a', 'diagonal'],
    neon: ['#0a0a12', '#39ff14', '#ff2fd1', 'diagonal'],
    retro: ['#f4e3c1', '#c1452f', '#2f4858', 'halves'],
    arcade: ['#1b1035', '#ff4f9a', '#41ead4', 'abstract'],
    marina: ['#0b2545', '#8ecae6', '#ffb703', 'gradient'],
    foresta: ['#1b3a2b', '#a7c957', '#f2e8cf', 'split_sides'],
    deserto: ['#c2793f', '#f2e3c4', '#3b2a20', 'gradient'],
    ghiaccio: ['#dff3ff', '#4aa3df', '#0f2438', 'top_deck'],
    fuoco: ['#1a0a05', '#ff7b00', '#ffd000', 'gradient'],
    oro: ['#101010', '#d4af37', '#ffffff', 'racing_stripes'],
    militare: ['#4b5320', '#8a9a5b', '#2b2b23', 'abstract'],
    monocromo: ['#f5f5f5', '#1a1a1a', '#8a8a8a', 'split_sides'],
    viola: ['#3a0ca3', '#f72585', '#4cc9f0', 'diagonal']
};

const LOCAL_THEMES = {};
for (const [key, [primary, secondary, accent, pattern]] of Object.entries(LOCAL_THEMES_RAW)) {
    LOCAL_THEMES[key] = [primary, secondary, accent, remapPattern(pattern, key)];
}

// Fallback locale deterministico: stesso identico algoritmo dell'editor
// esterno (tema nominato se il prompt lo contiene, altrimenti palette
// pseudo-casuale derivata da un hash del prompt) — patternStyle SEMPRE uno
// dei 4 supportati (i temi nominati sono già rimappati sopra, la scelta
// pseudo-casuale pesca solo da SUPPORTED_PATTERNS).
function localTheme(prompt) {
    const p = prompt.toLowerCase();
    for (const k in LOCAL_THEMES) {
        if (p.includes(k)) {
            const [primaryPaint, secondaryPaint, accentPaint, patternStyle] = LOCAL_THEMES[k];
            return { themeName: k, primaryPaint, secondaryPaint, accentPaint, patternStyle };
        }
    }
    const h = hashString(p);
    const rnd = mulberry32(h);
    const hue = rnd();
    const c1 = hslToRgb(hue * 360, 0.75, 0.42);
    const c2 = hslToRgb(((hue + 0.42 + rnd() * 0.15) % 1) * 360, 0.7, 0.62);
    const c3 = hslToRgb(((hue + 0.5) % 1) * 360, 0.5, 0.12);
    const patternStyle = SUPPORTED_PATTERNS[Math.floor(rnd() * SUPPORTED_PATTERNS.length)];
    return {
        themeName: prompt.trim() || 'Custom',
        primaryPaint: toHex(c1),
        secondaryPaint: toHex(c2),
        accentPaint: toHex(c3),
        patternStyle
    };
}

// Chiamata Gemini (proxata dal backend). Se manca GEMINI_API_KEY, se la
// rete fallisce, se la risposta non è JSON valido, o se patternStyle non è
// tra i 4 supportati, si cade SEMPRE sul fallback locale sopra — mai un
// errore bloccante per l'utente (stesso comportamento dell'editor esterno).
async function generateTheme(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return localTheme(prompt);

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                systemInstruction: {
                    parts: [{
                        text: 'Sei un designer di livree per auto da corsa in voxel art. ' +
                            'Restituisci una palette di 3 colori ad alto contrasto tra loro e un pattern. ' +
                            'primaryPaint e il colore dominante della carrozzeria, secondaryPaint il colore ' +
                            'della grafica principale, accentPaint un terzo colore usato per filetti sottili.'
                    }]
                },
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            themeName: { type: 'STRING' },
                            primaryPaint: { type: 'STRING' },
                            secondaryPaint: { type: 'STRING' },
                            accentPaint: { type: 'STRING' },
                            patternStyle: { type: 'STRING', enum: SUPPORTED_PATTERNS }
                        },
                        required: ['themeName', 'primaryPaint', 'secondaryPaint', 'accentPaint', 'patternStyle']
                    }
                }
            })
        });
        const json = await res.json();
        const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!txt) throw new Error('risposta vuota');
        const d = JSON.parse(txt);
        const fixColor = (c) => {
            let s = String(c || '').trim();
            if (!s.startsWith('#')) s = '#' + s;
            return /^#[0-9a-f]{6}$/i.test(s) ? s : '#888888';
        };
        if (!SUPPORTED_PATTERNS.includes(d.patternStyle)) {
            throw new Error('pattern non supportato: ' + d.patternStyle);
        }
        return {
            themeName: d.themeName || 'Custom',
            primaryPaint: fixColor(d.primaryPaint),
            secondaryPaint: fixColor(d.secondaryPaint),
            accentPaint: fixColor(d.accentPaint),
            patternStyle: d.patternStyle
        };
    } catch (error) {
        console.warn('⚠️ Gemini non disponibile, uso il tema locale:', error.message);
        return localTheme(prompt);
    }
}

module.exports = { generateTheme, localTheme, SUPPORTED_PATTERNS };
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test backend/services/themeGenerator.test.js`
Expected: PASS su tutti i test.

---

### Task 2: `POST /api/livery/generate-theme` — rotta protetta

**Files:**
- Modify: `backend/routes/livery.js`

**Interfaces:**
- Consumes: `generateTheme` (Task 1), `verifyFirebaseToken` (già esistente,
  importato in questo file da A).
- Produces: `POST /api/livery/generate-theme` → `200 {themeName,
  primaryPaint, secondaryPaint, accentPaint, patternStyle}`. Consumata dal
  frontend in Task 5.

- [ ] **Step 1: Aggiungere l'import e la rotta**

In cima a `backend/routes/livery.js`, vicino agli altri require:

```js
const { generateTheme } = require('../services/themeGenerator');
```

Aggiungere, dopo la rotta `POST /api/livery` esistente:

```js
// POST /api/livery/generate-theme — protetta: la chiamata a Gemini ha un
// costo reale, non va lasciata pubblica (stesso motivo per cui il
// salvataggio richiede token, qui è per evitare abuso/costo, non
// impersonificazione).
router.post('/api/livery/generate-theme', verifyFirebaseToken, async (req, res) => {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'prompt mancante o non valido' });
    }
    try {
        const theme = await generateTheme(prompt.trim());
        res.status(200).json(theme);
    } catch (error) {
        console.error('❌ Errore generazione tema:', error.message);
        res.status(500).json({ error: 'Errore generazione tema' });
    }
});
```

- [ ] **Step 2: Verifica sintattica**

Run: `node --check backend/routes/livery.js`
Expected: nessun errore.

- [ ] **Step 3: Verifica manuale (richiede token reale — vedi Task 4 del
  piano precedente `2026-07-29-f1-livery-mongo-persistence.md` per come
  ottenerne uno)**

```bash
curl -i -X POST http://localhost:3000/api/livery/generate-theme \
  -H "Authorization: Bearer <idToken>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"stile ferrari"}'
```

Expected: `200 OK`, corpo JSON con `themeName`/`primaryPaint`/
`secondaryPaint`/`accentPaint`/`patternStyle` (uno dei 4 supportati). Senza
`GEMINI_API_KEY` impostata, il risultato coincide con `localTheme('stile
ferrari')` (tema `ferrari`, pattern `racing_stripes`).

Verifica anche senza token:
```bash
curl -i -X POST http://localhost:3000/api/livery/generate-theme -H "Content-Type: application/json" -d '{"prompt":"test"}'
```
Expected: `401 {"error":"Token mancante"}`.

Nota per chi esegue questo piano: nessun test automatico oltre Task 1 per
questa rotta (dipende dal middleware auth reale + eventualmente Gemini
reale) — stessa scelta già fatta per `POST /api/livery`/`GET /api/livery/:uid`
in A.

---

### Task 3: `livery.html`/`livery.css` — shell pagina, gate login, scena 3D, loader modello

**Files:**
- Create: `frontend/livery.html`
- Create: `frontend/livery.js`
- Create: `frontend/styles/livery.css`

**Interfaces:**
- Consumes: `firebaseAuth` (da `shared/firebaseConfig.js`, già esistente),
  `THREE`/`GLTFLoader`/`OrbitControls` (CDN r128).
- Produces: variabili di modulo in `livery.js` — `carGroup` (il gruppo
  Three.js dell'auto caricata, con `pristineTex` salvato per mesh),
  `scene`/`camera`/`renderer`/`controls`. Consumate da Task 4 (controlli
  pattern/colori) e Task 5 (AI).

- [ ] **Step 1: Creare `frontend/styles/livery.css`**

```css
/* frontend/styles/livery.css */
html, body { margin: 0; height: 100%; overflow: hidden; font-family: sans-serif; background: #14141a; }
#livery-canvas-wrap { position: fixed; inset: 0; }
#livery-panel {
    position: fixed; top: 10px; right: 10px; bottom: 10px; z-index: 10;
    background: rgba(20,20,28,0.92); color: #ecf0f1; padding: 16px 18px;
    border-radius: 10px; width: 280px; font-size: 14px;
    box-sizing: border-box; overflow-y: auto;
}
#livery-panel h1 { font-size: 16px; margin: 0 0 12px; }
#livery-panel h2 { font-size: 13px; margin: 16px 0 8px; color: #95a5a6; text-transform: uppercase; }
#livery-panel .pattern-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#livery-panel .pattern-btn {
    padding: 8px; border-radius: 6px; border: 2px solid transparent;
    background: #2a2a35; color: #ecf0f1; cursor: pointer; font-size: 12px;
}
#livery-panel .pattern-btn.active { border-color: #3fa9f5; background: #34475a; }
#livery-panel .color-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
#livery-panel .color-row input[type="color"] { width: 42px; height: 32px; border: none; padding: 0; background: none; cursor: pointer; }
#livery-panel input[type="text"] { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid #3a3a45; background: #1c1c24; color: #ecf0f1; margin-top: 6px; }
#livery-panel button.btn-wide { width: 100%; margin-top: 10px; padding: 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; }
#livery-panel .btn-generate { background: #6c3fc9; color: #fff; }
#livery-panel .btn-save { background: #2ecc71; color: #101010; font-weight: 600; }
#livery-panel .btn-back { background: #3a3a45; color: #ecf0f1; }
```

- [ ] **Step 2: Creare `frontend/livery.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Project-W — Livery</title>
    <link rel="stylesheet" href="styles/index.css">
    <link rel="stylesheet" href="styles/livery.css">
</head>
<body>
    <div id="livery-canvas-wrap"></div>

    <div id="livery-panel">
        <h1>Livery Editor</h1>

        <h2>Pattern</h2>
        <div class="pattern-grid" id="pattern-grid">
            <button type="button" class="pattern-btn" data-pattern="racing_stripes">Racing Stripes</button>
            <button type="button" class="pattern-btn" data-pattern="split_sides">Split Sides</button>
            <button type="button" class="pattern-btn" data-pattern="checkers">Checkers</button>
            <button type="button" class="pattern-btn" data-pattern="solid">Solid</button>
        </div>

        <h2>Colors</h2>
        <div class="color-row"><label>Primary</label><input type="color" id="col-primary" value="#d40000"></div>
        <div class="color-row"><label>Secondary</label><input type="color" id="col-secondary" value="#ffffff"></div>
        <div class="color-row"><label>Accent</label><input type="color" id="col-accent" value="#101010"></div>

        <h2>AI Theme</h2>
        <input type="text" id="ai-prompt" placeholder="e.g. cyberpunk neon">
        <button type="button" class="btn-wide btn-generate" id="btn-generate">Generate</button>

        <button type="button" class="btn-wide btn-save" id="btn-save">Save</button>
        <button type="button" class="btn-wide btn-back" onclick="window.location.href='lobby.html'">Back</button>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    <script src="shared/liveryPattern.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js" defer></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js" defer></script>
    <script src="shared/firebaseConfig.js" defer></script>
    <script src="livery.js" defer></script>
</body>
</html>
```

Nota: `index.css` porta con sé lo stile dei toast (`.toast-container`/
`.toast`) già usato da `login.js` — riusato identico in Task 4/5, nessun CSS
nuovo per i toast.

- [ ] **Step 3: Creare `frontend/livery.js` — gate login, scena, loader modello**

```js
// frontend/livery.js
let scene, camera, renderer, controls;
let carGroup = null;

function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14141a);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(10, 20, 10);
    scene.add(sun);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 5, 8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('livery-canvas-wrap').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = true;

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    })();
}

// Loader dedicato e leggero — a differenza di carLoader.js::loadCarModel
// NON gestisce audio motore posizionale, rotazione ruote o colore mescola
// gomme (tutta roba di gara non pertinente a una pagina di sola
// personalizzazione). Fa solo ciò che liveryPattern.js richiede: centrare
// il modello e salvare pristineTex per ogni mesh con texture.
function loadCarForPreview(onReady) {
    const loader = new THREE.GLTFLoader();
    loader.load('/assets/custom/f1Car.glb', (gltf) => {
        const group = new THREE.Group();
        const model = gltf.scene;
        model.scale.set(3.5, 3.5, 3.5);

        model.updateMatrixWorld(true);
        const bbox0 = new THREE.Box3().setFromObject(model);
        const center0 = bbox0.getCenter(new THREE.Vector3());
        model.position.x -= center0.x;
        model.position.z -= center0.z;
        model.position.y -= bbox0.min.y;

        model.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
            child.material = child.material.clone();
            if (child.material.map) {
                child.userData.pristineTex = child.material.map;
            }
        });

        group.add(model);
        scene.add(group);
        onReady(group);
    }, undefined, (err) => console.error('Errore caricamento modello livery:', err));
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
        showToast('Firebase is not configured yet.', 'error');
        return;
    }
    firebaseAuth.onAuthStateChanged((user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        initScene();
        loadCarForPreview((group) => {
            carGroup = group;
        });
    });
});
```

- [ ] **Step 4: Verifica manuale in browser**

Con il server avviato (`node server.js` da `backend/`) e loggato via
`login.html`: aprire `http://localhost:3000/livery.html`. Expected: l'auto
appare al centro della scena (colori originali della texture, nessun
pattern ancora applicato), orbitabile col mouse (drag per ruotare, rotellina
per zoom). Aprire la pagina SENZA essere loggati (dopo logout): expected
redirect immediato a `login.html`.

---

### Task 4: Controlli manuali (pattern/colori), pre-caricamento e salvataggio

**Files:**
- Modify: `frontend/livery.js`
- Modify: `frontend/shared/liveryPattern.js:1-11` (solo il commento di
  intestazione)

**Interfaces:**
- Consumes: `carGroup` (Task 3), `LiveryPattern.applyVoxelLiveryPattern`
  (esistente, invariato), `POST /api/livery`/`GET /api/livery/:uid`
  (esistenti da A).
- Produces: `applyCurrentLivery()` (funzione condivisa che ricalcola
  l'anteprima dai controlli correnti) — consumata anche da Task 5 (AI).

- [ ] **Step 1: Aggiornare il commento di intestazione di `liveryPattern.js`**

Sostituire le righe 1-11 (che oggi dicono "NON PIÙ RICHIAMATO DAL GIOCO")
con:

```js
// frontend/shared/liveryPattern.js
//
// Algoritmo pattern+ombreggiatura per la livrea F1, validato con dati reali
// nello spike di B' (vedi [[project_f1_livery_ingame_port]]) e ora
// richiamato attivamente da frontend/livery.js (4b/D) — non più solo
// riferimento storico. Il gioco in gara (carLoader.js) continua a NON
// richiamarlo: carica colori-per-voxel già calcolati e salvati da questa
// pagina (vedi docs/superpowers/specs/2026-07-29-f1-livery-precomputed-colors-design.md),
// nessun ricalcolo dal vivo in pista.
```

(il resto del file, dalla riga 12 in poi, resta invariato)

- [ ] **Step 2: Aggiungere stato controlli + `applyCurrentLivery` + pre-caricamento in `livery.js`**

Aggiungere in cima al file, vicino alle altre variabili di modulo:

```js
let currentParams = { pattern: 'racing_stripes', primary: '#d40000', secondary: '#ffffff', accent: '#101010' };

function hexStringToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

// Ricalcola l'anteprima dai valori CORRENTI di currentParams — stessa
// funzione richiamata sia dai controlli manuali (Step 3) sia dal risultato
// della generazione AI (Task 5), nessuna logica duplicata.
function applyCurrentLivery() {
    if (!carGroup) return;
    LiveryPattern.applyVoxelLiveryPattern(carGroup, {
        pattern: currentParams.pattern,
        primary: hexStringToInt(currentParams.primary),
        secondary: hexStringToInt(currentParams.secondary),
        accent: hexStringToInt(currentParams.accent)
    });
}

function setActivePatternButton() {
    document.querySelectorAll('.pattern-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.pattern === currentParams.pattern);
    });
}

function applyThemeToControls(theme) {
    currentParams.pattern = theme.patternStyle;
    currentParams.primary = theme.primaryPaint;
    currentParams.secondary = theme.secondaryPaint;
    currentParams.accent = theme.accentPaint;
    document.getElementById('col-primary').value = theme.primaryPaint;
    document.getElementById('col-secondary').value = theme.secondaryPaint;
    document.getElementById('col-accent').value = theme.accentPaint;
    setActivePatternButton();
    applyCurrentLivery();
}
```

- [ ] **Step 3: Wiring controlli manuali + pre-caricamento livrea esistente + Save**

Sostituire il blocco `firebaseAuth.onAuthStateChanged` dentro
`DOMContentLoaded` (creato in Task 3 Step 3) con questa versione estesa:

```js
document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
        showToast('Firebase is not configured yet.', 'error');
        return;
    }
    firebaseAuth.onAuthStateChanged((user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        initScene();
        loadCarForPreview((group) => {
            carGroup = group;
            // Pre-carica una livrea già salvata, se esiste — 404 (prima
            // volta) è normale, si resta sui default di currentParams.
            fetch('/api/livery/' + user.uid)
                .then((res) => (res.ok ? res.json() : null))
                .then((doc) => {
                    if (doc && doc.liveryParams) {
                        currentParams.pattern = doc.liveryParams.pattern || currentParams.pattern;
                        currentParams.primary = doc.liveryParams.primary || currentParams.primary;
                        currentParams.secondary = doc.liveryParams.secondary || currentParams.secondary;
                        currentParams.accent = doc.liveryParams.accent || currentParams.accent;
                        document.getElementById('col-primary').value = currentParams.primary;
                        document.getElementById('col-secondary').value = currentParams.secondary;
                        document.getElementById('col-accent').value = currentParams.accent;
                    }
                    setActivePatternButton();
                    applyCurrentLivery();
                })
                .catch(() => { setActivePatternButton(); applyCurrentLivery(); });
        });

        document.querySelectorAll('.pattern-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                currentParams.pattern = btn.dataset.pattern;
                setActivePatternButton();
                applyCurrentLivery();
            });
        });
        document.getElementById('col-primary').addEventListener('input', (e) => {
            currentParams.primary = e.target.value; applyCurrentLivery();
        });
        document.getElementById('col-secondary').addEventListener('input', (e) => {
            currentParams.secondary = e.target.value; applyCurrentLivery();
        });
        document.getElementById('col-accent').addEventListener('input', (e) => {
            currentParams.accent = e.target.value; applyCurrentLivery();
        });

        document.getElementById('btn-save').addEventListener('click', async () => {
            if (!carGroup) return;
            const liveryColors = {};
            carGroup.traverse((child) => {
                if (child.isMesh && child.geometry.attributes.color) {
                    liveryColors[child.name] = Array.from(child.geometry.attributes.color.array);
                }
            });
            if (!Object.keys(liveryColors).length) {
                showToast('Nothing to save yet.', 'error');
                return;
            }
            try {
                const idToken = await user.getIdToken();
                const res = await fetch('/api/livery', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ liveryColors, liveryParams: currentParams })
                });
                if (!res.ok) throw new Error('save failed: ' + res.status);
                showToast('Livery saved!', 'success');
            } catch (err) {
                console.error('[livery] save error', err);
                showToast('Could not save livery. Try again.', 'error');
            }
        });
    });
});
```

- [ ] **Step 4: Verifica manuale in browser**

1. Aprire `livery.html` da loggato: cambiare pattern (i 4 pulsanti) e i 3
   color picker — l'anteprima 3D deve aggiornarsi dal vivo ad ogni
   modifica, stesso identico aspetto già validato per B' sui 3 pattern
   condivisi.
2. Cliccare "Save" — expected toast "Livery saved!", nessun errore in
   console.
3. Ricaricare la pagina (F5) — expected: pattern/colori tornano esattamente
   quelli salvati (pre-caricati da `GET /api/livery/:uid`), non i default.
4. Verifica di confine: `git diff --stat backend/store/liveryStore.js
   backend/auth/verifyFirebaseToken.js frontend/shared/carLoader.js
   frontend/f1.js` → nessun output (questi file non vanno toccati da questo
   task).

---

### Task 5: Generazione AI — wiring frontend

**Files:**
- Modify: `frontend/livery.js`

**Interfaces:**
- Consumes: `POST /api/livery/generate-theme` (Task 2), `applyThemeToControls`
  (Task 4).

- [ ] **Step 1: Wiring del pulsante "Generate"**

Aggiungere, dentro `firebaseAuth.onAuthStateChanged` (subito dopo il
wiring del pulsante "Save" fatto in Task 4):

```js
        document.getElementById('btn-generate').addEventListener('click', async () => {
            const prompt = document.getElementById('ai-prompt').value.trim();
            if (!prompt) {
                showToast('Write a theme description first.', 'error');
                return;
            }
            const btn = document.getElementById('btn-generate');
            btn.disabled = true;
            try {
                const idToken = await user.getIdToken();
                const res = await fetch('/api/livery/generate-theme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ prompt })
                });
                if (!res.ok) throw new Error('generate failed: ' + res.status);
                const theme = await res.json();
                applyThemeToControls(theme);
                showToast(`Theme "${theme.themeName}" applied.`, 'success');
            } catch (err) {
                console.error('[livery] generate-theme error', err);
                showToast('Could not generate a theme. Try again.', 'error');
            } finally {
                btn.disabled = false;
            }
        });
        document.getElementById('ai-prompt').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-generate').click();
        });
```

- [ ] **Step 2: Verifica manuale in browser**

1. Da loggato su `livery.html`, scrivere "stile ferrari" nel campo e
   cliccare "Generate" (o Invio). Expected: toast `Theme "ferrari" applied.`,
   pattern selezionato = Racing Stripes, color picker primario rosso
   (`#d40000`), anteprima aggiornata.
2. Provare un prompt libero non in nessun tema nominato (es. "oceano
   profondo"). Expected: comunque un pattern tra i 4 supportati applicato,
   nessun errore — che `GEMINI_API_KEY` sia impostata o meno (con la chiave
   assente, il backend usa il fallback locale, comunque una risposta valida
   `200`).
3. Cliccare "Save" dopo una generazione AI, ricaricare la pagina — expected:
   il tema generato ricompare identico (stesso giro di verifica del Task 4
   Step 4.3, stavolta partendo da un tema AI invece che da scelte manuali).

---

### Task 6: Pulsante nella lobby per raggiungere `livery.html`

**Files:**
- Modify: `frontend/lobby.html:54-60`
- Modify: `frontend/lobby.js`

**Interfaces:**
- Nessuna nuova interfaccia esposta — solo navigazione.

- [ ] **Step 1: Aggiungere il pulsante nel game-card "Racing"**

In `frontend/lobby.html`, il blocco attuale (righe 54-60):

```html
            <div class="game-card" data-game-id="racing" style="position:relative;">
                <i data-lucide="flag" class="g-icon"></i>
                <span class="g-title">Racing</span>
                <button id="leaderboard-mini-btn" class="btn-lb" title="Hall of Fame">
                    <i data-lucide="trophy"></i>
                </button>
            </div>
```

va sostituito con (aggiunta di un secondo pulsante, stessa classe `btn-lb`
per coerenza visiva, posizionato accanto al trofeo):

```html
            <div class="game-card" data-game-id="racing" style="position:relative;">
                <i data-lucide="flag" class="g-icon"></i>
                <span class="g-title">Racing</span>
                <button id="livery-mini-btn" class="btn-lb" title="Customize Livery" style="right:38px;">
                    <i data-lucide="palette"></i>
                </button>
                <button id="leaderboard-mini-btn" class="btn-lb" title="Hall of Fame">
                    <i data-lucide="trophy"></i>
                </button>
            </div>
```

- [ ] **Step 2: Wiring click in `lobby.js`**

Nel blocco esistente (vicino a riga 248, dove
`if (e.target.closest('#leaderboard-mini-btn')) return;` impedisce che il
click sul trofeo selezioni anche il gioco), aggiungere la stessa esclusione
per il nuovo pulsante, e il suo handler:

```js
                if (e.target.closest('#livery-mini-btn')) return;
```

subito dopo la riga esistente
`if (e.target.closest('#leaderboard-mini-btn')) return;` (stesso blocco,
stessa logica: click sul pulsante livery non deve selezionare/avviare il
gioco Racing).

Vicino al blocco leaderboard esistente (riga ~473, `if (e.target &&
e.target.closest('#leaderboard-mini-btn'))`), aggiungere:

```js
document.addEventListener('click', (e) => {
    if (e.target && e.target.closest('#livery-mini-btn')) {
        window.location.href = 'livery.html';
    }
});
```

- [ ] **Step 3: Verifica manuale in browser**

Aprire la lobby, cliccare l'icona palette sul game-card "Racing" —
expected: naviga a `livery.html` (con lo stesso gate login del Task 3 se
non loggati), il click NON deve selezionare/avviare il gioco Racing nella
lobby.

---

## Esito atteso di questo piano

Un utente autenticato può aprire `livery.html` dalla lobby, scegliere
pattern/colori manualmente o generarli via AI (proxata dal backend, chiave
mai esposta al client), vedere l'anteprima 3D dal vivo (stesso algoritmo
già validato in B'), e salvare — persistito su MongoDB tramite le rotte già
pronte da A, ricaricabile identico al prossimo accesso. Gli altri 14
pattern dell'editor esterno, il sistema sponsor, e il sotto-progetto C
(rete multiplayer) restano fuori scope, come da spec.
