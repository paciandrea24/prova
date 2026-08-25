// backend/tools/f1-crea-pista-banking.js
//
// Genera la pista di prova del banking (fase 1b-1): un anello semplice con
// QUATTRO curve identiche — due piane, una a 18° (Zandvoort) e una a 35°
// (parabolica). Stessa geometria, stessa velocita' d'ingresso: la differenza
// che si sente e' solo la sopraelevazione, e la si sente due volte per giro.
//
// Non e' una pista da campionato ed e' apposta che non lo sia: serve a
// rispondere a una domanda sola, senza che curve diverse la confondano.
//
// ⚠️ Il raggio conta piu' di tutto: sopra i ~120 unita' la curva si prende in
// pieno anche da piana, e li' piu' aderenza non serve a niente (vedi la tabella
// in f1-banking-taratura.js). Con 90 si arriva al limite di aderenza, che e'
// dove il banking si sente.
//
// Uso:  node backend/tools/f1-crea-pista-banking.js [gradiA] [gradiB]
const fs = require('fs');
const path = require('path');
const TS = require('../../frontend/shared/trackSegmenti.js');
const TG = require('../../frontend/shared/trackGeometry.js');

const GRADI_A = parseFloat(process.argv[2] || '18');   // la curva "Zandvoort"
const GRADI_B = parseFloat(process.argv[3] || '35');   // la "parabolica"

const RAGGIO = 90;
const LATO_X = 420, LATO_Z = 300;      // fra i centri delle curve
// ⚠️ Un nodo ogni 28 unita', non ogni 45: la sopraelevazione vive sui TRATTI
// che hanno entrambi i capi dentro la curva, e con nodi radi l'arco da 141
// unita' ne conteneva UNO SOLO, da 45. Il raccordo del rollio ne vuole 80, e su
// un tratto piu' corto la transizione non ci sta: la curva arrivava ai 35 gradi
// di scatto, col cordolo che si impennava (visto in gioco il 2026-08-25). Con
// nodi piu' fitti la curva ha tre tratti sopraelevati e la transizione e'
// quella vera.
const PASSO_NODI = 28;
const MEZZA = 12;

// Il contorno: quattro archi da 90° uniti da quattro rettilinei. Si percorre in
// senso ORARIO guardando dall'alto (z verso l'alto), partendo a meta' del
// rettilineo sud — dove staranno il traguardo e la corsia box.
const centri = [
    { cx: +LATO_X / 2, cz: -LATO_Z / 2, a0: -Math.PI / 2 },   // curva 1 (sud-est)
    { cx: +LATO_X / 2, cz: +LATO_Z / 2, a0: 0 },              // curva 2 (nord-est)
    { cx: -LATO_X / 2, cz: +LATO_Z / 2, a0: +Math.PI / 2 },   // curva 3 (nord-ovest)
    { cx: -LATO_X / 2, cz: -LATO_Z / 2, a0: Math.PI },        // curva 4 (sud-ovest)
];

// Costruisce il contorno come sequenza di punti fitti, ricordando per ciascuno
// se sta in una curva (e quale) o su un rettilineo.
function contorno() {
    const out = [];
    const spingi = (x, z, curva) => out.push({ x, z, curva });
    // Meta' rettilineo sud (dal traguardo alla curva 1)
    for (let x = 0; x < LATO_X / 2; x += 5) spingi(x, -LATO_Z / 2 - RAGGIO, -1);
    for (let c = 0; c < 4; c++) {
        const { cx, cz, a0 } = centri[c];
        const passi = Math.ceil((Math.PI / 2) * RAGGIO / 5);
        for (let k = 0; k < passi; k++) {
            const a = a0 + (Math.PI / 2) * (k / passi);
            spingi(cx + Math.cos(a) * RAGGIO, cz + Math.sin(a) * RAGGIO, c);
        }
        // Il rettilineo che segue la curva.
        const next = centri[(c + 1) % 4];
        const a1 = a0 + Math.PI / 2;
        const da = { x: cx + Math.cos(a1) * RAGGIO, z: cz + Math.sin(a1) * RAGGIO };
        const a2 = next.a0;
        const fino = { x: next.cx + Math.cos(a2) * RAGGIO, z: next.cz + Math.sin(a2) * RAGGIO };
        const lung = Math.hypot(fino.x - da.x, fino.z - da.z);
        const passiR = Math.max(1, Math.round(lung / 5));
        for (let k = 0; k < passiR; k++) {
            const t = k / passiR;
            // L'ultimo mezzo rettilineo sud si ferma al traguardo (x=0), non
            // oltre: il giro si chiude li'.
            const x = da.x + (fino.x - da.x) * t, z = da.z + (fino.z - da.z) * t;
            if (c === 3 && x >= 0) break;
            spingi(x, z, -1);
        }
    }
    return out;
}

