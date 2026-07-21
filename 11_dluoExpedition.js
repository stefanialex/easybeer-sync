// ============================================================
// V14 — DLUO CONSOMMÉE À L'EXPÉDITION (Niveau 4)
// ============================================================
// Remplace le proxy stock V12 par la vraie DLUO au départ client :
//   % DLUO consommée = (date expédition − date conditionnement) / durabilité produit
// Objectif craft : expédier avec ≥ 70 % de DLUO restante (< 30 % consommée).
//
// Sources :
//   - POST /commande/liste/toutes  (payload filtres, pagination — commandes livrées/facturées/archivées)
//   - GET  /commande/detail/{id}   (elementsBouteilles / elementsFuts / expeditions)
//   - HISTORIQUE_KPI               (map lot → Date Condi Réelle via chargerMapLotDateCondi_)
//   - produit.durabiliteMinimale   (jours, ex 360)
//
// ⚠️ PREMIÈRE UTILISATION : lancer menu V14 → « 🔬 Diagnostic une commande »
// pour valider la structure renvoyée par l'API REST (champ lot, expéditions).
// Le module est défensif : lignes sans lot/date comptées à part, jamais inventées.
// ============================================================

const DLUO_SHEET = 'DLUO_EXPEDITION';
const DLUO_SEUIL_OK = 0.30;        // < 30 % consommée = conforme (craft > 70 % restant)
const DLUO_SEUIL_ALERTE = 0.50;    // > 50 % = rouge
const DLUO_DURABILITE_DEFAUT = 365; // jours si produit.durabiliteMinimale absent

const DLUO_HEADERS = [
  'Mois', 'Date Expédition', 'N° Commande', 'Client', 'Produit', 'Lot',
  'Date Condi', 'Durabilité (j)', 'Âge à l\'expé (j)', '% DLUO Consommée',
  'Vol (HL)', 'Statut'
];

// ------------------------------------------------------------
// Fetch commandes
// ------------------------------------------------------------

function dluoFetchCommandesPage_(numeroPage) {
  const payload = {
    etats: [], etatsPaiement: [], typesPaiement: [], typesLivraison: [],
    idsClientsTypes: [], idsProduits: [], idsContenants: [], idsClientsTournees: [],
    idsPointsRetrait: [], idsCommerciaux: [], recherche: '', total: null,
    resteAPayer: null, retardPaiement: false, locationMateriel: false,
    sansLocationMateriel: false, locationFut: false, relancePaiement: false,
    inclureArchive: true
  };
  const url = EB_BASE_URL + '/commande/liste/toutes?numeroPage=' + numeroPage +
              '&nombreParPage=100&colonneTri=-dateCreation';
  const res = easybeerFetch_(url, {
    method: 'post', headers: getAuthHeader_(),
    payload: JSON.stringify(payload), muteHttpExceptions: true,
    contentType: 'application/json'
  }, 'commandes-page-' + numeroPage);
  return JSON.parse(res.getContentText());
}

function dluoFetchCommandeDetail_(idCommande) {
  const res = easybeerFetch_(
    EB_BASE_URL + '/commande/detail/' + idCommande,
    { method: 'get', headers: getAuthHeader_(), muteHttpExceptions: true },
    'commande-detail-' + idCommande
  );
  return JSON.parse(res.getContentText());
}

// ------------------------------------------------------------
// Extraction défensive
// ------------------------------------------------------------

/** Cherche un numéro de lot de brassin dans un élément de commande,
 *  quels que soient les champs utilisés par l'API. */
