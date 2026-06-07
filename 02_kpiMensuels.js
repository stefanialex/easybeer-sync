/**
 * ===============================================================
 * 02_KPI_MENSUELS.gs — Onglet KPI_MENSUELS (agrégats mensuels figés)
 * ===============================================================
 *
 * Lecture seule sur HISTORIQUE_KPI (+ onglets manuels SECURITE / ENERGIE).
 * Écrit dans KPI_MENSUELS (créé automatiquement).
 * NE FAIT AUCUN APPEL EASYBEER — pas besoin de lock.
 *
 * 2 modes :
 *   - recalculerKPIMensuelsComplet() : reconstruit toute la table
 *     depuis le 1er mois de HISTORIQUE_KPI. À lancer 1× au bootstrap
 *     et après toute correction massive (rattrapage, fix dates).
 *   - recalculerKPIMensuels(N) : recalcule UNIQUEMENT les N derniers
 *     mois (par défaut 3). C'est ce que le trigger quotidien appellera.
 *
 * 28 colonnes (cf. HANDOFF section 11.1 — Vol Se Canto Blonde/IPA/Blanche
 * éclatés en 3 colonnes pour cohérence avec HISTORIQUE_KPI).
 *
 * PRÉ-REQUIS :
 *   - HISTORIQUE_KPI rempli (V3 OK)
 *   - Onglets SECURITE et ENERGIE créés via creerOngletsManuel() du V3
 *     (les colonnes manuelles sont vides au début, c'est normal).
 */
 
const KPI_MENSUELS_HEADERS = [
  'Mois Clé',                          // 1   "YYYY-MM" clé primaire
  'Mois Label',                        // 2   "Mai 2026"
  'Année',                             // 3
  'Nb Brassins Total',                 // 4
  'Nb Brassins Archivés',              // 5
  'Vol Brassé Total (HL)',             // 6
  'Vol Conditionné Total (HL)',        // 7
  'Vol Théorique Total (HL)',          // 8
  'Vol Fruits Ajoutés (HL)',           // 9
  'Rendement Global (%)',              // 10  KPI métier 2.2
  'Rendement Brassage Moyen (%)',      // 11  KPI vital 1
  'Taux Perte Moyen (%)',              // 12  KPI vital 2
  'Batch RFT (%)',                     // 13  KPI vital 3
  'Respect Planning (%)',              // 14  KPI vital 4 (manuel)
  'Coût Matière / HL (€)',             // 15  KPI vital 5
  'TF1 Sécurité',                      // 16  KPI vital 6 (depuis SECURITE)
  'Ratio Eau (L/L)',                   // 17  niveau 3 (depuis ENERGIE)
  'Économie Levure Cumul (€)',         // 18
  'Nb Brassins Repitch',               // 19
  'Nb Brassins Fruités',               // 20
  'Vol Se Canto Total (HL)',           // 21
  'Vol Se Canto Blonde (HL)',          // 22
  'Vol Se Canto IPA (HL)',             // 23
  'Vol Se Canto Blanche (HL)',         // 24
  'Occupation Cuve Moyenne (j)',       // 25
  'Top Marque',                        // 26
  'Top Style',                         // 27
  'Date Calcul'                        // 28
];
 
// ============================================================
// HELPERS
// ============================================================
 
/** Crée l'onglet KPI_MENSUELS s'il n'existe pas, écrit les headers. */
function ensureKPIMensuelsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(KPI_MENSUELS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_MENSUELS_SHEET);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(KPI_MENSUELS_HEADERS);
    sheet.getRange(1, 1, 1, KPI_MENSUELS_HEADERS.length)
         .setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
 
/** "2026-05" depuis une Date (ou null si invalide). */
function moisCleFromDate_(d) {
  if (!d) return null;
  const dd = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dd.getTime())) return null;
  return dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0');
}
 
/** "Mai 2026" depuis une clé "2026-05". */
function moisLabelFromCle_(cle) {
  const parts = cle.split('-').map(Number);
  return MOIS_FR[parts[1] - 1] + ' ' + parts[0];
}
 
