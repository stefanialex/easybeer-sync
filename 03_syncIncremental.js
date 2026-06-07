/**
 * 
 * ===============================================================
 * 03_SYNC_INCREMENTAL.gs — Sync rapide Easybeer (bouton manuel)
 * ===============================================================
 *
 * Ne touche QUE :
 *   - les brassins EN_COURS (récupérés via /brassin/en-cours)
 *   - les brassins TERMINE avec dateFin > J-30 jours (récemment archivés)
 *
 * Pourquoi ? Pour le bouton "🔄 Synchroniser Easybeer" de la web app
 * V4, on a besoin d'une sync rapide (1-2 min max) qui ne ré-hit pas
 * toute la base de 462 brassins à chaque clic. Les vieux brassins ne
 * changent quasi jamais — on les ré-hit seulement via la sync complète
 * du V3 (syncEasybeerToSheet) qui tourne 1× par jour à 6h.
 *
 * Sous LockService — empêche double exécution (trigger + bouton manuel).
 *
 * PRÉ-REQUIS :
 *   - 00_config.gs, 01_easybeerClient.gs installés
 *   - HISTORIQUE_KPI existant avec ses 31 colonnes (V3 OK)
 *   - Tu peux lancer syncIncremental() manuellement OU
 *     synchroniserEasybeer() depuis le menu (à ajouter étape 6).
 */
 
// ============================================================
// CONSTANTES
// ============================================================
const SYNC_INCR_LOOKBACK_DAYS = 30;  // brassins archivés < 30j
const SYNC_INCR_ARCH_FILET    = 90;  // filet large /archives (dateDebut) pour ne pas rater
 
// ============================================================
// HELPER : lecture index HISTORIQUE_KPI
// ============================================================
 
/**
 * Lit HISTORIQUE_KPI et construit un index par idBrassin :
 *   { idBrassin (string) → { row, lot, extras } }
 *
 * extras = colonnes à préserver entre syncs (manuelles ou héritées) :
 *   levureManuelle, eco, dateCondiReelle, style, volFruits,
 *   volSeCanto, scBlonde, scIPA, scBlanche, rdtBrass, coutTotal,
 *   coutHL, tauxPerte, conforme.
 */
function readHistoriqueIndex_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PROD_SHEET);
  if (!sh) throw new Error('Onglet ' + PROD_SHEET + ' introuvable.');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { byId: {}, sheet: sh, idx: null, lastRow: 1 };
 
  const data = sh.getRange(1, 1, lastRow, PROD_HEADERS.length).getValues();
  const idx = {};
  data[0].forEach(function(h, i) { idx[String(h).trim()] = i; });
 
  const byId = {};
  for (let r = 1; r < data.length; r++) {
    const id = data[r][idx['ID Brassin']];
    if (!id) continue;
    byId[String(id)] = {
      row: r + 1,
      lot: data[r][idx['Lot']],
      extras: {
        levureManuelle:  data[r][idx['Levure Neuve']],
        eco:             data[r][idx['Économie (€)']],
        dateCondiReelle: data[r][idx['Date Condi Réelle']],
        style:           data[r][idx['Style']],
        volFruits:       data[r][idx['Vol Fruits Ajouté (HL)']],
        volSeCanto:      data[r][idx['Vol Se Canto (HL)']],
        scBlonde:        data[r][idx['Vol Se Canto Blonde (HL)']],
        scIPA:           data[r][idx['Vol Se Canto IPA (HL)']],
        scBlanche:       data[r][idx['Vol Se Canto Blanche (HL)']],
        rdtBrass:        data[r][idx['Rendement Brassage']],
        coutTotal:       data[r][idx['Coût Total (€)']],
        coutHL:          data[r][idx['Coût / HL (€)']],
        tauxPerte:       data[r][idx['Taux Perte (%)']],
        conforme:        data[r][idx['Conforme']]
      }
    };
  }
  return { byId: byId, sheet: sh, idx: idx, lastRow: lastRow };
}
 
// ============================================================
// HELPER : construit une ligne HISTORIQUE_KPI depuis un brassin enrichi
// ============================================================
 
