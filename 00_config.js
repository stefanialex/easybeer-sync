/**
 * ===============================================================
 * 00_CONFIG.gs — Configuration centralisée V4
 * ===============================================================
 *
 * Ce fichier REMPLACE dans ton V3 :
 *   - les lignes  const API_USER = '?';  /  const API_PASS = '?';
 *   - la fonction getAuthHeader_()
 *
 * ÉTAPE 0 — MIGRATION DES CREDENTIALS (à faire avant tout) :
 *
 *   1. Apps Script → Projet → Paramètres du projet (engrenage en bas)
 *      → Propriétés du script → Ajouter une propriété de script
 *      Ajoute DEUX propriétés :
 *        Nom : EASYBEER_USER    Valeur : <ton vrai identifiant Easybeer>
 *        Nom : EASYBEER_PASS    Valeur : <ton vrai mot de passe Easybeer>
 *      Enregistrer.
 *
 *   2. Dans ton fichier V3 actuel, SUPPRIME (ou commente) :
 *        - const API_USER = '?';
 *        - const API_PASS = '?';
 *        - la fonction getAuthHeader_() { ... } existante
 *
 *   3. Ajoute ce fichier dans le projet (Fichier → Nouveau → Script)
 *      avec le nom "00_config".
 *
 *   4. Lance la fonction testCredentialsEasybeer() depuis l'éditeur.
 *      Tu dois voir "✅ Credentials Easybeer OK (HTTP 200)".
 *
 *   5. Vérifie que ton V3 marche encore (lance "🚀 1. ACTUALISER
 *      HISTORIQUE KPI" depuis le menu).
 *
 * Ne touche à rien d'autre dans le V3 tant que cette étape n'est pas validée.
 */
 
// ========== ENDPOINTS EASYBEER ==========
const EB_BASE_URL = 'https://api.easybeer.fr';
const EB_ENDPOINTS = {
  archives: EB_BASE_URL + '/brassin/archives',
  enCours:  EB_BASE_URL + '/brassin/en-cours',
  detail:   function(id) { return EB_BASE_URL + '/brassin/' + id; }
};
 
// ========== RATE LIMIT EASYBEER ==========
const EB_SLEEP_LIST   = 1500;  // ms entre pages /archives
const EB_SLEEP_DETAIL = 2000;  // ms entre fiches détaillées /brassin/{id}
const EB_MAX_RETRIES  = 4;     // retries sur 429/5xx (backoff exponentiel)
 
// ========== LOCK ==========
const EB_LOCK_TIMEOUT_MS = 5000;   // attente max pour le lock global Easybeer
const EB_LOCK_KEY        = 'EASYBEER_LOCK_HOLDER';
 
// ========== ONGLETS V4 ==========
const KPI_MENSUELS_SHEET = 'KPI_MENSUELS';
 
// ========== AUTH ==========
/**
 * Charge les credentials depuis Script Properties.
 * Lève une erreur claire si manquants.
 */
function getEasybeerCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('EASYBEER_USER');
  const pass = props.getProperty('EASYBEER_PASS');
  if (!user || !pass) {
    throw new Error(
      "❌ Credentials Easybeer manquants.\n\n" +
      "Configure-les dans :\n" +
      "  Projet → Paramètres → Propriétés du script :\n" +
      "    EASYBEER_USER = <ton identifiant>\n" +
      "    EASYBEER_PASS = <ton mot de passe>\n\n" +
      "Puis relance la fonction."
    );
  }
  return { user: user, pass: pass };
}
 
/**
 * Header d'auth Basic Auth pour Easybeer.
 * REMPLACE l'ancien getAuthHeader_() de ton V3 (à supprimer côté V3).
 */
function getAuthHeader_() {
  const c = getEasybeerCredentials_();
  return {
    "Authorization": "Basic " + Utilities.base64Encode(c.user + ':' + c.pass),
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
}
 
/**
 * Test rapide à exécuter après config Script Properties.
 * Sélectionne cette fonction dans l'éditeur Apps Script et lance "Exécuter".
 */
function testCredentialsEasybeer() {
  const ui = SpreadsheetApp.getUi();
  try {
    const headers = getAuthHeader_();
    const res = UrlFetchApp.fetch(EB_ENDPOINTS.enCours, {
      method: 'post', headers: headers, payload: '{}', muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) {
      ui.alert("✅ Credentials Easybeer OK (HTTP 200).\n\n" +
               "Tu peux passer à l'étape suivante.");
    } else if (code === 401 || code === 403) {
      ui.alert("❌ Easybeer HTTP " + code + " — credentials invalides.\n\n" +
               "Vérifie EASYBEER_USER et EASYBEER_PASS dans Propriétés du script.");
    } else {
      ui.alert("⚠️ Easybeer HTTP " + code + "\n\n" +
               res.getContentText().substring(0, 500));
    }
  } catch (e) {
    ui.alert("❌ " + e.message);
  }
}