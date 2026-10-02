/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class OfflineAppSelectionDialog extends Component {
    setup() {
        this.state = useState({
            selected: this.props.initialSelected.map(String),
            busy: false,
            error: "",
        });
    }

    toggle(appId) {
        const id = String(appId);
        this.state.selected = this.state.selected.includes(id)
            ? this.state.selected.filter((item) => item !== id)
            : [...this.state.selected, id];
    }

    selectAll() {
        this.state.selected = this.props.apps.map((app) => String(app.id));
    }

    clearSelection() {
        this.state.selected = [];
    }

    async confirm() {
        if (!this.state.selected.length || this.state.busy) return;
        this.state.busy = true;
        this.state.error = "";
        try {
            await this.props.onConfirm(this.state.selected);
            this.props.close();
        } catch (error) {
            this.state.error = error.message || "La préparation des apps a échoué.";
            this.state.busy = false;
        }
    }
}

OfflineAppSelectionDialog.template = "offline_universal_patch.OfflineAppSelectionDialog";
OfflineAppSelectionDialog.components = { Dialog };
OfflineAppSelectionDialog.props = {
    apps: Array,
    initialSelected: Array,
    onConfirm: Function,
    close: Function,
};
