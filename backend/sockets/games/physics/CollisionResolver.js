// backend/sockets/games/physics/CollisionResolver.js
//
// Collision Resolver: muro rigido sui tratti ponte/barriera e collisioni
// auto-auto SAT/OBB. Estratto da f1GameSocket.js (Rif. SDD Capitolo 10.6)
// senza modificarne la logica — stesse formule, stessi valori, stesso
// comportamento.
const TrackGeometry = require('../../../../frontend/shared/trackGeometry.js');
const { MIN_COLLISION_SEVERITY, applyCarCollisionDamage, applyBarrierDamage } = require('./DamageModel');

// Ingombro reale dell'auto, misurato dal GLB (raceCarWhite.glb, bounding box
// combinata body+ruote applicando le translation dei nodi) × lo scale 3.5 con
// cui il modello viene caricato in f1.js: ~2.6 unità di larghezza (fianchi),
// ~4.7 di lunghezza (muso/coda). Il rettangolo va tenuto orientato con
// l'angolo dell'auto (SAT), altrimenti un cerchio esagera soprattutto i fianchi.
// Valori misurati sul modello custom (frontend/assets/custom/f1Car.glb):
// bbox GLB 0.992 x 2.048 (largh. x lungh.) x scale 3.5 = 3.47 x 7.17 in
// gioco -> metà 1.74 x 3.58. Prima erano 1.3/2.4, tarate sul vecchio kart
// Kenney molto più piccolo — con quelle le ruote posteriori del modello
// nuovo restavano fuori dall'hitbox.
const CAR_HALF_LENGTH = 3.58;  // metà lunghezza, asse avanti/dietro (locale Z)
const CAR_HALF_WIDTH = 1.74;  // metà larghezza, asse fianchi (locale X)
const COLLISION_BOUNCE = 0.6;  // quota della velocità normale scambiata all'urto (bump arcade, non elastico puro)

// A MAX_SPEED (6.2/tick) due auto che si avvicinano chiudono fino a 12.4
// unità in un tick — più della zona di contatto minima (~2.6, urto
// fianco-contro-fianco lungo l'asse stretto): senza integrare la posizione
// in sottostep, il rilevamento SAT (fatto una volta a fine tick) può non
// vedere mai la sovrapposizione e le auto si attraversano. 13 sottostep →
// chiusura massima ~0.95 unità/sottostep, stesso margine di sicurezza che
// c'era a MAX_SPEED=4.0 con 8 sottostep.
const COLLISION_SUBSTEPS = 13;

// Sui tratti ponte, uscire lateralmente non deve far "cadere" l'auto (senza
// terreno vero sotto finché non ricade sul terrapieno più lontano, vedi
// Fase 2): il bordo diventa un muro rigido. Stessa soglia già usata per il
// fuoripista (roadHalf+2 in applyOffTrackDrag di VehiclePhysics.js), non una
// nuova distanza.
const BRIDGE_BARRIER_MARGIN = 2;
// Quanta della componente di velocità che spinge oltre il muro (lungo la
// normale, verso l'esterno) viene rimossa ad ogni contatto — la componente
// parallela al muro non viene mai toccata da questo fattore (vedi
// applyBridgeBarrier: nessun calcolo/scelta di verso, solo rimozione della
// spinta verso l'esterno).
const BRIDGE_BARRIER_SLOWDOWN = 0.5;
// Attrito continuo applicato a tutta la velocità (non solo alla componente
// normale) finché l'auto resta appoggiata al muro — un rallentamento reale
// e sostenuto, non solo un colpo secco al momento dell'urto, richiesto
// esplicitamente dall'utente ("non velocità visibile dal contatore ma
// proprio un rallentamento"). Applicato ad ogni sotto-step di contatto
// (COLLISION_SUBSTEPS per tick): da tarare a vista, un valore troppo alto
// qui si amplifica rapidamente su contatti prolungati.
const BRIDGE_BARRIER_CONTACT_DRAG = 0.01;

// Finestra di ricerca locale (con wrap) dell'indice campionato più vicino:
// usata sia qui (applyBridgeBarrier) sia da updateTrackIndex in
// f1GameSocket.js. DEVE restare lo stesso valore nei due punti — per questo
// f1GameSocket.js importa questa costante invece di definirne una propria.
const TRACK_INDEX_WINDOW = 20;

