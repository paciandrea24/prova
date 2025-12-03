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
        imageUrl: "https://commons.wikimedia.org/wiki/Category:Microscopes#/media/File:Fine_rotative_table_Microscope_5_(12996283235).jpg",
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
    }

];

module.exports = ITALIAN_QUESTIONS;


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