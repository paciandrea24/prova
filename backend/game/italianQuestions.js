// game/italianQuestions.js

/* const ITALIAN_QUESTIONS = [ */
/* // --- GEOGRAFIA ---
{
    category: "Geografia",
    type: "multiple",
    difficulty: "easy",
    question: "Qual è la capitale della Germania?",
    correct_answer: "Berlino",
    incorrect_answers: ["Monaco", "Amburgo", "Francoforte"]
},
{
    category: "Geografia",
    type: "multiple",
    difficulty: "medium",
    question: "Qual è il fiume più lungo del mondo?",
    correct_answer: "Rio delle Amazzoni",
    incorrect_answers: ["Nilo", "Yangtze", "Mississippi"]
},
{
    category: "Geografia",
    type: "multiple",
    difficulty: "hard",
    question: "Qual è la capitale dell'Australia?",
    correct_answer: "Canberra",
    incorrect_answers: ["Sydney", "Melbourne", "Perth"]
},
{
    category: "Geografia",
    type: "multiple",
    difficulty: "medium",
    question: "In quale regione italiana si trova il Gargano?",
    correct_answer: "Puglia",
    incorrect_answers: ["Campania", "Calabria", "Abruzzo"]
},
{
    category: "Geografia",
    type: "multiple",
    difficulty: "hard",
    question: "Quante regioni ha l'Italia?",
    correct_answer: "20",
    incorrect_answers: ["18", "21", "22"]
},
{
    category: "Geografia",
    type: "multiple",
    difficulty: "medium",
    question: "Qual è il monte più alto del Sistema Solare?",
    correct_answer: "Monte Olimpo (Marte)",
    incorrect_answers: ["Monte Everest", "Mauna Kea", "K2"]
},

// --- STORIA ---
{
    category: "Storia",
    type: "multiple",
    difficulty: "easy",
    question: "In che anno Cristoforo Colombo scoprì l'America?",
    correct_answer: "1492",
    incorrect_answers: ["1498", "1500", "1348"]
},
{
    category: "Storia",
    type: "multiple",
    difficulty: "medium",
    question: "Chi fu il primo Imperatore Romano?",
    correct_answer: "Augusto",
    incorrect_answers: ["Giulio Cesare", "Nerone", "Traiano"]
},
{
    category: "Storia",
    type: "multiple",
    difficulty: "hard",
    question: "In che anno è avvenuta l'Unità d'Italia?",
    correct_answer: "1861",
    incorrect_answers: ["1848", "1870", "1900"]
},
{
    category: "Storia",
    type: "multiple",
    difficulty: "medium",
    question: "Quale città fu distrutta dal Vesuvio nel 79 d.C.?",
    correct_answer: "Pompei",
    incorrect_answers: ["Napoli", "Roma", "Atene"]
},
{
    category: "Storia",
    type: "multiple",
    difficulty: "hard",
    question: "Chi era l'ultimo re d'Italia?",
    correct_answer: "Umberto II",
    incorrect_answers: ["Vittorio Emanuele III", "Vittorio Emanuele II", "Carlo Alberto"]
},
{
    category: "Storia",
    type: "multiple",
    difficulty: "medium",
    question: "Quale civiltà ha costruito Machu Picchu?",
    correct_answer: "Inca",
    incorrect_answers: ["Aztechi", "Maya", "Olmechi"]
},

// --- SCIENZA & NATURA ---
{
    category: "Scienza",
    type: "multiple",
    difficulty: "easy",
    question: "Qual è il pianeta più vicino al Sole?",
    correct_answer: "Mercurio",
    incorrect_answers: ["Venere", "Marte", "Terra"]
},
{
    category: "Scienza",
    type: "multiple",
    difficulty: "medium",
    question: "Qual è il simbolo chimico dell'Oro?",
    correct_answer: "Au",
    incorrect_answers: ["Ag", "Fe", "Or"]
},
{
    category: "Scienza",
    type: "multiple",
    difficulty: "hard",
    question: "Quante ossa ci sono nel corpo umano adulto?",
    correct_answer: "206",
    incorrect_answers: ["200", "212", "305"]
},
{
    category: "Scienza",
    type: "multiple",
    difficulty: "medium",
    question: "Cosa misura un anno luce?",
    correct_answer: "Distanza",
    incorrect_answers: ["Tempo", "Luminosità", "Velocità"]
},
{
    category: "Scienza",
    type: "multiple",
    difficulty: "easy",
    question: "Quale gas respiriamo per vivere?",
    correct_answer: "Ossigeno",
    incorrect_answers: ["Elio", "Idrogeno", "Metano"]
},
{
    category: "Natura",
    type: "multiple",
    difficulty: "medium",
    question: "Che tipo di animale è un 'Black Mamba'?",
    correct_answer: "Serpente",
    incorrect_answers: ["Ragno", "Scorpione", "Pantera"]
},

// --- CINEMA & TV ---
{
    category: "Cinema",
    type: "multiple",
    difficulty: "easy",
    question: "Chi ha diretto il film 'E.T. l'extra-terrestre'?",
    correct_answer: "Steven Spielberg",
    incorrect_answers: ["George Lucas", "James Cameron", "Tim Burton"]
},
{
    category: "Cinema",
    type: "multiple",
    difficulty: "medium",
    question: "Quale film ha vinto il premio Oscar come Miglior Film nel 2000?",
    correct_answer: "Il Gladiatore",
    incorrect_answers: ["American Beauty", "Matrix", "Il Signore degli Anelli"]
},
{
    category: "Cinema",
    type: "multiple",
    difficulty: "hard",
    question: "Come si chiama l'attore che interpreta Iron Man nei film Marvel?",
    correct_answer: "Robert Downey Jr.",
    incorrect_answers: ["Chris Evans", "Chris Hemsworth", "Mark Ruffalo"]
},
{
    category: "TV",
    type: "multiple",
    difficulty: "medium",
    question: "Nella serie 'Breaking Bad', cosa insegna Walter White?",
    correct_answer: "Chimica",
    incorrect_answers: ["Fisica", "Matematica", "Biologia"]
},
{
    category: "Cinema",
    type: "multiple",
    difficulty: "easy",
    question: "Qual è il nome del leone nel film 'Il Re Leone'?",
    correct_answer: "Simba",
    incorrect_answers: ["Mufasa", "Scar", "Timon"]
},

// --- LETTERATURA & ARTE ---
{
    category: "Letteratura",
    type: "multiple",
    difficulty: "easy",
    question: "Chi ha scritto 'La Divina Commedia'?",
    correct_answer: "Dante Alighieri",
    incorrect_answers: ["Francesco Petrarca", "Giovanni Boccaccio", "Giacomo Leopardi"]
},
{
    category: "Letteratura",
    type: "multiple",
    difficulty: "medium",
    question: "Qual è il vero nome di Pinocchio?",
    correct_answer: "Pinocchio",
    incorrect_answers: ["Geppetto Jr.", "Burattino", "Carlo"]
},
{
    category: "Letteratura",
    type: "multiple",
    difficulty: "hard",
    question: "Chi è l'autore di '1984'?",
    correct_answer: "George Orwell",
    incorrect_answers: ["Aldous Huxley", "Ray Bradbury", "J.R.R. Tolkien"]
},
{
    category: "Arte",
    type: "multiple",
    difficulty: "medium",
    question: "In quale città si trova il 'David' di Michelangelo?",
    correct_answer: "Firenze",
    incorrect_answers: ["Roma", "Milano", "Venezia"]
},
{
    category: "Arte",
    type: "multiple",
    difficulty: "medium",
    question: "Chi ha dipinto 'La Notte Stellata'?",
    correct_answer: "Vincent van Gogh",
    incorrect_answers: ["Pablo Picasso", "Claude Monet", "Salvador Dalì"]
},

// --- SPORT ---
{
    category: "Sport",
    type: "multiple",
    difficulty: "easy",
    question: "Quale nazione ha vinto i Mondiali di calcio 2006?",
    correct_answer: "Italia",
    incorrect_answers: ["Francia", "Brasile", "Germania"]
},
{
    category: "Sport",
    type: "multiple",
    difficulty: "medium",
    question: "Quanti giocatori ci sono in una squadra di pallavolo in campo?",
    correct_answer: "6",
    incorrect_answers: ["5", "7", "11"]
},
{
    category: "Sport",
    type: "multiple",
    difficulty: "hard",
    question: "Chi detiene il record mondiale dei 100 metri piani maschili?",
    correct_answer: "Usain Bolt",
    incorrect_answers: ["Carl Lewis", "Marcell Jacobs", "Tyson Gay"]
},
{
    category: "Sport",
    type: "multiple",
    difficulty: "medium",
    question: "In quale sport si usa il termine 'ace'?",
    correct_answer: "Tennis",
    incorrect_answers: ["Calcio", "Basket", "Nuoto"]
},

// --- CIBO ---
{
    category: "Cibo",
    type: "multiple",
    difficulty: "easy",
    question: "Quale ingrediente NON va nella vera Carbonara?",
    correct_answer: "Panna",
    incorrect_answers: ["Uova", "Guanciale", "Pepe"]
},
{
    category: "Cibo",
    type: "multiple",
    difficulty: "medium",
    question: "Di quale regione sono originari gli Arrosticini?",
    correct_answer: "Abruzzo",
    incorrect_answers: ["Toscana", "Puglia", "Sicilia"]
},
{
    category: "Cibo",
    type: "multiple",
    difficulty: "hard",
    question: "Cos'è il Tofu?",
    correct_answer: "Formaggio di soia",
    incorrect_answers: ["Formaggio di capra", "Radice fermentata", "Alga essiccata"]
},

// --- VIDEOGIOCHI & TECNOLOGIA ---
{
    category: "Videogiochi",
    type: "multiple",
    difficulty: "easy",
    question: "Come si chiama l'idraulico più famoso dei videogiochi?",
    correct_answer: "Mario",
    incorrect_answers: ["Luigi", "Wario", "Sonic"]
},
{
    category: "Videogiochi",
    type: "multiple",
    difficulty: "medium",
    question: "Quale azienda ha creato la PlayStation?",
    correct_answer: "Sony",
    incorrect_answers: ["Nintendo", "Microsoft", "Sega"]
},
{
    category: "Tecnologia",
    type: "multiple",
    difficulty: "medium",
    question: "Cosa significa la sigla 'WWW'?",
    correct_answer: "World Wide Web",
    incorrect_answers: ["World Web Wide", "Web World Wide", "Wide World Web"]
},
{
    category: "Tecnologia",
    type: "multiple",
    difficulty: "hard",
    question: "In che anno è stato lanciato il primo iPhone?",
    correct_answer: "2007",
    incorrect_answers: ["2005", "2009", "2003"]
},

// --- MUSICA ---
{
    category: "Musica",
    type: "multiple",
    difficulty: "easy",
    question: "Chi è soprannominato il 'Re del Pop'?",
    correct_answer: "Michael Jackson",
    incorrect_answers: ["Elvis Presley", "Prince", "Freddie Mercury"]
},
{
    category: "Musica",
    type: "multiple",
    difficulty: "medium",
    question: "Quante corde ha solitamente una chitarra elettrica?",
    correct_answer: "6",
    incorrect_answers: ["4", "5", "8"]
},
{
    category: "Musica",
    type: "multiple",
    difficulty: "hard",
    question: "Chi cantava 'Bohemian Rhapsody'?",
    correct_answer: "Queen",
    incorrect_answers: ["Beatles", "Rolling Stones", "Pink Floyd"]
},

// --- CURIOSITÀ ---
{
    category: "Curiosità",
    type: "multiple",
    difficulty: "medium",
    question: "Quale animale dorme in piedi?",
    correct_answer: "Cavallo",
    incorrect_answers: ["Cane", "Gatto", "Orso"]
},
{
    category: "Curiosità",
    type: "multiple",
    difficulty: "easy",
    question: "Quanti giorni ci sono in un anno bisestile?",
    correct_answer: "366",
    incorrect_answers: ["365", "364", "360"]
},
{
    category: "Curiosità",
    type: "multiple",
    difficulty: "hard",
    question: "Qual è il materiale naturale più duro?",
    correct_answer: "Diamante",
    incorrect_answers: ["Acciaio", "Titanio", "Grafite"]
},
{
    category: "Curiosità",
    type: "multiple",
    difficulty: "medium",
    question: "Qual è la lingua più parlata al mondo (madrelingua)?",
    correct_answer: "Cinese Mandarino",
    incorrect_answers: ["Inglese", "Spagnolo", "Arabo"]
},
{
    category: "Curiosità",
    type: "multiple",
    difficulty: "easy",
    question: "Di che colore è la scatola nera degli aerei?",
    correct_answer: "Arancione",
    incorrect_answers: ["Nera", "Rossa", "Gialla"]
},

// --- NUOVE DOMANDE VISIVE (ARTISTI E OPERE) ---
{
    category: "Arte",
    type: "image",
    difficulty: "medium",
    question: "Chi è l'autore di questo famoso dipinto 'L'Urlo'?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg/960px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg",
    correct_answer: "Edvard Munch",
    incorrect_answers: ["Vincent van Gogh", "Pablo Picasso", "Claude Monet"]
},
{
    category: "Arte",
    type: "image",
    difficulty: "hard",
    question: "Come si chiama quest'opera di Botticelli?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg/800px-Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg",
    correct_answer: "Nascita di Venere",
    incorrect_answers: ["La Primavera", "Venere di Urbino", "Le tre Grazie"]
},
{
    category: "Arte",
    type: "image",
    difficulty: "easy",
    question: "Chi è questa famosa pittrice messicana?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg/640px-Frida_Kahlo%2C_by_Guillermo_Kahlo.jpg",
    correct_answer: "Frida Kahlo",
    incorrect_answers: ["Maria Callas", "Eva Peron", "Tamara de Lempicka"]
},
{
    category: "Arte",
    type: "image",
    difficulty: "medium",
    question: "Chi ha scolpito questa statua (Il Pensatore)?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/The_Thinker%2C_Rodin.jpg/960px-The_Thinker%2C_Rodin.jpg",
    correct_answer: "Auguste Rodin",
    incorrect_answers: ["Donatello", "Bernini", "Michelangelo"]
},

// --- MONUMENTI E LUOGHI ---
{
    category: "Geografia",
    type: "image",
    difficulty: "easy",
    question: "Come si chiama questo famoso monumento indiano?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Taj_Mahal_%28Edited%29.jpeg/800px-Taj_Mahal_%28Edited%29.jpeg",
    correct_answer: "Taj Mahal",
    incorrect_answers: ["Tempio d'Oro", "Angkor Wat", "Palazzo dei Venti"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "medium",
    question: "In quale città si trova questa cattedrale (San Basilio)?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/%D0%A5%D1%80%D0%B0%D0%BC_%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D1%8F_%D0%91%D0%BB%D0%B0%D0%B6%D0%B5%D0%BD%D0%BD%D0%BE%D0%B3%D0%BE_%E2%84%962.JPG/960px-%D0%A5%D1%80%D0%B0%D0%BC_%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D1%8F_%D0%91%D0%BB%D0%B0%D0%B6%D0%B5%D0%BD%D0%BD%D0%BE%D0%B3%D0%BE_%E2%84%962.JPG",
    correct_answer: "Mosca",
    incorrect_answers: ["San Pietroburgo", "Kiev", "Varsavia"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "easy",
    question: "Quale città è famosa per questo ponte?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Tower_Bridge_from_Shad_Thames.jpg/800px-Tower_Bridge_from_Shad_Thames.jpg",
    correct_answer: "Londra",
    incorrect_answers: ["New York", "San Francisco", "Sydney"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "hard",
    question: "Come si chiama questo sito archeologico in Giordania?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Treasury_petra_crop.jpeg/640px-Treasury_petra_crop.jpeg",
    correct_answer: "Petra",
    incorrect_answers: ["Palmira", "Luxor", "Machu Picchu"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "medium",
    question: "Dove si trova questa statua (Cristo Redentore)?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Christ_the_Redeemer_-_Cristo_Redentor.jpg/500px-Christ_the_Redeemer_-_Cristo_Redentor.jpg",
    correct_answer: "Rio de Janeiro",
    incorrect_answers: ["Buenos Aires", "Lisbona", "Barcellona"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "medium",
    question: "Qual è il nome di questa struttura preistorica?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Stonehenge2007_07_30.jpg/800px-Stonehenge2007_07_30.jpg",
    correct_answer: "Stonehenge",
    incorrect_answers: ["Newgrange", "Dolmen di Poulnabrone", "Carnac"]
},

// --- BANDIERE ---
{
    category: "Geografia",
    type: "image",
    difficulty: "easy",
    question: "Di quale nazione è questa bandiera?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Flag_of_Canada_%28Pantone%29.svg/800px-Flag_of_Canada_%28Pantone%29.svg.png",
    correct_answer: "Canada",
    incorrect_answers: ["Perù", "Austria", "Libano"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "medium",
    question: "Di quale nazione è questa bandiera?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Flag_of_Brazil.svg/800px-Flag_of_Brazil.svg.png",
    correct_answer: "Brasile",
    incorrect_answers: ["Argentina", "Portogallo", "Colombia"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "hard",
    question: "A quale stato europeo appartiene questa bandiera?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Flag_of_Sweden.svg/800px-Flag_of_Sweden.svg.png",
    correct_answer: "Svezia",
    incorrect_answers: ["Finlandia", "Norvegia", "Danimarca"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "hard",
    question: "Di quale paese è questa bandiera?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Flag_of_Argentina.svg/800px-Flag_of_Argentina.svg.png",
    correct_answer: "Argentina",
    incorrect_answers: ["Uruguay", "Grecia", "Honduras"]
},
{
    category: "Geografia",
    type: "image",
    difficulty: "medium",
    question: "Questa è l'unica bandiera quadrata al mondo. Di chi è?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Flag_of_Switzerland.svg/600px-Flag_of_Switzerland.svg.png",
    correct_answer: "Svizzera",
    incorrect_answers: ["Vaticano", "Monaco", "Belgio"]
},

// --- PERSONAGGI FAMOSI ---
{
    category: "Personaggi",
    type: "image",
    difficulty: "easy",
    question: "Chi è questo imprenditore informatico?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Steve_Jobs_Headshot_2010-CROP_%28cropped_2%29.jpg/640px-Steve_Jobs_Headshot_2010-CROP_%28cropped_2%29.jpg",
    correct_answer: "Steve Jobs",
    incorrect_answers: ["Bill Gates", "Elon Musk", "Tim Cook"]
},
{
    category: "Personaggi",
    type: "image",
    difficulty: "easy",
    question: "Chi è questa icona del cinema?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Marilyn_Monroe_in_How_to_Marry_a_Millionaire.jpg",
    correct_answer: "Marilyn Monroe",
    incorrect_answers: ["Audrey Hepburn", "Grace Kelly", "Elizabeth Taylor"]
},
{
    category: "Personaggi",
    type: "image",
    difficulty: "medium",
    question: "Chi è questo famoso attore del cinema muto?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Charlie_Chaplin_portrait.jpg/640px-Charlie_Chaplin_portrait.jpg",
    correct_answer: "Charlie Chaplin",
    incorrect_answers: ["Buster Keaton", "Stanlio", "Ollio"]
},
{
    category: "Personaggi",
    type: "image",
    difficulty: "medium",
    question: "Riconosci questo leader mondiale?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Nelson_Mandela-2008_%28edit%29.jpg/640px-Nelson_Mandela-2008_%28edit%29.jpg",
    correct_answer: "Nelson Mandela",
    incorrect_answers: ["Martin Luther King", "Barack Obama", "Morgan Freeman"]
},
{
    category: "Musica",
    type: "image",
    difficulty: "medium",
    question: "Chi è questo leggendario chitarrista?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ae/Jimi_Hendrix_1967.png",
    correct_answer: "Jimi Hendrix",
    incorrect_answers: ["Bob Marley", "Lenny Kravitz", "Prince"]
},

// --- ANIMALI ---
{
    category: "Animali",
    type: "image",
    difficulty: "hard",
    question: "Che animale è questo?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/5b/A_Kis_Panda.jpg",
    correct_answer: "Panda Minore",
    incorrect_answers: ["Volpe", "Procione", "Lemure"]
},
{
    category: "Animali",
    type: "image",
    difficulty: "medium",
    question: "Come si chiama questo animale australiano?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Wild_Platypus_4.jpg",
    correct_answer: "Ornitorinco",
    incorrect_answers: ["Castoro", "Talpa", "Echidna"]
},
{
    category: "Animali",
    type: "image",
    difficulty: "medium",
    question: "Quale animale è raffigurato?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/3/34/Hydrochoeris_hydrochaeris_in_Brazil_in_Petr%C3%B3polis%2C_Rio_de_Janeiro%2C_Brazil_09.jpg",
    correct_answer: "Capibara",
    incorrect_answers: ["Nutria", "Cavia", "Vombato"]
},
{
    category: "Animali",
    type: "image",
    difficulty: "easy",
    question: "Che tipo di rettile è questo?",
    imageUrl: "https://commons.wikimedia.org/w/index.php?title=Category:Chamaeleonidae&uselang=it#/media/File:Bradypodion_pumilum_Cape_chameleon_female_IMG_1767_(cropped).jpg",
    correct_answer: "Camaleonte",
    incorrect_answers: ["Iguana", "Geco", "Drago di Komodo"]
},
{
    category: "Animali",
    type: "image",
    difficulty: "hard",
    question: "Come si chiama questo anfibio messicano?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/2/20/Ambystoma_mexicanum_Natural_History_Museum_University_of_Pisa_%28cropped%29.jpg",
    correct_answer: "Axolotl",
    incorrect_answers: ["Salamandra", "Tritone", "Geco Leopardo"]
},

// --- SCIENZA E SPAZIO ---
{
    category: "Scienza",
    type: "image",
    difficulty: "easy",
    question: "Quale pianeta è famoso per i suoi anelli?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/800px-Saturn_during_Equinox.jpg",
    correct_answer: "Saturno",
    incorrect_answers: ["Giove", "Urano", "Nettuno"]
},
{
    category: "Scienza",
    type: "image",
    difficulty: "medium",
    question: "Quale organo del corpo umano è mostrato?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Diagram_of_the_human_heart_%28cropped%29.svg/640px-Diagram_of_the_human_heart_%28cropped%29.svg.png",
    correct_answer: "Cuore",
    incorrect_answers: ["Fegato", "Polmoni", "Reni"]
},
{
    category: "Scienza",
    type: "image",
    difficulty: "easy",
    question: "Che strumento scientifico è questo?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/53/Fine_rotative_table_Microscope_5_%2812996283235%29.jpg",
    correct_answer: "Microscopio",
    incorrect_answers: ["Telescopio", "Stetoscopio", "Periscopio"]
},
{
    category: "Scienza",
    type: "image",
    difficulty: "medium",
    question: "Cosa rappresenta questa struttura a doppia elica?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f5/DNA_Overview_it.png",
    correct_answer: "DNA",
    incorrect_answers: ["RNA", "Proteina", "Atomo"]
},

// --- CIBO ---
{
    category: "Cibo",
    type: "image",
    difficulty: "easy",
    question: "Qual è il nome di questo piatto giapponese?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Sushi_platter.jpg/800px-Sushi_platter.jpg",
    correct_answer: "Sushi",
    incorrect_answers: ["Ramen", "Tempura", "Gyoza"]
},
{
    category: "Cibo",
    type: "image",
    difficulty: "medium",
    question: "Come si chiamano questi dolcetti francesi?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e2/Macaron_colorati_1.JPG",
    correct_answer: "Macarons",
    incorrect_answers: ["Meringhe", "Bignè", "Eclair"]
},
{
    category: "Cibo",
    type: "image",
    difficulty: "medium",
    question: "Qual è questo famoso piatto spagnolo?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/0/04/ValencianPaella.jpg",
    correct_answer: "Paella",
    incorrect_answers: ["Tapas", "Tortilla", "Gazpacho"]
},

// --- CULTURA POP ---
{
    category: "TV",
    type: "image",
    difficulty: "easy",
    question: "Di quale famiglia animata è questa casa?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/it/b/ba/The_Simpson.jpg",
    correct_answer: "I Simpson",
    incorrect_answers: ["I Griffin", "I Flintstones", "American Dad"]
},
{
    category: "Giochi",
    type: "image",
    difficulty: "medium",
    question: "Come si chiama questo oggetto?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Rubiks_cube_by_keqs.jpg",
    correct_answer: "Cubo di Rubik",
    incorrect_answers: ["Piramide di Meffert", "Megaminx", "Cubo Magico"]
},
{
    category: "Giochi",
    type: "image",
    difficulty: "easy",
    question: "Che pezzo degli scacchi è questo?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Chess_piece_-_White_king.jpg",
    correct_answer: "Re",
    incorrect_answers: ["Regina", "Alfiere", "Torre"]
},
// --- 🎤 KARAOKE (COMPLETA LA CANZONE) ---
{
    category: "Musica",
    type: "multiple",
    difficulty: "easy",
    question: "Completa il testo: 'Certi amori non finiscono...'",
    correct_answer: "Fanno dei giri immensi e poi ritornano",
    incorrect_answers: ["Restano sempre nel cuore", "E non ci lasceranno mai", "Come le onde del mare"]
},
{
    category: "Musica",
    type: "multiple",
    difficulty: "easy",
    question: "Completa: 'Ma il cielo è sempre più...'",
    correct_answer: "Blu",
    incorrect_answers: ["Viola", "Nero", "Limpido"]
},
{
    category: "Musica",
    type: "multiple",
    difficulty: "medium",
    question: "Completa la sigla: 'Sembra talco ma non è...'",
    correct_answer: "Serve a darti l'allegria!",
    incorrect_answers: ["È farina di magia!", "Biancaneve è scappata via!", "È zucchero e fantasia!"]
},
{
    category: "Musica",
    type: "multiple",
    difficulty: "easy",
    question: "Queen: 'Mama, just killed a man...'",
    correct_answer: "Put a gun against his head",
    incorrect_answers: ["Pulled the trigger now he's dead", "Sent him to his bed", "Shot him until he bled"]
},
{
    category: "Musica",
    type: "multiple",
    difficulty: "medium",
    question: "883: 'Hanno ucciso l'Uomo Ragno, chi sia stato...'",
    correct_answer: "Non si sa",
    incorrect_answers: ["Forse noi", "La polizia", "Il Goblin"]
},

// --- 🤯 EFFETTO MANDELA (TI RICORDI MALE!) ---
{
    category: "Curiosità",
    type: "image",
    difficulty: "hard",
    question: "Il personaggio del Monopoly ha il monocolo?",
    imageUrl: "https://static.wikia.nocookie.net/mandela-effect/images/1/11/Sub-buzz-7165-1476217730-1.jpg/revision/latest?cb=20170213194026",
    correct_answer: "NO, mai avuto",
    incorrect_answers: ["SÌ, sull'occhio destro", "SÌ, sull'occhio sinistro", "Solo nelle vecchie edizioni"]
},
{
    category: "Curiosità",
    type: "image",
    difficulty: "hard",
    question: "Di che colore è la punta della coda di Pikachu?",
    imageUrl: "https://upload.wikimedia.org/wikipedia/en/a/a6/Pok%C3%A9mon_Pikachu_art.png",
    correct_answer: "Tutta gialla",
    incorrect_answers: ["Nera", "Marrone", "Bianca"]
},
{
    category: "Film",
    type: "multiple",
    difficulty: "hard",
    question: "Cosa dice Darth Vader a Luke Skywalker?",
    correct_answer: "No, io sono tuo padre",
    incorrect_answers: ["Luke, io sono tuo padre", "Tu non sai la verità", "Obi-Wan non ti ha detto tutto"]
},
{
    category: "Film",
    type: "multiple",
    difficulty: "medium",
    question: "Biancaneve: Cosa dice la Regina allo specchio?",
    correct_answer: "Specchio, servo delle mie brame",
    incorrect_answers: ["Specchio, specchio delle mie brame", "Specchio fatato, dimmi chi è", "Oh specchio, chi è la più bella"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Cosa dice sempre il ragazzo in foto?",
    imageUrl: "/imgs/avatars/1.png",
    correct_answer: "Ce ne andiaaaamo?",
    incorrect_answers: ["Ce ne andiamo viaa?", "Ce ne scappiaaamo?", "Non andiaaamo domani"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Cosa ha sotto gli occhi la ragazza in foto?",
    imageUrl: "/imgs/avatars/2.png",
    correct_answer: "Occhiaie pronunciate",
    incorrect_answers: ["Occhi aierini", "Naso", "Borse"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Qual è il talento del ragazzo in foto?",
    imageUrl: "/imgs/avatars/3.png",
    correct_answer: "Imitare le voci",
    incorrect_answers: ["Imitare i suoni", "Passare Machine Learning", "Sciupare le femmine"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Questo ragazzo ha il vizio di usare spesso un termine particolare, qual'è?",
    imageUrl: "/imgs/avatars/4.png",
    correct_answer: "Giacchè",
    incorrect_answers: ["Alchè", "Giammai", "Giacca"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Qual è l'espressione preferita del ragazzo in foto?",
    imageUrl: "/imgs/avatars/5.png",
    correct_answer: "È una zzzoccola",
    incorrect_answers: ["Ce ne andiaaamo?", "Gamification", "Stranger Things"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Qual è il cibo preferito del ragazzo in foto?",
    imageUrl: "/imgs/avatars/6.png",
    correct_answer: "Pasta con l'aglio",
    incorrect_answers: ["Thailandese", "Pizza", "Fiorentina"]
},
{
    category: "Personaggi famosi",
    type: "image",
    difficulty: "hard",
    question: "Qual'è l'attività che dovrebbe fare giornalmente il ragazzo in foto?",
    imageUrl: "/imgs/avatars/7.png",
    correct_answer: "Pushare",
    incorrect_answers: ["Tulodiciare", "DevFestare", "Caffettare"]
}, */

