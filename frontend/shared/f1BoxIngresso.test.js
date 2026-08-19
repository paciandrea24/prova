// frontend/shared/f1BoxIngresso.test.js
//
// La traiettoria d'ingresso ai box, provata sui tracciati VERI.
//
// Il test che conta e' quello sulle compenetrazioni. Una curva d'ingresso e'
// facile da scrivere e facile da far sembrare giusta guardandola da sola: il
// punto e' che gli ALTRI stalli hanno dentro delle auto ferme, e una diagonale
// che comincia troppo presto le prende in pieno. E' anche il motivo per cui il
// codice vecchio faceva quella svolta a 90 gradi — evitava il problema
// rinunciando alla manovra.
//
// L'ingombro si prova ORIENTATO, mai come distanza fra i centri: due
// rettangoli lunghi 7.17 e larghi 3.48 che si sfiorano di fianco hanno i
// centri lontanissimi (Rif. feedback ingombro orientato).
const test = require('node:test');
const assert = require('node:assert/strict');
const BI = require('./f1BoxIngresso');
const TG = require('./trackGeometry.js');
const { loadTrack } = require('../../backend/sockets/games/trackLoader.js');

// Ingombro dell'auto: gli stessi valori del server (CollisionResolver.js).
const CAR_HALF_LENGTH = 3.58;
const CAR_HALF_WIDTH = 1.74;

const PISTE = ['prova', 'monte-rosso'];

// Gli ancoraggi dei box come li calcola il server (f1GameSocket.assignGridSpawns).
function boxDi(track, quanti = 8) {
    const anchors = TG.pitBoxAnchors(track.pitPath, track.pitBoxIndex, quanti, track.points, track.pitRoadHalf);
    for (const a of anchors) a.laneIdx = TG.nearestPoint(track.pitLanePts, a.x, a.z).index;
    // Il vicino da cui stare lontani lo calcola il modulo: sono i box che si
    // superano durante la manovra, non tutta la fila (vedi
    // scostamentoViciniPrecedenti).
    for (const a of anchors) {
        a.scostamentoVicini = BI.scostamentoViciniPrecedenti(track.pitLanePts, a.laneIdx, anchors);
    }
    return anchors;
}

// Il piano d'ingresso di un box, con lo scostamento dei vicini gia dentro.
function pianoDi(track, a) {
    return BI.pianoIngresso(track.pitLanePts, a.laneIdx, { x: a.stallX, z: a.stallZ },
        { scostamentoVicini: a.scostamentoVicini });
}

// I quattro angoli di un rettangolo orientato.
function angoli(cx, cz, dirX, dirZ, semiLung, semiLarg) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const ax = dirX / len, az = dirZ / len;
    const px = az, pz = -ax;      // perpendicolare
    const out = [];
    for (const sl of [1, -1]) {
        for (const sw of [1, -1]) {
            out.push({
                x: cx + ax * semiLung * sl + px * semiLarg * sw,
                z: cz + az * semiLung * sl + pz * semiLarg * sw,
            });
        }
    }
    // In ordine CICLICO attorno al rettangolo, non nell'ordine in cui sono
    // stati generati: il SAT prende gli assi dai lati, e con i vertici in
    // ordine "a farfalla" i lati sono le diagonali e il risultato e' falso.
    return [out[0], out[1], out[3], out[2]];
}

