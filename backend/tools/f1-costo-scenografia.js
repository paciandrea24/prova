// Quanto costa la scenografia di un circuito: istanze, InstancedMesh e
// triangoli, per categoria e per asset, letti dai .glb veri.
//
// Uso:  node backend/tools/f1-costo-scenografia.js [tracciato ...]
//
// ⚠️ Il numero che conta NON è il triangolo — gli asset del circuito sono
// leggeri — ma l'InstancedMesh: f1.js::loadScenery ne crea uno per ogni mesh
// di ogni asset in ogni cella di sceneryChunks che quell'asset occupa, e ogni
// InstancedMesh è una draw call. Il GLTFLoader spezza per materiale, quindi un
// asset con sei materiali ne costa il doppio di uno con tre, a parità di
// istanze. È la ragione per cui i modelli nuovi vanno tenuti sotto i quattro
// materiali invece di arrivare al tetto di sei imposto da kit.finish().
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TrackScenery = require(path.join(ROOT, 'frontend/shared/trackScenery.js'));
const SceneryChunks = require(path.join(ROOT, 'frontend/shared/sceneryChunks.js'));
const { loadTrack } = require(path.join(ROOT, 'backend/sockets/games/trackLoader.js'));
const seats = require(path.join(ROOT,
    'frontend/assets/custom/circuit/grandStandSeats.json')).seats;

const CARTELLE = [path.join(ROOT, 'frontend/assets/custom/circuit'),
                  path.join(ROOT, 'frontend/assets/kenney')];

// Triangoli e numero di primitive di un .glb, letti dal solo chunk JSON:
// bastano gli accessor, non serve decodificare i buffer.
function leggiGlb(file) {
    const buf = fs.readFileSync(file);
    const lunghezzaJson = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + lunghezzaJson).toString('utf8'));
    let tri = 0, mesh = 0;
    for (const m of json.meshes || []) {
        for (const p of m.primitives) {
            mesh++;
            tri += (p.indices !== undefined ? json.accessors[p.indices].count
                                            : json.accessors[p.attributes.POSITION].count) / 3;
        }
    }
    return { tri, mesh };
}

const cache = new Map();
function costoDi(asset) {
    if (!cache.has(asset)) {
        let out = null;
        for (const c of CARTELLE) {
            const f = path.join(c, asset + '.glb');
            if (fs.existsSync(f)) { out = leggiGlb(f); break; }
        }
        cache.set(asset, out);
    }
    return cache.get(asset);
}

const tracciati = process.argv.slice(2).length ? process.argv.slice(2)
                : ['prova', 'new-monza', 'monte-rosso', 'baku'];

for (const id of tracciati) {
    const raw = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'frontend/tracks', id + '.json'), 'utf8'));
    const t = loadTrack(id);
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile);

    const perAsset = new Map();
    for (const v of layout) {
        // Laghetto e asfalto del parcheggio non hanno un modello: sono
        // superfici piane costruite in f1.js.
        if (v.category === 'pond' || v.category === 'parkingLot') continue;
        if (!perAsset.has(v.asset)) perAsset.set(v.asset, []);
        perAsset.get(v.asset).push(v);
    }

    let istanze = 0, gruppi = 0, triangoli = 0;
    const righe = [];
    const mancanti = [];
    for (const [asset, items] of perAsset) {
        const c = costoDi(asset);
        if (!c) mancanti.push(asset);
        const celle = items.length >= SceneryChunks.MIN_FOR_SPLIT
            ? SceneryChunks.groupByCell(items, SceneryChunks.CELL).size : 1;
        const mesh = celle * (c ? c.mesh : 1);
        const tri = (c ? c.tri : 0) * items.length;
        istanze += items.length; gruppi += mesh; triangoli += tri;
        righe.push({ asset, n: items.length, mesh, tri, celle });
    }

    // ⚠️ Le categorie si contano sulle VOCI, non per asset: lo stesso modello
    // può essere usato da categorie diverse — `billboardLow`, `flagPole` e
    // `pylon` stanno sia nel decoro del paddock sia fra le infrastrutture — e
    // attribuirlo a una sola fa sparire l'altra dal rapporto.
    //
    // Gli InstancedMesh invece NON sono attribuibili a una categoria: uno
    // contiene tutte le istanze di un asset in una cella, quali che siano le
    // categorie che lo usano. Per quelli vale solo la classifica per asset.
    const perCategoria = new Map();
    for (const v of layout) {
        if (v.category === 'pond' || v.category === 'parkingLot') continue;
        const c = costoDi(v.asset);
        const acc = perCategoria.get(v.category) || { n: 0, tri: 0 };
        acc.n++; acc.tri += c ? c.tri : 0;
        perCategoria.set(v.category, acc);
    }

    console.log(`\n=== ${id} ===  ${istanze} istanze, ${gruppi} InstancedMesh, `
        + `${(triangoli / 1000).toFixed(0)}k triangoli`);
    console.log('  per categoria (istanze e triangoli; le draw call non sono attribuibili):');
    for (const [cat, v] of [...perCategoria].sort((a, b) => b[1].tri - a[1].tri)) {
        console.log(`    ${cat.padEnd(18)} ${String(v.n).padStart(5)} istanze  `
            + `${(v.tri / 1000).toFixed(0).padStart(5)}k tri`);
    }
    console.log('  i 10 asset che costano più draw call:');
    for (const r of righe.sort((a, b) => b.mesh - a.mesh).slice(0, 10)) {
        console.log(`    ${r.asset.padEnd(20)} ${String(r.n).padStart(4)} istanze in `
            + `${String(r.celle).padStart(3)} celle  ${String(r.mesh).padStart(4)} mesh  `
            + `${(r.tri / 1000).toFixed(0).padStart(5)}k tri`);
    }
    if (mancanti.length) {
        console.log(`  ⚠️ senza .glb, contati come zero: ${mancanti.join(', ')}`);
    }
}
