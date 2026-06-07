/**
 * ============================================================
 *  V13 — ALERTES SLACK LOTS FANTÔMES
 * ============================================================
 *
 *  Détecte les lots en stock PF qui ressemblent à des "fantômes"
 *  (probablement écoulés en réalité mais encore dans Easybeer)
 *  et envoie des MP Slack aux destinataires concernés.
 *
 *  Critère par défaut :
 *    > 90 jours en stock  ET  < 10% du volume conditionné initial
 *    (fallback si pas de match HISTORIQUE_KPI : vol < 0.5 HL)
 *
 *  Cadence :
 *    Lundi 9h — jours travaillés (skip si férié)
 *    Re-alerte chaque lundi tant que le lot n'est pas régularisé
 *    Résolution auto dès que stock système = 0
 *
 *  Destinataires (workspace Prizm Brewing Co) :
 *    Alex     : U06DW4718N6
 *    Olivier  : U03ULDQ9AN6
 *    Maxime   : U093MADS3K5
 *
 *  Setup (à faire une fois) :
 *    1) Créer une app Slack chez prizmbrewingco.slack.com
 *       Scopes : chat:write, im:write
 *    2) Menu Easybeer → V13 → "Configurer token Slack"
 *       → coller le Bot User OAuth Token (xoxb-...)
 *    3) Menu → V13 → "Tester MP Slack" (envoie 1 MP test à Alex)
 *    4) Menu → V13 → "Bootstrap (marquer fantômes existants)"
 *       → ne PAS skipper, sinon spam massif au 1er lundi
 *    5) Menu → V13 → "Activer audit hebdo (lundi 9h)"
 *
 *  Architecture :
 *    - Détection : detecterLotsFantomes_() lit STOCK_PF + HISTORIQUE_KPI
 *    - State    : onglet ALERTES_FANTOMES_HISTO (1 ligne par lot)
 *    - Envoi    : Slack Web API chat.postMessage via UrlFetchApp
 *    - Trigger  : ScriptApp weekly Monday 9h → auditLotsFantomesHebdo()
 *
 *  Fonctions menu utilisateur :
 *    configurerSlackTokenV13          — stocker le token Slack
 *    testerMPSlackV13                 — envoyer 1 MP test à Alex
 *    previewLotsFantomesV13           — voir les fantômes détectés
 *    bootstrapAlertesFantomesV13      — marquer existants comme déjà alertés
 *    lancerAuditManuelV13             — exécuter l'audit maintenant
 *    activerAuditFantomesHebdoV13     — créer trigger lundi 9h
 *    desactiverAuditFantomesHebdoV13  — supprimer trigger
 *
 *  Dépendance : isJourTravaille_() définie dans 04_stocksPF.gs
 * ============================================================
 */

// ------------------------------------------------------------
//  CONSTANTES
// ------------------------------------------------------------
const ALERTES_HISTO_ONGLET = 'ALERTES_FANTOMES_HISTO';
const SEUIL_JOURS_FANTOME = 90;       // > 90 jours en stock
const SEUIL_PCT_INITIAL = 0.10;       // < 10% du volume conditionné initial
const SEUIL_VOLHL_FALLBACK = 0.5;     // fallback si pas de match HISTORIQUE_KPI
const SLACK_USER_IDS = {
  alex:    'U06DW4718N6',
  olivier: 'U03ULDQ9AN6',
  maxime:  'U093MADS3K5'
};
const SLACK_API_POSTMESSAGE = 'https://slack.com/api/chat.postMessage';
const PROP_SLACK_TOKEN = 'SLACK_BOT_TOKEN';

