/**
 * views/fields/char/char_field.js
 *
 * OWL implementation of the Odoo 17 CharField, mounted independently from the
 * rest of the legacy DOM renderer. The small adapter around the component is
 * intentional: form serialization and the other field widgets still consume
 * ordinary DOM elements while this widget is migrated incrementally.
 */

import { evaluateSimpleCondition } from "../../../core/py_js/py_utils.js";
import {
  openCharTranslationDialog,
  openDynamicPlaceholderSelector,
} from "./char_dialogs.js";

const owl = window.owl;
if (!owl?.App || !owl?.Component || !owl?.xml) {
  throw new Error("OWL n'est pas chargé. Vérifiez l'ordre des scripts dans index.html.");
}

const { App, Component, useRef, useState, xml } = owl;
const CHAR_HOST_SELECTOR = "[data-owl-char-field]";

function toCharValue(value) {
  return value === false || value === null || value === undefined ? "" : String(value);
}

function parseBoolean(value) {
  return value === true || value === 1 || ["1", "True", "true", "yes"].includes(value);
}

function parseCharOptions(rawOptions = "") {
  const dynamicMatch = rawOptions.match(
    /(?:['"]dynamic_placeholder['"]|dynamic_placeholder)\s*:\s*(True|False|true|false|1|0)\b/
  );
  const referenceMatch = rawOptions.match(
    /(?:['"]dynamic_placeholder_model_reference_field['"]|dynamic_placeholder_model_reference_field)\s*:\s*(['"])(.*?)\1/
  );
  return {
    dynamicPlaceholder: dynamicMatch ? parseBoolean(dynamicMatch[1]) : false,
    dynamicPlaceholderModelReferenceField: referenceMatch?.[2] || "",
  };
}

function createFallbackInput(props) {
  const input = document.createElement("input");
  input.type = props.isPassword ? "password" : "text";
  input.className = "o_input";
  input.id = props.id;
  input.name = props.name;
  input.value = props.value;
  input.autocomplete = props.autocomplete || (props.isPassword ? "new-password" : "off");
  if (props.placeholder) input.placeholder = props.placeholder;
  if (props.maxLength > 0) input.maxLength = props.maxLength;
  input.required = props.required;
  input.readOnly = props.readonly;
  if (props.translatable) input.classList.add("o_field_translate");
  input.dataset.charFieldInput = "true";
  return input;
}

export class CharField extends Component {
  static template = xml`
    <div class="o_field_char_owl_input d-flex align-items-center">
      <t t-if="state.readonly">
        <span
          class="o_form_readonly flex-grow-1"
          t-att-id="props.id"
          t-esc="formattedValue"
        />
      </t>
      <t t-else="">
        <input
          class="o_input flex-grow-1"
          t-att-class="{'o_field_translate': props.translatable}"
          t-att-id="props.id"
          t-att-name="props.name"
          t-att-type="props.isPassword ? 'password' : 'text'"
          t-att-autocomplete="props.autocomplete || (props.isPassword ? 'new-password' : 'off')"
          t-att-maxlength="maxLength > 0 ? maxLength : false"
          t-att-placeholder="props.placeholder || false"
          t-att-required="state.required"
          t-att-value="state.value"
          t-att-aria-label="props.label || false"
          data-char-field-input="true"
          t-ref="input"
          t-on-input="onInput"
          t-on-change="onChange"
          t-on-keydown="onKeydown"
        />
      </t>
      <t t-if="props.translatable">
        <button
          type="button"
          class="btn btn-link o_char_translate_button"
          title="Traduire"
          aria-label="Traduire ce champ"
          t-on-click="openTranslationDialog"
        ><i class="fa fa-language" aria-hidden="true"/></button>
      </t>
    </div>
  `;

  static props = {
    id: { type: String, optional: true },
    name: { type: String },
    label: { type: String, optional: true },
    value: { type: [String, Number, Boolean], optional: true },
    readonly: { type: Boolean, optional: true },
    required: { type: Boolean, optional: true },
    maxLength: { type: Number, optional: true },
    trim: { type: Boolean, optional: true },
    isPassword: { type: Boolean, optional: true },
    autocomplete: { type: String, optional: true },
    placeholder: { type: String, optional: true },
    translatable: { type: Boolean, optional: true },
    dynamicPlaceholder: { type: Boolean, optional: true },
    dynamicPlaceholderModelReferenceField: { type: String, optional: true },
    modelName: { type: String, optional: true },
    recordId: { type: [String, Number], optional: true },
    recordValues: { type: Object, optional: true },
    fieldsByModel: { type: Object, optional: true },
    onUpdate: { type: Function, optional: true },
  };

  static defaultProps = {
    id: "",
    label: "",
    value: "",
    readonly: false,
    required: false,
    maxLength: 0,
    trim: true,
    isPassword: false,
    autocomplete: "",
    placeholder: "",
    translatable: false,
    dynamicPlaceholder: false,
    dynamicPlaceholderModelReferenceField: "",
    modelName: "",
    recordId: "",
    recordValues: {},
    fieldsByModel: {},
  };

  setup() {
    this.input = useRef("input");
    this.state = useState({
      value: toCharValue(this.props.value),
      readonly: !!this.props.readonly,
      required: !!this.props.required,
    });
  }

  get maxLength() {
    const size = Number(this.props.maxLength);
    return Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
  }

  get formattedValue() {
    return this.props.isPassword ? "*".repeat(this.state.value.length) : this.state.value;
  }

  parse(value) {
    return this.props.trim && !this.props.isPassword ? value.trim() : value;
  }

  onInput(event) {
    const value = event.currentTarget.value;
    this.state.value = value;
    this.props.onUpdate?.(value, "input");
  }

  onChange(event) {
    this.commitValue(event.currentTarget);
  }

  onKeydown(event) {
    if (event.key === "#" && this.props.dynamicPlaceholder) {
      const input = event.currentTarget;
      const host = input.closest(CHAR_HOST_SELECTOR);
      // Let the browser insert '#', then open the model field selector at the
      // caret position, matching Odoo's dynamic-placeholder trigger behavior.
      setTimeout(() => {
        openDynamicPlaceholderSelector({
          host,
          input,
          modelName: this.props.modelName,
          modelReferenceField: this.props.dynamicPlaceholderModelReferenceField,
          recordValues: this.props.recordValues,
          fieldsByModel: this.props.fieldsByModel,
        }).catch((error) => console.warn("Sélecteur de placeholder indisponible :", error));
      }, 0);
      return;
    }

    // Odoo commits text fields on Enter/Tab as well as on the native change
    // event. Enter does not reliably blur a text input, so emit the bubbling
    // change event used by the existing PWA onchange adapter explicitly.
    // Do not prevent the browser's normal focus/navigation behavior.
    if (event.key === "Enter" || event.key === "Tab") {
      this.commitValue(event.currentTarget);
      if (event.key === "Enter") {
        const changeEvent = new event.currentTarget.ownerDocument.defaultView.Event("change", {
          bubbles: true,
        });
        event.currentTarget.dispatchEvent(changeEvent);
      }
    }
  }

  openTranslationDialog() {
    return openCharTranslationDialog({
      model: this.props.modelName,
      recordId: this.props.recordId,
      fieldName: this.props.name,
      label: this.props.label,
      userLanguageValue: this.state.value,
    });
  }

  commitValue(input) {
    const value = this.parse(input.value);
    if (input.value !== value) {
      input.value = value;
    }
    this.state.value = value;
    this.props.onUpdate?.(value, "commit");
  }

  setFieldState(patch) {
    if (Object.prototype.hasOwnProperty.call(patch, "value")) {
      this.state.value = toCharValue(patch.value);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "readonly")) {
      this.state.readonly = !!patch.readonly;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "required")) {
      this.state.required = !!patch.required;
    }
  }
}

