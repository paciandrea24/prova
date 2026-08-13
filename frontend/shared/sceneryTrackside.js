// frontend/shared/sceneryTrackside.js
//
// Elementi scenici DISTRIBUITI lungo il giro in funzione della forma del
// tracciato: barriere di pneumatici e cartelli di frenata nelle curve,
// commissari, reti davanti alle tribune, barriere di cemento lungo la corsia
// box, decoro del paddock. A differenza di sceneryLandmarks.js, qui il
// numero di istanze dipende da quante curve ha il tracciato.
// Modulo puro, nessuna dipendenza da Three.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'));
    } else {
        root.SceneryTrackside = factory(root.TrackGeometry, root.TrackGravel);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel) {

    // findCorners e la sua soglia stanno in trackGeometry.js: le usano due
    // sistemi indipendenti — questa scenografia e il profilo delle vie di
    // fuga in ghiaia (trackGravel.js) — e devono vedere le stesse curve.
    // Ri-esportate in fondo al file per i chiamanti esistenti.
    const findCorners = TrackGeometry.findCorners;
    const CORNER_RADIUS_MAX = TrackGeometry.CORNER_RADIUS_MAX;

    const TYRE_STEP = 7;             // passo di affiancamento del modello tyreStack
    const TYRE_MARGIN = 2.5;         // oltre barrierDist
    const BOARD_DISTANCES = [100, 50];
    const BOARD_MARGIN = 4;
    const MARSHAL_MARGIN = 8;
    const FENCE_STEP = 12;           // passo di affiancamento del modello catchFence
    // 1.5 e non 3: la rete va subito dietro la barriera, non a metà strada
    // fra barriera e tribuna. A 3 il suo spessore arrivava a barrierDist+3.25
    // e i PILASTRI della tettoia delle tribune coperte — che scendono fino a
    // terra a barrierDist+3.05 — la attraversavano, facendo apparire la
    // copertura "corrotta" (segnalato dall'utente su due tribune diverse).
    const FENCE_MARGIN = 1.5;
    const PADDOCK_DECOR_MARGIN = 14;
    // Ripieghi per il decoro del paddock quando la prima collocazione è
    // occupata: oltre la tribuna principale (profonda 12.8, centrata a
    // barrierDist+14) e oltre la corsia box.
    const MAIN_STAND_CLEAR_OFFSET = 34;
    const PADDOCK_FAR_OFFSET = 46;
    // Quanto avanti lungo il giro cercare, se la collocazione nominale è
    // occupata a tutti gli offset. 300 unità coprono la zona paddock su tutti
    // i tracciati esistenti senza spingere il decoro dall'altra parte del
    // circuito, dove non c'entrerebbe più nulla.
    const PADDOCK_DECOR_SEARCH_LEN = 300;
    const PADDOCK_DECOR_SEARCH_STEP = 15;
    // Distanza minima fra due pezzi di decoro: senza, finiscono tutti
    // ammucchiati nel primo punto libero trovato.
    const PADDOCK_DECOR_SPACING = 12;
    // Margine del muretto OLTRE il bordo della corsia box (pitRoadHalf), non
    // dall'asse: a offset fisso 4 con una corsia semilarga 5 i muretti
    // finivano DENTRO la carreggiata e l'auto in autopilota ci passava
    // attraverso (segnalato dall'utente). 1.5 = mezzo spessore del modulo
    // (0.7) più margine.
    const PIT_BARRIER_MARGIN = 1.5;
    // Distanza minima del muretto dal corridoio pista: mezzo ingombro del
    // modulo (3) più margine.
    const PIT_BARRIER_TRACK_CLEARANCE = 5;


    // `profiloPerRotazione`, se dato, è la distanza del MURO campione per
    // campione: serve solo a orientare l'oggetto lungo il nastro del muro.
    // La POSIZIONE continua a venire da `offset`, che per le reti è un valore
    // costante calcolato apposta (vedi più sotto, il massimo fra tre
    // campioni): se la rete seguisse il muro anche in distanza, tornerebbe a
    // staccarsi dalla tribuna che protegge.
    //
    // `spanSamples` è la mezza-larghezza dell'oggetto in campioni: un modulo
    // è un segmento rigido e va parallelo alla CORDA che sottende, non alla
    // tangente del suo centro.
    function place(trackPts, groundPts, idx, offset, side, barrierDist, embankStart, embankOuter,
                   profiloPerRotazione, spanSamples) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: profiloPerRotazione
                ? TrackGeometry.ribbonFacingAt(trackPts, idx, side, profiloPerRotazione, spanSamples)
                : Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter),
        };
    }

    function buildTrackside(ctx) {
        // embankStart assente = la barriera fissa di sempre: chi non conosce
        // il terrapieno allargato (test, chiamanti storici) continua a
        // funzionare invece di produrre coordinate NaN.
        const { trackPts, pitPts, barrierDist, pitRoadHalf, embankStart = barrierDist, embankOuter, mainSide,
                playerBoxFootprints, insidePlayerBoxFootprint, grandstands, barrierProfile } = ctx;
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const fitsUnderBridge = ctx.fitsUnderBridge || (() => true);

        // Scarta un punto se cade nella corsia box, sopra un box giocatore,
        // o se l'oggetto è troppo alto per stare sotto un cavalcavia che
        // passa lì sopra (la rete di protezione, alta 9, bucava la pista
        // sopraelevata del tracciato "prova" — segnalato con screenshot).
        function usable(asset, x, z, y, pitClearance) {
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitClearance) return false;
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) return false;
            return fitsUnderBridge(asset, x, z, y);
        }

        // Un oggetto affiancato a un tratto SOPRAELEVATO va scartato del
        // tutto. L'offset laterale lo porta fuori dal viadotto, ma la quota
        // viene dal terreno sottostante: l'oggetto precipita a terra e, dove
        // sotto passa un altro tratto di pista, finisce in mezzo alla
        // carreggiata. Sul tracciato "prova" ci finivano una barriera di
        // gomme e un capanno commissari (segnalato dall'utente).
        function onBridge(idx) {
            return !!trackPts[idx].bridge;
        }

        const corners = findCorners(trackPts);

        for (const corner of corners) {
            // Barriera di pneumatici lungo tutto l'arco esterno della curva.
            const arcSamples = (corner.endIdx - corner.startIdx + n) % n;
            const stepSamples = Math.max(1, Math.round(TYRE_STEP / stepLen));
            for (let s = 0; s <= arcSamples; s += stepSamples) {
                const idx = (corner.startIdx + s) % n;
                if (onBridge(idx)) continue;
                const pos = place(trackPts, groundPts, idx, barrierDist + TYRE_MARGIN,
                                  corner.side, barrierDist, embankStart, embankOuter);
                if (!usable('tyreStack', pos.x, pos.z, pos.y, pitRoadHalf + 6)) continue;
                layout.push(Object.assign({ asset: 'tyreStack', category: 'safety', scale: 1 }, pos));
            }

            // Commissario all'ingresso curva.
            const marshalOk = !onBridge(corner.startIdx);
            const marshal = place(trackPts, groundPts, corner.startIdx,
                                  barrierDist + MARSHAL_MARGIN, corner.side, barrierDist, embankStart, embankOuter);
            if (marshalOk && usable('marshalPost', marshal.x, marshal.z, marshal.y, pitRoadHalf + 8)) {
                layout.push(Object.assign({ asset: 'marshalPost', category: 'safety', scale: 1 }, marshal));
            }

            // Cartelli di frenata a 100 e 50 unità PRIMA dell'ingresso curva,
            // camminando all'indietro lungo il tracciato.
            for (const dist of BOARD_DISTANCES) {
                const w = TrackGeometry.walkClosedLoop(trackPts, corner.startIdx, -dist);
                if (onBridge(w.fromIdx)) continue;
                const pos = place(trackPts, groundPts, w.fromIdx, barrierDist + BOARD_MARGIN,
                                  corner.side, barrierDist, embankStart, embankOuter);
                if (!usable('brakingBoard', pos.x, pos.z, pos.y, pitRoadHalf + 5)) continue;
                layout.push(Object.assign({ asset: 'brakingBoard', category: 'safety', scale: 1 }, pos));
            }
        }

        // Reti di protezione davanti a ogni tribuna già piazzata: si copre un
        // tratto largo quanto la tribuna, centrato su di essa.
        // Due moduli affiancati e centrati sulla tribuna, non tre a passo
        // pieno: la tribuna è larga 19.2 e la rete 12, quindi tre moduli
        // coprivano 36 unità e sporgevano di 8 per lato oltre la tribuna
        // (segnalato dall'utente: "griglie che sporgono oltre").
        const fenceHalfSamples = Math.max(1, Math.round((FENCE_STEP / 2) / stepLen));
        for (const stand of grandstands) {
            const near = TrackGeometry.nearestPoint(trackPts, stand.x, stand.z);
            const nrm = TrackGeometry.normalAt(trackPts, near.index, true);
            // Da che parte della pista sta la tribuna: proiezione del vettore
            // pista->tribuna sulla normale.
            const side = Math.sign((stand.x - trackPts[near.index].x) * nrm.nx +
                                   (stand.z - trackPts[near.index].z) * nrm.nz) || 1;
            // La rete nasce sul MURO, come la tribuna che protegge, e sul
            // campione DELLA TRIBUNA: se nascesse sulla barriera storica per
            // poi essere traslata a valle, le due vedrebbero campioni diversi
            // e si separerebbero (misurate 3 reti su 99 finite fino a 11.3
            // unità fuori posto). Prendere il muro sul campione della rete
            // invece che su quello della tribuna riapre lo stesso problema in
            // piccolo, dove il muro cambia distanza fra i due.
            // Il massimo fra il muro sotto la tribuna e quello sotto i due
            // moduli di rete: uno solo dei tre lascerebbe la rete dentro la
            // via di fuga dove il muro si allontana fra un campione e l'altro
            // (misurate reti fino a 4.9 unità oltre la linea del muro).
            let muro = barrierDist;
            if (barrierProfile) {
                for (const s of [-fenceHalfSamples, 0, fenceHalfSamples]) {
                    const k = ((near.index + s) % n + n) % n;
                    muro = Math.max(muro, TrackGravel.barrierAt(barrierProfile, k, side));
                }
            }
            for (let s = -fenceHalfSamples; s <= fenceHalfSamples; s += fenceHalfSamples * 2) {
                const idx = ((near.index + s) % n + n) % n;
                if (onBridge(idx)) continue;
                // La rete guarda il nastro del MURO, non la normale della
                // pista: dove il muro è in rampa le due direzioni divergono e
                // la rete risultava storta fino a 48°. La sua POSIZIONE resta
                // quella di prima — `muro` è il valore costante calcolato
                // sopra, e cambiarlo la staccherebbe dalla tribuna.
                const pos = place(trackPts, groundPts, idx, muro + FENCE_MARGIN,
                                  side, barrierDist, embankStart, embankOuter,
                                  barrierProfile
                                      ? (k, s) => TrackGravel.barrierAt(barrierProfile, k, s)
                                      : null,
                                  Math.max(1, Math.round(FENCE_STEP / 2 / stepLen)));
                if (!usable('catchFence', pos.x, pos.z, pos.y, pitRoadHalf + 5)) continue;
                layout.push(Object.assign(
                    { asset: 'catchFence', category: 'safety', scale: 1, suMisuraSulMuro: !!barrierProfile }, pos));
            }
        }

        // Decoro del paddock vicino al traguardo, sul lato corsia box.
        const decorPlan = [
            { asset: 'flagPole', at: 20 },
            { asset: 'flagPole', at: 28 },
            { asset: 'flagPole', at: 36 },
            { asset: 'pylon', at: 55 },
            { asset: 'paddockTent', at: 85 },
            { asset: 'paddockTent', at: 115 },
        ];
        // Ricerca su DUE assi — offset laterale e posizione lungo il giro —
        // invece di una collocazione unica.
        //
        // Alla collocazione nominale (barrierDist + 14, lato corsia box) questi
        // oggetti cadono sistematicamente dentro la corsia o dentro un box
        // giocatore: misurato su "prova", nelle prime 55 unità dal traguardo
        // TUTTI e tre gli offset sono occupati. Venivano quindi scartati in
        // blocco — pylon e flagPole avevano ZERO istanze su tutti e tre i
        // tracciati, cioè erano asset modellati, esportati e mai visti in
        // gioco. Le due costanti di ripiego esistevano già ma non le usava
        // nessuna riga di codice, e da sole non sarebbero comunque bastate.
        const decorOffsets = [PADDOCK_DECOR_MARGIN, MAIN_STAND_CLEAR_OFFSET, PADDOCK_FAR_OFFSET];
        const decorPlaced = [];
        for (const d of decorPlan) {
            for (let ahead = 0; ahead <= PADDOCK_DECOR_SEARCH_LEN; ahead += PADDOCK_DECOR_SEARCH_STEP) {
                const w = TrackGeometry.walkClosedLoop(trackPts, 0, d.at + ahead);
                let done = false;
                for (const off of decorOffsets) {
                    const pos = place(trackPts, groundPts, w.fromIdx,
                                      barrierDist + off, -mainSide,
                                      barrierDist, embankStart, embankOuter);
                    if (!usable(d.asset, pos.x, pos.z, pos.y, pitRoadHalf + 8)) continue;
                    // Non ammucchiare il decoro nel primo punto libero: i tre
                    // pennoni devono restare un gruppo ordinato, non una pila.
                    if (decorPlaced.some(q => Math.hypot(q.x - pos.x, q.z - pos.z) < PADDOCK_DECOR_SPACING)) continue;
                    const item = Object.assign({ asset: d.asset, category: 'paddock-decor', scale: 1 }, pos);
                    layout.push(item);
                    decorPlaced.push(item);
                    done = true;
                    break;
                }
                if (done) break;
            }
        }

        // Barriere di cemento lungo la corsia box, a separarla dalla pista.
        // Quota dalla corsia stessa (p.y): il terrapieno non la copre.
        //
        // Si piazzano SOLO dove la corsia è già ben staccata dalla pista: nel
        // tratto d'imbocco le due corrono affiancate e i muretti finivano
        // dentro la carreggiata vera (segnalato dall'utente: "non metterli
        // dentro la pista reale, solo nella corsia box").
        for (let i = 6; i < Math.min(pitPts.length - 6, 90); i += 8) {
            const p = pitPts[i];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, i, false);
            const distPlus = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist;
            const side = distPlus >= distMinus ? -1 : 1;   // verso la pista
            const barrierOffset = pitRoadHalf + PIT_BARRIER_MARGIN;
            const x = p.x + nx * barrierOffset * side;
            const z = p.z + nz * barrierOffset * side;
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) continue;
            // Il muretto deve restare fuori dal corridoio della pista, con il
            // suo mezzo ingombro (3) più un margine.
            if (TrackGeometry.nearestPoint(trackPts, x, z).dist < barrierDist + PIT_BARRIER_TRACK_CLEARANCE) continue;
            layout.push({
                asset: 'concreteBarrier', category: 'safety',
                x, y: p.y || 0, z,
                rotY: Math.atan2(p.x - x, p.z - z), scale: 1,
            });
        }

        return layout;
    }

    return { buildTrackside, place, findCorners, CORNER_RADIUS_MAX };
});
