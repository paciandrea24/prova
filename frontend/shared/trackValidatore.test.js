// frontend/shared/trackValidatore.test.js
//
// ⚠️ `node --test backend/` NON esegue questo file: serve
// `node --test frontend/shared/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('./trackValidatore.js');

const ROOT = path.join(__dirname, '..', '..');
const pista = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', id + '.json'), 'utf8'));

// Una pista minima ma sana, da rompere un pezzo per volta: è il modo in cui
// si prova un validatore — un difetto alla volta, tutto il resto a posto.
function pistaSana() {
    const R = 220, nodi = [];
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        nodi.push({ x: Math.sin(a) * R, z: Math.cos(a) * R });
    }
    const box = [];
    for (let i = -4; i <= 4; i++) {
        const a = (i / 24) * Math.PI * 2;
        box.push({ x: Math.sin(a) * (R + 24), z: Math.cos(a) * (R + 24) });
    }
    return {
        id: 'sana', name: 'Sana', targetKm: 4, roadHalfWidth: 11,
        controlPoints: nodi,
        startFinish: { x: 0, z: R, angle: Math.atan2(1, 0) },
        pit: {
            roadHalfWidth: 5, boxIndex: 4,
            entryTrigger: { x: box[1].x, z: box[1].z, halfWidth: 5, halfLength: 6, angle: 0 },
            path: box,
        },
    };
}

const codici = (esito) => esito.problemi.map(p => p.codice);
const perCodice = (esito, c) => esito.problemi.find(p => p.codice === c);

test('una pista sana non ha problemi che impediscono di salvare', () => {
    const esito = V.controllaGeometria(pistaSana());
    const gravi = esito.problemi.filter(p => p.livello === 'impedisce');
    assert.deepEqual(gravi.map(p => p.codice), [], JSON.stringify(gravi, null, 1));
});

test('meno di tre punti: il gioco non caricherebbe la pista', () => {
    const p = pistaSana();
    p.controlPoints = p.controlPoints.slice(0, 2);
    assert.ok(codici(V.controllaGeometria(p)).includes('pochi-punti'));
});

test('corsia box troppo corta, e casella fuori dalla corsia', () => {
    const p = pistaSana();
    p.pit.path = p.pit.path.slice(0, 2);
    assert.ok(codici(V.controllaGeometria(p)).includes('corsia-corta'));

    const q = pistaSana();
    q.pit.boxIndex = 99;
    assert.ok(codici(V.controllaGeometria(q)).includes('casella-box-fuori'));
});

test('il riquadro d ingresso deve toccare la corsia box', () => {
    const p = pistaSana();
    p.pit.entryTrigger = { x: 9000, z: 9000, halfWidth: 5, halfLength: 5, angle: 0 };
    assert.ok(codici(V.controllaGeometria(p)).includes('trigger-non-tocca'));
});

test('il riquadro d ingresso non deve sbordare sull asfalto', () => {
    // Piazzato sul tracciato invece che sulla corsia: manderebbe ai box chi
    // sta solo passando.
    const p = pistaSana();
    p.pit.entryTrigger = { x: p.controlPoints[0].x, z: p.controlPoints[0].z, halfWidth: 6, halfLength: 6, angle: 0 };
    const c = codici(V.controllaGeometria(p));
    assert.ok(c.includes('trigger-sull-asfalto'), c.join(', '));
});

test('una curva troppo stretta si segnala, ma non impedisce di salvare', () => {
    const p = pistaSana();
    // Un gomito: tre punti ravvicinati che girano di colpo.
    p.controlPoints.splice(6, 0, { x: 150, z: 150 }, { x: 120, z: 145 }, { x: 118, z: 175 });
    const problema = perCodice(V.controllaGeometria(p), 'curva-stretta');
    assert.ok(problema, 'la curva stretta va segnalata');
    assert.equal(problema.livello, 'da guardare',
        'il raggio da solo non predice se i bot ce la faranno: melbourne e la piu stretta e li completa');
    assert.ok(problema.dove && typeof problema.dove.x === 'number', 'un problema deve dire DOVE');
});

test('una pendenza oltre il 15% si segnala', () => {
    const p = pistaSana();
    p.controlPoints[3].y = 40;   // 40 unità di salita in pochi metri
    const problema = perCodice(V.controllaGeometria(p), 'pendenza-forte');
    assert.ok(problema, 'la pendenza va segnalata');
    assert.match(problema.messaggio, /%/);
});

