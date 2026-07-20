// frontend/shared/trackMeshBuilder.js
(function (root) {
    const TrackGeometry = root.TrackGeometry;

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
            pos[b]     = p.x + nx * halfW; pos[b + 1] = 0.03; pos[b + 2] = p.z + nz * halfW;
            pos[b + 3] = p.x - nx * halfW; pos[b + 4] = 0.03; pos[b + 5] = p.z - nz * halfW;

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
                const r = isRed ? 0.85 : 0.93, g = isRed ? 0.10 : 0.93, bv = isRed ? 0.10 : 0.96;
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

    root.TrackMeshBuilder = { buildRibbon, buildOpenRibbon, buildCurbs, buildBarriers, buildStartLine, buildPitLane };
})(window);
