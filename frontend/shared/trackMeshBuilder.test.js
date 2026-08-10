// frontend/shared/trackMeshBuilder.test.js
const test = require('node:test');
const assert = require('node:assert');

// Finto Three.js: raccoglie solo ciò che serve a verificare la GEOMETRIA
// (posizioni dei vertici). Non disegna nulla — questi test controllano dove
// finiscono i vertici, non come appaiono.
global.THREE = {
    BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } setIndex(i) { this.index = i; } computeVertexNormals() {} },
    Float32BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
    MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } },
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
    DoubleSide: 2,
    Object3D: class { constructor() { this.children = []; } add(c) { this.children.push(c); } },
    BoxGeometry: class {},
    InstancedMesh: class { constructor() {} setMatrixAt() {} },
    Color: class {},
    Vector3: class {},
};

// trackMeshBuilder.js è solo-browser (`})(window)`, non UMD come gli altri
// moduli condivisi): prende le sue dipendenze da `window` e ci appende
// l'export. Qui si costruisce quel window minimo invece di convertire il
// modulo a UMD — è codice di rendering, il browser resta il suo unico
// ambiente reale.
global.window = {
    TrackGeometry: require('./trackGeometry.js'),
    SceneryHills: require('./sceneryHills.js'),
    ToonPalette: require('./toonPalette.js'),
};
require('./trackMeshBuilder.js');
const TrackMeshBuilder = global.window.TrackMeshBuilder;
const TrackGeometry = global.window.TrackGeometry;

function contenitore() { return { children: [], add(c) { this.children.push(c); } }; }

// Cerchio di raggio 100: la distanza di ogni vertice dall'origine è
// immediatamente confrontabile con la distanza attesa dall'asse pista.
function cerchio(n = 200) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        pts.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, y: 0 });
    }
    return pts;
}

test('buildBarriers con un numero: la barriera sta a quella distanza (invariato)', () => {
    const c = contenitore();
    TrackMeshBuilder.buildBarriers(c, cerchio(), 15, null);
    assert.equal(c.children.length, 2, 'una mesh per lato');
    for (const mesh of c.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let v = 0; v < pos.length; v += 3) {
            const d = Math.hypot(pos[v], pos[v + 2]);
            // Su un cerchio di raggio 100 la barriera sta a 85 (lato interno)
            // o 115 (lato esterno).
            assert.ok(Math.abs(d - 85) < 0.5 || Math.abs(d - 115) < 0.5,
                `vertice a distanza ${d.toFixed(2)}, attesa 85 o 115`);
        }
    }
});

// Su un cerchio, quale dei due `side` punta verso l'esterno dipende dal verso
// di percorrenza: si ricava da normalAt invece di assumerlo, così il test
// verifica la geometria e non la convenzione.
function latoEsterno(pts) {
    const { nx, nz } = TrackGeometry.normalAt(pts, 0, true);
    const p = pts[0];
    const raggio = Math.hypot(p.x, p.z);
    return Math.hypot(p.x + nx, p.z + nz) > raggio ? 1 : -1;
}

test('buildBarriers con una funzione: la distanza varia per campione e lato', () => {
    const pts = cerchio();
    const fuori = latoEsterno(pts);
    const c = contenitore();
    // 25 unità in più solo sul lato esterno e solo nella prima metà del giro.
    TrackMeshBuilder.buildBarriers(c, pts, (i, side) => 15 + (side === fuori && i < 100 ? 25 : 0), null);

    const distanze = [];
    for (const mesh of c.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let v = 0; v < pos.length; v += 3) distanze.push(Math.hypot(pos[v], pos[v + 2]));
    }
    const arrotondate = new Set(distanze.map(d => Math.round(d)));
    assert.ok(arrotondate.has(85), 'lato interno a 15 dall\'asse: raggio 85');
    assert.ok(arrotondate.has(115), 'lato esterno senza ghiaia: raggio 115');
    assert.ok(arrotondate.has(140), 'lato esterno con 25 di ghiaia: raggio 140');
});

test('buildGravel: la banda va dal bordo del cordolo alla barriera', () => {
    const pts = cerchio();
    const fuori = latoEsterno(pts);
    // Profilo finto: 25 unità sul solo lato esterno, ovunque lungo il giro.
    const piena = new Float64Array(pts.length).fill(25);
    const vuota = new Float64Array(pts.length);
    const prof = fuori > 0 ? { right: piena, left: vuota } : { right: vuota, left: piena };

    const c = contenitore();
    TrackMeshBuilder.buildGravel(c, pts, 11, 2.8, prof);

    assert.equal(c.children.length, 1, 'una sola mesh per tutta la ghiaia');
    const pos = c.children[0].geometry.attributes.position.array;
    // Solo i vertici effettivamente indicizzati: quelli del lato senza ghiaia
    // esistono nel buffer ma non formano triangoli.
    const usati = new Set(c.children[0].geometry.index);
    const distanze = [];
    for (const v of usati) distanze.push(Math.hypot(pos[v * 3], pos[v * 3 + 2]));
    const min = Math.min(...distanze), max = Math.max(...distanze);
    // Bordo interno = roadHalf + curbW = 13.8 -> raggio 113.8
    // Bordo esterno = 13.8 + 25 = 38.8 -> raggio 138.8
    assert.ok(Math.abs(min - 113.8) < 0.5, `bordo interno a ${min.toFixed(1)}, atteso 113.8`);
    assert.ok(Math.abs(max - 138.8) < 0.5, `bordo esterno a ${max.toFixed(1)}, atteso 138.8`);
});

test('buildGravel: con profilo tutto a zero non produce nulla', () => {
    const pts = cerchio();
    const prof = { right: new Float64Array(pts.length), left: new Float64Array(pts.length) };
    const c = contenitore();
    TrackMeshBuilder.buildGravel(c, pts, 11, 2.8, prof);
    assert.equal(c.children.length, 0, 'nessuna mesh dove non c\'è ghiaia');
});