// ------------------------------------------------------------
//  CONFIG SLACK TOKEN
// ------------------------------------------------------------
function configurerSlackTokenV13() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(
    'Slack Bot Token',
    'Colle le Bot User OAuth Token (commence par xoxb-) :',
    ui.ButtonSet.OK_CANCEL
  );
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const token = (r.getResponseText() || '').trim();
  if (!token.startsWith('xoxb-')) {
    ui.alert('❌ Token invalide : doit commencer par "xoxb-"');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_SLACK_TOKEN, token);
  ui.alert('✅ Token Slack stocké.\n\nLance "Tester MP Slack" pour valider l\'envoi.');
}

function getSlackToken_() {
  const t = PropertiesService.getScriptProperties().getProperty(PROP_SLACK_TOKEN);
  if (!t) throw new Error('SLACK_BOT_TOKEN non configuré. Menu Easybeer → V13 → Configurer token Slack.');
  return t;
}

// ------------------------------------------------------------
//  ENVOI MP SLACK (chat.postMessage)
// ------------------------------------------------------------
function envoyerMPSlack_(userId, markdownMessage) {
  const token = getSlackToken_();
  const payload = {
    channel: userId,
    text: markdownMessage,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false
  };
  try {
    const resp = UrlFetchApp.fetch(SLACK_API_POSTMESSAGE, {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    let data;
    try { data = JSON.parse(body); } catch (_) { data = null; }

    if (code === 200 && data && data.ok) {
      Logger.log('[Slack] OK → ' + userId + ' (ts=' + data.ts + ')');
      return { ok: true, ts: data.ts };
    }
    const err = (data && data.error) ? data.error : ('HTTP ' + code);
    Logger.log('[Slack] ERR → ' + userId + ' : ' + err);
    return { ok: false, error: err };
  } catch (e) {
    Logger.log('[Slack] EXCEPTION → ' + userId + ' : ' + e.toString());
    return { ok: false, error: e.toString() };
  }
}

// ------------------------------------------------------------
//  TEST MP — envoi minimal à Alex pour valider la chaîne
// ------------------------------------------------------------
function testerMPSlackV13() {
  const ui = SpreadsheetApp.getUi();
  const now = Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  const msg = ':beer: *Test V13 — Easybeer Sync*\n\n' +
              'Si tu vois ce message, l\'envoi Slack depuis Apps Script fonctionne.\n' +
              '_Émis le ' + now + ' — pas d\'action requise._';
  const r = envoyerMPSlack_(SLACK_USER_IDS.alex, msg);
  if (r.ok) {
    ui.alert('✅ MP envoyé à Alex.\n\nVérifie ton Slack sur Prizm Brewing Co.');
  } else {
    ui.alert('❌ Échec envoi Slack : ' + r.error +
            '\n\nVérifie le token et les scopes (chat:write + im:write).');
  }
}

// ------------------------------------------------------------
//  HELPERS COLONNES
// ------------------------------------------------------------
function findColIndex_(headers, candidates) {
  for (let c = 0; c < candidates.length; c++) {
    const i = headers.indexOf(candidates[c]);
    if (i >= 0) return i;
  }
  return -1;
}

// ------------------------------------------------------------
//  CHARGEMENT MAP LOT → VOLUME CONDITIONNÉ INITIAL
//    Depuis HISTORIQUE_KPI. Si un lot apparaît plusieurs fois, on garde le max.
// ------------------------------------------------------------
function chargerMapLotVolumeInitial_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('HISTORIQUE_KPI');
  const map = {};
  if (!sheet) {
    Logger.log('[V13] HISTORIQUE_KPI introuvable → fallback seuil absolu uniquement');
    return map;
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return map;
  const headers = data[0].map(h => String(h).trim());

  const iLot = findColIndex_(headers, [
    'Numero Lot', 'Numéro Lot', 'numeroLot', 'Lot', 'N° Lot', 'No Lot'
  ]);
  const iVolCondi = findColIndex_(headers, [
    'Vol Condi (HL)', 'Vol. Condi (HL)', 'Vol Condi HL', 'Vol. Condi HL',
    'Volume Condi HL', 'Vol condi (HL)', 'Volume Conditionné (HL)'
  ]);

  if (iLot < 0 || iVolCondi < 0) {
    Logger.log('[V13] HISTORIQUE_KPI colonnes non trouvées : iLot=' + iLot + ' iVolCondi=' + iVolCondi);
    Logger.log('[V13] Headers détectés : ' + JSON.stringify(headers));
    return map;
  }

  for (let r = 1; r < data.length; r++) {
    const lot = String(data[r][iLot] || '').trim();
    if (!lot) continue;
    const v = parseFloat(data[r][iVolCondi]);
    if (isNaN(v) || v <= 0) continue;
    map[lot] = Math.max(map[lot] || 0, v);
  }
  Logger.log('[V13] Map lot→volInit : ' + Object.keys(map).length + ' lots chargés');
  return map;
}

// ------------------------------------------------------------
//  DÉTECTION LOTS FANTÔMES
// ------------------------------------------------------------
function detecterLotsFantomes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('STOCK_PF');
  if (!sheet) throw new Error('Onglet STOCK_PF introuvable — lance d\'abord la sync stocks V12.');

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  const iLot = findColIndex_(headers, [
    'Numéro Lot', 'Numero Lot', 'numeroLot', 'Lot', 'N° Lot', 'No Lot'
  ]);
  const iProduit = findColIndex_(headers, ['Produit', 'Nom Produit', 'Nom']);
  const iStockHL = findColIndex_(headers, [
    'Volume (HL)', 'Stock (HL)', 'Stock HL', 'Vol HL', 'Vol (HL)', 'Volume HL'
  ]);
  const iDLUO = findColIndex_(headers, [
    'DLUO (date lisible)', 'DLUO', 'DLC', 'Date DLUO'
  ]);
  const iJoursStock = findColIndex_(headers, [
    'Jours en Stock', 'Jours Stock', 'JoursStock', 'Jours en stock', 'Âge (j)', 'Age'
  ]);

  if (iLot < 0 || iStockHL < 0 || iJoursStock < 0) {
    throw new Error(
      'Colonnes manquantes dans STOCK_PF (Lot=' + iLot +
      ' StockHL=' + iStockHL + ' JoursStock=' + iJoursStock + '). ' +
      'Headers vus : ' + JSON.stringify(headers)
    );
  }

  const mapVolInit = chargerMapLotVolumeInitial_();

  const fantomes = [];
  for (let r = 1; r < data.length; r++) {
    const lot = String(data[r][iLot] || '').trim();
    if (!lot) continue;

    const vol = parseFloat(data[r][iStockHL]);
    if (isNaN(vol) || vol <= 0) continue;

    const joursStock = parseInt(data[r][iJoursStock]);
    if (isNaN(joursStock) || joursStock <= SEUIL_JOURS_FANTOME) continue;

    const produit = String(data[r][iProduit] || '');
    const volInit = mapVolInit[lot];

    let isFantome = false;
    let pctInitial = null;

    if (volInit && volInit > 0) {
      pctInitial = vol / volInit;
      if (pctInitial < SEUIL_PCT_INITIAL) isFantome = true;
    } else {
      // Fallback : pas de match HISTORIQUE_KPI → seuil volume absolu
      if (vol < SEUIL_VOLHL_FALLBACK) isFantome = true;
    }

    if (!isFantome) continue;

    const dluoVal = iDLUO >= 0 ? data[r][iDLUO] : null;
    const dluoStr = (dluoVal instanceof Date)
      ? Utilities.formatDate(dluoVal, 'Europe/Paris', 'dd/MM/yyyy')
      : String(dluoVal || '');

    fantomes.push({
      lot: lot,
      produit: produit,
      volHL: Math.round(vol * 100) / 100,
      volInitHL: volInit ? Math.round(volInit * 100) / 100 : null,
      pctInitial: pctInitial !== null ? Math.round(pctInitial * 1000) / 10 : null, // en %
      joursStock: joursStock,
      dluo: dluoStr
    });
  }

  // Tri par criticité : pct initial le + bas → puis jours en stock le + élevé
  fantomes.sort((a, b) => {
    const pa = a.pctInitial !== null ? a.pctInitial : 50;
    const pb = b.pctInitial !== null ? b.pctInitial : 50;
    if (pa !== pb) return pa - pb;
    return b.joursStock - a.joursStock;
  });

  Logger.log('[V13] Fantômes détectés : ' + fantomes.length);
  return fantomes;
}

// ------------------------------------------------------------
//  PERSISTANCE : ONGLET ALERTES_FANTOMES_HISTO
// ------------------------------------------------------------
function getOuCreerOngletAlertes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ALERTES_HISTO_ONGLET);
  if (!sheet) {
    sheet = ss.insertSheet(ALERTES_HISTO_ONGLET);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'Lot', 'Produit', 'Date Détection', 'Date Dernière Alerte', 'Nb Alertes', 'Statut', 'Notes'
    ]]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#fef3c7');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 7, 140);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(7, 240);
  }
  return sheet;
}

