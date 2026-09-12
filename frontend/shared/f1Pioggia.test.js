// frontend/shared/f1Pioggia.test.js
//
// ⚠️ `node --test backend/` NON esegue questo file: serve
// `node --test frontend/shared/`.
//
// Della pioggia si verifica quel che si puo' verificare senza occhi: che le
// gocce restino nel volume attorno alla camera (se ne escono, si vede un muro
// d'acqua che si allontana), che l'intensita' decida quante se ne disegnano, e
// che a cielo asciutto non se ne disegni NESSUNA — il resto (se sembra
// pioggia) lo dice solo il playtest.
const test = require('node:test');
const assert = require('node:assert/strict');

// THREE finto: qui contano i numeri nel buffer, non la grafica.
global.THREE = {
    BufferGeometry: function () {
        this.attributes = {};
        this.drawRange = { start: 0, count: 0 };
        this.setAttribute = (nome, attr) => { this.attributes[nome] = attr; };
        this.setDrawRange = (s, c) => { this.drawRange = { start: s, count: c }; };
    },
    BufferAttribute: function (array, itemSize) {
        this.array = array; this.itemSize = itemSize; this.needsUpdate = false;
    },
    LineBasicMaterial: function (p) { Object.assign(this, p || {}); },
    LineSegments: function (geo, mat) { this.geometry = geo; this.material = mat; this.visible = true; },
};
const F1Pioggia = require('./f1Pioggia.js');

const scenaFinta = () => ({ figli: [], add(o) { this.figli.push(o); } });
const cameraA = (x, y, z) => ({ position: { x, y, z } });

test('pioggia: a cielo asciutto non si disegna una goccia', () => {
    const scena = scenaFinta();
    const p = F1Pioggia.install(scena, global.THREE);
    p.setIntensita(0);
    assert.equal(p.attive, 0);
    assert.equal(p.oggetto.visible, false, 'l\'oggetto resta a schermo con zero gocce');
    assert.equal(p.oggetto.geometry.drawRange.count, 0, 'la GPU disegnerebbe comunque');

    // E nemmeno con un velo di umidita': due gocce sparse sembrano un difetto.
    p.setIntensita(0.02);
    assert.equal(p.attive, 0);
});

test('pioggia: piu forte e il cielo, piu gocce e piu lunghe', () => {
    const scena = scenaFinta();
    const p = F1Pioggia.install(scena, global.THREE);
    const conta = [];
    for (const v of [0.2, 0.5, 0.8, 1]) { p.setIntensita(v); conta.push(p.attive); }
    for (let i = 1; i < conta.length; i++) {
        assert.ok(conta[i] > conta[i - 1], `le gocce non crescono col cielo: ${conta}`);
    }
    assert.ok(conta[conta.length - 1] <= F1Pioggia.GOCCE_MAX, 'piu gocce di quante ne esistano');
    assert.equal(p.oggetto.geometry.drawRange.count, p.attive * 2, 'drawRange e gocce attive non concordano');

    // La scia si allunga: si misura sulla distanza fra i due vertici di una
    // goccia, che e' quel che si vede a schermo.
    const cam = cameraA(0, 0, 0);
    const lunghezza = (intensita) => {
        p.setIntensita(intensita);
        p.update(cam, 0.016);
        const a = p.oggetto.geometry.attributes.position.array;
        return Math.hypot(a[3] - a[0], a[4] - a[1], a[5] - a[2]);
    };
    assert.ok(lunghezza(1) > lunghezza(0.2) * 2, 'la pioggia forte non ha scie piu lunghe');
});

test('pioggia: le gocce restano intorno alla camera, anche dopo un giro di pista', () => {
    const scena = scenaFinta();
    const p = F1Pioggia.install(scena, global.THREE);
    p.setIntensita(1);
    // L'auto attraversa il circuito: la camera si sposta di centinaia di unita'.
    let cam = cameraA(0, 3, 0);
    for (let t = 0; t < 600; t++) {
        cam = cameraA(t * 1.2, 3 + Math.sin(t / 40) * 2, -t * 0.8);
        p.update(cam, 0.02);
    }
    const a = p.oggetto.geometry.attributes.position.array;
    const R = F1Pioggia.RAGGIO, H = F1Pioggia.ALTEZZA;
    let fuori = 0;
    for (let i = 0; i < p.attive; i++) {
        const b = i * 6;
        const dx = a[b] - cam.position.x, dy = a[b + 1] - cam.position.y, dz = a[b + 2] - cam.position.z;
        // Un margine: la scia e la deriva di un fotogramma possono sporgere.
        if (Math.abs(dx) > R + 4 || Math.abs(dz) > R + 4 || Math.abs(dy) > H / 2 + 4) fuori++;
    }
    assert.equal(fuori, 0, `${fuori} gocce su ${p.attive} sono rimaste indietro: si vedrebbe un muro d'acqua che si allontana`);
});

test('pioggia: nessuna goccia si teletrasporta ogni fotogramma', () => {
    // ⚠️ Il riciclo deve scattare SOLO uscendo dal volume: se scattasse a ogni
    // fotogramma le gocce lampeggerebbero in posti a caso invece di cadere.
    const scena = scenaFinta();
    const p = F1Pioggia.install(scena, global.THREE);
    p.setIntensita(1);
    const cam = cameraA(0, 3, 0);
    p.update(cam, 0.016);
    const a = p.oggetto.geometry.attributes.position.array;
    const prima = Array.from(a.slice(0, p.attive * 6));
    p.update(cam, 0.016);
    let saltate = 0;
    for (let i = 0; i < p.attive; i++) {
        const b = i * 6;
        const salto = Math.hypot(a[b] - prima[b], a[b + 1] - prima[b + 1], a[b + 2] - prima[b + 2]);
        if (salto > 5) saltate++;   // in 16 ms una goccia cade meno di 1.5 unita'
    }
    // Qualcuna che rientra dalla cima c'e' sempre: quel che non deve esserci e'
    // una frazione grande.
    assert.ok(saltate < p.attive * 0.1,
        `${saltate} gocce su ${p.attive} sono saltate in un fotogramma: sembrano sfarfallare`);
});
