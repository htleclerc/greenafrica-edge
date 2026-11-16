# shellcheck shell=bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-common.sh — contrôles communs aux deux chargements d'un export de pays
# (tenant-import.sh et tenant-load-plain.sh). Se lit avec `source`, ne se lance
# pas.
#
# Un export arrive de l'extérieur : rien de ce qu'il contient n'est cru avant
# d'avoir été vérifié. Deux contrôles ici, dans cet ordre :
#   1. la signature du manifeste — l'export vient bien de qui détient la clé ;
#   2. l'empreinte de chaque fichier — il n'a été ni modifié ni tronqué.
# ─────────────────────────────────────────────────────────────────────────────

TENANT_EXPORT_FORMAT='greengate-tenant-export/3'

die() { echo "FATAL: $*" >&2; exit 1; }

# private_export_copy <dossier d'export>
#
# Le dossier reçu n'est jamais utilisé tel quel. On en prend une copie dans un
# dossier privé, et tout le reste — vérifications, lecture, fichiers de travail —
# se fait sur cette copie. Trois raisons :
#   • ce qui a été vérifié est exactement ce qui sera lu : personne ne peut
#     changer un fichier entre les deux ;
#   • les fichiers de travail ne sont pas écrits dans un dossier venu d'ailleurs,
#     où un lien pré-placé les ferait atterrir sur un autre fichier ;
#   • seuls les éléments attendus sont repris ; un lien ou un fichier spécial
#     fait refuser l'export.
# Pose le chemin de la copie dans EXPORT_COPY ; à l'appelant de la supprimer.
private_export_copy() {
  local src="$1" entry
  EXPORT_COPY="$(mktemp -d)" || die "impossible de créer un dossier de travail privé."
  chmod 700 "$EXPORT_COPY"
  for entry in manifest.json manifest.sig schema.json tenant accounts globals; do
    if [ -e "$src/$entry" ] || [ -L "$src/$entry" ]; then
      cp -R -P "$src/$entry" "$EXPORT_COPY/" || die "copie de l'export impossible ($entry)."
    fi
  done
  [ -z "$(find "$EXPORT_COPY" -mindepth 1 ! -type f ! -type d -print | head -1)" ] \
    || die "l'export contient un lien ou un fichier spécial : refusé."
  [ -f "$EXPORT_COPY/manifest.json" ] && [ -f "$EXPORT_COPY/schema.json" ] \
    || die "manifest.json ou schema.json absent : ce dossier n'est pas un export complet."
}

# verify_export_signature <dossier d'export>
#
# Le manifeste porte l'empreinte de tous les autres fichiers : le signer, c'est
# signer l'export entier. La vérification se fait avec la clé PUBLIQUE de
# l'émetteur : celui qui reçoit un export peut le contrôler sans pouvoir en
# fabriquer un.
#
# ALLOW_UNSIGNED_EXPORT=1 saute ce contrôle. À réserver aux essais : sans
# signature, rien ne prouve d'où vient l'export.
verify_export_signature() {
  local dir="$1"
  if [ "${ALLOW_UNSIGNED_EXPORT:-}" = "1" ]; then
    echo "ATTENTION : signature de l'export NON vérifiée (ALLOW_UNSIGNED_EXPORT=1). Rien ne prouve son origine." >&2
    return 0
  fi
  [ -n "${EXPORT_VERIFY_KEY:-}" ] \
    || die "EXPORT_VERIFY_KEY n'est pas renseignée : indiquer la clé publique de l'émetteur de l'export."
  [ -f "$EXPORT_VERIFY_KEY" ] || die "clé publique introuvable : $EXPORT_VERIFY_KEY"
  [ -f "$dir/manifest.sig" ] || die "export non signé (manifest.sig absent) : refusé."
  command -v openssl >/dev/null || die "openssl introuvable."
  openssl dgst -sha256 -verify "$EXPORT_VERIFY_KEY" -signature "$dir/manifest.sig" "$dir/manifest.json" >/dev/null 2>&1 \
    || die "signature du manifeste invalide : l'export ne vient pas du détenteur de la clé, ou a été modifié."
}

# check_export_files <fichier de sortie>
#
# À lancer depuis le dossier d'export. Contrôle le format, puis l'empreinte de
# chaque fichier annoncé par le manifeste. Écrit « chemin <tab> lignes » dans le
# fichier de sortie, schema.json excepté.
check_export_files() {
  local out="$1" line path rows sum
  grep -q "\"format\": \"$TENANT_EXPORT_FORMAT\"" manifest.json \
    || die "format d'export inconnu (attendu $TENANT_EXPORT_FORMAT)."
  : > "$out"
  while IFS= read -r line; do
    path="$(printf '%s' "$line" | sed -E 's/.*"path": "([^"]+)".*/\1/')"
    rows="$(printf '%s' "$line" | sed -E 's/.*"rows": ([0-9]+).*/\1/')"
    sum="$(printf '%s' "$line" | sed -E 's/.*"sha256": "([0-9a-f]+)".*/\1/')"
    [[ "$path" =~ ^((tenant|accounts|globals)/[a-z0-9_]+\.jsonl|schema\.json)$ ]] || die "chemin inattendu dans le manifeste : $path"
    [[ "$rows" =~ ^[0-9]+$ ]] || die "nombre de lignes illisible dans le manifeste pour $path"
    [ -f "$path" ] || die "fichier manquant : $path"
    [ "$(sha256sum "$path" | cut -d' ' -f1)" = "$sum" ] || die "empreinte différente pour $path : l'export a été modifié ou tronqué."
    [ "$path" = "schema.json" ] || printf '%s\t%s\n' "$path" "$rows" >> "$out"
  done < <(grep -E '"path": ' manifest.json)
  [ -z "$(cut -f1 "$out" | sort | uniq -d)" ] || die "le manifeste annonce deux fois le même fichier."
  grep -q '"path": "schema.json"' manifest.json || die "le manifeste n'annonce pas schema.json."
}
