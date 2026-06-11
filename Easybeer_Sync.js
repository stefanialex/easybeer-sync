/**
 * ====================================================================
 * EASYBEER SYNC V5 + V12 — Script complet à coller intégralement
 * ====================================================================
 * V12 (juin 2026) — getKPIsWebApp enrichi avec KPI stocks PF via
 *                   enrichirAvecStocks_() défini dans 04_stocksPF.gs.
 * NOTE : API_USER et API_PASS sont dans ton fichier 00_config.gs.
 */

// ============================================================
// CONSTANTES CONFIGURABLES
// ============================================================
const ECONOMIE_LEVURE_BATCH = { 2: 0, 5: 0, 25: 0, 50: 600, 100: 1000 };
const ANNEE_DEBUT_STATS = 2024;
const SEUIL_VOL_HL_REUSSI = 1080;
const SEUIL_RDT_REUSSI = 0.88;
const SEUIL_PERTE_OBJECTIF = 0.12;

const OBJECTIF_SE_CANTO_2026_TOTAL = 2500;
const OBJECTIF_SE_CANTO_2026_BLONDE = 1500;
const OBJECTIF_SE_CANTO_2026_IPA = 500;
const OBJECTIF_SE_CANTO_2026_BLANCHE = 500;

const ETIQUETTES_BESOIN_BLONDE = 31818;
const ETIQUETTES_BESOIN_BLANCHE = 10606;
const ETIQUETTES_BESOIN_IPA = 10606;
const ETIQUETTES_COMMANDEES_BLONDE = 30000;
const ETIQUETTES_COMMANDEES_BLANCHE = 10000;
const ETIQUETTES_COMMANDEES_IPA = 10000;

const OBJECTIF_SC_BLONDE_FUTS = 1395;
const OBJECTIF_SC_BLONDE_BTL = 105;
const OBJECTIF_SC_IPA_FUTS = 465;
const OBJECTIF_SC_IPA_BTL = 35;
const OBJECTIF_SC_BLANCHE_FUTS = 465;
const OBJECTIF_SC_BLANCHE_BTL = 35;

const PROD_SHEET = 'HISTORIQUE_KPI';
const DASH_SHEET = 'DASHBOARD';
const CAVE_SHEET = 'ETAT_CAVE';
const QUALITE_SHEET = 'QUALITE';
const SECURITE_SHEET = 'SECURITE';
const ENERGIE_SHEET = 'ENERGIE';
const PROD_SLEEP_LIST = 1500;
const PROD_SLEEP_DETAIL = 2000;
const PROD_MAX_DETAIL_ENCOURS = 100;  // V9c : 50 → 100 (les brassins en cours peuvent dépasser 50 chez Prizm)
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
  'Rendement Brassage','Coût Total (€)','Coût / HL (€)','Taux Perte (%)','Conforme',
  'Nb Conditionnements',
  'Vol Se Canto Blonde Fûts (HL)','Vol Se Canto Blonde Btl (HL)',
  'Vol Se Canto IPA Fûts (HL)','Vol Se Canto IPA Btl (HL)',
  'Vol Se Canto Blanche Fûts (HL)','Vol Se Canto Blanche Btl (HL)'
];
const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const ETATS_EXCLUS = ['ANNULE', 'DETRUIT'];

// ============================================================
// MENU
// ============================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('🍺 Easybeer');
  menu.addItem('🚀 Tout faire maintenant', 'pipelineToutFaire')
      .addItem('🌐 URL du dashboard web', 'ouvrirDashboardWeb')
      .addItem('📊 Régénérer dashboard sheet', 'actualiserDashboard')
      .addItem('🏭 État cave actuel', 'etatCaveActuel');
  menu.addSeparator();
  menu.addItem('🌙 Activer mise à jour auto (nuit)', 'creerTriggerPipelineNuit')
      .addItem('⏹ Désactiver mise à jour auto', 'supprimerTriggerPipelineNuit')
      .addItem('🛢️ Activer sync stocks auto (1h)', 'creerTriggerSyncStocksNuit')
      .addItem('🛢️ Désactiver sync stocks auto', 'supprimerTriggerSyncStocksNuit')
      .addItem('🔁 Filtres dropdowns dashboard ON', 'activerFiltresInteractifs');
  menu.addSeparator();
  const avance = ui.createMenu('⚙️ Avancé');
  avance.addItem('🔐 Tester credentials Easybeer', 'testCredentialsEasybeer')
        .addItem('📦 Créer onglets QUALITE/SECURITE/ENERGIE', 'creerOngletsManuel')
        .addSeparator()
        .addItem('🔄 Sync HISTORIQUE_KPI', 'syncEasybeerToSheet')
        .addItem('🛢️ Sync stocks PF (manuel)', 'syncStocksPFEasybeer')
        .addItem('🩹 Rattraper dates manquantes', 'rattrapageDatesManquantes')
        .addItem('🔄 Rattrapage complet (multi-runs)', 'rattrapageComplet')
        .addItem('🍋 Rattrapage Se Canto (ciblé)', 'rattrapageSeCanto')
        .addItem('🔬 Debug Se Canto (un lot)', 'debugSeCantoLot')
        .addItem('🩺 Audit pipeline complet', 'auditPipelineCompletV13')
        .addItem('🗓 Corriger Mois/Année', 'corrigerMoisAnnee')
        .addItem('🛠 Corriger rendements', 'corrigerRendements')
        .addSeparator()
        .addItem('🔍 État pipeline', 'pipelineStatut')
        .addItem('🔄 Reset pipeline', 'pipelineReset')
        .addItem('♻️ Reset rattrapage complet', 'resetRattrapage')
        .addItem('♻️ Reset rattrapage Se Canto', 'resetRattrapageSeCanto')
        .addItem('🔁 Filtres dropdowns OFF', 'desactiverFiltresInteractifs');
  menu.addSubMenu(avance);
  setupMenuV13_(menu);
  menu.addToUi();
}

// ============================================================
// HELPERS
// ============================================================
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
  return Math.round(batchHL * 10);
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
  const result = { totalHL:0, blondeHL:0, ipaHL:0, blancheHL:0, blondeFuts:0, blondeBtl:0, ipaFuts:0, ipaBtl:0, blancheFuts:0, blancheBtl:0 };
  if (!productions || !Array.isArray(productions)) return result;
  productions.forEach(p => {
    const prod = p.produit || {};
    const nom = (prod.nom || prod.libelle || '').toString().toLowerCase();
    if (!nom.includes('canto')) return;
    const volHL = (p.volumeTotal || 0) / 100;
    result.totalHL += volHL;
    const typeStr = String(p.typeContenant || '').toLowerCase();
    const estFut = typeStr.indexOf('fût') >= 0 || typeStr.indexOf('fut') >= 0 || typeStr.indexOf('keg') >= 0;
    const estBtl = typeStr.indexOf('bouteille') >= 0 || typeStr.indexOf('btl') >= 0;
    let variante = '';
    if (nom.indexOf('blonde') >= 0 || nom.indexOf('lager') >= 0) variante = 'blonde';
    else if (nom.indexOf('blanche') >= 0 || nom.indexOf('blanc') >= 0) variante = 'blanche';
    else if (nom.indexOf('ipa') >= 0) variante = 'ipa';
    if (variante) {
      result[variante + 'HL'] += volHL;
      if (estFut) {
        if (variante === 'blonde') result.blondeFuts += volHL;
        else if (variante === 'ipa') result.ipaFuts += volHL;
        else if (variante === 'blanche') result.blancheFuts += volHL;
      } else if (estBtl) {
        if (variante === 'blonde') result.blondeBtl += volHL;
        else if (variante === 'ipa') result.ipaBtl += volHL;
        else if (variante === 'blanche') result.blancheBtl += volHL;
      }
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
  if (!sheet) { SpreadsheetApp.getUi().alert('Onglet ' + PROD_SHEET + ' introuvable.'); return; }
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
            conforme: idx['Conforme'] !== undefined ? data[r][idx['Conforme']] : 'O',
            nbCondi: idx['Nb Conditionnements'] !== undefined ? data[r][idx['Nb Conditionnements']] : 0,
            scBlondeFuts: idx['Vol Se Canto Blonde Fûts (HL)'] !== undefined ? data[r][idx['Vol Se Canto Blonde Fûts (HL)']] : 0,
            scBlondeBtl: idx['Vol Se Canto Blonde Btl (HL)'] !== undefined ? data[r][idx['Vol Se Canto Blonde Btl (HL)']] : 0,
            scIPAFuts: idx['Vol Se Canto IPA Fûts (HL)'] !== undefined ? data[r][idx['Vol Se Canto IPA Fûts (HL)']] : 0,
            scIPABtl: idx['Vol Se Canto IPA Btl (HL)'] !== undefined ? data[r][idx['Vol Se Canto IPA Btl (HL)']] : 0,
            scBlancheFuts: idx['Vol Se Canto Blanche Fûts (HL)'] !== undefined ? data[r][idx['Vol Se Canto Blanche Fûts (HL)']] : 0,
            scBlancheBtl: idx['Vol Se Canto Blanche Btl (HL)'] !== undefined ? data[r][idx['Vol Se Canto Blanche Btl (HL)']] : 0
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
    const res = UrlFetchApp.fetch(url, { method:'post', headers:auth, payload: JSON.stringify({"etats":[],"recherche":"","dateDebutBrassage":"2021-12-31T23:00:00.000Z","dateFinBrassage":"2030-12-30T23:00:00.000Z"}), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) { Logger.log('[SYNC] ❌ Page ' + page); return; }
    const data = JSON.parse(res.getContentText());
    if (page === 1) totalPages = data.totalPages || 1;
    if (Array.isArray(data.liste)) allBrassins = allBrassins.concat(data.liste);
    page++;
    if (page <= totalPages) Utilities.sleep(PROD_SLEEP_LIST);
  }
  Utilities.sleep(PROD_SLEEP_LIST);
  const ecRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/en-cours', { method:'post', headers:auth, payload:'{}', muteHttpExceptions:true });
  if (ecRes.getResponseCode() === 200) {
    const ecData = JSON.parse(ecRes.getContentText());
    if (ecData.etapes) ecData.etapes.forEach(eg => { if (eg.modelesBrassins) allBrassins = allBrassins.concat(eg.modelesBrassins); });
  }
  const seen = {};
  let unique = [];
  allBrassins.forEach(b => { if (b && b.idBrassin && !seen[b.idBrassin]) { seen[b.idBrassin] = true; unique.push(b); } });
  unique = unique.filter(b => { const c = b.etat && b.etat.code; return !ETATS_EXCLUS.includes(c); });
  Logger.log('[SYNC] ' + unique.length + ' après filtre.');

  const enCours = unique.filter(b => b.etat && b.etat.code === 'EN_COURS');
  const detailsParId = {};
  let nbDetails = 0;
  for (const b of enCours) {
    if (nbDetails >= PROD_MAX_DETAIL_ENCOURS) break;
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + b.idBrassin, { method:'get', headers:auth, muteHttpExceptions:true });
    nbDetails++;
    if (detRes.getResponseCode() === 200) { try { detailsParId[b.idBrassin] = JSON.parse(detRes.getContentText()); } catch(e) {} }
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
    if (extras.dateCondiReelle) dCondiReelle = new Date(extras.dateCondiReelle);
    else if (enriched.productions && enriched.productions.length > 0) {
      const dates = enriched.productions.map(p => p.date).filter(d => d);
      if (dates.length > 0) dCondiReelle = new Date(Math.max.apply(null, dates));
    } else if (enriched.dateMiseEnBouteille) dCondiReelle = new Date(enriched.dateMiseEnBouteille);
    const dCondiAffichee = dCondiReelle || (enriched.dateFin ? new Date(enriched.dateFin) : null);
    let vSorti = 0;
    if (enriched.productions && enriched.productions.length > 0) enriched.productions.forEach(p => { vSorti += (p.volumeTotal || 0); });
    else vSorti = enriched.volumeFinal || 0;
    const vBrasseHL = (enriched.volume || 0) / 100;
    const vSortiHL = vSorti / 100;
    const vTheoHL = calculBatchTheorique_(vBrasseHL);
    const ings = (enriched.ingredients && enriched.ingredients.length > 0) ? analyserIngredients_(enriched.ingredients) : null;
    const style = (prod.type && prod.type.libelle) ? prod.type.libelle : (extras.style || '');
    const levureAuto = ings ? ings.levure : (extras.levureManuelle || '-');
    const volFruitsHL = ings ? ings.volFruitsHL : (extras.volFruits || 0);
    let sc = { totalHL: extras.volSeCanto || 0, blondeHL: extras.scBlonde || 0, ipaHL: extras.scIPA || 0, blancheHL: extras.scBlanche || 0, blondeFuts: extras.scBlondeFuts || 0, blondeBtl: extras.scBlondeBtl || 0, ipaFuts: extras.scIPAFuts || 0, ipaBtl: extras.scIPABtl || 0, blancheFuts: extras.scBlancheFuts || 0, blancheBtl: extras.scBlancheBtl || 0 };
    if (enriched.productions && enriched.productions.length > 0) sc = extraireVolSeCanto_(enriched.productions);
    const vTheoCorrigeHL = vTheoHL + (volFruitsHL || 0);
    const rendement = vTheoCorrigeHL > 0 ? (vSortiHL / vTheoCorrigeHL) : 0;
    const rdtBrass = (enriched.rendementBrassin !== undefined && enriched.rendementBrassin !== null) ? enriched.rendementBrassin : (extras.rdtBrass || 0);
    const coutTotal = (enriched.cout !== undefined && enriched.cout !== null && typeof enriched.cout === 'number') ? enriched.cout : (extras.coutTotal || 0);
    const coutHL = vSortiHL > 0 ? (coutTotal / vSortiHL) : 0;
    const volBrasseAvecFruits = vBrasseHL + (volFruitsHL || 0);
    const tauxPerte = volBrasseAvecFruits > 0 ? (volBrasseAvecFruits - vSortiHL) / volBrasseAvecFruits : 0;
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
      lotNom, statut, prod.nom || 'Inconnu', marque,
      dDebut, dCondiAffichee, occupation,
      vBrasseHL, vTheoHL, vSortiHL, rendement,
      enriched.densiteInitiale || 0, enriched.densiteFinale || 0, enriched.ph || 0,
      levureAuto, eco, b.idBrassin || '', dCondiReelle || '',
      style, volFruitsHL || 0,
      sc.totalHL || 0, sc.blondeHL || 0, sc.ipaHL || 0, sc.blancheHL || 0,
      rdtBrass / 100 || 0, coutTotal || 0, coutHL || 0, tauxPerte || 0, conforme,
      (enriched.productions && enriched.productions.length) ? enriched.productions.length : (extras.nbCondi || 0),
      sc.blondeFuts || 0, sc.blondeBtl || 0, sc.ipaFuts || 0, sc.ipaBtl || 0, sc.blancheFuts || 0, sc.blancheBtl || 0
    ];
  });

  const lignesFinales = {};
  let nbActu = 0, nbCons = 0, nbNouv = 0;
  Object.keys(memParLot).forEach(lot => {
    if (lotsRempaes[lot]) return;
    if (lignesActualisees[lot]) { lignesFinales[lot] = lignesActualisees[lot]; nbActu++; }
    else { const o = memParLot[lot]; while (o.length < PROD_HEADERS.length) o.push(''); lignesFinales[lot] = o; nbCons++; }
  });
  Object.keys(lignesActualisees).forEach(lot => { if (!lignesFinales[lot]) { lignesFinales[lot] = lignesActualisees[lot]; nbNouv++; } });
  Logger.log('[SYNC] ' + nbActu + ' MAJ, ' + nbNouv + ' nouv, ' + nbCons + ' cons.');
  const finalRows = Object.values(lignesFinales);
  finalRows.sort((a, b) => { const da = a[7] ? new Date(a[7]).getTime() : 0; const db = b[7] ? new Date(b[7]).getTime() : 0; return db - da; });
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
  sheet.getRange(2, 27, finalRows.length, 1).setNumberFormat('0.0%');
  sheet.getRange(2, 28, finalRows.length, 2).setNumberFormat('#,##0 "€"');
  sheet.getRange(2, 30, finalRows.length, 1).setNumberFormat('0.0%');
  Logger.log('[SYNC] ✅ Terminé en ' + Math.round((new Date().getTime() - t0) / 1000) + ' s. ' + finalRows.length + ' lignes.');
}

