/**
 * ============================================================================
 * EASYBEER SYNC — Brasserie Liquid Art
 * ============================================================================
 *
 * Script Google Apps Script de synchronisation et de pilotage de la production.
 * Récupère les brassins depuis l'API Easybeer (https://api.easybeer.fr) et
 * alimente un Google Sheet avec KPI mensuels + dashboard.
 *
 * VERSION       : 3.1 (V3 + extension KPI_MENSUELS)
 * LICENCE       : Privée (brasserie Liquid Art)
 *
 * INSTALLATION :
 *   1. Crée un projet Apps Script lié à ton Google Sheet
 *   2. Colle ce fichier
 *   3. Remplace API_USER et API_PASS (lignes ~30) par tes vrais identifiants
 *   4. Ajuste les constantes configurables (ECONOMIE_LEVURE_BATCH, seuils)
 *   5. Sauvegarde et recharge le Sheet (F5)
 *   6. Suis l'ordre d'exécution dans le commentaire de tête
 *
 * STRUCTURE :
 *   - HISTORIQUE_KPI : onglet principal, 1 ligne par brassin (31 colonnes)
 *   - KPI_MENSUELS   : agrégation mensuelle (28 colonnes)
 *   - DASHBOARD      : vue synthétique avec graphiques
 *   - ETAT_CAVE      : matériel en cours (généré à la demande)
 *   - QUALITE / SECURITE / ENERGIE : onglets de saisie manuelle
 *
 * SÉCURITÉ :
 *   Les identifiants API_USER et API_PASS sont SENSIBLES. Ne JAMAIS pousser
 *   ce fichier avec les vraies valeurs sur un dépôt public. Utiliser
 *   PropertiesService.getScriptProperties() en production.
 *
 * ============================================================================
 */


// ============================================================
// IDENTIFIANTS API
// ============================================================
const API_USER = 'TON_USER_ICI';
const API_PASS = 'TON_PASSWORD_ICI';

// ============================================================
// CONSTANTES CONFIGURABLES
// ============================================================
// Économie d'une bière qui repitch une levure (en €) par taille de batch.
// MODIFIE ces valeurs avec tes vraies données.
const ECONOMIE_LEVURE_BATCH = {
  2: 40,
  5: 80,
  25: 300,   // ← estimation, à ajuster
  50: 600,
  100: 1000
};

const ANNEE_DEBUT_STATS = 2024;
const SEUIL_VOL_HL_REUSSI = 850;
const SEUIL_RDT_REUSSI = 0.88;
const SEUIL_PERTE_OBJECTIF = 0.12;  // 12% objectif perte craft

// ============================================================
// CONSTANTES TECHNIQUES
// ============================================================
const PROD_SHEET = 'HISTORIQUE_KPI';
const DASH_SHEET = 'DASHBOARD';
const CAVE_SHEET = 'ETAT_CAVE';
const QUALITE_SHEET = 'QUALITE';
const SECURITE_SHEET = 'SECURITE';
const ENERGIE_SHEET = 'ENERGIE';
const PROD_SLEEP_LIST = 1500;
const PROD_SLEEP_DETAIL = 2000;
const PROD_MAX_DETAIL_ENCOURS = 50;
const PROD_RATTRAP_BATCH = 120;
const RATTRAP_PROP_KEY = 'RATTRAP_COMPLET_CHECKPOINT';
const RATTRAP_SECANTO_KEY = 'RATTRAP_SECANTO_CHECKPOINT';
const DENSITE_PUREE_FRUITS = 1.11;

const PROD_HEADERS = [
  'Mois','Année','Lot','Statut','Bière','Marque',
  'Date Début','Date Condi','Jours Occupation',
  'Vol. Brassé (HL)','Vol. Batch Théo','Vol. Condi (HL)','Rendement',
  'DI','DF','PH','Levure Neuve','Économie (€)',
  'ID Brassin','Date Condi Réelle',
  'Style','Vol Fruits Ajouté (HL)',
  'Vol Se Canto (HL)','Vol Se Canto Blonde (HL)','Vol Se Canto IPA (HL)','Vol Se Canto Blanche (HL)',
  'Rendement Brassage','Coût Total (€)','Coût / HL (€)','Taux Perte (%)','Conforme'
];

const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin",
                 "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const ETATS_EXCLUS = ['ANNULE', 'DETRUIT'];

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🍺 Easybeer API')
    .addItem('🚀 1. ACTUALISER HISTORIQUE KPI', 'syncEasybeerToSheet')
    .addItem('🩹 1bis. Rattraper dates manquantes', 'rattrapageDatesManquantes')
    .addItem('🔄 1ter. Rattrapage complet', 'rattrapageComplet')
    .addItem('🍋 1quater. Rattrapage Se Canto', 'rattrapageSeCanto')
    .addItem('🗓 Corriger Mois/Année', 'corrigerMoisAnnee')
    .addItem('♻️  Reset rattrapage complet', 'resetRattrapage')
    .addItem('♻️  Reset rattrapage Se Canto', 'resetRattrapageSeCanto')
    .addItem('🛠 Corriger rendements (sans API)', 'corrigerRendements')
    .addSeparator()
    .addItem('📊 2. GÉNÉRER DASHBOARD', 'actualiserDashboard')
    .addItem('🏭 3. ÉTAT CAVE', 'etatCaveActuel')
    .addItem('📦 Créer onglets manuels (1x)', 'creerOngletsManuel')
    .addSeparator()
    .addItem('⏰ Programmer sync auto quotidienne', 'creerTriggerQuotidien')
    .addItem('⏹  Supprimer triggers', 'supprimerTriggers')
    .addToUi();
}

// ============================================================
// HELPERS
// ============================================================
function getAuthHeader_() {
  return {
    "Authorization": "Basic " + Utilities.base64Encode(API_USER + ':' + API_PASS),
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
}

function calculBatchTheorique_(vBrasseHL) {
  if (vBrasseHL <= 0) return 0;
  if (vBrasseHL >= 90) return 100;
  if (vBrasseHL >= 45) return 50;
  if (vBrasseHL >= 15) return 25;
  if (vBrasseHL >= 5) return 5;
  if (vBrasseHL >= 1) return 2;
  return 0;
}

function calculEconomieLevure_(batchHL) {
  if (ECONOMIE_LEVURE_BATCH[batchHL] !== undefined) return ECONOMIE_LEVURE_BATCH[batchHL];
  return Math.round(batchHL * 10); // Fallback : 10€/HL linéaire
}

function libelleStatut_(etatCode, termine) {
  if (etatCode === 'TERMINE') return 'Archivé';
  if (etatCode === 'EN_COURS') return 'En cours';
  if (etatCode === 'PLANIFIE') return 'Planifié';
  return termine ? 'Archivé' : 'En cours';
}

function analyserIngredients_(ingredients) {
  const result = { levure: '-', volFruitsHL: 0 };
  if (!ingredients || !Array.isArray(ingredients)) return result;
  const levures = [];
  let totalKgFruits = 0;
  ingredients.forEach(ing => {
    const mp = ing.matierePremiere || {};
    const t = mp.type || {};
    const code = t.code || '';
    if (code === 'INGREDIENT_LEVURE') {
      const lib = mp.libelle || mp.nom || 'Levure inconnue';
      const qte = ing.quantite || '?';
      const unite = ing.unite ? ing.unite.symbole : '';
      const lot = ing.identifiantLot ? (' lot ' + ing.identifiantLot) : '';
      levures.push(lib + ' (' + qte + ' ' + unite + ')' + lot);
    } else if (code === 'INGREDIENT_FRUIT') {
      const qte = ing.quantite || 0;
      const unite = ing.unite ? (ing.unite.symbole || '').toLowerCase() : '';
      let qteKg = qte;
      if (unite === 'g') qteKg = qte / 1000;
      else if (unite === 't') qteKg = qte * 1000;
      totalKgFruits += qteKg;
    }
  });
  result.levure = levures.length > 0 ? levures.join(' | ') : '-';
  result.volFruitsHL = totalKgFruits / DENSITE_PUREE_FRUITS / 100;
  return result;
}

function extraireVolSeCanto_(productions) {
  const result = { totalHL: 0, blondeHL: 0, ipaHL: 0, blancheHL: 0 };
  if (!productions || !Array.isArray(productions)) return result;
  productions.forEach(p => {
    const prod = p.produit || {};
    const nom = (prod.nom || prod.libelle || '').toString().toLowerCase();
    if (nom.includes('canto')) {
      const volHL = (p.volumeTotal || 0) / 100;
      result.totalHL += volHL;
      if (nom.includes('blonde') || nom.includes('lager')) result.blondeHL += volHL;
      else if (nom.includes('blanche') || nom.includes('blanc')) result.blancheHL += volHL;
      else if (nom.includes('ipa')) result.ipaHL += volHL;
    }
  });
  return result;
}

function parseValSafe_(val) {
  if (val === undefined || val === null || val === '') return 0;
  return parseFloat(val.toString().replace(/\s/g, '').replace(',', '.')) || 0;
}

function isoWeekKey_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-S' + String(weekNum).padStart(2, '0');
}

