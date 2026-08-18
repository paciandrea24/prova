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
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryAssetSizes.js'));
    } else {
        root.TrackPreviewShots = factory(root.TrackGeometry, root.SceneryAssetSizes);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryAssetSizes) {

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

    // ────────────────────────────────────────────────────────────────────
    // SCANSARE LA SCENOGRAFIA
    //
    // Gli scatti nascono dalla forma della pista, gli oggetti li piazza
    // trackScenery.js, e i due moduli non si conoscono: usano gli stessi
    // offset dalla barriera e prima o poi si incontrano. Misurato sui
    // tracciati reali, prima di questo controllo:
    //
    //   prova        traguardo  DENTRO un cartellone sponsor per 0.3 unità
    //   prova        quota      DENTRO due tribune, per 4.3 e 0.3
    //   monte-rosso  traguardo  cartellone sfiorato a 0.3
    //
    // I cartelloni sponsor stanno a barrierDist+6 (BANNER_OFFSET in
    // sceneryPaddock.js) e la camera del traguardo si metteva a barrierDist+6:
    // lo stesso numero scritto in due file che non si parlano. Segnalato in
    // playtest come "l'inquadratura entra dentro un cartellone e passa dentro
    // uno dei tubi che lo sostengono".
    // ────────────────────────────────────────────────────────────────────

    // Nota su ponte semafori e passerella, che scavalcano la pista: la loro
    // scatola d'ingombro comprende il vuoto sotto la campata, quindi una
    // camera che ci passasse sotto risulta "dentro" senza esserlo. Qui si
    // accetta comunque di scansarli, per due motivi. Primo: l'intradosso
    // reale non è misurabile dall'asset — i GLB voxel raggruppano le mesh per
    // materiale, quindi un nodo copre insieme i piloni e l'impalcato
    // (misurato: `footbridge_concrete` va da 0 a 12.9 su tutta la campata), e
    // non esiste un numero verificabile sotto cui ci sia solo aria. Secondo:
    // scansarli non toglie nessuna inquadratura sulle piste attuali, mentre
    // un intradosso indovinato metterebbe la camera dentro un pilone.

    // Aria richiesta attorno alla camera. Non basta "non compenetrare": una
    // superficie a mezzo metro dall'obiettivo riempie comunque l'inquadratura.
    const ARIA_CAMERA = 2.5;

    // Alternative provate, in ordine di preferenza: prima ci si sposta di
    // lato, così l'inquadratura resta quella pensata; solo se non basta si
    // sale sopra l'ostacolo. [scostamento laterale, scostamento in quota]
    const ALTERNATIVE = [
        [0, 0], [3, 0], [-3, 0], [6, 0], [-5, 0], [9, 0], [12, 0], [16, 0], [20, 0],
        [0, 9], [6, 9], [-5, 9], [0, 16], [12, 16],
    ];

    // Distanza di un punto dal bordo di un rettangolo orientato, negativa se
    // il punto è dentro.
    function distanzaDalPoligono(px, pz, poly) {
        let minima = Infinity, segno = 0, dentro = true;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const dx = b.x - a.x, dz = b.z - a.z;
            const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
            const d = Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
            if (d < minima) minima = d;
            const cross = dx * (pz - a.z) - dz * (px - a.x);
            if (cross !== 0) {
                const s = cross > 0 ? 1 : -1;
                if (segno === 0) segno = s; else if (s !== segno) dentro = false;
            }
        }
        return dentro ? -minima : minima;
    }

    function ostruisce(item, p) {
        const scala = item.scale > 1 ? item.scale : 1;
        const dim = SceneryAssetSizes.sizeOf(item.asset);
        const base = item.y || 0;
        const cima = base + dim.h * scala;
        if (p.y < base - ARIA_CAMERA || p.y > cima + ARIA_CAMERA) return false;
        return distanzaDalPoligono(p.x, p.z, SceneryAssetSizes.footprintCorners(item)) < ARIA_CAMERA;
    }

    // Solo ciò che ha davvero un volume: folla, laghetti e asfalto del
    // parcheggio sono superfici o figurine, non ostacoli per una camera.
    function oggettiSolidi(layout) {
        return (layout || []).filter(v => v.category !== 'pond' && v.category !== 'parkingLot'
            && v.category !== 'crowd' && v.category !== 'terraceCrowd');
    }

    // Passo di campionamento lungo la corsa della camera, in unità di gioco.
    //
    // Controllare i soli estremi non basta: sul punto alto di "prova" la
    // camera partiva e arrivava all'aperto ma attraversava due tribune a metà
    // strada, perché a offset costante lungo una pista che curva la
    // traiettoria non è un segmento.
    //
    // E il passo va in DISTANZA, non in "N campioni": con un numero fisso di
    // campioni il passo cambia con la lunghezza della corsa, e su "prova" la
    // camera della curva scavalcava una rete di sicurezza infilandosi fra due
    // campioni consecutivi. Sotto ARIA_CAMERA il campionamento non ha buchi,
    // perché ogni campione controlla un intorno di quel raggio.
    const PASSO_CORSA = 2;
    const CAMPIONI_MAX = 200;   // rete di sicurezza contro corse anomale

    // Quanto lontano cercare la scenografia attorno alla corsa nominale: il
    // massimo scostamento laterale previsto dalle ALTERNATIVE, più aria.
    const RAGGIO_RICERCA = 60;

    function campioniDellaCorsa(c) {
        const lunghezza = Math.hypot(c.camFine.x - c.cam.x, c.camFine.y - c.cam.y, c.camFine.z - c.cam.z);
        return Math.min(CAMPIONI_MAX, Math.max(1, Math.ceil(lunghezza / PASSO_CORSA)));
    }

    function corsaLibera(c, solidi) {
        const campioni = campioniDellaCorsa(c);
        for (let k = 0; k <= campioni; k++) {
            const u = k / campioni;
            const p = {
                x: c.cam.x + (c.camFine.x - c.cam.x) * u,
                y: c.cam.y + (c.camFine.y - c.cam.y) * u,
                z: c.cam.z + (c.camFine.z - c.cam.z) * u,
            };
            for (const item of solidi) if (ostruisce(item, p)) return false;
        }
        return true;
    }

    // Sceglie fra le ALTERNATIVE la prima che libera TUTTA la corsa della
    // camera. `costruisci(dLato, dQuota)` deve restituire { cam, camFine }.
    // Se nessuna libera, torna la nominale: un'inquadratura imperfetta è
    // comunque meglio di una mancante.
    function scansa(costruisci, solidi) {
        if (!solidi || !solidi.length) return costruisci(0, 0);
        const nominale = costruisci(0, 0);

        // Solo la scenografia nei paraggi: il resto del circuito non può
        // ostruire una camera che si sposta di poche decine di unità, e
        // filtrarlo qui evita di ripassare ~1200 oggetti per ogni campione di
        // ogni alternativa.
        const cx = (nominale.cam.x + nominale.camFine.x) / 2;
        const cz = (nominale.cam.z + nominale.camFine.z) / 2;
        const mezzaCorsa = Math.hypot(nominale.camFine.x - nominale.cam.x,
            nominale.camFine.z - nominale.cam.z) / 2;
        const vicini = solidi.filter(function (v) {
            const sc = v.scale > 1 ? v.scale : 1;
            return Math.hypot(v.x - cx, v.z - cz)
                <= mezzaCorsa + RAGGIO_RICERCA + SceneryAssetSizes.footprintRadius(v.asset) * sc;
        });

        for (const alternativa of ALTERNATIVE) {
            const dLato = alternativa[0], dQuota = alternativa[1];
            const c = (dLato === 0 && dQuota === 0) ? nominale : costruisci(dLato, dQuota);
            if (corsaLibera(c, vicini)) return c;
        }
        return nominale;
    }

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
        // Scenografia già generata (TrackScenery.generateLayout). Facoltativa:
        // senza, gli scatti restano quelli nominali e possono finire dentro un
        // cartellone — è quello che succedeva prima che questo esistesse.
        const solidi = oggettiSolidi(o.layout);

        // Costruttore di una coppia cam/camFine laterale, scostabile: è quello
        // che `scansa` chiama con le varie alternative.
        function coppiaLaterale(idxA, idxB, offset, side, quota) {
            return (dLato, dQuota) => ({
                cam: puntoLaterale(trackPts, idxA, offset + dLato, side, quota + dQuota),
                camFine: puntoLaterale(trackPts, idxB, offset + dLato, side, quota + dQuota),
            });
        }

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

        // 2. TRAGUARDO — camera bassa a bordo pista, dal lato OPPOSTO alle
        //    tribune, che diventano così lo sfondo dell'inquadratura: è la
        //    posizione della telecamera televisiva al traguardo.
        //
        //    Dal lato delle tribune non funzionava: la fila principale ha il
        //    fronte a ~7 unità oltre la barriera, cioè esattamente dove stava
        //    la camera, e l'inquadratura finiva DENTRO i gradoni senza far
        //    vedere la linea (segnalato in playtest).
        scatti.push(Object.assign({
            id: 'traguardo',
            etichetta: 'IL TRAGUARDO',
            idx: traguardo,
            durata: DURATA_MS,
            target: puntoPista(trackPts, avanti(n, traguardo, campioniPer(trackPts, 60)), 2),
            targetFine: puntoPista(trackPts, avanti(n, traguardo, campioniPer(trackPts, 130)), 2),
        }, scansa(coppiaLaterale(
            avanti(n, traguardo, -campioniPer(trackPts, 55)),
            avanti(n, traguardo, -campioniPer(trackPts, 18)),
            barriera + 6, -latoTrib, 6), solidi)));

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
            scatti.push(Object.assign({
                id: 'curva',
                etichetta: `CURVA ${piuStretta + 1}`,
                idx: c.midIdx,
                durata: DURATA_MS,
                target: puntoPista(trackPts, c.midIdx, 1),
                targetFine: puntoPista(trackPts, c.midIdx, 1),
            }, scansa(coppiaLaterale(
                avanti(n, c.midIdx, -12), avanti(n, c.midIdx, 14),
                barriera + 20, c.side, 16), solidi)));
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
                // Unico scatto che NON viene scansato dalla scenografia: sta
                // sull'asse della pista per scelta, e spostarlo di lato lo
                // annullerebbe. Non ce n'è bisogno — è dove passano le auto,
                // quindi ciò che scavalca la pista (passerelle, ponte
                // semafori) le passa sopra anche qui. Su monte-rosso la corsa
                // finisce proprio sotto una passerella: è l'inquadratura
                // giusta, non una compenetrazione.
                suAsse: true,
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
            // Quota indipendente da quella della pista: la camera sta a terra,
            // il ponte le passa sopra.
            const quotaCam = Math.max(0, (p.y || 0) - alto.dislivello * 0.55) + 3;
            scatti.push(Object.assign({
                id: 'quota',
                etichetta: p.bridge ? 'IL PONTE' : 'IL DISLIVELLO',
                idx: alto.idx,
                durata: DURATA_MS,
                target: puntoPista(trackPts, alto.idx, 2),
                targetFine: puntoPista(trackPts, avanti(n, alto.idx, 12), 2),
            }, scansa(function (dLato, dQuota) {
                const cam = puntoLaterale(trackPts, alto.idx, barriera + 34 + dLato, lato, 0);
                const camB = puntoLaterale(trackPts, avanti(n, alto.idx, 18), barriera + 34 + dLato, lato, 0);
                cam.y = quotaCam + dQuota;
                camB.y = cam.y;
                return { cam: cam, camFine: camB };
            }, solidi)));
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
        ostruisce, oggettiSolidi, ARIA_CAMERA,
        DURATA_MS, DISLIVELLO_MIN, RETTILINEO_MIN, DISTANZA_UTILE,
    };
});
