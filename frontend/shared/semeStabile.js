// frontend/shared/semeStabile.js
//
// IL CASO CHE NON CAMBIA FRA UNA PARTITA E L'ALTRA.
//
// Tutto ciò che questo gioco sparge nel mondo — alberi, tribune, palazzi — è
// deciso da un generatore pseudocasuale seminato con la GEOMETRIA: l'id del
// tracciato, o le coordinate di un punto. Mai `Math.random`, o il circuito
// avrebbe una faccia diversa a ogni caricamento.
//
// Le due funzioni vivevano dentro `trackScenery.js` ed erano già usate anche da
// chi con la scenografia non c'entra (il profilo della città). Estrarle qui non
// è ordine per l'ordine: `sceneryAssetSizes` ha bisogno dei nomi degli asset
// cittadini, quelli vengono dal profilo, e il profilo prendeva il suo seme da
// `trackScenery`, che a sua volta legge gli ingombri — un anello di require che
// in Node lascia mezzo modulo vuoto e fa esplodere il primo che lo usa.
//
// ⚠️ Un secondo generatore, scritto altrove «perché serviva lì», divergerebbe
// dal primo al primo ritocco e cambierebbe l'aspetto di tutti i circuiti già
// disegnati. Questo è l'unico posto.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SemeStabile = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Hash FNV-1a 32 bit di una stringa: seme deterministico dall'id del
    // tracciato, così lo stesso tracciato genera sempre lo stesso layout
    // (tracciati diversi → layout diversi ma stabili nel tempo).
    function hashString(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    // PRNG mulberry32: veloce, seedabile, sufficiente per uno scatter
    // visivo (non serve crittografico).
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    return { hashString, mulberry32 };
});
