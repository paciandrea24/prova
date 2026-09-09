# Duelli: difesa, traiettorie proprie, errori — design

**2026-09-05.** Blocco H della carrellata del 23-08, terza voce (H3). Nasce dal
playtest dei livelli di difficoltà: «non ho visto sorpassi se non magari al
via», «si fanno tutta la gara seguendo l'interno curva», «non si
attaccano/difendono».

## 1. Il problema, misurato

**I bot viaggiano su una corsia sola e lasciano libera l'altra metà.** La
traiettoria di `prova` sta in media a **5.42 unità da un lato** dell'asse, su
una mezza carreggiata di 11. Lo spazio libero medio è **5.6 unità da una parte
e 16.4 dall'altra**.

L'utente lo ha detto con parole sue, e sono la descrizione esatta di quel
numero: «non c'è duello perché i bot sono costantemente all'interno quindi di
lato in pista, io passo sempre dal lato opposto e li supero facilmente».

Le altre due misure che inquadrano il resto:

- **In curva stanno all'interno il 62% del tempo**, cinque bot su sei con lo
  scostamento medio verso l'interno. Non è un difetto dei bot: è la linea che
  seguono, e la seguono tutti uguale.
- **Fra bot non ci sono duelli perché non si raggiungono**: a fine gara i
  distacchi fra consecutivi sono 109, 134, 150, 191 e 760 unità, contro una
  finestra di ingaggio di 30. Un 0.4% di differenza di ritmo su un giro da 50
  secondi sono due decimi che si sommano ogni giro e non tornano indietro.

⚠️ **Quindi il duello che conta è quello COL GIOCATORE**, non fra bot. Due bot
di pari livello si allontanano — succede anche nella F1 vera, ed è la ragione
per cui esistono DRS e strategie. Il giocatore invece attraversa il gruppo per
forza: è lì che i duelli devono esistere.

## 2. Le decisioni dell'utente

1. **La difesa cresce col livello**, ma senza contatto volontario (già
   registrata nella spec dei livelli).
2. **Gli errori dell'AI ai livelli bassi sono ammessi.** L'utente li aveva
   esclusi «perché già i bot erano scarsi, se poi gli permettevamo di fare
   errori era la fine» — ora che il ritmo lo decide il livello, la ragione è
   caduta.
3. La traiettoria interna in sé non è (ancora) oggetto di lavoro: se ne
   riparla se dopo questo blocco dà comunque fastidio.

## 3. La difesa

Quando un inseguitore entra nella finestra di ingaggio, il bot davanti guarda
**da che lato arriva** e si sposta su quel lato.

- **Una volta sola.** È la regola vera della F1: un cambio di traiettoria in
  difesa, non due. Un bot che oscilla per bloccare è una cosa che si vede
  subito ed è antipatica.
- **Mai su chi è già affiancato.** Se l'attaccante ha il muso a fianco, la
  porta resta dov'è: chiuderla lì è un contatto, e il contatto volontario è
  escluso.
- **Quanto si sposta lo dice il livello**: a Facile un accenno, a Difficile
  copre davvero.
- **Si rientra** sulla propria linea quando l'inseguitore esce dalla finestra.

⚠️ Il difensore **non rallenta per difendersi**: sposta la traiettoria, non il
piede. Un bot che frena per stare davanti è il difetto che i giocatori
riconoscono come «AI che bara».

## 4. La traiettoria propria

Ogni bot riceve alla creazione uno **scostamento personale** dalla linea buona,
piccolo e costante per tutta la gara: chi taglia un po' più stretto, chi sta un
po' più largo.

Serve a due cose: rompere il trenino — sei bot sulla stessa linea sono sei
copie — e dare alla difesa qualcosa da cui muoversi.

⚠️ **Piccolo davvero.** La linea è già ottimizzata: allontanarsene costa tempo,
e uno scostamento grande trasformerebbe la varietà in lentezza. Il valore va
scelto misurando quanto costa sul giro, non a occhio.

## 5. Gli errori, ai livelli bassi

Due errori soli, entrambi cose che un pilota vero fa:

- **allargare in uscita di curva** — il bot esce più largo del dovuto e perde
  qualche decimo;
- **bloccare le ruote in staccata** — frena troppo tardi e lungo, e deve
  recuperare.

Frequenza dal livello: a Facile capitano, a Difficile praticamente mai.

⚠️ **Un errore deve costare tempo, non la gara.** Un bot che finisce in ghiaia
a ogni giro non è divertente, è rotto: gli errori restano dentro i limiti della
pista.

## 6. L'attacco

Esiste già (`overtakeOffset`), ma sceglie il lato con una regola fissa —
l'opposto di dove sta l'auto davanti, con una preferenza personale per
spareggiare. Con la difesa attiva questo non basta più: se il difensore copre
un lato, l'attaccante deve provare **l'altro**, non quello deciso alla nascita.

## 7. Cosa NON cambia

- La racing line e il modello di guida.
- Il ritmo per livello e le soglie di aggressività (blocco H2, appena fatto).
- La regola che un bot non entra ai box nell'ultimo giro.

## 8. Le invarianti da provare

1. **Un bot che difende si sposta dal lato dell'attaccante**, e di più a
   Difficile che a Facile.
2. **Non si difende due volte**: fra due cambi di direzione difensivi deve
   passare un tempo minimo.
3. **Non si stringe chi è affiancato**: se l'attaccante è a fianco, lo
   scostamento difensivo non aumenta verso di lui.
4. **Il difensore non rallenta**: la sua velocità obiettivo non cambia perché
   sta difendendo.
5. **Gli scostamenti personali non costano più di due decimi al giro**, e sono
   diversi fra bot.
6. **Gli errori restano in pista**: un bot che sbaglia non finisce oltre il
   cordolo più di quanto già faccia oggi.
7. **A Difficile gli errori sono rari**: meno di uno per bot ogni due giri.

## 9. Il playtest

Una gara a Medio e una a Difficile su `prova`, guardando:

1. quando arrivi dietro a un bot, **si sposta a coprirti**?
2. il sorpasso è ancora regalato o te lo devi guadagnare?
3. i bot sembrano piloti diversi o sei copie?
4. a Facile, gli errori si vedono e sono credibili?
