document.addEventListener('DOMContentLoaded', () => {
    const avatarBox = document.querySelector('.avatar-box');
    const selectedAvatarColor = document.querySelector('.avatar-color');
    const form = document.querySelector('#colorForm');
    const hiddenInputForColorSelection = document.querySelector('#hiddenInputForColorSelection');
    const submitButton = document.querySelector('.submit-button');

    // Inizializza con cerchio vuoto e nessun colore selezionato
    selectedAvatarColor.style.backgroundColor = 'transparent';
    selectedAvatarColor.style.border = '2px dashed #ccc';
    hiddenInputForColorSelection.value = '';

    // Modifica il testo del pulsante e disabilitalo
    submitButton.textContent = 'Choose a color first';
    submitButton.disabled = true;
    submitButton.style.opacity = '0.6';
    submitButton.style.cursor = 'not-allowed';

    // Controlla se stiamo entrando in una lobby esistente
    const urlParams = new URLSearchParams(window.location.search);
    const joinLobbyId = urlParams.get('join');
    if (joinLobbyId) {
        // Se abbiamo un ID di lobby da unirsi, mostriamo un messaggio
        const firstBox = document.querySelector('.first-box');
        const joinMessage = document.createElement('p');
        joinMessage.textContent = `Joining lobby: ${joinLobbyId}`;
        joinMessage.style.color = '#333';
        joinMessage.style.marginBottom = '10px';
        firstBox.insertBefore(joinMessage, firstBox.firstChild);

        // Modifica il testo del pulsante (ma rimane disabilitato finché non si sceglie un colore)
        submitButton.textContent = 'Choose a color to join';
    }

    const availableColors = ['#DC143C', '#4169E1', '#50C878', '#FFD700', '#9966CC', '#36454F'];

    selectedAvatarColor.addEventListener("click", e => {
        e.preventDefault();
        // Rimuovi il box di selezione colore se esiste già
        const existingBox = document.querySelector('.change-color-box');
        if (existingBox) {
            existingBox.remove();
            return;
        }

        const changeColorBox = showChangeColorBox();
        showColorOptions(changeColorBox);
    });

    // CREA SOLO IL BOX
    function showChangeColorBox() {
        const changeColorBox = document.createElement('div');
        changeColorBox.setAttribute('class', 'change-color-box');
        avatarBox.appendChild(changeColorBox);
        return changeColorBox;
    }

    // MOSTRA I COLORI DISPONIBILI NELLA LISTA availableColors
    function showColorOptions(changeColorBox) {
        const colorList = document.createElement('ul');
        colorList.setAttribute('class', 'color-list');
        changeColorBox.appendChild(colorList);

        availableColors.forEach((color) => {
            const availableCircle = document.createElement('div');
            availableCircle.setAttribute('class', 'avatar-circle');
            availableCircle.style.width = '80px';
            availableCircle.style.height = '80px';
            colorList.appendChild(availableCircle);

            const availableColor = document.createElement('div');
            availableColor.setAttribute('class', 'avatar-color');
            availableColor.style.backgroundColor = color;
            availableColor.style.width = '50px';
            availableColor.style.height = '50px';
            availableCircle.appendChild(availableColor);

            // riempie i colori disponibili all'hover
            availableColor.addEventListener('mouseenter', e => {
                const currentColor = e.target.style.backgroundColor;
                e.target.style.borderColor = currentColor;
            });

            // seleziona il colore cliccato
            availableColor.addEventListener('click', e => {
                e.preventDefault();

                selectedAvatarColor.style.backgroundColor = e.target.style.backgroundColor;
                selectedAvatarColor.style.border = 'none'; // Rimuovi il bordo tratteggiato
                hiddenInputForColorSelection.value = e.target.style.backgroundColor;
                console.log('Ho selezionato il colore: ' + hiddenInputForColorSelection.value);
                changeColorBox.remove();

                // Abilita il pulsante submit
                if (joinLobbyId) {
                    submitButton.textContent = 'Join lobby';
                } else {
                    submitButton.textContent = 'Create lobby';
                }
                submitButton.disabled = false;
                submitButton.style.opacity = '1';
                submitButton.style.cursor = 'pointer';

                // aggiorna il colore dell'hover del colore selezionato
                selectedAvatarColor.addEventListener('mouseenter', e => {
                    const currentColor = e.target.style.backgroundColor;
                    e.target.style.borderColor = currentColor;
                });
            });
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const color = hiddenInputForColorSelection.value;
        if (!color) {
            alert('Please select a color first!');
            return;
        }

        const joinLobbyId = urlParams.get('join');

        if (joinLobbyId) {
            // Se stiamo entrando in una lobby esistente
            try {
                const response = await fetch('/join-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color, lobbyId: joinLobbyId })
                });

                if (response.ok) {
                    const data = await response.json();
                    window.location.href = `/lobby.html?lobby=${joinLobbyId}&color=${encodeURIComponent(color)}`;
                } else {
                    throw new Error('Server error');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to join lobby');
            }
        } else {
            // Se stiamo creando una nuova lobby
            try {
                const response = await fetch('/create-lobby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: color })
                });

                if (response.ok) {
                    const data = await response.json();
                    window.location.href = data.redirect;
                } else {
                    throw new Error('Server error');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to create lobby');
            }
        }
    });
});
/* 


const backgroundIconsContainer = document.querySelector('.background-icons');

// Lista immagini da usare
const icons = [
    './imgs/lampadina.svg',
    './imgs/libro.svg',
    './imgs/ombrello.svg',
    './imgs/sole.svg',
    './imgs/tavolozza.svg',
    './imgs/matita.svg',
    './imgs/albero.svg',
    './imgs/palla.svg'

];

const colors = ['#DC143C', '#4169E1', '#50C878', '#FFD700', '#9966CC', '#FF7F50', '#00CED1'];

let cycle = 0;
const CYCLE_DURATION = 8000; // 8 secondi visibili
const FADE_DURATION = 1000;  // 1 secondo per dissolvenza

function loadCycle() {
    const usedAreas = [];

    // 1. Fai svanire gli SVG attuali
    const existingSvgs = document.querySelectorAll('.background-icons svg');
    existingSvgs.forEach(svg => {
        svg.classList.add('fade-out');
    });

    // 2. Dopo 1 secondo (quando sono spariti), carica i nuovi
    setTimeout(() => {
        backgroundIconsContainer.innerHTML = '';

        icons.forEach((src, i) => {
            fetch(src)
                .then(res => res.text())
                .then(svgText => {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = svgText;
                    const svg = wrapper.querySelector('svg');
                    svg.classList.add('draw-icon');

                    svg.style.setProperty('--delay', `${i * 0.3}s`);
                    svg.style.color = colors[(i + cycle) % colors.length];

                    const maxAttempts = 20;
                    let attempts = 0;
                    let placed = false;

                    while (!placed && attempts < maxAttempts) {
                        const side = Math.random() < 0.5 ? 'left' : 'right';
                        const left = side === 'left'
                            ? Math.random() * 40
                            : Math.random() * 40 + 60;

                        const top = Math.random() * 80 + 10;
                        const width = 10;
                        const height = 10;

                        const area = {
                            top,
                            left,
                            bottom: top + height,
                            right: left + width
                        };

                        const overlaps = usedAreas.some(a =>
                            !(a.right < area.left ||
                                a.left > area.right ||
                                a.bottom < area.top ||
                                a.top > area.bottom)
                        );

                        if (!overlaps) {
                            usedAreas.push(area);
                            svg.style.top = `${top}%`;
                            svg.style.left = `${left}%`;

                            const strokeWidth = Math.floor(Math.random() * 3) + 3;
                            svg.querySelectorAll('path, circle, line, polyline, rect').forEach(el => {
                                el.setAttribute('stroke-width', strokeWidth);
                            });

                            backgroundIconsContainer.appendChild(svg);
                            placed = true;
                        }

                        attempts++;
                    }

                    if (!placed) {
                        console.warn(`Impossibile posizionare ${src} senza sovrapposizione`);
                    }
                })
                .catch(err => console.error(`Errore nel caricamento di ${src}:`, err));
        });

        cycle++;
    }, FADE_DURATION); // Dopo dissolvenza
}

// Primo caricamento
loadCycle();

// Ripeti ogni tot secondi
setInterval(loadCycle, CYCLE_DURATION); */