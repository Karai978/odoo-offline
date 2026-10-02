/** @odoo-module **/

import { getOfflineMethod } from "../capabilities/registry";
import { domainMatches, sortRecords } from "../query/domain";

export class OfflineUnsupportedError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "OfflineUnsupportedError";
        this.details = details;
    }
}

function asIds(value) {
    if (Array.isArray(value)) return value;
    if (value === false || value === null || value === undefined) return [];
    return [value];
}

function isCommandList(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) =>
        Array.isArray(item) && item.length >= 2 && Number.isInteger(item[0]) && item[0] >= 0 && item[0] <= 6
    );
}

function simpleDisplayName(record, id) {
    return record?.display_name || record?.name || record?.complete_name || record?.code || String(id);
}

const TAX_TOTALS_TARGETS = {
    "account.move": { model: "account.move" },
    "purchase.order": { model: "purchase.order" },
    "sale.order": { model: "sale.order" },
    "account.move.line": { model: "account.move", parentField: "move_id" },
    "purchase.order.line": { model: "purchase.order", parentField: "order_id" },
    "sale.order.line": { model: "sale.order", parentField: "order_id" },
};

function many2oneId(value) {
    const id = Array.isArray(value) ? value[0] : value;
    return Number.isInteger(id) ? id : null;
}

function safeSlice(records, offset = 0, limit = undefined) {
    const start = Math.max(0, Number(offset) || 0);
    const end = limit === undefined || limit === null ? undefined : start + Math.max(0, Number(limit) || 0);
    return records.slice(start, end);
}

function respectsActiveTest(record, manifest, kwargs) {
    const activeField = manifest?.active_field || "active";
    return kwargs?.context?.active_test === false || !manifest?.fields?.[activeField] || record[activeField] !== false;
}

export class OfflineOrmEngine {
    constructor({ database, user, runtime }) {
        this.database = database;
        this.user = user;
        this.runtime = runtime;
    }

    async call(model, method, args = [], kwargs = {}, operationUuid = null) {
        const params = { model, method, args, kwargs };
        switch (method) {
            case "read": return this.read(model, args[0] || [], args[1] || [], kwargs);
            case "web_read": return this.webRead(model, args[0] || [], kwargs);
            case "search": return this.search(model, args[0] || kwargs.domain || [], kwargs);
            case "search_read": return this.searchRead(model, args[0] || kwargs.domain || [], kwargs);
            case "web_search_read": return this.webSearchRead(model, kwargs);
            case "read_group": return this.readGroup(model, kwargs, false);
            case "web_read_group": return this.readGroup(model, kwargs, true);
            case "read_progress_bar": return this.readProgressBar(model, kwargs);
            case "search_count": return (await this.search(model, args[0] || kwargs.domain || [], { ...kwargs, limit: undefined })).length;
            case "name_get": return this.nameGet(model, args[0] || []);
            case "name_search": return this.nameSearch(model, args, kwargs);
            case "fields_get": return this.fieldsGet(model, args, kwargs);
            case "get_views": return this.getViews(model, kwargs);
            case "check_access_rights": return this.checkAccess(model, args[0]);
            case "create": return this.create(model, args[0], kwargs, operationUuid, args);
            case "write": return this.write(model, args[0], args[1] || {}, kwargs, operationUuid);
            case "unlink": return this.unlink(model, args[0], kwargs, operationUuid);
            case "web_save": return this.webSave(model, args, kwargs, operationUuid);
            case "action_archive": return this.setActive(model, args[0], false, args, kwargs, operationUuid);
            case "action_unarchive": return this.setActive(model, args[0], true, args, kwargs, operationUuid);
            case "resequence": return this.resequence(model, args, kwargs, operationUuid);
            default:
                return this.runCapability(model, method, args, kwargs, operationUuid, params);
        }
    }

    async getAll(model) {
        return this.database.getRecords(model);
    }

    async getOne(model, id) {
        return this.database.getRecord(model, id);
    }