/** Top du dictionnaire { name: count } → "Prizm Fixe (8)" ou "-". */
function topDictKPI_(dict) {
  let topName = '-', topN = 0;
  Object.keys(dict).forEach(function(k) {
    if (dict[k] > topN) { topName = k; topN = dict[k]; }
  });
  return topN > 0 ? topName + ' (' + topN + ')' : '-';
}
 
// ============================================================
// AGRÉGATION HISTORIQUE_KPI → buckets mensuels
// ============================================================
 
/**
 * Parse HISTORIQUE_KPI et groupe par mois (clé YYYY-MM via Date Condi Réelle).
 * Retourne un objet { 'YYYY-MM': { ...agrégats... } }
 */
function aggregerHistoriqueParMois_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) throw new Error('Onglet ' + PROD_SHEET + ' introuvable.');
  const lastRow = src.getLastRow();
  if (lastRow < 2) return {};
 
  const data = src.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach(function(h, i) { idx[String(h).trim()] = i; });
 
  const buckets = {};
 
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
 
    // Date de référence = Date Condi Réelle, fallback Date Condi
    const dRef = row[idx['Date Condi Réelle']] || row[idx['Date Condi']];
    if (!dRef) continue;
    const cle = moisCleFromDate_(dRef);
    if (!cle) continue;
 
    const statut = String(row[idx['Statut']] || '');
    const isArchive = statut.toLowerCase().indexOf('archiv') >= 0;
 
    const vBrasse = parseValSafe_(row[idx['Vol. Brassé (HL)']]);
    const vTheo   = parseValSafe_(row[idx['Vol. Batch Théo']]);
    const vCondi  = parseValSafe_(row[idx['Vol. Condi (HL)']]);
    const vFruits = parseValSafe_(row[idx['Vol Fruits Ajouté (HL)']]);
    const rdtBr   = parseValSafe_(row[idx['Rendement Brassage']]);
    const perte   = parseValSafe_(row[idx['Taux Perte (%)']]);
    const coutHL  = parseValSafe_(row[idx['Coût / HL (€)']]);
    const conf    = String(row[idx['Conforme']] || 'O').toUpperCase().trim();
    const occ     = parseValSafe_(row[idx['Jours Occupation']]);
    const eco     = parseValSafe_(row[idx['Économie (€)']]);
    const levure  = String(row[idx['Levure Neuve']] || '-').trim();
    const marque  = String(row[idx['Marque']] || '-');
    const style   = String(row[idx['Style']] || '-');
    const scTot   = parseValSafe_(row[idx['Vol Se Canto (HL)']]);
    const scBl    = parseValSafe_(row[idx['Vol Se Canto Blonde (HL)']]);
    const scIp    = parseValSafe_(row[idx['Vol Se Canto IPA (HL)']]);
    const scBlh   = parseValSafe_(row[idx['Vol Se Canto Blanche (HL)']]);
 
    if (!buckets[cle]) {
      buckets[cle] = {
        nbTotal: 0, nbArch: 0,
        // Volumes "tous brassins" (archivés + en cours) — pour affichage volumétrique
        vBrasse: 0, vCondi: 0, vTheo: 0, vFruits: 0,
        // Volumes "fini-only" (archivés uniquement) — pour calcul du Rendement Global
        vBrasseFini: 0, vCondiFini: 0, vTheoFini: 0, vFruitsFini: 0,
        rdtBrSum: 0, rdtBrN: 0,
        perteSum: 0, perteN: 0,
        coutHLSum: 0, coutHLN: 0,
        conformeOK: 0, conformeKO: 0,
        ecoEur: 0, nbRepitch: 0,
        nbFruites: 0,
        scTot: 0, scBl: 0, scIp: 0, scBlh: 0,
        occSum: 0, occN: 0,
        marques: {}, styles: {}
      };
    }
    const b = buckets[cle];
 
    b.nbTotal++;
    // Volumes affichés : on agrège pour TOUS les brassins du mois (archivés + en cours).
    // C'est ce qui permet de retrouver les ~971 HL d'avril 2026 incluant les conditions
    // partielles des brassins encore en cours.
    b.vBrasse += vBrasse;
    b.vCondi  += vCondi;
    b.vTheo   += vTheo;
    b.vFruits += vFruits;
 
    if (isArchive) {
      b.nbArch++;
      // Volumes "fini-only" pour le calcul du Rendement Global (sinon biaisé par
      // les brassins en cours qui ont un théorique sans conditionnement final).
      b.vBrasseFini += vBrasse;
      b.vCondiFini  += vCondi;
      b.vTheoFini   += vTheo;
      b.vFruitsFini += vFruits;
      if (rdtBr > 0)  { b.rdtBrSum += rdtBr; b.rdtBrN++; }
      if (perte > 0)  { b.perteSum += perte; b.perteN++; }
      if (coutHL > 0) { b.coutHLSum += coutHL; b.coutHLN++; }
      if (conf === 'O')      b.conformeOK++;
      else if (conf === 'N') b.conformeKO++;
      // Repitch détecté quand Levure Neuve est vide ou '-'
      if (!levure || levure === '-') {
        b.nbRepitch++;
        b.ecoEur += eco;
      }
    }
    if (vFruits > 0) b.nbFruites++;
    if (occ > 0) { b.occSum += occ; b.occN++; }
    b.scTot += scTot;
    b.scBl  += scBl;
    b.scIp  += scIp;
    b.scBlh += scBlh;
    if (marque && marque !== '-') b.marques[marque] = (b.marques[marque] || 0) + 1;
    if (style  && style  !== '-') b.styles[style]   = (b.styles[style]   || 0) + 1;
  }
 
  return buckets;
}
 