// ============================================================
// SYNC PRINCIPALE
// ============================================================
function syncEasybeerToSheet() {
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Onglet ' + PROD_SHEET + ' introuvable.');
    return;
  }

  Logger.log('[SYNC] Démarrage.');

  const memParLot = {}, memParId = {}, memExtras = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const data = sheet.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
    const idx = {};
    data[0].forEach((h, i) => idx[String(h).trim()] = i);
    const iLot = idx['Lot'];
    const iId = idx['ID Brassin'];
    if (iLot !== undefined) {
      for (let r = 1; r < data.length; r++) {
        const lot = data[r][iLot];
        if (lot) {
          memParLot[lot] = data[r].slice();
          if (iId !== undefined && data[r][iId]) memParId[String(data[r][iId])] = lot;
          memExtras[lot] = {
            levureManuelle: idx['Levure Neuve'] !== undefined ? data[r][idx['Levure Neuve']] : '-',
            eco: idx['Économie (€)'] !== undefined ? data[r][idx['Économie (€)']] : 0,
            dateCondiReelle: idx['Date Condi Réelle'] !== undefined ? data[r][idx['Date Condi Réelle']] : null,
            style: idx['Style'] !== undefined ? data[r][idx['Style']] : '',
            volFruits: idx['Vol Fruits Ajouté (HL)'] !== undefined ? data[r][idx['Vol Fruits Ajouté (HL)']] : 0,
            volSeCanto: idx['Vol Se Canto (HL)'] !== undefined ? data[r][idx['Vol Se Canto (HL)']] : 0,
            scBlonde: idx['Vol Se Canto Blonde (HL)'] !== undefined ? data[r][idx['Vol Se Canto Blonde (HL)']] : 0,
            scIPA: idx['Vol Se Canto IPA (HL)'] !== undefined ? data[r][idx['Vol Se Canto IPA (HL)']] : 0,
            scBlanche: idx['Vol Se Canto Blanche (HL)'] !== undefined ? data[r][idx['Vol Se Canto Blanche (HL)']] : 0,
            rdtBrass: idx['Rendement Brassage'] !== undefined ? data[r][idx['Rendement Brassage']] : 0,
            coutTotal: idx['Coût Total (€)'] !== undefined ? data[r][idx['Coût Total (€)']] : 0,
            coutHL: idx['Coût / HL (€)'] !== undefined ? data[r][idx['Coût / HL (€)']] : 0,
            tauxPerte: idx['Taux Perte (%)'] !== undefined ? data[r][idx['Taux Perte (%)']] : 0,
            conforme: idx['Conforme'] !== undefined ? data[r][idx['Conforme']] : 'O'
          };
        }
      }
    }
  }
  Logger.log('[SYNC] Mémoire : ' + Object.keys(memParLot).length + ' lots.');

  const auth = getAuthHeader_();

  let allBrassins = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages && page <= 100) {
    const url = 'https://api.easybeer.fr/brassin/archives?numeroPage=' + page + '&nombreParPage=100&colonneTri=-dateDebut';
    const res = UrlFetchApp.fetch(url, {
      method: 'post', headers: auth,
      payload: JSON.stringify({"etats":[],"recherche":"","dateDebutBrassage":"2021-12-31T23:00:00.000Z","dateFinBrassage":"2030-12-30T23:00:00.000Z"}),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) { Logger.log('[SYNC] ❌ Page ' + page); return; }
    const data = JSON.parse(res.getContentText());
    if (page === 1) totalPages = data.totalPages || 1;
    if (Array.isArray(data.liste)) allBrassins = allBrassins.concat(data.liste);
    page++;
    if (page <= totalPages) Utilities.sleep(PROD_SLEEP_LIST);
  }

  Utilities.sleep(PROD_SLEEP_LIST);
  const ecRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/en-cours', {
    method: 'post', headers: auth, payload: '{}', muteHttpExceptions: true
  });
  if (ecRes.getResponseCode() === 200) {
    const ecData = JSON.parse(ecRes.getContentText());
    if (ecData.etapes) ecData.etapes.forEach(eg => { if (eg.modelesBrassins) allBrassins = allBrassins.concat(eg.modelesBrassins); });
  }

  const seen = {};
  let unique = [];
  allBrassins.forEach(b => {
    if (b && b.idBrassin && !seen[b.idBrassin]) { seen[b.idBrassin] = true; unique.push(b); }
  });
  unique = unique.filter(b => { const c = b.etat && b.etat.code; return !ETATS_EXCLUS.includes(c); });
  Logger.log('[SYNC] ' + unique.length + ' après filtre.');

  const enCours = unique.filter(b => b.etat && b.etat.code === 'EN_COURS');
  const detailsParId = {};
  let nbDetails = 0;
  for (const b of enCours) {
    if (nbDetails >= PROD_MAX_DETAIL_ENCOURS) break;
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + b.idBrassin, {
      method: 'get', headers: auth, muteHttpExceptions: true
    });
    nbDetails++;
    if (detRes.getResponseCode() === 200) {
      try { detailsParId[b.idBrassin] = JSON.parse(detRes.getContentText()); } catch(e) {}
    }
  }
  Logger.log('[SYNC] Détails enrichis : ' + nbDetails);

  const lignesActualisees = {};
  const lotsRempaes = {};

  unique.forEach(b => {
    const lotNom = (b.nom || '').toString();
    if (!lotNom) return;
    const ancienLotRaw = memParId[String(b.idBrassin)];
    const ancienLot = (ancienLotRaw !== undefined && ancienLotRaw !== null) ? String(ancienLotRaw) : null;
    const lotPourMemoire = (ancienLot && ancienLot !== lotNom) ? ancienLot : lotNom;
    if (ancienLot && ancienLot !== lotNom) lotsRempaes[ancienLot] = lotNom;
    const extras = memExtras[lotPourMemoire] || {};

    const enriched = detailsParId[b.idBrassin] || b;
    const prod = enriched.produit || b.produit || {};
    const marque = (prod.categorie && prod.categorie.libelle) ? prod.categorie.libelle : '-';

    const dDebut = enriched.dateDebut ? new Date(enriched.dateDebut) : (enriched.dateDebutFormulaire ? new Date(enriched.dateDebutFormulaire) : null);

    let dCondiReelle = null;
    if (extras.dateCondiReelle) {
      dCondiReelle = new Date(extras.dateCondiReelle);
    } else if (enriched.productions && enriched.productions.length > 0) {
      const dates = enriched.productions.map(p => p.date).filter(d => d);
      if (dates.length > 0) dCondiReelle = new Date(Math.max.apply(null, dates));
    } else if (enriched.dateMiseEnBouteille) {
      dCondiReelle = new Date(enriched.dateMiseEnBouteille);
    }
    const dCondiAffichee = dCondiReelle || (enriched.dateFin ? new Date(enriched.dateFin) : null);

    let vSorti = 0;
    if (enriched.productions && enriched.productions.length > 0) {
      enriched.productions.forEach(p => { vSorti += (p.volumeTotal || 0); });
    } else { vSorti = enriched.volumeFinal || 0; }

    const vBrasseHL = (enriched.volume || 0) / 100;
    const vSortiHL = vSorti / 100;
    const vTheoHL = calculBatchTheorique_(vBrasseHL);

    const ings = (enriched.ingredients && enriched.ingredients.length > 0) ? analyserIngredients_(enriched.ingredients) : null;
    const style = (prod.type && prod.type.libelle) ? prod.type.libelle : (extras.style || '');
    const levureAuto = ings ? ings.levure : (extras.levureManuelle || '-');
    const volFruitsHL = ings ? ings.volFruitsHL : (extras.volFruits || 0);

    let sc = { totalHL: extras.volSeCanto || 0, blondeHL: extras.scBlonde || 0, ipaHL: extras.scIPA || 0, blancheHL: extras.scBlanche || 0 };
    if (enriched.productions && enriched.productions.length > 0) {
      sc = extraireVolSeCanto_(enriched.productions);
    }

    const vTheoCorrigeHL = vTheoHL + (volFruitsHL || 0);
    const rendement = vTheoCorrigeHL > 0 ? (vSortiHL / vTheoCorrigeHL) : 0;

    // Nouveaux KPI niveau 1 (depuis fiche détaillée si dispo, sinon mémoire)
    const rdtBrass = (enriched.rendementBrassin !== undefined && enriched.rendementBrassin !== null)
                     ? enriched.rendementBrassin : (extras.rdtBrass || 0);
    const coutTotal = (enriched.cout !== undefined && enriched.cout !== null && typeof enriched.cout === 'number')
                      ? enriched.cout : (extras.coutTotal || 0);
    const coutHL = vSortiHL > 0 ? (coutTotal / vSortiHL) : 0;
    const tauxPerte = vBrasseHL > 0 ? (vBrasseHL - vSortiHL) / vBrasseHL : 0;

    // Économie levure calculée auto (sauf si saisie manuelle)
    let eco = extras.eco !== undefined && extras.eco !== '' ? extras.eco : 0;
    if ((!eco || eco === 0) && levureAuto === '-' && vTheoHL > 0 && marque && !marque.match(/nolo|polygon|cider/i)) {
      eco = calculEconomieLevure_(vTheoHL);
    }

    let occupation = 0;
    if (dDebut && dCondiAffichee) {
      const j = Math.round((dCondiAffichee - dDebut) / (1000 * 60 * 60 * 24));
      if (j >= 0) occupation = j === 0 ? 1 : j;
    }

    const statut = libelleStatut_(b.etat && b.etat.code, b.termine);
    const conforme = extras.conforme || 'O';

    lignesActualisees[lotNom] = [
      dCondiAffichee ? MOIS_FR[dCondiAffichee.getMonth()] : '-',
      dCondiAffichee ? dCondiAffichee.getFullYear().toString() : '-',
      lotNom, statut,
      prod.nom || 'Inconnu', marque,
      dDebut, dCondiAffichee, occupation,
      vBrasseHL, vTheoHL, vSortiHL,
      rendement,
      enriched.densiteInitiale || 0, enriched.densiteFinale || 0, enriched.ph || 0,
      levureAuto,
      eco,
      b.idBrassin || '',
      dCondiReelle || '',
      style, volFruitsHL || 0,
      sc.totalHL || 0, sc.blondeHL || 0, sc.ipaHL || 0, sc.blancheHL || 0,
      rdtBrass / 100 || 0,  // Stocké en décimal (0.99 = 99%)
      coutTotal || 0,
      coutHL || 0,
      tauxPerte || 0,
      conforme
    ];
  });

  const lignesFinales = {};
  let nbActu = 0, nbCons = 0, nbNouv = 0;
  Object.keys(memParLot).forEach(lot => {
    if (lotsRempaes[lot]) return;
    if (lignesActualisees[lot]) { lignesFinales[lot] = lignesActualisees[lot]; nbActu++; }
    else {
      const o = memParLot[lot];
      while (o.length < PROD_HEADERS.length) o.push('');
      lignesFinales[lot] = o; nbCons++;
    }
  });
  Object.keys(lignesActualisees).forEach(lot => {
    if (!lignesFinales[lot]) { lignesFinales[lot] = lignesActualisees[lot]; nbNouv++; }
  });
  Logger.log('[SYNC] ' + nbActu + ' MAJ, ' + nbNouv + ' nouv, ' + nbCons + ' cons.');

  const finalRows = Object.values(lignesFinales);
  finalRows.sort((a, b) => {
    const da = a[7] ? new Date(a[7]).getTime() : 0;
    const db = b[7] ? new Date(b[7]).getTime() : 0;
    return db - da;
  });

  sheet.clear();
  sheet.appendRow(PROD_HEADERS);
  sheet.getRange(1, 1, 1, PROD_HEADERS.length).setFontWeight('bold').setBackground('#ead1dc');
  sheet.getRange(2, 1, finalRows.length, PROD_HEADERS.length).setValues(finalRows);

  sheet.getRange(2, 7, finalRows.length, 2).setNumberFormat('dd/mm/yyyy');
  sheet.getRange(2, 9, finalRows.length, 1).setNumberFormat('0');
  sheet.getRange(2, 10, finalRows.length, 3).setNumberFormat('#,##0.00');
  sheet.getRange(2, 13, finalRows.length, 1).setNumberFormat('0.0%');
  sheet.getRange(2, 20, finalRows.length, 1).setNumberFormat('dd/mm/yyyy');
  sheet.getRange(2, 22, finalRows.length, 5).setNumberFormat('#,##0.00');
  sheet.getRange(2, 27, finalRows.length, 1).setNumberFormat('0.0%');  // Rendement Brassage
  sheet.getRange(2, 28, finalRows.length, 2).setNumberFormat('#,##0 "€"'); // Coût Total + Coût/HL
  sheet.getRange(2, 30, finalRows.length, 1).setNumberFormat('0.0%');  // Taux Perte

  Logger.log('[SYNC] ✅ Terminé en ' + Math.round((new Date().getTime() - t0) / 1000) + ' s. ' + finalRows.length + ' lignes.');
}

