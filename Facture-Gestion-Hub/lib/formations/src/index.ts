/**
 * Liste officielle des formations (= prestations) — modifiable en base (CRUD) ;
 * les entrées manquantes sont recréées au démarrage (seed) pour rester alignées.
 */
export const DEFAULT_FORMATION_NAMES: readonly string[] = [
  "Consignation / déconsignation hydraulique",
  "Espaces confinés",
  "Habilitation électrique",
  "Incendie évacuation",
  "Inspection d'echafaudage",
  "Inspection échafaudage",
  "Inspection échafaudage+sst",
  "Montage et démontage d'échafaudage",
  "Montage et démontage échafaudage",
  "Préparation à l'habilitation électrique",
  "Prévention et risques d'incendie",
  "Prévention Incendie",
  "Projet examen préformation",
  "Recyclage habilitation électrique",
  "Recyclage Travaux en hauteur",
  "Risques machines",
  "Sauveteur Secouriste du Travail",
  "Sauveteurs Secouristes du Travail",
  "Sensibilisation aux risques électriques",
  "SST & incendie",
  "Travaux en hauteur",
  "wadi",
] as const;
