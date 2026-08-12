// backend/tools/f1-segnalazioni.js
//
// Rilegge le segnalazioni raccolte in gioco col tasto M e le stampa in
// ordine, dicendo per ognuna dove sei sulla pista. Serve a passare da "una
// tribuna è messa male" a un oggetto preciso con le sue coordinate, senza
// misurare a tappeto tutto il circuito.
//
// Uso:  node backend/tools/f1-segnalazioni.js
const store = require('../dev/segnalazioniStore');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
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

function stampa(file) {
    const records = store.leggi(file);
    if (!records.length) {
        console.log('Nessuna segnalazione. Il file è vuoto o non esiste ancora.');
        return;
    }
    let ultimoTrack = null, track = null;
    for (const rec of records) {
        if (rec.trackId !== ultimoTrack) {
            track = loadTrack(rec.trackId);
            ultimoTrack = rec.trackId;
            console.log(`\n=== ${track.name} (${rec.trackId}) ===`);
        }
        const d = descriviPuntoPista(track.points, track.roadHalf, rec);
        const dove = d.dentroPista ? 'in pista' : `fuori pista, ${d.distanzaAsse} dall'asse`;
        const giro = rec.giro === null ? 'giro ignoto' : `giro ${rec.giro}`;
        console.log(`\n[${rec.n}] ${dove} — ${d.progressione}% del giro (campione ${d.indice})`);
        console.log(`     posizione  x=${rec.pos.x} y=${rec.pos.y} z=${rec.pos.z}`);
        console.log(`     muso ${rec.headingDeg}°, ${rec.velocita} km/h, ${giro}, camera ${rec.camera}${rec.guardaDietro ? ' (guardava dietro)' : ''}`);
    }
    console.log('');
}

if (require.main === module) stampa(store.FILE_DEFAULT);

module.exports = { descriviPuntoPista, direzioneRelativa, gradiVerso, stampa };