// ============================================================
// RATTRAPAGE DATES MANQUANTES (fix Nov/Juillet 2024)
// Cible uniquement les brassins sans Date Condi Réelle.
// ============================================================
function rattrapageDatesManquantes() {
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);

  const queue = [];
  for (let r = 1; r < data.length; r++) {
    const id = data[r][idx['ID Brassin']];
    const dr = data[r][idx['Date Condi Réelle']];
    if (id && (!dr || dr === '')) {
      queue.push({ row: r + 1, id: id, lot: data[r][idx['Lot']] });
    }
  }
  Logger.log('[RATTRAP-DATES] Dates manquantes : ' + queue.length + ' brassins.');

  if (queue.length === 0) {
    SpreadsheetApp.getUi().alert('✅ Toutes les dates sont remplies.');
    return;
  }

  const auth = getAuthHeader_();
  let nbOk = 0, nbKO = 0;
  const updates = [];

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + item.id, {
      method: 'get', headers: auth, muteHttpExceptions: true
    });
    if (detRes.getResponseCode() !== 200) { nbKO++; continue; }
    let b;
    try { b = JSON.parse(detRes.getContentText()); } catch(e) { nbKO++; continue; }

    let dCondiReelle = null;
    if (b.productions && b.productions.length > 0) {
      const dates = b.productions.map(p => p.date).filter(d => d);
      if (dates.length > 0) dCondiReelle = new Date(Math.max.apply(null, dates));
    }
    if (!dCondiReelle && b.dateMiseEnBouteille) dCondiReelle = new Date(b.dateMiseEnBouteille);
    if (!dCondiReelle && b.dateFin) dCondiReelle = new Date(b.dateFin);
    if (!dCondiReelle) { nbKO++; continue; }

    const dDebut = b.dateDebut ? new Date(b.dateDebut) : null;
    let occupation = 0;
    if (dDebut) {
      const j = Math.round((dCondiReelle - dDebut) / (1000 * 60 * 60 * 24));
      if (j > 0) occupation = j;
      else if (j === 0) occupation = 1;
    }

    updates.push({
      row: item.row,
      mois: MOIS_FR[dCondiReelle.getMonth()],
      annee: dCondiReelle.getFullYear().toString(),
      dateCondi: dCondiReelle,
      dateCondiReelle: dCondiReelle,
      occupation: occupation
    });
    nbOk++;
    if ((i + 1) % 10 === 0) Logger.log('[RATTRAP-DATES] ' + (i + 1) + '/' + queue.length);
  }

  updates.forEach(u => {
    sheet.getRange(u.row, idx['Mois'] + 1).setValue(u.mois);
    sheet.getRange(u.row, idx['Année'] + 1).setValue(u.annee);
    sheet.getRange(u.row, idx['Date Condi'] + 1).setValue(u.dateCondi).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(u.row, idx['Date Condi Réelle'] + 1).setValue(u.dateCondiReelle).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(u.row, idx['Jours Occupation'] + 1).setValue(u.occupation);
  });

  Logger.log('[RATTRAP-DATES] ✅ ' + Math.round((new Date().getTime() - t0) / 1000) + 's. OK:' + nbOk + ' KO:' + nbKO);
  SpreadsheetApp.getUi().alert('✅ ' + nbOk + ' dates ajoutées (KO:' + nbKO + ').');
}

// ============================================================
// CORRIGER MOIS/ANNÉE depuis Date Condi Réelle
// ============================================================
function corrigerMoisAnnee() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);

  let nbC = 0, nbD = 0;
  for (let r = 1; r < data.length; r++) {
    const dr = data[r][idx['Date Condi Réelle']];
    if (!dr) continue;
    const d = new Date(dr);
    if (isNaN(d.getTime())) continue;
    const m = MOIS_FR[d.getMonth()];
    const a = d.getFullYear().toString();
    const oldM = data[r][idx['Mois']];
    const oldA = String(data[r][idx['Année']] || '');
    if (m !== oldM || a !== oldA) {
      sheet.getRange(r + 1, idx['Mois'] + 1).setValue(m);
      sheet.getRange(r + 1, idx['Année'] + 1).setValue(a);
      sheet.getRange(r + 1, idx['Date Condi'] + 1).setValue(d).setNumberFormat('dd/mm/yyyy');
      nbD++;
    }
    nbC++;
  }
  Logger.log('[FIX-MA] ' + nbC + ' vérifiées, ' + nbD + ' corrigées.');
  SpreadsheetApp.getUi().alert('✅ ' + nbD + ' corrigées sur ' + nbC + '.');
}

// ============================================================
// RATTRAPAGE COMPLET (avec rendement brassage + coût)
// ============================================================
function rattrapageComplet() {
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);

  const props = PropertiesService.getScriptProperties();
  let checkpoint = parseInt(props.getProperty(RATTRAP_PROP_KEY) || '0');

  const queue = [];
  for (let r = 1; r < data.length; r++) {
    const id = data[r][idx['ID Brassin']];
    if (id) queue.push({ row: r + 1, id: id, lot: data[r][idx['Lot']] });
  }
  Logger.log('[RATTRAP] Queue : ' + queue.length + ' | Checkpoint : ' + checkpoint);

  if (checkpoint >= queue.length) {
    Logger.log('[RATTRAP] ✅ TERMINÉ.');
    props.deleteProperty(RATTRAP_PROP_KEY);
    return;
  }

  const batch = queue.slice(checkpoint, checkpoint + PROD_RATTRAP_BATCH);
  const auth = getAuthHeader_();
  let nbOk = 0, nbKO = 0;
  const updates = [];

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + item.id, {
      method: 'get', headers: auth, muteHttpExceptions: true
    });
    if (detRes.getResponseCode() !== 200) { nbKO++; continue; }
    let b;
    try { b = JSON.parse(detRes.getContentText()); } catch(e) { nbKO++; continue; }
    if (b.etat && (b.etat.code === 'ANNULE' || b.etat.code === 'DETRUIT')) continue;

    let dCondiReelle = null;
    if (b.productions && b.productions.length > 0) {
      const dates = b.productions.map(p => p.date).filter(d => d);
      if (dates.length > 0) dCondiReelle = new Date(Math.max.apply(null, dates));
    }
    if (!dCondiReelle && b.dateMiseEnBouteille) dCondiReelle = new Date(b.dateMiseEnBouteille);
    if (!dCondiReelle && b.dateFin) dCondiReelle = new Date(b.dateFin);

    const style = (b.produit && b.produit.type && b.produit.type.libelle) ? b.produit.type.libelle : '';
    const ings = analyserIngredients_(b.ingredients);
    const sc = extraireVolSeCanto_(b.productions);

    const vBrasseHL = (b.volume || 0) / 100;
    let vSorti = 0;
    if (b.productions && b.productions.length > 0) b.productions.forEach(p => { vSorti += (p.volumeTotal || 0); });
    else vSorti = b.volumeFinal || 0;
    const vSortiHL = vSorti / 100;
    const vTheoHL = calculBatchTheorique_(vBrasseHL);
    const vTheoCorrige = vTheoHL + ings.volFruitsHL;
    const rendement = vTheoCorrige > 0 ? (vSortiHL / vTheoCorrige) : 0;

    const rdtBrass = (b.rendementBrassin !== undefined && b.rendementBrassin !== null) ? b.rendementBrassin : 0;
    const coutTotal = (b.cout !== undefined && b.cout !== null && typeof b.cout === 'number') ? b.cout : 0;
    const coutHL = vSortiHL > 0 ? (coutTotal / vSortiHL) : 0;
    const tauxPerte = vBrasseHL > 0 ? (vBrasseHL - vSortiHL) / vBrasseHL : 0;

    const dDebut = b.dateDebut ? new Date(b.dateDebut) : null;
    let occupation = 0;
    if (dDebut && dCondiReelle) {
      const j = Math.round((dCondiReelle - dDebut) / (1000*60*60*24));
      if (j > 0) occupation = j;
      else if (j === 0) occupation = 1;
    }

    const moisStr = dCondiReelle ? MOIS_FR[dCondiReelle.getMonth()] : '-';
    const anneeStr = dCondiReelle ? dCondiReelle.getFullYear().toString() : '-';

    updates.push({
      row: item.row, mois: moisStr, annee: anneeStr,
      dateCondi: dCondiReelle, dateCondiReelle: dCondiReelle, occupation,
      vBrasseHL, vTheoHL, vSortiHL, rendement,
      style, levure: ings.levure, volFruits: ings.volFruitsHL,
      scTotal: sc.totalHL, scBlonde: sc.blondeHL, scIPA: sc.ipaHL, scBlanche: sc.blancheHL,
      rdtBrass: rdtBrass / 100, coutTotal, coutHL, tauxPerte
    });
    nbOk++;
    if ((i + 1) % 20 === 0) Logger.log('[RATTRAP] ' + (i + 1) + '/' + batch.length);
  }

  updates.forEach(u => {
    sheet.getRange(u.row, idx['Mois'] + 1).setValue(u.mois);
    sheet.getRange(u.row, idx['Année'] + 1).setValue(u.annee);
    sheet.getRange(u.row, idx['Date Condi'] + 1).setValue(u.dateCondi).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(u.row, idx['Date Condi Réelle'] + 1).setValue(u.dateCondiReelle).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(u.row, idx['Jours Occupation'] + 1).setValue(u.occupation);
    sheet.getRange(u.row, idx['Vol. Brassé (HL)'] + 1).setValue(u.vBrasseHL);
    sheet.getRange(u.row, idx['Vol. Batch Théo'] + 1).setValue(u.vTheoHL);
    sheet.getRange(u.row, idx['Vol. Condi (HL)'] + 1).setValue(u.vSortiHL);
    sheet.getRange(u.row, idx['Rendement'] + 1).setValue(u.rendement);
    sheet.getRange(u.row, idx['Style'] + 1).setValue(u.style);
    sheet.getRange(u.row, idx['Levure Neuve'] + 1).setValue(u.levure);
    sheet.getRange(u.row, idx['Vol Fruits Ajouté (HL)'] + 1).setValue(u.volFruits);
    sheet.getRange(u.row, idx['Vol Se Canto (HL)'] + 1).setValue(u.scTotal);
    sheet.getRange(u.row, idx['Vol Se Canto Blonde (HL)'] + 1).setValue(u.scBlonde);
    sheet.getRange(u.row, idx['Vol Se Canto IPA (HL)'] + 1).setValue(u.scIPA);
    sheet.getRange(u.row, idx['Vol Se Canto Blanche (HL)'] + 1).setValue(u.scBlanche);
    sheet.getRange(u.row, idx['Rendement Brassage'] + 1).setValue(u.rdtBrass).setNumberFormat('0.0%');
    sheet.getRange(u.row, idx['Coût Total (€)'] + 1).setValue(u.coutTotal).setNumberFormat('#,##0 "€"');
    sheet.getRange(u.row, idx['Coût / HL (€)'] + 1).setValue(u.coutHL).setNumberFormat('#,##0 "€"');
    sheet.getRange(u.row, idx['Taux Perte (%)'] + 1).setValue(u.tauxPerte).setNumberFormat('0.0%');
  });

  const newCheckpoint = checkpoint + batch.length;
  props.setProperty(RATTRAP_PROP_KEY, String(newCheckpoint));
  Logger.log('[RATTRAP] ' + Math.round((new Date().getTime() - t0)/1000) + 's. OK:' + nbOk + ' KO:' + nbKO + ' Reste:' + (queue.length - newCheckpoint));
  if (newCheckpoint >= queue.length) { Logger.log('[RATTRAP] 🎉'); props.deleteProperty(RATTRAP_PROP_KEY); }
  else Logger.log('[RATTRAP] → Relance.');
}

function resetRattrapage() { PropertiesService.getScriptProperties().deleteProperty(RATTRAP_PROP_KEY); Logger.log('Reset OK.'); }

