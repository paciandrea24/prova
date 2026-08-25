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
//
// Fase 2 (Rif. docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md,
// percorso di confronto F1_AERO_DOWNFORCE_MODEL=1): il contributo aero
// downforce si combina con corneringGripFactor nella capacità — consultato
// DIRETTAMENTE da AerodynamicsModel, mai tramite effectiveGrip (che è un
// consumer indipendente dello stesso contributo, nessuna lettura
// incrociata — vedi spec, nota sul doppio conteggio).
const { corneringGripFactor } = require('./TyreForceModel');
const { corneringExcess } = require('./TyreSlipModel');
const AerodynamicsModel = require('./AerodynamicsModel');
const { fuelCorneringFactor } = require('./FuelModel');

// Contributo relativo alla capacità laterale (moltiplicatore adimensionale
// ~1 = nominale, <1 = usura, fino a +15% con downforce ad alta velocità,
// scontato da danno al fondo se F1_AERO_DAMAGE_MODEL attivo) — NON un
// valore di grip assoluto, la stessa scala già usata come termine di
// corneringExcess sotto. Estratta da qui (era inline) per essere
// consultata anche dal bot IA (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md) senza
// duplicare la formula.
function corneringCapacity(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    let capacity = corneringGripFactor(p.tyreWear, isQuali);
    if (AerodynamicsModel.isAeroDownforceModelActive()) {
        capacity *= AerodynamicsModel.downforceFactor(speedFrac, p.damageParts);
    }
    // Peso del carburante: l'auto piena ha meno capacita' laterale
    // disponibile. Consumatore INDIPENDENTE dallo stesso fatto fisico
    // agganciato in SteeringModel.turnRate — nessun doppio conteggio: qui il
    // bot DECIDE quanto frenare per la curva, li' la sterzata si ESEGUE.
    // Stessa separazione gia' documentata per downforceFactor.
    capacity /= fuelCorneringFactor(p);
    // SOPRAELEVAZIONE. Su una curva banked una parte del peso dell'auto spinge
    // verso l'interno invece che di lato, quindi la gomma ha più margine prima
    // di scivolare. Qui e in nessun altro posto: questa funzione la consulta
    // anche il bot per decidere quanto frenare (vedi la nota sopra su
    // corneringCapacity estratta apposta), quindi il banking arriva anche a lui
    // senza che f1Bot.js debba sapere cos'è un rollio.
    //
    // Il guadagno cresce col seno del rollio — è la componente di peso che si
    // riversa sulla curva — normalizzato sul rollio massimo, così vale
    // esattamente BANKING_GUADAGNO_MAX sulla parabolica più ripida ammessa e
    // non oltre: una curva non deve mai diventare gratis.
    capacity *= fattoreBanking(p.rollio);
    return capacity;
}

// Quanto in più tiene l'auto sulla sopraelevazione più ripida ammessa (45°).
// Da tarare in pista: vedi il piano della fase 1b-1.
const BANKING_GUADAGNO_MAX = 0.35;
const ROLLIO_MAX = 45 * Math.PI / 180;

// Un rollio assente o malformato vale piano, mai NaN: un NaN qui si
// propagherebbe alla tenuta in curva e da lì alla traiettoria, senza un errore
// che lo dica.
function fattoreBanking(rollio) {
    if (typeof rollio !== 'number' || !Number.isFinite(rollio) || rollio <= 0) return 1;
    const quota = Math.min(1, Math.sin(rollio) / Math.sin(ROLLIO_MAX));
    return 1 + BANKING_GUADAGNO_MAX * quota;
}

function lateralExcess(p, isQuali, maxSpeed) {
    const speedFrac = Math.min(1, Math.abs(p.speed) / maxSpeed);
    return corneringExcess(p.inputs.steer, speedFrac, corneringCapacity(p, isQuali, maxSpeed));
}

module.exports = { lateralExcess, corneringCapacity, fattoreBanking, BANKING_GUADAGNO_MAX };
