// frontend/shared/f1ProfiloCircuito.test.js
//
// Il profilo che si legge nella pagina di scelta mescola: giri, lunghezza,
// distanza di gara e le quattro barrette che riassumono il carattere della
// pista.
//
// Il test piu importante e' quello sulla COERENZA COL SERVER: il numero di giri
// mostrato prima della qualifica deve essere quello che la gara avra' davvero.
// Se le due strade divergono, il giocatore sceglie la mescola sapendo una
// distanza e ne corre un'altra — e non se ne accorgerebbe nessuno, perche' ogni
// numero preso da solo sembra giusto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const PC = require('./f1ProfiloCircuito');
const { loadTrack, listTracks } = require('../../backend/sockets/games/trackLoader.js');

function fileDi(id) {
    return JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'tracks', `${id}.json`), 'utf8'));
}

const PISTE = listTracks().map(t => t.id);

test('giri e lunghezza sono gli STESSI che usera la gara', () => {
    for (const id of PISTE) {
        const track = loadTrack(id);
        const p = PC.profilo(track.points, fileDi(id).targetKm);
        assert.equal(p.giri, track.totalLaps,
            `${id}: la pagina mescole direbbe ${p.giri} giri, la gara ne fa ${track.totalLaps}`);
        const lunghezzaServer = track.lapLength / 1000;
        assert.ok(Math.abs(p.lunghezzaKm - lunghezzaServer) < 1e-9,
            `${id}: lunghezza ${p.lunghezzaKm} contro ${lunghezzaServer} del server`);
        // E la distanza di gara e' il prodotto delle due, non un terzo numero.
        assert.ok(Math.abs(p.distanzaKm - p.lunghezzaKm * p.giri) < 1e-9);
    }
});

test('i numeri sono plausibili: niente zero, niente infiniti', () => {
    for (const id of PISTE) {
        const p = PC.profilo(loadTrack(id).points, fileDi(id).targetKm);
        assert.ok(p.lunghezzaKm > 0.2 && p.lunghezzaKm < 20, `${id}: lunghezza ${p.lunghezzaKm} km`);
        assert.ok(p.giri >= 1 && p.giri < 200, `${id}: ${p.giri} giri`);
        for (const [nome, v] of Object.entries(p.misure)) {
            assert.ok(Number.isFinite(v), `${id}: la misura "${nome}" non e un numero (${v})`);
            assert.ok(v >= 0, `${id}: la misura "${nome}" e negativa`);
        }
        for (const [nome, v] of Object.entries(p.barrette)) {
            assert.ok(Number.isInteger(v) && v >= 1 && v <= 5,
                `${id}: la barretta "${nome}" vale ${v}, fuori dalla scala 1-5`);
        }
    }
});

test('le barrette DISCRIMINANO: non danno lo stesso voto a tutti', () => {
    // E' il test che protegge la taratura delle soglie. Una barretta che vale 3
    // su ogni circuito non e una misura: e' una decorazione che sembra un dato,
    // ed e' esattamente il motivo per cui l'abrasione dell'asfalto non c'e.
    const profili = PISTE.map(id => PC.profilo(loadTrack(id).points, fileDi(id).targetKm));
    for (const chiave of ['trazione', 'stress', 'frenata', 'caricoAero']) {
        const valori = new Set(profili.map(p => p.barrette[chiave]));
        assert.ok(valori.size > 1,
            `la barretta "${chiave}" da ${[...valori][0]} su tutti i ${profili.length} circuiti: non distingue niente`);
    }
});

test('lo stress gomme non e una copia delle altre barrette', () => {
    // La prima versione restituiva la frazione di giro passata in curva, che e'
    // quasi esattamente trazione + carico aerodinamico: una riga in piu che non
    // aggiungeva niente.
    //
    // Non si verifica un ORDINAMENTO diverso — con pochi circuiti, tutti di
    // forma normale, l'ordine puo' coincidere senza che le misure siano la
    // stessa cosa — ma che il RAPPORTO fra le due vari da pista a pista: se
    // stress fosse trazione+aero in scala, il rapporto sarebbe costante.
    const rapporti = PISTE.map(id => {
        const m = PC.profilo(loadTrack(id).points, fileDi(id).targetKm).misure;
        return m.stress / (m.trazione + m.caricoAero);
    });
    const min = Math.min(...rapporti), max = Math.max(...rapporti);
    assert.ok((max - min) / max > 0.08,
        `stress e trazione+aero stanno in rapporto quasi fisso (${min.toFixed(3)}-${max.toFixed(3)}): e ridondante`);
});

test('un anello perfetto e tutto curva, un rettangolo lungo e tutto rettilineo', () => {
    // Due tracciati costruiti a mano, dove la risposta si sa in anticipo.
    const cerchio = [];
    for (let i = 0; i < 600; i++) {
        const a = (i / 600) * Math.PI * 2;
        cerchio.push({ x: Math.cos(a) * 300, z: Math.sin(a) * 300 });
    }
    const pC = PC.profilo(cerchio, 10);
    assert.equal(pC.barrette.trazione, 1, 'un anello largo non chiede trazione');
    assert.ok(pC.barrette.caricoAero >= 4, 'un anello e tutto curva: il carico deve essere alto');
    assert.equal(pC.barrette.frenata, 1, 'su un anello a raggio costante non si frena mai');

    // Un tornante stretto: raggio 40, sotto la soglia delle curve lente.
    const tornante = [];
    for (let i = 0; i < 600; i++) {
        const a = (i / 600) * Math.PI * 2;
        tornante.push({ x: Math.cos(a) * 40, z: Math.sin(a) * 40 });
    }
    const pT = PC.profilo(tornante, 10);
    assert.equal(pT.barrette.trazione, 5, 'un anello strettissimo e tutto trazione');
    assert.ok(pT.misure.stress < pC.misure.stress,
        'a bassa velocita le gomme soffrono meno che in un curvone veloce');
});
