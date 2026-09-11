/**
 * views/form/form_renderer.js
 * Builds the DOM skeleton of the Odoo form (o_form_view, o_form_sheet_bg,
 * statusbar, chatter stub), then delegates the recursive compilation of
 * the XML architecture to form_compiler.js.
 */

import { renderChildren } from "./form_compiler.js";

/**
 * NEW param: onObjectButtonClick, forwarded unchanged to renderChildren
 * (see form_compiler.js / core/notebook/notebook.js / status_bar_buttons/status_bar_buttons.js / button_box/button_box.js).
 */
export function renderFormView(archXml, fieldsInfo, initialValues = {}, securityContext = null, onObjectButtonClick = null) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    console.error("Erreur de parsing XML:", parseError.textContent);
    const errDiv = document.createElement("div");
    errDiv.textContent = "Impossible d'afficher ce formulaire (erreur de structure).";
    return errDiv;
  }

  const formRoot = doc.querySelector("form");
  if (!formRoot) {
    const errDiv = document.createElement("div");
    errDiv.textContent = "Aucun élément <form> trouvé dans cette vue.";
    return errDiv;
  }

  const hasRecordId = !!(initialValues && initialValues.id);
  const formView = document.createElement("div");
  formView.className = "o_form_view";

  const contentRow = document.createElement("div");
  contentRow.className = "o_content";
  formView.appendChild(contentRow);

  const rendererRow = document.createElement("div");
  rendererRow.className = "o_form_renderer o_form_editable d-flex flex-nowrap h-100";
  contentRow.appendChild(rendererRow);

  const sheetBg = document.createElement("div");
  sheetBg.className = "o_form_sheet_bg";
  rendererRow.appendChild(sheetBg);

  const headerRow = document.createElement("div");
  headerRow.className =
    "o_form_statusbar position-relative d-flex justify-content-between mb-0 mb-md-2 pb-2 pb-md-0";
  sheetBg.appendChild(headerRow);

  const sheet = document.createElement("div");
  sheet.className = "o_form_sheet position-relative";
  sheetBg.appendChild(sheet);

  const chatterCol = document.createElement("div");
  chatterCol.className =
    "o-mail-ChatterContainer o-mail-Form-chatter oe_chatter o-aside";
  chatterCol.innerHTML = `
    <div class="o-mail-Chatter w-100 h-100 flex-grow-1 d-flex flex-column overflow-auto">
      <div class="o-mail-Chatter-top position-sticky top-0">
        <div class="o-mail-Chatter-topbar d-flex flex-shrink-0 flex-grow-0 px-3 overflow-x-auto">
          <button type="button" class="o-mail-Chatter-sendMessage btn text-nowrap me-1 btn-primary my-2">Envoyer un message</button>
          <button type="button" class="o-mail-Chatter-logNote btn text-nowrap me-1 btn-secondary my-2">Note</button>
          <div class="flex-grow-1 d-flex">
            <button type="button" class="o-mail-Chatter-activity btn btn-secondary text-nowrap my-2"><span>Activités</span></button>
            <span class="o-mail-Chatter-topbarGrow flex-grow-1 pe-2"></span>
            <button type="button" class="o-mail-Chatter-search btn btn-link text-action" aria-label="Rechercher des messages">
              <i class="oi oi-search" role="img"></i>
            </button>
          </div>
        </div>
      </div>
      <div class="o-mail-Chatter-content">
        <div class="o-mail-Thread position-relative flex-grow-1 d-flex flex-column overflow-auto pb-4 text-muted small p-3">
          Historique non disponible hors-ligne pour l'instant.
        </div>
      </div>
    </div>
  `;
  rendererRow.appendChild(chatterCol);

  chatterCol
    .querySelectorAll(
      ".o-mail-Chatter-sendMessage, .o-mail-Chatter-logNote, " +
      ".o-mail-Chatter-activity, .o-mail-Chatter-search"
    )
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        alert(
          "Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment."
        );
      });
    });

  renderChildren(formRoot, headerRow, sheet, fieldsInfo, initialValues, securityContext, hasRecordId, onObjectButtonClick);

  return formView;
}