// frontend/shared/trackAcrobatico.js
//
// IL GIRO DELLA MORTE: la forma del tubo e il frame che la descrive.
//
// Un cerchio verticale percorso mentre ci si sposta di lato. Lo spostamento
// laterale NON è un vezzo: senza, il nastro in discesa attraverserebbe quello
// in salita nello stesso punto e l'auto ci passerebbe dentro. È il disegno che
// l'utente ha fatto il 2026-08-26 — «si entra nel loop e poi si esce in un
// tratto di strada che è proprio di fianco. perché altrimenti il loop non si
// può fare».
// Rif. docs/superpowers/specs/2026-08-25-f1-nastro-orientato-design.md (FASE 2)
//
// ⚠️ IL FRAME STA QUI E BASTA. Dove punta il nastro e dov'è l'alto lo dice
// `frameDi`, e lo leggono la mesh, la fisica e la camera. Se uno dei tre se lo
// ricalcolasse, un giorno l'auto sarebbe coricata di là e il tubo di qua — è
// esattamente il difetto che la fase 1b ha già pagato una volta col rollio.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackSegmenti.js'));
    } else {
        root.TrackAcrobatico = factory(root.TrackGeometry, root.TrackSegmenti);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackSegmenti) {

    function versore(x, y, z) {
        const n = Math.hypot(x, y, z) || 1;
        return { x: x / n, y: y / n, z: z / n };
    }

    // I campioni del giro, a passo costante di lunghezza d'arco come tutto il
    // resto della pista.
    //
    // Con θ da 0 a 2π, direzione di marcia `d`, laterale `l`, raggio R e
    // spostamento laterale L (che viene dai due nodi, non da un parametro):
    //
    //     avanti(θ) = R·sin θ          quota(θ) = R·(1 − cos θ)
    //     lato(θ)   = L · smoothstep(θ / 2π)
    //
    // ⚠️ LA SMOOTHSTEP, NON UNA RAMPA LINEARE. La sua derivata è nulla agli
    // estremi, ed è ciò che tiene ingresso e uscita esattamente tangenti alla
    // pista. Con una rampa lineare il nastro entrerebbe storto di
    // atan(L / 2πR) — undici gradi con L=30 e R=25 — e il passaggio fra i due
    // regimi avrebbe uno scatto proprio nel punto in cui si guarda.
    function puntiDelGiro({ ingresso, uscita, dirX, dirZ, raggio, passo }) {
        const R = raggio;
        const latX = dirZ, latZ = -dirX;                  // fianco destro rispetto alla marcia
        const dxU = uscita.x - ingresso.x, dzU = uscita.z - ingresso.z;
        const L = dxU * latX + dzU * latZ;                // spostamento laterale VERO, dai nodi
        const avantiNodi = dxU * dirX + dzU * dirZ;       // di solito ~0; se c'è, lo si onora
        const quanti = Math.max(8, Math.round(2 * Math.PI * R / (passo || 4)));
        // Il tubo, descritto una volta: da qui `puntoAlAngolo` sa ricostruire
        // QUALUNQUE punto del giro, non solo quelli campionati. Viaggia su ogni
        // campione perché è lì che lo trovano la fisica e il client.
        const tubo = {
            ox: ingresso.x, oy: (ingresso.y || 0), oz: ingresso.z,
            raggio: R, dirX, dirZ, latX, latZ, avanti: avantiNodi, lato: L,
        };
        const out = [];
        for (let k = 0; k < quanti; k++) {
            const th = (k / quanti) * 2 * Math.PI;
            const p = puntoAlAngolo(tubo, th);
            out.push({
                x: p.x, y: p.y, z: p.z,
                acrobatico: true,
                loopAngolo: th,
                loopDirX: dirX, loopDirZ: dirZ,
                loopLatX: latX, loopLatZ: latZ,
                tubo,
                // La pendenza del nastro sull'orizzonte È l'angolo percorso, e
                // questo fa funzionare la gravità della fase 1a qui dentro
                // senza una formula nuova: accelerazionePendenza chiede solo la
                // pendenza, e in cima al loop vale π — gravità piena contro il
                // tetto dell'auto, che è ciò che si vuole.
                pendenza: th,
            });
        }
        return out;
    }

    // UN PUNTO QUALUNQUE DEL GIRO, non uno dei campionati.
    //
    // ⚠️ È questa funzione a rendere fluida la percorrenza. Prima l'auto veniva
    // posata sul campione più vicino e la frazione di avanzamento buttata via:
    // con 69 campioni su 160 unità di tubo, si spostava a salti di 2.3 unità e
    // ruotava a scatti di 5 gradi. L'utente l'ha visto subito — «si vede
    // scattare, la camera non è fluida» (playtest del 2026-08-26). Con l'angolo
    // continuo la posizione e il frame sono esatti a ogni frazione di tick.
    function puntoAlAngolo(tubo, th) {
        const s = Math.max(0, Math.min(1, th / (2 * Math.PI)));
        const sm = s * s * (3 - 2 * s);
        const av = tubo.raggio * Math.sin(th) + tubo.avanti * sm;
        const lt = tubo.lato * sm;
        const c = Math.cos(th), sn = Math.sin(th);
        return {
            x: tubo.ox + tubo.dirX * av + tubo.latX * lt,
            y: tubo.oy + tubo.raggio * (1 - c),
            z: tubo.oz + tubo.dirZ * av + tubo.latZ * lt,
            tan: versore(tubo.dirX * c, sn, tubo.dirZ * c),
            su: versore(-tubo.dirX * sn, c, -tubo.dirZ * sn),
            lat: { x: tubo.latX, y: 0, z: tubo.latZ },
        };
    }

    // Dove punta il nastro (`tan`), dov'è l'alto dell'auto (`su`), da che parte
    // è il fianco destro (`lat`).
    //
    // A θ=0 `su` vale (0,1,0) e a θ=π vale (0,−1,0): in cima si è rovesciati,
    // che è il punto di tutto l'esercizio.
    //
    // ⚠️ La tangente ignora il contributo laterale della smoothstep. Vale
    // perché quel termine è al massimo 1.5·L/2πR ≈ 0.29 contro R = 25, e agli
    // estremi è esattamente zero — che è dove la tangenza conta. Se un giorno
    // un test di continuità in ingresso fallisse per centesimi, è QUI che si
    // aggiunge il termine, non in chi legge il frame.
    function frameDi(p) {
        const th = p.loopAngolo || 0;
        const c = Math.cos(th), s = Math.sin(th);
        return {
            tan: versore(p.loopDirX * c, s, p.loopDirZ * c),
            su:  versore(-p.loopDirX * s, c, -p.loopDirZ * s),
            lat: { x: p.loopLatX, y: 0, z: p.loopLatZ },
        };
    }

    // Quanto bisogna correre per completarlo: salire di due raggi costa
    // v² = 4·g·R.
    //
    // ⚠️ NON è la condizione centripeta (v² = g·R) di un'auto che si stacca dal
    // nastro in cima. Qui l'auto è incollata — decisione 3 della spec, «non si
    // cade mai» — quindi non c'è niente da cui staccarsi e conta solo l'energia
    // per arrivare in cima. La prima stesura della spec usava la formula
    // sbagliata e ne concludeva che un loop di raggio 30 chiedesse il 79% della
    // velocità massima: ne chiede il 158%, cioè non si completa.
    function velocitaMinima(raggio, g) {
        return 2 * Math.sqrt(g * raggio);
    }

    // La gravità che si sente DENTRO il tubo, un quarto di quella della pista.
    //
    // ⚠️ Ricopiata da `GravitaNastro.G_ACROBATICO` invece di importarla: quella
    // sta nel backend, e questo modulo lo carica anche l'editor nel browser —
    // che deve poter dire a chi disegna «a questo loop ci arrivi a 246 km/h».
    // Un test in GravitaNastro.test.js verifica che i due numeri siano lo
    // stesso, ed è lo stesso patto già in uso per MAX_DRIVERS fra trackLoader e
    // f1Bot.
    const GRAVITA_TUBO = 0.2;

    // L'accelerazione del motore, ricopiata da `PowertrainModel.ACCEL` con lo
    // stesso patto (un test la lega). Serve a rispondere alla domanda che si fa
    // chi disegna: «quanto rettilineo ci vuole prima di questo loop?».
    const ACCEL_AUTO = 0.186;

    // Quanto rettilineo serve, partendo da fermo, per arrivare al giro con la
    // velocità che chiede: v² / 2a. Da fermi non ci si arriva mai davvero, ed è
    // il motivo per cui il validatore ne pretende meno di così prima di
    // lamentarsi — ma è la misura giusta per dire «qui non ci sta».
    function spazioPerLanciarsi(raggio) {
        const v = velocitaMinima(raggio, GRAVITA_TUBO);
        return (v * v) / (2 * ACCEL_AUTO);
    }

    // I campioni del giro PRENDONO IL POSTO di quelli in pianta fra i due nodi
    // del tratto acrobatico.
    //
    // ⚠️ DOPO il campionamento e non prima. `TrackGeometry.resample` fa passare
    // una spline per i punti di controllo, e i punti del loop in pianta si
    // sovrappongono: la spline oscillerebbe e la pista uscirebbe deformata
    // anche lontano dal tubo. Così invece la pianta resta quella di sempre e il
    // tubo è esatto, generato dalla formula.
    //
    // ⚠️ Senza acrobazie restituisce LO STESSO array, non una copia: è la
    // garanzia che una pista normale resti identica al bit, e un test la
    // verifica per identità.
    function inserisciNeiCampioni(points, geometria, passo) {
        const tratti = (geometria && geometria.tratti) || [];
        const nodi = (geometria && geometria.nodi) || [];
        const acrobazie = [];
        for (let t = 0; t < tratti.length; t++) {
            const a = TrackSegmenti.acrobaziaDi(tratti[t]);
            if (a && nodi[t] && nodi[(t + 1) % nodi.length]) {
                acrobazie.push({
                    raggio: a.raggio, ingresso: nodi[t], uscita: nodi[(t + 1) % nodi.length],
                    // ⚠️ La direzione viene dal NODO, non dai campioni in pianta.
                    // È l'invariante del modello a segmenti — «la direzione
                    // appartiene al nodo» — e qui è l'unica misura sana: in
                    // pianta il tratto acrobatico è un segmento TRASVERSALE
                    // alla marcia (collega ingresso e uscita affiancati), quindi
                    // la spline lì sta già girando verso l'uscita. Misurata sui
                    // campioni, la direzione d'ingresso veniva (1.90, 0.92)
                    // invece di (0, 1): il loop partiva storto di 64 gradi.
                    dir: TrackSegmenti.versore(nodi[t].dir),
                });
            }
        }
        if (!acrobazie.length) return points;

        // Dall'ultima alla prima: sostituire un pezzo sposta gli indici di
        // tutto quello che viene dopo.
        const trovate = acrobazie.map(function (a) {
            return {
                raggio: a.raggio, uscita: a.uscita, dir: a.dir,
                i0: TrackGeometry.nearestPoint(points, a.ingresso.x, a.ingresso.z).index,
                i1: TrackGeometry.nearestPoint(points, a.uscita.x, a.uscita.z).index,
            };
        }).sort(function (p, q) { return q.i0 - p.i0; });

        const out = points.slice();
        for (const a of trovate) {
            const dir = { x: a.dir.dx, z: a.dir.dz };
            const ingresso = out[a.i0];
            const giro = puntiDelGiro({
                ingresso,
                uscita: { x: a.uscita.x, y: ingresso.y || 0, z: a.uscita.z },
                dirX: dir.x, dirZ: dir.z, raggio: a.raggio, passo,
            });
            // I campi che il resto del gioco si aspetta su OGNI campione si
            // ereditano dal punto di ingresso: dentro il tubo la carreggiata
            // non cambia (decisione dell'utente) e non c'è sopraelevazione —
            // il nastro è già orientato dal frame.
            for (const p of giro) {
                p.halfWidth = ingresso.halfWidth;
                p.rollio = 0;
            }
            const quanti = (a.i1 - a.i0 + out.length) % out.length;
            out.splice(a.i0 + 1, Math.max(0, quanti - 1), ...giro);
        }
        return out;
    }


    // I CAMPIONI DELLA PISTA, PER TUTTI: campionamento in pianta più i giri
    // della morte, in un posto solo.
    //
    // ⚠️ Chiamano qui il caricatore del server e la scena del client. Finché il
    // client si campionava la pista per conto suo, con il tubo in mezzo i due
    // vedevano piste diverse: il muro del server stava a 18.32 dove il client
    // lo disegnava a 18.37, la griglia dichiarava un indice a 33 campioni da
    // dove l'auto si trovava davvero, e la scenografia cotta non era quella del
    // gioco. Tre sintomi, una causa sola.
    function campionaPista(trackData, n) {
        const pts = TrackGeometry.sampleLoop(trackData.controlPoints, n);
        return inserisciNeiCampioni(pts, trackData.geometria, TrackGeometry.lapLength(pts) / pts.length);
    }

    return { puntiDelGiro, puntoAlAngolo, frameDi, velocitaMinima, GRAVITA_TUBO,
             ACCEL_AUTO, spazioPerLanciarsi, inserisciNeiCampioni, campionaPista };
});
