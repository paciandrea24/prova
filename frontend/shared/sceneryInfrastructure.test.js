const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const TrackGeometry = require('./trackGeometry.js');
const TrackGravel = require('./trackGravel.js');
const SceneryAssetSizes = require('./sceneryAssetSizes.js');
const SceneryInfrastructure = require('./sceneryInfrastructure.js');

// Lo stesso circuito vero usato dagli altri test di scenografia, con gli
// stessi campionamenti del caricatore di pista.
function circuitoVero(id) {
    const raw = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    const trackPts = TrackGeometry.sampleLoop(raw.controlPoints, 1000);
    const pitPath = TrackGeometry.snapPitPathEnds(raw.pit.path, trackPts, raw.roadHalfWidth);
    const pitLanePts = TrackGeometry.sampleOpenPath(pitPath, 300);
    const barrierProfile = TrackGravel.barrierProfile(trackPts, {
        roadHalf: raw.roadHalfWidth, pitLanePts, pitRoadHalf: raw.pit.roadHalfWidth });
    return { raw, trackPts, pitLanePts, barrierProfile,
             barrierDist: raw.roadHalfWidth + 2.8 + 1.2 };
}

function contesto(id, extra) {
    const c = circuitoVero(id);
    return Object.assign({
        trackPts: c.trackPts, pitPts: c.pitLanePts, barrierDist: c.barrierDist,
        pitRoadHalf: c.raw.pit.roadHalfWidth, embankStart: c.barrierDist, embankOuter: 45,
        barrierProfile: c.barrierProfile, accepted: [], grandstands: [], spanning: [],
        insidePlayerBoxFootprint: () => false, playerBoxFootprints: [],
        fitsUnderBridge: () => true, rng: () => 0.5, palette: [],
    }, extra || {});
}

test('con la palette vuota non posa niente', () => {
    const out = SceneryInfrastructure.buildInfrastructure(contesto('prova'));
    assert.equal(out.length, 0, 'palette vuota deve produrre zero voci');
});

test('il contesto riconosce il viadotto e ne misura il dislivello', () => {
    const ctx = contesto('prova');
    // I campioni 417-614 di prova sono sopraelevati, fino a 11.5 sul terreno.
    const sopra = SceneryInfrastructure.contestoAl(ctx, 480, 1);
    assert.ok(sopra.viadotto, 'il campione 480 di prova è su viadotto');
    assert.ok(sopra.dislivello > 5,
        `dislivello atteso sopra 5, misurato ${sopra.dislivello.toFixed(1)}`);

    const terra = SceneryInfrastructure.contestoAl(ctx, 0, 1);
    assert.ok(!terra.viadotto, 'il traguardo di prova non è su viadotto');
    assert.ok(terra.dislivello < 1, 'a terra il dislivello è ~0');
});

test('il contesto riconosce l\'esterno di una curva', () => {
    const ctx = contesto('prova');
    // ⚠️ findCorners restituisce in `side` il lato ESTERNO. La curva
    // 126-144 di prova ha side -1, quindi lì l'esterno è il lato -1.
    const fuori = SceneryInfrastructure.contestoAl(ctx, 135, -1);
    assert.ok(fuori.curva, 'il campione 135 di prova sta dentro una curva');
    assert.ok(fuori.esterno, 'lato -1 al campione 135 è l\'esterno');
    const dentro = SceneryInfrastructure.contestoAl(ctx, 135, 1);
    assert.ok(!dentro.esterno, 'lato +1 al campione 135 è l\'interno');
});

test('il muro del contesto è quello del lato giusto', () => {
    const ctx = contesto('prova');
    for (const idx of [0, 300, 700]) {
        for (const lato of [1, -1]) {
            const c = SceneryInfrastructure.contestoAl(ctx, idx, lato);
            assert.equal(c.muro, TrackGravel.barrierAt(ctx.barrierProfile, idx, lato),
                `il muro al campione ${idx} lato ${lato} deve venire da barrierAt con quel lato`);
        }
    }
});

