// Offline drug-interaction check — used when Gemini is unavailable (no key, no
// internet, 429 rate limit). It is a BASIC list of well-known dangerous pairs,
// not a complete database. The pharmacist always makes the final decision.

export type Severity = 'contraindicated' | 'major' | 'moderate';
export interface InteractionWarning { a: string; b: string; severity: Severity; effect: string; advice: string; source: 'ai' | 'offline' }

const CLASSES: Record<string, string[]> = {
  warfarin: ['warfarin', 'acenocoumarol'],
  nsaid: ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'ketorolac', 'celecoxib', 'piroxicam', 'indomethacin', 'etoricoxib'],
  azole_macrolide_quinolone_metro: ['metronidazole', 'fluconazole', 'ciprofloxacin', 'clarithromycin', 'erythromycin', 'ketoconazole', 'levofloxacin'],
  pde5: ['sildenafil', 'tadalafil', 'vardenafil'],
  nitrate: ['isosorbide', 'nitroglycerin', 'glyceryl trinitrate'],
  statin_cyp3a4: ['simvastatin', 'atorvastatin', 'lovastatin'],
  macrolide: ['clarithromycin', 'erythromycin'],
  methotrexate: ['methotrexate'],
  trimethoprim: ['trimethoprim', 'co-trimoxazole', 'sulfamethoxazole'],
  raas: ['enalapril', 'lisinopril', 'captopril', 'ramipril', 'perindopril', 'losartan', 'valsartan', 'irbesartan', 'telmisartan', 'olmesartan'],
  potassium: ['spironolactone', 'eplerenone', 'potassium chloride', 'potassium citrate', 'amiloride'],
  ssri: ['fluoxetine', 'sertraline', 'escitalopram', 'citalopram', 'paroxetine', 'fluvoxamine'],
  tramadol: ['tramadol'],
  clopidogrel: ['clopidogrel'],
  ppi_2c19: ['omeprazole', 'esomeprazole'],
  digoxin: ['digoxin'],
  digoxin_raisers: ['amiodarone', 'verapamil', 'clarithromycin'],
  lithium: ['lithium'],
  lithium_raisers: ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'hydrochlorothiazide', 'enalapril', 'lisinopril', 'captopril', 'losartan'],
  theophylline: ['theophylline', 'aminophylline'],
  cipro: ['ciprofloxacin'],
  tizanidine: ['tizanidine'],
  tizanidine_blockers: ['ciprofloxacin', 'fluvoxamine'],
  domperidone: ['domperidone'],
  qt_raisers: ['clarithromycin', 'erythromycin', 'ketoconazole', 'fluconazole'],
  allopurinol: ['allopurinol'],
  azathioprine: ['azathioprine', 'mercaptopurine'],
  quinolone: ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin'],
  chelators: ['aluminium', 'aluminum', 'magnesium', 'calcium', 'ferrous', 'iron', 'zinc', 'sucralfate'],
};

const RULES: [string, string, Severity, string, string][] = [
  ['warfarin', 'nsaid', 'major', 'Higher risk of serious bleeding', 'Avoid together; prefer paracetamol for pain'],
  ['warfarin', 'azole_macrolide_quinolone_metro', 'major', 'Raises warfarin effect (INR) — bleeding risk', 'Doctor should check INR or choose another drug'],
  ['pde5', 'nitrate', 'contraindicated', 'Dangerous drop in blood pressure', 'Do not sell together'],
  ['statin_cyp3a4', 'macrolide', 'major', 'Muscle damage (myopathy) risk', 'Ask doctor; statin is often paused during the antibiotic'],
  ['methotrexate', 'trimethoprim', 'major', 'Methotrexate toxicity (bone marrow)', 'Avoid together'],
  ['methotrexate', 'nsaid', 'major', 'Methotrexate toxicity', 'Check with doctor'],
  ['raas', 'potassium', 'major', 'High potassium (hyperkalaemia)', 'Doctor should monitor potassium'],
  ['ssri', 'tramadol', 'major', 'Serotonin syndrome and seizure risk', 'Check with doctor'],
  ['clopidogrel', 'ppi_2c19', 'moderate', 'Omeprazole/esomeprazole can weaken clopidogrel', 'Pantoprazole is usually preferred'],
  ['digoxin', 'digoxin_raisers', 'major', 'Digoxin toxicity', 'Doctor should adjust dose'],
  ['lithium', 'lithium_raisers', 'major', 'Lithium toxicity', 'Check with doctor'],
  ['theophylline', 'cipro', 'major', 'Theophylline toxicity', 'Check with doctor'],
  ['tizanidine', 'tizanidine_blockers', 'contraindicated', 'Severe low blood pressure and sedation', 'Do not sell together'],
  ['domperidone', 'qt_raisers', 'major', 'Heart rhythm problem (QT prolongation)', 'Avoid together'],
  ['allopurinol', 'azathioprine', 'major', 'Azathioprine toxicity', 'Doctor must reduce dose'],
  ['quinolone', 'chelators', 'moderate', 'Antibiotic is absorbed poorly', 'Take antibiotic 2 h before or 6 h after'],
];

const classesOf = (generic: string): string[] => {
  const g = generic.toLowerCase();
  return Object.entries(CLASSES).filter(([, names]) => names.some(n => g.includes(n))).map(([k]) => k);
};

export interface DrugRef { name: string; generic: string }

/** Pairwise check of every medicine on the bill, plus same-ingredient duplicates. */
export function checkInteractionsOffline(drugs: DrugRef[]): InteractionWarning[] {
  const out: InteractionWarning[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const A = drugs[i], B = drugs[j];
      const ca = classesOf(A.generic || A.name), cb = classesOf(B.generic || B.name);
      for (const [x, y, severity, effect, advice] of RULES) {
        if ((ca.includes(x) && cb.includes(y)) || (ca.includes(y) && cb.includes(x))) {
          const key = [A.name, B.name, effect].join('|');
          if (!seen.has(key)) { seen.add(key); out.push({ a: A.name, b: B.name, severity, effect, advice, source: 'offline' }); }
        }
      }
      // Therapeutic duplication — e.g. two products that both contain paracetamol or two NSAIDs.
      const ga = (A.generic || '').toLowerCase(), gb = (B.generic || '').toLowerCase();
      const shared = ['paracetamol', 'acetaminophen'].find(p => ga.includes(p) && gb.includes(p));
      if (shared) out.push({ a: A.name, b: B.name, severity: 'major', effect: `Both contain ${shared} — overdose risk`, advice: 'Usually sell only one', source: 'offline' });
      else if (ca.includes('nsaid') && cb.includes('nsaid')) out.push({ a: A.name, b: B.name, severity: 'moderate', effect: 'Two painkillers of the same type (NSAIDs) — stomach bleeding risk', advice: 'Usually sell only one', source: 'offline' });
    }
  }
  const rank: Record<Severity, number> = { contraindicated: 0, major: 1, moderate: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