// ============================================================
// RATTRAPAGE DATES MANQUANTES
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
    if (id && (!dr || dr === '')) queue.push({ row: r + 1, id: id, lot: data[r][idx['Lot']] });
  }
  Logger.log('[RATTRAP-DATES] Dates manquantes : ' + queue.length);
  if (queue.length === 0) { SpreadsheetApp.getUi().alert('✅ Toutes les dates sont remplies.'); return; }
  const auth = getAuthHeader_();
  let nbOk = 0, nbKO = 0;
  const updates = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + item.id, { method:'get', headers:auth, muteHttpExceptions:true });
    if (detRes.getResponseCode() !== 200) { nbKO++; continue; }
    let b; try { b = JSON.parse(detRes.getContentText()); } catch(e) { nbKO++; continue; }
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
      if (j > 0) occupation = j; else if (j === 0) occupation = 1;
    }
    updates.push({ row: item.row, mois: MOIS_FR[dCondiReelle.getMonth()], annee: dCondiReelle.getFullYear().toString(), dateCondi: dCondiReelle, dateCondiReelle: dCondiReelle, occupation: occupation });
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
// RATTRAPAGE COMPLET
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
  Logger.log('[RATTRAP] Queue : ' + queue.length + ' | CP : ' + checkpoint);
  if (checkpoint >= queue.length) { Logger.log('[RATTRAP] ✅'); props.deleteProperty(RATTRAP_PROP_KEY); return; }
  const batch = queue.slice(checkpoint, checkpoint + PROD_RATTRAP_BATCH);
  const auth = getAuthHeader_();
  let nbOk = 0, nbKO = 0;
  const updates = [];
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + item.id, { method:'get', headers:auth, muteHttpExceptions:true });
    if (detRes.getResponseCode() !== 200) { nbKO++; continue; }
    let b; try { b = JSON.parse(detRes.getContentText()); } catch(e) { nbKO++; continue; }
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
    const volBrasseAvecFruits = vBrasseHL + ings.volFruitsHL;
    const tauxPerte = volBrasseAvecFruits > 0 ? (volBrasseAvecFruits - vSortiHL) / volBrasseAvecFruits : 0;
    const dDebut = b.dateDebut ? new Date(b.dateDebut) : null;
    let occupation = 0;
    if (dDebut && dCondiReelle) {
      const j = Math.round((dCondiReelle - dDebut) / (1000*60*60*24));
      if (j > 0) occupation = j; else if (j === 0) occupation = 1;
    }
    const moisStr = dCondiReelle ? MOIS_FR[dCondiReelle.getMonth()] : '-';
    const anneeStr = dCondiReelle ? dCondiReelle.getFullYear().toString() : '-';
    const nbCondi = (b.productions && b.productions.length) ? b.productions.length : 0;
    updates.push({ row: item.row, mois: moisStr, annee: anneeStr, dateCondi: dCondiReelle, dateCondiReelle: dCondiReelle, occupation, vBrasseHL, vTheoHL, vSortiHL, rendement, style, levure: ings.levure, volFruits: ings.volFruitsHL, scTotal: sc.totalHL, scBlonde: sc.blondeHL, scIPA: sc.ipaHL, scBlanche: sc.blancheHL, rdtBrass: rdtBrass / 100, coutTotal, coutHL, tauxPerte, nbCondi, scBlondeFuts: sc.blondeFuts, scBlondeBtl: sc.blondeBtl, scIPAFuts: sc.ipaFuts, scIPABtl: sc.ipaBtl, scBlancheFuts: sc.blancheFuts, scBlancheBtl: sc.blancheBtl });
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
    if (idx['Nb Conditionnements'] !== undefined) sheet.getRange(u.row, idx['Nb Conditionnements'] + 1).setValue(u.nbCondi).setNumberFormat('0');
    if (idx['Vol Se Canto Blonde Fûts (HL)'] !== undefined) {
      sheet.getRange(u.row, idx['Vol Se Canto Blonde Fûts (HL)'] + 1).setValue(u.scBlondeFuts).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto Blonde Btl (HL)'] + 1).setValue(u.scBlondeBtl).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto IPA Fûts (HL)'] + 1).setValue(u.scIPAFuts).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto IPA Btl (HL)'] + 1).setValue(u.scIPABtl).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto Blanche Fûts (HL)'] + 1).setValue(u.scBlancheFuts).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto Blanche Btl (HL)'] + 1).setValue(u.scBlancheBtl).setNumberFormat('#,##0.00');
    }
  });
  const newCheckpoint = checkpoint + batch.length;
  props.setProperty(RATTRAP_PROP_KEY, String(newCheckpoint));
  Logger.log('[RATTRAP] ' + Math.round((new Date().getTime() - t0)/1000) + 's. OK:' + nbOk + ' KO:' + nbKO + ' Reste:' + (queue.length - newCheckpoint));
  if (newCheckpoint >= queue.length) { Logger.log('[RATTRAP] 🎉'); props.deleteProperty(RATTRAP_PROP_KEY); }
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

  // V9c fix : élargir la queue pour découvrir les nouveaux Se Canto sur brassins archivés récemment.
  // V9b ne ciblait que les brassins ayant déjà Vol Se Canto > 0, donc tout nouveau Se Canto
  // post-archivage restait invisible. Désormais on inclut aussi les brassins conditionnés
  // dans les SECANTO_RATTRAP_JOURS_RECENTS derniers jours (180j par défaut) + dédup par ID.
  const SECANTO_RATTRAP_JOURS_RECENTS = 180;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - SECANTO_RATTRAP_JOURS_RECENTS);

  const iId = idx['ID Brassin'];
  const iSC = idx['Vol Se Canto (HL)'];
  const iDateCondi = idx['Date Condi'];
  const iStatut = idx['Statut'];
  const seenIds = {};
  const queue = [];
  let nbAvecSC = 0, nbRecents = 0, nbEnCours = 0;
  for (let r = 1; r < data.length; r++) {
    const id = data[r][iId];
    if (!id || seenIds[id]) continue;
    const scTotal = parseValSafe_(data[r][iSC] || 0);
    const dateCondi = data[r][iDateCondi];
    const statut = String(data[r][iStatut] || '').trim().toLowerCase();
    const isRecent = (dateCondi instanceof Date) && !isNaN(dateCondi.getTime()) && dateCondi >= cutoffDate;
    const isEnCours = statut === 'en cours' || statut === 'planifié' || statut === 'planifie';
    if (scTotal > 0 || isRecent || isEnCours) {
      queue.push({ row: r + 1, id: id });
      seenIds[id] = true;
      if (scTotal > 0) nbAvecSC++;
      else if (isEnCours) nbEnCours++;
      else if (isRecent) nbRecents++;
    }
  }
  Logger.log('[SECANTO] Queue : ' + queue.length + ' (' + nbAvecSC + ' avec SC + ' + nbEnCours + ' en cours + ' + nbRecents + ' archivés <' + SECANTO_RATTRAP_JOURS_RECENTS + 'j) | CP : ' + checkpoint);
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
    // V9d : calculer Date Condi depuis productions pour rattraper les Mois/Année vides
    let dCondi = null;
    if (b.productions && b.productions.length > 0) {
      const dates = b.productions.map(p => p.date).filter(d => d);
      if (dates.length > 0) dCondi = new Date(Math.max.apply(null, dates));
    }
    if (!dCondi && b.dateFin) dCondi = new Date(b.dateFin);
    updates.push({ row:item.row, total:sc.totalHL, blonde:sc.blondeHL, ipa:sc.ipaHL, blanche:sc.blancheHL, blondeFuts:sc.blondeFuts, blondeBtl:sc.blondeBtl, ipaFuts:sc.ipaFuts, ipaBtl:sc.ipaBtl, blancheFuts:sc.blancheFuts, blancheBtl:sc.blancheBtl, dCondi: dCondi });
    nbOk++;
    if ((i+1)%20===0) Logger.log('[SECANTO] '+(i+1)+'/'+batch.length);
  }
  updates.forEach(u => {
    sheet.getRange(u.row, idx['Vol Se Canto (HL)'] + 1).setValue(u.total).setNumberFormat('#,##0.00');
    sheet.getRange(u.row, idx['Vol Se Canto Blonde (HL)'] + 1).setValue(u.blonde).setNumberFormat('#,##0.00');
    sheet.getRange(u.row, idx['Vol Se Canto IPA (HL)'] + 1).setValue(u.ipa).setNumberFormat('#,##0.00');
    sheet.getRange(u.row, idx['Vol Se Canto Blanche (HL)'] + 1).setValue(u.blanche).setNumberFormat('#,##0.00');
    if (idx['Vol Se Canto Blonde Fûts (HL)'] !== undefined) {
      sheet.getRange(u.row, idx['Vol Se Canto Blonde Fûts (HL)'] + 1).setValue(u.blondeFuts).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto Blonde Btl (HL)'] + 1).setValue(u.blondeBtl).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto IPA Fûts (HL)'] + 1).setValue(u.ipaFuts).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto IPA Btl (HL)'] + 1).setValue(u.ipaBtl).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto Blanche Fûts (HL)'] + 1).setValue(u.blancheFuts).setNumberFormat('#,##0.00');
      sheet.getRange(u.row, idx['Vol Se Canto Blanche Btl (HL)'] + 1).setValue(u.blancheBtl).setNumberFormat('#,##0.00');
    }
    // V9d : compléter Date Condi + Mois + Année si vides (cas brassin en cours avec productions)
    if (u.dCondi && idx['Date Condi'] !== undefined && idx['Mois'] !== undefined && idx['Année'] !== undefined) {
      const existingDate = sheet.getRange(u.row, idx['Date Condi'] + 1).getValue();
      const existingMois = sheet.getRange(u.row, idx['Mois'] + 1).getValue();
      const isEmpty = !existingDate || !(existingDate instanceof Date) || isNaN(existingDate.getTime()) || !existingMois || existingMois === '-';
      if (isEmpty) {
        sheet.getRange(u.row, idx['Date Condi'] + 1).setValue(u.dCondi);
        sheet.getRange(u.row, idx['Mois'] + 1).setValue(MOIS_FR[u.dCondi.getMonth()]);
        sheet.getRange(u.row, idx['Année'] + 1).setValue(u.dCondi.getFullYear().toString());
      }
    }
  });
  const newCp = checkpoint + batch.length;
  props.setProperty(RATTRAP_SECANTO_KEY, String(newCp));
  Logger.log('[SECANTO] '+Math.round((new Date().getTime()-t0)/1000)+'s. OK:'+nbOk+' KO:'+nbKO+' Reste:'+(queue.length-newCp));
  if (newCp >= queue.length) { Logger.log('[SECANTO] 🎉'); props.deleteProperty(RATTRAP_SECANTO_KEY); }
}
function resetRattrapageSeCanto() { PropertiesService.getScriptProperties().deleteProperty(RATTRAP_SECANTO_KEY); Logger.log('Reset OK.'); }

