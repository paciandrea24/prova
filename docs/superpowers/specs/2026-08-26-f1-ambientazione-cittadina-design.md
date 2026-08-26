# La città attorno alla pista — design (blocco G)

**Data:** 2026-08-26
**Blocco:** G della carrellata (`project_f1_carrellata_2026-08-23`), dopo A, B, C, D, E — F è stato scartato dall'utente.

## Cosa vuole l'utente

Dalla carrellata, parole sue:

> «voglio creare una nuova ambientazione per i circuiti cittadini. al momento i
> circuiti sono tutti immersi nel verde... però ci sono anche i circuiti
> cittadini, completamente dentro le città. quindi suggerirei di creare una
> nuova ambientazione dove la vista è completamente occultata dai palazzi che
> circondano perfettamente il circuito. circuiti come baku o monaco ne sono
> l'esempio lampante.»

E il problema tecnico che aveva già individuato da solo:

> «dobbiamo trovare un modo ottimizzato ed efficiente per far si che asset
> rettangolari come gli edifici si adattino perfettamente all'andamento curvo
> dei circuiti. dobbiamo fare un po' di ricerca su questo.»

Più due richieste che stanno nello stesso blocco: il **lusso** attorno a box e
traguardo («i circuiti sono delle zone per ricchi... sono sicuro che la zona
intorno al rettilineo del traguardo e in generale ai box, sia comunque
curatissima e lussuosa»), e le **barriere con gli sponsor** al posto del
bianco-rosso continuo.

## Le decisioni prese il 2026-08-26 (non ridiscutere)

1. **Muro continuo, tipo Monaco/Baku**: le facciate cominciano subito oltre le
   barriere e chiudono la vista quasi ovunque. Niente prato né colline
   all'orizzonte.
2. **L'ambientazione è un campo della pista**, scelto nell'editor come
   l'abrasività, e salvato nel `.json`. Le piste esistenti restano verdi senza
   che nessuno le tocchi.
3. **Sponsor inventati** disegnati da noi: nessun marchio reale.
4. **Miscuglio di edifici**, con la precisazione dell'utente: «nel gioco fps
   abbiamo più che altro negozi e non vere e proprie case/case lussuose».
   Quindi i modelli dell'FPS **non** faranno da palazzi.

## ⚠️ L'idea centrale: la città non è fatta di edifici, è un NASTRO

Il modo ovvio — prendere N modelli di palazzo e disporli lungo il bordo — è
quello che l'utente temeva, e ha due difetti che non si curano:

- **la curva**: un edificio è un parallelepipedo, il tracciato gira. Allinearli
  al nastro del muro (come già si fa con le tribune) funziona finché i pezzi
  sono corti; su una facciata continua ogni giunzione diventa uno spigolo aperto
  o una compenetrazione;
- **il costo**: questo gioco è **GPU-bound sui pixel**, non sulle draw call
  (`feedback_prestazioni_gpu_pixel_non_drawcall`). Un muro di palazzi che chiude
  la vista è esattamente ciò che riempie lo schermo, e i modelli dell'FPS pesano
  ~700 KB l'uno.

La strada giusta la conosce già il progetto: **si estrude un profilo lungo il
tracciato**, come per asfalto, cordoli, ghiaia e barriere. La facciata dei
palazzi è un nastro alto, generato sulla curva — quindi la segue **per
costruzione**, non per adattamento — e vive in poche mesh invece che in
centinaia di oggetti.

I «palazzi diversi» nascono come **variazione lungo il nastro**: l'altezza
cambia a scalini ogni tot metri, il colore della fascia cambia con lei, e le
finestre sono un motivo ripetuto. Da dentro l'abitacolo, a 250 km/h, è
indistinguibile da una fila di edifici veri — e questo il progetto lo sa già
fare bene (il prato dipinto, la folla, i cordoli a scacchi).

**I modelli veri restano, ma davanti alla facciata**: i negozi dell'FPS e gli
asset ricchi (hospitality, motorhome, tribune, schermi) si posano nei punti che
si guardano da vicino — rettilineo dei box, curve lente — con il meccanismo
delle schiere che esiste già. È il «miscuglio» chiesto dall'utente, ottenuto
senza far reggere ai modelli il peso di chiudere l'orizzonte.

## Il dato

```jsonc
{ "ambientazione": "citta" }     // assente o "verde" = come oggi
```

- **Un solo campo per pista**, non per tratto: la transizione fra due mondi è un
  problema in più che nessuno ha chiesto, e Monaco non ha un pezzo di bosco.
- **A valle lo riempie un posto solo** (`trackLoader`, come per `halfWidth`,
  `pendenza` e `rollio`): niente ripieghi sparsi.
- Le piste senza il campo **restano identiche al bit**, e un test lo verifica.

## Cosa cambia nel mondo, con la città

| oggi (verde) | città |
|---|---|
| prato che si estende fino all'orizzonte | asfalto/cemento fino alle facciate |
| terrapieno erboso attorno alla pista | marciapiede e cordolo di città |
| colline e boschi all'orizzonte | facciate continue che chiudono la vista |
| tribune, gomme, cartelli | gli stessi, più i negozi FPS nei punti vicini |
| barriere bianco-rosse | barriere con pannelli sponsor |

⚠️ **Il verde non sparisce del tutto**: attorno ai box e al traguardo l'utente
vuole il lusso, e lì restano aiuole, palme, hospitality. È la zona che si guarda
da ferma (griglia, podio, pit stop), quindi è anche l'unica dove conviene
spendere modelli veri.

## Le fasi

Come per il nastro orientato, si spezza in due metà provabili in pista da sole:

- **G1 — la città esiste.** Campo nel dato, facciata continua generata sul
  tracciato, suolo urbano al posto del prato, colline e boschi spenti. Una pista
  di prova generata da script (`citta-prova`) per giudicare l'insieme.
- **G2 — il lusso e gli sponsor.** Negozi e asset ricchi davanti alla facciata,
  la zona box curata, i pannelli sponsor sulle barriere.

## Invarianti da non violare

- Le piste **senza** `ambientazione: "citta"` devono restare identiche al bit —
  verificato da un test, non a occhio.
- **Una cosa, una misura**: dove finisce la carreggiata e dove comincia il muro
  lo dicono già `TrackGravel.barrierProfile` e `TrackGeometry`. La facciata si
  posa a partire da quelli, non da una distanza sua.
- **Il tetto degli fps**: prima e dopo, misura col pannello F9 sulla stessa
  pista. Se la città costa più di 8 fps, si taglia — meno finestre, facciata più
  bassa, motivo più semplice — invece di accettarla e scoprirlo al playtest.
- Niente marchi reali sugli sponsor.

## Limiti dichiarati in anticipo

- La facciata è un **fondale abitato**, non un quartiere: non ci si entra, non ha
  spessore, le vie laterali sono dipinte e non percorribili. È la stessa
  convenzione dei circuiti veri visti dall'abitacolo.
- Gli incroci in cui il tracciato passa vicino a se stesso avranno **due facciate
  affiancate**: va gestito come già si gestisce il terreno conteso
  (`TrackGeometry.neighbourLimits`), o si vedranno palazzi dentro palazzi.
- Le piste cittadine restano **della stessa categoria** delle altre: la
  distinzione Classic F1 / fantasiosa è un altro blocco, rimandato dall'utente.
