C'est une étape cruciale. Puisque vous n'avez pas accès aux compteurs de carburant internes des navires, vous devez utiliser une méthode d'estimation **"Bottom-Up" basée sur les données AIS**. C'est le modèle standard utilisé par l'Organisation Maritime Internationale (OMI) et l'ICCT (International Council on Clean Transportation) pour calculer les émissions mondiales.

La solution technologique que vous déployez doit calculer automatiquement les distances parcourues et les émissions estimées pour générer l'assiette de contribution.

Voici l'algorithme détaillé et le modèle mathématique à implémenter dans le backend de **Green-Gate OS**.

### 1. Le Modèle Mathématique (Méthode de la Loi Cubique)

La consommation d'un navire n'est pas linéaire ; elle dépend de manière cubique de sa vitesse. L'algorithme se calcule segment par segment (entre deux points AIS).

Pour chaque segment entre deux pings AIS, l'émission de $CO_2$ est calculée ainsi :

$$E_{CO2} = P_{utilise} \times SFOC \times \Delta t \times C_F$$

**Où :**

* $P_{utilise}$ : Puissance moteur utilisée (en kW). Calculée par la loi cubique : $P_{utilise} = P_{max} \times \left( \frac{V_{actuelle}}{V_{max}} \right)^3$
* $SFOC$ (Specific Fuel Oil Consumption) : Consommation spécifique du moteur (généralement entre **175 et 195 g/kWh** pour les gros moteurs lents).
* $\Delta t$ : Le temps écoulé entre deux relevés AIS (en heures).
* $C_F$ : Le facteur de conversion Carbone défini par l'OMI.

### 2. Les Constantes de Référence (Facteurs d'Émission OMI)

Votre système devra utiliser ces constantes ($C_F$) en fonction du carburant présumé du navire (souvent du HFO par défaut pour les gros porteurs) :

* **HFO (Heavy Fuel Oil) :** $3.114$ tonnes de CO2 par tonne de carburant.
* **MDO/MGO (Marine Diesel/Gas Oil) :** $3.206$ tonnes de CO2 par tonne de carburant.
* **LNG (Gaz Naturel Liquéfié) :** $2.750$ tonnes de CO2 par tonne de carburant.

---

### 3. L'Algorithme (Pseudo-code Python)

Voici la logique métier que votre développeur backend (Python/Django ou Node) devra intégrer au **Module 2 (Moteur de Tarification)**.

```python
import math

# --- CONSTANTES OMI ---
CF_HFO = 3.114 # Facteur d'émission pour le fioul lourd (Tonne CO2 / Tonne Carburant)
SFOC = 185 # Consommation moyenne g/kWh (peut être ajusté selon l'âge du navire)

def calculer_emissions_trajet(historique_positions_ais, profil_navire):
    """
    Calcule les émissions totales d'un navire lors de son passage dans la ZEE du Somaliland.
    """
    emissions_totales_co2 = 0.0
    distance_totale_nm = 0.0
    
    # Récupérer les données techniques du navire depuis la BDD (US 2.1)
    puissance_max_kw = profil_navire.engine_power_kw
    vitesse_design_noeuds = profil_navire.design_speed_knots

    # Boucle sur chaque point AIS capté dans la ZEE
    for i in range(1, len(historique_positions_ais)):
        point_A = historique_positions_ais[i-1]
        point_B = historique_positions_ais[i]
        
        # 1. Calcul du temps écoulé (Delta t) en heures
        delta_t_heures = (point_B.timestamp - point_A.timestamp).total_seconds() / 3600.0
        
        # 2. Vitesse actuelle (idéalement prise de l'AIS, sinon calculée par distance/temps)
        vitesse_actuelle = point_B.vitesse_noeuds
        
        # Si le navire est à l'arrêt ou presque (ex: ancrage), la propulsion principale est coupée.
        # (On ne compte que les générateurs auxiliaires, simplifié ici à 5% de la puissance)
        if vitesse_actuelle < 1.0:
            puissance_utilisee = puissance_max_kw * 0.05
        else:
            # 3. Loi cubique : Puissance requise à cette vitesse
            # On empêche de dépasser 100% de la puissance max
            ratio_vitesse = min(vitesse_actuelle / vitesse_design_noeuds, 1.0)
            puissance_utilisee = puissance_max_kw * (ratio_vitesse ** 3)
        
        # 4. Calcul de la consommation de carburant sur ce segment (en Tonnes)
        # Formule: (kW * g/kWh * heures) / 1,000,000 pour avoir des tonnes
        carburant_consomme_tonnes = (puissance_utilisee * SFOC * delta_t_heures) / 1000000.0
        
        # 5. Conversion en CO2
        co2_segment = carburant_consomme_tonnes * CF_HFO
        
        # Ajout au total
        emissions_totales_co2 += co2_segment
        
    return emissions_totales_co2

# --- EXEMPLE D'APPEL ---
# emission = calculer_emissions_trajet(points_ais_dans_zee, porte_conteneurs_msc)
# prix_taxe = emission * TAUX_TAXE_CARBONE_USD

```

### 4. Conseil d'implémentation pour Green-Gate

Dans un premier temps (Phase 1), l'objectif de Green-Gate est de garantir un recouvrement rapide et d'éviter les lourdeurs administratives.

**Mon conseil :** Ne bloquez pas le lancement de votre produit si vous n'avez pas immédiatement accès à la "Puissance Moteur ($P_{max}$)" exacte de chaque navire.

Pour votre MVP :

1. Faites un "Fallback" (solution de repli) : Créez une table de correspondance simple dans votre base de données.
* *Porte-conteneurs (Moyen)* = **$150$ tonnes de CO2 / jour de navigation**.
* *Vraquier (Petit)* = **$45$ tonnes de CO2 / jour**.


2. Calculez simplement le temps passé dans la ZEE via l'AIS, et multipliez par ce forfait journalier.
3. Utilisez l'algorithme cubique complet (ci-dessus) pour la **Phase 3**, lorsque le système se transformera en modèle hybride avec un registre interopérable aux standards internationaux.



Voulez-vous que je structure les **User Stories du Module 2** (qui incluront cet algorithme et la génération du PDF de la facture) pour boucler le cahier des charges de votre équipe technique ?