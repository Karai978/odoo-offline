/**
 * core/model_display.js
 * Dérive des libellés lisibles (nom d'app, nom de type de document) à
 * partir des caches déjà existants (installed_apps, module_manifests) —
 * pas de dictionnaire statique par modèle : ces informations existent
 * déjà côté Odoo (label d'app, name de menu) et sont simplement
 * recombinées ici pour l'affichage du panneau de conflits.
 */

import { db } from "./orm/orm_service.js";
import { getCachedApps } from "../webclient/menus/menu_service.js";
import { matchesDomain } from "./py_js/py_utils.js";

export async function resolveModelDisplayInfo(modelName, record = null) {
  const apps = await getCachedApps();
  if (!apps || apps.length === 0) return { appLabel: null, documentTypeLabel: null };

  for (const app of apps) {
    const manifest = await db.module_manifests.get(app.technical_name);
    if (!manifest || !manifest.menus) continue;

    const candidates = manifest.menus.filter((m) => m.model === modelName);
    if (candidates.length === 0) continue;

    const stateSpecificMatch = candidates.find(
      (m) => m.domain && record && domainMentionsField(m.domain, "state") && matchesDomain(record, m.domain)
    );

    if (stateSpecificMatch) {
      return { appLabel: app.label, documentTypeLabel: stateSpecificMatch.name };
    }

    // Aucun menu à domaine 'state' ne correspond : parmi les candidats
    // restants, on prend celui affiché en premier dans la navigation
    // (sequence la plus basse) — typiquement l'entrée "principale" du
    // modèle (ex: "Devis"), les sous-filtres spécialisés (ex: "à
    // facturer", "vente incitative") ayant une sequence plus élevée.
    const genericCandidates = candidates
      .filter((m) => !m.domain || !domainMentionsField(m.domain, "state"))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    const genericMatch = genericCandidates[0] || candidates[0];
    return { appLabel: app.label, documentTypeLabel: genericMatch.name };
  }

  return { appLabel: null, documentTypeLabel: null };
}

function domainMentionsField(domain, fieldName) {
  return domain.some(([field]) => field === fieldName);
}