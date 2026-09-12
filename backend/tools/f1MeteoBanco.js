// backend/tools/f1MeteoBanco.js
//
// TEMPO SUL GIRO PER OGNI MESCOLA A OGNI CIELO, su piste vere.
//
// Serve a tarare due cose di TyreModel, e a verificarne una terza:
//   1. `ADERENZA_PERSA_SUL_BAGNATO` — quanto costa il bagnato con la gomma
//      GIUSTA addosso. Bersaglio: +10% sul giro a bagnato pieno.
//   2. le larghezze delle `FINESTRE_BAGNATO` — a ogni cielo deve vincere la
//      mescola giusta.
//   3. che l'asciutto non sia cambiato di un millesimo.
//
// Uso:
//   node backend/tools/f1MeteoBanco.js              tutte le piste, tutti i cieli
//   node backend/tools/f1MeteoBanco.js --asciutto   solo la colonna a secco
//   node backend/tools/f1MeteoBanco.js prova        una pista sola
//
// ⚠️ IL DADO C'ERA, e l'avevo dato per assente. Scritto «qui il rumore e' zero
// perche' il bot non pesca», e misurando: sei run identici davano 0.70 s di
// escursione a secco e 1.80 s sul bagnato — piu' della differenza che si stava
// tarando, e la curva della taratura zigzagava. Il bot ripesca il ritmo quattro
// volte a giro e sporca lo sterzo, e lo fa solo IN GARA: cioe' proprio nella
// modalita' in cui questo banco deve girare per vedere le mescole.
//
// Adesso `simulateLap` riceve un dado seminato (`opts.seme`): due run a
// parametri uguali danno lo stesso numero al millesimo. Resta che UN seme e' un
// campione: la dinamica del bot cambia col parametro in modo non monotono,
// quindi si tara sulla MEDIANA di tre semi, non su un run.
//
// ⚠️ NON RIGENERARE LA RACING LINE mentre si tara: si riottimizza sul parametro
// che stai misurando e ti mente. Su `prova` e `monte-rosso` c'e' un
// `-raceline.json` e comanda quello: e' la condizione giusta per misurare, ma
// va sapendolo.
const { simulateLap } = require('./f1LapSimulator.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');
const TyreModel = require('../sockets/games/physics/TyreModel.js');

const MESCOLE = ['soft', 'medium', 'hard', 'intermedie', 'pioggia'];
const CIELI = [0, 0.25, 0.5, 0.75, 1];

// ⚠️ `gara: true` NON E' UN DETTAGLIO. Senza, il simulatore gira in modalita'
// qualifica, e in qualifica la mescola la decide il cielo: si misurerebbe
// cinque volte la stessa gomma. E' la stessa forma del difetto che ha tenuto
// questo banco cieco alla taratura delle gomme per settimane.
function giro(pista, mescola, bagnato) {
    const track = loadTrack(pista);
    // ⚠️ RITMO, PASSO E RUMORE VANNO PASSATI: `makeSimPlayer` li copia da
    // `opts` senza ripiego, e senza di essi `botSpeedFactor` resta undefined —
    // la velocita' obiettivo diventa NaN, lo sterzo NaN, e l'auto sta ferma
    // allo spawn per tutti i 3600 tick. Il banco stampava «fuori» su ogni
    // casella e sembrava un problema della pioggia.
    // Rumore ZERO: un banco di taratura non deve avere dadi.
    const r = simulateLap(track, { mescola, gara: true, bagnato, safetyCapS: 180,
                                   speedFactor: 1, paceMult: 1, precisionNoise: 0 });
    return (r && r.timeMs) ? r.timeMs / 1000 : null;
}

function tabella(pista, cieli) {
    console.log('');
    console.log('=== ' + pista + ' ===');
    console.log(['bagnato', ...MESCOLE].map(s => s.padStart(11)).join(''));
    const righe = [];
    for (const b of cieli) {
        const tempi = MESCOLE.map(m => giro(pista, m, b));
        righe.push({ bagnato: b, tempi });
        const celle = tempi.map((t) => (t === null ? 'fuori' : t.toFixed(3)));
        // La migliore del cielo si marca, perche' e' il criterio da verificare.
        let migliore = -1, best = Infinity;
        tempi.forEach((t, i) => { if (t !== null && t < best) { best = t; migliore = i; } });
        console.log(b.toFixed(2).padStart(11)
            + celle.map((c, i) => (i === migliore ? '*' + c : ' ' + c).padStart(11)).join(''));
    }
    return righe;
}

const argomenti = process.argv.slice(2);
const soloAsciutto = argomenti.includes('--asciutto');
const piste = argomenti.filter(a => !a.startsWith('--'));
const PISTE = piste.length ? piste : ['prova', 'monte-rosso'];
const cieli = soloAsciutto ? [0] : CIELI;

console.log('TEMPO SUL GIRO (s) — mescola x cielo. L\'asterisco e\' la migliore di quella riga.');
console.log('aderenza persa sul bagnato con la gomma giusta: '
    + TyreModel.ADERENZA_PERSA_SUL_BAGNATO);

const risultati = {};
for (const pista of PISTE) risultati[pista] = tabella(pista, cieli);

if (!soloAsciutto) {
    console.log('');
    console.log('=== I DUE CRITERI ===');
    for (const pista of PISTE) {
        const righe = risultati[pista];
        const secco = righe.find(r => r.bagnato === 0);
        const pieno = righe.find(r => r.bagnato === 1);
        if (secco && pieno) {
            // Il migliore a secco contro il migliore sotto il diluvio: e'
            // «quanto costa la pioggia a chi ha la gomma giusta».
            const mSecco = Math.min(...secco.tempi.filter(t => t !== null));
            const mPieno = Math.min(...pieno.tempi.filter(t => t !== null));
            const perc = ((mPieno / mSecco - 1) * 100);
            console.log(pista.padEnd(14) + 'col treno giusto il diluvio costa '
                + perc.toFixed(1) + '%  (bersaglio +10%)   '
                + (Math.abs(perc - 10) <= 4 ? 'nel bersaglio' : 'DA TARARE'));
        }
        // E a ogni cielo deve vincere la mescola della finestra giusta.
        for (const r of righe) {
            let migliore = null, best = Infinity;
            r.tempi.forEach((t, i) => { if (t !== null && t < best) { best = t; migliore = MESCOLE[i]; } });
            const atteso = TyreModel.mescolaPerCielo(r.bagnato);
            const attesoFamiglia = TyreModel.MESCOLE_ASCIUTTO.includes(atteso)
                ? TyreModel.MESCOLE_ASCIUTTO : [atteso];
            const ok = migliore && attesoFamiglia.includes(migliore);
            console.log('  '.padEnd(14) + 'bagnato ' + r.bagnato.toFixed(2)
                + ': vince ' + String(migliore).padEnd(11)
                + (ok ? 'giusto' : 'ATTESA ' + atteso + ' (finestre da ritarare)'));
        }
    }
}
