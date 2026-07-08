/**
 * ============================================================
 *  V18 — KPI NIVEAU 3 : RATIO EAU (L/L bière conditionnée)
 * ============================================================
 *
 *  Objectif Julien (commande KPI niveau 3 Énergie) :
 *    Ratio = litres d'eau consommés / litres de bière produits
 *    Benchmark craft     : 6-8 L/L
 *    Benchmark industriel: 3-4 L/L
 *
 *  Décisions Alex (validation 30/06/2026) :
 *    - Compteur production = 1113990 (320 rue de la Marbrerie,
 *      compteur I20JE011634, 40 mm). Le 1024201 (15 mm, sanitaire/
 *      bureaux) est exclu du KPI.
 *    - Volume bière = CONDITIONNÉ (ce qui sort réellement)
 *    - Imputation : prorata journalier par mois sur la période
 *      facturée. Si une facture couvre 06/10 → 16/04, on alloue
 *      les m³ proportionnellement au nombre de jours dans chaque
 *      mois traversé.
 *
 *  Structure onglet ENERGIE (3 zones dans la même feuille) :
 *
 *    ZONE 1 — Saisie factures (manuelle ou pré-remplie)
 *    En-tête ligne 1, data à partir de ligne 2. 10 colonnes.
 *    Colonnes : Date facture | N° | Compte | Adresse | Compteur |
 *               Date relevé début | Date relevé fin | Conso m³ |
 *               Montant TTC € | Source PDF
 *
 *    ZONE 2 — Conso mensuelle calculée (auto)
 *    Démarre 2 lignes après la zone 1. Colonnes :
 *    Mois | Conso eau m³ | Conso eau L | Vol bière HL Easybeer |
 *    Vol bière L | Ratio L/L | Statut (🟢 / 🟡 / 🔴)
 *
 *    ZONE 3 — Synthèse 12 mois glissants (auto)
 *    Une ligne récap : ratio moyen 12M, total eau, total bière.
 *
 *  Pré-remplissage : si la zone 1 est vide au 1er run, on injecte
 *  les 4 factures historiques connues (octobre 2024 → avril 2026).
 *  Si l'utilisateur a déjà rempli, on n'écrase JAMAIS.
 *
 *  Source volume bière : HISTORIQUE_KPI colonne 'Vol. Condi (HL)'
 *  agrégée par Mois+Année. On exclut les états ANNULE / DETRUIT.
 *
 *  Menu V18 :
 *    previewKPIEnergie         — popup résumé
 *    actualiserKPIEnergie      — recalcule zones 2+3
 *    ajouterFactureEnergie     — prompt UI saisie nouvelle facture
 *    activerKPIEnergieAuto     — trigger mensuel (1er du mois 4h)
 *    desactiverKPIEnergieAuto  — supprime trigger
 * ============================================================
 */

const KE_ONGLET = 'ENERGIE';

// Compteurs : seul le 1113990 alimente le KPI ratio
const KE_COMPTEUR_PROD   = '1113990';   // 320 rue Marbrerie, 40mm — process
const KE_COMPTEUR_SANIT  = '1024201';   // 280 rue Marbrerie, 15mm — sanitaire (informatif uniquement)

// Benchmarks ratio L eau / L bière
const KE_BENCH_CRAFT_MIN = 6;
const KE_BENCH_CRAFT_MAX = 8;
const KE_BENCH_INDUS_MIN = 3;
const KE_BENCH_INDUS_MAX = 4;

const KE_HEADERS_ZONE1 = [
  'Date facture', 'N° facture', 'Compte', 'Adresse', 'Compteur',
  'Date relevé début', 'Date relevé fin', 'Conso m³', 'Montant TTC €', 'Source PDF'
];

const KE_HEADERS_ZONE2 = [
  'Mois', 'Conso eau m³ (prorata)', 'Conso eau L', 'Vol bière HL', 'Vol bière L', 'Ratio L/L', 'Statut'
];

