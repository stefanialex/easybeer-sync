/**
 * ===============================================================
 * 04_stocksPF.gs — Sync stocks Produits Finis + DLUO (V12)
 * ===============================================================
 *
 * Réutilise l'infrastructure V4 existante :
 *   - easybeerFetch_(url, options, label) du 01_easybeerClient.gs
 *   - withEasybeerLock_(label, fn) pour ne pas entrer en conflit avec
 *     les autres syncs (incrementale, rattrapage, dashboard)
 *   - EB_BASE_URL et getAuthHeader_() du 00_config.gs
 *   - PROD_SHEET, parseValSafe_(), MOIS_FR du fichier principal
 *
 * Crée et alimente un onglet STOCK_PF (snapshot quotidien).
 *
 * KPI calculés :
 *   - Rotation stocks PF moyen pondéré (jours)
 *   - DLUO consommée moyenne pondérée (% du stock actuel)
 *   - Top 10 lots en alerte (>30% DLUO consommée)
 */

const STOCK_PF_SHEET = 'STOCK_PF';

const STOCK_PF_HEADERS = [
  'Date Snapshot',
  'Produit',
  'Catégorie',
  'Style',
  'Contenant',
  'Numéro Lot',
  'Quantité',
  'Volume (HL)',
  'DLUO (date lisible)',
  'Jours Restants DLUO',
  'Durabilité Min (j)',
  '% DLUO Consommée',
  'Date Condi (KPI)',
  'Jours en Stock',
  'Alerte DLUO (>30%)'
];

// ============================================================
//  WRAPPERS API — utilisent l'infrastructure 01_easybeerClient.gs
// ============================================================

/**
 * POST /indicateur/autonomie-stocks → liste consolidée des produits en stock
 * avec autonomie et durabilité par produit/contenant.
 *
 * Structure du payload reproduite EXACTEMENT depuis le HAR navigateur
 * (Alex 7 juin 2026). L'endpoint utilise un "indicateur configuré"
 * sauvegardé côté Easybeer — pas un appel générique.
 *
 *   idIndicateur=76551 = config "Autonomie stock Liquid Art"
 *   idsEntrepots=[865, 2523] = PRIZM + Entrepôt stockage Prizm
 *   idsProduitsCategories=[2995, 2997, 2999, 3348] = VNDL Fixe, Prizm Fixe, Prizm Nolo, ?
 *
 * Si tu changes d'entrepôt ou de catégories, mets à jour les constantes ci-dessous.
 */
// Constantes ID (laissées au cas où on revient un jour vers l'endpoint
// autonomie-stocks — non utilisées par le sync actuel).
const EB_ID_INDICATEUR_AUTONOMIE = 76551;
const EB_IDS_ENTREPOTS = [865, 2523];
const EB_IDS_CATEGORIES = [2995, 2997, 2999, 3348];

/**
 * POST /stock/produits → arborescence consolidée des stocks
 * Niveau 1: TOTAL  |  Niveau 2: ENTREPOT  |  Niveau 3: PRODUIT  |  Niveau 4: CONTENANT
 * Le niveau 4 contient `id` = idStockProduit (à utiliser pour stock-numero-lot/liste/{id}).
 */
function fetchStocksProduits_() {
  const url = EB_BASE_URL + '/stock/produits';
  const opts = {
    method: 'post',
    headers: getAuthHeader_(),
    payload: '{}',  // body minimal — Easybeer renvoie toute l'arborescence
    muteHttpExceptions: true
  };
  const res = easybeerFetch_(url, opts, 'stock-produits');
  return JSON.parse(res.getContentText());
}

/**
 * Parcourt récursivement l'arborescence stock-produits et extrait tous
 * les nœuds CONTENANT (niveau 4) qui ont un id.
 *
 * Push dans `results` un objet { id, contenance, durabiliteJ, nomProduit,
 * categorie, style, libelleContenant, entrepot, quantiteReelle }.
 */