test('il traguardo dentro un tornante lascia la pista senza tribuna', () => {
    const p = pistaSana();
    // Un tornante vero al posto del primo tratto, e il traguardo dentro.
    // Misurato: raggio 10.8 contro la soglia di 60, mentre la piu' stretta
    // fra le piste esistenti sta a 70.
    p.controlPoints.splice(1, 2, { x: 60, z: 215 }, { x: 30, z: 250 }, { x: -10, z: 215 });
    p.startFinish = { x: 30, z: 250, angle: Math.atan2(-1, 0) };
    const c = codici(V.controllaGeometria(p));
    assert.ok(c.includes('traguardo-in-curva'), c.join(', '));
});

test('un traguardo contromano impedisce di salvare', () => {
    const p = pistaSana();
    p.startFinish.angle += Math.PI;   // esattamente al contrario
    const problema = perCodice(V.controllaGeometria(p), 'traguardo-contromano');
    assert.ok(problema);
    assert.equal(problema.livello, 'impedisce');
});

test('le piste vere del gioco non hanno problemi che impediscono di salvare', () => {
    const brutte = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'frontend/tracks')).filter(x => x.endsWith('.json'))) {
        const id = f.replace(/\.json$/, '');
        const gravi = V.controllaGeometria(pista(id)).problemi.filter(p => p.livello === 'impedisce');
        if (gravi.length) brutte.push(id + ': ' + gravi.map(g => g.codice).join(', '));
    }
    assert.deepEqual(brutte, []);
});

// --- Scenografia ----------------------------------------------------------

const TrackScenery = require('./trackScenery.js');
const { loadTrack } = require(path.join(ROOT, 'backend/sockets/games/trackLoader.js'));
const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;
const terraceAnchors = require(path.join(ROOT, 'frontend/assets/custom/circuit/terraceAnchors.json')).anchors;

function scenografiaDi(id) {
    const raw = pista(id);
    const t = loadTrack(id);
    const barrierDist = raw.roadHalfWidth + 2.8 + 1.2;
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts, barrierDist, 45,
        seats, t.barrierProfile, terraceAnchors, { gridSize: 6 });
    return { raw, layout, contesto: {
        trackPts: t.points, pitPts: t.pitLanePts,
        barrierProfile: t.barrierProfile, barrierDist,
    } };
}

test('le piste vere non hanno oggetti dentro la carreggiata', () => {
    const brutte = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'frontend/tracks')).filter(x => x.endsWith('.json'))) {
        const id = f.replace(/\.json$/, '');
        const { raw, layout, contesto } = scenografiaDi(id);
        const gravi = V.controllaScenografia(raw, layout, contesto).problemi
            .filter(p => p.livello === 'impedisce');
        if (gravi.length) brutte.push(id + ': ' + gravi.map(g => g.messaggio).join(' / '));
    }
    assert.deepEqual(brutte, []);
});

test('un oggetto piazzato in mezzo alla pista viene visto', () => {
    const { raw, layout, contesto } = scenografiaDi('prova');
    const sulNastro = contesto.trackPts[100];
    const sporco = layout.concat([{
        asset: 'containerStack', category: 'paddock-life',
        x: sulNastro.x, z: sulNastro.z, y: 0, rotY: 0, scale: 1,
    }]);
    const problema = V.controllaScenografia(raw, sporco, contesto).problemi
        .find(p => p.codice === 'oggetti-in-pista');
    assert.ok(problema, 'un container in mezzo alla pista deve essere segnalato');
    assert.equal(problema.livello, 'impedisce');
    assert.ok(problema.dove, 'e deve dire dove');
});

test('gli spettatori senza tribuna vengono visti', () => {
    const { raw, layout, contesto } = scenografiaDi('prova');
    const sporco = layout.concat([
        { asset: 'spectatorA', category: 'crowd', x: 9000, y: 4, z: 9000, rotY: 0, scale: 1 },
    ]);
    const c = V.controllaScenografia(raw, sporco, contesto).problemi.map(p => p.codice);
    assert.ok(c.includes('spettatori-a-mezz-aria'), c.join(', '));
});

test('una fila del traguardo vuota viene vista', () => {
    const { raw, layout, contesto } = scenografiaDi('prova');
    const senzaPrincipale = layout.filter(v => v.category !== 'grandstand-main');
    const c = V.controllaScenografia(raw, senzaPrincipale, contesto).problemi.map(p => p.codice);
    assert.ok(c.includes('niente-tribuna-principale'), c.join(', '));
});
