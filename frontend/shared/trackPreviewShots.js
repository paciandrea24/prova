// frontend/shared/trackPreviewShots.js
//
// Inquadrature per l'anteprima del circuito nella schermata di scelta
// mescola. Modulo puro: solo numeri, nessuna dipendenza da Three.js — chi lo
// usa (f1.js) traduce le posizioni in una camera vera.
//
// Perché derivarle invece di scriverle a mano pista per pista: i tracciati si
// creano con l'editor, e una lista scritta a mano sarebbe vuota per ogni
// pista nuova. Tutti i punti qui sotto escono dalla forma del circuito
// (TrackGeometry.findCorners, i campioni in quota, il tracciato della corsia
// box), quindi una pista disegnata domani ha le sue inquadrature senza che
// nessuno le configuri.
//
// Cosa sostituisce: l'anteprima orbitava attorno a un punto FISSO scritto nel
// codice, (50, 100). Misurato sui tracciati reali, il centro vero è a (-518,
// -503) su "prova" e a (-64, -473) su "baku": la camera girava attorno a un
// pezzo di prato vuoto a centinaia di unità dal circuito, con un raggio di
// 150. Era il motivo per cui l'anteprima non mostrava niente.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'));
    } else {
        root.TrackPreviewShots = factory(root.TrackGeometry);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Quanto dura ogni inquadratura prima dello stacco.
    const DURATA_MS = 5200;

    // Dislivello minimo perché valga la pena dedicare un'inquadratura al
    // punto alto del tracciato. Sotto questo, la pista è in piano e lo scatto
    // mostrerebbe un rettilineo qualunque visto da sotto.
    //
    // Nota: NON si guarda il flag `bridge`. Su "baku" 909 campioni su 1000
    // sono marcati ponte ma la quota è 0 ovunque: il flag dice come è
    // costruito il terreno, non che ci sia qualcosa da guardare.
    const DISLIVELLO_MIN = 4;

    // Un rettilineo più corto di così non si legge come rettilineo.
    const RETTILINEO_MIN = 220;

    // Distanza massima fra camera e bersaglio. NON è un gusto: la nebbia del
    // gioco ha densità 0.0016 esponenziale-quadratica, quindi a 320 unità
    // l'immagine è già velata di un quarto, a 700 per metà, e oltre 1200
    // (camera.far) sparisce del tutto. Le prime inquadrature provate
    // guardavano fino a 866 unità di distanza — misurato — e mostravano
    // foschia, non circuito.
    //
    // Conseguenza voluta: la panoramica NON contiene tutto il tracciato (la
    // diagonale di "prova" è 1247, di "new-monza" 1397: non ci starebbe
    // comunque). La forma del giro la racconta la mappa a fianco, questi
    // scatti raccontano l'ambiente.
    const DISTANZA_UTILE = 320;

    function puntoLaterale(trackPts, idx, offset, side, quota) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        return {
            x: p.x + nx * offset * side,
            y: (p.y || 0) + quota,
            z: p.z + nz * offset * side,
        };
    }

    function puntoPista(trackPts, idx, quota) {
        const p = trackPts[idx];
        return { x: p.x, y: (p.y || 0) + (quota || 0), z: p.z };
    }

    function avanti(n, idx, passi) {
        return ((idx + passi) % n + n) % n;
    }

    // Quanti campioni servono per percorrere `distanza` unità di pista. I
    // campioni valgono 5.17 unità su "prova" e 1.18 su "monte-rosso": un
    // numero di campioni fisso darebbe inquadrature diverse su ogni pista.
    function campioniPer(trackPts, distanza) {
        const passo = TrackGeometry.lapLength(trackPts) / trackPts.length;
        return Math.max(1, Math.round(distanza / (passo || 1)));
    }

    // Ingombro del tracciato: centro vero e diagonale, per dimensionare la
    // panoramica su QUESTA pista invece che su una costante.
    function ingombro(trackPts) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of trackPts) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        return {
            cx: (minX + maxX) / 2,
            cz: (minZ + maxZ) / 2,
            diagonale: Math.hypot(maxX - minX, maxZ - minZ),
        };
    }

    // Da che parte corre la corsia box rispetto alla pista, all'altezza del
    // traguardo: serve a mettere la camera dall'altra parte, dove ci sono
    // tribuna e ponte semafori invece del retro dei garage.
    function latoCorsiaBox(trackPts, pitPts, idx) {
        if (!pitPts || !pitPts.length) return 1;
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const vicino = TrackGeometry.nearestPoint(pitPts, p.x, p.z);
        const segno = Math.sign((vicino.x - p.x) * nx + (vicino.z - p.z) * nz);
        return segno === 0 ? 1 : -segno;   // il lato OPPOSTO alla corsia
    }

    // Il tratto dritto più lungo del giro: il buco più ampio fra la fine di
    // una curva e l'inizio della successiva, in ordine di percorrenza.
    function rettilineoPiuLungo(trackPts, curve) {
        if (curve.length < 2) return null;
        const n = trackPts.length;
        const passo = TrackGeometry.lapLength(trackPts) / n;
        let migliore = null;
        for (let k = 0; k < curve.length; k++) {
            const fine = curve[k].endIdx;
            const inizio = curve[(k + 1) % curve.length].startIdx;
            const campioni = ((inizio - fine) % n + n) % n;
            const lunghezza = campioni * passo;
            if (!migliore || lunghezza > migliore.lunghezza) {
                migliore = { daIdx: fine, aIdx: inizio, campioni, lunghezza };
            }
        }
        return migliore && migliore.lunghezza >= RETTILINEO_MIN ? migliore : null;
    }

    // Da che parte c'è più spazio libero attorno a un campione, cioè dove il
    // tracciato non si ripiega addosso. Serve al punto alto: lì un ponte
    // scavalca un altro tratto di pista, e la camera messa dal lato sbagliato
    // finisce addosso alle barriere del tratto sottostante (misurato su
    // "prova": 15 unità dall'asse invece di 49).
    function latoPiuLibero(trackPts, idx, offset) {
        let migliore = 1, distanza = -1;
        for (const side of [1, -1]) {
            const p = puntoLaterale(trackPts, idx, offset, side, 0);
            const d = TrackGeometry.nearestPoint(trackPts, p.x, p.z).dist;
            if (d > distanza) { distanza = d; migliore = side; }
        }
        return migliore;
    }

    // Il campione più alto del giro, con il dislivello rispetto al più basso.
    function puntoPiuAlto(trackPts) {
        let idx = 0, alto = -Infinity, basso = Infinity;
        for (let i = 0; i < trackPts.length; i++) {
            const y = trackPts[i].y || 0;
            if (y > alto) { alto = y; idx = i; }
            if (y < basso) basso = y;
        }
        return { idx, dislivello: alto - basso };
    }

    // ────────────────────────────────────────────────────────────────────
    // opts: { startFinishIndex, barrierDist }
    //   barrierDist — distanza della barriera dall'asse pista: le camere
    //   esterne si posizionano rispetto a QUELLA, non alla carreggiata,
    //   altrimenti su un tracciato largo finiscono dentro le barriere.
    // ────────────────────────────────────────────────────────────────────
    function buildShots(trackPts, pitPts, opts) {
        const o = opts || {};
        const n = trackPts.length;
        if (!n) return [];
        const barriera = o.barrierDist || 15;
        const traguardo = o.startFinishIndex || 0;
        const scatti = [];

        // Lato opposto alla corsia box: di là ci sono tribuna principale e
        // ponte semafori, ancorati proprio al traguardo.
        const latoTrib = latoCorsiaBox(trackPts, pitPts, traguardo);

        // 1. VEDUTA AEREA — l'inquadratura d'apertura, un'orbita lenta e alta
        //    sulla zona del traguardo, che è dove la scenografia è più fitta.
        //    Raggio e quota sono LIMITATI da DISTANZA_UTILE: abbracciare
        //    l'intero tracciato richiederebbe di guardare da 700-900 unità,
        //    dove la nebbia ha già mangiato tutto.
        const centro = puntoPista(trackPts, traguardo, 0);
        const raggio = 250;
        const quotaPan = 155;
        const angolo = Math.atan2(
            TrackGeometry.normalAt(trackPts, traguardo, true).nz * latoTrib,
            TrackGeometry.normalAt(trackPts, traguardo, true).nx * latoTrib);
        const rotazione = 0.4;   // rad percorsi durante l'inquadratura
        scatti.push({
            id: 'panoramica',
            etichetta: 'VEDUTA AEREA',
            idx: traguardo,
            durata: DURATA_MS,
            cam: { x: centro.x + Math.cos(angolo) * raggio, y: quotaPan, z: centro.z + Math.sin(angolo) * raggio },
            camFine: {
                x: centro.x + Math.cos(angolo + rotazione) * raggio,
                y: quotaPan,
                z: centro.z + Math.sin(angolo + rotazione) * raggio,
            },
            target: centro,
            targetFine: centro,
        });

        // 2. TRAGUARDO — camera bassa a bordo pista, dal lato della tribuna.
        //    Carrella in avanti mentre guarda un punto più avanti sul
        //    rettilineo d'arrivo.
        scatti.push({
            id: 'traguardo',
            etichetta: 'IL TRAGUARDO',
            idx: traguardo,
            durata: DURATA_MS,
            cam: puntoLaterale(trackPts, avanti(n, traguardo, -campioniPer(trackPts, 55)), barriera + 7, latoTrib, 8),
            camFine: puntoLaterale(trackPts, avanti(n, traguardo, -campioniPer(trackPts, 18)), barriera + 7, latoTrib, 8),
            target: puntoPista(trackPts, avanti(n, traguardo, campioniPer(trackPts, 60)), 2),
            targetFine: puntoPista(trackPts, avanti(n, traguardo, campioniPer(trackPts, 130)), 2),
        });

        // 3. LA CURVA PIÙ STRETTA — camera all'ESTERNO (findCorners.side è già
        //    il lato esterno) e in alto, come una telecamera da bordo pista:
        //    più in basso si finirebbe dietro barriere, gomme e tribune, che
        //    proprio in curva sono gli oggetti più fitti.
        const curve = TrackGeometry.findCorners(trackPts);
        if (curve.length) {
            let piuStretta = 0;
            for (let k = 1; k < curve.length; k++) {
                if (curve[k].minRadius < curve[piuStretta].minRadius) piuStretta = k;
            }
            const c = curve[piuStretta];
            scatti.push({
                id: 'curva',
                etichetta: `CURVA ${piuStretta + 1}`,
                idx: c.midIdx,
                durata: DURATA_MS,
                cam: puntoLaterale(trackPts, avanti(n, c.midIdx, -12), barriera + 20, c.side, 16),
                camFine: puntoLaterale(trackPts, avanti(n, c.midIdx, 14), barriera + 20, c.side, 16),
                target: puntoPista(trackPts, c.midIdx, 1),
                targetFine: puntoPista(trackPts, c.midIdx, 1),
            });
        }

        // 4. IL RETTILINEO — sull'asse della pista e basso, così la
        //    carreggiata fugge verso l'orizzonte. È l'unica camera messa
        //    sopra l'asfalto: di lato il rettilineo si leggerebbe come un
        //    prato con una striscia grigia.
        const dritto = rettilineoPiuLungo(trackPts, curve);
        if (dritto) {
            const inizio = avanti(n, dritto.daIdx, Math.round(dritto.campioni * 0.1));
            // Il bersaglio si ferma a DISTANZA_UTILE anche su un rettilineo
            // molto lungo (848 unità su "prova"): oltre non si vedrebbe, e
            // soprattutto un "rettilineo" secondo findCorners può essere una
            // curva ampia — puntando in fondo si inquadrerebbe il prato di
            // fianco alla pista invece della pista.
            const avanzamento = Math.min(Math.round(dritto.campioni * 0.6),
                campioniPer(trackPts, DISTANZA_UTILE));
            scatti.push({
                id: 'rettilineo',
                etichetta: 'IL RETTILINEO',
                idx: inizio,
                durata: DURATA_MS,
                cam: puntoPista(trackPts, inizio, 6),
                camFine: puntoPista(trackPts, avanti(n, inizio, Math.round(avanzamento * 0.35)), 6),
                target: puntoPista(trackPts, avanti(n, inizio, avanzamento), 2),
                targetFine: puntoPista(trackPts, avanti(n, inizio, avanzamento), 2),
            });
        }

        // 5. IL PUNTO ALTO — solo se la pista ha un dislivello vero. Camera
        //    fuori e SOTTO la quota della pista, che così si staglia in alto.
        const alto = puntoPiuAlto(trackPts);
        if (alto.dislivello >= DISLIVELLO_MIN) {
            const p = trackPts[alto.idx];
            const lato = latoPiuLibero(trackPts, alto.idx, barriera + 34);
            const cam = puntoLaterale(trackPts, alto.idx, barriera + 34, lato, 0);
            const camB = puntoLaterale(trackPts, avanti(n, alto.idx, 18), barriera + 34, lato, 0);
            // Quota indipendente da quella della pista: la camera sta a terra,
            // il ponte le passa sopra.
            cam.y = Math.max(0, (p.y || 0) - alto.dislivello * 0.55) + 3;
            camB.y = cam.y;
            scatti.push({
                id: 'quota',
                etichetta: p.bridge ? 'IL PONTE' : 'IL DISLIVELLO',
                idx: alto.idx,
                durata: DURATA_MS,
                cam, camFine: camB,
                target: puntoPista(trackPts, alto.idx, 2),
                targetFine: puntoPista(trackPts, avanti(n, alto.idx, 12), 2),
            });
        }

        // 6. LA CORSIA BOX — dall'alto, in asse con la corsia: è la fila dei
        //    garage e dei box colorati dei piloti.
        if (pitPts && pitPts.length > 8) {
            const m = pitPts.length;
            let lunghezzaCorsia = 0;
            for (let i = 1; i < m; i++) {
                lunghezzaCorsia += Math.hypot(pitPts[i].x - pitPts[i - 1].x, pitPts[i].z - pitPts[i - 1].z);
            }
            const passoCorsia = lunghezzaCorsia / (m - 1) || 1;
            const a = Math.round(m * 0.15);
            // Stesso limite degli altri scatti: su una corsia lunga guardare
            // fino in fondo (300 unità misurate su "prova") vuol dire guardare
            // dentro la nebbia.
            const b = Math.min(m - 1, a + Math.round(DISTANZA_UTILE * 0.55 / passoCorsia));
            const quota = 22;
            scatti.push({
                id: 'box',
                etichetta: 'LA CORSIA BOX',
                // Il pallino sulla mappa vuole un indice di PISTA: si prende
                // il campione di pista più vicino all'imbocco della corsia.
                idx: TrackGeometry.nearestPoint(trackPts, pitPts[a].x, pitPts[a].z).index,
                durata: DURATA_MS,
                cam: { x: pitPts[a].x, y: (pitPts[a].y || 0) + quota, z: pitPts[a].z },
                camFine: (() => {
                    const c = Math.min(m - 1, a + Math.round((b - a) * 0.35));
                    return { x: pitPts[c].x, y: (pitPts[c].y || 0) + quota, z: pitPts[c].z };
                })(),
                target: { x: pitPts[b].x, y: (pitPts[b].y || 0), z: pitPts[b].z },
                targetFine: { x: pitPts[b].x, y: (pitPts[b].y || 0), z: pitPts[b].z },
            });
        }

        return scatti;
    }

    return {
        buildShots, ingombro, rettilineoPiuLungo,
        DURATA_MS, DISLIVELLO_MIN, RETTILINEO_MIN, DISTANZA_UTILE,
    };
});
