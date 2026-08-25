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
    Mesh: class {
        constructor(g, m) {
            this.geometry = g; this.material = m;
            this.rotation = { x: 0, y: 0, z: 0 };
            // set() assegna davvero: i piloni del ponte si posizionano così, e
            // per verificare dove arriva la loro sommità serve il valore.
            this.position = {
                x: 0, y: 0, z: 0,
                set(x, y, z) { this.x = x; this.y = y; this.z = z; },
            };
        }
    },
    DoubleSide: 2,
    Object3D: class { constructor() { this.children = []; } add(c) { this.children.push(c); } },
    BoxGeometry: class {},
    CylinderGeometry: class {
        constructor(radiusTop, radiusBottom, height, radialSegments) {
            this.parameters = { radiusTop, radiusBottom, height, radialSegments };
        }
    },
    PlaneGeometry: class { constructor() { this.attributes = {}; } rotateX() {} translate() {} },
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

test('terreno screziato: un colore per vertice, in gamma, e macchie diverse fra loro', () => {
    // Erba e ghiaia non sono più due campiture piatte: la tinta varia per
    // vertice. Se l'attributo colore avesse una lunghezza diversa da quello
    // delle posizioni, Three legge oltre la fine e il terreno diventa nero a
    // chiazze — un difetto che nessun test di geometria vedrebbe.
    const pts = cerchio();
    const piena = new Float64Array(pts.length).fill(25);
    const fuori = latoEsterno(pts);
    const prof = fuori > 0
        ? { right: piena, left: new Float64Array(pts.length) }
        : { right: new Float64Array(pts.length), left: piena };

    const c = contenitore();
    TrackMeshBuilder.buildGravel(c, pts, 11, 2.8, prof);
    TrackMeshBuilder.buildEmbankment(c, pts, INNER, PLATEAU, OUTER);
    TrackMeshBuilder.buildGround(c, pts, OUTER, 3000);

    let conColore = 0;
    for (const mesh of c.children) {
        const posizioni = mesh.geometry.attributes.position;
        const colori = mesh.geometry.attributes.color;
        if (!colori) continue;   // il prato lontano è un piano a tinta unita
        conColore++;
        assert.equal(colori.array.length, posizioni.array.length,
            'un colore per vertice, esattamente');
        const distinti = new Set();
        for (let v = 0; v < colori.array.length; v++) {
            const q = colori.array[v];
            assert.ok(q >= 0 && q <= 1, `componente di colore fuori gamma: ${q}`);
            if (v % 3 === 0) distinti.add(q.toFixed(3));
        }
        assert.ok(distinti.size > 1, 'la superficie deve avere più di una tinta');
    }
    assert.ok(conColore >= 3, `attese almeno 3 mesh screziate, trovate ${conColore}`);
});

test('buildGravel: con profilo tutto a zero non produce nulla', () => {
    const pts = cerchio();
    const prof = { right: new Float64Array(pts.length), left: new Float64Array(pts.length) };
    const c = contenitore();
    TrackMeshBuilder.buildGravel(c, pts, 11, 2.8, prof);
    assert.equal(c.children.length, 0, 'nessuna mesh dove non c\'è ghiaia');
});