function chargerHistoAlertes_() {
  const sheet = getOuCreerOngletAlertes_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  if (data.length < 2) return map;
  for (let r = 1; r < data.length; r++) {
    const lot = String(data[r][0] || '').trim();
    if (!lot) continue;
    map[lot] = {
      ligne: r + 1, // 1-indexed
      produit: data[r][1],
      dateDetection: data[r][2],
      dateLastAlerte: data[r][3],
      nbAlertes: parseInt(data[r][4]) || 0,
      statut: String(data[r][5] || '').trim(),
      notes: data[r][6]
    };
  }
  return map;
}

function upsertHistoAlerte_(lot, produit, statut, infoHistoExist) {
  const sheet = getOuCreerOngletAlertes_();
  const now = new Date();
  if (infoHistoExist) {
    sheet.getRange(infoHistoExist.ligne, 4).setValue(now);
    sheet.getRange(infoHistoExist.ligne, 5).setValue(infoHistoExist.nbAlertes + 1);
    sheet.getRange(infoHistoExist.ligne, 6).setValue(statut);
  } else {
    sheet.appendRow([lot, produit, now, now, 1, statut, '']);
  }
}

function marquerResolu_(infoHistoExist) {
  if (!infoHistoExist || !infoHistoExist.ligne) return;
  const sheet = getOuCreerOngletAlertes_();
  sheet.getRange(infoHistoExist.ligne, 6).setValue('RESOLU');
  sheet.getRange(infoHistoExist.ligne, 7).setValue(
    'Résolu auto le ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy')
  );
}