function dluoTrouverLot_(el) {
  const candidats = [
    el.numeroLot, el.identifiantLot,
    // Fûts — validé par diag 21/07/2026 : el.fut porte le lot (ex "2026143")
    el.fut && el.fut.numeroLot,
    el.fut && el.fut.lot,
    el.futHistorique && el.futHistorique.numeroLot,
    // Bouteilles — champ non encore validé (diag sans bouteilles) : candidats plausibles
    el.stockNumeroLot && el.stockNumeroLot.numeroLot,
    el.stockNumeroLot && el.stockNumeroLot.numero,
    el.stockBouteille && el.stockBouteille.numeroLot,
    el.lot && el.lot.numero, el.lot && el.lot.numeroLot
  ];
  for (let i = 0; i < candidats.length; i++) {
    const v = candidats[i];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** Date d'expédition d'une commande.
 *  Diag 21/07/2026 (commande 9398) : expeditions[] est vide, les dates vivent
 *  À LA RACINE du détail. Priorité : départ livraison > livraison réelle >
 *  réception client > expéditions[] (fallback) > facturation. */
function dluoDateExpedition_(det) {
  const racine = det.dateDepartLivraison || det.dateLivraisonReelle || det.dateReceptionClient;
  if (racine) {
    const d = new Date(racine);
    if (!isNaN(d.getTime())) return d;
  }
  let best = null;
  (det.expeditions || []).forEach(function(e) {
    const cand = e.dateDepartLivraison || e.dateExpedition || e.dateLivraison || e.date;
    if (cand) {
      const d = new Date(cand);
      if (!isNaN(d.getTime()) && (!best || d > best)) best = d;
    }
  });
  if (best) return best;
  if (det.dateFacturation) {
    const d = new Date(det.dateFacturation);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Volume HL d'un élément (même logique que l'analyse Montaner). */
function dluoVolumeElement_(el, estFut) {
  const cont = (el.stockBouteille && el.stockBouteille.contenant) ||
               (el.stockFut && el.stockFut.contenant) || el.contenant || {};
  const contenance = cont.contenance || 0;
  if (estFut) return contenance / 100; // 1 ligne = 1 fût physique
  const lotPack = (el.stockBouteille && el.stockBouteille.lot) || {};
  const nb = (el.quantite !== undefined && el.quantite !== null) ? el.quantite : 0;
  return (nb * (lotPack.quantite || 1) * contenance) / 100;
}

// ------------------------------------------------------------
// Analyse principale
// ------------------------------------------------------------

/**
 * Analyse les commandes expédiées entre dateDebut et dateFin (Date JS),
 * écrit les lignes dans DLUO_EXPEDITION (append, dédup par commande).
 * ⚠️ Long si beaucoup de commandes — à lancer par mois.
 */
function analyserDLUOExpedition_(dateDebut, dateFin) {
  return withEasybeerLock_('v14-dluo', function() {
    const mapLotCondi = chargerMapLotDateCondi_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(DLUO_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(DLUO_SHEET);
      sheet.getRange(1, 1, 1, DLUO_HEADERS.length).setValues([DLUO_HEADERS])
           .setFontWeight('bold').setBackground('#a64d79').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      sheet.getRange('F:F').setNumberFormat('@'); // lots en texte (bug "février 7445")
    }
    // Commandes déjà analysées (dédup)
    const dejaFait = {};
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues()
           .forEach(function(r) { if (r[0]) dejaFait[String(r[0])] = true; });
    }

    // 1. Liste des commandes (paginée), filtre période + livrée/facturée/archivée
    let cibles = [];
    let page = 1, totalPages = 1;
    while (page <= totalPages && page <= 50) {
      const data = dluoFetchCommandesPage_(page);
      if (page === 1) totalPages = data.totalPages || 1;
      (data.liste || []).forEach(function(c) {
        const d = new Date(c.dateCreation);
        const livree = c.estLivree || c.estFacturee || c.estArchivee;
        if (livree && d >= dateDebut && d <= dateFin && !dejaFait[String(c.numero)]) {
          cibles.push(c);
        }
      });
      page++;
      if (page <= totalPages) Utilities.sleep(EB_SLEEP_LIST);
    }
    Logger.log('[V14] ' + cibles.length + ' commandes à analyser');

    // 2. Détail par commande
    const lignes = [];
    let sansLot = 0, sansCondi = 0, sansExpe = 0;
    cibles.forEach(function(c, i) {
      Utilities.sleep(EB_SLEEP_DETAIL);
      let det;
      try { det = dluoFetchCommandeDetail_(c.idCommande); }
      catch (e) { Logger.log('[V14] detail KO ' + c.idCommande + ' : ' + e); return; }

      const dateExp = dluoDateExpedition_(det);
      if (!dateExp) { sansExpe++; return; }
      const moisCle = Utilities.formatDate(dateExp, 'Europe/Paris', 'yyyy-MM');
      const clientNom = (det.client && det.client.nom) || (c.client && c.client.nom) || '';

      const elements = []
        .concat((det.elementsBouteilles || []).map(function(el) { return { el: el, fut: false }; }))
        .concat((det.elementsFuts || []).map(function(el) { return { el: el, fut: true }; }));

      // Agrégat par (produit, lot) — les fûts arrivent 1 ligne par fût
      const parCle = {};
      elements.forEach(function(item) {
        const el = item.el;
        const prod = (el.stockBouteille && el.stockBouteille.produit) ||
                     (el.stockFut && el.stockFut.produit) || el.produit || {};
        const lot = dluoTrouverLot_(el);
        if (!lot) { sansLot++; return; }
        const cle = (prod.nom || '?') + '§' + lot + '§' + (prod.durabiliteMinimale || '');
        if (!parCle[cle]) parCle[cle] = { produit: prod.nom || '?', lot: lot,
                                          durabilite: prod.durabiliteMinimale || DLUO_DURABILITE_DEFAUT, vol: 0 };
        parCle[cle].vol += dluoVolumeElement_(el, item.fut);
      });

      Object.keys(parCle).forEach(function(cle) {
        const g = parCle[cle];
        const dCondi = mapLotCondi[g.lot];
        if (!dCondi) { sansCondi++; return; }
        const ageJours = Math.max(0, Math.round((dateExp - dCondi) / 86400000));
        const pct = g.durabilite > 0 ? ageJours / g.durabilite : 0;
        const statut = pct < DLUO_SEUIL_OK ? '✅' : (pct <= DLUO_SEUIL_ALERTE ? '⚠️' : '🔴');
        lignes.push([moisCle, dateExp, String(c.numero), clientNom, g.produit, g.lot,
                     dCondi, g.durabilite, ageJours, pct, g.vol, statut]);
      });
    });

    // 3. Écriture
    if (lignes.length > 0) {
      const start = sheet.getLastRow() + 1;
      sheet.getRange(start, 1, lignes.length, DLUO_HEADERS.length).setValues(lignes);
      sheet.getRange(start, 10, lignes.length, 1).setNumberFormat('0.0%');
      sheet.getRange(start, 11, lignes.length, 1).setNumberFormat('#,##0.00 "HL"');
      sheet.getRange(start, 2, lignes.length, 1).setNumberFormat('dd/MM/yyyy');
      sheet.getRange(start, 7, lignes.length, 1).setNumberFormat('dd/MM/yyyy');
    }
    const bilan = '[V14] ' + lignes.length + ' lignes écrites — ignorées : ' +
                  sansLot + ' sans lot, ' + sansCondi + ' lot inconnu d\'HISTORIQUE_KPI, ' +
                  sansExpe + ' commandes sans date d\'expédition';
    Logger.log(bilan);
    return { lignes: lignes.length, sansLot: sansLot, sansCondi: sansCondi, sansExpe: sansExpe };
  });
}

function analyserDLUOMoisCourant() {
  const now = new Date();
  const res = analyserDLUOExpedition_(new Date(now.getFullYear(), now.getMonth(), 1), now);
  SpreadsheetApp.getUi().alert('V14 — DLUO expédition',
    res.lignes + ' lignes ajoutées.\nIgnorées : ' + res.sansLot + ' sans lot, ' +
    res.sansCondi + ' lot inconnu, ' + res.sansExpe + ' sans date expédition.\n\n' +
    (res.sansLot > res.lignes ? '⚠️ Beaucoup de lignes sans lot — lance le Diagnostic pour vérifier la structure API.' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function analyserDLUOMoisPrecedent() {
  const now = new Date();
  const res = analyserDLUOExpedition_(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
    new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59));
  SpreadsheetApp.getUi().alert('V14 — DLUO expédition (M-1)',
    res.lignes + ' lignes ajoutées.\nIgnorées : ' + res.sansLot + ' sans lot, ' +
    res.sansCondi + ' lot inconnu, ' + res.sansExpe + ' sans date expédition.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ------------------------------------------------------------
// KPI pour la webapp
// ------------------------------------------------------------

function getKPIDluoExpeditionData_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(DLUO_SHEET);
    if (!sheet || sheet.getLastRow() < 2) {
      return { dispo: false, raison: 'Aucune analyse — menu Easybeer → 📦 V14 → Analyser' };
    }
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, DLUO_HEADERS.length).getValues();
    const parMois = {};
    data.forEach(function(r) {
      const mois = String(r[0]);
      const pct = parseFloat(r[9]) || 0;
      const vol = parseFloat(r[10]) || 0;
      if (!parMois[mois]) parMois[mois] = { volTotal: 0, pctPondere: 0, nb: 0, ok: 0 };
      const m = parMois[mois];
      m.volTotal += vol; m.pctPondere += pct * vol; m.nb++;
      if (pct < DLUO_SEUIL_OK) m.ok++;
    });
    const moisTries = Object.keys(parMois).sort();
    const histo = moisTries.slice(-6).map(function(k) {
      const m = parMois[k];
      return { mois: k, pctMoyen: m.volTotal > 0 ? m.pctPondere / m.volTotal : 0,
               pctConforme: m.nb > 0 ? m.ok / m.nb : 0, nb: m.nb, volHL: m.volTotal };
    });
    const dernier = histo[histo.length - 1] || null;
    // Pires lignes (toutes périodes confondues, top 5 par % desc)
    const pires = data.map(function(r) {
      return { mois: String(r[0]), produit: String(r[4]), lot: String(r[5]),
               pct: parseFloat(r[9]) || 0, vol: parseFloat(r[10]) || 0 };
    }).sort(function(a, b) { return b.pct - a.pct; }).slice(0, 5);
    return { dispo: true, seuilOK: DLUO_SEUIL_OK, dernier: dernier, histo: histo, pires: pires };
  } catch (e) {
    return { dispo: false, raison: String(e) };
  }
}

// ------------------------------------------------------------
// Diagnostic & menu
// ------------------------------------------------------------

/** Dump la structure brute d'une commande livrée AVEC BOUTEILLES (cherche
 *  jusqu'à 15 commandes) — valide les champs lot bouteille / date expédition.
 *  Diag fûts déjà validé le 21/07/2026 : el.fut.numeroLot ✅, date racine ✅. */
function diagnosticV14UneCommande() {
  const data = dluoFetchCommandesPage_(1);
  const livrees = (data.liste || []).filter(function(c) { return c.estLivree || c.estFacturee || c.estArchivee; });
  if (!livrees.length) { SpreadsheetApp.getUi().alert('V14', 'Aucune commande livrée trouvée page 1.', SpreadsheetApp.getUi().ButtonSet.OK); return; }

  let detAvecBtl = null, cmdAvecBtl = null, dernierDet = null, derniereCmd = null;
  for (let i = 0; i < Math.min(livrees.length, 15); i++) {
    Utilities.sleep(EB_SLEEP_DETAIL);
    try {
      const det = dluoFetchCommandeDetail_(livrees[i].idCommande);
      dernierDet = det; derniereCmd = livrees[i];
      if ((det.elementsBouteilles || []).length > 0) { detAvecBtl = det; cmdAvecBtl = livrees[i]; break; }
    } catch (e) { Logger.log('[V14-DIAG] detail KO ' + livrees[i].idCommande + ' : ' + e); }
  }

  const det = detAvecBtl || dernierDet;
  const cmd = cmdAvecBtl || derniereCmd;
  const elB = (det.elementsBouteilles || [])[0];
  const elF = (det.elementsFuts || [])[0];
  const resume = {
    commande: cmd.numero,
    aBouteilles: !!elB,
    exElementBouteille: elB ? Object.keys(elB) : 'AUCUNE COMMANDE AVEC BOUTEILLES SUR 15',
    exStockBouteille: elB && elB.stockBouteille ? Object.keys(elB.stockBouteille) : null,
    brutElementBouteille: elB ? JSON.stringify(elB).substring(0, 2000) : null,
    lotTrouveB: elB ? dluoTrouverLot_(elB) : null,
    lotTrouveF: elF ? dluoTrouverLot_(elF) : null,
    dateExpTrouvee: String(dluoDateExpedition_(det)),
    datesRacine: {
      dateDepartLivraison: det.dateDepartLivraison || null,
      dateLivraisonReelle: det.dateLivraisonReelle || null,
      dateReceptionClient: det.dateReceptionClient || null,
      dateFacturation: det.dateFacturation || null
    }
  };
  Logger.log('[V14-DIAG] ' + JSON.stringify(resume, null, 2));
  SpreadsheetApp.getUi().alert('V14 — Diagnostic',
    'Commande #' + cmd.numero + (elB ? ' (avec bouteilles)' : ' (fûts seulement — aucune commande à bouteilles trouvée sur 15)') + '\n' +
    'Lot bouteille trouvé : ' + resume.lotTrouveB + '\n' +
    'Lot fût trouvé : ' + resume.lotTrouveF + '\n' +
    'Date expédition trouvée : ' + resume.dateExpTrouvee + '\n\n' +
    'Structure brute dans les logs (Extensions → Apps Script → Exécutions).',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ------------------------------------------------------------
// Trigger mensuel automatique (2 du mois, 5h — analyse M-1)
// ------------------------------------------------------------
// Le 2 plutôt que le 1er : laisse passer la tâche Claude "suivi-mensuel-montaner"
// (1er à 8h) et les triggers V18 (1er à 4h) sans empiler les quotas UrlFetch.

/** Version trigger-safe (aucun appel UI) — analyse le mois précédent. */
function analyserDLUOMoisPrecedentAuto() {
  const now = new Date();
  try {
    const res = analyserDLUOExpedition_(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
      new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59));
    Logger.log('[V14-AUTO] M-1 : ' + res.lignes + ' lignes, ignorées lot=' +
               res.sansLot + ' condi=' + res.sansCondi + ' expé=' + res.sansExpe);
  } catch (e) {
    Logger.log('[V14-AUTO] ÉCHEC : ' + e);
  }
}

function creerTriggerV14Mensuel() {
  supprimerTriggerV14Mensuel_();
  ScriptApp.newTrigger('analyserDLUOMoisPrecedentAuto')
    .timeBased().onMonthDay(2).atHour(5).create();
  SpreadsheetApp.getUi().alert('V14', 'Trigger mensuel créé : analyse DLUO du mois précédent chaque 2 du mois à 5h.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function supprimerTriggerV14Mensuel_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'analyserDLUOMoisPrecedentAuto') ScriptApp.deleteTrigger(t);
  });
}

function supprimerTriggerV14Mensuel() {
  supprimerTriggerV14Mensuel_();
  SpreadsheetApp.getUi().alert('V14', 'Trigger mensuel supprimé.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function setupMenuV14_(menu) {
  const sub = SpreadsheetApp.getUi().createMenu('📦 V14 DLUO Expédition')
    .addItem('▶️ Analyser mois courant', 'analyserDLUOMoisCourant')
    .addItem('⏪ Analyser mois précédent', 'analyserDLUOMoisPrecedent')
    .addSeparator()
    .addItem('⏰ Activer analyse auto (2 du mois, 5h)', 'creerTriggerV14Mensuel')
    .addItem('🛑 Désactiver analyse auto', 'supprimerTriggerV14Mensuel')
    .addSeparator()
    .addItem('🔬 Diagnostic une commande (1er run)', 'diagnosticV14UneCommande');
  menu.addSubMenu(sub);
}
