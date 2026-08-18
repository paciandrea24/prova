# Sicurezza — stato al 2026-08-18

Scritto rispondendo alla domanda della roadmap 1.0 (voce 9): *«il gioco è
sicuro? temo codice distrutto, database svuotati, chiavi rubate»*.

Questa non è una certificazione. È l'elenco di cosa ho guardato, cosa ho
trovato, e cosa ho chiuso — in modo che fra sei mesi si sappia da dove
ripartire invece di rifare tutto da capo.

**Riassunto in una riga:** tutte e tre le paure erano fondate. Nove cose
chiuse qui dentro, e **una che devi chiudere tu**, perché è fuori dal codice.

---

## ⚠️ DA FARE TU, PRIMA DI TUTTO IL RESTO

**La password del database MongoDB è pubblica su GitHub da giugno.**

Il 26 giugno il file `backend/.env` è stato committato (`782fe53`) e rimosso
tre commit dopo (`1b13f6d`). Rimuovere un file da un commit successivo non lo
toglie dalla storia: è ancora lì, e `github.com/paciandrea24/prova` è un
repository **pubblico**. Chiunque può leggerlo con un comando.

Dentro c'era `MONGODB_URI`, che in MongoDB Atlas è una stringa del tipo
`mongodb+srv://utente:password@...`: utente e password sono dentro
l'indirizzo. Chi ce l'ha può leggere, riscrivere e **svuotare** il database —
la classifica globale e tutte le livree.

Oggi il `.gitignore` è corretto e non ricapiterà, ma il danno passato resta.

**Cosa fare, in quest'ordine:**

1. Su MongoDB Atlas → *Database Access* → cambia la password di quell'utente
   (o cancellalo e creane uno nuovo). Da quel momento la stringa pubblicata
   non apre più niente, ed è la cosa che conta.
2. Aggiorna `MONGODB_URI` in `backend/.env` in locale **e** fra le variabili
   d'ambiente del servizio su Render.
3. Su Atlas → *Network Access*: se c'è `0.0.0.0/0` (accesso da qualunque
   indirizzo), restringilo agli IP di Render.
4. *Facoltativo:* riscrivere la storia del repository per cancellare il file
   anche dal passato. Con la password già cambiata la stringa vecchia non
   serve più a nessuno, e riscrivere la storia di un repo pubblico è
   fastidioso: farlo solo se ti dà fastidio l'idea che resti lì.

Nessun'altra chiave è mai finita nella storia: nessun service account
Firebase, nessuna chiave Gemini, nessun file `.pem`. Ho controllato tutta la
storia, non solo lo stato attuale.

---

## Cosa ho guardato

- Tutte le rotte HTTP (`backend/routes/`, `backend/server.js`, `backend/dev/`).
- Tutti gli eventi socket, cioè il canale su cui gira ogni partita
  (`backend/sockets/`).
- Dove finiscono i dati che arrivano dalla rete: MongoDB (classifica,
  livree), file su disco (piste, minimappa, segnalazioni), e l'HTML delle
  pagine.
- Le dipendenze (`npm audit`) e i segreti (`.env`, chiavi nel frontend).

## Cosa ho trovato e chiuso

Sono nove cose. Le prime cinque erano sfruttabili da chiunque, senza
strumenti particolari e senza sapere niente del progetto.

### 1. Chiunque poteva comandare al posto dell'host

**Com'era.** L'identità di un giocatore era il suo colore. Ma il colore è
pubblico: il server lo manda a tutti quelli nella stanza. I controlli erano
scritti come *«il colore che mi hai mandato è quello dell'host?»* — vero per
chiunque sapesse chi fosse l'host, cioè per tutti.

**Cosa si poteva fare.** Espellere gli altri dalla lobby. Prendersi il ruolo
di host. Parlare in chat a nome di un altro. Trascinare tutta la stanza
dentro una partita con le impostazioni che si volevano. Su F1, dichiararsi
del colore dell'host e chiudere la gara a tutti.

**Cosa ho fatto.** Chi crea o entra in una lobby riceve un *gettone* (24 byte
casuali). Il colore resta il nome pubblico; il gettone è la prova. Da lì in
poi chi sei lo sa il server e non lo chiede più a nessuno.
→ `backend/store/lobbies.js`, `backend/sockets/socketManager.js`

