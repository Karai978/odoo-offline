/**
 * views/list/list_column_prefs.js
* Local persistence of
 * optional columns shown/hidden, per model.
 */

function getOptionalColumnsStorageKey(modelName) {
  return `pwa_optional_columns:${modelName || "unknown_model"}`;
}

export function loadOptionalColumnsState(modelName, optionalFields) {
  const key = getOptionalColumnsStorageKey(modelName);
  let saved = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) saved = JSON.parse(raw);
  } catch (err) {
    console.warn("Préférences de colonnes illisibles, réinitialisation:", err);
  }

  const state = {};
  optionalFields.forEach(({ field, defaultVisible }) => {
    state[field] = saved && Object.prototype.hasOwnProperty.call(saved, field)
      ? !!saved[field]
      : defaultVisible;
  });
  return state;
}

export function saveOptionalColumnsState(modelName, state) {
  const key = getOptionalColumnsStorageKey(modelName);
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    console.warn("Impossible de sauvegarder les préférences de colonnes:", err);
  }
}
