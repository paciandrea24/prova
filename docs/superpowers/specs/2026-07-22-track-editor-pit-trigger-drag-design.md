# Track editor — box trigger pit trascinabile

## Problema

Il riquadro trigger di ingresso ai box (xMin/xMax/zMin/zMax) si imposta solo
digitando i 4 valori nei campi numerici. Il riquadro è visualizzato in scena
come wireframe sottile (`THREE.LineSegments` sugli spigoli, colore magenta) e
non è cliccabile: per riposizionarlo bisogna leggere le coordinate a occhio
dalla vista top-down e aggiornare i campi a mano.

## Design

### Cornice spessa al posto del wireframe sottile

Il wireframe (`entryTriggerMesh`, `LineSegments` su `EdgesGeometry`) viene
sostituito da un gruppo di 4 mesh piatte (barre top/bottom/left/right) che
formano una cornice di spessore fisso `ENTRY_TRIGGER_FRAME_THICKNESS = 5`
unità mondo — stessa scala d'ingombro dei marker già cliccabili in questo
editor (sfere raggio 2–3). Materiale magenta traslucido (stesso colore
`0xff00ff` già in uso), stessa quota y (1.5) e stesso clamp visivo
(`visualClampExtent()`) del wireframe attuale.

L'interno del box resta senza mesh: un click al centro del riquadro continua
a comportarsi come oggi (aggiunge un punto pista/box alla lista attiva).
Solo un click sulla cornice avvia il drag.

### Interazione — drag diretto, nessun toggle

Nel gestore `mousedown` (dopo il controllo `pickMarker`, che ha sempre
priorità sui marker pista/box esistenti — invariato), si aggiunge un
controllo `pickEntryTriggerFrame(ev)`: se il raycaster colpisce una delle 4
barre della cornice, si avvia un nuovo stato di drag dedicato
(`triggerDrag`) invece di quello dei marker, salvando:
- il punto mondo iniziale del mouse (`worldFromEvent(ev)`);
- i 4 valori correnti xMin/xMax/zMin/zMax letti dai campi.

Se il click non colpisce né un marker né la cornice, il comportamento
esistente (aggiungi punto) resta invariato.

In `mousemove`, se `triggerDrag` è attivo: si calcola lo spostamento
(dx, dz) tra la posizione mouse corrente e quella iniziale, lo si applica a
tutti e 4 i valori di partenza (trasla il riquadro, non lo ridimensiona — le
dimensioni restano quelle scritte nei campi), si scrivono i nuovi valori
nei campi `entryXMin/entryXMax/entryZMin/entryZMax` (`.value`, arrotondati a
2 decimali come già fatto per i marker) e si richiama
`updateEntryTriggerVisual()` per ridisegnare la cornice.

In `mouseup`, `triggerDrag = null` insieme agli altri stati di drag già
resettati lì (`dragging`, `panning`, `imageDrag`).

### Cosa non cambia

- I campi numerici restano l'unica fonte di verità letta da
  `buildTrackData()`/validazione/export: il drag li scrive, non introduce
  uno stato parallelo.
- Nessun ridimensionamento via drag (fuori scope, confermato con l'utente):
  per cambiare le dimensioni del box si editano ancora i campi a mano.
- Nessuna modalità/toggle esplicita: la cornice è sempre cliccabile per il
  drag, in qualunque momento, senza sospendere l'aggiunta punti nel resto
  della scena (a differenza del positioning dell'overlay immagine, che
  sospende tutti i click normali).

## Testing

Verifica manuale in localhost (dev-only, come il resto dell'editor):
1. Aprire un tracciato esistente con corsia box, verificare che la cornice
   magenta sia visibile e più spessa del wireframe attuale.
2. Trascinare la cornice: il riquadro si sposta, i 4 campi si aggiornano
   live, le dimensioni (differenza xMax-xMin, zMax-zMin) restano invariate.
3. Cliccare al centro del riquadro (non sulla cornice): si aggiunge ancora
   un punto alla lista attiva (pista o box), invariato rispetto a oggi.
4. Cliccare su un marker esistente che si trova sotto/vicino alla cornice:
   vince il marker (drag del punto), non il box.
5. Salvare ed esportare: il JSON riflette i nuovi valori trascinati.
