-- Mode observation de la detection « port d'origine » (plan 8).
--
-- Le flux ShipStaticData mondial d'aisstream permet de reperer un navire qui
-- DECLARE Berbera ou Zeila comme destination, une a trois semaines avant son
-- arrivee. Mais une destination declaree est une intention, pas une arrivee —
-- et personne ne sait aujourd'hui combien de navires en declarent vraiment.
-- Mesure du 2026-08-24 sur dix minutes du flux mondial : 9 191 messages,
-- 4 088 destinations distinctes, AUCUNE pour Berbera ou Zeila, une seule pour
-- Djibouti.
--
-- Tant que ce drapeau est a true, une correspondance d'allow-list ecrit une
-- ligne dans destination_match_proposals (reconnaissable a fuzzy_score = 0)
-- au lieu de creer un arrival_alerts. On mesure ce qu'on AURAIT facture, sans
-- rien emettre. Le passer a false n'a de sens qu'une fois ce volume connu.
--
-- Le backend traite toute erreur de lecture de cette cle comme true : sur une
-- taxe souveraine, un incident d'infrastructure ne doit jamais pouvoir
-- declencher une pro-forma.
--
-- Rappel : ce drapeau ne sert que si feature.ais_global_enabled est a true.

INSERT INTO public.app_config (key, value)
VALUES ('feature.ais_global_observe_only', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
