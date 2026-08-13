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
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./sceneryAssetSizes.js'));
    } else {
        root.SceneryTrackside = factory(root.TrackGeometry, root.TrackGravel, root.SceneryAssetSizes);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel, SceneryAssetSizes) {

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
    // Nessun passo di affiancamento per le reti: dal 2026-08-13 ce n'è una
    // sola per tribuna, scalata sulla larghezza della tribuna stessa.
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


    // Oggetto piazzato di lato alla pista, che la guarda. Restano di qui i
    // pezzi piccoli — gomme, commissari, cartelli — per cui la normale della
    // pista basta.
    //
    // Le reti NON passano più di qui dal 2026-08-13: nascono dalla tribuna che
    // proteggono e ne ereditano centro e rotazione, quindi seguono il nastro
    // del muro esattamente quanto lo segue la tribuna. Prima si orientavano da
    // sole con `TrackGeometry.ribbonFacingAt`, e finivano storte rispetto alla
    // tribuna che avevano davanti.
    function place(trackPts, groundPts, idx, offset, side, barrierDist, embankStart, embankOuter) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter),
        };
    }

    function buildTrackside(ctx) {
        // embankStart assente = la barriera fissa di sempre: chi non conosce
        // il terrapieno allargato (test, chiamanti storici) continua a
        // funzionare invece di produrre coordinate NaN.
        const { trackPts, pitPts, barrierDist, pitRoadHalf, embankStart = barrierDist, embankOuter, mainSide,
                playerBoxFootprints, insidePlayerBoxFootprint, grandstands, barrierProfile,
                spanning = [] } = ctx;
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const fitsUnderBridge = ctx.fitsUnderBridge || (() => true);

        // Scarta un punto se cade nella corsia box, sopra un box giocatore,
        // o se l'oggetto è troppo alto per stare sotto un cavalcavia che
        // passa lì sopra (la rete di protezione, alta 9, bucava la pista
        // sopraelevata del tracciato "prova" — segnalato con screenshot).
        // `altezza`, se data, sostituisce quella nominale dell'asset: serve a
        // chi lo scala (le reti, dimensionate sulla tribuna).
        function usable(asset, x, z, y, pitClearance, altezza) {
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitClearance) return false;
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) return false;
            return fitsUnderBridge(asset, x, z, y, altezza);
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

        // Reti di protezione: UNA per tribuna, larga esattamente quanto lei.
        //
        // Fino al 2026-08-13 erano due moduli a scala 1 affiancati a un passo
        // arrotondato in CAMPIONI. Su `prova` un campione vale 5.17 unità,
        // quindi l'arrotondamento portava i due moduli a ±5.17 invece di ±6:
        // sfalsati rispetto alla tribuna, che restava scoperta per un pezzo.
        // Al campione 615 la copertura era del 54% — "un grandstand per metà
        // protetto e per metà no", segnalato in gioco. Su new-monza erano 57
        // tribune su 65; su monte-rosso, dove il campione vale 1.18, il
        // difetto non esisteva. È l'ennesima soglia geometrica espressa per
        // campione invece che in unità di pista.
        //
        // Ora la rete NASCE dalla tribuna: stesso centro, stessa rotazione, e
        // una scala tale che la sua larghezza sia quella della tribuna. La
        // copertura è esatta per costruzione, non per taratura di un passo — e
        // la rete è parallela al muro esattamente quanto lo è la tribuna,
        // senza doverlo ricalcolare per conto suo.
        //
        // ⚠️ La scala è UNIFORME (f1.js fa `dummy.scale.setScalar`): portando
        // la larghezza da 12 a 19.2 la rete si alza da 9 a 14.4, cioè fino al
        // tetto della tribuna. L'utente lo ha accettato esplicitamente il
        // 2026-08-13 ("va bene chiudere tutto fino al tetto"). Se un giorno la
        // si volesse più bassa, serve una scala non uniforme nel renderer.
        const larghezzaRete = SceneryAssetSizes.sizeOf('catchFence').w;
        const altezzaRete = SceneryAssetSizes.sizeOf('catchFence').h;
        const gia = new Set();
        for (const stand of grandstands) {
            // La tribuna principale può essere impilata su più livelli allo
            // stesso x/z: una rete sola, non una per livello, altrimenti sono
            // superfici complanari che sfarfallano.
            const chiave = stand.x.toFixed(2) + ',' + stand.z.toFixed(2);
            if (gia.has(chiave)) continue;
            gia.add(chiave);

            const larghezza = SceneryAssetSizes.sizeOf(stand.asset).w * (stand.scale || 1);
            const scale = larghezza / larghezzaRete;
            const near = TrackGeometry.nearestPoint(trackPts, stand.x, stand.z);
            if (onBridge(near.index)) continue;
            const nrm = TrackGeometry.normalAt(trackPts, near.index, true);
            // Da che parte della pista sta la tribuna: proiezione del vettore
            // pista->tribuna sulla normale.
            const side = Math.sign((stand.x - trackPts[near.index].x) * nrm.nx +
                                   (stand.z - trackPts[near.index].z) * nrm.nz) || 1;
            // La rete nasce sul MURO, come la tribuna che protegge. Si prende
            // il muro PIÙ LONTANO fra quelli sotto il fronte della rete, non
            // quello del solo centro: dove il muro si allontana da un campione
            // all'altro, un'estremità resterebbe dentro la via di fuga
            // (misurate reti fino a 4.9 unità oltre la linea del muro). La
            // finestra è la mezza-larghezza in unità di pista, convertita in
            // campioni qui e solo qui.
            let muro = barrierDist;
            if (barrierProfile) {
                const mezza = Math.max(1, Math.round((larghezza / 2) / stepLen));
                for (let s = -mezza; s <= mezza; s++) {
                    const k = ((near.index + s) % n + n) % n;
                    muro = Math.max(muro, TrackGravel.barrierAt(barrierProfile, k, side));
                }
            }
            // Dalla tribuna verso la pista, lungo la direzione in cui la
            // tribuna GUARDA. Non ricalcolare la posizione dal campione più
            // vicino: i moduli intermedi di una schiera cadono INTERPOLATI fra
            // due campioni, e ripartire dal campione perderebbe fino a mezzo
            // passo — di nuovo la rete sfalsata.
            const avvicina = near.dist - (muro + FENCE_MARGIN);
            const x = stand.x + Math.sin(stand.rotY) * avvicina;
            const z = stand.z + Math.cos(stand.rotY) * avvicina;
            const y = TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter);
            // L'altezza da confrontare col cavalcavia è quella SCALATA: a
            // scala 1 la rete era alta 9 e ci passava sotto, a 1.6 no.
            if (!usable('catchFence', x, z, y, pitRoadHalf + 5, altezzaRete * scale)) continue;
            layout.push({
                asset: 'catchFence', category: 'safety', scale,
                suMisuraSulMuro: !!barrierProfile,
                x, y, z, rotY: stand.rotY,
            });
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

        // Niente dentro gli asset che SCAVALCANO la pista.
        //
        // Passerella e ponte semafori si posano prima di tutto questo, quindi
        // controllano le strutture già accettate; ma quello che viene dopo —
        // gomme, reti, cartelli, commissari — non li guardava affatto. Finché
        // le campate erano strette il difetto restava latente: si vedeva un
        // solo urto su `prova`, fra il ponte semafori e una rete, ed era lì
        // da sempre. Allargando la passerella per coprire le vie di fuga
        // (2026-08-13) sono diventati 2 su prova e 5 su new-monza, e
        // l'utente li ha visti nel disegno.
        //
        // Si scarta invece di spostare: sotto una campata larga 80 unità un
        // oggetto non ha dove andare che non sia altrettanto sbagliato.
        if (spanning.length) {
            return layout.filter(v => !spanning.some(p => SceneryAssetSizes.itemsOverlap(p, v)));
        }
        return layout;
    }

    return { buildTrackside, place, findCorners, CORNER_RADIUS_MAX };
});
