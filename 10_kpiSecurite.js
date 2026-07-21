// ============================================================
// V19 — KPI SÉCURITÉ : registre incidents & TF1 (Niveau 1)
// ============================================================
// Source : onglet sécurité du classeur (gid KS_GID), alimenté par le
// bot Telegram Belzebrew via /securite (module securite.py, prizm-bot).
// Structure : 1 ligne = 1 événement, 20 colonnes (voir KS_COL_*).
//
// TF1 = (accidents avec arrêt × 1 000 000) / heures travaillées.
// Les heures travaillées ne sont pas encore disponibles (migration du
// logiciel RH en cours — ex-Eurécia). Tant qu'elles manquent, le module
// remonte les comptages et laisse tf1 = null.
//
// Le registre OFFICIEL des accidents bénins est tenu au format papier
// (visas victime + donneur de soins) — cet onglet est le suivi data interne.
// ============================================================

const KS_GID = 187622832;           // gid de l'onglet sécurité
const KS_NB_COLS = 20;

// Index colonnes (0-based) — structure écrite par le bot
const KS_COL_ID = 0, KS_COL_HORODATAGE = 1, KS_COL_SAISI_PAR = 2, KS_COL_TYPE = 3,
      KS_COL_DATE = 4, KS_COL_HEURE = 5, KS_COL_VICTIME = 6, KS_COL_FONCTION = 7,
      KS_COL_LIEU = 8, KS_COL_CIRCONSTANCES = 9, KS_COL_LESION = 10, KS_COL_SIEGE = 11,
      KS_COL_TEMOINS = 12, KS_COL_SOINS_PAR = 13, KS_COL_JOURS_ARRET = 14,
      KS_COL_CPAM = 15, KS_COL_DATE_CPAM = 16, KS_COL_REGISTRE_PAPIER = 17,
      KS_COL_ACTION = 18, KS_COL_STATUT = 19;

// Libellés types écrits par le bot (securite.py TYPES_VALIDES)
const KS_TYPES = {
  ARRET:      'Accident avec arrêt',
  SANS_ARRET: 'Accident sans arrêt (avec soins)',
  BENIN:      'Accident bénin (sans soins, sans arrêt)',
  PRESQU:     "Presqu'accident",
  DANGER:     'Situation dangereuse'
};

// ------------------------------------------------------------
// Lecture
// ------------------------------------------------------------

function ksGetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const byGid = ss.getSheets().filter(s => s.getSheetId() === KS_GID);
  if (byGid.length) return byGid[0];
  // Fallback par nom si le gid a changé (copie de classeur, etc.)
  return ss.getSheets().filter(s => /s[ée]curit[ée]/i.test(s.getName()))[0] || null;
}

function ksClasserType_(libelle) {
  const l = String(libelle || '').toLowerCase();
  if (l.indexOf('avec arrêt') !== -1 || l.indexOf('avec arret') !== -1) return 'arret';
  if (l.indexOf('sans arrêt') !== -1 || l.indexOf('sans arret') !== -1) return 'sansArret';
  if (l.indexOf('bénin') !== -1 || l.indexOf('benin') !== -1) return 'benin';
  if (l.indexOf('presqu') !== -1) return 'presqu';
  if (l.indexOf('dangereuse') !== -1) return 'danger';
  return 'autre';
}

function ksParseDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
  return null;
}

function ksLireEvenements_() {
  const sheet = ksGetSheet_();
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, KS_NB_COLS).getValues();
  const evts = [];
  values.forEach(r => {
    if (!String(r[KS_COL_ID]).trim()) return;
    const d = ksParseDate_(r[KS_COL_DATE]) || ksParseDate_(r[KS_COL_HORODATAGE]);
    if (!d) return;
    evts.push({
      id: r[KS_COL_ID],
      date: d,
      moisCle: Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM'),
      classe: ksClasserType_(r[KS_COL_TYPE]),
      typeLibelle: String(r[KS_COL_TYPE] || ''),
      lieu: String(r[KS_COL_LIEU] || ''),
      joursArret: parseInt(r[KS_COL_JOURS_ARRET], 10) || 0,
      cpam: ['OUI', 'O', 'YES'].indexOf(String(r[KS_COL_CPAM] || '').trim().toUpperCase()) !== -1,
      registrePapier: ['OUI', 'O', 'YES'].indexOf(String(r[KS_COL_REGISTRE_PAPIER] || '').trim().toUpperCase()) !== -1,
      statut: String(r[KS_COL_STATUT] || '')
    });
  });
  return evts;
}

function ksCompteurs_() {
  return { arret: 0, sansArret: 0, benin: 0, presqu: 0, danger: 0, autre: 0, total: 0 };
}

// ------------------------------------------------------------
// KPI pour la webapp
// ------------------------------------------------------------

