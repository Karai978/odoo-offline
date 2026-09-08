/**
 * webclient/navbar/navbar.js
*/

/**
 * Builds a tree from a flat list of menus.
 * Generic for any module.
 */
export function buildMenuTree(menus) {
  const byId = {};
  menus.forEach((m) => (byId[m.id] = { ...m, children: [] }));

  const roots = [];
  menus.forEach((m) => {
    if (m.parent_id && byId[m.parent_id]) {
      byId[m.parent_id].children.push(byId[m.id]);
    } else {
      roots.push(byId[m.id]);
    }
  });

  const sortRec = (list) => {
    list.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    list.forEach((item) => sortRec(item.children));
  };
  sortRec(roots);

  return roots;
}

/**
 * Finds, within a list of menus (using a direct model or via descendants),
 * the first usable model by recursing through the descendants.
 */
export function findFirstModel(item) {
  if (item.model) return { model: item.model, name: item.name, actionId: item.action_id, defaultView: item.default_view };
  for (const child of item.children) {
    const found = findFirstModel(child);
    if (found) return found;
  }
  return null;
}

/**
 * Renders the horizontal menu (direct children of the root app), with
 * a dropdown if the item itself has sub-menus.
 * onSelect(model, name, actionId, defaultView) is provided by webclient.js
 * and calls actionService.doAction(...) — no more iframe navigation.
 */
export function renderHorizontalMenu(rootMenu, container, onSelect) {
  container.innerHTML = "";

  rootMenu.children.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "o-dropdown dropdown o_navbar_section_item o-dropdown--no-caret";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdown-toggle";
    btn.textContent = item.name;
    wrapper.appendChild(btn);

    if (item.children.length > 0) {
      const dropdown = document.createElement("div");
      dropdown.className = "dropdown-menu";

      const closeAndSelect = (target) => {
        dropdown.classList.remove("show");
        setActive(wrapper);
        onSelect(target.model, target.name, target.actionId, target.defaultView);
      };

      const appendMenuItem = (menuItem, { grouped }) => {
        const target = findFirstModel(menuItem);
        if (!target) return;
        const a = document.createElement("a");
        a.className = grouped ? "dropdown-item o_dropdown_menu_group_entry" : "dropdown-item";
        a.style.paddingLeft = grouped ? "32px" : "20px";
        a.textContent = menuItem.name;
        a.addEventListener("click", () => closeAndSelect(target));
        dropdown.appendChild(a);
      };

      item.children.forEach((child) => {
        if (child.children.length > 0) {
          const header = document.createElement("div");
          header.className = "dropdown-menu_group dropdown-header";
          header.style.paddingLeft = "20px";
          header.textContent = child.name;
          dropdown.appendChild(header);

          child.children.forEach((grandchild) => appendMenuItem(grandchild, { grouped: true }));
        } else {
          appendMenuItem(child, { grouped: false });
        }
      });

      wrapper.appendChild(dropdown);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".dropdown-menu").forEach((d) => {
          if (d !== dropdown) d.classList.remove("show");
        });
        dropdown.classList.toggle("show");
      });
    } else {
      const target = findFirstModel(item);
      btn.addEventListener("click", () => {
        setActive(wrapper);
        if (target) onSelect(target.model, target.name, target.actionId, target.defaultView);
      });
    }

    container.appendChild(wrapper);
  });

  function setActive(wrapper) {
    container.querySelectorAll(".o_navbar_section_item").forEach((el) => el.classList.remove("active"));
    wrapper.classList.add("active");
  }

  document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown-menu").forEach((d) => d.classList.remove("show"));
  });
}

/**
 * Resolves a module's "natural" navigation target based on its
 * manifest: the first usable menu of the root app that has the most
 * children. Returns
 * { model, name, actionId, defaultView } or null if no usable menu exists.
 */
export function resolveNaturalLanding(manifest) {
  const tree = buildMenuTree(manifest.menus);
  let rootMenu = tree[0] || { children: [] };
  let maxChildren = rootMenu.children.length;
  for (const candidate of tree) {
    if (candidate.children.length > maxChildren) {
      rootMenu = candidate;
      maxChildren = candidate.children.length;
    }
  }

  if (rootMenu.model) {
    return { model: rootMenu.model, name: rootMenu.name, actionId: rootMenu.action_id, defaultView: rootMenu.default_view };
  }
  return findFirstModel(rootMenu);
}