// Historique connu (factures Régie des Eaux Montpellier - compteur production)
// Format : [dateFacture, numFacture, compte, adresse, compteur, dateReleveDebut, dateReleveFin, consoM3, montantTTC, sourcePdf]
const KE_HISTO_PRE_REMPLISSAGE = [
  ['2024-10-08', '3524911', '1113990', '320 rue de la Marbrerie', 'I20JE011634', '2024-04-03', '2024-09-26', 2527, 9314.27, 'Facture-3524911.pdf'],
  ['2025-06-24', '3990378', '1113990', '320 rue de la Marbrerie', 'I20JE011634', '2024-09-26', '2025-04-16', 2635, 9656.83, '1113990_Facture_N°3990378_du_2025-06-25.pdf'],
  ['2025-10-30', '4250270', '1113990', '320 rue de la Marbrerie', 'I20JE011634', '2025-04-16', '2025-10-06', 2743, 10190.44, '1479_001.pdf'],
  ['2026-05-11', '4728598', '1113990', '320 rue de la Marbrerie', 'I20JE011634', '2025-10-06', '2026-04-16', 3703, 6639.49, '1113990_Facture_N°4728598_du_2026-05-11.pdf']
];

// ------------------------------------------------------------
//  HELPERS
// ------------------------------------------------------------
function keParseDate_(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && v) {
    // Support yyyy-MM-dd et dd/MM/yyyy
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v);
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
  }
  return null;
}

function keMoisKey_(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0');
}

function keMoisLabel_(yyyymm) {
  if (!yyyymm || yyyymm.indexOf('-') < 0) return yyyymm;
  const parts = yyyymm.split('-');
  return (typeof MOIS_FR !== 'undefined' ? MOIS_FR[parseInt(parts[1],10)-1] : parts[1]) + ' ' + parts[0];
}

// Statut couleur selon ratio
function keStatut_(ratio) {
  if (!ratio) return '';
  if (ratio <= KE_BENCH_INDUS_MAX) return '🟢 Industriel';
  if (ratio <= KE_BENCH_CRAFT_MAX) return '🟡 Craft OK';
  return '🔴 Hors craft';
}

// ------------------------------------------------------------
//  PRORATA JOURNALIER : alloue m³ par mois
// ------------------------------------------------------------
/**
 * Pour une facture [dateDebut, dateFin, m³], retourne un dict
 *   { 'YYYY-MM' : m³_alloué_au_mois, ... }
 * Hypothèse : consommation linéaire jour par jour sur la période.
 */