    async read(model, ids, fields, kwargs = {}) {
        const records = [];
        const metadata = await this.database.getManifest(model);
        for (const id of ids) {
            const record = await this.getOne(model, id);
            if (!record) throw new OfflineUnsupportedError(`L'enregistrement ${model}(${id}) n'est pas dans le cache offline.`);
            const selected = fields.length ? fields : Object.keys(record);
            const values = {};
            for (const fieldName of selected) {
                if (!(fieldName in record)) continue;
                const value = record[fieldName];
                const fieldInfo = metadata?.fields?.[fieldName];
                if (kwargs.load !== null && kwargs.load !== false && fieldInfo?.type === "many2one" && Number.isInteger(value) && value) {
                    const related = await this.getOne(fieldInfo.relation, value);
                    values[fieldName] = [value, simpleDisplayName(related, value)];
                } else {
                    values[fieldName] = value;
                }
            }
            values.id = record.id;
            records.push(values);
        }
        return records;
    }

    async webRead(model, ids, kwargs = {}) {
        const specification = kwargs.specification || {};
        const records = [];
        for (const id of ids) {
            const record = await this.getOne(model, id);
            if (!record) throw new OfflineUnsupportedError(`L'enregistrement ${model}(${id}) n'est pas dans le cache offline.`);
            records.push(await this.shapeWebRecord(model, record, specification, 0));
        }
        return records;
    }

    async shapeWebRecord(model, record, specification, depth) {
        if (depth > 6) return { id: record.id };
        const result = { id: record.id };
        const fields = Object.keys(specification || {});
        if (!fields.length) return result;
        const modelManifest = await this.database.getManifest(model);
        for (const fieldName of fields) {
            if (fieldName === "id") continue;
            if (!(fieldName in record)) continue;
            const value = record[fieldName];
            const info = modelManifest?.fields?.[fieldName] || {};
            const spec = specification[fieldName] || {};
            if (info.type === "many2one" && spec.fields && value) {
                const id = Array.isArray(value) ? value[0] : value;
                const related = await this.getOne(info.relation, id);
                result[fieldName] = related
                    ? await this.shapeWebRecord(info.relation, related, spec.fields, depth + 1)
                    : false;
            } else if ((info.type === "one2many" || info.type === "many2many") && spec.fields && Array.isArray(value)) {
                const ids = spec.limit ? value.slice(0, spec.limit) : value;
                const children = [];
                for (const id of ids) {
                    const related = await this.getOne(info.relation, id);
                    children.push(related
                        ? await this.shapeWebRecord(info.relation, related, spec.fields, depth + 1)
                        : { id });
                }
                result[fieldName] = children;
            } else {
                result[fieldName] = value;
            }
        }
        return result;
    }

    async search(model, domain = [], kwargs = {}) {
        const manifest = await this.database.getManifest(model);
        const records = await this.getAll(model);
        const filtered = records.filter((record) => respectsActiveTest(record, manifest, kwargs) && domainMatches(record, domain));
        return safeSlice(sortRecords(filtered, kwargs.order), kwargs.offset, kwargs.limit).map((record) => record.id);
    }

    async searchRead(model, domain = [], kwargs = {}) {
        const ids = await this.search(model, domain, kwargs);
        return this.read(model, ids, kwargs.fields || [], kwargs);
    }

    async webSearchRead(model, kwargs = {}) {
        const domain = kwargs.domain || [];
        const allIds = await this.search(model, domain, { order: kwargs.order });
        const pageIds = safeSlice(allIds, kwargs.offset, kwargs.limit);
        const records = await this.webRead(model, pageIds, { specification: kwargs.specification || {} });
        const countLimit = kwargs.count_limit;
        const length = countLimit ? Math.min(allIds.length, countLimit) : allIds.length;
        return { length, records };
    }

