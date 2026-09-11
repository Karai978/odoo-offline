/**
 * views/form/button_box/button_box.js
 * Rendu du button_box (boutons intelligents / "smart buttons") d'une
 * vue formulaire. Extrait de views/form/notebook_and_header.js pour se
 * conformer à l'organisation réelle d'Odoo (dossier dédié button_box/).
 */

export function renderButtonBox(node, hasRecordId) {
  if (!hasRecordId) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "oe_button_box";

  const buttons = Array.from(node.children).filter((c) => c.tagName === "button");
  buttons.forEach((btnNode) => {
    const label = btnNode.getAttribute("string") || "";
    if (!label) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "oe_stat_button btn";
    btn.innerHTML = `<div class="o_stat_info"><span class="o_stat_text">${label}</span></div>`;
    wrapper.appendChild(btn);
  });

  return wrapper.children.length > 0 ? wrapper : null;
}