function keProratiserParMois_(dateDebut, dateFin, totalM3) {
  const d0 = (dateDebut instanceof Date) ? dateDebut : keParseDate_(dateDebut);
  const d1 = (dateFin   instanceof Date) ? dateFin   : keParseDate_(dateFin);
  if (!d0 || !d1 || d1 <= d0) return {};
  const totalJours = Math.round((d1.getTime() - d0.getTime()) / 86400000);
  if (totalJours <= 0) return {};
  const m3ParJour = totalM3 / totalJours;
  const result = {};
  const cur = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  for (let i = 0; i < totalJours; i++) {
    const k = keMoisKey_(cur);
    result[k] = (result[k] || 0) + m3ParJour;
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ------------------------------------------------------------
//  LECTURE VOLUME BIÈRE PAR MOIS depuis HISTORIQUE_KPI
// ------------------------------------------------------------
/**
 * Agrège Vol. Condi (HL) par Mois/Année depuis HISTORIQUE_KPI.
 * Retourne dict { 'YYYY-MM' : volHL }.
 * On exclut les états ANNULE / DETRUIT.
 */
function keLireVolBiereParMois_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROD_SHEET || 'HISTORIQUE_KPI');
  if (!sheet) { Logger.log('[V18] HISTORIQUE_KPI introuvable'); return {}; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const headerLen = (typeof PROD_HEADERS !== 'undefined' ? PROD_HEADERS.length : sheet.getLastColumn());
  const data = sheet.getRange(1, 1, lastRow, headerLen).getValues();
  const idx = {};
  data[0].forEach((h, i) => idx[String(h).trim()] = i);
  const iMois = idx['Mois'];
  const iAnnee = idx['Année'];
  const iVCondi = idx['Vol. Condi (HL)'];
  const iStatut = idx['Statut'];
  if (iMois === undefined || iAnnee === undefined || iVCondi === undefined) {
    Logger.log('[V18] Colonnes Mois/Année/Vol. Condi (HL) manquantes');
    return {};
  }
  const result = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const statut = String(row[iStatut] || '').toUpperCase();
    // Exclure annulés/détruits
    if (statut.indexOf('ANNUL') >= 0 || statut.indexOf('DETRUIT') >= 0) continue;
    const m = row[iMois];
    const a = parseInt(row[iAnnee]);
    if (!a || !m) continue;
    // Mois peut être numérique (1-12) ou label FR
    let moisNum = 0;
    if (typeof m === 'number') moisNum = m;
    else {
      const ms = String(m).trim();
      if (typeof MOIS_FR !== 'undefined') {
        const i = MOIS_FR.findIndex(x => x.toLowerCase() === ms.toLowerCase());
        if (i >= 0) moisNum = i + 1;
      }
      if (!moisNum && /^\d+$/.test(ms)) moisNum = parseInt(ms, 10);
    }
    if (!moisNum || moisNum < 1 || moisNum > 12) continue;
    const key = a + '-' + String(moisNum).padStart(2, '0');
    const v = parseFloat(row[iVCondi]) || 0;
    result[key] = (result[key] || 0) + v;
  }
  return result;
}

// ------------------------------------------------------------
//  ÉCRITURE ONGLET ENERGIE — Zone 1 (pré-remplissage) + 2 + 3
// ------------------------------------------------------------
function keInitOnglet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(KE_ONGLET);
  if (!sheet) sheet = ss.insertSheet(KE_ONGLET);

  // Zone 1 — header
  sheet.getRange(1, 1, 1, KE_HEADERS_ZONE1.length).setValues([KE_HEADERS_ZONE1]);
  sheet.getRange(1, 1, 1, KE_HEADERS_ZONE1.length)
    .setFontWeight('bold').setBackground('#1c4587').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Pré-remplissage seulement si zone 1 vide (ligne 2 vide)
  const ligne2 = sheet.getRange(2, 1, 1, KE_HEADERS_ZONE1.length).getValues()[0];
  const dejaRempli = ligne2.some(v => v !== '' && v !== null);
  if (!dejaRempli) {
    const data = KE_HISTO_PRE_REMPLISSAGE.map(r => [
      keParseDate_(r[0]), r[1], r[2], r[3], r[4],
      keParseDate_(r[5]), keParseDate_(r[6]),
      r[7], r[8], r[9]
    ]);
    sheet.getRange(2, 1, data.length, KE_HEADERS_ZONE1.length).setValues(data);
    sheet.getRange(2, 1, data.length, 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(2, 6, data.length, 2).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(2, 8, data.length, 1).setNumberFormat('#,##0 "m³"');
    sheet.getRange(2, 9, data.length, 1).setNumberFormat('#,##0.00 "€"');
    Logger.log('[V18] Pré-remplissage zone 1 : ' + data.length + ' factures injectées.');
  }
  return sheet;
}

