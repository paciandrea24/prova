// frontend/shared/cittaProfilo.test.js
//
// ⚠️ Gira con `node --test frontend/shared/`, non con `node --test backend/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const CittaProfilo = require('./cittaProfilo.js');
const TrackGravel = require('./trackGravel.js');
const TrackGeometry = require('./trackGeometry.js');

// Un anello largo, con il suo muro vero: la città si posa su quello.
//
// ⚠️ 800 campioni e non 200: le piste vere ne hanno 1000 su un giro di
// 1200-2000 unità, cioè un campione ogni 1-2 unità. Con 200 campioni su un
// anello di 1900 il passo diventa 9.4, un palazzo dura quattro campioni e
// qualunque misura su «quanto spesso cambia l'altezza» direbbe una cosa che in
// gioco non succede.
function ovaleConMuro(raggio = 300) {
    const pts = [];
    for (let i = 0; i < 800; i++) {
        const a = (i / 800) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, halfWidth: 11 });
    }
    const muro = TrackGravel.barrierProfile(pts, { roadHalf: 11, pitLanePts: [], pitRoadHalf: 5 });
    return { pts, muro };
}

const di = (p, i, side) => i * 2 + (side > 0 ? 0 : 1);

// Lo stesso anello, ma con una corsia box che gli corre accanto per un quarto
// di giro — la situazione in cui la citta' si e' scoperta cieca.
function ovaleConBox(raggio = 300, quanto = 20) {
    const pts = [];
    for (let i = 0; i < 800; i++) {
        const a = (i / 800) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * raggio, z: Math.sin(a) * raggio, y: 0, halfWidth: 11 });
    }
    const pit = [];
    for (let i = 100; i <= 300; i++) {
        const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
        pit.push({ x: pts[i].x + nx * quanto, z: pts[i].z + nz * quanto });
    }
    const muro = TrackGravel.barrierProfile(pts, { roadHalf: 11, pitLanePts: pit, pitRoadHalf: 5 });
    return { pts, muro, pit };
}

// Da che parte, e quanto lontano dall'asse, sta un punto della corsia box.
function rispettoAllAsse(pts, q) {
    const i = TrackGeometry.nearestPoint(pts, q.x, q.z).index;
    const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
    const proj = (q.x - pts[i].x) * nx + (q.z - pts[i].z) * nz;
    return { i, side: proj >= 0 ? 1 : -1, dist: Math.abs(proj) };
}



test('la facciata comincia SUBITO oltre il muro, non a una distanza sua', () => {
    // «la vista è completamente occultata dai palazzi che circondano
    // perfettamente il circuito»: a distanza fissa, dove il muro arretra per una
    // via di fuga si aprirebbe un varco sul nulla.
    const { pts, muro } = ovaleConMuro();
    const p = CittaProfilo.profilo(pts, muro);
    for (let i = 0; i < pts.length; i++) {
        for (const side of [1, -1]) {
            const d = p.distanza[di(p, i, side)];
            const m = TrackGravel.barrierAt(muro, i, side);
            assert.ok(d > m, `campione ${i} lato ${side}: facciata a ${d.toFixed(1)}, muro a ${m.toFixed(1)}`);
            assert.ok(d <= m + CittaProfilo.MARCIAPIEDE + 1e-9,
                `campione ${i} lato ${side}: facciata a ${(d - m).toFixed(1)} dal muro, il marciapiede ne vuole ${CittaProfilo.MARCIAPIEDE}`);
        }
    }
});

test('i palazzi cambiano altezza a scalini, non di continuo', () => {
    // Un'altezza che varia campione per campione non si legge come una fila di
    // edifici: si legge come una duna.
    const { pts, muro } = ovaleConMuro();
    const p = CittaProfilo.profilo(pts, muro);
    let cambi = 0, uguali = 0;
    for (let i = 1; i < pts.length; i++) {
        if (p.altezza[di(p, i, 1)] !== p.altezza[di(p, i - 1, 1)]) cambi++; else uguali++;
    }
    assert.ok(cambi >= 3, `solo ${cambi} palazzi diversi su tutto il giro: sembra un muro unico`);
    assert.ok(uguali > cambi * 4, `l'altezza cambia ${cambi} volte su ${pts.length}: è una duna, non una città`);
});

