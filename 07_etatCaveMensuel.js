/**
 * ============================================================
 *  V15 — ÉTAT DE CAVE MENSUEL → BROUILLON GMAIL À ANTOINE
 *  (réplique fidèle de la routine Claude Code existante)
 * ============================================================
 *
 *  Cadence : dernier jour calendaire du mois à 17h.
 *  Sortie : brouillon Gmail destiné à antoine@prizmbrewing.com
 *           (BCC alexandre@prizmbrewing.com). Validation manuelle
 *           avant envoi.
 *
 *  Sources données (toutes via MCP Easybeer JSON-RPC) :
 *    - search_brassins(etats:['EN_COURS'])
 *    - get_planning_brassage_materiel(dateDebut, dateFin, types)
 *
 *  Configuration : un token MCP Easybeer doit être stocké via
 *    Menu V15 → Configurer token MCP Easybeer (une fois)
 *
 *  Fonctions menu :
 *    configurerTokenMCPEasybeer       — stocker le token MCP
 *    previewEtatCaveV15               — popup résumé sans envoi
 *    testerEtatCaveMensuelV15         — crée brouillon Gmail (test)
 *    lancerEtatCaveMensuelMaintenant  — alias du test
 *    activerEtatCaveMensuelAutoV15    — trigger 17h dernier jour mois
 *    desactiverEtatCaveMensuelAutoV15 — supprimer trigger
 * ============================================================
 */

const ETAT_CAVE_DESTINATAIRE = 'antoine@prizmbrewing.com';
const ETAT_CAVE_BCC = 'alexandre@prizmbrewing.com';
const ETAT_CAVE_ONGLET_HISTO = 'ETAT_CAVE_MENSUEL';
const PROP_TOKEN_MCP_EB = 'EASYBEER_MCP_TOKEN';
const MCP_URL_BASE = 'https://api.easybeer.fr/mcp';

// ------------------------------------------------------------
//  CONFIG TOKEN MCP EASYBEER
// ------------------------------------------------------------
function configurerTokenMCPEasybeer() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(
    'Token MCP Easybeer',
    'Colle le token MCP Easybeer (format hbNqNu...=) :',
    ui.ButtonSet.OK_CANCEL
  );
  if (r.getSelectedButton() !== ui.Button.OK) return;
  // Nettoyer agressivement : trim + retirer espaces internes + retours ligne
  const t = String(r.getResponseText() || '').replace(/[\s\r\n]+/g, '').trim();
  if (!t) { ui.alert('❌ Token vide'); return; }
  PropertiesService.getScriptProperties().setProperty(PROP_TOKEN_MCP_EB, t);
  ui.alert('✅ Token MCP Easybeer stocké (' + t.length + ' caractères).\n\nLance maintenant "Test MCP Easybeer (debug)" pour vérifier la connexion.');
}