// ------------------------------------------------------------
//  LECTURE ZONE 1 (factures saisies)
// ------------------------------------------------------------
function keLireFactures_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(KE_ONGLET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  // On lit jusqu'à 200 lignes max en zone 1 (au-delà = zone 2)
  // Heuristique : on s'arrête à la 1ère ligne vide
  const data = sheet.getRange(2, 1, Math.min(lastRow - 1, 500), KE_HEADERS_ZONE1.length).getValues();
  const factures = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    // Ligne vide = fin de zone 1
    if (!r[0] && !r[1] && !r[7]) break;
    const dateDebut = keParseDate_(r[5]);
    const dateFin = keParseDate_(r[6]);
    const consoM3 = parseFloat(r[7]) || 0;
    const compteur = String(r[4] || '').trim();
    const compte = String(r[2] || '').trim();
    if (!dateDebut || !dateFin || !consoM3) continue;
    factures.push({
      dateFacture: keParseDate_(r[0]),
      numFacture: String(r[1] || ''),
      compte: compte,
      adresse: String(r[3] || ''),
      compteur: compteur,
      dateDebut: dateDebut,
      dateFin: dateFin,
      consoM3: consoM3,
      montantTTC: parseFloat(r[8]) || 0,
      sourcePdf: String(r[9] || '')
    });
  }
  return factures;
}

