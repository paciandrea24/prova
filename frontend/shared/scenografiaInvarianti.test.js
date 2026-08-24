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

// Le reti nascono attaccate alla loro tribuna: e' il loro mestiere, non un
// difetto. Nessun'altra coppia e' esentata.
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
            .map(v => ({ v, p: dentroIlCorridoio(v, t.points, raw.roadHalfWidth) }))
            .filter(x => x.p > MAX_DENTRO_PISTA)
            .map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`);
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: nessun oggetto scenico dentro la corsia box`, () => {
        const { raw, t, solidi } = scenografiaDi(id);
        if (!t.pitLanePts || !t.pitLanePts.length) return;
        const colpevoli = solidi
            .map(v => ({ v, p: dentroIlCorridoio(v, t.pitLanePts, raw.pit.roadHalfWidth) }))
            .filter(x => x.p > MAX_DENTRO_BOX)
            .map(x => `${x.v.category}/${x.v.asset} a (${x.v.x.toFixed(1)}, ${x.v.z.toFixed(1)}) dentro di ${x.p.toFixed(2)}`);
        assert.deepEqual(colpevoli, []);
    });

    test(`${id}: nessuna compenetrazione oltre ${MAX_COMPENETRAZIONE} unita'`, () => {
        const { solidi } = scenografiaDi(id);
        const colpevoli = [];
        for (const [a, b] of coppieVicine(solidi)) {
            if (coppiaLecita(a, b)) continue;
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