/**
 * @param {object} enriched  fiche détaillée /brassin/{id} (avec productions, ingredients, cout)
 * @param {object} extras    valeurs à préserver (cf. readHistoriqueIndex_)
 * @return {Array} ligne de 31 valeurs alignée sur PROD_HEADERS
 */
function construireLigneBrassin_(enriched, extras) {
  extras = extras || {};
  const prod = enriched.produit || {};
  const marque = (prod.categorie && prod.categorie.libelle) ? prod.categorie.libelle : '-';
  const style = (prod.type && prod.type.libelle) ? prod.type.libelle : (extras.style || '');
 
  const dDebut = enriched.dateDebut ? new Date(enriched.dateDebut)
                 : (enriched.dateDebutFormulaire ? new Date(enriched.dateDebutFormulaire) : null);
 
  let dCondiReelle = null;
  if (enriched.productions && enriched.productions.length > 0) {
    const dates = enriched.productions.map(function(p) { return p.date; }).filter(function(d) { return d; });
    if (dates.length > 0) dCondiReelle = new Date(Math.max.apply(null, dates));
  }
  if (!dCondiReelle && enriched.dateMiseEnBouteille) dCondiReelle = new Date(enriched.dateMiseEnBouteille);
  if (!dCondiReelle && extras.dateCondiReelle) dCondiReelle = new Date(extras.dateCondiReelle);
  const dCondiAffichee = dCondiReelle || (enriched.dateFin ? new Date(enriched.dateFin) : null);
 
  let vSorti = 0;
  if (enriched.productions && enriched.productions.length > 0) {
    enriched.productions.forEach(function(p) { vSorti += (p.volumeTotal || 0); });
  } else {
    vSorti = enriched.volumeFinal || 0;
  }
  const vBrasseHL = (enriched.volume || 0) / 100;
  const vSortiHL  = vSorti / 100;
  const vTheoHL   = calculBatchTheorique_(vBrasseHL);
 
  const ings = (enriched.ingredients && enriched.ingredients.length > 0)
               ? analyserIngredients_(enriched.ingredients) : null;
  const levureAuto = ings ? ings.levure : (extras.levureManuelle || '-');
  const volFruitsHL = ings ? ings.volFruitsHL : (parseValSafe_(extras.volFruits) || 0);
 
  let sc = {
    totalHL:  parseValSafe_(extras.volSeCanto),
    blondeHL: parseValSafe_(extras.scBlonde),
    ipaHL:    parseValSafe_(extras.scIPA),
    blancheHL:parseValSafe_(extras.scBlanche)
  };
  if (enriched.productions && enriched.productions.length > 0) {
    sc = extraireVolSeCanto_(enriched.productions);
  }
 
  const vTheoCorrigeHL = vTheoHL + (volFruitsHL || 0);
  const rendement = vTheoCorrigeHL > 0 ? (vSortiHL / vTheoCorrigeHL) : 0;
 
  // Rendement brassage normalisé (gère entier OU décimal renvoyé par l'API)
  const rdtBrass = (enriched.rendementBrassin !== undefined && enriched.rendementBrassin !== null)
                   ? normaliserRendementBrassage_(enriched.rendementBrassin)
                   : (parseValSafe_(extras.rdtBrass) || 0);
 
  const coutTotal = (enriched.cout !== undefined && enriched.cout !== null && typeof enriched.cout === 'number')
                    ? enriched.cout
                    : (parseValSafe_(extras.coutTotal) || 0);
  const coutHL = vSortiHL > 0 ? (coutTotal / vSortiHL) : 0;
  const tauxPerte = vBrasseHL > 0 ? (vBrasseHL - vSortiHL) / vBrasseHL : 0;
 
  // Économie levure : conserve la saisie manuelle, sinon calcul auto
  let eco = (extras.eco !== undefined && extras.eco !== '') ? parseValSafe_(extras.eco) : 0;
  if ((!eco || eco === 0) && levureAuto === '-' && vTheoHL > 0 && marque && !marque.match(/nolo|polygon|cider/i)) {
    eco = calculEconomieLevure_(vTheoHL);
  }
 
  let occupation = 0;
  if (dDebut && dCondiAffichee) {
    const j = Math.round((dCondiAffichee - dDebut) / (1000 * 60 * 60 * 24));
    if (j >= 0) occupation = (j === 0) ? 1 : j;
  }
 
  const etatCode = enriched.etat && enriched.etat.code;
  const statut = libelleStatut_(etatCode, enriched.termine);
  const conforme = extras.conforme || 'O';
 
  return [
    dCondiAffichee ? MOIS_FR[dCondiAffichee.getMonth()] : '-',
    dCondiAffichee ? dCondiAffichee.getFullYear().toString() : '-',
    enriched.nom || '', statut,
    prod.nom || 'Inconnu', marque,
    dDebut, dCondiAffichee, occupation,
    vBrasseHL, vTheoHL, vSortiHL, rendement,
    enriched.densiteInitiale || 0, enriched.densiteFinale || 0, enriched.ph || 0,
    levureAuto, eco,
    enriched.idBrassin || '', dCondiReelle || '',
    style, volFruitsHL || 0,
    sc.totalHL || 0, sc.blondeHL || 0, sc.ipaHL || 0, sc.blancheHL || 0,
    rdtBrass, coutTotal || 0, coutHL || 0, tauxPerte || 0,
    conforme
  ];
}
 