// ------------------------------------------------------------
//  BOOTSTRAP — 1ère exécution
//    Marque TOUS les fantômes ACTUELS comme déjà alertés, SANS rien envoyer.
//    Indispensable pour éviter le spam au 1er lundi.
// ------------------------------------------------------------
function bootstrapAlertesFantomesV13() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    'Bootstrap V13',
    'Cette action marque TOUS les lots fantômes ACTUELS comme "déjà alertés" SANS envoyer aucune MP Slack.\n\n' +
    'Indispensable pour éviter le spam au 1er lundi.\n\nContinuer ?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const fantomes = detecterLotsFantomes_();
  const histo = chargerHistoAlertes_();
  let nbAjoutes = 0, nbDejaLa = 0;
  fantomes.forEach(f => {
    if (!histo[f.lot]) {
      upsertHistoAlerte_(f.lot, f.produit, 'BOOTSTRAP', null);
      nbAjoutes++;
    } else {
      nbDejaLa++;
    }
  });
  ui.alert(
    '✅ Bootstrap terminé.\n\n' +
    '• ' + nbAjoutes + ' lots marqués BOOTSTRAP (déjà alertés)\n' +
    '• ' + nbDejaLa + ' lots déjà présents dans l\'historique\n\n' +
    'Les prochains lots détectés (NOUVEAUX) déclencheront une MP Slack au lundi suivant.'
  );
}

