// frontend/shared/cittaFacciate.test.js
//
// ⚠️ Gira con `node --test frontend/shared/`, non con `node --test backend/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const CittaFacciate = require('./cittaFacciate.js');
const CittaProfilo = require('./cittaProfilo.js');
const TrackGravel = require('./trackGravel.js');
const TrackGeometry = require('./trackGeometry.js');

function anello(raggio = 300, n = 800) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, halfWidth: 11 });
    }
    const muro = TrackGravel.barrierProfile(pts, { roadHalf: 11, pitLanePts: [], pitRoadHalf: 5 });
    return { pts, muro, profilo: CittaProfilo.profilo(pts, muro) };
}

test('senza citta\' non si posa nessuna colonna', () => {
    assert.deepEqual(CittaFacciate.colonne([], null), []);
    assert.deepEqual(CittaFacciate.colonne(null, {}), []);
    assert.deepEqual(CittaFacciate.colonne([{ x: 0, z: 0 }], { distanza: [] }), []);
});

test('le colonne coprono il giro, su tutti e due i lati', () => {
    const { pts, profilo } = anello();
    const voci = CittaFacciate.colonne(pts, profilo);
    assert.ok(voci.length > 0, 'nessuna colonna posata');
    // Quante colonne ci si aspetta: il giro delle due facciate diviso la
    // larghezza del modulo, meno i mozziconi lasciati ai giunti fra palazzi.
    const basi = voci.filter(v => /Base[AB]$/.test(v.asset));
    const giro = 2 * Math.PI * (300 + CittaProfilo.MARCIAPIEDE + 15) * 2;
    const attese = giro / CittaProfilo.MODULO_LARGO;
    assert.ok(basi.length > attese * 0.75 && basi.length <= attese,
        `${basi.length} colonne, attese circa ${attese.toFixed(0)}`);
    // Un tetto per colonna, mai due, mai zero.
    assert.equal(voci.filter(v => /Tetto$/.test(v.asset)).length, basi.length);
});

test('ogni pila arriva esattamente in cima al suo palazzo', () => {
    // ⚠️ È l'invariante che tiene insieme i moduli e il nastro: il nastro
    // finisce all'altezza che dice il profilo, e se la pila finisse più in
    // basso si vedrebbe il muro nudo sopra il cornicione.
    const { pts, profilo } = anello();
    const voci = CittaFacciate.colonne(pts, profilo);
    const perColonna = new Map();
    for (const v of voci) {
        const chiave = `${v.x.toFixed(3)},${v.z.toFixed(3)}`;
        if (!perColonna.has(chiave)) perColonna.set(chiave, []);
        perColonna.get(chiave).push(v);
    }
    assert.ok(perColonna.size > 50, 'troppe poche colonne per provare qualcosa');
    for (const [chiave, pila] of perColonna) {
        const tetto = pila.find(v => /Tetto$/.test(v.asset));
        const base = pila.find(v => /Base[AB]$/.test(v.asset));
        assert.ok(tetto && base, `${chiave}: pila senza base o senza coronamento`);
        const cima = tetto.y + CittaProfilo.H_CORONAMENTO;
        const piani = pila.length - 2;
        const attesa = base.y + CittaProfilo.H_BASE + piani * CittaProfilo.H_PIANO
            + CittaProfilo.H_CORONAMENTO;
        assert.ok(Math.abs(cima - attesa) < 1e-6, `${chiave}: la pila non torna`);
        // E l'altezza e' ESATTAMENTE quella che il nastro avra' li' dietro: e'
        // l'invariante che tiene insieme le due meta' della citta'. Il lato si
        // ricava dalla posizione, non si indovina, e si guarda una manciata di
        // campioni attorno perche' una colonna a cavallo del confine fra due
        // palazzi ha il campione piu' vicino gia' nel palazzo successivo.
        const i = TrackGeometry.nearestPoint(pts, base.x, base.z).index;
        const nrm = TrackGeometry.normalAt(pts, i, true);
        const proj = (base.x - pts[i].x) * nrm.nx + (base.z - pts[i].z) * nrm.nz;
        const lato = proj >= 0 ? 0 : 1;
        const alta = cima - base.y;
        const n = pts.length;
        const combacia = [];
        for (let d = -4; d <= 4; d++) combacia.push(profilo.altezza[((i + d + n) % n) * 2 + lato]);
        assert.ok(combacia.some(h => Math.abs(alta - h) < 1e-6),
            `${chiave}: pila alta ${alta.toFixed(1)}, il nastro dice ${combacia[4].toFixed(1)}`);
    }
});