test('senza profilo del muro si ripiega sulla barriera storica', () => {
    const ctx = contesto('prova', { barrierProfile: null });
    const c = SceneryInfrastructure.contestoAl(ctx, 0, 1);
    assert.equal(c.muro, ctx.barrierDist,
        'chi non conosce le vie di fuga deve continuare a funzionare');
});

// ---- la camminata e i sette vincoli ----
//
// Palette di prova fatta di asset che ESISTONO GIÀ: nessuna modellazione, ma
// basta a mettere sotto test tutta la macchina. Gli otto modelli nuovi della
// spec entreranno qui uno per volta col piano 2.
const PALETTE_ESISTENTI = [
    { asset: 'pylon',        contesti: ['rettilineo', 'viadotto'], passoMinimo: 400 },
    { asset: 'flagPole',     contesti: ['curvaEsterno', 'stretto'], passoMinimo: 200 },
    { asset: 'billboardLow', contesti: ['rettilineo', 'stretto'],  passoMinimo: 150 },
];

const TRACCIATI = ['prova', 'new-monza', 'monte-rosso', 'baku'];

test('con una palette vera posa qualcosa su tutti i tracciati', () => {
    for (const id of TRACCIATI) {
        const out = SceneryInfrastructure.buildInfrastructure(
            contesto(id, { palette: PALETTE_ESISTENTI }));
        assert.ok(out.length >= 5, `${id}: solo ${out.length} infrastrutture posate`);
        for (const v of out) {
            assert.equal(v.category, 'infrastructure');
            assert.equal(v.suMisuraSulMuro, true,
                'senza il flag, traslaOltreLaGhiaia le sposterebbe una seconda volta');
        }
    }
});

test('niente si compenetra fra le infrastrutture stesse', () => {
    for (const id of TRACCIATI) {
        const out = SceneryInfrastructure.buildInfrastructure(
            contesto(id, { palette: PALETTE_ESISTENTI }));
        for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                assert.ok(!SceneryAssetSizes.itemsOverlap(out[i], out[j]),
                    `${id}: ${out[i].asset} e ${out[j].asset} si compenetrano`);
            }
        }
    }
});

test('niente si compenetra con le strutture già accettate', () => {
    for (const id of TRACCIATI) {
        // Un ostacolo finto piantato al campione 0, largo e profondo: se il
        // modulo non guarda `accepted`, ci finisce dentro.
        const c = circuitoVero(id);
        const p = c.trackPts[0];
        const nrm = TrackGeometry.normalAt(c.trackPts, 0, true);
        const d = 30;
        const ostacolo = { asset: 'pitsOffice', category: 'paddock',
                           x: p.x + nrm.nx * d, y: 0, z: p.z + nrm.nz * d, rotY: 0, scale: 1 };
        const out = SceneryInfrastructure.buildInfrastructure(
            contesto(id, { palette: PALETTE_ESISTENTI, accepted: [ostacolo] }));
        for (const v of out) {
            assert.ok(!SceneryAssetSizes.itemsOverlap(v, ostacolo),
                `${id}: ${v.asset} finisce dentro l'ostacolo piantato al campione 0`);
        }
    }
});

test('ogni infrastruttura guarda la pista che ha davanti', () => {
    for (const id of TRACCIATI) {
        const ctx = contesto(id, { palette: PALETTE_ESISTENTI });
        for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
            assert.ok(TrackGeometry.guardaVersoLaPista(ctx.trackPts, v),
                `${id}: ${v.asset} non guarda la pista`);
        }
    }
});

test('nessun angolo finisce dentro la via di fuga', () => {
    for (const id of TRACCIATI) {
        const ctx = contesto(id, { palette: PALETTE_ESISTENTI });
        for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
            for (const k of SceneryAssetSizes.footprintCorners(v)) {
                const q = TrackGeometry.nearestPoint(ctx.trackPts, k.x, k.z);
                const nrm = TrackGeometry.normalAt(ctx.trackPts, q.index, true);
                const lato = Math.sign((k.x - ctx.trackPts[q.index].x) * nrm.nx +
                                       (k.z - ctx.trackPts[q.index].z) * nrm.nz) || 1;
                const dentro = TrackGravel.barrierAt(ctx.barrierProfile, q.index, lato) - q.dist;
                assert.ok(dentro <= 0,
                    `${id}: un angolo di ${v.asset} è dentro la ghiaia di ${dentro.toFixed(2)}`);
            }
        }
    }
});

