// frontend/shared/scenografiaInvarianti.test.js
//
// Le promesse che la scenografia deve mantenere su OGNI pista — comprese
// quelle che non esistono ancora. Il file ENUMERA la cartella dei tracciati
// invece di elencarli: e' cio' che rende vera la richiesta dell'utente del
// 2026-08-24, «non voglio piu' questi bug in una qualsiasi possibile pista
// che posso creare». Una pista nuova e' coperta il giorno che la si salva,
// senza che nessuno debba ricordarsi di aggiungerla qui.
//
// ⚠️ Questo file NON gira con `node --test backend/`, il comando abituale del
// progetto: sta in frontend/shared. Serve `node --test frontend/shared/`.
//
// Rif. docs/superpowers/specs/2026-08-24-f1-scenografia-alla-radice-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TrackScenery = require('./trackScenery.js');
const Sizes = require('./sceneryAssetSizes.js');
const TrackGeometry = require('./trackGeometry.js');
const { SCAVALCANO, A_BORDO_PISTA, stessaFila } = require('./sceneryRegistro.js');
const TrackGravel = require('./trackGravel.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');

const ROOT = path.join(__dirname, '..', '..');
const seats = require(path.join(ROOT, 'frontend/assets/custom/circuit/grandStandSeats.json')).seats;
const terraceAnchors = require(path.join(ROOT, 'frontend/assets/custom/circuit/terraceAnchors.json')).anchors;

// Soglie in UNITA' DI PISTA, mai in campioni: un campione vale 1.18 unita' su
// monte-rosso e 5.17 su prova, quindi «per campione» vorrebbe dire quattro
// comportamenti diversi in silenzio.
const MAX_DENTRO_PISTA = 0.5;      // niente sulla superficie di gara, punto
const MAX_DENTRO_BOX = 1.0;        // i garage lambiscono la corsia per mestiere
const MAX_COMPENETRAZIONE = 1.0;   // sotto, e' un contatto: vedi la nota sulla densita' nel piano
const FINESTRA_GANTRY = 40;        // quanto il ponte semafori puo' allontanarsi dalla posizione ideale

// Categorie senza un modello solido: non hanno un ingombro da rispettare.
const NON_SOLIDE = new Set(['pond', 'parkingLot', 'crowd']);

// Il ponte dei semafori e la passerella SCAVALCANO la pista: attraversarla e'
// il loro mestiere, e passano a 16 e 13 unita' di quota. La regola del
// corridoio vale per cio' che sta a terra. L'elenco arriva dal registro, non
// e' una copia: due liste della stessa cosa divergono.

// Le reti nascono attaccate alla loro tribuna: e' il loro mestiere, non un
// difetto. L'altra esenzione, stessaFila, arriva dal registro: file di tribune,
// edifici del paddock e pile di gomme si toccano per costruzione.
function coppiaLecita(a, b) {
    const tribuna = (v) => v.category === 'grandstand' || v.category === 'grandstand-main';
    const rete = (v) => v.asset === 'catchFence';
    return (rete(a) && tribuna(b)) || (rete(b) && tribuna(a));
}

