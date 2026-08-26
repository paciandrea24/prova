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
// ⚠️ SI AVANZA IN ANGOLO, NON DI CAMPIONE IN CAMPIONE. La prima stesura posava
// l'auto sul campione raggiunto e buttava via la frazione di avanzamento: con
// 69 campioni su 160 unità di tubo la posizione saltava di 2.3 unità per volta e
// l'orientamento di 5 gradi. In gioco si vedeva — «si vede scattare, la camera
// non è fluida» (playtest del 2026-08-26). Ora la posizione dell'auto è
// `TrackAcrobatico.puntoAlAngolo(tubo, θ)` con θ continuo, e i campioni servono
// solo a tenere aggiornato `trackIndex` per giri, settori e classifica.
//
// ⚠️ Il cambio di regime è LOCALE a un tratto, ed è la ragione per cui il giro
// della morte non costa la riscrittura del gioco: fuori di qui non cambia
// niente, e la spina dorsale (i campioni, `trackIndex`) resta una sola.
// Rif. docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md (FASE 2)
const TrackAcrobatico = require('../../../../frontend/shared/trackAcrobatico.js');

const GIRO = 2 * Math.PI;

// L'auto è nel tubo se il campione sotto di lei lo è. Il campione lo tiene
// aggiornato `avanza` (dentro) o `updateTrackIndex` (fuori): qui non si cerca
// niente in pianta, che lì dentro darebbe il ramo sbagliato.
function entrato(p, track) {
    const q = track.points[p.trackIndex];
    return !!(q && q.acrobatico);
}

// Il campione che corrisponde all'angolo `th`, cercato a partire da quello
// corrente: i campioni del tubo sono consecutivi e in un tick se ne percorrono
// pochi, quindi si cammina invece di ricercare da capo.
function campioneAll(track, da, th) {
    const n = track.points.length;
    let i = da;
    for (let passi = 0; passi < n; passi++) {
        const dopo = track.points[(i + 1) % n];
        if (!dopo || !dopo.acrobatico || dopo.loopAngolo > th) break;
        i = (i + 1) % n;
    }
    for (let passi = 0; passi < n; passi++) {
        const q = track.points[i];
        if (!q || !q.acrobatico || q.loopAngolo <= th) break;
        i = (i - 1 + n) % n;
    }
    return i;
}

// Avanza di `p.speed * dt` lungo il nastro.
//
// `p.speed` può essere NEGATIVA: chi non ce la fa si ferma in salita e torna
// indietro, ed è voluto (decisione 3 della spec — non si cade mai, si riscende).
function avanza(p, track, dt) {
    const n = track.points.length;
    const q = track.points[p.trackIndex];
    const tubo = q && q.tubo;
    // Un campione acrobatico senza il suo tubo non dovrebbe esistere: se
    // capita, si esce invece di dividere per undefined.
    if (!tubo) { staccati(p); return { uscito: true, completato: false }; }

    // All'ingresso l'angolo parte da quello del campione su cui si è entrati...
    if (typeof p.thetaTubo !== 'number') {
        p.thetaTubo = q.loopAngolo || 0;
        // ...e con lui si conserva DA CHE PARTE della carreggiata si stava.
        //
        // ⚠️ Senza, chi imbocca il tubo sul lato destro viene risucchiato al
        // centro nel primo tick: un salto laterale di mezza carreggiata, che in
        // gioco si vede come un teletrasporto («poi vengono tipo teletrasportati
        // nel loop», riscontro dell'utente del 2026-08-26). L'offset è la `u` di
        // (s, u) che la spec prometteva e che la prima stesura aveva lasciato
        // indietro, mettendo tutti sull'asse.
        const dove = TrackAcrobatico.puntoAlAngolo(tubo, p.thetaTubo);
        const mezza = (typeof q.halfWidth === 'number' && q.halfWidth > 0) ? q.halfWidth : 11;
        const u = (p.x - dove.x) * dove.lat.x + (p.z - dove.z) * dove.lat.z;
        p.uTubo = Math.max(-mezza, Math.min(mezza, u));
    }
    // Da lunghezza d'arco ad angolo. ⚠️ Il raggio, non la lunghezza vera del
    // percorso: lo spostamento laterale allunga il tragitto del 2%, e tenerne
    // conto qui vorrebbe dire un integrale a ogni tick per due centesimi di
    // velocità che nessuno può vedere.
    p.thetaTubo += (p.speed * dt) / tubo.raggio;

    // Usciti? Davanti si è completato il giro, dietro si è tornati indietro.
    if (p.thetaTubo >= GIRO || p.thetaTubo < 0) {
        const completato = p.thetaTubo >= GIRO;
        const fine = TrackAcrobatico.puntoAlAngolo(tubo, completato ? GIRO : 0);
        const uFine = p.uTubo || 0;
        p.x = fine.x + fine.lat.x * uFine;
        p.y = fine.y + fine.lat.y * uFine;
        p.z = fine.z + fine.lat.z * uFine;
        p.angle = Math.atan2(fine.tan.x, fine.tan.z);
        p.vx = p.speed * fine.tan.x;
        p.vz = p.speed * fine.tan.z;
        // Il campione: il primo fuori dal tubo dalla parte in cui si è usciti.
        let i = p.trackIndex;
        for (let passi = 0; passi < n && track.points[i].acrobatico; passi++) {
            i = completato ? (i + 1) % n : (i - 1 + n) % n;
        }
        p.trackIndex = i;
        p.pendenza = track.points[i].pendenza;
        staccati(p);
        return { uscito: true, completato };
    }

    const punto = TrackAcrobatico.puntoAlAngolo(tubo, p.thetaTubo);
    const u = p.uTubo || 0;
    p.x = punto.x + punto.lat.x * u;
    p.y = punto.y + punto.lat.y * u;
    p.z = punto.z + punto.lat.z * u;
    p.frame = { tan: punto.tan, su: punto.su, lat: punto.lat };
    // La pendenza del nastro È l'angolo percorso: la gravità della fase 1a
    // funziona qui dentro senza una formula nuova.
    p.pendenza = p.thetaTubo;
    p.rollio = 0;
    p.acrobatico = true;
    // L'auto guarda dove guarda il nastro: `angle` lo leggono collisioni, HUD e
    // minimappa, e lasciarlo all'ultimo valore di fuori vorrebbe dire un'auto
    // che nel tubo punta altrove.
    p.angle = Math.atan2(punto.tan.x, punto.tan.z);
    // E la velocità in pianta, che leggono scia, usura e consumo motore.
    p.vx = p.speed * punto.tan.x;
    p.vz = p.speed * punto.tan.z;
    // Il campione serve solo a giri, settori e classifica: la posizione vera
    // viene dall'angolo.
    p.trackIndex = campioneAll(track, p.trackIndex, p.thetaTubo);
    return { uscito: false, completato: false };
}

function staccati(p) {
    p.thetaTubo = undefined;
    p.uTubo = 0;
    p.frame = null;
    p.acrobatico = false;
    p.sTubo = 0;
}

module.exports = { entrato, avanza };
