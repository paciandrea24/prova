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
                'varying vec3 vDir;',
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
        scene.fog = new THREE.FogExp2(ToonPalette.fogColor(), ToonPalette.FOG_DENSITY);

        return {
            dome,
            uniforms,
            update(camera) {
                dome.position.copy(camera.position);
            },
            setEnabled(on) {
                uniforms.uOn.value = on ? 1 : 0;
                dome.visible = true;   // resta visibile: da spenta disegna il colore piatto
                scene.fog.color.set(on ? ToonPalette.fogColor() : FLAT_SKY);
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
