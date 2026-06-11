/**
 * ============================================================
 *  V16 — RAPPORT PRODUCTION MENSUEL À CLÉMENCE
 * ============================================================
 *
 *  Envoie chaque 25 du mois à 9h un MP Slack à Clémence avec
 *  les résultats de production des 6 derniers mois (Section J
 *  du dashboard) + objectifs + indicateur visuel par mois.
 *
 *  Destinataires :
 *    Clémence : U08TUHS1DRN
 *    Alex (copie de suivi)
 *
 *  Cadence : trigger mensuel le 25 à 9h
 *
 *  Utilise le bot Slack V13 déjà configuré (token PropertiesService).
 *
 *  Fonctions menu :
 *    testerRapportProductionClemence    — envoi TEST à Alex uniquement
 *    lancerRapportProductionMaintenant  — envoi RÉEL à Clémence + Alex
 *    activerRapportProductionMensuel    — trigger 25 du mois 9h
 *    desactiverRapportProductionMensuel — supprimer trigger
 *
 *  Dépendances : envoyerMPSlack_ (05_alertesSlackStocks.gs),
 *                SEUIL_VOL_HL_REUSSI, SEUIL_RDT_REUSSI (Easybeer_Sync.gs)
 * ============================================================
 */

const CLEMENCE_SLACK_ID = 'U08TUHS1DRN';
const RAPPORT_PROD_NB_MOIS = 6;

// ------------------------------------------------------------
//  GÉNÉRATION DU MESSAGE — relit HISTORIQUE_KPI et calcule
//  les agrégats mensuels (même logique que la section J du dashboard)
// ------------------------------------------------------------
function genererRapportProductionMensuel_(nbMois) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET);
  if (!sheet) throw new Error('Onglet HISTORIQUE_KPI introuvable');
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error('HISTORIQUE_KPI vide');
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);

  // Agrégat par mois (clé YYYY-MM, label "Mois Année")
  const mensuels = {};
  for (let r = 1; r < data.length; r++) {
    const statut = String(data[r][idx['Statut']] || '').trim();
    if (statut !== 'Archivé') continue;
    const dCondi = data[r][idx['Date Condi']];
    if (!dCondi || !(dCondi instanceof Date) || isNaN(dCondi.getTime())) continue;
    const mKey = dCondi.getFullYear() + '-' + String(dCondi.getMonth() + 1).padStart(2, '0');
    if (!mensuels[mKey]) {
      mensuels[mKey] = {
        label: MOIS_FR[dCondi.getMonth()] + ' ' + dCondi.getFullYear(),
        vol: 0, theoCorrige: 0, condiFini: 0, count: 0
      };
    }
    const m = mensuels[mKey];
    const vol = parseValSafe_(data[r][idx['Vol. Condi (HL)']]);
    const theo = parseValSafe_(data[r][idx['Vol. Batch Théo']]);
    const fruits = parseValSafe_(data[r][idx['Vol Fruits Ajouté (HL)']]);
    m.vol += vol;
    m.condiFini += vol;
    m.theoCorrige += (theo + fruits);
    m.count++;
  }

  // Tri desc, prendre N derniers mois
  const keys = Object.keys(mensuels).sort((a, b) => b.localeCompare(a)).slice(0, nbMois);
  if (keys.length === 0) throw new Error('Aucun brassin archivé trouvé pour générer le rapport');

  // Construction message Slack
  const moisLabel = Utilities.formatDate(new Date(), 'Europe/Paris', 'MMMM yyyy');
  let msg = ':bar_chart: *Rapport de production — ' + moisLabel + '*\n\n';
  msg += 'Salut Clémence,\n\n';
  msg += 'Voici les résultats de production des ' + keys.length + ' derniers mois.\n';
  msg += ':warning: _Rappel : décalage d\'1 mois entre la mesure et le calcul des primes._\n\n';

  msg += '*Objectifs mensuels :*\n';
  msg += '• Volume conditionné : ≥ *' + SEUIL_VOL_HL_REUSSI + ' HL*\n';
  msg += '• Rendement brassage : ≥ *' + Math.round(SEUIL_RDT_REUSSI * 100) + '%*\n\n';

  msg += '*Résultats par mois :*\n';
  msg += '```\n';
  msg += 'Mois             Vol HL      Rdt     Brassins  Statut\n';
  msg += '---------------- ---------- ------- --------- -------\n';
  keys.forEach(k => {
    const m = mensuels[k];
    const rdt = m.theoCorrige > 0 ? m.condiFini / m.theoCorrige : 0;
    // Arrondi à précision affichage pour éviter bug flottant (cf section J dashboard)
    const volArr = Math.round(m.vol * 10) / 10;
    const rdtArr = Math.round(rdt * 1000) / 1000;
    const volOk = volArr >= SEUIL_VOL_HL_REUSSI;
    const rdtOk = rdtArr >= SEUIL_RDT_REUSSI;
    let statut;
    if (volOk && rdtOk) statut = '✅ OK';
    else if (!volOk && !rdtOk) statut = '❌ vol+rdt';
    else if (!volOk) statut = '⚠️ vol';
    else statut = '⚠️ rdt';

    const lMois  = String(m.label).padEnd(16).substring(0, 16);
    const lVol   = (volArr.toFixed(1) + ' HL').padStart(10);
    const lRdt   = (Math.round(rdt * 1000) / 10).toFixed(1) + '%';
    const lRdtP  = lRdt.padStart(7);
    const lCount = String(m.count).padStart(9);
    msg += lMois + ' ' + lVol + ' ' + lRdtP + ' ' + lCount + '  ' + statut + '\n';
  });
  msg += '```\n\n';

  msg += '*Légende :*\n';
  msg += '✅ Volume ET rendement atteints  |  ⚠️ Un seul critère manqué  |  ❌ Les deux manqués\n\n';

  msg += '_Note : la prime "retour satisfaction / qualité" n\'est pas encore set up — sera ajoutée prochainement._\n\n';
  msg += 'Je me tiens à dispo pour tout élément complémentaire.\n';
  msg += '— Alex';

  return msg;
}

