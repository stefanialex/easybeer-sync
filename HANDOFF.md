# HANDOFF — Projet Dashboard Production Brasserie Prizm

_Dernière mise à jour : 30 juin 2026 — après livraison V17 + V18_

Ce document sert à briefer une nouvelle conversation Claude sur l'état du projet.
Lis-le en entier avant de commencer.

---

## 1. Contexte

- **Brasserie** : SAS Liquid Art Brewing (marque commerciale « PRIZM » et « VNDL »).
- **Adresse** : 280 & 320 rue de la Marbrerie, 34740 Vendargues.
- **Utilisateur principal** : Alexandre Stefani (`alexandre@prizmbrewing.com`).
- **Patron** : Julien (destinataire final des KPI dashboard).
- **Équipe production** : Rachel Copas, Matthieu Pillot, Antoine Kerrec.
- **Autres personnes citées** : Maxime (compta), Olivier (ops), Clémence (prod mensuel).

Le projet vise à automatiser le suivi production, stocks, coûts, énergie et sécurité
à partir de l'ERP brassicole **Easybeer** + factures fournisseurs + outils internes.

---

## 2. Préférences de communication d'Alex

À respecter dans toutes les réponses :

- Être direct, donner un avis contradictoire honnête.
- Ne jamais inventer ; vérifier et citer les sources.
- Quand Alex expose une idée : commencer par les **arguments contre**, biais, risques et
  hypothèses fragiles. Ensuite seulement présenter ce qui est solide.
