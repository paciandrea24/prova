// backend/tools/f1-crea-pista-loop.js
//
// Genera la pista di prova della fase 2a: un anello con UN giro della morte in
// fondo a un rettilineo lungo.
//
// Serve a rispondere a una domanda sola — «il loop si percorre, e come si
// sente?» — senza che altre curve la confondano. Stessa filosofia di
// f1-crea-pista-banking.js.
//
// ⚠️ IL RETTILINEO DI LANCIO NON E' DECORATIVO. Salire di due raggi costa
// v² = 4·G·R, e con la gravita' del tubo (0.2) un loop di raggio 25 si imbocca
// a 4.47 u/tick, cioe' il 72% della velocita' massima. Partendo dalla curva
// precedente servono circa v²/(2·ACCEL) = 54 unita' per riprenderla: qui ce ne
// sono 460 (250 dal traguardo al loop), perche un banco di prova deve poter
// essere sbagliato dal giocatore, non dalla pista.
//
// ⚠️ I DUE NODI DEL TRATTO ACROBATICO SONO AFFIANCATI, non allineati: si entra
// nel loop e si esce sulla corsia di fianco (disegno dell'utente, 2026-08-26).
// Senza quello spostamento il nastro in discesa attraverserebbe quello in
// salita. E i tratti PRIMA e DOPO devono essere rette: sono loro a imporre ai
// due nodi la direzione di marcia (`raddrizza`), che e' quella che il tubo
// eredita.
//
// Uso:  node backend/tools/f1-crea-pista-loop.js [raggio]
const fs = require('fs');
const path = require('path');
const TS = require('../../frontend/shared/trackSegmenti.js');
const TG = require('../../frontend/shared/trackGeometry.js');
const TA = require('../../frontend/shared/trackAcrobatico.js');
const { G_ACROBATICO } = require('../sockets/games/physics/GravitaNastro.js');

const RAGGIO = parseFloat(process.argv[2] || String(TS.RAGGIO_ACROBATICO_DEFAULT));
const MEZZA = 12;
// Lo spostamento laterale del tubo: una larghezza di pista piu' margine, o il
// nastro in discesa toccherebbe quello in salita.
const FIANCO = 30;
const PASSO_NODI = 40;

// L'anello: un rettangolo con gli angoli arrotondati, percorso in senso
// ANTIORARIO guardando dall'alto. Il rettilineo est e' quello di lancio: si
// risale verso +z, e a meta' c'e' il giro della morte.
// ⚠️ IL GIRO COMINCIA A META' DEL RETTILINEO DI LANCIO, non in fondo: il
// traguardo (e quindi la griglia, che sta dietro di lui) deve cadere su un
// tratto DRITTO. Alla prima stesura partiva subito dopo la curva sud-est e lo
// schieramento finiva in curva: le auto dichiaravano un indice di pista a 33
// campioni da dove stavano davvero, ed e' un difetto vecchio del progetto
// (griglia storta su curva), non del giro della morte.
const LANCIO_META = -250, LOOP_A = 0, DOPO_A = 300;
const OVEST = -260, SUD = -560, NORD = 360, RAGGIO_ANGOLO = 100;

function arco(cx, cz, r, da, a, punti) {
    const out = [];
    for (let k = 0; k <= punti; k++) {
        const ang = da + (a - da) * (k / punti);
        out.push({ x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r });
    }
    return out;
}

