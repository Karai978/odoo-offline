/** @odoo-module **/

export class UnsupportedOfflineDomainError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnsupportedOfflineDomainError";
    }
}

function isMany2oneValue(value) {
    return Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]) && typeof value[1] === "string";
}

function valueAt(record, fieldName) {
    const parts = String(fieldName).split(".");
    let value = record;
    for (let index = 0; index < parts.length; index++) {
        if (isMany2oneValue(value)) value = value[0];
        if (index > 0 && (value === null || value === undefined || typeof value !== "object")) {
            throw new UnsupportedOfflineDomainError(`Dotted relation domain '${fieldName}' needs a model-specific offline capability.`);
        }
        value = value?.[parts[index]];
    }
    return isMany2oneValue(value) ? value[0] : value;
}

function normalizeComparable(value) {
    if (value === false || value === null || value === undefined) return null;
    if (isMany2oneValue(value)) return value[0];
    return value;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likeRegex(pattern, insensitive) {
    const escaped = escapeRegex(pattern).replaceAll("%", ".*").replaceAll("_", ".");
    return new RegExp(`^${escaped}$`, insensitive ? "i" : "");
}

function compareLeaf(record, leaf) {
    if (!Array.isArray(leaf) || leaf.length < 3) {
        throw new UnsupportedOfflineDomainError(`Invalid domain leaf: ${JSON.stringify(leaf)}`);
    }
    const [field, operator, expected] = leaf;
    if (typeof field !== "string") {
        throw new UnsupportedOfflineDomainError("Offline domain fields must be strings.");
    }
    const actual = normalizeComparable(valueAt(record, field));
    const target = normalizeComparable(expected);

    switch (operator) {
        case "=?":
            return target === null || actual === target;
        case "=":
            return actual === target;
        case "!=":
            return actual !== target;
        case "in": {
            if (!Array.isArray(expected)) throw new UnsupportedOfflineDomainError("The 'in' operator needs an array.");
            const candidates = expected.map(normalizeComparable);
            return Array.isArray(actual)
                ? actual.some((item) => candidates.includes(normalizeComparable(item)))
                : candidates.includes(actual);
        }
        case "not in": {
            if (!Array.isArray(expected)) throw new UnsupportedOfflineDomainError("The 'not in' operator needs an array.");
            const candidates = expected.map(normalizeComparable);
            return Array.isArray(actual)
                ? !actual.some((item) => candidates.includes(normalizeComparable(item)))
                : !candidates.includes(actual);
        }
        case "<": return actual !== null && actual < target;
        case "<=": return actual !== null && actual <= target;
        case ">": return actual !== null && actual > target;
        case ">=": return actual !== null && actual >= target;
        case "like": return actual != null && likeRegex(`%${expected}%`, false).test(String(actual));
        case "ilike": return actual != null && likeRegex(`%${expected}%`, true).test(String(actual));
        case "not like": return actual == null || !likeRegex(`%${expected}%`, false).test(String(actual));
        case "not ilike": return actual == null || !likeRegex(`%${expected}%`, true).test(String(actual));
        case "=like": return actual != null && likeRegex(expected, false).test(String(actual));
        case "=ilike": return actual != null && likeRegex(expected, true).test(String(actual));
        case "child_of":
        case "parent_of":
            throw new UnsupportedOfflineDomainError(`The '${operator}' hierarchy operator needs a model-specific offline capability.`);
        default:
            throw new UnsupportedOfflineDomainError(`The '${operator}' domain operator is not supported offline.`);
    }
}

function parseExpression(domain, index, record) {
    if (index >= domain.length) {
        throw new UnsupportedOfflineDomainError("Unexpected end of Odoo domain.");
    }
    const token = domain[index];
    if (token === "!") {
        const child = parseExpression(domain, index + 1, record);
        return { value: !child.value, next: child.next };
    }
    if (token === "&" || token === "|") {
        const left = parseExpression(domain, index + 1, record);
        const right = parseExpression(domain, left.next, record);
        return {
            value: token === "&" ? left.value && right.value : left.value || right.value,
            next: right.next,
        };
    }
    if (Array.isArray(token) && token.length === 3 && !Array.isArray(token[0])) {
        return { value: compareLeaf(record, token), next: index + 1 };
    }
    if (Array.isArray(token)) {
        return { value: domainMatches(record, token), next: index + 1 };
    }
    throw new UnsupportedOfflineDomainError(`Unsupported Odoo domain token: ${String(token)}`);
}

export function domainMatches(record, domain = []) {
    if (!Array.isArray(domain) || !domain.length) return true;
    let index = 0;
    let result = true;
    while (index < domain.length) {
        const expression = parseExpression(domain, index, record);
        result = result && expression.value;
        index = expression.next;
    }
    return result;
}

function sortValue(value) {
    if (isMany2oneValue(value)) return value[1];
    if (Array.isArray(value)) return value.length ? value[0] : null;
    if (value === false || value === null || value === undefined) return null;
    return value;
}

export function sortRecords(records, order) {
    const clauses = String(order || "id asc")
        .split(",")
        .map((part) => part.trim().split(/\s+/))
        .filter(([field]) => field)
        .map(([field, direction]) => ({ field, descending: String(direction || "asc").toLowerCase() === "desc" }));
    return [...records].sort((left, right) => {
        for (const clause of clauses) {
            const a = sortValue(valueAt(left, clause.field));
            const b = sortValue(valueAt(right, clause.field));
            if (a === b) continue;
            if (a === null) return clause.descending ? -1 : 1;
            if (b === null) return clause.descending ? 1 : -1;
            const comparison = a < b ? -1 : 1;
            return clause.descending ? -comparison : comparison;
        }
        return 0;
    });
}

export function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
}
