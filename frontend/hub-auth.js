// frontend/hub-auth.js
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const link = document.getElementById('auth-link');
        if (!link) return;

        function loginUrl() {
            return 'login.html?returnTo=' + encodeURIComponent(ReturnTo.hereAsReturnTo());
        }

        function showLoggedOut() {
            link.textContent = 'Login';
            link.onclick = () => { window.location.href = loginUrl(); };
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
