# CLAUDE.md — Progetto "prova"

Web app multiplayer con una collezione di mini-giochi. Repo: https://github.com/paciandrea24/prova
- **Frontend**: HTML/CSS/JS vanilla (+ Three.js r128 da CDN per i giochi 3D).
- **Backend**: Node.js + Express + Socket.io. Stato in memoria (Map), nessun DB (tranne leaderboard su MongoDB opzionale).
- **Realtime**: Socket.io per lobby/segnalazione; alcuni giochi usano WebRTC P2P per il sync in-game.

Avvio locale: `node server.js` dalla cartella `backend/`, poi aprire `localhost:3000`. Per il multiplayer servono due client (due tab).

## Struttura (alto livello)
- `frontend/index.*` + `lobby.*` = ingresso e lobby (hub condiviso da tutti i giochi).
- `frontend/<gioco>.html|js` + `styles/<gioco>.css` = un gioco ciascuno.
- `backend/sockets/socketManager.js` = connessione/lobby/disconnect condivisi; carica i moduli `sockets/games/*`.
- `backend/store/` = store in memoria (`lobbies`, `activeGames`, `leaderboard`).

## Note per-gioco
Le note tecniche dettagliate stanno in file dedicati, da leggere SOLO quando si lavora su quel gioco:
- FPS → `docs/fps-notes.md`
- F1 → `docs/f1-notes.md`

## Convenzioni / preferenze utente
- **Italiano** nelle comunicazioni e nei commenti del codice.
- Procedere **per step**, una feature/fix alla volta, e far verificare all'utente in localhost prima di proseguire.
- L'utente fa il **push manuale** su GitHub quando vuole; **non** committare/pushare senza richiesta.
- Stile asset: "boxy ma dettagliato" (voxel/Minecraft pulito).
