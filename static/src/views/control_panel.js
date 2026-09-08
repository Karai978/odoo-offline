/**
 * views/control_panel.js
 * =========================
 * Builds the DOM skeleton for the control panel (.o_control_panel),
 * reused by any view controller that requires it (list_controller.js,
 * form_controller.js)—in keeping with the native Odoo architecture, where
 * .o_control_panel belongs to the current view's controller and resides within
 * .o_action_manager, NOT the global navbar (.o_navbar contains only
 * the apps menu and the systray; never the search bar, pager, or breadcrumb).
 *
 * Each controller calls buildControlPanel({ ...options }) and receives
 * the root element to insert into its own rendering, along with
 * references to the sub-elements it must populate or attach listeners to itself.
 */

export function buildControlPanel({
  withNewButton = false,
  withSearch = false,
  withPager = false,
  withViewSwitcher = false,
  withRecordStatusIcons = false,
  withOptionsGear = false,
} = {}) {
  const el = document.createElement("div");
  el.className = "o_control_panel d-flex flex-column gap-3 gap-lg-1 px-3 pt-2 pb-3";

  const main = document.createElement("div");
  main.className =
    "o_control_panel_main d-flex flex-wrap flex-lg-nowrap justify-content-between align-items-lg-start gap-3 flex-grow-1";
  el.appendChild(main);

  // --- Left column: action buttons + breadcrumb ---
  const breadcrumbsCol = document.createElement("div");
  breadcrumbsCol.className = "o_control_panel_breadcrumbs d-flex align-items-center gap-1 order-0 h-lg-100";
  main.appendChild(breadcrumbsCol);

  const mainButtons = document.createElement("div");
  mainButtons.className = "o_control_panel_main_buttons d-flex gap-1 d-empty-none d-print-none";
  breadcrumbsCol.appendChild(mainButtons);

  let newBtn = null;
  if (withNewButton) {
    newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn btn-primary o_list_button_add";
    newBtn.textContent = "Nouveau";
    mainButtons.appendChild(newBtn);
  }

  const breadcrumb = document.createElement("div");
  breadcrumb.className = "o_breadcrumb d-flex gap-1 text-truncate align-items-center";
  breadcrumbsCol.appendChild(breadcrumb);

  const breadcrumbListItem = document.createElement("div");
  breadcrumbListItem.className = "o_breadcrumb_item d-none";
  breadcrumbListItem.innerHTML = `
    <a href="#" class="o_breadcrumb_item_link text-truncate"></a>
    <i class="oi oi-chevron-right mx-1 text-muted small"></i>
  `;
  breadcrumb.appendChild(breadcrumbListItem);
  const breadcrumbListLink = breadcrumbListItem.querySelector("a");

  const lastBreadcrumbItem = document.createElement("div");
  lastBreadcrumbItem.className = "o_last_breadcrumb_item active d-flex fs-4 min-w-0 align-items-center";
  const breadcrumbCurrent = document.createElement("span");
  breadcrumbCurrent.className = "min-w-0 text-truncate";
  lastBreadcrumbItem.appendChild(breadcrumbCurrent);
  breadcrumb.appendChild(lastBreadcrumbItem);

  // ⚙️ Decorative "view options" icon (Import/Export/Columns...) —
  // NON-FUNCTIONAL for now; purely visual to match the
  // native Odoo look and feel. To be implemented later if needed.
  let optionsGearBtn = null;
  if (withOptionsGear) {
    optionsGearBtn = document.createElement("button");
    optionsGearBtn.type = "button";
    optionsGearBtn.className = "btn btn-link p-0 ms-1 lh-sm border-0";
    optionsGearBtn.title = "Options de vue";
    optionsGearBtn.innerHTML = '<i class="fa fa-cog"></i>';
    lastBreadcrumbItem.appendChild(optionsGearBtn);
  }

  let cloudBtn = null;
  let undoBtn = null;
  if (withRecordStatusIcons) {
    const recordStatusIcons = document.createElement("div");
    recordStatusIcons.className = "o_form_status_indicator_buttons";
    recordStatusIcons.innerHTML = `
      <button type="button" class="o_form_button_save btn btn-light border-0 px-1 py-0 lh-sm" title="Enregistrer manuellement" aria-label="Enregistrer manuellement">
        <i class="fa fa-cloud-upload fa-fw"></i>
      </button>
      <button type="button" class="o_form_button_cancel btn btn-light border-0 px-1 py-0 lh-sm" title="Ignorer les changements" aria-label="Ignorer les changements">
        <i class="fa fa-undo fa-fw"></i>
      </button>
    `;
    breadcrumb.appendChild(recordStatusIcons);
    cloudBtn = recordStatusIcons.querySelector(".o_form_button_save");
    undoBtn = recordStatusIcons.querySelector(".o_form_button_cancel");
  }

  // --- Colonne droite : recherche, pager, view-switcher --
  const navCol = document.createElement("div");
  navCol.className =
    "o_control_panel_navigation d-flex flex-wrap flex-md-nowrap justify-content-end gap-3 gap-lg-1 gap-xl-3 order-1 order-lg-2 flex-grow-1";
  main.appendChild(navCol);

  let searchInput = null;
  if (withSearch) {
    const searchWrap = document.createElement("div");
    searchWrap.className = "o_cp_searchview d-flex input-group flex-grow-1";
    searchWrap.setAttribute("role", "search");
    searchWrap.innerHTML = `
      <div class="o_searchview form-control d-flex align-items-center py-1" role="search">
        <i class="o_searchview_icon d-print-none oi oi-search me-2"></i>
        <div class="o_searchview_input_container d-flex flex-grow-1 flex-wrap gap-1">
          <input type="text" class="o_searchview_input border-0 flex-grow-1" placeholder="Rechercher...">
        </div>
      </div>
    `;
    navCol.appendChild(searchWrap);
    searchInput = searchWrap.querySelector("input");
  }

  let pagerEl = null, pagerInfoEl = null, pagerPrevBtn = null, pagerNextBtn = null;
  if (withPager) {
    const pagerWrap = document.createElement("div");
    pagerWrap.className = "o_cp_pager text-nowrap";
    pagerWrap.setAttribute("role", "search");
    pagerWrap.innerHTML = `
      <nav class="o_pager d-flex gap-2 h-100">
        <span class="o_pager_counter align-self-center"></span>
        <span class="btn-group d-print-none" aria-atomic="true">
          <button type="button" class="btn btn-secondary o_pager_previous px-2 rounded-start" title="Précédent">
            <i class="oi oi-chevron-left"></i>
          </button>
          <button type="button" class="btn btn-secondary o_pager_next px-2 rounded-end" title="Suivant">
            <i class="oi oi-chevron-right"></i>
          </button>
        </span>
      </nav>
    `;
    navCol.appendChild(pagerWrap);
    pagerEl = pagerWrap.querySelector(".o_pager");
    pagerInfoEl = pagerWrap.querySelector(".o_pager_counter");
    pagerPrevBtn = pagerWrap.querySelector(".o_pager_previous");
    pagerNextBtn = pagerWrap.querySelector(".o_pager_next");
  }

  let viewSwitcherEl = null;
  if (withViewSwitcher) {
    viewSwitcherEl = document.createElement("div");
    viewSwitcherEl.className = "o_cp_switch_buttons d-print-none btn-group";
    viewSwitcherEl.setAttribute("role", "group");
    navCol.appendChild(viewSwitcherEl);
  }

  return {
    el,
    newBtn,
    breadcrumbListItem,
    breadcrumbListLink,
    breadcrumbCurrent,
    optionsGearBtn,
    cloudBtn,
    undoBtn,
    searchInput,
    pagerEl,
    pagerInfoEl,
    pagerPrevBtn,
    pagerNextBtn,
    viewSwitcherEl,
  };
}

const VIEW_SWITCHER_ICONS = {
  list: "oi-view-list",
  kanban: "oi-view-kanban",
  pivot: "oi-view-pivot",
  graph: "oi-view-graph",
};

/**
 * Populates viewSwitcherEl (returned by buildControlPanel) with a button 
 * for each available view. onSwitch(viewType) is called on click. 
 **/
export function renderViewSwitcherButtons(viewSwitcherEl, views, currentView, onSwitch) {
  viewSwitcherEl.innerHTML = "";
  if (!views || views.length <= 1) return;

  views.forEach((viewType) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-secondary" + (viewType === currentView ? " active" : "");
    btn.title = viewType.charAt(0).toUpperCase() + viewType.slice(1);
    btn.innerHTML = `<i class="oi ${VIEW_SWITCHER_ICONS[viewType]}"></i>`;
    btn.addEventListener("click", () => onSwitch(viewType));
    viewSwitcherEl.appendChild(btn);
  });
}