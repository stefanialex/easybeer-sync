/**
 * ===============================================================
 * 01_EASYBEER_CLIENT.gs — Client Easybeer V4
 * ===============================================================
 *
 * Wrapper autour de UrlFetchApp avec :
 *   - LockService partagé (empêche double sync : trigger 6h + bouton manuel)
 *   - Retry exponentiel sur HTTP 429 et 5xx
 *   - Helpers haut niveau : fetchBrassinDetail_ / fetchEnCours_ /
 *     fetchArchivesPage_ / fetchAllBrassins_
 *   - Logging centralisé
 *
 * Toutes les requêtes vers Easybeer DOIVENT passer par easybeerFetch_.
 * Toutes les boucles qui hit Easybeer DOIVENT être enveloppées par
 * withEasybeerLock_('label', () => { ... }).
 *
 * PRÉ-REQUIS : 00_config.gs installé et testCredentialsEasybeer() OK.
 *
 * MIGRATION PROGRESSIVE :
 *   On ne remplace PAS encore les fonctions du V3 (syncEasybeerToSheet,
 *   rattrapageComplet, etc.). Elles continuent à marcher avec leur propre
 *   code de fetch. Ce module sert aux NOUVELLES fonctions V4 :
 *     - syncIncremental (étape 3)
 *     - recalculerKPIMensuelsComplet (étape 2 — n'appelle pas Easybeer)
 *   À l'étape 6, on refactorisera le V3 pour qu'il passe aussi par ici.
 */
 
/**
 * Acquiert le lock global Easybeer. Empêche la double exécution
 * de sync (trigger 6h + bouton manuel).
 *
 * Usage:
 *   withEasybeerLock_('label', function() {
 *     // ...code qui appelle Easybeer...
 *   });
 *
 * @param {string} label  Identifiant lisible pour les logs (ex: "sync-incremental")
 * @param {function} fn   Fonction à exécuter sous lock
 * @return {*} la valeur retournée par fn
 * @throws {Error} si le lock est déjà tenu après EB_LOCK_TIMEOUT_MS
 */
function withEasybeerLock_(label, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(EB_LOCK_TIMEOUT_MS)) {
    throw new Error(
      "🔒 [" + label + "] Une synchronisation Easybeer est déjà en cours. " +
      "Réessaie dans quelques minutes."
    );
  }
  // Marque qui tient le lock — pour debug
  PropertiesService.getScriptProperties().setProperty(EB_LOCK_KEY,
    label + '|' + new Date().toISOString());
  Logger.log('[LOCK] Acquis par ' + label);
  try {
    return fn();
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(EB_LOCK_KEY);
    lock.releaseLock();
    Logger.log('[LOCK] Libéré par ' + label);
  }
}
 
/**
 * Retourne info sur le lock actuel (pour debug / UI).
 */
function getEasybeerLockInfo_() {
  return PropertiesService.getScriptProperties().getProperty(EB_LOCK_KEY);
}
 
/**
 * Force le déblocage du lock (en cas de plantage qui aurait laissé
 * la propriété en l'état). À utiliser avec parcimonie.
 */
function forceReleaseEasybeerLock() {
  PropertiesService.getScriptProperties().deleteProperty(EB_LOCK_KEY);
  Logger.log('[LOCK] Force-released');
  SpreadsheetApp.getUi().alert('⚠️ Lock Easybeer force-libéré. ' +
    'Vérifie qu\'aucune autre sync ne tourne avant de relancer.');
}
 
/**
 * Fetch avec retry exponentiel sur 429/5xx. Erreur fatale sur 4xx (sauf 429).
 *
 * @param {string} url
 * @param {object} options    options UrlFetchApp.fetch (doit avoir muteHttpExceptions:true)
 * @param {string} label      pour les logs
 * @return {HTTPResponse}
 */
function easybeerFetch_(url, options, label) {
  let attempt = 0;
  while (attempt < EB_MAX_RETRIES) {
    let res;
    try {
      res = UrlFetchApp.fetch(url, options);
    } catch (netErr) {
      attempt++;
      const wait = Math.pow(2, attempt) * 1000;
      Logger.log('[EB-RETRY] ' + label + ' erreur réseau — retry ' +
                 attempt + '/' + EB_MAX_RETRIES + ' dans ' + wait + 'ms : ' + netErr.message);
      Utilities.sleep(wait);
      continue;
    }
    const code = res.getResponseCode();
    if (code === 200) return res;
    if (code === 429 || code >= 500) {
      attempt++;
      const wait = Math.pow(2, attempt) * 1000;
      Logger.log('[EB-RETRY] ' + label + ' HTTP ' + code + ' — retry ' +
                 attempt + '/' + EB_MAX_RETRIES + ' dans ' + wait + 'ms');
      Utilities.sleep(wait);
      continue;
    }
    // 4xx autre que 429 = erreur fatale (auth, 404, etc.)
    throw new Error('[EB-FETCH] ' + label + ' HTTP ' + code + ' — ' +
                    res.getContentText().substring(0, 300));
  }
  throw new Error('[EB-FETCH] ' + label + ' — ' + EB_MAX_RETRIES +
                  ' tentatives épuisées');
}
 