// ------------------------------------------------------------
//  AUDIT PRINCIPAL — exécuté chaque lundi 9h
// ------------------------------------------------------------
function auditLotsFantomesHebdo() {
  const today = new Date();

  // Skip jours non travaillés (gère lundi férié)
  if (typeof isJourTravaille_ === 'function' && !isJourTravaille_(today)) {
    Logger.log('[V13] auditLotsFantomesHebdo : jour non travaillé, skip');
    return { skipped: 'jour non travaillé' };
  }

  const fantomes = detecterLotsFantomes_();
  const histo = chargerHistoAlertes_();

  // Set des lots fantômes actuels (pour détecter les résolutions)
  const setFantomesActuels = {};
  fantomes.forEach(f => { setFantomesActuels[f.lot] = true; });

  // Lots à alerter cette semaine
  const aAlerter = [];
  fantomes.forEach(f => {
    const info = histo[f.lot];
    if (!info) {
      // Nouveau lot fantôme jamais vu → alerter
      aAlerter.push(Object.assign({}, f, { statutHisto: 'NOUVEAU' }));
    } else if (info.statut === 'BOOTSTRAP') {
      // Marqué bootstrap → ne PAS alerter (déjà connu pré-V13)
      // (on garde le statut tel quel)
    } else if (info.statut === 'RESOLU') {
      // Re-devenu fantôme après résolution → alerter à nouveau
      aAlerter.push(Object.assign({}, f, { statutHisto: 'RE-OUVERT' }));
    } else {
      // ENVOYE / RE-ENVOYE → rappel hebdo
      aAlerter.push(Object.assign({}, f, { statutHisto: 'RAPPEL' }));
    }
  });

  // Détecter les résolutions : lots dans histo NON présents dans fantomes actuels
  // (et qui n'étaient pas déjà RESOLU)
  Object.keys(histo).forEach(lot => {
    if (!setFantomesActuels[lot] && histo[lot].statut !== 'RESOLU' && histo[lot].statut !== 'BOOTSTRAP') {
      marquerResolu_(histo[lot]);
    }
  });

  if (aAlerter.length === 0) {
    Logger.log('[V13] Aucun lot à alerter — skip envoi Slack');
    return { sent: 0, lots: 0 };
  }

  // Envoi MP aux 3 destinataires
  const message = formatMessageSlack_(aAlerter);
  const destinataires = [
    { id: SLACK_USER_IDS.alex,    name: 'Alex' },
    { id: SLACK_USER_IDS.olivier, name: 'Olivier' },
    { id: SLACK_USER_IDS.maxime,  name: 'Maxime' }
  ];
  let nbEnvois = 0;
  const erreurs = [];
  destinataires.forEach(d => {
    const r = envoyerMPSlack_(d.id, message);
    if (r.ok) {
      nbEnvois++;
    } else {
      erreurs.push(d.name + ' (' + r.error + ')');
    }
    Utilities.sleep(500); // courtoisie Slack rate limit
  });

  // Update histo (incrémente compteur, met date)
  aAlerter.forEach(f => {
    const info = histo[f.lot];
    let newStatut;
    if (!info) newStatut = 'ENVOYE';
    else if (info.statut === 'ENVOYE' || info.statut === 'RE-ENVOYE') newStatut = 'RE-ENVOYE';
    else newStatut = 'ENVOYE';
    upsertHistoAlerte_(f.lot, f.produit, newStatut, info || null);
  });

  Logger.log('[V13] Audit terminé : ' + aAlerter.length + ' lots × ' + nbEnvois + '/' + destinataires.length + ' destinataires');
  if (erreurs.length > 0) Logger.log('[V13] Erreurs envoi : ' + erreurs.join(', '));

  return { sent: nbEnvois, lots: aAlerter.length, erreurs: erreurs };
}