/*  {
     category: "Arte",
     type: "image",
     difficulty: "hard",
     question: "Chi ha dipinto questo quadro?",
     // Lascia imageSearch (non fa male), ma aggiungi imageUrl per forzare questa foto:
     imageSearch: "La persistenza della memoria",
     // Link diretto (preso da Wikipedia EN o altra fonte stabile)
     imageUrl: "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Persistence_of_Memory.jpg",
     correct_answer: "Salvador Dalì",
     incorrect_answers: ["Picasso", "Magritte", "Mirò"]
 },
 {
     category: "Personaggi",
     type: "image",
     difficulty: "easy",
     question: "Chi è questo famoso scienziato?",
     imageSearch: "Albert Einstein", // Cercherà automaticamente la foto su Wiki
     correct_answer: "Albert Einstein",
     incorrect_answers: ["Newton", "Tesla", "Galileo"]
 },

];

module.exports = ITALIAN_QUESTIONS; */


/* const ITALIAN_QUESTIONS = [
    // ============================================================
    //  🧠 CULTURA GENERALE & STORIA (Solo Testo - Difficili)
    // ============================================================
    {
        category: "Storia",
        type: "multiple",
        difficulty: "hard",
        question: "In che anno è caduto l'Impero Romano d'Occidente?",
        correct_answer: "476 d.C.",
        incorrect_answers: ["1492 d.C.", "313 d.C.", "800 d.C."]
    },
    {
        category: "Letteratura",
        type: "multiple",
        difficulty: "hard",
        question: "Chi ha scritto 'Il nome della rosa'?",
        correct_answer: "Umberto Eco",
        incorrect_answers: ["Italo Calvino", "Luigi Pirandello", "Dante Alighieri"]
    },
    {
        category: "Scienza",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'elemento chimico più abbondante nell'Universo?",
        correct_answer: "Idrogeno",
        incorrect_answers: ["Ossigeno", "Carbonio", "Elio"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "hard",
        question: "Qual è il deserto più grande del mondo (inclusi quelli polari)?",
        correct_answer: "Antartide",
        incorrect_answers: ["Sahara", "Gobi", "Kalahari"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Quale stile artistico è associato a Claude Monet?",
        correct_answer: "Impressionismo",
        incorrect_answers: ["Cubismo", "Surrealismo", "Barocco"]
    },
    {
        category: "Tecnologia",
        type: "boolean",
        difficulty: "medium",
        question: "Vero o Falso: Il primo uomo sulla luna aveva uno smartphone più potente dei computer della NASA dell'epoca.",
        correct_answer: "Falso", // I computer erano molto meno potenti di un moderno smartphone
        incorrect_answers: ["Vero"]
    },
    {
        category: "Mitologia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi è il dio greco del mare?",
        correct_answer: "Poseidone",
        incorrect_answers: ["Zeus", "Ares", "Apollo"]
    },
    {
        category: "Sport",
        type: "multiple",
        difficulty: "hard",
        question: "In quale città si sono svolte le prime Olimpiadi moderne (1896)?",
        correct_answer: "Atene",
        incorrect_answers: ["Parigi", "Londra", "Roma"]
    },

    // ============================================================
    //  🖼️ ARTE & ARCHITETTURA (Immagini - Livello Avanzato)
    // ============================================================
    {
        category: "Arte",
        type: "image",
        difficulty: "hard",
        question: "Come si chiama questa celebre opera giapponese?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Great_Wave_off_Kanagawa2.jpg/640px-Great_Wave_off_Kanagawa2.jpg",
        correct_answer: "La grande onda di Kanagawa",
        incorrect_answers: ["Il Monte Fuji Rosso", "Ciliegi in fiore", "La tempesta perfetta"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "hard",
        question: "Chi è l'autore di quest'opera surrealista?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Persistence_of_Memory.jpg", // Link stabile Wikipedia EN fair use
        correct_answer: "Salvador Dalí",
        incorrect_answers: ["René Magritte", "Joan Miró", "Pablo Picasso"]
    },
    {
        category: "Architettura",
        type: "image",
        difficulty: "medium",
        question: "Quale famoso architetto ha progettato questa casa (Casa Batlló)?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Casa_Batll%C3%B3_01.jpg/450px-Casa_Batll%C3%B3_01.jpg",
        correct_answer: "Antoni Gaudí",
        incorrect_answers: ["Le Corbusier", "Frank Lloyd Wright", "Renzo Piano"]
    },
    {
        category: "Luoghi",
        type: "image",
        difficulty: "hard",
        question: "In quale nazione si trova questo castello (Neuschwanstein)?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Schloss_Neuschwanstein_2013.jpg/600px-Schloss_Neuschwanstein_2013.jpg",
        correct_answer: "Germania",
        incorrect_answers: ["Austria", "Svizzera", "Francia"]
    },

    // ============================================================
    //  🔬 SCIENZA & NATURA (Zoom & Dettagli)
    // ============================================================
    {
        category: "Zoom",
        type: "image",
        difficulty: "hard",
        question: "Cosa stiamo guardando al microscopio?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Snowflake_macro_photography_1.jpg/600px-Snowflake_macro_photography_1.jpg",
        correct_answer: "Un fiocco di neve",
        incorrect_answers: ["Un cristallo di sale", "Un diamante grezzo", "Vetro rotto"]
    },
    {
        category: "Natura",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama questo fenomeno atmosferico?",
        imageUrl: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=600&q=80",
        correct_answer: "Via Lattea (Galassia)",
        incorrect_answers: ["Aurora Boreale", "Nebulosa di Orione", "Andromeda"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "hard",
        question: "Che animale è questo (visto da molto vicino)?",
        imageUrl: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&q=80",
        correct_answer: "Mosca / Insetto",
        incorrect_answers: ["Ragno", "Granchio", "Alieno"]
    },

    // ============================================================
    //  🎥 CINEMA & PERSONAGGI (Meno banali)
    // ============================================================
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Da quale famoso film di Kubrick è tratta questa scena?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/en/a/a6/2001_A_Space_Odyssey_Style_B.jpg", // Poster iconico
        correct_answer: "2001: Odissea nello spazio",
        incorrect_answers: ["Interstellar", "Star Wars", "Blade Runner"]
    },
    {
        category: "Personaggi",
        type: "image",
        difficulty: "hard",
        question: "Chi è questo storico Primo Ministro britannico?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Sir_Winston_Churchill_-_19086236948.jpg/480px-Sir_Winston_Churchill_-_19086236948.jpg",
        correct_answer: "Winston Churchill",
        incorrect_answers: ["Franklin D. Roosevelt", "Margaret Thatcher", "John F. Kennedy"]
    },

    // ============================================================
    //  🔠 LOGICA & PAROLE (Testuali per spezzare il ritmo)
    // ============================================================
    {
        category: "Logica",
        type: "multiple",
        difficulty: "hard",
        question: "Se un mattone pesa 1 kg più mezzo mattone, quanto pesa un mattone?",
        correct_answer: "2 kg",
        incorrect_answers: ["1.5 kg", "1 kg", "2.5 kg"]
    },
    {
        category: "Proverbi",
        type: "multiple",
        difficulty: "medium",
        question: "Completa il proverbio: 'Chi la dura...'",
        correct_answer: "La vince",
        incorrect_answers: ["Non molla", "La spunta", "Arriva in fondo"]
    },
    {
        category: "Cucina",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'ingrediente base della pasta 'Cacio e Pepe' oltre al formaggio?",
        correct_answer: "Pepe Nero",
        incorrect_answers: ["Olio d'oliva", "Burro", "Panna"]
    },
    {
        category: "Scienza",
        type: "multiple",
        difficulty: "medium",
        question: "A quale temperatura l'acqua bolle a livello del mare?",
        correct_answer: "100°C",
        incorrect_answers: ["90°C", "110°C", "80°C"]
    },
];

module.exports = ITALIAN_QUESTIONS; */



