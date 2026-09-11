/**
 * views/kanban/kanban_renderer.js
 * Rendu de la vue Kanban : construit la grille de cartes à partir des
 * enregistrements et du template <t t-name="kanban-box">, en délégant
 * la compilation/interprétation du template à kanban_compiler.js
 * (moteur QWeb minimal : t-if, t-esc, t-out, t-attf-class, t-set...).
 */

import { formatCellValue } from "../list/list_renderer_utils.js";
import { renderKanbanNode } from "./kanban_compiler.js";

function buildKanbanRecordProxy(record, fieldsInfo) {
  const proxy = {};
  for (const [fname, info] of Object.entries(fieldsInfo)) {
    const rawValue = record[fname];
    proxy[fname] = {
      raw_value: rawValue === undefined ? false : rawValue,
      value: formatCellValue(rawValue, info),
    };
  }
  if (proxy.id === undefined) {
    proxy.id = { raw_value: record.id, value: record.id };
  }
  return proxy;
}

const KANBAN_GLOBAL_DEFAULTS = {
  selection_mode: false,
};

export function renderKanbanView(archXml, fieldsInfo, records, onCardClick) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const kanbanRoot = doc.querySelector("kanban");
  const templateNode = doc.querySelector('templates > t[t-name="kanban-box"]');

  const wrapper = document.createElement("div");
  wrapper.className = "o_kanban_view o_kanban_ungrouped";

  if (!kanbanRoot || !templateNode) {
    wrapper.textContent = "Vue Kanban non disponible pour ce modèle.";
    return wrapper;
  }

  if (!records || records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "o_kanban_renderer o_kanban_no_records text-muted p-4 text-center";
    empty.textContent = "Aucun enregistrement.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const renderer = document.createElement("div");
  renderer.className = "o_kanban_renderer o_kanban_grouped d-flex flex-wrap gap-3 p-3";
  wrapper.appendChild(renderer);

  records.forEach((rawRecord) => {
    const recordProxy = buildKanbanRecordProxy(rawRecord, fieldsInfo);
    const scope = { ...KANBAN_GLOBAL_DEFAULTS };

    const cardWrapper = document.createElement("div");
    cardWrapper.className = "o_kanban_record";
    cardWrapper.style.width = "300px";
    cardWrapper.style.cursor = "pointer";

    for (const child of Array.from(templateNode.childNodes)) {
      const rendered = renderKanbanNode(child, recordProxy, fieldsInfo, scope);
      if (rendered) cardWrapper.appendChild(rendered);
    }

    cardWrapper.addEventListener("click", () => onCardClick(rawRecord.id));
    renderer.appendChild(cardWrapper);
  });

  return wrapper;
}
