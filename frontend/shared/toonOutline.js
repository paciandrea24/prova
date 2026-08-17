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
    // `ms` è il tempo speso a DISEGNARE, separato dal tempo del frame: se il
    // frame dura 46 ms ma il disegno ne prende 8, il ritardo viene da
    // altrove — elaborazione dei pacchetti dal server, aggiornamenti del DOM,
    // raccolta della memoria — e non serve a nulla alleggerire la grafica.
    const stats = { calls: 0, triangles: 0, ms: 0 };

    // ── Perché la soglia di profondità non può essere un numero fisso ──
    //
    // Il bordo di silhouette si accende dove il salto RELATIVO di profondità
    // fra due pixel vicini supera una soglia. Su una superficie PIANA vista di
    // taglio quel salto non è un difetto: è geometria, e vale
    //
    //     salto ≈ (angolo di un pixel) × distanza / (altezza della camera)
    //
    // — inversamente proporzionale a quanto la camera è alta da terra. Una
    // soglia fissa è quindi tarata su UNA sola altezza di camera. In F1 le due
    // telecamere sono lo stesso oggetto (stessi near/far/fov) ma stanno a 5.5
    // (terza persona) e 1.95 (halo) unità: sull'halo il terreno produce un
    // salto 2.8 volte più grande, veniva scambiato per silhouette, e
    // all'orizzonte compariva una banda nera piena proprio sopra la pista
    // (segnalato il 2026-08-17; la stessa taratura in terza persona era
    // corretta, ed è per questo che il difetto sembrava sparito).
    //
    // Rimedio: alla soglia base si somma il salto che una superficie piana
    // produrrebbe in quel punto, ricavato dall'inclinazione fra normale e
    // raggio di vista — la normale è già nel buffer che lo shader legge. Il
    // criterio diventa "è una discontinuità vera" invece di "è un salto
    // grosso", e smette di dipendere dall'altezza della camera. Sulle facce
    // frontali la compensazione è nulla: i valori tarati al playtest del
    // 2026-08-10 conservano esattamente il significato che avevano.
    //
    // Le tre funzioni sotto sono la SORGENTE della formula: lo shader viene
    // costruito interpolandone le costanti, e `toonOutline.test.js` le misura
    // sui numeri veri del gioco.

    // Superficie perfettamente parallela allo sguardo = pendenza infinita: il
    // tetto la limita. Va scelto in modo che il terreno torni sopra soglia
    // solo OLTRE uFadeEnd, dove il contorno è comunque spento (con 0.003 e
    // camera a 1.95 succede a ~1500 unità, ben oltre le 728 della dissolvenza).
    const NDV_MIN = 0.003;
    const SLOPE_K = 2;

    // Quanto varia la profondità, in proporzione a se stessa e per radiante di
    // apertura, su un piano la cui normale forma un coseno `ndv` col raggio.
    function grazingSlope(ndv) {
        const c = Math.min(1, Math.abs(ndv));
        return Math.sqrt(Math.max(0, 1 - c * c)) / Math.max(c, NDV_MIN);
    }

    // Radianti coperti da un pixel verticale. I pixel sono quadrati, quindi
    // vale anche in orizzontale.
    function pixelAngle(fovDeg, heightPx) {
        return 2 * Math.tan(fovDeg * Math.PI / 360) / heightPx;
    }

    function depthThreshold(depthBias, slopeK, slope, pxAngle, thickness) {
        return depthBias + slopeK * slope * pxAngle * thickness;
    }

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
        // Compensazione delle superfici RADENTI (vedi il blocco qui sotto).
        // 0 = comportamento precedente al 2026-08-17, soglia fissa.
        uSlopeK: { value: SLOPE_K },
        // Quanto è pieno il nero del tratto (1 = nero pieno, com'era fino al
        // 2026-08-17). 0.5 scelto dall'utente col pannello al playtest del
        // 2026-08-17: il tratto pieno induriva troppo il disegno.
        uStrength: { value: 0.5 },
        uPixelAngle: { value: 0.0014 },    // radianti coperti da un pixel, da fov/risoluzione
        uTanHalfFov: { value: 0.637 },
        uAspect: { value: 1.777 },
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
                'uniform float uSlopeK;',
                'uniform float uStrength;',
                'uniform float uPixelAngle;',
                'uniform float uTanHalfFov;',
                'uniform float uAspect;',
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
                // Soglia di profondità del pixel: base + il salto che una
                // superficie piana con QUESTA inclinazione produrrebbe qui.
                // Il raggio di vista si ricava dalla posizione sullo schermo:
                // usare l'asse della camera al suo posto sbaglia fino a 32°
                // ai bordi dell'inquadratura, dove l'orizzonte spesso sta.
                '    vec3 vDir = normalize( vec3(',
                '        ( vUv.x * 2.0 - 1.0 ) * uTanHalfFov * uAspect,',
                '        ( vUv.y * 2.0 - 1.0 ) * uTanHalfFov,',
                '        -1.0 ) );',
                '    float ndv = min( 1.0, abs( dot( nC, vDir ) ) );',
                `    float pend = sqrt( max( 0.0, 1.0 - ndv * ndv ) ) / max( ndv, ${NDV_MIN} );`,
                '    float sogliaD = uDepthBias + uSlopeK * pend * uPixelAngle * uThickness;',
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
                '    float eD = smoothstep( sogliaD, sogliaD * 1.8, bordoD )',
                '             * ( 1.0 - smoothstep( uFadeStart, uFadeEnd, dC ) );',
                '    gl_FragColor = vec4( 0.0, 0.0, 0.0, max( eN, eD ) * uStrength );',
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

    // Scala del buffer di normali e profondità rispetto allo schermo. È una
    // delle TRE passate che la scena paga a ogni frame, e su questo gioco il
    // frame lo decidono i pixel: a 0.5 quella passata ne riempie un quarto.
    // Il prezzo si vede solo sui contorni, che vengono cercati su
    // un'immagine più piccola e quindi si arrotondano un poco; il colore
    // della scena non passa di qui e resta a piena risoluzione.
    let scala = 1;

    function setScala(renderer, s) {
        scala = s;
        setSize(renderer);
    }

    function setSize(renderer) {
        if (!ready) return;
        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        const w = Math.max(1, Math.floor(size.x * pr * scala));
        const h = Math.max(1, Math.floor(size.y * pr * scala));
        target.setSize(w, h);
        // ⚠️ uResolution è la dimensione del BUFFER, non dello schermo: il
        // fragment shader la usa per spostarsi di un texel quando cerca i
        // bordi, e con un buffer ridotto un texel non è più un pixel.
        uniforms.uResolution.value.set(w, h);
    }

    function render(renderer, scene, camera) {
        const t0 = performance.now();
        if (!ready || !enabled) {
            renderer.render(scene, camera);
            stats.calls = renderer.info.render.calls;
            stats.triangles = renderer.info.render.triangles;
            stats.ms = performance.now() - t0;
            return;
        }

        uniforms.uNear.value = camera.near;
        uniforms.uFar.value = camera.far;
        // La compensazione delle superfici radenti ha bisogno di sapere quanto
        // "mondo" copre un pixel: dipende da fov e risoluzione, entrambi
        // variabili a runtime (ridimensionamento della finestra), quindi si
        // rileggono a ogni frame invece di essere fissati in init.
        // Si legge uResolution e non la dimensione dello schermo di proposito:
        // è la misura del BUFFER, quindi con `setScala(0.5)` un texel copre il
        // doppio dell'angolo e la soglia si adegua da sola. Usando i pixel
        // dello schermo, a mezza risoluzione la banda nera tornerebbe.
        if (camera.isPerspectiveCamera) {
            uniforms.uPixelAngle.value = pixelAngle(camera.fov, uniforms.uResolution.value.y);
            uniforms.uTanHalfFov.value = Math.tan(camera.fov * Math.PI / 360);
            uniforms.uAspect.value = camera.aspect;
        }

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

        stats.ms = performance.now() - t0;
    }

    return {
        init, render, setSize, setScala, uniforms, stats,
        grazingSlope, pixelAngle, depthThreshold, NDV_MIN, SLOPE_K,
        get enabled() { return enabled; },
        setEnabled(on) { enabled = !!on; },
    };
});
