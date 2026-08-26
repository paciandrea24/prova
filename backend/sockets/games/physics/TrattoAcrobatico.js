// backend/sockets/games/physics/TrattoAcrobatico.js
//
// DENTRO IL GIRO DELLA MORTE COMANDA IL NASTRO.
//
// Fuori: l'auto si muove in x/z (VehicleMotionModel.integratePosition) e da lì
// si ricava il campione più vicino. Dentro non si può, per due motivi che non
// hanno rimedio: in cima al loop l'avanzamento orizzontale è zero mentre l'auto
// va a 200, e allo stesso punto in pianta corrispondono la salita e la discesa.
// Quindi qui si avanza LUNGO il nastro e da lì si ricavano x, y, z.
//
// ⚠️ Il cambio di regime è LOCALE a un tratto, ed è la ragione per cui il giro
// della morte non costa la riscrittura del gioco: fuori di qui non cambia
// niente, e la spina dorsale (i campioni, `trackIndex`) resta una sola — giri,
// settori, tempi e classifica continuano a contare come sempre.
// Rif. docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md (FASE 2)
const TrackAcrobatico = require('../../../../frontend/shared/trackAcrobatico.js');

// L'auto è nel tubo se il campione sotto di lei lo è. Il campione lo tiene
// aggiornato `avanza` (dentro) o `updateTrackIndex` (fuori): qui non si cerca
// niente in pianta, che lì dentro darebbe il ramo sbagliato.
function entrato(p, track) {
    const q = track.points[p.trackIndex];
    return !!(q && q.acrobatico);
}

// Avanza di `p.speed * dt` lungo il nastro.
//
// `p.speed` può essere NEGATIVA: chi non ce la fa si ferma in salita e torna
// indietro, ed è voluto (decisione 3 della spec — non si cade mai, si riscende).
// Per questo l'indice si muove nei due versi.
function avanza(p, track, dt) {
    const n = track.points.length;
    const passo = track.lapLength / n;
    p.sTubo = (p.sTubo || 0) + p.speed * dt;
    let indice = p.trackIndex;
    // Un ciclo per verso, con il contatore di sicurezza: a velocità assurde
    // (un danno, un test) un while su `passo` piccolo girerebbe all'infinito.
    let passi = 0;
    while (p.sTubo >= passo && passi++ < n) { p.sTubo -= passo; indice = (indice + 1) % n; }
    while (p.sTubo < 0 && passi++ < n) { p.sTubo += passo; indice = (indice - 1 + n) % n; }

    const q = track.points[indice];
    p.trackIndex = indice;
    p.x = q.x; p.y = q.y || 0; p.z = q.z;
    p.pendenza = q.pendenza;
    p.rollio = q.rollio || 0;
    p.acrobatico = !!q.acrobatico;
    p.frame = q.acrobatico ? TrackAcrobatico.frameDi(q) : null;
    if (p.frame) {
        // L'auto guarda dove guarda il nastro: `angle` lo leggono collisioni,
        // HUD e minimappa, e lasciarlo all'ultimo valore di fuori vorrebbe dire
        // un'auto che nel tubo punta altrove.
        p.angle = Math.atan2(p.frame.tan.x, p.frame.tan.z);
        // E la velocità in pianta, che leggono scia, usura e consumo motore:
        // tenuta coerente con l'avanzamento vero invece che congelata.
        p.vx = p.speed * p.frame.tan.x;
        p.vz = p.speed * p.frame.tan.z;
    }
    // Usciti: chi comanda torna a essere la pianta, e il resto della briciola
    // di avanzamento si perde qui — è meno di un passo di campione.
    //
    // ⚠️ USCIRE NON E' COMPLETARE. Dal tubo si esce in due modi: in avanti,
    // avendo fatto il giro, oppure all'indietro — chi arriva piano si ferma in
    // salita e riscende da dove è entrato (decisione 3 della spec). Chi legge
    // deve poterli distinguere: contare il rientro come un giro fatto
    // significherebbe dire «completato» a chi non ce l'ha fatta, e un test del
    // validatore (fase 2b) taratosi su quello darebbe la velocità d'ingresso
    // sbagliata.
    if (!q.acrobatico) {
        const completato = p.speed >= 0;
        p.sTubo = 0;
        p.frame = null;
        return { uscito: true, completato };
    }
    return { uscito: false, completato: false };
}

module.exports = { entrato, avanza };