test('su prova la barriera non finisce sepolta nel terrapieno', () => {
    // Caso vero, non sintetico: il difetto vive dove la curvatura CAMBIA
    // mentre la pista sale, e un cerchio perfetto non lo riproduce (le sue
    // fette di terrapieno sono radiali e non si accavallano mai). Su prova, in
    // salita verso il ponte, i settori di campioni vicini si sovrappongono e
    // quello più avanti — più alto — passa sopra la barriera di quello più
    // indietro, che sparisce sotto terra. Segnalato in gioco il 2026-08-12.
    const TrackGravel = require('./trackGravel.js');
    const prova = require('../tracks/prova.json');

    const roadHalf = prova.roadHalfWidth, curbW = 2.8;
    const barrierD = roadHalf + curbW + 1.2, inner = roadHalf + curbW;
    const pts = TrackGeometry.sampleLoop(prova.controlPoints, 1000);
    const pitPts = TrackGeometry.tuckPitEndsToTrack(
        TrackGeometry.sampleOpenPath(TrackGeometry.snapPitPathEnds(prova.pit.path, pts, roadHalf), 300), pts);
    const profilo = TrackGravel.barrierProfile(pts, {
        roadHalf, curbW, pitLanePts: pitPts, pitRoadHalf: prova.pit.roadHalfWidth,
    });
    const plateau = require('./trackScenery.js').embankmentStart(profilo, barrierD);
    const outer = plateau + 45;

    const terreno = contenitore();
    TrackMeshBuilder.buildEmbankment(terreno, pts, inner, plateau, outer);
    const muro = contenitore();
    TrackMeshBuilder.buildBarriers(muro, pts,
        (i, side) => TrackGravel.barrierAt(profilo, i, side), null,
        (i, bx, bz) => TrackGeometry.terrainTopAt(pts, i, bx, bz, plateau));

    // Triangoli del terreno in una griglia spaziale: senza, sono 12000 facce
    // per 2000 punti e il test diventa impraticabile.
    const CELLA = 40, griglia = new Map();
    const facce = [];
    for (const mesh of terreno.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let f = 0; f < mesh.geometry.index.length; f += 3) {
            const id = [mesh.geometry.index[f], mesh.geometry.index[f + 1], mesh.geometry.index[f + 2]];
            const V = id.map(k => ({ x: pos[k * 3], y: pos[k * 3 + 1], z: pos[k * 3 + 2] }));
            const indice = facce.push(V) - 1;
            const x0 = Math.floor(Math.min(V[0].x, V[1].x, V[2].x) / CELLA), x1 = Math.floor(Math.max(V[0].x, V[1].x, V[2].x) / CELLA);
            const z0 = Math.floor(Math.min(V[0].z, V[1].z, V[2].z) / CELLA), z1 = Math.floor(Math.max(V[0].z, V[1].z, V[2].z) / CELLA);
            for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
                const k = gx + ',' + gz;
                if (griglia.has(k)) griglia.get(k).push(indice); else griglia.set(k, [indice]);
            }
        }
    }
    function terrenoSopra(x, z) {
        const lista = griglia.get(Math.floor(x / CELLA) + ',' + Math.floor(z / CELLA));
        if (!lista) return null;
        let alta = null;
        for (const f of lista) {
            const [A, B, C] = facce[f];
            const den = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
            if (Math.abs(den) < 1e-9) continue;
            const l1 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / den;
            const l2 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / den;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            const y = l1 * A.y + l2 * B.y + l3 * C.y;
            if (alta === null || y > alta) alta = y;
        }
        return alta;
    }

    // Cime della barriera indicizzate per posizione, così il confronto è fra
    // due geometrie emesse e non fra una geometria e una formula.
    const cime = new Map();
    for (const mesh of muro.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let v = 0; v < pos.length; v += 3) {
            const k = pos[v].toFixed(1) + ',' + pos[v + 2].toFixed(1);
            if (!cime.has(k) || pos[v + 1] > cime.get(k)) cime.set(k, pos[v + 1]);
        }
    }

    // La cima deve sporgere dal terreno per almeno metà della sua altezza
    // (1.1): sotto quella soglia, in gioco si vede una barriera che sprofonda.
    let peggiore = 0, dove = null;
    for (let i = 0; i < pts.length; i++) {
        if (pts[i].bridge) continue;
        const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
        for (const side of [-1, 1]) {
            const d = TrackGravel.barrierAt(profilo, i, side);
            const bx = pts[i].x + nx * d * side, bz = pts[i].z + nz * d * side;
            const suolo = terrenoSopra(bx, bz);
            const cima = cime.get(bx.toFixed(1) + ',' + bz.toFixed(1));
            if (suolo === null || cima === undefined) continue;
            const mancante = 0.55 - (cima - suolo);
            if (mancante > peggiore) { peggiore = mancante; dove = { i, side, cima, suolo }; }
        }
    }
    assert.ok(peggiore <= 0,
        `la barriera sporge meno di mezza altezza dal terreno (manca ${peggiore.toFixed(2)})` +
        (dove ? `: campione ${dove.i} lato ${dove.side > 0 ? '+' : '-'}, cima ${dove.cima.toFixed(2)}, terreno ${dove.suolo.toFixed(2)}` : ''));
});

// --- Terrapieno -------------------------------------------------------------
//
// Le tre distanze sono quelle vere di "prova": attacco al bordo del cordolo,
// fine del pianoro (la barriera più lontana del giro, con le vie di fuga) e
// fine della rampa.
const INNER = 13.8, PLATEAU = 45.7, OUTER = 93.7;

