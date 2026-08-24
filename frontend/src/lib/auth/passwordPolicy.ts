/**
 * Longueur minimale d'un mot de passe.
 *
 * Vit dans son propre module et non dans l'action : un fichier `'use server'`
 * ne peut exporter que des fonctions asynchrones, et Next ne le signale qu'à la
 * compilation du bundle — ni `tsc` ni les tests ne l'attrapent.
 *
 * L'écran l'annonce, l'action la vérifie : une seule valeur, sinon le formulaire
 * promettrait une règle que le serveur ne tient pas.
 */
export const MIN_PASSWORD_LENGTH = 12;