// ============================================================
// AUDIT PIPELINE COMPLET — vérifie l'intégrité de toute la chaîne
//   • Triggers actifs (les 3 attendus + triggers fantômes)
//   • État du pipeline (étape courante, checkpoints)
//   • Cohérence HISTORIQUE_KPI (brassins par statut, colonnes manquantes)
//   • Comparaison Easybeer sur les 5 brassins récemment archivés
// Génère un rapport dans l'onglet AUDIT_PIPELINE.
// ============================================================
function auditPipelineCompletV13() {
  const ui = SpreadsheetApp.getUi();
  const t0 = new Date().getTime();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let audit = ss.getSheetByName('AUDIT_PIPELINE');
  if (audit) audit.clear();
  else audit = ss.insertSheet('AUDIT_PIPELINE');
  let r = 1;
  const C = { OK: '#d1fae5', WARN: '#fef3c7', ERR: '#fee2e2', HDR: '#1f2937', SEC: '#fef3c7' };

  audit.getRange(r, 1).setValue('🔍 AUDIT PIPELINE — ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm'))
    .setFontSize(14).setFontWeight('bold').setBackground(C.HDR).setFontColor('white');
  audit.getRange(r, 1, 1, 5).merge();
  r += 2;

  // ----- Section 1 : Triggers actifs -----
  audit.getRange(r, 1).setValue('📅 1. TRIGGERS ACTIFS').setFontWeight('bold').setBackground(C.SEC); r++;
  const triggers = ScriptApp.getProjectTriggers();
  const expected = {
    'pipelineToutFaire': 'Pipeline nuit (chaque jour ~00h)',
    'syncStocksPFEasybeer': 'Sync stocks V12 (chaque jour ~01h)',
    'auditLotsFantomesHebdo': 'Audit Slack V13 (lundi ~09h)'
  };
  const found = {};
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    found[fn] = (found[fn] || 0) + 1;
  });
  Object.keys(expected).forEach(fn => {
    const ok = found[fn] > 0;
    audit.getRange(r, 1).setValue(fn);
    audit.getRange(r, 2).setValue(expected[fn]);
    audit.getRange(r, 3).setValue(ok ? '✅ Actif' : '❌ MANQUANT').setBackground(ok ? C.OK : C.ERR);
    r++;
  });
  let nbFantomes = 0;
  Object.keys(found).forEach(fn => {
    if (!expected[fn] && fn !== 'onOpen' && fn !== 'onEditDashboard' && fn !== 'pipelineEtapeSuivante') {
      audit.getRange(r, 1).setValue(fn);
      audit.getRange(r, 2).setValue('Inconnu');
      audit.getRange(r, 3).setValue('⚠️ ' + found[fn] + ' trigger(s)').setBackground(C.WARN);
      r++;
    }
    if (fn === 'pipelineEtapeSuivante' && found[fn] > 0) {
      audit.getRange(r, 1).setValue(fn);
      audit.getRange(r, 2).setValue('Trigger intermédiaire (devrait être 0 entre 2 pipelines)');
      audit.getRange(r, 3).setValue('⚠️ ' + found[fn] + ' actif(s)').setBackground(C.WARN);
      nbFantomes += found[fn];
      r++;
    }
  });
  r++;

  // ----- Section 2 : État pipeline -----
  audit.getRange(r, 1).setValue('🚦 2. ÉTAT PIPELINE').setFontWeight('bold').setBackground(C.SEC); r++;
  const props = PropertiesService.getScriptProperties();
  const etape = props.getProperty('PIPELINE_ETAPE') || 'INACTIF';
  const cpR = props.getProperty('RATTRAP_COMPLET_CHECKPOINT') || '-';
  const cpS = props.getProperty('RATTRAP_SECANTO_CHECKPOINT') || '-';
  const pipelineTermine = (etape === 'INACTIF' || etape === 'FINI');
  audit.getRange(r, 1).setValue('Étape courante'); audit.getRange(r, 2).setValue(etape);
  audit.getRange(r, 3).setValue(pipelineTermine ? '✅ Terminé' : '⚠️ Pipeline en cours').setBackground(pipelineTermine ? C.OK : C.WARN); r++;
  audit.getRange(r, 1).setValue('CP rattrapage complet'); audit.getRange(r, 2).setValue(cpR); r++;
  audit.getRange(r, 1).setValue('CP rattrapage Se Canto'); audit.getRange(r, 2).setValue(cpS); r++;
  r++;

  // ----- Section 3 : Cohérence HISTORIQUE_KPI -----
  audit.getRange(r, 1).setValue('📊 3. COHÉRENCE HISTORIQUE_KPI').setFontWeight('bold').setBackground(C.SEC); r++;
  const histo = ss.getSheetByName(PROD_SHEET);
  if (!histo) {
    audit.getRange(r, 1).setValue('❌ HISTORIQUE_KPI introuvable').setBackground(C.ERR);
    r++;
  } else {
    const data = histo.getDataRange().getValues();
    const idx = {};
    data[0].forEach((h, i) => idx[String(h).trim()] = i);
    let nbEnCours = 0, nbArchive = 0, nbAutre = 0;
    let nbSansMois = 0, nbArchSansVolCondi = 0, nbSansDateCondi = 0, nbEnCoursSansDateDebut = 0;
    let dernArchiveDate = null;
    const archivesRecents = [];
    for (let i = 1; i < data.length; i++) {
      const statut = String(data[i][idx['Statut']] || '').trim();
      if (statut === 'En cours') nbEnCours++;
      else if (statut === 'Archivé') nbArchive++;
      else nbAutre++;
      const mois = String(data[i][idx['Mois']] || '').trim();
      if (!mois || mois === '-') nbSansMois++;
      const vCondi = parseFloat(data[i][idx['Vol. Condi (HL)']]);
      if ((isNaN(vCondi) || vCondi === 0) && statut === 'Archivé') nbArchSansVolCondi++;
      const dCondi = data[i][idx['Date Condi']];
      if (!dCondi || !(dCondi instanceof Date)) nbSansDateCondi++;
      const dDebut = data[i][idx['Date Début']];
      if (statut === 'En cours' && (!dDebut || !(dDebut instanceof Date))) nbEnCoursSansDateDebut++;
      if (statut === 'Archivé' && dCondi instanceof Date) {
        if (!dernArchiveDate || dCondi > dernArchiveDate) dernArchiveDate = dCondi;
        archivesRecents.push({ row: i+1, lot: data[i][idx['Lot']], id: data[i][idx['ID Brassin']], dCondi: dCondi, vCondi: vCondi || 0 });
      }
    }
    audit.getRange(r, 1).setValue('Brassins En cours'); audit.getRange(r, 2).setValue(nbEnCours); r++;
    audit.getRange(r, 1).setValue('Brassins Archivés'); audit.getRange(r, 2).setValue(nbArchive); r++;
    audit.getRange(r, 1).setValue('Brassins Autre statut'); audit.getRange(r, 2).setValue(nbAutre); r++;
    audit.getRange(r, 1).setValue('Date dernier archivage'); audit.getRange(r, 2).setValue(dernArchiveDate ? Utilities.formatDate(dernArchiveDate, 'Europe/Paris', 'dd/MM/yyyy') : 'N/A'); r++;
    audit.getRange(r, 1).setValue('Sans Mois ("-")');
    audit.getRange(r, 2).setValue(nbSansMois).setBackground(nbSansMois > 5 ? C.ERR : (nbSansMois > 0 ? C.WARN : C.OK)); r++;
    audit.getRange(r, 1).setValue('Archivés sans Vol. Condi');
    audit.getRange(r, 2).setValue(nbArchSansVolCondi).setBackground(nbArchSansVolCondi > 0 ? C.ERR : C.OK); r++;
    audit.getRange(r, 1).setValue('Sans Date Condi');
    audit.getRange(r, 2).setValue(nbSansDateCondi).setBackground(nbSansDateCondi > 10 ? C.ERR : (nbSansDateCondi > 0 ? C.WARN : C.OK)); r++;
    audit.getRange(r, 1).setValue('En cours sans Date Début');
    audit.getRange(r, 2).setValue(nbEnCoursSansDateDebut).setBackground(nbEnCoursSansDateDebut > 0 ? C.ERR : C.OK); r++;
    r++;

    // ----- Section 4 : Comparaison Easybeer sur les 5 archivés les + récents -----
    audit.getRange(r, 1).setValue('🔬 4. COHÉRENCE EASYBEER ↔ SHEET (5 brassins récents)').setFontWeight('bold').setBackground(C.SEC); r++;
    audit.getRange(r, 1, 1, 6).setValues([['Lot', 'Date Condi Sheet', 'Vol Condi Sheet', 'Vol Easybeer (productions)', 'Écart abs', 'Statut']]).setFontWeight('bold').setBackground('#e5e7eb');
    r++;
    archivesRecents.sort((a, b) => b.dCondi.getTime() - a.dCondi.getTime());
    const sample = archivesRecents.slice(0, 5);
    const auth = getAuthHeader_();
    sample.forEach(a => {
      Utilities.sleep(500);
      try {
        const resp = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + a.id, { method:'get', headers:auth, muteHttpExceptions:true });
        if (resp.getResponseCode() === 200) {
          const b = JSON.parse(resp.getContentText());
          let volEB = 0;
          if (b.productions && b.productions.length > 0) b.productions.forEach(p => { volEB += (p.volumeTotal || 0); });
          volEB = volEB / 100;
          const ecart = Math.abs(a.vCondi - volEB);
          const statusBg = ecart < 0.5 ? C.OK : (ecart < 2 ? C.WARN : C.ERR);
          const statusTxt = ecart < 0.5 ? '✅ OK' : (ecart < 2 ? '⚠️ Léger écart' : '❌ Divergence importante');
          audit.getRange(r, 1).setValue(a.lot);
          audit.getRange(r, 2).setValue(a.dCondi).setNumberFormat('dd/mm/yyyy');
          audit.getRange(r, 3).setValue(a.vCondi).setNumberFormat('#,##0.00');
          audit.getRange(r, 4).setValue(volEB).setNumberFormat('#,##0.00');
          audit.getRange(r, 5).setValue(ecart).setNumberFormat('#,##0.00').setBackground(statusBg);
          audit.getRange(r, 6).setValue(statusTxt).setBackground(statusBg);
        } else {
          audit.getRange(r, 1).setValue(a.lot);
          audit.getRange(r, 6).setValue('❌ HTTP ' + resp.getResponseCode()).setBackground(C.ERR);
        }
      } catch (e) {
        audit.getRange(r, 1).setValue(a.lot);
        audit.getRange(r, 6).setValue('❌ ' + e.message).setBackground(C.ERR);
      }
      r++;
    });
  }
  r++;

  // ----- Footer -----
  const duree = Math.round((new Date().getTime() - t0) / 1000);
  audit.getRange(r, 1).setValue('Audit terminé en ' + duree + 's').setFontStyle('italic');
  audit.setColumnWidths(1, 6, 180);
  audit.setColumnWidth(2, 280);

  ui.alert('✅ Audit terminé en ' + duree + 's.\n\nOuvre l\'onglet AUDIT_PIPELINE pour le rapport complet.');
}

