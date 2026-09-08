/**
 * core/assets.js
*/

import { CONFIG } from "./browser/session.js";

const ODOO_ASSETS_STYLE_ID = "odoo-assets-dynamic";

export async function loadOdooAssets() {
  if (document.getElementById(ODOO_ASSETS_STYLE_ID)) return;

  try {
    const response = await fetch("css/web.assets_web.min.css");
    let css = await response.text();
    css = css.replaceAll("__ODOO_BASE__", CONFIG.ODOO_BASE_URL);

    const style = document.createElement("style");
    style.id = ODOO_ASSETS_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  } catch (err) {
    console.error("Impossible de charger web.assets_web.min.css :", err);
  }
}

/** Removes web.assets_web.min.css (called when the navbar is hidden). */
export function unloadOdooAssets() {
  document.getElementById(ODOO_ASSETS_STYLE_ID)?.remove();
}

/**
 * Dynamically loads a stylesheet and injects it into the <head>,
 * identifying it with a unique ID so it can be cleanly removed later.
 * Used for CSS scoped to a single screen (e.g., web.assets_frontend.min.css,
 * active only while the login screen is mounted)—never load this
 * globally like web.assets_web.min.css, as this could cause
 * class conflicts between the "website" theme and the Odoo backend theme.
 */
export async function loadScopedCss(url, styleId) {
  if (document.getElementById(styleId)) return;

  try {
    const response = await fetch(url);
    const css = await response.text();

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  } catch (err) {
    console.error(`Impossible de charger ${url} :`, err);
  }
}

/** Remove a stylesheet previously injected by loadScopedCss(). */
export function unloadScopedCss(styleId) {
  document.getElementById(styleId)?.remove();
}
