// frontend/shared/toonSky.js
//
// Cupola del cielo a gradiente + nebbia coordinata, per il look cel-shaded
// (Rif. spec 2026-08-10-f1-art-direction-cel-shading-design.md).
//
// La cupola SEGUE la camera: il gradiente si calcola sulla direzione dal
// centro della cupola, non sulla quota assoluta, quindi il cielo si comporta
// come se fosse infinitamente lontano anche con un raggio di 800 unità (che
// deve restare entro camera.far, 1200).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonSky = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const DOME_RADIUS = 800;

    // Il cielo piatto di prima: si rivede solo spegnendo la cupola dal
    // pannello, per il confronto A/B.
    const FLAT_SKY = 0x87ceeb;

    function install(scene) {
        const stops = ToonPalette.SKY_STOPS;
        const uniforms = {
            uColors: { value: stops.map((s) => new THREE.Color(s.color)) },
            uStops: { value: stops.map((s) => s.t) },
            uOn: { value: 1 },
            uFlat: { value: new THREE.Color(FLAT_SKY) },
            // Stelle: accese solo di notte. Costano qualche istruzione sui
            // pixel della SOLA cupola, che è già disegnata comunque, e
            // stanno dentro un ramo — di giorno il ramo non si prende.
            uStelle: { value: 0 },
        };

        const material = new THREE.ShaderMaterial({
            uniforms,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            vertexShader: [
                'varying vec3 vDir;',
                'void main() {',
                '    vDir = normalize( position );',
                '    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
                '}',
            ].join('\n'),
            fragmentShader: [
                'uniform vec3 uColors[' + stops.length + '];',
                'uniform float uStops[' + stops.length + '];',
                'uniform float uOn;',
                'uniform vec3 uFlat;',
                'uniform float uStelle;',
                'varying vec3 vDir;',
                'float stellaHash( vec2 p ) {',
                '    p = fract( p * vec2( 127.1, 311.7 ) );',
                '    p += dot( p, p + 45.32 );',
                '    return fract( p.x * p.y );',
                '}',
                'void main() {',
                // t = 0 all'orizzonte, 1 allo zenit. Sotto l'orizzonte resta
                // il colore dell'orizzonte: là c'è comunque il terreno, e
                // così la cupola non stacca mai dalla nebbia.
                '    float t = clamp( vDir.y, 0.0, 1.0 );',
                '    vec3 col = uColors[0];',
                '    for ( int i = 1; i < ' + stops.length + '; i++ ) {',
                '        float k = clamp( ( t - uStops[i - 1] ) / ( uStops[i] - uStops[i - 1] ), 0.0, 1.0 );',
                '        k = k * k * ( 3.0 - 2.0 * k );',
                '        col = mix( col, uColors[i], k );',
                '    }',
                '    if ( uStelle > 0.5 ) {',
                '        vec3 d = normalize( vDir );',
                '        vec2 g = vec2( atan( d.z, d.x ) * 14.0, asin( clamp( d.y, -1.0, 1.0 ) ) * 26.0 );',
                '        vec2 cella = floor( g );',
                '        float h = stellaHash( cella );',
                '        if ( h > 0.875 ) {',
                '            vec2 centro = cella + vec2( stellaHash( cella + 1.7 ), stellaHash( cella + 3.1 ) );',
                '            float dist = length( g - centro );',
                '            float lum = smoothstep( 0.40, 0.0, dist ) * ( 0.35 + 0.65 * stellaHash( cella + 7.3 ) );',
            '            col += vec3( 0.86, 0.90, 1.0 ) * lum * smoothstep( 0.04, 0.34, d.y );',
                '        }',
                '    }',
                '    gl_FragColor = vec4( mix( uFlat, col, uOn ), 1.0 );',
                '}',
            ].join('\n'),
        });

        const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 16), material);
        dome.frustumCulled = false;
        dome.renderOrder = -1;
        scene.add(dome);

        // Il colore piatto di prima resta come background: si vede solo se la
        // cupola viene spenta, e non costa nulla tenerlo.
        scene.background = new THREE.Color(FLAT_SKY);
        scene.fog = new THREE.FogExp2(ToonPalette.fogColor(), ToonPalette.fogDensity());

        // Colore d'origine dell'orizzonte e della banda calda: servono per
        // rimescolarli con setHorizonWarmth senza perdere il riferimento.
        const orizzonteFreddo = new THREE.Color(stops[0].color);
        const caldo = new THREE.Color(stops[1].color);

        return {
            dome,
            uniforms,
            update(camera) {
                dome.position.copy(camera.position);
            },
            // Le stelle si accendono con la notte, e solo con la notte.
            setStelle(on) { uniforms.uStelle.value = on ? 1 : 0; },
            setEnabled(on) {
                uniforms.uOn.value = on ? 1 : 0;
                dome.visible = true;   // resta visibile: da spenta disegna il colore piatto
                scene.fog.color.set(on ? ToonPalette.fogColor() : FLAT_SKY);
            },
            // Quota della banda calda: più bassa = fascia sottile schiacciata
            // sull'orizzonte, più alta = fascia che invade il cielo.
            setWarmPos(t) { uniforms.uStops.value[1] = t; },
            // Da dove comincia l'azzurro: avvicinandolo alla banda calda si
            // stringe la transizione, allontanandolo la si allarga.
            setBlueStart(t) { uniforms.uStops.value[2] = t; },
            // Quanto l'orizzonte stesso è caldo, da 0 (azzurro-lilla) a 1
            // (caldo come la banda). LA NEBBIA SEGUE: è la stessa tinta, per
            // costruzione, quindi il terreno lontano continua a sfumare
            // esattamente nel cielo che ha sopra, senza linea di stacco.
            setHorizonWarmth(k) {
                uniforms.uColors.value[0].copy(orizzonteFreddo).lerp(caldo, k);
                scene.fog.color.copy(uniforms.uColors.value[0]);
            },
        };
    }

    // Cielo di PRIMA del cel shading, con lo stesso contratto di install():
    // serve al confronto A/B con `?toon=off`, dove il gioco deve tornare
    // esattamente com'era per poter misurare se un problema (di resa o di
    // prestazioni) dipenda davvero dal nuovo look.
    function installFlat(scene) {
        scene.background = new THREE.Color(FLAT_SKY);
        scene.fog = new THREE.FogExp2(FLAT_SKY, 0.0016);
        return {
            dome: null,
            uniforms: {},
            update() {},
            setEnabled() {},
        };
    }

    return { install, installFlat, DOME_RADIUS, FLAT_SKY };
});