// ============================================================
// DEBUG SE CANTO — investigation pour un lot spécifique
// Affiche brassin Easybeer + productions + détection Se Canto
// Permet de diagnostiquer pourquoi un brassin n'a pas son Se Canto
// ============================================================
function debugSeCantoLot() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Debug Se Canto', 'Numéro de lot du brassin à investiguer :', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const lotCible = (resp.getResponseText() || '').trim();
  if (!lotCible) { ui.alert('Lot vide.'); return; }

  // 1. Récupérer l'ID Brassin depuis HISTORIQUE_KPI
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) { ui.alert('Onglet HISTORIQUE_KPI introuvable'); return; }
  const data = sheet.getDataRange().getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);
  let idBrassin = null;
  let nomProduit = '';
  let statut = '';
  let scActuel = 0;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idx['Lot']]).trim() === lotCible) {
      idBrassin = data[r][idx['ID Brassin']];
      nomProduit = data[r][idx['Bière']];
      statut = data[r][idx['Statut']];
      scActuel = parseValSafe_(data[r][idx['Vol Se Canto (HL)']]);
      break;
    }
  }
  if (!idBrassin) {
    ui.alert('❌ Lot ' + lotCible + ' non trouvé dans HISTORIQUE_KPI.\n\nSi le brassin est encore en cours et jamais synchronisé, lance d\'abord une sync.');
    return;
  }

  // 2. Appel détail Easybeer
  const auth = getAuthHeader_();
  const r = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + idBrassin, { method:'get', headers:auth, muteHttpExceptions:true });
  if (r.getResponseCode() !== 200) {
    ui.alert('❌ HTTP ' + r.getResponseCode() + ' sur /brassin/' + idBrassin);
    return;
  }
  const b = JSON.parse(r.getContentText());

  // 3. Analyse productions
  const productions = b.productions || [];
  let msg = '🔍 Debug lot ' + lotCible + '\n';
  msg += 'ID Brassin : ' + idBrassin + '\n';
  msg += 'Produit Sheet : ' + nomProduit + '\n';
  msg += 'Statut : ' + statut + '\n';
  msg += 'Se Canto Sheet : ' + scActuel + ' HL\n';
  msg += 'Date Début : ' + (b.dateDebut || '-') + '\n';
  msg += 'Date Fin : ' + (b.dateFin || '-') + '\n';
  msg += 'État API : ' + (b.etat ? (b.etat.code + ' / ' + b.etat.libelle) : '-') + '\n';
  msg += 'Vol brassé API : ' + ((b.volume||0)/100).toFixed(2) + ' HL\n';
  msg += '\n📦 PRODUCTIONS (' + productions.length + ') :\n';
  if (productions.length === 0) {
    msg += '  (aucune production attachée à ce brassin)\n';
  } else {
    productions.forEach((p, i) => {
      const prod = p.produit || {};
      const nom = prod.nom || prod.libelle || '?';
      const volHL = ((p.volumeTotal||0)/100).toFixed(2);
      const contenant = p.typeContenant || '?';
      const hasCanto = nom.toLowerCase().includes('canto');
      const date = p.date ? Utilities.formatDate(new Date(p.date), 'Europe/Paris', 'dd/MM/yyyy') : '-';
      msg += '  ' + (i+1) + '. ' + (hasCanto ? '🍋 ' : '   ') + nom + ' (' + volHL + ' HL, ' + contenant + ', ' + date + ')\n';
    });
  }

  // 4. Application extraireVolSeCanto_
  const sc = extraireVolSeCanto_(productions);
  msg += '\n🍋 extraireVolSeCanto_ retourne :\n';
  msg += '  Total : ' + sc.totalHL.toFixed(2) + ' HL\n';
  msg += '  Blonde : ' + sc.blondeHL.toFixed(2) + ' / IPA : ' + sc.ipaHL.toFixed(2) + ' / Blanche : ' + sc.blancheHL.toFixed(2) + ' HL\n';
  if (sc.totalHL === 0 && productions.length > 0) {
    msg += '\n⚠️ DIAGNOSTIC : aucune production ne contient "canto" dans son nom produit. ';
    msg += 'Vérifie comment Se Canto est nommé dans Easybeer pour ce brassin.';
  }

  Logger.log(msg);
  ui.alert(msg);
}

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
  cave.getRange(1, 1).setValue('🏭 ÉTAT CAVE — ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm')).setFontSize(16).setFontWeight('bold').setBackground('#000').setFontColor('white');
  cave.getRange(1, 1, 1, 6).merge();
  const headers = ['Lot', 'Bière', 'Marque', 'Matériel', 'Vol. Brassé (HL)', 'Jours en cuve'];
  cave.getRange(3, 1, 1, headers.length).setValues([headers]).setBackground('#666').setFontColor('white').setFontWeight('bold');
  const now = new Date();
  const rows = [];
  liste.forEach(b => {
    if (b.etat && (b.etat.code === 'ANNULE' || b.etat.code === 'DETRUIT')) return;
    const mat = (b.materielsAffectes && Array.isArray(b.materielsAffectes) && b.materielsAffectes.length > 0) ? b.materielsAffectes.map(m => m.libelle || m.nom || '?').join(', ') : '?';
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

function creerOngletsManuel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(QUALITE_SHEET)) {
    const s = ss.insertSheet(QUALITE_SHEET);
    s.getRange(1, 1).setValue('🍺 QUALITE').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
    s.getRange(1, 1, 1, 6).merge();
    s.getRange(3, 1, 1, 6).setValues([['Date', 'Lot', 'Type', 'Description', 'Volume affecté (HL)', 'Action prise']]).setBackground('#ead1dc').setFontWeight('bold');
  }
  if (!ss.getSheetByName(SECURITE_SHEET)) {
    const s = ss.insertSheet(SECURITE_SHEET);
    s.getRange(1, 1).setValue('🦺 SECURITE').setFontSize(14).setFontWeight('bold').setBackground('#cc0000').setFontColor('white');
    s.getRange(1, 1, 1, 6).merge();
    s.getRange(3, 1, 1, 6).setValues([['Mois', 'Année', 'Heures travaillées', 'Nb incidents', 'Nb presqu\'accidents', 'Commentaire']]).setBackground('#ead1dc').setFontWeight('bold');
  }
  if (!ss.getSheetByName(ENERGIE_SHEET)) {
    const s = ss.insertSheet(ENERGIE_SHEET);
    s.getRange(1, 1).setValue('💧 ENERGIE').setFontSize(14).setFontWeight('bold').setBackground('#0b5394').setFontColor('white');
    s.getRange(1, 1, 1, 6).merge();
    s.getRange(3, 1, 1, 6).setValues([['Mois', 'Année', 'Eau (m³)', 'Électricité (kWh)', 'Gaz (m³)', 'Commentaire']]).setBackground('#ead1dc').setFontWeight('bold');
  }
  SpreadsheetApp.getUi().alert('✅ Onglets QUALITE, SECURITE, ENERGIE créés.');
}

