/**
 * core/notebook/notebook.js
 * Rendu du notebook (onglets <page>) d'une vue formulaire.
 * Extrait de views/form/notebook_and_header.js pour se conformer à
 * l'organisation réelle d'Odoo (le composant Notebook vit dans core/,
 * réutilisable en dehors des seules vues formulaire).
 * Depends on:
 * - core/py_js/py_utils.js (isNodeVisible)
 * - views/form/form_compiler.js (renderChildrenInto)
 */

import { isNodeVisible } from "../py_js/py_utils.js";
import { renderChildrenInto } from "../../views/form/form_compiler.js";

export function renderNotebook(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_notebook";

  const nav = document.createElement("div");
  nav.className = "o_notebook_headers";

  const navUl = document.createElement("ul");
  navUl.className = "nav nav-tabs";
  nav.appendChild(navUl);

  const content = document.createElement("div");
  content.className = "tab-content";

  const pages = Array.from(node.children).filter(
    (c) => c.tagName === "page" && isNodeVisible(c, securityContext, initialValues)
  );

  pages.forEach((page, index) => {
    const label = page.getAttribute("string") || `Page ${index + 1}`;

    const li = document.createElement("li");
    li.className = "nav-item";
    const link = document.createElement("a");
    link.className = "nav-link" + (index === 0 ? " active" : "");
    link.href = "#";
    link.textContent = label;
    li.appendChild(link);
    navUl.appendChild(li);

    const pane = document.createElement("div");
    pane.className = "tab-pane" + (index === 0 ? " active" : "");
    renderChildrenInto(page, pane, fieldsInfo, initialValues, securityContext, hasRecordId);
    content.appendChild(pane);

    link.addEventListener("click", (e) => {
      e.preventDefault();
      navUl.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
      content.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      link.classList.add("active");
      pane.classList.add("active");
    });
  });

  wrapper.appendChild(nav);
  wrapper.appendChild(content);
  return pages.length > 0 ? wrapper : null;
}
