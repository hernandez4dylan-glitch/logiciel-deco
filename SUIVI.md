# Suivi — Studio Plan & 3D pour le rendez-vous client

## Décisions prises (à valider par vous)
- **Pas de nouveau modèle téléchargé** : le détourage reste basé sur le modèle U²-Net déjà inclus, complété par un affinage pleine résolution (couleurs, filtre guidé, décontamination). Choix recommandé : rester sans téléchargement tant que le résultat sur le fauteuil est bon ; un modèle plus lourd (IS-Net/BiRefNet, 40 à 200 Mo) reste possible ensuite.
- **Format d'origine conservé** : la photo n'est plus recadrée en 4:3 ; elle est seulement réduite à 2400 px sur le grand côté pour rester fluide sur un PC standard.
- **Plan d'implantation (grille de SKU)** : retiré du studio, qui part désormais d'une photo ou d'un rendu ; une « pièce vierge » générée reste disponible pour démarrer sans photo.

## Diagnostic (25/11/2026)
- `normalizeRoomPhoto` recadre toute photo en 1536 × 1152 : un panoramique ou une photo verticale perd son cadrage.
- Les articles sont des `<img>` positionnés par leur centre en % de la largeur : impossible de poser des pieds sur le sol ; ombre CSS fixe ; aucun masquage derrière un meuble.
- La recoloration remplace la luminance par une teinte + 0,75 × écart : la lumière de la fenêtre s'écrase, le masque est un simple pinceau binaire (débordements, pas de protection des menuiseries).
- Rien n'est enregistré : fermer le logiciel perd la composition ; pas de variante, ni de comparaison, ni d'export avec références.
- Détourage : U²-Net compact en un seul passage 320 × 320, masque agrandi en bilinéaire → pieds fins et accoudoir perdus, bords teintés par le fond ; l'éditeur de contours n'a pas de zoom et n'enregistre pas sur la fiche article.
- Un article n'a qu'une photo (`image_url`).

## Approches changées en cours de route
- **Détourage – GrabCut pleine résolution** : lissait les tubes fins (patins, montants) jusqu'à les supprimer. Remplacé par « trace du modèle U²-Net × écart de couleur au fond local » + filtre guidé.
- **Détourage – complétion automatique des barres (Hough puis LSD)** : 3 essais, le dernier ajoutait un morceau de mur au lieu de l'accoudoir. Abandonné au profit du pinceau « Restaurer précis » (ne reprend que les pixels qui tranchent sur le fond).
- **Liseré de fond** : la correction de bord faite à la résolution de travail (×2,5) était annulée au retour à la taille réelle ; déplacée après le redimensionnement.
- **Sélection de mur – GrabCut depuis des clics** : apprend la couleur du mur sur trop peu de pixels (échec). Remplacé par une croissance de région par teinte (angle a/b en Lab, saturation relative, luminosité libre) arrêtée sur les contours, GrabCut seulement dans une bande. Bug trouvé : décalage de 128 de a/b en Lab 8 bits d'OpenCV.
- **Liseré orange en haut du mur repeint** : pixels de bord mixtes ; ils sont maintenant repeints s'ils ont la teinte de l'ancien mur.

## Bugs trouvés pendant les essais dans le navigateur (corrigés et testés)
- Enregistrer une peinture échouait (« Valeur négative ou vide ») : largeur de motif vide refusée par le serveur.
- Après « Changer le décor », les finitions et le premier plan de l'ancienne photo restaient affichés : ils sont maintenant masqués / vidés.
- Le plan de travail restait en 300 × 150 tant que l'observateur de taille ne s'était pas déclenché : dimensionnement immédiat.

## Limites constatées
- Gomme sur un arrière-plan chargé (porte à lettres, plaid, meuble derrière) : fragments recopiés ; à réserver aux fonds simples.
- Accoudoir gauche et patin droit du fauteuil d'essai non retrouvés automatiquement (photo de 210 px) : une minute de pinceau.
- Ombres = ombres de contact douces réglables ; pas de calcul de lumière ni d'ombre portée par les fenêtres ; lumière des articles non recalculée.
- La boîte de dialogue d'impression de la fiche client n'a pas pu être ouverte dans le navigateur d'essai (fenêtre masquée) : le contenu HTML de la fiche a été vérifié, pas l'impression PDF elle-même.