// Muro rigido sui tratti ponte (Fase 3): a differenza di applyOffTrackDrag
// (che si applica ovunque e frena soltanto), qui — solo dove il punto pista
// più vicino è bridge:true — si impedisce fisicamente di superare la
// soglia. La sicurezza (non superare mai il muro) viene prima di tutto: la
// posizione è sempre riportata sul bordo.
//
// Redesign 2026-07-23 (vedi
// docs/superpowers/specs/2026-07-23-f1-barriera-ponte-redesign-design.md):
// tutti i tentativi precedenti provavano a CALCOLARE un verso "giusto" lungo
// il muro (dalla velocità d'impatto, poi da p.speed, poi da orientamento×
// p.speed) — ma qualunque calcolo è di fatto un "aiuto" che decide per il
// giocatore, e quando quel calcolo assume il verso canonico della pista
// (invece del verso reale di marcia) redirige in modo indesiderato chi va
// contromano o in retromarcia (bug segnalato dall'utente). Il fix corretto
// è più semplice: NON scegliere mai un verso. Si rimuove solo la componente
// di velocità che spinge oltre il muro (lungo la normale, verso l'esterno);
// qualunque componente parallela al muro l'auto avesse già — in qualunque
// verso, anche debole o ambigua — resta esattamente quella, senza alcuna
// correzione di direzione o di orientamento.
function applyBridgeBarrier(p, track, isRace) {
    const idx = TrackGeometry.nearestIndexNear(track.points, p.trackIndex || 0, p.x, p.z, TRACK_INDEX_WINDOW);
    const pt = track.points[idx];
    if (!pt.bridge) return;

    const dx = p.x - pt.x, dz = p.z - pt.z;
    const dist = Math.hypot(dx, dz);
    const limit = track.roadHalf + BRIDGE_BARRIER_MARGIN;

    if (dist <= limit) {
        p.wallContact = false;
        return;
    }

    const { nx, nz } = TrackGeometry.normalAt(track.points, idx, true);
    // normalAt punta sempre verso lo stesso lato fisso: va orientata verso
    // il lato da cui l'auto è effettivamente uscita.
    const side = (dx * nx + dz * nz) >= 0 ? 1 : -1;
    const wallNx = nx * side, wallNz = nz * side;

    // Riporta l'auto ESATTAMENTE sul bordo sottraendo solo l'eccesso lungo
    // la normale dalla sua posizione ATTUALE (non ricostruendola da zero sul
    // punto pista campionato pt): con una formula "p.x = pt.x + wallNx*limit"
    // ogni contatto ripiazzerebbe l'auto sullo stesso punto campionato più un
    // offset fisso, scartando qualunque avanzamento tangenziale reale appena
    // fatto — se il contatto scatta ad ogni sotto-step (equilibrio stabile
    // lungo il muro, confermato via log: l'indice pista restava congelato
    // per centinaia di tick nonostante una velocità sana) l'auto resterebbe
    // bloccata esattamente nello stesso punto per sempre. Sottrarre solo
    // l'eccesso preserva l'esatta posizione tangenziale raggiunta, azzerando
    // solo la componente radiale in più.
    const overshoot = dist - limit;
    p.x -= wallNx * overshoot;
    p.z -= wallNz * overshoot;

    // Componente della velocità lungo la normale (con segno: positiva se
    // punta ancora verso l'esterno, cioè sta ancora spingendo l'auto oltre
    // il muro). Si rimuove/smorza SOLO questa componente — quella
    // parallela al muro (vx/vz meno la parte normale) non viene mai
    // toccata: qualunque direzione avesse già l'auto lungo il bordo (avanti,
    // contromano, retromarcia) resta quella, senza alcun calcolo che scelga
    // un verso "giusto" al posto del giocatore.
    const vn = p.vx * wallNx + p.vz * wallNz;
    if (vn > 0) {
        const remove = vn * BRIDGE_BARRIER_SLOWDOWN;
        p.vx -= wallNx * remove;
        p.vz -= wallNz * remove;
    }

    if (!p.wallContact) {
        p.wallContact = true;
        if (isRace && Math.abs(vn) >= MIN_COLLISION_SEVERITY) {
            applyBarrierDamage(p, vn);
        }
    }

    // Attrito continuo mentre l'auto resta appoggiata al muro (non solo un
    // colpo secco al momento dell'urto): un rallentamento REALE e sostenuto
    // finché il contatto persiste — non solo un numero diverso sul
    // contachilometri — richiesto esplicitamente dall'utente.
    const contactKeep = 1 - BRIDGE_BARRIER_CONTACT_DRAG;
    p.vx *= contactKeep;
    p.vz *= contactKeep;

    // p.speed (lo scalare usato da updateVelocity per ricostruire
    // fx/fz = sin/cos(angle)*speed ad ogni tick, vedi blend col grip) va
    // risincronizzato: si proietta la nuova vx/vz sul muso dell'auto
    // (stessa convenzione di updateVelocity), non ricostruito da un verso
    // scelto — altrimenti riappare il disallineamento "velocità fantasma"
    // già diagnosticato e corretto in precedenza.
    p.speed = p.vx * Math.sin(p.angle) + p.vz * Math.cos(p.angle);
}

