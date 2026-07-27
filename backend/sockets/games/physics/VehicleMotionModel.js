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

// Ghiaia: rallentamento fuori pista. Ritorna se il giocatore è fuori pista in
// questo tick, riusato da TyreModel.applyTyreWear per il piccolo extra di usura.
// (Chi è nella corsia box vera e propria è guidato dall'autopilota, escluso
// da questa funzione — vedi il filtro "racing" in tickGame — quindi non
// serve un'esenzione qui: la zona di trigger d'ingresso è comunque abbastanza
// vicina al bordo pista normale da non scattare mai.)
function applyOffTrackDrag(p, track) {
    const dist = nearestTrackDist(track, p.x, p.z);
    const offTrack = dist > track.roadHalf + 2;
    if (offTrack) {
        const k = Math.min(1, (dist - track.roadHalf - 2) / 8);   // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
    return offTrack;
}

module.exports = { integratePosition, applyOffTrackDrag };