test('accanto a un tratto sopraelevato solo ciò che è più alto del dislivello', () => {
    const ctx = contesto('prova', { palette: PALETTE_ESISTENTI });
    let visti = 0;
    for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
        const q = TrackGeometry.nearestPoint(ctx.trackPts, v.x, v.z);
        const c = SceneryInfrastructure.contestoAl(ctx, q.index, 1);
        if (!c.viadotto) continue;
        visti++;
        const alto = SceneryAssetSizes.sizeOf(v.asset).h;
        assert.ok(alto > c.dislivello,
            `${v.asset} è alto ${alto} accanto a un viadotto di ${c.dislivello.toFixed(1)}`);
    }
    assert.ok(visti > 0, 'su prova qualcosa deve pur finire accanto al viadotto');
});

test('niente nella fascia davanti a una tribuna', () => {
    const c = circuitoVero('prova');
    // Una tribuna finta al campione 200, alla distanza a cui stanno le vere.
    const p = c.trackPts[200];
    const nrm = TrackGeometry.normalAt(c.trackPts, 200, true);
    const d = TrackGravel.barrierAt(c.barrierProfile, 200, 1) + 10;
    const tx = p.x + nrm.nx * d, tz = p.z + nrm.nz * d;
    const tribuna = { asset: 'grandStandCovered', category: 'grandstand',
                      x: tx, y: 0, z: tz, scale: 1,
                      rotY: Math.atan2(p.x - tx, p.z - tz) };
    const ctx = contesto('prova', { palette: PALETTE_ESISTENTI, grandstands: [tribuna] });
    for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
        const co = Math.cos(tribuna.rotY), si = Math.sin(tribuna.rotY);
        const dx = v.x - tribuna.x, dz = v.z - tribuna.z;
        const du = dx * co - dz * si, df = dx * si + dz * co;
        const meta = (SceneryAssetSizes.sizeOf(tribuna.asset).w
                    + SceneryAssetSizes.sizeOf(v.asset).w) / 2;
        assert.ok(!(Math.abs(du) <= meta && df > 0 && df <= 22),
            `${v.asset} è nella fascia davanti alla tribuna `
            + `(du ${du.toFixed(1)}, df ${df.toFixed(1)})`);
    }
});

test('niente sotto una campata che scavalca la pista', () => {
    const c = circuitoVero('prova');
    const p = c.trackPts[300];
    const tg = TrackGeometry.tangentAt(c.trackPts, 300, true);
    const campata = { asset: 'startGantry', category: 'landmark',
                      x: p.x, y: 0, z: p.z,
                      rotY: Math.atan2(tg.tx, tg.tz) + Math.PI, scale: 1.5 };
    const ctx = contesto('prova', { palette: PALETTE_ESISTENTI, spanning: [campata] });
    for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
        assert.ok(!SceneryAssetSizes.itemsOverlap(v, campata),
            `${v.asset} finisce dentro la campata`);
    }
});

test('niente dentro la corsia box', () => {
    for (const id of TRACCIATI) {
        const ctx = contesto(id, { palette: PALETTE_ESISTENTI });
        for (const v of SceneryInfrastructure.buildInfrastructure(ctx)) {
            const d = TrackGeometry.nearestPoint(ctx.pitPts, v.x, v.z).dist;
            assert.ok(d > ctx.pitRoadHalf,
                `${id}: ${v.asset} è a ${d.toFixed(1)} dall'asse della corsia box`);
        }
    }
});

test('lo stesso tracciato dà sempre lo stesso layout', () => {
    const a = SceneryInfrastructure.buildInfrastructure(
        contesto('prova', { palette: PALETTE_ESISTENTI }));
    const b = SceneryInfrastructure.buildInfrastructure(
        contesto('prova', { palette: PALETTE_ESISTENTI }));
    assert.deepEqual(a, b, 'il layout deve essere deterministico');
});