// Ovale stretto: due rettilinei paralleli a 60 unità l'uno dall'altro, uniti
// da semicerchi di raggio 30. È la forma minima che riproduce il difetto —
// il terrapieno ha 93.7 unità di portata, molto più delle 30 che separano un
// rettilineo dalla mezzeria, quindi senza correzioni arriva dall'altra parte
// e passa sopra la pista affiancata.
function ovaleStretto({ y = 0 } = {}) {
    const pts = [];
    const push = (x, z) => pts.push({ x, z, y, bridge: false });
    const R = 30, L = 200;
    for (let k = 0; k < 100; k++) push(-L + k * 4, -R);
    for (let k = 0; k < 24; k++) { const a = -Math.PI / 2 + k / 24 * Math.PI; push(L + Math.cos(a) * R, Math.sin(a) * R); }
    for (let k = 0; k < 100; k++) push(L - k * 4, R);
    for (let k = 0; k < 24; k++) { const a = Math.PI / 2 + k / 24 * Math.PI; push(-L + Math.cos(a) * R, Math.sin(a) * R); }
    return pts;
}

// Tutti i vertici del terrapieno presenti nel contenitore, come {x, y, z}.
// Si guarda la GEOMETRIA EMESSA e non TrackGeometry.terrainHeightAt: quella
// fonde le quote sul punto di pista più vicino, quindi per costruzione non
// può mostrare uno sbordo (misurarla ha già fatto perdere un giro, il
// 2026-08-11).
function verticiDi(container) {
    const out = [];
    for (const mesh of container.children) {
        const pos = mesh.geometry.attributes.position.array;
        for (let v = 0; v < pos.length; v += 3) out.push({ x: pos[v], y: pos[v + 1], z: pos[v + 2] });
    }
    return out;
}

test('il terrapieno non invade la carreggiata di un tratto affiancato', () => {
    const pts = ovaleStretto();
    const c = contenitore();
    TrackMeshBuilder.buildEmbankment(c, pts, INNER, PLATEAU, OUTER);

    // Il terrapieno attacca al bordo del cordolo: nessun suo vertice può
    // trovarsi più VICINO di così all'asse di una pista — se ci sta, quel
    // pezzo di terreno è sopra l'asfalto (o sopra il cordolo) di un tratto
    // che non è quello che l'ha generato.
    let peggiore = INNER;
    for (const v of verticiDi(c)) {
        const d = TrackGeometry.nearestPoint(pts, v.x, v.z).dist;
        if (d < peggiore) peggiore = d;
    }
    assert.ok(peggiore >= INNER - 0.05,
        `un vertice del terrapieno sta a ${peggiore.toFixed(2)} dall'asse pista, il cordolo finisce a ${INNER}`);
});

test('dove è tagliato dal tratto vicino il terrapieno resta alla quota della pista', () => {
    // Ovale sopraelevato di 8: l'interno è largo 60, quindi ogni suo punto
    // dista al più 30 da una delle due piste — meno del pianoro (45.7). Il
    // terreno lì dentro deve essere tutto in piano alla quota della pista,
    // non una conca che scende verso il prato e poi risale.
    const pts = ovaleStretto({ y: 8 });
    const c = contenitore();
    TrackMeshBuilder.buildEmbankment(c, pts, INNER, PLATEAU, OUTER);

    let piuBasso = 8;
    for (const v of verticiDi(c)) {
        // Solo l'interno dell'ovale, lontano dai semicerchi di testa.
        if (Math.abs(v.z) > 30 || Math.abs(v.x) > 150) continue;
        if (v.y < piuBasso) piuBasso = v.y;
    }
    // La tolleranza copre il piede della parete di confine, che affonda di
    // mezza unità sotto il terreno del vicino apposta (vedi PIEDE_AFFONDO):
    // è geometria sepolta, non una conca. Resta ampiamente sotto le 8 unità
    // di dislivello che avrebbe una conca vera.
    assert.ok(piuBasso >= 8 - 0.7,
        `dentro l'ovale il terreno scende a ${piuBasso.toFixed(2)} invece di restare a 8`);
});

