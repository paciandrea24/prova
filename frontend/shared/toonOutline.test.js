const test = require('node:test');
const assert = require('node:assert/strict');
const ToonOutline = require('./toonOutline.js');

// Perché questo file esiste (2026-08-17).
//
// Il contorno di silhouette accende un bordo dove il salto RELATIVO di
// profondità fra due pixel vicini supera una soglia. Su una superficie piana
// vista di taglio quel salto non è un difetto della superficie: è geometria.
// Vale
//
//     salto ≈ (angolo di un pixel) × distanza / (altezza della camera)
//
// cioè cresce con la distanza e, a parità di distanza, è INVERSAMENTE
// proporzionale a quanto sei alto da terra. Con una soglia fissa la taratura
// vale quindi per una sola altezza di camera: quella con cui è stata fatta.
//
// In F1 le due telecamere sono lo stesso oggetto (stessi near/far/fov) ma
// stanno a quote molto diverse — 5.5 unità in terza persona, 1.95 sull'halo —
// quindi il terreno produce sull'halo un salto 2.8 volte più grande. Coi
// valori tarati al playtest del 2026-08-10 (in terza persona) l'asfalto e il
// prato lontani venivano scambiati per silhouette e all'orizzonte compariva
// una banda nera piena, proprio sopra la pista davanti al pilota.
//
// La correzione: la soglia non è più fissa, ma parte dalla soglia base e vi
// somma il salto che una superficie PIANA produrrebbe in quel punto, ricavato
// dall'inclinazione della superficie rispetto al raggio di vista (la normale
// c'è già nel buffer che lo shader legge). Il criterio diventa "è una
// discontinuità vera", non "è un salto grosso", e non dipende più dall'altezza
// della camera.
//
// I test qui sotto lavorano sui numeri REALI del gioco: fov 65, finestra da
// 900 pixel, spessore 0.5, soglia base 0.071 (i valori tarati dall'utente).

const FOV = 65;
const ALTEZZA_PX = 900;
const SPESSORE = 0.5;
const SOGLIA_BASE = 0.071;
const K = ToonOutline.SLOPE_K;

const CAM_TERZA = 5.5;   // f1.js::updateCamera, ramo 'third'
const CAM_HALO = 1.95;   // f1.js::updateCamera, COCKPIT_HEIGHT

const angoloPixel = ToonOutline.pixelAngle(FOV, ALTEZZA_PX);

// Un terreno piatto a distanza `d` visto da una camera alta `h`: l'elevazione
// del raggio sopra il piano vale sin(e) = h/d, e il coseno fra normale e
// raggio è esattamente quel seno. Da lì derivano sia la pendenza apparente
// (quella che lo shader ricava dalla normale) sia il salto di profondità che
// il piano produce davvero fra due pixel adiacenti.
function terrenoPiano(h, d) {
    const ndv = h / d;
    return {
        pendenza: ToonOutline.grazingSlope(ndv),
        salto: angoloPixel * SPESSORE * (d / h),
    };
}

function soglia(pendenza, k = K) {
    return ToonOutline.depthThreshold(SOGLIA_BASE, k, pendenza, angoloPixel, SPESSORE);
}

// ── Il difetto, come si presentava ──────────────────────────────────────

test('senza compensazione il terreno piatto fa bordo sull halo-cam', () => {
    // Caratterizza il bug: con k=0 (la soglia fissa di prima) il terreno
    // dell'halo-cam supera la soglia già a 250 unità, dove la dissolvenza
    // delle silhouette (che parte a 280) non ha ancora tolto nulla. È la
    // banda nera segnalata dall'utente.
    const t = terrenoPiano(CAM_HALO, 250);
    assert.ok(t.salto > soglia(t.pendenza, 0),
        `salto ${t.salto.toFixed(4)} non supera la soglia fissa ${SOGLIA_BASE}`);
});

test('senza compensazione la terza persona invece regge', () => {
    // Stessa formula, stessa taratura, altra quota: ecco perché il difetto
    // si vedeva su una telecamera sola e la taratura sembrava corretta.
    const t = terrenoPiano(CAM_TERZA, 250);
    assert.ok(t.salto < soglia(t.pendenza, 0));
});

