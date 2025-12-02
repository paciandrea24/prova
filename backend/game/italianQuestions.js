// game/italianQuestions.js

const ITALIAN_QUESTIONS = [
    // --- GEOGRAFIA ---
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73.5_cm%2C_National_Gallery_of_Norway.jpg/640px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73.5_cm%2C_National_Gallery_of_Norway.jpg",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/The_Thinker_MET_117242.jpg/640px-The_Thinker_MET_117242.jpg",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Saint_Basil%27s_Cathedral_on_Red_Square_in_Moscow.jpg/640px-Saint_Basil%27s_Cathedral_on_Red_Square_in_Moscow.jpg",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Christ_the_Redeemer_-_Rio_de_Janeiro%2C_Brazil.jpg/640px-Christ_the_Redeemer_-_Rio_de_Janeiro%2C_Brazil.jpg",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Marilyn_Monroe_in_The_Prince_and_the_Showgirl_trailer.jpg/640px-Marilyn_Monroe_in_The_Prince_and_the_Showgirl_trailer.jpg",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Jimi_Hendrix_1967.png/640px-Jimi_Hendrix_1967.png",
        correct_answer: "Jimi Hendrix",
        incorrect_answers: ["Bob Marley", "Lenny Kravitz", "Prince"]
    },

    // --- ANIMALI ---
    {
        category: "Animali",
        type: "image",
        difficulty: "hard",
        question: "Che animale è questo?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Red_Panda_%2825193861686%29.jpg/800px-Red_Panda_%2825193861686%29.jpg",
        correct_answer: "Panda Minore",
        incorrect_answers: ["Volpe", "Procione", "Lemure"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama questo animale australiano?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Platypus.jpg/800px-Platypus.jpg",
        correct_answer: "Ornitorinco",
        incorrect_answers: ["Castoro", "Talpa", "Echidna"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "medium",
        question: "Quale animale è raffigurato?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Capybara_Costa_Rica.jpg/800px-Capybara_Costa_Rica.jpg",
        correct_answer: "Capibara",
        incorrect_answers: ["Nutria", "Cavia", "Vombato"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "easy",
        question: "Che tipo di rettile è questo?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Chamaeleo_calyptratus_Male_02.jpg/640px-Chamaeleo_calyptratus_Male_02.jpg",
        correct_answer: "Camaleonte",
        incorrect_answers: ["Iguana", "Geco", "Drago di Komodo"]
    },
    {
        category: "Animali",
        type: "image",
        difficulty: "hard",
        question: "Come si chiama questo anfibio messicano?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Axolotl_2.jpg/800px-Axolotl_2.jpg",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Microscope-medical.jpg/640px-Microscope-medical.jpg",
        correct_answer: "Microscopio",
        incorrect_answers: ["Telescopio", "Stetoscopio", "Periscopio"]
    },
    {
        category: "Scienza",
        type: "image",
        difficulty: "medium",
        question: "Cosa rappresenta questa struttura a doppia elica?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/DNA_orbit_animated.gif/400px-DNA_orbit_animated.gif",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Macarons_-_flavors.jpg/800px-Macarons_-_flavors.jpg",
        correct_answer: "Macarons",
        incorrect_answers: ["Meringhe", "Bignè", "Eclair"]
    },
    {
        category: "Cibo",
        type: "image",
        difficulty: "medium",
        question: "Qual è questo famoso piatto spagnolo?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Paella_de_marisco_01.jpg/800px-Paella_de_marisco_01.jpg",
        correct_answer: "Paella",
        incorrect_answers: ["Tapas", "Tortilla", "Gazpacho"]
    },

    // --- CULTURA POP ---
    {
        category: "TV",
        type: "image",
        difficulty: "easy",
        question: "Di quale famiglia animata è questa casa?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/742_Evergreen_Terrace.png/640px-742_Evergreen_Terrace.png",
        correct_answer: "I Simpson",
        incorrect_answers: ["I Griffin", "I Flintstones", "American Dad"]
    },
    {
        category: "Giochi",
        type: "image",
        difficulty: "medium",
        question: "Come si chiama questo oggetto?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Rubik%27s_cube.svg/640px-Rubik%27s_cube.svg.png",
        correct_answer: "Cubo di Rubik",
        incorrect_answers: ["Piramide di Meffert", "Megaminx", "Cubo Magico"]
    },
    {
        category: "Giochi",
        type: "image",
        difficulty: "easy",
        question: "Che pezzo degli scacchi è questo?",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Chess_klt45.svg/480px-Chess_klt45.svg.png",
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
        imageUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2b/Rich_Uncle_Pennybags.svg/300px-Rich_Uncle_Pennybags.svg.png",
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
];

module.exports = ITALIAN_QUESTIONS;