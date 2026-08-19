// frontend/shared/f1Danni.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./f1Danni');
const DamageModel = require('../../backend/sockets/games/physics/DamageModel.js');

test('i quattro componenti sono ESATTAMENTE quelli che manda il server', () => {
    // Il pannello mostra `damageParts` così com'è. Se un giorno il modello di
    // danno guadagna o perde un pezzo, questo test si accorge subito che il
    // pannello non lo sa — invece di lasciare un quadrante fermo a 0% per
    // sempre, che è il modo in cui questo difetto si nasconde.
    const veri = Object.keys(DamageModel.createDamageParts()).sort();
    const miei = D.COMPONENTI.map(c => c.chiave).sort();
    assert.deepEqual(miei, veri);
});

test('ogni componente ha un nome e una sigla, tutti diversi', () => {
    const nomi = new Set(), brevi = new Set();
    for (const c of D.COMPONENTI) {
        assert.ok(c.nome && c.nome.length > 2, `nome mancante per ${c.chiave}`);
        assert.ok(c.breve && c.breve.length <= 6, `sigla assente o troppo lunga per ${c.chiave}`);
        nomi.add(c.nome); brevi.add(c.breve);
    }
    assert.equal(nomi.size, D.COMPONENTI.length, 'due componenti hanno lo stesso nome');
    assert.equal(brevi.size, D.COMPONENTI.length, 'due componenti hanno la stessa sigla');
});

// ---- la scala di colore -----------------------------------------------------

test('la scala va dal verde al rosso passando per il giallo', () => {
    const rgb = (s) => s.match(/\d+/g).map(Number);
    const [r0, g0] = rgb(D.colore(0));
    const [r1, g1] = rgb(D.colore(100));
    assert.ok(g0 > r0, 'a 0 non è verde');
    assert.ok(r1 > g1, 'a 100 non è rosso');
    // Salendo, la scala non deve mai tornare a sembrare più tranquilla. La
    // misura giusta è il VERDE che cala: il rosso no, perché il giallo di
    // mezzo (217) è più rosso del rosso finale (198) — è un rosso mattone
    // spento, ed è quello che l'utente ha approvato per l'usura.
    let prec = 256;
    for (let p = 0; p <= 100; p++) {
        const g = rgb(D.colore(p))[1];
        assert.ok(g <= prec, `il verde risale fra ${p - 1}% e ${p}%`);
        prec = g;
    }
});

test('la scala non esplode fuori dal suo intervallo', () => {
    for (const v of [-40, 0, 100, 250, NaN, null, undefined]) {
        const c = D.colore(v);
        assert.ok(/^rgb\(\d+,\d+,\d+\)$/.test(c), `colore non valido per ${v}: ${c}`);
    }
});

// ---- l'arco del quadrante ---------------------------------------------------

const fine = (d) => {
    const n = d.match(/-?\d+\.?\d*/g).map(Number);
    return { x: n[n.length - 2], y: n[n.length - 1] };
};

test('a zero il quadrante non disegna niente', () => {
    assert.equal(D.arco(0, 50, 50, 20), '');
    assert.equal(D.arco(-5, 50, 50, 20), '');
});

test('a 100 l anello si chiude e NON sparisce', () => {
    // È il caso che si rompe da solo: un arco di 360° esatti ha inizio e fine
    // coincidenti e il browser non disegna nulla — il quadrante scomparirebbe
    // proprio a componente distrutto.
    const d = D.arco(100, 50, 50, 20);
    assert.notEqual(d, '');
    assert.match(d, / 1 1 /, 'manca il flag di arco grande: non fa il giro lungo');
    const f = fine(d);
    const dist = Math.hypot(f.x - 50, f.y - 30);
    assert.ok(dist > 0, 'inizio e fine coincidono: l arco è degenere');
    assert.ok(dist < 0.5, `l anello resta aperto di ${dist.toFixed(2)}`);
});

test('gira in senso orario partendo dalle ore 12', () => {
    // Un quarto finisce a destra, mezzo in basso, tre quarti a sinistra.
    const casi = [[25, 70, 50], [50, 50, 70], [75, 30, 50]];
    for (const [pct, x, y] of casi) {
        const f = fine(D.arco(pct, 50, 50, 20));
        assert.ok(Math.abs(f.x - x) < 0.05 && Math.abs(f.y - y) < 0.05,
            `${pct}%: finisce in ${f.x},${f.y} invece che ${x},${y}`);
    }
});

test('il flag di arco grande scatta esattamente a meta giro', () => {
    assert.match(D.arco(49, 50, 50, 20), / 0 1 /);
    assert.match(D.arco(51, 50, 50, 20), / 1 1 /);
});

test('nessun arco contiene NaN, a nessuna percentuale', () => {
    for (let p = 0; p <= 100; p += 0.5) {
        const d = D.arco(p, 33.5, 47.25, 24.5);
        assert.ok(!/NaN|undefined/.test(d), `arco rotto a ${p}%: ${d}`);
    }
});

// ---- il peggiore dei quattro ------------------------------------------------

test('il peggiore e il massimo, non la media', () => {
    // Deve coincidere con `p.damage` del server, che è definito come massimo:
    // un solo pezzo distrutto non va annacquato dagli altri tre sani.
    const parti = { frontWing: 0, floor: 0, engine: 92, suspension: 4 };
    assert.equal(D.peggiore(parti), 92);
    const p2 = DamageModel.createDamageParts();
    DamageModel.addComponentDamage({ damageParts: p2 }, 30, { engine: 1 });
    assert.equal(D.peggiore(p2), 30);
});

test('il peggiore regge un oggetto assente o incompleto', () => {
    assert.equal(D.peggiore(null), 0);
    assert.equal(D.peggiore({}), 0);
    assert.equal(D.peggiore({ engine: 12 }), 12);
});