// ------------------------------------------------------------
//  TEST — envoi à Alex uniquement (pour valider mise en forme)
// ------------------------------------------------------------
function testerRapportProductionClemence() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    '🧪 Test rapport production',
    'Génère le rapport et l\'envoie à TOI (Alex) uniquement, PAS à Clémence.\n\n' +
    'Sert à valider la mise en forme avant l\'envoi réel.\n\n' +
    'Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  try {
    const message = genererRapportProductionMensuel_(RAPPORT_PROD_NB_MOIS);
    const testMsg = '🧪 *[TEST — non envoyé à Clémence]*\n\n' + message;
    const r = envoyerMPSlack_(SLACK_USER_IDS.alex, testMsg);
    if (r.ok) {
      ui.alert('✅ Test envoyé à Alex.\n\nVérifie le rendu sur Slack. Clémence n\'a rien reçu.');
    } else {
      ui.alert('❌ Échec envoi Slack : ' + r.error);
    }
  } catch (e) {
    ui.alert('❌ Erreur génération : ' + e.message);
  }
}

// ------------------------------------------------------------
//  ENVOI RÉEL — Clémence + Alex (copie)
// ------------------------------------------------------------
function lancerRapportProductionMaintenant() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    '⚠️ Envoi rapport à Clémence',
    'Cette action envoie le rapport à CLÉMENCE (U08TUHS1DRN) ET à toi en copie.\n\n' +
    'Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  const r = envoyerRapportProductionMensuelClemence_();
  let txt = '';
  txt += 'Clémence : ' + (r.clemence.ok ? '✅ envoyé' : '❌ ' + r.clemence.error) + '\n';
  txt += 'Alex (copie) : ' + (r.alex.ok ? '✅ envoyé' : '❌ ' + r.alex.error);
  ui.alert(txt);
}

