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

## Avancement du 25/11/2026 (après-midi)
- [x] Lumière des articles : « Accorder à la pièce » (luminosité et teinte mesurées autour de la base, adaptation partielle) + réglages manuels.
- [x] Ombre portée commune à la pièce : longueur, direction, vers le fond / vers l'avant, intensité ; projection de la silhouette depuis la base.
- [x] Annuler / rétablir (Ctrl+Z / Ctrl+Y, boutons) sur articles, réglages et finitions, gestes regroupés.
- Vérifié dans le navigateur sur données de test et par export PNG (carte des différences : ombre projetée visible).
  Fausse alerte écartée : lenteur apparente due au navigateur intégré sans focus (1 image/s), le logiciel réagit en ~34 ms.

## Rendu des peintures et finitions (25/11/2026, fin d'après-midi)
Demande : rendu « digne d'un studio photo », différencier portes / cadres / murs / plafonds / sols, peintures et
papiers saisis comme des produits (marque, ex. un fournisseur), finitions mat / velours / satiné nettement visibles.
- [x] Moteur refait (local/finitions.py) : travail en lumière linéaire, éclairage et couleur de la lumière séparés de la
  couleur de la surface, grain conservé, bords nets ; reflets mesurés (porte bleu nuit : mat plat, brillant reflète le fauteuil).