// ---- la tassonomia dei contesti ----
//
// Il playtest del 2026-08-13 ha bocciato la distribuzione, e la causa non era
// solo la palette di segnaposto: 'stretto' era il ripiego di ogni punto che
// non fosse viadotto, curva esterna o visuale lunga — il 34% di prova e il 55%
// di monte-rosso. Un asset che lo dichiarava finiva ovunque.

test('stretto vuol dire muro sottile, non "tutto il resto"', () => {
    const ctx = contesto('prova');
    let stretti = 0, larghi = 0;
    for (let i = 0; i < ctx.trackPts.length; i += 5) {
        for (const lato of [1, -1]) {
            const c = SceneryInfrastructure.contestoAl(ctx, i, lato);
            if (c.viadotto) continue;
            const et = SceneryInfrastructure.etichette(c);
            if (et.indexOf('stretto') >= 0) {
                stretti++;
                assert.ok(c.muro <= SceneryInfrastructure.MURO_STRETTO,
                    `stretto con muro ${c.muro.toFixed(1)}, sopra la soglia`);
            } else {
                larghi++;
                assert.ok(c.muro > SceneryInfrastructure.MURO_STRETTO,
                    `non stretto con muro ${c.muro.toFixed(1)}, sotto la soglia`);
            }
        }
    }
    assert.ok(stretti > 0 && larghi > 0, 'servono entrambi i casi per dire qualcosa');
});

test('nessun contesto è il ripiego di mezzo circuito', () => {
    // La soglia è al 50%. Il vecchio 'stretto' stava al 55% su monte-rosso, ed
    // era un ripiego vero: veniva aggiunto in fondo a OGNI lista, a
    // prescindere dal punto. I massimi legittimi misurati il 2026-08-14 sono
    // 'rettilineo' al 48% su new-monza — un tracciato veloce ha davvero
    // visuale lunga su metà giro — e 'aperto' al 39% su monte-rosso.
    for (const id of ['prova', 'new-monza', 'monte-rosso']) {
        const ctx = contesto(id);
        const conta = new Map();
        let punti = 0;
        for (let i = 0; i < ctx.trackPts.length; i += 5) {
            for (const lato of [1, -1]) {
                const et = SceneryInfrastructure.etichette(
                    SceneryInfrastructure.contestoAl(ctx, i, lato));
                conta.set(et[0], (conta.get(et[0]) || 0) + 1);
                punti++;
            }
        }
        for (const [gruppo, n] of conta) {
            // Il viadotto è esente: su baku è il 90% del giro per costruzione,
            // ed è un fatto del tracciato, non una scelta di tassonomia.
            if (gruppo === 'viadotto') continue;
            assert.ok(n / punti <= 0.50,
                `${id}: il contesto ${gruppo} copre il ${(n / punti * 100).toFixed(0)}% del giro`);
        }
    }
});

test('il viadotto e il muro sottile non hanno ripieghi, i tratti larghi sì', () => {
    const viadotto = { viadotto: true, muro: 30, curva: false, esterno: false, visuale: true };
    assert.deepEqual(SceneryInfrastructure.etichette(viadotto), ['viadotto'],
        'accanto al viadotto vale il vincolo di altezza e nient\'altro');
    const stretto = { viadotto: false, muro: 14, curva: true, esterno: true, visuale: true };
    assert.deepEqual(SceneryInfrastructure.etichette(stretto), ['stretto'],
        'col muro sottile non c\'è spazio per gli asset dei tratti larghi');
    const curva = { viadotto: false, muro: 30, curva: true, esterno: true, visuale: false };
    assert.deepEqual(SceneryInfrastructure.etichette(curva), ['curvaEsterno', 'aperto'],
        'sui tratti larghi "aperto" fa da rete se lo specifico non entra');
    const dritto = { viadotto: false, muro: 30, curva: false, esterno: false, visuale: true };
    assert.deepEqual(SceneryInfrastructure.etichette(dritto), ['rettilineo', 'aperto']);
    const altro = { viadotto: false, muro: 30, curva: false, esterno: false, visuale: false };
    assert.deepEqual(SceneryInfrastructure.etichette(altro), ['aperto']);
});
