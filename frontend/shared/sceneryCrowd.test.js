// frontend/shared/sceneryCrowd.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryCrowd = require('./sceneryCrowd.js');
const seatData = require('../assets/custom/circuit/grandStandSeats.json');

function rngFactory() {
    let a = 987654321;
    return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

const STANDS = [
    { asset: 'grandStand', category: 'grandstand-main', x: 100, y: 0, z: 200, rotY: 0, scale: 1 },
    { asset: 'grandStandAwning', category: 'grandstand', x: -50, y: 3, z: 40, rotY: Math.PI / 2, scale: 1 },
];

test('genera spettatori solo per le tribune, in numero inferiore ai posti', () => {
    const crowd = SceneryCrowd.buildCrowd(STANDS, seatData.seats, rngFactory());
    assert.ok(crowd.length > 0, 'nessuno spettatore generato');
    assert.ok(crowd.length <= STANDS.length * seatData.seatCount);
    for (const s of crowd) {
        assert.ok(['spectatorA', 'spectatorB', 'spectatorC'].includes(s.asset));
        assert.equal(s.scale, 1);
        assert.equal(s.category, 'crowd');
    }
});

// Il posto è espresso in coordinate LOCALI alla tribuna: se la rotazione non
// viene applicata, gli spettatori di una tribuna ruotata finiscono in aria
// da un'altra parte. Con rotY=0 la trasformazione è l'identità più la
// traslazione, quindi il controllo è esatto.
test('con rotY=0 il posto locale si somma alla posizione della tribuna', () => {
    const stand = Object.assign({}, STANDS[0], { rotY: 0 });
    const crowd = SceneryCrowd.buildCrowd([stand], seatData.seats, rngFactory());
    for (const s of crowd) {
        const dx = s.x - stand.x, dz = s.z - stand.z;
        const match = seatData.seats.some(p =>
            Math.abs(p.x - dx) < 1e-6 && Math.abs(p.z - dz) < 1e-6);
        assert.ok(match, `spettatore a (${dx}, ${dz}) non corrisponde ad alcun posto`);
    }
});

test('la rotazione della tribuna è applicata ai posti', () => {
    const stand = Object.assign({}, STANDS[0], { rotY: Math.PI / 2 });
    const crowd = SceneryCrowd.buildCrowd([stand], seatData.seats, rngFactory());
    const anyRotated = crowd.some(s => Math.abs(s.x - stand.x) > 1);
    assert.ok(anyRotated, 'nessuno spettatore spostato: rotazione non applicata');
    for (const s of crowd) {
        const d = Math.hypot(s.x - stand.x, s.z - stand.z);
        assert.ok(d < 20, `spettatore a ${d.toFixed(1)} dal centro tribuna: fuori sagoma`);
    }
});

test('gli spettatori ereditano la quota della tribuna', () => {
    const stand = Object.assign({}, STANDS[1]);
    const crowd = SceneryCrowd.buildCrowd([stand], seatData.seats, rngFactory());
    for (const s of crowd) assert.ok(s.y >= stand.y, 'spettatore sotto la base della tribuna');
});

test('la tribuna principale è più piena delle altre', () => {
    const main = SceneryCrowd.buildCrowd(
        [Object.assign({}, STANDS[0], { category: 'grandstand-main' })], seatData.seats, rngFactory());
    const side = SceneryCrowd.buildCrowd(
        [Object.assign({}, STANDS[0], { category: 'grandstand' })], seatData.seats, rngFactory());
    assert.ok(main.length / seatData.seatCount >= SceneryCrowd.MAIN_FILL_MIN - 0.05,
        `principale riempita al ${(main.length / seatData.seatCount * 100).toFixed(0)}%`);
    assert.ok(side.length <= seatData.seatCount);
});

test('senza posti in ingresso non genera nulla invece di fallire', () => {
    assert.deepEqual(SceneryCrowd.buildCrowd(STANDS, null, rngFactory()), []);
    assert.deepEqual(SceneryCrowd.buildCrowd(STANDS, [], rngFactory()), []);
});

test('gli spettatori delle terrazze stanno sopra la terrazza, non a mezz\'aria', () => {
    const ancore = { hospitalityDeck: [{ x: 2, y: 5.4, z: 3.7 }] };
    // Terrazza ruotata di 90°: se la rotazione non viene applicata, la figura
    // resta sull'asse sbagliato e il test lo vede.
    const terrazze = [{ asset: 'hospitalityDeck', x: 100, y: 7, z: -50,
                        rotY: Math.PI / 2, scale: 1 }];
    const out = SceneryCrowd.buildTerraceCrowd(terrazze, ancore, () => 0.1);
    assert.equal(out.length, 1);
    const f = out[0];
    assert.ok(f.asset === 'spectatorStandA' || f.asset === 'spectatorStandB');
    assert.equal(f.category, 'crowd');
    assert.ok(Math.abs(f.y - (7 + 5.4)) < 1e-6, 'la quota è quella della terrazza più l\'ancora');
    // (x,z) locali (2, 3.7) ruotati di 90°: x' = x·cos + z·sin = 3.7,
    // z' = -x·sin + z·cos = -2.
    assert.ok(Math.abs(f.x - (100 + 3.7)) < 1e-6, `x atteso 103.7, ottenuto ${f.x}`);
    assert.ok(Math.abs(f.z - (-50 - 2)) < 1e-6, `z atteso -52, ottenuto ${f.z}`);
    assert.ok(Math.abs(f.rotY - Math.PI / 2) < 1e-6, 'guarda dove guarda la terrazza');
});

test('un asset senza ancore non produce spettatori', () => {
    const out = SceneryCrowd.buildTerraceCrowd(
        [{ asset: 'giantScreen', x: 0, y: 0, z: 0, rotY: 0 }], {}, () => 0.1);
    assert.equal(out.length, 0);
});

test('le terrazze hanno un budget proprio, separato da quello delle tribune', () => {
    const ancore = { hospitalityDeck: [] };
    for (let i = 0; i < 20; i++) ancore.hospitalityDeck.push({ x: i, y: 5.4, z: 3.7 });
    const terrazze = [];
    for (let i = 0; i < 200; i++) {
        terrazze.push({ asset: 'hospitalityDeck', x: i * 40, y: 0, z: 0, rotY: 0 });
    }
    // ⚠️ Qui serve un rng UNIFORME, non una costante. Il filtro è
    // `rng() > fill`: un rng che ritorna sempre 0 passa qualunque soglia e il
    // test non potrebbe fallire. Il tetto è statistico, non un taglio netto —
    // da qui le tolleranze larghe.
    let s = 12345;
    const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

    // Il budget è SEPARATO da quello delle tribune: nessuna tribuna è passata
    // a questa chiamata, eppure le terrazze si popolano.
    const out = SceneryCrowd.buildTerraceCrowd(terrazze, ancore, rng);
    assert.ok(out.length > 0, 'nessuno spettatore sulle terrazze');

    // E dal 2026-08-25 il budget SCALA col numero di terrazze, come quello
    // delle tribune scala col numero di tribune: 200 terrazze non devono
    // ritrovarsi con le stesse 900 figure che ne servivano 29, o si svuotano
    // tutte insieme. Rif. spec 2026-08-25-f1-densita-scenografia-design.md
    const poche = [];
    for (let i = 0; i < 29; i++) {
        poche.push({ asset: 'hospitalityDeck', x: i * 40, y: 0, z: 0, rotY: 0 });
    }
    let s2 = 12345;
    const rng2 = () => { s2 = (s2 * 9301 + 49297) % 233280; return s2 / 233280; };
    const pochi = SceneryCrowd.buildTerraceCrowd(poche, ancore, rng2);
    const riempPoche = pochi.length / (29 * 20);
    const riempTante = out.length / (200 * 20);
    assert.ok(riempTante > riempPoche * 0.9,
        `riempimento terrazze: ${(riempPoche * 100).toFixed(0)}% con 29, `
        + `${(riempTante * 100).toFixed(0)}% con 200`);

    // Sotto il riferimento il tetto resta quello di prima: si alza, mai si
    // abbassa.
    assert.ok(pochi.length <= SceneryCrowd.MAX_TERRACE * 1.15,
        `${pochi.length} figure con 29 terrazze, sopra il tetto di ${SceneryCrowd.MAX_TERRACE}`);
});

// ---- il budget della folla segue le tribune ----
//
// MAX_TOTAL non e' un numero di spettatori: e' un budget spalmato su tutte le
// tribune (fillCap = MAX_TOTAL / capienza). Con un numero fisso, piu' tribune
// significa tribune piu' vuote - misurato il 2026-08-25: 100% pieno su
// monte-rosso (50 tribune), 62% su melbourne (90), 40% su shanghai (139), e
// 25% su shanghai appena le schiere hanno smesso di avere un tetto (243).
//
// L'utente: «io non toccherei gli spettatori o li scalerei con le tribune,
// niente di diverso. girando in velocita' nella pista non e' che si nota se
// una tribuna e' piu' piena o meno». Quindi la folla cresce PERCHE' le tribune
// sono di piu', non perche' ognuna e' piu' piena.
// Rif. docs/superpowers/specs/2026-08-25-f1-densita-scenografia-design.md
function tribuneFinte(quante) {
    const out = [];
    for (let i = 0; i < quante; i++) {
        out.push({ asset: 'grandStand', category: 'grandstand',
                   x: i * 200, y: 0, z: 0, rotY: 0, scale: 1 });
    }
    return out;
}

function riempimento(quante) {
    const t = tribuneFinte(quante);
    const crowd = SceneryCrowd.buildCrowd(t, seatData.seats, rngFactory());
    return crowd.length / (quante * seatData.seats.length);
}

test('raddoppiando le tribune il riempimento non crolla', () => {
    const a = riempimento(111);
    const b = riempimento(222);
    assert.ok(b > a * 0.9,
        `riempimento: ${(a * 100).toFixed(0)}% con 111 tribune, `
        + `${(b * 100).toFixed(0)}% con 222`);
});

test('sotto il riferimento il budget della folla non cambia', () => {
    // 90 tribune (melbourne) e 50 (monte-rosso) devono dare esattamente cio'
    // che davano prima: il tetto si alza, mai si abbassa.
    for (const quante of [50, 90, 111]) {
        const t = tribuneFinte(quante);
        const crowd = SceneryCrowd.buildCrowd(t, seatData.seats, rngFactory());
        // 3% di tolleranza: il budget e' un tetto MEDIO, non esatto - ogni
        // posto e' un'estrazione (`if (rng() > fill) continue`), quindi il
        // totale oscilla attorno a capienza x fillCap.
        assert.ok(crowd.length <= 6000 * 1.03,
            `${quante} tribune: ${crowd.length} spettatori, sopra il budget di 6000`);
    }
});