- [x] Approches abandonnées : reflet « normalisé sur son maximum » (tache sur une porte uniforme), reflet d'environnement
  pris sur la surface elle-même (voile laiteux de l'ancienne teinte), reflets trop forts (bleu nuit devenu gris) → reflet
  absolu, pris hors de la surface, 4 à 10 %, plus diffus sur un grand mur que sur une porte.
- [x] Surfaces typées (mur, plafond, porte, cadre, sol, autre), finition par surface, « Séparer le cadre » (enveloppe
  extérieure : les lettres collées ne créent pas de faux cadre), sol en perspective (parquet d'exemple dessiné ici).
- [x] Baguette : intérieurs de lettres et taches de soleil entre brindilles repris ; GrabCut rendu déterministe
  (même clic = même sélection ; un trou rempli pouvait disparaître d'un lancement à l'autre).
- [x] Teintes comme produits : migration 4 additive (marque, gamme, usage + parquet d'exemple), testée sur une copie de la
  base réelle : 3 colonnes et 1 ligne ajoutées, aucune donnée existante modifiée, intégrité ok, idempotente.
  La base réelle n'est pas encore migrée : elle le sera au prochain lancement du logiciel.
- [x] Import de nuancier CSV (modèle à télécharger, aperçu, mise à jour sans doublon sur marque + référence).
- [x] Vérifié dans le navigateur sur données de test : porte + cadre séparé, teinte créée avec marque, passage en brillant,
  import CSV (2 nouvelles, 1 mise à jour, 1 refusée), projet rouvert à l'identique, console sans erreur.
- Aucune référence réelle de fournisseur n'a été inventée : les teintes livrées sont des exemples fictifs.
- Limite : les reflets sont une approximation 2D (symétrie par rapport au pied de la surface), sans fenêtres hors champ.

## IA locale : propositions dès l'import et optimisation finale (25-26/11/2026)
Demande : retrouver la simplicité de la V1 (Murs présélectionnés, une teinte, Appliquer, l'IA trouve les murs) en
local ; propositions avec nos finitions dès l'import ; « Optimisation finale » avec consigne enregistrée.
- V1 relue (src/components/pro/studio.tsx, src/routes/api/showroom-photo.ts) : envoi de la photo et d'une consigne
  « repeins uniquement les murs » à un modèle d'édition en ligne (Lovable). Remplacé par des modèles locaux.
- Modèles retenus (licences vérifiées sur les fiches officielles, usage commercial et inclusion dans le ZIP permis) :
  UperNet ConvNeXt-Small ADE20K (MIT), Depth Anything V2 Small (Apache 2.0), SD 1.5 Inpainting (OpenRAIL-M)
  + LCM-LoRA (OpenRAIL++-M) fusionnés, TAESD (MIT), onnxruntime 1.20.1 (MIT). Textes et restrictions d'usage
  dans local/modeles. Matériel d'essai : Intel Core i5-13400T, 16 Go, sans carte graphique dédiée.
- [x] Analyse automatique à l'import (local/analyse.py) : pans de mur par la profondeur (profil par morceaux,
  angle recalé sur l'arête visible), plafond, sol, portes ; fenêtres, tableaux, meubles, plinthes exclus.
- [x] Propositions (src/lib/propositions.ts) : 4 aperçus de la pièce avec les finitions réelles de la bibliothèque,
  référence sous chaque aperçu ; un clic applique ; « Tous les murs » présélectionné ; changement de finition
  sans nouvelle analyse (lumière de chaque surface gardée en cache).
- [x] Optimisation finale (local/optimisation.py) : consigne pré-encodée, retouche limitée à un anneau autour des
  articles et à leurs ombres, grain du montage réinjecté ; avant/après, « Garder » / « Revenir au montage ».
- Mesures dans le logiciel (navigateur, données d'essai) : hall de référence — analyse 16,7 s, premier aperçu 22 s ;
  salon en angle — analyse 10,6 s, premier aperçu 12,6 s, 4 aperçus 15 s ; changement de proposition ou passage à
  la chaux sur tous les murs ≈ 4 s ; optimisation : 14 s (petit vase, vignette 384 px) à 43 s (vignette 512 px),
  dont ≈ 10 s de chargement du modèle au premier usage.
- Approches abandonnées : quantification int8 de l'UNet (10 s par pas contre 10,9 : gain nul, qualité moindre) ;
  VAE d'origine (40 s par vignette) remplacé par TAESD (3 s) ; découpage des pans par programmation dynamique
  (cassures absentes) remplacé par recherche exhaustive ; croissance libre de la couleur du mur (débordait dans
  le plafond) remplacée par une extension limitée aux pixels classés « objet ».
- Bug antérieur corrigé : un POST refusé (403) coupait la connexion sous Windows avant la réponse (corps non lu).
- Limites : la segmentation est calculée en 576 px (bords recalés ensuite) ; sur une image dessinée sans ombres, un
  coin de plafond uni peut rester compté comme mur ; l'optimisation ne recrée pas la lumière de toute la scène et
  ne touche jamais l'intérieur des articles ; la 2e pièce d'essai est une image de synthèse (aucune autre photo
  de pièce n'était disponible) : à confirmer sur vos photos réelles, le logiciel affiche les durées.

## Simplification (26/11/2026)
Demande : les 4 propositions ne servent à rien et font perdre du temps ; la sélection des murs est trop compliquée.
- [x] Bandeau des propositions retiré (code supprimé).
- [x] Peindre : choisir la teinte puis cliquer sur la photo ; la surface reconnue sous le clic est peinte (porte
  avant mur), sinon sélection à la baguette au point cliqué ; pipette = nouvelle teinte au pinceau.
- [x] Meubles : choisir l'article puis cliquer sur la photo pour poser sa base.
- [x] « Exporter pour l'IA » : visuel PNG + consigne de rendu 3D (modifiable, mémorisée) avec les finitions
  utilisées ; l'optimisation locale reste accessible depuis cette fenêtre.
- Vérifié dans le navigateur sur données de test : 2 clics = 2 murs peints, vase posé d'un clic sur un tabouret,
  fenêtre d'export (aperçu, PNG, consigne).

## Détail des pièces et fluidité (26/11/2026)
Demande : détailler plinthes, portes, cadres, murs et plafond de chaque pièce. Essai sur une vraie photo de
l'utilisateur (couloir 2400 × 1800 : habillage bleu-gris, mur beige, ascenseur, porte coupe-feu).
- [x] Surfaces fines : plinthes (bande droite au-dessus du sol, arête nette), une surface par porte, cadre
  séparé quand sa couleur diffère du vantail, pans de mur séparés aussi par la teinte (beige / bleu-gris).
- [x] Corrigé sur la vraie photo : mur beige rendu au plafond (réattribution limitée aux pixels que le modèle
  soupçonne être du plafond), bandes de mur perdues (contrôle de plan limité au plafond/sol suspects),
  mur jaune coupé entre ombre et soleil (séparation par la teinte seulement), fausses plinthes au pied des
  fauteuils (une plinthe est droite), fauteuil beige rattaché au mur beige (extension limitée à 2,5 %).
- [x] Survol : la surface visée s'affiche dans la teinte choisie, avec son nom.
- [x] Fluidité : aperçu à l'écran calculé à 1400 px au plus ; un clic de peinture s'affiche en ≈ 5 s au premier
  passage sur une photo de 2400 px puis en moins d'une seconde ; la pleine résolution est calculée à l'export.
- Vérifié dans le navigateur sur la photo du couloir : mur du fond, porte, cadre, mur gauche et plinthes peints
  chacun d'un clic ; 51 tests Python, 40 tests d'écrans.
- Limite : une plinthe ou un cadre fin se vise mieux après un zoom ; le cadre est une bande d'épaisseur estimée.

## Espace décorateur refait (26/11/2026)
Demande : reprendre entièrement l'onglet ; garder l'outil d'objets, le catalogue et les projets existants.
- [x] Accueil « Importer une photo » / « Reprendre un projet » (projets existants listés avec vignette).
- [x] Atelier plein écran : photo au centre, survol = contour de la surface, clic = panneau de la surface
  avec les finitions compatibles du catalogue en vignettes ; changement de finition sans resélection.
- [x] Fenêtres reconnues (protégées) ; plinthes raccordées et prolongées le long de leur droite ; trous de
  la couleur du mur rendus au mur ; contour d'une surface dessiné sous les objets.
- [x] Nouvelle matière au sol : le dessin de l'ancien revêtement (chevrons) n'apparaît plus sous le béton ciré.
- [x] Parquet : sens des lames (rotation) et échelle ; perspective 4 coins.
- [x] Objets glissés depuis le catalogue, rotation, taille, duplication, suppression ; import d'un visuel
  (PNG transparent tel quel, sinon détourage) lié à sa référence.
- [x] « Ma sélection » : dernière finition par surface, quantités d'objets, m² × couches ÷ rendement,
  « À renseigner » et total partiel ; tarif public / pro.
- [x] Base : migration 5 (prix, unité, m² par unité, couches sur les finitions), additive ; impact mesuré
  sur une copie de la vraie base : 4 colonnes ajoutées, aucune ligne modifiée, intégrité ok.
- [x] Mode « Présenter au client » (rideau avant / après) et PDF (2 pages) généré localement.
- [x] Visuel haute définition 4 fois plus rapide (flous larges calculés sur image réduite) : ≈ 11 s au lieu de 44 s.
- Vérifié dans le navigateur sur une vraie photo (chambre-salon 2400 × 1800, données de test) : mur gauche
  Sauge puis Terracotta sans toucher prises ni plinthes, parquet puis béton ciré puis parquet tourné de 90°,
  fauteuil glissé, dupliqué (quantité 2, 938 €) puis supprimé (quantité 1), 24 m² et 18 m² saisis,
  rechargement de la page et réouverture du projet identiques, présentation, PDF relu : Terracotta
  « À renseigner », parquet 9 paquets 584,10 €, fauteuil 1 × 469 €, total partiel 1 053,10 €.
  53 tests Python, 45 tests d'écrans.
- Limites : la photo d'essai n'a pas de canapé (préservation des meubles vérifiée sur le rendu de référence
  et la pièce d'angle) ; corniche et coffre de volet non reconnus (pinceau « Ajouter ») ; une plinthe sous
  un habillage (placards) n'est plus détectée quand le mur au-dessus n'est pas un mur.

## Photo réaliste par IA générative locale (28/11/2026)
Demande : un visuel « comme une IA » (réaliste), après essai concluant sur la photo du salon.
- [x] Module optionnel runtime/ia-rendu : Python 3.12 autonome + PyTorch CPU + diffusers (0,9 Go) et modèles
  (3,2 Go) : Realistic Vision 5.1 inpainting, ControlNet profondeur, LCM-LoRA, VAE ft-mse, Depth Anything small.
  Hors ZIP et hors GitHub ; versions figées dans local/outils/ia_rendu/requirements.txt ; licences dans LICENCES.txt.
- [x] local/rendu_ia.py : l'IA redessine les surfaces habillées et le pourtour des articles ; la teinte du nuancier
  (chroma locale), la luminosité moyenne et les détails (motif, lames, grain) sont repris du montage ; autour des
  articles l'IA ne peut qu'assombrir (ombre de contact, pas de halo clair) ; le reste de la photo est intact.
- [x] Serveur : tâche en processus séparé, priorité basse, une à la fois, progression, annulation ; l'image est
  rangée dans le dossier photos ; bouton absent si le module manque.
- [x] Présentation : « Créer la photo réaliste », barre de progression, « Annuler », bascule « Montage / Photo
  réaliste », « Refaire » (autre version) ; le PDF reprend le visuel affiché ; enregistré dans la proposition.
- Vérifié dans le navigateur sur la vraie photo (Salon Durand, données de test) : rendu lancé depuis la
  présentation, progression affichée, image prête en ≈ 3 min 30, conservée après rechargement, « Refaire »
  fonctionne, PDF identique à la photo réaliste (écart moyen 0,04 / 255). 59 tests Python, 46 tests d'écrans.
- Limites : 1 min 30 à 4 min par image sur ce PC (processeur, pas de carte graphique) ; l'IA calcule en
  768 × 576 puis les détails sont repris du montage ; elle peut inventer une tache de soleil ou une prise ;
  les défauts de contour du montage (bas de mur) restent visibles.

## Rendu avec ChatGPT (28/11/2026)
Demande : obtenir un rendu de la qualité d'une grande IA en ligne avec l'abonnement ChatGPT Pro (pas de clé API).
- [x] Bouton « Rendu avec ChatGPT » dans la barre de l'atelier (ouvre la présentation et le panneau) et dans la présentation : copier le visuel (PNG), ouvrir chatgpt.com, copier la
  consigne (celle d'« Exporter pour l'IA » + finitions), reprendre l'image par Ctrl+V, glisser-déposer ou fichier.
  Replis : visuel téléchargé si le presse-papiers est refusé, ancienne commande de copie pour la consigne.
- [x] Image reprise recadrée au format de la photo (rideau avant / après aligné), rangée dans les photos, enregistrée
  dans la proposition (même place que la photo réaliste locale), reprise par le PDF.
- Vérifié dans le navigateur (données de test) : panneau, image 3:2 collée → recadrée en 2400 × 1800 et affichée,
  conservée après rechargement, PDF généré avec cette image. La copie vers le presse-papiers n'a pas pu être
  vérifiée dans le navigateur de test (permission refusée par ce navigateur) : le repli s'applique ; à vérifier
  dans Edge sur le vrai logiciel.
- Le logiciel ne se connecte pas à ChatGPT (un abonnement ChatGPT ne donne pas d'accès API ; piloter le site est
  contraire à ses conditions).

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
