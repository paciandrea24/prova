// backend/tools/glbInspect.js
//
// Parser GLB minimale (nessuna dipendenza): serve solo a verificare gli
// asset esportati da Blender in test headless — non è un loader completo,
// non legge i buffer binari. La bounding box si ricava dai min/max degli
// accessor POSITION (obbligatori nello standard glTF per gli accessor
// referenziati da POSITION) trasformati per la matrice mondo del nodo.
//
// Perché non three/GLTFLoader: il repo non ha node_modules e i test girano
// con `node --test` nativo; aggiungere three come dipendenza solo per
// misurare un bounding box sarebbe sproporzionato.
//
// Coordinate: quelle del file glTF, cioè quelle di gioco (Y = altezza),
// NON quelle di Blender.
const fs = require('fs');

function readGlbJson(absPath) {
    const buf = fs.readFileSync(absPath);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${absPath}: magic GLB non valido`);
    const version = buf.readUInt32LE(4);
    if (version !== 2) throw new Error(`${absPath}: versione glTF ${version}, attesa 2`);
    const chunkLen = buf.readUInt32LE(12);
    const chunkType = buf.readUInt32LE(16);
    if (chunkType !== 0x4e4f534a) throw new Error(`${absPath}: primo chunk non è JSON`);
    return JSON.parse(buf.slice(20, 20 + chunkLen).toString('utf8'));
}

// Matrici 4x4 in ordine column-major, come le vuole glTF.
function mul(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
}

function trs(node) {
    if (node.matrix) return node.matrix.slice();
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    ];
}

function apply(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
}

function inspectGlb(absPath) {
    const gltf = readGlbJson(absPath);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const nodeNames = [];
    let primitiveCount = 0;
    const meshesSeen = new Set();
    const materialsSeen = new Set();

    const scene = gltf.scenes[gltf.scene || 0];
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const stack = (scene.nodes || []).map(i => ({ idx: i, parent: null }));

    while (stack.length) {
        const { idx, parent } = stack.pop();
        const node = gltf.nodes[idx];
        const world = mul(parent || identity, trs(node));
        if (node.name) nodeNames.push(node.name);
        for (const child of node.children || []) stack.push({ idx: child, parent: world });
        if (node.mesh === undefined) continue;
        meshesSeen.add(node.mesh);
        for (const prim of gltf.meshes[node.mesh].primitives) {
            primitiveCount++;
            if (prim.material !== undefined) materialsSeen.add(prim.material);
            const acc = gltf.accessors[prim.attributes.POSITION];
            if (!acc.min || !acc.max) throw new Error(`${absPath}: accessor POSITION senza min/max`);
            for (let corner = 0; corner < 8; corner++) {
                const p = [
                    (corner & 1) ? acc.max[0] : acc.min[0],
                    (corner & 2) ? acc.max[1] : acc.min[1],
                    (corner & 4) ? acc.max[2] : acc.min[2],
                ];
                const w = apply(world, p);
                for (let i = 0; i < 3; i++) {
                    if (w[i] < min[i]) min[i] = w[i];
                    if (w[i] > max[i]) max[i] = w[i];
                }
            }
        }
    }

    return {
        meshCount: meshesSeen.size,
        materialCount: materialsSeen.size,
        primitiveCount,
        nodeNames,
        bounds: { min, max },
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    };
}

// LA LUCE INTERNA DI UN PORTALE, misurata sul modello e non sul commento.
// Un portale poggia su due piedi e in mezzo ci passa la pista: il numero che
// conta e' la distanza dall'asse del punto piu' INTERNO dei piedi. Il ponte
// dei semafori ha i piloni a ±15 larghi 3 (filo interno 13.5) ma i plinti di
// cemento larghi 4.5 (filo interno 12.75), e chi dimensionava la campata
// usava il pilone: alla scala 2.39 di shanghai i 0.75 di differenza
// diventano 1.79 e il plinto entrava nella barriera. Segnalato dall'utente
// in gioco il 2026-08-24, col tasto M.
//
// `yMax` limita la misura alla parte BASSA del modello: e' li' che il portale
// tocca terra, mentre in alto la campata passa sopra la pista ed e' giusto
// che invada.
//
// A differenza del resto del file questa funzione LEGGE i vertici: i min/max
// degli accessor non bastano, perche' i due piedi stanno spesso nello stesso
// nodo e la loro bounding box comune non ha il vuoto in mezzo.
function luceInterna(absPath, yMax) {
    const buf = fs.readFileSync(absPath);
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
    // Il chunk BIN segue quello JSON, che e' allineato a 4 byte.
    const binStart = 20 + jsonLen + 8;

    function leggiPosizioni(accIdx) {
        const acc = gltf.accessors[accIdx];
        const bv = gltf.bufferViews[acc.bufferView];
        const base = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = bv.byteStride || 12;
        const out = [];
        for (let i = 0; i < acc.count; i++) {
            const o = base + i * stride;
            out.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
        }
        return out;
    }

    const scene = gltf.scenes[gltf.scene || 0];
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const stack = (scene.nodes || []).map(i => ({ idx: i, parent: null }));
    let sinistra = -Infinity, destra = Infinity;

    while (stack.length) {
        const { idx, parent } = stack.pop();
        const node = gltf.nodes[idx];
        const world = mul(parent || identity, trs(node));
        for (const child of node.children || []) stack.push({ idx: child, parent: world });
        if (node.mesh === undefined) continue;
        for (const prim of gltf.meshes[node.mesh].primitives) {
            for (const p of leggiPosizioni(prim.attributes.POSITION)) {
                const w = apply(world, p);
                if (w[1] > yMax) continue;
                if (w[0] < 0 && w[0] > sinistra) sinistra = w[0];
                else if (w[0] >= 0 && w[0] < destra) destra = w[0];
            }
        }
    }
    return { sinistra: Math.abs(sinistra), destra, semiluce: Math.min(Math.abs(sinistra), destra) };
}

module.exports = { inspectGlb, readGlbJson, luceInterna };
