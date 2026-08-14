// backend/tools/f1-segnalazioni.js
//
// Rilegge le segnalazioni raccolte in gioco col tasto M e le stampa in
// ordine, dicendo per ognuna dove sei sulla pista. Serve a passare da "una
// tribuna è messa male" a un oggetto preciso con le sue coordinate, senza
// misurare a tappeto tutto il circuito.
//
// Uso:  node backend/tools/f1-segnalazioni.js
const fs = require('fs');
const path = require('path');
const store = require('../dev/segnalazioniStore');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const TrackScenery = require('../../frontend/shared/trackScenery.js');
const { loadTrack } = require('../sockets/games/trackLoader');

// Dove sei rispetto alla pista: campione più vicino, quanto sei avanti nel
// giro, quanto sei lontano dall'asse e se sei ancora sull'asfalto.
function descriviPuntoPista(trackPts, roadHalf, rec) {
    const vicino = TrackGeometry.nearestPoint(trackPts, rec.pos.x, rec.pos.z);
    return {
        indice: vicino.index,
        progressione: Math.round(vicino.index / trackPts.length * 1000) / 10,
        distanzaAsse: Math.round(vicino.dist * 100) / 100,
        dentroPista: vicino.dist <= roadHalf
    };
}

const SETTORI = ['davanti', 'avanti a destra', 'a destra', 'dietro a destra',
                 'dietro', 'dietro a sinistra', 'a sinistra', 'avanti a sinistra'];

// Dove cade un oggetto rispetto al muso dell'auto. Convenzione del gioco:
// rotY cresce verso +X, quindi un angolo maggiore di quello del muso sta
// alla DESTRA di chi guida.
function direzioneRelativa(headingDeg, gradiVersoOggetto) {
    const delta = (((gradiVersoOggetto - headingDeg) % 360) + 360) % 360;
    return SETTORI[Math.round(delta / 45) % 8];
}

function gradiVerso(da, a) {
    const g = Math.atan2(a.x - da.x, a.z - da.z) * 180 / Math.PI;
    return ((g % 360) + 360) % 360;
}

// I `quanti` oggetti di scenografia più vicini al punto, con distanza e
// verso rispetto al muso: serve a distinguere l'oggetto che il giocatore
// stava guardando da quello che aveva alle spalle.
//
// Un tipo di oggetto compare UNA volta sola, col suo esemplare più vicino.
// Senza questo la lista è inutile dove conta: gli spettatori sono 2989 dei
// 4075 elementi di `prova`, quindi accanto a una tribuna i cinque più vicini
// sono cinque spettatori e la tribuna non si vede; e lungo una barriera sono
// cinque pile di gomme identiche. Tutta la folla conta come un tipo solo.
function vicini(layout, rec, quanti) {
    const ordinati = layout
        .map(v => ({
            asset: v.asset,
            category: v.category,
            distanza: Math.round(Math.hypot(v.x - rec.pos.x, v.z - rec.pos.z) * 100) / 100,
            direzione: direzioneRelativa(rec.headingDeg, gradiVerso(rec.pos, v))
        }))
        .sort((a, b) => a.distanza - b.distanza);

    const visti = new Set();
    const scelti = [];
    for (const v of ordinati) {
        const tipo = v.category === 'crowd' ? 'crowd' : v.asset;
        if (visti.has(tipo)) continue;
        visti.add(tipo);
        scelti.push(v);
        if (scelti.length === quanti) break;
    }
    return scelti;
}

// Ricostruisce lo STESSO layout che il gioco ha generato al caricamento.
// Ogni argomento qui sotto corrisponde a uno di frontend/f1.js:655 — se uno
// diverge, gli oggetti che stampiamo non sono quelli che il giocatore aveva
// davanti.
const CURB_W = 2.8;              // f1.js:156
const EMBANKMENT_WIDTH = 45;     // f1.js:168

function layoutDi(trackId, track) {
    // Il .json grezzo della pista, non l'oggetto derivato di loadTrack:
    // generateLayout vuole controlPoints, pit.path, pit.boxIndex.
    const raw = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', 'frontend', 'tracks', `${trackId}.json`), 'utf8'));
    // I posti a sedere: il client li prende con una fetch (f1.js:646), qui si
    // leggono dal file. Se mancano, la scenografia si genera lo stesso senza
    // spettatori — che per noi non sono oggetti da segnalare.
    let seatAnchors = null;
    try {
        seatAnchors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend',
            'assets', 'custom', 'circuit', 'grandStandSeats.json'), 'utf8')).seats;
    } catch (err) { /* tribune vuote, come fa il client */ }
    // Idem per le ancore degli spettatori sulle terrazze delle infrastrutture.
    let terraceAnchors = null;
    try {
        terraceAnchors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend',
            'assets', 'custom', 'circuit', 'terraceAnchors.json'), 'utf8')).anchors;
    } catch (err) { /* terrazze vuote, come fa il client */ }

    const BARRIER_D = raw.roadHalfWidth + CURB_W + 1.2;   // f1.js:157
    // track.points e track.pitLanePts sono campionati con le stesse costanti
    // del client (1000 e 300 campioni, vedi trackLoader.js:14-17).
    return TrackScenery.generateLayout(raw, track.points, track.pitLanePts,
        BARRIER_D, EMBANKMENT_WIDTH, seatAnchors, track.barrierProfile, terraceAnchors);
}

function stampa(file) {
    const records = store.leggi(file);
    if (!records.length) {
        console.log('Nessuna segnalazione. Il file è vuoto o non esiste ancora.');
        return;
    }
    let ultimoTrack = null, track = null, layout = null;
    for (const rec of records) {
        if (rec.trackId !== ultimoTrack) {
            track = loadTrack(rec.trackId);
            layout = layoutDi(rec.trackId, track);
            ultimoTrack = rec.trackId;
            console.log(`\n=== ${track.name} (${rec.trackId}) ===`);
            // Riepilogo per confrontare la ricostruzione col client: se questi
            // numeri non coincidono con quelli loggati dal gioco, i nomi degli
            // oggetti stampati sotto NON sono attendibili.
            const perCategoria = {};
            for (const v of layout) perCategoria[v.category] = (perCategoria[v.category] || 0) + 1;
            console.log(`    scenografia ricostruita: ${layout.length} elementi —`,
                Object.entries(perCategoria).map(([c, n]) => `${c}:${n}`).join(' '));
        }
        const d = descriviPuntoPista(track.points, track.roadHalf, rec);
        const dove = d.dentroPista ? 'in pista' : `fuori pista, ${d.distanzaAsse} dall'asse`;
        const giro = rec.giro === null ? 'giro ignoto' : `giro ${rec.giro}`;
        console.log(`\n[${rec.n}] ${dove} — ${d.progressione}% del giro (campione ${d.indice})`);
        console.log(`     posizione  x=${rec.pos.x} y=${rec.pos.y} z=${rec.pos.z}`);
        console.log(`     muso ${rec.headingDeg}°, ${rec.velocita} km/h, ${giro}, camera ${rec.camera}${rec.guardaDietro ? ' (guardava dietro)' : ''}`);
        for (const v of vicini(layout, rec, 5)) {
            console.log(`     · ${v.asset} (${v.category}) a ${v.distanza}, ${v.direzione}`);
        }
    }
    console.log('');
}

if (require.main === module) stampa(store.FILE_DEFAULT);

module.exports = { descriviPuntoPista, direzioneRelativa, gradiVerso, vicini, layoutDi, stampa };
