# Règles métier Odoo 17 — Digest source pour le portage JS offline

Source : `odoo/odoo` branche `17.0` (addons/sale, addons/purchase, addons/stock, addons/account),
vérifié le 2026-10-02 via raw.githubusercontent.com. Seuls les blocs décorés
(`@api.depends` / `@api.onchange` / `@api.constrains`) utiles au moteur JS
(`computeRegistry` / `onchangeRegistry` / `constraintsRegistry`) sont conservés.

Légende de portabilité :
- ✅ = portable tel quel offline (lecture de champs de records déjà en cache)
- ⚠️ = portable avec approximation documentée (pas de pricelist ni moteur de taxes)
- ❌ = serveur uniquement (SQL, séquences, tax engine, recherche)

---

## 1. VENTES — sale.order (addons/sale/models/sale_order.py)

### 1.1 Computes (`@api.depends`) — à porter en `onchangeRegistry` (déclenchés sur le champ source) ou `computeRegistry`

| Méthode | Dépend | Logique 17.0 | Port |
|---|---|---|---|
| `_compute_partner_invoice_id` | partner_id | `partner.address_get(['invoice'])` (repli : le partner lui-même) | ⚠️ |
| `_compute_partner_shipping_id` | partner_id | `partner.address_get(['delivery'])` | ⚠️ |
| `_compute_payment_term_id` | partner_id | `partner.property_payment_term_id` | ✅ (déjà fait) |
| `_compute_pricelist_id` | partner_id, company_id | si state=draft : `partner.property_product_pricelist` (sinon False) | ⚠️ (pricelist hors cache) |
| `_compute_currency_id` | pricelist_id, company_id | `pricelist.currency_id or company.currency_id` | ⚠️ |
| `_compute_currency_rate` | currency_id, date_order | `res.currency._get_conversion_rate(...)` | ❌ (taux serveur) |
| `_compute_fiscal_position_id` | partner_id, partner_shipping_id, company_id | `fpos._get_fiscal_position(partner, delivery)` (règle sur pays + foreign_vat) | ⚠️ (approximation par pays du partner) |
| `_compute_user_id` | partner_id | `partner.user_id or partner.commercial_partner_id.user_id or (env.user si groupe salesman)` | ⚠️ |
| `_compute_team_id` | partner_id, user_id | `_get_default_team_id` (CRM) | ❌ |
| `_compute_note` | partner_id | conditions générales de la société (`account.use_invoice_terms` → `company.invoice_terms`) | ✅ |
| `_compute_require_signature` | company_id | `company.portal_confirmation_sign` (base sale ; **sale_management** ajoute la priorité `sale_order_template_id.require_signature`) | ✅ (déjà fait) |
| `_compute_require_payment` | company_id | `company.portal_confirmation_pay` | ✅ |
| `_compute_prepayment_percent` | require_payment | `company.prepayment_percent` | ✅ |
| `_compute_validity_date` | company_id | `today + company.quotation_validity_days` si > 0 (base ; sale_management : priorité au template `number_of_days`) | ✅ (déjà fait) |
| `_compute_amounts` | order_line.price_subtotal/price_tax | `amount_untaxed = Σ price_subtotal ; amount_tax = Σ price_tax ; amount_total = somme` (sinon tax engine) | ✅ (approximation : pas de recalcul des taxes) |
| `_compute_expected_date` | order_line.customer_lead, date_order, state | min des dates attendues des lignes | ⚠️ |
| `_compute_is_expired` | (non stocké) | `state in (draft,sent) and validity_date < today` | ✅ |
| `_compute_journal_id` | — | `False` (défaut ; le journal est choisi à la facturation) | ✅ (trivial) |
| `_compute_type_name` | state | draft/sent/cancel → "Quotation", sinon "Sales Order" | ✅ |

### 1.2 Onchanges (`@api.onchange`)

| Méthode | Déclencheur | Logique | Port |
|---|---|---|---|
| `_onchange_commitment_date` | commitment_date, expected_date | **warning** "Requested date is too soon" si `commitment_date < expected_date` | ✅ (nécessite la support warnings du moteur) |
| `_onchange_company_id_warning` | company_id | warning si lignes existantes (state=draft) | ✅ |
| `_onchange_fpos_id_show_update_fpos` | fiscal_position_id | flag `show_update_fpos` si lignes existantes | ⚠️ (flag, non bloquant) |
| `_onchange_partner_id_warning` | partner_id | `partner.sale_warn` (block → reset partner_id / warning → message) ; remonte au parent si le contact n'a pas de warn | ✅ (pattern identique au `purchase_warn` achats) |
| `_onchange_pricelist_id_show_update_prices` | pricelist_id | flag `show_update_pricelist` | ⚠️ |
| `_onchange_prepayment_percent` | prepayment_percent | si vide → `require_payment = False` | ✅ |

