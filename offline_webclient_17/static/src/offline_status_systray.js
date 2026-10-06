/** @odoo-module **/

import { Component, onWillDestroy, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

export class OfflineStatusIndicator extends Component {
    static template = "offline_webclient_17.OfflineStatusIndicator";

    setup() {
        const status = useService("offline_webclient_17.status");
        this.state = useState({ online: status.isOnline });
        const unsubscribe = status.subscribe(({ online }) => {
            this.state.online = online;
        });
        onWillDestroy(unsubscribe);
    }
}

registry.category("systray").add(
    "offline_webclient_17.status",
    { Component: OfflineStatusIndicator, isDisplayed: () => true },
    { sequence: 5 }
);