    async readGroup(model, kwargs = {}, webShape = false) {
        const domain = kwargs.domain || [];
        const fields = kwargs.fields || [];
        const requestedGroupBy = kwargs.groupby || [];
        const groupBy = kwargs.lazy === false ? requestedGroupBy : requestedGroupBy.slice(0, 1);
        const manifest = await this.database.getManifest(model);
        const fieldInfo = manifest?.fields || {};
        const normalizedGroupBy = groupBy.map((spec) => {
            const [field, interval] = String(spec).split(":");
            const info = fieldInfo[field];
            if (!info) throw new OfflineUnsupportedError(`Métadonnées de regroupement absentes pour ${model}.${field}.`);
            if (interval || ["date", "datetime", "many2many"].includes(info.type)) {
                throw new OfflineUnsupportedError(`Le regroupement ${spec} n'est pas pris en charge hors ligne.`);
            }
            return { spec, field, info };
        });
        const candidates = (await this.getAll(model)).filter((record) => respectsActiveTest(record, manifest, kwargs) && domainMatches(record, domain));
        const grouped = new Map();
        for (const record of candidates) {
            const keyValues = normalizedGroupBy.map(({ field }) => {
                const value = record[field];
                return Array.isArray(value) && value.length === 2 ? value[0] : value;
            });
            const key = JSON.stringify(keyValues);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(record);
        }
        const groups = [];
        for (const [key, records] of grouped) {
            const keyValues = JSON.parse(key);
            const group = { __domain: [...domain], __count: records.length };
            if (kwargs.lazy !== false && requestedGroupBy.length > 1) {
                group.__context = { group_by: requestedGroupBy.slice(1) };
            }
            for (let index = 0; index < normalizedGroupBy.length; index++) {
                const { spec, field, info } = normalizedGroupBy[index];
                const value = keyValues[index] ?? false;
                let displayValue = value;
                if (info.type === "many2one" && value) {
                    const related = await this.getOne(info.relation, value);
                    displayValue = [value, simpleDisplayName(related, value)];
                }
                group[spec] = displayValue;
                group.__domain.push([field, "=", value]);
            }
            const groupFields = new Set(normalizedGroupBy.map(({ field }) => field));
            for (const fieldSpec of fields) {
                const [field, aggregate = ""] = String(fieldSpec).split(":");
                if (!field || groupFields.has(field) || !aggregate) continue;
                const numbers = records.map((record) => record[field]).filter((value) => typeof value === "number");
                if (aggregate === "sum") group[field] = numbers.reduce((total, value) => total + value, 0);
                else if (aggregate === "avg") group[field] = numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : 0;
                else if (aggregate === "min") group[field] = numbers.length ? Math.min(...numbers) : false;
                else if (aggregate === "max") group[field] = numbers.length ? Math.max(...numbers) : false;
                else if (aggregate === "count") group[field] = records.filter((record) => record[field] !== false && record[field] != null).length;
                else if (aggregate === "count_distinct") group[field] = new Set(records.map((record) => record[field])).size;
                else throw new OfflineUnsupportedError(`L'agrégat ${aggregate} n'est pas pris en charge hors ligne.`);
            }
            groups.push(group);
        }
        const ordered = sortRecords(groups, kwargs.orderby || kwargs.order || normalizedGroupBy.map(({ field }) => `${field} asc`).join(", "));
        const page = safeSlice(ordered, kwargs.offset, kwargs.limit);
        if (!webShape) return page;
        return { groups: page, length: ordered.length };
    }

    async readProgressBar(model, kwargs = {}) {
        const groupSpec = kwargs.group_by;
        const progress = kwargs.progress_bar || {};
        const field = progress.field;
        if (!groupSpec || !field) return {};
        const result = {};
        const manifest = await this.database.getManifest(model);
        const records = (await this.getAll(model)).filter((record) => respectsActiveTest(record, manifest, kwargs) && domainMatches(record, kwargs.domain || []));
        const groupField = String(groupSpec).split(":")[0];
        const groupInfo = manifest?.fields?.[groupField];
        for (const record of records) {
            const rawGroup = record[groupField];
            const groupId = Array.isArray(rawGroup) ? rawGroup[0] : rawGroup;
            let groupValue = Array.isArray(rawGroup) && rawGroup.length === 2 ? rawGroup[1] : rawGroup;
            if (groupInfo?.type === "many2one" && groupId) {
                const related = await this.getOne(groupInfo.relation, groupId);
                groupValue = simpleDisplayName(related, groupId);
            }
            const key = String(groupValue === false || groupValue == null ? "False" : groupValue);
            const value = record[field];
            if (!result[key]) result[key] = Object.fromEntries(Object.keys(progress.colors || {}).map((color) => [color, 0]));
            if (Object.prototype.hasOwnProperty.call(result[key], value)) result[key][value]++;
        }
        return result;
    }

