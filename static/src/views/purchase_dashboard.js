/**
 * views/purchase_dashboard.js
 * Statistics banner
 * for the Purchasing dashboard — its display had been explicitly deferred
 */

function formatKpiAmount(value, symbol, position) {
  const formatted = Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return position === "after" ? `${formatted}\u00A0${symbol}` : `${symbol}\u00A0${formatted}`;
}

export function renderPurchaseDashboard(dashboardData, activeFilter, onFilterClick) {
  const boxes = [
    { state: "a_envoyer", label: "À envoyer", titleToutes: "Toutes les demandes de prix en brouillon", titleMes: "Mes demandes de prix en brouillon" },
    { state: "en_attente", label: "En attente", titleToutes: "Toutes les demandes de prix en attente", titleMes: "Mes demandes de prix en attente" },
    { state: "en_retard", label: "En retard", titleToutes: "Toutes les demandes de prix en retard", titleMes: "Mes demandes de prix en retard" },
  ];

  function isActive(rowKey, stateKey) {
    return !!(activeFilter && activeFilter.rowKey === rowKey && activeFilter.stateKey === stateKey);
  }

  const toutesBoxesHtml = boxes
    .map((b) => `
    <div class="g-col-4 p-0" title="${b.titleToutes}" data-row="toutes" data-state="${b.state}">
      <a href="#" class="btn btn-primary w-100 h-100 border-0 rounded-0 text-capitalize text-break fw-normal${isActive("toutes", b.state) ? " active" : ""}">
        <div class="fs-2">${dashboardData.toutes[b.state]}</div>${b.label}
      </a>
    </div>`)
    .join("");

  const mesBoxesHtml = boxes
    .map((b) => `
    <div class="g-col-4 p-0" title="${b.titleMes}" data-row="mes" data-state="${b.state}">
      <a href="#" class="btn btn-light d-flex align-items-center w-100 h-100 p-0 border-0 bg-100 fw-normal${isActive("mes", b.state) ? " active" : ""}">
        <div class="w-100 p-2">${dashboardData.mes[b.state]}</div>
      </a>
    </div>`)
    .join("");

  let kpiHtml = "";
  if (dashboardData.kpi) {
    const k = dashboardData.kpi;
    const avgOrderValueText = formatKpiAmount(k.avg_order_value, k.currency_symbol, k.currency_position);
    const purchased7dText = formatKpiAmount(k.purchased_7d, k.currency_symbol, k.currency_position);

    kpiHtml = `
      <div class="col-12 col-lg-7 col-xl-6 col-xxl-5 flex-shrink-0">
        <div class="d-flex flex-column justify-content-between gap-2 h-100">
          <div class="grid gap-2 h-100">
            <div class="g-col-6 g-col-md-6 grid gap-1 gap-md-4">
              <div class="g-col-12 g-col-sm-4 g-col-lg-6 d-flex align-items-center justify-content-center text-center justify-content-md-end text-md-end mt-4 mt-sm-0 text-break">Valeur moyenne de la commande</div>
              <div class="g-col-12 g-col-sm-8 g-col-lg-5 d-flex align-items-center justify-content-center py-2 bg-100"><span>${avgOrderValueText}</span></div>
            </div>
            <div class="g-col-6 g-col-md-6 grid gap-1 gap-md-4">
              <div class="g-col-12 g-col-sm-4 g-col-lg-6 d-flex align-items-center py-2 justify-content-center text-center justify-content-md-end text-md-end mt-4 mt-sm-0 text-break">Acheté ces 7 derniers jours</div>
              <div class="g-col-12 g-col-sm-8 g-col-lg-6 d-flex align-items-center justify-content-center py-2 bg-100"><span>${purchased7dText}</span></div>
            </div>
          </div>
          <div class="grid gap-2 h-100">
            <div class="g-col-6 g-col-md-6 grid gap-1 gap-md-4">
              <div class="g-col-12 g-col-sm-4 g-col-lg-6 d-flex align-items-center justify-content-center text-center justify-content-md-end text-md-end mt-4 mt-sm-0 text-break">Délai pour les achats</div>
              <div class="g-col-12 g-col-sm-8 g-col-lg-5 d-flex align-items-center justify-content-center py-2 bg-100"><span>${k.lead_time_days} Jours</span></div>
            </div>
            <div class="g-col-6 g-col-md-6 grid gap-1 gap-md-4">
              <div class="g-col-12 g-col-md-4 g-col-sm-4 g-col-lg-6 d-flex align-items-center justify-content-center text-center justify-content-md-end text-md-end mt-4 mt-sm-0 text-break">Demandes de prix envoyées les 7 derniers jours</div>
              <div class="g-col-12 g-col-sm-8 g-col-lg-6 d-flex align-items-center justify-content-center py-2 bg-100"><span>${k.sent_7d_count}</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "o_purchase_dashboard container-fluid py-4 border-bottom bg-views";
  wrapper.innerHTML = `
    <div class="row justify-content-between gap-3 gap-lg-0">
      <div class="col-12 col-lg-5 col-xl-5 col-xxl-4 flex-grow-1 flex-lg-grow-0 flex-shrink-0">
        <div class="grid gap-4">
          <div class="g-col-3 g-col-sm-2 d-flex align-items-center py-2 justify-content-end text-end justify-content-lg-start text-lg-start text-break">Toutes les demandes de prix</div>
          <div class="g-col-9 g-col-sm-10 grid gap-1">
            ${toutesBoxesHtml}
          </div>
        </div>
        <div class="grid gap-4">
          <div class="g-col-3 g-col-sm-2 d-flex align-items-center py-2 justify-content-end text-end justify-content-lg-start text-lg-start text-break">Mes demandes de prix</div>
          <div class="g-col-9 g-col-sm-10 grid gap-2">
            ${mesBoxesHtml}
          </div>
        </div>
      </div>
      ${kpiHtml}
    </div>
  `;

  wrapper.querySelectorAll("[data-row][data-state]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      onFilterClick(el.dataset.row, el.dataset.state);
    });
  });

  return wrapper;
}

/**
 * Constructs the Odoo domain corresponding to a dashboard tile,
 * exactly mirroring the backend logic (purchase_dashboard controller).
 */
export function buildPurchaseDashboardDomain(rowKey, stateKey, userId) {
  let domain;
  if (stateKey === "a_envoyer") {
    domain = [["state", "=", "draft"]];
  } else if (stateKey === "en_attente") {
    domain = [["state", "=", "sent"]];
  } else {
    const today = new Date().toISOString().slice(0, 10);
    domain = [["state", "in", ["draft", "sent"]], ["date_order", "<", today]];
  }
  if (rowKey === "mes" && userId) {
    domain.push(["user_id", "=", userId]);
  }
  return domain;
}
