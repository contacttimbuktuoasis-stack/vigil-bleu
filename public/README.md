# Vigil Bleu — V9 Backend

Cette version transforme le prototype local en application centralisée : les signalements sont stockés côté serveur, les tickets sont générés côté serveur, les doublons sont vérifiés côté serveur et le superviseur peut mettre à jour les statuts.

## 1. Installation

Prérequis : Node.js 20+.

```bash
cd backend
npm install
```

## 2. Configuration

Copier `.env.example` vers `.env` et définir au minimum un `JWT_SECRET` long et aléatoire.

Pour une première démonstration, les comptes sont créés automatiquement au premier démarrage :
- admin@vigilbleu.com / Admin1234
- sarah.diop@eau.sn / 1234

Changez ces mots de passe avant toute utilisation réelle.

## 3. Démarrage

```bash
npm start
```

Puis ouvrir `http://localhost:3000`.

## 4. Notification professionnelle

Le backend accepte `NOTIFY_WEBHOOK_URL`. À chaque nouveau signalement, il envoie un POST JSON à cette URL. C'est volontairement un webhook générique : il permet de brancher ensuite WhatsApp Business/API, un outil interne, e-mail ou autre canal professionnel sans exposer le numéro au citoyen.

Le navigateur citoyen n'ouvre plus `wa.me`.

## 5. Production

Avant remise à une société : utiliser HTTPS, une vraie base de données (PostgreSQL/MySQL), un stockage photo, une authentification avec rotation de secrets, sauvegardes, journalisation, limitation de débit et un fournisseur de notification professionnel. Le fichier `data.json` est prévu pour le prototype et les tests, pas pour une exploitation à grande échelle.