    async nameGet(model, ids) {
        const result = [];
        for (const id of ids) {
            const record = await this.getOne(model, id);
            if (record) result.push([id, simpleDisplayName(record, id)]);
        }
        return result;
    }

    async nameSearch(model, args = [], kwargs = {}) {
        const name = String(kwargs.name ?? args[0] ?? "").toLowerCase();
        const domain = kwargs.args ?? args[1] ?? [];
        const operator = kwargs.operator ?? args[2] ?? "ilike";
        const limit = kwargs.limit ?? args[3] ?? 100;
        const manifest = await this.database.getManifest(model);
        const all = await this.getAll(model);
        const results = all.filter((record) => {
            if (!respectsActiveTest(record, manifest, kwargs) || !domainMatches(record, domain)) return false;
            if (!name) return true;
            const label = simpleDisplayName(record, record.id).toLowerCase();
            return operator === "=" ? label === name : label.includes(name);
        });
        return sortRecords(results, "display_name asc, name asc").slice(0, limit).map((record) => [record.id, simpleDisplayName(record, record.id)]);
    }

    async fieldsGet(model, args = [], kwargs = {}) {
        const manifest = await this.database.getManifest(model);
        if (!manifest) throw new OfflineUnsupportedError(`Métadonnées absentes pour ${model}.`);
        const allFields = manifest.fields || {};
        const requested = args[0] || kwargs.allfields;
        const attrs = args[1] || kwargs.attributes;
        const result = {};
        for (const [name, info] of Object.entries(allFields)) {
            if (requested?.length && !requested.includes(name)) continue;
            if (Array.isArray(attrs)) {
                result[name] = Object.fromEntries(attrs.filter((attr) => attr in info).map((attr) => [attr, info[attr]]));
            } else {
                result[name] = info;
            }
        }
        return result;
    }

    async getViews(model, kwargs = {}) {
        const actionId = kwargs.options?.action_id || null;
        const manifest = await this.database.getManifest(model, actionId);
        const native = manifest?.native_views;
        if (!native?.models || !native?.views) {
            throw new OfflineUnsupportedError(`Vues natives non préchargées pour ${model}.`);
        }
        const requested = kwargs.views || [];
        const views = {};
        for (const [viewId, requestedType] of requested) {
            const viewType = requestedType === "tree" ? "list" : requestedType;
            if (!["list", "form", "kanban", "search", "calendar"].includes(viewType)) {
                throw new OfflineUnsupportedError(`La vue ${viewType} de ${model} n'est pas prise en charge hors ligne.`);
            }
            const description = native.views[viewType];
            if (!description) {
                throw new OfflineUnsupportedError(`La vue ${viewType} de ${model} n'est pas préchargée.`);
            }
            if (viewId && Number(viewId) !== Number(description.id)) {
                throw new OfflineUnsupportedError(`La vue personnalisée ${viewId} de ${model} n'est pas préchargée.`);
            }
            views[viewType] = description;
        }
        return { models: native.models, views };
    }

    async checkAccess(model, operation) {
        const manifest = await this.database.getManifest(model);
        return !!manifest?.access?.[operation];
    }

    async invalidateTaxTotals(model, ids, values = {}) {
        const target = TAX_TOTALS_TARGETS[model];
        if (!target) return;
        const parentManifest = await this.database.getManifest(target.model);
        if (!parentManifest?.fields?.tax_totals) return;

        const targetIds = new Set();
        for (const id of asIds(ids)) {
            if (!target.parentField) {
                if (Number.isInteger(id)) targetIds.add(id);
                continue;
            }
            const record = await this.getOne(model, id);
            const previousParentId = many2oneId(record?.[target.parentField]);
            const nextParentId = many2oneId(values?.[target.parentField]);
            if (previousParentId !== null) targetIds.add(previousParentId);
            if (nextParentId !== null) targetIds.add(nextParentId);
        }

        for (const id of targetIds) {
            const record = await this.getOne(target.model, id);
            if (!record || record.tax_totals === null) continue;
            await this.database.putRecord(target.model, { ...record, tax_totals: null }, { local: id < 0 });
        }
    }