function extraireStocksContenants_(node, results) {
  if (!node) return;
  // Filtre : on garde uniquement les niveaux CONTENANT avec un id ET avec du stock réel > 0
  // (sinon on fetch pour rien des centaines de "lots fantômes" à 0 unité)
  if (node.typeConsolidation === 'CONTENANT' && node.id && (node.quantiteReelle || 0) > 0) {
    results.push({
      idStockProduit: node.id,
      libelleContenant: node.libelle || '?',
      contenance: (node.contenant && node.contenant.contenance) || 0,
      idProduit: (node.produit && node.produit.idProduit) || null,
      nomProduit: (node.produit && (node.produit.nom || node.produit.nomCommercial)) || (node.libelle || '?'),
      durabiliteMinimale: (node.produit && node.produit.durabiliteMinimale) || 0,
      categorie: (node.produit && node.produit.categorie && node.produit.categorie.libelle) || '?',
      style: (node.produit && node.produit.type && node.produit.type.libelle) || '?',
      entrepot: (node.entrepot && (node.entrepot.libelle || node.entrepot.nom)) || '?',
      quantiteReelle: node.quantiteReelle || 0
    });
  }
  if (node.consolidationsFilles && Array.isArray(node.consolidationsFilles)) {
    node.consolidationsFilles.forEach(function(child) { extraireStocksContenants_(child, results); });
  }
}

/**
 * GET /stock/stock-numero-lot/liste/{idStockProduit} → tous les lots
 * (numéro + DLUO + quantité) pour un stock produit donné.
 */
function fetchLotsStockProduit_(idStockProduit) {
  const url = EB_BASE_URL + '/stock/stock-numero-lot/liste/' + idStockProduit +
              '?deduireNonLoti=false&masquerVide=false';
  const opts = {
    method: 'get',
    headers: getAuthHeader_(),
    muteHttpExceptions: true
  };
  const res = easybeerFetch_(url, opts, 'stock-lots-' + idStockProduit);
  return JSON.parse(res.getContentText());
}

// ============================================================
//  CROSS-REFERENCE — numeroLot → date condi (HISTORIQUE_KPI)
// ============================================================
function chargerMapLotDateCondi_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PROD_SHEET);
  if (!src) {
    Logger.log('⚠️ ' + PROD_SHEET + ' introuvable');
    return {};
  }
  const data = src.getDataRange().getValues();
  if (data.length < 2) return {};
  const headers = data[0];
  const iLot = headers.indexOf('Lot');
  let iDCondi = headers.indexOf('Date Condi Réelle');
  if (iDCondi === -1) iDCondi = headers.indexOf('Date Condi');
  if (iLot === -1 || iDCondi === -1) {
    Logger.log('⚠️ Colonnes Lot / Date Condi introuvables');
    return {};
  }
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const lot = String(data[r][iLot] || '').trim();
    const dCondi = data[r][iDCondi];
    if (lot && dCondi instanceof Date) map[lot] = dCondi;
    else if (lot && dCondi) {
      const d = new Date(dCondi);
      if (!isNaN(d.getTime())) map[lot] = d;
    }
  }
  Logger.log('📚 Map lot→condi : ' + Object.keys(map).length + ' lots');
  return map;
}