// ====================================================
// COLLISIONI TRA AUTO — rettangoli orientati (OBB)
// Un cerchio esagera i fianchi rispetto al muso/coda (l'auto è molto più
// stretta che lunga): serve un rettangolo allineato con l'angolo di ciascuna
// auto. Rilevamento con SAT (Separating Axis Theorem, 4 assi: i due assi
// locali di ciascun box) + risoluzione con l'MTV (asse di overlap minimo).
// Correzione posizionale (evita compenetrazione) + scambio parziale della
// componente di velocità lungo la normale (bump arcade). La GRIP di
// updateVelocity (VehiclePhysics.js) riassorbe naturalmente la spinta nei
// tick successivi, quindi non serve alcuno stato dedicato: la fisica
// esistente fa già "recuperare" l'auto dopo l'urto.
// ====================================================
function carAxes(p) {
    const s = Math.sin(p.angle), c = Math.cos(p.angle);
    return {
        forward: { x: s, z: c },    // asse lunghezza (muso/coda)
        right: { x: c, z: -s }    // asse larghezza (fianchi)
    };
}

// Proietta il box di p sull'asse dato: ritorna [min,max] dell'intervallo occupato
function projectOBB(p, axes, axis) {
    const centerProj = p.x * axis.x + p.z * axis.z;
    const radius =
        Math.abs(axes.forward.x * axis.x + axes.forward.z * axis.z) * CAR_HALF_LENGTH +
        Math.abs(axes.right.x * axis.x + axes.right.z * axis.z) * CAR_HALF_WIDTH;
    return { min: centerProj - radius, max: centerProj + radius };
}

const CAR_MAX_REACH = (CAR_HALF_LENGTH + CAR_HALF_WIDTH) * 2;   // scarto rapido, upper bound grossolano

function resolveCollisions(players) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];

            const dx = b.x - a.x, dz = b.z - a.z;
            if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;   // troppo distanti, salta il SAT
            }

            const axesA = carAxes(a);
            const axesB = carAxes(b);
            const axes = [axesA.forward, axesA.right, axesB.forward, axesB.right];

            let minOverlap = Infinity;
            let mtvAxis = null;

            let separated = false;
            for (const axis of axes) {
                const pa = projectOBB(a, axesA, axis);
                const pb = projectOBB(b, axesB, axis);
                const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
                if (overlap <= 0) { separated = true; break; }
                if (overlap < minOverlap) { minOverlap = overlap; mtvAxis = axis; }
            }
            if (separated) {
                a.carContacts.delete(b.color); b.carContacts.delete(a.color);
                continue;
            }

            // Normale dell'MTV, orientata da a verso b
            let nx = mtvAxis.x, nz = mtvAxis.z;
            if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }

            // Separazione posizionale: metà per uno, per non compenetrarsi
            const push = minOverlap * 0.5;
            a.x -= nx * push; a.z -= nz * push;
            b.x += nx * push; b.z += nz * push;

            // Impulso solo se si stanno avvicinando lungo la normale
            const avn = a.vx * nx + a.vz * nz;
            const bvn = b.vx * nx + b.vz * nz;
            const rel = bvn - avn;

            // Danno/penalità SOLO al primo contatto (transizione da "non a
            // contatto" a "a contatto"): uno struscio prolungato non deve
            // riaccumulare danno ad ogni sotto-step. resolveCollisions è
            // chiamata solo `if (!isQuali)` in tickGame, quindi tutto qui è
            // già implicitamente "solo in gara" — nessun controllo fase
            // aggiuntivo necessario.
            const wasInContact = a.carContacts.has(b.color);
            if (!wasInContact) {
                a.carContacts.add(b.color);
                b.carContacts.add(a.color);

                const closingRate = -rel;   // violenza totale dell'urto (rel<0 = si avvicinano)
                if (closingRate >= MIN_COLLISION_SEVERITY) {
                    applyCarCollisionDamage(a, b, avn, bvn, closingRate);
                }
            }

            if (rel < 0) {
                const delta = rel * COLLISION_BOUNCE;
                a.vx += nx * delta; a.vz += nz * delta;
                b.vx -= nx * delta; b.vz -= nz * delta;
            }
        }
    }
}

module.exports = {
    COLLISION_SUBSTEPS, TRACK_INDEX_WINDOW,
    CAR_HALF_LENGTH, CAR_HALF_WIDTH, COLLISION_BOUNCE,
    BRIDGE_BARRIER_MARGIN, BRIDGE_BARRIER_SLOWDOWN, BRIDGE_BARRIER_CONTACT_DRAG,
    applyBridgeBarrier, resolveCollisions
};