    async create(model, values, kwargs = {}, operationUuid = null, originalArgs = null) {
        const list = Array.isArray(values) ? values : [values || {}];
        if (!(await this.checkAccess(model, "create"))) {
            throw new OfflineUnsupportedError(`Création offline refusée pour ${model} selon les droits mis en cache.`);
        }
        const ids = [];
        for (const vals of list) {
            const id = await this.database.nextLocalId();
            const record = { ...vals, id };
            await this.applyValues(model, record, vals);
            await this.database.putRecord(model, record, { local: true });
            ids.push(id);
        }
        await this.invalidateTaxTotals(model, ids);
        await this.database.enqueue({
            operation_uuid: operationUuid || undefined,
            model,
            method: "create",
            args: originalArgs || [list],
            kwargs,
            local_ids: ids,
        });
        return ids.length === 1 ? ids[0] : ids;
    }

    async write(model, ids, values, kwargs = {}, operationUuid = null) {
        const recordIds = asIds(ids);
        if (!(await this.checkAccess(model, "write"))) {
            throw new OfflineUnsupportedError(`Modification offline refusée pour ${model} selon les droits mis en cache.`);
        }
        const expectedWriteDates = await this.expectedWriteDates(model, recordIds);
        await this.invalidateTaxTotals(model, recordIds, values);
        for (const id of recordIds) {
            const record = await this.getOne(model, id);
            if (!record) throw new OfflineUnsupportedError(`La fiche ${model}(${id}) n'est pas en cache.`);
            const updated = { ...record };
            await this.applyValues(model, updated, values);
            updated.write_date = new Date().toISOString();
            await this.database.putRecord(model, updated, { local: id < 0 });
        }
        await this.invalidateTaxTotals(model, recordIds, values);
        await this.database.enqueue({
            operation_uuid: operationUuid || undefined,
            model,
            method: "write",
            args: [recordIds, values],
            kwargs,
            expected_write_dates: expectedWriteDates,
        });
        return true;
    }

    async unlink(model, ids, kwargs = {}, operationUuid = null) {
        const recordIds = asIds(ids);
        if (!(await this.checkAccess(model, "unlink"))) {
            throw new OfflineUnsupportedError(`Suppression offline refusée pour ${model} selon les droits mis en cache.`);
        }
        const expectedWriteDates = await this.expectedWriteDates(model, recordIds);
        await this.invalidateTaxTotals(model, recordIds);
        for (const id of recordIds) await this.database.deleteRecord(model, id);
        await this.database.enqueue({
            operation_uuid: operationUuid || undefined,
            model,
            method: "unlink",
            args: [recordIds],
            kwargs,
            expected_write_dates: expectedWriteDates,
        });
        return true;
    }

    async webSave(model, args, kwargs = {}, operationUuid = null) {
        const ids = asIds(args[0]);
        const values = args[1] || {};
        const specification = kwargs.specification || {};
        if (ids.length) {
            if (!(await this.checkAccess(model, "write"))) {
                throw new OfflineUnsupportedError(`Modification offline refusée pour ${model} selon les droits mis en cache.`);
            }
            const expectedWriteDates = await this.expectedWriteDates(model, ids);
            await this.invalidateTaxTotals(model, ids, values);
            for (const id of ids) {
                const record = await this.getOne(model, id);
                if (!record) throw new OfflineUnsupportedError(`La fiche ${model}(${id}) n'est pas en cache.`);
                const updated = { ...record };
                await this.applyValues(model, updated, values);
                updated.write_date = new Date().toISOString();
                await this.database.putRecord(model, updated, { local: id < 0 });
            }
            await this.invalidateTaxTotals(model, ids, values);
            await this.database.enqueue({
                operation_uuid: operationUuid || undefined,
                model,
                method: "web_save",
                args: [ids, values],
                kwargs,
                expected_write_dates: expectedWriteDates,
            });
            return this.webRead(model, ids, { specification });
        }

        if (!(await this.checkAccess(model, "create"))) {
            throw new OfflineUnsupportedError(`Création offline refusée pour ${model} selon les droits mis en cache.`);
        }
        const localId = await this.database.nextLocalId();
        const record = { ...values, id: localId };
        await this.applyValues(model, record, values);
        await this.database.putRecord(model, record, { local: true });
        await this.invalidateTaxTotals(model, [localId], values);
        await this.database.enqueue({
            operation_uuid: operationUuid || undefined,
            model,
            method: "web_save",
            args: [[], values],
            kwargs,
            local_ids: [localId],
        });
        return this.webRead(model, [localId], { specification });
    }

