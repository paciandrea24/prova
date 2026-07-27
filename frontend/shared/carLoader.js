// frontend/shared/carLoader.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CarLoader = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Ricolore per modelli con texture-palette (mesh voxel unica, colore dato
    // da una piccola texture invece che da material.color): si ricrea la
    // palette sostituendo SOLO i texel "rosso livrea" (tonalità in
    // [0, LIVERY_HUE_MAX], saturazione >= LIVERY_SAT_MIN — misurato sulla
    // palette reale del modello: i rossi livrea non superano mai 23.8° di
    // tonalità, i neri/grigi/ombre AO olive-marroni stanno da 32° in su —
    // soglia scelta nel mezzo di questo margine, altrimenti quelle ombre
    // vengono ricolorate per errore) con la stessa luminosità/saturazione
    // ma tonalità del colore giocatore, così l'ombreggiatura già cotta
    // nella palette resta intatta.
    const LIVERY_HUE_MAX = 28;
    const LIVERY_SAT_MIN = 0.2;

    // Cerchio ruota: tonalità 45°-100° (verde oliva), misurata sulla palette
    // reale — nettamente separata dalla livrea rossa (≤24°) e dal nero/grigio
    // gomma (saturazione quasi nulla, o tonalità <10° con valore molto basso).
    // Usata per ritingere il cerchio col colore mescola (vedi loadCarModel).
    const RIM_HUE_MIN = 45;
    const RIM_HUE_MAX = 100;
    // Floor di saturazione: il texel 20 (RGB 32,31,26 → h=50°, s=0.19) e il
    // texel 45 (RGB 90,92,88 → h=90°, s=0.04) rientrano nella finestra di
    // tonalità del cerchio ma sono grigi quasi neutri usati sul battistrada
    // (residuo di tinta oliva dal bake AO), non cerchio vero — senza questo
    // floor vengono ritinti a piena saturazione col colore mescola, macchiando
    // la gomma. Il cerchio vero non scende mai sotto s=0.28 (misurato sulla
    // palette reale di f1Car.glb) — 0.25 sta a metà tra i due margini.
    const RIM_SAT_MIN = 0.25;

    // Lift di luminosità applicato a OGNI texel (nero, grigio o livrea),
    // stessa curva per tutti — misurato sulla palette reale: anche il "nero"
    // più chiaro non supera v=0.36, e molte ombre livrea stanno sotto v=0.15,
    // per questo in gioco auto propria e avversarie si leggono come un blob
    // scuro indistinguibile. Curva uniforme (nessun ramo per tonalità) per
    // non ripetere l'artefatto del tentativo precedente (floor applicato in
    // base alla classificazione hue → macchie sui texel ambigui 30-45°).
    const VALUE_LIFT_FLOOR = 0.14;
    const VALUE_LIFT_GAMMA = 0.55;
    function liftValue(v) {
        return VALUE_LIFT_FLOOR + (1 - VALUE_LIFT_FLOOR) * Math.pow(v, VALUE_LIFT_GAMMA);
    }

    // Alcuni texel non-livrea hanno un residuo di tonalità (giallo/oliva,
    // probabile artefatto di bake dell'AO) con saturazione non trascurabile:
    // finché erano scurissimi non si vedeva, ma il lift sopra li rende
    // luminosi abbastanza da leggersi come "voxel gialli" sulle gomme.
    // Spenta qui, solo per i texel non classificati come livrea.
    const BLACK_SAT_SCALE = 0.12;
    function desaturateForBlack(s) {
        return s * BLACK_SAT_SCALE;
    }

    function rgbToHsv(r, g, b) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r)      h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else                h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        const s = max === 0 ? 0 : d / max;
        return [h, s, max];
    }

    function hsvToRgb(h, s, v) {
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let r1, g1, b1;
        if      (h < 60)  [r1, g1, b1] = [c, x, 0];
        else if (h < 120) [r1, g1, b1] = [x, c, 0];
        else if (h < 180) [r1, g1, b1] = [0, c, x];
        else if (h < 240) [r1, g1, b1] = [0, x, c];
        else if (h < 300) [r1, g1, b1] = [x, 0, c];
        else              [r1, g1, b1] = [c, 0, x];
        return [r1 + m, g1 + m, b1 + m];
    }

    function recolorLiveryTexture(sourceTexture, hex, forceNeutral = false, compoundHex = null) {
        const img = sourceTexture.image;
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // targetSat/targetVal: per i texel livrea la saturazione/luminosità
        // finali arrivano dal colore SCELTO dal giocatore, non dalla texture
        // sorgente (quasi sempre un rosso vivido) — altrimenti un colore
        // scuro/poco saturo come il marrone (#795548, H≈16° S≈0.40 V≈0.48,
        // tonalità vicinissima al rosso) viene ricolorato con la vividezza
        // del rosso sorgente e appare rosso invece che marrone. La texture
        // sorgente resta usata come moltiplicatore di ombreggiatura relativa
        // (chiaro/scuro), non come valore assoluto.
        const [targetHue, targetSat, targetVal] = rgbToHsv(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);

        // Stesso principio per il colore mescola sul cerchio (solo quando
        // forceNeutral è attivo, cioè sulle mesh ruota): se compoundHex non è
        // fornito (mescola non ancora nota), isRim resta sempre falso più
        // sotto e il cerchio si comporta come un texel neutro qualsiasi.
        const [compoundHue, compoundSat, compoundVal] = compoundHex != null
            ? rgbToHsv(((compoundHex >> 16) & 0xff) / 255, ((compoundHex >> 8) & 0xff) / 255, (compoundHex & 0xff) / 255)
            : [0, 0, 0];

        for (let i = 0; i < data.length; i += 4) {
            const [h, s, v] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            const isLivery = !forceNeutral && h <= LIVERY_HUE_MAX && s >= LIVERY_SAT_MIN;
            const isRim    = forceNeutral && compoundHex != null && h >= RIM_HUE_MIN && h <= RIM_HUE_MAX && s >= RIM_SAT_MIN;
            const liftedV = liftValue(v);
            let outHue, outSat, outVal;
            if (isLivery) {
                outHue = targetHue; outSat = targetSat; outVal = targetVal * liftedV;
            } else if (isRim) {
                outHue = compoundHue; outSat = compoundSat; outVal = compoundVal * liftedV;
            } else {
                outHue = h; outSat = desaturateForBlack(s); outVal = liftedV;
            }
            const [nr, ng, nb] = hsvToRgb(outHue, outSat, outVal);
            data[i]     = Math.round(nr * 255);
            data[i + 1] = Math.round(ng * 255);
            data[i + 2] = Math.round(nb * 255);
        }
        ctx.putImageData(imageData, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY     = sourceTexture.flipY;
        tex.wrapS     = sourceTexture.wrapS;
        tex.wrapT     = sourceTexture.wrapT;
        tex.magFilter = sourceTexture.magFilter;
        tex.minFilter = sourceTexture.minFilter;
        tex.encoding  = sourceTexture.encoding;
        tex.needsUpdate = true;
        return tex;
    }

    // Ruote nominate 'wheelHub_FL/FR/RL/RR' (vedi backend/tools/f1CarBuilder.py,
    // funzione add_wheel) o 'wheel_FL' ecc. — suffisso '_fl'/'_fr' = anteriore,
    // '_rl'/'_rr' = posteriore. Usato per applicare lo sterzo visivo
    // (frontend/f1.js) solo alle ruote anteriori.
    function classifyWheelSide(nm) {
        if (/_(?:fl|fr)(?![a-z])/.test(nm)) return 'front';
        if (/_(?:rl|rr)(?![a-z])/.test(nm)) return 'rear';
        return null;
    }

    // loadCarModel: stessa identica implementazione di f1.js (prima
    // dell'estrazione), con UNA sola differenza di firma — scene/listener/
    // engineBuffer arrivano come terzo parametro (deps) invece che per
    // closure su variabili esterne di f1.js. Il loader GLTF viene creato
    // localmente ad ogni chiamata invece di essere condiviso a livello di
    // modulo: in f1.js era una variabile di modulo condivisa tra le
    // chiamate, ma ricrearla qui non cambia il comportamento (il costo è
    // trascurabile).
    function loadCarModel(playerColor, onReady, { scene, listener, engineBuffer }) {
        const loader = new THREE.GLTFLoader();
        loader.load('/assets/custom/f1Car.glb', (gltf) => {
            const group = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(3.5, 3.5, 3.5);

            // Il nodo radice del GLB ha un pivot non centrato sull'asset (translation
            // locale non nulla): senza compensarlo la mesh visibile risulta spostata
            // rispetto al centro logico (group), che è quello usato da fisica, hitbox
            // e camera — causa del disallineamento "auto qui, hitbox là" osservato in
            // gioco. Ricentriamo sul bounding box reale (x/z al centro, y a terra).
            model.updateMatrixWorld(true);
            const carBBox0 = new THREE.Box3().setFromObject(model);
            const carCenter0 = carBBox0.getCenter(new THREE.Vector3());
            model.position.x -= carCenter0.x;
            model.position.z -= carCenter0.z;
            model.position.y -= carBBox0.min.y;

            const hex        = parseInt(playerColor.replace('#', ''), 16);
            const namedWheels = [];
            const allMeshes   = [];
            const meshSide    = new Map();

            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow    = true;
                child.receiveShadow = true;
                child.material      = child.material.clone();
                const nm = (child.name + ' ' + (child.parent?.name || '')).toLowerCase();
                const isWheelMesh = nm.includes('wheel') || nm.includes('tyre') || nm.includes('tire');
                // Le gomme non cambiano mai colore col giocatore (una gomma vera
                // resta nera/grigia): la palette condivisa con la carrozzeria ha
                // alcuni toni scuri (ombre) che per tonalità/saturazione vengono
                // classificati come "livrea" da recolorLiveryTexture — corretto
                // sulla carrozzeria, sbagliato sulle ruote (macchie del colore
                // giocatore sui voxel gomma/cerchio). Sulle mesh ruota si applica
                // comunque la schiarita di luminosità (altrimenti la palette
                // scura originale si legge come un blob nero indistinguibile,
                // vedi liftValue) ma MAI la tinta livrea (forceNeutral).
                if (isWheelMesh && child.material.map) {
                    child.userData.pristineTex = child.material.map;
                }
                if (child.material.map) {
                    child.material.map = recolorLiveryTexture(child.material.map, hex, isWheelMesh);
                    child.material.needsUpdate = true;
                } else {
                    const c = child.material.color;
                    if (c.r > 0.85 && c.g > 0.85 && c.b > 0.85) {
                        child.material.color.setHex(hex);
                        child.material.metalness = 0.4;
                        child.material.roughness = 0.35;
                    }
                }
                allMeshes.push(child);
                if (isWheelMesh) {
                    namedWheels.push(child);
                    const side = classifyWheelSide(nm);
                    if (side) meshSide.set(child, side);
                }
            });

            console.log('[F1] Mesh nel modello:', allMeshes.map(m => `"${m.name}"`).join(', '));

            group.add(model);

            // Raccogli i nodi PARENT delle ruote (rotazione più corretta del sub-mesh)
            const wheelParentSet  = new Set();
            const wheelSideByNode = new Map();
            for (const wm of namedWheels) {
                const p = wm.parent;
                const node = (p && p.isObject3D && !(p.isMesh) && p !== model && p !== gltf.scene) ? p : wm;
                wheelParentSet.add(node);
                if (meshSide.has(wm) && !wheelSideByNode.has(node)) {
                    wheelSideByNode.set(node, meshSide.get(wm));
                }
            }

            // Fallback bounding-box se non trovate per nome
            let wheels = [...wheelParentSet];
            if (wheels.length < 2 && allMeshes.length > 1) {
                const carBB = new THREE.Box3().setFromObject(group);
                const thresh = carBB.min.y + (carBB.max.y - carBB.min.y) * 0.38;
                wheels = allMeshes.filter(m => {
                    const bb = new THREE.Box3().setFromObject(m);
                    return bb.getCenter(new THREE.Vector3()).y < thresh;
                });
                console.log('[F1] Ruote per BB:', wheels.length);
            }

            // Fallback finale: ruote cilindriche sintetiche — solo se il
            // modello ha più mesh separate (indizio che le ruote ci sono ma
            // non sono state trovate); su una mesh voxel unica (allMeshes.length
            // === 1) le ruote sono già disegnate nel modello stesso, aggiungerne
            // di finte creerebbe cilindri scoordinati sovrapposti.
            if (wheels.length < 2 && allMeshes.length > 1) {
                console.log('[F1] Nessuna ruota separata trovata → aggiungo ruote fake');
                const wGeo = new THREE.CylinderGeometry(0.88, 0.88, 0.65, 16);
                const wMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.1 });
                const wPos = [
                    [-2.7, 0.88,  3.6],   // anteriore sinistra
                    [ 2.7, 0.88,  3.6],   // anteriore destra
                    [-2.7, 0.88, -3.4],   // posteriore sinistra
                    [ 2.7, 0.88, -3.4],   // posteriore destra
                ];
                wheels = [];
                for (const [wx, wy, wz] of wPos) {
                    const w = new THREE.Mesh(wGeo, wMat.clone());
                    w.rotation.z = Math.PI / 2;
                    w.position.set(wx, wy, wz);
                    w.castShadow = true;
                    group.add(w);
                    wheels.push(w);
                }
            }

            group.updateMatrixWorld(true);
            const frontWheels = wheels.filter((w) => {
                const side = wheelSideByNode.get(w);
                if (side) return side === 'front';
                return new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3()).z > 0;
            });

            group.userData.wheels      = wheels;
            group.userData.frontWheels = frontWheels;
            group.userData.wheelRot    = 0;

            // Rigenera la texture ruota col colore mescola richiesto, partendo
            // sempre dalla copia non processata (mai dalla texture già
            // ricolorata) per evitare degradazione cumulativa ad ogni cambio
            // mescola (es. dopo un pit stop). Nessun effetto su mesh non-ruota
            // (w.userData.pristineTex è undefined per la carrozzeria).
            group.userData.setCompoundColor = function (compoundHex) {
                for (const w of namedWheels) {
                    if (!w.isMesh || !w.userData.pristineTex) continue;
                    const old = w.material.map;
                    w.material.map = recolorLiveryTexture(w.userData.pristineTex, hex, true, compoundHex);
                    if (old && old !== w.userData.pristineTex) old.dispose();
                    w.material.needsUpdate = true;
                }
            };

            // Ordine Euler 'YXZ' su ogni nodo ruota: lo sterzo (rotation.y,
            // applicato solo alle ruote anteriori in frontend/f1.js) va
            // composto PRIMA del rotolamento (rotation.x, su tutte le ruote)
            // — con l'ordine di default 'XYZ' le due rotazioni si mescolano
            // e l'asse di rotolamento oscilla fuori dal piano orizzontale
            // invece di sterzare pulito. Stessa tecnica già usata per
            // carGroup (vedi frontend/f1.js).
            for (const w of wheels) w.rotation.order = 'YXZ';

            // Loop motore: un solo buffer, mai fermato — pitch e volume
            // vengono regolati ogni frame in animate() in base a velocità
            // e stato accelerando/decelerando.
            const engineSound = new THREE.PositionalAudio(listener);
            engineSound.setBuffer(engineBuffer);
            engineSound.setLoop(true);
            engineSound.setRefDistance(15);
            engineSound.setRolloffFactor(1.5);
            engineSound.setVolume(0);
            engineSound.play();
            group.add(engineSound);
            group.userData.engineSound = engineSound;

            scene.add(group);
            onReady(group);
        }, undefined, (err) => console.error('Errore car model:', err));
    }

    return { loadCarModel, classifyWheelSide };
});