// ============================================================
// TRIGGERS QUOTIDIENS BASIQUES
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
// DASHBOARD V6 — avec FILTRES INTERACTIFS (sections A à J + graphes)
// ============================================================
function actualiserDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) { try { SpreadsheetApp.getUi().alert("❌ HISTORIQUE_KPI introuvable."); } catch(e){} return; }
  let dash = ss.getSheetByName(DASH_SHEET);
  if (!dash) dash = ss.insertSheet(DASH_SHEET);

  let moisFiltre = 'Courant', anneeFiltre = 'Courant', anneeHistoFiltre = '2026';
  try {
    if (dash.getLastRow() >= 3) {
      const b3 = dash.getRange('B3').getValue();
      const d3 = dash.getRange('D3').getValue();
      const f3 = dash.getRange('F3').getValue();
      if (b3) moisFiltre = String(b3);
      if (d3) anneeFiltre = String(d3);
      if (f3) anneeHistoFiltre = String(f3);
    }
  } catch(e) {}

  dash.getCharts().forEach(c => dash.removeChart(c));
  try { dash.getRange(1, 1, dash.getMaxRows(), dash.getMaxColumns()).breakApart(); } catch(e) {}
  dash.clear();
  SpreadsheetApp.flush();

  const data = src.getDataRange().getValues();
  if (data.length < 2) { try { SpreadsheetApp.getUi().alert("⚠️ Vide."); } catch(e){} return; }
  const headers = data[0];
  const rows = data.slice(1);
  const idx = {};
  headers.forEach((h, i) => idx[String(h).trim()] = i);

  const now = new Date();
  let yNow, mNow;
  if (anneeFiltre && anneeFiltre !== 'Courant' && !isNaN(parseInt(anneeFiltre))) yNow = parseInt(anneeFiltre);
  else yNow = now.getFullYear();
  if (moisFiltre && moisFiltre !== 'Courant' && MOIS_FR.indexOf(moisFiltre) >= 0) mNow = moisFiltre;
  else mNow = MOIS_FR[now.getMonth()];

  const moisIdxNow = MOIS_FR.indexOf(mNow);
  const prevDate = new Date(yNow, moisIdxNow - 1, 1);
  const yPrev = prevDate.getFullYear();
  const mPrev = MOIS_FR[prevDate.getMonth()];
  const lastYrDate = new Date(yNow - 1, moisIdxNow, 1);
  const yLastY = lastYrDate.getFullYear();
  const mLastY = MOIS_FR[lastYrDate.getMonth()];
  const date12wAgo = new Date(yNow, moisIdxNow, 1); date12wAgo.setDate(date12wAgo.getDate() - 84);
  const date12mAgo = new Date(yNow, moisIdxNow - 11, 1);

  const kpi = {
    now:  { vol:0, count:0, volTheoFini:0, volCondiFini:0, volFruitsFini:0, brands:{}, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 },
    prev: { vol:0, count:0, volTheoFini:0, volCondiFini:0, volFruitsFini:0, brands:{}, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 },
    lastY:{ vol:0, count:0, volTheoFini:0, volCondiFini:0, volFruitsFini:0, brands:{}, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0, conformeOK:0, conformeKO:0 }
  };
  const occupParStyle2025 = {}, occupParStyle2026 = {};
  const cadenceHebdo = {};
  const histMensuel = {};
  const styleMensuel = {};
  const compAnnuel = {};
  const seCantoMensuel2026 = {};
  const seCantoTotal2026 = { total:0, blonde:0, ipa:0, blanche:0 };
  const enCoursLongs = { j30: [], j60: [] };
  let totalRepitch = 0, totalLevureNeuve = 0;
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
    const coutHL = idx['Coût / HL (€)'] !== undefined ? parseValSafe_(r[idx['Coût / HL (€)']]) : 0;
    const conforme = idx['Conforme'] !== undefined ? String(r[idx['Conforme']] || 'O').toUpperCase() : 'O';
    const nbCondi = idx['Nb Conditionnements'] !== undefined ? parseValSafe_(r[idx['Nb Conditionnements']]) : 0;
    const occ = parseValSafe_(r[idx['Jours Occupation']]);
    const eco = parseValSafe_(r[idx['Économie (€)']]);
    const dCondi = r[idx['Date Condi Réelle']] ? new Date(r[idx['Date Condi Réelle']]) : (r[idx['Date Condi']] ? new Date(r[idx['Date Condi']]) : null);
    const dDebut = r[idx['Date Début']] ? new Date(r[idx['Date Début']]) : null;
    const levure = idx['Levure Neuve'] !== undefined ? r[idx['Levure Neuve']] : '';

    if (marque !== '-') globalBrandsSet.add(marque);
    const aDesProductions = vCondi > 0;
    const isEnCours = statut.toLowerCase().includes('en cours');
    const volBrasseAvecFruits = vBrasse + vFruits;
    const tauxPerteCalc = volBrasseAvecFruits > 0 ? (volBrasseAvecFruits - vCondi) / volBrasseAvecFruits : 0;
    tousLesBrassins.push({lot, biere, marque, style, statut, vCondi, vBrasse, vFruits, dCondi, aDesProductions});

    if (occ > 0 && style) {
      if (a === 2025) { if (!occupParStyle2025[style]) occupParStyle2025[style] = { jours:0, count:0 }; occupParStyle2025[style].jours += occ; occupParStyle2025[style].count++; }
      else if (a === 2026) { if (!occupParStyle2026[style]) occupParStyle2026[style] = { jours:0, count:0 }; occupParStyle2026[style].jours += occ; occupParStyle2026[style].count++; }
    }
    if (dCondi && dCondi >= date12wAgo) {
      const wk = isoWeekKey_(dCondi);
      if (!cadenceHebdo[wk]) cadenceHebdo[wk] = { brassins:0, condi:0, volCondi:0, volBrasse:0 };
      cadenceHebdo[wk].brassins++;
      cadenceHebdo[wk].condi += (nbCondi > 0 ? nbCondi : 1);
      cadenceHebdo[wk].volCondi += vCondi;
      cadenceHebdo[wk].volBrasse += vBrasse;
    }
    if (isEnCours && dDebut) {
      const days = Math.round((now - dDebut)/(1000*60*60*24));
      if (days >= 60) enCoursLongs.j60.push({lot, biere, marque, days});
      else if (days >= 30) enCoursLongs.j30.push({lot, biere, marque, days});
    }
    const aggKpi = (t) => {
      t.vol += vCondi; t.count++;
      t.brands[marque] = (t.brands[marque] || 0) + 1;
      if (aDesProductions) {
        t.volTheoFini += vTheo; t.volCondiFini += vCondi; t.volFruitsFini += vFruits;
        if (rdtBrass > 0) { t.rdtBrassSum += rdtBrass; t.rdtBrassN++; }
        if (tauxPerteCalc > 0) { t.perteSum += tauxPerteCalc; t.perteN++; }
        if (coutHL > 0) { t.coutHLSum += coutHL; t.coutHLN++; }
        if (conforme === 'O') t.conformeOK++; else if (conforme === 'N') t.conformeKO++;
      }
    };
    if (m === mNow && a === yNow) aggKpi(kpi.now);
    else if (m === mPrev && a === yPrev) aggKpi(kpi.prev);
    else if (m === mLastY && a === yLastY) aggKpi(kpi.lastY);

    if (a >= ANNEE_DEBUT_STATS && !isNaN(a)) {
      if (!compAnnuel[a]) compAnnuel[a] = { vol:0, count:0, theoFini:0, condiFini:0, fruitsFini:0, repitch:0, levureNeuve:0, brassinsFruits:0, hlFruits:0, ecoEur:0, rdtBrassSum:0, rdtBrassN:0, perteSum:0, perteN:0, coutHLSum:0, coutHLN:0 };
      const ca = compAnnuel[a];
      ca.vol += vCondi; ca.count++;
      if (aDesProductions) {
        ca.theoFini += vTheo; ca.condiFini += vCondi; ca.fruitsFini += vFruits;
        const lstr = String(levure || '').trim();
        if (lstr === '' || lstr === '-') { ca.repitch++; ca.ecoEur += eco; } else ca.levureNeuve++;
        if (rdtBrass > 0) { ca.rdtBrassSum += rdtBrass; ca.rdtBrassN++; }
        if (tauxPerteCalc > 0) { ca.perteSum += tauxPerteCalc; ca.perteN++; }
        if (coutHL > 0) { ca.coutHLSum += coutHL; ca.coutHLN++; }
      }
      if (vFruits > 0) { ca.brassinsFruits++; ca.hlFruits += vFruits; }
    }
    if (m && m !== '-') {
      const sortKey = a + '-' + String(MOIS_FR.indexOf(m) + 1).padStart(2, '0');
      if (!histMensuel[sortKey]) histMensuel[sortKey] = { label: m+' '+a, annee:a, vol:0, count:0, theo:0, theoCorrige:0, condiFini:0, occTotal:0, occCount:0, brands:{} };
      const h = histMensuel[sortKey];
      h.vol += vCondi; h.count++;
      h.brands[marque] = (h.brands[marque] || 0) + 1;
      if (aDesProductions) { h.theo += vTheo; h.theoCorrige += (vTheo+vFruits); h.condiFini += vCondi; }
      if (occ > 0) { h.occTotal += occ; h.occCount++; }
      if (style && aDesProductions) {
        if (!styleMensuel[sortKey]) styleMensuel[sortKey] = {};
        if (!styleMensuel[sortKey][style]) styleMensuel[sortKey][style] = { count:0, vol:0, theo:0, theoCorrige:0 };
        const s = styleMensuel[sortKey][style];
        s.count++; s.vol += vCondi; s.theo += vTheo; s.theoCorrige += (vTheo+vFruits);
      }
      if (a === 2026 && scTotal > 0) {
        if (!seCantoMensuel2026[sortKey]) seCantoMensuel2026[sortKey] = { label: m+' '+a, total:0, blonde:0, ipa:0, blanche:0 };
        const sm = seCantoMensuel2026[sortKey];
        sm.total += scTotal; sm.blonde += scBlonde; sm.ipa += scIPA; sm.blanche += scBlanche;
      }
    }
    if (a === 2026 && scTotal > 0) {
      seCantoTotal2026.total += scTotal; seCantoTotal2026.blonde += scBlonde;
      seCantoTotal2026.ipa += scIPA; seCantoTotal2026.blanche += scBlanche;
    }
    if (aDesProductions) {
      const lstr = String(levure || '').trim();
      if (lstr === '' || lstr === '-') totalRepitch++; else totalLevureNeuve++;
    }
    if (vFruits > 0) { totalFruitsBrassins++; totalFruitsHL += vFruits; }
  });

  let r = 1;
  dash.getRange(r, 1).setValue('📊 DASHBOARD PRODUCTION : ' + mNow.toUpperCase() + ' ' + yNow).setFontSize(18).setFontWeight('bold').setBackground('#000').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge().setHorizontalAlignment('center');
  r++;
  dash.getRange(r, 1).setValue('Mis à jour le ' + Utilities.formatDate(now, 'Europe/Paris', 'dd/MM/yyyy HH:mm')).setFontStyle('italic').setFontColor('#666');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  // FILTRES (r=3)
  dash.getRange(r, 1).setValue('🔍 Mois :').setFontWeight('bold').setBackground('#fff2cc');
  dash.getRange(r, 2).setValue(moisFiltre).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Courant'].concat(MOIS_FR)).setAllowInvalid(false).build()).setBackground('#ffe599').setFontWeight('bold').setHorizontalAlignment('center');
  dash.getRange(r, 3).setValue('Année :').setFontWeight('bold').setBackground('#fff2cc');
  dash.getRange(r, 4).setValue(anneeFiltre).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Courant', '2024', '2025', '2026', '2027']).setAllowInvalid(false).build()).setBackground('#ffe599').setFontWeight('bold').setHorizontalAlignment('center');
  dash.getRange(r, 5).setValue('Année histo J :').setFontWeight('bold').setBackground('#fff2cc');
  dash.getRange(r, 6).setValue(anneeHistoFiltre).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Toutes', '2024', '2025', '2026', '2027']).setAllowInvalid(false).build()).setBackground('#ffe599').setFontWeight('bold').setHorizontalAlignment('center');
  dash.getRange(r, 7).setValue('← Modifie pour filtrer').setFontStyle('italic').setFontColor('#666');
  r += 2;

  // KPI VITAUX
  dash.getRange(r, 1).setValue('🎯 KPI VITAUX — ' + mNow + ' ' + yNow).setFontSize(14).setFontWeight('bold').setBackground('#cc0000').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const yieldGlobalNow = (kpi.now.volTheoFini + kpi.now.volFruitsFini) > 0 ? kpi.now.volCondiFini / (kpi.now.volTheoFini + kpi.now.volFruitsFini) : 0;
  const perteNow = kpi.now.perteN > 0 ? kpi.now.perteSum / kpi.now.perteN : 0;
  const coutHLNow = kpi.now.coutHLN > 0 ? kpi.now.coutHLSum / kpi.now.coutHLN : 0;
  const kpiRows = [
    ['KPI VITAL', 'Période choisie', 'Objectif', 'Statut'],
    ['1. Rendement Global', yieldGlobalNow, 0.88, (Math.round(yieldGlobalNow * 1000) / 1000) >= 0.88 ? '✅' : '⚠️'],
    ['2. Taux de Perte Totale (avec fruits)', perteNow, SEUIL_PERTE_OBJECTIF, perteNow <= SEUIL_PERTE_OBJECTIF ? '✅' : '⚠️'],
    ['3. Batch Right-First-Time', 'NC', 'NC', '🔧 Système à mettre en place'],
    ['4. Respect planning', 'NC', 'NC', '🔧 Voir onglets Planning'],
    ['5. Coût matière par HL', coutHLNow, 'À config/style', '—'],
    ['6. Incidents sécurité (TF1)', 'NC', 'NC', '🔧 Pas de système']
  ];
  dash.getRange(r, 1, kpiRows.length, 4).setValues(kpiRows);
  dash.getRange(r, 1, 1, 4).setBackground('#cc0000').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, 1, 2).setNumberFormat('0.0%');
  dash.getRange(r+2, 2, 1, 2).setNumberFormat('0.0%');
  dash.getRange(r+5, 2, 1, 1).setNumberFormat('#,##0 "€"');
  r += kpiRows.length + 2;

  // A - RÉSUMÉ
  dash.getRange(r, 1).setValue('🎯 A — RÉSUMÉ EXÉCUTIF').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  let topMarque = '-', topMarqueVol = 0;
  Object.keys(kpi.now.brands).forEach(b => { if (b !== '-' && kpi.now.brands[b] > topMarqueVol) { topMarque = b; topMarqueVol = kpi.now.brands[b]; } });
  const resTable = [
    ['INDICATEUR','VALEUR','','INDICATEUR','VALEUR'],
    ['Volume Total HL période', kpi.now.vol, '', 'Rendement Global', yieldGlobalNow],
    ['Brassins période', kpi.now.count, '', 'Top Marque', topMarque + ' (' + topMarqueVol + ')'],
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

  // B - COMPARATIF
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
    ['Rendement', yieldGlobalNow, yieldPrev, yieldLastY, evol(yieldGlobalNow, yieldPrev), evol(yieldGlobalNow, yieldLastY)]
  ];
  dash.getRange(r, 1, compTable.length, 6).setValues(compTable);
  dash.getRange(r, 1, 1, 6).setBackground('#444').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, 1, 3).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+2, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+3, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+1, 5, compTable.length-1, 2).setNumberFormat('+0.0%;-0.0%;0%');
  r += compTable.length + 2;

  // C - CADENCE HEBDO
  dash.getRange(r, 1).setValue('⚡ C — CADENCE 12 SEMAINES').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const cadStart = r;
  const cadKeys = Object.keys(cadenceHebdo).sort();
  const cadRows = [['Semaine ISO', 'Nb Brassins', 'Nb Conditionnements', 'Vol. Conditionné (HL)', 'Vol. Brassé (HL)']];
  cadKeys.forEach(k => cadRows.push([k, cadenceHebdo[k].brassins, cadenceHebdo[k].condi, cadenceHebdo[k].volCondi, cadenceHebdo[k].volBrasse]));
  if (cadRows.length === 1) cadRows.push(['(aucune)', 0, 0, 0, 0]);
  dash.getRange(r, 1, cadRows.length, 5).setValues(cadRows);
  dash.getRange(r, 1, 1, 5).setBackground('#666').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, cadRows.length-1, 1).setNumberFormat('0');
  dash.getRange(r+1, 3, cadRows.length-1, 1).setNumberFormat('0');
  dash.getRange(r+1, 4, cadRows.length-1, 1).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 5, cadRows.length-1, 1).setNumberFormat('#,##0.0 "HL"');
  if (cadRows.length > 2) {
    try {
      const c = dash.newChart().setChartType(Charts.ChartType.LINE)
        .addRange(dash.getRange(cadStart, 1, cadRows.length, 1))
        .addRange(dash.getRange(cadStart, 4, cadRows.length, 2))
        .setPosition(cadStart, 7, 0, 0)
        .setOption('title','Cadence hebdo — Conditionné vs Brassé (HL)')
        .setOption('width',550).setOption('height',300)
        .setOption('colors', ['#1c4587', '#cc0000'])
        .setOption('legend', {position: 'bottom'})
        .setOption('hAxis', {slantedText: true, slantedTextAngle: 45})
        .setOption('vAxis', {title: 'HL', format: '#,##0'})
        .build();
      dash.insertChart(c);
    } catch(e) {}
  }
  r += cadRows.length + 2;

  // D - MIX MARQUES
  dash.getRange(r, 1).setValue('🎨 D — MIX MARQUES (' + mNow + ' ' + yNow + ')').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const mixStart = r;
  const mixRows = [['Marque','Nb Brassins','Vol HL','% Vol']];
  const totalVolMois = kpi.now.vol;
  Array.from(globalBrandsSet).sort().forEach(b => {
    if (b !== '-') {
      let volB = 0, nbB = 0;
      tousLesBrassins.forEach(br => { if (br.marque === b && br.dCondi && br.dCondi.getMonth() === moisIdxNow && br.dCondi.getFullYear() === yNow) { volB += br.vCondi; nbB++; } });
      mixRows.push([b, nbB, volB, totalVolMois > 0 ? volB/totalVolMois : 0]);
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
        .setPosition(mixStart, 5, 0, 0)
        .setOption('title','Mix HL').setOption('width',500).setOption('height',280)
        .setOption('colors', ['#cc0000','#ff9900','#ffcc00','#6aa84f','#1c4587','#674ea7','#a64d79'])
        .setOption('pieSliceText', 'percentage').build();
      dash.insertChart(c);
    } catch(e) {}
  }
  r += mixRows.length + 2;

  // E - PERFORMANCE STYLE
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

  // F - SE CANTO
  dash.getRange(r, 1).setValue('🆕 F — SUIVI SE CANTO 2026 (vs Objectifs)').setFontSize(14).setFontWeight('bold').setBackground('#a64d79').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const jauge = (val, obj) => { const pct = obj > 0 ? val/obj : 0; const filled = Math.min(20, Math.round(pct * 20)); return '▓'.repeat(filled) + '░'.repeat(20 - filled); };
  const scAnRows = [
    ['Variante', 'Réalisé 2026', 'Objectif', '% Atteint', 'Jauge'],
    ['TOTAL', seCantoTotal2026.total, OBJECTIF_SE_CANTO_2026_TOTAL, OBJECTIF_SE_CANTO_2026_TOTAL > 0 ? seCantoTotal2026.total/OBJECTIF_SE_CANTO_2026_TOTAL : 0, jauge(seCantoTotal2026.total, OBJECTIF_SE_CANTO_2026_TOTAL)],
    ['Blonde', seCantoTotal2026.blonde, OBJECTIF_SE_CANTO_2026_BLONDE, OBJECTIF_SE_CANTO_2026_BLONDE > 0 ? seCantoTotal2026.blonde/OBJECTIF_SE_CANTO_2026_BLONDE : 0, jauge(seCantoTotal2026.blonde, OBJECTIF_SE_CANTO_2026_BLONDE)],
    ['IPA', seCantoTotal2026.ipa, OBJECTIF_SE_CANTO_2026_IPA, OBJECTIF_SE_CANTO_2026_IPA > 0 ? seCantoTotal2026.ipa/OBJECTIF_SE_CANTO_2026_IPA : 0, jauge(seCantoTotal2026.ipa, OBJECTIF_SE_CANTO_2026_IPA)],
    ['Blanche', seCantoTotal2026.blanche, OBJECTIF_SE_CANTO_2026_BLANCHE, OBJECTIF_SE_CANTO_2026_BLANCHE > 0 ? seCantoTotal2026.blanche/OBJECTIF_SE_CANTO_2026_BLANCHE : 0, jauge(seCantoTotal2026.blanche, OBJECTIF_SE_CANTO_2026_BLANCHE)]
  ];
  dash.getRange(r, 1, scAnRows.length, 5).setValues(scAnRows);
  dash.getRange(r, 1, 1, 5).setBackground('#a64d79').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, scAnRows.length-1, 2).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 4, scAnRows.length-1, 1).setNumberFormat('0.0%');
  dash.getRange(r+1, 1, scAnRows.length-1, 1).setFontWeight('bold');
  r += scAnRows.length + 1;

  // Détail Fûts/Btl par variante
  dash.getRange(r, 1).setValue('Détail Fûts vs Bouteilles par variante').setFontWeight('bold').setBackground('#d5a6bd');
  dash.getRange(r, 1, 1, 5).merge();
  r++;
  let scBlF = 0, scBlB = 0, scIF = 0, scIB = 0, scWF = 0, scWB = 0;
  rows.forEach(rr => {
    const a = parseInt(rr[idx['Année']]);
    if (a !== 2026) return;
    scBlF += parseValSafe_(rr[idx['Vol Se Canto Blonde Fûts (HL)']] || 0);
    scBlB += parseValSafe_(rr[idx['Vol Se Canto Blonde Btl (HL)']] || 0);
    scIF += parseValSafe_(rr[idx['Vol Se Canto IPA Fûts (HL)']] || 0);
    scIB += parseValSafe_(rr[idx['Vol Se Canto IPA Btl (HL)']] || 0);
    scWF += parseValSafe_(rr[idx['Vol Se Canto Blanche Fûts (HL)']] || 0);
    scWB += parseValSafe_(rr[idx['Vol Se Canto Blanche Btl (HL)']] || 0);
  });
  const objTotalFuts = OBJECTIF_SC_BLONDE_FUTS + OBJECTIF_SC_IPA_FUTS + OBJECTIF_SC_BLANCHE_FUTS;
  const objTotalBtl = OBJECTIF_SC_BLONDE_BTL + OBJECTIF_SC_IPA_BTL + OBJECTIF_SC_BLANCHE_BTL;
  const pct = (a,b) => b > 0 ? a/b : 0;
  const futBtlRows = [
    ['Variante', 'Type', 'Réalisé (HL)', 'Objectif (HL)', '% Atteint'],
    ['Blonde', 'Fûts', scBlF, OBJECTIF_SC_BLONDE_FUTS, pct(scBlF, OBJECTIF_SC_BLONDE_FUTS)],
    ['Blonde', 'Bouteilles', scBlB, OBJECTIF_SC_BLONDE_BTL, pct(scBlB, OBJECTIF_SC_BLONDE_BTL)],
    ['IPA', 'Fûts', scIF, OBJECTIF_SC_IPA_FUTS, pct(scIF, OBJECTIF_SC_IPA_FUTS)],
    ['IPA', 'Bouteilles', scIB, OBJECTIF_SC_IPA_BTL, pct(scIB, OBJECTIF_SC_IPA_BTL)],
    ['Blanche', 'Fûts', scWF, OBJECTIF_SC_BLANCHE_FUTS, pct(scWF, OBJECTIF_SC_BLANCHE_FUTS)],
    ['Blanche', 'Bouteilles', scWB, OBJECTIF_SC_BLANCHE_BTL, pct(scWB, OBJECTIF_SC_BLANCHE_BTL)],
    ['TOTAL', 'Fûts', scBlF+scIF+scWF, objTotalFuts, pct(scBlF+scIF+scWF, objTotalFuts)],
    ['TOTAL', 'Bouteilles', scBlB+scIB+scWB, objTotalBtl, pct(scBlB+scIB+scWB, objTotalBtl)]
  ];
  dash.getRange(r, 1, futBtlRows.length, 5).setValues(futBtlRows);
  dash.getRange(r, 1, 1, 5).setBackground('#a64d79').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 3, futBtlRows.length-1, 2).setNumberFormat('#,##0.0 "HL"');
  dash.getRange(r+1, 5, futBtlRows.length-1, 1).setNumberFormat('0.0%');
  dash.getRange(r+7, 1, 2, 5).setFontWeight('bold').setBackground('#fce4ec');
  r += futBtlRows.length + 2;

  // Détail mensuel 2026
  dash.getRange(r, 1).setValue('Détail mensuel 2026').setFontWeight('bold').setBackground('#d5a6bd');
  dash.getRange(r, 1, 1, 5).merge();
  r++;
  const scKeys = Object.keys(seCantoMensuel2026).sort((a,b) => b.localeCompare(a));
  const scMRows = [['Mois','Total HL','Blonde','IPA','Blanche']];
  if (scKeys.length === 0) scMRows.push(['(rien)',0,0,0,0]);
  else scKeys.forEach(k => { const sc = seCantoMensuel2026[k]; scMRows.push([sc.label, sc.total, sc.blonde, sc.ipa, sc.blanche]); });
  dash.getRange(r, 1, scMRows.length, 5).setValues(scMRows);
  dash.getRange(r, 1, 1, 5).setBackground('#a64d79').setFontColor('white').setFontWeight('bold');
  if (scKeys.length > 0) dash.getRange(r+1, 2, scMRows.length-1, 4).setNumberFormat('#,##0.0 "HL"');
  r += scMRows.length + 1;

  // Suivi étiquettes
  dash.getRange(r, 1).setValue('Suivi étiquettes (à commander si reliquat > 0, délai 10j)').setFontWeight('bold').setBackground('#d5a6bd');
  dash.getRange(r, 1, 1, 5).merge();
  r++;
  const relB = ETIQUETTES_BESOIN_BLONDE - ETIQUETTES_COMMANDEES_BLONDE;
  const relW = ETIQUETTES_BESOIN_BLANCHE - ETIQUETTES_COMMANDEES_BLANCHE;
  const relI = ETIQUETTES_BESOIN_IPA - ETIQUETTES_COMMANDEES_IPA;
  const etiqRows = [
    ['Type', 'Besoin', 'Commandé', 'Reliquat', 'Statut'],
    ['Blonde', ETIQUETTES_BESOIN_BLONDE, ETIQUETTES_COMMANDEES_BLONDE, relB, relB > 0 ? '⚠️ À commander' : '✅'],
    ['Blanche', ETIQUETTES_BESOIN_BLANCHE, ETIQUETTES_COMMANDEES_BLANCHE, relW, relW > 0 ? '⚠️ À commander' : '✅'],
    ['IPA', ETIQUETTES_BESOIN_IPA, ETIQUETTES_COMMANDEES_IPA, relI, relI > 0 ? '⚠️ À commander' : '✅'],
    ['TOTAL', ETIQUETTES_BESOIN_BLONDE+ETIQUETTES_BESOIN_BLANCHE+ETIQUETTES_BESOIN_IPA, ETIQUETTES_COMMANDEES_BLONDE+ETIQUETTES_COMMANDEES_BLANCHE+ETIQUETTES_COMMANDEES_IPA, relB+relW+relI, (relB+relW+relI) > 0 ? '⚠️ Délai 10 jours' : '✅']
  ];
  dash.getRange(r, 1, etiqRows.length, 5).setValues(etiqRows);
  dash.getRange(r, 1, 1, 5).setBackground('#a64d79').setFontColor('white').setFontWeight('bold');
  dash.getRange(r+1, 2, etiqRows.length-1, 3).setNumberFormat('#,##0');
  dash.getRange(r+4, 1, 1, 5).setFontWeight('bold');
  r += etiqRows.length + 2;

  // G - COMPARATIF ANNUEL
  dash.getRange(r, 1).setValue('📆 G — COMPARATIF ANNUEL 2024 / 2025 / 2026').setFontSize(14).setFontWeight('bold').setBackground('#0b5394').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const ca24 = compAnnuel[2024] || {};
  const ca25 = compAnnuel[2025] || {};
  const ca26 = compAnnuel[2026] || {};
  const rdtg = (c) => (c.theoFini + c.fruitsFini) > 0 ? c.condiFini / (c.theoFini + c.fruitsFini) : 0;
  const avg = (s, n) => n > 0 ? s/n : 0;
  const pctRep = (c) => { const total = (c.levureNeuve || 0) + (c.repitch || 0); return total > 0 ? c.repitch / total : 0; };
  const compAnRows = [['Indicateur','2024','2025','2026'],
    ['Volume Total HL', ca24.vol||0, ca25.vol||0, ca26.vol||0],
    ['Nb Brassins', ca24.count||0, ca25.count||0, ca26.count||0],
    ['Rendement Global', rdtg(ca24), rdtg(ca25), rdtg(ca26)],
    ['Rendement Brassage moy.', avg(ca24.rdtBrassSum||0, ca24.rdtBrassN||0), avg(ca25.rdtBrassSum||0, ca25.rdtBrassN||0), avg(ca26.rdtBrassSum||0, ca26.rdtBrassN||0)],
    ['Taux Perte moy. (avec fruits)', avg(ca24.perteSum||0, ca24.perteN||0), avg(ca25.perteSum||0, ca25.perteN||0), avg(ca26.perteSum||0, ca26.perteN||0)],
    ['Coût / HL moyen', avg(ca24.coutHLSum||0, ca24.coutHLN||0), avg(ca25.coutHLSum||0, ca25.coutHLN||0), avg(ca26.coutHLSum||0, ca26.coutHLN||0)],
    ['Batch RFT (Conformité)', 'NC', 'NC', 'NC'],
    ['Brassins en repitch', ca24.repitch||0, ca25.repitch||0, ca26.repitch||0],
    ['Brassins avec levure neuve', ca24.levureNeuve||0, ca25.levureNeuve||0, ca26.levureNeuve||0],
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
  dash.getRange(r+8, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+9, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+10, 2, 1, 3).setNumberFormat('0.0%');
  dash.getRange(r+11, 2, 1, 3).setNumberFormat('#,##0 "€"');
  dash.getRange(r+12, 2, 1, 3).setNumberFormat('0');
  dash.getRange(r+13, 2, 1, 3).setNumberFormat('#,##0.0 "HL"');
  r += compAnRows.length + 2;

  // H - EFFICACITÉ INDUSTRIELLE
  dash.getRange(r, 1).setValue('🏭 H — EFFICACITÉ INDUSTRIELLE (2025 vs 2026)').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  dash.getRange(r, 1).setValue('Temps moyen en cuve par style — 2025').setFontWeight('bold').setBackground('#cfe2f3');
  dash.getRange(r, 1, 1, 3).merge();
  r++;
  const occ2025Rows = [['Style','Jours Moyens','Nb Brassins']];
  Object.keys(occupParStyle2025).map(st => ({ st, avg: occupParStyle2025[st].jours / occupParStyle2025[st].count, n: occupParStyle2025[st].count })).sort((a,b) => a.avg - b.avg).forEach(o => occ2025Rows.push([o.st, o.avg, o.n]));
  if (occ2025Rows.length === 1) occ2025Rows.push(['(aucun)', 0, 0]);
  dash.getRange(r, 1, occ2025Rows.length, 3).setValues(occ2025Rows);
  dash.getRange(r, 1, 1, 3).setBackground('#ead1dc').setFontWeight('bold');
  dash.getRange(r+1, 2, occ2025Rows.length-1, 1).setNumberFormat('0.0 "j"');
  dash.getRange(r+1, 3, occ2025Rows.length-1, 1).setNumberFormat('0');
  r += occ2025Rows.length + 1;
  dash.getRange(r, 1).setValue('Temps moyen en cuve par style — 2026').setFontWeight('bold').setBackground('#cfe2f3');
  dash.getRange(r, 1, 1, 3).merge();
  r++;
  const occ2026Rows = [['Style','Jours Moyens','Nb Brassins']];
  Object.keys(occupParStyle2026).map(st => ({ st, avg: occupParStyle2026[st].jours / occupParStyle2026[st].count, n: occupParStyle2026[st].count })).sort((a,b) => a.avg - b.avg).forEach(o => occ2026Rows.push([o.st, o.avg, o.n]));
  if (occ2026Rows.length === 1) occ2026Rows.push(['(aucun)', 0, 0]);
  dash.getRange(r, 1, occ2026Rows.length, 3).setValues(occ2026Rows);
  dash.getRange(r, 1, 1, 3).setBackground('#ead1dc').setFontWeight('bold');
  dash.getRange(r+1, 2, occ2026Rows.length-1, 1).setNumberFormat('0.0 "j"');
  dash.getRange(r+1, 3, occ2026Rows.length-1, 1).setNumberFormat('0');
  r += occ2026Rows.length + 1;
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

  // J - HISTORIQUE MENSUEL
  const titreJ = anneeHistoFiltre === 'Toutes' ? 'Toutes années' : anneeHistoFiltre;
  dash.getRange(r, 1).setValue('📈 J — HISTORIQUE MENSUEL (' + titreJ + ') — vert si ≥' + SEUIL_VOL_HL_REUSSI + ' HL / rdt ≥' + Math.round(SEUIL_RDT_REUSSI*100) + '%').setFontSize(14).setFontWeight('bold').setBackground('#1c4587').setFontColor('white');
  dash.getRange(r, 1, 1, 7).merge();
  r++;
  const allBrandsList = Array.from(globalBrandsSet).sort();
  const histHeaders = ['Mois/Année','Vol HL','Rdt','Occ Moy (j)','Nb Brassins'].concat(allBrandsList);
  const histTable = [histHeaders];
  const histRowsData = [];
  Object.keys(histMensuel).sort((a,b) => b.localeCompare(a)).forEach(k => {
    const h = histMensuel[k];
    if (anneeHistoFiltre && anneeHistoFiltre !== 'Toutes' && String(h.annee) !== anneeHistoFiltre) return;
    const yMois = h.theoCorrige > 0 ? h.condiFini/h.theoCorrige : 0;
    const oMois = h.occCount > 0 ? h.occTotal/h.occCount : 0;
    const row = [h.label, h.vol, yMois, oMois, h.count];
    allBrandsList.forEach(b => row.push(h.brands[b] || 0));
    histTable.push(row);
    histRowsData.push({ vol:h.vol, rdt:yMois });
  });
  if (histTable.length === 1) {
    const emptyRow = ['(aucune donnée pour ' + titreJ + ')', 0, 0, 0, 0];
    allBrandsList.forEach(() => emptyRow.push(0));
    histTable.push(emptyRow);
  }
  const histStart = r;
  dash.getRange(r, 1, histTable.length, histHeaders.length).setValues(histTable);
  dash.getRange(r, 1, 1, histHeaders.length).setBackground('#d9ead3').setFontWeight('bold');
  if (histTable.length > 1) {
    dash.getRange(r+1, 2, histTable.length-1, 1).setNumberFormat('#,##0.0 "HL"');
    dash.getRange(r+1, 3, histTable.length-1, 1).setNumberFormat('0.0%');
    dash.getRange(r+1, 4, histTable.length-1, 1).setNumberFormat('0.0 "j"');
    dash.getRange(r+1, 5, histTable.length-1, histHeaders.length-4).setNumberFormat('0');
  }
  histRowsData.forEach((d, i) => {
    const ri = histStart + 1 + i;
    // Arrondir à la précision d'affichage avant comparaison pour éviter les bugs flottants
    // (ex : 0.87999... s'affiche "88.0%" mais reste < 0.88 sans arrondi)
    const volArr = Math.round(d.vol * 10) / 10;
    const rdtArr = Math.round(d.rdt * 1000) / 1000;
    if (volArr >= SEUIL_VOL_HL_REUSSI) dash.getRange(ri, 2).setBackground('#b7e1cd').setFontWeight('bold');
    if (rdtArr >= SEUIL_RDT_REUSSI) dash.getRange(ri, 3).setBackground('#b7e1cd').setFontWeight('bold');
  });
  r += histTable.length + 2;

  // Graph HL mensuel
  const last12 = Object.keys(histMensuel).sort((a,b) => b.localeCompare(a)).filter(k => {
    if (anneeHistoFiltre === 'Toutes') return true;
    return String(histMensuel[k].annee) === anneeHistoFiltre;
  }).slice(0, 12).reverse();
  if (last12.length > 1) {
    dash.getRange(r, 1).setValue('📊 Données du graphique — Volume conditionné mensuel (' + titreJ + ')').setFontWeight('bold').setBackground('#d9ead3').setFontStyle('italic');
    dash.getRange(r, 1, 1, 7).merge();
    r++;
    const cs = r;
    const cd = [['Mois','Volume Conditionné (HL)']];
    last12.forEach(k => cd.push([histMensuel[k].label, Math.round(histMensuel[k].vol * 10) / 10]));
    dash.getRange(cs, 1, cd.length, 2).setValues(cd);
    dash.getRange(cs, 1, 1, 2).setBackground('#666').setFontColor('white').setFontWeight('bold');
    dash.getRange(cs+1, 2, cd.length-1, 1).setNumberFormat('#,##0.0 "HL"');
    try {
      const c = dash.newChart().setChartType(Charts.ChartType.COLUMN)
        .addRange(dash.getRange(cs, 1, cd.length, 2))
        .setPosition(cs + cd.length + 2, 1, 0, 0)
        .setOption('title', '📈 Volume conditionné mensuel — ' + titreJ + ' (HL)')
        .setOption('titleTextStyle', {fontSize: 16, bold: true, color: '#1c4587'})
        .setOption('width', 900).setOption('height', 420)
        .setOption('colors', ['#1c4587'])
        .setOption('legend', {position: 'none'})
        .setOption('hAxis', { title: 'Mois', slantedText: true, slantedTextAngle: 30 })
        .setOption('vAxis', { title: 'Volume (HL)', format: '#,##0' })
        .setOption('chartArea', {left: 80, right: 50, top: 70, bottom: 90})
        .setOption('bar', {groupWidth: '60%'})
        .build();
      dash.insertChart(c);
    } catch(e) { Logger.log('[CHART J] ' + e.message); }
  }
  dash.autoResizeColumns(1, Math.max(7, histHeaders.length));
  try { SpreadsheetApp.getUi().alert('✅ Dashboard actualisé.\n\nFiltres : Mois ' + moisFiltre + ' / Année ' + anneeFiltre + ' / Histo J ' + anneeHistoFiltre); } catch(e){}
}