// ------------------------------------------------------------
//  CALCUL Zone 2 + Zone 3
// ------------------------------------------------------------
function keCalculerEtEcrire_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(KE_ONGLET);
  if (!sheet) throw new Error('Onglet ENERGIE introuvable. Lance d\'abord "Init ENERGIE".');

  const factures = keLireFactures_();
  if (factures.length === 0) {
    SpreadsheetApp.getUi().alert('Aucune facture saisie en zone 1.');
    return;
  }

  // Restreindre au compteur production
  const facturesProd = factures.filter(f => f.compte === KE_COMPTEUR_PROD);
  Logger.log('[V18] Factures production retenues : ' + facturesProd.length + '/' + factures.length);

  // Conso mensuelle m³ (somme prorata sur toutes les factures)
  const consoParMois = {};
  facturesProd.forEach(f => {
    const proratas = keProratiserParMois_(f.dateDebut, f.dateFin, f.consoM3);
    Object.keys(proratas).forEach(k => {
      consoParMois[k] = (consoParMois[k] || 0) + proratas[k];
    });
  });

  // Volume bière mensuel depuis HISTORIQUE_KPI
  const volBiereParMois = keLireVolBiereParMois_();

  // Construction des lignes zone 2
  const moisOnt = Object.keys(consoParMois).sort();
  const lignesZ2 = moisOnt.map(k => {
    const m3 = consoParMois[k];
    const litresEau = m3 * 1000;
    const volHL = volBiereParMois[k] || 0;
    const litresBiere = volHL * 100;
    const ratio = litresBiere > 0 ? litresEau / litresBiere : 0;
    return {
      mois: k,
      m3: m3,
      litresEau: litresEau,
      volHL: volHL,
      litresBiere: litresBiere,
      ratio: ratio,
      statut: keStatut_(ratio)
    };
  });

  // Synthèse 12 mois glissants
  const aujourd = new Date();
  const il12mois = new Date(aujourd.getFullYear(), aujourd.getMonth() - 12, 1);
  const lignes12M = lignesZ2.filter(l => {
    const p = l.mois.split('-');
    const d = new Date(parseInt(p[0],10), parseInt(p[1],10)-1, 1);
    return d >= il12mois;
  });
  const totalEau12M = lignes12M.reduce((acc, l) => acc + l.litresEau, 0);
  const totalBiere12M = lignes12M.reduce((acc, l) => acc + l.litresBiere, 0);
  const ratioMoyen12M = totalBiere12M > 0 ? totalEau12M / totalBiere12M : 0;

  // ÉCRITURE
  // On trouve la fin de zone 1 (1ère ligne vide après le header)
  const lastRowZ1 = Math.max(2 + facturesProd.length + factures.filter(f => f.compte === KE_COMPTEUR_SANIT).length, 2 + KE_HISTO_PRE_REMPLISSAGE.length);
  // Plus simple : on lit zone1 brute
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1 || 1, KE_HEADERS_ZONE1.length).getValues();
  let nbLignesZ1 = 0;
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0] && !data[i][1] && !data[i][7]) break;
    nbLignesZ1++;
  }
  const startZ2 = 2 + nbLignesZ1 + 2; // 2 lignes de séparation

  // Effacer ancien zone 2 + 3 (au-delà de startZ2-2)
  if (sheet.getLastRow() >= startZ2 - 1) {
    const nbRowsClear = sheet.getMaxRows() - (startZ2 - 1);
    if (nbRowsClear > 0) {
      sheet.getRange(startZ2 - 1, 1, nbRowsClear, sheet.getMaxColumns()).clear();
    }
  }

  // Titre Zone 2
  sheet.getRange(startZ2 - 1, 1).setValue('📊 Conso mensuelle calculée (prorata journalier) + ratio L eau / L bière')
    .setFontWeight('bold').setBackground('#1c4587').setFontColor('#ffffff').setFontSize(11);
  sheet.getRange(startZ2 - 1, 1, 1, KE_HEADERS_ZONE2.length).merge();

  // Header Zone 2
  sheet.getRange(startZ2, 1, 1, KE_HEADERS_ZONE2.length).setValues([KE_HEADERS_ZONE2])
    .setFontWeight('bold').setBackground('#ead1dc');

  // Data Zone 2
  if (lignesZ2.length > 0) {
    const rowsZ2 = lignesZ2.map(l => [
      keMoisLabel_(l.mois),
      Math.round(l.m3 * 10) / 10,
      Math.round(l.litresEau),
      Math.round(l.volHL * 10) / 10,
      Math.round(l.litresBiere),
      Math.round(l.ratio * 100) / 100,
      l.statut
    ]);
    sheet.getRange(startZ2 + 1, 1, rowsZ2.length, KE_HEADERS_ZONE2.length).setValues(rowsZ2);
    sheet.getRange(startZ2 + 1, 2, rowsZ2.length, 1).setNumberFormat('#,##0.0 "m³"');
    sheet.getRange(startZ2 + 1, 3, rowsZ2.length, 1).setNumberFormat('#,##0 "L"');
    sheet.getRange(startZ2 + 1, 4, rowsZ2.length, 1).setNumberFormat('#,##0.0 "HL"');
    sheet.getRange(startZ2 + 1, 5, rowsZ2.length, 1).setNumberFormat('#,##0 "L"');
    sheet.getRange(startZ2 + 1, 6, rowsZ2.length, 1).setNumberFormat('0.00 "L/L"');
    // Mise en forme conditionnelle sur la colonne Ratio
    sheet.clearConditionalFormatRules();
    const rangeRatio = sheet.getRange(startZ2 + 1, 6, rowsZ2.length, 1);
    const r1 = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThanOrEqualTo(KE_BENCH_INDUS_MAX)
      .setBackground('#10b981').setFontColor('#fff').setBold(true)
      .setRanges([rangeRatio]).build();
    const r2 = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(KE_BENCH_INDUS_MAX + 0.01, KE_BENCH_CRAFT_MAX)
      .setBackground('#fde68a').setFontColor('#78350f').setBold(true)
      .setRanges([rangeRatio]).build();
    const r3 = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(KE_BENCH_CRAFT_MAX)
      .setBackground('#fecaca').setFontColor('#991b1b').setBold(true)
      .setRanges([rangeRatio]).build();
    sheet.setConditionalFormatRules([r1, r2, r3]);
  }

  // Zone 3 — Synthèse 12M glissants
  const startZ3 = startZ2 + 1 + lignesZ2.length + 2;
  sheet.getRange(startZ3, 1).setValue('🎯 Synthèse — 12 mois glissants')
    .setFontWeight('bold').setBackground('#1c4587').setFontColor('#ffffff').setFontSize(11);
  sheet.getRange(startZ3, 1, 1, 4).merge();
  const synthRows = [
    ['Période',              '12 derniers mois (' + lignes12M.length + ' mois)', '', ''],
    ['Total eau process',    Math.round(totalEau12M / 1000) + ' m³', '', ''],
    ['Total bière condi',    Math.round(totalBiere12M / 100) + ' HL', '', ''],
    ['Ratio moyen L/L',      Math.round(ratioMoyen12M * 100) / 100, keStatut_(ratioMoyen12M), ''],
    ['Benchmark craft',      KE_BENCH_CRAFT_MIN + '-' + KE_BENCH_CRAFT_MAX + ' L/L', '', ''],
    ['Benchmark industriel', KE_BENCH_INDUS_MIN + '-' + KE_BENCH_INDUS_MAX + ' L/L', '', '']
  ];
  sheet.getRange(startZ3 + 1, 1, synthRows.length, 4).setValues(synthRows);
  sheet.getRange(startZ3 + 1, 1, synthRows.length, 1).setFontWeight('bold').setBackground('#ead1dc');
  sheet.getRange(startZ3 + 4, 2).setNumberFormat('0.00 "L/L"');

  try { sheet.autoResizeColumns(1, KE_HEADERS_ZONE1.length); } catch(e) {}

  Logger.log('[V18] Écriture terminée. ' + lignesZ2.length + ' mois en zone 2. Ratio 12M=' + ratioMoyen12M.toFixed(2));
  return { lignesZ2: lignesZ2, ratioMoyen12M: ratioMoyen12M, totalEau12M, totalBiere12M, lignes12M };
}

