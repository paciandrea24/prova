const OxygenTask = {
    activeTaskId: null,
    dustLeft: 6,

    initHTML: function () {
        const html = `
        <div id="task-oxygen-overlay" class="overlay hidden" style="z-index: 150; background: rgba(0,0,0,0.8);">
            <div class="task-panel" style="width: 320px;">
                <div class="task-header">
                    <h2 style="margin: 0; color: #3498db;">Filtra Ossigeno</h2>
                    <button onclick="OxygenTask.close()" class="close-btn">X</button>
                </div>
                <p style="color: white; text-align: center; font-size: 14px;">Passa il mouse sulla polvere per pulire il filtro.</p>
                <div id="oxygen-filter" style="width: 100%; height: 200px; background: #ecf0f1; position: relative; border-radius: 10px; overflow: hidden; border: 4px solid #bdc3c7;">
                    </div>
                <div id="oxygen-feedback" style="text-align: center; margin-top: 15px; height: 20px; font-weight: bold; color: #3498db;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    open: function (taskId) {
        this.activeTaskId = taskId;
        isTaskOpen = true;
        this.dustLeft = 6;
        document.getElementById('oxygen-feedback').innerText = '';

        const filter = document.getElementById('oxygen-filter');
        filter.innerHTML = '';

        for (let i = 0; i < 6; i++) {
            const dust = document.createElement('div');
            dust.style.width = '50px'; dust.style.height = '50px';
            dust.style.background = 'rgba(139, 69, 19, 0.7)'; // Marrone polvere
            dust.style.position = 'absolute';
            dust.style.borderRadius = '30% 70% 70% 30% / 30% 30% 70% 70%';
            dust.style.left = Math.random() * 220 + 'px';
            dust.style.top = Math.random() * 140 + 'px';
            dust.style.filter = 'blur(2px)';

            // Pulisce al passaggio del mouse
            dust.onmouseenter = () => this.cleanDust(dust);
            filter.appendChild(dust);
        }
        document.getElementById('task-oxygen-overlay').classList.remove('hidden');
    },

    cleanDust: function (el) {
        if (el.style.opacity === '0') return;
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.2s';
        this.dustLeft--;

        if (this.dustLeft === 0) {
            document.getElementById('oxygen-feedback').innerText = 'FILTRO PULITO';
            socket.emit('attemptTask', { lobbyId, playerColor: myColor, taskId: this.activeTaskId });
            setTimeout(() => this.close(), 1000);
        }
    },

    close: function () {
        isTaskOpen = false;
        document.getElementById('task-oxygen-overlay').classList.add('hidden');
    }
};
document.addEventListener("DOMContentLoaded", () => OxygenTask.initHTML());