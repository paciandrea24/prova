const fs = require('fs');
const wordsByDifficulty = JSON.parse(fs.readFileSync('./words.json', 'utf8'));
const allWords = [...wordsByDifficulty.easy, ...wordsByDifficulty.medium, ...wordsByDifficulty.hard];

module.exports = { wordsByDifficulty, allWords };