### 2. Un messaggio storto spegneva il server

**Com'era.** Socket.io non protegge i gestori che registriamo: se uno lancia
un errore, il processo muore — e si porta dietro **ogni partita di ogni
stanza**. E lanciare era facile: `addRecord` faceva `playerName.toUpperCase()`
su quello che arrivava dalla rete, quindi bastava mandare un numero.

**Cosa ho fatto.** Tutti i gestori sono avvolti in un punto solo: l'errore
finisce nel log col nome dell'evento, la connessione va avanti.
→ `backend/sockets/socketManager.js` (`proteggiGestori`)

### 3. Chiunque poteva cancellare le piste dal server

**Com'era.** `POST /api/f1/tracks` e `DELETE /api/f1/tracks/:id` scrivono e
cancellano file veri sul disco del server. Sono l'editor piste, uno strumento
di sviluppo — ma non c'era **niente** che le chiudesse in produzione. Una
richiesta per riscrivere una pista con qualunque contenuto, e una DELETE in un
ciclo per cancellarle quasi tutte (ne restava una).

Questa è letteralmente la paura del «codice distrutto», ed era vera.

**Cosa ho fatto.** Le rotte che scrivono su disco (editor piste, minimappa,
segnalazioni col tasto M) e il banco prova bot sono attivi **solo in locale**.
La regola è invertita rispetto a prima: sono spenti di default e si accendono
se è evidente che siamo sul portatile — o esplicitamente con
`STRUMENTI_SVILUPPO=on`.
→ `backend/config/ambiente.js`, `backend/routes/lobbyRoutes.js`

### 4. La classifica globale accettava qualunque cosa

**Com'era.** `saveNewRecord` riportava su MongoDB quattro campi mandati dal
client, senza guardarli. Il nome della pista è la **chiave** del documento:
mandarne uno nuovo ogni volta faceva crescere quel documento all'infinito.

**Cosa ho fatto.** Dal messaggio arrivano solo le due cose che il server non
può sapere da sé (le tre lettere del nome e il tempo), e passano da un
controllo. Pista e colore li mette il server.
→ `backend/sockets/games/racingGameSocket.js`, `backend/store/leaderboard.js`

### 5. Del codice altrui che girava nel browser di chi apriva la classifica

**Com'era.** Il colore del giocatore finiva dritto dentro un attributo
`style` della pagina classifica, che lo incolla nell'HTML. E il server
accettava qualunque stringa come colore (la tavolozza esisteva solo nel
frontend, cioè dalla parte di chi la può riscrivere). Lasciare lì del codice
che poi girava nel browser di chiunque aprisse la classifica era questione di
una richiesta.

**Cosa ho fatto.** I dodici colori li decide il server, e quello che si
disegna nella classifica viene ripulito prima di finire nell'HTML.
→ `backend/config/coloriGiocatore.js`, `frontend/lobby.js`

### 6. Nessun tetto a niente

**Com'era.** Aprire lobby (`POST /create-lobby`) faceva crescere la memoria
del server senza limite, e un ciclo di poche righe bastava a riempirla. La
chat rimbalzava ogni messaggio a tutti, alla velocità della rete.
`/api/livery/generate-theme` chiama Gemini, e ogni chiamata **si paga**.

**Cosa ho fatto.** Un limitatore di frequenza minimo, in memoria, senza
dipendenze nuove: 20 lobby al minuto per indirizzo, 10 messaggi ogni 5
secondi, 10 temi al minuto. Non è un firewall: è la differenza fra «chiunque
passi di qui può spegnere il server per noia» e «bisogna volerlo davvero».
→ `backend/middleware/limiteRichieste.js`

### 7. Le API erano aperte a qualunque sito

**Com'era.** `app.use(cors())` senza argomenti vuol dire «chiunque, da
qualunque sito». Il frontend però è servito dallo stesso server delle API:
nessuna nostra pagina ne aveva bisogno, quella porta era aperta solo per gli
altri.