### 1.3 Contraintes (`@api.constrains` / SQL)

| Méthode | Champ | Logique | Port |
|---|---|---|---|
| `_check_order_line_company_id` | company_id, order_line | produits d'une autre société que la commande | ✅ (si product.company_id en cache) |
| `_check_prepayment_percent` | prepayment_percent | `0 < prepayment_percent <= 1.0` si `require_payment` | ✅ |
| `_sql_constraints` date_order_conditional_required | state, date_order | state='sale' ⇒ date_order non nul | ✅ (garde-fou local au save) |

---

## 2. VENTES — sale.order.line (addons/sale/models/sale_order_line.py)

| Méthode | Décorateur | Logique | Port |
|---|---|---|---|
| `_compute_product_template_id` | product_id | `product.product_tmpl_id` | ✅ |
| `_compute_name` | product_id | `product.get_product_multiline_description_sale()` (≈ `description_sale` + attributs) | ✅ |
| `_compute_product_uom` | product_id | `product.uom_id` (si différent) | ✅ |
| `_compute_product_uom_qty` | display_type, product_id, packaging | conversion via packaging (si `product_packaging_qty`) | ⚠️ |
| `_compute_tax_id` | product_id, company_id | `product.taxes_id` filtré par société puis **mappé par la fiscal position** (`fpos.map_tax`) | ⚠️ (sans mapping fpos offline) |
| `_compute_pricelist_item_id` | product_id, product_uom, product_uom_qty | `pricelist._get_product_rule(product, qty, uom, date)` | ❌ (règles pricelist serveur) |
| `_compute_price_unit` | product_id, product_uom, product_uom_qty | prix pricelist → conversion prix HT→TTC ; **ne touche pas le prix si `qty_invoiced > 0`** | ⚠️ (repli : `product.list_price`) |
| `_compute_discount` | product_id, product_uom, product_uom_qty | si `pricelist.discount_policy == 'without_discount'` : discount déduit de la règle pricelist | ❌ |
| `_compute_amount` | product_uom_qty, discount, price_unit, tax_id | tax engine : `price_subtotal / price_tax / price_total` | ⚠️ (approx : `subtotal = qty × price × (1-disc/100)`, `tax = 0`, `total = subtotal`) |
| `_compute_product_packaging_id/qty` | product_id, qty, uom | packaging le plus proche | ⚠️ |
| `_compute_customer_lead` | — | 0.0 (overridden par sale_stock) | — |
| `_compute_qty_to_invoice` / `_compute_invoice_status` | qty_invoiced, qty_delivered, product_uom_qty, state | logique facturation | ❌ (données serveur) |

**Onchanges ligne** (section `#=== ONCHANGE METHODS ===#`) :
- `_onchange_product_id` : réinitialise + synchronise `product_uom`, description, taxes (via les computes ci-dessus)
- `_onchange_display_type` : nettoyage des champs si section/note
- `_onchange_product_uom` : recalc `product_uom_qty`
- contrainte implicite : ligne readonly si `state == 'sale'` et produit lié à une facture

---

## 3. ACHATS — purchase.order (addons/purchase/models/purchase_order.py)

### 3.1 Computes

| Méthode | Dépend | Logique | Port |
|---|---|---|---|
| `_compute_currency_rate` | date_order, currency_id, company | taux de conversion | ❌ |
| `_compute_date_planned` | order_line.date_planned | `min(date_planned des lignes non-sections)` | ✅ |
| `_compute_receipt_reminder_email` | company_id, partner_id | `partner.receipt_reminder_email` (+ `reminder_date_before_receipt`) | ✅ |
| `_compute_tax_country_id` | company, fpos | `fpos.foreign_vat ? fpos.country_id : company.account_fiscal_country_id` | ✅ |
| `amount_untaxed/tax/total` | order_line.* | somme des lignes (même pattern que sale) | ⚠️ (id. taxes) |

### 3.2 Onchanges

| Méthode | Déclencheur | Logique | Port |
|---|---|---|---|
| `onchange_partner_id` | partner_id, company_id | **`fiscal_position_id = fpos._get_fiscal_position(partner)` ; `payment_term_id = partner.property_supplier_payment_term_id` ; `currency_id = partner.property_purchase_currency_id or company.currency_id` ; `user_id = partner.buyer_id` (si défini)** ; si pas de partner : fpos=False, currency=company | ⚠️/✅ |
| `_compute_tax_id` (onchange) | fiscal_position_id, company_id | relance `order_line._compute_tax_id()` | ⚠️ |
| `onchange_partner_id_warning` | partner_id | `partner.purchase_warn` (block → reset / warning), uniquement si groupe `purchase.group_warning_purchase` | ✅ |
| `onchange_date_planned` | date_planned | propage `date_planned` sur toutes les lignes non-sections | ⚠️ (propagation one2many) |
| `onchange` (override) | — | supprime `date_planned` des lignes quand partner/company change (`_must_delete_date_planned`) | ⚠️ |

