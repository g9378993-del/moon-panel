// Traductions pour les messages vus par les ACHETEURS (panel, boutons, DM).
// Les commandes admin restent en français. es/pt/de recyclent l'anglais
// pour l'instant (à traduire plus tard si besoin).

const en = {
  btn_get_keys: 'Get my keys',
  btn_redeem: 'Redeem a key',
  btn_get_script: 'Get Script',
  btn_reset_hwid: 'Reset HWID',
  btn_view_script: 'View Script',
  btn_key_info: 'Key Info',
  btn_get_buyer_role: 'Get Buyer Role',
  select_product_placeholder: 'Choose a product',
  msg_no_key_owned: "You don't own any key yet.",
  msg_role_granted: '✅ Role granted! Your key will arrive shortly.',
  msg_role_already: 'ℹ️ You already have this role.',
  msg_no_role_configured: '❌ No role is configured for self-service access.',
  key_info_title: '📊 My keys',
  modal_redeem_title: 'Redeem my key',
  modal_redeem_label: 'Your key',
  modal_hwid_title: 'Reset HWID',
  modal_hwid_label: 'Your key',
  msg_blacklisted: 'You are blacklisted from this system.',
  msg_no_product_access: "You don't have access to any product yet.",
  msg_keys_sent_dm: '✅ Your keys have been sent to your DMs.',
  msg_dm_failed: "❌ Couldn't send you a DM. Check your privacy settings.",
  msg_invalid_key: '❌ Invalid key.',
  msg_key_owned_by_other: '❌ This key belongs to someone else.',
  msg_product_disabled: '🔒 This product is temporarily disabled.',
  msg_key_expired: '❌ This key has expired.',
  msg_no_script_configured: '❌ No script is configured for this product.',
  msg_script_sent_dm: '✅ Script sent to your DMs!',
  msg_no_hwid_key: '❌ Invalid key or this key has no owner yet.',
  msg_hwid_reset_success: '✅ HWID reset. You can use the script on a new device now.',
  msg_hwid_cooldown: '❌ You must wait {hours}h before resetting your HWID again.',
  msg_choose_delivery: '✅ Valid key! How do you want to receive the script?',
  btn_deliver_dm: 'Send in DM',
  btn_deliver_here: 'Show here',
  help_title: '📖 Help',
  help_user_section: 'Available to everyone',
  help_admin_section: 'Admin only',
};

const fr = {
  btn_get_keys: 'Obtenir mes clés',
  btn_redeem: 'Utiliser une clé',
  btn_get_script: 'Get Script',
  btn_reset_hwid: 'Réinitialiser HWID',
  btn_view_script: 'View Script',
  btn_key_info: 'Key Info',
  btn_get_buyer_role: 'Get Buyer Role',
  select_product_placeholder: 'Choisis un produit',
  msg_no_key_owned: "Tu ne possèdes encore aucune clé.",
  msg_role_granted: '✅ Rôle attribué ! Ta clé va arriver dans quelques instants.',
  msg_role_already: 'ℹ️ Tu as déjà ce rôle.',
  msg_no_role_configured: "❌ Aucun rôle n'est configuré pour l'accès libre-service.",
  key_info_title: '📊 Mes clés',
  modal_redeem_title: 'Utiliser ma clé',
  modal_redeem_label: 'Ta clé',
  modal_hwid_title: 'Réinitialiser HWID',
  modal_hwid_label: 'Ta clé',
  msg_blacklisted: 'Tu es sur liste noire de ce système.',
  msg_no_product_access: "Tu n'as pas encore accès à un produit.",
  msg_keys_sent_dm: '✅ Tes clés ont été envoyées en DM.',
  msg_dm_failed: "❌ Impossible de t'envoyer un DM. Vérifie tes paramètres de confidentialité.",
  msg_invalid_key: '❌ Clé invalide.',
  msg_key_owned_by_other: "❌ Cette clé appartient à quelqu'un d'autre.",
  msg_product_disabled: '🔒 Ce produit est temporairement désactivé.',
  msg_key_expired: '❌ Cette clé a expiré.',
  msg_no_script_configured: "❌ Aucun script n'est configuré pour ce produit.",
  msg_script_sent_dm: '✅ Script envoyé en DM !',
  msg_no_hwid_key: "❌ Clé invalide ou pas encore réclamée par personne.",
  msg_hwid_reset_success: '✅ HWID réinitialisé. Tu peux utiliser le script sur un nouvel appareil.',
  msg_hwid_cooldown: '❌ Tu dois attendre encore {hours}h avant de réinitialiser ton HWID.',
  msg_choose_delivery: '✅ Clé valide ! Comment veux-tu recevoir le script ?',
  btn_deliver_dm: 'Envoyer en DM',
  btn_deliver_here: 'Afficher ici',
  help_title: '📖 Aide',
  help_user_section: 'Accessible à tous',
  help_admin_section: 'Réservé aux admins',
};

const STRINGS = { en, fr, es: en, pt: en, de: en };
const SUPPORTED_LANGS = ['en', 'fr', 'es', 'pt', 'de'];

function t(lang, key, vars = {}) {
  const dict = STRINGS[lang] || STRINGS.en;
  let str = dict[key] || STRINGS.en[key] || key;
  for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

module.exports = { t, SUPPORTED_LANGS };