    async resequence(model, args, kwargs = {}, operationUuid = null) {
        const ids = asIds(args[0]);
        const fieldName = kwargs.field || "sequence";
        if (!(await this.checkAccess(model, "write"))) {
            throw new OfflineUnsupportedError(`Réorganisation offline refusée pour ${model}.`);
        }
        const expectedWriteDates = await this.expectedWriteDates(model, ids);
        const offset = Number(kwargs.offset || 0);
        for (let index = 0; index < ids.length; index++) {
            const record = await this.getOne(model, ids[index]);
            if (!record) throw new OfflineUnsupportedError(`La fiche ${model}(${ids[index]}) n'est pas en cache.`);
            record[fieldName] = index + offset;
            await this.database.putRecord(model, record, { local: ids[index] < 0 });
        }
        await this.database.enqueue({
            operation_uuid: operationUuid || undefined,
            model,
            method: "resequence",
            args: [ids],
            kwargs: { ...kwargs, field: fieldName, offset },
            expected_write_dates: expectedWriteDates,
        });
        return true;
    }

    async setActive(model, ids, active, originalArgs, kwargs, operationUuid) {
        if (!(await this.checkAccess(model, "write"))) {
            throw new OfflineUnsupportedError(`Modification offline refusée pour ${model}.`);
        }
        const recordIds = asIds(ids);
        const expectedWriteDates = await this.expectedWriteDates(model, recordIds);
        for (const id of recordIds) {
            const record = await this.getOne(model, id);
            if (!record) throw new OfflineUnsupportedError(`La fiche ${model}(${id}) n'est pas en cache.`);
            record.active = active;
            record.write_date = new Date().toISOString();
            await this.database.putRecord(model, record, { local: id < 0 });
        }
        await this.database.enqueue({
            operation_uuid: operationUuid || undefined,
            model,
            method: active ? "action_unarchive" : "action_archive",
            args: originalArgs,
            kwargs,
            expected_write_dates: expectedWriteDates,
        });
        return true;
    }

    async expectedWriteDates(model, ids) {
        const pending = await this.database.listOutbox("pending");
        const previouslyChanged = new Set();
        for (const operation of pending) {
            if (operation.model !== model || !["write", "unlink", "web_save"].includes(operation.method)) continue;
            const operationIds = asIds(operation.args?.[0]);
            for (const id of operationIds) previouslyChanged.add(id);
        }
        const expected = {};
        for (const id of ids) {
            if (id < 0 || previouslyChanged.has(id)) continue;
            const record = await this.getOne(model, id);
            if (record?.write_date) expected[id] = record.write_date;
        }
        return expected;
    }

    async applyValues(model, record, values) {
        const manifest = await this.database.getManifest(model);
        for (const [fieldName, value] of Object.entries(values || {})) {
            const info = manifest?.fields?.[fieldName];
            if (info && ["one2many", "many2many"].includes(info.type) && isCommandList(value)) {
                record[fieldName] = await this.applyRelationalCommands(info.relation, record[fieldName] || [], value);
            } else {
                record[fieldName] = value;
            }
        }
    }