// ============================================================
// RATTRAPAGE SE CANTO
// ============================================================
function rattrapageSeCanto() {
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);

  const props = PropertiesService.getScriptProperties();
  let checkpoint = parseInt(props.getProperty(RATTRAP_SECANTO_KEY) || '0');
  const queue = [];
  for (let r = 1; r < data.length; r++) {
    const id = data[r][idx['ID Brassin']];
    if (id) queue.push({ row: r + 1, id: id });
  }
  Logger.log('[SECANTO] Queue : ' + queue.length + ' | CP : ' + checkpoint);
  if (checkpoint >= queue.length) { Logger.log('[SECANTO] ✅'); props.deleteProperty(RATTRAP_SECANTO_KEY); return; }

  const batch = queue.slice(checkpoint, checkpoint + PROD_RATTRAP_BATCH);
  const auth = getAuthHeader_();
  let nbOk = 0, nbKO = 0;
  const updates = [];
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const r = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + item.id, { method:'get', headers:auth, muteHttpExceptions:true });
    if (r.getResponseCode() !== 200) { nbKO++; continue; }
    let b; try { b = JSON.parse(r.getContentText()); } catch(e) { nbKO++; continue; }
    const sc = extraireVolSeCanto_(b.productions);
    updates.push({ row:item.row, total:sc.totalHL, blonde:sc.blondeHL, ipa:sc.ipaHL, blanche:sc.blancheHL });
    nbOk++;
    if ((i+1)%20===0) Logger.log('[SECANTO] '+(i+1)+'/'+batch.length);
  }
  updates.forEach(u => {
    sheet.getRange(u.row, idx['Vol Se Canto (HL)'] + 1).setValue(u.total).setNumberFormat('#,##0.00');
    sheet.getRange(u.row, idx['Vol Se Canto Blonde (HL)'] + 1).setValue(u.blonde).setNumberFormat('#,##0.00');
    sheet.getRange(u.row, idx['Vol Se Canto IPA (HL)'] + 1).setValue(u.ipa).setNumberFormat('#,##0.00');
    sheet.getRange(u.row, idx['Vol Se Canto Blanche (HL)'] + 1).setValue(u.blanche).setNumberFormat('#,##0.00');
  });
  const newCp = checkpoint + batch.length;
  props.setProperty(RATTRAP_SECANTO_KEY, String(newCp));
  Logger.log('[SECANTO] '+Math.round((new Date().getTime()-t0)/1000)+'s. OK:'+nbOk+' KO:'+nbKO+' Reste:'+(queue.length-newCp));
  if (newCp >= queue.length) { Logger.log('[SECANTO] 🎉'); props.deleteProperty(RATTRAP_SECANTO_KEY); }
}

function resetRattrapageSeCanto() { PropertiesService.getScriptProperties().deleteProperty(RATTRAP_SECANTO_KEY); Logger.log('Reset OK.'); }

// ============================================================
// CORRIGER RENDEMENTS
// ============================================================
function corrigerRendements() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);
  let nbC = 0;
  const rdts = [];
  for (let r = 1; r < data.length; r++) {
    const vS = parseValSafe_(data[r][idx['Vol. Condi (HL)']]);
    const vT = parseValSafe_(data[r][idx['Vol. Batch Théo']]);
    const vF = parseValSafe_(data[r][idx['Vol Fruits Ajouté (HL)']]);
    const d = vT + vF;
    rdts.push([d > 0 ? vS/d : 0]);
    nbC++;
  }
  sheet.getRange(2, idx['Rendement']+1, rdts.length, 1).setValues(rdts).setNumberFormat('0.0%');
  Logger.log('[FIX-RDT] ✅ '+nbC+' rdts.');
}

// ============================================================
// ETAT CAVE
// ============================================================
function etatCaveActuel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cave = ss.getSheetByName(CAVE_SHEET);
  if (!cave) cave = ss.insertSheet(CAVE_SHEET);
  cave.clear();
  try { cave.getRange(1, 1, cave.getMaxRows(), cave.getMaxColumns()).breakApart(); } catch(e) {}
  const auth = getAuthHeader_();
  const r = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/en-cours', { method:'post', headers:auth, payload:'{}', muteHttpExceptions:true });
  if (r.getResponseCode() !== 200) { cave.getRange(1,1).setValue('❌ Erreur API.'); return; }
  const ec = JSON.parse(r.getContentText());
  const liste = [];
  if (ec.etapes) ec.etapes.forEach(e => { if (e.modelesBrassins) liste.push(...e.modelesBrassins); });
  cave.getRange(1, 1).setValue('🏭 ÉTAT CAVE — ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm'))
       .setFontSize(16).setFontWeight('bold').setBackground('#000').setFontColor('white');
  cave.getRange(1, 1, 1, 6).merge();
  const headers = ['Lot', 'Bière', 'Marque', 'Matériel', 'Vol. Brassé (HL)', 'Jours en cuve'];
  cave.getRange(3, 1, 1, headers.length).setValues([headers]).setBackground('#666').setFontColor('white').setFontWeight('bold');
  const now = new Date();
  const rows = [];
  liste.forEach(b => {
    if (b.etat && (b.etat.code === 'ANNULE' || b.etat.code === 'DETRUIT')) return;
    const mat = (b.materielsAffectes && Array.isArray(b.materielsAffectes) && b.materielsAffectes.length > 0)
                ? b.materielsAffectes.map(m => m.libelle || m.nom || '?').join(', ') : '?';
    const dD = b.dateDebut ? new Date(b.dateDebut) : null;
    const j = dD ? Math.round((now - dD)/(1000*60*60*24)) : 0;
    rows.push([b.nom || '?', (b.produit && b.produit.nom) || '?', (b.produit && b.produit.categorie && b.produit.categorie.libelle) || '-', mat, (b.volume||0)/100, j]);
  });
  rows.sort((a,b) => b[5]-a[5]);
  if (rows.length === 0) rows.push(['(aucun)', '', '', '', 0, 0]);
  cave.getRange(4, 1, rows.length, headers.length).setValues(rows);
  cave.getRange(4, 5, rows.length, 1).setNumberFormat('#,##0.00');
  cave.getRange(4, 6, rows.length, 1).setNumberFormat('0');
  cave.autoResizeColumns(1, headers.length);
  SpreadsheetApp.getUi().alert('✅ État cave : ' + rows.length + ' brassins en cours.');
}

// ============================================================
// CRÉER ONGLETS MANUELS
// ============================================================
function creerOngletsManuel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // QUALITE
  if (!ss.getSheetByName(QUALITE_SHEET)) {
    const s = ss.insertSheet(QUALITE_SHEET);
    s.getRange(1, 1).setValue('🍺 QUALITE — Suivi conformité et réclamations (saisie manuelle)')
      .setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
    s.getRange(1, 1, 1, 6).merge();
    const h = [['Date', 'Lot', 'Type', 'Description', 'Volume affecté (HL)', 'Action prise']];
    s.getRange(3, 1, 1, 6).setValues(h).setBackground('#ead1dc').setFontWeight('bold');
    s.getRange(4, 1).setValue('(Exemple : à remplir manuellement)');
  }

  // SECURITE
  if (!ss.getSheetByName(SECURITE_SHEET)) {
    const s = ss.insertSheet(SECURITE_SHEET);
    s.getRange(1, 1).setValue('🦺 SECURITE — Incidents et heures travaillées (saisie manuelle)')
      .setFontSize(14).setFontWeight('bold').setBackground('#cc0000').setFontColor('white');
    s.getRange(1, 1, 1, 6).merge();
    const h = [['Mois', 'Année', 'Heures travaillées', 'Nb incidents', 'Nb presqu\'accidents', 'Commentaire']];
    s.getRange(3, 1, 1, 6).setValues(h).setBackground('#ead1dc').setFontWeight('bold');
    s.getRange(4, 1).setValue('(Exemple : Janvier | 2026 | 800 | 0 | 1 | RAS)');
  }

  // ENERGIE
  if (!ss.getSheetByName(ENERGIE_SHEET)) {
    const s = ss.insertSheet(ENERGIE_SHEET);
    s.getRange(1, 1).setValue('💧 ENERGIE — Consommation eau et énergie (saisie manuelle)')
      .setFontSize(14).setFontWeight('bold').setBackground('#0b5394').setFontColor('white');
    s.getRange(1, 1, 1, 6).merge();
    const h = [['Mois', 'Année', 'Eau (m³)', 'Électricité (kWh)', 'Gaz (m³)', 'Commentaire']];
    s.getRange(3, 1, 1, 6).setValues(h).setBackground('#ead1dc').setFontWeight('bold');
    s.getRange(4, 1).setValue('(Exemple : Janvier | 2026 | 1200 | 8500 | 450 | RAS)');
  }

  SpreadsheetApp.getUi().alert('✅ Onglets QUALITE, SECURITE, ENERGIE créés (s\'ils n\'existaient pas).');
}

// ============================================================
// TRIGGERS
// ============================================================
function creerTriggerQuotidien() {
  supprimerTriggers();
  ScriptApp.newTrigger('syncEasybeerToSheet').timeBased().atHour(6).everyDays(1).create();
  ScriptApp.newTrigger('actualiserDashboard').timeBased().atHour(7).everyDays(1).create();
  SpreadsheetApp.getUi().alert('✅ Triggers : sync 6h + dashboard 7h.');
}

function supprimerTriggers() {
  const t = ScriptApp.getProjectTriggers();
  t.forEach(x => ScriptApp.deleteTrigger(x));
  Logger.log('Triggers supprimés (' + t.length + ').');
}

