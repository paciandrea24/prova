# F1 — Voxel Livery Studio: fix buchi ruote + voxel neri

## Contesto

`voxel_livery_studio.html` (tool esterno, `C:\Users\pacia\Desktop\livery\`,
non nel repo) importa `f1Car.glb`, applica una livrea procedurale
(pattern/sponsor) ricolorando i voxel, ed esporta un nuovo `.glb` da mettere
al posto di `frontend/assets/custom/f1Car.glb` in gioco. Due bug riscontrati
nell'uso reale:

1. **Buchi nelle ruote** dopo l'export, visibili quando la ruota gira in
   gioco (workaround manuale attuale: in Blender, cancellare le ruote
   generate e incollare quelle del modello di riferimento originale).
2. **Voxel neri "corrotti"** su nose/chassis quando il colore secondario
   scelto è scuro (es. `#461616`), assenti/accettabili con colori vividi
   (es. `#FF0000`).

Diagnosi confermata su dati reali (ispezione Blender headless di
`frontend/assets/custom/f1Car.glb`):

- `Wheel_FL` (bbox y ∈ [-0.704, -0.416]) e `Plank` (bbox y ∈ [-0.448, 0.992])
  condividono una fascia di 1 voxel (passo griglia 0.032 unità) dove x/z si
  sovrappongono. `Wheel_RL`/`Wheel_RR` si sovrappongono a `Plank` in modo
  ancora più esteso (l'intero range y della ruota è dentro quello del
  Plank).
- In `buildModel()` (voxel_livery_studio.html:769), ogni cella voxel viene
  assegnata a UNA mesh originale per maggioranza di campioni
  (`bestName`, righe ~797-801). Nella fascia di sovrapposizione, celle che
  visivamente appartengono alla ruota possono finire assegnate a `Plank`
  per un margine minimo di campioni.
- All'export (`exportGLB`, righe ~1416-1504), le facce vengono smistate per
  nome-parte: una cella mal classificata come `Plank` finisce nel nodo
  statico invece che nel nodo `Wheel_*` che ruota in gioco → buco che si
  apre quando la ruota gira.
- Bug voxel neri: in `applyLivery()` (righe ~1273-1291), il trasferimento
  d'ombra usa un blend **additivo** in HSL
  (`finalL = targetHSL.l + deltaL`, con `deltaL = origHSL.l - domHSL.l`).
  Se il colore target ha luminosità bassa e il voxel originale era
  un'ombra/AO molto scura (`deltaL` molto negativo), `finalL` scende sotto
  zero e clippa a **nero puro** — da cui le chiazze nere. Con un colore
  vivido (L≈0.5) c'è più margine prima di toccare zero, da cui la
  differenza di comportamento osservata.

## Fix 1 — buchi ruote (via export, non via voxelizzazione)

Le ruote sono già escluse dalla ripittura livrea (`locked[q]` per
`c.rub > 0`, voxel_livery_studio.html:794) — quindi usare la geometria
ruota originale invece di quella ricostruita dai voxel è visivamente
identico a un export "corretto", non un compromesso. Non si tocca la
logica di voxelizzazione/classificazione generale (nessun rischio di
regressione su altre parti o altri modelli).

**Implementazione:**

- In `loadFile()`, oltre al pivot già salvato per ogni mesh (`M.pivots`),
  salvare anche una copia di geometria + materiale delle mesh il cui nome
  corrisponde al pattern ruota — stesso regex già usato per `isRubber` in
  `collectTriangles()`: `/wheel|tire|tyre|rubber|gomm|ruota/i`. Nuova
  struttura `M.originalWheelMeshes[name] = { geometry, material }`
  (geometria clonata per non dipendere dal lifetime della scena gltf
  originale).
- In `exportGLB()`, quando si itera `parts` per nome, se
  `M.originalWheelMeshes[name]` esiste, **non** ricostruire la mesh dai
  voxel per quella parte: aggiungere invece alla `exportScene` un mesh
  clonato da `M.originalWheelMeshes[name]`, posizionato allo stesso pivot
  già usato per le altre parti (`M.pivots[name]`).
- Se il modello caricato non ha mesh nominate come ruota, il comportamento
  resta quello attuale (nessuna regressione).

## Fix 2 — voxel neri (blend moltiplicativo con floor)

Sostituire il blend additivo con uno moltiplicativo che non può mai
azzerare la luminosità:

```js
const SHADE_FLOOR = 0.22; // valore indicativo, da verificare a occhio
const relShade = origHSL.l / Math.max(M.domHSL.l, 0.02);
const shadeMult = Math.max(SHADE_FLOOR, relShade);
let finalL = clamp(targetHSL.l * shadeMult, 0, 1);
```

Nessuna dipendenza dalla logica di `frontend/shared/carLoader.js` (che
risolve un problema diverso — ricolora solo texel in una fascia di
tonalità su una texture-palette esistente, non calcola pattern interi):
si riusa solo il principio (moltiplicativo + floor batte additivo perché
non può mai andare sotto zero), non il suo codice.

Il resto del blend (desaturazione texel non-livrea/scuri,
`origHSL.s < 0.25`) resta invariato — non è la causa del bug segnalato.

## Fuori scope (rimandato, non dimenticare)

- Estendere la colorazione a front/rear wing (voxel troppo piatti/uniformi
  nel modello sorgente per il transfer-ombra attuale; in gioco le ali sono
  oggi forzate sempre nere via `isFixedMesh` in `carLoader.js`).
- Integrazione dell'editor in gioco + account/persistenza (cambio
  architetturale grosso: oggi il colore lobby è già l'hex che tinge
  l'intera livrea via `recolorLiveryTexture`; passare a livree custom
  complete implica persistenza oltre la sessione).

## Test/verifica

- Ricaricare `f1Car.glb` nell'editor, applicare una livrea con pattern +
  colore secondario scuro (es. `#461616`) e uno vivido (`#FF0000`),
  confermare a occhio che non ci sono più chiazze nere su nose/chassis con
  nessuno dei due.
- Esportare, sostituire `frontend/assets/custom/f1Car.glb` in locale,
  avviare il gioco e osservare le ruote in movimento (accelerazione,
  sterzo) per confermare l'assenza di buchi che si aprono durante la
  rotazione — sia ruote anteriori che posteriori.
- Verificare che l'export di un modello SENZA mesh nominate come ruota
  (se disponibile) non cambi comportamento rispetto a prima del fix.
