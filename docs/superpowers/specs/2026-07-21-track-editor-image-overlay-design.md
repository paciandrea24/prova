# Track Editor — overlay immagine di riferimento per ricalco

## Problema

Nel track-editor (`frontend/track-editor.js`) i tracciati si disegnano a mano,
punto per punto, guardando solo la griglia. L'utente vuole poter incollare
l'immagine di un tracciato reale (screenshot, foto da mappa) come riferimento
semi-trasparente sotto la vista dall'alto, per ricalcarne la forma con i
punti esistenti invece di stimarla a occhio.

## Contesto tecnico esistente

- Camera ortografica top-down (`THREE.OrthographicCamera`), non ruota mai;
  pan (tasto centrale) e zoom (rotellina) traslano/scalano il target.
- Click sinistro su area vuota → aggiunge un punto alla lista attiva
  (`mainPoints` o `pitPoints`); click su un marker → trascina; tasto destro →
  elimina; rotellina su un punto della pista → alza/abbassa la quota.
- Tutto vive in un'unica scena Three.js con coordinate mondo condivise;
  `rebuild()` ricostruisce la mesh della pista ad ogni modifica.

## Design

### Import

- Ascolto `paste` su `document`. Quando `clipboardData` contiene
  un'immagine, la converto in un `HTMLImageElement` (via `URL.createObjectURL`
  sul blob) e costruisco una `THREE.Texture` da quello.
- Se un overlay esiste già, il nuovo paste lo sostituisce (nessuna gestione
  multi-immagine: un solo riferimento alla volta, coerente con "ricalco un
  tracciato per volta").

### Rappresentazione

- Un `THREE.Mesh` piano (`PlaneGeometry` ruotata per giacere su XZ, come il
  `GridHelper`), materiale `MeshBasicMaterial({ map, transparent: true,
  opacity, depthWrite: false })`, posizionato a **y = -0.05** — sotto la
  griglia (y=0) e sotto la mesh di pista (y≈0..puntiY): la pista disegnata
  sopra copre naturalmente l'immagine man mano che si traccia, la griglia
  resta visibile in trasparenza per allinearsi alle coordinate.
- Stato JS associato:
  ```js
  let imageOverlay = null; // { mesh, texture, x, z, rotation, scale, aspect, opacity }
  let imagePositioning = false; // true = modalità posizionamento attiva
  ```
- Dimensione iniziale: centrata sul `camTarget` corrente, lato maggiore =
  150 unità mondo, l'altro lato in proporzione alle dimensioni pixel
  originali dell'immagine (`aspect = img.width / img.height`), rotazione 0,
  opacità iniziale 35%.

### Modalità posizionamento (attiva subito dopo il paste)

- Mentre `imagePositioning === true`, il gestore esistente di `mousedown` su
  `renderer.domElement` fa **early return** verso una logica dedicata invece
  di aggiungere punti/trascinare marker (pan e zoom da rotellina restano
  invariati, per poter inquadrare meglio durante l'allineamento).
- Due maniglie, oggetti Three.js separati (piccole sfere) posizionate in
  base a x/z/rotation/scale correnti dell'overlay, ricalcolate ad ogni
  modifica:
  - **maniglia d'angolo** (in basso a destra rispetto al piano, ruotata con
    esso): drag → **scala uniforme**, calcolata come rapporto tra distanza
    corrente mouse-centro e distanza iniziale mouse-centro al mousedown.
  - **maniglia superiore** (offset oltre il bordo alto, ruotata con il
    piano): drag → **rotazione**, calcolata come angolo tra il vettore
    centro→mouse e l'asse "su" locale.
  - drag sul corpo del piano (click che colpisce la mesh ma nessuna delle
    due maniglie) → **spostamento** (aggiorna x/z in base al delta mouse in
    coordinate mondo, stesso pattern già usato per trascinare i marker).
  - click che non colpisce né maniglie né piano → nessun effetto (non
    aggiunge punti finché non si conferma).
- Raycaster dedicato per l'hit-test di piano+maniglie (gruppo separato da
  `markerGroup`, es. `imageHandleGroup`), per non interferire con
  `pickMarker()`.

### Pannello laterale (`track-editor.html`)

Nuova sezione, visibile solo quando `imageOverlay !== null`:

```html
<div id="imgOverlaySection" style="display:none;">
    <hr style="border-color: #4b5b6b; margin: 10px 0;">
    <h1>Immagine di riferimento</h1>
    <label>Opacità
        <input type="range" id="imgOpacity" min="0" max="100" value="35">
    </label>
    <button id="imgConfirmBtn">Conferma posizione</button>
    <button id="imgEditBtn">Modifica posizione</button>
    <button id="imgRemoveBtn">Rimuovi immagine</button>
</div>
```

- `imgOpacity` è sempre attivo (anche a immagine confermata): aggiorna
  `material.opacity` in tempo reale.
- `imgConfirmBtn`: `imagePositioning = false`, rimuove le maniglie
  dalla scena. Da questo momento i click tornano al comportamento normale
  (aggiungi punto / trascina marker) esattamente come oggi, perché
  `pickMarker()` raycasta solo `markerGroup.children` e `worldFromEvent()`
  usa un piano matematico, non la mesh dell'immagine: **nessuna modifica
  necessaria** alla logica di click esistente per farla "ignorare"
  l'immagine confermata.
- `imgEditBtn`: `imagePositioning = true`, ricrea le maniglie — si può
  rientrare in modalità posizionamento in qualsiasi momento.
- `imgRemoveBtn`: rimuove mesh/texture dalla scena, `imageOverlay = null`,
  nasconde la sezione, esce da eventuale modalità posizionamento.
- Aggiornare `#hint` in fondo alla pagina con una riga su Ctrl+V e le
  maniglie.

### Persistenza

- **Nessuna**: l'overlay non viene salvato né in `buildTrackData()` né sul
  server. Sparisce ricaricando la pagina, cambiando pista o premendo
  "Rimuovi immagine". È solo un ausilio visivo di sessione, non fa parte
  del formato JSON della pista (`controlPoints`/`pit` restano invariati).

## Cosa NON cambia

- Nessuna modifica al formato dati delle piste (`buildTrackData`,
  `applyTrackData`, validazioni di salvataggio).
- Nessuna modifica al gioco vero (`f1GameSocket.js`, `f1.js`): l'overlay
  esiste solo nel track-editor.
- Nessuna gestione di più immagini contemporanee o di storico/undo per
  l'immagine: un solo overlay alla volta, sostituito da un nuovo paste.

## Verifica

Manuale in localhost (nessun test automatico esiste per il track-editor,
strumento dev-only):
- Copiare uno screenshot di un tracciato reale, incollarlo con Ctrl+V
  nell'editor: deve comparire semi-trasparente, centrato sulla vista
  corrente.
- Trascinare il corpo → si sposta; trascinare la maniglia d'angolo → scala
  mantenendo le proporzioni; trascinare la maniglia superiore → ruota.
- Regolare lo slider opacità e verificare che cambi in tempo reale, sia
  prima che dopo la conferma.
- Premere "Conferma posizione": verificare che i click ora aggiungano punti
  pista come sempre, che l'immagine resti visibile e ferma sotto, e che
  tracciando la pista sopra la ricopra progressivamente.
- Premere "Modifica posizione" dopo la conferma: le maniglie devono
  ricomparire e permettere di aggiustare ancora.
- Premere "Rimuovi immagine": l'overlay e la sua sezione pannello devono
  sparire, l'editor torna esattamente come prima del paste.
- Ricaricare la pagina: l'immagine non deve ricomparire (nessuna
  persistenza).
