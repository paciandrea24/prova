// frontend/shared/cittaFacciate.js
//
// I MODULI DI FACCIATA CHE VESTONO IL NASTRO.
//
// Il nastro (TrackMeshBuilder.buildCitta) chiude la vista e segue la curva per
// costruzione; questi pezzi gli danno la faccia. Una colonna è una pila: base,
// N piani tipo, coronamento — modelli veri, scolpiti in Blender con la stessa
// palette di tutta la scenografia (backend/tools/circuitAssets/cittaFacciate.py).
//
// ⚠️ DOVE vadano le colonne lo decide `CittaProfilo`, non questo modulo: sono
// le stesse misure che dicono al nastro dove cambiare altezza, e due conti
// separati farebbero finire un coronamento a metà di uno scalino. Qui si
// traduce soltanto: da colonna a voci di layout, con il nome dell'asset e la
// quota di ogni pezzo della pila.
// Rif. docs/superpowers/specs/2026-08-27-f1-facciate-asset-design.md
//
// Modulo PURO: niente Three.js, niente DOM. Le voci prodotte sono le stesse che
// il gioco istanzia per tutta la scenografia — così le facciate ereditano
// gratis instancing, divisione in celle e pannello di diagnostica.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./cittaProfilo.js'), require('./toonPalette.js'));
    } else {
        root.CittaFacciate = factory(root.CittaProfilo, root.ToonPalette);
    }
})(typeof self !== 'undefined' ? self : this, function (CittaProfilo, ToonPalette) {

    // La categoria delle voci prodotte. Non è scenografia da posare: è la
    // superficie di un pezzo di mondo già deciso, e non deve passare dal
    // registro degli ingombri — che la scarterebbe contro sé stessa, visto che
    // due colonne adiacenti si toccano per mestiere.
    const CATEGORIA = 'citta';

    // ⚠️ LA PILA NON AFFONDA: parte esattamente alla quota del campione.
    // Affondarla di tre decimi «per non vedere la fessura al piede» sembrava
    // gratis e non lo era: i moduli hanno altezze fisse, quindi tutto quello
    // che scende sotto terra manca in cima, e il coronamento finiva tre decimi
    // sotto il bordo del nastro — una striscia di muro nudo sopra il cornicione,
    // in cima a ogni palazzo del circuito. Sotto ci pensa il nastro, che affonda
    // lui di un'unità e mezza ed è del colore giusto.

    // Tutti gli assetId che questo modulo può nominare. Serve a chi deve
    // conoscerli in anticipo — la tabella dei percorsi, quella degli ingombri,
    // i test — senza ricopiarne venticinque a mano.
    const PEZZI = ['BaseA', 'BaseB', 'PianoA', 'PianoB', 'Tetto'];
    function assetIds() {
        const out = [];
        for (const t of ToonPalette.CITTA_FACCIATE) {
            for (const p of PEZZI) out.push(`citta${t.nome}${p}`);
        }
        return out;
    }

    // Le voci di layout di una pista cittadina. Vuoto per tutte le altre.
    function colonne(trackPts, profilo) {
        if (!profilo || !profilo.colonne || !profilo.colonne.length) return [];
        const tinte = ToonPalette.CITTA_FACCIATE;
        const voci = [];
        for (const col of profilo.colonne) {
            const nome = tinte[col.tinta % tinte.length].nome;
            const variante = col.variante ? 'B' : 'A';
            // Le due basi si alternano lungo il palazzo: con una sola, un
            // palazzo di quattro colonne mostrava quattro portoni identici in
            // fila — cosa che non succede in nessuna strada.
            const pila = [[`citta${nome}Base${col.indice % 2 === 0 ? 'A' : 'B'}`, CittaProfilo.H_BASE]];
            for (let q = 0; q < col.piani; q++) {
                pila.push([`citta${nome}Piano${variante}`, CittaProfilo.H_PIANO]);
            }
            pila.push([`citta${nome}Tetto`, CittaProfilo.H_CORONAMENTO]);

            let quota = col.y;
            for (const [asset, alto] of pila) {
                voci.push({ asset, category: CATEGORIA, x: col.x, y: quota, z: col.z, rotY: col.rotY });
                quota += alto;
            }
        }
        return voci;
    }

    return { colonne, assetIds, CATEGORIA, PEZZI };
});
