/**
 * webclient/login.js
 */

import { registry } from "../core/registry.js";
import { CONFIG, saveSession } from "../core/browser/session.js";
import { fetchAndStoreSecurityInfo } from "../core/user.js";
import { ensureCacheOwnership } from "../core/cache_owner.js"; 
import { loadScopedCss, unloadScopedCss } from "../core/assets.js";

const LOGIN_TEMPLATE = `
  <div id="wrapwrap">
    <main>
      <div class="container py-5">
        <div style="max-width: 300px;" class="card border-0 mx-auto bg-100 o_database_list">
          <div class="card-body">
            <div class="text-center pb-3 border-bottom mb-4">
              <img alt="Logo" style="max-height:120px; max-width: 100%; width:auto"
                   src="https://upload.wikimedia.org/wikipedia/commons/2/2c/Odoo-logo.svg">
            </div>

            <form class="oe_login_form" role="form" id="login-form">
              <div class="mb-3 field-login">
                <label for="login-email" class="form-label">E-mail</label>
                <input type="text" placeholder="E-mail" id="login-email" required
                       autocomplete="username" autofocus autocapitalize="off" class="form-control">
              </div>

              <div class="mb-3">
                <label for="login-password" class="form-label">Mot de passe</label>
                <input type="password" placeholder="Mot de passe" id="login-password" required
                       autocomplete="current-password" maxlength="4096" class="form-control">
              </div>

              <div class="clearfix oe_login_buttons text-center gap-1 d-grid mb-1 pt-3">
                <button type="submit" id="login-btn" class="btn btn-primary">Se connecter</button>
                <p id="error" class="text-danger small mt-2 mb-0" style="display:none;"></p>
              </div>
              <div class="justify-content-between mt-2 d-flex small">
                <a href="http://localhost:8069/web/signup?">Vous n'avez pas de compte ?</a>
                <a href="http://localhost:8069/web/reset_password?">Réinitialiser le mot de passe</a>
              </div>
                <div class="o_login_auth"></div>
              </div>
              <input type="hidden" name="redirect">
            </form>

            <div class="text-center small mt-4 pt-3 border-top">
              <a class="border-end pe-2 me-1" href="http://localhost:8069/web/database/manager">Gestion des bases de données</a>
              <a href="https://www.odoo.com/?utm_source=db&amp;utm_medium=auth" target="_blank">Généré par <span>Odoo</span></a>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
`;

/**
 * Mounts the login screen. params.redirectTo (optional) is the
 * action descriptor the user was trying to reach before
 * being redirected here by the authentication guard.
 */
function mountLogin(container, params, env) {
  container.innerHTML = LOGIN_TEMPLATE;

  loadScopedCss("css/web.assets_frontend.min.css", "odoo-frontend-assets-login");

  const form = container.querySelector("#login-form");
  const emailEl = container.querySelector("#login-email");
  const passwordEl = container.querySelector("#login-password");
  const errorEl = container.querySelector("#error");
  const btn = container.querySelector("#login-btn");

  async function onSubmit(event) {
    event.preventDefault();

    const email = emailEl.value;
    const password = passwordEl.value;

    errorEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Connexion...";

    try {
      const response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        errorEl.textContent = data.error || "Erreur de connexion";
        errorEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Se connecter";
        return;
      }

      saveSession({
        uid: data.uid,
        name: data.name,
        api_key: data.api_key,
      });

      // Purges the local cache if it belonged to another user,
      btn.textContent = "Vérification du cache local...";
      try {
        await ensureCacheOwnership(data.uid);
      } catch (cacheErr) {
        console.error("Erreur lors de la vérification du cache local :", cacheErr);
        errorEl.textContent = "Erreur lors de l'initialisation du cache local. Réessayez.";
        errorEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Se connecter";
        return;
      }

      // Retrieve permissions (Security Engine) immediately after login.
      // Do not block the connection if this fails: the user will still be
      // able to use the app, simply without cached permissions for the time being.
      btn.textContent = "Chargement des droits...";
      try {
        await fetchAndStoreSecurityInfo(data.api_key, CONFIG.ODOO_BASE_URL);
      } catch (securityErr) {
        console.warn("Impossible de récupérer les droits (Security Engine) :", securityErr);
      }

      // Returns to the screen requested prior to the authentication redirect,
      // or "home_menu" by default (direct login, without a deep link).
      const target = params.redirectTo || { tag: "home_menu" };
      await env.doAction(target, { replace: true, clearStack: true });
    } catch (err) {
      errorEl.textContent = "Impossible de contacter le serveur. Vérifiez votre connexion.";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Se connecter";
    }
  }

  form.addEventListener("submit", onSubmit);

  return {
    destroy() {
      form.removeEventListener("submit", onSubmit);
      unloadScopedCss("odoo-frontend-assets-login");
    },
  };
}

registry.category("actions").add("login", { mount: mountLogin });