const ITALIAN_QUESTIONS = [
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "In quale città si trovava l'antica Biblioteca famosa per la sua vastità di testi?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/6/64/Ancientlibraryalex.jpg",
        imageSearch: "Biblioteca di Alessandria",
        correct_answer: "Alessandria d'Egitto",
        incorrect_answers: ["Atene", "Roma", "Cartagine"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il fiume più lungo d'Europa?",
        correct_answer: "Volga",
        incorrect_answers: ["Danubio", "Dnepr", "Reno"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha dipinto il famoso affresco 'La Creazione di Adamo'?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Creaci%C3%B3n_de_Ad%C3%A1n.jpg",
        imageSearch: "Creazione di Adamo",
        correct_answer: "Michelangelo",
        incorrect_answers: ["Raffaello", "Leonardo da Vinci", "Caravaggio"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il pianeta più grande del sistema solare?",
        correct_answer: "Giove",
        incorrect_answers: ["Saturno", "Nettuno", "Urano"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Chi è il regista del film 'Pulp Fiction'?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/it/0/06/Pulp_Fiction.png",
        imageSearch: "Pulp Fiction",
        correct_answer: "Quentin Tarantino",
        incorrect_answers: ["Martin Scorsese", "Steven Spielberg", "Ridley Scott"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'animale terrestre più veloce?",
        correct_answer: "Ghepardo",
        incorrect_answers: ["Leone", "Tigre", "Antilope"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale città si trova la famosa struttura chiamata Taj Mahal?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/5a/Monument_wiecznej_milosci-Taj_Mahal_Agra_-_panoramio.jpg",
        imageSearch: "Taj Mahal",
        correct_answer: "Agra",
        incorrect_answers: ["Delhi", "Jaipur", "Mumbai"]
    },
    {
        category: "Letteratura",
        type: "multiple",
        difficulty: "medium",
        question: "Chi ha scritto 'Il Nome della Rosa'?",
        correct_answer: "Umberto Eco",
        incorrect_answers: ["Alessandro Manzoni", "Italo Calvino", "Dino Buzzati"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il primo presidente degli Stati Uniti?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b6/Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg",
        imageSearch: "George Washington",
        correct_answer: "George Washington",
        incorrect_answers: ["Thomas Jefferson", "John Adams", "Benjamin Franklin"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale montagna è la più alta del mondo?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/bf/Mt._Everest_from_Gokyo_Ri_November_5%2C_2012_Cropped.jpg",
        imageSearch: "Monte Everest",
        correct_answer: "Everest",
        incorrect_answers: ["K2", "Kangchenjunga", "Lhotse"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Chi interpreta Jack Dawson in 'Titanic'?",
        correct_answer: "Leonardo DiCaprio",
        incorrect_answers: ["Brad Pitt", "Tom Cruise", "Matt Damon"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama la celebre scultura che rappresenta un uomo che pensa?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/5/56/The_Thinker%2C_Rodin.jpg",
        imageSearch: "Il Pensatore Rodin",
        correct_answer: "Il Pensatore",
        incorrect_answers: ["David", "La Pietà", "La Nike di Samotracia"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il gas più abbondante nell’atmosfera terrestre?",
        correct_answer: "Azoto",
        incorrect_answers: ["Ossigeno", "Anidride carbonica", "Argon"]
    },
    {
        category: "Musica",
        type: "image",
        difficulty: "medium",
        question: "Chi è l'autore della celebre 'Nona Sinfonia'?",
        imageSearch: "Ludwig van Beethoven",
        correct_answer: "Ludwig van Beethoven",
        incorrect_answers: ["Mozart", "Bach", "Tchaikovsky"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova la Statua della Libertà?",
        imageSearch: "Statua della Libertà",
        correct_answer: "New York",
        incorrect_answers: ["Boston", "Washington D.C.", "Philadelphia"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "In quale anno è caduto l’Impero Romano d’Occidente?",
        correct_answer: "476 d.C.",
        incorrect_answers: ["410 d.C.", "325 d.C.", "540 d.C."]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la capitale del Canada?",
        correct_answer: "Ottawa",
        incorrect_answers: ["Toronto", "Vancouver", "Montreal"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha dipinto 'La Notte Stellata'?",
        imageSearch: "La Notte Stellata Van Gogh",
        correct_answer: "Vincent van Gogh",
        incorrect_answers: ["Monet", "Picasso", "Renoir"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi era il celebre fisico che formulò la teoria della relatività?",
        imageSearch: "Albert Einstein",
        correct_answer: "Albert Einstein",
        incorrect_answers: ["Isaac Newton", "Niels Bohr", "Max Planck"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'unità di misura della forza?",
        correct_answer: "Newton",
        incorrect_answers: ["Joule", "Pascal", "Watt"]
    },

    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trova il Machu Picchu?",
        imageSearch: "Machu Picchu",
        correct_answer: "Perù",
        incorrect_answers: ["Bolivia", "Cile", "Argentina"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Quale film ha introdotto il personaggio di Indiana Jones?",
        correct_answer: "I predatori dell'Arca perduta",
        incorrect_answers: ["Indiana Jones e il Tempio Maledetto", "L'Ultima Crociata", "Il Regno del Teschio di Cristallo"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu l'eroe nazionale francese noto per aver guidato l'esercito durante la Guerra dei Cent'Anni?",
        imageSearch: "Giovanna d'Arco",
        correct_answer: "Giovanna d'Arco",
        incorrect_answers: ["Maria Antonietta", "Caterina de' Medici", "Eleonora d'Aquitania"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova il celebre affresco 'Il Cenacolo'?",
        imageSearch: "Cenacolo Milano",
        correct_answer: "Milano",
        incorrect_answers: ["Venezia", "Firenze", "Roma"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quanti cuori ha un polpo?",
        correct_answer: "Tre",
        incorrect_answers: ["Uno", "Due", "Quattro"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale città si trova la Sagrada Família?",
        imageSearch: "Sagrada Família",
        correct_answer: "Barcellona",
        incorrect_answers: ["Madrid", "Valencia", "Siviglia"]
    },
    {
        category: "Letteratura",
        type: "multiple",
        difficulty: "medium",
        question: "Chi ha scritto 'Orgoglio e Pregiudizio'?",
        correct_answer: "Jane Austen",
        incorrect_answers: ["Emily Brontë", "Mary Shelley", "Virginia Woolf"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama la galassia in cui si trova il Sistema Solare?",
        imageSearch: "Via Lattea",
        correct_answer: "Via Lattea",
        incorrect_answers: ["Andromeda", "Triangolo", "Cane Maggiore"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi era il celebre conquistatore macedone?",
        correct_answer: "Alessandro Magno",
        incorrect_answers: ["Ciro il Grande", "Annibale", "Giulio Cesare"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la capitale dell’Australia?",
        correct_answer: "Canberra",
        incorrect_answers: ["Sydney", "Melbourne", "Perth"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha scolpito il David di marmo conservato a Firenze?",
        imageSearch: "David Michelangelo",
        correct_answer: "Michelangelo",
        incorrect_answers: ["Donatello", "Bernini", "Cellini"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Qual è la saga cinematografica con il personaggio 'Darth Vader'?",
        imageSearch: "Darth Vader",
        correct_answer: "Star Wars",
        incorrect_answers: ["Star Trek", "Dune", "Avatar"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il metallo liquido a temperatura ambiente?",
        correct_answer: "Mercurio",
        incorrect_answers: ["Aluminio", "Stagno", "Piombo"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Qual è il famoso anfiteatro situato nel centro di Roma?",
        imageSearch: "Colosseo",
        correct_answer: "Colosseo",
        incorrect_answers: ["Circo Massimo", "Pantheon", "Foro Romano"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi fu il leader dell'Unione Sovietica durante la Seconda Guerra Mondiale?",
        correct_answer: "Joseph Stalin",
        incorrect_answers: ["Lenin", "Khrushchev", "Trotsky"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Qual è il deserto più grande del mondo?",
        imageSearch: "Deserto del Sahara",
        correct_answer: "Sahara",
        incorrect_answers: ["Gobi", "Kalahari", "Atacama"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale mammifero depone le uova?",
        correct_answer: "Ornitorinco",
        incorrect_answers: ["Koala", "Pipistrello", "Panda"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha dipinto 'Guernica'?",
        imageSearch: "Guernica Picasso",
        correct_answer: "Pablo Picasso",
        incorrect_answers: ["Dalí", "Miró", "Goya"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi è stato il primo uomo a camminare sulla Luna?",
        imageSearch: "Neil Armstrong",
        correct_answer: "Neil Armstrong",
        incorrect_answers: ["Buzz Aldrin", "Yuri Gagarin", "Michael Collins"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la velocità della luce nel vuoto?",
        correct_answer: "300.000 km/s",
        incorrect_answers: ["150.000 km/s", "1.000.000 km/s", "30.000 km/s"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Quale oceano è il più grande?",
        correct_answer: "Pacifico",
        incorrect_answers: ["Atlantico", "Indiano", "Artico"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Qual è il nome del celebre maghetto protagonista di una famosa saga?",
        imageSearch: "Harry Potter",
        correct_answer: "Harry Potter",
        incorrect_answers: ["Frodo Baggins", "Percy Jackson", "Artemis Fowl"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trovano i Moai, le celebri statue monolitiche?",
        imageSearch: "Moai Isola di Pasqua",
        correct_answer: "Isola di Pasqua",
        incorrect_answers: ["Madagascar", "Hawaii", "Giappone"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi ha scoperto l’America?",
        correct_answer: "Cristoforo Colombo",
        incorrect_answers: ["Vespucci", "Magellano", "Cortés"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha scolpito la Pietà conservata in Vaticano?",
        imageSearch: "Pietà Michelangelo",
        correct_answer: "Michelangelo",
        incorrect_answers: ["Bernini", "Donatello", "Ghiberti"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi è noto come il 'padre della fisica moderna'?",
        correct_answer: "Albert Einstein",
        incorrect_answers: ["Galileo Galilei", "Stephen Hawking", "Richard Feynman"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il più grande mammifero del pianeta?",
        correct_answer: "Balena blu",
        incorrect_answers: ["Elefante africano", "Orca", "Capodoglio"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale è la montagna più alta dell'Africa?",
        imageSearch: "Kilimangiaro",
        correct_answer: "Kilimangiaro",
        incorrect_answers: ["Monte Kenya", "Rwenzori", "Meru"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Quale civiltà costruì la città di Machu Picchu?",
        correct_answer: "Inca",
        incorrect_answers: ["Maya", "Aztechi", "Olmechi"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha dipinto 'La Ragazza con l’orecchino di perla'?",
        imageSearch: "Ragazza con l'orecchino di perla",
        correct_answer: "Johannes Vermeer",
        incorrect_answers: ["Rembrandt", "Jan Steen", "Frans Hals"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Chi è il regista della trilogia 'Il Signore degli Anelli'?",
        imageSearch: "Peter Jackson",
        correct_answer: "Peter Jackson",
        incorrect_answers: ["James Cameron", "Christopher Nolan", "George Lucas"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la particella con carica negativa?",
        correct_answer: "Elettrone",
        incorrect_answers: ["Protone", "Neutrone", "Bosone"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi è stato il famoso condottiero cartaginese noto per l’attraversamento delle Alpi?",
        imageSearch: "Annibale Barca",
        correct_answer: "Annibale",
        incorrect_answers: ["Scipione l'Africano", "Amilcare", "Asdrubale"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale città si trova la Torre di Pisa?",
        imageSearch: "Torre di Pisa",
        correct_answer: "Pisa",
        incorrect_answers: ["Firenze", "Lucca", "Siena"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'animale più grande della Terra dopo la balena blu?",
        correct_answer: "Capodoglio",
        incorrect_answers: ["Squalo balena", "Elefante africano", "Orca"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la capitale della Norvegia?",
        correct_answer: "Oslo",
        incorrect_answers: ["Bergen", "Copenaghen", "Helsinki"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha realizzato il celebre dipinto 'Il Bacio'?",
        imageSearch: "Il Bacio Klimt",
        correct_answer: "Gustav Klimt",
        incorrect_answers: ["Schiele", "Munch", "Monet"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi fu il primo imperatore di Roma?",
        correct_answer: "Augusto",
        incorrect_answers: ["Nerone", "Tiberio", "Cesare"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Qual è il nome della più famosa nebulosa presente nella costellazione di Orione?",
        imageSearch: "Nebulosa di Orione",
        correct_answer: "Nebulosa di Orione",
        incorrect_answers: ["Nebulosa Aquila", "Nebulosa Velo", "Nebulosa Granchio"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Chi interpreta il personaggio di Joker nel film del 2019?",
        correct_answer: "Joaquin Phoenix",
        incorrect_answers: ["Heath Ledger", "Jared Leto", "Christian Bale"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova la Porta di Brandeburgo?",
        imageSearch: "Porta di Brandeburgo",
        correct_answer: "Berlino",
        incorrect_answers: ["Monaco", "Colonia", "Amburgo"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il mare che separa l’Europa dall’Africa?",
        correct_answer: "Mar Mediterraneo",
        incorrect_answers: ["Mar Nero", "Mar Rosso", "Mar Egeo"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Quale artista è noto per lo stile cubista?",
        imageSearch: "Pablo Picasso",
        correct_answer: "Pablo Picasso",
        incorrect_answers: ["Kandinsky", "Dalí", "Warhol"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi era il famoso scienziato italiano che perfezionò il telescopio?",
        imageSearch: "Galileo Galilei",
        correct_answer: "Galileo Galilei",
        incorrect_answers: ["Fermi", "Volta", "Marconi"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale di questi animali può rigenerare gli arti?",
        correct_answer: "Stella marina",
        incorrect_answers: ["Delfino", "Tartaruga", "Fenicottero"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la formula chimica dell'acqua?",
        correct_answer: "H₂O",
        incorrect_answers: ["CO₂", "O₂", "H₂SO₄"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi era il faraone della famosa tomba scoperta quasi intatta nel 1922?",
        imageSearch: "Tutankhamon",
        correct_answer: "Tutankhamon",
        incorrect_answers: ["Ramses II", "Akhenaton", "Seti I"]
    },

    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città è famosa per la sua Opera House?",
        imageSearch: "Sydney Opera House",
        correct_answer: "Sydney",
        incorrect_answers: ["Melbourne", "Auckland", "Brisbane"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Chi interpreta Neo nella saga di Matrix?",
        correct_answer: "Keanu Reeves",
        incorrect_answers: ["Tom Cruise", "Will Smith", "Matt Damon"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama la celebre scultura con una donna senza braccia conservata al Louvre?",
        imageSearch: "Venere di Milo",
        correct_answer: "Venere di Milo",
        incorrect_answers: ["Afrodite di Cnido", "Nike di Samotracia", "Leda e il cigno"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi era il compositore della celebre 'Quinta Sinfonia'?",
        correct_answer: "Beethoven",
        incorrect_answers: ["Mozart", "Schubert", "Vivaldi"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Qual è l'uccello simbolo della Nuova Zelanda?",
        imageSearch: "Kiwi uccello",
        correct_answer: "Kiwi",
        incorrect_answers: ["Emù", "Casuario", "Pinguino"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il lago più profondo del mondo?",
        correct_answer: "Lago Baikal",
        incorrect_answers: ["Lago Tanganica", "Lago Vostok", "Lago Superior"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il condottiero che attraversò il Rubicone?",
        imageSearch: "Giulio Cesare",
        correct_answer: "Giulio Cesare",
        incorrect_answers: ["Pompeo", "Bruto", "Marco Antonio"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Qual è il robot protagonista della saga 'Transformers'?",
        imageSearch: "Optimus Prime",
        correct_answer: "Optimus Prime",
        incorrect_answers: ["Megatron", "Bumblebee", "Sentinel Prime"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Chi è considerato il padre dell'arte rinascimentale?",
        correct_answer: "Giotto",
        incorrect_answers: ["Botticelli", "Leonardo da Vinci", "Masaccio"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trovano i templi di Abu Simbel?",
        imageSearch: "Abu Simbel",
        correct_answer: "Egitto",
        incorrect_answers: ["Sudan", "Libia", "Turchia"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale animale è noto per il suo lungo letargo?",
        correct_answer: "Orso",
        incorrect_answers: ["Canguro", "Ippopotamo", "Lupo"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città è famosa per il Cristo Redentore?",
        imageSearch: "Cristo Redentore Rio",
        correct_answer: "Rio de Janeiro",
        incorrect_answers: ["San Paolo", "Buenos Aires", "Lima"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l’unità di misura della frequenza?",
        correct_answer: "Hertz",
        incorrect_answers: ["Ohm", "Tesla", "Weber"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "In quale film compare il personaggio di Forrest Gump?",
        correct_answer: "Forrest Gump",
        incorrect_answers: ["Il Miglio Verde", "Rain Man", "Cast Away"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi era il leader dell'indipendenza indiana noto per la non violenza?",
        imageSearch: "Mahatma Gandhi",
        correct_answer: "Mahatma Gandhi",
        incorrect_answers: ["Nehru", "Ambedkar", "Patel"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Qual è il dipinto più famoso di Edvard Munch?",
        imageSearch: "L'Urlo Munch",
        correct_answer: "L'Urlo",
        incorrect_answers: ["Madonna", "Vampira", "La Danza della Vita"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la capitale della Thailandia?",
        correct_answer: "Bangkok",
        incorrect_answers: ["Phuket", "Hanoi", "Kuala Lumpur"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Qual è il grande rettile simbolo dell'Australia?",
        imageSearch: "Coccodrillo australiano",
        correct_answer: "Coccodrillo marino",
        incorrect_answers: ["Varano", "Iguana", "Serpente tigre"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova il celebre Monte Rushmore?",
        imageSearch: "Mount Rushmore",
        correct_answer: "Stati Uniti",
        incorrect_answers: ["Canada", "Messico", "Brasile"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Quale organo del corpo umano produce insulina?",
        correct_answer: "Pancreas",
        incorrect_answers: ["Fegato", "Milza", "Cuore"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "In quale film compare il dinosauro T-Rex più famoso?",
        imageSearch: "Jurassic Park T-Rex",
        correct_answer: "Jurassic Park",
        incorrect_answers: ["King Kong", "Godzilla", "Dinosaur"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Chi realizzò la Cappella degli Scrovegni?",
        correct_answer: "Giotto",
        incorrect_answers: ["Masaccio", "Michelangelo", "Piero della Francesca"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trova il monte Fuji?",
        imageSearch: "Monte Fuji",
        correct_answer: "Giappone",
        incorrect_answers: ["Cina", "Corea del Sud", "Mongolia"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi era il re macedone padre di Alessandro Magno?",
        correct_answer: "Filippo II",
        incorrect_answers: ["Tolomeo", "Cassandro", "Perdicca"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi era il famoso inventore della lampadina elettrica?",
        imageSearch: "Thomas Edison",
        correct_answer: "Thomas Edison",
        incorrect_answers: ["Tesla", "Marconi", "Bell"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'animale più longevo?",
        correct_answer: "Tartaruga delle Seychelles",
        incorrect_answers: ["Elefante", "Balena", "Corvo"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Qual è la capitale della Corea del Sud?",
        imageSearch: "Seul",
        correct_answer: "Seul",
        incorrect_answers: ["Tokyo", "Pechino", "Busan"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "In quale secolo avvenne la Rivoluzione Francese?",
        correct_answer: "XVIII secolo",
        incorrect_answers: ["XVI secolo", "XVII secolo", "XIX secolo"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi dipinse 'Il Giardino delle Delizie'?",
        imageSearch: "Giardino delle delizie Bosch",
        correct_answer: "Hieronymus Bosch",
        incorrect_answers: ["Bruegel", "Van Eyck", "Dürer"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Chi interpreta Iron Man nel Marvel Cinematic Universe?",
        correct_answer: "Robert Downey Jr.",
        incorrect_answers: ["Chris Evans", "Mark Ruffalo", "Chris Hemsworth"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l'elemento chimico con simbolo Au?",
        correct_answer: "Oro",
        incorrect_answers: ["Argento", "Osmio", "Uranio"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi era la regina inglese durante la seconda metà del XX secolo?",
        imageSearch: "Regina Elisabetta II",
        correct_answer: "Elisabetta II",
        incorrect_answers: ["Vittoria", "Maria I", "Anna"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trova il Cremlino di Mosca?",
        imageSearch: "Cremlino Mosca",
        correct_answer: "Russia",
        incorrect_answers: ["Ucraina", "Bielorussia", "Polonia"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale animale ha la forza di sollevare fino a 50 volte il suo peso?",
        correct_answer: "Formica",
        incorrect_answers: ["Armadillo", "Scoiattolo", "Talpa"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "In quale continente si trova il fiume Orinoco?",
        correct_answer: "Sud America",
        incorrect_answers: ["Africa", "Asia", "Europa"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Quale celebre scultura raffigura una figura femminile con ali?",
        imageSearch: "Nike di Samotracia",
        correct_answer: "Nike di Samotracia",
        incorrect_answers: ["Venere di Milo", "Irene di Atene", "Afrodite di Cnido"]
    },

    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il leader dell'Impero Mongolo?",
        imageSearch: "Gengis Khan",
        correct_answer: "Gengis Khan",
        incorrect_answers: ["Kublai Khan", "Timur Lenk", "Ögedei Khan"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Qual è il film d'animazione in cui compare il personaggio di Simba?",
        imageSearch: "Il Re Leone",
        correct_answer: "Il Re Leone",
        incorrect_answers: ["Bambi", "Madagascar", "La Bella e la Bestia"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Quale vitamina è principalmente sintetizzata grazie all'esposizione al sole?",
        correct_answer: "Vitamina D",
        incorrect_answers: ["Vitamina A", "Vitamina C", "Vitamina K"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città italiana è famosa per i suoi trulli?",
        imageSearch: "Alberobello",
        correct_answer: "Alberobello",
        incorrect_answers: ["Matera", "Lecce", "Ostuni"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi ha fondato la teoria dell'evoluzione tramite selezione naturale?",
        correct_answer: "Charles Darwin",
        incorrect_answers: ["Gregor Mendel", "Lamarck", "Richard Dawkins"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova la famosa scultura 'Manneken Pis'?",
        imageSearch: "Manneken Pis",
        correct_answer: "Bruxelles",
        incorrect_answers: ["Amsterdam", "Lussemburgo", "Parigi"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi fu l'ultimo zar di Russia?",
        correct_answer: "Nicola II",
        incorrect_answers: ["Alessandro III", "Pietro I", "Ivan IV"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Quale film ha vinto l'Oscar come miglior film nel 1998?",
        correct_answer: "Titanic",
        incorrect_answers: ["Braveheart", "Forrest Gump", "Shakespeare in Love"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale grande animale vive nelle praterie nordamericane?",
        imageSearch: "Bisonte americano",
        correct_answer: "Bisonte",
        incorrect_answers: ["Yak", "Bufalo africano", "Gaur"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il nome della teoria che descrive l'origine dell'universo?",
        correct_answer: "Big Bang",
        incorrect_answers: ["Inflazione cosmica", "Teoria delle stringhe", "Singolarità"]
    },

    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trova il Palazzo di Versailles?",
        imageSearch: "Palazzo di Versailles",
        correct_answer: "Francia",
        incorrect_answers: ["Italia", "Spagna", "Germania"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il mare che bagna la città di Venezia?",
        correct_answer: "Mar Adriatico",
        incorrect_answers: ["Mar Ionio", "Mar Tirreno", "Mar Ligure"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il celebre inventore del telefono?",
        imageSearch: "Alexander Graham Bell",
        correct_answer: "Alexander Graham Bell",
        incorrect_answers: ["Edison", "Tesla", "Marconi"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Chi realizzò 'Le Ninfee'?",
        correct_answer: "Claude Monet",
        incorrect_answers: ["Renoir", "Manet", "Cézanne"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il grande conquistatore macedone che fondò un vasto impero?",
        imageSearch: "Alessandro Magno",
        correct_answer: "Alessandro Magno",
        incorrect_answers: ["Perdicca", "Tolomeo", "Antigono"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Quale film introduce il personaggio di Jack Sparrow?",
        imageSearch: "La Maledizione della Prima Luna",
        correct_answer: "Pirati dei Caraibi: La Maledizione della Prima Luna",
        incorrect_answers: ["Dead Man's Chest", "At World's End", "On Stranger Tides"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale mammifero marino è noto per i suoi salti fuori dall'acqua?",
        correct_answer: "Delfino",
        incorrect_answers: ["Tricheco", "Lamantino", "Foca"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama la galassia più vicina alla Via Lattea?",
        imageSearch: "Galassia di Andromeda",
        correct_answer: "Andromeda",
        incorrect_answers: ["Triangolo", "Cane Maggiore", "Sagittario"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi era il famoso poeta autore della Divina Commedia?",
        correct_answer: "Dante Alighieri",
        incorrect_answers: ["Petrarca", "Boccaccio", "Tasso"]
    },

    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città è famosa per la Piazza Rossa?",
        imageSearch: "Piazza Rossa Mosca",
        correct_answer: "Mosca",
        incorrect_answers: ["Kiev", "San Pietroburgo", "Varsavia"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Quale pittore è noto per le sue opere del periodo blu?",
        imageSearch: "Picasso periodo blu",
        correct_answer: "Pablo Picasso",
        incorrect_answers: ["Miró", "Chagall", "Gauguin"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Quale popolo costruì Stonehenge?",
        correct_answer: "Popoli preistorici britanni",
        incorrect_answers: ["Romani", "Sassoni", "Vichinghi"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "In quale film compare il personaggio di Marty McFly?",
        correct_answer: "Ritorno al Futuro",
        incorrect_answers: ["Ghostbusters", "Top Gun", "Gremlins"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il tessuto più grande del corpo umano?",
        correct_answer: "La pelle",
        incorrect_answers: ["Il fegato", "Il cuore", "Il cervello"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova la Porta di Ishtar, ricostruita al Pergamon Museum?",
        imageSearch: "Porta di Ishtar",
        correct_answer: "Berlino",
        incorrect_answers: ["Londra", "Parigi", "Baghdad"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi è stato il celebre pittore olandese autore dell’Autoritratto con orecchio bendato?",
        imageSearch: "Van Gogh autoritratto orecchio",
        correct_answer: "Vincent van Gogh",
        incorrect_answers: ["Rembrandt", "Vermeer", "Rubens"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale grande felino è noto per la sua criniera?",
        imageSearch: "Leone africano",
        correct_answer: "Leone",
        incorrect_answers: ["Tigre", "Ghepardo", "Leopardo"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Quale particella subatomica ha carica positiva?",
        correct_answer: "Protone",
        incorrect_answers: ["Elettrone", "Neutrone", "Positrone"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il fiume più lungo dell’Africa?",
        correct_answer: "Nilo",
        incorrect_answers: ["Niger", "Congo", "Zambesi"]
    },

    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha dipinto la 'Nascita di Venere'?",
        imageSearch: "Nascita di Venere Botticelli",
        correct_answer: "Sandro Botticelli",
        incorrect_answers: ["Michelangelo", "Caravaggio", "Raffaello"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Quale attore interpreta il personaggio di John Wick?",
        imageSearch: "John Wick Keanu Reeves",
        correct_answer: "Keanu Reeves",
        incorrect_answers: ["Tom Hardy", "Brad Pitt", "Ben Affleck"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Quale nave affondò nel 1912 durante il suo primo viaggio?",
        correct_answer: "Titanic",
        incorrect_answers: ["Britannic", "Lusitania", "Olympic"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi fu il celebre matematico autore dei Principia Mathematica?",
        correct_answer: "Isaac Newton",
        incorrect_answers: ["Descartes", "Euler", "Gauss"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale animale ha la vista più sviluppata nel mondo degli insetti?",
        correct_answer: "Libellula",
        incorrect_answers: ["Ape", "Scarabeo", "Grillo"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il lago più profondo del mondo?",
        correct_answer: "Lago Bajkal",
        incorrect_answers: ["Lago Tanganica", "Mar Caspio", "Lago Vittoria"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "In quale film appare il personaggio Forrest Gump?",
        imageSearch: "Forrest Gump",
        correct_answer: "Forrest Gump",
        incorrect_answers: ["Cast Away", "Rain Man", "Philadelphia"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Chi dipinse 'La Libertà che guida il popolo'?",
        correct_answer: "Eugène Delacroix",
        incorrect_answers: ["David", "Ingres", "Géricault"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il fondatore dell'Impero Persiano?",
        imageSearch: "Ciro il Grande",
        correct_answer: "Ciro il Grande",
        incorrect_answers: ["Dario I", "Serse I", "Artaserse"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Quale pianeta del Sistema Solare ha il giorno più lungo?",
        correct_answer: "Venere",
        incorrect_answers: ["Mercurio", "Marte", "Giove"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova il Monte Rushmore?",
        imageSearch: "Mount Rushmore",
        correct_answer: "Stati Uniti",
        incorrect_answers: ["Canada", "Messico", "Brasile"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi è l’autore della teoria della relatività?",
        correct_answer: "Albert Einstein",
        incorrect_answers: ["Planck", "Bohr", "Heisenberg"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale animale è conosciuto come l’unico marsupiale europeo?",
        imageSearch: "Opossum europeo",
        correct_answer: "Opossum",
        incorrect_answers: ["Tasso", "Scoiattolo", "Puzzola"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trova il deserto del Namib?",
        imageSearch: "Deserto del Namib",
        correct_answer: "Namibia",
        incorrect_answers: ["Sudafrica", "Botswana", "Zimbabwe"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Chi ha diretto il film 'Inception'?",
        correct_answer: "Christopher Nolan",
        incorrect_answers: ["James Cameron", "Ridley Scott", "Steven Spielberg"]
    },

    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Quale artista è famoso per l’opera 'La Grande Onda di Kanagawa'?",
        imageSearch: "Grande Onda di Kanagawa",
        correct_answer: "Hokusai",
        incorrect_answers: ["Hiroshige", "Utamaro", "Sesshū"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "In quale anno cadde il Muro di Berlino?",
        correct_answer: "1989",
        incorrect_answers: ["1987", "1991", "1993"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Quale organo del corpo umano filtra il sangue per produrre urina?",
        imageSearch: "Reni anatomia",
        correct_answer: "Reni",
        incorrect_answers: ["Fegato", "Stomaco", "Milza"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi era il rivoluzionario argentino noto come 'Che'?",
        imageSearch: "Che Guevara",
        correct_answer: "Ernesto Guevara",
        incorrect_answers: ["Fidel Castro", "Hugo Chávez", "Simón Bolívar"]
    },
    {
        category: "Monumenti",
        type: "multiple",
        difficulty: "medium",
        question: "La basilica di Santa Sofia si trova in quale città?",
        correct_answer: "Istanbul",
        incorrect_answers: ["Atene", "Smirne", "Ankara"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale uccello è noto per essere il più veloce in picchiata?",
        correct_answer: "Falco pellegrino",
        incorrect_answers: ["Aquila reale", "Sparviero", "Condor"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "A quale stato appartengono le Hawaii?",
        correct_answer: "Stati Uniti",
        incorrect_answers: ["Messico", "Figi", "Canada"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Qual è il robot protagonista del film animato 'WALL·E'?",
        imageSearch: "WALL-E",
        correct_answer: "WALL·E",
        incorrect_answers: ["EVA", "R2-D2", "BAYMAX"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Chi scolpì il 'David' di Donatello?",
        correct_answer: "Donatello",
        incorrect_answers: ["Michelangelo", "Bernini", "Verrocchio"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il celebre faraone bambino dell'antico Egitto?",
        imageSearch: "Tutankhamon",
        correct_answer: "Tutankhamon",
        incorrect_answers: ["Ramses II", "Akhenaton", "Seti I"]
    },

    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città è famosa per il Cristo Redentore?",
        imageSearch: "Cristo Redentore Rio",
        correct_answer: "Rio de Janeiro",
        incorrect_answers: ["Brasilia", "San Paolo", "Salvador"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Quale gas costituisce la maggior parte dell’atmosfera terrestre?",
        correct_answer: "Azoto",
        incorrect_answers: ["Ossigeno", "Anidride carbonica", "Argon"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Quale attore interpreta Neo in Matrix?",
        correct_answer: "Keanu Reeves",
        incorrect_answers: ["Laurence Fishburne", "Tom Cruise", "Christian Bale"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova il famoso affresco 'Il Bacio di Giuda' di Giotto?",
        imageSearch: "Cappella degli Scrovegni Giotto",
        correct_answer: "Cappella degli Scrovegni",
        incorrect_answers: ["Santa Croce", "San Marco", "Santa Maria Novella"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi fu il primo presidente degli Stati Uniti?",
        correct_answer: "George Washington",
        incorrect_answers: ["John Adams", "Thomas Jefferson", "James Madison"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi è l'autore di '1984'?",
        imageSearch: "George Orwell",
        correct_answer: "George Orwell",
        incorrect_answers: ["Aldous Huxley", "Ray Bradbury", "Philip K. Dick"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trova la Torre di Hercules?",
        imageSearch: "Torre di Hercules",
        correct_answer: "Spagna",
        incorrect_answers: ["Portogallo", "Italia", "Francia"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale animale è noto per la sua capacità di mimetismo estremo?",
        correct_answer: "Camaleonte",
        incorrect_answers: ["Istrice", "Alpaca", "Capibara"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Quale strumento misura la pressione atmosferica?",
        imageSearch: "Barometro",
        correct_answer: "Barometro",
        incorrect_answers: ["Termometro", "Igrometro", "Anemometro"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la capitale della Norvegia?",
        correct_answer: "Oslo",
        incorrect_answers: ["Stoccolma", "Copenaghen", "Helsinki"]
    },

    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "In quale film compare il personaggio di Gollum?",
        imageSearch: "Gollum Il Signore degli Anelli",
        correct_answer: "Il Signore degli Anelli",
        incorrect_answers: ["Harry Potter", "Lo Hobbit", "Narnia"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Quale artista realizzò l'opera 'Guernica'?",
        correct_answer: "Pablo Picasso",
        incorrect_answers: ["Dalí", "Miró", "Rothko"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi guidò la spedizione che circumnavigò per primo il globo?",
        correct_answer: "Ferdinando Magellano",
        incorrect_answers: ["Vasco da Gama", "Cristoforo Colombo", "Amerigo Vespucci"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi era la scrittrice di 'Orgoglio e Pregiudizio'?",
        correct_answer: "Jane Austen",
        incorrect_answers: ["Charlotte Brontë", "Emily Brontë", "Mary Shelley"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Quale famoso palazzo si trova a Granada?",
        imageSearch: "Alhambra",
        correct_answer: "Alhambra",
        incorrect_answers: ["Escorial", "Mezquita", "Sagrada Familia"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale animale marino ha otto braccia?",
        imageSearch: "Polpo",
        correct_answer: "Polpo",
        incorrect_answers: ["Stella marina", "Medusa", "Razza"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la molecola responsabile della fotosintesi nelle piante?",
        correct_answer: "Clorofilla",
        incorrect_answers: ["Emoglobina", "Cheratina", "Melanina"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città è famosa per il Palazzo Imperiale?",
        imageSearch: "Palazzo Imperiale Tokyo",
        correct_answer: "Tokyo",
        incorrect_answers: ["Kyoto", "Osaka", "Yokohama"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Quale film Disney presenta il personaggio di Aladdin?",
        correct_answer: "Aladdin",
        incorrect_answers: ["Hercules", "Tarzan", "Il Gobbo di Notre-Dame"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi ha scolpito la 'Pietà' custodita nella Basilica di San Pietro?",
        imageSearch: "Pietà Michelangelo",
        correct_answer: "Michelangelo",
        incorrect_answers: ["Bernini", "Canova", "Donatello"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Qual è la capitale dell’Islanda?",
        imageSearch: "Reykjavík",
        correct_answer: "Reykjavík",
        incorrect_answers: ["Oslo", "Copenaghen", "Stoccolma"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "In quale secolo avvenne la Rivoluzione Francese?",
        correct_answer: "XVIII secolo",
        incorrect_answers: ["XVI secolo", "XVII secolo", "XIX secolo"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi dipinse il quadro 'La Primavera'?",
        imageSearch: "La Primavera Botticelli",
        correct_answer: "Sandro Botticelli",
        incorrect_answers: ["Raffaello", "Tiziano", "Caravaggio"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Quale film vinse l’Oscar come Miglior Film nel 1994?",
        correct_answer: "Forrest Gump",
        incorrect_answers: ["Pulp Fiction", "The Shawshank Redemption", "Braveheart"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale animale è noto per la sua proboscide?",
        imageSearch: "Elefante africano",
        correct_answer: "Elefante",
        incorrect_answers: ["Rinoceronte", "Ippopotamo", "Bufalo africano"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale città si trova la Torre Pendente?",
        imageSearch: "Torre di Pisa",
        correct_answer: "Pisa",
        incorrect_answers: ["Firenze", "Roma", "Venezia"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi fu il primo uomo a camminare sulla Luna?",
        correct_answer: "Neil Armstrong",
        incorrect_answers: ["Buzz Aldrin", "Yuri Gagarin", "Michael Collins"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l’unità di misura dell’energia?",
        correct_answer: "Joule",
        incorrect_answers: ["Watt", "Newton", "Pascal"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è il fiume più lungo d’Europa?",
        correct_answer: "Volga",
        incorrect_answers: ["Danubio", "Reno", "Loira"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu l'ultimo zar di Russia?",
        imageSearch: "Nicholas II of Russia",
        correct_answer: "Nicola II",
        incorrect_answers: ["Alessandro II", "Pietro il Grande", "Ivan IV"]
    },

    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Chi è il protagonista del film 'Gladiator'?",
        imageSearch: "Gladiator Maximus",
        correct_answer: "Massimo Decimo Meridio",
        incorrect_answers: ["Spartaco", "Achille", "Leonida"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Quale pittore è noto per lo stile cubista?",
        correct_answer: "Pablo Picasso",
        incorrect_answers: ["Matisse", "Kandinsky", "Miró"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "In quale paese si trovano le Moai dell’Isola di Pasqua?",
        imageSearch: "Moai Easter Island",
        correct_answer: "Cile",
        incorrect_answers: ["Perù", "Argentina", "Ecuador"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale animale è il più grande mammifero della Terra?",
        correct_answer: "Balena Blu",
        incorrect_answers: ["Elefante africano", "Orca", "Capodoglio"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Quale cellula del sangue trasporta ossigeno?",
        imageSearch: "Globuli rossi",
        correct_answer: "Globuli rossi",
        incorrect_answers: ["Globuli bianchi", "Piastrine", "Linfonodi"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città è famosa per la Porta di Brandeburgo?",
        imageSearch: "Porta di Brandeburgo",
        correct_answer: "Berlino",
        incorrect_answers: ["Monaco", "Amburgo", "Francoforte"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi dipinse il soffitto della Cappella Sistina?",
        correct_answer: "Michelangelo",
        incorrect_answers: ["Raffaello", "Leonardo da Vinci", "Donatello"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "Chi è il regista di 'Titanic'?",
        correct_answer: "James Cameron",
        incorrect_answers: ["Steven Spielberg", "Ridley Scott", "Ron Howard"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Quale città fu distrutta dall’eruzione del Vesuvio nel 79 d.C.?",
        correct_answer: "Pompei",
        incorrect_answers: ["Ercolano", "Stabia", "Pozzuoli"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la montagna più alta del Giappone?",
        correct_answer: "Monte Fuji",
        incorrect_answers: ["Monte Tate", "Monte Kita", "Monte Yari"]
    },

    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Quale monumento è noto come simbolo della Francia?",
        imageSearch: "Torre Eiffel",
        correct_answer: "Torre Eiffel",
        incorrect_answers: ["Arco di Trionfo", "Notre-Dame", "Louvre"]
    },
    {
        category: "Arte",
        type: "image",
        difficulty: "medium",
        question: "Chi dipinse 'Le Ninfee'?",
        imageSearch: "Claude Monet Water Lilies",
        correct_answer: "Claude Monet",
        incorrect_answers: ["Manet", "Degas", "Renoir"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Quale parte dell’occhio controlla la quantità di luce?",
        correct_answer: "Iride",
        incorrect_answers: ["Retina", "Cristallino", "Cornea"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi è stato il celebre fisico noto per la legge di gravitazione universale?",
        imageSearch: "Isaac Newton",
        correct_answer: "Isaac Newton",
        incorrect_answers: ["Einstein", "Galileo", "Keplero"]
    },
    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "In quale film appare il personaggio Jack Sparrow?",
        correct_answer: "Pirati dei Caraibi",
        incorrect_answers: ["Hook", "La Bussola d’Oro", "I Goonies"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è l’oceano più grande del mondo?",
        correct_answer: "Oceano Pacifico",
        incorrect_answers: ["Oceano Atlantico", "Oceano Indiano", "Oceano Artico"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Chi fu il leader dell’Impero Mongolo?",
        imageSearch: "Genghis Khan",
        correct_answer: "Gengis Khan",
        incorrect_answers: ["Tamerlano", "Kublai Khan", "Attila"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova il Big Ben?",
        imageSearch: "Big Ben London",
        correct_answer: "Londra",
        incorrect_answers: ["Manchester", "Edimburgo", "Bristol"]
    },
    {
        category: "Animali",
        type: "multiple",
        difficulty: "medium",
        question: "Quale animale è noto per la sua grande velocità?",
        correct_answer: "Ghepardo",
        incorrect_answers: ["Leopardo", "Tigre", "Antilope"]
    },
    {
        category: "Scienze",
        type: "image",
        difficulty: "medium",
        question: "Quale organo pompa il sangue in tutto il corpo?",
        imageSearch: "Cuore anatomia",
        correct_answer: "Cuore",
        incorrect_answers: ["Fegato", "Reni", "Polmoni"]
    },

    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Quale artista è legato al movimento del surrealismo?",
        correct_answer: "Salvador Dalí",
        incorrect_answers: ["Goya", "Van Gogh", "Klimt"]
    },
    {
        category: "Geografia",
        type: "image",
        difficulty: "medium",
        question: "Quale città ospita la famosa opera 'Sagrada Familia'?",
        imageSearch: "Sagrada Familia",
        correct_answer: "Barcellona",
        incorrect_answers: ["Madrid", "Valencia", "Siviglia"]
    },
    {
        category: "Storia",
        type: "multiple",
        difficulty: "medium",
        question: "Chi scoprì l’America?",
        correct_answer: "Cristoforo Colombo",
        incorrect_answers: ["Amerigo Vespucci", "Vasco da Gama", "Magellano"]
    },
    {
        category: "Cinema",
        type: "image",
        difficulty: "medium",
        question: "Qual è il robot protagonista del film 'RoboCop'?",
        imageSearch: "RoboCop",
        correct_answer: "RoboCop",
        incorrect_answers: ["T-800", "R2-D2", "HAL 9000"]
    },
    {
        category: "Monumenti",
        type: "multiple",
        difficulty: "medium",
        question: "La Porta di Ishtar apparteneva a quale città antica?",
        correct_answer: "Babilonia",
        incorrect_answers: ["Ninive", "Ur", "Uruk"]
    },
    {
        category: "Personaggi Famosi",
        type: "image",
        difficulty: "medium",
        question: "Chi è stata la famosa scienziata che studiò la radioattività?",
        imageSearch: "Marie Curie",
        correct_answer: "Marie Curie",
        incorrect_answers: ["Ada Lovelace", "Rosalind Franklin", "Lise Meitner"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale animale è noto per il suo nero e bianco manto?",
        imageSearch: "Panda gigante",
        correct_answer: "Panda gigante",
        incorrect_answers: ["Koala", "Orso bruno", "Pinguino"]
    },
    {
        category: "Scienze",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la formula chimica dell’acqua?",
        correct_answer: "H₂O",
        incorrect_answers: ["CO₂", "O₂", "H₂"]
    },
    {
        category: "Geografia",
        type: "multiple",
        difficulty: "medium",
        question: "Qual è la nazione più popolosa del mondo?",
        correct_answer: "India",
        incorrect_answers: ["Cina", "USA", "Indonesia"]
    },
    {
        category: "Storia",
        type: "image",
        difficulty: "medium",
        question: "Quale faraone fece costruire la Grande Piramide di Giza?",
        imageSearch: "Cheope",
        correct_answer: "Cheope",
        incorrect_answers: ["Chefren", "Micerino", "Ramses II"]
    },

    {
        category: "Cinema",
        type: "multiple",
        difficulty: "medium",
        question: "In quale film appare il personaggio di Hannibal Lecter?",
        correct_answer: "Il Silenzio degli Innocenti",
        incorrect_answers: ["Seven", "Shutter Island", "Psycho"]
    },
    {
        category: "Monumenti",
        type: "image",
        difficulty: "medium",
        question: "Dove si trova la Statua della Libertà?",
        imageSearch: "Statue of Liberty",
        correct_answer: "New York",
        incorrect_answers: ["Washington", "Boston", "Philadelphia"]
    },
    {
        category: "Arte",
        type: "multiple",
        difficulty: "medium",
        question: "Chi scolpì il 'Discobolo'?",
        correct_answer: "Mirone",
        incorrect_answers: ["Fidia", "Policleto", "Prassitele"]
    },
    {
        category: "Personaggi Famosi",
        type: "multiple",
        difficulty: "medium",
        question: "Chi scrisse 'Il nome della rosa'?",
        correct_answer: "Umberto Eco",
        incorrect_answers: ["Italo Calvino", "Primo Levi", "Pier Paolo Pasolini"]
    }
]

module.exports = ITALIAN_QUESTIONS;