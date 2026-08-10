# F1 — direzione artistica: cel shading, palette e cielo (design)

Data: 2026-08-10
Stato: approvato dall'utente in brainstorming, non ancora implementato

## Obiettivo

Rifare l'aspetto del gioco F1 sul modello visivo di *Fortnite × I Simpson*:
colori piatti e saturi, luce a fasce nette, contorni neri, ombre colorate,
cielo a gradiente pastello. Oggi l'F1 usa un rendering fisicamente plausibile
(`MeshStandardMaterial`, luce sfumata, ombre morbide, cielo a colore piatto):
è l'opposto del riferimento su ogni punto, e questo è ciò che rende il lavoro
fattibile senza rimodellare nulla — il grosso del look sta nel **sistema di
shading**, non nella forma degli asset. La geometria voxel esistente regge il
riferimento senza modifiche.

Non è un obiettivo la copia pixel-perfetta: quella è Unreal 5 con ogni asset
dipinto a mano per lo stile. L'obiettivo è la parte riconoscibile — luce,
contorni, palette, cielo.

## Decisioni prese in brainstorming

| Domanda | Decisione |
|---|---|
| Atmosfera | **Giorno con orizzonte pastello**: azzurro saturo allo zenit, banda calda arancio-oro bassa sull'orizzonte (tarata al playtest, vedi la nota nella sezione palette); sole medio-alto, ombre corte e nette. Non il tramonto lilla delle prime immagini: sull'asfalto il contrasto calerebbe e la pista si leggerebbe peggio. |
| Contorni | **Su tutto, spigoli interni inclusi**, con un tasto per accenderli e spegnerli durante i test. |
| Prestazioni | C'è margine: il gioco gira fluido. Si punta alla resa migliore, tenendo il costo sotto osservazione con un contatore. |
| Ambito | **Gara F1** (`f1.html`) come necessità primaria. Il **Voxel Livery Studio** (`livery.html`) segue dopo, a gara stabilizzata, per coerenza fra la livrea che si disegna e quella che si vede in pista. Banco prova bot ed editor pista restano fuori. |
| Approccio | **A — motore di stile condiviso nello shader**, con pannello di taratura. |

### Perché nello shader e non sui materiali

Nel gioco i colori arrivano da tre meccanismi diversi:

- gli asset del circuito hanno **un colore per materiale** (`voxelKit.py` crea
  una mesh per colore, massimo 6, nessuna texture);
- l'auto usa una **texture-palette 256×1** più i **vertex color**
  (`carLoader.js`);
- pista, prato e cordoli usano **solo vertex color**
  (`trackMeshBuilder.js`).

Nessun intervento "sui materiali" li copre tutti con la stessa regola. Un
intervento sul colore base *dentro lo shader*, applicato dopo che texture e
vertex color hanno detto la loro, sì.

### Alternative scartate

- **Ricolore alla sorgente** (rigenerare i 25 asset in Blender con la palette
  nuova, cambiando solo luci e cielo nel gioco): non produce né le fasce né i
  contorni, cioè i due tratti che rendono riconoscibile il riferimento; ogni
  tentativo di colore costa una rigenerazione; e non tocca pista, prato e auto,
  che sono generati in JavaScript. Resta valido come **rifinitura mirata** in
  fase 4, per i singoli asset che dopo il playtest risultassero fuori tono.
- **Filtro cartoon a schermo intero** (posterizzazione e ricerca bordi sul
  frame finito): quantizza l'immagine, non l'illuminazione dell'oggetto, quindi
  le fasce cadono dove capita sullo schermo e scorrono quando la camera si
  muove; la nebbia si spezza a chiazze. Si legge come filtro sovrapposto, non
  come gioco disegnato così.

## Cosa cambia a schermo

Sei ingredienti, ognuno con il proprio interruttore nel pannello.

1. **Luce a fasce (cel shading).** Da sfumatura continua a 3 gradini netti:
   pieno sole, mezza luce, ombra. È ciò che trasforma il fianco di una tribuna
   in una campitura unica.
2. **Ombre nette e colorate.** Le ombre proiettate perdono la sfocatura (bordo
   stretto, non frastagliato) e smettono di essere grigio scuro: diventano il
   colore della superficie virato al freddo. Vale anche per l'ombra dell'auto
   sull'asfalto.
3. **Contorni neri.** Tratto uniforme su silhouette e spigoli, spessore
   costante in pixel, attenuato con la distanza per non impastare le tribune
   sul fondo.