// Separating Axis Theorem su due rettangoli orientati: si prova la proiezione
// su tutti e quattro gli assi dei due rettangoli. Se ne esiste uno su cui le
// proiezioni non si toccano, i rettangoli sono separati.
function sovrapposti(a, b) {
    for (const poly of [a, b]) {
        for (let i = 0; i < 4; i++) {
            const p0 = poly[i], p1 = poly[(i + 1) % 4];
            const ax = -(p1.z - p0.z), az = p1.x - p0.x;
            const len = Math.hypot(ax, az) || 1;
            const nx = ax / len, nz = az / len;
            let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
            for (const p of a) { const d = p.x * nx + p.z * nz; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
            for (const p of b) { const d = p.x * nx + p.z * nz; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
            if (maxA < minB || maxB < minA) return false;
        }
    }
    return true;
}

// Percorre la traiettoria d'ingresso di un box e restituisce i campioni, con la
// direzione ricavata dal MOVIMENTO (che e' esattamente come la calcola il
// server: l'auto punta dove si sta muovendo, non dove le si dice di puntare).
function traiettoria(track, anchor, passo = 0.5) {
    const lane = track.pitLanePts;
    const piano = pianoDi(track, anchor);
    const punti = [];
    let prec = null;
    for (let r = piano.lunghezza + 6; r >= 0; r -= passo) {
        const p = BI.posizioneIngresso(lane, piano, r);
        if (prec) {
            const dx = p.x - prec.x, dz = p.z - prec.z;
            if (Math.hypot(dx, dz) > 1e-6) punti.push({ x: p.x, z: p.z, dirX: dx, dirZ: dz, rimanente: r, w: p.w });
        }
        prec = p;
    }
    return { piano, punti };
}

test('il raccordo parte sulla corsia e finisce esattamente nello stallo', () => {
    for (const id of PISTE) {
        const track = loadTrack(id);
        const lane = track.pitLanePts;
        for (const a of boxDi(track)) {
            const piano = pianoDi(track, a);

            // All'inizio del raccordo si e' ancora in mezzo alla corsia.
            const inizio = BI.posizioneIngresso(lane, piano, piano.lunghezza);
            const puntoCorsia = BI.puntoIndietroSullaLane(lane, a.laneIdx, piano.lunghezza);
            assert.ok(Math.hypot(inizio.x - puntoCorsia.x, inizio.z - puntoCorsia.z) < 1e-6,
                `${id}: il raccordo non parte dalla corsia`);

            // Alla fine si e' esattamente sullo stallo, non "quasi".
            const fine = BI.posizioneIngresso(lane, piano, 0);
            assert.ok(Math.hypot(fine.x - a.stallX, fine.z - a.stallZ) < 1e-6,
                `${id}: arrivo a ${Math.hypot(fine.x - a.stallX, fine.z - a.stallZ).toFixed(2)} unita dallo stallo`);
        }
    }
});

test('si arriva DRITTI dentro: niente rotazione sul posto', () => {
    // Il difetto da cui nasce tutto: 88-91 gradi di svolta, misurati sul codice
    // vecchio su ogni box di ogni pista. Qui si misura l'angolo fra la
    // direzione di marcia e la corsia, e non deve mai avvicinarsi a quello.
    for (const id of PISTE) {
        const track = loadTrack(id);
        for (const a of boxDi(track)) {
            const { punti } = traiettoria(track, a);
            const tang = TG.tangentAt(track.pitLanePts, a.laneIdx, false);
            let massimo = 0;
            for (const p of punti) {
                const len = Math.hypot(p.dirX, p.dirZ) || 1;
                const cos = (p.dirX / len) * tang.tx + (p.dirZ / len) * tang.tz;
                const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
                massimo = Math.max(massimo, ang);
            }
            // 88-91 gradi era il codice vecchio, misurato. Il tetto qui e' 65:
            // sotto i 54 non ci arriva NESSUNA traiettoria con questa geometria,
            // e sotto i 61 solo quelle che passano a meno di un'unita dalle auto
            // ferme. Vedi la nota in testa al modulo.
            assert.ok(massimo < 65, `${id} box laneIdx ${a.laneIdx}: sterzata massima ${massimo.toFixed(0)} gradi`);

            // E l'ULTIMO tratto deve essere quasi parallelo alla corsia: e' il
            // "arrivare dritti dentro", ed e' anche la condizione perche' l'auto
            // si fermi parallela senza dover ruotare a fine manovra.
            const ultimo = punti[punti.length - 1];
            const lenU = Math.hypot(ultimo.dirX, ultimo.dirZ) || 1;
            const angU = Math.acos(Math.max(-1, Math.min(1,
                (ultimo.dirX / lenU) * tang.tx + (ultimo.dirZ / lenU) * tang.tz))) * 180 / Math.PI;
            assert.ok(angU < 6, `${id}: si ferma storta di ${angU.toFixed(0)} gradi invece che dritta`);
            // E si RADDRIZZA avvicinandosi, non si storce: l'angolo cala a ogni
            // campione dell'ultimo tratto. Il valore assoluto a meta strada non
            // e' un buon criterio — dipende da quanto e spostato QUEL box, che
            // va da 12 a 23 unita — mentre "sta finendo di girare" e' la cosa
            // che si vede e vale per tutti.
            const coda = punti.slice(-12);
            const angoliCoda = coda.map(p => {
                const len = Math.hypot(p.dirX, p.dirZ) || 1;
                return Math.acos(Math.max(-1, Math.min(1,
                    (p.dirX / len) * tang.tx + (p.dirZ / len) * tang.tz))) * 180 / Math.PI;
            });
            for (let i = 1; i < angoliCoda.length; i++) {
                assert.ok(angoliCoda[i] <= angoliCoda[i - 1] + 0.5,
                    `${id}: nell ultimo tratto si storce invece di raddrizzarsi (${angoliCoda[i - 1].toFixed(0)} -> ${angoliCoda[i].toFixed(0)} gradi)`);
            }
        }
    }
});

test('la traiettoria non entra addosso alle auto ferme negli altri box', () => {
    // IL test. Un raccordo piu lungo sembra piu morbido ed e' piu PERICOLOSO:
    // quando si passa davanti al box precedente si e' gia spostati di lato. E'
    // questo vincolo, non l'estetica, a mettere il tetto alla lunghezza.
    for (const id of PISTE) {
        const track = loadTrack(id);
        const box = boxDi(track);
        let provati = 0;
        for (const mio of box) {
            const { punti } = traiettoria(track, mio);
            for (const altro of box) {
                if (altro === mio) continue;
                // L'auto ferma nello stallo dell'altro, parallela alla corsia.
                const fermo = angoli(altro.stallX, altro.stallZ, altro.tx, altro.tz, CAR_HALF_LENGTH, CAR_HALF_WIDTH);
                for (const p of punti) {
                    // ...e la mia, orientata come si sta muovendo.
                    const mia = angoli(p.x, p.z, p.dirX, p.dirZ, CAR_HALF_LENGTH, CAR_HALF_WIDTH);
                    assert.ok(!sovrapposti(mia, fermo),
                        `${id}: entrando nel box a laneIdx ${mio.laneIdx} si finisce addosso all auto ferma a laneIdx ${altro.laneIdx} (a ${p.rimanente.toFixed(1)} unita dall arrivo, spostamento ${(p.w * 100).toFixed(0)}%)`);
                    provati++;
                }
            }
        }
        assert.ok(provati > 4000, `${id}: solo ${provati} coppie provate`);
    }
});

test('la manovra e a due tempi, e fra i due si viaggia dritti', () => {
    // Il primo tempo porta a poco meno di meta strada e li lo spostamento quasi
    // si ferma: e' quel tratto dritto che permette di superare l'auto ferma nel
    // box precedente prima di girare dentro. Con una diagonale unica le si
    // andrebbe addosso, ed e' il motivo per cui il codice vecchio rinunciava
    // alla manovra e faceva una svolta secca a 90 gradi.
    const track = loadTrack('prova');
    const lane = track.pitLanePts;
    const a = boxDi(track)[3];
    const piano = pianoDi(track, a);
    assert.equal(piano.lunghezza, BI.RACCORDO_A + piano.raccordoB);

    const alloStacco = BI.posizioneIngresso(lane, piano, piano.raccordoB);
    assert.ok(Math.abs(alloStacco.w - piano.frazioneA) < 1e-9,
        `alla fine del primo tempo lo spostamento e ${alloStacco.w}, atteso ${piano.frazioneA}`);
    // E il primo tempo si ferma esattamente a una fascia di sicurezza dal
    // vicino piu interno: e' quello il criterio, non una percentuale.
    const riferimento = Math.min(a.scostamentoVicini, piano.scostamento.modulo);
    const distanzaDalVicino = riferimento - alloStacco.w * piano.scostamento.modulo;
    assert.ok(Math.abs(distanzaDalVicino - BI.FASCIA_SICUREZZA) < 0.01,
        `si transita a ${distanzaDalVicino.toFixed(2)} unita dal vicino invece che a ${BI.FASCIA_SICUREZZA}`);

    // Attorno alla giunzione la deriva laterale quasi si annulla: le due
    // progressioni morbide si toccano li con derivata nulla.
    const q1 = BI.posizioneIngresso(lane, piano, piano.raccordoB + 1);
    const q2 = BI.posizioneIngresso(lane, piano, piano.raccordoB - 1);
    assert.ok(Math.abs(q2.w - q1.w) < 0.05, `giunzione a scatto: ${(q2.w - q1.w).toFixed(3)} di spostamento in due unita`);
});

test('l avanzamento e monotono: non si torna mai indietro', () => {
    // Una S mal fatta puo far arretrare l'auto lungo la corsia mentre si
    // sposta di lato, e in gioco si vedrebbe come uno scatto all indietro.
    const track = loadTrack('prova');
    for (const a of boxDi(track)) {
        const { punti } = traiettoria(track, a, 0.25);
        const tang = TG.tangentAt(track.pitLanePts, a.laneIdx, false);
        for (const p of punti) {
            const avanzamento = p.dirX * tang.tx + p.dirZ * tang.tz;
            assert.ok(avanzamento > 0, `arretra di ${avanzamento.toFixed(3)} a ${p.rimanente.toFixed(1)} dall arrivo`);
        }
    }
});

test('il muro sta prima del punto in cui si sterza, e cade sulla corsia', () => {
    for (const id of PISTE) {
        const track = loadTrack(id);
        const lane = track.pitLanePts;
        for (const a of boxDi(track)) {
            const piano = pianoDi(track, a);
            assert.ok(piano.muro > piano.inizioRaccordo,
                'il muro cade dopo l inizio della sterzata: si premerebbe mentre si sterza');
            const m = BI.muroReazione(lane, piano);
            const d = TG.nearestPoint(lane, m.x, m.z).dist;
            assert.ok(d < 1.5, `${id}: il muro e piantato a ${d.toFixed(2)} unita dalla corsia`);
            // Ed e' orientato come la corsia in quel punto: il pannello ci sta
            // perpendicolare, e una tangente sbagliata lo metterebbe di sbieco.
            assert.ok(Math.abs(Math.hypot(m.tx, m.tz) - 1) < 1e-6, 'tangente non normalizzata');
        }
    }
});

// Mette un'auto sulla corsia a `distanza` unita dal muro, col muso, e
// restituisce { x, z, angolo } come li avrebbe il server.
function autoAllaDistanza(track, piano, distanza) {
    const m = piano.muroPunto;
    // Indietro lungo la direzione della corsia: il muso a `distanza` dal muro
    // significa il CENTRO una semilunghezza piu indietro ancora.
    const arretra = distanza + BI.SEMILUNGHEZZA_AUTO;
    return {
        x: m.x - m.tx * arretra,
        z: m.z - m.tz * arretra,
        angolo: Math.atan2(m.tx, m.tz),
    };
}

test('i tre esiti si misurano sul MUSO, non sul centro dell auto', () => {
    // Il difetto del playtest 2026-08-19: «mi e sembrato che stessi sulla
    // porzione verde quando ho premuto spazio ma mi ha sempre dato buona».
    // Chi gioca mira con la punta; il centro sta 3.58 unita piu indietro, che
    // e' piu della tolleranza perfetta intera.
    const track = loadTrack('prova');
    const piano = pianoDi(track, boxDi(track)[0]);

    const colMuso = autoAllaDistanza(track, piano, 0);
    assert.ok(Math.abs(BI.distanzaDalMuro(piano, colMuso.x, colMuso.z, colMuso.angolo)) < 1e-6,
        'col muso sul muro la distanza deve essere zero');
    assert.equal(BI.esitoDaDistanza(BI.distanzaDalMuro(piano, colMuso.x, colMuso.z, colMuso.angolo)), BI.PERFETTA);

    // E col CENTRO sul muro la misura deve dire "muso gia oltre di una
    // semilunghezza", non zero. E' questo il cuore della correzione: dove cade
    // il bersaglio, non quanto e' larga la finestra attorno — la finestra puo'
    // essere ritarata, il riferimento no.
    const colCentro = { x: piano.muroPunto.x, z: piano.muroPunto.z, angolo: colMuso.angolo };
    const misurata = BI.distanzaDalMuro(piano, colCentro.x, colCentro.z, colCentro.angolo);
    assert.ok(Math.abs(misurata + BI.SEMILUNGHEZZA_AUTO) < 1e-6,
        `col centro sul muro la misura dice ${misurata.toFixed(2)}, attesa ${-BI.SEMILUNGHEZZA_AUTO}`);

    // Le due tolleranze.
    assert.equal(BI.esitoDaDistanza(BI.MURO_PERFETTO - 0.1), BI.PERFETTA);
    assert.equal(BI.esitoDaDistanza(BI.MURO_PERFETTO + 0.5), BI.BUONA);
    assert.equal(BI.esitoDaDistanza(-(BI.MURO_PERFETTO + 0.5)), BI.BUONA, 'appena passato');
    assert.equal(BI.esitoDaDistanza(BI.MURO_BUONO + 1), BI.LENTA);
    assert.equal(BI.esitoDaDistanza(-(BI.MURO_BUONO + 1)), BI.LENTA, 'troppo tardi');
    assert.equal(BI.esitoDaDistanza(null), BI.LENTA, 'mai premuto');
});

test('la distanza dal muro e continua: nessuno scalino, su nessuna pista', () => {
    // IL difetto del playtest 2026-08-19: «non riesco mai a fare pit stop
    // perfetto». Chi giudicava contava i campioni della corsia — una misura
    // quantizzata al passo dei campioni (1.68 unita su `prova`) che sbagliava
    // sempre nello stesso verso — mentre il conto alla rovescia a schermo
    // proiettava il muso sul muro. Scarto misurato: 0.96 unita in media, fino a
    // 1.68, contro una tolleranza di 3. Sommato al ritardo di rete, bastava.
    //
    // Qui si avanza a passi costanti e si verifica che la distanza cali
    // altrettanto: se qualcuno tornasse a contare i campioni, ricomparirebbero
    // gli scalini e questo test li vedrebbe.
    for (const id of PISTE) {
        const track = loadTrack(id);
        const piano = pianoDi(track, boxDi(track)[1]);
        const PASSO = 0.4;
        let precedente = null;
        for (let d = 20; d >= -10; d -= PASSO) {
            const a = autoAllaDistanza(track, piano, d);
            const misurata = BI.distanzaDalMuro(piano, a.x, a.z, a.angolo);
            assert.ok(Math.abs(misurata - d) < 1e-6,
                `${id}: a ${d} unita dal muro ne misura ${misurata.toFixed(3)}`);
            if (precedente != null) {
                const salto = Math.abs((precedente - misurata) - PASSO);
                assert.ok(salto < 1e-6, `${id}: scalino di ${salto.toFixed(3)} unita nella misura`);
            }
            precedente = misurata;
        }
    }
});

test('il conto alla rovescia arriva a zero quando il muso tocca il muro', () => {
    const track = loadTrack('prova');
    const piano = pianoDi(track, boxDi(track)[2]);
    const prima = autoAllaDistanza(track, piano, 10);
    const sopra = autoAllaDistanza(track, piano, 0);
    const dopo = autoAllaDistanza(track, piano, -5);
    assert.ok(BI.distanzaDalMuro(piano, prima.x, prima.z, prima.angolo) > 0, 'prima del muro deve essere positivo');
    assert.ok(Math.abs(BI.distanzaDalMuro(piano, sopra.x, sopra.z, sopra.angolo)) < 1e-6);
    assert.ok(BI.distanzaDalMuro(piano, dopo.x, dopo.z, dopo.angolo) < 0, 'dopo il muro deve essere negativo');
});
