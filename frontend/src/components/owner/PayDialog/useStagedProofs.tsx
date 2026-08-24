'use client';

import * as React from 'react';
import type { UploadedProof } from '@/components/payments/ProofUploader';

export interface StagedProofs {
    /** Fichiers retenus, dans l'ordre de selection. */
    files: File[];
    /** Adaptateur au contrat de ProofUploader, servi depuis la memoire. */
    adapter: {
        list: () => Promise<UploadedProof[]>;
        upload: (file: File) => Promise<void>;
        remove: (id: string) => Promise<void>;
    };
}

/**
 * Retient les justificatifs EN MEMOIRE, avant que le paiement existe.
 *
 * Le televersement reel vise `/api/owner/payments/<id>/proofs` : il lui faut un
 * paiement deja cree. Exiger la piece a la soumission imposait donc de choisir
 * entre deux mauvaises solutions — creer le paiement d'abord et esperer que
 * l'armateur joigne la piece ensuite (ce qu'il pouvait ignorer d'un clic), ou
 * refuser la piece tant que le paiement n'existe pas. On retient les fichiers
 * ici, et on les envoie dans la foulee de la creation.
 *
 * Le meme composant d'upload sert dans les deux cas : ce qui change est
 * l'adaptateur, pas l'interface. L'armateur voit le meme ecran, avec les memes
 * controles de taille et de format.
 */
export function useStagedProofs(): StagedProofs {
    const [files, setFiles] = React.useState<File[]>([]);
    // Une reference double l'etat : `list` doit rester stable d'un rendu a
    // l'autre (ProofUploader la met en dependance d'un effet), tout en lisant
    // la valeur courante.
    const ref = React.useRef<File[]>([]);

    const list = React.useCallback(
        async (): Promise<UploadedProof[]> =>
            ref.current.map((f, i) => ({
                id: String(i),
                name: f.name,
                sizeBytes: f.size,
                mimeType: f.type,
            })),
        [],
    );

    const upload = React.useCallback(async (file: File): Promise<void> => {
        ref.current = [...ref.current, file];
        setFiles(ref.current);
    }, []);

    const remove = React.useCallback(async (id: string): Promise<void> => {
        const index = Number(id);
        ref.current = ref.current.filter((_, i) => i !== index);
        setFiles(ref.current);
    }, []);

    return { files, adapter: { list, upload, remove } };
}