// ------------------------------------------------------------
//  DEBUG MCP — test simple + logs détaillés
// ------------------------------------------------------------
function testMCPEasybeerDebug() {
  const ui = SpreadsheetApp.getUi();
  try {
    const token = getTokenMCPEasybeer_();
    Logger.log('[V15-DEBUG] Token longueur=' + token.length + ' début=' + token.substring(0, 8) + ' fin=' + token.substring(token.length - 4));
    Logger.log('[V15-DEBUG] Token contient = ? ' + (token.indexOf('=') >= 0));

    // Test 1 : appel minimaliste search_brassins sans aucun argument
    const url = MCP_URL_BASE + '?token=' + token;  // Pas d'encodeURIComponent, comme curl
    Logger.log('[V15-DEBUG] URL = ' + url.substring(0, 60) + '... (token masqué)');

    const payload = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_brassins","arguments":{"etats":["EN_COURS"]}}}';
    Logger.log('[V15-DEBUG] Payload = ' + payload);

    const r = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    const body = r.getContentText();
    Logger.log('[V15-DEBUG] HTTP ' + code);
    Logger.log('[V15-DEBUG] Body (1000 premiers car.) : ' + body.substring(0, 1000));

    ui.alert(
      'HTTP ' + code + '\n\n' +
      'Token : ' + token.length + ' car. (commence par ' + token.substring(0, 6) + '..., finit par ...' + token.substring(token.length - 4) + ')\n\n' +
      'Réponse (300 car.) :\n' + body.substring(0, 300) + '\n\n' +
      'Logs complets dans Apps Script → Exécutions.'
    );
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

function getTokenMCPEasybeer_() {
  const t = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN_MCP_EB);
  if (!t) throw new Error('Token MCP Easybeer non configuré. Menu V15 → Configurer token MCP Easybeer.');
  return t;
}

// ------------------------------------------------------------
//  APPEL MCP EASYBEER (JSON-RPC tools/call)
// ------------------------------------------------------------
function callMCPEasybeer_(toolName, args) {
  const token = getTokenMCPEasybeer_();
  // PAS d'encodeURIComponent — on passe le token brut comme dans le curl qui marche
  const url = MCP_URL_BASE + '?token=' + token;
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args || {} }
  });
  const r = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  });
  const code = r.getResponseCode();
  const body = r.getContentText();
  if (code !== 200) {
    throw new Error('MCP HTTP ' + code + ' — ' + body.substring(0, 300));
  }
  let env;
  try { env = JSON.parse(body); }
  catch(e) { throw new Error('MCP réponse non-JSON : ' + body.substring(0, 200)); }
  if (env.error) throw new Error('MCP error : ' + JSON.stringify(env.error).substring(0, 300));
  if (!env.result || !env.result.content || !env.result.content[0]) {
    throw new Error('MCP réponse invalide (pas de result.content[0])');
  }
  const text = env.result.content[0].text;
  try { return JSON.parse(text); }
  catch(e) { throw new Error('MCP content non-JSON : ' + String(text).substring(0, 200)); }
}

// ------------------------------------------------------------
//  PLANNING — map idBrassin → cuves actuelles
// ------------------------------------------------------------
function recupererCuvesParBrassin_() {
  const today = new Date();
  const debut = new Date(today.getTime() - 90 * 86400000);
  const fin = new Date(today.getTime() + 60 * 86400000);
  const args = {
    dateDebut: Utilities.formatDate(debut, 'Europe/Paris', 'yyyy-MM-dd'),
    dateFin: Utilities.formatDate(fin, 'Europe/Paris', 'yyyy-MM-dd'),
    types: ['CUVE_FERMENTATION', 'CUVE_CONDITIONNEMENT', 'CUVE_GARDE', 'FERMENTEUR_CYLINDROCONIQUE']
  };
  let data;
  try { data = callMCPEasybeer_('get_planning_brassage_materiel', args); }
  catch (e) {
    Logger.log('[V15] Planning KO : ' + e.message + ' — fallback vide');
    return {};
  }
  const map = {};
  const nowTs = today.getTime();
  if (data.planning && Array.isArray(data.planning)) {
    data.planning.forEach(materiel => {
      if (materiel.type !== 'materiel') return;
      const cuveName = String(materiel.name || '').replace(/\s*\(.*\)\s*$/, '').trim();
      if (!cuveName) return;
      const tasks = materiel.tasks;
      if (!tasks || !Array.isArray(tasks)) return;
      tasks.forEach(task => {
        if (task.type !== 'brassin') return;
        const idBrassin = task.serverId;
        if (!idBrassin) return;
        if (task.from && task.to && task.from <= nowTs && nowTs <= task.to) {
          if (!map[idBrassin]) map[idBrassin] = [];
          if (map[idBrassin].indexOf(cuveName) < 0) map[idBrassin].push(cuveName);
        }
      });
    });
  }
  Logger.log('[V15] Planning : ' + Object.keys(map).length + ' brassins associés à des cuves actives');
  return map;
}