// I nodi, in ordine di percorrenza. Ogni voce dice anche di che tipo e' il
// tratto che PARTE da lei.
function costruisci() {
    const nodi = [], tipi = [];
    const spingi = (x, z, tipo) => { nodi.push({ x, z, y: 0, dir: 0 }); tipi.push(tipo); };

    // Rettilineo di lancio, dal traguardo fino all'ingresso del loop (x = 0).
    for (let z = LANCIO_META; z < LOOP_A; z += PASSO_NODI) spingi(0, z, 'retta');
    // I due nodi del giro della morte: affiancati, stessa z.
    spingi(0, LOOP_A, 'acrobatico');
    spingi(FIANCO, LOOP_A, 'retta');
    // Rettilineo dopo il loop, sulla corsia spostata di FIANCO.
    for (let z = LOOP_A + PASSO_NODI; z <= DOPO_A; z += PASSO_NODI) spingi(FIANCO, z, 'retta');
    // Angolo nord-est, rettilineo nord verso ovest, angolo nord-ovest.
    for (const p of arco(FIANCO - RAGGIO_ANGOLO, NORD - RAGGIO_ANGOLO, RAGGIO_ANGOLO, 0, Math.PI / 2, 5)) spingi(p.x, p.z, 'curva');
    for (let x = FIANCO - RAGGIO_ANGOLO - PASSO_NODI; x > OVEST + RAGGIO_ANGOLO; x -= PASSO_NODI) spingi(x, NORD, 'retta');
    for (const p of arco(OVEST + RAGGIO_ANGOLO, NORD - RAGGIO_ANGOLO, RAGGIO_ANGOLO, Math.PI / 2, Math.PI, 5)) spingi(p.x, p.z, 'curva');
    // Rettilineo ovest verso sud.
    for (let z = NORD - RAGGIO_ANGOLO - PASSO_NODI; z > SUD + RAGGIO_ANGOLO; z -= PASSO_NODI) spingi(OVEST, z, 'retta');
    // Angolo sud-ovest, rettilineo sud, angolo sud-est che riporta al lancio.
    for (const p of arco(OVEST + RAGGIO_ANGOLO, SUD + RAGGIO_ANGOLO, RAGGIO_ANGOLO, Math.PI, 1.5 * Math.PI, 5)) spingi(p.x, p.z, 'curva');
    for (let x = OVEST + RAGGIO_ANGOLO + PASSO_NODI; x < -RAGGIO_ANGOLO; x += PASSO_NODI) spingi(x, SUD, 'retta');
    for (const p of arco(-RAGGIO_ANGOLO, SUD + RAGGIO_ANGOLO, RAGGIO_ANGOLO, 1.5 * Math.PI, 2 * Math.PI, 5)) spingi(p.x, p.z, 'curva');
    // ...e la prima meta' del rettilineo di lancio, che riporta al traguardo.
    for (let z = SUD + RAGGIO_ANGOLO + PASSO_NODI; z < LANCIO_META; z += PASSO_NODI) spingi(0, z, 'retta');

    // Punti doppi (gli archi condividono gli estremi coi rettilinei): tolti,
    // altrimenti `riallinea` trova due nodi nello stesso posto e la direzione
    // fra loro e' indefinita.
    const puliti = [], tipiPuliti = [];
    for (let i = 0; i < nodi.length; i++) {
        const prec = puliti[puliti.length - 1];
        if (prec && Math.hypot(nodi[i].x - prec.x, nodi[i].z - prec.z) < 1) continue;
        puliti.push(nodi[i]); tipiPuliti.push(tipi[i]);
    }
    return { nodi: puliti, tratti: tipiPuliti.map(t => (t === 'acrobatico' ? { tipo: 'acrobatico', raggio: RAGGIO } : { tipo: t })) };
}

function main() {
    const { nodi, tratti } = costruisci();
    const g = TS.riallinea({ versione: 1, nodi, tratti });
    const controlPoints = TS.cuoci(g, TS.PASSO_COTTURA, MEZZA);

    // La corsia box sul rettilineo nord, costruita dai campioni veri: un
    // riquadro posato a occhio e' esattamente il difetto che su monte-rosso
    // rendeva i box irraggiungibili.
    const inPianta = TG.sampleLoop(controlPoints, 1000);
    const n = inPianta.length;
    const DA = Math.round(n * 0.45), A = Math.round(n * 0.62);
    const LATERALE = MEZZA + 9;
    const corsia = [];
    for (let i = DA; i <= A; i += 4) {
        const k = i % n;
        const { nx, nz } = TG.normalAt(inPianta, k, true);
        const p = inPianta[k];
        const versoFuori = (p.z - (NORD + SUD) / 2) * nz + (p.x - (OVEST + FIANCO) / 2) * nx >= 0 ? 1 : -1;
        corsia.push({ x: p.x + nx * LATERALE * versoFuori, z: p.z + nz * LATERALE * versoFuori });
    }

    const inizio = corsia[0], dopo = corsia[1];
    const pista = {
        id: 'loop-prova',
        name: 'Loop Prova',
        targetKm: 10,
        roadHalfWidth: MEZZA,
        startFinish: { x: controlPoints[0].x, z: controlPoints[0].z },
        geometria: g,
        controlPoints,
        pit: {
            roadHalfWidth: 5,
            boxIndex: Math.round(corsia.length / 2),
            entryTrigger: {
                x: inizio.x, z: inizio.z, halfWidth: 7, halfLength: 10,
                angle: Math.atan2(dopo.x - inizio.x, dopo.z - inizio.z),
            },
            path: corsia,
        },
    };

    const dest = path.join(__dirname, '..', '..', 'frontend', 'tracks', 'loop-prova.json');
    fs.writeFileSync(dest, JSON.stringify(pista, null, 2));
    const conTubo = TA.inserisciNeiCampioni(inPianta, g, TG.lapLength(inPianta) / n);
    const tubo = conTubo.filter(p => p.acrobatico);
    const cima = tubo.reduce((a, b) => (b.y > a.y ? b : a), { y: 0 });
    console.log(`scritta ${dest}`);
    console.log(`  ${nodi.length} nodi, ${controlPoints.length} campioni, corsia box di ${corsia.length} punti`);
    console.log(`  giro della morte: raggio ${RAGGIO}, ${tubo.length} campioni, cima a ${cima.y.toFixed(1)}`);
    console.log(`  ci si entra a ${TA.velocitaMinima(RAGGIO, G_ACROBATICO).toFixed(2)} u/tick`);
}

if (require.main === module) main();

module.exports = { costruisci, RAGGIO, FIANCO };
