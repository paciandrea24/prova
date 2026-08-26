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

// ---- l'elenco su cui offrire «togli questo» ----
//
// Il validatore continua a dire e a non aggiustare (e' scritto in testa al
// modulo): `oggetti` serve solo a dare all'editor su COSA offrire il pulsante.
// Chi toglie e' l'autore, e la scelta finisce in `scenografiaEsclusi`.
// Rif. docs/superpowers/specs/2026-08-25-f1-densita-scenografia-design.md
const SceneryEsclusioni = require('./sceneryEsclusioni.js');

test('una segnalazione su oggetti li elenca tutti, non solo il peggiore', () => {
    const { raw, layout, contesto } = scenografiaDi('prova');
    const a = contesto.trackPts[100], b = contesto.trackPts[300];
    const sporco = layout.concat([
        { asset: 'containerStack', category: 'paddock-life', x: a.x, z: a.z, y: 0, rotY: 0, scale: 1 },
        { asset: 'containerStack', category: 'paddock-life', x: b.x, z: b.z, y: 0, rotY: 0, scale: 1 },
    ]);
    const p = V.controllaScenografia(raw, sporco, contesto).problemi
        .find(x => x.codice === 'oggetti-in-pista');
    assert.ok(p.oggetti, 'la segnalazione deve portare gli oggetti');
    assert.equal(p.oggetti.length, 2, 'due container in pista, due righe da togliere');
    // L'id e' la STESSA stringa che il filtro si aspetta: una cosa, una misura.
    for (const o of p.oggetti) {
        assert.ok(o.id && o.asset && typeof o.x === 'number' && typeof o.z === 'number');
        const voce = sporco.find(v => SceneryEsclusioni.idDi(v) === o.id);
        assert.ok(voce, `l'id ${o.id} non corrisponde a nessuna voce del layout`);
    }
});

test('le segnalazioni che non parlano di oggetti non portano un elenco', () => {
    // «il traguardo non ha la sua tribuna» non si cura togliendo qualcosa:
    // offrire un pulsante li' sarebbe peggio che non offrirlo.
    const { raw, layout, contesto } = scenografiaDi('prova');
    const senzaPrincipale = layout.filter(v => v.category !== 'grandstand-main');
    const p = V.controllaScenografia(raw, senzaPrincipale, contesto).problemi
        .find(x => x.codice === 'niente-tribuna-principale');
    assert.ok(p, 'la tribuna principale mancante deve essere segnalata');
    assert.equal(p.oggetti, null);
});

// ═══════════ LA SOPRAELEVAZIONE (fase 1b-2) ═══════════

const TrackSegmenti = require('./trackSegmenti.js');
const TrackGeometryV = require('./trackGeometry.js');

// Una pista nel formato dell'editor: geometria a segmenti E i controlPoints
// COTTI da lei, come li riscrive l'editor a ogni modifica. Senza la cottura il
// rollio scritto nei tratti non arriverebbe mai ai punti e i controlli qui
// sotto misurerebbero una pista piana.
function pistaSegmenti(nodi, tratti) {
    const g = TrackSegmenti.riallinea({ versione: 1, nodi, tratti });
    const controlPoints = TrackSegmenti.cuoci(g, TrackSegmenti.PASSO_COTTURA, 11);
    const pts = TrackGeometryV.sampleLoop(controlPoints, 400);
    const box = [];
    for (let k = -18; k <= 18; k++) {
        const i = (k % pts.length + pts.length) % pts.length;
        const { nx, nz } = TrackGeometryV.normalAt(pts, i, true);
        box.push({ x: pts[i].x + nx * 24, z: pts[i].z + nz * 24 });
    }
    const t = TrackGeometryV.tangentAt(pts, 0, true);
    return {
        id: 'segmenti', name: 'Segmenti', targetKm: 4, roadHalfWidth: 11,
        geometria: g, controlPoints,
        startFinish: { x: pts[0].x, z: pts[0].z, angle: Math.atan2(t.tx, t.tz) },
        pit: {
            roadHalfWidth: 5, boxIndex: 4,
            entryTrigger: { x: box[1].x, z: box[1].z, halfWidth: 5, halfLength: 6, angle: 0 },
            path: box,
        },
    };
}

function nodiAnello(n, R) {
    const nodi = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        nodi.push({ x: Math.sin(a) * R, z: Math.cos(a) * R, y: 0, dir: 0 });
    }
    return nodi;
}

