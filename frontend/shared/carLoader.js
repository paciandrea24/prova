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
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
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
        if (h < 60) [r1, g1, b1] = [c, x, 0];
        else if (h < 120) [r1, g1, b1] = [x, c, 0];
        else if (h < 180) [r1, g1, b1] = [0, c, x];
        else if (h < 240) [r1, g1, b1] = [0, x, c];
        else if (h < 300) [r1, g1, b1] = [x, 0, c];
        else[r1, g1, b1] = [c, 0, x];
        return [r1 + m, g1 + m, b1 + m];
    }

    function recolorLiveryTexture(sourceTexture, hex, forceNeutral = false, compoundHex = null) {
        const img = sourceTexture.image;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
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
            const isRim = forceNeutral && compoundHex != null && h >= RIM_HUE_MIN && h <= RIM_HUE_MAX && s >= RIM_SAT_MIN;
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
            data[i] = Math.round(nr * 255);
            data[i + 1] = Math.round(ng * 255);
            data[i + 2] = Math.round(nb * 255);
        }
        ctx.putImageData(imageData, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY = sourceTexture.flipY;
        tex.wrapS = sourceTexture.wrapS;
        tex.wrapT = sourceTexture.wrapT;
        // Sempre NEAREST e senza mipmap: questa texture è una palette di
        // lookup (256x1 colori diversissimi affiancati), non un'immagine
        // spaziale — con mipmap/filtro lineare la GPU sfuma colonne
        // adiacenti a distanza, mescolando i colori di voxel vicini (da qui
        // la differenza di colore vista in gioco rispetto a Blender, dove
        // si guarda sempre a piena risoluzione).
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.encoding = sourceTexture.encoding;
        tex.needsUpdate = true;
        return tex;
    }

    // Tinta di default per-vertice (geometry.attributes.color / COLOR_0)
    // per le mesh che non hanno più una texture-palette (Chassis/Nose/Plank
    // del modello rifatto): senza questo ramo cadevano nel fallback
    // "materiale bianco puro" (tinta uniforme su material.color), che poi
    // si MOLTIPLICA per il colore-per-vertice già cotto nel file (COLOR_0),
    // producendo una livrea scura/appiattita.
    //
    // A DIFFERENZA di recolorLiveryTexture (che tinge SOLO i texel in
    // [0,LIVERY_HUE_MAX] di una texture-palette rosso-livrea, lasciando
    // intatti gli altri come "dettaglio"), qui NON si filtra per hue/sat:
    // verificato leggendo il COLOR_0 grezzo del .glb che il colore
    // originale di queste mesh non è affatto un rosso con dettagli scuri,
    // è un vero pattern mimetico multi-tono su tutta la superficie — con
    // quel filtro oltre l'80% dei vertici restava escluso dalla tinta e si
    // vedeva il mimetico originale sotto qualunque colore scelto (stesso
    // bug osservato nell'editor, vedi liveryPattern.js). Quando
    // forceNeutral è attivo (ruote/halo/wing, se mai passassero da questo
    // ramo) resta comunque neutro: nessuna tinta, solo lift di luminosità.
    // Muta l'array in place — il chiamante deve aver già clonato la
    // geometria/l'attributo prima di invocarla, altrimenti tinge anche
    // l'asset condiviso da tutte le istanze auto.
    function recolorLiveryVertexColors(colorAttr, hex, forceNeutral = false) {
        const [targetHue, targetSat, targetVal] = rgbToHsv(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);
        const arr = colorAttr.array;
        for (let i = 0; i < arr.length; i += 3) {
            const [h, s, v] = rgbToHsv(arr[i], arr[i + 1], arr[i + 2]);
            const liftedV = liftValue(v);
            let outHue, outSat, outVal;
            if (!forceNeutral) {
                outHue = targetHue; outSat = targetSat; outVal = targetVal * liftedV;
            } else {
                outHue = h; outSat = desaturateForBlack(s); outVal = liftedV;
            }
            const [nr, ng, nb] = hsvToRgb(outHue, outSat, outVal);
            arr[i] = nr; arr[i + 1] = ng; arr[i + 2] = nb;
        }
        colorAttr.needsUpdate = true;
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

    // Template voxel condiviso tra TUTTE le auto con livrea custom: la
    // geometria (posizione/normali/indici, ~137.000 facce) e la
    // classificazione per-cella (meshName/locked) dipendono solo dal modello
    // sorgente f1Car.glb — sempre lo stesso — MAI dal colore scelto dal
    // giocatore, quindi sono identiche per ogni auto. Ricalcolarle da zero
    // (Voxelizer.voxelizeModel: campionamento triangoli + costruzione
    // griglia) per ogni singola auto era il costo reale dietro al lag
    // segnalato dall'utente in localhost con più auto a livrea personalizzata
    // in pista contemporaneamente. Calcolata una sola volta al primo
    // caricamento, poi ogni auto riusa le stesse posizione/normali/indici
    // (mai mutati dopo il collasso ruote iniziale) e costruisce solo il
    // proprio attributo colore.
    let cachedVoxelTemplate = null;

    // loadCarModel: stessa identica implementazione di f1.js (prima
    // dell'estrazione), con UNA sola differenza di firma — scene/listener/
    // engineBuffer arrivano come terzo parametro (deps) invece che per
    // closure su variabili esterne di f1.js. Il loader GLTF viene creato
    // localmente ad ogni chiamata invece di essere condiviso a livello di
    // modulo: in f1.js era una variabile di modulo condivisa tra le
    // chiamate, ma ricrearla qui non cambia il comportamento (il costo è
    // trascurabile).
    // liveryColors (opzionale, 4b/B'): { [meshName]: number[]|Float32Array }
    // — una tripletta RGB per vertice, stesso ordine dell'attributo
    // "position" di quella mesh (Chassis/Nose/Plank). Se presente per una
    // mesh, sovrascrive la tinta-texture di recolorLiveryTexture con
    // colori-per-voxel già calcolati altrove (non da questa funzione — vedi
    // docs/superpowers/specs/2026-07-29-f1-livery-precomputed-colors-design.md).
    // Se assente (bot, ospiti, account senza livrea salvata): la carrozzeria
    // torna al comportamento pre-livree-custom, hue-shift col colore scelto
    // in lobby (playerColor) — MAI una fixture condivisa uguale per tutti
    // (bug reale: rendeva bot/ospiti tutti con la stessa identica livrea).
    function loadCarModel(playerColor, onReady, { scene, listener, engineBuffer }, liveryData = null) {
        const loader = new THREE.GLTFLoader();
        loader.load('/assets/custom/f1Car.glb', (gltf) => {
            const group = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(3.5, 3.5, 3.5);

            model.updateMatrixWorld(true);
            const carBBox0 = new THREE.Box3().setFromObject(model);
            const carCenter0 = carBBox0.getCenter(new THREE.Vector3());
            model.position.x -= carCenter0.x;
            model.position.z -= carCenter0.z;
            model.position.y -= carBBox0.min.y;

            const hex = parseInt(playerColor.replace('#', ''), 16);
            const namedWheels = [];
            const allMeshes = [];
            const meshSide = new Map();

            const colorsArray = (liveryData && liveryData.liveryColors) ? liveryData.liveryColors : liveryData;
            const hasCustomLivery = !!(colorsArray && colorsArray.length > 0 && typeof Voxelizer !== 'undefined');

            // 1. SCANSIONE MESH ORIGINALI E PREPARAZIONE FISICA
            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;
                child.material = child.material.clone();

                const nm = (child.name + ' ' + (child.parent?.name || '')).toLowerCase();
                const isWheelMesh = nm.includes('wheel') || nm.includes('tyre') || nm.includes('tire');
                // Ali, halo e T-cam restano SEMPRE nere/neutre, mai tinte col
                // colore giocatore/lobby (nodi reali del modello: Front_Wing,
                // Rear_Wing, Halo, TCam, Plank — verificato leggendo i node
                // name dal .glb). Nel fallback senza livrea custom sotto,
                // senza questa esclusione venivano ritinte col colore di
                // lobby insieme a Chassis/Nose, apparendo più scure ma
                // comunque colorate (bug segnalato dall'utente in localhost).
                const isFixedMesh = nm.includes('halo') || nm.includes('wing') || nm.includes('plank') || nm.includes('tcam');

                if (child.material.map) {
                    child.userData.pristineTex = child.material.map;
                }

                if (isWheelMesh) {
                    namedWheels.push(child);
                    const side = classifyWheelSide(nm);
                    if (side) meshSide.set(child, side);

                    if (child.material.map) {
                        child.material.map = recolorLiveryTexture(child.material.map, hex, true);
                        child.material.needsUpdate = true;
                    }
                } else if (hasCustomLivery) {
                    // TRUCCO MAGICO PER LA FISICA:
                    // Non usiamo child.visible = false, altrimenti il motore fisico la ignora!
                    // Spegniamo solo il MATERIALE. In questo modo il Raycaster e la fisica
                    // continueranno a usare la carrozzeria originale (leggerissima),
                    // ma il giocatore vedrà solo i Voxel sovrapposti!
                    child.material.visible = false;
                } else {
                    // Nessuna livrea custom: la carrozzeria resta visibile e
                    // ritinta col colore di lobby, stesso identico percorso
                    // già usato sopra per le ruote — forceNeutral=isFixedMesh,
                    // così Chassis/Nose prendono la tonalità scelta ma
                    // ali/halo/plank/tcam restano neutre (solo lift di
                    // luminosità), esattamente come le ruote.
                    if (child.material.map) {
                        child.material.map = recolorLiveryTexture(child.material.map, hex, isFixedMesh);
                        child.material.needsUpdate = true;
                    }
                }
                allMeshes.push(child);
            });

            group.add(model);

            // 2. CREAZIONE DEL VESTITO VOXEL — solo se esiste una livrea custom valida
            if (hasCustomLivery) {
                try {
                    // Geometria + classificazione: calcolate una sola volta
                    // (cache di modulo), riusate identiche per ogni auto — vedi
                    // commento su cachedVoxelTemplate più sopra.
                    let M = cachedVoxelTemplate;
                    if (!M) {
                        M = Voxelizer.voxelizeModel(model);
                        const templateGeo0 = M.isBufferGeometry ? M : (M.geometry || M);

                        // --- FIX RUOTE DOPPIE E CENTRO DI MASSA ---
                        // Collassiamo i voxel delle ruote nel centro logico della
                        // griglia. Se li mettessimo a (0,0,0) deformeremmo la
                        // hitbox verso il basso! Fatto una sola volta: la
                        // posizione è identica per ogni auto (mai per-giocatore).
                        if (M.meshName && M.faceCell) {
                            const posArr = templateGeo0.attributes.position.array;
                            const safeX = M.NX / 2, safeY = M.NY / 2, safeZ = M.NZ / 2;
                            for (let f = 0; f < M.faceCount; f++) {
                                const q = M.faceCell[f];
                                const partName = (M.meshName[q] || '').toLowerCase();
                                if (partName.includes('wheel') || partName.includes('tyre') || partName.includes('tire')) {
                                    const offset = f * 12;
                                    for (let v = 0; v < 4; v++) {
                                        posArr[offset + v * 3] = safeX;
                                        posArr[offset + v * 3 + 1] = safeY;
                                        posArr[offset + v * 3 + 2] = safeZ;
                                    }
                                }
                            }
                            templateGeo0.attributes.position.needsUpdate = true;
                        }
                        cachedVoxelTemplate = M;
                    }

                    // Geometria PER QUESTA auto: posizione/normali/indici
                    // riusati per riferimento dal template condiviso (mai
                    // mutati dopo il collasso ruote sopra), colore invece
                    // sempre nuovo — è l'unico dato specifico del giocatore.
                    const templateGeo = M.isBufferGeometry ? M : (M.geometry || M);
                    const voxelGeo = new THREE.BufferGeometry();
                    voxelGeo.setAttribute('position', templateGeo.attributes.position);
                    if (templateGeo.attributes.normal) voxelGeo.setAttribute('normal', templateGeo.attributes.normal);
                    if (templateGeo.index) voxelGeo.setIndex(templateGeo.index);
                    voxelGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colorsArray), 3));

                    // Ali/halo/plank/tcam neutralizzate PER QUESTA auto: il
                    // colore, a differenza della geometria sopra, è specifico
                    // del giocatore e va ricalcolato per ognuna.
                    if (M.meshName && M.faceCell) {
                        const colorArr = voxelGeo.attributes.color.array;
                        const tempColor = new THREE.Color();

                        for (let f = 0; f < M.faceCount; f++) {
                            const q = M.faceCell[f];
                            const partName = (M.meshName[q] || '').toLowerCase();

                            if ((partName.includes('wing') || partName.includes('halo') || partName.includes('plank') || partName.includes('tcam')) && M.locked[q]) {
                                // Neutralizziamo ali/halo/plank/tcam (stessa
                                // formula del fallback bot/ospite: tonalità
                                // invariata, desaturata, luminosità sollevata).
                                // Doppio filtro, non uno solo:
                                // 1) partName limita lo scope a queste 4 parti:
                                //    Chassis/Nose non entrano MAI qui, qualunque
                                //    sia il colore scelto dal giocatore.
                                // 2) M.locked[q] — calcolato da Voxelizer sul
                                //    colore ORIGINALE/fresco del modello (M.orig,
                                //    campionato una sola volta nella cache sopra),
                                //    MAI sul colore salvato in colorsArray —
                                //    decide se la cella è fisicamente nera nel
                                //    modello sorgente. Due tentativi precedenti
                                //    falliti qui: testare lum/sat sul colore
                                //    SALVATO schiariva per errore un primary
                                //    scuro scelto dal giocatore (es. #1a1a1a
                                //    appariva grigio); usare solo partName (voto
                                //    a maggioranza tra i triangoli campionati in
                                //    ogni cella) etichettava "front_wing" alcune
                                //    celle di confine visivamente Nose,
                                //    producendo voxel difettosi. M.locked, che
                                //    riflette il colore fisico originale (non il
                                //    voto sul nome-mesh né la scelta del
                                //    giocatore), evita entrambi.
                                const offset = f * 12;
                                for (let v = 0; v < 4; v++) {
                                    const idx = offset + v * 3;

                                    // ATTENZIONE spazio colore: colorArr qui è
                                    // LINEARE (Voxelizer applica
                                    // convertSRGBToLinear in campionamento,
                                    // vedi voxelizer.js), mentre
                                    // recolorLiveryTexture lavora su byte
                                    // canvas sRGB grezzi — andata/ritorno in
                                    // sRGB per usare la stessa formula nello
                                    // stesso spazio del fallback.
                                    tempColor.setRGB(colorArr[idx], colorArr[idx + 1], colorArr[idx + 2]);
                                    tempColor.convertLinearToSRGB();
                                    const [h, s, val] = rgbToHsv(tempColor.r, tempColor.g, tempColor.b);
                                    const [nr, ng, nb] = hsvToRgb(h, desaturateForBlack(s), liftValue(val));
                                    tempColor.setRGB(nr, ng, nb);
                                    tempColor.convertSRGBToLinear();
                                    colorArr[idx] = tempColor.r; colorArr[idx + 1] = tempColor.g; colorArr[idx + 2] = tempColor.b;
                                }
                            }
                        }
                        voxelGeo.attributes.color.needsUpdate = true;
                    }
                    voxelGeo.computeBoundingBox();
                    voxelGeo.computeBoundingSphere();

                    const voxelMat = new THREE.MeshStandardMaterial({
                        vertexColors: true,
                        roughness: 0.25,
                        metalness: 0.35
                    });

                    const voxelMesh = new THREE.Mesh(voxelGeo, voxelMat);
                    voxelMesh.castShadow = true;
                    voxelMesh.receiveShadow = true;

                    // SALVATAGGIO PRESTAZIONI E FISICA:
                    // Impediamo al motore di calcolare urti su questi 137.000 cubetti.
                    voxelMesh.raycast = function () { };

                    voxelMesh.scale.setScalar(M.voxelSize || 1);
                    if (M.gridOrigin) {
                        voxelMesh.position.copy(M.gridOrigin);
                    }

                    group.add(voxelMesh);
                } catch (err) {
                    // Estremo: il Voxelizer è esploso nonostante colorsArray valido.
                    // Riaccendiamo il materiale pristine (non ritinto) piuttosto che
                    // lasciare l'auto invisibile.
                    console.error("[F1] Errore critico nel Voxelizer:", err);
                    allMeshes.forEach(m => {
                        if (m.material) m.material.visible = true;
                    });
                }
            }

            // 3. RECUPERO NODI DELLE RUOTE E LOGICA FISICA
            const wheelParentSet = new Set();
            const wheelSideByNode = new Map();
            for (const wm of namedWheels) {
                const p = wm.parent;
                const node = (p && p.isObject3D && !(p.isMesh) && p !== model && p !== gltf.scene) ? p : wm;
                wheelParentSet.add(node);
                if (meshSide.has(wm) && !wheelSideByNode.has(node)) {
                    wheelSideByNode.set(node, meshSide.get(wm));
                }
            }

            let wheels = [...wheelParentSet];
            if (wheels.length < 2 && allMeshes.length > 1) {
                const carBB = new THREE.Box3().setFromObject(group);
                const thresh = carBB.min.y + (carBB.max.y - carBB.min.y) * 0.38;
                wheels = allMeshes.filter(m => {
                    const bb = new THREE.Box3().setFromObject(m);
                    return bb.getCenter(new THREE.Vector3()).y < thresh;
                });
            }

            if (wheels.length < 2 && allMeshes.length > 1) {
                const wGeo = new THREE.CylinderGeometry(0.88, 0.88, 0.65, 16);
                const wMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.1 });
                const wPos = [
                    [-2.7, 0.88, 3.6], [2.7, 0.88, 3.6],
                    [-2.7, 0.88, -3.4], [2.7, 0.88, -3.4],
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

            group.userData.wheels = wheels;
            group.userData.frontWheels = frontWheels;
            group.userData.wheelRot = 0;

            group.userData.setCompoundColor = function (compoundHex) {
                for (const w of namedWheels) {
                    if (!w.isMesh || !w.userData.pristineTex) continue;
                    const old = w.material.map;
                    w.material.map = recolorLiveryTexture(w.userData.pristineTex, hex, true, compoundHex);
                    if (old && old !== w.userData.pristineTex) old.dispose();
                    w.material.needsUpdate = true;
                }
            };

            for (const w of wheels) w.rotation.order = 'YXZ';

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