// ------------------------------------------------------------
//  FONCTION PRINCIPALE — appel menu
// ------------------------------------------------------------
function actualiserKPIEnergie() {
  const ui = (function(){ try { return SpreadsheetApp.getUi(); } catch(e) { return null; } })();
  try {
    keInitOnglet_();
    const r = keCalculerEtEcrire_();
    const msg = '✅ KPI Énergie actualisé.\n\n' +
                r.lignesZ2.length + ' mois en zone 2\n' +
                'Ratio moyen 12 mois : ' + r.ratioMoyen12M.toFixed(2) + ' L/L\n' +
                'Total eau 12M : ' + Math.round(r.totalEau12M / 1000) + ' m³\n' +
                'Total bière 12M : ' + Math.round(r.totalBiere12M / 100) + ' HL\n\n' +
                keStatut_(r.ratioMoyen12M);
    if (ui) ui.alert(msg);
    return r;
  } catch (e) {
    Logger.log('[V18] ❌ ' + e.message);
    if (ui) ui.alert('❌ Erreur : ' + e.message);
    throw e;
  }
}

// ------------------------------------------------------------
//  AJOUTER UNE FACTURE — prompt UI
// ------------------------------------------------------------
function ajouterFactureEnergie() {
  const ui = SpreadsheetApp.getUi();
  const prompts = [
    ['Date facture (dd/mm/yyyy)', null],
    ['N° facture', null],
    ['Compte (1113990 = production / 1024201 = sanitaire)', '1113990'],
    ['Date relevé début (dd/mm/yyyy)', null],
    ['Date relevé fin (dd/mm/yyyy)', null],
    ['Conso m³', null],
    ['Montant TTC € (optionnel)', '']
  ];
  const valeurs = [];
  for (let i = 0; i < prompts.length; i++) {
    const r = ui.prompt(prompts[i][0], prompts[i][1] ? '(défaut : ' + prompts[i][1] + ')' : '', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) { ui.alert('Annulé.'); return; }
    let v = String(r.getResponseText() || '').trim();
    if (!v && prompts[i][1]) v = prompts[i][1];
    valeurs.push(v);
  }
  const [dateFac, num, compte, dDeb, dFin, m3, ttc] = valeurs;
  const adresse = compte === KE_COMPTEUR_PROD ? '320 rue de la Marbrerie' :
                  compte === KE_COMPTEUR_SANIT ? '280 rue de la Marbrerie' : '?';
  const compteur = compte === KE_COMPTEUR_PROD ? 'I20JE011634' : '';
  const dDebD = keParseDate_(dDeb);
  const dFinD = keParseDate_(dFin);
  const dFacD = keParseDate_(dateFac);
  if (!dDebD || !dFinD || !dFacD || !m3) {
    ui.alert('❌ Dates ou conso manquantes / invalides.');
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(KE_ONGLET) || keInitOnglet_();
  // Trouver la 1ère ligne vide en zone 1
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1 || 1, KE_HEADERS_ZONE1.length).getValues();
  let nbZ1 = 0;
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0] && !data[i][1] && !data[i][7]) break;
    nbZ1++;
  }
  const row = 2 + nbZ1;
  sheet.getRange(row, 1, 1, KE_HEADERS_ZONE1.length).setValues([[
    dFacD, num, compte, adresse, compteur,
    dDebD, dFinD, parseFloat(m3), parseFloat(ttc) || '', ''
  ]]);
  sheet.getRange(row, 1, 1, 1).setNumberFormat('dd/mm/yyyy');
  sheet.getRange(row, 6, 1, 2).setNumberFormat('dd/mm/yyyy');
  sheet.getRange(row, 8, 1, 1).setNumberFormat('#,##0 "m³"');
  if (ttc) sheet.getRange(row, 9, 1, 1).setNumberFormat('#,##0.00 "€"');
  ui.alert('✅ Facture ajoutée ligne ' + row + '.\n\nLance "🔄 Actualiser KPI Énergie" pour recalculer les ratios.');
}

