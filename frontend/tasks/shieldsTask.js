// frontend/tasks/shieldsTask.js

const ShieldsTask = {
    activeTaskId: null,
    nodes: [], // true = acceso, false = spento

    initHTML: function () {
        const taskHTML = `
        <div id="task-shields-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 380px;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #00bcd4; text-shadow: 0 0 10px rgba(0, 188, 212, 0.5);">Attiva Scudi</h2>
                    <button onclick="ShieldsTask.close()" class="close-btn">X</button>
                </div>
                
                <p style="color: #bdc3c7; font-size: 14px; text-align: center; margin-bottom: 15px;">Clicca sui nodi rossi per ripristinare la rete scudi.</p>
                
                <div id="shields-grid" style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; margin-bottom: 20px; padding: 25px; background: #1a252f; border-radius: 10px; border: 3px inset #34495E;">
                    </div>

                <div id="shields-feedback" style="height: 20px; font-weight: bold; color: #00bcd4; text-align: center; font-size: 20px; letter-spacing: 2px;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', taskHTML);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true; // Ferma il player

        const grid = document.getElementById('shields-grid');
        grid.innerHTML = '';
        this.nodes = [];

        // Genera 7 nodi. Ognuno ha il 70% di probabilità di essere spento (rosso)
        for (let i = 0; i < 7; i++) {
            const isInactive = Math.random() > 0.3;
            this.nodes.push(!isInactive);

            const btn = document.createElement('div');
            btn.className = 'shield-node';
            btn.id = `shield-node-${i}`;

            // Stile base del nodo scudo
            btn.style.width = '65px';
            btn.style.height = '65px';
            btn.style.borderRadius = '50%';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'; // Effetto rimbalzo elastico

            this.updateNodeStyle(btn, !isInactive);

            // Quando clicchi un nodo, chiama toggleNode
            btn.onmousedown = () => {
                btn.style.transform = 'scale(0.85)';
            };
            btn.onmouseup = () => {
                btn.style.transform = 'scale(1)';
                this.toggleNode(i);
            };
            btn.onmouseleave = () => btn.style.transform = 'scale(1)';

            grid.appendChild(btn);
        }

        // Assicuriamoci che ci sia ALMENO UN nodo rosso, sennò la task si auto-completa
        if (this.nodes.every(n => n === true)) {
            this.nodes[0] = false;
            this.updateNodeStyle(document.getElementById('shield-node-0'), false);
        }

        document.getElementById('shields-feedback').innerText = '';
        document.getElementById('task-shields-overlay').classList.remove('hidden');
    },

    updateNodeStyle: function (el, isActive) {
        if (isActive) {
            // SCUDO ACCESO (Azzurro scuro/Ciano)
            el.style.background = 'radial-gradient(circle at 30% 30%, #00bcd4, #00838f)';
            el.style.border = '3px solid #b2ebf2';
            el.style.boxShadow = '0 0 20px rgba(0, 188, 212, 0.8), inset 0 0 10px rgba(0,0,0,0.5)';
        } else {
            // SCUDO SPENTO (Rosso)
            el.style.background = 'radial-gradient(circle at 30% 30%, #e74c3c, #c0392b)';
            el.style.border = '3px solid #ffbaba';
            el.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.5)';
        }
    },

    toggleNode: function (index) {
        if (this.nodes[index]) return; // Se è già acceso, non fare nulla

        // Accendi il nodo
        this.nodes[index] = true;
        this.updateNodeStyle(document.getElementById(`shield-node-${index}`), true);

        this.checkWin();
    },

    checkWin: function () {
        // Controlla se tutti i nodi nell'array sono 'true'
        if (this.nodes.every(n => n === true)) {
            document.getElementById('shields-feedback').innerText = 'SCUDI ONLINE';

            // Invia segnale al server
            socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });

            setTimeout(() => this.close(), 1000);
        }
    },

    close: function () {
        isTaskOpen = false;
        document.getElementById('task-shields-overlay').classList.add('hidden');
    }
};

document.addEventListener("DOMContentLoaded", () => ShieldsTask.initHTML());