function getKPISecuriteData_() {
  try {
    const evts = ksLireEvenements_();
    if (evts === null) return { dispo: false, raison: 'Onglet sécurité introuvable (gid ' + KS_GID + ')' };

    const now = new Date();
    const moisCle = Utilities.formatDate(now, 'Europe/Paris', 'yyyy-MM');
    const annee = now.getFullYear();

    const mois = ksCompteurs_();
    const cumul = ksCompteurs_();
    const histo = {};   // moisCle → compteurs (12 derniers mois)
    let dernierAccident = null;   // arret / sansArret / benin
    let joursArretCumul = 0;
    let nonClotures = 0;
    let beninsNonReportes = 0;
    let accidentsNonDeclares = 0;

    evts.forEach(e => {
      const isAccident = (e.classe === 'arret' || e.classe === 'sansArret' || e.classe === 'benin');
      if (e.moisCle === moisCle) { mois[e.classe] = (mois[e.classe] || 0) + 1; mois.total++; }
      if (e.date.getFullYear() === annee) {
        cumul[e.classe] = (cumul[e.classe] || 0) + 1; cumul.total++;
        joursArretCumul += (e.classe === 'arret') ? e.joursArret : 0;
        if (e.classe === 'benin' && !e.registrePapier) beninsNonReportes++;
        if ((e.classe === 'arret' || e.classe === 'sansArret') && !e.cpam) accidentsNonDeclares++;
      }
      if (isAccident && (!dernierAccident || e.date > dernierAccident)) dernierAccident = e.date;
      if (e.statut && e.statut.toUpperCase() === 'OUVERT') nonClotures++;
      if (!histo[e.moisCle]) histo[e.moisCle] = ksCompteurs_();
      histo[e.moisCle][e.classe] = (histo[e.moisCle][e.classe] || 0) + 1;
      histo[e.moisCle].total++;
    });

    const joursSansAccident = dernierAccident
      ? Math.floor((now - dernierAccident) / 86400000)
      : null;   // null = aucun accident enregistré depuis l'ouverture du registre

    const histo12M = Object.keys(histo).sort().slice(-12)
      .map(k => Object.assign({ mois: k }, histo[k]));

    return {
      dispo: true,
      moisLabel: (typeof MOIS_FR !== 'undefined' ? MOIS_FR[now.getMonth()] : moisCle) + ' ' + annee,
      mois: mois,
      cumulAnnee: cumul,
      annee: annee,
      joursSansAccident: joursSansAccident,
      joursArretCumul: joursArretCumul,
      nonClotures: nonClotures,
      beninsNonReportes: beninsNonReportes,
      accidentsNonDeclares: accidentsNonDeclares,
      histo12M: histo12M,
      tf1: null,                      // en attente heures travaillées
      tf1Statut: 'EN_ATTENTE_HEURES', // migration logiciel RH (ex-Eurécia)
      nbEvenements: evts.length
    };
  } catch (e) {
    return { dispo: false, raison: String(e) };
  }
}

// ------------------------------------------------------------
// Menu V19
// ------------------------------------------------------------

function setupMenuV19_(menu) {
  const sub = SpreadsheetApp.getUi().createMenu('🦺 V19 Sécurité — Incidents & TF1')
    .addItem('👁️ Aperçu KPI sécurité', 'afficherApercuSecurite')
    .addItem('ℹ️ Comment saisir un événement', 'afficherAideSecurite');
  menu.addSubMenu(sub);
}

function afficherApercuSecurite() {
  const d = getKPISecuriteData_();
  const ui = SpreadsheetApp.getUi();
  if (!d.dispo) { ui.alert('V19 Sécurité', 'Indisponible : ' + d.raison, ui.ButtonSet.OK); return; }
  const lignes = [
    '📅 ' + d.moisLabel,
    '',
    'Mois courant : ' + d.mois.total + ' événement(s)',
    '  • Avec arrêt : ' + d.mois.arret + '   • Sans arrêt : ' + d.mois.sansArret + '   • Bénins : ' + d.mois.benin,
    '  • Presqu\'accidents : ' + d.mois.presqu + '   • Situations dangereuses : ' + d.mois.danger,
    '',
    'Cumul ' + d.annee + ' : ' + d.cumulAnnee.total + ' événement(s) — ' + d.joursArretCumul + ' jour(s) d\'arrêt',
    'Jours sans accident : ' + (d.joursSansAccident === null ? 'aucun accident enregistré 🎉' : d.joursSansAccident),
    'TF1 : en attente heures travaillées (migration logiciel RH)',
    '',
    (d.accidentsNonDeclares > 0 ? '⚠️ ' + d.accidentsNonDeclares + ' accident(s) avec soins/arrêt sans déclaration CPAM cochée !' : '✅ Déclarations CPAM à jour'),
    (d.beninsNonReportes > 0 ? '⚠️ ' + d.beninsNonReportes + ' bénin(s) non reporté(s) au registre papier' : '✅ Registre papier à jour'),
    (d.nonClotures > 0 ? '🔶 ' + d.nonClotures + ' événement(s) encore ouvert(s)' : '✅ Tous les événements sont clôturés')
  ];
  ui.alert('🦺 V19 — KPI Sécurité', lignes.join('\n'), ui.ButtonSet.OK);
}

function afficherAideSecurite() {
  SpreadsheetApp.getUi().alert('🦺 V19 — Saisie des événements',
    'La saisie se fait par Telegram avec le bot Belzebrew :\n\n' +
    '/securite <récit libre>\n' +
    'Ex : /securite Matthieu s\'est coupé la main gauche ce matin au conditionnement, pansement par Rachel, pas d\'arrêt\n\n' +
    'Le bot structure le signalement, te montre un récap et écrit ici après validation.\n' +
    '/incidents pour voir les derniers signalements.\n\n' +
    'Rappels : accident avec soins/arrêt → déclaration CPAM sous 48h.\n' +
    'Accident bénin → report au registre papier (visas victime + donneur de soins).\n' +
    'Colonnes "Déclaré CPAM" et "Reporté registre papier" à tenir à jour dans cet onglet.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
