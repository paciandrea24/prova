// backend/tools/f1-banking-taratura.js
//
// Banco di taratura della sopraelevazione (fase 1b-1, Rif.
// docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md).
//
// Risponde alla sola domanda che conta per chi guida: A PARITA' DI CURVA,
// quanto piu' veloce ci passo se e' sopraelevata? Niente bot, niente racing
// line, niente giro cronometrato: solo la fisica dell'auto.
//
// ⚠️ PERCHE' NON COL SIMULATORE DI GIRI: provato, e la misura era inutilizzabile.
// Il bot ha bisogno della racing line della pista, che va riottimizzata per
// ogni valore del guadagno (la linea giusta su una curva banked non e' quella
// della stessa curva piana); l'ottimizzatore e' stocastico, e la "velocita'
// minima in curva" saltava da +24% con guadagno 0.35 a +3% con 0.60 — cioe' il
// rumore era piu' grande dell'effetto. Qui invece la misura e' deterministica:
// stesso numero a ogni esecuzione.
//
// Come si misura: sterzo tutto da un lato a velocita' tenuta costante, si
// guarda di quanto ruota il vettore velocita' in un tick e da li' il raggio del
// cerchio che l'auto descrive. Il raggio piu' stretto percorribile a una data
// velocita' e' l'inverso della domanda "a che velocita' passo questa curva".
//
// Uso:  node backend/tools/f1-banking-taratura.js [raggi] [gradi]
//       node backend/tools/f1-banking-taratura.js 60,80,120 0,9,18,27,35,45
const physics = require('../sockets/games/physics/VehiclePhysics.js');
const { fattoreBanking, BANKING_GUADAGNO_MAX, ROLLIO_MAX } = require('../sockets/games/physics/Sopraelevazione.js');

const MAX_SPEED = physics.MAX_SPEED;
const KMH = 55;              // stessa conversione del simulatore di giri

// Un'auto in condizioni nominali: gomme nuove, niente danni, serbatoio di
// riferimento. Cambiare queste condizioni cambierebbe i numeri assoluti, non il
// confronto piano/sopraelevato — che e' cio' che il banco deve dire.
function auto(rollio, speed) {
    return {
        x: 0, z: 0, angle: 0, speed,
        vx: 0, vz: speed,
        rollio,
        tyreWear: 0, tyreCompound: 'medium',
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        inputs: { steer: 1, throttle: 1, brake: 0 },
        trackIndex: 0
    };
}

// Il raggio del cerchio che l'auto descrive a sterzo pieno, tenendo la
// velocita' costante. Si lascia assestare la scivolata (il blend fra dove punta
// il muso e dove va davvero l'auto ha una sua inerzia) e poi si misura.
function raggioASterzoPieno(rollio, speed) {
    const p = auto(rollio, speed);
    const ASSESTAMENTO = 120, MISURA = 60;
    let somma = 0;
    for (let t = 0; t < ASSESTAMENTO + MISURA; t++) {
        const prima = Math.atan2(p.vz, p.vx);
        p.speed = speed;                       // velocita' tenuta, non libera
        physics.updateVelocity(p, true, 1);
        physics.integratePosition(p, 1);
        const dopo = Math.atan2(p.vz, p.vx);
        let d = dopo - prima;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (t >= ASSESTAMENTO) somma += Math.abs(d);
    }
    const omega = somma / MISURA;              // rad per tick
    return omega > 1e-9 ? speed / omega : Infinity;
}

// La velocita' piu' alta a cui l'auto riesce ancora a stare dentro un cerchio
// di raggio R. Bisezione: il raggio percorribile cresce con la velocita'.
function velocitaMax(rollio, raggio) {
    let lo = 0.2, hi = MAX_SPEED;
    if (raggioASterzoPieno(rollio, hi) <= raggio) return hi;   // curva presa in pieno
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (raggioASterzoPieno(rollio, mid) <= raggio) lo = mid; else hi = mid;
    }
    return lo;
}

function main() {
    const raggi = (process.argv[2] || '60,80,120,200').split(',').map(Number);
    const gradi = (process.argv[3] || '0,9,18,27,35,45').split(',').map(Number);

    console.log(`\nBANKING_GUADAGNO_MAX = ${BANKING_GUADAGNO_MAX} (il tetto, raggiunto a ${(ROLLIO_MAX * 180 / Math.PI).toFixed(0)}°)`);
    console.log('Velocita\' massima in curva (km/h), e quanto in piu\' della stessa curva piana.\n');
    const intestazione = ['  raggio'].concat(gradi.map(g => `${g}°`.padStart(14))).join('');
    console.log(intestazione);
    for (const R of raggi) {
        const base = velocitaMax(0, R) * KMH;
        const celle = gradi.map(g => {
            const v = velocitaMax(g * Math.PI / 180, R) * KMH;
            const pct = base ? (v / base - 1) * 100 : 0;
            const tetto = v >= MAX_SPEED * KMH - 1e-6 ? '*' : ' ';
            return `${v.toFixed(0)}${tetto}(${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`.padStart(14);
        });
        console.log(`  ${String(R).padStart(6)}${celle.join('')}`);
    }
    console.log('\n  * = l\'auto passa la curva in pieno: piu\' aderenza non serve, li\' il banking non si sente.');
    console.log('  Il fattore di aderenza applicato:');
    console.log('  ' + gradi.map(g => `${g}° → ×${fattoreBanking(g * Math.PI / 180).toFixed(3)}`).join('   ') + '\n');
}

if (require.main === module) main();
module.exports = { raggioASterzoPieno, velocitaMax };
