// frontend/shared/trackMeshBuilder.js
(function (root) {
    const TrackGeometry = root.TrackGeometry;
    // Quota del terreno collinare: stessa funzione usata da trackScenery per
    // piantarci sopra gli alberi dei boschi. Se le due divergessero, gli
    // alberi finirebbero sepolti o sospesi in aria.
    const SceneryHills = root.SceneryHills;

    // Colori delle superfici: fonte unica in toonPalette.js, così pista,
    // editor e banco prova non possono divergere (Rif. spec
    // 2026-08-10-f1-art-direction-cel-shading-design.md). Va caricato prima di
    // questo file in ogni pagina che lo usa.
    const Palette = root.ToonPalette;

    // Verde del prato: usato sia dal terrapieno sia dal prato con foro
    // (buildGround), per continuità visiva senza cuciture di colore tra i due.
    const GRASS_COLOR = Palette.SURFACES.grass;

    // Un singolo campione (o pochissimi di fila) "dentro" una fascia da
    // saltare (cordolo/varco) non basta per interrompere una linea o una
    // superficie: la curva del raccordo pista/corsia box
    // (TrackGeometry.tuckPitEndsToTrack) può attraversare per un attimo
    // una fascia durante la transizione senza restarci — un salto così
    // breve si vede come una rottura innaturale, non come una vera
    // sovrapposizione prolungata (Rif. richiesta utente 2026-08-08,
    // "discontinuità nella striscia" — misurato: 4-7 campioni isolati su
    // "prova", contro le decine di campioni di un varco vero). Riusata da
    // buildBarriers/buildCurbs/buildPitEdgeLine: un tratto "saltato" conta
    // solo se dura almeno minRun campioni consecutivi, altrimenti viene
    // ripristinato (non saltato).
    function suppressShortRuns(flags, minRun) {
        const n = flags.length;
        const out = flags.slice();
        let i = 0;
        while (i < n) {
            if (out[i]) {
                let j = i;
                while (j < n && out[j]) j++;
                if (j - i < minRun) for (let k = i; k < j; k++) out[k] = false;
                i = j;
            } else {
                i++;
            }
        }
        return out;
    }

    function buildRibbon(container, pts, halfW, material) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv  = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
            const p = pts[i];
            const y = (p.y || 0) + 0.02;
            const b = i * 6;
            pos[b]     = p.x + nx * halfW; pos[b + 1] = y; pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW; pos[b + 4] = y; pos[b + 5] = p.z - nz * halfW;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            const base = i * 2, next = ((i + 1) % n) * 2;
            idx.push(base, base + 1, next, next, base + 1, next + 1);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        container.add(mesh);
        return mesh;
    }

    function buildOpenRibbon(container, pts, halfW, material) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv  = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pts, i, false);
            const p = pts[i];
            const b = i * 6;
            pos[b]     = p.x + nx * halfW; pos[b + 1] = (p.y || 0) + 0.03; pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW; pos[b + 4] = (p.y || 0) + 0.03; pos[b + 5] = p.z - nz * halfW;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            if (i < n - 1) {
                const base = i * 2, next = (i + 1) * 2;
                idx.push(base, base + 1, next, next, base + 1, next + 1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        container.add(mesh);
        return mesh;
    }

    // Sotto questa distanza dai campioni vicino ai due estremi della corsia
    // box, il cordolo NON viene rimosso (a differenza della barriera: il
    // cordolo è piatto, non blocca nulla) ma RICOLORATO in grigio neutro
    // invece del solito rosso/bianco (Rif. richiesta utente 2026-08-08:
    // "togliere il cordolo... tanto c'è la corsia box"). Rimuovere la
    // GEOMETRIA (come per la barriera) lasciava un vero buco fino al
    // terrapieno più esterno (embankStart parte da roadHalf+curbW,
    // indipendente dalla corsia box): senza nulla a coprire lo spazio
    // lasciato dal cordolo, si vedeva il verde del terrapieno sfondare
    // nella pista — segnalato dall'utente con screenshot ("un pezzetto di
    // prato verde" a forma di cuneo). Ricolorare mantiene la stessa
    // copertura di sempre, senza bisogno di far combaciare esattamente
    // dove arriva davvero l'asfalto della corsia box (che curva ben più
    // stretta del cordolo vicino al punto di aggancio).
    const CURB_PIT_GAP_THRESHOLD = 8;
    const CURB_NEUTRAL_COLOR = Palette.SURFACES.curbNeutral;

    function buildCurbs(container, pts, roadHalf, curbW, mergePoints) {
        const n = pts.length;
        const stepLen = TrackGeometry.lapLength(pts) / n;
        const STRIPE = 10;

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let dist = 0, flip = false;
            const gapped = new Array(n).fill(false);
            const flipAt = new Array(n).fill(false);

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const y = (p.y || 0) + 0.04;
                const inner = roadHalf * side, outer = (roadHalf + curbW) * side;

                if (mergePoints) {
                    const mx = p.x + nx * outer, mz = p.z + nz * outer;
                    gapped[i] = TrackGeometry.nearestPoint(mergePoints, mx, mz).dist < CURB_PIT_GAP_THRESHOLD;
                }

                const b = i * 6;
                pos[b]     = p.x + nx * inner; pos[b + 1] = y; pos[b + 2] = p.z + nz * inner;
                pos[b + 3] = p.x + nx * outer; pos[b + 4] = y; pos[b + 5] = p.z + nz * outer;

                if (i > 0) { dist += stepLen; if (dist >= STRIPE) { dist = 0; flip = !flip; } }
                flipAt[i] = flip;

                const base = i * 2, nxt = ((i + 1) % n) * 2;
                idx.push(base, base + 1, nxt, nxt, base + 1, nxt + 1);
            }

            const gappedClean = mergePoints ? suppressShortRuns(gapped, CURB_MIN_GAP_RUN) : gapped;
            for (let i = 0; i < n; i++) {
                const cb = i * 6;
                if (gappedClean[i]) {
                    const [r, g, bv] = CURB_NEUTRAL_COLOR;
                    col[cb] = r; col[cb + 1] = g; col[cb + 2] = bv;
                    col[cb + 3] = r; col[cb + 4] = g; col[cb + 5] = bv;
                } else {
                    const r = 1, g = flipAt[i] ? 0 : 1, bv = flipAt[i] ? 0 : 1;
                    col[cb] = r; col[cb + 1] = g; col[cb + 2] = bv;
                    col[cb + 3] = r; col[cb + 4] = g; col[cb + 5] = bv;
                }
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
            mesh.receiveShadow = true;
            container.add(mesh);
        }
    }

    // Un varco "vero" (in prossimità di ingresso/uscita) dura tipicamente
    // decine di campioni; un contatto isolato di pochi campioni è quasi
    // sempre una coincidenza geometrica (la pista che torna vicina a un
    // punto qualunque della corsia box per un attimo, es. sull'altra corsia
    // di ingresso/uscita vicina — misurato su "prova", dove entrata e
    // uscita sono a soli ~99 campioni l'una dall'altra) — vedi
    // suppressShortRuns.
    const CURB_MIN_GAP_RUN = 6;

    // Sotto questa distanza dai campioni vicino ai due estremi della
    // corsia box (mergePoints — SOLO la finestra vicino a inizio/fine di
    // pitPts, non l'intero percorso, a cura del chiamante: vedi
    // frontend/f1.js::pitMergeSamples), niente barriera: varco automatico
    // in entrata E in uscita, senza bisogno di dati aggiuntivi in editor
    // (Rif. richiesta utente 2026-08-08). Un confronto contro tutta la
    // corsia box (versione precedente di questa funzione) apriva un varco
    // spurio ovunque il tracciato passi vicino a un punto QUALUNQUE della
    // corsia — anche a centinaia di metri dall'ingresso/uscita vero, es.
    // dove la pista corre vicino alla zona box/stalli — misurato: 139m di
    // varco indesiderato su "prova", segnalato dall'utente in playtest
    // come "varco troppo esteso". Soglia più bassa di un primo tentativo
    // (12): con la corsia box che ora "abbraccia" la curva vera vicino
    // agli estremi (TrackGeometry.tuckPitEndsToTrack) resta vicina alla
    // pista più a lungo, quindi una soglia uguale a prima avrebbe riaperto
    // un varco più esteso del necessario. DEVE però restare sopra la
    // distanza minima ESATTA barriera-corsia proprio nel punto vero di
    // aggancio — verificata analiticamente e su tutte le piste esistenti:
    // (CURB_W + 1.2 dalla barriera) + insetMargin (3, il margine di
    // TrackGeometry.snapPitPathEnds) = 2.8+1.2+3 = 7.0 costante, a
    // prescindere da roadHalfWidth. Una soglia di 6 (troppo bassa)
    // lasciava il varco chiuso ESATTAMENTE nel punto che più conta,
    // riaprendo la barriera proprio dove passa la corsia box (bug
    // riscontrato misurando la distanza reale prima di scegliere questo
    // valore, non a occhio).
    const BARRIER_PIT_GAP_THRESHOLD = 8;
    // Stessa idea di CURB_MIN_GAP_RUN: un contatto isolato di pochi
    // campioni non è un varco vero, vedi suppressShortRuns.
    const BARRIER_MIN_GAP_RUN = 6;

    function buildBarriers(container, pts, distFromCenter, mergePoints) {
        const n = pts.length;
        const HEIGHT = 1.1;
        const stepLen = TrackGeometry.lapLength(pts) / n;
        const STRIPE = 14;

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let stripeAcc = 0, isRed = false;
            const gapped = new Array(n).fill(false);

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const baseY = p.y || 0;
                const bx = p.x + nx * distFromCenter * side;
                const bz = p.z + nz * distFromCenter * side;

                if (mergePoints) gapped[i] = TrackGeometry.nearestPoint(mergePoints, bx, bz).dist < BARRIER_PIT_GAP_THRESHOLD;

                pos[i * 6]     = bx; pos[i * 6 + 1] = baseY + 0.05;   pos[i * 6 + 2] = bz;
                pos[i * 6 + 3] = bx; pos[i * 6 + 4] = baseY + HEIGHT; pos[i * 6 + 5] = bz;

                if (i > 0) { stripeAcc += stepLen; if (stripeAcc >= STRIPE) { stripeAcc = 0; isRed = !isRed; } }
                // Sui tratti ponte la barriera è un muro rigido lato server
                // (applyBridgeBarrier), non il solito fuoripista attraversabile:
                // bianco/arancione invece di bianco/rosso, stessa cadenza di
                // striping, per distinguerla a colpo d'occhio.
                let r, g, bv;
                if (p.bridge) { r = isRed ? 0.95 : 0.93; g = isRed ? 0.45 : 0.93; bv = isRed ? 0.05 : 0.96; }
                else          { r = isRed ? 0.85 : 0.93; g = isRed ? 0.10 : 0.93; bv = isRed ? 0.10 : 0.96; }
                col[i * 6] = r; col[i * 6 + 1] = g; col[i * 6 + 2] = bv;
                col[i * 6 + 3] = r; col[i * 6 + 4] = g; col[i * 6 + 5] = bv;
            }

            const gappedClean = mergePoints ? suppressShortRuns(gapped, BARRIER_MIN_GAP_RUN) : gapped;
            for (let i = 0; i < n; i++) {
                const nextI = (i + 1) % n;
                if (gappedClean[i] || gappedClean[nextI]) continue;   // varco: nessuna faccia vicino alla corsia box
                const base = i * 2, next = nextI * 2;
                if (side < 0) idx.push(base, base + 1, next, next, base + 1, next + 1);
                else          idx.push(base, next, base + 1, next, next + 1, base + 1);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                vertexColors: true, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide
            }));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            container.add(mesh);
        }
    }

    function buildStartLine(container, pts, roadHalf, startIndex = 0) {
        const p0 = pts[startIndex], p1 = pts[(startIndex + 1) % pts.length];
        const { nx, nz } = TrackGeometry.normalAt(pts, startIndex, true);

        const STRIPES = 10;
        const stripeW = (roadHalf * 2) / STRIPES;
        const dummy = new THREE.Object3D();
        const geoS  = new THREE.BoxGeometry(stripeW - 0.1, 0.02, 2.5);
        const matB  = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const matK  = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const imB   = new THREE.InstancedMesh(geoS, matB, STRIPES);
        const imK   = new THREE.InstancedMesh(geoS, matK, STRIPES);
        const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        let iB = 0, iK = 0;

        for (let s = 0; s < STRIPES; s++) {
            const off = -roadHalf + stripeW * s + stripeW / 2;
            dummy.position.set(p0.x + nx * off, (p0.y || 0) + 0.06, p0.z + nz * off);
            dummy.rotation.y = angle;
            dummy.updateMatrix();
            if (s % 2 === 0) imB.setMatrixAt(iB++, dummy.matrix);
            else              imK.setMatrixAt(iK++, dummy.matrix);
        }
        imB.count = iB; imK.count = iK;
        imB.instanceMatrix.needsUpdate = imK.instanceMatrix.needsUpdate = true;
        container.add(imB, imK);
    }

    // Dimensioni della "staffa" dipinta di ogni casella di griglia (Rif.
    // richiesta utente 2026-08-07, con foto di riferimento di una vera
    // griglia F1: NON un rettangolo pieno — una riga trasversale sul lato
    // ANTERIORE (dove si ferma il muso dell'auto) + due gambe laterali che
    // si estendono all'INDIETRO, aperta sul retro, nessuna riga di
    // chiusura). Leggermente più ampie dell'ingombro reale dell'auto
    // (CAR_HALF_WIDTH*2≈3.48, CAR_HALF_LENGTH*2≈7.16 —
    // backend/sockets/games/physics/CollisionResolver.js).
    const STARTING_GRID_BOX_WIDTH = 4;     // larghezza della riga trasversale / distanza tra le due gambe
    const STARTING_GRID_BOX_LENGTH = 8;    // quanto le gambe si estendono all'indietro dalla riga trasversale
    const STARTING_GRID_LINE_THICK = 0.35; // spessore delle righe (larghezza reale di una vernice da pista)

    // Disegna le MAX_GRID_SIZE caselle della griglia di partenza vera,
    // permanenti sulla pista (non legate a un giocatore specifico — a
    // differenza dei box pit-lane, qui la posizione conta, non chi la
    // occupa in questa gara). Usa TrackGeometry.gridSpawnPoint, la STESSA
    // funzione che calcola davvero dove spawna ogni auto (server e client
    // condividono la formula): nessun rischio che il disegno diverga dalla
    // posizione reale. maxGridSize deve restare in sync con
    // f1Bot.js::MAX_GRID_SIZE (valore di gioco, non geometrico — per
    // questo non è stato spostato nel modulo condiviso).
    //
    // Ogni casella è un THREE.Group di 3 listelli sottili in coordinate
    // LOCALI (rotation.y = spot.angle allinea +Z locale al senso di
    // marcia, stessa convenzione di rotation.y = p.angle per le auto —
    // vedi frontend/f1.js): riga trasversale a z=+L/2 (fronte, dove si
    // ferma il muso), due gambe a x=∓W/2 che vanno da z=+L/2 a z=-L/2
    // (indietro) — nessun listello a z=-L/2 di chiusura, la staffa resta
    // aperta sul retro come nella foto di riferimento.
    function buildStartingGrid(container, points, startFinishIndex, maxGridSize) {
        const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
        const halfW = STARTING_GRID_BOX_WIDTH / 2;
        const L = STARTING_GRID_BOX_LENGTH;
        const thick = STARTING_GRID_LINE_THICK;

        for (let i = 0; i < maxGridSize; i++) {
            const spot = TrackGeometry.gridSpawnPoint(points, startFinishIndex, i);
            const group = new THREE.Group();
            group.position.set(spot.x, 0.04, spot.z);
            group.rotation.y = spot.angle;

            const frontLine = new THREE.Mesh(
                new THREE.BoxGeometry(STARTING_GRID_BOX_WIDTH + thick, 0.03, thick), material
            );
            frontLine.position.set(0, 0, L / 2);
            group.add(frontLine);

            for (const side of [-1, 1]) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(thick, 0.03, L), material);
                leg.position.set(side * halfW, 0, 0);
                group.add(leg);
            }

            container.add(group);
        }
    }

    // Profondità (dal bordo pitRoadHalf verso l'esterno) dell'asfalto
    // aggiuntivo per la zona stalli (Rif. richiesta utente 2026-08-07: "ci
    // deve essere l'asfalto anche negli stalli", segnalato dopo aver visto
    // erba verde sotto ai box spostati più indietro nel round precedente).
    // Copre lo stallo per intero (centrato a pitRoadHalf+PIT_STALL_CLEARANCE
    // =10, largo STALL_WIDTH=5 → arriva fino a 12.5) con un margine di
    // sicurezza — vedi TrackGeometry.PIT_STALL_CLEARANCE/PitBoxLoader.STALL_WIDTH.
    const PIT_STALL_APRON_DEPTH = 15;

    // Larghezza della linea bianca continua che segna il bordo tra la
    // corsia condivisa e la zona stalli (Rif. richiesta utente 2026-08-07:
    // "linee di demarcazione... in modo da far capire qual è la strada
    // dritta comune a tutti nei box" — stile vera corsia box F1, dove la
    // linea bianca separa la "fast lane" dalla zona box).
    const PIT_LANE_DIVIDER_WIDTH = 0.4;

    // Striscia asimmetrica (a differenza di buildOpenRibbon, che è sempre
    // centrata sul percorso): da innerOffset a outerOffset dalla linea
    // centrale, SOLO sul lato dove stanno davvero i box (quello più lontano
    // dal tracciato principale — stessa tecnica "outward" già usata da
    // frontend/f1.js::loadPlayerPitBox e da TrackGeometry.pitBoxAnchors per
    // lo stallo). Determinato punto per punto (non una volta sola per tutta
    // la corsia box) per restare corretto anche se la corsia box curva
    // rispetto al tracciato principale. Riusata sia per l'asfalto della
    // zona stalli (buildPitLane) sia per la linea bianca di demarcazione
    // (stesso identico calcolo di lato/orientamento, solo offset diversi).
    function buildPitSideStrip(container, pitPts, innerOffset, outerOffset, trackPts, material, yOffset = 0.03) {
        const n = pitPts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pitPts, i, false);
            const p = pitPts[i];
            const y = (p.y || 0) + yOffset;

            const distPlus = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;

            const innerX = p.x + nx * innerOffset * side, innerZ = p.z + nz * innerOffset * side;
            const outerX = p.x + nx * outerOffset * side, outerZ = p.z + nz * outerOffset * side;

            const b = i * 6;
            pos[b] = innerX; pos[b + 1] = y; pos[b + 2] = innerZ;
            pos[b + 3] = outerX; pos[b + 4] = y; pos[b + 5] = outerZ;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            if (i < n - 1) {
                const base = i * 2, next = (i + 1) * 2;
                idx.push(base, base + 1, next, next, base + 1, next + 1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        container.add(mesh);
        return mesh;
    }

    // Lunghezza (unità d'arco) su cui il colore della corsia box sfuma
    // verso il colore della pista vera, ai due estremi: i punti 0/ultimo
    // sono ora agganciati esattamente al bordo pista
    // (TrackGeometry.snapPitPathEnds, applicata dal chiamante), quindi qui
    // è dove il nastro si confonde fisiologicamente con l'asfalto
    // principale — la sfumatura rende quella sovrapposizione invisibile
    // invece che un cambio di colore netto (Rif. richiesta utente
    // 2026-08-08).
    const PIT_MERGE_BLEND_LENGTH = 15;
    const PIT_COLOR = Palette.SURFACES.pitLane;

    // Come buildOpenRibbon, ma con vertex color che sfuma da PIT_COLOR al
    // colore pista (trackColorHex) negli ultimi/primi PIT_MERGE_BLEND_LENGTH
    // unità d'arco. cumDist calcolato per SOMMA DIRETTA dei segmenti (non
    // TrackGeometry.lapLength, che è per anelli CHIUSI: su un percorso
    // aperto come pitPts aggiungerebbe anche il segmento fittizio di
    // chiusura tra ultimo e primo punto, enorme qui, sballando la stima).
    function buildPitRibbon(container, pts, halfW, trackColorHex) {
        const n = pts.length;
        const cumDist = [0];
        for (let i = 1; i < n; i++) {
            cumDist.push(cumDist[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        }
        const totalLen = cumDist[n - 1];
        const pitColor = new THREE.Color(PIT_COLOR);
        const trackColor = new THREE.Color(trackColorHex);

        const pos = new Float32Array(n * 2 * 3);
        const col = new Float32Array(n * 2 * 3);
        const uv = new Float32Array(n * 2 * 2);
        const idx = [];

        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pts, i, false);
            const p = pts[i];
            const b = i * 6;
            pos[b] = p.x + nx * halfW; pos[b + 1] = (p.y || 0) + 0.03; pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW; pos[b + 4] = (p.y || 0) + 0.03; pos[b + 5] = p.z - nz * halfW;

            const distFromStart = cumDist[i];
            const distFromEnd = totalLen - cumDist[i];
            const blendT = 1 - Math.min(1, Math.min(distFromStart, distFromEnd) / PIT_MERGE_BLEND_LENGTH);
            const c = pitColor.clone().lerp(trackColor, blendT);
            const cb = i * 6;
            col[cb] = c.r; col[cb + 1] = c.g; col[cb + 2] = c.b;
            col[cb + 3] = c.r; col[cb + 4] = c.g; col[cb + 5] = c.b;

            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;

            if (i < n - 1) {
                const base = i * 2, next = (i + 1) * 2;
                idx.push(base, base + 1, next, next, base + 1, next + 1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
        mesh.receiveShadow = true;
        container.add(mesh);
        return mesh;
    }

    // Nastro sottile a offset FISSO dalla linea centrale (non "verso il lato
    // più lontano dalla pista" come buildPitSideStrip: qui serve tracciare
    // letteralmente i due bordi geometrici della corsia box, indipendenti
    // da dove sta la pista vera). Due chiamate (offset positivo/negativo)
    // disegnano le due linee laterali continue. skipTest(x,z) (opzionale):
    // se true per un campione, la linea si interrompe lì — usato per non
    // disegnare sopra il cordolo rosso/bianco (Rif. richiesta utente
    // 2026-08-08).
    function buildPitEdgeLine(container, pts, offset, halfLineWidth, material, skipTest) {
        const n = pts.length;
        const pos = new Float32Array(n * 2 * 3);
        const uv = new Float32Array(n * 2 * 2);
        const idx = [];
        const skipped = new Array(n).fill(false);
        for (let i = 0; i < n; i++) {
            const { nx, nz } = TrackGeometry.normalAt(pts, i, false);
            const p = pts[i];
            const y = (p.y || 0) + 0.04;
            const innerOff = offset - halfLineWidth, outerOff = offset + halfLineWidth;
            if (skipTest) skipped[i] = skipTest(p.x + nx * offset, p.z + nz * offset);
            const b = i * 6;
            pos[b] = p.x + nx * innerOff; pos[b + 1] = y; pos[b + 2] = p.z + nz * innerOff;
            pos[b + 3] = p.x + nx * outerOff; pos[b + 4] = y; pos[b + 5] = p.z + nz * outerOff;
            const u = i / (n - 1);
            const ub = i * 4;
            uv[ub] = 0; uv[ub + 1] = u; uv[ub + 2] = 1; uv[ub + 3] = u;
        }
        const skippedClean = skipTest ? suppressShortRuns(skipped, PIT_EDGE_MIN_SKIP_RUN) : skipped;
        for (let i = 0; i < n - 1; i++) {
            if (skippedClean[i] || skippedClean[i + 1]) continue;
            const base = i * 2, next = (i + 1) * 2;
            idx.push(base, base + 1, next, next, base + 1, next + 1);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        container.add(mesh);
    }

    // Stessa idea di CURB_MIN_GAP_RUN/BARRIER_MIN_GAP_RUN: durante la
    // transizione del raccordo la linea può attraversare la fascia del
    // cordolo per pochissimi campioni e uscirne subito (misurato: 4
    // campioni su "prova") — troppo breve per essere una vera
    // sovrapposizione, si vedrebbe solo come una rottura innaturale della
    // riga (Rif. richiesta utente 2026-08-08, "discontinuità nella
    // striscia"). Vedi suppressShortRuns.
    const PIT_EDGE_MIN_SKIP_RUN = 6;

    // Due linee bianche continue lungo TUTTI e due i bordi della corsia box
    // (a ±pitRoadHalf dalla linea centrale), per l'intera lunghezza —
    // comprese le zone di raccordo dove il colore sfuma verso quello della
    // pista vera (buildPitRibbon sopra): restano visibili esattamente dove
    // servono di più, per riconoscere la corsia box anche lì (Rif.
    // richiesta utente 2026-08-08).
    // curbBand (opzionale, {roadHalf, curbW, trackPts}): se presente,
    // qualunque campione delle due linee che cade nella fascia del
    // cordolo (tra roadHalf e roadHalf+curbW dal centro pista) viene
    // saltato — evita che la striscia bianca "allungata"
    // (TrackGeometry.pitLeadInPoints) si sovrapponga al cordolo
    // rosso/bianco nella zona di preavviso (Rif. richiesta utente
    // 2026-08-08: "rimuoverla dal lato della sovrapposizione").
    const PIT_EDGE_LINE_WIDTH = 0.35;
    function buildPitEdgeLines(container, pitPts, pitRoadHalf, curbBand) {
        const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
        let skipTest = null;
        if (curbBand) {
            skipTest = (x, z) => {
                const d = TrackGeometry.nearestPoint(curbBand.trackPts, x, z).dist;
                return d > curbBand.roadHalf && d < curbBand.roadHalf + curbBand.curbW;
            };
        }
        buildPitEdgeLine(container, pitPts, pitRoadHalf, PIT_EDGE_LINE_WIDTH / 2, material, skipTest);
        buildPitEdgeLine(container, pitPts, -pitRoadHalf, PIT_EDGE_LINE_WIDTH / 2, material, skipTest);
    }

    // pitControlPoints: punti di controllo GREZZI (non campionati) della
    // corsia box, presi da pit.path del JSON — attesi GIÀ agganciati al
    // bordo pista (TrackGeometry.snapPitPathEnds, a cura del chiamante).
    // drawBoxMarker (default true): il riquadro giallo semitrasparente su
    // pitBoxIndex era il SOLO indicatore visivo del box quando era un
    // punto unico condiviso da tutti i piloti. Ora ogni pilota ha il
    // proprio box 3D colorato (vedi frontend/f1.js, loadPlayerPitBox), reso
    // in gara nel punto vero — il riquadro lì diventerebbe fuorviante
    // (quasi nessun pilota si ferma davvero lì). Resta utile SOLO
    // nell'editor tracciato (track-editor.js), per vedere dove sta
    // pitBoxIndex mentre lo si modifica: da lì la chiamata resta col
    // default true, invariata.
    // trackPts (opzionale, retrocompatibile): punti campionati del
    // tracciato principale, servono SOLO per l'asfalto aggiuntivo della
    // zona stalli (buildPitApron) — senza, il comportamento resta identico
    // a prima (solo la corsia normale, nessun apron).
    // trackColorHex (default: l asfalto della palette, lo stesso colore usato da
    // f1.js/track-editor.js per buildRibbon): colore verso cui sfuma il
    // raccordo (buildPitRibbon sopra). Il raccordo "abbraccia" la
    // curvatura vera della pista vicino agli estremi invece di tagliare a
    // un angolo indipendente da essa (TrackGeometry.tuckPitEndsToTrack, sul
    // suo default di taperLength — stessa unica fonte di verità riusata
    // anche da f1.js per il varco barriera, Rif. richiesta utente
    // 2026-08-08 con riferimento visivo disegnato a mano).
    // Quanto (unità d'arco) le due linee laterali bianche si estendono SULLA
    // PISTA VERA oltre il vero punto di aggancio — solo le linee, non
    // l'asfalto della corsia box né la linea di fine corsia (quella resta
    // al vero punto, invariata): un preavviso visivo, per far vedere al
    // giocatore la "corsia" mentre sta ancora correndo normalmente, prima
    // di dover davvero sterzare (Rif. richiesta utente 2026-08-08: "capire
    // subito che devono spostarsi verso quella corsia").
    const PIT_EDGE_LEAD_LENGTH = 60;
    // roadHalf/curbWidth (opzionali, solo se trackPts è presente): servono
    // SOLO a non disegnare la striscia laterale "allungata" sopra il
    // cordolo rosso/bianco (curbBand in buildPitEdgeLines) — senza,
    // comportamento identico a prima (nessun taglio).
    function buildPitLane(container, pitControlPoints, pitRoadHalf, pitBoxIndex, drawBoxMarker = true, trackPts, trackColorHex = Palette.SURFACES.asphalt, roadHalf, curbWidth = 2.8) {
        const pitPtsRaw = TrackGeometry.sampleOpenPath(pitControlPoints, 300);
        const pitPts = trackPts ? TrackGeometry.tuckPitEndsToTrack(pitPtsRaw, trackPts) : pitPtsRaw;
        const curbBand = (trackPts && roadHalf != null) ? { trackPts, roadHalf, curbW: curbWidth } : null;

        buildPitRibbon(container, pitPts, pitRoadHalf, trackColorHex);
        if (trackPts) {
            // Le linee laterali usano un array PIÙ LUNGO di pitPts (punti
            // aggiuntivi sulla pista vera prima dell'ingresso/dopo
            // l'uscita) — solo per queste due linee, l'asfalto e la linea
            // di fine corsia (addLine più sotto) restano su pitPts, invariati.
            const entryLead = TrackGeometry.pitLeadInPoints(pitPts, trackPts, 0, 1, PIT_EDGE_LEAD_LENGTH).reverse();
            const exitLead = TrackGeometry.pitLeadInPoints(pitPts, trackPts, pitPts.length - 1, -1, PIT_EDGE_LEAD_LENGTH);
            buildPitEdgeLines(container, [...entryLead, ...pitPts, ...exitLead], pitRoadHalf, curbBand);
        } else {
            buildPitEdgeLines(container, pitPts, pitRoadHalf);
        }

        if (trackPts) {
            buildPitSideStrip(container, pitPts, pitRoadHalf, pitRoadHalf + PIT_STALL_APRON_DEPTH, trackPts, new THREE.MeshStandardMaterial({
                color: 0x3a3a3a, roughness: 0.95, side: THREE.DoubleSide
            }));
            // Linea bianca continua sul bordo esatto tra corsia condivisa e
            // zona stalli: metà sul lato corsia (dentro l'asfalto della
            // corridoio, y=0.03) e metà sul lato apron (anch'esso y=0.03) —
            // yOffset più alto (0.04, stesso livello già usato da addLine/
            // dal vecchio riquadro box più sotto in questo file) per non
            // finire in z-fighting con l'asfalto sottostante su cui è
            // parzialmente sovrapposta.
            buildPitSideStrip(
                container, pitPts,
                pitRoadHalf - PIT_LANE_DIVIDER_WIDTH / 2, pitRoadHalf + PIT_LANE_DIVIDER_WIDTH / 2,
                trackPts, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
                0.04
            );
        }

        if (drawBoxMarker) {
            const boxPos = pitControlPoints[pitBoxIndex];
            const boxMesh = new THREE.Mesh(
                new THREE.BoxGeometry(pitRoadHalf * 1.7, 0.03, 15),
                new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.9, transparent: true, opacity: 0.55 })
            );
            boxMesh.position.set(boxPos.x, 0.04, boxPos.z);
            container.add(boxMesh);
        }

        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        function addLine(pt, dirPt) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(pitRoadHalf * 2, 0.03, 1), lineMat);
            line.position.set(pt.x, 0.045, pt.z);
            line.rotation.y = Math.atan2(dirPt.x - pt.x, dirPt.z - pt.z);
            container.add(line);
        }
        // Linee esattamente al vero punto di raccordo (campione 0 e
        // campione finale di pitPts): con pitControlPoints già agganciato
        // da TrackGeometry.snapPitPathEnds (a cura del chiamante), questi
        // DUE campioni coincidono col bordo pista — non più un 5%/95%
        // arbitrario (Rif. richiesta utente 2026-08-08).
        addLine(pitPts[0], pitPts[1]);
        addLine(pitPts[pitPts.length - 1], pitPts[pitPts.length - 2]);
    }

    // Terrapieno: alcuni anelli concentrici tra embankStart ed embankOuter,
    // quota di ogni anello sfumata dalla quota pista (anello più interno) a 0
    // (anello più esterno) con lo stesso smoothstep di
    // TrackGeometry.terrainHeightAt — qui calcolato direttamente sull'indice
    // e l'anello (non con una ricerca nearestPoint) perché in fase di
    // costruzione si conosce già esattamente la distanza dal centro pista
    // (il raggio dell'anello stesso): più economico, stesso risultato.
    const EMBANKMENT_RING_COUNT = 4;

    // Costruita per spezzone (TrackGeometry.splitByBridge), non più come un
    // unico anello chiuso: un ponte non genera terrapieno (lo spezzone a
    // terra semplicemente si interrompe lì, il vuoto è dove vanno impalcato
    // e piloni di buildBridgeDecks). Se non c'è nessun punto ponte,
    // splitByBridge restituisce un solo spezzone chiuso con tutti gli
    // indici in ordine: il risultato è identico, byte per byte, alla
    // versione precedente (nessuna regressione sulle piste esistenti).
    function buildEmbankment(container, trackPts, embankStart, embankOuter) {
        const ringCount = EMBANKMENT_RING_COUNT;
        const material = new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: 1, metalness: 0, side: THREE.DoubleSide });
        const { groundRuns } = TrackGeometry.splitByBridge(trackPts);

        for (const run of groundRuns) {
            const indices = run.indices;
            const m = indices.length;
            if (m < 2) continue; // spezzone troppo corto per generare una mesh

            for (const side of [-1, 1]) {
                const pos = new Float32Array(m * ringCount * 3);

                for (let k = 0; k < m; k++) {
                    const i = indices[k];
                    const { nx, nz } = TrackGeometry.normalAt(trackPts, i, run.closed);
                    const p = trackPts[i];
                    const baseY = p.y || 0;

                    for (let j = 0; j < ringCount; j++) {
                        const t = j / (ringCount - 1);
                        const te = t * t * (3 - 2 * t);
                        const r = embankStart + (embankOuter - embankStart) * t;
                        const y = baseY + (0 - baseY) * te;
                        const vb = (k * ringCount + j) * 3;
                        pos[vb]     = p.x + nx * r * side;
                        pos[vb + 1] = y;
                        pos[vb + 2] = p.z + nz * r * side;
                    }
                }

                const idx = [];
                const segCount = run.closed ? m : m - 1;
                for (let k = 0; k < segCount; k++) {
                    const kNext = (k + 1) % m;
                    for (let j = 0; j < ringCount - 1; j++) {
                        const a = k * ringCount + j;
                        const b = k * ringCount + j + 1;
                        const c = kNext * ringCount + j;
                        const d = kNext * ringCount + j + 1;
                        if (side > 0) idx.push(a, c, b, c, d, b);
                        else          idx.push(a, b, c, c, b, d);
                    }
                }

                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
                geo.setIndex(idx);
                geo.computeVertexNormals();
                const mesh = new THREE.Mesh(geo, material);
                mesh.receiveShadow = true;
                container.add(mesh);
            }
        }
    }

    // Dimensione lato di una cella della griglia prato: abbastanza piccola
    // da seguire bene il contorno del terrapieno, abbastanza grande da
    // restare economica su un tracciato grande.
    const GROUND_GRID_CELL = 20;
    // Griglia delle colline dell'orizzonte: maglia grossa (stanno a centinaia
    // di unità dalla camera, il dettaglio non si legge) ed estesa ben oltre il
    // prato, che si ferma a ~80 unità dal circuito — troppo presto perché i
    // rilievi, che iniziano a 180, cadessero dentro la griglia.
    // HILL_REACH copre il raggio in cui SceneryHills sale al massimo
    // (75 di attesa + 230 di rampa) più un margine di pianoro in cima.
    //
    // Maglia scesa da 80 a 50 il 2026-08-10, insieme all'innalzamento delle
    // colline. Le celle sono piatte con pareti verticali fra l'una e l'altra —
    // servono, senza si vede attraverso il terreno — quindi il dislivello fra
    // celle vicine È il gradino che si vede. A quota 55 era discreto; a quota
    // 120-190 diventava un terrazzamento, ed è così che l'utente l'ha
    // descritto: "un cerchio di mura verdi a scaloni". Misurato: il gradino
    // medio passa da 3.3 a 2.2 unità e il peggiore da 13.5 a 8.6.
    // Il costo è ~2.5 volte le celle (da ~840 a ~2150, sotto i 20k triangoli):
    // scendere a 40 avrebbe guadagnato altre 0.4 unità di gradino per il 60%
    // di celle in più, che non vale.
    const HILL_GRID_CELL = 50;
    const HILL_REACH = 700;

    // Prato "vicino": una griglia di quad, tenuti solo se il centro è oltre
    // embankOuter dal punto a terra (non-ponte) più vicino. A differenza del
    // precedente poligono con foro (rimosso), un test per cella non può mai
    // autointersecarsi — anche quando la pista passa vicino a se stessa (un
    // vero ponte/sovrappasso), che invece rompeva la triangolazione del
    // poligono (macchia/fessura segnalata dall'utente subito dopo la fine
    // del tratto ponte su "prova"). Nessuna classificazione "dentro/fuori"
    // necessaria: infield ed esterno sono trattati allo stesso modo, un
    // semplice test di distanza.
    // Prato "lontano": un unico piano piatto senza fori, abbastanza lontano
    // dalla griglia da non potersi mai sovrapporre al terrapieno o tagliare
    // una discesa.
    function buildGround(container, trackPts, embankOuter, worldSize) {
        const groundPts = trackPts.filter(p => !p.bridge);
        const material = new THREE.MeshStandardMaterial({
            color: GRASS_COLOR, roughness: 1, metalness: 0, side: THREE.DoubleSide
        });

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of trackPts) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        const pad = embankOuter + GROUND_GRID_CELL;
        minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

        const cols = Math.ceil((maxX - minX) / GROUND_GRID_CELL);
        const rows = Math.ceil((maxZ - minZ) / GROUND_GRID_CELL);
        const pos = [];
        const idx = [];

        // Emette una cella: piano superiore + i fianchi verso le vicine più
        // basse. I fianchi non sono decorativi — senza, due celle a quote
        // diverse lasciano una fessura verticale da cui si vede attraverso il
        // terreno.
        function emitCell(x0, z0, size, y, neighbourY) {
            const x1 = x0 + size, z1 = z0 + size;
            let base = pos.length / 3;
            pos.push(x0, y, z0,  x1, y, z0,  x1, y, z1,  x0, y, z1);
            idx.push(base, base + 1, base + 2,  base, base + 2, base + 3);
            if (y <= 0) return;

            const sides = [
                { d: 0, ax: x0, az: z0, bx: x1, bz: z0 },
                { d: 1, ax: x1, az: z0, bx: x1, bz: z1 },
                { d: 2, ax: x1, az: z1, bx: x0, bz: z1 },
                { d: 3, ax: x0, az: z1, bx: x0, bz: z0 },
            ];
            for (const s of sides) {
                const ny = neighbourY(s.d);
                if (ny >= y - 0.01) continue;   // vicina più alta o pari: nessuna fessura
                base = pos.length / 3;
                pos.push(s.ax, y, s.az,  s.bx, y, s.bz,  s.bx, ny, s.bz,  s.ax, ny, s.az);
                idx.push(base, base + 1, base + 2,  base, base + 2, base + 3);
            }
        }

        // Prima passata: quota di ogni cella tenuta. Serve completa PRIMA di
        // emettere la geometria, perché le pareti verticali di una cella si
        // dimensionano sulla quota delle vicine.
        const cellY = new Map();
        const key = (cx, cz) => cx + ',' + cz;
        for (let cx = 0; cx < cols; cx++) {
            for (let cz = 0; cz < rows; cz++) {
                const x0 = minX + cx * GROUND_GRID_CELL, x1 = x0 + GROUND_GRID_CELL;
                const z0 = minZ + cz * GROUND_GRID_CELL, z1 = z0 + GROUND_GRID_CELL;
                const cxCenter = (x0 + x1) / 2, czCenter = (z0 + z1) / 2;
                // Leggermente aggressivo (embankOuter - metà cella): meglio
                // una cella che sovrappone un po' il terrapieno (stesso
                // colore, invisibile) che una fessura scoperta al bordo per
                // colpa della risoluzione della griglia.
                const d = TrackGeometry.nearestPoint(groundPts, cxCenter, czCenter).dist;
                if (d < embankOuter - GROUND_GRID_CELL / 2) continue;
                cellY.set(key(cx, cz),
                          SceneryHills ? SceneryHills.hillHeightAt(cxCenter, czCenter, d, embankOuter,
                              TrackGeometry.isInsideLoop(groundPts, cxCenter, czCenter)) : 0);
            }
        }

        // Seconda passata: piano superiore della cella + pareti verticali
        // verso le vicine più basse. Il risultato è un rilievo a gradoni —
        // coerente con l'estetica voxel del progetto — e resta UNA sola mesh
        // come il prato piatto di prima: nessuna draw call in più.
        //
        // Le pareti non sono un dettaglio: due celle a quote diverse senza il
        // fianco che le raccorda lasciano una fessura verticale da cui si vede
        // attraverso il terreno.
        const NB = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for (const entry of cellY) {
            const parts = entry[0].split(',');
            const cx = Number(parts[0]), cz = Number(parts[1]);
            emitCell(minX + cx * GROUND_GRID_CELL, minZ + cz * GROUND_GRID_CELL,
                     GROUND_GRID_CELL, entry[1], (d) => {
                         const nk = key(cx + NB[d][0], cz + NB[d][1]);
                         return cellY.has(nk) ? cellY.get(nk) : 0;
                     });
        }

        // --- Colline dell'orizzonte ---------------------------------------
        // Seconda griglia, a maglia GROSSA, oltre il rettangolo del prato.
        //
        // Serve perché il prato qui sopra si estende solo `pad` unità oltre il
        // circuito (embankOuter + 20 = 80 su tutti i tracciati esistenti),
        // mentre i rilievi di SceneryHills iniziano a embankOuter + 120 = 180:
        // le colline cadevano tutte FUORI dalla griglia e non venivano
        // disegnate affatto — l'orizzonte restava la distesa piatta segnalata
        // dall'utente, e il rilievo non è mai comparso in gioco. Misurato: 69
        // celle in quota su 1710, tutte nell'infield.
        //
        // Maglia di 80 e non 20 perché queste celle stanno a centinaia di
        // unità dalla camera: a quella distanza il dettaglio fine non si legge
        // e costerebbe 12 volte i vertici (10506 celle contro 841). Restano
        // nella STESSA BufferGeometry del prato, quindi nessuna draw call in
        // più.
        if (SceneryHills) {
            const hillCellY = new Map();
            const hCols = Math.ceil((maxX - minX + 2 * HILL_REACH) / HILL_GRID_CELL);
            const hRows = Math.ceil((maxZ - minZ + 2 * HILL_REACH) / HILL_GRID_CELL);
            const hMinX = minX - HILL_REACH, hMinZ = minZ - HILL_REACH;

            for (let cx = 0; cx < hCols; cx++) {
                for (let cz = 0; cz < hRows; cz++) {
                    const x0 = hMinX + cx * HILL_GRID_CELL, z0 = hMinZ + cz * HILL_GRID_CELL;
                    const xc = x0 + HILL_GRID_CELL / 2, zc = z0 + HILL_GRID_CELL / 2;
                    // Salta ciò che il prato fine copre già: due superfici
                    // complanari nello stesso punto darebbero z-fighting.
                    if (xc > minX && xc < maxX && zc > minZ && zc < maxZ) continue;
                    const d = TrackGeometry.nearestPoint(groundPts, xc, zc).dist;
                    hillCellY.set(key(cx, cz), SceneryHills.hillHeightAt(xc, zc, d, embankOuter,
                        TrackGeometry.isInsideLoop(groundPts, xc, zc)));
                }
            }

            for (const entry of hillCellY) {
                const parts = entry[0].split(',');
                const cx = Number(parts[0]), cz = Number(parts[1]);
                emitCell(hMinX + cx * HILL_GRID_CELL, hMinZ + cz * HILL_GRID_CELL,
                         HILL_GRID_CELL, entry[1], (dir) => {
                             const nk = key(cx + NB[dir][0], cz + NB[dir][1]);
                             return hillCellY.has(nk) ? hillCellY.get(nk) : 0;
                         });
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const grid = new THREE.Mesh(geo, material);
        grid.receiveShadow = true;
        container.add(grid);

        const farGeo = new THREE.PlaneGeometry(worldSize, worldSize);
        const far = new THREE.Mesh(farGeo, material);
        far.rotation.x = -Math.PI / 2;
        // Leggermente sotto la griglia (a y=0): la griglia resta sempre
        // sopra al bordo della propria estensione, niente z-fighting.
        far.position.y = -0.01;
        far.receiveShadow = true;
        container.add(far);
    }

    const BRIDGE_COLOR = Palette.SURFACES.bridge;
    const BRIDGE_DECK_DROP      = 1.5;  // unità sotto la quota pista: dà l'idea di uno spessore strutturale
    const BRIDGE_DECK_THICK     = 1.0;  // spessore dell'impalcato: solo per calcolare da dove partono i piloni
    const BRIDGE_PILLAR_SPACING = 18;   // unità d'arco tra un pilone e il successivo
    const BRIDGE_PILLAR_RADIUS  = 1.2;
    const BRIDGE_PILLAR_MIN_HEIGHT = 0.5; // sotto questa altezza, niente pilone (evita geometria degenere)
    // Il confronto con embankStart da solo escludeva solo il centro del
    // pilone: un centro appena oltre embankStart aveva comunque il corpo
    // cilindrico (raggio BRIDGE_PILLAR_RADIUS) che sconfinava indietro su
    // cordolo/barriera (segnalato dall'utente: pilone ancora visibile sopra
    // il cordolo). Il margine copre lo spazio cordolo->barriera (1.2) più
    // il raggio del pilone, con un margine di sicurezza.
    const BRIDGE_PILLAR_CLEARANCE = 4;

    // Impalcato (lastra sottile sotto il nastro pista, riusando buildOpenRibbon
    // già esistente) + piloni (cilindri) fino al terreno vero sottostante, per
    // ogni spezzone marcato ponte (TrackGeometry.splitByBridge). deckHalfWidth:
    // metà larghezza dell'impalcato (pista+cordoli). groundPts/embankStart/
    // embankOuter: per calcolare la quota del terreno vero sotto ogni pilone
    // (TrackGeometry.terrainHeightAt) — groundPts esclude i punti-ponte, quindi
    // il pilone raggiunge sempre il livello reale, non quello del ponte stesso.
    function buildBridgeDecks(container, trackPts, groundPts, deckHalfWidth, embankStart, embankOuter) {
        const { bridgeRuns } = TrackGeometry.splitByBridge(trackPts);
        if (!bridgeRuns.length) return;

        const deckMaterial   = new THREE.MeshStandardMaterial({ color: BRIDGE_COLOR, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide });
        const pillarMaterial = new THREE.MeshStandardMaterial({ color: BRIDGE_COLOR, roughness: 0.7, metalness: 0.2 });
        const stepLen = TrackGeometry.lapLength(trackPts) / trackPts.length;
        const pillarStepSamples = Math.max(1, Math.round(BRIDGE_PILLAR_SPACING / stepLen));

        for (const indices of bridgeRuns) {
            if (indices.length < 2) continue;

            const deckPts = indices.map(i => {
                const p = trackPts[i];
                return { x: p.x, y: (p.y || 0) - BRIDGE_DECK_DROP, z: p.z };
            });
            buildOpenRibbon(container, deckPts, deckHalfWidth, deckMaterial);

            for (let k = 0; k < indices.length; k += pillarStepSamples) {
                const i = indices[k];
                const p = trackPts[i];
                // Se il punto a terra più vicino è proprio la pista che passa
                // sotto (entro cordolo+barriera, imbankStart), un pilone qui
                // finirebbe piantato sulla carreggiata invece che a lato:
                // salta questo pilone (segnalato dall'utente su un vero
                // sovrappasso).
                const nearestGround = TrackGeometry.nearestPoint(groundPts, p.x, p.z);
                if (nearestGround.dist < embankStart + BRIDGE_PILLAR_CLEARANCE) continue;
                const groundY = TrackGeometry.terrainHeightAt(groundPts, p.x, p.z, embankStart, embankOuter);
                const bottomY = (p.y || 0) - BRIDGE_DECK_DROP - BRIDGE_DECK_THICK;
                const height = bottomY - groundY;
                if (height < BRIDGE_PILLAR_MIN_HEIGHT) continue;

                const geo = new THREE.CylinderGeometry(BRIDGE_PILLAR_RADIUS, BRIDGE_PILLAR_RADIUS, height, 8);
                const pillar = new THREE.Mesh(geo, pillarMaterial);
                pillar.position.set(p.x, groundY + height / 2, p.z);
                pillar.castShadow = true;
                container.add(pillar);
            }
        }
    }

    root.TrackMeshBuilder = { buildRibbon, buildOpenRibbon, buildCurbs, buildBarriers, buildStartLine, buildStartingGrid, buildPitLane, buildEmbankment, buildGround, buildBridgeDecks };
})(window);
