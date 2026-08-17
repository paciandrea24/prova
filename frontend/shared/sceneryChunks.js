// frontend/shared/sceneryChunks.js
//
// Partizionamento spaziale della scenografia, per poter riaccendere il
// frustum culling (Rif. playtest 2026-08-10: la scenografia costava 7 ms per
// frame, misurati spegnendola dal pannello).
//
// IL PROBLEMA: f1.js crea un InstancedMesh per ogni mesh di ogni asset, con
// dentro TUTTE le istanze di quell'asset sparse per il circuito. Three culla
// per oggetto, usando il volume di ingombro della geometria trasformato dalla
// matrice dell'oggetto: per un InstancedMesh quel volume descrive il modello
// base, non dove stanno davvero le istanze. Ecco perché il culling era
// disattivato — acceso, avrebbe fatto sparire interi gruppi a caso.
//
// LA SOLUZIONE: dividere le istanze in celle quadrate e creare un
// InstancedMesh per cella, ciascuno con un ingombro che copre le proprie
// istanze e nient'altro. Le celle fuori dall'inquadratura non vengono
// disegnate né dalla camera né dalla mappa delle ombre.
//
// Modulo puro: nessuna dipendenza da Three, così il calcolo dell'ingombro —
// la parte che, se sbagliata, fa sparire oggetti — è verificabile con
// `node --test`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryChunks = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Lato della cella, in unità di gioco. È un compromesso: celle piccole
    // cullano meglio ma moltiplicano le draw call, celle grandi fanno il
    // contrario. 350 tiene le tribune di una curva nello stesso gruppo.
    const CELL = 350;

    // Sotto questa soglia non conviene dividere: pochi oggetti in un gruppo
    // solo costano meno di tanti gruppi da pochi oggetti. Il volume di
    // ingombro viene comunque calcolato, così anche i gruppi interi
    // partecipano al culling.
    const MIN_FOR_SPLIT = 24;

    // ...e nemmeno sotto questo peso in triangoli, per quante istanze ci
    // siano. Dividere in celle è uno SCAMBIO: si paga una draw call per cella
    // e per materiale, e si spera di risparmiare i triangoli delle celle
    // fuori dall'inquadratura. Il cambio fra le due valute l'ha misurato il
    // pannello F9 su `prova` il 2026-08-16, e non è alla pari:
    //
    //   - il tempo di disegno è ~5 ms fissi più ~0.013 ms per draw call;
    //   - spegnere 449k triangoli su 1017k NON ha alzato gli fps;
    //   - spegnere 104 draw call di alberi ha tolto 1 ms su 11.7.
    //
    // Con quel cambio, dividere `treeBroad` — 131 alberi, 44k triangoli in
    // tutto, sparsi su 26 celle — costa 78 draw call, cioè ~1 ms per frame,
    // per risparmiare triangoli che non pesano. La folla invece va divisa:
    // 2035 figure sono 244k triangoli, e la maggior parte sta alle spalle.
    //
    // 50k è il ginocchio della curva misurata sui punti di vista di un giro
    // intero: draw call in vista da 326 a 216 (-34%), triangoli da 787k a
    // 890k (+13%). Sotto i 25k si recupera poco, sopra i 100k si comincia a
    // pagare in triangoli senza togliere quasi più draw call.
    const MIN_TRI_FOR_SPLIT = 50000;

    // Conviene spezzare in celle questo asset? `triangoli` è il totale
    // dell'asset in scena: triangoli del modello per numero di istanze.
    function vaDivisoInCelle(istanze, triangoli) {
        return istanze >= MIN_FOR_SPLIT && triangoli >= MIN_TRI_FOR_SPLIT;
    }

    function cellKey(x, z, cell) {
        return `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    }

    // items: oggetti con .x e .z (le voci del layout di TrackScenery).
    // Restituisce una Map chiave-cella → array di voci, nell'ordine originale.
    function groupByCell(items, cell) {
        const out = new Map();
        for (const it of items) {
            const k = cellKey(it.x, it.z, cell || CELL);
            if (!out.has(k)) out.set(k, []);
            out.get(k).push(it);
        }
        return out;
    }

    // Sfera che racchiude tutti i punti, ciascuno ingombrante `raggio`.
    // Centro = centro del parallelepipedo che li contiene (non la media: con
    // istanze addensate da un lato la media lascerebbe fuori le altre).
    function boundsOf(punti, raggio) {
        if (!punti.length) return { x: 0, y: 0, z: 0, radius: 0 };
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const p of punti) {
            const y = p.y || 0;
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        let maxDist = 0;
        for (const p of punti) {
            const dx = p.x - cx, dy = (p.y || 0) - cy, dz = p.z - cz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > maxDist) maxDist = d;
        }
        // Il raggio del singolo oggetto va SOMMATO, non ignorato: la sfera
        // deve contenere l'ingombro, non i soli punti di ancoraggio. Un
        // ingombro troppo grande costa qualche oggetto disegnato in più; uno
        // troppo piccolo fa sparire oggetti veri, che è molto peggio.
        return { x: cx, y: cy, z: cz, radius: maxDist + (raggio || 0) };
    }

    return { CELL, MIN_FOR_SPLIT, MIN_TRI_FOR_SPLIT, vaDivisoInCelle,
             cellKey, groupByCell, boundsOf };
});