/**
 * Fiche détaillée d'un brassin (avec productions, ingredients, coût).
 * @param {number|string} idBrassin
 */
function fetchBrassinDetail_(idBrassin) {
  const res = easybeerFetch_(
    EB_ENDPOINTS.detail(idBrassin),
    { method: 'get', headers: getAuthHeader_(), muteHttpExceptions: true },
    'detail-' + idBrassin
  );
  return JSON.parse(res.getContentText());
}
 
/**
 * Liste des brassins EN_COURS (avec materielsAffectes).
 * Note : ce endpoint ne filtre PAS les ANNULE/DETRUIT — à filtrer côté appelant.
 */
function fetchEnCours_() {
  const res = easybeerFetch_(
    EB_ENDPOINTS.enCours,
    { method: 'post', headers: getAuthHeader_(), payload: '{}', muteHttpExceptions: true },
    'en-cours'
  );
  return JSON.parse(res.getContentText());
}
 
/**
 * Une page de /brassin/archives.
 * @param {number} numeroPage
 * @param {string} [dateDebutBrassage] ISO 8601, défaut 2021-12-31T23:00:00.000Z
 * @param {string} [dateFinBrassage]   ISO 8601, défaut 2030-12-30T23:00:00.000Z
 */
function fetchArchivesPage_(numeroPage, dateDebutBrassage, dateFinBrassage) {
  const payload = {
    etats: [],
    recherche: '',
    dateDebutBrassage: dateDebutBrassage || '2021-12-31T23:00:00.000Z',
    dateFinBrassage:   dateFinBrassage   || '2030-12-30T23:00:00.000Z'
  };
  const url = EB_ENDPOINTS.archives +
              '?numeroPage=' + numeroPage +
              '&nombreParPage=100&colonneTri=-dateDebut';
  const res = easybeerFetch_(url, {
    method: 'post', headers: getAuthHeader_(),
    payload: JSON.stringify(payload), muteHttpExceptions: true
  }, 'archives-page-' + numeroPage);
  return JSON.parse(res.getContentText());
}
 
/**
 * Récupère TOUS les brassins (archivés + en cours) déduplifiés et
 * filtrés (ANNULE/DETRUIT exclus). Respecte le rate limit.
 *
 * ⚠️ Long (10-15 min sur la base actuelle ~462 brassins archivés).
 * À envelopper avec withEasybeerLock_.
 *
 * @param {string} [dateDebut] ISO 8601 — filtre côté serveur
 * @param {string} [dateFin]   ISO 8601 — filtre côté serveur
 */
function fetchAllBrassins_(dateDebut, dateFin) {
  let all = [];
  let page = 1, total = 1;
  while (page <= total && page <= 100) {
    const data = fetchArchivesPage_(page, dateDebut, dateFin);
    if (page === 1) total = data.totalPages || 1;
    if (Array.isArray(data.liste)) all = all.concat(data.liste);
    page++;
    if (page <= total) Utilities.sleep(EB_SLEEP_LIST);
  }
  Utilities.sleep(EB_SLEEP_LIST);
  const ec = fetchEnCours_();
  if (ec.etapes) {
    ec.etapes.forEach(function(e) {
      if (e.modelesBrassins) all = all.concat(e.modelesBrassins);
    });
  }
  // Dédup + filtre ANNULE/DETRUIT
  const seen = {};
  return all.filter(function(b) {
    if (!b || !b.idBrassin || seen[b.idBrassin]) return false;
    seen[b.idBrassin] = true;
    const c = b.etat && b.etat.code;
    return c !== 'ANNULE' && c !== 'DETRUIT';
  });
}
 
/**
 * Sleep dédié pour les fetches /brassin/{id} en boucle.
 * À appeler entre chaque appel pour respecter le rate limit.
 */
function eBSleepDetail_() {
  Utilities.sleep(EB_SLEEP_DETAIL);
}
 
/**
 * Garde-fou : normalise le rendement brassage en décimal.
 * L'API renvoie en théorie un entier (99 = 99%), mais certaines saisies
 * historiques peuvent être en décimal. Cette fonction gère les deux.
 *
 * @param {number} raw  valeur brute reçue de l'API
 * @return {number} valeur décimale entre 0 et 1
 */
function normaliserRendementBrassage_(raw) {
  if (raw === undefined || raw === null) return 0;
  const v = parseFloat(raw);
  if (isNaN(v)) return 0;
  // Si > 1.5, on suppose un entier (ex: 99 → 0.99). Sinon déjà décimal.
  return v > 1.5 ? v / 100 : v;
}