test('le altezze stanno nell\'intervallo dichiarato', () => {
    const { pts, muro } = ovaleConMuro();
    const p = CittaProfilo.profilo(pts, muro);
    for (const h of p.altezza) {
        assert.ok(h >= CittaProfilo.ALTEZZA_MIN && h <= CittaProfilo.ALTEZZA_MAX,
            `altezza ${h} fuori dall'intervallo ${CittaProfilo.ALTEZZA_MIN}-${CittaProfilo.ALTEZZA_MAX}`);
    }
});

test('la stessa pista dà sempre la stessa città, una diversa no', () => {
    // Deterministico: se cambiasse ad ogni caricamento, il circuito avrebbe una
    // faccia diversa ad ogni partita. Il seme viene dalla geometria, non da
    // Math.random.
    const { pts, muro } = ovaleConMuro();
    const a = CittaProfilo.profilo(pts, muro);
    const b = CittaProfilo.profilo(pts, muro);
    assert.deepEqual(Array.from(a.altezza), Array.from(b.altezza));
    const altrove = pts.map(q => ({ ...q, x: q.x + 137, z: q.z - 89 }));
    const c = CittaProfilo.profilo(altrove, muro);
    assert.notDeepEqual(Array.from(c.altezza), Array.from(a.altezza));
});

test('dentro un palazzo non cambia niente: tinta, altezza e variante', () => {
    // ⚠️ Chi sia il palazzo lo dice `inizio`, non l'altezza. Da quando le
    // altezze sono quantizzate sulla pila di moduli, due palazzi diversi
    // possono avere lo stesso numero di piani — e questo test, che prima
    // riconosceva il palazzo dalla sua altezza, li scambiava per uno solo.
    const { pts, muro } = ovaleConMuro();
    const p = CittaProfilo.profilo(pts, muro);
    for (const side of [1, -1]) {
        for (let i = 1; i < pts.length; i++) {
            const qui = di(p, i, side), prima = di(p, i - 1, side);
            if (p.inizio[qui] !== p.inizio[prima]) continue;
            assert.equal(p.colore[qui], p.colore[prima], `campione ${i}: colore diverso`);
            assert.equal(p.altezza[qui], p.altezza[prima], `campione ${i}: altezza diversa`);
            assert.equal(p.variante[qui], p.variante[prima], `campione ${i}: variante diversa`);
        }
    }
});

test('ogni altezza e\' una pila di moduli, non un numero qualsiasi', () => {
    // Un palazzo alto 31.7 non esiste: esiste quello da sette piani. Se
    // l'altezza non cadesse sulla griglia dei moduli, il coronamento
    // galleggerebbe sopra l'ultimo piano o ci affonderebbe dentro.
    const { pts, muro } = ovaleConMuro();
    const p = CittaProfilo.profilo(pts, muro);
    for (let k = 0; k < p.altezza.length; k++) {
        const piani = p.piani[k];
        assert.ok(piani >= CittaProfilo.PIANI_MIN && piani <= CittaProfilo.PIANI_MAX,
            `${piani} piani, fuori dall'intervallo`);
        const attesa = CittaProfilo.H_BASE + piani * CittaProfilo.H_PIANO + CittaProfilo.H_CORONAMENTO;
        assert.ok(Math.abs(p.altezza[k] - attesa) < 1e-9,
            `altezza ${p.altezza[k]} non e' una pila: ${piani} piani fanno ${attesa}`);
    }
});