// ============================================================
// LECTURE ONGLETS MANUELS (SECURITE / ENERGIE)
// ============================================================
 
/**
 * Lit l'onglet SECURITE → map { 'YYYY-MM': TF1 }.
 * TF1 = (Nb incidents × 10⁶) / heures travaillées.
 * Si l'onglet n'existe pas ou est vide, retourne {} (KPI laissé blanc).
 */
function lireTF1Securite_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SECURITE_SHEET);
  if (!sh || sh.getLastRow() < 4) return {};
 
  // Layout V3 : ligne 1 titre fusionné, ligne 2 vide, ligne 3 headers, ligne 4+ data
  const data = sh.getRange(3, 1, sh.getLastRow() - 2, 6).getValues();
  const idx = {};
  data[0].forEach(function(h, i) { idx[String(h).trim()] = i; });
 
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const moisLib = String(data[r][idx['Mois']] || '').trim();
    const annee = parseValSafe_(data[r][idx['Année']]);
    const heures = parseValSafe_(data[r][idx['Heures travaillées']]);
    const incidents = parseValSafe_(data[r][idx['Nb incidents']]);
    if (!moisLib || !annee || heures <= 0) continue;
    const mIdx = MOIS_FR.indexOf(moisLib);
    if (mIdx < 0) continue;
    const cle = annee + '-' + String(mIdx + 1).padStart(2, '0');
    map[cle] = (incidents * 1e6) / heures;
  }
  return map;
}
 
/**
 * Lit l'onglet ENERGIE → map { 'YYYY-MM': ratioEau (L eau / L bière) }.
 * Eau en m³ → ×1000 L. Bière conditionnée en HL → ×100 L.
 *
 * @param {object} buckets  buckets mensuels (besoin du Vol Condi pour le ratio)
 */
function lireRatioEau_(buckets) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ENERGIE_SHEET);
  if (!sh || sh.getLastRow() < 4) return {};
 
  const data = sh.getRange(3, 1, sh.getLastRow() - 2, 6).getValues();
  const idx = {};
  data[0].forEach(function(h, i) { idx[String(h).trim()] = i; });
 
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const moisLib = String(data[r][idx['Mois']] || '').trim();
    const annee = parseValSafe_(data[r][idx['Année']]);
    const eauM3 = parseValSafe_(data[r][idx['Eau (m³)']]);
    if (!moisLib || !annee || eauM3 <= 0) continue;
    const mIdx = MOIS_FR.indexOf(moisLib);
    if (mIdx < 0) continue;
    const cle = annee + '-' + String(mIdx + 1).padStart(2, '0');
    const bucket = buckets[cle];
    if (!bucket || bucket.vCondi <= 0) continue;
    map[cle] = (eauM3 * 1000) / (bucket.vCondi * 100);
  }
  return map;
}
 
