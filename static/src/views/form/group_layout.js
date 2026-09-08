/**
 * views/form/group_layout.js
* Group rendering
 * Nested <group> elements, using the Odoo o_inner_group grid (col, colspan,
 * newline, standalone label). Depends on:
 *  - core/py_js/py_utils.js      (isNodeVisible)
 *  - fields/field.js             (renderField)
 *  - views/form/form_compiler.js (renderNode)
 */

import { isNodeVisible } from "../../core/py_js/py_utils.js";
import { renderField } from "../../fields/field.js";
import { renderNode } from "./form_compiler.js";

function getItemSpan(node) {
  const raw = node.getAttribute("colspan");
  const span = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(span) && span > 0 ? span : 1;
}

export function renderGroup(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const childGroups = Array.from(node.children).filter((c) => c.tagName === "group");

  if (childGroups.length > 0) {
    const el = document.createElement("div");
    el.className = "o_group row align-items-start";

    const stringAttr = node.getAttribute("string");
    if (stringAttr) {
      const title = document.createElement("h2");
      title.className = "o_horizontal_separator mt-4 mb-3 text-uppercase fw-bolder small";
      title.textContent = stringAttr;
      el.appendChild(title);
    }

    const outerMaxCols = parseInt(node.getAttribute("col"), 10) || 2;
    const colSize = Math.max(1, Math.round(12 / outerMaxCols));

    for (const child of node.children) {
      if (!isNodeVisible(child, securityContext, initialValues)) continue;

      if (child.tagName === "group") {
        const col = renderInnerGroup(child, fieldsInfo, initialValues, securityContext, hasRecordId);
        if (col) {
          const itemSpan = getItemSpan(child);
          if (itemSpan !== outerMaxCols) {
            col.classList.add(`col-lg-${itemSpan * colSize}`);
          }
          el.appendChild(col);
        }
      } else {
        const rendered = renderNode(child, fieldsInfo, initialValues, securityContext, hasRecordId);
        if (rendered) el.appendChild(rendered);
      }
    }
    return el;
  }

  return renderInnerGroup(node, fieldsInfo, initialValues, securityContext, hasRecordId);
}

function renderInnerGroup(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_inner_group grid";

  const maxCols = parseInt(node.getAttribute("col"), 10) || 2;

  const stringAttr = node.getAttribute("string");
  if (stringAttr) {
    const title = document.createElement("h2");
    title.className = "o_horizontal_separator mt-4 mb-3 text-uppercase fw-bolder small";
    title.textContent = stringAttr;
    wrapper.appendChild(title);
  }

  const items = collectGroupItems(node, fieldsInfo, initialValues, securityContext, hasRecordId);
  if (items.length === 0) return stringAttr ? wrapper : null;

  const rows = bucketItemsIntoRows(items, maxCols);

  for (const row of rows) {
    if (row.length === 0) continue;
    const rowEl = document.createElement("div");
    rowEl.className = "o_wrap_field d-flex d-sm-contents flex-column mb-3 mb-sm-0";

    const labelCount = row.filter((it) => it.subType === "item_component").length;
    const sizeOfDataCell = 100 / Math.max(1, maxCols - labelCount);

    for (const item of row) {
      const width =
        item.subType === "item_component" ? Math.max(1, item.itemSpan - 1) * sizeOfDataCell : null;
      item.render(width).forEach((cell) => rowEl.appendChild(cell));
    }

    wrapper.appendChild(rowEl);
  }

  return wrapper;
}

function collectGroupItems(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const items = [];
  const children = Array.from(node.children);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isNodeVisible(child, securityContext, initialValues)) continue;

    if (child.tagName === "label") {
      const forAttr = child.getAttribute("for");
      const next = children[i + 1];
      if (
        forAttr &&
        next &&
        isNodeVisible(next, securityContext, initialValues) &&
        nodeContainsField(next, forAttr)
      ) {
        const item = buildLabeledItem(
          child,
          next,
          fieldsInfo,
          initialValues,
          securityContext,
          hasRecordId
        );
        if (item) items.push(item);
        i++;
        continue;
      }
    }

    if (child.tagName === "field") {
      const item = buildFieldItem(child, fieldsInfo, initialValues, securityContext, hasRecordId);
      if (item) items.push(item);
      continue;
    }

    if (child.tagName === "newline") {
      if (items.length) items[items.length - 1].newline = true;
      continue;
    }

    const rendered = renderNode(child, fieldsInfo, initialValues, securityContext, hasRecordId);
    if (rendered) {
      const span = getItemSpan(child);
      rendered.classList.add("o_cell", "flex-grow-1", "flex-sm-grow-0");
      items.push({
        subType: "other",
        itemSpan: span,
        newline: false,
        render: () => [rendered],
      });
    }
  }
  return items;
}

