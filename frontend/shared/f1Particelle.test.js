// frontend/shared/f1Particelle.test.js
//
// Di un effetto particellare l'aspetto si guarda in pista, non qui. Cio' che si
// verifica e' il MOTO, che e' la parte che puo' rompersi in silenzio: la durata
// che dipende dal frame rate, le particelle che sprofondano sotto il prato,
// l'effetto che si spegne a mezz'aria invece di ricadere, il pool che nasce
// tutto insieme e sparisce di colpo.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./f1Particelle');

// Generatore deterministico: due esecuzioni dello stesso test devono dare lo
// stesso risultato, o un rosso raro diventa impossibile da riprodurre.
function randFinto(seme = 1) {
    let s = seme;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
    };
}

test('la vita di una particella dura lo stesso tempo a ogni frame rate', () => {
    function vissuteDopo(ms, fps) {
        const rand = randFinto(7);
        const stato = P.creaStato(P.SCIA);
        // Tutte nate adesso, nessuna rinascita: si misura la sola durata.
        for (let i = 0; i < P.SCIA.numero; i++) P.rinasci(stato, i, P.SCIA, null, rand);
        const dt = 1000 / fps;
        for (let t = 0; t < ms; t += dt) P.avanza(stato, P.SCIA, dt, { emissione: 0, rand });
        let vive = 0;
        for (let i = 0; i < P.SCIA.numero; i++) vive += stato.viva[i];
        return vive;
    }
    // Poco prima della fine della vita sono tutte vive, poco dopo nessuna —
    // a 30, 60 e 144 fps.
    for (const fps of [30, 60, 144]) {
        assert.equal(vissuteDopo(P.SCIA.vitaMs * 0.8, fps), P.SCIA.numero, `a ${fps} fps muoiono presto`);
        assert.equal(vissuteDopo(P.SCIA.vitaMs * 1.2, fps), 0, `a ${fps} fps non muoiono mai`);
    }
});

test('la scia percorre la stessa distanza a 30 e a 144 fps', () => {
    // E' il difetto che c'era prima del modulo: lo spostamento era per FRAME,
    // quindi a 144 fps la scia era due volte e mezzo piu lunga.
    // Senza turbolenza: si misura il MOTO, e la turbolenza e' rumore per
    // definizione — a frame rate diversi la sequenza casuale e' diversa, e
    // lasciarla dentro vorrebbe dire misurare anche quella.
    const SCIA_LISCIA = { ...P.SCIA, turbolenza: 0 };
    function distanzaDopo(fps) {
        const rand = randFinto(3);
        const stato = P.creaStato(SCIA_LISCIA);
        P.rinasci(stato, 0, SCIA_LISCIA, null, rand);
        const partenza = stato.z[0];
        const dt = 1000 / fps;
        // Numero di passi CONTATO, non un `for (t = 0; t < 500; t += dt)`: con
        // dt = 33.333 quindici passi fanno 499.995, il confronto passa ancora e
        // si simulano 533 ms invece di 500. Il modulo era corretto, il conteggio
        // no — ed e' esattamente il tipo di errore che questo test cerca.
        const passi = Math.round(500 / dt);
        for (let i = 0; i < passi; i++) P.avanza(stato, SCIA_LISCIA, dt, { emissione: 0, rand });
        return Math.abs(stato.z[0] - partenza);
    }
    const a30 = distanzaDopo(30);
    const a144 = distanzaDopo(144);
    assert.ok(Math.abs(a30 - a144) < 0.001, `30 fps: ${a30.toFixed(3)} unita, 144 fps: ${a144.toFixed(3)}`);
    // E il valore atteso e' quello storico: 5.4 unita/s per mezzo secondo.
    assert.ok(Math.abs(a144 - 2.7) < 0.05, `distanza in mezzo secondo: ${a144.toFixed(2)}, attesa 2.7 (5.4 unita/s, il valore storico)`);
});

test('i detriti ricadono e si posano, non sprofondano', () => {
    const rand = randFinto(11);
    const stato = P.creaStato(P.DETRITI);
    const ancora = { x: 100, y: 0, z: -50, avantiX: 1, avantiZ: 0 };
    for (let i = 0; i < P.DETRITI.numero; i++) P.rinasci(stato, i, P.DETRITI, ancora, rand);

    let saliteSopraLaNascita = 0;
    const quotaNascita = [];
    for (let i = 0; i < P.DETRITI.numero; i++) quotaNascita.push(stato.y[i]);

    for (let t = 0; t < P.DETRITI.vitaMs * 0.95; t += 16) {
        P.avanza(stato, P.DETRITI, 16, { emissione: 0, rand });
        for (let i = 0; i < P.DETRITI.numero; i++) {
            if (stato.y[i] > quotaNascita[i]) saliteSopraLaNascita++;
            assert.ok(stato.y[i] >= P.DETRITI.pavimento - 1e-6,
                `particella ${i} sprofondata a ${stato.y[i]}`);
        }
    }
    assert.ok(saliteSopraLaNascita > 0, 'nessuna zolla e mai salita: non e uno schizzo, e una perdita');
});