function main() {
    const punti = contorno();
    // Un nodo ogni PASSO_NODI unita' di contorno: abbastanza fitti da tenere la
    // forma, abbastanza radi da non fare una spezzata.
    const nodi = [], curvaDelNodo = [];
    let percorso = 0;
    for (let i = 0; i < punti.length; i++) {
        if (i > 0) percorso += Math.hypot(punti[i].x - punti[i - 1].x, punti[i].z - punti[i - 1].z);
        if (i === 0 || percorso >= PASSO_NODI) {
            nodi.push({ x: punti[i].x, z: punti[i].z, y: 0, dir: 0 });
            curvaDelNodo.push(punti[i].curva);
            percorso = 0;
        }
    }
    // Il tratto i va dal nodo i al nodo i+1: e' "in curva" se lo sono entrambi
    // i suoi capi, o la sopraelevazione sborderebbe sul rettilineo — dove non
    // si vede (la mesh non la disegna su un tratto dritto) e quindi non deve
    // nemmeno sentirsi.
    const gradiPerCurva = { 0: GRADI_A, 1: 0, 2: GRADI_B, 3: 0 };
    const tratti = nodi.map((_, i) => {
        const a = curvaDelNodo[i], b = curvaDelNodo[(i + 1) % nodi.length];
        const g = (a >= 0 && a === b) ? gradiPerCurva[a] : 0;
        return g > 0 ? { tipo: 'curva', rollioGradi: g } : { tipo: 'curva' };
    });

    const g = TS.riallinea({ versione: 1, nodi, tratti });
    const controlPoints = TS.cuoci(g, TS.PASSO_COTTURA, MEZZA);

    // LA CORSIA BOX, parallela al rettilineo sud e fuori dal nastro. Costruita
    // dai campioni veri della pista invece che a mano: e' l'unico modo perche'
    // la corsia sia davvero accanto alla pista su tutta la sua lunghezza — un
    // riquadro posato a occhio e' esattamente il difetto che su monte-rosso
    // rendeva i box irraggiungibili.
    const n = controlPoints.length;
    const iTraguardo = 0;
    // ⚠️ La corsia box finisce ben PRIMA del traguardo, non gli arriva addosso:
    // occupando il fianco fino al via non restava un posto libero dove posare il
    // ponte semafori, che deve stare davanti a tutta la griglia. Con la corsia
    // fino al 98% il gantry finiva a 44 unita' dalla linea, dentro la griglia.
    const DA = Math.round(n * 0.72), A = Math.round(n * 0.90);
    const LATERALE = MEZZA + 9;                                  // oltre il bordo pista
    const corsia = [];
    for (let i = DA; i <= A; i += 4) {
        const k = i % n;
        const { nx, nz } = TG.normalAt(controlPoints, k, true);
        // Il lato ESTERNO dell'anello: il centro sta all'origine, quindi si va
        // dalla parte opposta al centro.
        const p = controlPoints[k];
        const versoFuori = (p.x * nx + p.z * nz) >= 0 ? 1 : -1;
        corsia.push({ x: p.x + nx * LATERALE * versoFuori, z: p.z + nz * LATERALE * versoFuori });
    }

    const inizio = corsia[0], dopo = corsia[1];
    const pista = {
        id: 'banking-prova',
        name: 'Banking Prova',
        targetKm: 12,
        roadHalfWidth: MEZZA,
        startFinish: { x: controlPoints[iTraguardo].x, z: controlPoints[iTraguardo].z },
        geometria: g,
        controlPoints,
        pit: {
            roadHalfWidth: 5,
            boxIndex: Math.round(corsia.length / 2),
            entryTrigger: {
                x: inizio.x, z: inizio.z, halfWidth: 7, halfLength: 10,
                angle: Math.atan2(dopo.x - inizio.x, dopo.z - inizio.z)
            },
            path: corsia
        }
    };

    const dest = path.join(__dirname, '..', '..', 'frontend', 'tracks', 'banking-prova.json');
    fs.writeFileSync(dest, JSON.stringify(pista, null, 2));
    console.log(`scritta ${dest}`);
    console.log(`  ${nodi.length} nodi, ${controlPoints.length} campioni, corsia box di ${corsia.length} punti`);
    const conRollio = controlPoints.filter(p => p.rollio > 0.01).length;
    console.log(`  curve: 1 a ${GRADI_A}°, 1 a ${GRADI_B}°, 2 piane — ${conRollio} campioni sopraelevati (${(100 * conRollio / n).toFixed(0)}%)`);
}

if (require.main === module) main();
