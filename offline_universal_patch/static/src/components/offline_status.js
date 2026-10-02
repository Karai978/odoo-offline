/** @odoo-module **/

import { Component, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useBus, useService } from "@web/core/utils/hooks";

export class OfflineUniversalStatus extends Component {
    setup() {
        this.offline = useService("offline_universal");
        this.state = useState({
            online: navigator.onLine,
            ready: false,
            busy: false,
            pending: 0,
            conflicts: 0,
            errors: 0,
            message: "",
        });
        this.refresh();
        this._onOnline = () => {
            this.state.online = true;
            this.refresh();
        };
        this._onOffline = () => {
            this.state.online = false;
            this.refresh();
        };
        window.addEventListener("online", this._onOnline);
        window.addEventListener("offline", this._onOffline);
        useBus(this.env.bus, "OFFLINE_UNIVERSAL:PROGRESS", (event) => {
            this.state.message = event.detail?.message || "Préparation offline…";
            this.state.busy = ["bootstrap", "metadata", "snapshot", "service_worker"].includes(event.detail?.phase);
            if (event.detail?.phase === "ready") {
                this.state.ready = true;
                this.state.busy = false;
            }
            if (event.detail?.phase === "failed") this.state.busy = false;
        });
        useBus(this.env.bus, "OFFLINE_UNIVERSAL:SYNCED", () => this.refresh());
        useBus(this.env.bus, "OFFLINE_UNIVERSAL:CONNECTIVITY", (event) => {
            this.state.online = !!event.detail?.online;
            this.refresh();
        });
        onWillUnmount(() => {
            window.removeEventListener("online", this._onOnline);
            window.removeEventListener("offline", this._onOffline);
        });
    }

    get label() {
        if (this.state.busy) return "Préparation…";
        if (!this.state.online) return this.state.ready ? "Hors ligne" : "Hors ligne — non préparé";
        if (!this.state.ready) return "Préparer offline";
        if (this.state.errors || this.state.conflicts) return "Synchronisation à vérifier";
        return "Cache hors ligne prêt";
    }

    async refresh() {
        try {
            const summary = await this.offline.getSummary();
            this.state.ready = summary.ready;
            this.state.pending = summary.pending;
            this.state.conflicts = summary.conflict;
            this.state.errors = summary.error;
        } catch (error) {
            this.state.message = error.message;
        }
    }

    async onClick() {
        if (this.state.busy) return;
        this.state.busy = true;
        this.state.message = "";
        try {
            if (!this.state.ready) {
                await this.offline.prepare();
            } else {
                await this.offline.sync();
            }
            await this.refresh();
            this.state.message = "Opération terminée.";
        } catch (error) {
            this.state.message = error.message || "Erreur offline.";
        } finally {
            this.state.busy = false;
        }
    }
}

OfflineUniversalStatus.template = "offline_universal_patch.OfflineStatus";
OfflineUniversalStatus.props = {};

registry.category("systray").add(
    "offline_universal_patch.status",
    { Component: OfflineUniversalStatus },
    { sequence: 90 }
);