// ------------------------------------------------------------
//  BRASSINS EN COURS via MCP search_brassins
// ------------------------------------------------------------
function genererEtatCaveData_() {
  const result = callMCPEasybeer_('search_brassins', { etats: ['EN_COURS'] });
  const brassins = (result && result.brassins) ? result.brassins : [];
  Logger.log('[V15] search_brassins(EN_COURS) : ' + brassins.length + ' résultats');

  const cuvesParBrassin = recupererCuvesParBrassin_();

  const lignes = [];
  let nbExclusArchive = 0;
  brassins.forEach(b => {
    // Exclure les brassins en étape "Brassins à Archiver" (déjà conditionnés, plus en cave)
    const etapeStr = String(b.etapeBrassageCourante || '');
    if (/archiv/i.test(etapeStr)) {
      nbExclusArchive++;
      return;
    }
    const volInit = b.volumeBrassageInitial || 0;
    const volRest = b.volumeRestant != null ? b.volumeRestant : volInit;
    const volCondi = volInit - volRest;
    const coutRevient = b.coutRevient || 0;
    const ratioRestant = volInit > 0 ? volRest / volInit : 0;
    const valeurRestante = coutRevient * ratioRestant;
    const volRestHL = volRest / 100;
    const euroParHL = volRestHL > 0 ? valeurRestante / volRestHL : 0;

    let cuves = '—';
    const cuvesFromPlanning = cuvesParBrassin[b.idBrassin];
    if (cuvesFromPlanning && cuvesFromPlanning.length > 0) {
      cuves = cuvesFromPlanning.join(', ');
    }

    lignes.push({
      cuves: cuves,
      biere: b.produit || '?',
      lot: b.identifiant || b.numeroLot || '?',
      etape: b.etapeBrassageCourante || '?',
      vol_brasse_hl: volInit / 100,
      vol_condi_hl: volCondi / 100,
      vol_restant_hl: volRestHL,
      cout_revient: coutRevient,
      valeur_restante: valeurRestante,
      euro_par_hl: euroParHL,
      idBrassin: b.idBrassin || ''
    });
  });

  lignes.sort((a, b) => {
    const aVide = a.cuves === '—' ? 1 : 0;
    const bVide = b.cuves === '—' ? 1 : 0;
    if (aVide !== bVide) return aVide - bVide;
    if (a.cuves !== b.cuves) return a.cuves.localeCompare(b.cuves);
    return String(a.lot).localeCompare(String(b.lot));
  });
  Logger.log('[V15] Brassins retenus pour le rapport : ' + lignes.length + ' (exclus archive : ' + nbExclusArchive + ')');
  return lignes;
}

