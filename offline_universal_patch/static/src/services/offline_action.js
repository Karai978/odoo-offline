/** @odoo-module **/

const OFFLINE_ACTION_VIEWS = new Set(["list", "form", "kanban", "calendar"]);
const FALLBACK_VIEW_ORDER = ["list", "kanban", "calendar", "form"];

function normalizeViewType(viewType) {
    return viewType === "tree" ? "list" : viewType;
}

function cachedViewMatches(viewId, description) {
    return !viewId || (description?.id && Number(viewId) === Number(description.id));
}

function searchViewId(action) {
    const value = action.search_view_id;
    if (Array.isArray(value)) return value[0];
    if (value && typeof value === "object") return value.id;
    return value;
}

export function mergeOfflineNativeViews(defaultViews, actionViews) {
    const defaults = defaultViews || {};
    const action = actionViews || {};
    const models = {};
    for (const modelName of new Set([
        ...Object.keys(defaults.models || {}),
        ...Object.keys(action.models || {}),
    ])) {
        const defaultModel = defaults.models?.[modelName] || {};
        const actionModel = action.models?.[modelName] || {};
        models[modelName] = {
            ...defaultModel,
            ...actionModel,
            fields: { ...(defaultModel.fields || {}), ...(actionModel.fields || {}) },
        };
    }
    return {
        ...defaults,
        ...action,
        models,
        views: { ...(defaults.views || {}), ...(action.views || {}) },
    };
}

/** Replace unsupported or unavailable action views with the cached native view. */
export function makeOfflineActionCompatible(action, nativeViews) {
    const viewsByType = nativeViews?.views;
    if (!action?.res_model || !viewsByType) return action;

    const requestedViews = Array.isArray(action.views) && action.views.length
        ? action.views
        : String(action.view_mode || "").split(",").map((type) => [false, type.trim()]).filter(([, type]) => type);
    const compatibleViews = [];
    let droppedView = false;
    for (const entry of requestedViews) {
        if (!Array.isArray(entry) || entry.length < 2) {
            droppedView = true;
            continue;
        }
        const [viewId, requestedType] = entry;
        const viewType = normalizeViewType(requestedType);
        const description = viewsByType[viewType];
        if (!OFFLINE_ACTION_VIEWS.has(viewType) || !description || !cachedViewMatches(viewId, description)) {
            droppedView = true;
            continue;
        }
        compatibleViews.push([viewId || false, viewType]);
    }

    const result = { ...action };
    if (droppedView && result.context && typeof result.context === "object" && !Array.isArray(result.context)) {
        result.context = { ...result.context };
        delete result.context.group_by;
    }
    if (compatibleViews.length) {
        result.views = compatibleViews;
        result.view_mode = [...new Set(compatibleViews.map(([, type]) => type))].join(",");
    } else {
        const fallbackOrder = action.target === "new"
            ? ["form", ...FALLBACK_VIEW_ORDER.filter((type) => type !== "form")]
            : FALLBACK_VIEW_ORDER;
        const fallbackType = fallbackOrder.find((type) => viewsByType[type]);
        if (!fallbackType) return action;
        result.views = [[false, fallbackType]];
        result.view_mode = fallbackType;
        // Pivot/graph contexts can request grouped reads that the local ORM
        // cannot reproduce. A plain cached view is safer than false totals.
        if (result.context && typeof result.context === "object" && !Array.isArray(result.context)) {
            result.context = { ...result.context };
            delete result.context.group_by;
        }
    }

    const requestedSearchViewId = searchViewId(action);
    const cachedSearchView = viewsByType.search;
    if (requestedSearchViewId && !cachedViewMatches(requestedSearchViewId, cachedSearchView)) {
        result.search_view_id = false;
    }
    return result;
}