function envoyerRapportProductionMensuelClemence_() {
  const message = genererRapportProductionMensuel_(RAPPORT_PROD_NB_MOIS);
  const rClemence = envoyerMPSlack_(CLEMENCE_SLACK_ID, message);
  Utilities.sleep(500);
  const copieMsg = '_Copie du rapport envoyé à Clémence aujourd\'hui :_\n\n' + message;
  const rAlex = envoyerMPSlack_(SLACK_USER_IDS.alex, copieMsg);
  Logger.log('[RAPPORT-PROD] Clémence: ' + (rClemence.ok ? 'OK ts=' + rClemence.ts : rClemence.error) +
             ' | Alex: ' + (rAlex.ok ? 'OK ts=' + rAlex.ts : rAlex.error));
  return { clemence: rClemence, alex: rAlex };
}

// ------------------------------------------------------------
//  TRIGGER AUTO — appelé chaque 25 du mois à 9h
// ------------------------------------------------------------
function rapportProductionMensuelAuto() {
  const today = new Date();
  // Skip si jour férié (par sécurité, même si on est le 25)
  if (typeof isJourTravaille_ === 'function' && !isJourTravaille_(today)) {
    Logger.log('[RAPPORT-PROD-AUTO] Jour férié, on envoie quand même (jour fixe = 25)');
    // En fait pour Clémence c'est OK d'envoyer un jour férié, c'est un rapport pas une alerte
  }
  Logger.log('[RAPPORT-PROD-AUTO] Lancement…');
  try {
    const r = envoyerRapportProductionMensuelClemence_();
    Logger.log('[RAPPORT-PROD-AUTO] Terminé. Clémence=' + r.clemence.ok + ', Alex=' + r.alex.ok);
  } catch (e) {
    Logger.log('[RAPPORT-PROD-AUTO] ❌ ' + e.message);
    // Notifier Alex en cas d'erreur
    try { envoyerMPSlack_(SLACK_USER_IDS.alex, '❌ *Erreur rapport production auto :* ' + e.message); } catch (e2) {}
  }
}

function activerRapportProductionMensuel() {
  supprimerTriggerRapportProduction_();
  ScriptApp.newTrigger('rapportProductionMensuelAuto')
    .timeBased()
    .onMonthDay(25)
    .atHour(9)
    .create();
  SpreadsheetApp.getUi().alert(
    '✅ Trigger mensuel activé.\n\n' +
    'Le rapport sera envoyé à Clémence chaque 25 du mois entre 9h et 10h.\n' +
    'Tu reçois une copie en MP.'
  );
}

function desactiverRapportProductionMensuel() {
  const n = supprimerTriggerRapportProduction_();
  SpreadsheetApp.getUi().alert('✅ ' + n + ' trigger(s) supprimé(s).');
}

function supprimerTriggerRapportProduction_() {
  const triggers = ScriptApp.getProjectTriggers();
  let n = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'rapportProductionMensuelAuto') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  return n;
}

// ------------------------------------------------------------
//  MENU V16 — à appeler depuis onOpen() de Easybeer_Sync.gs
//  Ajouter une ligne dans le onOpen() :  setupMenuV16_(menu);
//  juste avant le .addToUi() final.
// ------------------------------------------------------------
function setupMenuV16_(menu) {
  const ui = SpreadsheetApp.getUi();
  menu.addSubMenu(
    ui.createMenu('📈 V16 Rapport prod Clémence')
      .addItem('🧪 Test rapport (envoi à Alex)',         'testerRapportProductionClemence')
      .addItem('▶️  Envoyer maintenant à Clémence',       'lancerRapportProductionMaintenant')
      .addSeparator()
      .addItem('🟢 Activer auto (25 du mois 9h)',         'activerRapportProductionMensuel')
      .addItem('🔴 Désactiver auto',                       'desactiverRapportProductionMensuel')
  );
}