**Cosa ho fatto.** Chiusa, riapribile elencando le origini in
`ORIGINI_CONSENTITE`. Aggiunte le tre intestazioni di base che il browser sa
già usare da solo (`nosniff`, niente cornici altrui attorno al gioco,
l'indirizzo della stanza non viaggia verso siti esterni).
→ `backend/middleware/sicurezzaHttp.js`

### 8. Il canale delle partite aveva un buco noto

`npm audit` segnalava 4 vulnerabilità **alte**, tutte su `ws` — la libreria
che regge le WebSocket sotto socket.io, cioè il canale di ogni partita:
divulgazione di memoria non inizializzata, ed esaurimento memoria mandando
frammenti minuscoli. Chiuse con `npm audit fix`. Da 15 problemi a 8.

### 9. Il colore nell'indirizzo

Non era una vulnerabilità di per sé, ma era la **causa** della n. 1: il
colore stava nell'URL perché era così che il client si ricordava chi era.
Ora l'indirizzo è `?lobby=K3QC48` e basta, e chi sei vive nella scheda.
→ `frontend/shared/sessioneGiocatore.js`

---

## Cosa NON era un problema

- **Le chiavi *di oggi*.** `.env` è in `.gitignore` e non è nel repo (per il
  passato vedi il riquadro in cima). La chiave Gemini resta sul server e non
  viene mai spedita al browser. La `apiKey` di Firebase che si vede nel
  frontend **è pubblica per progetto**: serve a identificare il progetto, non
  a autorizzare — non è un segreto, e va bene che si veda.
- **Il salvataggio della livrea.** Era già fatto bene: l'uid viene dal token
  Firebase verificato, mai dal corpo della richiesta. Nessuno può salvare la
  livrea di un altro.
- **Il caricamento delle piste.** `loadTrack` valida l'id con un'espressione
  regolare prima di toccare il disco: non si può risalire fuori dalla
  cartella delle piste.

---

## Cosa resta aperto

Nessuna di queste è sfruttabile da chi passa di lì per caso. Sono decisioni,
non correzioni dimenticate.

1. **Barare sul proprio tempo.** Il server accetta il tempo sul giro che il
   client gli manda (nel gioco `racing`; F1 invece cronometra lui). Chiuderlo
   vuol dire far cronometrare il server, che è un lavoro a sé. Fra amici non
   è un problema; con una classifica globale pubblica lo diventa.
2. **L'uid nelle partite F1.** Arriva dal client e serve solo a mostrare la
   livrea giusta. Dichiarare l'uid di un altro fa vedere la sua livrea sulla
   propria auto: fastidioso, non pericoloso. Si chiude quando l'account
   diventerà obbligatorio (voce 7 della roadmap, le stagioni).
3. **8 vulnerabilità moderate** restano dentro l'albero di `firebase-admin`
   (pacchetto `uuid`). Per chiuderle serve un aggiornamento che rompe delle
   API: va fatto con calma e con un playtest, non di corsa.
4. **Nessuna Content-Security-Policy.** Le pagine usano stili e gestori
   scritti dentro l'HTML: una policy stretta le spegnerebbe, una larga non
   protegge da niente. Va fatta insieme a una ripulita dell'HTML.
5. **Nessun HTTPS forzato lato applicazione.** Su Render lo fa la
   piattaforma, quindi oggi va bene; se un giorno il gioco girasse altrove,
   va aggiunto.

---

## Prima di aprire al pubblico su Render

Controlla che nelle variabili d'ambiente del servizio ci sia:

| Variabile | Valore | Perché |
|---|---|---|
| `NODE_ENV` | `production` | Spegne gli strumenti di sviluppo. Render imposta già `RENDER=true`, che basta da solo — questa è la cintura oltre alle bretelle. |
| `STRUMENTI_SVILUPPO` | **non impostata** | Se la metti a `on`, l'editor piste torna aperto a chiunque. |
| `MONGODB_URI` | la tua stringa | Senza, la classifica vive solo in memoria e sparisce a ogni riavvio. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | il tuo JSON | Senza, le rotte con account rispondono 503. |
| `GEMINI_API_KEY` | la tua chiave | Solo per la generazione dei temi livrea. |
| `ORIGINI_CONSENTITE` | **non impostata** | Serve solo se un giorno il gioco verrà servito da un dominio diverso dalle API. |

E, se non l'hai ancora fatto, cambia la password di MongoDB: vedi il
riquadro in cima a questa pagina.
