// frontend/shared/voxelizer.js
//
// Porting diretto della pipeline di ricostruzione voxel di
// voxel_livery_studio.html (editor esterno di riferimento, non nel repo —
// vedi [[project_f1_livery_ingame_port]]): collectTriangles/estimateVoxelSize/
// voxelize/floodOutside/buildModel, quasi invariate. Manca SOLO la parte
// non necessaria qui (sponsor, export .glb, UI): l'obiettivo di questo
// modulo è UNA cosa sola, produrre la STESSA mesh "a voxel puliti" (una
// faccia per lato esposto, 4 vertici TUTTI SUOI per faccia, mai condivisi
// con la faccia vicina) che l'editor di riferimento usa per dipingere senza
// mai sbavare tra un colore e l'altro — root cause del bug "voxel a metà
// di un colore, metà di un altro" osservato quando si proverà a dipingere
// la mesh originale (scolpita a mano, angoli condivisi, superfici curve)
// direttamente: qualunque euristica di classificazione per-vertice/per-
// triangolo prima o poi sbava su una superficie curva, perché la FORMA
// della mesh non è quella giusta. Qui invece si ricostruisce la forma
// giusta una volta, poi si dipinge (in frontend/shared/liveryPattern.js).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Voxelizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

    // Legge la texture-palette (se il materiale ne ha una) in un canvas e
    // restituisce un sampler nearest (u,v) -> THREE.Color, già moltiplicato
    // per material.color. Mesh senza texture (color solido) restituiscono
    // sempre lo stesso colore base.
    function makeSampler(material) {
        const baseCol = new THREE.Color(1, 1, 1);
        if (material && material.color) baseCol.copy(material.color);

        const map = material && material.map;
        if (!map || !map.image) {
            return () => baseCol;
        }
        let data = null, w = 0, h = 0;
        try {
            const img = map.image;
            w = img.width || img.videoWidth;
            h = img.height || img.videoHeight;
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            data = ctx.getImageData(0, 0, w, h).data;
        } catch (e) {
            console.warn('[voxelizer] texture non leggibile, uso il colore base del materiale.', e);
            return () => baseCol;
        }

        // Nota r128 (three.js su questo progetto): niente color-management
        // esplicito qui (l'editor di riferimento usa three 0.160 con
        // setRGB(..., colorSpace) — API che r128 non ha), i valori si
        // leggono così come sono, stessa convenzione di tutto il resto del
        // progetto (mai conversioni gamma esplicite).
        const flipY = map.flipY === true;
        const rx = map.repeat ? map.repeat.x : 1, ry = map.repeat ? map.repeat.y : 1;
        const ox = map.offset ? map.offset.x : 0, oy = map.offset ? map.offset.y : 0;
        const out = new THREE.Color();

        return (u, v) => {
            let uu = u * rx + ox, vv = v * ry + oy;
            uu -= Math.floor(uu); vv -= Math.floor(vv);
            const row = flipY ? (1 - vv) : vv;
            const px = clamp(Math.floor(uu * w), 0, w - 1);
            const py = clamp(Math.floor(row * h), 0, h - 1);
            const i = (py * w + px) * 4;

            // Imposta i colori
            out.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);

            // AGGIUNGI QUESTA RIGA per fixare i voxel neri (converte i pixel in lineare)
            out.convertSRGBToLinear();

            out.r *= baseCol.r; out.g *= baseCol.g; out.b *= baseCol.b;
            return out;
        };
    }

    // Stima il lato del voxel a partire dagli spigoli allineati agli assi.
    function estimateVoxelSize(tris, maxSize) {
        const lens = [];
        const eps = maxSize * 1e-5;
        const step = Math.max(1, Math.floor(tris.length / 4000));
        for (let t = 0; t < tris.length; t += step) {
            const tr = tris[t];
            for (let e = 0; e < 3; e++) {
                const a = tr.p[e], b = tr.p[(e + 1) % 3];
                const d = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])];
                let nz = 0, val = 0;
                for (let k = 0; k < 3; k++) if (d[k] > eps) { nz++; val = d[k]; }
                if (nz === 1) lens.push(val);
            }
        }
        if (!lens.length) return maxSize / 32;
        lens.sort((a, b) => a - b);
        const minL = lens[Math.floor(lens.length * 0.01)] || lens[0];
        const probe = Math.max(1, Math.floor(lens.length / 400));
        for (let n = 1; n <= 8; n++) {
            const g = minL / n;
            if (g < maxSize / 1024) break;
            let ok = 0, tot = 0;
            for (let i = 0; i < lens.length; i += probe) {
                const m = lens[i] / g;
                if (Math.abs(m - Math.round(m)) < 0.03) ok++;
                tot++;
            }
            if (tot && ok / tot > 0.97) return g;
        }
        return minL;
    }

    // Estrae tutti i triangoli in coordinate mondo del modello sorgente.
    function collectTriangles(rootObj) {
        const tris = [];
        rootObj.updateWorldMatrix(true, true);
        const v = new THREE.Vector3();
        rootObj.traverse(o => {
            if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
            const geo = o.geometry;
            const pos = geo.attributes.position;
            const nrm = geo.attributes.normal;
            const uv = geo.attributes.uv;
            const vc = geo.attributes.color;
            const idx = geo.index;
            const mat = Array.isArray(o.material) ? o.material[0] : o.material;
            const sampler = makeSampler(mat);
            const name = (o.name || '').toLowerCase() + ' ' + ((mat && mat.name) || '').toLowerCase();
            const isRubber = /wheel|tire|tyre|rubber|gomm|ruota/.test(name);
            const mw = o.matrixWorld;
            const nMat = new THREE.Matrix3().getNormalMatrix(mw);
            const acc = new THREE.Vector3();
            const count = idx ? idx.count : pos.count;

            for (let t = 0; t + 2 < count; t += 3) {
                const a = idx ? idx.getX(t) : t;
                const b = idx ? idx.getX(t + 1) : t + 1;
                const c = idx ? idx.getX(t + 2) : t + 2;
                const p = [];
                for (const vi of [a, b, c]) {
                    v.fromBufferAttribute(pos, vi).applyMatrix4(mw);
                    p.push([v.x, v.y, v.z]);
                }
                const rec = { p, sampler, isRubber, uv: null, vc: null, n: null, meshName: o.name || 'VoxelMesh' };
                if (nrm) {
                    acc.set(0, 0, 0);
                    for (const vi of [a, b, c]) acc.add(v.fromBufferAttribute(nrm, vi));
                    acc.applyMatrix3(nMat);
                    if (acc.lengthSq() > 1e-12) { acc.normalize(); rec.n = [acc.x, acc.y, acc.z]; }
                }
                if (uv) rec.uv = [[uv.getX(a), uv.getY(a)], [uv.getX(b), uv.getY(b)], [uv.getX(c), uv.getY(c)]];
                if (vc) rec.vc = [
                    [vc.getX(a), vc.getY(a), vc.getZ(a)],
                    [vc.getX(b), vc.getY(b), vc.getZ(b)],
                    [vc.getX(c), vc.getY(c), vc.getZ(c)]
                ];
                tris.push(rec);
            }
        });
        return tris;
    }

    // Voxelizzazione: assegna ogni triangolo a una o più celle di una
    // griglia 3D, campionando il colore (texture o vertex color) al
    // baricentro di ciascun sotto-triangolo di campionamento.
    function voxelize(tris, box, vs) {
        const size = box.getSize(new THREE.Vector3());
        const NX = Math.ceil(size.x / vs) + 4;
        const NY = Math.ceil(size.y / vs) + 4;
        const NZ = Math.ceil(size.z / vs) + 4;
        if (NX * NY * NZ > 24e6) throw new Error('Griglia troppo fitta: aumenta il lato voxel.');

        const ox = box.min.x - vs * 2, oy = box.min.y - vs * 2, oz = box.min.z - vs * 2;
        const cells = new Map();
        const spacing = vs * 0.35;

        for (const tr of tris) {
            const [p0, p1, p2] = tr.p;
            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
            const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
            let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const nl = Math.hypot(nx, ny, nz);
            if (nl < 1e-12) continue;
            nx /= nl; ny /= nl; nz /= nl;
            if (tr.n) { nx = tr.n[0]; ny = tr.n[1]; nz = tr.n[2]; }

            const maxEdge = Math.max(
                Math.hypot(ux, uy, uz),
                Math.hypot(wx, wy, wz),
                Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
            );
            const steps = clamp(Math.ceil(maxEdge / spacing), 1, 400);
            const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
            const inx = nx * vs * 0.3, iny = ny * vs * 0.3, inz = nz * vs * 0.3;

            for (let a = 0; a <= steps; a++) {
                for (let b = 0; a + b <= steps; b++) {
                    const w1 = a / steps, w2 = b / steps, w0 = 1 - w1 - w2;
                    let x = p0[0] * w0 + p1[0] * w1 + p2[0] * w2;
                    let y = p0[1] * w0 + p1[1] * w1 + p2[1] * w2;
                    let z = p0[2] * w0 + p1[2] * w1 + p2[2] * w2;
                    x = cx + (x - cx) * 0.999; y = cy + (y - cy) * 0.999; z = cz + (z - cz) * 0.999;
                    const i = Math.floor((x - inx - ox) / vs);
                    const j = Math.floor((y - iny - oy) / vs);
                    const k = Math.floor((z - inz - oz) / vs);
                    if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) continue;
                    const key = (i * NY + j) * NZ + k;

                    let col = null;
                    if (tr.uv) {
                        const u = tr.uv[0][0] * w0 + tr.uv[1][0] * w1 + tr.uv[2][0] * w2;
                        const vv = tr.uv[0][1] * w0 + tr.uv[1][1] * w1 + tr.uv[2][1] * w2;
                        col = tr.sampler(u, vv);
                    } else {
                        col = tr.sampler(0, 0);
                    }
                    let r = col.r, g = col.g, bl = col.b;
                    if (tr.vc) {
                        r *= tr.vc[0][0] * w0 + tr.vc[1][0] * w1 + tr.vc[2][0] * w2;
                        g *= tr.vc[0][1] * w0 + tr.vc[1][1] * w1 + tr.vc[2][1] * w2;
                        bl *= tr.vc[0][2] * w0 + tr.vc[1][2] * w1 + tr.vc[2][2] * w2;
                    }
                    let cell = cells.get(key);
                    if (!cell) { cell = { r: 0, g: 0, b: 0, w: 0, rub: 0, meshes: {} }; cells.set(key, cell); }
                    cell.r += r; cell.g += g; cell.b += bl; cell.w++;
                    if (tr.isRubber) cell.rub++;
                    cell.meshes[tr.meshName] = (cell.meshes[tr.meshName] || 0) + 1;
                }
            }
        }
        return { cells, NX, NY, NZ, origin: new THREE.Vector3(ox, oy, oz) };
    }

    const DIRS = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
    ];
    const FACE_VERTS = [
        [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
        [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
        [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
        [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
        [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
        [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]
    ];

    // Marca le celle vuote raggiungibili dall'esterno: serve a non generare
    // facce interne (il modello sorgente è un guscio, dentro è cavo).
    function floodOutside(grid) {
        const { cells, NX, NY, NZ } = grid;
        const total = NX * NY * NZ;
        const out = new Uint8Array(total);
        const stack = [];
        const push = k => { if (!out[k] && !cells.has(k)) { out[k] = 1; stack.push(k); } };
        for (let i = 0; i < NX; i++)
            for (let j = 0; j < NY; j++)
                for (let k = 0; k < NZ; k++) {
                    if (i && i < NX - 1 && j && j < NY - 1 && k && k < NZ - 1) continue;
                    push((i * NY + j) * NZ + k);
                }
        while (stack.length) {
            const key = stack.pop();
            const i = Math.floor(key / (NY * NZ));
            const rem = key - i * NY * NZ;
            const j = Math.floor(rem / NZ);
            const k = rem - j * NZ;
            if (i > 0) push(key - NY * NZ);
            if (i < NX - 1) push(key + NY * NZ);
            if (j > 0) push(key - NZ);
            if (j < NY - 1) push(key + NZ);
            if (k > 0) push(key - 1);
            if (k < NZ - 1) push(key + 1);
        }
        return out;
    }

    // Costruisce la mesh voxel finale: una faccia per lato esposto, 4
    // vertici TUTTI SUOI per faccia (mai condivisi) — la geometria stessa
    // impedisce qualunque sbavatura di colore tra un voxel e l'altro.
    function buildModel(grid) {
        const { cells, NY, NZ } = grid;
        const n = cells.size;
        if (!n) throw new Error('Nessun voxel rilevato nel modello.');
        const outside = floodOutside(grid);

        const ci = new Int32Array(n), cj = new Int32Array(n), ck = new Int32Array(n);
        const orig = new Float32Array(n * 3);
        const locked = new Uint8Array(n);
        const index = new Map();
        const meshName = new Array(n);

        let p = 0, minI = 1e9, maxI = -1e9, minJ = 1e9, maxJ = -1e9, minK = 1e9, maxK = -1e9;
        for (const [key, c] of cells) {
            const i = Math.floor(key / (NY * NZ));
            const rem = key - i * NY * NZ;
            const j = Math.floor(rem / NZ);
            const k = rem - j * NZ;
            ci[p] = i; cj[p] = j; ck[p] = k;
            const r = c.r / c.w, g = c.g / c.w, b = c.b / c.w;
            orig[p * 3] = r; orig[p * 3 + 1] = g; orig[p * 3 + 2] = b;

            // Blocca gomme / parti nere: non vanno ridipinte dalla livrea
            // (stesso identico criterio dell'editor di riferimento).
            const lum = luminance(r, g, b);
            const sat = Math.max(r, g, b) - Math.min(r, g, b);
            if (c.rub > 0 || (lum < 0.022 && sat < 0.05)) locked[p] = 1;

            index.set(key, p);
            let bestName = 'Mesh', maxW = -1;
            for (const mName in c.meshes) {
                if (c.meshes[mName] > maxW) { maxW = c.meshes[mName]; bestName = mName; }
            }
            meshName[p] = bestName;
            if (i < minI) minI = i; if (i > maxI) maxI = i;
            if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
            if (k < minK) minK = k; if (k > maxK) maxK = k;
            p++;
        }

        const spanX = maxI - minI + 1, spanZ = maxK - minK + 1, spanY = maxJ - minJ + 1;
        const latIsX = spanX <= spanZ;
        const spanLat = latIsX ? spanX : spanZ;
        const spanLen = latIsX ? spanZ : spanX;

        const lat = new Int32Array(n), len = new Int32Array(n), up = new Int32Array(n);
        const nLat = new Float32Array(n), nLen = new Float32Array(n), nUp = new Float32Array(n);
        const latMin = latIsX ? minI : minK, lenMin = latIsX ? minK : minI;
        for (let q = 0; q < n; q++) {
            lat[q] = (latIsX ? ci[q] : ck[q]) - latMin;
            len[q] = (latIsX ? ck[q] : ci[q]) - lenMin;
            up[q] = cj[q] - minJ;
            nLat[q] = spanLat > 1 ? lat[q] / (spanLat - 1) - 0.5 : 0;
            nLen[q] = spanLen > 1 ? len[q] / (spanLen - 1) : 0;
            nUp[q] = spanY > 1 ? up[q] / (spanY - 1) : 0;
        }

        const faceCell = [], faceDir = [];
        for (let q = 0; q < n; q++) {
            for (let d = 0; d < 6; d++) {
                const i2 = ci[q] + DIRS[d][0], j2 = cj[q] + DIRS[d][1], k2 = ck[q] + DIRS[d][2];
                const nk = (i2 * NY + j2) * NZ + k2;
                const hasNeighbor = index.has(nk);
                const isSamePart = hasNeighbor && (meshName[q] === meshName[index.get(nk)]);
                if (isSamePart) continue;
                if (!hasNeighbor && !outside[nk]) continue;
                faceCell.push(q); faceDir.push(d);
            }
        }
        const fc = Int32Array.from(faceCell), fd = Uint8Array.from(faceDir);
        const fn = fc.length;

        const position = new Float32Array(fn * 12);
        const normal = new Float32Array(fn * 12);
        const color = new Float32Array(fn * 12);
        const indices = new Uint32Array(fn * 6);
        for (let f = 0; f < fn; f++) {
            const q = fc[f], d = fd[f], verts = FACE_VERTS[d], nrm = DIRS[d];
            for (let v = 0; v < 4; v++) {
                const o = (f * 4 + v) * 3;
                position[o] = ci[q] + verts[v][0];
                position[o + 1] = cj[q] + verts[v][1];
                position[o + 2] = ck[q] + verts[v][2];
                normal[o] = nrm[0]; normal[o + 1] = nrm[1]; normal[o + 2] = nrm[2];
            }
            const b = f * 4, o = f * 6;
            indices[o] = b; indices[o + 1] = b + 1; indices[o + 2] = b + 2;
            indices[o + 3] = b; indices[o + 4] = b + 2; indices[o + 5] = b + 3;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();

        return {
            n, ci, cj, ck, lat, len, up, nLat, nLen, nUp, orig, locked, meshName,
            spanLat, spanLen, spanUp: spanY, latIsX,
            faceCell: fc, faceDir: fd, faceCount: fn,
            geometry, gridOrigin: grid.origin, voxelSize: 0 // impostato dal chiamante
        };
    }

    // Punto d'ingresso: da un THREE.Object3D (la scena di un GLTF caricato)
    // a un modello voxel pronto per essere dipinto (vedi liveryPattern.js).
    function voxelizeModel(sourceRoot) {
        const tris = collectTriangles(sourceRoot);
        if (!tris.length) throw new Error('Il modello non contiene mesh.');
        const box = new THREE.Box3().setFromObject(sourceRoot);
        const size = box.getSize(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z);
        const voxelSize = estimateVoxelSize(tris, maxSize);
        const grid = voxelize(tris, box, voxelSize);
        const M = buildModel(grid);
        M.voxelSize = voxelSize;
        M.gridOrigin = grid.origin;
        return M;
    }

    return { voxelizeModel, luminance };
});