// ============================================================
// CONSTRUCTION LIGNES + ÉCRITURE
// ============================================================
 
/** Construit la ligne KPI_MENSUELS pour un bucket donné. */
function bucketToRow_(cle, b, tf1Map, eauMap) {
  // Rendement Global = vol conditionné / (vol théorique + vol fruits), sur ARCHIVÉS uniquement
  // (sinon biaisé par les brassins en cours qui ont théorique > 0 mais condi partiel).
  const vTheoCorrigeFini = b.vTheoFini + b.vFruitsFini;
  const rdtGlobal        = vTheoCorrigeFini > 0 ? b.vCondiFini / vTheoCorrigeFini : 0;
  const rdtBrMoy     = b.rdtBrN > 0 ? b.rdtBrSum / b.rdtBrN : 0;
  const perteMoy     = b.perteN > 0 ? b.perteSum / b.perteN : 0;
  const coutHLMoy    = b.coutHLN > 0 ? b.coutHLSum / b.coutHLN : 0;
  const rft          = (b.conformeOK + b.conformeKO) > 0
                       ? b.conformeOK / (b.conformeOK + b.conformeKO) : 0;
  const occMoy       = b.occN > 0 ? b.occSum / b.occN : 0;
  const annee        = parseInt(cle.split('-')[0]);
 
  return [
    cle,
    moisLabelFromCle_(cle),
    annee,
    b.nbTotal,
    b.nbArch,
    b.vBrasse,
    b.vCondi,
    b.vTheo,
    b.vFruits,
    rdtGlobal,
    rdtBrMoy,
    perteMoy,
    rft,
    '',                                              // Respect Planning — manuel (laissé vide)
    coutHLMoy,
    tf1Map[cle] !== undefined ? tf1Map[cle] : '',
    eauMap[cle] !== undefined ? eauMap[cle] : '',
    b.ecoEur,
    b.nbRepitch,
    b.nbFruites,
    b.scTot,
    b.scBl,
    b.scIp,
    b.scBlh,
    occMoy,
    topDictKPI_(b.marques),
    topDictKPI_(b.styles),
    new Date()
  ];
}
 
/** Applique les formats numériques sur l'onglet (à appeler après écriture). */
function appliquerFormatsKPIMensuels_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const n = last - 1;
 
  // HL
  [6, 7, 8, 9, 21, 22, 23, 24].forEach(function(c) {
    sheet.getRange(2, c, n, 1).setNumberFormat('#,##0.0 "HL"');
  });
  // %
  [10, 11, 12, 13, 14].forEach(function(c) {
    sheet.getRange(2, c, n, 1).setNumberFormat('0.0%');
  });
  // €
  [15, 18].forEach(function(c) {
    sheet.getRange(2, c, n, 1).setNumberFormat('#,##0 "€"');
  });
  // TF1 + Ratio Eau (2 décimales)
  sheet.getRange(2, 16, n, 1).setNumberFormat('0.00');
  sheet.getRange(2, 17, n, 1).setNumberFormat('0.00');
  // Entiers
  [3, 4, 5, 19, 20].forEach(function(c) {
    sheet.getRange(2, c, n, 1).setNumberFormat('0');
  });
  // Occupation
  sheet.getRange(2, 25, n, 1).setNumberFormat('0.0 "j"');
  // Date Calcul
  sheet.getRange(2, 28, n, 1).setNumberFormat('dd/mm/yyyy HH:mm');
}
 
// ============================================================
// FONCTIONS PUBLIQUES
// ============================================================
 
/**
 * BOOTSTRAP : recalcule tous les mois depuis HISTORIQUE_KPI.
 * Écrase entièrement KPI_MENSUELS (sauf la ligne header).
 *
 * À lancer 1× au démarrage et après corrections massives
 * (rattrapage, fix dates, etc.).
 */