// ------------------------------------------------------------
//  PREVIEW
// ------------------------------------------------------------
function previewKPIEnergie() {
  const ui = SpreadsheetApp.getUi();
  try {
    keInitOnglet_();
    const r = keCalculerEtEcrire_();
    const dernier = r.lignesZ2.length > 0 ? r.lignesZ2[r.lignesZ2.length - 1] : null;
    let msg = 'KPI Énergie — Ratio Eau (L/L bière)\n\n';
    msg += 'Ratio moyen 12M : ' + r.ratioMoyen12M.toFixed(2) + ' L/L  ' + keStatut_(r.ratioMoyen12M) + '\n';
    msg += '(Total eau ' + Math.round(r.totalEau12M / 1000) + ' m³ / Bière ' + Math.round(r.totalBiere12M / 100) + ' HL)\n\n';
    if (dernier) {
      msg += 'Dernier mois : ' + keMoisLabel_(dernier.mois) + '\n';
      msg += '  Eau : ' + Math.round(dernier.m3) + ' m³  |  Bière : ' + dernier.volHL.toFixed(1) + ' HL\n';
      msg += '  Ratio : ' + dernier.ratio.toFixed(2) + ' L/L  ' + dernier.statut + '\n\n';
    }
    msg += 'Benchmark craft : ' + KE_BENCH_CRAFT_MIN + '-' + KE_BENCH_CRAFT_MAX + ' L/L\n';
    msg += 'Benchmark indus : ' + KE_BENCH_INDUS_MIN + '-' + KE_BENCH_INDUS_MAX + ' L/L';
    ui.alert(msg);
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

// ------------------------------------------------------------
//  DATA POUR WEBAPP DASHBOARD
// ------------------------------------------------------------
function getKPIEnergieData_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(KE_ONGLET);
    if (!sheet) return { dispo: false, raison: 'Onglet ENERGIE inexistant — menu V18 → Actualiser' };

    // Recalcul à la volée (lightweight) — on lit factures + volume bière
    const factures = keLireFactures_();
    const facturesProd = factures.filter(f => f.compte === KE_COMPTEUR_PROD);
    if (facturesProd.length === 0) return { dispo: false, raison: 'Aucune facture production saisie' };

    const consoParMois = {};
    facturesProd.forEach(f => {
      const proratas = keProratiserParMois_(f.dateDebut, f.dateFin, f.consoM3);
      Object.keys(proratas).forEach(k => { consoParMois[k] = (consoParMois[k] || 0) + proratas[k]; });
    });
    const volBiereParMois = keLireVolBiereParMois_();
    const moisOnt = Object.keys(consoParMois).sort();
    const lignes = moisOnt.map(k => {
      const m3 = consoParMois[k];
      const volHL = volBiereParMois[k] || 0;
      const ratio = volHL > 0 ? (m3 * 1000) / (volHL * 100) : 0;
      return { mois: k, m3: m3, volHL: volHL, ratio: ratio };
    });

    // Synthèse 12M
    const aujourd = new Date();
    const il12mois = new Date(aujourd.getFullYear(), aujourd.getMonth() - 12, 1);
    const lignes12M = lignes.filter(l => {
      const p = l.mois.split('-');
      return new Date(parseInt(p[0],10), parseInt(p[1],10)-1, 1) >= il12mois;
    });
    const eau12M = lignes12M.reduce((a, l) => a + l.m3 * 1000, 0);
    const biere12M = lignes12M.reduce((a, l) => a + l.volHL * 100, 0);
    const ratio12M = biere12M > 0 ? eau12M / biere12M : 0;

    const dernier = lignes.length > 0 ? lignes[lignes.length - 1] : null;
    return {
      dispo: true,
      ratio12M: ratio12M,
      eau12M_m3: eau12M / 1000,
      biere12M_HL: biere12M / 100,
      nbMois12M: lignes12M.length,
      benchCraftMin: KE_BENCH_CRAFT_MIN,
      benchCraftMax: KE_BENCH_CRAFT_MAX,
      benchIndusMin: KE_BENCH_INDUS_MIN,
      benchIndusMax: KE_BENCH_INDUS_MAX,
      dernier: dernier,
      lignes: lignes.slice(-12)
    };
  } catch (e) {
    Logger.log('[V18] getKPIEnergieData_ KO : ' + e.message);
    return { dispo: false, raison: e.message };
  }
}