// ============================================================
// FILTRES INTERACTIFS
// ============================================================
function onEditDashboard(e) {
  if (!e || !e.range) return;
  try { if (e.range.getSheet().getName() !== DASH_SHEET) return; } catch(err) { return; }
  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row === 3 && [2, 4, 6].includes(col)) actualiserDashboard();
}
function activerFiltresInteractifs() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'onEditDashboard') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditDashboard').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  SpreadsheetApp.getUi().alert('✅ Filtres interactifs activés.');
}
function desactiverFiltresInteractifs() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'onEditDashboard') { ScriptApp.deleteTrigger(t); n++; } });
  SpreadsheetApp.getUi().alert(n + ' trigger(s) filtres désactivés.');
}

// ============================================================
// 🚀 PIPELINE TOUT-EN-UN
// ============================================================
const PIPELINE_ETAPE_KEY = 'PIPELINE_ETAPE';
function pipelineToutFaire() {
  PropertiesService.getScriptProperties().setProperty(PIPELINE_ETAPE_KEY, 'SYNC');
  Logger.log('[PIPELINE] 🚀 Démarrage');
  try { SpreadsheetApp.getUi().alert('🚀 Pipeline lancé !\n\nReviens dans ~30 min, dashboard à jour.'); } catch(e) {}
  pipelineEtapeSuivante();
}
function pipelineEtapeSuivante() {
  const props = PropertiesService.getScriptProperties();
  let etape = props.getProperty(PIPELINE_ETAPE_KEY) || 'FINI';
  Logger.log('[PIPELINE] Étape : ' + etape);
  try {
    if (etape === 'SYNC') { syncEasybeerToSheet(); props.setProperty(PIPELINE_ETAPE_KEY, 'DATES'); pipelineProgrammerSuivante_(); }
    else if (etape === 'DATES') { pipelineRattrapDatesSansAlerte_(); props.setProperty(PIPELINE_ETAPE_KEY, 'RATTRAP'); pipelineProgrammerSuivante_(); }
    else if (etape === 'RATTRAP') {
      rattrapageComplet();
      const cp = props.getProperty(RATTRAP_PROP_KEY);
      if (!cp) { Logger.log('[PIPELINE] Rattrap terminé.'); props.setProperty(PIPELINE_ETAPE_KEY, 'SECANTO'); }
      pipelineProgrammerSuivante_();
    }
    else if (etape === 'SECANTO') {
      rattrapageSeCanto();
      const cp = props.getProperty(RATTRAP_SECANTO_KEY);
      if (!cp) { Logger.log('[PIPELINE] SeCanto terminé.'); props.setProperty(PIPELINE_ETAPE_KEY, 'RENDEMENT'); }
      pipelineProgrammerSuivante_();
    }
    else if (etape === 'RENDEMENT') { corrigerRendements(); props.setProperty(PIPELINE_ETAPE_KEY, 'DASHBOARD'); pipelineProgrammerSuivante_(); }
    else if (etape === 'DASHBOARD') {
      try { actualiserDashboardSansAlerte_(); } catch(e) { Logger.log('Dashboard : '+e.message); }
      props.setProperty(PIPELINE_ETAPE_KEY, 'FINI');
      pipelineSupprimerTriggersIntermediaires_();
      Logger.log('[PIPELINE] 🎉 TERMINÉ.');
    }
    else { pipelineSupprimerTriggersIntermediaires_(); }
  } catch(e) {
    Logger.log('[PIPELINE] ❌ ' + etape + ' : ' + e.message);
    pipelineProgrammerSuivante_();
  }
}
function pipelineProgrammerSuivante_() {
  pipelineSupprimerTriggersIntermediaires_();
  ScriptApp.newTrigger('pipelineEtapeSuivante').timeBased().after(2 * 60 * 1000).create();
}
function pipelineSupprimerTriggersIntermediaires_() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'pipelineEtapeSuivante') ScriptApp.deleteTrigger(t); });
}
function pipelineRattrapDatesSansAlerte_() {
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
    if (id && (!dr || dr === '')) queue.push({ row: r + 1, id: id });
  }
  if (queue.length === 0) return;
  const auth = getAuthHeader_();
  const updates = [];
  for (let i = 0; i < queue.length; i++) {
    Utilities.sleep(PROD_SLEEP_DETAIL);
    const detRes = UrlFetchApp.fetch('https://api.easybeer.fr/brassin/' + queue[i].id, { method:'get', headers:auth, muteHttpExceptions:true });
    if (detRes.getResponseCode() !== 200) continue;
    let b; try { b = JSON.parse(detRes.getContentText()); } catch(e) { continue; }
    let dCondiReelle = null;
    if (b.productions && b.productions.length > 0) {
      const dates = b.productions.map(p => p.date).filter(d => d);
      if (dates.length > 0) dCondiReelle = new Date(Math.max.apply(null, dates));
    }
    if (!dCondiReelle && b.dateMiseEnBouteille) dCondiReelle = new Date(b.dateMiseEnBouteille);
    if (!dCondiReelle && b.dateFin) dCondiReelle = new Date(b.dateFin);
    if (!dCondiReelle) continue;
    const dDebut = b.dateDebut ? new Date(b.dateDebut) : null;
    let occ = 0;
    if (dDebut) { const j = Math.round((dCondiReelle - dDebut) / 86400000); occ = j > 0 ? j : (j === 0 ? 1 : 0); }
    updates.push({ row: queue[i].row, mois: MOIS_FR[dCondiReelle.getMonth()], annee: dCondiReelle.getFullYear().toString(), dateCondi: dCondiReelle, occ });
  }
  updates.forEach(u => {
    sheet.getRange(u.row, idx['Mois'] + 1).setValue(u.mois);
    sheet.getRange(u.row, idx['Année'] + 1).setValue(u.annee);
    sheet.getRange(u.row, idx['Date Condi'] + 1).setValue(u.dateCondi).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(u.row, idx['Date Condi Réelle'] + 1).setValue(u.dateCondi).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(u.row, idx['Jours Occupation'] + 1).setValue(u.occ);
  });
  Logger.log('[PIPELINE] rattrapDates : ' + updates.length + ' dates ajoutées.');
}
function actualiserDashboardSansAlerte_() {
  const ui = SpreadsheetApp.getUi();
  ui.alert = function() {};
  try { actualiserDashboard(); } finally {}
}

