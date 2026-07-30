// frontend/hub-auth.js
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const link = document.getElementById('auth-link');
        if (!link) return;

        function loginUrl() {
            return 'login.html?returnTo=' + encodeURIComponent(ReturnTo.hereAsReturnTo());
        }

        // Su lobby.html evitiamo la navigazione a piena pagina: chiuderebbe
        // la connessione Socket.io e farebbe perdere la lobby (stesso
        // motivo per cui il pulsante livrea apre in una nuova scheda, vedi
        // lobby.js). La sessione Firebase si sincronizza comunque tra
        // schede, quindi l'header qui si aggiorna da solo (onAuthStateChanged
        // sotto) appena il login ha successo nella scheda nuova. Su
        // index.html non c'è nulla da perdere: resta la navigazione diretta.
        function goToLogin() {
            if (window.location.pathname.endsWith('lobby.html')) {
                window.open(loginUrl(), '_blank');
            } else {
                window.location.href = loginUrl();
            }
        }

        function showLoggedOut() {
            link.textContent = 'Login';
            link.onclick = () => { goToLogin(); };
        }

        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showLoggedOut();
            return;
        }

        firebaseAuth.onAuthStateChanged((user) => {
            if (user) {
                link.textContent = 'Log out';
                link.onclick = () => firebaseAuth.signOut();
            } else {
                showLoggedOut();
            }
        });
    });
})();
