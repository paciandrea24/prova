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

    // Spaziatura reale (metri) tra un box giocatore e il successivo lungo la
    // corsia box — vedi frontend/shared/pitBoxLoader.js e
    // docs/superpowers/specs/2026-08-03-f1-pit-boxes-design.md. Si cammina
    // sulla SPEZZATA di pitPath (gli stessi punti di controllo grezzi usati
    // dall'autopilota server-side in f1GameSocket.js, non la curva
    // Catmull-Rom campionata usata per il rendering): backend e frontend
    // richiamano questa stessa funzione con gli stessi input, garantendo che
    // l'auto si fermi esattamente davanti al proprio box.
    // Valore misurato sul modello REALE renderizzato in gioco (non sul file
    // .glb grezzo): f1PitBox.glb ha ingombro grezzo ~6.2×6m in pianta, ma
    // pitBoxLoader.js applica un fattore 3.5x (stesso della macchina, vedi
    // loadCarModel) → ingombro reale in gioco ~21.7×21m. 8m (basato sul solo
    // file grezzo, prima di scoprire che serviva il fattore 3.5x) faceva
    // sovrapporre i box tra loro — verificato in playtest dall'utente.
    const PIT_BOX_SPACING = 24;

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
            angle: Math.atan2(ntx, ntz)
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
    function pitBoxAnchors(pitPath, boxIndex, count, trackPoints, pitRoadHalf) {
        const mid = (count - 1) / 2;
        const anchors = [];
        for (let i = 0; i < count; i++) {
            const offset = (i - mid) * PIT_BOX_SPACING;
            const { x, z, fromIdx, toIdx } = walkPitPath(pitPath, boxIndex, offset);
            const a = pitPath[fromIdx], b = pitPath[toIdx];
            const tx = b.x - a.x, tz = b.z - a.z;
            const tlen = Math.hypot(tx, tz) || 1;
            const ntx = tx / tlen, ntz = tz / tlen;
            const anchor = { x, z, tx: ntx, tz: ntz, fromIdx };

            if (trackPoints && pitRoadHalf != null) {
                const nx = -ntz, nz = ntx;   // normale, perpendicolare alla tangente
                const distPlus = nearestPoint(trackPoints, x + nx, z + nz).dist;
                const distMinus = nearestPoint(trackPoints, x - nx, z - nz).dist;
                const side = distPlus >= distMinus ? 1 : -1;
                const stallOffset = pitRoadHalf + PIT_STALL_CLEARANCE;
                anchor.stallX = x + nx * stallOffset * side;
                anchor.stallZ = z + nz * stallOffset * side;
            }

            anchors.push(anchor);
        }
        return anchors;
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

    return {
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
        pitBoxAnchors,
        walkClosedLoop,
        gridSpawnPoint,
        pointInOrientedBox,
        snapPitPathEnds,
        PIT_STALL_CLEARANCE,
        GRID_START, GRID_STAGGER, GRID_LANE_OFFSET
    };
});
