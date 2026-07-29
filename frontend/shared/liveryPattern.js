// frontend/shared/liveryPattern.js
//
// SPIKE / prototipo: verifica che i pattern multi-colore dell'editor
// esterno (voxel_livery_studio.html, tool esterno non nel repo) si
// possano applicare dal vivo sul modello reale del gioco (f1Car.glb)
// scrivendo vertex color veri, invece di ritingere la texture-palette
// (che recolorLiveryTexture in carLoader.js può fare solo in modo
// uniforme, non per pattern posizionali — un colore diverso a
// sinistra/destra o avanti/dietro non è ottenibile da quella tecnica).
//
// Non tocca salvataggio/rete: prende un oggetto livrea FISSO passato
// dal chiamante e lo applica solo al carGroup passato (pensato per un
// test hardcoded sulla propria auto, vedi f1.js).
//
// A differenza dell'editor (che deve voxelizzare mesh arbitrarie
// sconosciute campionando triangoli in una griglia), qui il modello è
// noto e già geometria a voxel pulita: le coordinate lat/len/up si
// derivano direttamente dalla posizione dei vertici e dal passo di
// griglia già misurato, senza rieseguire la voxelizzazione completa.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LiveryPattern = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Mesh "carrozzeria" dipingibili col pattern — ruote/ali/halo/tcam
    // restano fuori, trattate come oggi da recolorLiveryTexture in
    // carLoader.js (sempre neutre/fisse).
    const PAINTABLE_NAMES = ['chassis', 'nose', 'plank'];

    // Passo di griglia misurato su f1Car.glb (0.032 unità nello spazio
    // locale della geometria, PRIMA della scala 3.5x che loadCarModel
    // applica al gruppo — i rapporti usati qui sotto sono comunque
    // invarianti alla scala, ma il valore assoluto del passo va misurato
    // in questo stesso spazio locale non scalato).
    const GRID_STEP = 0.032;

    // Nessuna riga di luminosità può mai azzerarsi del tutto — stesso
    // principio (moltiplicativo, non additivo) già validato nel fix dei
    // "voxel neri" in voxel_livery_studio.html.
    const SHADE_FLOOR = 0.22;

    function hexToRgb(hex) {
        return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
    }

    function rgbToHsl(r, g, b) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        const d = max - min;
        if (d !== 0) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return [h, s, l];
    }

    function hslToRgb(h, s, l) {
        if (s === 0) return [l, l, l];
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hk = h / 360;
        function hue2rgb(t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        }
        return [hue2rgb(hk + 1 / 3), hue2rgb(hk), hue2rgb(hk - 1 / 3)];
    }

    // Sottoinsieme di prova per lo spike (3 dei 18 pattern dell'editor —
    // uno a strisce continue, uno a soglia laterale, uno su griglia
    // discreta, per coprire i tre stili di calcolo usati dal set intero).
    function applyVoxelLiveryPattern(carGroup, params) {
        const { pattern, primary, secondary, accent } = params;
        const cPrimary = hexToRgb(primary);
        const cSecondary = hexToRgb(secondary);
        const cAccent = hexToRgb(accent);

        const paintable = [];
        carGroup.traverse((child) => {
            if (!child.isMesh) return;
            const nm = (child.name || '').toLowerCase();
            if (PAINTABLE_NAMES.some((n) => nm.includes(n))) paintable.push(child);
        });
        if (!paintable.length) {
            console.warn('[liveryPattern] nessuna mesh carrozzeria trovata su', carGroup.name || carGroup);
            return;
        }

        // Bounding box combinata: Chassis/Nose/Plank condividono la stessa
        // origine locale (pivot [0,0,0] per tutte e tre, verificato via
        // ispezione Blender su f1Car.glb), quindi le loro bounding box
        // locali sono già nello stesso sistema di coordinate.
        const box = new THREE.Box3();
        for (const mesh of paintable) {
            mesh.geometry.computeBoundingBox();
            box.union(mesh.geometry.boundingBox);
        }
        const size = box.getSize(new THREE.Vector3());
        // Orientamento noto di QUESTO modello (verificato via ispezione
        // Blender, non generico come nell'editor): X = laterale,
        // Z = lunghezza, Y = altezza.
        const spanLat = Math.max(1, Math.round(size.x / GRID_STEP));
        const spanLen = Math.max(1, Math.round(size.z / GRID_STEP));
        const latCenterIdx = (spanLat - 1) / 2;

        // Colore dominante approssimato (media luminosità dei vertex color
        // originali) — versione semplificata di computeBodyColors()
        // dell'editor, sufficiente per uno spike di validazione.
        let sumL = 0, nSample = 0;
        for (const mesh of paintable) {
            const col = mesh.geometry.attributes.color;
            if (!col) continue;
            for (let i = 0; i < col.count; i++) {
                const [, , l] = rgbToHsl(col.getX(i), col.getY(i), col.getZ(i));
                sumL += l;
                nSample++;
            }
        }
        const domL = nSample ? sumL / nSample : 0.4;

        for (const mesh of paintable) {
            const col = mesh.geometry.attributes.color;
            if (!col) {
                console.warn('[liveryPattern] mesh senza vertex color:', mesh.name);
                continue;
            }
            // Clona la geometria: ogni istanza auto (propria + avversari)
            // deve avere il proprio buffer colore, altrimenti dipingere
            // un'auto dipingerebbe tutte le auto che condividono l'asset.
            mesh.geometry = mesh.geometry.clone();
            const pos = mesh.geometry.attributes.position;
            const outCol = mesh.geometry.attributes.color;

            const wStripe = Math.max(1, Math.round(spanLat * 0.11));
            const wSplit = Math.max(1, Math.round(spanLat * 0.30));
            const cellSize = Math.max(2, Math.round(spanLat * 0.15));

            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
                const latIdx = Math.round((x - box.min.x) / GRID_STEP);
                const lenIdx = Math.round((z - box.min.z) / GRID_STEP);
                const upIdx = Math.round((y - box.min.y) / GRID_STEP);
                const dLat = Math.abs(latIdx - latCenterIdx);

                let r = cPrimary[0], g = cPrimary[1], b = cPrimary[2];

                switch (pattern) {
                    case 'racing_stripes':
                        if (dLat <= wStripe) { r = cSecondary[0]; g = cSecondary[1]; b = cSecondary[2]; }
                        else if (dLat <= wStripe + 1) { r = cAccent[0]; g = cAccent[1]; b = cAccent[2]; }
                        break;
                    case 'split_sides':
                        if (dLat >= wSplit) { r = cSecondary[0]; g = cSecondary[1]; b = cSecondary[2]; }
                        else if (dLat >= wSplit - 1) { r = cAccent[0]; g = cAccent[1]; b = cAccent[2]; }
                        break;
                    case 'checkers': {
                        const cx = Math.floor(latIdx / cellSize);
                        const cl = Math.floor(lenIdx / cellSize);
                        const cu = Math.floor(upIdx / cellSize);
                        if ((cx + cl + cu) % 2 === 0) { r = cSecondary[0]; g = cSecondary[1]; b = cSecondary[2]; }
                        break;
                    }
                    default:
                        break; // altri pattern non ancora portati in questo spike
                }

                // Trasferimento ombra: stesso principio moltiplicativo con
                // floor già validato nel fix "voxel neri" dell'editor
                // esterno — non clippa mai a luminosità zero.
                const origL = rgbToHsl(outCol.getX(i), outCol.getY(i), outCol.getZ(i))[2];
                const [targetH, targetS, targetL] = rgbToHsl(r, g, b);
                const relShade = origL / Math.max(domL, 0.02);
                const shadeMult = Math.max(SHADE_FLOOR, relShade);
                const finalL = Math.max(0, Math.min(1, targetL * shadeMult));
                const [fr, fg, fb] = hslToRgb(targetH, targetS, finalL);
                outCol.setXYZ(i, fr, fg, fb);
            }
            outCol.needsUpdate = true;
            mesh.material.vertexColors = true;
            mesh.material.needsUpdate = true;
        }
    }

    return { applyVoxelLiveryPattern };
});
