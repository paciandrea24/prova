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
//
// Il file f1Car.glb NON ha un attributo COLOR_0 (verificato leggendo il
// JSON grezzo del .glb, non un'ipotesi — un controllo precedente via
// Blender aveva fatto credere il contrario, probabilmente un artefatto
// di anteprima di Blender in fase di import, non dato reale del file):
// il colore/ombreggiatura originale per-voxel si campiona dalla texture
// via UV (stesso identico approccio di voxel_livery_studio.html), e
// l'attributo colore per il pattern viene creato da zero, non
// sovrascritto.
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

    // Classificazione livrea-vs-dettaglio: STESSI valori già misurati e
    // provati su QUESTO asset in carLoader.js (LIVERY_HUE_MAX/SAT_MIN) —
    // non i valori di voxel_livery_studio.html (tarati su una palette
    // diversa). Un texel "non livrea" (cockpit/prese d'aria/dettagli
    // scuri o desaturati dentro la stessa mesh Chassis/Nose/Plank) NON va
    // ridipinto col pattern: va lasciato esattamente com'è, altrimenti
    // sporca sia il colore dominante sia il risultato finale su quei
    // texel (bug osservato: colore dominante calcolato come nero perché
    // molti vertici di dettaglio scuro/desaturato, non scartati da una
    // soglia di sola luminosità, dominavano l'istogramma per numero).
    const LIVERY_HUE_MAX = 28;
    const LIVERY_SAT_MIN = 0.2;
    // La saturazione HSL è instabile vicino al nero: un texel quasi-nero
    // con minime variazioni per canale (es. r=0.004,g=0.002,b=0.001, un
    // artefatto di compressione/campionamento, non colore vero) ha
    // saturazione calcolata alta (è un rapporto relativo alla luminosità,
    // che esplode vicino a zero) pur essendo visivamente nero puro — senza
    // questo floor quei texel passavano il controllo hue/sat e dominavano
    // l'istogramma del colore dominante quantizzandosi tutti a (0,0,0).
    const LIVERY_LIGHT_MIN = 0.05;
    function isLiveryTexel(h, s, l) {
        return l >= LIVERY_LIGHT_MIN && h <= LIVERY_HUE_MAX && s >= LIVERY_SAT_MIN;
    }

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

    // Legge la texture-palette in un canvas e restituisce un sampler
    // nearest (u,v) -> [r,g,b] 0..1. Il file f1Car.glb NON ha un
    // attributo COLOR_0 (verificato leggendo il JSON del .glb — un
    // controllo precedente via Blender aveva fatto credere il contrario,
    // probabilmente un artefatto di anteprima di Blender, non dato reale
    // del file): il colore/ombreggiatura originale per-voxel esiste SOLO
    // nella texture, va campionato via UV — stesso approccio già usato in
    // voxel_livery_studio.html (makeSampler).
    function makeTextureSampler(map) {
        const img = map.image;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const w = canvas.width, h = canvas.height;
        const flipY = map.flipY !== false; // default THREE.js: true

        return (u, v) => {
            let uu = u - Math.floor(u), vv = v - Math.floor(v);
            const row = flipY ? (1 - vv) : vv;
            const px = Math.min(w - 1, Math.max(0, Math.floor(uu * w)));
            const py = Math.min(h - 1, Math.max(0, Math.floor(row * h)));
            const i = (py * w + px) * 4;
            return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
        };
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

        // Il centro laterale VERO si prende dalla Chassis, non dal centro
        // della bounding box combinata: verificato con dati reali
        // (ispezione Blender) che Chassis e Nose condividono lo stesso
        // centro laterale locale (x=0.016), ma Plank ha un centro diverso
        // (x=0.0, scarto di mezzo passo di griglia). Usare il centro della
        // combinazione dei tre lo tira verso quello di Plank, allontanandolo
        // dal vero asse di simmetria di Chassis/Nose — poco percettibile
        // sulla Chassis (larga), molto visibile sul Nose (stretto: lo
        // stesso scarto assoluto è una frazione molto più grande della sua
        // larghezza) — causa esatta della striscia non centrata osservata.
        const chassisMesh = paintable.find((m) => (m.name || '').toLowerCase().includes('chassis'));
        const chassisBox = new THREE.Box3();
        if (chassisMesh) {
            chassisMesh.geometry.computeBoundingBox();
            chassisBox.copy(chassisMesh.geometry.boundingBox);
        } else {
            chassisBox.copy(box); // fallback se il modello non ha una mesh "Chassis"
        }
        const trueCenterX = (chassisBox.min.x + chassisBox.max.x) / 2;
        const latCenterIdx = (trueCenterX - box.min.x) / GRID_STEP;

        // Colore dominante: stesso metodo di computeBodyColors()
        // nell'editor — istogramma dei colori quantizzati (4 bit per
        // canale), bucket PIÙ FREQUENTE (non una media), escludendo i
        // texel quasi-neri/desaturati (gomme/dettagli, mai livrea). Una
        // media semplice era sbagliata: pochi texel scuri (ombre/creste
        // AO) la spostavano in basso rispetto al colore che copre la
        // maggior parte della superficie, causando risultati troppo
        // chiari/lavati (bug osservato: rosso pieno diventato rosa/bianco).
        // Usa SEMPRE la texture PRISTINA (userData.pristineTex, salvata da
        // carLoader.js prima del ricolore) — quella già ricolorata da
        // recolorLiveryTexture è schiarita (fix voxel neri), campionarla
        // qui rischiarirebbe due volte in cascata.
        const hist = new Map();
        for (const mesh of paintable) {
            const tex = mesh.userData.pristineTex || mesh.material.map;
            if (!tex || !mesh.geometry.attributes.uv) continue;
            const sampler = makeTextureSampler(tex);
            const uv = mesh.geometry.attributes.uv;
            for (let i = 0; i < uv.count; i++) {
                const [r, g, b] = sampler(uv.getX(i), uv.getY(i));
                const [h, s, l] = rgbToHsl(r, g, b);
                if (!isLiveryTexel(h, s, l)) continue; // dettaglio/trim: non livrea, non conta per il dominante
                const key = (Math.round(r * 15) * 16 + Math.round(g * 15)) * 16 + Math.round(b * 15);
                hist.set(key, (hist.get(key) || 0) + 1);
            }
        }
        let domL = 0.4;
        if (hist.size) {
            const domKey = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
            const dB = domKey % 16, dG = Math.floor(domKey / 16) % 16, dR = Math.floor(domKey / 256);
            domL = rgbToHsl(dR / 15, dG / 15, dB / 15)[2];
        }

        for (const mesh of paintable) {
            const tex = mesh.userData.pristineTex || mesh.material.map;
            if (!tex || !mesh.geometry.attributes.uv) {
                console.warn('[liveryPattern] mesh senza texture/UV, salto:', mesh.name);
                continue;
            }
            // Clona la geometria: ogni istanza auto (propria + avversari)
            // deve avere il proprio buffer colore, altrimenti dipingere
            // un'auto dipingerebbe tutte le auto che condividono l'asset.
            mesh.geometry = mesh.geometry.clone();
            const pos = mesh.geometry.attributes.position;
            const uv = mesh.geometry.attributes.uv;
            const sampler = makeTextureSampler(tex); // texture PRISTINA, vedi nota sopra

            // Nessun attributo colore nel file: lo creiamo da zero (non
            // possiamo limitarci a sovrascrivere un attributo esistente
            // come nell'editor esterno, qui parte vuoto).
            const colorArray = new Float32Array(pos.count * 3);

            const wStripe = Math.max(1, Math.round(spanLat * 0.11));
            const wSplit = Math.max(1, Math.round(spanLat * 0.30));
            const cellSize = Math.max(2, Math.round(spanLat * 0.15));

            for (let i = 0; i < pos.count; i++) {
                // "orig" dalla texture PRISTINA campionata via UV (il file
                // non ha un attributo colore). Se il texel originale non è
                // "livrea" (dettaglio/trim scuro o desaturato — cockpit,
                // prese d'aria, ecc. — stesso criterio hue/sat già provato
                // in carLoader.js), si tiene il colore originale così com'è:
                // NON va ridipinto col pattern, esattamente come fa
                // l'editor esterno coi voxel "locked".
                const [origR, origG, origB] = sampler(uv.getX(i), uv.getY(i));
                const [origH, origS, origL] = rgbToHsl(origR, origG, origB);

                if (!isLiveryTexel(origH, origS, origL)) {
                    colorArray[i * 3] = origR;
                    colorArray[i * 3 + 1] = origG;
                    colorArray[i * 3 + 2] = origB;
                    continue;
                }

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
                const [targetH, targetS, targetL] = rgbToHsl(r, g, b);
                const relShade = origL / Math.max(domL, 0.02);
                const shadeMult = Math.max(SHADE_FLOOR, relShade);
                const finalL = Math.max(0, Math.min(1, targetL * shadeMult));
                const [fr, fg, fb] = hslToRgb(targetH, targetS, finalL);
                colorArray[i * 3] = fr;
                colorArray[i * 3 + 1] = fg;
                colorArray[i * 3 + 2] = fb;
            }
            mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
            // THREE.js MOLTIPLICA map × vertexColor quando entrambi sono
            // attivi (non sostituisce) — lasciare la texture rossa già
            // ricolorata da recolorLiveryTexture avrebbe reso invisibile
            // il bianco (bianco × rosso = rosso invariato) e visibile solo
            // come lieve scurimento la fascia accento (accento scuro ×
            // rosso = rosso scurito) — esattamente il sintomo osservato
            // ("alone scuro", base sempre rossa). Il colore-pattern deve
            // essere l'unica fonte: si toglie la texture, il campionatore
            // sopra ha già estratto i pixel di cui aveva bisogno prima di
            // questo punto.
            mesh.material.map = null;
            mesh.material.vertexColors = true;
            mesh.material.needsUpdate = true;
        }
    }

    return { applyVoxelLiveryPattern };
});
