const NavigationTask = {
    activeTaskId: null,
    currentStep: 1,

    initHTML: function () {
        const html = `
        <div id="task-nav-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 350px;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #1abc9c;">Mappa Rotta</h2>
                    <button onclick="NavigationTask.close()" class="close-btn">X</button>
                </div>
                <p style="color: white; text-align: center;">Seleziona i nodi in ordine (1 ➔ 4)</p>
                <div id="nav-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
                    </div>
                <div id="nav-feedback" style="text-align: center; height: 20px; font-weight: bold; color: #1abc9c;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true;
        this.currentStep = 1;
        document.getElementById('nav-feedback').innerText = '';

        const grid = document.getElementById('nav-grid');
        grid.innerHTML = '';

        // Array mischiato da 1 a 4
        let nodes = [1, 2, 3, 4].sort(() => Math.random() - 0.5);

        nodes.forEach(num => {
            const btn = document.createElement('button');
            btn.className = 'key-btn';
            btn.style.height = '80px';
            btn.style.fontSize = '30px';
            btn.innerText = num;
            btn.onclick = () => this.clickNode(btn, num);
            grid.appendChild(btn);
        });

        document.getElementById('task-nav-overlay').classList.remove('hidden');
    },

    clickNode: function (btn, num) {
        if (num === this.currentStep) {
            btn.style.background = '#1abc9c'; // Corretto
            btn.style.color = '#fff';
            this.currentStep++;

            if (this.currentStep > 4) {
                document.getElementById('nav-feedback').innerText = 'ROTTA IMPOSTATA';
                socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });
                setTimeout(() => this.close(), 1000);
            }
        } else if (num > this.currentStep) {
            // Errore: lampeggia di rosso ma non resetta
            const oldBg = btn.style.background;
            btn.style.background = '#e74c3c';
            setTimeout(() => btn.style.background = oldBg, 200);
        }
    },

    close: function () {
        isTaskOpen = false;
        document.getElementById('task-nav-overlay').classList.add('hidden');
    }
};
document.addEventListener("DOMContentLoaded", () => NavigationTask.initHTML());