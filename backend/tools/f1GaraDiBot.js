// backend/tools/f1GaraDiBot.js
//
// Una gara di soli bot, headless, con la VERA `tickGame` del server: quanti
// sorpassi ci sono, quanto tempo passano attaccati, e che traiettoria tengono.
//
// ⚠️ PERCHE' ESISTE. Il playtest del 2026-09-05 sui livelli di difficolta' ha
// detto quello che nessun test aveva colto: «non ho visto sorpassi se non
// magari al via», «si fanno tutta la gara seguendo l'interno curva», «non si
// attaccano/difendono». I test misuravano lo stato di UN bot in UN tick; una
// gara e' un'altra cosa, e va guardata come gara.
//
// Non e' una simulazione semplificata: chiama `tickGame` esportata da
// f1GameSocket, la stessa che gira sul server. Se un giorno divergesse, i
// numeri qui sotto non varrebbero piu' niente.
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');
const { createBots } = require('../sockets/games/f1Bot.js');
const f1 = require('../sockets/games/f1GameSocket.js');

const IO_MUTO = { to: () => ({ emit: () => {} }) };

function garaDiBot(trackId, opzioni) {
    const o = opzioni || {};
    const quanti = o.quanti || 6;
    const giri = o.giri || 3;
    const track = loadTrack(trackId);
    const game = {
        track, phase: 'race', raceStarted: true, raceTick: 0,
        players: {}, gridSize: quanti, tyreConfirmed: new Set(),
        settings: { botDifficolta: o.livello, botsEnabled: 'true' },
        lightsSequenceActive: false,
        // Quello che il server prepara all'avvio di una sessione vera e che qui
        // nessuno ha preparato: senza, tickGame esplode al primo settore.
        bestSectorTimes: [Infinity, Infinity, Infinity],
        // Il server tiene la mappa colore -> socket per parlare ai client: qui
        // non c'e' nessun client, ma la sosta ai box la consulta.
        socketByColor: {},
    };
    createBots(game, { lockedPlayers: [] }, f1.TYRE_COMPOUNDS);
    const bot = Object.values(game.players);
    // In griglia: incolonnati sul tracciato, il piu' veloce davanti — com'e'
    // dopo una qualifica.
    bot.sort((a, b) => b.botSpeedFactor - a.botSpeedFactor);
    bot.forEach((p, k) => {
        const idx = (track.points.length - k * 6) % track.points.length;
        const punto = track.points[idx];
        const nrm = TrackGeometry.normalAt(track.points, idx, true);
        const lato = (k % 2 ? 1 : -1) * 3;
        p.x = punto.x + nrm.nx * lato;
        p.z = punto.z + nrm.nz * lato;
        p.trackIndex = idx;
        p.angle = Math.atan2(track.points[(idx + 1) % track.points.length].x - punto.x,
                             track.points[(idx + 1) % track.points.length].z - punto.z);
        p.speed = 0; p.vx = 0; p.vz = 0; p.lap = 0;
    });

    // La classifica di un istante: chi ha percorso piu' strada.
    const avanzamento = (p) => (p.lap || 0) * track.points.length + (p.trackIndex || 0);
    const ordine = () => bot.slice().sort((a, b) => avanzamento(b) - avanzamento(a)).map(p => p.color);

    const stati = {};
    let sorpassi = 0, tickAttaccati = 0, tickTotali = 0, difese = 0, scostamentoDifesa = 0;
    const scostamenti = [];
    let precedente = ordine();

    const maxTick = Math.round((giri + 1) * 60 * 1000 / 50);
    for (let t = 0; t < maxTick; t++) {
        f1.tickGame(IO_MUTO, 'banco', game);
        tickTotali++;
        for (const p of bot) {
            const s = (p._botDebug && p._botDebug.state) || '?';
            stati[s] = (stati[s] || 0) + 1;
            if (s === 'FOLLOWING' || s === 'OVERTAKING' || s === 'DEFENDING') tickAttaccati++;
            if (s === 'DEFENDING') { difese++; scostamentoDifesa += Math.abs(p._botDebug.scostamentoDifensivo || 0); }
            // Dove sta rispetto all'asse: il segno dice il lato, e su una
            // curva dice se sta all'interno o all'esterno.
            const q = TrackGeometry.nearestPoint(track.points, p.x, p.z);
            scostamenti.push({ i: q.index, d: q.dist, x: p.x, z: p.z, colore: p.color });
        }
        // Un sorpasso e' uno scambio fra due vicini in classifica.
        const adesso = ordine();
        for (let k = 0; k < adesso.length; k++) {
            if (adesso[k] !== precedente[k]) { sorpassi++; break; }
        }
        precedente = adesso;
        if (bot.every(p => (p.lap || 0) >= giri)) break;
    }

    return { game, bot, sorpassi, stati, tickAttaccati, tickTotali, scostamenti, track,
             difese, scostamentoMedioDifesa: difese ? scostamentoDifesa / difese : 0 };
}

if (require.main === module) {
    const trackId = process.argv[2] || 'prova';
    const giri = Number(process.argv[3] || 3);
    console.log('gara di soli bot su ' + trackId + ', ' + giri + ' giri, 6 bot per livello');
    console.log('');
    console.log('livello'.padEnd(12) + 'tick in difesa'.padStart(20) +
                'tick attaccati'.padStart(16) + '   stati');
    for (const livello of ['facile', 'medio', 'difficile']) {
        const r = garaDiBot(trackId, { livello, giri, quanti: 6 });
        const stati = Object.entries(r.stati).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => k + ' ' + (100 * v / (r.tickTotali * r.bot.length)).toFixed(0) + '%')
            .join('  ');
        console.log(livello.padEnd(12) + String(r.difese).padStart(20) +
                    (r.tickAttaccati + ' su ' + r.tickTotali * r.bot.length).padStart(16) +
                    '   scostamento medio ' + r.scostamentoMedioDifesa.toFixed(2) + '   ' + stati);
    }
}

module.exports = { garaDiBot };
