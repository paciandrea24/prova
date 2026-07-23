// frontend/shared/trackMeshBuilder.js
(function (root) {
    const TrackGeometry = root.TrackGeometry;

    // Stesso verde del prato esistente (f1.js): usato sia dal terrapieno sia
    // dal prato con foro (buildGround), per continuità visiva senza cuciture
    // di colore tra i due.
    const GRASS_COLOR = 0x3d8b3d;

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

    function buildCurbs(container, pts, roadHalf, curbW) {
        const n = pts.length;
        const stepLen = TrackGeometry.lapLength(pts) / n;
        const STRIPE = 10;

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let dist = 0, flip = false;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const y = (p.y || 0) + 0.04;
                const inner = roadHalf * side, outer = (roadHalf + curbW) * side;

                const b = i * 6;
                pos[b]     = p.x + nx * inner; pos[b + 1] = y; pos[b + 2] = p.z + nz * inner;
                pos[b + 3] = p.x + nx * outer; pos[b + 4] = y; pos[b + 5] = p.z + nz * outer;

                if (i > 0) { dist += stepLen; if (dist >= STRIPE) { dist = 0; flip = !flip; } }
                const r = 1, g = flip ? 0 : 1, bv = flip ? 0 : 1;
                const cb = i * 6;
                col[cb] = r; col[cb + 1] = g; col[cb + 2] = bv;
                col[cb + 3] = r; col[cb + 4] = g; col[cb + 5] = bv;

                const base = i * 2, nxt = ((i + 1) % n) * 2;
                idx.push(base, base + 1, nxt, nxt, base + 1, nxt + 1);
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

    function buildBarriers(container, pts, distFromCenter) {
        const n = pts.length;
        const HEIGHT = 1.1;
        const stepLen = TrackGeometry.lapLength(pts) / n;
        const STRIPE = 14;

        for (const side of [-1, 1]) {
            const pos = new Float32Array(n * 2 * 3);
            const col = new Float32Array(n * 2 * 3);
            const idx = [];
            let stripeAcc = 0, isRed = false;

            for (let i = 0; i < n; i++) {
                const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
                const p = pts[i];
                const baseY = p.y || 0;
                const bx = p.x + nx * distFromCenter * side;
                const bz = p.z + nz * distFromCenter * side;

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

                const base = i * 2, next = ((i + 1) % n) * 2;
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

    function buildStartLine(container, pts, roadHalf) {
        const p0 = pts[0], p1 = pts[1];
        const { nx, nz } = TrackGeometry.normalAt(pts, 0, true);

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

    // pitControlPoints: punti di controllo GREZZI (non campionati) della
    // corsia box, presi da pit.path del JSON.
    function buildPitLane(container, pitControlPoints, pitRoadHalf, pitBoxIndex) {
        const pitPts = TrackGeometry.sampleOpenPath(pitControlPoints, 300);

        buildOpenRibbon(container, pitPts, pitRoadHalf, new THREE.MeshStandardMaterial({
            color: 0x3a3a3a, roughness: 0.95, side: THREE.DoubleSide
        }));

        const boxPos = pitControlPoints[pitBoxIndex];
        const boxMesh = new THREE.Mesh(
            new THREE.BoxGeometry(pitRoadHalf * 1.7, 0.03, 15),
            new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.9, transparent: true, opacity: 0.55 })
        );
        boxMesh.position.set(boxPos.x, 0.04, boxPos.z);
        container.add(boxMesh);

        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        function addLine(pt, dirPt) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(pitRoadHalf * 2, 0.03, 1), lineMat);
            line.position.set(pt.x, 0.045, pt.z);
            line.rotation.y = Math.atan2(dirPt.x - pt.x, dirPt.z - pt.z);
            container.add(line);
        }
        // Linee vicino a distacco/rientro: al 5% e al 95% del percorso
        // campionato, orientate verso il campione successivo/precedente —
        // generico per qualunque forma di corsia box, non solo Monte Rosso.
        const nearStart = Math.max(1, Math.round(pitPts.length * 0.05));
        const nearEnd   = Math.min(pitPts.length - 2, Math.round(pitPts.length * 0.95));
        addLine(pitPts[nearStart], pitPts[nearStart + 1]);
        addLine(pitPts[nearEnd], pitPts[nearEnd - 1]);
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

                const base = pos.length / 3;
                pos.push(x0, 0, z0,  x1, 0, z0,  x1, 0, z1,  x0, 0, z1);
                idx.push(base, base + 1, base + 2,  base, base + 2, base + 3);
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

    const BRIDGE_COLOR = 0x4a4a4a;
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

    root.TrackMeshBuilder = { buildRibbon, buildOpenRibbon, buildCurbs, buildBarriers, buildStartLine, buildPitLane, buildEmbankment, buildGround, buildBridgeDecks };
})(window);
