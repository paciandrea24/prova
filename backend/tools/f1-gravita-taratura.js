// backend/tools/f1-gravita-taratura.js
//
// Banco di taratura della gravità lungo il nastro (fase 1a, Rif.
// docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md).
//
// Confronta flag spento e flag acceso sulla stessa pista e stampa DOVE la
// differenza si vede: la velocità media nei campioni in salita, in discesa e in
// piano. Il tempo sul giro è stampato per ultimo e vale come contorno — un flag
// di guida si giudica dove agisce, non sul totale.
//
// Uso:  node backend/tools/f1-gravita-taratura.js [pista] [ripetizioni]
//       node backend/tools/f1-gravita-taratura.js prova 30
const { loadTrack } = require('../sockets/games/trackLoader.js');
const { simulateLap, parseArgs } = require('./f1LapSimulator.js');

// Soglia di "tratto in pendenza": 5% di tangente. Su prova ci cade circa il 7%
// dei campioni, con punte del +10.7% e del -6.9%.
const SOGLIA_PCT = 5;

function media(v) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }

function misura(track, pista, ripetizioni) {
    // Le opzioni sono quelle di default dello strumento ufficiale: il banco
    // deve misurare la stessa auto che misurano tutti gli altri.
    const opts = parseArgs([pista]);
    const salita = [], discesa = [], piano = [], tempi = [];
    for (let r = 0; r < ripetizioni; r++) {
        // Nessun seme da passare: il rumore viene da botLapPaceMult, che il bot
        // si ri-randomizza da solo più volte per giro. È esattamente il motivo
        // per cui i giri sono 30 e mai uno.
        const res = simulateLap(track, opts);
        if (res.timeMs) tempi.push(res.timeMs);
        for (const t of res.telemetry || []) {
            const pct = Math.tan(track.points[t.idx].pendenza) * 100;
            if (pct > SOGLIA_PCT) salita.push(t.speedKmh);
            else if (pct < -SOGLIA_PCT) discesa.push(t.speedKmh);
            else piano.push(t.speedKmh);
        }
    }
    return {
        salita: media(salita), discesa: media(discesa), piano: media(piano),
        tempo: media(tempi), giriValidi: tempi.length
    };
}

function main() {
    const pista = process.argv[2] || 'prova';
    const ripetizioni = parseInt(process.argv[3], 10) || 30;
    const track = loadTrack(pista);

    // ⚠️ Per spegnere serve '0': dal playtest del 2026-08-25 la gravità è accesa
    // di default, quindi togliere la variabile la lascerebbe accesa e il banco
    // confronterebbe due volte la stessa configurazione senza dirlo.
    process.env.F1_GRAVITA_NASTRO = '0';
    const spento = misura(track, pista, ripetizioni);
    process.env.F1_GRAVITA_NASTRO = '1';
    const acceso = misura(track, pista, ripetizioni);
    delete process.env.F1_GRAVITA_NASTRO;

    const { G_NASTRO } = require('../sockets/games/physics/GravitaNastro.js');
    const riga = (nome, a, b) => {
        const delta = b - a;
        const pct = a ? (delta / a * 100) : 0;
        console.log(`  ${nome.padEnd(22)} ${a.toFixed(1).padStart(9)} ${b.toFixed(1).padStart(9)}  ${(delta >= 0 ? '+' : '')}${delta.toFixed(1).padStart(8)}  ${(pct >= 0 ? '+' : '')}${pct.toFixed(1)}%`);
    };

    console.log(`\nPista: ${pista} — ${ripetizioni} giri per configurazione — G_NASTRO = ${G_NASTRO}`);
    console.log(`Campioni oltre il ${SOGLIA_PCT}% di pendenza contano come salita/discesa.\n`);
    console.log('  ' + 'misura'.padEnd(22) + '   spento'.padStart(9) + '   acceso'.padStart(9) + '     delta       %');
    riga('velocita\' in salita', spento.salita, acceso.salita);
    riga('velocita\' in discesa', spento.discesa, acceso.discesa);
    riga('velocita\' in piano', spento.piano, acceso.piano);
    console.log('');
    riga('tempo sul giro (ms)', spento.tempo, acceso.tempo);
    console.log(`\n  giri completati: ${spento.giriValidi}/${ripetizioni} spento, ${acceso.giriValidi}/${ripetizioni} acceso`);
    if (acceso.giriValidi < ripetizioni) {
        console.log('  ⚠️  a flag acceso qualche giro non si chiude: G_NASTRO è probabilmente troppo alto.');
    }
    console.log('');
}

main();