test('fra due tratti affiancati a quote diverse il confine è chiuso da una parete', () => {
    // Stesso ovale stretto, ma con un rettilineo sopraelevato di 8 e l'altro a
    // terra (i semicerchi raccordano le due quote). È la situazione di "prova"
    // vicino al ponte: il taglio ferma i due terrapieni sulla mezzeria, uno a
    // quota 8 e l'altro a 0, e fra le due superfici resta aria — un buco da cui
    // si vede attraverso il terreno, segnalato dall'utente in gioco.
    const pts = ovaleStretto();
    for (const p of pts) p.y = p.z < 0 ? 8 : 0;
    for (const p of pts) {
        if (Math.abs(p.z) < 29.9) p.y = 8 * (0.5 - p.z / 60);   // raccordo sui semicerchi
    }

    const c = contenitore();
    TrackMeshBuilder.buildEmbankment(c, pts, INNER, PLATEAU, OUTER);

    // I vertici vanno presi per INDICE, non per posizione: due tratti
    // affiancati giacciono sulla stessa normale, quindi un filtro geometrico
    // finirebbe per prendere anche quelli del vicino. L'ordine emesso è
    // (spezzone, lato, campione, anello); qui lo spezzone è uno solo e chiuso.
    const perCampione = [];   // { i, side, vertici: [{x,y,z}], raggi: [] }
    const facce = [];         // triangoli, col campione che li ha generati
    for (let mesh = 0; mesh < c.children.length; mesh++) {
        const geo = c.children[mesh].geometry;
        const pos = geo.attributes.position.array;
        const ring = pos.length / 3 / pts.length;
        const side = mesh === 0 ? -1 : 1;
        for (let i = 0; i < pts.length; i++) {
            const v = [], r = [];
            for (let j = 0; j < ring; j++) {
                const vb = (i * ring + j) * 3;
                v.push({ x: pos[vb], y: pos[vb + 1], z: pos[vb + 2] });
                r.push(Math.hypot(pos[vb] - pts[i].x, pos[vb + 2] - pts[i].z));
            }
            perCampione.push({ i, side, vertici: v, raggi: r });
        }
        for (let f = 0; f < geo.index.length; f += 3) {
            const a = geo.index[f], b = geo.index[f + 1], d = geo.index[f + 2];
            facce.push({
                i: Math.floor(a / ring),
                v: [a, b, d].map(k => ({ x: pos[k * 3], y: pos[k * 3 + 1], z: pos[k * 3 + 2] })),
            });
        }
    }

    // Quota della superficie disegnata sopra un punto: si cerca il triangolo
    // che lo contiene in pianta e si interpola. Prendere "il vertice più
    // vicino" non basta — in mezzo a tre tratti che si contendono lo spazio
    // il vertice più vicino può appartenere al bordo di un terzo tratto e
    // dire una quota che lì non c'è. Si escludono le facce dei campioni
    // parenti, che sono la superficie di questo stesso tratto.
    function quotaSuperficieIn(x, z, iEscluso) {
        let piuAlta = null;
        for (const f of facce) {
            const ds = Math.min(Math.abs(f.i - iEscluso), pts.length - Math.abs(f.i - iEscluso));
            if (ds < 12) continue;
            const [A, B, C] = f.v;
            const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
            if (Math.abs(d) < 1e-9) continue;   // triangolo degenere
            const l1 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / d;
            const l2 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / d;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            const y = l1 * A.y + l2 * B.y + l3 * C.y;
            if (piuAlta === null || y > piuAlta) piuAlta = y;
        }
        return piuAlta;
    }

    let peggiore = 0, dove = null;
    for (const g of perCampione) {
        if (g.i % 4) continue;
        const bordo = Math.max(...g.raggi);
        if (bordo > OUTER - 0.5) continue;      // non tagliato: nessun confine
        const p = pts[g.i];
        const { nx, nz } = TrackGeometry.normalAt(pts, g.i, true);

        // Quota del terreno oltre il confine, e quota più bassa raggiunta dai
        // vertici sul confine: se non scendono fin lì, resta un buco.
        const ox = p.x + nx * (bordo + 3) * g.side, oz = p.z + nz * (bordo + 3) * g.side;
        const oltre = quotaSuperficieIn(ox, oz, g.i);
        if (oltre === null) continue;   // oltre il confine non disegna nessuno
        const piede = Math.min(...g.vertici.filter((_, k) => g.raggi[k] > bordo - 0.5).map(v => v.y));
        const buco = piede - oltre;
        if (buco > peggiore) { peggiore = buco; dove = { i: g.i, bordo, piede, oltre }; }
    }

    assert.ok(peggiore < 0.35,
        `al confine resta un salto verticale scoperto di ${peggiore.toFixed(2)} unità` +
        (dove ? ` (campione ${dove.i}, bordo a ${dove.bordo.toFixed(1)}: il terreno finisce a ${dove.piede.toFixed(2)} e riprende a ${dove.oltre.toFixed(2)})` : ''));
});

