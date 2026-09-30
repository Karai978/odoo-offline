/**
 * business_rules/sale_order_rules.js
 * ====================================
 * Règles métier "sale.order" pour le moteur offline — équivalent JS
 * explicite d'onchange/compute Python enregistrés dans business_rules_registry.js.
 * Importé une seule fois au démarrage dans main.js.
 */
import { onchangeRegistry, constraintsRegistry } from "../model/relational_model/business_rules_registry.js";

// Équivalent de l'onchange partner_id -> payment_term_id
onchangeRegistry.add("sale.order:partner_id", async (partnerId, values, { getRecordSmart, getReferenceRecordsSmart, apiKey, baseUrl }) => {
  if (!partnerId) return null;

  const partner = await getRecordSmart("res.partner", partnerId, apiKey, baseUrl);
  if (!partner?.property_payment_term_id) return null;

  const terms = await getReferenceRecordsSmart("account.payment.term", apiKey, baseUrl);
  const term = terms.find((t) => t.id === partner.property_payment_term_id);
  if (!term) { return null; }

  return { payment_term_id: { id: term.id, display_name: term.display_name } };
});

async function computeValidityDate(_changedValue, values, { getRecordSmart, apiKey, baseUrl }) {
  if (values.sale_order_template_id) {
    const template = await getRecordSmart("sale.order.template", values.sale_order_template_id, apiKey, baseUrl);
    if (template?.number_of_days > 0) {
      const target = new Date();
      target.setDate(target.getDate() + template.number_of_days);
      return { validity_date: target.toISOString().slice(0, 10) };
    }
  }

  if (values.company_id) {
    const company = await getRecordSmart("res.company", values.company_id, apiKey, baseUrl);
    if (company?.quotation_validity_days > 0) {
      const target = new Date();
      target.setDate(target.getDate() + company.quotation_validity_days);
      return { validity_date: target.toISOString().slice(0, 10) };
    }
  }

  return { validity_date: null };
}

constraintsRegistry.add("sale.order", (values) => {
  if (values.commitment_date && values.date_order && values.commitment_date < values.date_order) {
    return "La date d'engagement ne peut pas être antérieure à la date de commande.";
  }
  return null;
});

onchangeRegistry.add("sale.order:sale_order_template_id#validity_date", computeValidityDate);
onchangeRegistry.add("sale.order:company_id#validity_date", computeValidityDate);

/**
 * Équivalent de _compute_require_signature (sale + sale_management) :
 * 1. Si sale_order_template_id défini -> require_signature = template.require_signature
 * 2. Sinon -> require_signature = company_id.portal_confirmation_sign
 */
async function computeRequireSignature(_changedValue, values, { getRecordSmart, apiKey, baseUrl }) {
  if (values.sale_order_template_id) {
    const template = await getRecordSmart("sale.order.template", values.sale_order_template_id, apiKey, baseUrl);
    if (template) {
      return { require_signature: !!template.require_signature };
    }
  }

  if (values.company_id) {
    const company = await getRecordSmart("res.company", values.company_id, apiKey, baseUrl);
    if (company) {
      return { require_signature: !!company.portal_confirmation_sign };
    }
  }

  return null;
}

onchangeRegistry.add("sale.order:sale_order_template_id#require_signature", computeRequireSignature);
onchangeRegistry.add("sale.order:company_id#require_signature", computeRequireSignature);