# Tableau de bord production — Brasserie Liquid Art / Prizm Brewing Co

> **Version actuelle : V13** — État au 7 juin 2026

---

## 🎯 Objectif du projet

Centraliser et automatiser le suivi de la production brassicole de la Brasserie Liquid Art (marque commerciale : Prizm Brewing Co) en exploitant les données du logiciel Easybeer via son API. Le projet remplace les tableaux Excel manuels et fournit une vue temps-réel des KPI, des stocks et des alertes opérationnelles.

---

## 🔗 Accès et liens

### Dashboard web (consultation KPI)
URL publique restreinte au domaine `@prizmbrewing.com` :
```
https://script.google.com/a/macros/prizmbrewing.com/s/AKfycbxv5XzpYqcUfo2cy9Ix6Sn-Itrm0VekGHboc-oXKjX-PiGo3EGoLGdr5rRDUs1MIDAYmA/exec
```

### Code source (GitHub)
Repo privé propriété du compte GitHub `stefanialex` :
```
https://github.com/stefanialex/easybeer-sync
```

### Backend Apps Script
Projet Google Apps Script lié au Sheet "Prévisionnel Production" :
```
https://script.google.com/u/0/home/projects/1B3GzM4xAcW_MXmHHCWRibHpDTLRTAM6iV-HMdMTojMQxdTG7vbFvrtRc/edit
```

Script ID : `1B3GzM4xAcW_MXmHHCWRibHpDTLRTAM6iV-HMdMTojMQxdTG7vbFvrtRc`