/**
 * Imperatively updates the component when legacy form rules or an onchange
 * patch changes a CharField. Updates are queued until OWL has mounted.
 */
export function updateCharField(host, patch) {
  if (!host || !patch) return;

  host._owlPendingProps = { ...(host._owlPendingProps || {}), ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "value")) {
    host._owlCharValue = toCharValue(patch.value);
  }
  const input = host._owlFallbackInput || host.querySelector("[data-char-field-input]");
  if (input) {
    if (Object.prototype.hasOwnProperty.call(patch, "value")) input.value = toCharValue(patch.value);
    if (Object.prototype.hasOwnProperty.call(patch, "readonly")) input.readOnly = !!patch.readonly;
    if (Object.prototype.hasOwnProperty.call(patch, "required")) input.required = !!patch.required;
  }
  host._owlComponent?.setFieldState(patch);
}

/** Returns the raw value represented by either the editable input or readonly text node. */
export function getCharFieldValue(element) {
  if (!element) return "";
  const host = element.matches?.(CHAR_HOST_SELECTOR)
    ? element
    : element.closest?.(CHAR_HOST_SELECTOR);
  let value;
  if (element.matches?.("input[data-char-field-input]")) {
    value = element.value;
  } else if (host && Object.prototype.hasOwnProperty.call(host, "_owlCharValue")) {
    // Keep the raw value in a JS property rather than a data-* attribute. In
    // particular, readonly password values must never be exposed in the DOM.
    value = host._owlCharValue;
  } else {
    const input = element.matches?.("input, textarea") ? element : element.querySelector?.("input, textarea");
    value = input ? input.value : (element.textContent || "");
  }
  if (host?.dataset.charTrim === "true" && host.dataset.charPassword !== "true") {
    value = value.trim();
  }
  return value;
}