// ============================================================
//  FONCTION PRINCIPALE — sync complet (sous lock global)
// ============================================================
function syncStocksPFEasybeer() {
  return withEasybeerLock_('sync-stocks-pf', function() {
    const t0 = new Date().getTime();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log('🍺 [V12] Démarrage sync stocks PF + DLUO');

    const mapLotCondi = chargerMapLotDateCondi_();

    // 1. Récupérer l'arborescence stocks-produits depuis Easybeer
    Logger.log('📡 fetchStocksProduits_…');
    const stocksRoot = fetchStocksProduits_();

    // 2. Extraire récursivement tous les niveaux 4 (CONTENANT) avec leur id
    const stocksContenants = [];
    if (Array.isArray(stocksRoot)) {
      stocksRoot.forEach(function(r) { extraireStocksContenants_(r, stocksContenants); });
    } else {
      extraireStocksContenants_(stocksRoot, stocksContenants);
    }
    Logger.log('✅ ' + stocksContenants.length + ' stocks-contenants avec idStockProduit');

    // 3. Pour chaque stock-contenant, fetch les lots + DLUO via stock-numero-lot
    //    Sleep AVANT chaque appel pour garantir rate limit même en cas de skip/erreur.
    //    Si détection de ban (HTTP 400 "banned"), on arrête la boucle (break).
    const aujourdhui = new Date();
    const lignes = [];
    let nbLotsTraites = 0;
    let banDetecte = false;

    for (let iSC = 0; iSC < stocksContenants.length; iSC++) {
      if (banDetecte) {
        Logger.log('🛑 Ban Easybeer détecté — arrêt de la boucle après ' + iSC + ' stocks');
        break;
      }
      const sc = stocksContenants[iSC];
      const idStockProd = sc.idStockProduit;
      const nomProduit = sc.nomProduit;
      const categorie = sc.categorie;
      const style = sc.style;
      const contenant = sc.libelleContenant;
      const durabiliteJ = sc.durabiliteMinimale;
      const contenance = sc.contenance;

      // Sleep AVANT chaque fetch : 1000ms = 1 req/s strict.
      // Easybeer annonce 10 req/s mais en pratique a banni à 4 req/s lors des tests précédents.
      // Avec 145 stocks × 1s = ~3 min total (sous la limite Apps Script de 6 min).
      Utilities.sleep(1000);

      let lots;
      try {
        lots = fetchLotsStockProduit_(idStockProd);
      } catch (e) {
        const msg = e.message || '';
        if (msg.indexOf('banned') !== -1 || msg.indexOf('Limit of') !== -1) {
          Logger.log('🛑 BAN détecté sur idStockProd=' + idStockProd + ' : ' + msg);
          banDetecte = true;
        } else {
          Logger.log('⚠️ Lots KO idStockProd=' + idStockProd + ' : ' + msg);
        }
        continue;
      }
      if (!Array.isArray(lots) || lots.length === 0) continue;

      lots.forEach(function(l) {
        nbLotsTraites++;
        const numLot = String(l.numeroLot || '').trim();
        if (!numLot) return;
        const qte = parseFloat(l.quantite || 0);
        if (qte <= 0) return;  // filtre les lots fantômes à quantité nulle
        const volHL = (qte * contenance) / 100;
        const dluoTs = l.dateLimiteUtilisationOptimale;
        const dluoDate = dluoTs ? new Date(dluoTs) : null;
        const dateCondi = mapLotCondi[numLot] || null;

        let pctConsommee = null;
        let joursRestantsDluo = null;
        let joursEnStock = null;
        let alerte = '';

        if (dluoDate) {
          joursRestantsDluo = Math.floor((dluoDate.getTime() - aujourdhui.getTime()) / 86400000);
        }
        if (dateCondi) {
          joursEnStock = Math.floor((aujourdhui.getTime() - dateCondi.getTime()) / 86400000);
        }
        if (dateCondi && durabiliteJ > 0) {
          const consomme = Math.min(durabiliteJ, Math.max(0, (aujourdhui - dateCondi) / 86400000));
          pctConsommee = consomme / durabiliteJ;
          if (pctConsommee > 0.30) alerte = 'O';
        }

        lignes.push([
          aujourdhui,
          nomProduit,
          categorie,
          style,
          contenant,
          numLot,
          qte,
          volHL,
          dluoDate ? Utilities.formatDate(dluoDate, 'Europe/Paris', 'dd/MM/yyyy') : '',
          joursRestantsDluo !== null ? joursRestantsDluo : '',
          durabiliteJ,
          pctConsommee !== null ? pctConsommee : '',
          dateCondi ? Utilities.formatDate(dateCondi, 'Europe/Paris', 'dd/MM/yyyy') : '',
          joursEnStock !== null ? joursEnStock : '',
          alerte
        ]);
      });
    }

    Logger.log('📊 ' + stocksContenants.length + ' stocks-contenants traités, ' +
               nbLotsTraites + ' lots traités, ' + lignes.length + ' lignes écrites' +
               (banDetecte ? ' (ARRÊT ANTICIPÉ — ban Easybeer)' : ''));

    // 3. Écriture onglet STOCK_PF
    let sheet = ss.getSheetByName(STOCK_PF_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(STOCK_PF_SHEET);
      sheet.getRange(1, 1, 1, STOCK_PF_HEADERS.length)
           .setValues([STOCK_PF_HEADERS])
           .setFontWeight('bold').setBackground('#1c4587').setFontColor('#fff');
      sheet.setFrozenRows(1);
    } else if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, STOCK_PF_HEADERS.length).clearContent();
    }
    if (lignes.length > 0) {
      sheet.getRange(2, 1, lignes.length, STOCK_PF_HEADERS.length).setValues(lignes);
      sheet.getRange(2, 12, lignes.length, 1).setNumberFormat('0.0%');
      sheet.getRange(2, 8, lignes.length, 1).setNumberFormat('0.00');
      sheet.getRange(2, 1, lignes.length, STOCK_PF_HEADERS.length)
           .sort([{ column: 12, ascending: false }]);
    }

    const dur = Math.round((new Date().getTime() - t0) / 1000);
    ss.toast('✅ Sync stocks PF : ' + lignes.length + ' lignes (' + dur + 's)', 'V12', 5);
    Logger.log('✅ Sync stocks terminée en ' + dur + 's');

    return {
      lignes: lignes.length,
      lots: nbLotsTraites,
      stocksContenants: stocksContenants.length,
      durationSec: dur
    };
  });
}

