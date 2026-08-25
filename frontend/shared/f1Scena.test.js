// frontend/shared/f1Scena.test.js
//
// ⚠️ `node --test backend/` NON esegue questo file: serve
// `node --test frontend/shared/`.
//
// Questo è un test di CARATTERIZZAZIONE: non descrive come vorremmo che fosse
// costruita la scena, descrive come è costruita OGGI. Serve a estrarre quelle
// righe da f1.js senza cambiare di una virgola ciò che il giocatore vede, e a
// impedire che cambi domani per sbaglio.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Il modulo crea materiali: in Node THREE non c'è, e qui non serve — la
// sequenza e i parametri sono ciò che va protetto, non il colore dell'asfalto.
global.THREE = {
    MeshStandardMaterial: function (p) { Object.assign(this, p || {}); },
    DoubleSide: 2,
};
const F1Scena = require('./f1Scena.js');
const ROOT = path.join(__dirname, '..', '..');
const PISTE = fs.readdirSync(path.join(ROOT, 'frontend/tracks'))
    .filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));

// Un TrackMeshBuilder finto che prende nota di quello che gli chiedono invece
// di costruirlo: è così che si verifica una SEQUENZA.
//
// ⚠️ Non è solo comodo, è NECESSARIO: il TrackMeshBuilder vero usa `window` e
// in Node non si carica nemmeno («window is not defined»). Il modulo lo prende
// dal global nel browser e dal chiamante nei test.
function builderChePrendeNota(registro) {
    const nomi = ['buildGround', 'buildEmbankment', 'buildBridgeDecks', 'buildRibbon',
                  'buildCurbs', 'buildGravel', 'buildBarriers', 'buildStartLine',
                  'buildPitLane', 'buildStartingGrid'];
    const finto = {};
    for (const nome of nomi) {
        finto[nome] = (...args) => {
            // Gli argomenti che contano sono i numeri: funzioni e array di
            // punti si riassumono, altrimenti il registro è illeggibile.
            registro.push(nome + '(' + args.slice(1).map(a =>
                typeof a === 'number' ? a.toFixed(2)
                : typeof a === 'function' ? 'fn'
                : Array.isArray(a) ? 'punti[' + a.length + ']'
                : a && typeof a === 'object' ? 'oggetto'
                : String(a)).join(', ') + ')');
        };
    }
    return finto;
}

const scenaFinta = () => ({ children: [], add() { this.children.push({}); } });
const pista = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/tracks', id + '.json'), 'utf8'));

test('la sequenza di costruzione è quella del gioco, nell ordine del gioco', async () => {
    const registro = [];
    await F1Scena.costruisciCircuito(scenaFinta(), pista('prova'),
        { builder: builderChePrendeNota(registro), gridSize: 6 });

    // L'ordine RIFLETTE LA SEZIONE REALE della pista: terreno, poi asfalto,
    // poi cordolo, poi ghiaia, poi barriera. Cambiarlo cambia cosa si vede —
    // la ghiaia sopra il cordolo, la barriera sotto il prato.
    assert.deepEqual(registro.map(r => r.split('(')[0]), [
        'buildGround', 'buildEmbankment', 'buildBridgeDecks',
        'buildRibbon', 'buildCurbs', 'buildGravel', 'buildBarriers',
        'buildStartLine', 'buildPitLane', 'buildStartingGrid',
    ]);
});

test('i parametri derivati valgono quelli di oggi', async () => {
    const trackData = pista('prova');
    const c = await F1Scena.costruisciCircuito(scenaFinta(), trackData,
        { builder: builderChePrendeNota([]), gridSize: 6 });
    assert.equal(c.roadHalf, trackData.roadHalfWidth);
    assert.equal(c.curbW, 2.8);
    assert.equal(c.embankmentStart, trackData.roadHalfWidth + 2.8);
    assert.equal(c.barrierDist, trackData.roadHalfWidth + 2.8 + 1.2);
    assert.equal(c.trackPts.length, 1000, 'il gioco campiona a 1000');
    assert.ok(c.embankOuter > c.embankPlateau, 'la rampa sta oltre il pianoro');
    assert.ok(c.groundPts.length <= c.trackPts.length, 'i punti a terra escludono i ponti');
    assert.ok(c.pitPts.length > 0 && c.barrierProfile, 'corsia e muro ci sono');
});

test('la larghezza del cordolo entra nelle chiamate che la usano', async () => {
    // 2.8 non è un numero qualunque: è la stessa costante con cui il server
    // calcola il muro fisico. Se qui passasse un altro valore, il cordolo
    // disegnato e quello contro cui si sbatte starebbero in due posti diversi.
    const registro = [];
    await F1Scena.costruisciCircuito(scenaFinta(), pista('prova'),
        { builder: builderChePrendeNota(registro), gridSize: 6 });
    const curbs = registro.find(r => r.startsWith('buildCurbs'));
    assert.match(curbs, /2\.80/, `buildCurbs ha ricevuto: ${curbs}`);
});

test('ogni pista si costruisce senza esplodere', async () => {
    for (const id of PISTE) {
        const registro = [];
        await F1Scena.costruisciCircuito(scenaFinta(), pista(id),
            { builder: builderChePrendeNota(registro), gridSize: 6 });
        assert.equal(registro.length, 10, `${id}: attese 10 chiamate, fatte ${registro.length}`);
    }
});

test('la barra di caricamento è facoltativa, e viene chiamata se c è', async () => {
    const passi = [];
    let respiri = 0;
    await F1Scena.costruisciCircuito(scenaFinta(), pista('prova'), {
        builder: builderChePrendeNota([]), gridSize: 6,
        passo: (testo, frazione) => passi.push(frazione),
        respira: async () => { respiri++; },
    });
    assert.ok(passi.length >= 2, 'il gioco vuole sapere a che punto è');
    assert.ok(respiri >= 2, 'e vuole poter respirare fra un blocco e l altro');

    // E senza, non deve esplodere: l'anteprima non ha una barra.
    await F1Scena.costruisciCircuito(scenaFinta(), pista('prova'),
        { builder: builderChePrendeNota([]) });
});

test('senza TrackMeshBuilder lo dice, invece di fallire dentro', async () => {
    await assert.rejects(
        () => F1Scena.costruisciCircuito(scenaFinta(), pista('prova'), {}),
        /TrackMeshBuilder/);
});

// ⚠️ DUE NUMERI CHE DEVONO RESTARE UNO. Il cuneo di terra sotto una curva
// sopraelevata prosegue oltre il bordo dell'asfalto esattamente quanto il
// cordolo, che su quel lato continua la stessa pendenza del nastro. Se il
// cordolo si allargasse e il cuneo no, resterebbe scoperto di sin(rollio) per
// la differenza; se fosse il contrario, il terreno spunterebbe sopra il
// cordolo. Il numero vive in TrackGeometry (che non conosce la scenografia) e
// qui si controlla che sia ancora lo stesso.
test('il cuneo del banking prosegue oltre il bordo quanto il cordolo', () => {
    const TrackGeometry = require('./trackGeometry.js');
    assert.equal(TrackGeometry.CUNEO_OLTRE_IL_BORDO, F1Scena.CURB_W,
        'CUNEO_OLTRE_IL_BORDO e CURB_W sono lo stesso bordo: vanno cambiati insieme');
});