4. **Palette.** Colori nuovi per le superfici generate in JavaScript;
   correzione globale (saturazione e ombre fredde) per gli asset del circuito;
   correzione molto leggera sull'auto.
5. **Cielo a gradiente e distanza azzurra.** Cupola con gradiente verticale al
   posto del colore piatto; nebbia **derivata** dal gradiente; colline lontane
   che virano al lilla.
6. **Terreno dipinto.** Chiazze morbide di due verdi sul prato e ciuffi d'erba
   come piccoli tratti scuri.

## Architettura

Cinque moduli nuovi in `frontend/shared/`, ognuno con un compito solo. Stesso
schema degli altri moduli condivisi del progetto: IIFE con un globale, niente
moduli ES (il progetto carica Three r128 come script globale).

| modulo | compito | dipende da Three? |
|---|---|---|
| `toonPalette.js` | colori e regole di correzione: dati e funzioni pure | **no** → testabile con `node --test` |
| `toonStyle.js` | conversione dei materiali e patch shader condiviso | sì |
| `toonOutline.js` | passaggio dei contorni | sì |
| `toonSky.js` | cupola del cielo e nebbia coordinata | sì |
| `toonPanel.js` | pannello di taratura e tasti | no (solo DOM) |

### Agganci in `f1.js`

Tre punti, nient'altro:

1. **All'avvio**: `ToonSky.install(scene)` sostituisce `scene.background` e
   `scene.fog`; le luci esistenti (`HemisphereLight` + `DirectionalLight`)
   vengono ritarate per il modello a fasce.
2. **A ogni caricamento**: `ToonStyle.convert(oggetto)` — dentro la callback
   GLTF di `loadScenery` (una per asset), nella callback di
   `CarLoader.loadCarModel` (una per auto, comprese quelle che arrivano a gara
   iniziata), in `PitBoxLoader`, e sulle mesh sincrone di `TrackMeshBuilder`
   più il laghetto.
3. **Nel loop**: `renderer.render(scene, camera)` diventa
   `ToonOutline.render(renderer, scene, camera)`.

### Flusso di un frame

```
1. normali + profondità  ──►  buffer fuori schermo   (~110 draw call, senza luci né ombre)
2. scena a colori        ──►  canvas                  (come oggi, con antialias)
3. contorni              ──►  sopra il canvas         (1 rettangolo a schermo intero)
```

Con i contorni spenti il passaggio 1 e il 3 non vengono eseguiti e si chiama
direttamente `renderer.render`: costo identico a oggi.

## Dettagli che decidono se funziona

Punti non ovvi, ognuno dei quali costerebbe una sessione se scoperto sul campo.

- **Il passaggio delle normali non deve ricalcolare le ombre.** Three rigenera
  la shadow map a ogni `render()` quando `shadowMap.autoUpdate` è attivo:
  senza spegnerlo per quel passaggio si pagherebbe **due volte** la parte più
  cara della scena — quella per cui esiste già `NO_SHADOW_ASSETS` in `f1.js`.
  Si spegne prima del passaggio 1 e si ripristina prima del 2.
  Non si tocca invece `shadowMap.enabled`: cambiarlo a runtime cambia i define
  dei materiali e ne forza la ricompilazione.
- **La scena resta disegnata sul canvas**, non su un buffer intermedio. Il
  canvas ha `antialias: true` (MSAA nativo); passando per un render target lo
  perderemmo, e con campiture piatte e contorni la scalettatura si vedrebbe
  moltissimo. Solo i contorni sono un overlay trasparente
  (`renderer.autoClear = false`, quad ortografico, `depthTest: false`).
- **La correzione di palette agisce sul colore base** (subito dopo i chunk
  `map` e `color_fragment`), non sul colore finale: applicata in fondo
  saturerebbe anche le ombre e il look si sfalderebbe.
- **Un solo `onBeforeCompile` condiviso** da tutti i materiali — la stessa
  funzione, non una per materiale — così la GPU compila un programma unico. È
  il pattern già usato da `worldToon` in `fps.js`.
- **Uniform condivise per riferimento, uniform private per materiale.**
  `shader.uniforms` è per-materiale: si copiano dentro per riferimento le
  uniform globali (così uno slider del pannello muove tutta la scena senza
  ricompilare) e si aggiungono le poche private, come `uIsGround`, che
  distingue il prato dagli altri materiali per macchie e ciuffi.
- **Il patch shader può fallire in silenzio.** Si aggancia ai chunk interni di
  Three cercando una stringa: se la stringa non c'è, `String.replace` non
  sostituisce nulla e nessuno se ne accorge. Ogni sostituzione verifica di
  aver avuto effetto e registra un errore in console se no.
