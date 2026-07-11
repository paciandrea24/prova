// ══════════════════════════════════════════════════════
//  WORLD-CONFIG — elenco zone del mondo FPS
//  UNICA FONTE DI VERITÀ condivisa tra fps.js (gioco) e
//  minimap-gen.html (tool dev che genera la texture della minimappa).
//  Se aggiungi/sposti una zona: modifica QUI, poi rigenera la minimappa
//  aprendo localhost:3000/minimap-gen.html.
// ══════════════════════════════════════════════════════
const _GALLERIA_OFF = { x: 97, z: 0 };   // offset mondo della Galleria (combacia con collegamenti-layout.py)

const WORLD_CONFIG = {
    GALLERIA_OFF: _GALLERIA_OFF,
    // skip/passthrough dei varchi Jazz (coord LOCALI del layout)
    VARCHI_URL: 'assets/models/jazz/varchi-skip.json',
    // varchi:true → alla zona vanno passati skip/passthrough letti da VARCHI_URL
    // pav:false   → la zona non ha 'pavimentazione.glb' separata
    ZONES: [
        { dir: 'assets/models/jazz/',             json: 'zona-layout.json',         varchi: true },
        { dir: 'assets/models/collegamenti-wip/', json: 'collegamenti-layout.json', pav: false },
        { dir: 'assets/models/galleria-wip/',     json: 'galleria-layout.json',     offset: _GALLERIA_OFF },
        { dir: 'assets/models/piazza/',           json: 'piazza-layout.json',       pav: false },
        { dir: 'assets/models/funland/',          json: 'funland-layout.json',      pav: false },
    ],
};