function mountWhenConnected(host, props) {
  if (host._owlDestroyed || host._owlApp) return;
  if (!host.isConnected) {
    const observer = new MutationObserver(() => {
      if (host.isConnected) {
        observer.disconnect();
        host._owlMountObserver = null;
        mountWhenConnected(host, props);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    host._owlMountObserver = observer;
    return;
  }

  const fallback = host._owlFallbackInput;
  const liveProps = {
    ...props,
    ...(host._owlPendingProps || {}),
    value: fallback ? fallback.value : props.value,
    onUpdate: (value, phase) => {
      host._owlPendingProps = { ...(host._owlPendingProps || {}), value };
      host._owlCharValue = value;
      props.onUpdate?.(value, phase);
    },
  };
  // Capture autofill or other native edits that happened without an input event
  // before the fallback field is removed.
  host._owlCharValue = liveProps.value;

  const app = new App(CharField, { props: liveProps });
  host._owlApp = app;
  app
    .mount(host, { position: "first-child" })
    .then(async (component) => {
      if (host._owlDestroyed) {
        app.destroy();
        return;
      }
      host._owlComponent = component;
      if (fallback) fallback.hidden = true;

      const latest = host._owlPendingProps || {};
      if (Object.keys(latest).length) {
        component.setFieldState(latest);
        if (typeof requestAnimationFrame === "function") {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
      if (fallback) {
        fallback.remove();
        host._owlFallbackInput = null;
      }
    })
    .catch((error) => {
      // The native input stays usable if OWL cannot mount (for example, a
      // browser extension blocks the vendor script or a host is removed).
      host._owlApp = null;
      console.error("Impossible de monter le champ char OWL :", error);
    });
}

/**
 * Builds a DOM host and mounts an isolated OWL CharField inside it. Keeping
 * the host synchronous preserves the existing form compiler's API.
 */
export function renderCharField(
  name,
  info = {},
  node = null,
  initialValue,
  initialValues = null,
  fieldContext = null
) {
  const password = parseBoolean(node?.getAttribute("password"));
  const placeholder = node?.getAttribute("placeholder") || "";
  const charOptions = parseCharOptions(node?.getAttribute("options") || "");
  const readonlyAttr = node?.getAttribute("readonly");
  const requiredAttr = node?.getAttribute("required");

  const props = {
    id: `field-${name}`,
    name,
    label: info.label || name,
    value: toCharValue(initialValue),
    readonly: !!info.readonly || parseBoolean(readonlyAttr),
    required: !!info.required || parseBoolean(requiredAttr),
    maxLength: Number(info.size) || 0,
    // Odoo Char fields trim by default; explicit false in the server metadata
    // preserves fields declared with trim=False.
    trim: info.trim !== false,
    isPassword: password,
    autocomplete: node?.getAttribute("autocomplete") || "",
    placeholder,
    translatable: !!info.translate,
    dynamicPlaceholder: charOptions.dynamicPlaceholder,
    dynamicPlaceholderModelReferenceField: charOptions.dynamicPlaceholderModelReferenceField,
    modelName: fieldContext?._modelName || initialValues?.model || "",
    recordId: initialValues?.id ?? "",
    recordValues: initialValues || {},
    fieldsByModel: fieldContext?._allModels || {},
  };

  // Dynamic modifiers have a useful initial value before the first form input
  // causes the legacy relational model to re-evaluate them.
  if (readonlyAttr && !parseBoolean(readonlyAttr)) {
    props.readonly = props.readonly || evaluateSimpleCondition(readonlyAttr, initialValues) === true;
  }
  if (requiredAttr && !parseBoolean(requiredAttr)) {
    props.required = props.required || evaluateSimpleCondition(requiredAttr, initialValues) === true;
  }

  const host = document.createElement("div");
  host.className = "o_field_char_owl";
  host.style.display = "contents";
  host.dataset.owlCharField = "true";
  host.dataset.charTrim = props.trim ? "true" : "false";
  host.dataset.charPassword = props.isPassword ? "true" : "false";
  host._owlCharValue = props.value;
  host._owlPendingProps = {};
  activeCharHosts.add(host);

  const fallback = createFallbackInput(props);
  host._owlFallbackInput = fallback;
  host.appendChild(fallback);

  // A field can be edited during the brief asynchronous mount window. Keep
  // the fallback input and its pending value in sync until OWL takes over.
  fallback.addEventListener("input", () => {
    host._owlPendingProps = { ...(host._owlPendingProps || {}), value: fallback.value };
    host._owlCharValue = fallback.value;
  });
  fallback.addEventListener("change", () => {
    const value = props.trim && !props.isPassword ? fallback.value.trim() : fallback.value;
    fallback.value = value;
    host._owlPendingProps = { ...(host._owlPendingProps || {}), value };
    host._owlCharValue = value;
  });

  queueMicrotask(() => mountWhenConnected(host, props));
  return host;
}

const activeCharHosts = new Set();

/** Destroys OWL roots in a subtree (and detached field subtrees owned by a form). */
export function destroyCharFields(root = null) {
  for (const host of Array.from(activeCharHosts)) {
    const belongsToRoot = !root || root === host || root.contains?.(host);
    if (!belongsToRoot) continue;

    host._owlDestroyed = true;
    host._owlMountObserver?.disconnect();
    host._owlApp?.destroy();
    host._owlApp = null;
    host._owlComponent = null;
    activeCharHosts.delete(host);
  }
}
