const test = require('node:test');
const assert = require('node:assert/strict');
const { G_NASTRO, accelerazionePendenza, isGravitaNastroActive, pendenzaMassimaInSalita } = require('./GravitaNastro.js');

test('in piano la gravita\' non fa niente', () => {
    assert.equal(accelerazionePendenza(0), 0);
});

test('in salita frena, in discesa spinge', () => {
    assert.ok(accelerazionePendenza(0.1) < 0, 'la salita deve togliere velocita\'');
    assert.ok(accelerazionePendenza(-0.1) > 0, 'la discesa deve darne');
});

test('salita e discesa della stessa pendenza sono simmetriche', () => {
    assert.ok(Math.abs(accelerazionePendenza(0.3) + accelerazionePendenza(-0.3)) < 1e-15);
});

test('a 90 gradi vale tutta la gravita\'', () => {
    assert.ok(Math.abs(accelerazionePendenza(Math.PI / 2) + G_NASTRO) < 1e-12);
});

// Una pendenza mancante o malformata deve valere "piano", non NaN: un NaN in
// p.speed si propaga silenziosamente a posizione, classifica e tempi sul giro.
test('una pendenza assente o non numerica vale zero, mai NaN', () => {
    assert.equal(accelerazionePendenza(undefined), 0);
    assert.equal(accelerazionePendenza(null), 0);
    assert.equal(accelerazionePendenza(NaN), 0);
    assert.equal(accelerazionePendenza('0.2'), 0);
});

// --- fin dove si sale ---

test('oltre il limite di salita la gravita\' batte il motore', () => {
    const ACCEL = 0.186;
    const limite = pendenzaMassimaInSalita(ACCEL);
    // Appena sotto il limite il motore vince ancora, appena sopra no.
    assert.ok(ACCEL + accelerazionePendenza(limite - 0.01) > 0, 'sotto il limite si deve salire');
    assert.ok(ACCEL + accelerazionePendenza(limite + 0.01) < 0, 'sopra il limite si deve retrocedere');
});

test('col motore piu\' forte della gravita\' si sale qualunque muro', () => {
    assert.equal(pendenzaMassimaInSalita(G_NASTRO * 2), Math.PI / 2);
});

test('senza accelerazione non si sale niente', () => {
    assert.equal(pendenzaMassimaInSalita(0), 0);
    assert.equal(pendenzaMassimaInSalita(-1), 0);
});

// Dal playtest del 2026-08-25 la gravita' e' la fisica normale del gioco: si
// spegne solo con un no esplicito. Se questo test tornasse a pretendere '1'
// per accenderla, vorrebbe dire che qualcuno ha rimesso il default a spento.
test('la gravita\' e\' accesa salvo un no esplicito', () => {
    const prima = process.env.F1_GRAVITA_NASTRO;
    delete process.env.F1_GRAVITA_NASTRO;
    assert.equal(isGravitaNastroActive(), true, 'senza variabile deve essere accesa');
    process.env.F1_GRAVITA_NASTRO = '1';
    assert.equal(isGravitaNastroActive(), true);
    process.env.F1_GRAVITA_NASTRO = '0';
    assert.equal(isGravitaNastroActive(), false, 'con 0 deve spegnersi');
    if (prima === undefined) delete process.env.F1_GRAVITA_NASTRO;
    else process.env.F1_GRAVITA_NASTRO = prima;
});

// --- il giro della morte (fase 2a) ---

test('dentro il tubo la gravita\' pesa un quarto', () => {
    const { G_NASTRO, G_ACROBATICO, accelerazionePendenza } = require('./GravitaNastro.js');
    assert.equal(G_ACROBATICO, G_NASTRO / 4);
    assert.ok(Math.abs(accelerazionePendenza(Math.PI / 2, G_ACROBATICO) + G_ACROBATICO) < 1e-12);
    // Senza il secondo argomento non cambia NIENTE per il resto della pista.
    assert.equal(accelerazionePendenza(0.3), accelerazionePendenza(0.3, G_NASTRO));
    assert.equal(accelerazionePendenza(0.3, 'un quarto'), accelerazionePendenza(0.3));
});

test('col quarto di gravita\' il raggio massimo resta percorribile', () => {
    // Lega i due numeri: se qualcuno alzasse RAGGIO_ACROBATICO_MAX senza
    // abbassare G_ACROBATICO, il default dell'editor diventerebbe un loop che
    // nessuno completa — e questo test lo direbbe subito.
    const { G_ACROBATICO } = require('./GravitaNastro.js');
    const { MAX_SPEED } = require('./PowertrainModel.js');
    const TrackAcrobatico = require('../../../../frontend/shared/trackAcrobatico.js');
    const TrackSegmenti = require('../../../../frontend/shared/trackSegmenti.js');
    const serve = TrackAcrobatico.velocitaMinima(TrackSegmenti.RAGGIO_ACROBATICO_MAX, G_ACROBATICO);
    assert.ok(serve < MAX_SPEED,
        `il raggio massimo (${TrackSegmenti.RAGGIO_ACROBATICO_MAX}) chiede ${serve.toFixed(2)} u/tick su ${MAX_SPEED}`);
    // E il default deve avere margine vero, non stare sul filo.
    const default_ = TrackAcrobatico.velocitaMinima(TrackSegmenti.RAGGIO_ACROBATICO_DEFAULT, G_ACROBATICO);
    assert.ok(default_ < MAX_SPEED * 0.8,
        `il raggio di default chiede il ${(100 * default_ / MAX_SPEED).toFixed(0)}% della velocita' massima`);
});
