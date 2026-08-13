// backend/tools/barrieraForma.js
//
// Misura la FORMA del nastro della barriera, non il suo profilo di distanza.
// La distinzione è il motivo per cui questo file esiste: un profilo liscio può
// benissimo produrre un nastro accartocciato, ed è esattamente quello che
// succedeva nei quattro punti segnalati in gioco su `prova` il 2026-08-12.
//
// Tutte le misure partono dalla stessa formula con cui la mesh piazza i
// vertici (trackMeshBuilder.js::buildBarriers): un vertice per campione,
// spostato di `dist` lungo la normale.
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');

function puntiBarriera(pts, distDi, side) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
        const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
        const d = distDi(i, side);
        out.push({ x: pts[i].x + nx * d * side, z: pts[i].z + nz * d * side });
    }
    return out;
}

// Dove il nastro INDIETREGGIA invece di avanzare. Sul lato interno di una
// curva, oltre il raggio di curvatura l'avanzamento diventa negativo: prima
// una cuspide, poi un cappio. La normale di `prev` è perpendicolare alla
// propria tangente per costruzione, quindi nell'avanzamento entra solo la
// distanza del campione di ARRIVO.
function ripiegamenti(pts, distDi) {
    const n = pts.length;
    const out = [];
    for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            const t = TrackGeometry.tangentAt(pts, prev, true);
            const nQui = TrackGeometry.normalAt(pts, i, true);
            const avanti = (pts[i].x - pts[prev].x) * t.tx + (pts[i].z - pts[prev].z) * t.tz
                + side * distDi(i, side) * (nQui.nx * t.tx + nQui.nz * t.tz);
            if (avanti <= 0) out.push({ side, i });
        }
    }
    return out;
}

function incrociano(a, b, c, d) {
    const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) return false;
    const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
    const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

// Segmenti del nastro che si tagliano fra loro. La finestra è in CAMPIONI ed
// è volutamente locale: due rami lontani del tracciato che si sfiorano non
// sono un difetto del muro, sono la pista che si ripiega su se stessa.
function autoIntersezioni(pts, distDi, finestra = 120) {
    const n = pts.length;
    const out = [];
    for (const side of [-1, 1]) {
        const B = puntiBarriera(pts, distDi, side);
        for (let i = 0; i < n; i++) {
            for (let k = 2; k < finestra; k++) {
                const j = (i + k) % n;
                if (incrociano(B[i], B[(i + 1) % n], B[j], B[(j + 1) % n])) out.push({ side, i, j });
            }
        }
    }
    return out;
}

// Il segmento più corto del nastro. Vicino a zero i quad sono degeneri e la
// mesh mostra facce che si compenetrano anche senza un ripiegamento vero.
function passoMinimo(pts, distDi) {
    const n = pts.length;
    let best = { lunghezza: Infinity, side: 0, i: -1 };
    for (const side of [-1, 1]) {
        const B = puntiBarriera(pts, distDi, side);
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const L = Math.hypot(B[j].x - B[i].x, B[j].z - B[i].z);
            if (L < best.lunghezza) best = { lunghezza: L, side, i };
        }
    }
    return best;
}

module.exports = { puntiBarriera, ripiegamenti, autoIntersezioni, passoMinimo };
