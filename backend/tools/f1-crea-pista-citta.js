// backend/tools/f1-crea-pista-citta.js
//
// Genera la pista di prova del blocco G: un circuito cittadino, cioè un
// tracciato normale con `ambientazione: "citta"`.
//
// Serve a giudicare una cosa sola: **la città chiude davvero la vista, e i
// palazzi sembrano palazzi diversi?** Per questo la forma è fatta di tre pezzi
// che si guardano in modo diverso:
//   - un rettilineo lungo, dove le facciate scorrono di lato a 300 all'ora;
//   - due curve lente, dove invece si ha tempo di guardarle;
//   - una chicane stretta, dove i palazzi stanno addosso da tutte e due le parti.
//
// Uso:  node backend/tools/f1-crea-pista-citta.js
const fs = require('fs');
const path = require('path');
const TS = require('../../frontend/shared/trackSegmenti.js');
const TG = require('../../frontend/shared/trackGeometry.js');

const MEZZA = 11;
const PASSO_NODI = 40;
const OVEST = -420, EST = 380, SUD = -300, NORD = 300, RAGGIO = 110;

function arco(cx, cz, r, da, a, punti) {
    const out = [];
    for (let k = 0; k <= punti; k++) {
        const ang = da + (a - da) * (k / punti);
        out.push({ x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r });
    }
    return out;
}

function costruisci() {
    const nodi = [], tipi = [];
    const spingi = (x, z, tipo) => { nodi.push({ x, z, y: 0, dir: 0 }); tipi.push(tipo); };

    // Rettilineo sud: quello lungo, col traguardo a metà.
    for (let x = -150; x < EST - RAGGIO; x += PASSO_NODI) spingi(x, SUD, 'retta');
    // Curva lenta sud-est e rettilineo est.
    for (const p of arco(EST - RAGGIO, SUD + RAGGIO, RAGGIO, -Math.PI / 2, 0, 6)) spingi(p.x, p.z, 'curva');
    for (let z = SUD + RAGGIO + PASSO_NODI; z < NORD - RAGGIO; z += PASSO_NODI) spingi(EST, z, 'retta');
    // Curva lenta nord-est.
    for (const p of arco(EST - RAGGIO, NORD - RAGGIO, RAGGIO, 0, Math.PI / 2, 6)) spingi(p.x, p.z, 'curva');
    // Rettilineo nord con la CHICANE in mezzo: due curve strette opposte, dove
    // i palazzi stanno addosso da tutte e due le parti.
    for (let x = EST - RAGGIO - PASSO_NODI; x > 60; x -= PASSO_NODI) spingi(x, NORD, 'retta');
    spingi(20, NORD, 'curva');
    spingi(-20, NORD - 34, 'curva');
    spingi(-60, NORD - 34, 'curva');
    spingi(-100, NORD, 'curva');
    for (let x = -140; x > OVEST + RAGGIO; x -= PASSO_NODI) spingi(x, NORD, 'retta');
    // Curve nord-ovest e sud-ovest, e ritorno al traguardo.
    for (const p of arco(OVEST + RAGGIO, NORD - RAGGIO, RAGGIO, Math.PI / 2, Math.PI, 6)) spingi(p.x, p.z, 'curva');
    for (let z = NORD - RAGGIO - PASSO_NODI; z > SUD + RAGGIO; z -= PASSO_NODI) spingi(OVEST, z, 'retta');
    for (const p of arco(OVEST + RAGGIO, SUD + RAGGIO, RAGGIO, Math.PI, 1.5 * Math.PI, 6)) spingi(p.x, p.z, 'curva');
    for (let x = OVEST + RAGGIO + PASSO_NODI; x < -150; x += PASSO_NODI) spingi(x, SUD, 'retta');

    // Nodi doppi: gli archi condividono gli estremi coi rettilinei.
    const puliti = [], tipiPuliti = [];
    for (let i = 0; i < nodi.length; i++) {
        const prec = puliti[puliti.length - 1];
        if (prec && Math.hypot(nodi[i].x - prec.x, nodi[i].z - prec.z) < 1) continue;
        puliti.push(nodi[i]); tipiPuliti.push(tipi[i]);
    }
    return { nodi: puliti, tratti: tipiPuliti.map(t => ({ tipo: t })) };
}

function main() {
    const { nodi, tratti } = costruisci();
    const g = TS.riallinea({ versione: 1, nodi, tratti });
    const controlPoints = TS.cuoci(g, TS.PASSO_COTTURA, MEZZA);

    // La corsia box sul rettilineo sud, dai campioni veri.
    const pts = TG.sampleLoop(controlPoints, 1000);
    const n = pts.length;
    const DA = Math.round(n * 0.72), A = Math.round(n * 0.92);
    const LATERALE = MEZZA + 9;
    const corsia = [];
    for (let i = DA; i <= A; i += 4) {
        const k = i % n;
        const { nx, nz } = TG.normalAt(pts, k, true);
        const p = pts[k];
        const versoFuori = (p.z - (NORD + SUD) / 2) * nz + (p.x - (OVEST + EST) / 2) * nx >= 0 ? 1 : -1;
        corsia.push({ x: p.x + nx * LATERALE * versoFuori, z: p.z + nz * LATERALE * versoFuori });
    }

    const inizio = corsia[0], dopo = corsia[1];
    const pista = {
        id: 'citta-prova',
        name: 'Città Prova',
        targetKm: 10,
        roadHalfWidth: MEZZA,
        // ⚠️ È tutto qui: il resto della pista è un tracciato come gli altri.
        ambientazione: 'citta',
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

    const dest = path.join(__dirname, '..', '..', 'frontend', 'tracks', 'citta-prova.json');
    fs.writeFileSync(dest, JSON.stringify(pista, null, 2));
    console.log(`scritta ${dest}`);
    console.log(`  ${nodi.length} nodi, ${controlPoints.length} campioni, giro di ${TG.lapLength(pts).toFixed(0)} unita'`);
    console.log(`  corsia box di ${corsia.length} punti, ambientazione: citta`);
}

if (require.main === module) main();

module.exports = { costruisci };