test('senza tratti affiancati il terrapieno resta quello di prima', () => {
    // Cerchio di raggio 300: il tratto più vicino a se stesso è il diametro
    // opposto, 600 unità più in là. Niente può tagliare, quindi gli anelli
    // devono stare esattamente ai loro raggi nominali.
    const pts = [];
    for (let i = 0; i < 240; i++) {
        const a = i / 240 * Math.PI * 2;
        pts.push({ x: Math.cos(a) * 300, z: Math.sin(a) * 300, y: 6 });
    }
    const c = contenitore();
    TrackMeshBuilder.buildEmbankment(c, pts, INNER, PLATEAU, OUTER);

    // Cinque anelli: attacco, fine pianoro, poi la rampa in tre passi.
    const attesi = [INNER, PLATEAU,
        PLATEAU + (OUTER - PLATEAU) / 3, PLATEAU + (OUTER - PLATEAU) * 2 / 3, OUTER];
    const raggi = new Set();
    for (const v of verticiDi(c)) {
        raggi.add(Math.abs(Math.hypot(v.x, v.z) - 300).toFixed(1));
        // La quota è quella di sempre: pista fino al pianoro, zero alla fine.
        const scostamento = Math.abs(Math.hypot(v.x, v.z) - 300);
        if (scostamento <= PLATEAU + 0.01) assert.equal(v.y, 6, 'pianoro alla quota pista');
        if (Math.abs(scostamento - OUTER) < 0.01) assert.ok(Math.abs(v.y) < 1e-6, 'fine rampa a zero');
    }
    for (const r of attesi) {
        assert.ok(raggi.has(r.toFixed(1)), `manca l'anello a ${r.toFixed(1)} dall'asse (trovati: ${[...raggi].join(', ')})`);
    }
});

// ═══════════════ PONTI: impalcato e piloni ═══════════════
//
// Difetto segnalato dall'utente ("la strada fluttua"): l'impalcato era un
// piano SENZA spessore appeso 1.5 unità sotto la carreggiata, mentre i piloni
// si fermavano a 2.5 sotto — cioè un'unità più giù del piano, calcolata come
// se l'impalcato fosse un solido spesso BRIDGE_DECK_THICK che però nessuno
// disegnava. Fra strada, piano e piloni restavano due strisce d'aria.

const PONTE_QUOTA = 10;

// Cerchio con un tratto in quota marcato come ponte, e i punti a terra
// separati: è la stessa coppia (trackPts, groundPts) che f1.js passa.
function cerchioConPonte(n = 200, da = 40, a = 60) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const ang = i / n * Math.PI * 2;
        const suPonte = i >= da && i <= a;
        pts.push({
            x: Math.cos(ang) * 100, z: Math.sin(ang) * 100,
            y: suPonte ? PONTE_QUOTA : 0,
            bridge: suPonte,
        });
    }
    return pts;
}

function costruisciPonte() {
    const c = contenitore();
    const pts = cerchioConPonte();
    const groundPts = pts.filter(p => !p.bridge);
    // Stessi argomenti di f1.js: semilarghezza impalcato = pista + cordolo.
    TrackMeshBuilder.buildBridgeDecks(c, pts, groundPts, 13.8, 13.8, 45, 90);
    const piloni = c.children.filter(m => m.geometry && m.geometry.parameters
        && m.geometry.parameters.height !== undefined);
    const impalcati = c.children.filter(m => m.geometry && m.geometry.attributes
        && m.geometry.attributes.position);
    return { piloni, impalcati };
}

function estremiY(mesh) {
    const pos = mesh.geometry.attributes.position.array;
    let min = Infinity, max = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
        if (pos[i] < min) min = pos[i];
        if (pos[i] > max) max = pos[i];
    }
    return { min, max };
}

test('ponte: i piloni arrivano a toccare l\'impalcato, non si fermano prima', () => {
    const { piloni, impalcati } = costruisciPonte();
    assert.ok(piloni.length > 0, 'il tracciato di prova deve produrre dei piloni');
    assert.ok(impalcati.length > 0, 'e un impalcato');

    const sotto = Math.min(...impalcati.map(m => estremiY(m).min));
    for (const pilone of piloni) {
        const sommita = pilone.position.y + pilone.geometry.parameters.height / 2;
        assert.ok(sommita >= sotto - 0.05,
            `pilone fermo a ${sommita.toFixed(2)} mentre l'impalcato comincia a ${sotto.toFixed(2)}: ${(sotto - sommita).toFixed(2)} unità di vuoto`);
    }
});