function buildFieldItem(fieldNode, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const rendered = renderField(fieldNode, fieldsInfo, initialValues, securityContext, hasRecordId);
  if (!rendered) return null;

  const noLabel = fieldNode.getAttribute("nolabel") === "1";
  const itemSpan = getItemSpan(fieldNode);

  let labelEl = null;
  let widgetPresent = false;
  Array.from(rendered.children).forEach((c) => {
    if (c.tagName === "LABEL") {
      labelEl = c;
    } else {
      widgetPresent = true;
    }
  });
  if (!widgetPresent) return null;

  if (labelEl) rendered.removeChild(labelEl);

  rendered.className = "o_cell o_wrap_input flex-grow-1 flex-sm-grow-0 text-break";

  if (noLabel || !labelEl) {
    return {
      subType: "field_only",
      itemSpan,
      newline: false,
      render: () => [rendered],
    };
  }

  return {
    subType: "item_component",
    itemSpan,
    newline: false,
    render: (width) => {
      if (itemSpan - 1 > 1) rendered.style.gridColumn = `span ${itemSpan - 1}`;
      if (width != null) rendered.style.width = `${width}%`;
      return [wrapLabelCell(labelEl), rendered];
    },
  };
}

function wrapLabelCell(labelEl) {
  const cell = document.createElement("div");
  cell.className = "o_cell o_wrap_label flex-grow-1 flex-sm-grow-0 w-100 text-break text-900";
  cell.appendChild(labelEl);
  return cell;
}

function buildLabeledItem(
  labelNode,
  siblingNode,
  fieldsInfo,
  initialValues,
  securityContext,
  hasRecordId
) {
  const forAttr = labelNode.getAttribute("for");
  const stringAttr = labelNode.getAttribute("string");
  const info = fieldsInfo[forAttr];
  const labelText = stringAttr || (info ? info.label : forAttr);
  const itemSpan = getItemSpan(siblingNode);

  const labelEl = document.createElement("label");
  labelEl.className = "o_form_label";
  labelEl.setAttribute("for", `field-${forAttr}`);
  labelEl.textContent = labelText;

  const valueInner = document.createElement("div");
  valueInner.className = "o_field_widget";

  if (siblingNode.tagName === "field") {
    const rendered = renderField(siblingNode, fieldsInfo, initialValues, securityContext, hasRecordId);
    if (rendered) {
      const widget = rendered.querySelector(".o_field_widget") || rendered;
      Array.from(widget.childNodes).forEach((n) => valueInner.appendChild(n));
    }
  } else {
    for (const inner of Array.from(siblingNode.children)) {
      if (!isNodeVisible(inner, securityContext, initialValues)) continue;
      if (inner.tagName === "field") {
        const rendered = renderField(inner, fieldsInfo, initialValues, securityContext, hasRecordId);
        if (!rendered) continue;
        const label = rendered.querySelector(".o_form_label");
        if (label) label.remove();
        const widget = rendered.querySelector(".o_field_widget");
        if (widget) valueInner.appendChild(widget);
      } else {
        const rendered = renderNode(inner, fieldsInfo, initialValues, securityContext, hasRecordId);
        if (rendered) valueInner.appendChild(rendered);
      }
    }
  }

  if (valueInner.children.length === 0) return null;

  return {
    subType: "item_component",
    itemSpan,
    newline: false,
    render: (width) => {
      const inputCell = document.createElement("div");
      inputCell.className = "o_cell o_wrap_input flex-grow-1 flex-sm-grow-0 text-break";
      if (itemSpan - 1 > 1) inputCell.style.gridColumn = `span ${itemSpan - 1}`;
      if (width != null) inputCell.style.width = `${width}%`;
      inputCell.appendChild(valueInner);
      return [wrapLabelCell(labelEl), inputCell];
    },
  };
}

function bucketItemsIntoRows(items, maxCols) {
  const rows = [];
  let currentRow = [];
  let reserved = 0;

  for (const item of items) {
    if (item.newline && currentRow.length) {
      rows.push(currentRow);
      currentRow = [];
      reserved = 0;
    }
    if (item.itemSpan + reserved > maxCols && currentRow.length) {
      rows.push(currentRow);
      currentRow = [];
      reserved = 0;
    }
    currentRow.push(item);
    reserved += item.itemSpan;
  }
  if (currentRow.length) rows.push(currentRow);
  return rows;
}

function nodeContainsField(node, fieldName) {
  if (node.tagName === "field" && node.getAttribute("name") === fieldName) return true;
  return Array.from(node.querySelectorAll ? node.querySelectorAll("field") : []).some(
    (f) => f.getAttribute("name") === fieldName
  );
}