// 🌙 Trigger nuit
function creerTriggerPipelineNuit() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'pipelineToutFaire') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pipelineToutFaire').timeBased().atHour(0).everyDays(1).create();
  SpreadsheetApp.getUi().alert('✅ Pipeline auto programmé chaque nuit à 00h00.');
}
function supprimerTriggerPipelineNuit() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'pipelineToutFaire') { ScriptApp.deleteTrigger(t); n++; } });
  pipelineSupprimerTriggersIntermediaires_();
  SpreadsheetApp.getUi().alert(n + ' trigger(s) nuit supprimés.');
}
function pipelineStatut() {
  const e = PropertiesService.getScriptProperties().getProperty(PIPELINE_ETAPE_KEY) || 'INACTIF';
  const cpR = PropertiesService.getScriptProperties().getProperty(RATTRAP_PROP_KEY) || '-';
  const cpS = PropertiesService.getScriptProperties().getProperty(RATTRAP_SECANTO_KEY) || '-';
  SpreadsheetApp.getUi().alert('État pipeline : ' + e + '\nCP rattrap : ' + cpR + '\nCP secanto : ' + cpS);
}
function pipelineReset() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PIPELINE_ETAPE_KEY);
  props.deleteProperty(RATTRAP_PROP_KEY);
  props.deleteProperty(RATTRAP_SECANTO_KEY);
  pipelineSupprimerTriggersIntermediaires_();
  SpreadsheetApp.getUi().alert('🔄 Pipeline reset.');
}