// ============================================================
// FONCTION PRINCIPALE
// ============================================================
 
/**
 * Sync incrémentale Easybeer :
 *   - tous les brassins EN_COURS
 *   - tous les brassins TERMINE dont dateFin > J-30 jours
 *
 * Met à jour HISTORIQUE_KPI par idBrassin (update in-place, pas de clear).
 * Sous LockService — bloque toute autre sync pendant l'exécution.
 *
 * @return {object} { nbEnCours, nbRecents, nbMaj, nbAjout, nbKO, durationSec }
 */
function syncIncremental() {
  return withEasybeerLock_('sync-incremental', function() {
    const t0 = new Date().getTime();
    Logger.log('[SYNC-INCR] Démarrage');
 
    const histo = readHistoriqueIndex_();
    const sheet = histo.sheet;
    const idx = histo.idx;
    const byId = histo.byId;
 
    // 1. Brassins EN_COURS
    const ec = fetchEnCours_();
    let enCoursList = [];
    if (ec.etapes) {
      ec.etapes.forEach(function(e) {
        if (e.modelesBrassins) enCoursList = enCoursList.concat(e.modelesBrassins);
      });
    }
    enCoursList = enCoursList.filter(function(b) {
      if (!b || !b.idBrassin) return false;
      const c = b.etat && b.etat.code;
      return c !== 'ANNULE' && c !== 'DETRUIT';
    });
    Logger.log('[SYNC-INCR] EN_COURS : ' + enCoursList.length);
 
    // 2. Brassins archivés récents (filet large /archives sur dateDebut > J-90j, filtre dateFin > J-30j)
    const now = new Date();
    const dArchFilet = new Date(now.getTime() - SYNC_INCR_ARCH_FILET * 24 * 3600 * 1000);
    Utilities.sleep(EB_SLEEP_LIST);
    let recents = [];
    let page = 1, total = 1;
    while (page <= total && page <= 20) {
      const data = fetchArchivesPage_(page, dArchFilet.toISOString());
      if (page === 1) total = data.totalPages || 1;
      if (Array.isArray(data.liste)) recents = recents.concat(data.liste);
      page++;
      if (page <= total) Utilities.sleep(EB_SLEEP_LIST);
    }
    const dCutoff = new Date(now.getTime() - SYNC_INCR_LOOKBACK_DAYS * 24 * 3600 * 1000);
    recents = recents.filter(function(b) {
      if (!b || !b.idBrassin) return false;
      const c = b.etat && b.etat.code;
      if (c === 'ANNULE' || c === 'DETRUIT') return false;
      const df = b.dateFin ? new Date(b.dateFin) : null;
      return df && df >= dCutoff;
    });
    Logger.log('[SYNC-INCR] Archivés récents : ' + recents.length);
 
    // 3. Dédoublonne et fetch chaque détail
    const cibles = {};
    enCoursList.forEach(function(b) { cibles[b.idBrassin] = b; });
    recents.forEach(function(b)     { cibles[b.idBrassin] = b; });
    const ids = Object.keys(cibles);
    Logger.log('[SYNC-INCR] Total cibles : ' + ids.length);
 
    let nbMaj = 0, nbAjout = 0, nbKO = 0;
    const ajouts = [];
 
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      eBSleepDetail_();
      let enriched;
      try {
        enriched = fetchBrassinDetail_(id);
      } catch (e) {
        Logger.log('[SYNC-INCR] KO ' + id + ' : ' + e.message);
        nbKO++;
        continue;
      }
      const existing = byId[id];
      const extras = existing ? existing.extras : {};
      const row = construireLigneBrassin_(enriched, extras);
 
      if (existing) {
        sheet.getRange(existing.row, 1, 1, PROD_HEADERS.length).setValues([row]);
        // Formats sur les colonnes critiques (au cas où la cellule aurait perdu son format)
        sheet.getRange(existing.row, 7, 1, 2).setNumberFormat('dd/mm/yyyy');
        sheet.getRange(existing.row, 13, 1, 1).setNumberFormat('0.0%');
        sheet.getRange(existing.row, 20, 1, 1).setNumberFormat('dd/mm/yyyy');
        sheet.getRange(existing.row, 27, 1, 1).setNumberFormat('0.0%');
        sheet.getRange(existing.row, 28, 1, 2).setNumberFormat('#,##0 "€"');
        sheet.getRange(existing.row, 30, 1, 1).setNumberFormat('0.0%');
        nbMaj++;
      } else {
        ajouts.push(row);
        nbAjout++;
      }
 
      if ((i + 1) % 10 === 0) Logger.log('[SYNC-INCR] ' + (i + 1) + '/' + ids.length);
    }
 
    // 4. Ajouts en bas du sheet
    if (ajouts.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, ajouts.length, PROD_HEADERS.length).setValues(ajouts);
      sheet.getRange(startRow, 7, ajouts.length, 2).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(startRow, 13, ajouts.length, 1).setNumberFormat('0.0%');
      sheet.getRange(startRow, 20, ajouts.length, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(startRow, 27, ajouts.length, 1).setNumberFormat('0.0%');
      sheet.getRange(startRow, 28, ajouts.length, 2).setNumberFormat('#,##0 "€"');
      sheet.getRange(startRow, 30, ajouts.length, 1).setNumberFormat('0.0%');
    }
 
    const dur = Math.round((new Date().getTime() - t0) / 1000);
    const summary = {
      nbEnCours: enCoursList.length,
      nbRecents: recents.length,
      nbCibles: ids.length,
      nbMaj: nbMaj,
      nbAjout: nbAjout,
      nbKO: nbKO,
      durationSec: dur
    };
    Logger.log('[SYNC-INCR] OK ' + JSON.stringify(summary));
    return summary;
  });
}
 