// Ovale: due rettilinei da 400 e due semicerchi da 150. `inCurva[i]` dice se il
// nodo i sta in curva, così un tratto si dichiara sopraelevato dalla parte
// giusta.
function nodiOvale() {
    const nodi = [], inCurva = [], R = 150, L = 400;
    const spingi = (x, z, curva) => { nodi.push({ x, z, y: 0, dir: 0 }); inCurva.push(curva); };
    for (let k = 0; k < 10; k++) spingi(-L / 2 + k * (L / 10), -R, false);
    for (let k = 0; k < 12; k++) { const a = -Math.PI / 2 + k / 12 * Math.PI; spingi(L / 2 + Math.cos(a) * R, Math.sin(a) * R, true); }
    for (let k = 0; k < 10; k++) spingi(L / 2 - k * (L / 10), R, false);
    for (let k = 0; k < 12; k++) { const a = Math.PI / 2 + k / 12 * Math.PI; spingi(-L / 2 + Math.cos(a) * R, Math.sin(a) * R, true); }
    return { nodi, inCurva };
}

const soloSopraelevazione = (esito) => esito.problemi.filter(p => p.codice.indexOf('sopraelevazione') === 0);

test('il validatore ferma una sopraelevazione oltre il massimo', () => {
    const nodi = nodiAnello(24, 220);
    const tratti = nodi.map((_, i) => (i === 1 ? { tipo: 'curva', rollioGradi: 60 } : { tipo: 'curva' }));
    const esito = V.controllaGeometria(pistaSegmenti(nodi, tratti));
    const p = perCodice(esito, 'sopraelevazione-fuori-scala');
    assert.ok(p, 'nessuna segnalazione per 60 gradi');
    assert.equal(p.livello, 'impedisce');
});

test('il validatore segnala una sopraelevazione su un tratto che risulta dritto', () => {
    // Il valore c'è nel file ma il gioco non lo disegna: si alza il bordo
    // ESTERNO, e su un rettilineo un esterno non c'è. Senza segnalazione, chi
    // l'ha messo passa il pomeriggio a chiedersi perché la pista non si
    // inclina.
    const { nodi, inCurva } = nodiOvale();
    const tratti = nodi.map((_, i) => (!inCurva[i] && i >= 2 && i < 7
        ? { tipo: 'curva', rollioGradi: 25 } : { tipo: 'curva' }));
    const esito = V.controllaGeometria(pistaSegmenti(nodi, tratti));
    const p = perCodice(esito, 'sopraelevazione-senza-curva');
    assert.ok(p, 'nessuna segnalazione per il rollio su un rettilineo');
    assert.equal(p.livello, 'da guardare');
    assert.ok(p.dove && typeof p.dove.x === 'number', 'la segnalazione deve essere cliccabile');
});

test('un ovale con le CURVE sopraelevate non fa scattare niente', () => {
    // Il controspecchio del test qui sopra: i raccordi d'ingresso curva sono
    // tratti brevi in cui il rollio è dichiarato e non ancora efficace, e una
    // soglia troppo stretta li scambierebbe per il difetto. Misurati: 26 unità
    // contigue qui, 261 sul rettilineo sopraelevato.
    const { nodi, inCurva } = nodiOvale();
    const tratti = nodi.map((_, i) => (inCurva[i] && inCurva[(i + 1) % nodi.length]
        ? { tipo: 'curva', rollioGradi: 25 } : { tipo: 'curva' }));
    assert.deepEqual(soloSopraelevazione(V.controllaGeometria(pistaSegmenti(nodi, tratti))).map(p => p.codice), []);
});

test('il validatore dice quando la sopraelevazione non ci sta nel tratto', () => {
    // Su un tratto corto la cottura NON fa lo scalino: si accontenta di meno
    // gradi (fase 1b-1). Il difetto quindi non è più un gradino sotto le ruote
    // — quello non può più arrivare — è che l'autore scrive 35 e in pista ne
    // trova 30, senza che nessuno glielo dica.
    const nodi = nodiAnello(48, 220);          // tratti da 29 unità
    const tratti = nodi.map((_, i) => (i === 2 ? { tipo: 'curva', rollioGradi: 35 } : { tipo: 'curva' }));
    const p = perCodice(V.controllaGeometria(pistaSegmenti(nodi, tratti)), 'sopraelevazione-non-entra');
    assert.ok(p, 'nessuna segnalazione per i 35 gradi che diventano 30');
    assert.equal(p.livello, 'da guardare');
});