test('i detriti restano dove sono nati: e l auto ad andarsene', () => {
    // La differenza con la scia: questi vivono nel MONDO. Se si spostassero
    // quanto la scia, seguirebbero la vettura e non direbbero "sono uscito qui".
    const rand = randFinto(5);
    const stato = P.creaStato(P.DETRITI);
    const ancora = { x: 0, y: 0, z: 0, avantiX: 0, avantiZ: 1 };
    P.rinasci(stato, 0, P.DETRITI, ancora, rand);
    const x0 = stato.x[0], z0 = stato.z[0];
    for (let t = 0; t < 600; t += 16) P.avanza(stato, P.DETRITI, 16, { emissione: 0, rand });
    const spostamento = Math.hypot(stato.x[0] - x0, stato.z[0] - z0);
    // In sei decimi di secondo un'auto a 340 km/h fa 56 unita. Una zolla deve
    // restare entro pochi metri dal punto in cui e stata sollevata.
    assert.ok(spostamento < 6, `zolla volata via di ${spostamento.toFixed(1)} unita`);
});

test('a emissione zero le ultime particelle finiscono la corsa, poi il pool si svuota', () => {
    const rand = randFinto(13);
    const stato = P.creaStato(P.DETRITI);
    P.riempi(stato, P.DETRITI, null, rand);
    // Un istante dopo il rientro in pista ce ne sono ancora in aria...
    P.avanza(stato, P.DETRITI, 50, { emissione: 0, rand });
    let vive = 0;
    for (let i = 0; i < P.DETRITI.numero; i++) vive += stato.viva[i];
    assert.ok(vive > 0, 'le zolle in aria sono sparite di colpo invece di ricadere');
    // ...e dopo una vita intera non ne resta nessuna.
    for (let t = 0; t < P.DETRITI.vitaMs + 100; t += 16) P.avanza(stato, P.DETRITI, 16, { emissione: 0, rand });
    vive = 0;
    for (let i = 0; i < P.DETRITI.numero; i++) vive += stato.viva[i];
    assert.equal(vive, 0, 'il pool non si e svuotato');
});

test('riempi sfalsa le eta: il primo istante non e uno sbuffo unico', () => {
    const rand = randFinto(17);
    const stato = P.creaStato(P.SCIA);
    P.riempi(stato, P.SCIA, null, rand);
    const eta = Array.from(stato.eta);
    const min = Math.min(...eta), max = Math.max(...eta);
    assert.ok(max - min > P.SCIA.vitaMs * 0.5,
        `eta troppo ravvicinate: da ${min.toFixed(0)} a ${max.toFixed(0)} ms`);
});

test('la scala cresce, poi si restringe fino a zero', () => {
    const rand = randFinto(23);
    const stato = P.creaStato(P.SCIA);
    P.rinasci(stato, 0, P.SCIA, null, rand);
    const appenaNata = P.scalaDi(stato, 0, P.SCIA);
    assert.equal(appenaNata, 0, 'appena nata deve essere invisibile, non a piena taglia');

    let massima = 0, quandoMassima = 0;
    for (let t = 0; t < P.SCIA.vitaMs; t += 8) {
        P.avanza(stato, P.SCIA, 8, { emissione: 0, rand });
        const s = P.scalaDi(stato, 0, P.SCIA);
        if (s > massima) { massima = s; quandoMassima = t; }
    }
    assert.ok(massima > 0, 'non e mai diventata visibile');
    assert.ok(quandoMassima < P.SCIA.vitaMs * 0.3, 'il picco deve stare all inizio della vita');
    assert.equal(P.scalaDi(stato, 0, P.SCIA), 0, 'a fine vita deve essere sparita');
});

test('la particella nasce nel riferimento dell auto, non in quello del mondo', () => {
    // Con l'auto che punta a -X, la scia deve finire a +X (dietro di lei), non
    // sempre lungo l'asse Z del mondo.
    const rand = randFinto(29);
    const stato = P.creaStato(P.SCIA);
    const versoMenoX = { x: 0, y: 0, z: 0, avantiX: -1, avantiZ: 0 };
    P.rinasci(stato, 0, P.SCIA, versoMenoX, rand);
    assert.ok(stato.x[0] > 1, `nata a x=${stato.x[0]}: non e dietro l auto`);
    assert.ok(Math.abs(stato.z[0]) < 1.6, `nata a z=${stato.z[0]}: fuori dalla larghezza dell auto`);
    // E la sua velocita la porta ancora piu indietro.
    assert.ok(stato.vx[0] > 0, 'la scia deve scappare all indietro rispetto all auto');
});
