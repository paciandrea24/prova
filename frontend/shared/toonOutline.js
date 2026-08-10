// frontend/shared/toonOutline.js
//
// Contorni neri su silhouette E spigoli interni, per il look cel-shaded
// (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md).
//
// Come funziona: la scena viene disegnata una seconda volta con
// MeshNormalMaterial su un buffer fuori schermo che porta con sé anche la
// profondità; un rettangolo a schermo intero confronta ogni pixel con i
// vicini e dove normale o profondità saltano disegna nero sopra il canvas.
//
// DUE SCELTE NON OVVIE:
//  1. la scena a colori resta disegnata DIRETTAMENTE sul canvas, che ha
//     l'antialias del browser: passando per un render target lo perderemmo, e
//     con campiture piatte la scalettatura si vedrebbe moltissimo. Il
//     contorno è quindi un overlay trasparente, non un filtro.
//  2. il passaggio delle normali NON deve ricalcolare le ombre: Three
//     rigenera la shadow map a ogni render() e con migliaia di istanze è la
//     parte più cara della scena. Si spegne shadowMap.autoUpdate per quel
//     passaggio (non shadowMap.enabled: cambiarlo a runtime cambia i define
//     dei materiali e ne forzerebbe la ricompilazione).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonOutline = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    let target = null, normalMat = null, quadScene = null, quadCam = null;
    let enabled = true, ready = false;

    // Draw call e triangoli della SCENA (non del rettangolo dei contorni),
    // catturati dentro render(). Vedi il commento nel punto in cui si
    // riempiono.
    const stats = { calls: 0, triangles: 0 };

    const uniforms = {
        uNormal: { value: null },
        uDepth: { value: null },
        uResolution: { value: null },      // THREE.Vector2, creato in init
        // Valori tarati dall'utente al playtest del 2026-08-10 con gli slider
        // del pannello, non scelti a tavolino.
        uThickness: { value: 0.5 },        // in pixel
        uNormalBias: { value: 0.34 },      // quanto deve girare la normale per fare bordo
        uDepthBias: { value: 0.071 },      // salto di profondità relativo
        // DUE dissolvenze separate, non una. I bordi di SILHOUETTE (salto di
        // profondità) restano leggibili anche da lontano e vanno tenuti; i
        // bordi fra facce dello stesso oggetto (salto di normale) a distanza
        // diventano rumore, perché i dettagli delle tribune — gradini, sbarre,
        // reti — scendono sotto la dimensione del pixel e ogni pixel diventa
        // un bordo. Con una dissolvenza sola, l'orizzonte si impasta di nero
        // (segnalato con screenshot al playtest del 2026-08-10).
        uFadeNormStart: { value: 45 },     // i bordi interni spariscono presto
        uFadeNormEnd: { value: 122 },
        uFadeStart: { value: 280 },        // le silhouette resistono più a lungo
        uFadeEnd: { value: 728 },
        uNear: { value: 0.1 },
        uFar: { value: 1200 },
    };

    function init(renderer, camera) {
        // La profondità in una texture richiede WebGL2 oppure l'estensione
        // WEBGL_depth_texture. Senza, i contorni restano spenti e il resto del
        // look continua a funzionare.
        if (!renderer.capabilities.isWebGL2 && !renderer.extensions.get('WEBGL_depth_texture')) {
            console.warn('[ToonOutline] profondità non disponibile: contorni disattivati');
            enabled = false;
            return;
        }

        // La camera deve vedere anche il layer degli oggetti esclusi dal
        // contorno: ToonStyle.excludeFromOutline li SPOSTA fuori dal layer 0,
        // e senza questa riga sparirebbero del tutto dalla scena.
        camera.layers.enable(ToonStyle.OUTLINE_EXCLUDE_LAYER);

        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        const w = Math.floor(size.x * pr), h = Math.floor(size.y * pr);

        const depth = new THREE.DepthTexture(w, h);
        depth.type = THREE.UnsignedIntType;   // 24 bit: a 16 la profondità lontana è troppo grossolana
        target = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            depthTexture: depth,
            depthBuffer: true,
            stencilBuffer: false,
        });

        // DoubleSide OBBLIGATORIO. Pista, ponti, cordoli e terreno sono
        // costruiti con side: DoubleSide perché il loro winding è specchiato
        // (vedi le note sul winding invertito da (x,−z) in docs/f1-notes).
        // Con il FrontSide di fabbrica quelle superfici verrebbero scartate
        // nel passaggio delle normali: non scrivendo profondità, ciò che sta
        // SOTTO resta scoperto e i suoi bordi finiscono disegnati sopra un
        // asfalto che nell'immagine finale li copre — è così che comparivano
        // i contorni dei piloni attraverso l'impalcato dei ponti.
        // Three inverte da sé le normali delle facce posteriori, quindi i
        // bordi restano corretti.
        normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
        uniforms.uNormal.value = target.texture;
        uniforms.uDepth.value = depth;
        uniforms.uResolution.value = new THREE.Vector2(w, h);

        const mat = new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            vertexShader: [
                'varying vec2 vUv;',
                'void main() {',
                '    vUv = uv;',
                '    gl_Position = vec4( position.xy, 0.0, 1.0 );',
                '}',
            ].join('\n'),
            fragmentShader: [
                'uniform sampler2D uNormal;',
                'uniform sampler2D uDepth;',
                'uniform vec2 uResolution;',
                'uniform float uThickness;',
                'uniform float uNormalBias;',
                'uniform float uDepthBias;',
                'uniform float uFadeNormStart;',
                'uniform float uFadeNormEnd;',
                'uniform float uFadeStart;',
                'uniform float uFadeEnd;',
                'uniform float uNear;',
                'uniform float uFar;',
                'varying vec2 vUv;',
                // dalla profondità del buffer (non lineare) alla distanza in
                // unità di gioco: senza linearizzare, la soglia di salto
                // varrebbe solo a pochi metri dalla camera
                'float lin( float d ) {',
                '    float z = d * 2.0 - 1.0;',
                '    return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );',
                '}',
                'void main() {',
                '    vec2 px = uThickness / uResolution;',
                '    float dC = lin( texture2D( uDepth, vUv ).x );',
                '    vec3 nC = normalize( texture2D( uNormal, vUv ).xyz * 2.0 - 1.0 );',
                '    float bordoN = 0.0;',
                '    float bordoD = 0.0;',
                '    vec2 offs[4];',
                '    offs[0] = vec2( px.x, 0.0 );',
                '    offs[1] = vec2( -px.x, 0.0 );',
                '    offs[2] = vec2( 0.0, px.y );',
                '    offs[3] = vec2( 0.0, -px.y );',
                '    for ( int i = 0; i < 4; i++ ) {',
                '        vec2 uv = vUv + offs[i];',
                '        vec3 n = normalize( texture2D( uNormal, uv ).xyz * 2.0 - 1.0 );',
                '        bordoN = max( bordoN, 1.0 - clamp( dot( n, nC ), 0.0, 1.0 ) );',
                '        float d = lin( texture2D( uDepth, uv ).x );',
                // salto RELATIVO alla distanza: a 300 unità un dislivello di
                // mezza unità non è un bordo, a 3 unità lo è
                '        bordoD = max( bordoD, abs( d - dC ) / max( dC, 1.0 ) );',
                '    }',
                // Ogni tipo di bordo con la propria dissolvenza: gli interni
                // (normali) svaniscono presto, le silhouette (profondità)
                // resistono.
                '    float eN = smoothstep( uNormalBias, uNormalBias * 1.6, bordoN )',
                '             * ( 1.0 - smoothstep( uFadeNormStart, uFadeNormEnd, dC ) );',
                '    float eD = smoothstep( uDepthBias, uDepthBias * 1.8, bordoD )',
                '             * ( 1.0 - smoothstep( uFadeStart, uFadeEnd, dC ) );',
                '    gl_FragColor = vec4( 0.0, 0.0, 0.0, max( eN, eD ) );',
                '}',
            ].join('\n'),
        });

        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        quad.frustumCulled = false;
        quadScene = new THREE.Scene();
        quadScene.add(quad);
        quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        ready = true;
    }

    function setSize(renderer) {
        if (!ready) return;
        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        const w = Math.floor(size.x * pr), h = Math.floor(size.y * pr);
        target.setSize(w, h);
        uniforms.uResolution.value.set(w, h);
    }

    function render(renderer, scene, camera) {
        if (!ready || !enabled) {
            renderer.render(scene, camera);
            return;
        }

        uniforms.uNear.value = camera.near;
        uniforms.uFar.value = camera.far;

        // 1. normali + profondità, senza luci né ombre
        const shadowAuto = renderer.shadowMap.autoUpdate;
        const layerMask = camera.layers.mask;
        const bg = scene.background;
        renderer.shadowMap.autoUpdate = false;
        camera.layers.disable(ToonStyle.OUTLINE_EXCLUDE_LAYER);
        scene.background = null;
        scene.overrideMaterial = normalMat;
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, camera);
        scene.overrideMaterial = null;
        renderer.setRenderTarget(null);
        scene.background = bg;
        camera.layers.mask = layerMask;
        renderer.shadowMap.autoUpdate = shadowAuto;

        // 2. scena a colori, direttamente sul canvas (con antialias)
        renderer.render(scene, camera);

        // Contatori catturati QUI, non dopo: Three azzera renderer.info a ogni
        // render(), quindi chi legge a fine frame vedrebbe solo il rettangolo
        // dei contorni — una draw call e due triangoli, numeri inutili. Il
        // pannello legge questi.
        stats.calls = renderer.info.render.calls;
        stats.triangles = renderer.info.render.triangles;

        // 3. contorni sopra, senza cancellare quello che c'è
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(quadScene, quadCam);
        renderer.autoClear = autoClear;
    }

    return {
        init, render, setSize, uniforms, stats,
        get enabled() { return enabled; },
        setEnabled(on) { enabled = !!on; },
    };
});
