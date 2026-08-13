// backend/tools/f1-barriera-dallalto.js
//
// Disegna il muro visto dall'alto, dai dati veri del modulo. Esiste perché il
// difetto dei "grovigli di barriere" si giudica guardando una forma: tre
// tentativi di correzione sono stati approvati sulle misure e bocciati al
// playtest, e la svolta è arrivata disegnando.
//
// Uso:
//   node backend/tools/f1-barriera-dallalto.js <tracciato> [--salva-baseline] [--baseline]
const fs = require('fs');
const path = require('path');
const Forma = require('./barrieraForma.js');
const TrackGravel = require('../../frontend/shared/trackGravel.js');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');

const OUT = path.join(__dirname, 'out');
const id = process.argv[2] || 'prova';
const salvaBaseline = process.argv.includes('--salva-baseline');
const conBaseline = process.argv.includes('--baseline');

const track = loadTrack(id);
const pts = track.points;
const distDi = (i, side) => TrackGravel.barrierAt(track.barrierProfile, i, side);

const rip = Forma.ripiegamenti(pts, distDi);
const inc = Forma.autoIntersezioni(pts, distDi);
const passo = Forma.passoMinimo(pts, distDi);
const stepLen = TrackGeometry.lapLength(pts) / pts.length;

// Zone da evidenziare: i campioni coinvolti, raggruppati.
function zone(indici, tolleranza = 15) {
    const s = [...new Set(indici)].sort((a, b) => a - b);
    const out = [];
    for (const i of s) {
        const last = out[out.length - 1];
        if (last && i - last[1] <= tolleranza) last[1] = i;
        else out.push([i, i]);
    }
    return out;
}
const critiche = zone([...rip.map(r => r.i), ...inc.map(c => c.i)]);

fs.mkdirSync(OUT, { recursive: true });

const baselineFile = path.join(OUT, `baseline-${id}.json`);
if (salvaBaseline) {
    const dump = { left: [], right: [] };
    for (let i = 0; i < pts.length; i++) { dump.left.push(distDi(i, -1)); dump.right.push(distDi(i, 1)); }
    fs.writeFileSync(baselineFile, JSON.stringify(dump));
    console.log(`baseline salvata in ${baselineFile}`);
}

let baseline = null;
if (conBaseline && fs.existsSync(baselineFile)) {
    const dump = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    baseline = (i, side) => (side > 0 ? dump.right : dump.left)[i];
}

// ---- disegno ----
function polilinea(distFn, side) {
    return Forma.puntiBarriera(pts, distFn, side).map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');
}

function svg() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const m = 80;
    const vb = `${(minX - m).toFixed(0)} ${(minZ - m).toFixed(0)} ${(maxX - minX + 2 * m).toFixed(0)} ${(maxZ - minZ + 2 * m).toFixed(0)}`;
    const asse = pts.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');

    const evidenziate = critiche.map(([a, b]) => {
        const seg = [];
        for (let i = a - 3; i <= b + 3; i++) {
            const p = pts[((i % pts.length) + pts.length) % pts.length];
            seg.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        }
        return `<polyline points="${seg.join(' ')}" fill="none" stroke="#ffb300" stroke-width="14" opacity="0.55"/>`;
    }).join('\n');

    const strato = (fn, colore, larghezza, opacita) => [-1, 1]
        .map(s => `<polyline points="${polilinea(fn, s)}" fill="none" stroke="${colore}" stroke-width="${larghezza}" opacity="${opacita}"/>`)
        .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1100">
<rect x="${minX - m}" y="${minZ - m}" width="${maxX - minX + 2 * m}" height="${maxZ - minZ + 2 * m}" fill="#f4f4ef"/>
${evidenziate}
<polyline points="${asse}" fill="none" stroke="#9aa0a6" stroke-width="${track.roadHalf * 2}" opacity="0.35"/>
${baseline ? strato(baseline, '#7986cb', 3, 0.9) : ''}
${strato(distDi, '#c62828', 3, 1)}
</svg>`;
}

const file = path.join(OUT, `barriera-${id}.svg`);
fs.writeFileSync(file, svg());

console.log(`=== ${id} — ${pts.length} campioni, passo ${stepLen.toFixed(2)} unità ===`);
console.log(`  ripiegamenti del nastro: ${rip.length}`);
console.log(`  auto-intersezioni:       ${inc.length}`);
console.log(`  passo minimo del nastro: ${passo.lunghezza.toFixed(2)} (pista ${stepLen.toFixed(2)})`);
console.log(`  zone critiche: ${critiche.map(c => c[0] === c[1] ? c[0] : `${c[0]}-${c[1]}`).join(', ') || 'nessuna'}`);
console.log(`  disegno: ${file}${baseline ? '  (in blu il profilo di baseline)' : ''}`);
