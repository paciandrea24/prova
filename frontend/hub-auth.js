// frontend/hub-auth.js
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const link = document.getElementById('auth-link');
        if (!link) return;

        function showLoggedOut() {
            link.textContent = 'Login';
            link.onclick = () => { window.location.href = 'login.html'; };
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