- **Ne pas utiliser le mot « cash »** (Alex l'a explicitement banni).
- Toujours livrer les fichiers **complets**, pas des snippets partiels.
- Secrets : jamais en dur dans le code — stockage via `PropertiesService`.
- Format des réponses : prose naturelle, tableaux quand vraiment utile, minimum de bullet points.

---

## 3. Architecture technique

### 3.1 Stack
- **Google Apps Script** (V8) — orchestration, sync, calculs.
- **clasp** — synchronisation locale ↔ Apps Script.
- **Repo Git** : `stefanialex/easybeer-sync` sur GitHub (branche `main`).
- **Google Sheets** hébergeant le dashboard + HISTORIQUE_KPI + onglets métiers.
- **Web App HTML** déployée depuis Apps Script (Chart.js + Tailwind + JS vanilla).
- **MCP Easybeer** (JSON-RPC 2.0, read-only) pour requêter l'ERP.

### 3.2 Chemins locaux (Windows)
- Repo local : `C:\Users\Alex PRIZM\Documents\Easybeer-AppsScript\`
- Working dir Claude scratchpad : `C:\Users\Alex PRIZM\AppData\Roaming\Claude\...\outputs\`
- Downloads (mount visible côté Claude) : `C:\Users\Alex PRIZM\Downloads\`

### 3.3 Fichiers Apps Script (dans le repo)

| Fichier | Rôle |
|---|---|
| `00_config.js` | Endpoints Easybeer, credentials via `PropertiesService`, `getAuthHeader_()` |
| `01_easybeerClient.js` | Client Easybeer bas niveau (auth + retry) |
| `02_kpiMensuels.js` | Calcul KPI mensuels et écriture `KPI_MENSUELS` |
| `03_syncIncremental.js` | Sync incrémentale Easybeer → sheet |
| `04_stocksPF.js` | V12 — Sync stocks produits finis (rotation + DLUO) |
| `05_alertesSlackStocks.js` | V13 — Alertes Slack lots fantômes lundi 9h |
| `06_rapportProductionClemence.js` | V16 — Rapport prod mensuel Slack à Clémence (25 du mois 9h) |
| `07_etatCaveMensuel.js` | V15 — État de cave mensuel → brouillon Gmail à Antoine (dernier jour 17h) |
| `08_kpiTempsSortie.js` | **V17** — KPI Temps de sortie COM/PREF/ESPLA |
| `09_kpiEnergie.js` | **V18** — KPI Niveau 3 Ratio Eau (L/L) depuis factures Régie des Eaux |
| `Easybeer_Sync.js` | Fichier principal (`onOpen()`, pipeline, `doGet()` webapp, orchestration) |
| `dashboard.html` | Web App HTML (Tailwind + Chart.js + JS render) |
| `dashboard.md` | Documentation historique du projet |
| `HANDOFF.md` | **Ce fichier** |
| `appsscript.json` | Manifest Apps Script |
| `.clasp.json` | Config clasp (scriptId lié à Apps Script) |

### 3.4 Sheets Google (IDs importants)

- **HISTORIQUE_KPI** (dashboard sheet principal) — ID à récupérer via `SpreadsheetApp.getActiveSpreadsheet()`.
  - Onglets : `HISTORIQUE_KPI`, `KPI_MENSUELS`, `Dashboard`, `ETAT_CAVE_MENSUEL`,
    `KPI_TEMPS_SORTIE` (V17), `ENERGIE` (V18), `QUALITE`, `SECURITE`, `AUDIT_PIPELINE`,
    `ALERTES_FANTOMES_HISTO`, `STOCK_PF`.
- **Coûts Montaner** : `1RBOwnyjzFztVAr4Vu0neVN8tV_LgdTlNwzWFri8oWbc`
  (utilisé par V15 pour le coût revient — plus utilisé activement mais référence conservée).
- **Prévisionnel Production** : `1EIkY-3v0WXXjyjzIxdCIuBZwWIAKhbiucdZjXtD6eQs`
  (planning brassage, non modifié par le script — utilisé pour référence).

### 3.5 Script Properties (secrets)

Configurés via `Projet → Paramètres → Propriétés du script` :

- `EASYBEER_USER` — identifiant Easybeer.
- `EASYBEER_PASS` — mot de passe Easybeer.
- `EASYBEER_MCP_TOKEN` — token MCP Easybeer (lecture seule) partagé V15/V17.
- `SLACK_BOT_TOKEN` — token bot Slack (V13, V16).

**Ne jamais mettre ces valeurs en dur dans le code.**

### 3.6 IDs Slack (canaux + users)

- Canal `#production` : ID à récupérer dans le code V13/V16.
- Users Slack :
  - Alex : `U06DW4718N6`
  - Olivier : `U03ULDQ9AN6`
  - Maxime : `U093MADS3K5`
  - Clémence : `U08TUHS1DRN` (V16)
  - Antoine : `U028AM1MRHD` (V15)

---

## 4. Ce qui est livré (V12 → V18)

### V12 — Sync stocks PF (nuit 1h)
- Lit stocks Easybeer, calcule rotation + DLUO consommée par lot.
- Top 10 alertes DLUO > 30% affiché webapp.
- Trigger automatique 1h du matin.

### V13 — Alertes Slack lots fantômes
- Détecte les lots avec écart stock vs Easybeer.
- Envoi Slack lundi 9h à Alex + Maxime + Olivier.
- Historique dans onglet `ALERTES_FANTOMES_HISTO`.

### V15 — État de cave mensuel
- MCP Easybeer `search_brassins(etats:['EN_COURS'])` + `get_planning_brassage_materiel`.
- Croisement cuves ↔ brassins actifs.
- Génère brouillon Gmail à Antoine (BCC Alex) le dernier jour du mois à 17h.
- Snapshot dans onglet `ETAT_CAVE_MENSUEL`.

### V16 — Rapport production mensuel Slack à Clémence
- KPI production consolidés (hL brassés, condi, occupation cuves, rendement).
- Slack DM à Clémence le 25 du mois à 9h.
- Statut ⏳ pour le mois courant si pas fini (rendement non calculable).
- Format « 16 (4 arch) » = 16 brassins totaux dont 4 archivés.

### V17 — KPI Temps de sortie COM / PREF / ESPLA
- Fichier : `08_kpiTempsSortie.js`.
- **Objectifs validés Alex 30/06/2026** : COM 12j, PREF 17j, ESPLA 12j (best perf 2025+2026 + 2j de marge).
- OK si durée ≤ objectif (égalité = OK).
- Marques classifiées : LA COM (Lager 4.5%), LA PREF (IPA 5.5%), L'ESPLA (Witbier 4.5%).
  Se Canto rattaché à la marque parente selon le style. **CORUM ≠ COM** (garde-fou explicite).
- Périmètre : brassins TERMINE année 2026 (extensible via `KTS_ANNEES`).
- Onglet `KPI_TEMPS_SORTIE` avec mise en forme conditionnelle vert/rouge.
- Affichage webapp : bloc niveau 2 avec 3 tiles (% par marque, cumul + 3 derniers mois)
  et détail collapsible (bouton toggle) par lot.
- Trigger auto 3h du matin.

### V18 — KPI Niveau 3 Ratio Eau (L/L bière)
- Fichier : `09_kpiEnergie.js`.
- **Compteur production identifié** : `1113990` (320 rue de la Marbrerie, compteur `I20JE011634`, 40 mm).
  Le compte `1024201` (280 rue, 15 mm, sanitaire) est **exclu** du KPI.
- **Volume bière** = conditionné (agrégé depuis HISTORIQUE_KPI colonne `Vol. Condi (HL)`).
- Prorata journalier des m³ par mois sur la période facturée.
- Benchmarks : craft 6-8 L/L, industriel 3-4 L/L.
- Structure onglet `ENERGIE` en 3 zones :
  - **Zone 1** : Saisie factures (10 colonnes, pré-remplie avec 4 factures historiques).
  - **Zone 2** : Conso mensuelle m³ + Vol bière + Ratio + Statut.
  - **Zone 3** : Synthèse 12 mois glissants.
- Menu V18 avec `ajouterFactureEnergie` (prompt UI pour saisie nouvelle facture).
- Trigger auto 1er du mois 4h.
- Card webapp NIVEAU 3 passe de 🟡 EN ATTENTE à ✅ DISPO.

### Factures eau pré-remplies (V18)

| N° facture | Période | m³ | Montant TTC |
|---|---|---|---|
| 3524911 | 03/04/2024 → 26/09/2024 | 2 527 | 9 314,27 € |
| 3990378 | 26/09/2024 → 16/04/2025 | 2 635 | 9 656,83 € |
| 4250270 | 16/04/2025 → 06/10/2025 | 2 743 | 10 190,44 € |
| 4728598 | 06/10/2025 → 16/04/2026 | 3 703 | 6 639,49 € (indicatif) |

Toutes ces factures viennent de la Régie des Eaux Montpellier Méditerranée Métropole.

---

## 5. Décisions clés à ne pas oublier

- **CORUM ≠ COM** : deux marques distinctes. CORUM = Ambrée d'été 5% ; COM = La Com Lager Blonde 4.5%.
- **Se Canto** est une sous-marque : Se Canto IPA → rattaché à PREF, Se Canto Lager → COM, Se Canto Witbier → ESPLA.
- **Objectifs V17** ne se recalculent pas dynamiquement — ils sont hard-codés dans `KTS_OBJECTIFS`.
  À revoir manuellement si Alex met à jour les cibles.
- **Compteur eau production** = 1113990 uniquement (le 1024201 sert aux sanitaires/bureaux).
- **Filtre 30 HL Flop 5** : fait (20/07/2026) — `FLOP5_MIN_HL = 30` dans `getKPIsWebApp()`,
  les batches pilotes < 30 HL brassés sont exclus du Flop 5 (#52 closed).
- **Précision flottante ≥ 88%** : correction déjà appliquée avec `Math.round(rdt * 1000) / 1000`.
- **Bug "février 7445"** (lot Nolo parsé en Date par Sheets) : fixé en forçant format texte
  sur la colonne Lot d'HISTORIQUE_KPI. Voir #55.

---

## 6. Prochains chantiers

### #42 — V14 : DLUO consommée à expédition
Remplacer le proxy stock actuel par la vraie DLUO à la date d'expédition client.
Source : Easybeer `/commande/detail` + `dateDepartLivraison`.

### #59 — V19 : Registre Incidents & TF1 — PARTIE BOT FAITE (20/07/2026)
- **Fait** : saisie via bot Telegram Belzebrew — `/securite <récit libre>` (extraction Gemini
  + validation boutons) écrit dans l'onglet sécurité du **Prévisionnel Production**
  (gid `187622832`, 20 colonnes, en-têtes auto). Module `securite.py` dans le repo
  `C:\Users\Alex PRIZM\prizm-bot\`. Déployé et testé OK le 20/07/2026.
- Décisions : registre officiel des accidents bénins tenu **au format papier**
  (visas victime + donneur de soins) ; le sheet = data interne + TF1.
  5 catégories : accident avec arrêt / sans arrêt avec soins / bénin / presqu'accident /
  situation dangereuse. Rappels légaux auto (CPAM 48h, report registre papier).
- **Fait aussi (20/07/2026, partie Apps Script)** : `10_kpiSecurite.js` —
  `getKPISecuriteData_()` (comptages mois/cumul/12M, jours sans accident, alertes
  CPAM non déclarée et bénins non reportés au registre papier), menu `🦺 V19`,
  injection `kpiSecurite` dans `getKPIsWebApp()`, card NIVEAU 1 dynamique dans
  `dashboard.html` (`renderSecurite`), roadmap + footer à jour.
  **Reste** : TF1 chiffré dès que les heures travaillées arrivent (migration RH),
  et TF2 si souhaité. Déploiement : `clasp push` + nouvelle version webapp.

### V18.1 — Automatisation Énergie
- Forward mail Régie des Eaux → parsing PDF auto (parser texte, fallback OCR).
- Ou intégration API Pennylane si dispo.

### Tasks pending

- **#42** V14 DLUO expédition — désormais faisable proprement : le MCP EasyBeer est
  connecté à Claude (search_commandes / get_commande dispo).
- **#48** Debrief Julien — chiffres dashboard à vérifier
- **#54** Migration routines Claude Code → Google Apps Script
- ~~#52 Filtre Flop 5~~ — fait 20/07/2026
- ~~#59 V19 Registre Incidents~~ — fait 20/07/2026 (bot + Apps Script + webapp ; TF1 chiffré en attente heures RH)

---

## 7. Comment reprendre une session

### 7.1 Étapes standard
1. **Lire ce fichier `HANDOFF.md` en entier.**
2. Lire `dashboard.md` pour l'historique long.
3. Vérifier `git log --oneline -20` dans le repo pour les derniers commits.
4. `clasp status` pour voir si le local et Apps Script sont synchro.
5. Consulter la task list pour les items pending.

### 7.2 Workflow de dev
```powershell
cd "C:\Users\Alex PRIZM\Documents\Easybeer-AppsScript"
# Édition locale
clasp push                                # push vers Apps Script
# Test dans le sheet (menu Easybeer)
git add <fichiers modifiés>
git commit -m "message"
git push origin main
```

### 7.3 Déploiement webapp
Après un changement de `dashboard.html` ou du backend `doGet()` :
Apps Script → Déployer → Gérer les déploiements → ✏️ → **Nouvelle version** → Déployer.
L'URL webapp est accessible via le menu Easybeer → 🌐 URL du dashboard web.

### 7.4 Menus dans le sheet
Menu principal `🍺 Easybeer` avec sous-menus :
- Pipeline principal
- ⚙️ Avancé (sync manuel, rattrapages, debug)
- 🏭 V15 État de cave mensuel
- 📊 V16 Rapport prod Clémence
- 🚨 V13 Alertes Slack stocks
- ⏱️ V17 Temps sortie COM/PREF/ESPLA
- 💧 V18 KPI Énergie — Ratio Eau

---

## 8. Ce qui a été fait le 30 juin 2026 (session la plus récente)

- Livraison **V17** (Temps de sortie COM/PREF/ESPLA).
  Migration du bloc de la section « Top 5 brassins » vers NIVEAU 2 Performance opérationnelle.
- Livraison **V18** (Ratio Eau) : lecture des 6 PDF factures eau, identification compteur production,
  pré-remplissage 4 factures historiques, calcul prorata + ratio 12M.
- Refonte **Section H** du dashboard sheet : 2026 (gauche) ⇄ 2025 (droite) aligné par style, avec bloc
  styles 2025-only en bas.
- Fix bug **lot Nolo « février 7445 »** : forçage format texte `@` sur la colonne Lot
  d'HISTORIQUE_KPI et du tableau « Brassins en cours longs ».
- Mise à jour de la roadmap webapp : V17 + V18 dans « Livrés », V18.1 dans « À venir »,
  ligne « Audit durées fermentation » retirée du « Process à mettre en place » (couverte par V17).
- Création de ce fichier `HANDOFF.md`.

Fin de session : « demain on attaque le truc pour les accidents et presque accidents » → V19.

---

## 9. Notes techniques utiles

- Les réponses MCP Easybeer trop volumineuses sont sauvegardées automatiquement en fichier
  dans `.claude/projects/.../tool-results/`. Utiliser `bash` + `python3` + `grep` pour parser
  ces fichiers plutôt que réessayer le call MCP.
- `search_brassins` MCP renvoie déjà `dateDebutBrassage` et `dateConditionnement`, pas besoin
  d'appeler `get_brassin` juste pour les durées de sortie.
- `dateConditionnement` du search_brassins ≈ `dateMiseEnBouteille` — pour la « 1ère prod » exacte,
  il faut `min(productions.date)` via `get_brassin`, mais l'écart est en heures, pas en jours.
- Format `MOIS_FR` défini globalement dans `Easybeer_Sync.js` pour éviter les labels en anglais.
- `MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"]`.
- Le `onOpen()` liste tous les `setupMenuV*_(menu)` — quand tu ajoutes une V, penser à brancher
  le menu dans ce `onOpen()`.
- Le `getKPIsWebApp()` retourne un objet enrichi. Ajouter une V nécessite d'y injecter le résultat
  de `getKPI<Nom>Data_()` avec un fallback `null` si la fonction n'existe pas.

---

## 10. Bloqueurs externes connus

- **Gurubeer** — pas d'API ni export publiquement documenté.
  Bloque : Taux retour / réclamation (Niveau 2) + Batch RFT.
- **Raccordement FV80** — 2 fermenteurs 80 HL en attente de raccord groupe froid.
  CAPEX estimé 10-15k€. Débloque le scénario Sc3 à 11 références.
- **Heures travaillées (TF1)** — la RH annonce une **migration d'Eurécia vers un autre
  logiciel** (juillet 2026) → intégration en pause, wait and see. Guide de connexion
  API Eurécia rédigé au cas où : `C:\Users\Alex PRIZM\prizm-bot\EURECIA_API.md`
  (auth 2 temps, endpoints, calcul heures théoriques − absences). Critère à pousser
  auprès de la RH pour le nouveau soft : API REST ouverte et documentée.

---

## Fin du fichier

Pour toute nouvelle conversation, commence par lire ce document puis dis-moi :
« J'ai lu le HANDOFF, on continue sur … » avec le chantier que tu veux attaquer.