    async applyRelationalCommands(comodel, currentIds, commands) {
        let ids = [...(Array.isArray(currentIds) ? currentIds : [])];
        for (const [operation, recordId, payload] of commands) {
            const id = Number(recordId);
            if (operation === 0) {
                const localId = await this.database.nextLocalId();
                const data = { ...(payload || {}), id: localId };
                await this.database.putRecord(comodel, data, { local: true });
                ids.push(localId);
            } else if (operation === 1) {
                const existing = await this.getOne(comodel, id);
                if (existing) await this.database.putRecord(comodel, { ...existing, ...(payload || {}) }, { local: id < 0 });
            } else if (operation === 2) {
                ids = ids.filter((item) => item !== id);
                await this.database.deleteRecord(comodel, id);
            } else if (operation === 3) {
                ids = ids.filter((item) => item !== id);
            } else if (operation === 4) {
                if (!ids.includes(id)) ids.push(id);
            } else if (operation === 5) {
                ids = [];
            } else if (operation === 6) {
                ids = Array.isArray(payload) ? [...payload] : [];
            }
        }
        return ids;
    }

    async runCapability(model, method, args, kwargs, operationUuid, params) {
        const capability = getOfflineMethod(model, method);
        if (!capability) {
            throw new OfflineUnsupportedError(`La méthode métier ${model}.${method} n'a pas d'implémentation locale.` , params);
        }
        const operation = {
            operation_uuid: operationUuid || undefined,
            model,
            method,
            args,
            kwargs,
        };
        const outcome = await capability.handler({
            model,
            method,
            args,
            kwargs,
            database: this.database,
            user: this.user,
            operation,
            getRecord: (resModel, id) => this.getOne(resModel, id),
            getRecords: (resModel) => this.getAll(resModel),
        });
        if (!outcome || !Array.isArray(outcome.mutations)) {
            throw new Error(`L'exécuteur ${model}.${method} doit retourner {result, mutations: []}.`);
        }
        for (const mutation of outcome.mutations) {
            await this.invalidateTaxTotals(mutation.model, [mutation.id], mutation.values || {});
            if (mutation.operation === "delete") {
                await this.database.deleteRecord(mutation.model, mutation.id);
            } else {
                const current = await this.getOne(mutation.model, mutation.id) || { id: mutation.id };
                await this.database.putRecord(mutation.model, { ...current, ...(mutation.values || {}) }, { local: mutation.id < 0 });
            }
        }
        await this.database.enqueue({
            ...operation,
            expected_write_dates: outcome.expected_write_dates || {},
        });
        return outcome.result === undefined ? false : outcome.result;
    }

    async mirrorOnlineResult(model, method, args = [], result) {
        if (method === "web_save" && Array.isArray(result)) {
            await this.database.putRecords(model, result);
            return;
        }
        if (method === "create") {
            const values = Array.isArray(args[0]) ? args[0] : [args[0] || {}];
            const resultIds = Array.isArray(result) ? result : [result];
            for (let index = 0; index < values.length; index++) {
                const id = resultIds[index];
                if (Number.isInteger(id)) await this.database.putRecord(model, { ...values[index], id });
            }
            await this.invalidateTaxTotals(model, resultIds);
            return;
        }
        if (method === "write") {
            const ids = asIds(args[0]);
            const values = args[1] || {};
            await this.invalidateTaxTotals(model, ids, values);
            for (const id of ids) {
                const current = await this.getOne(model, id);
                if (!current) continue;
                const updated = { ...current };
                await this.applyValues(model, updated, values);
                await this.database.putRecord(model, updated);
            }
            await this.invalidateTaxTotals(model, ids, values);
            return;
        }
        if (method === "unlink") {
            const ids = asIds(args[0]);
            await this.invalidateTaxTotals(model, ids);
            for (const id of ids) await this.database.deleteRecord(model, id);
            return;
        }
        if (method === "action_archive" || method === "action_unarchive") {
            for (const id of asIds(args[0])) {
                const current = await this.getOne(model, id);
                if (current) await this.database.putRecord(model, { ...current, active: method === "action_unarchive" });
            }
        }
    }

    async localButton(model, method, args, kwargs, operationUuid = null) {
        return this.runCapability(model, method, args, kwargs, operationUuid, { route: "/web/dataset/call_button" });
    }
}