test('una pista piana non guadagna nessuna segnalazione nuova', () => {
    assert.deepEqual(soloSopraelevazione(V.controllaGeometria(pistaSana())).map(p => p.codice), []);
});

test('banking-prova è una pista sopraelevata FATTA BENE: nessuna segnalazione', () => {
    // Un validatore che grida sulla pista di riferimento del banking non
    // servirebbe a nessuno: quattro curve, due a 18 e 35 gradi, tarate apposta.
    assert.deepEqual(soloSopraelevazione(V.controllaGeometria(pista('banking-prova'))).map(p => p.codice), []);
});

// ═══════════ IL GIRO DELLA MORTE (fase 2b) ═══════════

const TrackAcrobatico = require('./trackAcrobatico.js');

// Un anello con un tratto acrobatico fra due nodi affiancati, sul modello di
// `loop-prova`: rettilineo di lancio, i due nodi del tubo, e il resto.
function pistaConGiro({ raggio = 25, fianco = 30, lancio = 300 } = {}) {
    const nodi = [], tratti = [];
    const spingi = (x, z, tipo, extra) => {
        nodi.push({ x, z, y: 0, dir: 0 });
        tratti.push(Object.assign({ tipo }, extra || {}));
    };
    for (let z = -lancio; z < 0; z += 40) spingi(0, z, 'retta');
    spingi(0, 0, 'acrobatico', { raggio });
    spingi(fianco, 0, 'retta');
    for (let z = 40; z <= 240; z += 40) spingi(fianco, z, 'retta');
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI;
        spingi(fianco - 160 + Math.cos(a) * 160, 240 + Math.sin(a) * 160, 'curva');
    }
    for (let z = 200; z > -lancio; z -= 40) spingi(fianco - 320, z, 'retta');
    for (let k = 1; k < 8; k++) {
        const a = Math.PI + (k / 8) * Math.PI;
        spingi(fianco - 160 + Math.cos(a) * 160, -lancio - 20 + Math.sin(a) * 160, 'curva');
    }
    return pistaSegmenti(nodi, tratti);
}

test('il validatore ferma un giro della morte piu\' grande del percorribile', () => {
    const dati = pistaConGiro({ raggio: TrackSegmenti.RAGGIO_ACROBATICO_MAX + 20 });
    const p = perCodice(V.controllaGeometria(dati), 'acrobatico-fuori-scala');
    assert.ok(p, 'nessuna segnalazione per un raggio oltre il massimo');
    assert.equal(p.livello, 'impedisce');
});

test('il validatore ferma un giro della morte che si attraversa da solo', () => {
    // Ingresso e uscita devono essere AFFIANCATI di almeno una carreggiata: se
    // stanno quasi sullo stesso punto, il nastro in discesa passa attraverso
    // quello in salita e l'auto ci finisce dentro. E' il motivo per cui
    // l'utente ha disegnato l'uscita di fianco.
    const dati = pistaConGiro({ fianco: 4 });
    const p = perCodice(V.controllaGeometria(dati), 'acrobatico-si-attraversa');
    assert.ok(p, 'nessuna segnalazione per ingresso e uscita sovrapposti');
    assert.equal(p.livello, 'impedisce');
});

test('il validatore avvisa se prima del giro non c\'e\' spazio per lanciarsi', () => {
    const dati = pistaConGiro({ lancio: 40 });
    const p = perCodice(V.controllaGeometria(dati), 'acrobatico-poco-slancio');
    assert.ok(p, 'nessuna segnalazione per un rettilineo troppo corto');
    assert.equal(p.livello, 'da guardare');
    assert.ok(p.dove && typeof p.dove.x === 'number', 'la segnalazione deve essere cliccabile');
});

test('un giro della morte fatto bene non fa scattare niente', () => {
    const soloAcrobatico = (esito) => esito.problemi
        .filter(x => x.codice.indexOf('acrobatico') === 0).map(x => x.codice);
    assert.deepEqual(soloAcrobatico(V.controllaGeometria(pistaConGiro())), []);
});

test('loop-prova non ha segnalazioni sul suo giro della morte', () => {
    // La pista di riferimento della fase 2: se il validatore gridasse su di
    // lei, chi disegna non saprebbe piu' a cosa credere.
    const esito = V.controllaGeometria(pista('loop-prova'));
    assert.deepEqual(esito.problemi.filter(x => x.codice.indexOf('acrobatico') === 0).map(x => x.codice), []);
});