// ------------------------------------------------------------
//  FORMATAGE MESSAGE SLACK
// ------------------------------------------------------------
function formatMessageSlack_(lots) {
  const today = new Date();
  const semaine = Utilities.formatDate(today, 'Europe/Paris', 'w');
  const dateStr = Utilities.formatDate(today, 'Europe/Paris', 'dd/MM/yyyy');

  let volTotal = 0;
  let nbNouveaux = 0, nbRappels = 0, nbReouverts = 0;
  lots.forEach(l => {
    volTotal += (l.volHL || 0);
    if (l.statutHisto === 'NOUVEAU') nbNouveaux++;
    else if (l.statutHisto === 'RAPPEL') nbRappels++;
    else if (l.statutHisto === 'RE-OUVERT') nbReouverts++;
  });

  let msg = ':beer: *Audit lots fantômes — semaine ' + semaine + ' (' + dateStr + ')*\n\n';
  msg += '*' + lots.length + ' lot(s) à régulariser* en stock système — ';
  msg += nbNouveaux + ' nouveau(x), ' + nbRappels + ' rappel(s)';
  if (nbReouverts > 0) msg += ', ' + nbReouverts + ' ré-ouvert(s)';
  msg += '\n';
  msg += '_Volume immobilisé total :_ *' + (Math.round(volTotal * 100) / 100) + ' HL*\n\n';

  const top = lots.slice(0, 15);
  msg += '```\n';
  msg += 'Lot                  Produit                        Stock   %init  Jours  DLUO\n';
  msg += '-------------------- ------------------------------ ------- ------ ------ ----------\n';
  top.forEach(l => {
    const lotP = String(l.lot || '').padEnd(20).substring(0, 20);
    const prodP = String(l.produit || '').padEnd(30).substring(0, 30);
    const stockP = ((l.volHL || 0).toFixed(2) + ' HL').padStart(7);
    const pctP = l.pctInitial !== null ? (l.pctInitial.toFixed(1) + '%').padStart(6) : '   -- ';
    const joursP = (l.joursStock + 'j').padStart(6);
    const dluoP = (l.dluo || '--').substring(0, 10);
    msg += lotP + ' ' + prodP + ' ' + stockP + ' ' + pctP + ' ' + joursP + ' ' + dluoP + '\n';
  });
  if (lots.length > 15) {
    msg += '... +' + (lots.length - 15) + ' autres lots (voir onglet ALERTES_FANTOMES_HISTO)\n';
  }
  msg += '```\n\n';
  msg += '*Critère :* > ' + SEUIL_JOURS_FANTOME + ' jours en stock ET < ' + (SEUIL_PCT_INITIAL * 100) + '% du volume conditionné initial du brassin.\n';
  msg += '*Action :* passer un mouvement de sortie / ajustement dans Easybeer pour chaque lot.\n';
  msg += '_Prochaine alerte lundi prochain si non résolus. Résolution automatique dès que stock système = 0._';
  return msg;
}

// ------------------------------------------------------------
//  PREVIEW (sans envoi) — affiche les fantômes détectés
// ------------------------------------------------------------
function previewLotsFantomesV13() {
  const ui = SpreadsheetApp.getUi();
  const fantomes = detecterLotsFantomes_();
  if (fantomes.length === 0) {
    ui.alert('✅ Aucun lot fantôme détecté actuellement.');
    return;
  }
  let msg = fantomes.length + ' lots fantômes détectés :\n\n';
  fantomes.slice(0, 20).forEach(f => {
    msg += '• ' + f.lot + ' — ' + f.produit + '\n';
    msg += '  ' + f.volHL + ' HL';
    if (f.pctInitial !== null) msg += ' (' + f.pctInitial + '% du volume initial)';
    msg += ' • ' + f.joursStock + 'j • DLUO ' + (f.dluo || '--') + '\n';
  });
  if (fantomes.length > 20) msg += '\n... +' + (fantomes.length - 20) + ' autres';
  ui.alert(msg);
}