### Sheet Google "Prévisionnel Production"
Base de données alimentée par les scripts. Onglets clés :
- `HISTORIQUE_KPI` — un brassin par ligne, tous les KPI calculés
- `STOCK_PF` — snapshot stocks produits finis avec lots, DLUO, rotation
- `KPI_MENSUELS` — agrégats mensuels précalculés
- `ALERTES_FANTOMES_HISTO` — historique des alertes Slack V13
- `DASHBOARD` — version Sheet du dashboard (legacy, l'URL web HTML est préférée)
- `QUALITE`, `SECURITE`, `ENERGIE` — onglets à remplir manuellement (TF1, etc.)
- `Planning sortie 2024/2025/2026` — planning prévisionnel maintenu par Alex

### Workspace Slack (alertes)
Workspace : `prizmbrewingco.slack.com`. App Slack Bot dédiée : `Prizm Easybeer Sync`. Scopes : `chat:write`, `im:write`. Token Bot stocké en `PropertiesService` Apps Script sous la clé `SLACK_BOT_TOKEN` (chiffré côté Google, jamais exposé en clair).

Destinataires audit hebdo V13 :
- Alex : user ID Slack `U06DW4718N6`
- Olivier (responsable logistique) : `U03ULDQ9AN6`
- Maxime (DAF) : `U093MADS3K5`

### Dossier local de développement
Sur la machine d'Alex :
```
C:\Users\Alex PRIZM\Documents\Easybeer-AppsScript
```
Géré avec `clasp` pour synchronisation bidirectionnelle Apps Script ↔ local.

---

## 🏗️ Architecture technique

**Backend** : Google Apps Script (V8 runtime) — JavaScript ES6+ hébergé sur les serveurs Google, exécuté via triggers temporels ou requêtes web.

**Stockage** : Google Sheet "Prévisionnel Production" (multi-onglets). Pas de base de données externe. Sécurisé par les ACL Google Drive.

**Source de données** : API REST `api.easybeer.fr` (Basic Auth). Lecture seule — le projet n'écrit jamais dans Easybeer.

**Frontend** : Dashboard HTML servi par Apps Script `doGet()`. Stack : Tailwind CSS + Chart.js v4.4.0 via CDN. Utilise `google.script.run` pour les appels backend asynchrones.

**Notifications** : Slack Web API (`chat.postMessage`) appelée depuis Apps Script via `UrlFetchApp`. Token Bot stocké dans PropertiesService.

**Versioning** : Git + GitHub. Clasp (CLI Google) pour synchronisation Apps Script ↔ fichiers locaux `.js`/`.html`.

**Authentification** :
- Easybeer : Basic Auth (user/password stockés en PropertiesService sous `EASYBEER_USER` et `EASYBEER_PASS`)
- Slack : Bot Token OAuth (xoxb-…) stocké sous `SLACK_BOT_TOKEN`
- Google : OAuth utilisateur via clasp local (`~/.clasprc.json`)
- GitHub : Personal Access Token ou OAuth via Credential Manager Windows

---

## 📁 Fichiers du projet

`00_config.gs` — credentials Easybeer, constantes globales (noms onglets, seuils, taux). Fonction `getAuthHeader_()` retourne les headers Basic Auth.

`01_easybeerClient.gs` — client API Easybeer. Fonction `easybeerFetch_()` enveloppe `UrlFetchApp.fetch` avec gestion des erreurs, rate limiting, retry. Fonctions de haut niveau pour endpoints courants (brassins, stocks, commandes).

`02_kpiMensuels.gs` — calcul des KPI mensuels stockés (volume, marge, coût/HL, rendement, etc.). Écrit dans l'onglet `KPI_MENSUELS`. Appelé lors du sync nocturne.

`03_syncIncremental.gs` — sync incrémentale Easybeer → HISTORIQUE_KPI. Évite de re-fetcher l'intégralité des brassins à chaque exécution. Maintient un checkpoint en PropertiesService.

`04_stocksPF.gs` — V12. Sync stocks produits finis depuis Easybeer (`/stock/produits` niveau 4 CONTENANT). Calcule la rotation et la DLUO consommée. Détecte les ghost lots. Helper `isJourTravaille_()` (calendrier français 2025-2027).

`05_alertesSlackStocks.gs` — V13. Détection lots fantômes + envoi MP Slack hebdo. Trigger `auditLotsFantomesHebdo()` lundi 9h. Onglet `ALERTES_FANTOMES_HISTO` pour le state. Fonctions utilitaires (`previewLotsFantomesV13`, `bootstrapAlertesFantomesV13`, `lancerAuditTestAlexUniquementV13`, etc.) accessibles via menu Sheet.

`Easybeer_Sync.gs` — fichier principal (legacy + orchestration). Contient `onOpen()` (menu), `pipelineToutFaire`, `actualiserDashboard`, `doGet()` (web app), `etatCaveActuel()`, et de nombreuses helpers. ~2000 lignes — sera progressivement éclaté en modules.

`dashboard.html` — interface web. Structure : header avec menu mois/marque, sections KPI vitaux, KPI niveau 2-3, graphiques (Chart.js), top 10 alertes DLUO, roadmap. Appelle `getKPIsWebApp()` côté backend pour les données.

`appsscript.json` — manifest Apps Script (timezone Europe/Paris, scopes OAuth requis, web app config).

`.clasp.json` — config locale clasp (Script ID, root directory).

`.gitignore` — exclut `.clasprc.json` (credentials clasp), `.DS_Store`, `*.log`, `node_modules/`.

`dashboard.md` — ce document.

---

## 📊 Versions livrées

**V1 à V3** (mars-avril 2026) — récupération projet depuis un autre LLM, patches bugs, analyse HAR, exploration API Easybeer.

**V4** (avril 2026) — KPI mensuels stockés + Dashboard HTML filtrable.

**V5** — fixes dashboard (isArchive, sections D/F/H/J, bugs % repitch et coût).

**V6** — pipeline tout-en-un + trigger nuit auto.

**V7** — filtres interactifs dashboard, section C avec 2 volumes.

**V8** — colonne Nb Conditionnements, design graph J.

**V9** — Se Canto détail Fûts/Bouteilles par variante. V9b : optimisation rattrapage Se Canto.

**V10** — menu épuré, sécurité credentials via PropertiesService, web app HTML responsive. V10b : nettoyage doublons.

**V11** — Dashboard avec tous les KPI Julien (vitaux + niveaux 2-4) avec statuts explicites. V11b : spec en dur dans dashboard pour chaque KPI manquant.

**V12** (7 juin 2026) — Sync stocks Easybeer. Calcul Rotation stocks PF en jours (177j actuellement). DLUO consommée (29,5% actuellement). Top 10 alertes DLUO. Trigger sync stocks 1h chaque nuit.

**V13** (7 juin 2026, soir) — Alertes Slack lots fantômes. Détection lots > 90 jours en stock ET < 10% du volume conditionné initial. Envoi MP Slack hebdo (lundi 9h) à Alex + Maxime + Olivier. Setup clasp pour synchronisation Apps Script ↔ local. Repo GitHub historisé.

---

## ⚙️ Automatismes en place

**Sync nocturne (1h)** — trigger `creerTriggerPipelineNuit` orchestre :
1. Sync HISTORIQUE_KPI Easybeer (`syncEasybeerToSheet`)
2. Sync stocks PF (`syncStocksPFEasybeer`)
3. Recalcul KPI mensuels (`recalculerKPIMensuels`)
4. Mise à jour dashboard (`actualiserDashboard`)

**Audit Slack hebdo (lundi 9h-10h)** — trigger `auditLotsFantomesHebdo` :
1. Détection lots fantômes (critère V13)
2. Skip si jour férié français (`isJourTravaille_()`)
3. Envoi MP Slack aux 3 destinataires
4. Update onglet `ALERTES_FANTOMES_HISTO` (statuts NOUVEAU / ENVOYE / RE-ENVOYE / RESOLU / BOOTSTRAP / RE-OUVERT)

---

## 🛠️ Workflow de développement

### Pull du code actuel depuis Apps Script
```bash
cd "C:\Users\Alex PRIZM\Documents\Easybeer-AppsScript"
clasp pull
```

### Push des modifs locales vers Apps Script
```bash
clasp push
```

### Commit + push sur GitHub
```bash
git add .
git commit -m "vXX — description"
git push
```

### Redéployer la web app (pour qu'une modif dashboard.html prenne effet sur l'URL publique)
Apps Script → coin haut-droit → Déployer → Gérer les déploiements → Modifier le déploiement existant → Nouvelle version → Déployer.

### Lancer l'audit V13 manuellement (test)
Sheet "Prévisionnel Production" → Menu 🍺 Easybeer → 🚨 V13 Alertes Slack → choisir l'action (Preview, Audit TEST Alex only, Lancer audit MANUEL, etc.).

---

## 🎯 Plan suivant

**V14** — DLUO consommée à expédition. Lecture `/commande/detail` + dateDepartLivraison. Remplace le proxy stock actuel par la vraie DLUO à l'envoi client.

**V15.1** (prérequis V15) — Migrer fichier "calcul de prix méthode Montaner" Excel → Google Sheets cloud. Édition collaborative, lecture native par Apps Script.

**V15.2** (prérequis V15) — Définir mapping Type Excel (blonde, IPA, NEIPA, Bali, Narita, etc.) ↔ Produit Easybeer (VNDL - LA PREF - IPA 5,5%, etc.).

**V15** — État de cave mensuel auto. Trigger dernier jour calendaire du mois 18h. Slack résumé (top 5 fermenteurs + total HL + nb divergences coût) + onglet `ETAT_CAVE_MENSUEL` détaillé. Comparaison coût matière Easybeer ↔ norme Excel pour détecter les erreurs de saisie.

**Plus tard** — Respect Planning (croiser Planning sortie ↔ réel), Registre Incidents (TF1), Eurécia API (heures travaillées), cadrage gammes/prix avec Julien.

**Bloqué externe** — Gurubeer : pas d'API ni d'export propre, on ne peut pas calculer Taux retour ni Batch RFT pour le moment.

---

## 🔐 Sécurité

- **Credentials Easybeer** : Basic Auth user/pass stockés en PropertiesService Apps Script, chiffrés côté Google, accessibles uniquement par les fonctions du projet.
- **Slack Bot Token** : `xoxb-…` stocké en PropertiesService sous `SLACK_BOT_TOKEN`. Jamais committé dans le repo. Si compromis : révoquer via Slack app config → Reinstall to Workspace.
- **GitHub** : repo privé, accès via compte `stefanialex`.
- **Apps Script Web App** : `Execute as = owner`, `Who has access = anyone within prizmbrewing.com domain`. Pas d'accès public anonyme.
- **Clasp** : credentials OAuth stockés dans `~/.clasprc.json` (jamais committé, présent dans `.gitignore`).
- **Permissions Sheet** : restreintes au domaine `@prizmbrewing.com` via les ACL Drive.

---

## 📞 Contacts projet

- **Owner technique** : Alex (alexandre@prizmbrewing.com)
- **Stakeholders prod** : Julien Momar, Antoine (associés)
- **Utilisateurs opérationnels** : Maxime (DAF), Olivier (logistique)
- **Source de données externe** : Easybeer (support via leur portail)

---

## 📚 Documentation interne

- `easybeer-api-reference.md` — documentation des endpoints API Easybeer utilisés (présent dans le repo).
- Logs d'exécution : Apps Script → projet → Exécutions (icône horloge sidebar gauche).
- Historique commits : `git log` ou via GitHub UI.

---

*Dernière mise à jour : 7 juin 2026 — V13 en prod*
