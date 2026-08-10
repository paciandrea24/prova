const test = require('node:test');
const assert = require('node:assert/strict');
const ToonStyle = require('./toonStyle.js');

// Finto shader con i soli chunk a cui il patch si aggancia, negli stessi
// punti in cui compaiono in Three r128.
function fakeShader() {
    return {
        uniforms: {},
        vertexShader: [
            'void main() {',
            '    #include <beginnormal_vertex>',
            '    #include <begin_vertex>',
            '    #include <project_vertex>',
            '}',
        ].join('\n'),
        fragmentShader: [
            '#include <gradientmap_pars_fragment>',
            'void main() {',
            '    #include <map_fragment>',
            '    #include <color_fragment>',
            '    vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
            '}',
        ].join('\n'),
    };
}

test('il patch dichiara le sue uniform', () => {
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    for (const nome of ['uOn', 'uShadowTint', 'uSat', 'uIsGround']) {
        assert.ok(s.uniforms[nome], `manca la uniform ${nome}`);
    }
});

test('la saturazione è privata del materiale, non condivisa', () => {
    // Due materiali con saturazione diversa (scenografia 0.18, auto 0.04)
    // devono poter convivere: se uSat finisse fra le uniform condivise, il
    // secondo materiale sovrascriverebbe il primo e le auto verrebbero
    // saturate come la scenografia.
    const a = fakeShader(), b = fakeShader();
    ToonStyle.buildPatch(a, { saturation: 0.18, isGround: false });
    ToonStyle.buildPatch(b, { saturation: 0.04, isGround: false });
    assert.equal(a.uniforms.uSat.value, 0.18);
    assert.equal(b.uniforms.uSat.value, 0.04);
    assert.notEqual(a.uniforms.uSat, b.uniforms.uSat);
});

test('le uniform globali sono lo STESSO oggetto per tutti i materiali', () => {
    // È ciò che permette agli slider del pannello di muovere tutta la scena
    // senza ricompilare gli shader.
    const a = fakeShader(), b = fakeShader();
    ToonStyle.buildPatch(a, { saturation: 0.18, isGround: false });
    ToonStyle.buildPatch(b, { saturation: 0.18, isGround: false });
    assert.equal(a.uniforms.uOn, b.uniforms.uOn);
    assert.equal(a.uniforms.uShadowTint, b.uniforms.uShadowTint);
});

test('il flag terreno arriva nello shader', () => {
    const terra = fakeShader(), altro = fakeShader();
    ToonStyle.buildPatch(terra, { saturation: 0.1, isGround: true });
    ToonStyle.buildPatch(altro, { saturation: 0.1, isGround: false });
    assert.equal(terra.uniforms.uIsGround.value, 1);
    assert.equal(altro.uniforms.uIsGround.value, 0);
});

test('il patch tiene conto dell instancing per la posizione mondo', () => {
    // La scenografia è tutta InstancedMesh: senza instanceMatrix la posizione
    // mondo di ogni istanza sarebbe quella dell'origine del modello, e le
    // macchie del terreno risulterebbero identiche su tutte le istanze.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    assert.ok(s.vertexShader.includes('USE_INSTANCING'), 'manca il ramo instancing');
    assert.ok(s.vertexShader.includes('instanceMatrix'), 'instanceMatrix non usata');
});

test('la fascia in ombra vira di tinta', () => {
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    assert.ok(s.fragmentShader.includes('getGradientIrradiance'),
        'il patch non ridefinisce la funzione delle fasce');
    assert.ok(s.fragmentShader.includes('uShadowTint'), 'la tinta d ombra non è usata');
});

test('il patch non tocca la luce uscente', () => {
    // Una compressione delle alte luci agganciata a `outgoingLight` è stata
    // provata e RIMOSSA il 2026-08-10: ha coinciso con la comparsa di scatti
    // al playtest e non serviva, perché i chiari sfondavano per via delle
    // intensità delle luci (somma ~1.9) e non per la mancanza di un tetto.
    // Questo test impedisce che rientri per distrazione: il costo per pixel
    // del patch deve restare quello che è.
    const s = fakeShader();
    ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false });
    const dopo = s.fragmentShader.split('vec3 outgoingLight')[1] || '';
    assert.ok(!dopo.includes('uKnee') && !dopo.includes('uShoulder'),
        'la compressione delle alte luci è rientrata nello shader');
});

test('la conversione non riaccende un materiale spento', () => {
    // carLoader.js:293 nasconde la carrozzeria originale sotto il vestito
    // voxel spegnendo il MATERIALE (child.material.visible = false), non la
    // mesh — la mesh deve restare per la fisica e il raycast. Un materiale
    // nuovo che riparte da visible=true fa riemergere la carrozzeria, che ha
    // ancora la texture sorgente ROSSA, e le due superfici compenetrate si
    // contendono ogni pixel: puntini rossi che cambiano mentre l'auto si
    // muove. Bug reale osservato in localhost il 2026-08-10.
    const src = { visible: false };
    const dst = { visible: true };
    ToonStyle.copyMaterialState(src, dst);
    assert.equal(dst.visible, false);
});

test('la conversione conserva lo stato di render del materiale', () => {
    const src = {
        visible: true, side: 2, transparent: true, opacity: 0.55, alphaTest: 0.1,
        depthTest: false, depthWrite: false, colorWrite: false, blending: 5,
        premultipliedAlpha: true, dithering: true, toneMapped: false, fog: false,
        flatShading: true, wireframe: true, shadowSide: 1,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: 3,
    };
    const dst = {};
    ToonStyle.copyMaterialState(src, dst);
    for (const k of Object.keys(src)) {
        assert.equal(dst[k], src[k], `proprietà ${k} non copiata`);
    }
});

test('una proprietà assente nel sorgente non sovrascrive il default', () => {
    // Assegnare undefined al posto del default del materiale nuovo sarebbe
    // peggio che non copiare affatto.
    const dst = { visible: true, opacity: 1 };
    ToonStyle.copyMaterialState({}, dst);
    assert.equal(dst.visible, true);
    assert.equal(dst.opacity, 1);
});

test('un chunk mancante fa fallire il patch con un messaggio esplicito', () => {
    // È la rete di sicurezza principale: String.replace su una stringa
    // assente non solleva nulla e il materiale resterebbe muto, senza che
    // nessuno se ne accorga.
    const s = fakeShader();
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '');
    assert.throws(
        () => ToonStyle.buildPatch(s, { saturation: 0.18, isGround: false }),
        /color_fragment/,
        'l errore deve nominare il chunk mancante'
    );
});