// ============================================================
//  CALCUL DES KPI — appelé par le backend web app
// ============================================================
function calculerKPIStocks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STOCK_PF_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return {
      stocksDispo: false,
      rotationJoursMoy: 0,
      dluoConsommeeMoy: 0,
      lotsAlerte: [],
      nbLotsStock: 0,
      volumeStockHL: 0
    };
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iVol = headers.indexOf('Volume (HL)');
  const iPct = headers.indexOf('% DLUO Consommée');
  const iJoursStock = headers.indexOf('Jours en Stock');
  const iLot = headers.indexOf('Numéro Lot');
  const iProduit = headers.indexOf('Produit');
  const iAlerte = headers.indexOf('Alerte DLUO (>30%)');
  const iDLUO = headers.indexOf('DLUO (date lisible)');

  let sumVolPct = 0, sumVolPctN = 0;
  let sumVolJours = 0, sumVolJoursN = 0;
  let volTotal = 0;
  const alertes = [];

  for (let r = 1; r < data.length; r++) {
    const vol = parseFloat(data[r][iVol]) || 0;
    const pct = parseFloat(data[r][iPct]);
    const jours = parseFloat(data[r][iJoursStock]);
    volTotal += vol;
    if (!isNaN(pct) && vol > 0) { sumVolPct += vol * pct; sumVolPctN += vol; }
    if (!isNaN(jours) && vol > 0) { sumVolJours += vol * jours; sumVolJoursN += vol; }
    if (data[r][iAlerte] === 'O') {
      // Force string conversion sur tous les champs pour éviter les problèmes
      // de sérialisation JSON via google.script.run (Date objects → null)
      const dluoVal = data[r][iDLUO];
      const dluoStr = (dluoVal instanceof Date)
        ? Utilities.formatDate(dluoVal, 'Europe/Paris', 'dd/MM/yyyy')
        : String(dluoVal || '');
      alertes.push({
        lot: String(data[r][iLot] || ''),
        produit: String(data[r][iProduit] || ''),
        pctConsommee: isNaN(pct) ? 0 : pct,
        volHL: isNaN(vol) ? 0 : vol,
        dluo: dluoStr
      });
    }
  }
  // Tri par CRITICITÉ = % consommée × volume (lots prioritaires à pousser en vente)
  alertes.sort(function(a, b) { return (b.pctConsommee * b.volHL) - (a.pctConsommee * a.volHL); });

  return {
    stocksDispo: true,
    rotationJoursMoy: sumVolJoursN > 0 ? sumVolJours / sumVolJoursN : 0,
    dluoConsommeeMoy: sumVolPctN > 0 ? sumVolPct / sumVolPctN : 0,
    lotsAlerte: alertes.slice(0, 10),
    nbLotsStock: data.length - 1,
    volumeStockHL: volTotal
  };
}