// ------------------------------------------------------------
//  CONSTRUCTION HTML — tableau email
// ------------------------------------------------------------
function buildHtmlEtatCave_(lignes, dateRapport, isTest) {
  const moisLabel = MOIS_FR[dateRapport.getMonth()] + ' ' + dateRapport.getFullYear();
  const dateLabel = Utilities.formatDate(dateRapport, 'Europe/Paris', 'dd/MM/yyyy');

  const T = lignes.reduce((acc, l) => {
    acc.vol_brasse_hl += l.vol_brasse_hl;
    acc.vol_condi_hl += l.vol_condi_hl;
    acc.vol_restant_hl += l.vol_restant_hl;
    acc.cout_revient += l.cout_revient;
    acc.valeur_restante += l.valeur_restante;
    return acc;
  }, { vol_brasse_hl: 0, vol_condi_hl: 0, vol_restant_hl: 0, cout_revient: 0, valeur_restante: 0 });
  const totalEuroParHL = T.vol_restant_hl > 0 ? T.valeur_restante / T.vol_restant_hl : 0;

  const fmtHL = v => v.toFixed(2).replace('.', ',') + ' hl';
  const fmtEur = v => Math.round(v).toLocaleString('fr-FR') + ' €';
  const fmtEurDec = v => v.toFixed(2).replace('.', ',') + ' €';

  let html = '<div style="font-family:Arial,sans-serif;color:#1a1a2e;">';
  html += '<h2 style="color:#1a1a2e;margin:0 0 6px 0;">[PRIZM] État de la cave — ' + moisLabel + '</h2>';
  html += '<p style="color:#666;font-size:13px;margin:0 0 16px 0;">Rapport automatique généré le ' + dateLabel + ' à partir de l\'API Easybeer (MCP).</p>';
  html += '<p style="margin:0 0 14px 0;">Bonjour Antoine,</p>';

  html += '<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:10px 14px;margin:0 0 16px 0;font-size:13px;">';
  html += '<strong>⚠️ AUTOMATISATION EN COURS DE TEST</strong><br/>';
  html += 'Ce rapport est généré automatiquement le dernier jour de chaque mois via l\'API Easybeer (script Google Apps Script).<br/>';
  html += 'Merci de vérifier que les calculs sont corrects et de faire un retour à Alexandre Stefani ';
  html += '(<a href="mailto:alexandre@prizmbrewing.com">alexandre@prizmbrewing.com</a>) pour signaler tout bug ou amélioration.';
  if (isTest) {
    html += '<br/><br/><em>Note : ce rapport a été généré manuellement le ' + dateLabel + ' pour test (pas le dernier jour du mois).</em>';
  }
  html += '</div>';

  html += '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">';
  html += '<thead><tr>';
  ['Cuve(s)', 'Bière', 'Brassin', 'Étape',
   'Vol. brassé (hl)', 'Vol. conditionné (hl)', 'Vol. restant (hl)',
   'Coût revient (€)', 'Valeur restante (€)', '€/hl'].forEach(h => {
    html += '<th style="background:#1a1a2e;color:white;padding:8px 12px;text-align:left;border:1px solid #1a1a2e;">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';

  lignes.forEach(l => {
    const vide = l.cuves === '—';
    const trStyle = vide ? ' style="color:#999;"' : '';
    html += '<tr' + trStyle + '>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;">' + l.cuves + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;">' + l.biere + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;">' + l.lot + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;">' + l.etape + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;text-align:right;">' + fmtHL(l.vol_brasse_hl) + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;text-align:right;">' + fmtHL(l.vol_condi_hl) + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;text-align:right;">' + fmtHL(l.vol_restant_hl) + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;text-align:right;">' + fmtEur(l.cout_revient) + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;text-align:right;">' + fmtEur(l.valeur_restante) + '</td>';
    html += '<td style="padding:7px 12px;border-bottom:1px solid #ddd;text-align:right;">' + (l.vol_restant_hl > 0 ? fmtEurDec(l.euro_par_hl) : '—') + '</td>';
    html += '</tr>';
  });

  html += '<tr style="font-weight:bold;background:#f0f0f0;">';
  html += '<td colspan="4" style="padding:8px 12px;border-top:2px solid #1a1a2e;">TOTAL (' + lignes.length + ' brassins)</td>';
  html += '<td style="padding:8px 12px;border-top:2px solid #1a1a2e;text-align:right;">' + fmtHL(T.vol_brasse_hl) + '</td>';
  html += '<td style="padding:8px 12px;border-top:2px solid #1a1a2e;text-align:right;">' + fmtHL(T.vol_condi_hl) + '</td>';
  html += '<td style="padding:8px 12px;border-top:2px solid #1a1a2e;text-align:right;">' + fmtHL(T.vol_restant_hl) + '</td>';
  html += '<td style="padding:8px 12px;border-top:2px solid #1a1a2e;text-align:right;">' + fmtEur(T.cout_revient) + '</td>';
  html += '<td style="padding:8px 12px;border-top:2px solid #1a1a2e;text-align:right;">' + fmtEur(T.valeur_restante) + '</td>';
  html += '<td style="padding:8px 12px;border-top:2px solid #1a1a2e;text-align:right;">' + fmtEurDec(totalEuroParHL) + '</td>';
  html += '</tr>';
  html += '</tbody></table>';

  html += '<p style="color:#888;font-size:11px;margin:18px 0 0 0;">';
  html += 'Rapport généré automatiquement · PRIZM Brewing · Easybeer MCP · Google Apps Script';
  html += '</p>';
  html += '</div>';

  return { html: html, totaux: T, totalEuroParHL: totalEuroParHL };
}

// ------------------------------------------------------------
//  CRÉATION BROUILLON GMAIL + SNAPSHOT
// ------------------------------------------------------------
function creerBrouillonEtatCave_(isTest) {
  const dateRapport = new Date();
  const lignes = genererEtatCaveData_();
  if (lignes.length === 0) throw new Error('Aucun brassin en cours détecté dans Easybeer');
  const built = buildHtmlEtatCave_(lignes, dateRapport, isTest);
  const moisLabel = MOIS_FR[dateRapport.getMonth()] + ' ' + dateRapport.getFullYear();
  const subject = '[PRIZM] État de la cave — ' + moisLabel + ' (rapport automatique)';
  const draft = GmailApp.createDraft(
    ETAT_CAVE_DESTINATAIRE,
    subject,
    'Bonjour Antoine,\n\nVoici l\'état de la cave Prizm. Ouvre cet email dans Gmail pour voir le tableau complet.\n\n— Rapport généré automatiquement.',
    {
      bcc: ETAT_CAVE_BCC,
      htmlBody: built.html,
      name: 'Prizm Brewing — Rapport automatique'
    }
  );
  try { enregistrerSnapshotEtatCave_(lignes, dateRapport); }
  catch (e) { Logger.log('[V15] Snapshot KO : ' + e.message); }
  return { draftId: draft.getId(), nbBrassins: lignes.length, totaux: built.totaux };
}

// ------------------------------------------------------------
//  SNAPSHOT ONGLET ETAT_CAVE_MENSUEL
// ------------------------------------------------------------
function enregistrerSnapshotEtatCave_(lignes, dateSnapshot) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ETAT_CAVE_ONGLET_HISTO);
  if (!sheet) {
    sheet = ss.insertSheet(ETAT_CAVE_ONGLET_HISTO);
    sheet.getRange(1, 1, 1, 11).setValues([[
      'Date Snapshot', 'Cuve(s)', 'Bière', 'Brassin', 'Étape',
      'Vol brassé (hl)', 'Vol conditionné (hl)', 'Vol restant (hl)',
      'Coût revient (€)', 'Valeur restante (€)', '€/hl'
    ]]);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#fef3c7');
    sheet.setFrozenRows(1);
  }
  const rows = lignes.map(l => [
    dateSnapshot, l.cuves, l.biere, l.lot, l.etape,
    l.vol_brasse_hl, l.vol_condi_hl, l.vol_restant_hl,
    l.cout_revient, l.valeur_restante, l.euro_par_hl
  ]);
  if (rows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 11).setValues(rows);
    sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy HH:mm');
    sheet.getRange(startRow, 6, rows.length, 3).setNumberFormat('#,##0.00');
    sheet.getRange(startRow, 9, rows.length, 3).setNumberFormat('#,##0 "€"');
  }
}