// ------------------------------------------------------------
//  RUN MANUEL (ENVOIE LES MPS) — pour tester / forcer
// ------------------------------------------------------------
function lancerAuditManuelV13() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    '⚠️ Lancement manuel audit V13',
    'Cette action exécute l\'audit COMME SI on était lundi matin.\n\n' +
    'Des MP Slack seront ENVOYÉS aux 3 destinataires (Alex, Olivier, Maxime).\n\n' +
    'Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  const r = auditLotsFantomesHebdo();
  let txt;
  if (r.skipped) {
    txt = '⚠️ Skippé : ' + r.skipped;
  } else if (r.lots === 0) {
    txt = '✅ Aucun lot à alerter aujourd\'hui.';
  } else {
    txt = '✅ Audit lancé : ' + r.lots + ' lots × ' + r.sent + '/3 destinataires.';
    if (r.erreurs && r.erreurs.length > 0) txt += '\n\nErreurs : ' + r.erreurs.join(', ');
  }
  ui.alert(txt);
}

// ------------------------------------------------------------
//  AUDIT DE TEST — envoie SEULEMENT à Alex, NE touche PAS à l'historique
//    Utile pour valider la mise en forme du message avant le 1er envoi
//    aux 3 destinataires. Peut être relancé autant de fois que voulu.
// ------------------------------------------------------------
function lancerAuditTestAlexUniquementV13() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    '🧪 Audit TEST — envoi à Alex uniquement',
    'Cette action :\n' +
    '  • détecte tous les lots fantômes\n' +
    '  • envoie le rapport COMPLET à Alex uniquement\n' +
    '  • NE touche PAS à l\'historique ALERTES_FANTOMES_HISTO\n' +
    '  • NE notifie PAS Maxime ni Olivier\n\n' +
    'Sert à valider la mise en forme avant d\'envoyer aux 3 destinataires.\n\n' +
    'Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const fantomes = detecterLotsFantomes_();
  if (fantomes.length === 0) {
    ui.alert('✅ Aucun lot fantôme détecté actuellement. Rien à envoyer.');
    return;
  }

  // Simuler le statutHisto sans toucher à l'historique réel
  const histo = chargerHistoAlertes_();
  const lotsAvecStatut = fantomes.map(f => {
    const info = histo[f.lot];
    let statutHisto = 'NOUVEAU';
    if (info) {
      if (info.statut === 'RESOLU') statutHisto = 'RE-OUVERT';
      else if (info.statut === 'BOOTSTRAP') statutHisto = 'BOOTSTRAP';
      else statutHisto = 'RAPPEL';
    }
    return Object.assign({}, f, { statutHisto: statutHisto });
  });

  // Filtrer les BOOTSTRAP pour le test (cohérent avec audit normal)
  const aAlerter = lotsAvecStatut.filter(l => l.statutHisto !== 'BOOTSTRAP');

  if (aAlerter.length === 0) {
    ui.alert('✅ Aucun lot à alerter (tous sont en BOOTSTRAP).');
    return;
  }

  const message = '🧪 *[TEST]* ' + formatMessageSlack_(aAlerter);
  const r = envoyerMPSlack_(SLACK_USER_IDS.alex, message);

  if (r.ok) {
    ui.alert(
      '✅ Test envoyé à Alex.\n\n' +
      '• ' + aAlerter.length + ' lots dans le rapport\n' +
      '• Maxime et Olivier n\'ont rien reçu\n' +
      '• L\'historique ALERTES_FANTOMES_HISTO n\'a pas été touché\n\n' +
      'Vérifie le rendu sur Slack. Si OK → "Lancer audit MANUEL" pour envoyer aux 3.'
    );
  } else {
    ui.alert('❌ Échec envoi : ' + r.error);
  }
}