// ============================================================
//  BACKEND — enrichit l'objet getKPIsWebApp avec les KPI stocks
//  À appeler dans getKPIsWebApp (Easybeer_Sync.gs) juste avant le return.
// ============================================================
function enrichirAvecStocks_(kpi) {
  try {
    kpi.stocks = calculerKPIStocks();
  } catch (e) {
    Logger.log('⚠️ enrichirAvecStocks_ erreur : ' + e.message);
    kpi.stocks = { stocksDispo: false };
  }
  return kpi;
}

// ============================================================
//  TRIGGER AUTO — sync stocks chaque nuit à 1h
//  (1h pour ne pas conflicter avec le pipeline principal à minuit)
// ============================================================
function creerTriggerSyncStocksNuit() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncStocksPFEasybeer') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncStocksPFEasybeer').timeBased().atHour(1).everyDays(1).create();
  SpreadsheetApp.getUi().alert(
    '✅ Trigger sync stocks PF programmé chaque nuit à 1h00.\n\n' +
    'Pas de conflit avec ton pipeline principal (minuit).\n' +
    'Durée ~3 min par sync.'
  );
}

function supprimerTriggerSyncStocksNuit() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncStocksPFEasybeer') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getUi().alert(n + ' trigger(s) sync stocks supprimé(s).');
}

// ============================================================
//  HELPER JOURS TRAVAILLÉS — utilisé en V13 pour alertes Slack
//  Retourne true si date = lundi à vendredi ET pas jour férié FR
// ============================================================
function isJourTravaille_(date) {
  date = date || new Date();
  const jour = date.getDay(); // 0=dim, 6=sam
  if (jour === 0 || jour === 6) return false;
  // Jours fériés France 2025-2027 (à étendre annuellement)
  const feries = [
    '2025-01-01','2025-04-21','2025-05-01','2025-05-08','2025-05-29','2025-06-09','2025-07-14','2025-08-15','2025-11-01','2025-11-11','2025-12-25',
    '2026-01-01','2026-04-06','2026-05-01','2026-05-08','2026-05-14','2026-05-25','2026-07-14','2026-08-15','2026-11-01','2026-11-11','2026-12-25',
    '2027-01-01','2027-03-29','2027-05-01','2027-05-06','2027-05-08','2027-05-17','2027-07-14','2027-08-15','2027-11-01','2027-11-11','2027-12-25'
  ];
  const iso = Utilities.formatDate(date, 'Europe/Paris', 'yyyy-MM-dd');
  return feries.indexOf(iso) === -1;
}

// ============================================================
//  TEST — affiche les KPI calculés
// ============================================================
function testCalculerKPIStocks() {
  const kpi = calculerKPIStocks();
  Logger.log('Rotation moyenne : ' + kpi.rotationJoursMoy.toFixed(1) + ' jours');
  Logger.log('DLUO consommée moyenne : ' + (kpi.dluoConsommeeMoy * 100).toFixed(1) + ' %');
  Logger.log('Nb lots en stock : ' + kpi.nbLotsStock);
  Logger.log('Volume total : ' + kpi.volumeStockHL.toFixed(1) + ' HL');
  Logger.log('Alertes (>30%) : ' + kpi.lotsAlerte.length);
  kpi.lotsAlerte.slice(0, 5).forEach(function(a) {
    Logger.log('  • ' + a.lot + ' / ' + a.produit + ' / ' + (a.pctConsommee * 100).toFixed(1) + '% / ' + a.volHL.toFixed(2) + ' HL');
  });
}