### 3.3 Contraintes / garde-fous

| Méthode | Champ | Logique | Port |
|---|---|---|---|
| `_check_order_line_company_id` | company_id, order_line | produits d'une autre société | ✅ |
| `_unlink_if_cancelled` | — | non supprimable sauf state='cancel' | ✅ (garde-fou local) |
| `write` / `create` | — | séquence `ir.sequence 'purchase.order'` ; `_write_partner_values` (buyer…) | ❌ (séquence serveur) |

---

## 4. ACHATS — purchase.order.line (addons/purchase/models/purchase_order_line.py)

| Méthode | Décorateur | Logique | Port |
|---|---|---|---|
| `onchange_product_id` | product_id | si pas de qty existante : reset `price_unit = product_qty = 0` puis `_product_id_change()` + `_suggest_quantity()` | ✅ |
| `_product_id_change` (appelé par l'onchange) | — | **`product_uom = product.uom_po_id or product.uom_id` ; `name = _get_product_purchase_description()` (description fournisseur, langue du partner) ; `_compute_tax_id()`** | ⚠️ |
| `onchange_product_id_warning` | product_id | `product.purchase_line_warn` (block → reset product / warning), si groupe | ✅ |
| `_compute_price_unit_and_date_planned_and_name` | product_qty, product_uom, company_id | **`seller = product._select_seller(partner, qty, date_order, uom)`** : `date_planned = date_order + seller.delay` ; `price_unit = seller.price` (conversion devise + UoM, ajustement prix TTC→HT) ou sinon `product.standard_price` (avec `supplier_taxes_id`) ; `discount = seller.discount` ; `name` = description spécifique vendeur si pas déjà personnalisée | ⚠️ (seller_ids peu probable en cache → repli standard_price) |
| `_compute_product_packaging_id/qty` | product_id, qty, uom | packaging achat | ⚠️ |
| `_compute_product_uom_qty` | product_uom, product_qty | conversion UoM produit | ⚠️ |
| `_inverse_qty_received` (onchange) | qty_received | si `qty_received_method == 'manual'` (consu/service) : `qty_received_manual = qty_received` | ✅ |
| `_compute_qty_invoiced` / qty_to_invoice | invoice_lines, qty_received… | facturation | ❌ |
| `price_unit_discounted` | price_unit, discount | `price_unit × (1 − discount/100)` | ✅ |
| `_unlink_except_purchase_or_done` | — | ligne non supprimable si commande confirmed/done | ✅ (garde-fou local) |
| `write` | display_type | changement de type de ligne interdit | ✅ |

---

## 5. STOCK — stock.picking (addons/stock/models/stock_picking.py)

### 5.1 Computes

| Méthode | Dépend | Logique | Port |
|---|---|---|---|
| `_compute_location_id` | picking_type_id, partner_id | **draft only, pas de retour** : `location_id = picking_type.default_location_src_id or partner.property_stock_supplier or emplacement client du dépôt` ; `location_dest_id = picking_type.default_location_dest_id or partner.property_stock_customer or emplacement fournisseur du dépôt` | ⚠️ (nécessite references stock.location) |
| `_compute_state` | move_ids.state, move_type | agrégat des états des moves (draft/assigned/confirmed/waiting/done/cancel) | ⚠️ (si moves en cache) |
| `_compute_scheduled_date` | move_ids.state, move_ids.date, move_type | `min/move_ids.date` (direct) sinon `max` ; `_set_scheduled_date` réécrit `move.date` (erreur si done/cancel) | ⚠️ |
| `_compute_date_deadline` | move_ids.date_deadline, move_type | min/max deadlines | ⚠️ |
| `_compute_show_check_availability` | state, move_ids… | bouton "Vérifier la disponibilité" | ⚠️ |
| `_compute_products_availability` | state, picking_type_code, scheduled_date, forecast | "Available / Not Available / Exp…" | ❌ (forecast serveur) |
| `_compute_is_signed` / `_compute_show_lots_text` / `_compute_return_count` | — | trivial | ✅ |

### 5.2 Onchanges

| Méthode | Déclencheur | Logique | Port |
|---|---|---|---|
| `_onchange_picking_type` | picking_type_id, partner_id | **draft : réécrit `picking_type_id` + `company_id` des moves, `description_picking` = `product._get_description(picking_type)`** ; puis `partner.picking_warn` (block → reset partner / warning) | ⚠️ |
| `_onchange_locations` | location_id, location_dest_id | **propage les 2 emplacements aux moves** ; warning "Locations to update" si des operations ont déjà des quantités | ⚠️ |

### 5.3 Garde-fous `write()`

- `picking_type_id` : **interdit si state != 'draft'** ("Changing the operation type of this record is forbidden at this point.")
- changement `location_id`/`location_dest_id`/`partner_id` → propagé aux moves non scrapped

---

## 6. STOCK — stock.move (addons/stock/models/stock_move.py) — à confirmer au prochain passage

Règles attendues (pattern standard 17) : `onchange product_id` → `product_uom_id = product.uom_id`, `route_id` (route produit), `date` ;
`onchange product_uom` → conversion `product_uom_qty` ; computes `forecast_availability`, `state`.
→ Ne sera porté que si l'édition offline des lines de picking est demandée (à confirmer).

---

## 7. COMPTABILITÉ — account.move (addons/account/models/account_move.py)

### 7.1 Computes

| Méthode | Dépend | Logique | Port |
|---|---|---|---|
| `_compute_fiscal_position_id` | partner_id, partner_shipping_id, company_id | `fpos._get_fiscal_position(partner, delivery)` | ⚠️ |
| `_compute_partner_shipping_id` | partner_id | `partner.address_get(['delivery'])` si invoice | ⚠️ |
| `_compute_invoice_payment_term_id` | partner_id | **doc de vente → `partner.property_payment_term_id` ; doc d'achat → `partner.property_supplier_payment_term_id`** | ✅ |
| `_compute_partner_bank_id` | bank_partner_id | 1er compte bancaire du partner (priorité `allow_out_payment` faux) | ⚠️ (bank_ids en cache ?) |
| `_compute_currency_id` | journal_id, statement_line | `journal.currency_id or company.currency_id` | ✅ (si journal en cache) |
| `_compute_commercial_partner_id` | partner_id | `partner.commercial_partner_id` | ✅ |
| `_compute_narration` | move_type, partner_id, company_id | conditions générales société (si `account.use_invoice_terms` + doc de vente) | ✅ |
| `_compute_invoice_date_due` | needed_terms | `max(date_maturity des échéances)` | ⚠️ (nécessite les échéances — server) |
| `_compute_amount` | line_ids.* | sommes par type de ligne (product/tax/payment_term) → `amount_untaxed / amount_tax / amount_total / amount_residual` | ⚠️ (taxes) |
| `_compute_direction_sign` | move_type | 1 si outbound/entry, −1 sinon | ✅ |
| `_compute_type_name` | move_type | "Invoice / Credit Note / Vendor Bill…" | ✅ |
| `_compute_partner_credit_warning` | company, partner, tax_totals, currency | warning limite de crédit (state=draft, out_invoice) | ✅ |
| `_compute_tax_country_id` | company, fpos | `fpos.foreign_vat ? fpos.country_id : company.account_fiscal_country_id` | ✅ |

### 7.2 Inverses / Onchanges

| Méthode | Déclencheur | Logique | Port |
|---|---|---|---|
| `_inverse_partner_id` | partner_id | réécrit `partner_id` des lignes + relance leur inverse | ⚠️ |
| `_inverse_company_id` | company_id | erreur si société vide ; recalc conditionnel du journal | ✅ (garde-fou) |
| `_inverse_currency_id` | currency_id | recalc devise des lignes | ⚠️ |
| `_inverse_journal_id` | journal_id | **`company_id = journal.company_id` ; `currency_id = journal.currency_id` (si défini)** | ✅ |
| `_onchange_move_type` | move_type | **journal par défaut du type** (`_default_journal_id` : compte journal de la société selon type) — à confirmer au prochain passage (chunk 11) | ✅ (approx par référence account.journal) |
| `_onchange_date` | date | recalc `amount_currency` des lignes (non facture) | ❌ |
| `_onchange_invoice_vendor_bill` | invoice_vendor_bill_id | copie des lignes d'une facture fournisseur | ❌ |
| `_onchange_fpos_id_show_update_fpos` | fiscal_position_id | flag `show_update_fpos` | ⚠️ |
| `_onchange_partner_id` | partner_id | **vérifie `property_account_receivable_id`/`property_account_payable_id` (RedirectWarning si plan comptable absent) ; `partner.invoice_warn` (block → reset / warning)** | ✅ |
| `_onchange_name_warning` | name, highest_name | warning de séquence (trou / format changé) | ⚠️ (optionnel) |
| `_inverse_payment_reference` / `_inverse_invoice_payment_term_id` | — | renommage des lignes payment_term | ❌ |

### 7.3 Contraintes (à confirmer au prochain passage, chunk ~12)

`_check_untaxable_amount` (ligne HT=0 interdite), `_check_reconciliation`,
`_check_no_currency_mismatch`, `_check_invoice_partner`, SQL `check_credit_debit`…

---

## 8. COMPTABILITÉ — account.move.line (addons/account/models/account_move_line.py)

| Méthode | Décorateur | Logique | Port |
|---|---|---|---|
| `_sql_constraints` | — | `credit × debit = 0` ; signe devise cohérent ; `account_id` requis sur ligne accountable | ✅ (garde-fou local si lignes éditables) |
| `_compute_display_type` | move_id | tax / payment_term / product / section / note | ✅ (statique) |
| `_compute_partner_id` | — | `move.partner.commercial_partner_id` | ✅ |
| `_compute_currency_id` | move_id.currency_id | devise du move (ou société) | ✅ |
| `_compute_name` | product_id, move_id.payment_reference | **`product.partner_ref` + `product.description_sale` (journal vente) / `product.description_purchase` (journal achat)** ; lignes payment_term : référence + n° échéance | ✅ |
| `_compute_account_id` | — | compte par défaut (SQL + propriétés) | ❌ |
| `_compute_tax_ids` / `_onchange_product_id` | product_id | **`product.taxes_id` filtrés par le pays du partner** (`tax_country_id`) ; `price_unit` = prix produit | ⚠️ (à confirmer chunk 3-4) |
| `_compute_price_subtotal` / `_compute_price_total` | quantity, price_unit, tax_ids, discount | `quantity × price_unit × (1 − discount/100)` ± taxes | ⚠️ (taxes = 0 offline) |
| `_compute_amount_residual` | — | réconciliation | ❌ |

---

## 9. Décisions techniques pour le portage (à valider)

1. **Moteur — warnings** : les onchanges Python renvoient parfois `{'warning': {title, message}}`
   (et parfois `{'block': ...}` via reset de champ). → Le moteur JS doit accepter
   qu'une règle retourne en plus du patch : `{ _warning: { title, message } }`
   (affiché via `notify({type: 'warning'|'danger'})`) et éventuellement `{ _block: true }`
   (le patch inclut le reset du champ, ex. `partner_id: false`).
2. **Moteur — computes de champs** : le `computeRegistry` actuel ne gère que les totaux one2many.
   → Ajouter un registre `offline_field_compute` : clé `model:field` → `fn(values, helpers) => valeur`,
   réévalué dans le `revaluateAll` existant de `relational_model.js` (hook `input`/`change` déjà en place),
   écrit dans le DOM si le champ existe (priorité aux champs readonly/monetary/float/integer).
3. **Taxes** : pas de tax engine offline. Convention : sur ligne **existante** conservée,
   les valeurs `price_tax/price_subtotal/price_total` stockées restent affichées ; sur ligne
   **nouvelle/modifiée** : `price_subtotal = qty × price_unit × (1 − discount/100)`, `price_tax = 0`,
   `price_total = price_subtotal`. Les totaux du document = somme des lignes.
4. **Prix** : pas de pricelist (ventes) ni de `seller_ids` (achats) en cache →
   repli `product.list_price` / `product.standard_price` (documenté).
5. **Données requises en cache** : `res.partner` (avec propriétés : `property_payment_term_id`,
   `property_supplier_payment_term_id`, `property_product_pricelist`, `property_purchase_currency_id`,
   `property_stock_supplier`, `property_stock_customer`, `buyer_id`, `user_id`, `commercial_partner_id`,
   `sale_warn/purchase_warn/invoice_warn/picking_warn`, `invoice_terms`), `res.company` (termes,
   validité, portail), `res.currency` (déjà géré par name_service), `account.journal`,
   `stock.location`, `product.product` (descriptions, taxes, prix, UoM, `seller_ids` ?).
   → Le manifest du backend `offline_sync` (fields) doit exposer ces champs ; les règles
   doivent tolérer l'absence (fallback silencieux, jamais de crash).
6. **Structure des fichiers** (miroir de l'exemple `sale_order_rules.js`) :
   - `business_rules/sale_rules.js`   (remplace/étend `sale_order_rules.js`)
   - `business_rules/purchase_rules.js`
   - `business_rules/stock_rules.js`
   - `business_rules/account_rules.js`
   - import dans `main.js` (côté effet, comme l'exemple actuel)
7. **Clés onchange** : `model:champ` (règle unique) ou `model:champ#discriminant`
   (plusieurs règles indépendantes sur le même champ) — format déjà supporté.

## 10. Notes d'implémentation (état final du portage)

### Moteur (`model/relational_model/relational_model.js`)
- `attachLiveOnchange(model, containerEl, fieldsInfo, helpers)` :
  - une règle peut retourner `{ ...patch, _warning: { title, message, block } }`
    → toast via `notify()` (danger si block) ;
  - un patch one2many (tableau de lignes) → `applyOne2manyPatch` : appariement
    des lignes par `tr._recordId` (lignes existantes) ou par ordre d'apparition
    (nouvelles) ; cellules many2one = hidden + visible ; les cellules scalaires
    modifiées ré-émettent `change` (cascade) ;
  - after patch : `change` ré-émis **uniquement sur les champs dont la valeur a
    changé** → les chaînes de règles s'arrêtent sur les règles idempotentes.
- `attachLiveBusinessRules(archXml, containerEl, fieldsInfo, model, helpers)` :
  en plus de readonly/required dynamiques, réévalue les entrées
  `fieldComputeRegistry` du modèle (`model:field` → `fn(values, helpers)`) et
  écrit via `writeFieldValue` (monétaire = toFixed(2), m2o = hidden+visible,
  `undefined` = champ non touché).
- `form_controller.js` : les contraintes (`constraintsRegistry`) retournent un
  **message string** (plus une fonction) ; le contrôleur fait `notify()` +
  status. Les deux helpers (model + onchangeHelpers) sont passés aux deux
  fonctions d'attachement (load + refresh après sync).

### Conventions de portage appliquées
- **Sentinel `getRecordSmart`** : en cas de cache manquant, la fonction
  renvoie `{ id, display_name: "Non disponible hors-ligne" }` (objet truthy !).
  Toutes les règles passent par `isMissingRecord()` (rules_helpers.js) avant
  d'utiliser un record : sinon une règle écraserait des champs (prix → 0,
  pricelist/termes → false, signature → false) sur un cache manquant.
- **Backfill de lignes** (onchange produit) : remplit les champs dérivés
  **vides** (name, product_uom, tax(es)_id, price_unit, date_planned achat)
  et **recalcule en permanence** les montants (price_subtotal, price_tax,
  price_total) + les taxes via le moteur approximatif ci-dessous ; une ligne
  dont les valeurs ne changent pas est renvoyée telle quelle (aucun écrit
  DOM, aucune cascade, aucun refetch) — idempotent, le serveur reste la
  vérité au sync.
- **m2o collecté = id entier ou "tmp:…"** : les règles ignorent les ids tmp
  (création locale non synchronisée).
- **Adresses** (partner_invoice/shipping) : repli sur le partner lui-même
  (`address_get()` est un calcul serveur sur les contacts).
- **Fiscal position** : position du même pays que le partner (foreign_vat en
  priorité), sinon false — jamais d'écriture si aucun record fiable.
- **Groupes utilisateurs** (`purchase.group_warning_purchase` etc.) non
  disponibles offline : les warnings `*_warn` sont appliqués sans condition de
  groupe (documenté).

### Moteur de taxes approximatif (offline) — `rules_helpers.js`
Ajout : `computeTaxAmounts(base, quantity, taxRecords)` + `getTaxRecord()`
(lecture `account.tax` **cache-first**, un seul fetch en ligne ensuite).
Les backfills de lignes (vente/achat/facture) recalculent à chaque événement
(sous-total, `price_tax`, `price_total`), idempotent :
- `percent` (défaut) : `base × taux / 100` ;
- `ad_dosem` (montant fixe par unité) : `quantity × montant` ;
- `price_include` (prix TTC) : `base HT ≈ base / (1 + taux/100)`,
  `price_total = price_subtotal` (comme Odoo, le total n'additionne pas la
  taxe incluse).
Totaux document recalculés en conséquence :
`amount_total = Σ price_total`, `amount_tax = Σ price_tax`,
`amount_untaxed = amount_total − amount_tax` (juste aussi en prix TTC).

### Ce qui n'est PAS répliqué offline (documenté)
- Tax engine complet : groupes de taxes, arrondis fiscaux par taxe
  (`base_round`/`tax_round`), répartition de base, `map_tax` de la position
  fiscale ; l'interaction multi-taxes incluses est approximée ; arrondi final
  à 2 décimales.
- Pricelists / seller_ids (prix = list_price / standard_price).
- Taux de change (currency_rate non touché).
- `stock.move` : propagation des locations/quantités aux moves (scope picking
  seul) ; state/forecast du picking.
- Échéancier (invoice_date_due), compte de contrepartie, `currency_field`
  conditionnel, séquence des journaux par défaut.
- `_compute_price_unit` pricelist rules, `payment_term` nomenclature des
  lignes de facture, langue du partner dans les descriptions.

### Rebuild
Le bundle (`static/src/bundles/app.bundle.js`) doit être régénéré :
`(cd scripts && npm install) && bash scripts/build-bundle.sh`
(pas de réseau dans le sandbox de dev — à faire côté utilisateur).

---

## 11. Flux create / save / liste — source Odoo 17 (web client) et portage offline

### 11.1 Ce que fait Odoo 17 en ligne (source vérifiée, branch 17.0)

Fichiers lus : `addons/web/static/src/model/relational_model/relational_model.js`,
`.../relational_model/record.js`, `.../views/list/list_controller.js`,
`.../views/form/form_controller.js`.

1. **Création** — bouton "Nouveau" de la liste :
   `ListController.createRecord()` → liste éditables ? ligne virtuelle inline
   (`DynamicRecordList.addNewRecord`, pas d'id) : `props.createRecord()` →
   `doAction(form_view, { isNew: true })`. Le form charge le record sans
   `resId` (`_loadData` → `_loadNewRecord` → **onchange serveur** pour les
   valeurs par défaut).
2. **Enregistrement** — `Record.save()` → `Record._save()`, dans
   `model/relational_model/record.js` :
   - `creation = !this.resId` ; validité ; `changes = _getChanges()` (diff vs
     valeurs serveur, champs readonly exclus) ;
   - un **seul RPC `web_save`** (`orm.webSave(resModel, resId ? [resId] : [],
     changes)` — tableau vide pour un nouveau record = CREATE serveur) ;
   - **si création** : `resId = records[0].id` puis
     `_updateConfig(config, { resId, resIds }, { reload: false })` —
     **le record reçoit son id réel SANS naviguer** (le form reste ouvert,
     l'URL est mise à jour via `updateURL()` → `router.pushState({ id: resId })`) ;
   - `hooks.onRecordSaved` ; rechargement complet depuis le serveur
     (`_setData(records[0])`) → les champs calculés par le serveur
     (séquence, totaux…) remplacent les valeurs locales.
3. **Retour à la liste** — breadcrumb : `beforeLeave()` (le form sauvegarde
   s'il est dirty, `reload: false`), puis la liste est **remontée et
   rechargée depuis le serveur** (`web_search_read`) → le nouveau record y
   figure. Dans une liste éditables, le record virtuel est ajouté dans
   `root.records` et son id est posé en place après save.
4. **Ouverture** — `ListController.openRecord(record)` →
   `selectRecord(record.resId, { activeIds })` → `doAction(form_view, { id })`
   → le form charge `web_read` de ce seul id.

### 11.2 Équivalent offline dans la PWA (état avant correction)

| Étape Odoo 17 | Équivalent PWA avant | État |
|---|---|---|
| create RPC → id réel | `queueAction(model, "create", values)` → `local:<uuid>`, snapshot `record_cache` + insertion `list_cache` (optimiste, `applyOptimisticLocalUpdate`) | ✅ présent |
| id réel posé en place | au sync : `replaceRecordId` + `replaceRecordIdInAllLists` | ✅ présent |
| liste rechargée serveur → record visible | `getListRecordsSmart` (serveur si online, sinon cache) | ⚠️ **lacune** : en ligne, le fetch serveur ÉCRASE le cache → les créations non synchronisées disparaissent de la liste |
| liste avec cache | `list_cache` | ⚠️ **lacune** : hors-ligne sans liste jamais en cache → erreur "Aucune liste en cache" au lieu d'afficher les fiches locales |
| record_id de la création persisté | — | ⚠️ **lacune** : `odoo_record_id` renvoyé par le push n'était pas stocké dans `sync_queue` (réouverture par id local après rechargement impossible) |
| form ouvrable par id | `form_controller` gère déjà `local:<uuid>` (lecture `record_cache`, amend de la file) | ✅ présent |
| lignes liste/kanban ouvrables par id quelconque | `record.id` passé en closure (aucun `parseInt`) | ✅ présent |

### 11.3 Corrections implémentées

1. **`core/network/rpc_service.js`**
   - `syncPendingActions` : `odoo_record_id` persisté dans l'entrée
     `sync_queue` au succès d'un create (réouverture par id local robuste,
     et détection "déjà synchronisé" côté liste).
   - Nouveau `getLocalPendingRecords(modelName)` : toutes les entrées
     `create` du modèle en status `pending`/`error`/`conflict` sans
     `odoo_record_id` → `[{ ...values, id: "local:<uuid>" }]`.
2. **`views/list/list_controller.js`**
   - Les créations locales en attente sont **toujours fusionnées** en tête de
     la liste (en ligne comme hors-ligne), dédupliquées par id — le record
     apparaît donc dès l'enregistrement, comme dans Odoo.
   - Hors-ligne sans liste en cache : la liste s'affiche avec les seules
     fiches locales (plus d'écran d'erreur), avec message explicite.
   - Abonnement bus `sync:updated` : à chaque synchro (panneau navbar,
     save…), la liste OPENED re-fusionne sans aller au serveur — la ligne
     locale disparaît quand elle est synchronisée (id renommé côté
     `list_cache` par `replaceRecordIdInAllLists`).
3. **`views/form/form_controller.js`**
   - Chemin ré-enregistrement d'une fiche locale déjà synchronisée
     (`odoo_record_id` maintenant persisté) : conversion automatique en
     `write` — même comportement que dans Odoo (le record a un id, tout edit
     est un write).

### Correctifs de bugs (retours de test navigateur)
- **Écriture m2m/m2o dans les cellules de lignes** (relational_model.js
  `applyOne2manyPatch`) : le widget many2many_tags attend un JSON d'ids
  dans son input caché — un tableau de paires écrit tel quel devenait
  `String(tableau)` (illisible) → `NaN`/`[]` après collecte → la ligne
  restait « incomplète » **indéfiniment** → boucle de refetch à chaque
  événement (spam 400 console). Branch `many2many` dédié ajouté ; un
  tableau reçu sur un champ many2one est ignoré définitivement (plus
  jamais de `"undefined"` écrit dans le DOM).
- **tax_id (vente) / taxes_id (achat) sont des many2one UNIQUE en Odoo
  17** : les backfills les remplissaient avec le tableau m2m des taxes du
  produit (même bug de boucle). → première taxe uniquement, écrite en
  `{ id, display_name }`.
- **`needsFill` des backfills de lignes** : une colonne ABSENTE de la vue
  ne rend plus la ligne « incomplète » (garde `"col" in line`) et un prix
  volontairement 0 est conservé (seul l'état vide déclenche le remplissage).
- **`getReferenceRecordsSmart` (name_service.js)** : mémo d'échec par
  modèle (TTL 5 min) — un modèle non servi par le backend (ex:
  `product.uom` → 400) n'est plus retenté à chaque événement ; un seul
  warn console, repli cache immédiat.
- **favicon.ico 404** : `<link rel="icon">` ajouté dans index.html
  (assets/icon-192.png).

#### Cas limites gérés par les backfills de lignes (taxes)
- **Taux connu + record lisible** → calcul du moteur (HT / TTC / fixe,
  multi-taxes en somme).
- **Id de taxe déclaré mais record non en cache** (offline, jamais chargée)
  → taxe inconnue : `price_tax` serveur **conservée** (jamais zéroée à
  tort), ajoutée au total ; `price_total = sous-total + taxe conservée`.
- **Colonne taxe vide** (ligne sans taxe) → `price_tax = 0`.
- **Colonne taxe absente de la vue** → taxe inconnue : valeur serveur
  conservée.
- **Idempotence** : ligne dont les montants ne changent pas → renvoyée
  telle quelle (aucun écrit DOM, aucune cascade, aucun refetch produit ni
  tax record).

#### Totaux document & pied de tableau avec taxes (v2)
La vue standard v17 ne rend PAS de colonnes `price_tax` / `price_total`
sur les lignes : le montant de taxe calculé par les règles de lignes ne
s'écrit donc dans aucun cell du tableau. Les totaux ne peuvent plus
"suivre" une colonne — ils résolvent la taxe de chaque ligne :

- **`resolveLineTax(taxIds, base, qty, serverAmounts, helpers)`**
  (rules_helpers.js) — point unique de décision :
  1. record(s) `account.tax` lisible(s) (cache d'abord, réseau ensuite,
     fetch in-flight dédoublonné) → calcul du moteur approximatif ;
  2. ids déclarés mais record(s) absent(s) du cache (hors-ligne) →
     `price_tax` **serveur** de la ligne initiale (`tr._serverData`),
     mise à l'échelle du nouveau sous-total (exact pour les taxes en %) ;
  3. aucune donnée → 0.
- **`sumLinesWithTax` / `docLinesAmounts`** — somment les lignes
  (sous-total + taxe ; lignes TTC : total = sous-total) et alimentent
  `amount_total` / `amount_tax` / `amount_untaxed` (computes de champs,
  qui reçoivent désormais le conteneur DOM en 3e argument).
- **Pied de tableau** (compute_engine.js) — même résolution : le "Total:"
  sous le tableau = Σ (sous-total + taxe). Rechargement asynchrone avec
  un seul calcul en vol à la fois.
- **`tr._serverData`** (x2many_field.js) — les données complètes initiales
  de chaque ligne (tous les champs servis, y compris non rendus) sont
  conservées sur la `<tr>` pour le repli hors-ligne.
- **Catalogue** (x2many_field.js) — une ligne créée via le catalogue
  déclenche désormais un `change` pour lancer le backfill (taxes,
  désignation, unité) ; les taxes du payload catalogue sont pré-remplies
  si fournies.
- **Idempotence** (règles de lignes) — on ne compare que les clés
  présentes dans la ligne collectée : une colonne `price_tax`/
  `price_total` absente de la vue ne fait plus bloquer la stabilisation
  de la règle.
- **`lineTaxIds(line)`** — ids de taxes de la ligne quel que soit le nom
  de colonne rendu (`tax_id` m2o, `taxes_id` m2o ou m2m, `tax_ids` m2m),
  dédoublonnés.

##### Prérequis backend (`offline_sync`, côté Odoo)
- `read_record` doit autoriser le modèle **`account.tax`** (sinon la taxe
  n'est calculable qu'une fois le record vu en cache — ou reste le repli
  "valeur serveur" hors-ligne) ;
- `read_record` sur **`product.product`** doit renvoyer `taxes_id`
  (source des taxes par défaut des nouvelles lignes).
