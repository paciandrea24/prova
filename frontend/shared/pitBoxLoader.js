// frontend/shared/pitBoxLoader.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PitBoxLoader = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Misurato campionando via UV ogni faccia della mesh reale di
    // f1PitBox.glb (palette 256x1, 7 colori effettivamente usati): rosso
    // tetto/righe (221,53,53) -> h=0°, s=0.76; pareti bianche
    // (238,238,238), base/ombre grigie (64/85/119/136, tutte r=g=b) ->
    // saturazione 0 esatta; insegna gialla (255,204,51) -> h=45°, s=0.80.
    // Soglie a metà dei margini: nessun grigio/bianco/giallo può mai
    // cadere nella finestra "rosso".
    const RED_HUE_MAX = 20;
    const RED_SAT_MIN = 0.3;

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

    // r,g,b in [0,255]. Vero solo per il rosso "livrea" del box (tetto +
    // righe), mai per pareti/base/insegna — vedi soglie sopra.
    function isRedTexel(r, g, b) {
        const [h, s] = rgbToHsv(r / 255, g / 255, b / 255);
        return s >= RED_SAT_MIN && (h <= RED_HUE_MAX || h >= 360 - RED_HUE_MAX);
    }

    // A differenza della livrea auto (recolorLiveryTexture in
    // carLoader.js), qui non c'è ombreggiatura da preservare: il rosso del
    // box è un unico tono piatto (nessuna variante più scura trovata
    // campionando la palette), quindi il texel rosso viene sostituito col
    // colore target ESATTO — S/V dal target, non dalla texture sorgente
    // (stesso principio di recolorLiveryTexture), qui senza il lift di
    // luminosità che lì serviva solo per le ombre AO scure del modello auto.
    function recolorPitBoxTexture(sourceTexture, hex) {
        const img = sourceTexture.image;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const tr = (hex >> 16) & 0xff, tg = (hex >> 8) & 0xff, tb = hex & 0xff;

        for (let i = 0; i < data.length; i += 4) {
            if (!isRedTexel(data[i], data[i + 1], data[i + 2])) continue;
            data[i] = tr; data[i + 1] = tg; data[i + 2] = tb;
        }
        ctx.putImageData(imageData, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY = sourceTexture.flipY;
        tex.wrapS = sourceTexture.wrapS;
        tex.wrapT = sourceTexture.wrapT;
        // Palette di lookup (256x1), non immagine spaziale: stesso motivo
        // di recolorLiveryTexture, altrimenti il filtro lineare mescola i
        // colori di voxel adiacenti nella striscia.
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = sourceTexture.colorSpace;
        tex.needsUpdate = true;
        return tex;
    }

    // Carica un box colorato indipendente per un giocatore. placement =
    // { x, y, z, rotY } già calcolato dal chiamante (frontend/f1.js:
    // offset laterale dalla corsia + rotazione verso di essa, stessa
    // tecnica di trackScenery.js::buildPaddockLayout) — questo modulo si
    // occupa solo di caricare/ricolorare/posizionare il modello, non della
    // geometria della corsia box. Niente InstancedMesh/materiale condiviso
    // come per la scenografia decorativa (loadScenery in f1.js): ogni box
    // ha un colore diverso.
    // onError (opzionale): senza, un fallimento di caricamento (rete,
    // 404...) restava un console.error muto — combinato con la guardia
    // pendingPitBoxLoads lato chiamante (frontend/f1.js), quel colore non
    // veniva MAI più ritentato per il resto della gara (box mancante in
    // permanenza). Chiamato al posto di — non in aggiunta a — console.error,
    // così il chiamante può liberare la propria guardia e ritentare al
    // prossimo state update, mantenendo comunque un log.
    function loadPitBoxModel(playerColor, placement, onReady, onError) {
        const loader = new THREE.GLTFLoader();
        const hex = parseInt(playerColor.replace('#', ''), 16);
        loader.load('/assets/custom/f1PitBox.glb', (gltf) => {
            const model = gltf.scene;
            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;
                child.material = child.material.clone();
                if (child.material.map) {
                    child.material.map = recolorPitBoxTexture(child.material.map, hex);
                    child.material.needsUpdate = true;
                }
            });
            model.position.set(placement.x, placement.y || 0, placement.z);
            model.rotation.y = placement.rotY;
            onReady(model);
        }, undefined, (err) => {
            console.error('[F1] Errore caricando f1PitBox.glb:', err);
            if (onError) onError(err);
        });
    }

    return { loadPitBoxModel, recolorPitBoxTexture, isRedTexel };
});