## Reprise du 25/11/2026 (relance sur données réelles)
- Git Bash présent dans `%LOCALAPPDATA%\Programs\Git` (hors PATH) ; le hook Stop s'y exécute correctement (bloque si une tâche reste ouverte, laisse passer sinon).
- Hook rendu robuste : chemin absolu `$CLAUDE_PROJECT_DIR/.claude/hooks/verifier.ps1` (le chemin relatif échouait hors de la racine). Contrôles inchangés.
- Données réelles : `%LOCALAPPDATA%\AtelierStockSymphony` (base schéma 0, 7 articles, 6 photos). Sauvegarde validée dans `%LOCALAPPDATA%\AtelierStockSymphony_sauvegardes\2026-11-25_111221`.
- Migration testée sur une copie : additive (4 tables, 7 finitions d'exemple), aucune table existante modifiée, idempotente.
- Logiciel testé sur la copie migrée : toutes les pages, photos et détourages, vente + annulation, sauvegarde ZIP, studio avec l'article réel « MEMENTO ».
- Relance sur données réelles faite par l'utilisateur (Lancer_Atelier.cmd, 25/11 11:15:03). Contrôle en lecture seule
  ensuite : base en version 3, intégrité ok, tables d'origine identiques à la sauvegarde, 4 nouvelles tables ;
  application joignable, 7 articles, 7 photos, 3 fournisseurs, 4 dépenses accessibles.

## Reprise d'éléments de l'ancien dépôt GitHub (25/11/2026)
- `logiciel-deco` : dépôt vide (aucun commit) ; rien à reprendre.
- `atelier-stock-symphony` (privé, version en ligne Lovable/Supabase) lu depuis le navigateur connecté ; `.env` non lu.
- Repris et testé : cap produit + indicateur « ventes de la semaine » (tableau de bord), correction automatique
  de lumière et décor clair pour la retouche showroom, pipette et « Annuler la dernière retouche » de l'ancien studio.
- Non repris : authentification et base Supabase, passerelle IA Lovable, outils JS de gomme/recoloration
  (moins précis que le moteur actuel), recadrage forcé 4:3.
- [x] Éléments utiles intégrés, vitest (25) + Python (35) + build OK, vérifiés dans le navigateur sur données de test.

## Tâches
- [x] Vérification automatique installée (.claude/hooks/verifier.ps1 + .claude/settings.json)
- [x] Base : migrations sans perte (teintes/matières, photos d'article, projets, variantes) + tests
- [x] Détourage automatique affiné (pieds fins, ouvertures, bords, couleur) + avant/après fond clair et sombre
- [x] Éditeur de détourage : zoom, effacer/restaurer, enregistrement sur la fiche article
- [x] Plusieurs photos par article, choix de la photo dans le studio
- [x] Sélection de mur : baguette (croissance de région par teinte + GrabCut local), pinceau ajouter/retirer, protections, zoom
- [x] Peinture qui conserve la lumière (dégradé fenêtre), bords sans débordement
- [x] Bibliothèque de teintes et matières (nom, référence magasin, échantillon)
- [x] Papier peint : motif importé, taille, alignement en perspective (4 coins)
- [x] Enduit / béton ciré à partir de la photo d'échantillon
- [x] Studio : format d'origine conservé (panoramique, vertical)
- [x] Articles ancrés par leur base, échelle, miroir, ombre de contact réglable, premier plan qui masque
- [x] Projets : enregistrer / rouvrir, variantes dupliquées, changement de teinte sans bouger les articles
- [x] Comparaison de deux variantes, export PNG + liste des références et quantités (CSV, impression)
- [x] Gomme et remplacement de décor conservés dans le nouveau studio
- [x] Vérification navigateur de toutes les pages, console sans erreur
- [x] Démos (fauteuil avant/après, mur recoloré, composition proche du rendu de référence) produites avec le logiciel
- [x] LIRE_MOI.txt, Comparer.html, LICENCES.txt à jour ; ZIP Windows livré ; lancement sans Node ni Python vérifié