const PISTE = fs.readdirSync(path.join(ROOT, 'frontend/tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

// Una pista si genera una volta sola: sono ~1000 oggetti per pista e cinque
// test per pista, e rigenerarla ogni volta rende la suite lenta senza dire
// niente di piu'.
const cache = new Map();
function scenografiaDi(id) {
    if (cache.has(id)) return cache.get(id);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', id + '.json'), 'utf8'));
    const t = loadTrack(id);
    const layout = TrackScenery.generateLayout(raw, t.points, t.pitLanePts,
        raw.roadHalfWidth + 2.8 + 1.2, 45, seats, t.barrierProfile, terraceAnchors,
        { gridSize: 6 });
    const dati = { raw, t, layout, solidi: layout.filter(v => !NON_SOLIDE.has(v.category) && v.asset) };
    cache.set(id, dati);
    return dati;
}

// Quanto un ingombro entra dentro un corridoio: la penetrazione massima di un
// suo ANGOLO oltre il bordo. Sugli angoli e non sul centro — il pennone ha il
// pivot sull'asta e il corpo sporge tutto da un lato.
function dentroIlCorridoio(item, punti, mezzaLarghezza) {
    let peggio = 0;
    for (const c of Sizes.footprintCorners(item)) {
        const dentro = mezzaLarghezza - TrackGeometry.nearestPoint(punti, c.x, c.z).dist;
        if (dentro > peggio) peggio = dentro;
    }
    return peggio;
}

// Profondita' di compenetrazione: il minimo spostamento che separerebbe i due
// rettangoli orientati (asse di minima sovrapposizione del test SAT). Serve la
// PROFONDITA' e non un si/no: una fila di tribune o una corsa di reti si tocca
// per costruzione, e senza la profondita' il test sarebbe rumore.
function profondita(a, b) {
    const A = Sizes.footprintCorners(a), B = Sizes.footprintCorners(b);
    let minimo = Infinity;
    for (const poly of [A, B]) {
        for (let i = 0; i < poly.length; i++) {
            const j = (i + 1) % poly.length;
            let nx = -(poly[j].z - poly[i].z), nz = poly[j].x - poly[i].x;
            const len = Math.hypot(nx, nz) || 1;
            nx /= len; nz /= len;
            let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
            for (const p of A) { const d = p.x * nx + p.z * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
            for (const p of B) { const d = p.x * nx + p.z * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
            if (maxA < minB || maxB < minA) return 0;
            const sovr = Math.min(maxA, maxB) - Math.max(minA, minB);
            if (sovr < minimo) minimo = sovr;
        }
    }
    return minimo === Infinity ? 0 : minimo;
}

// Coppie candidate, via griglia spaziale: senza, sono 1000^2 confronti per pista.
function coppieVicine(solidi) {
    const cella = 60, griglia = new Map();
    const chiavi = (v) => {
        const r = Sizes.footprintRadius(v.asset) * Math.max(1, v.scale || 1);
        const out = [];
        for (let i = Math.floor((v.x - r) / cella); i <= Math.floor((v.x + r) / cella); i++)
            for (let j = Math.floor((v.z - r) / cella); j <= Math.floor((v.z + r) / cella); j++)
                out.push(i + ',' + j);
        return out;
    };
    solidi.forEach((v, i) => { for (const k of chiavi(v)) { if (!griglia.has(k)) griglia.set(k, []); griglia.get(k).push(i); } });
    const out = [];
    solidi.forEach((v, i) => {
        const visti = new Set();
        for (const k of chiavi(v)) for (const j of (griglia.get(k) || [])) {
            if (j <= i || visti.has(j)) continue;
            visti.add(j);
            out.push([v, solidi[j]]);
        }
    });
    return out;
}

for (const id of PISTE) {
    test(`${id}: nessun oggetto scenico dentro la carreggiata`, () => {
        const { raw, t, solidi } = scenografiaDi(id);
        const colpevoli = solidi
            .filter(v => !SCAVALCANO.has(v.asset))
            .map(v => ({ v, p: dentroIlCorridoio(v, t.points, raw.roadHalfWidth) }))
            .filter(x => x.p > MAX_DENTRO_PISTA)
            .map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`);
        assert.deepEqual(colpevoli, []);
    });

    // La via di fuga E' pista per chi guida: i due container di monte-rosso
    // stavano a 13.8 dall'asse con la carreggiata a 11 e il muro a 15, e
    // l'utente li ha segnalati come «dentro la pista». Il muro non e' a
    // distanza fissa, quindi si chiede dov'e' campione per campione.
    test(`${id}: niente dentro la via di fuga, tranne chi ci sta per mestiere`, () => {
        const { raw, t, solidi } = scenografiaDi(id);
        const colpevoli = solidi
            .filter(v => !SCAVALCANO.has(v.asset) && !A_BORDO_PISTA.has(v.category))
            .map(v => {
                let peggio = 0;
                for (const c of Sizes.footprintCorners(v)) {
                    const near = TrackGeometry.nearestPoint(t.points, c.x, c.z);
                    const p = t.points[near.index];
                    const n = TrackGeometry.normalAt(t.points, near.index, true);
                    const lato = Math.sign((c.x - p.x) * n.nx + (c.z - p.z) * n.nz) || 1;
                    const muro = t.barrierProfile
                        ? TrackGravel.barrierAt(t.barrierProfile, near.index, lato)
                        : raw.roadHalfWidth + 4;
                    const d = muro - near.dist;
                    if (d > peggio) peggio = d;
                }
                return { v, p: peggio };
            })
            .filter(x => x.p > MAX_DENTRO_PISTA)
            .map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`);
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: nessun oggetto scenico dentro la corsia box`, () => {
        const { raw, t, solidi } = scenografiaDi(id);
        if (!t.pitLanePts || !t.pitLanePts.length) return;
        const colpevoli = solidi
            .filter(v => !SCAVALCANO.has(v.asset))
            .map(v => ({ v, p: dentroIlCorridoio(v, t.pitLanePts, raw.pit.roadHalfWidth) }))
            .filter(x => x.p > MAX_DENTRO_BOX)
            .map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`);
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: nessuna compenetrazione oltre ${MAX_COMPENETRAZIONE} unita'`, () => {
        const { solidi } = scenografiaDi(id);
        const colpevoli = [];
        for (const [a, b] of coppieVicine(solidi)) {
            if (coppiaLecita(a, b) || stessaFila(a, b)) continue;
            if (!Sizes.itemsOverlap(a, b)) continue;
            const p = profondita(a, b);
            if (p > MAX_COMPENETRAZIONE) {
                colpevoli.push(`${a.category}/${a.asset} × ${b.category}/${b.asset} per ${p.toFixed(2)} a (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
            }
        }
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: il ponte dei semafori sta davanti alla griglia`, () => {
        // Porta i semafori di partenza: se scivola in avanti il giocatore non
        // vede piu' il via. Misurato il 2026-08-24: melbourne 226 unita'
        // invece di 75, shanghai 135.
        const { raw, t, layout } = scenografiaDi(id);
        const gantry = layout.find(v => v.asset === 'startGantry');
        assert.ok(gantry, 'ogni tracciato deve avere il ponte dei semafori');
        const n = t.points.length;
        const iGrid = raw.startFinish
            ? TrackGeometry.nearestPoint(t.points, raw.startFinish.x, raw.startFinish.z).index : 0;
        const iGantry = TrackGeometry.nearestPoint(t.points, gantry.x, gantry.z).index;
        const avanti = ((iGantry - iGrid) % n + n) % n;
        const unita = avanti / n * TrackGeometry.lapLength(t.points);
        assert.ok(Math.abs(unita - 75) <= FINESTRA_GANTRY,
            `il ponte semafori sta a ${unita.toFixed(0)} unita' dalla griglia, attese 75 ± ${FINESTRA_GANTRY}`);
    });

    // NESSUNO SPETTATORE SENZA LA SUA TRIBUNA. La folla si costruisce prima
    // della porta e passa senza ingombro: se la porta scarta la tribuna dopo,
    // i suoi spettatori restano a mezz'aria. E' lo stesso difetto degli
    // orfani gia' chiuso per le reti — e l'utente l'ha visto in gioco su
    // shanghai, davanti al traguardo (2026-08-24). Misurato: 173 su
    // melbourne, 120 su shanghai, 28 su test.
    test(`${id}: nessuno spettatore senza la sua tribuna`, () => {
        const { layout } = scenografiaDi(id);
        const sorgenti = layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main'
            || v.asset === 'hospitalityDeck' || v.asset === 'vipSuite');
        // 15 unita': una tribuna e' 19.2 x 12.8, quindi dal suo centro nessun
        // sedile dista di piu'. Chi supera questa soglia non e' seduto da
        // nessuna parte.
        const orfani = layout.filter(v => v.category === 'crowd')
            .filter(s => !sorgenti.some(g => Math.hypot(g.x - s.x, g.z - s.z) < 15));
        assert.equal(orfani.length, 0,
            orfani.length ? `${orfani.length} spettatori a mezz'aria, es. (${orfani[0].x.toFixed(0)}, ${orfani[0].z.toFixed(0)})` : '');
    });

    test(`${id}: ogni tribuna ha la sua rete`, () => {
        // Il difetto non e' che la rete manchi: e' che tribuna e rete possano
        // esistere separatamente. Misurato il 2026-08-24: melbourne 15 tribune
        // scoperte su 110.
        const { layout } = scenografiaDi(id);
        const reti = layout.filter(v => v.asset === 'catchFence');
        const posizioni = new Set();
        for (const s of layout) {
            if (s.category !== 'grandstand' && s.category !== 'grandstand-main') continue;
            posizioni.add(s.x.toFixed(2) + ',' + s.z.toFixed(2));
        }
        const scoperte = [...posizioni].filter(k => {
            const [x, z] = k.split(',').map(Number);
            return !reti.some(r => Math.hypot(r.x - x, r.z - z) < 20);
        });
        assert.deepEqual(scoperte, []);
    });
}

// L'INGOMBRO DICHIARATO E' QUELLO VERO. Un asset senza riga in
// sceneryAssetSizes non fa rumore: viene giudicato col FALLBACK 6x6x6, e da
// lì la porta decide su un oggetto che non esiste. E' cosi' che i due
// container sono finiti dentro la pista di monte-rosso il 2026-08-24 — il
// modello vero e' 7.7 x 3.4, giudicato 6 x 6 entrava in carreggiata di 0.40
// (sotto la soglia di 0.5, quindi «a posto») mentre in gioco ne entrava 1.16.
//
// Il test enumera gli asset che il layout PIAZZA DAVVERO, su tutte le piste:
// un asset nuovo e' coperto il giorno che qualcuno lo mette in scena, senza
// che nessuno debba ricordarsi di aggiungerlo qui.
// La campata di un portale si dimensiona sul PIEDE, non sul fusto. Il numero
// scritto in sceneryLandmarks deve essere quello del modello: se qualcuno
// rigenera il .glb con plinti diversi, questo test lo dice prima che un
// pilastro finisca nella barriera.
test('la semiluce dei portali e quella del loro PIEDE, misurata sul .glb', () => {
    const { luceInterna } = require(path.join(ROOT, 'backend/tools/glbInspect.js'));
    const Landmarks = require('./sceneryLandmarks.js');
    // yMax: solo la parte bassa. Piu' su la campata passa sopra la pista, ed
    // e' il suo mestiere.
    const gantry = luceInterna(path.join(ROOT, 'frontend/assets/custom/circuit/startGantry.glb'), 2);
    const passerella = luceInterna(path.join(ROOT, 'frontend/assets/custom/circuit/footbridge.glb'), 1.5);
    assert.equal(Landmarks.GANTRY_NATIVE_HALF_SPAN, gantry.semiluce,
        `il ponte semafori poggia a ${gantry.semiluce} dall'asse, non a ${Landmarks.GANTRY_NATIVE_HALF_SPAN}`);
    assert.equal(Landmarks.FOOTBRIDGE_NATIVE_HALF_SPAN, passerella.semiluce,
        `la passerella poggia a ${passerella.semiluce} dall'asse, non a ${Landmarks.FOOTBRIDGE_NATIVE_HALF_SPAN}`);
});

test('ogni asset piazzato ha un ingombro dichiarato, e coincide col .glb', () => {
    const { inspectGlb } = require(path.join(ROOT, 'backend/tools/glbInspect.js'));
    const usati = new Set();
    for (const id of PISTE) for (const v of scenografiaDi(id).layout) if (v.asset) usati.add(v.asset);

    const senzaTaglia = [], scostati = [];
    for (const asset of [...usati].sort()) {
        const dich = Sizes.sizeOf(asset);
        const file = path.join(ROOT, 'frontend/assets/custom/circuit', asset + '.glb');
        if (!fs.existsSync(file)) continue;   // asset non custom: niente da misurare
        const [w, h, d] = inspectGlb(file).size;
        // Il fallback e' 6x6x6: un asset che lo riceve non e' dichiarato.
        if (dich.w === 6 && dich.h === 6 && dich.d === 6 && Math.abs(w - 6) + Math.abs(d - 6) > 0.2) {
            senzaTaglia.push(`${asset} (vero ${w.toFixed(1)} x ${d.toFixed(1)}, h ${h.toFixed(1)})`);
            continue;
        }
        if (Math.abs(dich.w - w) > 0.2 || Math.abs(dich.d - d) > 0.2 || Math.abs(dich.h - h) > 0.2) {
            scostati.push(`${asset}: dichiarato ${dich.w} x ${dich.d} (h ${dich.h}), misurato ${w.toFixed(1)} x ${d.toFixed(1)} (h ${h.toFixed(1)})`);
        }
    }
    assert.deepEqual(senzaTaglia, [], 'asset piazzati senza ingombro dichiarato');
    assert.deepEqual(scostati, [], 'ingombro dichiarato diverso dal modello');
});
