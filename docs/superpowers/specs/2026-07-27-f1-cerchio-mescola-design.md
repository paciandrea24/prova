# F1 — colore cerchio ruota in base alla mescola

## Contesto

Il modello auto attuale (`frontend/assets/custom/f1Car.glb`, versione con
`Chassis` + `Wheel_FL/FR/RL/RR` separati per l'effetto sterzo visivo) non ha
una fascia laterale dedicata sul pneumatico come le F1 vere: il cerchio
(oggi sempre verde oliva) è l'unica zona del modello ruota abbastanza
grande e distinguibile da poter rappresentare la mescola scelta.

Le mescole e i relativi colori sono già definiti lato server
(`backend/sockets/games/physics/TyreModel.js:19-23`):

```js
const TYRE_COMPOUNDS = {
    soft:   { label: 'Soft',   color: '#e74c3c', ... },
    medium: { label: 'Medium', color: '#f1c40f', ... },
    hard:   { label: 'Hard',   color: '#ecf0f1', ... },
};
```

Stessi colori già usati in HUD (dot mescola, badge, `frontend/f1.js:764`,
`803`).

## Obiettivo

Il cerchio della ruota (proprio, avversari, bot) assume il colore della
mescola attualmente montata, e cambia colore quando la mescola cambia
(scelta iniziale in `tyre_select`, e ad ogni pit stop). Effetto puramente
cosmetico.

## Vincoli/verifiche dal codice esistente

- Il modello usa **una texture-palette condivisa** (256×1 px) per tutta
  l'auto: ogni voxel referenzia un indice della palette via UV, non un
  colore per-vertice. `frontend/shared/carLoader.js::recolorLiveryTexture`
  già ricolora questa palette per applicare il colore giocatore ai texel
  "livrea" (tonalità ≤28°, saturazione ≥0.2), lasciando gli altri texel
  neutri (schiariti ma non tinti) — meccanismo introdotto oggi stesso per
  evitare che le ruote prendessero il colore giocatore.
- **Verificato analizzando la palette reale** (`f1Car.glb` estratto e
  decodificato): i texel del cerchio (verde oliva, indici usati es. 5, 8,
  20, 28, 34, 39, 43, 48, 50, 55, 69, 76, 85, 97 su `Wheel_FL`) hanno
  tonalità nell'intervallo **45°-100°**, nettamente separata sia dalla
  livrea rossa (≤24°) sia dal nero/grigio gomma (saturazione quasi nulla o
  tonalità <10° con valore molto basso). Nessuna sovrapposizione tra le
  tre categorie — classificazione per tonalità sicura quanto quella già
  usata per livrea/neutro.
- `group.userData.wheels` (`carLoader.js:255`) contiene già i nodi mesh
  ruota (nel modello attuale, mesh dirette, non serve risalire a un
  parent) — stesso array già usato per il rotolamento
  (`frontend/f1.js:1518-1521`).
- Il server include già `compound` nel payload di stato per ogni giocatore
  ad ogni tick (`backend/sockets/games/f1GameSocket.js:1186`, stesso
  blocco di `steerInput`), e lo aggiorna correttamente a fine pit stop
  (`f1GameSocket.js:782`: `p.compound = p.pendingCompound`). **Nessuna
  modifica server necessaria.**
- Prima della scelta mescola (fase `tyre_select`), `p.compound` è `null`
  lato server — il client deve gestire questo caso senza inventare un
  colore.
- `frontend/f1.js` riceve già l'oggetto colori mescola in `tyreCompoundsInfo`
  (`f1.js:679`, popolato da `f1Setup`), usato oggi per l'HUD.

## Modifiche

### 1. `frontend/shared/carLoader.js` — classificazione "cerchio" + rigenerazione su richiesta

In `recolorLiveryTexture`, aggiungere una terza categoria accanto a
livrea/neutro:

```js
const RIM_HUE_MIN = 45, RIM_HUE_MAX = 100; // misurato sulla palette reale, cerchio verde oliva

function recolorLiveryTexture(sourceTexture, hex, forceNeutral = false, compoundHex = null) {
    ...
    const [compoundHue, compoundSat, compoundVal] = compoundHex != null
        ? rgbToHsv(((compoundHex >> 16) & 0xff) / 255, ((compoundHex >> 8) & 0xff) / 255, (compoundHex & 0xff) / 255)
        : [0, 0, 0];

    for (...) {
        const [h, s, v] = rgbToHsv(...);
        const isLivery = !forceNeutral && h <= LIVERY_HUE_MAX && s >= LIVERY_SAT_MIN;
        const isRim    = forceNeutral && compoundHex != null && h >= RIM_HUE_MIN && h <= RIM_HUE_MAX;
        const liftedV  = liftValue(v);
        let outHue, outSat, outVal;
        if (isLivery)      { outHue = targetHue;   outSat = targetSat;   outVal = targetVal * liftedV; }
        else if (isRim)     { outHue = compoundHue; outSat = compoundSat; outVal = compoundVal * liftedV; }
        else                { outHue = h;           outSat = desaturateForBlack(s); outVal = liftedV; }
        ...
    }
}
```

In `loadCarModel`, nel `model.traverse` (`carLoader.js:159-192`): quando
`isWheelMesh` è vero e `child.material.map` esiste, salvare la texture
**originale non processata** prima di sovrascriverla (serve per rigenerare
più volte senza degradare l'immagine ad ogni cambio mescola):

```js
if (isWheelMesh) child.userData.pristineTex = child.material.map;
```

Dopo il traverse, esportare sul `group` una funzione per riapplicare il
colore mescola in qualsiasi momento (chiamata dal render loop di `f1.js`
quando la mescola cambia):

```js
group.userData.setCompoundColor = function (compoundHex) {
    for (const w of wheels) {
        if (!w.isMesh || !w.userData.pristineTex) continue;
        w.material.map = recolorLiveryTexture(w.userData.pristineTex, hex, true, compoundHex);
        w.material.needsUpdate = true;
    }
};
```

Nessuna chiamata automatica a `setCompoundColor` durante il caricamento:
finché il render loop non la invoca (perché non conosce ancora una
mescola reale), il cerchio resta al colore originale del modello — questo
copre naturalmente il caso "compound ancora null".

### 2. `frontend/f1.js` — invocare il cambio colore quando la mescola cambia

Nel loop `animate()`, dentro il blocco `if (carGroup) { ... }`, subito
dopo l'aggiornamento sterzo (`f1.js:1527-1529`, prima del blocco motore):

```js
// Colore cerchio in base alla mescola montata: si applica una sola volta
// per ogni cambio (non ad ogni frame) confrontando col valore già
// applicato, memorizzato su carGroup.userData.appliedCompound.
if (target.compound && tyreCompoundsInfo && carGroup.userData.setCompoundColor
        && carGroup.userData.appliedCompound !== target.compound) {
    const info = tyreCompoundsInfo[target.compound];
    if (info) {
        const compoundHex = parseInt(info.color.replace('#', ''), 16);
        carGroup.userData.setCompoundColor(compoundHex);
        carGroup.userData.appliedCompound = target.compound;
    }
}
```

Si applica a tutte le auto (`myCarGroup` e `otherCars[color]`, stesso
blocco già condiviso da tutte), coprendo proprio/avversari/bot senza casi
speciali.

## Testing

- `recolorLiveryTexture` e la classificazione "cerchio" per tonalità:
  nessun test automatico esistente per questa funzione (richiede
  `document.createElement('canvas')`, non testabile con `node:test` senza
  mock del DOM — stesso limite già presente per il resto di
  `carLoader.js`, coerente con l'infrastruttura attuale).
- Verifica manuale in localhost: scegliere una mescola in `tyre_select`,
  osservare il colore cerchio (proprio + eventuali bot) corrispondere a
  quello mostrato in HUD; effettuare un pit stop cambiando mescola,
  verificare che il cerchio cambi colore di conseguenza senza dover
  ricaricare la pagina.

## Fuori scope

- Aggiungere una vera fascia laterale sul pneumatico (richiederebbe
  modellazione/scultura voxel aggiuntiva) — scartato in fase di
  brainstorming, si ricolora il cerchio esistente.
- Rifacimento del sistema di luci/ombre (richiesta separata dell'utente,
  da trattare come progetto a parte).
