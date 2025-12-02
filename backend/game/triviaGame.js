// game/triviaGame.js
const ITALIAN_QUESTIONS = require('./italianQuestions');

// Funzione di utilità per mescolare un array (Fisher-Yates shuffle)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Funzione simulata che "scarica" le domande (dal file locale)
async function fetchTriviaQuestions(amount = 5) {
    let allQuestions = [...ITALIAN_QUESTIONS];
    shuffleArray(allQuestions);
    const selectedQuestions = allQuestions.slice(0, amount);

    return selectedQuestions.map(item => {
        let options = [...item.incorrect_answers, item.correct_answer];
        options = shuffleArray(options);
        const correctIndex = options.indexOf(item.correct_answer);

        return {
            question: item.question,
            options: options,
            correctIndex: correctIndex,
            imageUrl: item.imageUrl || null // <--- FONDAMENTALE: Questo deve esserci!
        };
    });
}

// Inizializza il gioco
function initializeTriviaGame(gameId, settings, questions) {
    return {
        type: 'trivia',
        isActive: true,
        currentRound: 0,
        totalRounds: questions.length,
        roundDuration: 15,
        timer: 0,

        questionsList: questions,

        currentQuestion: null,
        correctAnswerIndex: -1,
        playerAnswers: {},
        answeredCount: 0,
        scores: {},
    };
}

// Calcolo Punti
function calculateTriviaPoints(timeLeft, totalTime) {
    if (!timeLeft || !totalTime || totalTime === 0) return 10;
    const percentage = timeLeft / totalTime;
    const points = Math.floor(100 * percentage);
    return Math.max(points, 10);
}

// Prende la prossima domanda
function getNextQuestion(game) {
    const roundIndex = game.currentRound;
    if (roundIndex >= game.questionsList.length) return null;

    const q = game.questionsList[roundIndex];

    return {
        text: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        imageUrl: q.imageUrl || null // <--- ANCHE QUI deve esserci!
    };
}

module.exports = {
    initializeTriviaGame,
    calculateTriviaPoints,
    getNextQuestion,
    fetchTriviaQuestions
};