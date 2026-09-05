// backend/tools/f1Telemetria.js
//
// Registra il giro di un pilota UMANO, tick per tick, per confrontarlo con
// quello del bot.
//
// ⚠️ PERCHE' ESISTE. Il 2026-09-05 l'utente ha girato `prova` in 47.3 s. La
// traiettoria che i bot considerano ideale vale 48.25 s e il bot in gara ne
// fa 49.15: il divario e' in due meta' quasi uguali — 900 ms li perde il bot
// rispetto alla propria linea, 950 ms li perde la linea rispetto a come guida
// una persona. Sapere QUANTO non basta per decidere dove intervenire: serve
// sapere DOVE lungo il giro, e se si perde per velocita' (nello stesso punto
// il bot va piu' piano) o per traiettoria (passa da un'altra parte e fa piu'
// strada). Sono due interventi diversi.
//
// Il tempo si conta in TICK di fisica, come fa `f1LapSimulator`: il confronto
// fra due orologi diversi non varrebbe niente.
//
// ⚠️ SPENTO NON FA NIENTE, ed e' spento sempre tranne quando si misura:
// `F1_TELEMETRIA=1`. Il gioco vero non paga un ramo in piu' per campione.
const fs = require('fs');
const path = require('path');

function creaRegistratore(opzioni) {
    const o = opzioni || {};
    const attiva = !!o.attiva;
    const cartella = o.cartella || __dirname;
    // Un giro in corso per ogni (lobby, colore): due piloti nella stessa gara
    // registrano due file diversi.
    const giri = new Map();
    const chiaveDi = (lobbyId, colore) => lobbyId + '|' + colore;

    function campiona(lobbyId, p, raceTick, tickMs) {
        if (!attiva || !p || p.isBot) return;
        const k = chiaveDi(lobbyId, p.color);
        let lista = giri.get(k);
        if (!lista) { lista = []; giri.set(k, lista); }
        const input = p.inputs || {};
        lista.push({
            t: raceTick * tickMs,
            x: round(p.x), z: round(p.z),
            v: round(p.speed),
            i: p.trackIndex || 0,
            gas: round(input.throttle || 0),
            freno: round(input.brake || 0),
            sterzo: round(input.steer || 0),
        });
    }

    // Scrive il giro appena chiuso e ricomincia. Restituisce il percorso del
    // file, oppure null se non c'era niente da scrivere.
    function chiudiGiro(lobbyId, info) {
        if (!attiva) return null;
        const i = info || {};
        const k = chiaveDi(lobbyId, i.colore || primoColore(lobbyId));
        const lista = giri.get(k);
        if (!lista || !lista.length) return null;
        giri.delete(k);
        const colore = k.slice(lobbyId.length + 1);
        const file = path.join(cartella,
            `telemetria-${i.pista || 'pista'}-${colore}-giro${i.giro || 0}.json`);
        fs.writeFileSync(file, JSON.stringify({
            pista: i.pista || null,
            colore,
            giro: i.giro || 0,
            tickMs: lista.length > 1 ? lista[1].t - lista[0].t : null,
            campioni: lista,
        }));
        return file;
    }

    // Con un solo pilota umano in gara — il caso della misura — non serve
    // dire chi: si prende quello che sta registrando.
    function primoColore(lobbyId) {
        for (const k of giri.keys()) {
            if (k.startsWith(lobbyId + '|')) return k.slice(lobbyId.length + 1);
        }
        return '';
    }

    return { campiona, chiudiGiro, attiva };
}

function round(v) {
    return typeof v === 'number' ? Math.round(v * 1000) / 1000 : 0;
}

// Il registratore del server: acceso solo da F1_TELEMETRIA.
const condiviso = creaRegistratore({
    attiva: !!process.env.F1_TELEMETRIA,
    cartella: __dirname,
});

module.exports = { creaRegistratore, condiviso };