// ============================================================
// DASHBOARD V3
// ============================================================
function actualiserDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) { SpreadsheetApp.getUi().alert("❌ HISTORIQUE_KPI introuvable."); return; }

  let dash = ss.getSheetByName(DASH_SHEET);
  if (!dash) dash = ss.insertSheet(DASH_SHEET);
  dash.getCharts().forEach(c => dash.removeChart(c));
  try { dash.getRange(1, 1, dash.getMaxRows(), dash.getMaxColumns()).breakApart(); } catch(e) {}
  dash.clear();
  SpreadsheetApp.flush();

  const data = src.getDataRange().getValues();
  if (data.length < 2) { SpreadsheetApp.getUi().alert("⚠️ Vide."); return; }

  const headers = data[0];
  const rows = data.slice(1);
  const idx = {};
  headers.forEach((h, i) => idx[String(h).trim()] = i);

  const now = new Date();
  const yNow = now.getFullYear();
  const mNow = MOIS_FR[now.getMonth()];
  const prevDate = new Date(yNow, now.getMonth() - 1, 1);
  const yPrev = prevDate.getFullYear();
  const mPrev = MOIS_FR[prevDate.getMonth()];
  const lastYrDate = new Date(yNow - 1, now.getMonth(), 1);
  const yLastY = lastYrDate.getFullYear();
  const mLastY = MOIS_FR[lastYrDate.getMonth()];
  const date12wAgo = new Date(); date12wAgo.setDate(date12wAgo.getDate() - 84);
  const date12mAgo = new Date(yNow, now.getMonth() - 11, 1);

  // === AGRÉGATION ===
  const kpi = {
    now:  { vol:0, count:0, volTheoFini:0, volCondiFini:0, volFruitsFini:0, brands:{}, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 },
    prev: { vol:0, count:0, volTheoFini:0, volCondiFini:0, volFruitsFini:0, brands:{}, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 },
    lastY:{ vol:0, count:0, volTheoFini:0, volCondiFini:0, volFruitsFini:0, brands:{}, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 }
  };
  const occupParStyle = {};
  const cadenceHebdo = {};
  const histMensuel = {};
  const styleMensuel = {};
  const compAnnuel = {};
  const seCantoMensuel = {};
  const seCantoAnnuel = {};
  const enCoursLongs = { j30: [], j60: [] };
  let totalRepitch = 0, totalLevureNeuve = 0, totalEcoEur = 0;
  let totalFruitsBrassins = 0, totalFruitsHL = 0;
  let globalBrandsSet = new Set();
  const tousLesBrassins = [];

  rows.forEach(r => {
    const m = r[idx['Mois']];
    const a = parseInt(r[idx['Année']]);
    const marque = r[idx['Marque']] || '-';
    const statut = (r[idx['Statut']] || '').toString();
    const lot = r[idx['Lot']];
    const biere = r[idx['Bière']] || '?';
    const style = (idx['Style'] !== undefined ? r[idx['Style']] : '') || 'Non défini';
    const vCondi = parseValSafe_(r[idx['Vol. Condi (HL)']]);
    const vBrasse = parseValSafe_(r[idx['Vol. Brassé (HL)']]);
    const vTheo = parseValSafe_(r[idx['Vol. Batch Théo']]);
    const vFruits = idx['Vol Fruits Ajouté (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Fruits Ajouté (HL)']]) : 0;
    const scTotal = idx['Vol Se Canto (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto (HL)']]) : 0;
    const scBlonde = idx['Vol Se Canto Blonde (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto Blonde (HL)']]) : 0;
    const scIPA = idx['Vol Se Canto IPA (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto IPA (HL)']]) : 0;
    const scBlanche = idx['Vol Se Canto Blanche (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto Blanche (HL)']]) : 0;
    const rdtBrass = idx['Rendement Brassage'] !== undefined ? parseValSafe_(r[idx['Rendement Brassage']]) : 0;
    const coutTotal = idx['Coût Total (€)'] !== undefined ? parseValSafe_(r[idx['Coût Total (€)']]) : 0;
    const coutHL = idx['Coût / HL (€)'] !== undefined ? parseValSafe_(r[idx['Coût / HL (€)']]) : 0;
    const tauxPerte = idx['Taux Perte (%)'] !== undefined ? parseValSafe_(r[idx['Taux Perte (%)']]) : 0;
    const conforme = idx['Conforme'] !== undefined ? String(r[idx['Conforme']] || 'O').toUpperCase() : 'O';
    const occ = parseValSafe_(r[idx['Jours Occupation']]);
    const eco = parseValSafe_(r[idx['Économie (€)']]);
    const dCondi = r[idx['Date Condi Réelle']] ? new Date(r[idx['Date Condi Réelle']]) : (r[idx['Date Condi']] ? new Date(r[idx['Date Condi']]) : null);
    const dDebut = r[idx['Date Début']] ? new Date(r[idx['Date Début']]) : null;
    const levure = idx['Levure Neuve'] !== undefined ? r[idx['Levure Neuve']] : '-';
    if (marque !== '-') globalBrandsSet.add(marque);
    const isArchive = statut.toLowerCase().includes('archiv');
    const isEnCours = statut.toLowerCase().includes('en cours');
    tousLesBrassins.push({lot, biere, marque, style, statut, vCondi, vBrasse, dCondi, isArchive});

    if (occ > 0 && style) {
      if (!occupParStyle[style]) occupParStyle[style] = { jours:0, count:0 };
      occupParStyle[style].jours += occ; occupParStyle[style].count++;
    }
    if (dCondi && dCondi >= date12wAgo) {
      const wk = isoWeekKey_(dCondi);
      if (!cadenceHebdo[wk]) cadenceHebdo[wk] = { brassins:0, vol:0 };
      cadenceHebdo[wk].brassins++; cadenceHebdo[wk].vol += vCondi;
    }
    if (isEnCours && dDebut) {
      const days = Math.round((now - dDebut)/(1000*60*60*24));
      if (days >= 60) enCoursLongs.j60.push({lot, biere, marque, days});
      else if (days >= 30) enCoursLongs.j30.push({lot, biere, marque, days});
    }

    const aggKpi = (t) => {
      t.vol += vCondi; t.count++;
      t.brands[marque] = (t.brands[marque] || 0) + 1;
      if (isArchive) {
        t.volTheoFini += vTheo; t.volCondiFini += vCondi; t.volFruitsFini += vFruits;
        if (rdtBrass > 0) { t.rdtBrassSum += rdtBrass; t.rdtBrassN++; }
        if (tauxPerte > 0) { t.perteSum += tauxPerte; t.perteN++; }
        if (coutHL > 0) { t.coutHLSum += coutHL; t.coutHLN++; }
        if (conforme === 'O') t.conformeOK++;
        else if (conforme === 'N') t.conformeKO++;
      }
    };
    if (m === mNow && a === yNow) aggKpi(kpi.now);
    else if (m === mPrev && a === yPrev) aggKpi(kpi.prev);
    else if (m === mLastY && a === yLastY) aggKpi(kpi.lastY);

    if (a >= ANNEE_DEBUT_STATS && !isNaN(a)) {
      if (!compAnnuel[a]) compAnnuel[a] = { vol:0, count:0, theoFini:0, condiFini:0, fruitsFini:0, repitch:0, levureNeuve:0, brassinsFruits:0, hlFruits:0, ecoEur:0, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 };
      const ca = compAnnuel[a];
      ca.vol += vCondi; ca.count++;
      if (isArchive) {
        ca.theoFini += vTheo; ca.condiFini += vCondi; ca.fruitsFini += vFruits;
        if (levure && String(levure).trim() !== '-' && String(levure).trim() !== '') ca.levureNeuve++;
        else { ca.repitch++; ca.ecoEur += eco; }
        if (rdtBrass > 0) { ca.rdtBrassSum += rdtBrass; ca.rdtBrassN++; }
        if (tauxPerte > 0) { ca.perteSum += tauxPerte; ca.perteN++; }
        if (coutHL > 0) { ca.coutHLSum += coutHL; ca.coutHLN++; }
        if (conforme === 'O') ca.conformeOK++;
        else if (conforme === 'N') ca.conformeKO++;
      }
      if (vFruits > 0) { ca.brassinsFruits++; ca.hlFruits += vFruits; }
    }

    if (m && m !== '-') {
      const sortKey = a + '-' + String(MOIS_FR.indexOf(m) + 1).padStart(2, '0');
      if (!histMensuel[sortKey]) histMensuel[sortKey] = { label: m+' '+a, annee:a, vol:0, count:0, theo:0, theoCorrige:0, condiFini:0, occTotal:0, occCount:0, brands:{} };
      const h = histMensuel[sortKey];
      h.vol += vCondi; h.count++;
      h.brands[marque] = (h.brands[marque] || 0) + 1;
      if (isArchive) { h.theo += vTheo; h.theoCorrige += (vTheo+vFruits); h.condiFini += vCondi; }
      if (occ > 0) { h.occTotal += occ; h.occCount++; }
      if (style && isArchive) {
        if (!styleMensuel[sortKey]) styleMensuel[sortKey] = {};
        if (!styleMensuel[sortKey][style]) styleMensuel[sortKey][style] = { count:0, vol:0, theo:0, theoCorrige:0 };
        const s = styleMensuel[sortKey][style];
        s.count++; s.vol += vCondi; s.theo += vTheo; s.theoCorrige += (vTheo+vFruits);
      }
      if (a >= ANNEE_DEBUT_STATS && scTotal > 0) {
        if (!seCantoMensuel[sortKey]) seCantoMensuel[sortKey] = { label:m+' '+a, total:0, blonde:0, ipa:0, blanche:0 };
        const sm = seCantoMensuel[sortKey];
        sm.total += scTotal; sm.blonde += scBlonde; sm.ipa += scIPA; sm.blanche += scBlanche;
      }
    }
    if (a >= ANNEE_DEBUT_STATS && scTotal > 0) {
      if (!seCantoAnnuel[a]) seCantoAnnuel[a] = { total:0, blonde:0, ipa:0, blanche:0 };
      seCantoAnnuel[a].total += scTotal; seCantoAnnuel[a].blonde += scBlonde; seCantoAnnuel[a].ipa += scIPA; seCantoAnnuel[a].blanche += scBlanche;
    }

    if (isArchive) {
      if (levure && String(levure).trim() !== '-' && String(levure).trim() !== '') totalLevureNeuve++;
      else { totalRepitch++; totalEcoEur += eco; }
    }
    if (vFruits > 0) { totalFruitsBrassins++; totalFruitsHL += vFruits; }
  });

  // === ÉCRITURE ===
  let r = 1;

  // HEADER
  dash.getRange(r, 1).setValue('📊 DASHBOARD PRODUCTION : ' + mNow.toUpperCase() + ' ' + yNow)
       .setFontSize(18).setFontWeight('bold').setBackground('#000').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge().setHorizontalAlignment('center');
  r++;
  dash.getRange(r, 1).setValue('Mis à jour le ' + Utilities.formatDate(now, 'Europe/Paris', 'dd/MM/yyyy HH:mm'))
       .setFontStyle('italic').setFontColor('#666');
  r += 2;

  // === 🎯 KPI VITAUX (NIVEAU 1) ===
  dash.getRange(r, 1).setValue('🎯 KPI VITAUX (Niveau 1) — Mois courant + annuel')
       .setFontSize(14).setFontWeight('bold').setBackground('#cc0000').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;

  const rdtBrassNow = kpi.now.rdtBrassN > 0 ? kpi.now.rdtBrassSum / kpi.now.rdtBrassN : 0;
  const perteNow = kpi.now.perteN > 0 ? kpi.now.perteSum / kpi.now.perteN : 0;
  const coutHLNow = kpi.now.coutHLN > 0 ? kpi.now.coutHLSum / kpi.now.coutHLN : 0;
  const rftNow = (kpi.now.conformeOK + kpi.now.conformeKO) > 0 ? kpi.now.conformeOK / (kpi.now.conformeOK + kpi.now.conformeKO) : 0;

  const kpiRows = [
    ['KPI VITAL', 'Mois courant', 'Objectif', 'Statut'],
    ['1. Rendement Brassage (Easybeer)', rdtBrassNow, 0.88, rdtBrassNow >= 0.88 ? '✅' : '⚠️'],
    ['2. Taux de Perte Totale', perteNow, SEUIL_PERTE_OBJECTIF, perteNow <= SEUIL_PERTE_OBJECTIF ? '✅' : '⚠️'],
    ['3. Batch Right-First-Time (Conformité)', rftNow, 0.95, rftNow >= 0.95 ? '✅' : '⚠️'],
    ['4. Respect planning (à saisir)', '—', '—', 'À configurer'],
    ['5. Coût matière par HL', coutHLNow, '—', '—'],
    ['6. Incidents sécurité (TF1) (à saisir)', '—', '—', 'À configurer']
  ];
  dash.getRange(r, 1, kpiRows.length, 4).setValues(kpiRows);
  dash.getRange(r, 1, 1, 4).setBackground('#cc0000').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+1, 3, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+2, 2, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+2, 3, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+3, 2, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+3, 3, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+5, 2, 1, 1).setNumberFormat('#,##0 "€"');
  r += kpiRows.length + 2;

  // === A : RÉSUMÉ ===
  dash.getRange(r, 1).setValue('🎯 A — RÉSUMÉ EXÉCUTIF').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const yieldNow = (kpi.now.volTheoFini + kpi.now.volFruitsFini) > 0 ? kpi.now.volCondiFini / (kpi.now.volTheoFini + kpi.now.volFruitsFini) : 0;
  let topMarque = '-', topMarqueVol = 0;
  Object.keys(kpi.now.brands).forEach(b => { if (b !== '-' && kpi.now.brands[b] > topMarqueVol) { topMarque = b; topMarqueVol = kpi.now.brands[b]; } });
  const resTable = [
    ['INDICATEUR','VALEUR','','INDICATEUR','VALEUR'],
    ['Volume Total HL ce mois', kpi.now.vol, '', 'Rendement global', yieldNow],
    ['Brassins ce mois', kpi.now.count, '', 'Top marque', topMarque + ' (' + topMarqueVol + ')'],
    ['Brassins en cours > 30j', enCoursLongs.j30.length, '', 'Brassins en cours > 60j', enCoursLongs.j60.length]
  ];
  dash.getRange(r, 1, resTable.length, 5).setValues(resTable);
  dash.getRange(r, 1, 1, 5).setBackground('#cfe2f3').setFontWeight('bold');
  dash.getRange(r+1, 2, 1, 1).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 5, 1, 1).setNumberFormat('0.0%');
  dash.getRange(r+2, 2, 1, 1).setNumberFormat('0');
  dash.getRange(r+3, 2, 1, 1).setNumberFormat('0');
  dash.getRange(r+3, 5, 1, 1).setNumberFormat('0');
  r += resTable.length + 2;

  // === B : COMPARATIF M/M-1/N-1 ===
  dash.getRange(r, 1).setValue('📅 B — COMPARATIF M / M-1 / N-1').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const evol = (a, b) => b > 0 ? (a-b)/b : (a > 0 ? 1 : 0);
  const yieldPrev = (kpi.prev.volTheoFini + kpi.prev.volFruitsFini) > 0 ? kpi.prev.volCondiFini / (kpi.prev.volTheoFini + kpi.prev.volFruitsFini) : 0;
  const yieldLastY = (kpi.lastY.volTheoFini + kpi.lastY.volFruitsFini) > 0 ? kpi.lastY.volCondiFini / (kpi.lastY.volTheoFini + kpi.lastY.volFruitsFini) : 0;
  const compTable = [
    ['INDICATEUR', mNow+' '+yNow, mPrev+' '+yPrev, mLastY+' '+yLastY, 'Évol /M-1', 'Évol /N-1'],
    ['Volume HL', kpi.now.vol, kpi.prev.vol, kpi.lastY.vol, evol(kpi.now.vol, kpi.prev.vol), evol(kpi.now.vol, kpi.lastY.vol)],
    ['Nb Brassins', kpi.now.count, kpi.prev.count, kpi.lastY.count, evol(kpi.now.count, kpi.prev.count), evol(kpi.now.count, kpi.lastY.count)],
    ['Rendement', yieldNow, yieldPrev, yieldLastY, evol(yieldNow, yieldPrev), evol(yieldNow, yieldLastY)]
  ];
  dash.getRange(r, 1, compTable.length, 6).setValues(compTable);
  dash.getRange(r, 1, 1, 6).setBackground('#444').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, 1, 3).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+2, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+3, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+1, 5, compTable.length-1, 2).setNumberFormat('+0.0%;-0.0%;0%');
  r += compTable.length + 2;

  // === C : CADENCE ===
  dash.getRange(r, 1).setValue('⚡ C — CADENCE 12 SEMAINES').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const cadStart = r;
  const cadKeys = Object.keys(cadenceHebdo).sort();
  const cadRows = [['Semaine ISO', 'Brassins', 'Vol HL']];
  cadKeys.forEach(k => cadRows.push([k, cadenceHebdo[k].brassins, cadenceHebdo[k].vol]));
  if (cadRows.length === 1) cadRows.push(['(aucune)', 0, 0]);
  dash.getRange(r, 1, cadRows.length, 3).setValues(cadRows);
  dash.getRange(r, 1, 1, 3).setBackground('#666').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, cadRows.length-1, 1).setNumberFormat('0');
  dash.getRange(r+1, 3, cadRows.length-1, 1).setNumberFormat('#,##0.0 "HL"');
  if (cadRows.length > 2) {
    try {
      const c = dash.newChart().setChartType(Charts.ChartType.LINE)
        .addRange(dash.getRange(cadStart, 1, cadRows.length, 3))
        .setPosition(cadStart, 5, 0, 0).setOption('title','Cadence hebdo (HL)')
        .setOption('width',500).setOption('height',280)
        .setOption('legend',{position:'bottom'}).build();
      dash.insertChart(c);
    } catch(e) { Logger.log('[CHART C] '+e.message); }
  }
  r += cadRows.length + 2;

  // === D : MIX MARQUES ===
  dash.getRange(r, 1).setValue('🎨 D — MIX MARQUES (mois courant)').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const mixStart = r;
  const mixRows = [['Marque','Nb Brassins','Vol HL','% Vol']];
  const totalVolMois = kpi.now.vol;
  Object.keys(kpi.now.brands).sort().forEach(b => {
    if (b !== '-') {
      let volB = 0;
      tousLesBrassins.forEach(br => { if (br.marque === b && br.dCondi && br.dCondi.getMonth() === now.getMonth() && br.dCondi.getFullYear() === yNow) volB += br.vCondi; });
      mixRows.push([b, kpi.now.brands[b], volB, totalVolMois > 0 ? volB/totalVolMois : 0]);
    }
  });
  if (mixRows.length === 1) mixRows.push(['(aucun)', 0, 0, 0]);
  dash.getRange(r, 1, mixRows.length, 4).setValues(mixRows);
  dash.getRange(r, 1, 1, 4).setBackground('#666').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, mixRows.length-1, 1).setNumberFormat('0');
  dash.getRange(r+1, 3, mixRows.length-1, 1).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 4, mixRows.length-1, 1).setNumberFormat('0.0%');
  if (mixRows.length > 2) {
    try {
      const c = dash.newChart().setChartType(Charts.ChartType.PIE)
        .addRange(dash.getRange(mixStart, 1, mixRows.length, 1))
        .addRange(dash.getRange(mixStart, 3, mixRows.length, 1))
        .setPosition(mixStart, 5, 0, 0).setOption('title','Mix HL')
        .setOption('width',500).setOption('height',280).build();
      dash.insertChart(c);
    } catch(e) { Logger.log('[CHART D] '+e.message); }
  }
  r += mixRows.length + 2;

  // === E : PERFORMANCE STYLE 12 MOIS ===
  dash.getRange(r, 1).setValue('🍺 E — PERFORMANCE PAR STYLE (12 mois)').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const styleAgg = {};
  Object.keys(styleMensuel).forEach(sk => {
    const [sy, sm] = sk.split('-').map(Number);
    if (new Date(sy, sm-1, 1) >= date12mAgo) {
      Object.keys(styleMensuel[sk]).forEach(st => {
        if (!styleAgg[st]) styleAgg[st] = { count:0, vol:0, theoCorrige:0 };
        const a = styleAgg[st], v = styleMensuel[sk][st];
        a.count += v.count; a.vol += v.vol; a.theoCorrige += v.theoCorrige;
      });
    }
  });
  const styleRows = [['Style','Nb Brassins','Vol HL','Rendement']];
  Object.keys(styleAgg).sort((a,b) => styleAgg[b].vol - styleAgg[a].vol).forEach(st => {
    const a = styleAgg[st];
    styleRows.push([st, a.count, a.vol, a.theoCorrige > 0 ? a.vol/a.theoCorrige : 0]);
  });
  if (styleRows.length === 1) styleRows.push(['(aucun)',0,0,0]);
  dash.getRange(r, 1, styleRows.length, 4).setValues(styleRows);
  dash.getRange(r, 1, 1, 4).setBackground('#666').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, styleRows.length-1, 1).setNumberFormat('0');
  dash.getRange(r+1, 3, styleRows.length-1, 1).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 4, styleRows.length-1, 1).setNumberFormat('0.0%');
  r += styleRows.length + 2;

  // === F : SE CANTO ===
  dash.getRange(r, 1).setValue('🆕 F — SE CANTO (depuis 2024)').setFontSize(14).setFontWeight('bold').setBackground('#a64d79').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  dash.getRange(r, 1).setValue('Cumul annuel').setFontWeight('bold').setBackground('#d5a6bd');
  dash.getRange(r, 1, 1, 5).merge();
  r++;
  const scAnRows = [['Année','Total HL','Blonde','IPA','Blanche']];
  [2024, 2025, 2026].forEach(yr => {
    const a = seCantoAnnuel[yr] || { total:0, blonde:0, ipa:0, blanche:0 };
    scAnRows.push([yr, a.total, a.blonde, a.ipa, a.blanche]);
  });
  dash.getRange(r, 1, scAnRows.length, 5).setValues(scAnRows);
  dash.getRange(r, 1, 1, 5).setBackground('#a64d79').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, scAnRows.length-1, 4).setNumberFormat('#,##0.0 "HL"');
  r += scAnRows.length + 1;
  dash.getRange(r, 1).setValue('Détail mensuel').setFontWeight('bold').setBackground('#d5a6bd');
  dash.getRange(r, 1, 1, 5).merge();
  r++;
  const scKeys = Object.keys(seCantoMensuel).sort((a,b) => b.localeCompare(a));
  const scMRows = [['Mois','Total HL','Blonde','IPA','Blanche']];
  if (scKeys.length === 0) scMRows.push(['(rien)', 0,0,0,0]);
  else scKeys.forEach(k => { const sc = seCantoMensuel[k]; scMRows.push([sc.label, sc.total, sc.blonde, sc.ipa, sc.blanche]); });
  dash.getRange(r, 1, scMRows.length, 5).setValues(scMRows);
  dash.getRange(r, 1, 1, 5).setBackground('#a64d79').setFontColor('white').setFontWeight('bold');
  if (scKeys.length > 0) dash.getRange(r+1, 2, scMRows.length-1, 4).setNumberFormat('#,##0.0 "HL"');
  r += scMRows.length + 2;

  // === G : COMPARATIF ANNUEL 2024/2025/2026 + KPI ===
  dash.getRange(r, 1).setValue('📆 G — COMPARATIF ANNUEL 2024 / 2025 / 2026 (avec KPI Niveau 1)').setFontSize(14).setFontWeight('bold').setBackground('#0b5394').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const ca24 = compAnnuel[2024] || {};
  const ca25 = compAnnuel[2025] || {};
  const ca26 = compAnnuel[2026] || {};
  const rdtg = (c) => (c.theoFini + c.fruitsFini) > 0 ? c.condiFini / (c.theoFini + c.fruitsFini) : 0;
  const pctRep = (c) => (c.repitch + c.levureNeuve) > 0 ? c.repitch / (c.repitch + c.levureNeuve) : 0;
  const avg = (s, n) => n > 0 ? s/n : 0;
  const rft = (c) => (c.conformeOK + c.conformeKO) > 0 ? c.conformeOK / (c.conformeOK + c.conformeKO) : 0;
  const compAnRows = [['Indicateur','2024','2025','2026'],
    ['Volume Total HL', ca24.vol||0, ca25.vol||0, ca26.vol||0],
    ['Nb Brassins', ca24.count||0, ca25.count||0, ca26.count||0],
    ['Rendement Global', rdtg(ca24), rdtg(ca25), rdtg(ca26)],
    ['Rendement Brassage moy.', avg(ca24.rdtBrassSum||0, ca24.rdtBrassN||0), avg(ca25.rdtBrassSum||0, ca25.rdtBrassN||0), avg(ca26.rdtBrassSum||0, ca26.rdtBrassN||0)],
    ['Taux Perte moy.', avg(ca24.perteSum||0, ca24.perteN||0), avg(ca25.perteSum||0, ca25.perteN||0), avg(ca26.perteSum||0, ca26.perteN||0)],
    ['Coût / HL moyen', avg(ca24.coutHLSum||0, ca24.coutHLN||0), avg(ca25.coutHLSum||0, ca25.coutHLN||0), avg(ca26.coutHLSum||0, ca26.coutHLN||0)],
    ['Batch RFT (Conformité)', rft(ca24), rft(ca25), rft(ca26)],
    ['Brassins en repitch', ca24.repitch||0, ca25.repitch||0, ca26.repitch||0],
    ['% repitch', pctRep(ca24), pctRep(ca25), pctRep(ca26)],
    ['Économie levure (€)', ca24.ecoEur||0, ca25.ecoEur||0, ca26.ecoEur||0],
    ['Brassins fruités', ca24.brassinsFruits||0, ca25.brassinsFruits||0, ca26.brassinsFruits||0],
    ['Volume fruits HL', ca24.hlFruits||0, ca25.hlFruits||0, ca26.hlFruits||0]
  ];
  dash.getRange(r, 1, compAnRows.length, 4).setValues(compAnRows);
  dash.getRange(r, 1, 1, 4).setBackground('#0b5394').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, 1, 3).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+2, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+3, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+4, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+5, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+6, 2, 1, 3).setNumberFormat('#,##0 "€"');
  dash.getRange(r+7, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+8, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+9, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+10, 2, 1, 3).setNumberFormat('#,##0 "€"');
  dash.getRange(r+11, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+12, 2, 1, 3).setNumberFormat('#,##0.0 "HL"');
  r += compAnRows.length + 2;

  // === H : EFFICACITÉ INDUSTRIELLE ===
  dash.getRange(r, 1).setValue('🏭 H — EFFICACITÉ INDUSTRIELLE').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  dash.getRange(r, 1).setValue('Temps moyen en cuve par style (tri croissant)').setFontWeight('bold').setBackground('#cfe2f3');
  dash.getRange(r, 1, 1, 4).merge();
  r++;
  const occRows = [['Style','Jours Moyens','Nb Brassins étudiés']];
  Object.keys(occupParStyle)
    .map(st => ({ st, avg: occupParStyle[st].jours / occupParStyle[st].count, n: occupParStyle[st].count }))
    .sort((a,b) => a.avg - b.avg)
    .forEach(o => occRows.push([o.st, o.avg, o.n]));
  if (occRows.length === 1) occRows.push(['(aucun)',0,0]);
  dash.getRange(r, 1, occRows.length, 3).setValues(occRows);
  dash.getRange(r, 1, 1, 3).setBackground('#ead1dc').setFontWeight('bold');
  dash.getRange(r+1, 2, occRows.length-1, 1).setNumberFormat('0.0 "j"');
  dash.getRange(r+1, 3, occRows.length-1, 1).setNumberFormat('0');
  r += occRows.length + 1;
  dash.getRange(r, 1).setValue('⚠️ Brassins en cours longs').setFontWeight('bold').setBackground('#f4cccc');
  dash.getRange(r, 1, 1, 4).merge();
  r++;
  const longRows = [['Lot','Bière','Marque','Jours']];
  enCoursLongs.j60.forEach(b => longRows.push([b.lot, b.biere, b.marque, b.days]));
  enCoursLongs.j30.forEach(b => longRows.push([b.lot, b.biere, b.marque, b.days]));
  if (longRows.length === 1) longRows.push(['(aucun)','','',0]);
  dash.getRange(r, 1, longRows.length, 4).setValues(longRows);
  dash.getRange(r, 1, 1, 4).setBackground('#ead1dc').setFontWeight('bold');
  dash.getRange(r+1, 4, longRows.length-1, 1).setNumberFormat('0');
  r += longRows.length + 2;

  // === J : HISTORIQUE MENSUEL avec mise en valeur ===
  dash.getRange(r, 1).setValue('📈 J — HISTORIQUE MENSUEL (vert = >'+SEUIL_VOL_HL_REUSSI+' HL ou rdt ≥'+Math.round(SEUIL_RDT_REUSSI*100)+'%)')
       .setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const allBrandsList = Array.from(globalBrandsSet).sort();
  const histHeaders = ['Mois/Année','Vol HL','Rdt','Occ Moy (j)','Nb Brassins'].concat(allBrandsList);
  const histTable = [histHeaders];
  const histRowsData = [];
  Object.keys(histMensuel).sort((a,b) => b.localeCompare(a)).forEach(k => {
    const h = histMensuel[k];
    const yMois = h.theoCorrige > 0 ? h.condiFini/h.theoCorrige : 0;
    const oMois = h.occCount > 0 ? h.occTotal/h.occCount : 0;
    const row = [h.label, h.vol, yMois, oMois, h.count];
    allBrandsList.forEach(b => row.push(h.brands[b] || 0));
    histTable.push(row);
    histRowsData.push({ vol:h.vol, rdt:yMois });
  });
  const histStart = r;
  dash.getRange(r, 1, histTable.length, histHeaders.length).setValues(histTable);
  dash.getRange(r, 1, 1, histHeaders.length).setBackground('#d9ead3').setFontWeight('bold');
  dash.getRange(r+1, 2, histTable.length-1, 1).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 3, histTable.length-1, 1).setNumberFormat('0.0%');
  dash.getRange(r+1, 4, histTable.length-1, 1).setNumberFormat('0.0 "j"');
  dash.getRange(r+1, 5, histTable.length-1, histHeaders.length-4).setNumberFormat('0');
  histRowsData.forEach((d, i) => {
    const ri = histStart + 1 + i;
    if (d.vol > SEUIL_VOL_HL_REUSSI) dash.getRange(ri, 2).setBackground('#b7e1cd').setFontWeight('bold');
    if (d.rdt >= SEUIL_RDT_REUSSI) dash.getRange(ri, 3).setBackground('#b7e1cd').setFontWeight('bold');
  });
  r += histTable.length + 2;

  // Chart 12 mois
  const last12 = Object.keys(histMensuel).sort((a,b) => b.localeCompare(a)).slice(0, 12).reverse();
  if (last12.length > 1) {
    const cs = r;
    const cd = [['Mois','Vol HL']];
    last12.forEach(k => cd.push([histMensuel[k].label, histMensuel[k].vol]));
    dash.getRange(cs, 1, cd.length, 2).setValues(cd);
    try {
      const c = dash.newChart().setChartType(Charts.ChartType.COLUMN)
        .addRange(dash.getRange(cs, 1, cd.length, 2))
        .setPosition(cs + cd.length + 1, 1, 0, 0)
        .setOption('title','Vol HL — 12 derniers mois')
        .setOption('width',800).setOption('height',350)
        .setOption('legend',{position:'bottom'}).build();
      dash.insertChart(c);
    } catch(e) { Logger.log('[CHART J] '+e.message); }
  }

  dash.autoResizeColumns(1, Math.max(7, histHeaders.length));
  SpreadsheetApp.getUi().alert('✅ Dashboard actualisé.');
}

