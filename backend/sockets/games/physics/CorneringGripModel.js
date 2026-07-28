// backend/sockets/games/physics/CorneringGripModel.js
//
// Cornering Grip Model: Fase 4 (Rif.
// docs/superpowers/specs/2026-07-28-f1-cornering-grip-limit-design.md).
// Responsabilità UNICA: tradurre lo stato del player nell'eccesso
// laterale (0..1) — quanto la domanda di aderenza in curva eccede la
// capacità disponibile in questo tick. NON riduce il grip, non tocca `p`,
// non possiede stato: la riduzione effettiva (e l'eventuale stato
// persistente futuro) è applicata dal chiamante (VehiclePhysics.js). Non
// duplica TyreForceModel: la capacità è richiesta a corneringGripFactor,
// mai ricalcolata qui.
//
// NON è un modello di slip angle fisico (vedi nota terminologica nella
// spec): è un modello di perdita di CAPACITÀ laterale, stesso principio
// domanda/capacità già usato per trazione e frenata in TyreSlipModel.js.
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');

function lateralExcess(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    const capacity = corneringGripFactor(p.tyreWear, isQuali);
    return corneringExcess(p.inputs.steer, speedFrac, capacity);
}

module.exports = { lateralExcess };