test('i due lati non sono lo stesso identico palazzo', () => {
    // Con lo stesso seme per entrambi i lati, il circuito sembrerebbe uno
    // specchio: stessa altezza a destra e a sinistra per tutto il giro.
    const { pts, muro } = ovaleConMuro();
    const p = CittaProfilo.profilo(pts, muro);
    let diversi = 0;
    for (let i = 0; i < pts.length; i++) {
        if (p.altezza[di(p, i, 1)] !== p.altezza[di(p, i, -1)]) diversi++;
    }
    assert.ok(diversi > pts.length / 3, `i due lati coincidono su ${pts.length - diversi} campioni su ${pts.length}`);
});

test('la citta\' arretra dove passa la corsia box', () => {
    // ⚠️ IL DIFETTO CHE HA VISTO L'UTENTE: «nella pista di prova dei circuiti
    // cittadini la corsia dei box e' fatta male, perche' si entra attraverso
    // edifici». Nel tratto del traguardo il muro della pista NON arretra — sta
    // fra la carreggiata e la corsia box, com'e' giusto — quindi una facciata
    // posata sul muro piu' il marciapiede cade in mezzo alla corsia e dentro i
    // garage. Misurato su citta-prova prima della cura: 260 punti di corsia su
    // 300 dentro i palazzi, il peggiore di 4 unita'.
    //
    // La citta' deve fare spazio a TUTTO il paddock: la corsia, il grembiule
    // dove l'auto si ferma, e la fila dei garage dietro.
    const { pts, muro, pit } = ovaleConBox();
    const p = CittaProfilo.profilo(pts, muro, { pitLanePts: pit, pitRoadHalf: 5 });
    for (const q of pit) {
        const { i, side, dist } = rispettoAllAsse(pts, q);
        const facciata = p.distanza[di(p, i, side)];
        const servono = dist + 5 + CittaProfilo.PADDOCK;
        assert.ok(facciata >= servono,
            `campione ${i}: la facciata sta a ${facciata.toFixed(1)} e la corsia box arriva a ${servono.toFixed(1)}`);
    }
});

test('la citta\' arretra solo DOVE serve, e senza gradini', () => {
    // Un arretramento a scalino sarebbe un palazzo che rientra di trenta unita'
    // fra un campione e l'altro: il nastro resta continuo, ma si vedrebbe una
    // parete piatta perpendicolare alla strada. Si allarga come si allarga il
    // muro per la ghiaia — con una pendenza, non con un salto.
    const { pts, muro, pit } = ovaleConBox();
    const p = CittaProfilo.profilo(pts, muro, { pitLanePts: pit, pitRoadHalf: 5 });
    const senzaBox = CittaProfilo.profilo(pts, muro, {});
    const passo = TrackGeometry.lapLength(pts) / pts.length;
    for (const side of [1, -1]) {
        for (let i = 0; i < pts.length; i++) {
            const qui = p.distanza[di(p, i, side)];
            const dopo = p.distanza[di(p, (i + 1) % pts.length, side)];
            assert.ok(Math.abs(dopo - qui) <= passo * CittaProfilo.PENDENZA_MAX + 1e-6,
                `campione ${i} lato ${side}: la facciata salta di ${(dopo - qui).toFixed(1)} in un passo di ${passo.toFixed(1)}`);
        }
    }
    // E dall'altra parte del giro, lontano dai box, la citta' e' quella di prima.
    for (const side of [1, -1]) {
        assert.equal(p.distanza[di(p, 600, side)], senzaBox.distanza[di(p, 600, side)],
            'lontano dalla corsia box la facciata non deve muoversi');
    }
});

test('la misura del paddock e quella della scenografia sono lo stesso numero', () => {
    // ⚠️ `PADDOCK_OFFSET` e' una COPIA di TrackScenery.PIT_BUILDING_OFFSET_MARGIN:
    // importarlo chiuderebbe un anello di require, da quando la scenografia deve
    // nominare la citta' per posarne le colonne. Questo test e' il prezzo della
    // copia — se qualcuno sposta i garage, la citta' deve arretrare con loro.
    const TrackScenery = require('./trackScenery.js');
    assert.equal(CittaProfilo.PADDOCK_OFFSET, TrackScenery.PIT_BUILDING_OFFSET_MARGIN);
});
