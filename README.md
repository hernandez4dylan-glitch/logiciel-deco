# Atelier Stock Symphony — Un Instant Chez Moi

Logiciel local de gestion de boutique déco (Windows) : catalogue et stock, fournisseurs,
devis et ventes, frais, espace Pro décorateurs, passerelle e-commerce, et **Studio Plan & 3D**
pour les rendez-vous clients (murs repeints en gardant la lumière, papier peint en perspective,
articles du magasin posés au sol ou sur un meuble, variantes, comparaison, fiche client).

Tout fonctionne sur le PC : aucun service en ligne, aucune clé API, aucun coût par rendu.

## Utiliser le logiciel
Télécharger le ZIP Windows (il contient Python, le moteur photo et l'interface compilée),
l'extraire puis double-cliquer sur `Lancer_Atelier.cmd`. Mode d'emploi : [LIRE_MOI.txt](LIRE_MOI.txt).

## Contenu du dépôt
- `src/` : interface React + Vite + TypeScript (le studio est dans `src/components/studio` et `src/lib`).
- `local/` : serveur Python (127.0.0.1 uniquement), base SQLite et moteur photo
  (`detourage.py`, `finitions.py`, `gomme.py`, `retouche.py`, modèle U²-Net compact `u2netp.onnx`).
- `local/tests/` : tests Python ; `local/outils/` : sauvegarde vérifiée et contrôle de migration.
- `docs/` : cap produit et feuille de route ; `Essai_photo/` : essais visuels (`Comparer.html`).
- Non versionnés : `runtime/` (Python embarqué, NumPy, OpenCV — livrés dans le ZIP), `dist/`, `node_modules/`,
  et bien sûr aucune donnée de boutique (elles restent dans `%LOCALAPPDATA%\AtelierStockSymphony`).

## Développer
Avec Node.js : `npm ci`, puis `npm run check`, `npm test`, `npm run build`.
Tests du serveur et du moteur photo (avec le Python embarqué du ZIP placé dans `runtime/windows`) :
`npm run test:local`. Licences des composants : [LICENCES.txt](LICENCES.txt).