- **Le ombre nette si ottengono nello shader, non cambiando tipo di shadow
  map.** La tentazione è passare da `PCFSoftShadowMap` a `BasicShadowMap`: il
  bordo diventa netto ma anche scalettato, perché è la scaletta dei texel
  della mappa. Si tiene il PCF a `4096` e si stringe la transizione nel patch
  (`smoothstep` su una finestra stretta al posto della sfumatura completa):
  bordo netto, senza scaletta.
- **Niente UV sul terreno.** Le mesh del prato sono generate senza coordinate
  di texture: macchie e ciuffi si campionano in **coordinate mondo XZ**
  (proiezione planare), come già fatto per la macchia acquerello dell'FPS.
- **Esclusioni.** Si convertono i soli `MeshStandardMaterial`. I
  `MeshBasicMaterial` esistenti sono effetti e segnalatori (scia in scia
  d'aria, marker, zona box gialla) e restano come sono. Gli stessi oggetti
  vanno esclusi anche dai contorni, mettendoli su un layer dedicato che il
  passaggio delle normali salta (si salva e ripristina `camera.layers.mask`).

## Palette di partenza

Valori iniziali, da tarare a vista col pannello. Il riferimento è la coppia di
immagini "mappa dall'alto" e "fabbrica" (giorno pieno).

| superficie | oggi | proposta |
|---|---|---|
| prato | `0x3d8b3d` verde erba | `0x3fa86b` smeraldo, chiazze `0x2e8f5e` / `0x55be7c` |
| asfalto pista | `0x1e1e1e` quasi nero | `0x5e6b75` grigio-bluastro |
| corsia box | `0x3a3a3a` | `0x6a7681` |
| ponte | `0x4a4a4a` | `0x8b93a0` |
| cordolo neutro | `[0.35,0.35,0.37]` | `[0.55,0.57,0.60]` |
| laghetto | `0x2f6fa8` | `0x1e63c8` cobalto |
| cielo (zenit → orizzonte) | `0x87ceeb` piatto | `0x3fa9e8` → `0x8fd3f0` → `0xffd49a` → `0xeed5b3` |

L'asfalto è il cambiamento più forte: da quasi nero a grigio medio. È
necessario — su un asfalto nero le fasce di luce non si vedono e l'ombra
colorata non ha nulla su cui virare.

Il gradiente del cielo ha **quattro tappe**, non tre: una banda calda vicino
all'orizzonte, poi l'azzurro che sale fino allo zenit.

> **Aggiornato dopo la taratura al playtest (2026-08-10).** Il disegno
> iniziale teneva l'orizzonte azzurro-lilla, con la banda calda *appena sopra*,
> per avere le colline lontane color lilla come nel riferimento. Provato in
> gioco non ha convinto: fra la foschia fredda e l'arancione subito sopra
> restava un salto visibile. Con gli slider del pannello l'utente ha scelto un
> **orizzonte caldo** (`0xeed5b3`, cioè la tappa fredda mescolata al 69% con
> la banda calda) e una banda **bassa e stretta** — picco a 0.05, azzurro già
> da 0.26. Così il terreno lontano sfuma *dentro* la banda invece di
> scontrarcisi; le colline virano al beige caldo e non più al lilla, ed è una
> conseguenza accettata. Nebbia scesa a 0.001.

La regola strutturale resta: **la nebbia è il colore del cielo all'orizzonte**,
qualunque sia la taratura, e il pannello la muove insieme.

**La nebbia non è un colore separato**: è il valore del gradiente del cielo
alla quota dell'orizzonte, calcolato dalla stessa funzione. Per costruzione
non può più esistere la riga di stacco fra prato e cielo che avevamo già
corretto una volta scegliendo i due colori a mano.

### Che cosa fa esattamente la correzione ("grade")

Due operazioni sole, entrambe in `toonPalette.js` e applicate al colore base:

1. **Saturazione**: allontanamento dal proprio luma di una quantità fissa
   (`+18%` di partenza per gli asset del circuito, `+4%` per l'auto). Non
   sposta la tinta, quindi un rosso resta rosso e un pilota resta
   riconoscibile.
2. **Tinta d'ombra**: la fascia in ombra non moltiplica per un grigio ma vira
   verso una tinta fredda (`0x8aa0c8` di partenza), come nel riferimento dove
   l'ombra sul muro rosso è rosso scuro e non grigia. È lo stesso meccanismo
   già usato in `fps.js`, dove la fascia scura vira al viola.

Una terza operazione — lo spostamento di tinta dei verdi verso il turchese —
è deliberatamente **esclusa**: sarebbe l'unico modo per far virare in blocco la
vegetazione, ma colpirebbe anche livree e cartelloni verdi. I verdi si
sistemano nelle costanti di colore delle superfici, che sono poche e note.

**I colori dei piloti restano riconoscibili.** In gara il colore dell'auto dice
chi è chi ed è lo stesso pallino della classifica: sull'auto la correzione di
palette è molto leggera e non sposta la tinta. A caratterizzarla ci pensano
fasce e contorni.

## Pannello di taratura

- **F9** apre e chiude il pannello, nascosto di default.
- **F8** accende e spegne i contorni senza aprire il pannello.

Contenuto: un interruttore per ciascuno dei sei ingredienti; slider per numero
e soglia delle fasce, tinta dell'ombra, saturazione, spessore e sensibilità del
contorno, densità della nebbia; in alto un contatore di frame, per vedere il
costo mentre si accende un effetto. Agisce in tempo reale, senza refresh.

Testo e glifi monocromatici, **niente emoji** (convenzione del progetto).

I tasti F8/F9 sono liberi: i comandi di gioco usano Spazio, T, R, G e i tasti
di guida.

## Verifica

- **Automatica**: `toonPalette.test.js` sotto `node --test`, come gli altri
  moduli condivisi (il progetto non ha Three come dipendenza npm, quindi solo
  il modulo puro è testabile). Copre: correzione dei colori entro intervallo,
  **coerenza fra colore della nebbia e gradiente del cielo all'orizzonte**,
  stabilità della conversione (idempotenza del grade).
- **Visiva**: playtest in localhost a ogni consegna, dagli **stessi tre punti
  di ripresa** — griglia di partenza, una curva veloce, la corsia box — così i
  confronti prima/dopo sono onesti.
- **Prestazioni**: contatore di frame del pannello, misurato con contorni
  accesi e spenti nello stesso punto pista.
- **Cache**: bumpare la versione degli script in `f1.html` a ogni modifica JS,
  altrimenti il browser serve il file vecchio e sembra che non sia cambiato
  nulla.

## Rischi e contromisure

| rischio | contromisura |
|---|---|
| Un punto di aggancio dimenticato lascia un oggetto col materiale vecchio, che stona senza motivo apparente | `ToonStyle.audit(scene)` elenca in console le mesh non convertite; si lancia dal pannello |
| Il patch si aggancia ai chunk interni di Three r128: un aggiornamento della libreria lo romperebbe | verifica di avvenuta sostituzione con errore esplicito; Three è fissato a r128 da CDN, il rischio è teorico finché non lo si aggiorna |
| Il browser non supporta il buffer di profondità | i contorni si disattivano da soli, tutto il resto continua a funzionare |
| Il costo del secondo passaggio risulta più alto del previsto | il contatore lo rende visibile subito; il passaggio delle normali non ha luci, ombre né texture, quindi la leva è la sola conta di draw call |

## Consegne

Quattro fasi, ognuna con playtest dell'utente prima della successiva (una
feature alla volta, come da convenzione del progetto).

1. **Fondamenta** — cielo a gradiente, luci ritarate, luce a fasce, ombre nette
   colorate, pannello e tasti. È il salto più grande: già qui il gioco cambia
   faccia.
2. **Contorni** — passaggio delle normali, ricerca dei bordi, overlay, i due
   tasti.
3. **Palette e terreno** — colori delle superfici, correzione degli asset,
   prato chiazzato, ciuffi d'erba.
4. **Rifiniture** — asset rimasti fuori tono ricolorati alla sorgente in
   Blender; estensione al Voxel Livery Studio.

La palette viene **dopo** i contorni di proposito: le stesse tinte cambiano
aspetto una volta che ci sono fasce e inchiostro, e tararle prima
significherebbe rifarle due volte.

Il piano di implementazione copre le fasi 1-3. La fase 4 dipende da cosa
emerge dai playtest — quali asset stonano davvero e se il Livery Studio ha
bisogno dell'intero motore o del solo grade — e avrà quindi un piano proprio,
scritto a gara stabilizzata.

## Fuori scope

Niente bloom, profondità di campo o tabelle di colore; niente meteo dinamico né
ciclo giorno/notte; niente preset di illuminazione per pista (scartato in
brainstorming a favore di un'unica atmosfera); nessun rifacimento generalizzato
degli asset; banco prova bot ed editor pista non vengono toccati.