// ------------------------------------------------------------
//  TEST / ENVOI MANUEL
// ------------------------------------------------------------
function testerEtatCaveMensuelV15() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    '🧪 Test rapport état de cave',
    'Crée un brouillon Gmail (destinataire = Antoine, BCC = toi).\n\n' +
    'Le brouillon ne sera PAS envoyé : tu pourras le vérifier dans Gmail avant envoi manuel.\n\n' +
    'Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  try {
    const r = creerBrouillonEtatCave_(true);
    ui.alert(
      '✅ Brouillon Gmail créé.\n\n' +
      r.nbBrassins + ' brassins listés.\n' +
      'Vol restant total : ' + r.totaux.vol_restant_hl.toFixed(2) + ' hl\n' +
      'Valeur restante : ' + Math.round(r.totaux.valeur_restante).toLocaleString('fr-FR') + ' €\n\n' +
      'Va dans Gmail → Brouillons pour vérifier le rendu.'
    );
  } catch (e) {
    ui.alert('❌ Erreur : ' + e.message);
  }
}

function lancerEtatCaveMensuelMaintenant() { testerEtatCaveMensuelV15(); }

// ------------------------------------------------------------
//  TRIGGER AUTO — quotidien 17h, exécution si dernier jour du mois
// ------------------------------------------------------------
function etatCaveMensuelAuto() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (tomorrow.getDate() !== 1) {
    Logger.log('[V15-AUTO] Pas dernier jour du mois (today=' + today.getDate() + '), skip');
    return;
  }
  Logger.log('[V15-AUTO] Dernier jour du mois — création brouillon Gmail…');
  try {
    const r = creerBrouillonEtatCave_(false);
    Logger.log('[V15-AUTO] Brouillon créé draftId=' + r.draftId + ' nbBrassins=' + r.nbBrassins);
  } catch (e) {
    Logger.log('[V15-AUTO] ❌ ' + e.message);
    try {
      GmailApp.sendEmail(
        'alexandre@prizmbrewing.com',
        '[PRIZM][ERREUR] Rapport état de cave auto',
        'Le script V15 a échoué le ' + Utilities.formatDate(today, 'Europe/Paris', 'dd/MM/yyyy HH:mm') + ' :\n\n' + e.message
      );
    } catch (e2) { Logger.log('Envoi erreur KO: ' + e2.message); }
  }
}

