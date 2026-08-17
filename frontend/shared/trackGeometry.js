// frontend/shared/trackGeometry.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TrackGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function dist(a, b) {
        return Math.hypot(b.x - a.x, b.z - a.z, (b.y || 0) - (a.y || 0));
    }

    // Punto sul segmento p1->p2 di una Catmull-Rom centripeta (algoritmo
    // piramidale di Barry-Goldman), dati i 4 punti di controllo p0,p1,p2,p3
    // e il parametro locale u in [0,1]. Il blend piramidale guarda anche ai
    // vicini p0/p3: su x/z va bene (è quello che arrotonda le curve), ma sulla
    // quota y un punto isolato molto più alto/basso dei vicini fa "sforare"
    // la curva oltre il punto stesso (si vede come una piega/anello nella
    // mesh della pista). La quota quindi NON passa dal blend piramidale: è
    // interpolata separatamente, solo tra p1.y e p2.y, con uno smoothstep che
    // garantisce pendenza nulla (quindi continua, senza spigoli) esattamente
    // in corrispondenza di ogni punto di controllo — non può mai superare i
    // due punti che delimitano il segmento.
    function evalSegment(p0, p1, p2, p3, u) {
        const alpha = 0.5; // centripeta
        const t0 = 0;
        const t1 = t0 + Math.pow(dist(p0, p1), alpha) || 1e-6;
        const t2 = t1 + Math.pow(dist(p1, p2), alpha) || t1 + 1e-6;
        const t3 = t2 + Math.pow(dist(p2, p3), alpha) || t2 + 1e-6;
        const t = t1 + u * (t2 - t1);

        function lerp(a, b, ta, tb, tt) {
            const d = tb - ta;
            if (Math.abs(d) < 1e-9) return { x: a.x, z: a.z };
            const f = (tt - ta) / d;
            return {
                x: a.x + (b.x - a.x) * f,
                z: a.z + (b.z - a.z) * f
            };
        }

        const A1 = lerp(p0, p1, t0, t1, t);
        const A2 = lerp(p1, p2, t1, t2, t);
        const A3 = lerp(p2, p3, t2, t3, t);
        const B1 = lerp(A1, A2, t0, t2, t);
        const B2 = lerp(A2, A3, t1, t3, t);
        const xz = lerp(B1, B2, t1, t2, t);

        const y1 = p1.y || 0, y2 = p2.y || 0;
        const ue = u * u * (3 - 2 * u); // smoothstep: derivata nulla a u=0 e u=1
        // Un campione è "ponte" solo se ENTRAMBI i punti che delimitano il
        // segmento lo sono (stessa coppia p1/p2 usata sopra per la quota): i
        // punti di transizione (rampa) restano a terra, il terrapieno della
        // Fase 1 continua a coprirli normalmente.
        const bridge = !!p1.bridge && !!p2.bridge;
        return { x: xz.x, y: y1 + (y2 - y1) * ue, z: xz.z, bridge };
    }

    // Valuta la curva (chiusa o aperta) al parametro globale t in [0,1].
    function evalCurve(controlPoints, closed, t) {
        const n = controlPoints.length;
        const segCount = closed ? n : n - 1;
        const segF = t * segCount;
        let i = Math.floor(segF);
        if (i >= segCount) i = segCount - 1;
        if (i < 0) i = 0;
        const u = segF - i;

        function at(idx) {
            if (closed) return controlPoints[((idx % n) + n) % n];
            if (idx < 0) return controlPoints[0];
            if (idx >= n) return controlPoints[n - 1];
            return controlPoints[idx];
        }

        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        return evalSegment(p0, p1, p2, p3, u);
    }

    // Ricampiona la curva in `samples` punti equidistanti per lunghezza
    // d'arco (non per parametro), come getSpacedPoints() di Three.js.
    function resample(controlPoints, closed, samples) {
        if (controlPoints.length < 3) {
            throw new Error('Servono almeno 3 punti di controllo');
        }
        const FINE = Math.max(samples * 4, 2000);
        const fine = [];
        for (let i = 0; i < FINE; i++) {
            fine.push(evalCurve(controlPoints, closed, i / (closed ? FINE : FINE - 1)));
        }

        const cum = [0];
        for (let i = 1; i < fine.length; i++) {
            cum.push(cum[i - 1] + dist(fine[i - 1], fine[i]));
        }
        const total = cum[cum.length - 1];

        const out = [];
        for (let s = 0; s < samples; s++) {
            const target = closed
                ? (s / samples) * total
                : (s / (samples - 1)) * total;
            let lo = 0, hi = cum.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] < target) lo = mid + 1; else hi = mid;
            }
            const idx = Math.max(1, lo);
            const segLen = cum[idx] - cum[idx - 1] || 1e-9;
            const f = (target - cum[idx - 1]) / segLen;
            const a = fine[idx - 1], b = fine[idx];
            out.push({
                x: a.x + (b.x - a.x) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
                z: a.z + (b.z - a.z) * f,
                bridge: a.bridge
            });
        }
        return out;
    }

    function sampleLoop(controlPoints, samples) {
        return resample(controlPoints, true, samples);
    }

    function sampleOpenPath(controlPoints, samples) {
        return resample(controlPoints, false, samples);
    }

    function lapLength(points) {
        let len = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            len += Math.hypot(b.x - a.x, b.z - a.z);
        }
        return len;
    }

    // Ricerca globale (non finestrata): usata per il fuoripista e per
    // agganciare l'altezza y visiva della macchina al punto più vicino della
    // pista. Costo O(n) sui punti campionati, accettabile a 50 tick/s con
    // poche decine di punti-auto.
    function nearestPoint(points, x, z) {
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const dd = (x - p.x) ** 2 + (z - p.z) ** 2;
            if (dd < bestDist) { bestDist = dd; bestIdx = i; }
        }
        const p = points[bestIdx];
        return { x: p.x, y: p.y || 0, z: p.z, index: bestIdx, dist: Math.sqrt(bestDist) };
    }

    // Quota "del terreno" in un punto qualunque del mondo: pari alla quota
    // pista se si è entro embankStart dal punto pista più vicino, sfuma a 0
    // (prato in piano) oltre embankOuter con uno smoothstep nel mezzo (stessa
    // curva già usata in evalSegment per la quota lungo il tracciato:
    // pendenza nulla ai due estremi, nessuno spigolo visibile). Fonte di
    // verità unica per "che quota ha il terreno qui", riusata sia per
    // posizionare oggetti scenici sia per la quota visiva dell'auto fuori
    // pista sia per costruire la mesh del terrapieno.
    function terrainHeightAt(groundPts, x, z, embankStart, embankOuter) {
        const { y, dist } = nearestPoint(groundPts, x, z);
        if (dist <= embankStart) return y;
        if (dist >= embankOuter) return 0;
        const t = (dist - embankStart) / (embankOuter - embankStart);
        const te = t * t * (3 - 2 * t);
        return y + (0 - y) * te;
    }

    // Divide i punti campionati (chiusi, come trackPts) in spezzoni "a terra"
    // (non-ponte) e "ponte": un ponte non genera terrapieno/prato proprio
    // (li ignora, il terreno resta quello vero sotto), uno spezzone a terra
    // continua a funzionare come nella Fase 1. Se non c'è nessun punto ponte,
    // un solo spezzone chiuso copre l'intero giro (nessuna differenza
    // rispetto a prima di questa funzione). La scansione parte sempre
    // dall'inizio di uno spezzone a terra (non da un indice arbitrario):
    // partire a metà di uno spezzone lo spezzerebbe in due pezzi ai lati del
    // bordo dell'array — un bug reale trovato scrivendo i test di questa
    // funzione.
    function splitByBridge(trackPts) {
        const n = trackPts.length;
        if (!trackPts.some(p => p.bridge)) {
            return { groundRuns: [{ indices: trackPts.map((_, i) => i), closed: true }], bridgeRuns: [] };
        }

        let first = 0;
        for (let i = 0; i < n; i++) {
            if (!trackPts[i].bridge && trackPts[(i - 1 + n) % n].bridge) { first = i; break; }
        }

        const groundRuns = [];
        const bridgeRuns = [];
        let current = [];
        let currentIsBridge = false;

        function flush() {
            if (!current.length) return;
            if (currentIsBridge) bridgeRuns.push(current);
            else groundRuns.push({ indices: current, closed: false });
            current = [];
        }

        for (let k = 0; k < n; k++) {
            const idx = (first + k) % n;
            const isBridge = !!trackPts[idx].bridge;
            if (isBridge !== currentIsBridge) { flush(); currentIsBridge = isBridge; }
            current.push(idx);
        }
        flush();

        return { groundRuns, bridgeRuns };
    }

    // Giri necessari per coprire (circa) targetKm, dati in metri = unità di
    // gioco (coerente con le scale esistenti: CAR_HALF_LENGTH ~2.4 unità
    // già pensato come metri reali).
    function lapsForDistance(lapLengthUnits, targetKm) {
        return Math.max(1, Math.round((targetKm * 1000) / lapLengthUnits));
    }

    function nearestIndexNear(points, prevIndex, x, z, window) {
        const n = points.length;
        const w = window || 20;
        let bestIdx = prevIndex || 0;
        let bestDist = Infinity;
        for (let d = -w; d <= w; d++) {
            const idx = ((prevIndex + d) % n + n) % n;
            const pt = points[idx];
            const dd = (x - pt.x) ** 2 + (z - pt.z) ** 2;
            if (dd < bestDist) { bestDist = dd; bestIdx = idx; }
        }
        return bestIdx;
    }

    // closed=true: normale/tangente "avvolgente" (usa il vicino oltre gli
    // estremi). closed=false: agli estremi usa solo il vicino disponibile.
    function tangentAt(points, i, closed) {
        const n = points.length;
        const next = closed ? points[(i + 1) % n] : points[Math.min(i + 1, n - 1)];
        const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(i - 1, 0)];
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const len = Math.hypot(tx, tz) || 1;
        return { tx: tx / len, tz: tz / len };
    }

    function normalAt(points, i, closed) {
        const { tx, tz } = tangentAt(points, i, closed);
        return { nx: -tz, nz: tx };
    }

    // Direzione in cui deve guardare un oggetto posato su un nastro parallelo
    // alla pista a distanza `distanzaA(idx, side)`: perpendicolare al NASTRO,
    // non alla pista.
    //
    // Dove la distanza è costante le due direzioni coincidono — è il motivo
    // per cui questa funzione non cambia nulla su 136 elementi di 149. Dove
    // il muro sale o scende, il nastro è inclinato rispetto alla pista di
    // atan(variazione della distanza / passo di pista), e un oggetto
    // orientato sulla normale della pista risulta storto di altrettanto:
    // misurati 37° sulla rete del campione 414 di `prova` e 31° sulla tribuna
    // del 615, quella segnalata in gioco dall'utente il 2026-08-12.
    // `spanSamples` è la mezza-larghezza dell'oggetto, in campioni: la
    // direzione si prende sulla CORDA del nastro che l'oggetto sottende, non
    // sulla tangente in un punto. Un oggetto è un segmento rigido, e in una
    // rampa breve la tangente al centro non è parallela alla corda: con
    // spanSamples 1 su un oggetto largo 4 campioni restavano 17° di scarto
    // sulla tribuna del campione 615 di `prova` (misurato il 2026-08-13).
    function ribbonFacingAt(points, i, side, distanzaA, spanSamples) {
        const n = points.length;
        const w = Math.max(1, Math.round(spanSamples || 1));
        const punto = (k) => {
            const { nx, nz } = normalAt(points, k, true);
            const d = distanzaA(k, side);
            return { x: points[k].x + nx * d * side, z: points[k].z + nz * d * side };
        };
        const qui = punto(i);
        const versoPista = { x: points[i].x - qui.x, z: points[i].z - qui.z };
        const a = punto(((i - w) % n + n) % n), b = punto((i + w) % n);
        let tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz);
        // Nastro degenere (i due vicini coincidono): non c'è una tangente da
        // cui ricavare la perpendicolare, si torna alla normale della pista
        // invece di produrre un NaN.
        if (len < 1e-9) return Math.atan2(versoPista.x, versoPista.z);
        tx /= len; tz /= len;
        let fx = -tz, fz = tx;
        if (versoPista.x * fx + versoPista.z * fz < 0) { fx = -fx; fz = -fz; }
        return Math.atan2(fx, fz);
    }

    // Quota della pista SOPRAELEVATA che passa sopra il punto (x, z), o
    // Infinity se lì sopra non passa nulla entro `radius`.
    //
    // Serve alla scenografia: terrainHeightAt lavora sui soli punti a terra
    // (i tratti `bridge` vengono filtrati via a monte), quindi un oggetto
    // piazzato sotto un cavalcavia riceve la quota del terreno e, se è più
    // alto della luce del ponte, ci passa attraverso — succedeva a reti,
    // tribune e torre sul tracciato "prova", che ha 198 punti di ponte fino
    // a 11.5 unità sopra il terreno.
    function bridgeHeightAt(bridgePts, x, z, radius) {
        if (!bridgePts || !bridgePts.length) return Infinity;
        let best = Infinity;
        const r2 = radius * radius;
        for (let i = 0; i < bridgePts.length; i++) {
            const p = bridgePts[i];
            const dd = (x - p.x) ** 2 + (z - p.z) ** 2;
            if (dd <= r2 && p.y < best) best = p.y;
        }
        return best;
    }

    // Raggio di curvatura del tracciato al punto i, in unità, e verso della
    // curva. Si confrontano le direzioni a `sampleSpan` campioni prima e
    // dopo: l'angolo fra le due, diviso per la lunghezza d'arco percorsa, è
    // la curvatura, il cui reciproco è il raggio. Su un rettilineo l'angolo
    // è nullo e il raggio Infinity.
    //
    // Un campione singolo sarebbe dominato dal rumore del campionamento
    // Catmull-Rom, per questo si guarda una finestra: 12 campioni su 1000
    // per giro sono ~1% del tracciato, abbastanza da mediare il rumore senza
    // spalmare una curva stretta su tutto il suo intorno.
    //
    // Il bot server-side (backend/sockets/games/f1Bot.js) calcola la stessa
    // grandezza per decidere la velocità in curva, ma vive in un altro
    // processo e non è importabile da qui: questa è la versione condivisa,
    // usata dalla scenografia per sapere dove sono le curve.
    function curvatureAt(points, i, sampleSpan = 12) {
        const n = points.length;
        const a = points[(((i - sampleSpan) % n) + n) % n];
        const b = points[i];
        const c = points[(i + sampleSpan) % n];

        const h1 = Math.atan2(b.z - a.z, b.x - a.x);
        const h2 = Math.atan2(c.z - b.z, c.x - b.x);
        let turnSigned = h2 - h1;
        while (turnSigned > Math.PI) turnSigned -= Math.PI * 2;
        while (turnSigned < -Math.PI) turnSigned += Math.PI * 2;

        // Diviso 2: l'angolo fra le direzioni dei due segmenti corrisponde
        // all'arco fra i loro PUNTI MEDI, cioè metà della somma delle corde.
        // Senza il fattore 2 il raggio risulta doppio di quello vero
        // (misurato su un cerchio di raggio noto: 199.7 invece di 100).
        const arc = Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z);
        if (Math.abs(turnSigned) < 1e-6 || arc === 0) return { radius: Infinity, turnSigned: 0 };
        return { radius: arc / (2 * Math.abs(turnSigned)), turnSigned };
    }

    // Spaziatura reale (metri) tra un box giocatore e il successivo lungo la
    // corsia box — vedi frontend/shared/pitBoxLoader.js e
    // docs/superpowers/specs/2026-08-03-f1-pit-boxes-design.md. Si cammina
    // sulla SPEZZATA di pitPath (gli stessi punti di controllo grezzi usati
    // dall'autopilota server-side in f1GameSocket.js, non la curva
    // Catmull-Rom campionata usata per il rendering): backend e frontend
    // richiamano questa stessa funzione con gli stessi input, garantendo che
    // l'auto si fermi esattamente davanti al proprio box.
    // Valore misurato sull'ingombro REALE del box in gioco (~21.7m in pianta
    // col vecchio f1PitBox.glb, che era grezzo ~6.2×6m moltiplicato 3.5x da
    // pitBoxLoader.js). 8m — basato sul solo file grezzo, prima di scoprire
    // che serviva il fattore di scala — faceva sovrapporre i box tra loro,
    // verificato in playtest dall'utente.
    // Dal 2026-08-09 il modello è circuit/pitBox.glb, in scala 1:1 e senza
    // moltiplicatore: è stato dimensionato apposta a 21.8m di larghezza per
    // NON cambiare questa costante, che è condivisa con l'autopilota
    // server-side (backend/sockets/games/f1GameSocket.js) e determina dove
    // le auto si fermano davvero.
    // 15 e non più 24: è la larghezza di un box di F1 vera (≈11,7 m) e
    // triplica la capienza delle corsie corte — monte-rosso passa da 8 a 13
    // posti, che è ciò che permette di scegliere in lobby fino a 20 piloti.
    // I tre volumi che stanno su questa fila (pitBox, pitsGarageClosed,
    // pitsOffice) sono larghi 14.1-14.5: mezza unità di stacco, così due
    // fronti affiancati non si toccano.
    //
    // ⚠️ Condiviso con l'autopilota server-side: questa costante decide dove
    // le auto si FERMANO davvero, non solo dove si disegna il box. Cambiandola
    // serve un playtest della sosta, non un controllo a vista.
    const PIT_BOX_SPACING = 15;

    // Distanza dal bordo della corsia box (pitRoadHalf) alla quale piazzare
    // lo STALLO di sosta di ogni auto (Rif. richiesta utente 2026-08-07,
    // due round: 1° round, 2 — appena oltre il bordo — non bastava, l'auto
    // restava troppo vicina alla corsia di transito condivisa; 2° round,
    // spinto a 10 su richiesta esplicita di "spingere la schiera di box più
    // indietro" e creare una vera zona stallo separata dalla corsia). Il
    // garage decorativo (PitBoxLoader.PIT_BOX_CLEARANCE) è stato spostato
    // ANCORA più indietro di questo valore, in modo che lo stallo resti
    // "subito davanti" al proprio garage, mai sovrapposto.
    const PIT_STALL_CLEARANCE = 10;

    // Cammina lungo la spezzata `pitPath` di `distance` metri (con segno) a
    // partire dal punto boxIndex; oltre gli estremi della corsia si ferma
    // (clamp) invece di uscire dall'array.
    function walkPitPath(pitPath, boxIndex, distance) {
        let idx = boxIndex;
        let remaining = distance;
        if (remaining >= 0) {
            while (idx < pitPath.length - 1) {
                const segLen = dist(pitPath[idx], pitPath[idx + 1]);
                if (segLen === 0 || remaining <= segLen) {
                    const f = segLen === 0 ? 0 : remaining / segLen;
                    return {
                        x: pitPath[idx].x + (pitPath[idx + 1].x - pitPath[idx].x) * f,
                        z: pitPath[idx].z + (pitPath[idx + 1].z - pitPath[idx].z) * f,
                        fromIdx: idx, toIdx: idx + 1
                    };
                }
                remaining -= segLen;
                idx++;
            }
            const last = pitPath.length - 1;
            return { x: pitPath[last].x, z: pitPath[last].z, fromIdx: Math.max(0, last - 1), toIdx: last };
        }
        remaining = -remaining;
        while (idx > 0) {
            const segLen = dist(pitPath[idx - 1], pitPath[idx]);
            if (segLen === 0 || remaining <= segLen) {
                const f = segLen === 0 ? 0 : remaining / segLen;
                return {
                    x: pitPath[idx].x + (pitPath[idx - 1].x - pitPath[idx].x) * f,
                    z: pitPath[idx].z + (pitPath[idx - 1].z - pitPath[idx].z) * f,
                    fromIdx: idx - 1, toIdx: idx
                };
            }
            remaining -= segLen;
            idx--;
        }
        return { x: pitPath[0].x, z: pitPath[0].z, fromIdx: 0, toIdx: Math.min(1, pitPath.length - 1) };
    }

    // Come walkPitPath, ma per un percorso CHIUSO ad anello (i punti
    // campionati del tracciato principale, non la corsia box): cammina di
    // `distance` metri (con segno) a partire da `startIndex`, avvolgendosi
    // circolarmente (mai un clamp agli estremi, non ci sono estremi).
    // Serve a piazzare griglia di partenza/spawn seguendo la VERA curva
    // del tracciato — Rif. richiesta utente 2026-08-07: prima
    // (gridSpawnPoint in trackLoader.js) si usava un'estrapolazione
    // lineare da un unico punto+angolo fissi (quelli del traguardo), che
    // su un tratto curvo del traguardo faceva sì che le auto più lontane
    // dal punto di riferimento finissero fuori dalla vera linea centrale E
    // con un angolo non allineato alla pista in quel punto (auto "storte"
    // in griglia, segnalato in playtest).
    function walkClosedLoop(points, startIndex, distance) {
        const n = points.length;
        let idx = startIndex;
        let remaining = distance;
        if (remaining >= 0) {
            for (let steps = 0; steps < n; steps++) {
                const nextIdx = (idx + 1) % n;
                const segLen = dist(points[idx], points[nextIdx]);
                if (segLen === 0 || remaining <= segLen) {
                    const f = segLen === 0 ? 0 : remaining / segLen;
                    return {
                        x: points[idx].x + (points[nextIdx].x - points[idx].x) * f,
                        z: points[idx].z + (points[nextIdx].z - points[idx].z) * f,
                        fromIdx: idx, toIdx: nextIdx
                    };
                }
                remaining -= segLen;
                idx = nextIdx;
            }
        } else {
            remaining = -remaining;
            for (let steps = 0; steps < n; steps++) {
                const prevIdx = (idx - 1 + n) % n;
                const segLen = dist(points[prevIdx], points[idx]);
                if (segLen === 0 || remaining <= segLen) {
                    const f = segLen === 0 ? 0 : remaining / segLen;
                    return {
                        x: points[idx].x + (points[prevIdx].x - points[idx].x) * f,
                        z: points[idx].z + (points[prevIdx].z - points[idx].z) * f,
                        fromIdx: prevIdx, toIdx: idx
                    };
                }
                remaining -= segLen;
                idx = prevIdx;
            }
        }
        // Rete di sicurezza (mai raggiunta con una distance ragionevole
        // rispetto alla lunghezza del giro): resta sul punto di partenza
        // invece di un valore inventato.
        return { x: points[startIndex].x, z: points[startIndex].z, fromIdx: startIndex, toIdx: (startIndex + 1) % n };
    }

    // Primo campione, camminando da startIndex nel verso dir (+1/-1), il cui
    // punto PROIETTATO dista almeno `spacing` da `from`. -1 se non esiste.
    //
    // Serve a comporre file di oggetti contigui (tribune, edifici box). Il
    // modo ovvio — convertire la spaziatura in un numero di campioni,
    // `Math.round(spacing / stepLen)` — sbaglia due volte: l'arrotondamento
    // introduce da solo un errore (18.4/5.17 -> 4 campioni = 20.7, +12%), e
    // soprattutto ignora che gli oggetti stanno SPOSTATI DI LATO rispetto
    // alla linea centrale: su una curva di raggio 158 con offset 29, l'arco
    // percorso dagli oggetti non è quello dei campioni. Misurando la distanza
    // reale fra i punti proiettati, entrambi gli errori spariscono e la fila
    // resta continua su qualunque geometria (Rif. "buco al traguardo"
    // segnalato dall'utente il 2026-08-09: distanze reali di 14.3 e 17.2 fra
    // moduli che dovevano stare a 18.4).
    //
    // `project(idx) -> {x, z}` mappa un indice nel punto da misurare: per la
    // scenografia è il punto già offsettato di lato, non il campione grezzo.
    function advanceToDistance(points, startIndex, dir, closed, from, spacing, project) {
        const n = points.length;
        const step = dir >= 0 ? 1 : -1;
        let idx = startIndex;
        for (let k = 0; k < n; k++) {
            idx += step;
            if (closed) {
                idx = ((idx % n) + n) % n;
            } else if (idx < 0 || idx >= n) {
                return -1;
            }
            const q = project(idx);
            if (Math.hypot(q.x - from.x, q.z - from.z) >= spacing) return idx;
        }
        return -1;
    }

    // Come advanceToDistance, ma con la posizione ESATTA invece del primo
    // campione utile: ritorna { idx, prevIdx, t }, dove t è il fattore di
    // interpolazione fra prevIdx e idx al quale la distanza da `from` vale
    // esattamente `spacing`. null se il percorso finisce prima.
    //
    // Serve perché i campioni sono radi rispetto agli oggetti da affiancare:
    // sul tracciato "prova" un campione vale 5.17 unità, quindi accontentarsi
    // del primo oltre la soglia sfora di quasi due unità e riapre il varco
    // che si voleva chiudere (misurato: moduli a 20.1 invece di 19.2). La
    // bisezione costa una manciata di iterazioni ed è codice di caricamento,
    // eseguito una volta per tracciato.
    function advanceToDistancePoint(points, startIndex, dir, closed, from, spacing, project) {
        const idx = advanceToDistance(points, startIndex, dir, closed, from, spacing, project);
        if (idx < 0) return null;
        const n = points.length;
        const prevIdx = closed ? (((idx - (dir >= 0 ? 1 : -1)) % n) + n) % n : idx - (dir >= 0 ? 1 : -1);
        const a = project(prevIdx), b = project(idx);
        const distOf = (t) => {
            const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
            return Math.hypot(x - from.x, z - from.z);
        };
        // a sta sotto la soglia e b sopra (per costruzione di
        // advanceToDistance), quindi la soluzione è nell'intervallo.
        let lo = 0, hi = 1;
        for (let k = 0; k < 24; k++) {
            const mid = (lo + hi) / 2;
            if (distOf(mid) < spacing) lo = mid; else hi = mid;
        }
        return { idx, prevIdx, t: (lo + hi) / 2 };
    }

    // count posizioni equispaziate lungo la corsia box, centrate su
    // boxIndex — una per pilota (vedi assignGridSpawns in
    // f1GameSocket.js). Restituisce anche la tangente locale (tx,tz
    // normalizzata) per offsettare/ruotare il modello del box lateralmente
    // (frontend/f1.js, loadPlayerPitBox), e fromIdx (indice del waypoint di
    // pitPath appena PRIMA dell'anchor, nel verso di marcia): serve
    // all'autopilota server-side (f1GameSocket.js::updatePitAutopilot) per
    // sapere fino a che waypoint camminare in avanti prima del balzo finale
    // verso il proprio box — box con offset negativo (prima di boxIndex
    // lungo il verso di marcia) hanno fromIdx < boxIndex, altrimenti
    // l'autopilota li farebbe passare oltre il proprio box fino al vertice
    // condiviso per poi tornare indietro (bug osservato in playtest: l'auto
    // va avanti, poi inverte per raggiungere il box).
    // Griglia di partenza (Rif. richiesta utente 2026-08-07): distanza
    // dietro/spaziatura/scarto laterale delle posizioni di partenza in
    // gara. UNICA fonte di verità per queste costanti — prima erano
    // duplicate solo in backend/sockets/games/trackLoader.js; spostate qui
    // (modulo condiviso Node+browser) così sia il calcolo reale dello
    // spawn (server) sia il disegno permanente della griglia sulla pista
    // (client, Rif. richiesta "griglia visibile in pista") usano ESATTAMENTE
    // la stessa formula — nessun rischio che le due cose divergano.
    // GRID_START=48: con MAX_GRID_SIZE=6 (f1Bot.js) e GRID_STAGGER=8, la
    // casella più vicina alla linea è i=MAX_GRID_SIZE-1=5, la cui distanza
    // dalla linea è GRID_START - 5*GRID_STAGGER. Con 40 veniva 0 — la
    // casella finiva ESATTAMENTE sulla linea del traguardo, sovrapponendosi
    // alle strisce bianco/nere (bug segnalato in playtest su Monte Rosso e
    // Prova, presente su ogni pista perché indipendente dalla geometria).
    // 48 lascia 8 unità di margine anche all'ultima casella.
    const GRID_START = 48;       // unità dietro la linea di partenza per la pole
    const GRID_STAGGER = 8;      // arretramento extra per ogni posizione in griglia
    const GRID_LANE_OFFSET = 6;  // scostamento laterale di ogni corsia dal centro pista

    // Posizione (e angolo, allineato alla tangente LOCALE) della i-esima
    // casella di griglia, camminando sui punti VERI del tracciato chiuso a
    // partire da startFinishIndex (mai un'estrapolazione lineare da un
    // unico punto+angolo fissi — su un tratto curvo vicino al traguardo
    // faceva finire le posizioni più lontane fuori dalla vera linea
    // centrale e con un angolo non allineato alla pista in quel punto,
    // bug reale "auto storte in griglia" segnalato in playtest). i=0 è la
    // pole, alterna lato (pari=+1, dispari=-1) come una vera griglia
    // sfalsata.
    function gridSpawnPoint(points, startFinishIndex, i) {
        const laneSign = (i % 2 === 0) ? 1 : -1;
        const distForward = GRID_START - i * GRID_STAGGER;
        const { x, z, fromIdx, toIdx } = walkClosedLoop(points, startFinishIndex, distForward);
        const a = points[fromIdx], b = points[toIdx];
        const tx = b.x - a.x, tz = b.z - a.z;
        const tlen = Math.hypot(tx, tz) || 1;
        const ntx = tx / tlen, ntz = tz / tlen;
        const nx = -ntz, nz = ntx;
        return {
            x: x + nx * (laneSign * GRID_LANE_OFFSET),
            z: z + nz * (laneSign * GRID_LANE_OFFSET),
            angle: Math.atan2(ntx, ntz),
            // Campione di pista su cui cade lo schieramento. Chi posiziona
            // un'auto qui DEVE usarlo per `p.trackIndex`: la fisica cerca il
            // punto pista in una finestra stretta attorno all'indice che
            // l'auto dichiara (nearestIndexNear, ±20 campioni), e uno spawn
            // che dichiara 0 mentre sta al campione 41 fa misurare al muro la
            // distanza dal punto sbagliato — l'auto viene spinta di lato al
            // primo tick di gara. Succedeva su monte-rosso, dove i campioni
            // valgono 1.18 unità e la pole cade al 41°; su prova (5.17 per
            // campione, pole al 9°) restava dentro la finestra per caso.
            index: fromIdx,
        };
    }

    // trackPoints/pitRoadHalf (opzionali, retrocompatibili — se assenti gli
    // anchor non hanno stallX/stallZ, comportamento identico a prima):
    // quando presenti, ogni anchor guadagna uno stallo di sosta
    // (stallX/stallZ) spostato lateralmente dalla linea centrale della
    // corsia verso il lato ESTERNO del circuito (stessa tecnica di
    // frontend/f1.js::loadPlayerPitBox per il modello del garage: tra le due
    // normali possibili si sceglie quella più lontana dal tracciato
    // principale), a distanza pitRoadHalf+PIT_STALL_CLEARANCE dalla linea
    // centrale — coincide con l'imbocco del garage decorativo. La corsia
    // condivisa (pitPath) resta invariata: solo il punto di ARRIVO/sosta si
    // sposta, non il percorso di transito.
    // Una posizione sulla corsia box, a `offset` unità dal punto `boxIndex`.
    //
    // È il mattone comune di pitBoxAnchors e pitLaneSlots: se le due
    // calcolassero la posizione ognuna per conto suo, i box dei piloti e gli
    // edifici decorativi finirebbero su due file leggermente diverse, e il
    // fronte della corsia si leggerebbe sfalsato.
    function pitSlotAt(pitPath, boxIndex, offset, trackPoints, pitRoadHalf) {
        const { x, z, fromIdx, toIdx } = walkPitPath(pitPath, boxIndex, offset);
        const a = pitPath[fromIdx], b = pitPath[toIdx];
        const tx = b.x - a.x, tz = b.z - a.z;
        const tlen = Math.hypot(tx, tz) || 1;
        const ntx = tx / tlen, ntz = tz / tlen;
        const slot = { x, z, tx: ntx, tz: ntz, fromIdx };

        if (trackPoints && pitRoadHalf != null) {
            const nx = -ntz, nz = ntx;   // normale, perpendicolare alla tangente
            const distPlus = nearestPoint(trackPoints, x + nx, z + nz).dist;
            const distMinus = nearestPoint(trackPoints, x - nx, z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const stallOffset = pitRoadHalf + PIT_STALL_CLEARANCE;
            slot.stallX = x + nx * stallOffset * side;
            slot.stallZ = z + nz * stallOffset * side;
        }
        return slot;
    }

    function pitBoxAnchors(pitPath, boxIndex, count, trackPoints, pitRoadHalf) {
        // Math.floor e non (count-1)/2: con un numero PARI di box la mezza
        // misura faceva cadere le ancore a metà passo, cioè FRA due posizioni
        // della griglia — e gli edifici decorativi, che sulla griglia ci
        // stanno, sarebbero finiti sfalsati di 7.5 unità rispetto ai box.
        // Arrotondando, ogni box cade esattamente su una posizione: la fila
        // resta centrata su boxIndex a meno di mezzo passo, che a occhio non
        // si vede, e il fronte resta allineato, che invece si vede eccome.
        const mid = Math.floor((count - 1) / 2);
        const anchors = [];
        for (let i = 0; i < count; i++) {
            anchors.push(pitSlotAt(pitPath, boxIndex, (i - mid) * PIT_BOX_SPACING,
                                   trackPoints, pitRoadHalf));
        }
        return anchors;
    }

    // Tutte le posizioni lungo la corsia box, in ordine di percorrenza, a
    // passo PIT_BOX_SPACING e IN FASE con la fila dei box (che è centrata su
    // boxIndex).
    //
    // È la griglia unica su cui si posano sia i box dei piloti sia gli edifici
    // decorativi: avendo un passo solo e una fase sola, fra due elementi
    // consecutivi non può restare un vuoto. Prima erano due sistemi con passi
    // diversi che si evitavano a vicenda, e i vuoti nascevano da lì.
    //
    // GEOMETRIA PURA, nessun margine agli estremi: quante posizioni ci stanno
    // e basta. Il primo tentativo ne toglieva 40 unità per capo, perché
    // all'imbocco la corsia corre ancora affiancata alla pista e un garage lì
    // sovrasta l'ingresso — ma così su monte-rosso restavano 8 posizioni su
    // 13, cioè si buttava via metà del guadagno del passo stretto. Chi posa
    // gli edifici ha già i suoi controlli di distanza dalla pista: le
    // posizioni che non gli servono le salta lui, e i BOX possono usarle
    // tutte, come hanno sempre fatto.
    function pitLaneSlots(pitPath, boxIndex, trackPoints, pitRoadHalf) {
        if (!pitPath || pitPath.length < 2) return [];

        let prima = 0;
        for (let i = 1; i <= boxIndex && i < pitPath.length; i++) {
            prima += Math.hypot(pitPath[i].x - pitPath[i - 1].x,
                                pitPath[i].z - pitPath[i - 1].z);
        }
        let dopo = 0;
        for (let i = boxIndex + 1; i < pitPath.length; i++) {
            dopo += Math.hypot(pitPath[i].x - pitPath[i - 1].x,
                               pitPath[i].z - pitPath[i - 1].z);
        }

        const indietro = Math.floor(prima / PIT_BOX_SPACING);
        const avanti = Math.floor(dopo / PIT_BOX_SPACING);

        const slots = [];
        for (let k = -indietro; k <= avanti; k++) {
            const s = pitSlotAt(pitPath, boxIndex, k * PIT_BOX_SPACING, trackPoints, pitRoadHalf);
            s.indice = slots.length;
            // Distanza lungo la corsia da boxIndex: serve a chi deve spostare
            // di poco un oggetto rispetto alla sua posizione (vedi il fronte
            // della corsia in trackScenery, dove sulle curve strette un
            // edificio va scostato per non incrociare il vicino).
            s.offset = k * PIT_BOX_SPACING;
            slots.push(s);
        }
        return slots;
    }

    // Test "punto dentro un rettangolo orientato" — generalizza il vecchio
    // confronto xMin/xMax/zMin/zMax assi-allineato (usato dal trigger
    // d'ingresso ai box): ruota il punto nel sistema di riferimento locale
    // del rettangolo (stessa convenzione atan2(x,z) usata ovunque nel
    // modulo, es. gridSpawnPoint/tangentAt) e confronta contro le due
    // semi-estensioni. Ad angle=0 si riduce esattamente al vecchio
    // confronto assi-allineato — nessuna differenza di comportamento per
    // un trigger non ruotato (Rif. richiesta utente 2026-08-08).
    function pointInOrientedBox(px, pz, box) {
        const angle = box.angle || 0;
        const dx = px - box.x, dz = pz - box.z;
        const sin = Math.sin(angle), cos = Math.cos(angle);
        const localZ = dx * sin + dz * cos;   // avanti/indietro nel verso del rettangolo
        const localX = dx * cos - dz * sin;   // laterale
        return Math.abs(localX) <= box.halfWidth && Math.abs(localZ) <= box.halfLength;
    }

    // Aggancia il primo e l'ultimo punto della corsia box esattamente al
    // bordo della pista vera (roadHalf - insetMargin dal centro pista,
    // sullo stesso lato del punto grezzo originale), lasciando invariati i
    // punti intermedi. Elimina la sovrapposizione/il vuoto che oggi
    // dipendono da quanto precisamente è stato piazzato il punto a mano
    // nell'editor (Rif. richiesta utente 2026-08-08 raccordo pulito
    // pista/corsia box — verificato: sulle piste esistenti il punto finale
    // era 4-10 unità oltre il bordo pista). insetMargin tiene il punto un
    // po' DENTRO il bordo pista, non esattamente sopra: un valore troppo
    // piccolo rischierebbe di restare comunque "fuori" per via
    // dell'arrotondamento della curva campionata.
    function snapPitEndpoint(rawPt, trackPoints, roadHalf, insetMargin) {
        const { index } = nearestPoint(trackPoints, rawPt.x, rawPt.z);
        const m = trackPoints[index];
        const { nx, nz } = normalAt(trackPoints, index, true);
        const signedDist = (rawPt.x - m.x) * nx + (rawPt.z - m.z) * nz;
        const side = signedDist >= 0 ? 1 : -1;
        const snapDist = roadHalf - insetMargin;
        return { x: m.x + nx * side * snapDist, z: m.z + nz * side * snapDist };
    }

    function snapPitPathEnds(pitControlPoints, trackPoints, roadHalf, insetMargin = 3) {
        const pts = pitControlPoints.map(p => ({ ...p }));
        const n = pts.length;
        Object.assign(pts[0], snapPitEndpoint(pts[0], trackPoints, roadHalf, insetMargin));
        Object.assign(pts[n - 1], snapPitEndpoint(pts[n - 1], trackPoints, roadHalf, insetMargin));
        return pts;
    }

    // Rif. richiesta utente 2026-08-08 (screenshot con riferimento disegnato
    // a mano): il raccordo deve "seguire l'andamento e la curvatura della
    // pista reale" vicino al punto di aggancio, non tagliare a un angolo
    // qualunque quello che capita di avere il percorso grezzo autorato in
    // editor. Entro taperLength unità d'arco da ciascun estremo (i due
    // campioni già agganciati da snapPitPathEnds), ogni campione viene
    // spostato dalla sua posizione originale verso un punto che cammina
    // lungo la VERA curva della pista principale, allo STESSO offset
    // laterale del punto di aggancio (quindi "parallelo" alla pista lì) —
    // sfumando con uno smoothstep verso la forma originale del percorso man
    // mano che ci si allontana dall'estremo (0 = esattamente il punto di
    // aggancio, 1 = forma originale invariata al confine del raccordo).
    // Puramente estetico/di rendering: opera sui campioni GIA' campionati
    // (sampleOpenPath), non su pitControlPoints/pitPath — non tocca nulla
    // di ciò che la fisica di gioco usa (il server continua a camminare sui
    // waypoint grezzi come oggi), sicuro applicarlo liberamente al solo
    // array usato per disegnare corsia box/varco barriera.
    function tuckPitEndsToTrack(pitPts, trackPts, taperLength = 60) {
        const n = pitPts.length;
        const cumDist = [0];
        for (let i = 1; i < n; i++) cumDist.push(cumDist[i - 1] + dist(pitPts[i - 1], pitPts[i]));
        const avgStep = cumDist[n - 1] / (n - 1 || 1);
        const out = pitPts.map(p => ({ ...p }));

        function tuckEnd(mergeSampleIdx, sign) {
            const mergePt = pitPts[mergeSampleIdx];
            const { index: mergeMainIdx } = nearestPoint(trackPts, mergePt.x, mergePt.z);
            const mergeMain = trackPts[mergeMainIdx];
            const mergeNormal = normalAt(trackPts, mergeMainIdx, true);
            const mergeOffset = (mergePt.x - mergeMain.x) * mergeNormal.nx + (mergePt.z - mergeMain.z) * mergeNormal.nz;

            // Determina il verso di cammino lungo la pista (+arco/-arco a
            // partire da mergeMainIdx) confrontando, a metà del raccordo,
            // quale dei due versi si avvicina di più al percorso originale
            // — l'unico modo di sapere "da che parte" la corsia box si
            // stacca senza assumere nulla sull'orientamento della pista.
            const refDist = taperLength * 0.5;
            const refIdx = Math.max(0, Math.min(n - 1, mergeSampleIdx + sign * Math.round(refDist / avgStep)));
            const refPt = pitPts[refIdx];
            const plus = walkClosedLoop(trackPts, mergeMainIdx, refDist);
            const minus = walkClosedLoop(trackPts, mergeMainIdx, -refDist);
            const walkSign = dist(plus, refPt) <= dist(minus, refPt) ? 1 : -1;

            for (let i = mergeSampleIdx; i >= 0 && i < n; i += sign) {
                const distFromEnd = Math.abs(cumDist[i] - cumDist[mergeSampleIdx]);
                if (distFromEnd > taperLength) break;
                // Il campione di aggancio stesso (distFromEnd=0) resta
                // ESATTAMENTE quello originale (out è già una copia): senza
                // questo caso a parte, a distanza zero fromIdx/toIdx del
                // walk possono differire di un campione dall'indice usato
                // per calcolare mergeOffset, introducendo uno scarto
                // sub-unità puramente numerico sul punto che invece deve
                // restare fermo per definizione.
                if (distFromEnd === 0) continue;
                const walked = walkClosedLoop(trackPts, mergeMainIdx, walkSign * distFromEnd);
                const walkedIdx = walkSign >= 0 ? walked.fromIdx : walked.toIdx;
                const { nx, nz } = normalAt(trackPts, walkedIdx, true);
                const t = distFromEnd / taperLength;
                const te = t * t * (3 - 2 * t); // smoothstep: 0 al punto di aggancio, 1 al confine del raccordo
                const huggedX = walked.x + nx * mergeOffset, huggedZ = walked.z + nz * mergeOffset;
                out[i].x = huggedX + (pitPts[i].x - huggedX) * te;
                out[i].z = huggedZ + (pitPts[i].z - huggedZ) * te;
            }
        }

        tuckEnd(0, 1);
        tuckEnd(n - 1, -1);
        return out;
    }

    // Genera punti AGGIUNTIVI (non fanno parte della corsia box vera) che
    // proseguono lungo la pista principale, allontanandosi dal punto di
    // aggancio (mergeSampleIdx di pitPts) verso il lato OPPOSTO a dove
    // prosegue la corsia box — stesso offset laterale del punto di
    // aggancio, quindi ancora "in corsia" sulla pista vera. Servono a far
    // vedere le linee laterali bianche della corsia box già un po' prima
    // del vero distacco (in entrata) o ancora un po' dopo il vero rientro
    // (in uscita), mentre il giocatore sta ancora correndo normalmente —
    // Rif. richiesta utente 2026-08-08: "creare una corsia immediatamente
    // visibile... capiscano subito che devono spostarsi verso quella
    // corsia". Restituisce i punti in ordine dal più VICINO al punto di
    // aggancio al più LONTANO (il chiamante inverte l'ordine se deve
    // anteporli invece che accodarli). pathSign: +1 se mergeSampleIdx=0
    // (entrata, la corsia box prosegue in avanti), -1 se
    // mergeSampleIdx=ultimo indice (uscita, la corsia box prosegue
    // all'indietro) — stessa convenzione di tuckEnd sopra.
    function pitLeadInPoints(pitPts, trackPts, mergeSampleIdx, pathSign, leadLength, samples = 20) {
        const mergePt = pitPts[mergeSampleIdx];
        const { index: mergeMainIdx } = nearestPoint(trackPts, mergePt.x, mergePt.z);
        const mergeMain = trackPts[mergeMainIdx];
        const mergeNormal = normalAt(trackPts, mergeMainIdx, true);
        const mergeOffset = (mergePt.x - mergeMain.x) * mergeNormal.nx + (mergePt.z - mergeMain.z) * mergeNormal.nz;

        // Stesso confronto già usato in tuckEnd per scegliere il verso di
        // cammino lungo la pista che corrisponde alla prosecuzione della
        // corsia box: qui però ci si allontana nel verso OPPOSTO.
        const refIdx = Math.max(0, Math.min(pitPts.length - 1, mergeSampleIdx + pathSign * 10));
        const refPt = pitPts[refIdx];
        const plus = walkClosedLoop(trackPts, mergeMainIdx, 10);
        const minus = walkClosedLoop(trackPts, mergeMainIdx, -10);
        const pitWalkSign = dist(plus, refPt) <= dist(minus, refPt) ? 1 : -1;
        const leadSign = -pitWalkSign;

        const out = [];
        for (let s = 1; s <= samples; s++) {
            const d = (leadLength * s) / samples;
            const walked = walkClosedLoop(trackPts, mergeMainIdx, leadSign * d);
            const walkedIdx = leadSign >= 0 ? walked.fromIdx : walked.toIdx;
            const { nx, nz } = normalAt(trackPts, walkedIdx, true);
            out.push({ x: walked.x + nx * mergeOffset, z: walked.z + nz * mergeOffset });
        }
        return out;
    }

    // Il punto sta DENTRO l'anello del tracciato? Ray casting: si conta
    // quante volte una semiretta orizzontale uscente dal punto attraversa il
    // bordo; dispari = dentro.
    //
    // Serve perché la distanza dalla pista, da sola, non distingue l'infield
    // dalla campagna: su un tracciato tortuoso il centro di un'ansa può
    // trovarsi a 170 unità dall'asfalto esattamente come un prato esterno, e
    // ogni effetto legato alla distanza — le colline, per esempio — vi si
    // applicherebbe allo stesso modo, sollevando terreno in mezzo al
    // circuito (difetto reale osservato il 2026-08-10: una lastra verde che
    // attraversava la pista).
    function isInsideLoop(pts, x, z) {
        let dentro = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i], b = pts[j];
            if (((a.z > z) !== (b.z > z)) &&
                (x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x)) {
                dentro = !dentro;
            }
        }
        return dentro;
    }

    // ────────────────────────────────────────────────────────────────────
    // CURVE DEL TRACCIATO
    //
    // Era in sceneryTrackside.js, dove serviva solo a distribuire gomme e
    // cartelli di frenata. Spostata qui perché ora la usano DUE sistemi
    // indipendenti — la scenografia e il profilo delle vie di fuga in ghiaia
    // (trackGravel.js) — e devono vedere le stesse curve: se divergessero, la
    // ghiaia finirebbe dove le gomme non sono e viceversa.
    // ────────────────────────────────────────────────────────────────────

    // Soglia sotto la quale un punto è considerato "in curva". 120 unità
    // (~94 m) su una pista larga 22: misurato sui tracciati esistenti,
    // seleziona il 18-23% dei punti, cioè i tornanti e le curve medie senza
    // marcare i raccordi quasi dritti.
    const CORNER_RADIUS_MAX = 120;
    // Due curve separate da meno di questo si fondono: senza, una parabolica
    // leggermente irregolare si spezza in più curve e riceve più volte gli
    // stessi oggetti sovrapposti.
    const CORNER_MERGE_GAP = 40;
    // Sotto questa lunghezza d'arco è un'increspatura del campionamento, non
    // una curva.
    const CORNER_MIN_LEN = 25;

    function findCorners(trackPts) {
        const n = trackPts.length;
        const stepLen = lapLength(trackPts) / n;
        const inCorner = [];
        const turns = [];
        const radii = [];
        for (let i = 0; i < n; i++) {
            const { radius, turnSigned } = curvatureAt(trackPts, i);
            inCorner.push(radius < CORNER_RADIUS_MAX);
            turns.push(turnSigned);
            radii.push(radius);
        }

        // Si parte da un punto NON in curva, così il primo run non risulta
        // spezzato a cavallo dell'indice 0 del giro chiuso.
        let start = -1;
        for (let i = 0; i < n; i++) {
            if (!inCorner[i] && inCorner[(i + 1) % n]) { start = (i + 1) % n; break; }
        }
        if (start < 0) return [];   // tracciato interamente curvo o interamente dritto

        const runs = [];
        let cur = null;
        for (let s = 0; s < n; s++) {
            const i = (start + s) % n;
            if (inCorner[i]) {
                if (!cur) cur = { startIdx: i, endIdx: i, turnSum: 0 };
                cur.endIdx = i;
                cur.turnSum += turns[i];
            } else if (cur) {
                runs.push(cur);
                cur = null;
            }
        }
        if (cur) runs.push(cur);

        const gapSamples = Math.max(1, Math.round(CORNER_MERGE_GAP / stepLen));
        const merged = [];
        for (const r of runs) {
            const last = merged[merged.length - 1];
            if (last && ((r.startIdx - last.endIdx + n) % n) <= gapSamples) {
                last.endIdx = r.endIdx;
                last.turnSum += r.turnSum;
            } else {
                merged.push(Object.assign({}, r));
            }
        }

        const minSamples = Math.max(1, Math.round(CORNER_MIN_LEN / stepLen));
        return merged
            .filter(r => ((r.endIdx - r.startIdx + n) % n) >= minSamples)
            .map(r => {
                const len = (r.endIdx - r.startIdx + n) % n;
                const midIdx = (r.startIdx + Math.floor(len / 2)) % n;
                const { radius } = curvatureAt(trackPts, midIdx);
                // Raggio più stretto di tutto l'arco. È una misura DIVERSA da
                // `radius`, non una sua rifinitura: `radius` descrive la forma
                // a metà curva, `minRadius` dice quanto si dovrà rallentare —
                // è il punto più vincolante che detta la velocità di
                // percorrenza (stesso criterio di f1Bot::cornerTargetSpeed).
                // Su una curva FUSA da CORNER_MERGE_GAP il punto medio può
                // cadere sul tratto quasi dritto che unisce i due archi:
                // misurato, `radius` vale 8588 sulla curva 1 di new-monza e
                // 463 sulla 9 di baku, che sono tornanti. `minRadius` dà 48 su
                // entrambe.
                let minRadius = Infinity;
                for (let k = 0; k <= len; k++) {
                    const rad = radii[(r.startIdx + k) % n];
                    if (rad < minRadius) minRadius = rad;
                }
                // Il lato ESTERNO della curva è opposto al verso di sterzata:
                // normalAt ritorna (-tz, tx) e con turnSum positivo la pista
                // gira verso quella normale, quindi l'esterno sta dall'altra parte.
                return {
                    startIdx: r.startIdx, endIdx: r.endIdx, midIdx, radius, minRadius,
                    side: r.turnSum > 0 ? -1 : 1,
                };
            });
    }

    // Quanto percorso lungo il tracciato separa un punto dai suoi "parenti":
    // entro questa distanza i campioni appartengono al proprio tratto, oltre
    // sono un altro pezzo di circuito anche se in linea d'aria sono lì
    // accanto. È in UNITÀ DI PISTA e non in campioni, che valgono 1.18 unità
    // su monte-rosso e 5.17 su prova.
    const NEIGHBOUR_KIN_SPAN = 40;
    // Quanto due campioni possono differire in distanza dal punto di confine
    // ed essere considerati entrambi "quelli che stanno di là".
    const NEIGHBOUR_TIE_MARGIN = 8;

    // Fin dove si estende il territorio di ogni campione, per lato, prima di
    // finire su un pezzo di circuito che appartiene a un altro tratto — e a
    // che quota riprende il terreno appena oltre quel confine.
    //
    // Serve a tutto ciò che si allontana lateralmente dalla pista e non può
    // permettersi di scavalcare il tracciato vicino: il terrapieno (che
    // altrimenti copre cordolo e barriere dell'altro tratto) e la barriera
    // arretrata (che altrimenti si ritrova appoggiata sul terreno del vicino,
    // a un'altra quota, e ci affonda o ci fluttua sopra).
    //
    // Il confine cade sulla mezzeria fra i due tratti — ognuno tiene la metà
    // che gli è più vicina, come fa terrainHeightAt quando cerca il punto di
    // pista più vicino. Sulla semiretta P + N·r il punto equidistante da P e
    // da un punto estraneo Q si ricava in forma chiusa da |P + N·r − Q|² = r²,
    // cioè r = |PQ|² / (2 N·PQ): un prodotto scalare per candidato, niente
    // marcia a passi lungo la normale.
    //
    // `minDist` è il valore sotto cui il confine non scende mai (per il
    // terrapieno il bordo del cordolo, per la barriera la sua posizione
    // storica), `maxDist` quanto lontano ha senso guardare.
    function neighbourLimits(trackPts, minDist, maxDist) {
        const n = trackPts.length;
        const pos = new Float64Array(n).fill(maxDist);
        const neg = new Float64Array(n).fill(maxDist);
        const yPos = new Float64Array(n);
        const yNeg = new Float64Array(n);
        // Candidati di ogni campione, tenuti da parte: le quote di confine si
        // calcolano dopo il livellamento, sul confine definitivo.
        const viciniDi = new Array(n);
        if (n < 2) return { pos, neg, yPos, yNeg };

        const cum = new Float64Array(n);
        for (let i = 1; i < n; i++) {
            cum[i] = cum[i - 1] + Math.hypot(trackPts[i].x - trackPts[i - 1].x, trackPts[i].z - trackPts[i - 1].z);
        }
        const giro = cum[n - 1] + Math.hypot(trackPts[0].x - trackPts[n - 1].x, trackPts[0].z - trackPts[n - 1].z);

        // Griglia spaziale dei soli punti a terra: i tratti a ponte passano
        // SOPRA il terreno e non rivendicano niente — è proprio sotto un
        // cavalcavia che il prato deve continuare indisturbato.
        const cella = Math.max(1, maxDist);
        const chiave = (cx, cz) => cx + ',' + cz;
        const griglia = new Map();
        for (let i = 0; i < n; i++) {
            if (trackPts[i].bridge) continue;
            const k = chiave(Math.floor(trackPts[i].x / cella), Math.floor(trackPts[i].z / cella));
            const lista = griglia.get(k);
            if (lista) lista.push(i); else griglia.set(k, [i]);
        }

        // Oltre il doppio della portata la mezzeria cade comunque più in là
        // del limite (r ≥ |PQ|/2): quei punti non possono restringere niente.
        const portata = 2 * maxDist;
        const raggioCelle = Math.ceil(portata / cella);

        for (let i = 0; i < n; i++) {
            const p = trackPts[i];
            const { nx, nz } = normalAt(trackPts, i, true);
            const cx = Math.floor(p.x / cella), cz = Math.floor(p.z / cella);
            let limPos = maxDist, limNeg = maxDist;
            const vicini = [];

            for (let gx = cx - raggioCelle; gx <= cx + raggioCelle; gx++) {
                for (let gz = cz - raggioCelle; gz <= cz + raggioCelle; gz++) {
                    const lista = griglia.get(chiave(gx, gz));
                    if (!lista) continue;
                    for (const j of lista) {
                        let ds = Math.abs(cum[j] - cum[i]);
                        if (giro - ds < ds) ds = giro - ds;
                        if (ds < NEIGHBOUR_KIN_SPAN) continue;

                        const dx = trackPts[j].x - p.x, dz = trackPts[j].z - p.z;
                        const d2 = dx * dx + dz * dz;
                        if (d2 > portata * portata) continue;

                        vicini.push(j);
                        const proj = dx * nx + dz * nz;
                        if (proj > 1e-9) {
                            const r = d2 / (2 * proj);
                            if (r < limPos) limPos = r;
                        } else if (proj < -1e-9) {
                            const r = d2 / (-2 * proj);
                            if (r < limNeg) limNeg = r;
                        }
                    }
                }
            }

            pos[i] = Math.max(minDist, limPos);
            neg[i] = Math.max(minDist, limNeg);
            viciniDi[i] = vicini;
        }

        // ⚠️ Il confine NON va livellato lungo la pista. Provato il
        // 2026-08-12 con pendenza massima 1: livellare accorcia, e accorciare
        // dove il vicino non arriva lascia terreno che non disegna nessuno —
        // misurati 4 campioni scoperti su prova e 59 su new-monza, mentre il
        // difetto che doveva risolvere (la barriera coperta dal terrapieno di
        // fronte) restava identico. Il bordo resta a scalini, e va bene: i
        // salti cadono dove due tratti si contendono lo spazio, cioè dove a
        // coprire è comunque uno dei due.
        for (let i = 0; i < n; i++) {
            const p = trackPts[i];
            const { nx, nz } = normalAt(trackPts, i, true);
            const vicini = viciniDi[i];

            // A che quota riprende il terreno appena oltre il confine: la
            // quota PIÙ BASSA fra i campioni che se lo contendono, non quella
            // del campione che ha imposto il limite.
            //
            // Il caso che obbliga a fare così è il centro di un tornante: lì
            // convergono decine di campioni della stessa curva, tutti alla
            // stessa distanza esatta dal confine, e se la curva sale hanno
            // quote diverse fra loro. "Il più vicino" è allora una scelta a
            // caso fra pari merito, e sceglierne uno alto lascia scoperto il
            // dislivello verso quelli bassi.
            for (const [lato, lim] of [[1, pos[i]], [-1, neg[i]]]) {
                const bx = p.x + nx * lim * lato, bz = p.z + nz * lim * lato;
                let piuVicino = Infinity;
                for (const j of vicini) {
                    const d = (trackPts[j].x - bx) ** 2 + (trackPts[j].z - bz) ** 2;
                    if (d < piuVicino) piuVicino = d;
                }
                const soglia = (Math.sqrt(piuVicino) + NEIGHBOUR_TIE_MARGIN) ** 2;
                let quota = Infinity;
                for (const j of vicini) {
                    const d = (trackPts[j].x - bx) ** 2 + (trackPts[j].z - bz) ** 2;
                    if (d <= soglia) quota = Math.min(quota, trackPts[j].y || 0);
                }
                if (!isFinite(quota)) quota = 0;
                if (lato > 0) yPos[i] = quota; else yNeg[i] = quota;
            }
        }

        return { pos, neg, yPos, yNeg };
    }

    // Quota più alta a cui il terrapieno arriva sopra un punto vicino al
    // campione `i`, contando che i settori di campioni vicini si accavallano.
    //
    // Non è terrainHeightAt con un altro nome: quella risponde "che quota
    // AVREBBE il terreno qui" prendendo il campione più vicino, ed è la
    // superficie ideale; questa risponde "fin dove arriva il terreno
    // DISEGNATO", che dove due settori si sovrappongono è il più alto dei due.
    // Le due divergono in curva mentre la pista sale: lì il settore di un
    // campione più avanti, e più alto, passa sopra quello di uno più indietro.
    // Serve a posare la barriera sul terreno invece che sulla quota della
    // pista, se no in quei punti sparisce sotto terra.
    //
    // Si guardano solo i campioni "parenti": quelli di un altro tratto non
    // arrivano fin qui, perché neighbourLimits li ferma prima.
    // Un campione copre il punto solo col SUO settore, cioè la fascia fra la
    // sua normale e quella del campione successivo: il punto ci sta dentro
    // quando è davanti all'uno e dietro all'altro. Prendere invece tutti i
    // campioni entro il pianoro è troppo generoso — misurato, alzava la
    // barriera fino a 3.75 unità sopra il terreno in 179 campioni di prova,
    // scambiando un muro sepolto con un muro che fluttua.
    function terrainTopAt(trackPts, i, x, z, plateauEnd) {
        const n = trackPts.length;
        const avanzamento = (j) => {
            const t = tangentAt(trackPts, j, true);
            return (x - trackPts[j].x) * t.tx + (z - trackPts[j].z) * t.tz;
        };

        let top = null;
        for (const verso of [1, -1]) {
            let percorso = 0;
            for (let k = 0; k < n; k++) {
                const j = ((i + verso * k) % n + n) % n;
                const succ = (j + 1) % n;
                if (k > 0) {
                    const prec = ((i + verso * (k - 1)) % n + n) % n;
                    percorso += Math.hypot(trackPts[j].x - trackPts[prec].x, trackPts[j].z - trackPts[prec].z);
                    if (percorso > NEIGHBOUR_KIN_SPAN) break;
                }
                if (trackPts[j].bridge || trackPts[succ].bridge) continue;

                const a = avanzamento(j), b = avanzamento(succ);
                if (a < 0 || b > 0) continue;            // il punto non è in questo settore
                if (Math.hypot(trackPts[j].x - x, trackPts[j].z - z) > plateauEnd) continue;

                // Dove cade il punto dentro il settore, per interpolare le due
                // quote come fa la mesh, che fra un campione e l'altro tira
                // dritto.
                const t = (a - b) > 1e-9 ? a / (a - b) : 0;
                const y = (trackPts[j].y || 0) * (1 - t) + (trackPts[succ].y || 0) * t;
                if (top === null || y > top) top = y;
            }
        }
        return top === null ? (trackPts[i].y || 0) : top;
    }

    // Un oggetto scenico deve GUARDARE la pista che ha davvero davanti, cioè
    // stare perpendicolare al campione che gli è PIÙ VICINO. Non è la stessa
    // cosa di essere perpendicolare al campione da cui è stato costruito: dove
    // la pista fa un tornante le due branche si avvicinano, e un oggetto
    // posato per la prima si ritrova più vicino alla seconda.
    //
    // Il 2026-08-13, allungando le schiere di tribune da 6 a 8 moduli, su
    // `prova` una fila finiva con sette moduli a 45.8 dall'asse e l'ottavo a
    // 40.4 girato di 77°, e un'altra nasceva già storta di 37° perché il SEME
    // cadeva lì. Sono la "tribuna storta" e il "gradino nella fila" che i test
    // misurano: un solo modulo li produceva entrambi.
    //
    // 30° di default: gli oggetti sani deviano meno di 1°, e il caso limite
    // noto e accettato — il muro che gira più di quanto l'oggetto sia largo,
    // prova @412 — arriva a 18.5°. Separa i due mondi senza inseguire nessuno
    // dei due.
    const SCARTO_DALLA_PISTA_MAX = Math.PI / 6;

    function guardaVersoLaPista(trackPts, item, scartoMax) {
        const limite = scartoMax === undefined ? SCARTO_DALLA_PISTA_MAX : scartoMax;
        const q = nearestPoint(trackPts, item.x, item.z);
        const nrm = normalAt(trackPts, q.index, true);
        const lato = Math.sign((item.x - trackPts[q.index].x) * nrm.nx +
                               (item.z - trackPts[q.index].z) * nrm.nz) || 1;
        // Direzione che va dall'oggetto verso l'asse: è dove deve guardare.
        const verso = Math.atan2(-nrm.nx * lato, -nrm.nz * lato);
        let d = (item.rotY || 0) - verso;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) <= limite;
    }

    return {
        isInsideLoop,
        findCorners,
        CORNER_RADIUS_MAX,
        neighbourLimits,
        terrainTopAt,
        NEIGHBOUR_KIN_SPAN,
        sampleLoop,
        sampleOpenPath,
        lapLength,
        lapsForDistance,
        nearestIndexNear,
        nearestPoint,
        terrainHeightAt,
        splitByBridge,
        tangentAt,
        normalAt,
        ribbonFacingAt,
        curvatureAt,
        bridgeHeightAt,
        pitBoxAnchors,
        pitLaneSlots,
        // Serve a chi deve costruire una posizione scostata rispetto alla
        // griglia (il fronte della corsia sulle curve strette).
        pitSlotAt,
        guardaVersoLaPista,
        SCARTO_DALLA_PISTA_MAX,
        walkClosedLoop,
        advanceToDistance,
        advanceToDistancePoint,
        gridSpawnPoint,
        pointInOrientedBox,
        snapPitPathEnds,
        tuckPitEndsToTrack,
        pitLeadInPoints,
        PIT_STALL_CLEARANCE,
        // Esportata perche' i test (e chiunque misuri il fronte della corsia)
        // la leggano invece di ricopiarne il valore.
        PIT_BOX_SPACING,
        GRID_START, GRID_STAGGER, GRID_LANE_OFFSET
    };
});
