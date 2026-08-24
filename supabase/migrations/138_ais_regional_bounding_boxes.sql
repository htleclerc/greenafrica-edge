-- Les boites d'abonnement du flux AIS regional deviennent une configuration.
--
-- Elles etaient en dur dans le binaire Go : une seule zone, lat 5..25 /
-- lon 40..75. Mesure du 2026-08-24 avec la vraie cle et le code d'abonnement
-- exact : zero message en dix minutes sur cette boite, contre 25 positions
-- instantanees sur un controle en Manche. aisstream agrege des recepteurs
-- terrestres benevoles et il n'y en a pas autour de la Corne de l'Afrique.
--
-- L'elargissement ne cree pas de couverture la ou il n'y en a pas : il sert a
-- voir le navire la ou il EST visible, en amont de son approche. D'ou quatre
-- zones qui couvrent les routes vers Berbera et Zeila plutot que leur seul
-- voisinage.
--
-- Format aisstream : [[lat_min, lon_min], [lat_max, lon_max]].
-- Le backend valide la valeur (bornes, coins non inverses) et retombe sur son
-- defaut embarque si elle est absente ou mal formee — une boite invalide ne
-- fait PAS echouer l'abonnement cote aisstream, elle le laisse simplement
-- vide, ce qui se lit comme une absence de trafic.

INSERT INTO public.app_config (key, value)
VALUES (
  'ais.regional_bounding_boxes',
  '[
     [[12, 32], [32, 44]],
     [[0, 40], [28, 78]],
     [[-36, 20], [2, 56]],
     [[-12, 78], [22, 106]]
   ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_config IS
  'Configuration applicative en JSONB. ais.regional_bounding_boxes : zones AIS surveillees, cf migration 138.';
