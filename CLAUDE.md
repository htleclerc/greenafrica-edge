CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000

# AGENT.md - Instructions pour l'Agent de Développement

> Ce fichier définit le contexte, les conventions et les bonnes pratiques pour ce projet.
> L'agent DOIT lire ce fichier au début de chaque session.

---

## 📋 Informations Projet

### Projet
- **Nom** : Mon Projet
- **Type** : Web App
- **Stack** : Next.js / TypeScript / Tailwind CSS
- **Statut** : Développement

---

## 📚 Documentation de Référence

**TOUJOURS consulter ces fichiers avant de faire des modifications :**

1. **[startup-package/README.md](startup-package/README.md)** - Vue d'ensemble des bonnes pratiques
2. **[startup-package/docs/standards/ENTERPRISE_STANDARDS.md](startup-package/docs/standards/ENTERPRISE_STANDARDS.md)** - Standards enterprise

---

## 🎯 Règles Impératives

### TOUJOURS ✅
1. Utiliser TypeScript strict mode
2. Valider les inputs avec Zod
3. Écrire des tests pour le nouveau code
4. Utiliser `TodoWrite` pour les tâches complexes (> 3 étapes)
5. Faire des commits atomiques avec messages conventionnels **humanisés** (rédigés comme par un humain, sans signature d'outil)
6. Lire le code existant avant de créer du nouveau
7. Attribuer **tous** les commits à **Loic Leclerc <leclerc@drwintech.com>**

### JAMAIS ❌
1. Utiliser `any` en TypeScript
2. Committer des secrets
3. Ignorer les erreurs TypeScript ou ESLint
4. Push sur main/master directement
5. Ajouter Claude / une IA comme co-auteur (`Co-Authored-By: Claude …`) ou toute mention « Generated with Claude Code » dans les commits **ou** les descriptions de PR

---

## 🛠️ Conventions de Code

### Nommage
| Type | Convention | Exemple |
|------|------------|---------|
| Variables | camelCase | `userName` |
| Constantes | UPPER_SNAKE | `API_URL` |
| Classes/Types | PascalCase | `UserService` |
| Fichiers composants | PascalCase | `UserProfile.tsx` |

### Git Commits
```
type(scope): description

Types: feat, fix, docs, style, refactor, test, chore
```

- **Auteur** : toujours `Loic Leclerc <leclerc@drwintech.com>` (jamais l'email GitHub noreply).
- **Pas de co-auteur Claude** : ne JAMAIS ajouter `Co-Authored-By: Claude …` ni de ligne « 🤖 Generated with Claude Code » dans le message du commit ou la description de la PR. Les messages doivent rester humanisés.

---

## 🔧 Commandes Disponibles

```bash
npm run dev      # Développement
npm run build    # Build production
npm run lint     # ESLint
npm run test     # Tests
```

---

## ⚠️ Points d'Attention

- Consulter startup-package/docs/ pour les best practices
- Respecter l'architecture existante
- Documenter les décisions importantes dans docs/adr/

---

**Dernière mise à jour** : 2026-06-02
**Version** : 1.1