// ============================================================
// 🌐 WEB APP
// ============================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('Dashboard Production — Liquid Art')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function ouvrirDashboardWeb() {
  const ui = SpreadsheetApp.getUi();
  const url = 'https://script.google.com/a/macros/prizmbrewing.com/s/AKfycbxv5XzpYqcUfo2cy9Ix6Sn-Itrm0VekGHboc-oXKjX-PiGo3EGoLGdr5rRDUs1MIDAYmA/exec';
  ui.alert('🌐 URL du dashboard web :\n\n' + url);
}

/**
 * Endpoint serveur — V12 enrichi avec stocks PF (rotation + DLUO).
 */
function getKPIsWebApp(filters) {
  filters = filters || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) return { error: 'HISTORIQUE_KPI introuvable' };
  const data = src.getDataRange().getValues();
  if (data.length < 2) return { error: 'Pas de données' };
  const headers = data[0];
  const rows = data.slice(1);
  const idx = {};
  headers.forEach((h, i) => idx[String(h).trim()] = i);

  const dateDebut = filters.dateDebut ? new Date(filters.dateDebut) : null;
  const dateFin = filters.dateFin ? new Date(filters.dateFin) : null;
  if (dateFin) dateFin.setHours(23, 59, 59);
  const marquesF = filters.marques && filters.marques.length > 0 ? new Set(filters.marques) : null;
  const stylesF = filters.styles && filters.styles.length > 0 ? new Set(filters.styles) : null;

  let nbBrassins = 0, nbProductions = 0;
  let volBrasse = 0, volCondi = 0, volTheo = 0, volFruits = 0;
  let volTheoFini = 0, volCondiFini = 0, volFruitsFini = 0;
  let rdtBrassSum = 0, rdtBrassN = 0, perteSum = 0, perteN = 0, coutHLSum = 0, coutHLN = 0;
  let conformeOK = 0, conformeKO = 0, occSum = 0, occN = 0, repitch = 0, levureNeuve = 0;
  const brandsCount = {}, stylesCount = {}, brandsVol = {}, stylesVol = {};
  const histMensuel = {};
  const allMarques = new Set(), allStyles = new Set();
  const topBrassins = [];
  let scTotal = 0, scBlondeFuts = 0, scBlondeBtl = 0, scIPAFuts = 0, scIPABtl = 0, scBlancheFuts = 0, scBlancheBtl = 0;

  rows.forEach(r => {
    const marque = String(r[idx['Marque']] || '-');
    const style = String((idx['Style'] !== undefined ? r[idx['Style']] : '') || 'Non défini');
    if (marque !== '-') allMarques.add(marque);
    if (style && style !== 'Non défini') allStyles.add(style);
    const dCondi = r[idx['Date Condi Réelle']] ? new Date(r[idx['Date Condi Réelle']]) : (r[idx['Date Condi']] ? new Date(r[idx['Date Condi']]) : null);
    if (dateDebut && (!dCondi || dCondi < dateDebut)) return;
    if (dateFin && (!dCondi || dCondi > dateFin)) return;
    if (marquesF && !marquesF.has(marque)) return;
    if (stylesF && !stylesF.has(style)) return;
    const vC = parseValSafe_(r[idx['Vol. Condi (HL)']]);
    const vB = parseValSafe_(r[idx['Vol. Brassé (HL)']]);
    const vT = parseValSafe_(r[idx['Vol. Batch Théo']]);
    const vF = idx['Vol Fruits Ajouté (HL)'] !== undefined ? parseValSafe_(r[idx['Vol Fruits Ajouté (HL)']]) : 0;
    const occ = parseValSafe_(r[idx['Jours Occupation']]);
    const rdtB = idx['Rendement Brassage'] !== undefined ? parseValSafe_(r[idx['Rendement Brassage']]) : 0;
    const cHL = idx['Coût / HL (€)'] !== undefined ? parseValSafe_(r[idx['Coût / HL (€)']]) : 0;
    const conf = idx['Conforme'] !== undefined ? String(r[idx['Conforme']] || 'O').toUpperCase() : 'O';
    const nbCondi = idx['Nb Conditionnements'] !== undefined ? parseValSafe_(r[idx['Nb Conditionnements']]) : 0;
    const lev = idx['Levure Neuve'] !== undefined ? String(r[idx['Levure Neuve']] || '').trim() : '';
    const aDesProductions = vC > 0;
    nbBrassins++;
    nbProductions += (nbCondi || 0);
    volBrasse += vB; volCondi += vC; volTheo += vT; volFruits += vF;
    brandsCount[marque] = (brandsCount[marque] || 0) + 1;
    brandsVol[marque] = (brandsVol[marque] || 0) + vC;
    stylesCount[style] = (stylesCount[style] || 0) + 1;
    stylesVol[style] = (stylesVol[style] || 0) + vC;
    topBrassins.push({ lot: r[idx['Lot']], biere: r[idx['Bière']], marque, style, vCondi: vC, vBrasse: vB, dCondi: dCondi ? dCondi.toISOString() : '' });
    if (aDesProductions) {
      volTheoFini += vT; volCondiFini += vC; volFruitsFini += vF;
      if (rdtB > 0) { rdtBrassSum += rdtB; rdtBrassN++; }
      const vBF = vB + vF;
      if (vBF > 0) { perteSum += (vBF - vC)/vBF; perteN++; }
      if (cHL > 0) { coutHLSum += cHL; coutHLN++; }
      if (conf === 'O') conformeOK++; else if (conf === 'N') conformeKO++;
      if (occ > 0) { occSum += occ; occN++; }
      if (lev === '' || lev === '-') repitch++; else levureNeuve++;
    }
    if (dCondi) {
      const k = dCondi.getFullYear() + '-' + String(dCondi.getMonth()+1).padStart(2,'0');
      if (!histMensuel[k]) histMensuel[k] = { label: MOIS_FR[dCondi.getMonth()] + ' ' + dCondi.getFullYear(), vol: 0, count: 0 };
      histMensuel[k].vol += vC;
      histMensuel[k].count++;
    }
    if (idx['Vol Se Canto (HL)'] !== undefined) {
      scTotal += parseValSafe_(r[idx['Vol Se Canto (HL)']]);
      scBlondeFuts += parseValSafe_(r[idx['Vol Se Canto Blonde Fûts (HL)']] || 0);
      scBlondeBtl += parseValSafe_(r[idx['Vol Se Canto Blonde Btl (HL)']] || 0);
      scIPAFuts += parseValSafe_(r[idx['Vol Se Canto IPA Fûts (HL)']] || 0);
      scIPABtl += parseValSafe_(r[idx['Vol Se Canto IPA Btl (HL)']] || 0);
      scBlancheFuts += parseValSafe_(r[idx['Vol Se Canto Blanche Fûts (HL)']] || 0);
      scBlancheBtl += parseValSafe_(r[idx['Vol Se Canto Blanche Btl (HL)']] || 0);
    }
  });

  const yieldGlobal = (volTheoFini + volFruitsFini) > 0 ? volCondiFini / (volTheoFini + volFruitsFini) : 0;
  const rdtBrassMoy = rdtBrassN > 0 ? rdtBrassSum / rdtBrassN : 0;
  const perteMoy = perteN > 0 ? perteSum / perteN : 0;
  const coutHLMoy = coutHLN > 0 ? coutHLSum / coutHLN : 0;
  const rft = (conformeOK + conformeKO) > 0 ? conformeOK / (conformeOK + conformeKO) : 0;
  const occMoy = occN > 0 ? occSum / occN : 0;
  const pctRepitch = (repitch + levureNeuve) > 0 ? repitch / (repitch + levureNeuve) : 0;
  topBrassins.sort((a, b) => b.vCondi - a.vCondi);
  const top5 = topBrassins.slice(0, 5);
  const flop5 = topBrassins.filter(b => b.vCondi > 0).slice(-5).reverse();
  const histSorted = Object.keys(histMensuel).sort().map(k => ({ mois: histMensuel[k].label, vol: histMensuel[k].vol, count: histMensuel[k].count }));
  const mixMarques = Object.keys(brandsVol).filter(b => b !== '-').sort((a,b) => brandsVol[b] - brandsVol[a]).map(b => ({ marque: b, nb: brandsCount[b], vol: brandsVol[b], pct: volCondi > 0 ? brandsVol[b]/volCondi : 0 }));
  const mixStyles = Object.keys(stylesVol).filter(s => s && s !== 'Non défini').sort((a,b) => stylesVol[b] - stylesVol[a]).map(s => ({ style: s, nb: stylesCount[s], vol: stylesVol[s], pct: volCondi > 0 ? stylesVol[s]/volCondi : 0 }));

  const _result = {
    nbBrassins, nbProductions,
    volBrasse, volCondi, volTheo, volFruits,
    yieldGlobal, rdtBrassMoy, perteMoy, coutHLMoy, rft, occMoy, pctRepitch,
    histMensuel: histSorted,
    mixMarques, mixStyles,
    top5, flop5,
    seCanto: {
      total: scTotal,
      blondeFuts: scBlondeFuts, blondeBtl: scBlondeBtl,
      ipaFuts: scIPAFuts, ipaBtl: scIPABtl,
      blancheFuts: scBlancheFuts, blancheBtl: scBlancheBtl,
      objTotal: OBJECTIF_SE_CANTO_2026_TOTAL,
      objBlondeFuts: OBJECTIF_SC_BLONDE_FUTS, objBlondeBtl: OBJECTIF_SC_BLONDE_BTL,
      objIPAFuts: OBJECTIF_SC_IPA_FUTS, objIPABtl: OBJECTIF_SC_IPA_BTL,
      objBlancheFuts: OBJECTIF_SC_BLANCHE_FUTS, objBlancheBtl: OBJECTIF_SC_BLANCHE_BTL
    },
    allMarques: Array.from(allMarques).sort(),
    allStyles: Array.from(allStyles).sort(),
    derniereMaj: Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm')
  };
  return enrichirAvecStocks_(_result);
}

function testStocksDansBackend() {
  const k = getKPIsWebApp({});
  if (!k.stocks) {
    Logger.log('❌ Pas de champ stocks dans le retour');
    return;
  }
  Logger.log('✅ Champ stocks présent');
  Logger.log('  • stocksDispo : ' + k.stocks.stocksDispo);
  Logger.log('  • rotationJoursMoy : ' + (k.stocks.rotationJoursMoy ? k.stocks.rotationJoursMoy.toFixed(1) + ' j' : '0'));
  Logger.log('  • dluoConsommeeMoy : ' + (k.stocks.dluoConsommeeMoy ? (k.stocks.dluoConsommeeMoy * 100).toFixed(1) + ' %' : '0'));
  Logger.log('  • nbLotsStock : ' + k.stocks.nbLotsStock);
  Logger.log('  • volumeStockHL : ' + (k.stocks.volumeStockHL ? k.stocks.volumeStockHL.toFixed(1) + ' HL' : '0'));
  Logger.log('  • lotsAlerte : ' + (k.stocks.lotsAlerte ? k.stocks.lotsAlerte.length : 0) + ' alertes');
  if (k.stocks.lotsAlerte && k.stocks.lotsAlerte.length > 0) {
    Logger.log('  • Top alerte : ' + k.stocks.lotsAlerte[0].lot + ' / ' + (k.stocks.lotsAlerte[0].pctConsommee * 100).toFixed(1) + '%');
  }
}