// ============================================================================
// EXTENSION V4 — KPI MENSUELS (1 ligne par mois stockée)
// ============================================================================


const KPI_MENSUELS_HEADERS = [
  'Mois Clé',                          // 1  YYYY-MM (clé primaire triable)
  'Mois Label',                        // 2  "Mai 2026"
  'Année',                             // 3  2026
  'Nb Brassins Total',                 // 4
  'Nb Brassins Archivés',              // 5
  'Vol Brassé (HL)',                   // 6
  'Vol Conditionné (HL)',              // 7
  'Vol Théorique (HL)',                // 8
  'Vol Fruits Ajoutés (HL)',           // 9
  'Rendement Global (%)',              // 10
  'Rendement Brassage Moy. (%)',       // 11 KPI VITAL 1
  'Taux Perte Moy. (%)',               // 12 KPI VITAL 2
  'Batch RFT (%)',                     // 13 KPI VITAL 3
  'Respect Planning (%)',              // 14 KPI VITAL 4 (manuel)
  'Coût Matière / HL (€)',             // 15 KPI VITAL 5
  'TF1 Sécurité',                      // 16 KPI VITAL 6 (manuel)
  'Ratio Eau (L/L)',                   // 17 (manuel ENERGIE)
  'Économie Levure (€)',               // 18
  'Nb Brassins Repitch',               // 19
  'Nb Brassins Fruités',               // 20
  'Vol Se Canto Total (HL)',           // 21
  'Vol Se Canto Blonde (HL)',          // 22
  'Vol Se Canto IPA (HL)',             // 23
  'Vol Se Canto Blanche (HL)',         // 24
  'Occupation Moy. (jours)',           // 25
  'Top Marque',                        // 26
  'Top Style',                         // 27
  'Date Calcul'                        // 28
];