function recalculerKPIMensuelsComplet() {
  const t0 = new Date().getTime();
  const ui = SpreadsheetApp.getUi();
  const sheet = ensureKPIMensuelsSheet_();
 
  const buckets = aggregerHistoriqueParMois_();
  const tf1Map = lireTF1Securite_();
  const eauMap = lireRatioEau_(buckets);
 
  const cles = Object.keys(buckets).sort();
  if (cles.length === 0) {
    ui.alert('⚠️ HISTORIQUE_KPI vide ou sans dates valides.');
    return;
  }
 
  const rows = cles.map(function(cle) {
    return bucketToRow_(cle, buckets[cle], tf1Map, eauMap);
  });
 
  // Clear contenu sauf header
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, KPI_MENSUELS_HEADERS.length)
         .clearContent();
  }
  sheet.getRange(2, 1, rows.length, KPI_MENSUELS_HEADERS.length).setValues(rows);
  appliquerFormatsKPIMensuels_(sheet);
 
  const dur = Math.round((new Date().getTime() - t0) / 1000);
  Logger.log('[KPI_MENSUELS] Bootstrap : ' + rows.length + ' mois en ' + dur + 's.');
  ui.alert('✅ KPI_MENSUELS recalculé : ' + rows.length + ' mois (en ' + dur + 's).');
}
 
/**
 * Recalcule UNIQUEMENT les N derniers mois (par défaut 3).
 * Utilisé par le trigger quotidien.
 *
 * @param {number} [nbMois=3]
 */
function recalculerKPIMensuels(nbMois) {
  const n = nbMois || 3;
  const t0 = new Date().getTime();
  const sheet = ensureKPIMensuelsSheet_();
 
  const buckets = aggregerHistoriqueParMois_();
  const tf1Map = lireTF1Securite_();
  const eauMap = lireRatioEau_(buckets);
 
  // Génère les N derniers mois cibles
  const now = new Date();
  const cibles = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    cibles.push(moisCleFromDate_(d));
  }
 
  // Lit les existants (clé → numéro de ligne)
  const last = sheet.getLastRow();
  const existants = {};
  if (last > 1) {
    const data = sheet.getRange(2, 1, last - 1, KPI_MENSUELS_HEADERS.length).getValues();
    data.forEach(function(row, i) {
      if (row[0]) existants[row[0]] = i + 2;
    });
  }
 
  let nbMaj = 0, nbAjout = 0;
  cibles.forEach(function(cle) {
    const b = buckets[cle];
    if (!b) return; // pas de données ce mois → skip
    const row = bucketToRow_(cle, b, tf1Map, eauMap);
    if (existants[cle]) {
      sheet.getRange(existants[cle], 1, 1, KPI_MENSUELS_HEADERS.length).setValues([row]);
      nbMaj++;
    } else {
      sheet.appendRow(row);
      nbAjout++;
    }
  });
 
  // Re-trie par mois clé ascendant après ajouts
  if (nbAjout > 0 && sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, KPI_MENSUELS_HEADERS.length)
         .sort({ column: 1, ascending: true });
  }
 
  appliquerFormatsKPIMensuels_(sheet);
  const dur = Math.round((new Date().getTime() - t0) / 1000);
  Logger.log('[KPI_MENSUELS] Recalcul ' + n + ' mois : ' +
             nbMaj + ' MAJ, ' + nbAjout + ' ajouts en ' + dur + 's.');
}
 
/**
 * Test rapide : recalcule juste le mois courant.
 * À lancer depuis l'éditeur pour vérifier que tout marche après bootstrap.
 */
function testKPIMensuelsMoisCourant() {
  recalculerKPIMensuels(1);
  SpreadsheetApp.getUi().alert(
    '✅ Recalcul mois courant terminé.\n' +
    'Vérifie l\'onglet KPI_MENSUELS — dernière ligne mise à jour.'
  );
}
 
/**
 * À ajouter au menu plus tard (étape 6).
 * Fonction wrapper pour le trigger quotidien : sync + recalcul 3 mois.
 * Pour l'instant, à appeler manuellement après une sync.
 */
function syncEtRecalculerMensuels() {
  // À étape 6, on appellera ici syncIncremental() puis recalculerKPIMensuels(3)
  // Pour l'instant, juste le recalcul (la sync reste celle du V3).
  recalculerKPIMensuels(3);
}