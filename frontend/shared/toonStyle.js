// frontend/shared/toonStyle.js
//
// Motore di stile cel-shaded del gioco F1: converte i materiali della scena
// in MeshToonMaterial e inietta in tutti lo stesso patch shader — luce a
// fasce, fascia d'ombra colorata, correzione di saturazione, terreno dipinto.
// Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md.
//
// PERCHÉ NELLO SHADER: nel gioco il colore arriva da tre meccanismi diversi
// (colore per materiale negli asset del circuito, texture-palette + vertex
// color nell'auto, soli vertex color in pista e prato). Correggerlo dopo che
// texture e vertex color hanno detto la loro è l'unico punto in cui la regola
// vale per tutti e tre.
//
// Nessun riferimento a THREE fuori dalle funzioni: così `node --test` può
// caricare questo file per verificare buildPatch senza Three.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonStyle = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const Palette = (typeof module === 'object' && module.exports)
        ? require('./toonPalette.js')
        : null;   // nel browser è il globale ToonPalette

    function palette() {
        return Palette || ToonPalette;
    }

    // Layer riservato agli oggetti che non devono avere il contorno (effetti,
    // segnalatori): il passaggio delle normali di toonOutline lo salta.
    //
    // ATTENZIONE, due conseguenze non ovvie:
    //  - `layers.set` SPOSTA l'oggetto su questo layer togliendolo dal layer 0,
    //    quindi la camera deve abilitare anche il layer 2 per continuare a
    //    vederlo (lo fa ToonOutline.init). Con `layers.enable` l'oggetto
    //    resterebbe anche sul layer 0 e continuerebbe a comparire nel
    //    passaggio delle normali: l'esclusione non avrebbe alcun effetto.
    //  - un oggetto fuori dal layer 0 non proietta più ombra (la shadow map
    //    confronta i layer dell'oggetto con quelli della luce). Va bene per gli
    //    effetti, che ombra non ne fanno: non usarlo su oggetti solidi.
    const OUTLINE_EXCLUDE_LAYER = 2;

    // Marcatore di versione, mostrato nel titolo del pannello (F9). Serve a
    // rispondere senza dubbi alla domanda "il browser sta eseguendo il codice
    // nuovo o quello in cache?": bumpare i ?v= degli script non basta se è
    // f1.html stesso a essere servito dalla cache, e in quel caso una
    // modifica sembra non aver avuto alcun effetto.
    // Va aggiornato quando si cambia qualcosa che l'utente deve poter
    // verificare in un playtest.
    const BUILD = '20260810-o';

    // ── uniform CONDIVISE ────────────────────────────────────────────
    // Un solo oggetto per uniform, copiato per riferimento in ogni materiale:
    // muovere .value qui (dal pannello o dalla console) aggiorna tutta la
    // scena senza ricompilare nulla.
    let shared = null;

    // ── texture del terreno dipinto ──────────────────────────────────
    // Rumore e ciuffi arrivano da texture PRECALCOLATE, non da funzioni
    // procedurali: la versione con value-noise in GLSL costava 12 sin() per
    // pixel su una superficie che riempie mezzo schermo. Qui sono 3 letture.
    // Entrambe tileable e campionate in coordinate mondo XZ, perché le mesh
    // del terreno non hanno UV.

    // Macchie morbide: una griglia grossolana di valori casuali, lasciata
    // interpolare dal filtro lineare della GPU. Il wrap fa combaciare i bordi
    // da solo, quindi il tile non si vede.
    function noiseTexture(celle) {
        const c = document.createElement('canvas');
        c.width = c.height = celle;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(celle, celle);
        for (let i = 0; i < celle * celle; i++) {
            const v = Math.floor(Math.random() * 256);
            img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
            img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        return tex;
    }

    // Ciuffi d'erba: trattini scuri sparsi, come quelli disegnati sul prato
    // del riferimento. Ogni tratto viene disegnato anche sulle otto copie
    // attorno al riquadro, così quelli a cavallo del bordo non risultano
    // tagliati quando la texture si ripete.
    function tuftTexture(lato) {
        const c = document.createElement('canvas');
        c.width = c.height = lato;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';        // bianco = nessun ciuffo
        ctx.fillRect(0, 0, lato, lato);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = Math.max(1, lato / 170);
        ctx.lineCap = 'round';
        for (let i = 0; i < 70; i++) {
            const x = Math.random() * lato, y = Math.random() * lato;
            const lung = lato * (0.020 + Math.random() * 0.022);
            const inclina = (Math.random() - 0.5) * 0.9;
            for (let ox = -lato; ox <= lato; ox += lato) {
                for (let oy = -lato; oy <= lato; oy += lato) {
                    ctx.beginPath();
                    ctx.moveTo(x + ox, y + oy);
                    ctx.quadraticCurveTo(
                        x + ox + inclina * lung * 0.5, y + oy - lung * 0.6,
                        x + ox + inclina * lung, y + oy - lung
                    );
                    ctx.stroke();
                }
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        return tex;
    }

    function sharedUniforms() {
        if (!shared) {
            const P = palette();
            const nelBrowser = (typeof document !== 'undefined' && typeof THREE !== 'undefined');
            // In Node (test) THREE non esiste: le uniform di colore usano un
            // sostituto che espone solo ciò che il patch tocca.
            const colore = (hex) => (typeof THREE === 'undefined')
                ? { r: 0, g: 0, b: 0, set() {}, setRGB() {} }
                : new THREE.Color(hex);
            shared = {
                uOn: { value: 1 },
                // Notturno: 0 di giorno, 1 di notte. Condivisa, perché
                // l'ora del giorno è una sola per tutta la scena. La TINTA
                // invece è per materiale (vedi buildPatch): l'asfalto sotto
                // le torri faro non è buio come il prato dietro le tribune.
                uNotte: { value: 0 },
                uShadowTint: { value: colore(P.SHADOW_TINT) },
                uGrassDark: { value: colore(P.SURFACES.grassDark) },
                uGrassLight: { value: colore(P.SURFACES.grassLight) },
                uPatchScale: { value: 0.012 },   // 1/unità: una chiazza ogni ~80 unità
                uPatchAmount: { value: 0.55 },   // quanto le chiazze si discostano dal verde base
                uTuftAmount: { value: 0.6 },     // forza dei trattini d'erba
                uTuftScale: { value: 0.125 },    // il riquadro dei ciuffi copre ~8 unità
                uNoiseTex: { value: nelBrowser ? noiseTexture(16) : null },
                uTuftTex: { value: nelBrowser ? tuftTexture(256) : null },
            };
        }
        return shared;
    }

    // Sostituzione che NON fallisce in silenzio. String.replace su una
    // stringa assente restituisce l'originale senza sollevare nulla: il
    // materiale resterebbe senza patch e nessuno se ne accorgerebbe.
    function replaceOrThrow(source, needle, replacement) {
        if (source.indexOf(needle) === -1) {
            throw new Error(`[ToonStyle] chunk non trovato nello shader: ${needle} — ` +
                'la versione di Three è cambiata? Il patch va aggiornato.');
        }
        return source.replace(needle, replacement);
    }

    function buildPatch(shader, opts) {
        const o = opts || {};
        Object.assign(shader.uniforms, sharedUniforms());
        // Uniform PRIVATE del materiale: la saturazione è diversa fra
        // scenografia e auto, il flag terreno vale per le sole mesh del prato.
        shader.uniforms.uSat = { value: o.saturation || 0 };
        shader.uniforms.uIsGround = { value: o.isGround ? 1 : 0 };
        // Quanto questa superficie resta chiara di notte. Il valore sta
        // qui e non nel codice dello shader apposta: cambiare una uniform
        // non fa ricompilare il programma, quindi tutti i materiali
        // continuano a condividerne uno solo.
        shader.uniforms.uTintaNotte = {
            value: (typeof THREE === 'undefined')
                ? { r: 0, g: 0, b: 0, set() {}, setRGB() {} }
                : new THREE.Color(o.tintaNotte !== undefined ? o.tintaNotte : palette().ORARI.notte.tinta)
        };

        // ── vertex: posizione e normale in coordinate MONDO ───────────
        // Serve l'instanceMatrix: la scenografia è tutta InstancedMesh e
        // senza di essa ogni istanza userebbe la posizione dell'origine del
        // modello (chiazze identiche su tutti gli oggetti, e sul terreno
        // niente affatto).
        shader.vertexShader = 'varying vec3 vToonPos;\nvarying vec3 vToonNorm;\n' +
            replaceOrThrow(shader.vertexShader, '#include <begin_vertex>', [
                '#include <begin_vertex>',
                '#ifdef USE_INSTANCING',
                '    vToonPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;',
                '    vToonNorm = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );',
                '#else',
                '    vToonPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
                '    vToonNorm = normalize( mat3( modelMatrix ) * objectNormal );',
                '#endif',
            ].join('\n'));

        // ── fragment ──────────────────────────────────────────────────
        let f = 'uniform float uOn;\nuniform vec3 uShadowTint;\nuniform float uSat;\n' +
            'uniform float uIsGround;\nuniform vec3 uGrassDark;\nuniform vec3 uGrassLight;\n' +
            'uniform float uPatchScale;\nuniform float uPatchAmount;\n' +
            'uniform float uTuftAmount;\nuniform float uTuftScale;\n' +
            'uniform sampler2D uNoiseTex;\nuniform sampler2D uTuftTex;\n' +
            'uniform float uNotte;\nuniform vec3 uTintaNotte;\n' +
            'varying vec3 vToonPos;\nvarying vec3 vToonNorm;\n' + shader.fragmentShader;

        // Fascia in ombra COLORATA: la funzione che mappa l'angolo di luce
        // sulla fascia viene ridefinita per lerpare verso la tinta invece di
        // restare grigia.
        f = replaceOrThrow(f, '#include <gradientmap_pars_fragment>', [
            '#ifdef USE_GRADIENTMAP',
            '    uniform sampler2D gradientMap;',
            '#endif',
            'vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {',
            '    float dotNL = dot( normal, lightDirection );',
            '    vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );',
            '    #ifdef USE_GRADIENTMAP',
            '        float band = texture2D( gradientMap, coord ).r;',
            '    #else',
            '        float band = ( coord.x < 0.7 ) ? 0.7 : 1.0;',
            '    #endif',
            '    vec3 tinted = mix( uShadowTint, vec3( 1.0 ), band );',
            '    return mix( vec3( band ), tinted, uOn );',
            '}',
        ].join('\n'));

        // Correzione del colore BASE (dopo map e vertex color, prima
        // dell'illuminazione) + terreno dipinto.
        f = replaceOrThrow(f, '#include <color_fragment>', [
            '#include <color_fragment>',
            '{',
            '    float luma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
            '    vec3 sat = luma + ( diffuseColor.rgb - luma ) * ( 1.0 + uSat );',
            '    diffuseColor.rgb = mix( diffuseColor.rgb, clamp( sat, 0.0, 1.0 ), uOn );',
            // La condizione include i due PESI, non solo "sono terreno": il
            // rumore qui sotto costa 12 sin() per pixel e il terreno riempie
            // metà schermo, quindi con chiazze e ciuffi a zero si pagavano
            // oltre dieci milioni di funzioni trascendenti per frame per un
            // risultato moltiplicato per zero. Sono uniform, quindi il ramo è
            // uguale per tutti i pixel e la GPU lo salta davvero.
            // ⚠ Quando al Task 7 si accenderanno chiazze e ciuffi il costo
            // tornerà: lì il rumore va sostituito da una TEXTURE tileable
            // precalcolata (2 letture invece di 12 sin), come il blotch di
            // fps.js.
            '    if ( uIsGround > 0.5 && uOn > 0.5 && ( uPatchAmount > 0.001 || uTuftAmount > 0.001 ) ) {',
            // chiazze: due letture della stessa texture a scale diverse, in
            // coordinate mondo XZ (il terreno non ha UV, è generato senza
            // coordinate di texture)
            '        float n = texture2D( uNoiseTex, vToonPos.xz * uPatchScale ).r * 0.65',
            '                + texture2D( uNoiseTex, vToonPos.xz * uPatchScale * 3.1 ).r * 0.35;',
            '        vec3 chiazza = mix( uGrassDark, uGrassLight, smoothstep( 0.35, 0.65, n ) );',
            '        diffuseColor.rgb = mix( diffuseColor.rgb, chiazza, uPatchAmount );',
            // ciuffi: trattini disegnati sulla texture (nero = tratto)
            '        float tratto = ( 1.0 - texture2D( uTuftTex, vToonPos.xz * uTuftScale ).r ) * uTuftAmount;',
            '        diffuseColor.rgb *= 1.0 - tratto * 0.45;',
            '    }',
            // Ultimo passaggio, dopo le chiazze del prato: così il notturno
            // prende TUTTO — superfici generate in JS e modelli che arrivano
            // dai GLB con i colori già cotti dentro, che altrimenti
            // resterebbero luminosi in mezzo a un mondo spento.
            '    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uTintaNotte, uNotte );',
            '}',
        ].join('\n'));

        // NOTA STORICA (2026-08-10). Qui c'era una compressione delle alte
        // luci agganciata a `outgoingLight` (knee/shoulder, come
        // _worldFxPatch in fps.js). È stata RIMOSSA: al playtest ha coinciso
        // con la comparsa di scatti, e soprattutto non serviva — i colori
        // chiari sfondavano perché la somma delle intensità delle luci
        // valeva ~1.9, non perché mancasse un tetto. Il contrasto delle fasce
        // si governa dalle INTENSITÀ in f1.js, che non costano nulla per
        // pixel. Se un giorno servisse davvero un tetto, rimetterlo solo con
        // una misura del frame peggiore prima e dopo.

        shader.fragmentShader = f;
        return shader;
    }

    // ── conversione dei materiali ────────────────────────────────────
    let gradientMap = null;

    function bandGradientMap() {
        if (!gradientMap) {
            const P = palette();
            const data = new Uint8Array(P.BANDS.map((v) => Math.round(v * 255)));
            gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.LuminanceFormat);
            gradientMap.minFilter = THREE.NearestFilter;
            gradientMap.magFilter = THREE.NearestFilter;
            gradientMap.generateMipmaps = false;
            gradientMap.needsUpdate = true;
        }
        return gradientMap;
    }

    // Stato di render comune a tutti i Material che il materiale nuovo deve
    // EREDITARE: senza, il toon riparte dai valori di fabbrica e cambia il
    // comportamento a schermo anche a parità di colore.
    //
    // `visible` è la più insidiosa e ha già causato un bug reale (2026-08-10):
    // carLoader.js nasconde la carrozzeria originale sotto il vestito voxel
    // spegnendo il MATERIALE e non la mesh — la mesh deve restare in scena per
    // la fisica. Un materiale nuovo con visible=true faceva riemergere la
    // carrozzeria, che ha ancora la texture sorgente rossa, e le due superfici
    // compenetrate si contendevano ogni pixel: puntini rossi che cambiavano
    // durante la marcia.
    const MATERIAL_STATE = [
        'visible', 'side', 'transparent', 'opacity', 'alphaTest', 'depthTest',
        'depthWrite', 'colorWrite', 'blending', 'premultipliedAlpha', 'dithering',
        'toneMapped', 'fog', 'flatShading', 'wireframe', 'shadowSide',
        'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
    ];

    function copyMaterialState(src, dst) {
        for (const chiave of MATERIAL_STATE) {
            // Una proprietà assente nel sorgente non deve sovrascrivere il
            // default del materiale nuovo con undefined.
            if (src[chiave] !== undefined) dst[chiave] = src[chiave];
        }
        return dst;
    }

    function toonFrom(std, opts) {
        const m = new THREE.MeshToonMaterial({
            color: std.color ? std.color.clone() : undefined,
            map: std.map || null,
            gradientMap: bandGradientMap(),
            vertexColors: std.vertexColors === true,
        });
        copyMaterialState(std, m);
        m.name = std.name;
        m.userData = Object.assign({}, std.userData);
        // Tutti i materiali ricevono una closure con lo STESSO corpo: Three
        // include `onBeforeCompile.toString()` nella chiave di cache del
        // programma, quindi il testo identico fa condividere a tutti un unico
        // programma GL compilato. Ciò che varia fra un materiale e l'altro
        // (saturazione, flag terreno) sta nelle uniform private, non nel
        // codice — se finisse nel codice, ogni materiale otterrebbe un
        // programma diverso e la compilazione si moltiplicherebbe.
        m.onBeforeCompile = (shader) => buildPatch(shader, opts);
        m.userData.toonified = true;
        return m;
    }

    function convert(root, opts) {
        const o = Object.assign(
            { saturation: palette().SATURATION.scenery, isGround: false },
            opts || {}
        );
        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            const out = mats.map((m) => (m && m.isMeshStandardMaterial ? toonFrom(m, o) : m));
            child.material = Array.isArray(child.material) ? out : out[0];
        });
        return root;
    }

    function setEnabled(on) {
        sharedUniforms().uOn.value = on ? 1 : 0;
    }

    // Accende o spegne il notturno su TUTTI i materiali in una volta: è una
    // uniform condivisa, non una proprietà per materiale. Costa un numero e
    // non una ricompilazione, quindi si potrà anche animare (un tramonto, un
    // giro che finisce col buio) senza scatti.
    function impostaNotturno(on) {
        sharedUniforms().uNotte.value = on ? 1 : 0;
    }

    // Rete di sicurezza contro l'errore più probabile: un punto di
    // caricamento dimenticato lascia un oggetto col materiale vecchio, che
    // stona senza motivo apparente.
    function audit(scene) {
        const rimasti = [];
        scene.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) {
                if (m && m.isMeshStandardMaterial) {
                    rimasti.push(child.name || m.name || '(senza nome)');
                    break;
                }
            }
        });
        return rimasti;
    }

    function excludeFromOutline(object) {
        object.traverse((c) => c.layers.set(OUTLINE_EXCLUDE_LAYER));
    }

    return {
        buildPatch, convert, setEnabled, impostaNotturno, audit, excludeFromOutline,
        copyMaterialState, MATERIAL_STATE,
        OUTLINE_EXCLUDE_LAYER, BUILD,
        get uniforms() { return sharedUniforms(); },
    };
});