// ------------------------------------------------------------
//  TRIGGER AUTO
// ------------------------------------------------------------
function actualiserKPIEnergieAuto() {
  try {
    keInitOnglet_();
    keCalculerEtEcrire_();
    Logger.log('[V18-AUTO] OK');
  } catch (e) { Logger.log('[V18-AUTO] ❌ ' + e.message); }
}

function activerKPIEnergieAuto() {
  desactiverKPIEnergieAuto_();
  ScriptApp.newTrigger('actualiserKPIEnergieAuto')
    .timeBased().onMonthDay(1).atHour(4).create();
  SpreadsheetApp.getUi().alert('✅ Trigger V18 activé.\n\nRecalcul auto le 1er de chaque mois à 4h du matin.');
}

function desactiverKPIEnergieAuto() {
  const n = desactiverKPIEnergieAuto_();
  SpreadsheetApp.getUi().alert('✅ ' + n + ' trigger(s) V18 supprimé(s).');
}

function desactiverKPIEnergieAuto_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'actualiserKPIEnergieAuto') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

// ------------------------------------------------------------
//  MENU V18 — à appeler depuis onOpen() de Easybeer_Sync.gs
//  Ajouter dans onOpen() : setupMenuV18_(menu);
// ------------------------------------------------------------
function setupMenuV18_(menu) {
  const ui = SpreadsheetApp.getUi();
  menu.addSubMenu(
    ui.createMenu('💧 V18 KPI Énergie — Ratio Eau')
      .addItem('👁️  Preview KPI Énergie',              'previewKPIEnergie')
      .addItem('🔄 Actualiser KPI Énergie',             'actualiserKPIEnergie')
      .addItem('➕ Ajouter une facture eau',            'ajouterFactureEnergie')
      .addSeparator()
      .addItem('🟢 Activer auto (1er du mois 4h)',      'activerKPIEnergieAuto')
      .addItem('🔴 Désactiver auto',                     'desactiverKPIEnergieAuto')
  );
}