test('ponte: l\'impalcato ha uno spessore vero e arriva sotto la carreggiata', () => {
    const { impalcati } = costruisciPonte();
    const sopra = Math.max(...impalcati.map(m => estremiY(m).max));
    const sotto = Math.min(...impalcati.map(m => estremiY(m).min));

    assert.ok(sopra >= PONTE_QUOTA - 0.1,
        `il bordo alto dell'impalcato è a ${sopra.toFixed(2)}, la strada a ${PONTE_QUOTA}: in mezzo si vedrebbe il vuoto`);
    assert.ok(sopra - sotto > 0.3,
        `impalcato spesso ${(sopra - sotto).toFixed(2)}: di taglio si legge come un foglio`);
});

test('le barriere sul ponte hanno gli stessi colori di tutte le altre', () => {
    const c = contenitore();
    TrackMeshBuilder.buildBarriers(c, cerchioConPonte(), 15, null);
    const tinte = new Set();
    for (const mesh of c.children) {
        const col = mesh.geometry.attributes.color.array;
        for (let i = 0; i < col.length; i += 3) {
            tinte.add([col[i], col[i + 1], col[i + 2]].map(v => v.toFixed(2)).join(','));
        }
    }
    // Due sole tinte su tutto il giro: la striscia chiara e quella rossa. Ora
    // che ogni barriera è un muro solido, quella del ponte non ha più niente
    // di diverso da segnalare.
    assert.equal(tinte.size, 2, `attese 2 tinte, trovate ${tinte.size}: ${[...tinte].join(' | ')}`);
});

// ────────────────────────────────────────────────────────────────────────
// I PILONI DEL VIADOTTO NON DEVONO CADERE DENTRO LA CARREGGIATA
//
// Il difetto che questi test proteggono (segnalato dall'utente): "da quando
// abbiamo allargato la carreggiata totale, spostando le barriere piu' in la',
// in alcune parti della pista i pilastri che sorreggono i ponti cadono dentro
// la carreggiata. Non e' un problema di gameplay, le macchine ci passano
// attraverso, pero' nella realta' sarebbe un grosso problema di sicurezza".
//
// La causa: buildBridgeDecks teneva i piloni alla larga da una distanza
// COSTANTE (innerEdge + 4). Le vie di fuga hanno reso le barriere un profilo
// variabile per campione e per lato, e quella costante ha smesso di descrivere
// il bordo della carreggiata. Misurato su "prova": dove la costante prevedeva
// 17.8 il muro vero sta a 29.8, e quattro piloni finivano dentro la pista,
// sconfinando fino a 10.7 unita'.
//
// Il tracciato e' quello vero, non un cerchio sintetico: serve un viadotto che
// scavalchi davvero un altro tratto, ed e' esattamente il caso segnalato.
// ────────────────────────────────────────────────────────────────────────
const TrackGravel = require('./trackGravel.js');
const { loadTrack } = require(require('path').join(__dirname, '..', '..',
    'backend/sockets/games/trackLoader.js'));

const PILONE_RAGGIO = 1.2;   // BRIDGE_PILLAR_RADIUS in trackMeshBuilder.js

function pilonisuProva(barrieraA) {
    const t = loadTrack('prova');
    const ROAD_HALF = t.roadHalf, CURB_W = 2.8;
    const bordoInterno = ROAD_HALF + CURB_W;
    const groundPts = t.points.filter(p => !p.bridge);
    const c = contenitore();
    TrackMeshBuilder.buildBridgeDecks(c, t.points, groundPts, bordoInterno,
        bordoInterno, bordoInterno, bordoInterno + 45, barrieraA);
    const piloni = c.children.filter(m => m.geometry && m.geometry.parameters
        && m.geometry.parameters.height !== undefined);
    return { piloni, track: t, groundPts };
}

// Di quanto il pilone sconfina oltre la barriera del tratto che passa sotto.
// Positivo = dentro la carreggiata.
function sconfinamento(p, track, groundPts, barrieraA) {
    const sotto = TrackGeometry.nearestPoint(groundPts, p.position.x, p.position.z);
    const idx = TrackGeometry.nearestPoint(track.points, sotto.x, sotto.z).index;
    const { nx, nz } = TrackGeometry.normalAt(track.points, idx, true);
    const lato = Math.sign((p.position.x - sotto.x) * nx + (p.position.z - sotto.z) * nz) || 1;
    return barrieraA(idx, lato) - (sotto.dist - PILONE_RAGGIO);
}

test('prova: nessun pilone del viadotto cade dentro la carreggiata', () => {
    const barrieraA = (i, lato) => TrackGravel.barrierAt(loadTrack('prova').barrierProfile, i, lato);
    const { piloni, track, groundPts } = pilonisuProva(barrieraA);

    assert.ok(piloni.length > 20,
        `solo ${piloni.length} piloni: il viadotto e' rimasto quasi senza sostegni`);

    const dentro = piloni
        .map(p => ({ p, s: sconfinamento(p, track, groundPts, barrieraA) }))
        .filter(r => r.s > 0);
    assert.strictEqual(dentro.length, 0,
        `${dentro.length} piloni dentro la carreggiata, il peggiore per ` +
        `${Math.max(...dentro.map(r => r.s), 0).toFixed(1)} unita'`);
});