// ============================================================
// CALCUL DES KPI D'UN MOIS DONNÉ
// ============================================================
/**
 * Calcule l'agrégation complète pour un mois donné, à partir de toutes
 * les lignes de HISTORIQUE_KPI.
 * @param {string} sortKey   "YYYY-MM" (ex: "2026-05")
 * @param {Array<Array>} rows  Les lignes brutes du sheet (sans header)
 * @param {Object} idx       Map nom_colonne -> index
 * @return {Array} Tableau prêt à écrire dans KPI_MENSUELS (28 colonnes)
 */
function calculerKPIsMois_(sortKey, rows, idx) {
  const [yStr, mStr] = sortKey.split('-');
  const annee = parseInt(yStr);
  const moisNum = parseInt(mStr);
  const moisLabel = MOIS_FR[moisNum - 1] + ' ' + annee;

  let nbTotal = 0, nbArchives = 0;
  let volBrasse = 0, volCondi = 0, volTheo = 0, volFruits = 0, volFruitsArch = 0, volTheoArch = 0, volCondiArch = 0;
  let rdtBrassSum = 0, rdtBrassN = 0;
  let perteSum = 0, perteN = 0;
  let conformeOK = 0, conformeKO = 0;
  let coutHLSum = 0, coutHLN = 0;
  let ecoEur = 0;
  let nbRepitch = 0, nbLevureNeuve = 0;
  let nbFruits = 0;
  let scTotal = 0, scBlonde = 0, scIPA = 0, scBlanche = 0;
  let occSum = 0, occN = 0;
  const marqueCnt = {}, styleCnt = {};

  rows.forEach(r => {
    const m = r[idx['Mois']];
    const a = parseInt(r[idx['Année']]);
    if (a !== annee || m !== MOIS_FR[moisNum - 1]) return;

    const marque = r[idx['Marque']] || '-';
    const style = (idx['Style'] !== undefined ? r[idx['Style']] : '') || 'Non défini';
    const statut = (r[idx['Statut']] || '').toString();
    const vCondi = parseValSafe_(r[idx['Vol. Condi (HL)']]);
    const vBrasse = parseValSafe_(r[idx['Vol. Brassé (HL)']]);
    const vTheo = parseValSafe_(r[idx['Vol. Batch Théo']]);
    const vFruits = idx['Vol Fruits Ajouté (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Fruits Ajouté (HL)']]) : 0;
    const occ = parseValSafe_(r[idx['Jours Occupation']]);
    const rdtB = idx['Rendement Brassage'] !== undefined ? parseValSafe_(r[idx['Rendement Brassage']]) : 0;
    const txPerte = idx['Taux Perte (%)'] !== undefined ? parseValSafe_(r[idx['Taux Perte (%)']]) : 0;
    const coutHL = idx['Coût / HL (€)'] !== undefined ? parseValSafe_(r[idx['Coût / HL (€)']]) : 0;
    const conforme = idx['Conforme'] !== undefined ? String(r[idx['Conforme']] || 'O').toUpperCase() : 'O';
    const eco = parseValSafe_(r[idx['Économie (€)']]);
    const levure = idx['Levure Neuve'] !== undefined ? r[idx['Levure Neuve']] : '-';
    const scT = idx['Vol Se Canto (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto (HL)']]) : 0;
    const scB = idx['Vol Se Canto Blonde (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto Blonde (HL)']]) : 0;
    const scI = idx['Vol Se Canto IPA (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto IPA (HL)']]) : 0;
    const scBl = idx['Vol Se Canto Blanche (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Se Canto Blanche (HL)']]) : 0;

    const isArchive = statut.toLowerCase().includes('archiv');

    nbTotal++;
    volBrasse += vBrasse; volCondi += vCondi; volTheo += vTheo; volFruits += vFruits;
    if (occ > 0) { occSum += occ; occN++; }
    if (marque !== '-') marqueCnt[marque] = (marqueCnt[marque] || 0) + 1;
    if (style && style !== 'Non défini') styleCnt[style] = (styleCnt[style] || 0) + 1;
    scTotal += scT; scBlonde += scB; scIPA += scI; scBlanche += scBl;

    if (isArchive) {
      nbArchives++;
      volTheoArch += vTheo; volCondiArch += vCondi; volFruitsArch += vFruits;
      if (rdtB > 0) { rdtBrassSum += rdtB; rdtBrassN++; }
      if (txPerte > 0) { perteSum += txPerte; perteN++; }
      if (coutHL > 0) { coutHLSum += coutHL; coutHLN++; }
      if (conforme === 'O') conformeOK++;
      else if (conforme === 'N') conformeKO++;
      if (levure && String(levure).trim() !== '-' && String(levure).trim() !== '') nbLevureNeuve++;
      else { nbRepitch++; ecoEur += eco; }
    }
    if (vFruits > 0) nbFruits++;
  });

  // Rendement global
  const denomGlobal = volTheoArch + volFruitsArch;
  const rdtGlobal = denomGlobal > 0 ? volCondiArch / denomGlobal : 0;
  const rdtBrassMoy = rdtBrassN > 0 ? rdtBrassSum / rdtBrassN : 0;
  const perteMoy = perteN > 0 ? perteSum / perteN : 0;
  const coutHLMoy = coutHLN > 0 ? coutHLSum / coutHLN : 0;
  const rft = (conformeOK + conformeKO) > 0 ? conformeOK / (conformeOK + conformeKO) : 0;
  const occMoy = occN > 0 ? occSum / occN : 0;

  // Top marque et style
  let topMarque = '-', topMarqueN = 0;
  Object.keys(marqueCnt).forEach(b => { if (marqueCnt[b] > topMarqueN) { topMarque = b; topMarqueN = marqueCnt[b]; } });
  let topStyle = '-', topStyleN = 0;
  Object.keys(styleCnt).forEach(s => { if (styleCnt[s] > topStyleN) { topStyle = s; topStyleN = styleCnt[s]; } });

  // Lecture des onglets manuels pour les KPI saisis
  const tf1 = lireTF1Mois_(annee, moisNum);
  const ratioEau = lireRatioEauMois_(annee, moisNum, volCondi);
  const respPlanning = lireRespectPlanning_(annee, moisNum); // 0 si non saisi

  return [
    sortKey, moisLabel, annee,
    nbTotal, nbArchives,
    volBrasse, volCondi, volTheo, volFruits,
    rdtGlobal, rdtBrassMoy, perteMoy, rft, respPlanning,
    coutHLMoy, tf1, ratioEau,
    ecoEur, nbRepitch, nbFruits,
    scTotal, scBlonde, scIPA, scBlanche,
    occMoy,
    topMarque + ' (' + topMarqueN + ')',
    topStyle + ' (' + topStyleN + ')',
    new Date()
  ];
}

