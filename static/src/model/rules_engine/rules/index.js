/**
 * model/rules_engine/rules/index.js
 * ====================================
 * Agrège toutes les règles du projet et les expose comme `allRules`,
 * à passer une seule fois à initRulesEngine() au démarrage de l'app
 * (voir main.js).
 */

import { purchaseOrderLineRules, purchaseOrderRules } from "./purchase_order.js";
import { saleOrderLineRules, saleOrderRules } from "./sale_order.js";
import { accessRules } from "./access_rules.js";
import { domainRules } from "./domain_rules.js";
import { defaultRules } from "./default_rules.js";
import { genericLineAmountRules } from "./generic_rules.js";
import { stockPickingRules } from "./stock_rules.js";

export const allRules = [
  ...purchaseOrderLineRules,
  ...purchaseOrderRules,
  ...saleOrderLineRules,
  ...saleOrderRules,
  ...accessRules,
  ...domainRules,
  ...defaultRules,
  ...genericLineAmountRules,
  ...stockPickingRules,
];