test('prova: il viadotto resta sostenuto ai due lati di cio che scavalca', () => {
    // Non basta togliere i piloni vietati: senza gli appoggi ai bordi del
    // tratto vietato la lastra resterebbe sospesa da molto prima a molto dopo
    // l'attraversamento. La campata piu' lunga deve valere quanto la larghezza
    // di cio' che scavalca, non molto di piu'.
    const barrieraA = (i, lato) => TrackGravel.barrierAt(loadTrack('prova').barrierProfile, i, lato);
    const { piloni } = pilonisuProva(barrieraA);

    let massima = 0;
    for (let k = 1; k < piloni.length; k++) {
        massima = Math.max(massima, Math.hypot(
            piloni[k].position.x - piloni[k - 1].position.x,
            piloni[k].position.z - piloni[k - 1].position.z));
    }
    // La corsia sottostante con le sue vie di fuga occupa una sessantina di
    // unita': una campata di 100 vorrebbe dire appoggi mancanti, non un
    // attraversamento.
    assert.ok(massima < 100,
        `campata piu' lunga ${massima.toFixed(1)} unita': mancano gli appoggi ai bordi dell'attraversamento`);
});

test('senza profilo delle barriere resta il criterio a distanza costante', () => {
    // Chi non passa la funzione (il banco prova, che non disegna le vie di
    // fuga) deve continuare a ottenere dei piloni, non zero.
    const { piloni } = pilonisuProva(null);
    assert.ok(piloni.length > 20,
        `senza profilo il viadotto ha solo ${piloni.length} piloni`);
});

// ---- il prato non galleggia sopra una discesa ----
//
// Difetto segnalato dall'utente il 2026-08-25 con uno screenshot: dove aveva
// messo una discesa, la pista spariva sotto un prato piatto. Le celle di
// confine sporgono sul terrapieno di mezza diagonale, e `hillHeightAt`
// risponde zero in tutta la fascia vicina: sopra una discesa restavano a
// quota zero mentre il terrapieno sotto era sceso.
test('sopra una discesa le celle di prato di confine scendono col terreno', () => {
    // Una pista che scende a -12 su un tratto.
    const pts = [];
    const N = 400, R = 350;
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        // la discesa sta fra un quarto e mezzo giro
        const t = i / N;
        const y = (t > 0.25 && t < 0.5) ? -12 : 0;
        pts.push({ x: Math.sin(a) * R, y, z: Math.cos(a) * R });
    }
    const PLATEAU = 14, OUTER = 59;

    // Il punto più basso, e una cella di confine appena fuori dal buco.
    const basso = pts.reduce((b, p) => (p.y < b.y ? p : b), pts[0]);
    const dir = Math.hypot(basso.x, basso.z) || 1;
    const fuori = { x: basso.x * (1 + (OUTER - 5) / dir), z: basso.z * (1 + (OUTER - 5) / dir) };

    // ⚠️ Il CENTRO della cella dice poco: a 54 unità il raccordo è quasi
    // risalito a zero (-0.41 misurato). È l'ANGOLO INTERNO che conta — la
    // cella sporge di mezza diagonale verso la pista, ~14 unità su una cella
    // di 20, e lì il terreno è molto più basso. Misurare il centro era
    // esattamente l'errore che nascondeva il difetto.
    const yCentro = TrackGeometry.terrainHeightAt(pts, fuori.x, fuori.z, PLATEAU, OUTER);
    const dentro = { x: basso.x * (1 + (OUTER - 19) / dir), z: basso.z * (1 + (OUTER - 19) / dir) };
    const yAngolo = TrackGeometry.terrainHeightAt(pts, dentro.x, dentro.z, PLATEAU, OUTER);
    assert.ok(yAngolo < -2,
        `l'angolo interno della cella dovrebbe essere sceso, invece è ${yAngolo.toFixed(2)}`);
    assert.ok(yAngolo < yCentro - 1,
        `angolo ${yAngolo.toFixed(2)} e centro ${yCentro.toFixed(2)}: senza questa `
        + `differenza il test non proverebbe niente`);

    // E lontano dalla pista il raccordo torna a zero: la correzione non deve
    // schiacciare le colline.
    const lontano = { x: basso.x * (1 + 400 / dir), z: basso.z * (1 + 400 / dir) };
    assert.equal(TrackGeometry.terrainHeightAt(pts, lontano.x, lontano.z, PLATEAU, OUTER), 0);
});

