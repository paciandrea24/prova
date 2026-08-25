// backend/sockets/games/physics/VehicleMotionModel.js
//
// Vehicle Motion Model: integrazione della posizione da vx/vz + drag
// fuoripista. Estratto da VehiclePhysics.js — refactoring architetturale
// (Rif. docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md),
// nessuna formula cambiata.
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');

function integratePosition(p, dt) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
}

// Fuoripista: distanza dal punto più vicino della pista caricata.
function nearestTrackDist(track, x, z) {
    return TrackGeometry.nearestPoint(track.points, x, z).dist;
}

// Ghiaia: rallentamento fuori pista. Ritorna `offTrack` (riusato da
// TyreModel.applyTyreWear per il piccolo extra di usura) e `profondita`
// (0..1, riusata da DamageModel per il danno al fondo): sfiorare l'erba non
// costa quanto attraversare la ghiaia.
//
// La soglia e' roadHalf + 2, e quei 2 sono la fascia del CORDOLO: chi sta sul
// cordolo non e' fuori pista, quindi non consuma gomma e non rovina il fondo.
// E' una richiesta esplicita dell'utente, ed e' soddisfatta gratis da questa
// soglia — c'e' un test che la difende, non toglierla.
//
// ATTENZIONE: il ritorno e' un OGGETTO, non piu' un booleano. Un oggetto e'
// sempre vero: un chiamante rimasto indietro non da' errore, crede solo di
// essere fuori pista ad ogni tick.
//
// (Chi e' nella corsia box vera e propria e' guidato dall'autopilota, escluso
// da questa funzione — vedi il filtro "racing" in tickGame — quindi non
// serve un'esenzione qui: la zona di trigger d'ingresso e' comunque abbastanza
// vicina al bordo pista normale da non scattare mai.)
function applyOffTrackDrag(p, track) {
    // ⚠️ UNA sola ricerca del campione piu' vicino, non due: gira per ogni
    // auto a ogni tick (50/s) ed e' O(1000) sui punti della pista. Serve sia
    // la distanza sia l'indice — la distanza per sapere se si e' fuori,
    // l'indice per sapere quanto e' larga la pista PROPRIO LI'.
    const vicino = TrackGeometry.nearestPoint(track.points, p.x, p.z);
    const dist = vicino.dist;
    // La mezza carreggiata DI QUI, non quella nominale: da quando un tratto
    // puo' essere piu' largo degli altri, `track.roadHalf` descrive la pista
    // media e non quella sotto le ruote. Il caricatore garantisce il campo su
    // ogni campione, quindi qui non serve un ripiego.
    const sotto = track.points[vicino.index];
    const mezza = (sotto && typeof sotto.halfWidth === 'number')
        ? sotto.halfWidth : track.roadHalf;
    const offTrack = dist > mezza + 2;
    if (!offTrack) return { offTrack: false, profondita: 0 };
    const k = Math.min(1, (dist - mezza - 2) / 8);   // 0..1 in funzione della profondità
    const drag = 0.04 + k * 0.08;
    p.speed *= (1 - drag);
    p.vx   *= (1 - drag);
    p.vz   *= (1 - drag);
    return { offTrack: true, profondita: k };
}

module.exports = { integratePosition, applyOffTrackDrag };