function activerEtatCaveMensuelAutoV15() {
  supprimerTriggerEtatCaveV15_();
  ScriptApp.newTrigger('etatCaveMensuelAuto')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .create();
  SpreadsheetApp.getUi().alert(
    '✅ Trigger activé.\n\n' +
    'Le brouillon Gmail sera créé automatiquement à 17h le DERNIER jour de chaque mois.\n' +
    'Antoine en destinataire, toi en BCC.'
  );
}

function desactiverEtatCaveMensuelAutoV15() {
  const n = supprimerTriggerEtatCaveV15_();
  SpreadsheetApp.getUi().alert('✅ ' + n + ' trigger(s) supprimé(s).');
}

function supprimerTriggerEtatCaveV15_() {
  const triggers = ScriptApp.getProjectTriggers();
  let n = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'etatCaveMensuelAuto') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  return n;
}

// ------------------------------------------------------------
//  PREVIEW
// ------------------------------------------------------------
function previewEtatCaveV15() {
  const ui = SpreadsheetApp.getUi();
  try {
    const lignes = genererEtatCaveData_();
    if (lignes.length === 0) { ui.alert('⚠️ Aucun brassin en cours détecté.'); return; }
    const totaux = lignes.reduce((acc, l) => {
      acc.vol_brasse_hl += l.vol_brasse_hl;
      acc.vol_condi_hl += l.vol_condi_hl;
      acc.vol_restant_hl += l.vol_restant_hl;
      acc.cout_revient += l.cout_revient;
      acc.valeur_restante += l.valeur_restante;
      return acc;
    }, { vol_brasse_hl: 0, vol_condi_hl: 0, vol_restant_hl: 0, cout_revient: 0, valeur_restante: 0 });
    let msg = lignes.length + ' brassins en cours\n\n';
    msg += 'Vol brassé total : ' + totaux.vol_brasse_hl.toFixed(2) + ' hl\n';
    msg += 'Vol conditionné : ' + totaux.vol_condi_hl.toFixed(2) + ' hl\n';
    msg += 'Vol restant     : ' + totaux.vol_restant_hl.toFixed(2) + ' hl\n';
    msg += 'Coût revient    : ' + Math.round(totaux.cout_revient).toLocaleString('fr-FR') + ' €\n';
    msg += 'Valeur restante : ' + Math.round(totaux.valeur_restante).toLocaleString('fr-FR') + ' €\n\n';
    msg += 'Détail des 10 premiers brassins :\n';
    lignes.slice(0, 10).forEach(l => {
      msg += '• ' + l.lot + ' / ' + l.biere + '\n  ' + l.etape + ' • ' + l.cuves + ' • ' + l.vol_restant_hl.toFixed(2) + ' hl restants • ' + Math.round(l.valeur_restante) + ' €\n';
    });
    ui.alert(msg);
  } catch (e) {
    ui.alert('❌ Erreur : ' + e.message);
  }
}

// ------------------------------------------------------------
//  MENU V15
// ------------------------------------------------------------
function setupMenuV15_(menu) {
  const ui = SpreadsheetApp.getUi();
  menu.addSubMenu(
    ui.createMenu('🏭 V15 État de cave mensuel (Gmail)')
      .addItem('⚙️  Configurer token MCP Easybeer',         'configurerTokenMCPEasybeer')
      .addItem('🔬 Test MCP Easybeer (debug)',              'testMCPEasybeerDebug')
      .addSeparator()
      .addItem('👁️  Preview cave actuelle',                  'previewEtatCaveV15')
      .addItem('📝 Créer brouillon Gmail maintenant',        'testerEtatCaveMensuelV15')
      .addSeparator()
      .addItem('🟢 Activer auto (dernier jour mois 17h)',     'activerEtatCaveMensuelAutoV15')
      .addItem('🔴 Désactiver auto',                          'desactiverEtatCaveMensuelAutoV15')
  );
}
