const fs = require('fs');
const path = require('path');
// Percorso ancorato al FILE, non alla cartella da cui si e' lanciato node:
// con './words.json' il modulo si carica solo se il processo parte da
// backend/. Bastava lanciare i test dalla radice del repo perche' ogni file
// che arriva qui per require morisse di ENOENT prima di eseguire un test.
const wordsByDifficulty = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'words.json'), 'utf8'));
const allWords = [...wordsByDifficulty.easy, ...wordsByDifficulty.medium, ...wordsByDifficulty.hard];

module.exports = { wordsByDifficulty, allWords };