/**
 * Wrapper pour menu / UI : exécute la sync incrémentale + recalcul des 3 derniers mois,
 * affiche une alerte de résumé.
 *
 * Utilisé par :
 *   - le bouton "🔄 Synchroniser Easybeer" de la web app (étape 4)
 *   - menu manuel (étape 6)
 *   - trigger quotidien (étape 6, en remplacement du syncEasybeerToSheet pour les jours
 *     non-complets ; la sync complète V3 reste 1×/jour à 6h)
 */
function synchroniserEasybeer() {
  try {
    const s = syncIncremental();
    recalculerKPIMensuels(3);
    SpreadsheetApp.getUi().alert(
      '✅ Sync Easybeer terminée en ' + s.durationSec + 's.\n\n' +
      '• ' + s.nbCibles + ' brassins ciblés (' + s.nbEnCours + ' en cours, ' + s.nbRecents + ' archivés récents)\n' +
      '• ' + s.nbMaj + ' mises à jour\n' +
      '• ' + s.nbAjout + ' ajouts\n' +
      '• ' + s.nbKO + ' erreurs\n\n' +
      'KPI_MENSUELS recalculés sur les 3 derniers mois.'
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
  }
}
 
/**
 * Test rapide : lance juste la partie sync, affiche le résumé en log.
 * Utile pour valider sans toucher au menu.
 */
function testSyncIncremental() {
  const s = syncIncremental();
  Logger.log(JSON.stringify(s, null, 2));
  SpreadsheetApp.getUi().alert('Test terminé. Voir Affichage → Journaux pour le détail.');
}