// ============================================================
// LECTURE DES ONGLETS MANUELS
// ============================================================
function lireTF1Mois_(annee, moisNum) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SECURITE_SHEET);
  if (!sheet || sheet.getLastRow() < 4) return 0;
  const data = sheet.getRange(4, 1, sheet.getLastRow() - 3, 6).getValues();
  for (const row of data) {
    const m = row[0], y = parseInt(row[1]);
    const heures = parseValSafe_(row[2]);
    const incidents = parseValSafe_(row[3]);
    if (y === annee && m === MOIS_FR[moisNum - 1] && heures > 0) {
      return (incidents * 1000000) / heures;
    }
  }
  return 0;
}

function lireRatioEauMois_(annee, moisNum, volCondiHL) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ENERGIE_SHEET);
  if (!sheet || sheet.getLastRow() < 4) return 0;
  const data = sheet.getRange(4, 1, sheet.getLastRow() - 3, 6).getValues();
  for (const row of data) {
    const m = row[0], y = parseInt(row[1]);
    const eauM3 = parseValSafe_(row[2]);
    if (y === annee && m === MOIS_FR[moisNum - 1] && eauM3 > 0 && volCondiHL > 0) {
      // L eau / L bière : eauM3 * 1000 L / (volCondiHL * 100 L)
      return (eauM3 * 1000) / (volCondiHL * 100);
    }
  }
  return 0;
}

function lireRespectPlanning_(annee, moisNum) {
  // À implémenter quand l'onglet PLANNING sera créé
  return 0;
}

// ============================================================
// RECALCULER KPI MENSUELS — n derniers mois
// ============================================================
/**
 * Recalcule les N derniers mois et met à jour KPI_MENSUELS.
 * Les mois plus anciens restent intacts.
 */
function recalculerKPIMensuels(nbMois) {
  if (!nbMois) nbMois = 3;
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) { Logger.log('[KPIM] HISTORIQUE_KPI introuvable.'); return; }

  let dst = ss.getSheetByName(KPI_MENSUELS_SHEET);
  if (!dst) {
    dst = ss.insertSheet(KPI_MENSUELS_SHEET);
    dst.appendRow(KPI_MENSUELS_HEADERS);
    dst.getRange(1, 1, 1, KPI_MENSUELS_HEADERS.length).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  }

  const srcData = src.getDataRange().getValues();
  if (srcData.length < 2) { Logger.log('[KPIM] HISTORIQUE_KPI vide.'); return; }
  const srcHeaders = srcData[0];
  const srcRows = srcData.slice(1);
  const srcIdx = {};
  srcHeaders.forEach((h, i) => srcIdx[String(h).trim()] = i);

  // Construire la liste des sortKeys à recalculer (N derniers mois)
  const now = new Date();
  const moisACalculer = [];
  for (let i = 0; i < nbMois; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    moisACalculer.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  Logger.log('[KPIM] Recalcul des mois : ' + moisACalculer.join(', '));

  // Lire l'existant pour mise à jour ciblée
  const dstData = dst.getDataRange().getValues();
  const existing = {}; // sortKey -> row index (1-based dans le sheet)
  for (let r = 1; r < dstData.length; r++) {
    const k = dstData[r][0];
    if (k) existing[k] = r + 1;
  }

  let nbMaj = 0, nbAjout = 0;
  moisACalculer.forEach(sortKey => {
    const row = calculerKPIsMois_(sortKey, srcRows, srcIdx);
    if (existing[sortKey]) {
      dst.getRange(existing[sortKey], 1, 1, row.length).setValues([row]);
      nbMaj++;
    } else {
      dst.appendRow(row);
      nbAjout++;
    }
  });

  // Tri par Mois Clé décroissant
  if (dst.getLastRow() > 2) {
    dst.getRange(2, 1, dst.getLastRow() - 1, KPI_MENSUELS_HEADERS.length).sort({column: 1, ascending: false});
  }

  // Formats
  formaterKPIMensuels_(dst);

  Logger.log('[KPIM] ✅ ' + Math.round((new Date().getTime() - t0) / 1000) + 's. MAJ:' + nbMaj + ' Ajouts:' + nbAjout);
  SpreadsheetApp.getUi().alert('✅ ' + nbMaj + ' mois MAJ + ' + nbAjout + ' ajoutés dans KPI_MENSUELS.');
}

// ============================================================
// RECALCUL COMPLET (bootstrap initial)
// ============================================================
function recalculerKPIMensuelsComplet() {
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) return;

  let dst = ss.getSheetByName(KPI_MENSUELS_SHEET);
  if (!dst) dst = ss.insertSheet(KPI_MENSUELS_SHEET);
  dst.clear();
  dst.appendRow(KPI_MENSUELS_HEADERS);
  dst.getRange(1, 1, 1, KPI_MENSUELS_HEADERS.length).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');

  const srcData = src.getDataRange().getValues();
  const srcHeaders = srcData[0];
  const srcRows = srcData.slice(1);
  const srcIdx = {};
  srcHeaders.forEach((h, i) => srcIdx[String(h).trim()] = i);

  // Collecter tous les sortKeys présents
  const sortKeysSet = new Set();
  srcRows.forEach(r => {
    const m = r[srcIdx['Mois']];
    const a = parseInt(r[srcIdx['Année']]);
    if (m && a && m !== '-' && MOIS_FR.indexOf(m) >= 0) {
      sortKeysSet.add(a + '-' + String(MOIS_FR.indexOf(m) + 1).padStart(2, '0'));
    }
  });
  const sortKeys = Array.from(sortKeysSet).sort();
  Logger.log('[KPIM-COMPLET] ' + sortKeys.length + ' mois à calculer.');

  // Bulk write
  const allRows = sortKeys.map(sk => calculerKPIsMois_(sk, srcRows, srcIdx));
  if (allRows.length > 0) {
    dst.getRange(2, 1, allRows.length, KPI_MENSUELS_HEADERS.length).setValues(allRows);
    // Tri décroissant
    dst.getRange(2, 1, allRows.length, KPI_MENSUELS_HEADERS.length).sort({column: 1, ascending: false});
  }

  formaterKPIMensuels_(dst);

  Logger.log('[KPIM-COMPLET] ✅ ' + Math.round((new Date().getTime() - t0) / 1000) + 's. ' + sortKeys.length + ' mois.');
  SpreadsheetApp.getUi().alert('✅ ' + sortKeys.length + ' mois calculés dans KPI_MENSUELS.');
}

// ============================================================
// FORMATS DE COLONNES KPI_MENSUELS
// ============================================================
function formaterKPIMensuels_(dst) {
  const lr = dst.getLastRow();
  if (lr < 2) return;
  const n = lr - 1;
  // Volumes HL
  dst.getRange(2, 6, n, 4).setNumberFormat('#,##0.0 "HL"');
  // Pourcentages KPI vitaux
  dst.getRange(2, 10, n, 5).setNumberFormat('0.0%'); // Rdt Global, Rdt Brass, Taux Perte, RFT, Planning
  // Coût / HL
  dst.getRange(2, 15, n, 1).setNumberFormat('#,##0 "€"');
  // TF1
  dst.getRange(2, 16, n, 1).setNumberFormat('#,##0.00');
  // Ratio Eau
  dst.getRange(2, 17, n, 1).setNumberFormat('0.00');
  // Économie €
  dst.getRange(2, 18, n, 1).setNumberFormat('#,##0 "€"');
  // Nb brassins (entiers)
  dst.getRange(2, 4, n, 2).setNumberFormat('0');
  dst.getRange(2, 19, n, 2).setNumberFormat('0');
  // Se Canto HL
  dst.getRange(2, 21, n, 4).setNumberFormat('#,##0.0 "HL"');
  // Occupation
  dst.getRange(2, 25, n, 1).setNumberFormat('0.0 "j"');
  // Date Calcul
  dst.getRange(2, 28, n, 1).setNumberFormat('dd/mm/yyyy HH:mm');
}

// ============================================================
// WRAPPER pour appel quotidien après sync
// ============================================================
function recalcKPIM_3DerniersMois() { recalculerKPIMensuels(3); }