// ── L'invariante che la correzione deve garantire ───────────────────────

test('il terreno piatto non fa mai bordo, a nessuna quota di camera', () => {
    for (const h of [CAM_HALO, CAM_TERZA, 1.2, 3.0, 12.0]) {
        // Fino a 728 unità, dove finisce la dissolvenza delle silhouette
        // (uFadeEnd): oltre, il contorno è comunque spento.
        for (let d = 60; d <= 728; d += 4) {
            const t = terrenoPiano(h, d);
            assert.ok(t.salto < soglia(t.pendenza),
                `camera a ${h}, terreno a ${d}: salto ${t.salto.toFixed(4)} ` +
                `oltre la soglia ${soglia(t.pendenza).toFixed(4)}`);
        }
    }
});

test('il margine sul terreno piatto non è di misura', () => {
    // Non basta stare sotto: la soglia deve tenere anche con un terreno
    // leggermente ondulato (colline, terrapieno), altrimenti la banda
    // riappare a macchie. Si pretende almeno il doppio di margine.
    const t = terrenoPiano(CAM_HALO, 300);
    assert.ok(soglia(t.pendenza) > t.salto * 2,
        `margine ${(soglia(t.pendenza) / t.salto).toFixed(2)}× insufficiente`);
});

// ── Le silhouette vere devono sopravvivere ──────────────────────────────

test('la silhouette di una collina contro il cielo resta un bordo', () => {
    // È il caso che l alzare la soglia a mano (0.189, provato dall utente)
    // metteva a rischio: il cielo è alla profondità di camera.far.
    const collina = 700, cielo = 1200;
    const salto = (cielo - collina) / collina;
    // Versante lontano visto molto obliquo: il caso peggiore per noi.
    const pendenza = ToonOutline.grazingSlope(0.12);
    assert.ok(salto > soglia(pendenza) * 1.8,
        `salto ${salto.toFixed(3)} non arriva al massimo della rampa`);
});

test('la silhouette di un auto vicina resta un bordo', () => {
    const auto = 100, terrenoDietro = 130;
    const salto = (terrenoDietro - auto) / auto;
    const pendenza = ToonOutline.grazingSlope(0.8);  // fiancata verso la camera
    assert.ok(salto > soglia(pendenza) * 1.8);
});

test('la soglia base resta esattamente quella di prima sulle facce frontali', () => {
    // Su una superficie perpendicolare allo sguardo la compensazione è nulla:
    // i valori tarati dall'utente al playtest conservano il significato che
    // avevano, non vanno ritarati.
    assert.ok(Math.abs(soglia(ToonOutline.grazingSlope(1)) - SOGLIA_BASE) < 1e-9);
});

// ── Il tetto sulla pendenza ─────────────────────────────────────────────

test('il tetto sulla pendenza non rientra prima della dissolvenza', () => {
    // grazingSlope è limitata (una superficie perfettamente parallela allo
    // sguardo darebbe pendenza infinita). Il tetto va scelto in modo che il
    // terreno torni a fare bordo solo OLTRE la distanza in cui la dissolvenza
    // ha già spento le silhouette, altrimenti il difetto riappare da lontano.
    const pendenzaMax = ToonOutline.grazingSlope(0);
    const dOltre = K * pendenzaMax * CAM_HALO;   // dove salto tornerebbe = soglia
    assert.ok(dOltre > 728,
        `il terreno tornerebbe nero a ${dOltre.toFixed(0)} unità, prima di uFadeEnd`);
});

// ── L angolo di un pixel ────────────────────────────────────────────────

test('l angolo di un pixel segue fov e risoluzione', () => {
    // Raddoppiando i pixel verticali ogni pixel copre metà angolo: è il
    // motivo per cui lo stesso difetto si vede meno su uno schermo ad alta
    // densità (f1.js usa un pixelRatio fino a 2) e non va dedotto dal solo fov.
    const a = ToonOutline.pixelAngle(FOV, 900);
    const b = ToonOutline.pixelAngle(FOV, 1800);
    assert.ok(Math.abs(a / b - 2) < 1e-9);
    assert.ok(Math.abs(a - 2 * Math.tan(FOV * Math.PI / 360) / 900) < 1e-12);
});
