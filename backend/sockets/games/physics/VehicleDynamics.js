// backend/sockets/games/physics/VehicleDynamics.js
//
// Vehicle Dynamics: facade — unico punto da cui f1GameSocket.js::tickGame
// invoca la simulazione vettura per-tick. Per ora si limita a ri-esportare
// le funzioni già esistenti in TyreModel/VehiclePhysics/CollisionResolver
// (nessuna logica qui dentro): l'obiettivo di questo file è dare un seam
// stabile a tickGame, così che le estrazioni successive dentro
// VehiclePhysics.js (PowertrainModel/BrakingModel/SteeringModel/
// AerodynamicsModel/VehicleMotionModel — vedi
// docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md) non
// debbano più toccare f1GameSocket.js.
const { applyTyreWear } = require('./TyreModel');
const { updateVelocity, integratePosition, applyOffTrackDrag } = require('./VehiclePhysics');
const { COLLISION_SUBSTEPS, applyBridgeBarrier, resolveCollisions } = require('./CollisionResolver');

module.exports = {
    COLLISION_SUBSTEPS,
    updateVelocity, integratePosition, applyOffTrackDrag,
    applyBridgeBarrier, resolveCollisions,
    applyTyreWear
};
