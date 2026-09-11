# Le fotografie del tutorial

Quattro immagini, una per schermata. Le legge `frontend/shared/f1Tutorial.js`
da questa cartella, con QUESTI NOMI ESATTI.

⚠️ Se un file manca, la sua immagine si nasconde da sola e la schermata resta
leggibile: il tutorial non si rompe mentre aspetta le foto.

| file | cosa deve mostrare |
|---|---|
| `weekend.jpg` | La griglia di partenza vista da dietro, con le auto schierate. Deve far capire «sono tutti in fila e si parte da fermi». |
| `partenza.jpg` | Il ponte dei semafori **con le luci accese**, inquadrato come lo vedi dall'abitacolo un attimo prima del via. |
| `sosta.jpg` | L'arrivo in corsia box con il **muro del conto alla rovescia acceso** (quando diventa azzurro). È il momento che il testo descrive. |
| `gomme.jpg` | La schermata di scelta mescola, con le tre carte e i giri di durata. |

## Come scattarle

- **Formato 16:9**, almeno 960×540. Più grandi va bene, vengono ridotte.
- `.jpg` per le fotografie di gioco (pesano molto meno del `.png` a parità di
  resa su un'immagine 3D).
- ⚠️ **Con la legenda admin spenta** (F10 in gara): quelle scritte non le vede
  nessun altro giocatore, e in un tutorial insegnerebbero tasti che per lui
  non esistono.
- Tieni l'HUD normale acceso: fa parte di ciò che il giocatore vedrà.

## Come aggiungerne, togliere o cambiare

Nel file `f1Tutorial.js`, dentro `PASSI`, ogni passo ha un campo `foto`.
Toglilo e la schermata resta senza immagine; cambialo e punta a un altro file.