test('ogni facciata guarda la pista', () => {
    // Una colonna girata al contrario mostrerebbe il retro liscio: il difetto
    // si vede solo in gioco, ma si misura qui con un prodotto scalare.
    const { pts, profilo } = anello();
    for (const v of CittaFacciate.colonne(pts, profilo)) {
        const i = TrackGeometry.nearestPoint(pts, v.x, v.z).index;
        const versoLAsse = { x: pts[i].x - v.x, z: pts[i].z - v.z };
        const guarda = { x: Math.sin(v.rotY), z: Math.cos(v.rotY) };
        const dot = (guarda.x * versoLAsse.x + guarda.z * versoLAsse.z)
            / Math.hypot(versoLAsse.x, versoLAsse.z);
        assert.ok(dot > 0.9, `${v.asset} guarda altrove (dot ${dot.toFixed(2)})`);
    }
});

test('due colonne vicine non si compenetrano', () => {
    // Sono larghe MODULO_LARGO e stanno in fila: se il passo fosse più corto
    // della larghezza, ogni giunzione sarebbe una compenetrazione.
    const { pts, profilo } = anello();
    const basi = CittaFacciate.colonne(pts, profilo).filter(v => /Base[AB]$/.test(v.asset));
    let minimo = Infinity;
    for (let i = 1; i < basi.length; i++) {
        const d = Math.hypot(basi[i].x - basi[i - 1].x, basi[i].z - basi[i - 1].z);
        if (d < 40) minimo = Math.min(minimo, d);   // salta il salto fra i due lati
    }
    // In curva la corda è più corta dell'arco: la soglia tiene conto di quello.
    assert.ok(minimo > CittaProfilo.MODULO_LARGO * 0.97,
        `due colonne a ${minimo.toFixed(2)}, larghe ${CittaProfilo.MODULO_LARGO}`);
});

test('la stessa pista da\' sempre la stessa citta\'', () => {
    const a = anello(), b = anello();
    assert.deepEqual(CittaFacciate.colonne(a.pts, a.profilo),
                     CittaFacciate.colonne(b.pts, b.profilo));
});

test('le tabelle degli asset conoscono tutti i moduli, e con le misure giuste', () => {
    // ⚠️ I nomi dei moduli sono composti in TRE posti — qui, nella tabella dei
    // percorsi e in quella degli ingombri — perche' importarli da un posto solo
    // chiuderebbe un anello di require (profilo -> scenografia -> tabelle).
    // Questo test e' cio' che tiene al posto della dipendenza: se le liste
    // divergono, un asset diventa un 404 al caricamento della pista, e un
    // ingombro mancante diventa il FALLBACK 6x6x6 che nessuno nota.
    const Sizes = require('./sceneryAssetSizes.js');
    const Paths = require('./sceneryAssetPaths.js');
    const ids = CittaFacciate.assetIds();
    assert.equal(ids.length, 25, 'cinque pezzi per cinque famiglie-tinta');
    for (const id of ids) {
        assert.ok(Paths.PERCORSI[id], `${id}: manca il percorso del modello`);
        const size = Sizes.SIZES[id];
        assert.ok(size, `${id}: manca l'ingombro`);
        const attesa = /Base[AB]$/.test(id) ? CittaProfilo.H_BASE
            : /Tetto$/.test(id) ? CittaProfilo.H_CORONAMENTO : CittaProfilo.H_PIANO;
        assert.equal(size.h, attesa, `${id}: l'ingombro dice ${size.h}, la pila ${attesa}`);
    }
    // E nessuna tabella nomina un modulo che qui non esiste.
    const noti = new Set(ids);
    for (const chiave of Object.keys(Paths.PERCORSI)) {
        if (/^citta[A-Z]/.test(chiave)) assert.ok(noti.has(chiave), `${chiave}: percorso orfano`);
    }
});
