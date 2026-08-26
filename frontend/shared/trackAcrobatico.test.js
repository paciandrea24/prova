// frontend/shared/trackAcrobatico.test.js
//
// ⚠️ Questo file NON gira con `node --test backend/`: sta in frontend/shared.
// Serve `node --test frontend/shared/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const TrackAcrobatico = require('./trackAcrobatico.js');

// Un giro che entra andando verso +z ed esce spostato di 30 verso +x.
function giroDiProva(raggio = 25) {
    return TrackAcrobatico.puntiDelGiro({
        ingresso: { x: 0, y: 0, z: 0 }, uscita: { x: 30, y: 0, z: 0 },
        dirX: 0, dirZ: 1, raggio, passo: 4,
    });
}

test('il giro comincia e finisce alla quota di partenza', () => {
    const pts = giroDiProva();
    assert.ok(pts.length > 20, `troppo pochi campioni: ${pts.length}`);
    assert.ok(Math.abs(pts[0].y) < 1e-9, `parte da quota ${pts[0].y}`);
    // L'ultimo campione sta un passo prima della chiusura (il giro è ciclico e
    // il punto finale è il primo del tratto dopo), quindi non è esattamente a
    // zero: deve però essere risalito quasi del tutto.
    assert.ok(pts[pts.length - 1].y < 0.6, `esce a quota ${pts[pts.length - 1].y.toFixed(2)}`);
});

test('in cima si e\' alti due raggi e rovesciati', () => {
    const pts = giroDiProva();
    const cima = pts.reduce((a, b) => (b.y > a.y ? b : a));
    assert.ok(Math.abs(cima.y - 50) < 1.5, `la cima sta a ${cima.y.toFixed(1)}, non a 50`);
    assert.ok(TrackAcrobatico.frameDi(cima).su.y < -0.9, 'in cima il tetto deve puntare in giu\'');
});

test('si esce di fianco: lo spostamento laterale c\'e\' tutto', () => {
    const pts = giroDiProva();
    const fine = pts[pts.length - 1];
    assert.ok(Math.abs(fine.x - 30) < 1.5, `esce a x=${fine.x.toFixed(1)}, doveva essere 30`);
    assert.ok(Math.abs(pts[0].x) < 1e-9, 'e deve ENTRARE dove sta il nodo di ingresso');
});

test('ingresso e uscita sono TANGENTI alla pista, non storti', () => {
    // È la smoothstep a garantirlo: con una rampa lineare qui ci sarebbero 11
    // gradi di scarto e il nastro entrerebbe di traverso.
    //
    // ⚠️ Si guarda θ=0 e θ=2π, NON il primo e l'ultimo campione: l'ultimo sta
    // un passo PRIMA della chiusura (θ=350.8° con 39 campioni), dove il nastro
    // sta ancora scendendo di quei 9.2° che separano due campioni qualunque del
    // giro. Misurarlo lì direbbe «uscita storta» di una cosa che è solo il
    // passo di campionamento — e il campione che segue, quello del tratto dopo,
    // è orizzontale per costruzione.
    const pts = giroDiProva();
    const chiusura = Object.assign({}, pts[0], { loopAngolo: 2 * Math.PI });
    for (const p of [pts[0], chiusura]) {
        const t = TrackAcrobatico.frameDi(p).tan;
        assert.ok(t.z > 0.999, `tangente storta: (${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)})`);
        assert.ok(Math.abs(t.y) < 1e-9, `agli estremi il nastro dev'essere orizzontale (${t.y.toFixed(3)})`);
    }
});

test('il nastro non ha scatti: fra due campioni non gira mai piu\' del passo', () => {
    // Il controspecchio del test qui sopra. Se l'uscita fosse davvero storta,
    // qui si vedrebbe un salto fra l'ultimo campione del giro e la pista che
    // riprende; se invece è solo discretizzazione, tutti i passi sono uguali.
    const pts = giroDiProva();
    const passoAngolare = 2 * Math.PI / pts.length;
    for (let i = 0; i < pts.length; i++) {
        const a = TrackAcrobatico.frameDi(pts[i]).tan;
        const b = TrackAcrobatico.frameDi(pts[(i + 1) % pts.length]).tan;
        const cos = Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z);
        assert.ok(Math.acos(cos) < passoAngolare * 1.05,
            `fra i campioni ${i} e ${i + 1} il nastro gira di ${(Math.acos(cos) * 180 / Math.PI).toFixed(1)}°, `
            + `il passo e' ${(passoAngolare * 180 / Math.PI).toFixed(1)}°`);
    }
});

test('la pendenza del campione e\' l\'angolo del nastro sull\'orizzonte', () => {
    // È ciò che fa funzionare la gravità della fase 1a dentro il tubo senza una
    // formula nuova: accelerazionePendenza chiede solo la pendenza.
    const pts = giroDiProva();
    assert.ok(pts.length > 20, 'il caso di prova deve avere campioni');
    for (const p of pts) {
        const t = TrackAcrobatico.frameDi(p).tan;
        assert.ok(Math.abs(Math.sin(p.pendenza) - t.y) < 1e-9,
            `θ=${p.loopAngolo.toFixed(2)}: pendenza ${p.pendenza.toFixed(3)} contro tangente ${t.y.toFixed(3)}`);
    }
});

test('tangente e su sono perpendicolari, sempre', () => {
    for (const p of giroDiProva()) {
        const f = TrackAcrobatico.frameDi(p);
        const dot = f.tan.x * f.su.x + f.tan.y * f.su.y + f.tan.z * f.su.z;
        assert.ok(Math.abs(dot) < 1e-9, `frame storto a θ=${p.loopAngolo.toFixed(2)}: dot ${dot}`);
    }
});

test('il nastro in discesa non attraversa quello in salita', () => {
    // La ragione per cui si esce di fianco (disegno dell'utente). Con L=30 e la
    // pista larga 22-24, i due rami devono restare separati più della mezza
    // carreggiata, o l'auto in salita passerebbe dentro quella in discesa.
    const pts = giroDiProva();
    let minima = Infinity, dove = '';
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 4; j < pts.length; j++) {
            const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
            if (d < minima) { minima = d; dove = `${i}-${j}`; }
        }
    }
    assert.ok(minima > 11, `i campioni ${dove} distano ${minima.toFixed(1)}: i rami del tubo si toccano`);
});

test('la velocita\' minima per completarlo viene dall\'energia', () => {
    // v² = 4·g·R (salire di due raggi), non la condizione centripeta.
    assert.ok(Math.abs(TrackAcrobatico.velocitaMinima(25, 0.2) - 4.4721) < 1e-3);
    assert.ok(TrackAcrobatico.velocitaMinima(45, 0.2) < 6.2,
        'il raggio massimo del modello deve restare percorribile a velocita\' massima');
});
