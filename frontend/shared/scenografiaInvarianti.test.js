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
const TrackValidatore = require('./trackValidatore.js');
const TrackGravel = require('./trackGravel.js');
const CittaProfilo = require('./cittaProfilo.js');
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
    // Due moduli di facciata si toccano per costruzione: sono le colonne di uno
    // stesso muro, impilate e affiancate. In curva, per giunta, due colonne
    // adiacenti sono anche RUOTATE l'una rispetto all'altra e i loro spigoli si
    // incrociano pur avendo i centri alla distanza giusta — lo stesso fenomeno
    // già documentato per gli edifici della corsia box.
    if (a.category === 'citta' && b.category === 'citta') return true;
    // Due fette del palazzo dei box sono lo STESSO edificio, accostate a passo
    // 7.5 mentre ne misurano 7.3. Sul lato interno di una curva l'arco si
    // accorcia e le due si incastrano: misurati 2.88 su new-monza. Non e' un
    // difetto da correggere ma la sola alternativa a un buco nella facciata —
    // e fra due volumi identici e dello stesso colore non si vede nulla, al
    // contrario di una fessura. Stessa ragione delle colonne di citta'.
    const palazzo = (v) => v.category === 'paddock-club' && /^pitClub/.test(v.asset);
    if (palazzo(a) && palazzo(b)) return true;
    // Il RETRO del palazzo contro le facciate della citta'. Il nastro che
    // chiude la vista corre proprio dietro la corsia box, e il palazzo e'
    // profondo 22: su citta-prova si sovrappongono di 2.9 dal lato che nessuno
    // guarda. In un circuito cittadino vero il pit building e' addossato agli
    // edifici, ed e' esattamente quello che si vede.
    if ((palazzo(a) && b.category === 'citta') || (palazzo(b) && a.category === 'citta')) return true;
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



    // ⚠️ QUESTI CONTROLLI NON VIVONO PIU' QUI: stanno in trackValidatore.js, e
    // il pulsante «Controlla la pista» dell'editor usa la stessa funzione.
    // Erano quattro test con le loro misure — oggetti in carreggiata, in via
    // di fuga, in corsia box, spettatori orfani — e una copia delle misure
    // avrebbe finito per divergere: un giorno il test avrebbe detto una cosa e
    // il pulsante un'altra, e non si sarebbe saputo a chi credere.
    test(`${id}: il validatore non trova difetti di scenografia`, () => {
        const { raw, t, layout } = scenografiaDi(id);
        const barrierDist = raw.roadHalfWidth + 2.8 + 1.2;
        const problemi = TrackValidatore.controllaScenografia(raw, layout, {
            trackPts: t.points, pitPts: t.pitLanePts,
            barrierProfile: t.barrierProfile, barrierDist,
        }).problemi.filter(p => p.livello !== 'da sapere');
        assert.deepEqual(problemi.map(p => `${p.codice}: ${p.messaggio}`), []);
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


    test(`${id}: in citta' non nasce il paddock esterno`, () => {
        // ⚠️ Mezzi, container e parcheggio stanno fra le 58 e le 210 unita'
        // dalla corsia box, cioe' DIETRO le facciate: invisibili, e pagati a
        // ogni frame. Decisione dell'utente il 2026-08-27: «se tanto e' dietro
        // gli edifici non lo vediamo mai». Gli striscioni invece restano —
        // quelli stanno sul marciapiede, davanti ai palazzi.
        const { t, layout } = scenografiaDi(id);
        if (t.ambientazione !== 'citta') return;
        const LONTANI = new Set(['motorhome', 'truck', 'containerStack',
                                 'parkedCarRed', 'parkedCarBlue', 'parkedCarWhite']);
        // ⚠️ Per CATEGORIA e non solo per asset: le auto parcheggiate del
        // marciapiede sono gli stessi modelli di quelle del parcheggio del
        // paddock, ma stanno in strada, davanti ai palazzi, e ci devono stare.
        const trovati = layout.filter(v => v.category !== 'strada'
            && (LONTANI.has(v.asset) || v.category === 'parkingLot'));
        assert.deepEqual([...new Set(trovati.map(v => v.asset || v.category))], []);
        // E i garage della corsia box non c'entrano: quelli si vedono eccome.
        assert.ok(layout.some(v => v.asset === 'pitsGarageClosed' || v.asset === 'pitsOffice'),
            'gli edifici della corsia box non vanno tolti');
    });

    test(`${id}: in citta' non c'e' l'arredo da circuito permanente`, () => {
        // Elenco dettato dall'utente il 2026-08-27: «dovremmo levare gli asset
        // superflui dalle piste cittadine, tipo i cartelloni, le bandiere a
        // scacchi, la torre, il gazebo, le bandierine». Sono oggetti che in
        // mezzo ai palazzi si leggono come capitati li' per sbaglio.
        //
        // ⚠️ QUESTO ASSERT E' STATO ROVESCIATO. Nella prima stesura pretendeva
        // che la `raceControlTower` RESTASSE, perche' «la torre» era stata
        // letta come il pennone col pannello sponsor (`pylon`). L'utente ha
        // corretto lo stesso giorno: «io intendevo di rimuovere la torre di
        // direzione gara (e' ancora rimasta)», e insieme «anche il podio
        // secondo me non ci sta in ambiente cittadino».
        const { t, layout } = scenografiaDi(id);
        if (t.ambientazione !== 'citta') return;
        const FUORI = ['billboard', 'billboardLow', 'flagPole', 'pylon', 'paddockTent',
                       'banner', 'raceControlTower', 'podium'];
        assert.deepEqual(layout.filter(v => FUORI.includes(v.asset)).map(v => v.asset), []);
        // Il ponte dei semafori invece resta, ed e' l'unico landmark che resta:
        // porta il via, senza non si legge la partenza.
        assert.ok(layout.some(v => v.asset === 'startGantry'),
            'il ponte dei semafori porta il via e non si toglie mai');
    });

    test(`${id}: in citta', niente di bordo pista finisce dentro una facciata`, () => {
        // ⚠️ SEGNALAZIONE DELL'UTENTE, 2026-08-27: «nella pista di prova dei
        // circuiti cittadini (e probabilmente anche negli altri che costruiro'
        // in futuro) la corsia dei box e' fatta male, perche' si entra
        // attraverso edifici». Il test sta QUI, fra le invarianti che girano su
        // ogni pista della cartella, proprio per il «anche negli altri»: una
        // pista cittadina nuova e' coperta il giorno che la si salva.
        //
        // Si guarda la roba che deve restare DAVANTI ai palazzi — tribune,
        // reti, torrette, cartelli, il podio, il ponte dei semafori — e la si
        // misura contro il profilo della citta'. Il paddock lontano e il
        // parcheggio non entrano nel conto: quelli stanno dietro la citta', e
        // in citta' andranno tolti del tutto (fase G2).
        const { t, layout } = scenografiaDi(id);
        if (t.ambientazione !== 'citta') return;
        const prof = CittaProfilo.profilo(t.points, t.barrierProfile, {
            pitLanePts: t.pitLanePts,
            pitRoadHalf: t.pitRoadHalf,
            startFinishIndex: t.startFinishIndex,
        });
        // `strada` e' l'arredo urbano del marciapiede: sta fra il muro e i
        // palazzi, quindi vale per lui come per le tribune — davanti, mai
        // dentro.
        const DAVANTI = new Set(['grandstand', 'grandstand-main', 'safety', 'trackside',
                                 'marshal', 'landmark', 'strada']);
        let controllati = 0;
        const dentro = [];
        for (const v of layout) {
            if (!v.asset || !DAVANTI.has(v.category)) continue;
            const angoli = Sizes.footprintCorners(v);
            if (!angoli || !angoli.length) continue;
            controllati++;
            for (const a of angoli) {
                const i = TrackGeometry.nearestPoint(t.points, a.x, a.z).index;
                const nrm = TrackGeometry.normalAt(t.points, i, true);
                const proj = (a.x - t.points[i].x) * nrm.nx + (a.z - t.points[i].z) * nrm.nz;
                const facciata = prof.distanza[i * 2 + (proj >= 0 ? 0 : 1)];
                if (Math.abs(proj) - facciata > MAX_COMPENETRAZIONE) {
                    dentro.push(`${v.asset} a ${(Math.abs(proj) - facciata).toFixed(1)} dentro il palazzo`);
                    break;
                }
            }
        }
        assert.ok(controllati > 50, `solo ${controllati} oggetti di bordo pista: il caso di prova e' vuoto`);
        assert.deepEqual(dentro, []);
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

// ═══════════ Le gomme stanno dove si sbatte, e nulla sta davanti a loro ═══════════
//
// Dal 2026-09-04 le pile di pneumatici non sono piu' decorazione dietro il
// muro: sono l'ostacolo su cui l'auto si ferma (spec 2026-09-04). Da qui
// nascono due promesse su ogni pista.

// Il lato del nastro su cui sta un oggetto, nella convenzione di segno del
// profilo e della fisica.
function latoDi(trackPts, idx, x, z) {
    const nrm = TrackGeometry.normalAt(trackPts, idx, true);
    return Math.sign((x - trackPts[idx].x) * nrm.nx + (z - trackPts[idx].z) * nrm.nz) || 1;
}

// ⚠️ Il campione PIU' VICINO a una pila non e' il campione da cui e' nata.
// All'esterno di una curva stretta l'arco si allarga, e la pila piu' esterna
// finisce piu' vicina a un campione del rettilineo che segue — dove il muro
// sta a 13 mentre lei sta a 27. Misurarla di li' fa gridare a un difetto che
// non c'e' (su `prova` dava uno scarto di 13.62). La domanda giusta e':
// ESISTE un campione col cuscinetto che la spiega esattamente?
function campioneCheLaSpiega(trackPts, profilo, g) {
    const meta = TrackGravel.PROFONDITA_GOMME / 2;
    for (let i = 0; i < trackPts.length; i++) {
        for (const side of [1, -1]) {
            const banda = side > 0 ? profilo.gomme.right : profilo.gomme.left;
            if (!banda[i]) continue;
            const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
            const d = TrackGravel.impattoAt(profilo, i, side) + meta;
            const dx = trackPts[i].x + nx * d * side - g.x;
            const dz = trackPts[i].z + nz * d * side - g.z;
            if (dx * dx + dz * dz < 0.01) return i;
        }
    }
    return -1;
}

test('ogni pila di gomme nasce da un campione col cuscinetto, al punto d\'impatto', () => {
    // Fino al 2026-09-04 stavano a barrierDist + 2.5, cioe' DIETRO il muro:
    // invisibili. La fila che si vede dev'essere la fila che ferma, e nascere
    // solo dove il profilo dichiara il cuscinetto.
    const orfane = [];
    for (const id of PISTE) {
        const { t, layout } = scenografiaDi(id);
        if (!t.barrierProfile || !t.barrierProfile.gomme) continue;
        for (const g of layout.filter(v => v.asset === 'tyreStack')) {
            if (campioneCheLaSpiega(t.points, t.barrierProfile, g) < 0) {
                const q = TrackGeometry.nearestPoint(t.points, g.x, g.z);
                orfane.push(`${id}: pila a (${g.x.toFixed(0)}, ${g.z.toFixed(0)}), ${q.dist.toFixed(2)} dal nastro`);
            }
        }
    }
    assert.deepEqual(orfane, []);
});

test('nessun oggetto di scenografia sta fra le gomme e il muro', () => {
    // La fascia fra il punto d'impatto e il muro e' larga 2.4 e la occupano le
    // gomme: un oggetto li' dentro comparirebbe DAVANTI a loro, in mezzo alla
    // via di fuga. La scenografia si dispone a partire dal muro, quindi la
    // fascia va lasciata libera da sola — se non lo e', e' un modulo che posa
    // a partire da un numero che non e' piu' il bordo buono.
    //
    // La tolleranza serve al BORDO: un cartello di frenata che finisce
    // esattamente sul muro (misurato su melbourne, scarto 0.00) sta dietro le
    // gomme, non dentro.
    const BORDO = 0.1;
    const dentro = [];
    for (const id of PISTE) {
        const { t, layout } = scenografiaDi(id);
        if (!t.barrierProfile || !t.barrierProfile.gomme) continue;
        for (const v of layout) {
            if (v.asset === 'tyreStack' || !v.asset) continue;
            const q = TrackGeometry.nearestPoint(t.points, v.x, v.z);
            const side = latoDi(t.points, q.index, v.x, v.z);
            const banda = side > 0 ? t.barrierProfile.gomme.right : t.barrierProfile.gomme.left;
            if (!banda[q.index]) continue;
            const impatto = TrackGravel.impattoAt(t.barrierProfile, q.index, side);
            const muro = TrackGravel.barrierAt(t.barrierProfile, q.index, side);
            if (q.dist > impatto + BORDO && q.dist < muro - BORDO) {
                dentro.push(`${id}: ${v.asset} a ${q.dist.toFixed(2)}, nel cuscinetto ${impatto.toFixed(2)}..${muro.toFixed(2)}`);
            }
        }
    }
    assert.deepEqual(dentro, []);
});