// --- il nastro si inclina nelle curve sopraelevate (fase 1b-1) ---

// Lo stesso cerchio, con una sopraelevazione costante su ogni punto.
function cerchioBanked(gradi, n = 200) {
    const pts = cerchio(n);
    for (const p of pts) p.rollio = gradi * Math.PI / 180;
    return pts;
}

test('senza sopraelevazione i due bordi del nastro stanno alla stessa quota', () => {
    // La pista di oggi non deve cambiare di un millimetro.
    const c = contenitore();
    const pts = cerchio();
    const mesh = TrackMeshBuilder.buildRibbon(c, pts, 11, {});
    const pos = mesh.geometry.attributes.position.array;
    for (let i = 0; i < pts.length; i++) {
        assert.strictEqual(pos[i * 6 + 1], pos[i * 6 + 4], `campione ${i}: bordi a quote diverse`);
    }
});

test('con la sopraelevazione un bordo sale e l\'altro resta dov\'era', () => {
    const gradi = 18;
    const c = contenitore();
    const pts = cerchioBanked(gradi);
    const mesh = TrackMeshBuilder.buildRibbon(c, pts, 11, {});
    const pos = mesh.geometry.attributes.position.array;
    const alzataAttesa = Math.sin(gradi * Math.PI / 180) * 22;
    for (let i = 0; i < pts.length; i++) {
        const b = i * 6;
        const alto = Math.max(pos[b + 1], pos[b + 4]);
        const basso = Math.min(pos[b + 1], pos[b + 4]);
        assert.ok(Math.abs((alto - basso) - alzataAttesa) < 1e-6,
            `campione ${i}: alzata ${(alto - basso).toFixed(3)} invece di ${alzataAttesa.toFixed(3)}`);
        // Il bordo basso resta alla quota del punto: il nastro si APPOGGIA sul
        // terreno esistente, non ci sprofonda dentro.
        assert.ok(Math.abs(basso - ((pts[i].y || 0) + 0.02)) < 1e-9,
            `campione ${i}: il bordo basso e' sceso a ${basso.toFixed(3)}`);
    }
});

test('il bordo che sale e\' quello esterno, lontano dal centro della curva', () => {
    const c = contenitore();
    const pts = cerchioBanked(18);
    const mesh = TrackMeshBuilder.buildRibbon(c, pts, 11, {});
    const pos = mesh.geometry.attributes.position.array;
    for (const i of [0, 37, 99, 150]) {
        const b = i * 6;
        // Il cerchio e' centrato nell'origine: il vertice piu' alto dev'essere
        // anche il piu' lontano dal centro.
        const d1 = Math.hypot(pos[b], pos[b + 2]);
        const d2 = Math.hypot(pos[b + 3], pos[b + 5]);
        const piuAlto = pos[b + 1] > pos[b + 4] ? d1 : d2;
        const piuBasso = pos[b + 1] > pos[b + 4] ? d2 : d1;
        assert.ok(piuAlto > piuBasso,
            `campione ${i}: il vertice alto dista ${piuAlto.toFixed(1)}, quello basso ${piuBasso.toFixed(1)}`);
    }
});

test('i cordoli seguono il nastro inclinato', () => {
    // Se l'asfalto si alza e il cordolo no, il cordolo sparisce dentro la pista
    // o resta appeso: sono lo stesso bordo, devono stare alla stessa quota.
    const piano = contenitore(), banked = contenitore();
    TrackMeshBuilder.buildCurbs(piano, cerchio(), 11, 2.8, null);
    TrackMeshBuilder.buildCurbs(banked, cerchioBanked(18), 11, 2.8, null);
    const quote = (c) => {
        const ys = [];
        for (const mesh of c.children) {
            const pos = mesh.geometry.attributes.position.array;
            for (let v = 1; v < pos.length; v += 3) ys.push(pos[v]);
        }
        return ys;
    };
    const yPiano = quote(piano), yBanked = quote(banked);
    assert.equal(yPiano.length, yBanked.length, 'stesso numero di vertici');
    assert.ok(Math.max(...yBanked) > Math.max(...yPiano) + 1,
        `i cordoli non si sono alzati: max ${Math.max(...yBanked).toFixed(2)} contro ${Math.max(...yPiano).toFixed(2)}`);
});