// ------------------------------------------------------------
//  TRIGGER WEEKLY MONDAY 9h
// ------------------------------------------------------------
function activerAuditFantomesHebdoV13() {
  const ui = SpreadsheetApp.getUi();
  supprimerTriggerAuditFantomesV13_();
  ScriptApp.newTrigger('auditLotsFantomesHebdo')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  ui.alert(
    '✅ Trigger hebdomadaire activé.\n\n' +
    'Exécution : tous les lundis entre 9h et 10h.\n' +
    'Skip auto si lundi férié (via isJourTravaille_).'
  );
}

function desactiverAuditFantomesHebdoV13() {
  const nb = supprimerTriggerAuditFantomesV13_();
  SpreadsheetApp.getUi().alert('✅ ' + nb + ' trigger(s) supprimé(s).');
}

function supprimerTriggerAuditFantomesV13_() {
  const triggers = ScriptApp.getProjectTriggers();
  let nb = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'auditLotsFantomesHebdo') {
      ScriptApp.deleteTrigger(t);
      nb++;
    }
  });
  return nb;
}

// ------------------------------------------------------------
//  MENU V13 — à appeler depuis onOpen() de Easybeer_Sync.gs
//  Ajouter UNE seule ligne dans le onOpen() existant :
//      setupMenuV13_(menu);
//  juste avant le .addToUi() final.
// ------------------------------------------------------------
function setupMenuV13_(menu) {
  const ui = SpreadsheetApp.getUi();
  menu.addSubMenu(
    ui.createMenu('🚨 V13 Alertes Slack')
      .addItem('⚙️  Configurer token Slack',                'configurerSlackTokenV13')
      .addItem('🧪 Tester MP Slack (envoi à Alex)',         'testerMPSlackV13')
      .addSeparator()
      .addItem('👁️  Preview lots fantômes (sans envoi)',     'previewLotsFantomesV13')
      .addItem('🧪 Audit TEST → Alex uniquement (no histo)',   'lancerAuditTestAlexUniquementV13')
      .addItem('🚀 Bootstrap (marquer existants comme alertés)', 'bootstrapAlertesFantomesV13')
      .addItem('▶️  Lancer audit MANUEL maintenant (ENVOIE)', 'lancerAuditManuelV13')
      .addSeparator()
      .addItem('🟢 Activer audit hebdo (lundi 9h)',          'activerAuditFantomesHebdoV13')
      .addItem('🔴 Désactiver audit hebdo',                  'desactiverAuditFantomesHebdoV13')
  );
}

// ------------------------------------------------------------
//  FALLBACK MENU V13 (au cas où tu ne veux pas modifier onOpen)
//  Cette fonction crée un menu top-level "🚨 V13" séparé.
//  À lancer manuellement 1 fois si besoin (Run → onOpenV13).
//  Ou via un trigger "À l'ouverture" sur onOpenV13.
//  À ne PAS confondre avec onOpen() — Apps Script ne supporte
//  qu'un seul onOpen() simple par projet (le tien est dans
//  Easybeer_Sync.gs).
//  NB : nom SANS underscore final, sinon Apps Script considère
//  la fonction comme "privée" et ne l'expose pas aux triggers.
// ------------------------------------------------------------
function onOpenV13() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚨 V13 Alertes Slack')
    .addItem('⚙️  Configurer token Slack',                'configurerSlackTokenV13')
    .addItem('🧪 Tester MP Slack (envoi à Alex)',         'testerMPSlackV13')
    .addSeparator()
    .addItem('👁️  Preview lots fantômes (sans envoi)',     'previewLotsFantomesV13')
    .addItem('🚀 Bootstrap (marquer existants comme alertés)', 'bootstrapAlertesFantomesV13')
    .addItem('▶️  Lancer audit MANUEL maintenant (ENVOIE)', 'lancerAuditManuelV13')
    .addSeparator()
    .addItem('🟢 Activer audit hebdo (lundi 9h)',          'activerAuditFantomesHebdoV13')
    .addItem('🔴 Désactiver audit hebdo',                  'desactiverAuditFantomesHebdoV13')
    .addToUi();
}