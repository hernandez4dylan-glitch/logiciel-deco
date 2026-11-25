# Cap et feuille de route — Un Instant Chez Moi

Repris du dépôt de la version en ligne (`atelier-stock-symphony`, Lovable + Supabase), mis à jour
pour l'édition locale Windows (25/11/2026).

## Cap
Les clients de la boutique et ceux des décorateurs meublent leur intérieur avec des pièces qu'ils ont choisies.

**Indicateur suivi : ventes enregistrées chaque semaine** — affiché au tableau de bord
(« Ventes enregistrées cette semaine », comparé à la semaine précédente).

## Feuille de route
- [x] Renommer en Un Instant Chez Moi
- [x] Devis & Ventes (caisse, export CSV) — plus : modification du client, annulation avec remise en stock
- [x] Frais & Dépenses (saisie, export CSV) — plus : modification, suppression
- [x] Espace Pro Décorateurs (catalogue Pro, partenaires, ajout d'un décorateur)
- [x] Passerelle E-commerce (publier, statut, export CSV/JSON)
- [x] Tableau de bord : graphique CA / entrées / sorties / marge ; export CSV stock ; ventes de la semaine
- [x] Retouche showroom des photos d'annonce : détourage, **correction de lumière**, fond uni ou **décor clair** (local)
- [x] Conseiller : style / besoins / budget → sélection d'articles du catalogue (local)
- [x] Détourage des articles (local, pieds fins, éditeur au pinceau, enregistré sur la fiche, plusieurs photos)
- [x] Studio : murs, plafonds, portes, cadres = surfaces libres sélectionnées à la baguette
- [x] Studio : peinture qui conserve la lumière, papier peint en perspective, enduit d'après échantillon
- [x] Studio : bibliothèque de teintes avec référence magasin, **pipette**
- [x] Studio : gomme, remplacement de décor, **annuler la dernière retouche**
- [x] Studio : articles ancrés au sol ou sur un meuble, échelle, miroir, ombre réglable, premier plan
- [x] Studio : lumière des articles accordée à la pièce, ombre portée orientée, annuler / rétablir (Ctrl+Z / Ctrl+Y)
- [x] Studio : projets clients enregistrés, variantes, comparaison, visuel PNG, fiche client, références CSV
- [x] Outils sans crédits : tout fonctionne sur le PC, sans clé API ni coût par rendu
- [ ] Rendu photoréaliste complet (rééclairage de toute la scène) : non réalisable en local à ce jour
- [ ] Navigation dans une maquette 3D complète : à étudier ensuite

## Ce qui n'est pas repris de la version en ligne
- Connexion Supabase, authentification, passerelle IA Lovable (`LOVABLE_API_KEY`) : remplacées par le
  serveur local et le moteur photo embarqué.
- Le fichier `.env` du dépôt en ligne n'a pas été lu ni copié (il peut contenir des clés).
- Règle de l'ancien studio « photos recadrées en 4:3 » : abandonnée, le format d'origine est conservé.
- Gomme et recoloration en JavaScript (`local-image.ts`) : remplacées par le moteur Python plus précis ;
  seule la correction automatique de lumière a été reprise (`src/lib/couleur.ts`).
