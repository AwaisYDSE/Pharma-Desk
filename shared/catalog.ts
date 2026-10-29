// Built-in starter list of medicines commonly sold in Pakistan: brand, formula
// (generic), strength, form, company, category and what it is used for.
// Offered ONCE, when the owner sets up the shop. It cannot be imported later.
// Prices are left at 0 for each shop to set. Always check strength/company on the
// pack and with DRAP — brands and makers change over time.
// © Awais Amin
import type { Medicine } from './types.ts';

// brand | formula | strength | form | company | category | used for | Rx (1 = prescription)
const RAW = `
Panadol|Paracetamol|500mg|Tablet|Haleon|Pain & fever|Mild to moderate pain and fever|0
Panadol Extra|Paracetamol + Caffeine|500mg/65mg|Tablet|Haleon|Pain & fever|Headache and stronger pain|0
Calpol|Paracetamol|120mg/5ml|Syrup|Haleon|Pain & fever|Fever and pain in children|0
Calpol 6 Plus|Paracetamol|250mg/5ml|Syrup|Haleon|Pain & fever|Fever and pain in children over 6|0
Disprin|Aspirin|300mg|Dispersible tablet|Reckitt|Pain & fever|Pain, fever and headache (not for children)|0
Brufen|Ibuprofen|400mg|Tablet|Abbott|Pain & inflammation|Pain, swelling and fever|0
Brufen Syrup|Ibuprofen|100mg/5ml|Syrup|Abbott|Pain & inflammation|Fever and pain in children|0
Arinac|Ibuprofen + Pseudoephedrine|200mg/30mg|Tablet|Abbott|Cold & flu|Blocked nose, cold and flu aches|0
Ponstan|Mefenamic acid|250mg|Capsule|Pfizer|Pain & inflammation|Period pain and mild to moderate pain|0
Ponstan Forte|Mefenamic acid|500mg|Tablet|Pfizer|Pain & inflammation|Period pain and moderate pain|0
Voltral|Diclofenac sodium|50mg|Tablet|Novartis|Pain & inflammation|Joint pain, back pain, arthritis|1
Voltral Emulgel|Diclofenac diethylamine|1%|Gel||Pain & inflammation|Muscle and joint pain (apply on skin)|0
Caflam|Diclofenac potassium|50mg|Tablet|Novartis|Pain & inflammation|Acute pain and swelling|1
Synflex|Naproxen sodium|550mg|Tablet||Pain & inflammation|Pain, arthritis and period pain|1
Mobic|Meloxicam|7.5mg|Tablet|Boehringer Ingelheim|Pain & inflammation|Arthritis pain and stiffness|1
Celbexx|Celecoxib|200mg|Capsule||Pain & inflammation|Arthritis pain|1
Tramal|Tramadol|50mg|Capsule||Pain (strong)|Moderate to severe pain — controlled use|1
Nuberol|Paracetamol + Orphenadrine|450mg/35mg|Tablet||Muscle pain|Muscle spasm and pain|0
Nuberol Forte|Paracetamol + Orphenadrine|650mg/50mg|Tablet||Muscle pain|Muscle spasm and stronger pain|0
Augmentin|Amoxicillin + Clavulanic acid|625mg|Tablet|GSK|Antibiotic|Chest, ear, throat, skin and urine infections|1
Augmentin 1g|Amoxicillin + Clavulanic acid|1g|Tablet|GSK|Antibiotic|Bacterial infections (higher dose)|1
Augmentin Syrup|Amoxicillin + Clavulanic acid|156mg/5ml|Suspension|GSK|Antibiotic|Bacterial infections in children|1
Amoxil|Amoxicillin|500mg|Capsule|GSK|Antibiotic|Bacterial infections|1
Amoxil Syrup|Amoxicillin|125mg/5ml|Suspension|GSK|Antibiotic|Bacterial infections in children|1
Velosef|Cephradine|500mg|Capsule|GSK|Antibiotic|Skin, chest and urine infections|1
Cefspan|Cefixime|400mg|Capsule||Antibiotic|Typhoid, urine and chest infections|1
Cefspan Syrup|Cefixime|100mg/5ml|Suspension||Antibiotic|Infections in children (incl. typhoid)|1
Klaricid|Clarithromycin|500mg|Tablet|Abbott|Antibiotic|Chest infections, H. pylori treatment|1
Azomax|Azithromycin|500mg|Tablet|Novartis|Antibiotic|Chest, throat and typhoid infections|1
Azomax Syrup|Azithromycin|200mg/5ml|Suspension|Novartis|Antibiotic|Infections in children|1
Zithromax|Azithromycin|250mg|Capsule|Pfizer|Antibiotic|Chest, throat and skin infections|1
Ciproxin|Ciprofloxacin|500mg|Tablet|Bayer|Antibiotic|Urine, gut and typhoid infections|1
Novidat|Ciprofloxacin|500mg|Tablet|Sami|Antibiotic|Urine, gut and typhoid infections|1
Leflox|Levofloxacin|500mg|Tablet|Getz Pharma|Antibiotic|Chest, sinus and urine infections|1
Tavanic|Levofloxacin|500mg|Tablet|Sanofi|Antibiotic|Chest, sinus and urine infections|1
Flagyl|Metronidazole|400mg|Tablet|Sanofi|Antibiotic / amoebicide|Amoebic dysentery, gut and dental infections|1
Flagyl Syrup|Metronidazole benzoate|200mg/5ml|Suspension|Sanofi|Antibiotic / amoebicide|Diarrhoea/dysentery infections in children|1
Entamizole|Diloxanide furoate + Metronidazole|500mg/400mg|Tablet|Abbott|Amoebicide|Amoebic dysentery|1
Septran DS|Co-trimoxazole (Sulfamethoxazole + Trimethoprim)|800mg/160mg|Tablet|GSK|Antibiotic|Urine and chest infections|1
Vibramycin|Doxycycline|100mg|Capsule|Pfizer|Antibiotic|Chest infections, acne, some fevers|1
Rocephin|Ceftriaxone|1g|Injection|Roche|Antibiotic|Serious infections incl. typhoid (hospital use)|1
Fucidin|Fusidic acid|2%|Cream|LEO Pharma|Skin antibiotic|Infected cuts, impetigo|0
Polyfax|Polymyxin B + Bacitracin|—|Ointment|GSK|Skin / eye antibiotic|Minor skin and eye infections|0
Bactroban|Mupirocin|2%|Ointment|GSK|Skin antibiotic|Impetigo and infected skin|1
Risek|Omeprazole|20mg|Capsule|Getz Pharma|Acidity / ulcer|Heartburn, acidity, stomach ulcers|0
Risek 40|Omeprazole|40mg|Capsule|Getz Pharma|Acidity / ulcer|Ulcers, severe acidity, H. pylori treatment|1
Nexum|Esomeprazole|40mg|Tablet|Getz Pharma|Acidity / ulcer|Acid reflux and ulcers|1
Losec|Omeprazole|20mg|Capsule|AstraZeneca|Acidity / ulcer|Heartburn and ulcers|0
Motilium|Domperidone|10mg|Tablet|Janssen|Nausea / gut|Nausea, vomiting, bloating|1
Gravinate|Dimenhydrinate|50mg|Tablet|Searle|Nausea|Travel sickness and vomiting|0
Imodium|Loperamide|2mg|Capsule|Janssen|Diarrhoea|Sudden diarrhoea in adults|0
Buscopan|Hyoscine butylbromide|10mg|Tablet||Gut spasm|Stomach cramps and colic|0
Gaviscon|Sodium alginate + Antacids|—|Suspension|Reckitt|Acidity|Heartburn and acid reflux|0
Peditral|Oral rehydration salts|—|Sachet|Searle|Rehydration|Dehydration from diarrhoea/vomiting|0
Duphalac|Lactulose|3.35g/5ml|Syrup|Abbott|Laxative|Constipation|0
Ispaghol|Psyllium husk|—|Sachet||Laxative|Constipation and soft stools|0
ENO|Sodium bicarbonate + Citric acid|—|Sachet|Haleon|Antacid|Quick relief of acidity and gas|0
Ventolin Inhaler|Salbutamol|100mcg/dose|Inhaler|GSK|Asthma|Quick relief of wheeze and asthma attack|1
Ventolin Syrup|Salbutamol|2mg/5ml|Syrup|GSK|Asthma|Wheeze and cough with tight chest|1
Seretide|Salmeterol + Fluticasone|25/250mcg|Inhaler|GSK|Asthma / COPD|Daily asthma and COPD control|1
Symbicort|Budesonide + Formoterol|160/4.5mcg|Inhaler|AstraZeneca|Asthma / COPD|Daily asthma and COPD control|1
Singulair|Montelukast|10mg|Tablet|MSD|Asthma / allergy|Asthma prevention and allergic rhinitis|1
Mucosolvan|Ambroxol|30mg/5ml|Syrup|Boehringer Ingelheim|Cough|Cough with thick phlegm|0
Prospan|Ivy leaf extract|35mg/5ml|Syrup||Cough|Cough with phlegm (herbal)|0
Hydryllin|Diphenhydramine + Ammonium chloride|—|Syrup|Searle|Cough|Cough and cold|0
Telfast|Fexofenadine|120mg|Tablet|Sanofi|Allergy|Hay fever, sneezing, runny nose|0
Telfast 180|Fexofenadine|180mg|Tablet|Sanofi|Allergy|Hives and skin allergy|0
Zyrtec|Cetirizine|10mg|Tablet||Allergy|Sneezing, itching, hives|0
Rigix|Cetirizine|10mg|Tablet||Allergy|Sneezing, itching, hives|0
Softin|Loratadine|10mg|Tablet||Allergy|Non-drowsy allergy relief|0
Avil|Pheniramine|25mg|Tablet|Sanofi|Allergy|Itching and allergic reactions|0
Strepsils|Amylmetacresol + Dichlorobenzyl alcohol|—|Lozenge|Reckitt|Sore throat|Sore throat relief|0
Vicks VapoRub|Menthol + Camphor + Eucalyptus oil|—|Ointment|P&G|Cold|Blocked nose and cough (rub on chest)|0
Glucophage|Metformin|500mg|Tablet|Merck|Diabetes|Type 2 diabetes|1
Glucophage 850|Metformin|850mg|Tablet|Merck|Diabetes|Type 2 diabetes|1
Glucophage XR|Metformin extended release|500mg|Tablet|Merck|Diabetes|Type 2 diabetes (once daily)|1
Amaryl|Glimepiride|2mg|Tablet|Sanofi|Diabetes|Type 2 diabetes|1
Getryl|Glimepiride|2mg|Tablet|Getz Pharma|Diabetes|Type 2 diabetes|1
Diamicron MR|Gliclazide modified release|30mg|Tablet|Servier|Diabetes|Type 2 diabetes|1
Januvia|Sitagliptin|100mg|Tablet|MSD|Diabetes|Type 2 diabetes|1
Galvus|Vildagliptin|50mg|Tablet|Novartis|Diabetes|Type 2 diabetes|1
Galvus Met|Vildagliptin + Metformin|50/500mg|Tablet|Novartis|Diabetes|Type 2 diabetes|1
Jardiance|Empagliflozin|10mg|Tablet|Boehringer Ingelheim|Diabetes / heart|Type 2 diabetes, heart failure|1
Forxiga|Dapagliflozin|10mg|Tablet|AstraZeneca|Diabetes / heart / kidney|Type 2 diabetes, heart failure, kidney disease|1
Mixtard 30|Human insulin 30/70|100IU/ml|Injection|Novo Nordisk|Diabetes (insulin)|Diabetes — keep in fridge|1
Lantus|Insulin glargine|100IU/ml|Injection|Sanofi|Diabetes (insulin)|Long-acting insulin — keep in fridge|1
Concor|Bisoprolol|5mg|Tablet|Merck|Heart / BP|High blood pressure, heart failure, angina|1
Tenormin|Atenolol|50mg|Tablet|AstraZeneca|Heart / BP|High blood pressure and angina|1
Inderal|Propranolol|10mg|Tablet||Heart / BP|Fast heartbeat, tremor, migraine prevention|1
Norvasc|Amlodipine|5mg|Tablet|Pfizer|Heart / BP|High blood pressure and angina|1
Cozaar|Losartan|50mg|Tablet|MSD|Heart / BP|High blood pressure, kidney protection in diabetes|1
Diovan|Valsartan|80mg|Tablet|Novartis|Heart / BP|High blood pressure and heart failure|1
Tritace|Ramipril|5mg|Capsule|Sanofi|Heart / BP|High blood pressure, after heart attack|1
Coversyl|Perindopril|5mg|Tablet|Servier|Heart / BP|High blood pressure|1
Capoten|Captopril|25mg|Tablet||Heart / BP|High blood pressure|1
Lasix|Furosemide|40mg|Tablet|Sanofi|Diuretic|Swelling (oedema) and fluid in lungs|1
Aldactone|Spironolactone|25mg|Tablet|Pfizer|Diuretic|Heart failure, fluid retention|1
Lipitor|Atorvastatin|20mg|Tablet|Pfizer|Cholesterol|High cholesterol, heart attack prevention|1
Crestor|Rosuvastatin|10mg|Tablet|AstraZeneca|Cholesterol|High cholesterol|1
Plavix|Clopidogrel|75mg|Tablet|Sanofi|Blood thinner|Prevents clots after heart attack/stent|1
Loprin|Aspirin|75mg|Tablet|Highnoon|Blood thinner|Prevents heart attack and stroke|0
Xarelto|Rivaroxaban|20mg|Tablet|Bayer|Blood thinner|Prevents clots and stroke (AF)|1
Warfarin|Warfarin|5mg|Tablet||Blood thinner|Prevents clots — needs INR checks|1
Lanoxin|Digoxin|0.25mg|Tablet||Heart|Heart failure and irregular heartbeat|1
Angised|Glyceryl trinitrate|0.5mg|Sublingual tablet|GSK|Heart (angina)|Chest pain (angina) — under the tongue|1
Isordil|Isosorbide dinitrate|10mg|Tablet||Heart (angina)|Angina prevention|1
Surbex Z|Multivitamin + Zinc|—|Tablet|Abbott|Vitamins|Vitamin B, C and zinc supplement|0
Neurobion|Vitamin B1 + B6 + B12|—|Tablet|Merck|Vitamins|Nerve pain and vitamin B deficiency|0
CaC-1000 Plus|Calcium + Vitamin C|1000mg|Effervescent tablet||Vitamins & minerals|Calcium supplement|0
Sunny D|Cholecalciferol (Vitamin D3)|200,000IU|Capsule||Vitamins|Vitamin D deficiency|0
Indrop D|Cholecalciferol (Vitamin D3)|—|Drops||Vitamins|Vitamin D for babies and children|0
Folic Acid|Folic acid|5mg|Tablet||Vitamins|Anaemia and pregnancy|0
Fefol|Ferrous sulphate + Folic acid|—|Capsule|GSK|Iron|Iron-deficiency anaemia, pregnancy|0
Zincat|Zinc sulphate|20mg/5ml|Syrup||Minerals|Zinc for children with diarrhoea|0
Lexotanil|Bromazepam|3mg|Tablet|Roche|Anxiety|Anxiety — controlled medicine|1
Xanax|Alprazolam|0.5mg|Tablet|Pfizer|Anxiety|Anxiety and panic — controlled medicine|1
Rivotril|Clonazepam|0.5mg|Tablet|Roche|Epilepsy / anxiety|Fits and panic — controlled medicine|1
Tegral|Carbamazepine|200mg|Tablet|Novartis|Epilepsy|Fits and nerve pain|1
Epival|Sodium valproate|500mg|Tablet|Abbott|Epilepsy|Fits and bipolar disorder|1
Lyrica|Pregabalin|75mg|Capsule|Pfizer|Nerve pain|Nerve pain, fibromyalgia, fits|1
Cipralex|Escitalopram|10mg|Tablet|Lundbeck|Depression / anxiety|Depression and anxiety|1
Prozac|Fluoxetine|20mg|Capsule|Eli Lilly|Depression|Depression, OCD|1
Tryptanol|Amitriptyline|25mg|Tablet||Depression / pain|Depression, nerve pain, migraine prevention|1
Euthyrox|Levothyroxine|50mcg|Tablet|Merck|Thyroid|Underactive thyroid|1
Neo-Mercazole|Carbimazole|5mg|Tablet||Thyroid|Overactive thyroid|1
Deltacortril|Prednisolone|5mg|Tablet|Pfizer|Steroid|Asthma, allergy and inflammation|1
Decadron|Dexamethasone|4mg/ml|Injection||Steroid|Severe allergy and inflammation|1
Betnovate|Betamethasone valerate|0.1%|Cream|GSK|Skin steroid|Eczema and skin inflammation|1
Dermovate|Clobetasol propionate|0.05%|Cream|GSK|Skin steroid|Severe eczema, psoriasis|1
Canesten|Clotrimazole|1%|Cream|Bayer|Antifungal|Ringworm, fungal skin and thrush|0
Daktarin Oral Gel|Miconazole|2%|Gel|Janssen|Antifungal|Oral thrush|0
Diflucan|Fluconazole|150mg|Capsule|Pfizer|Antifungal|Vaginal thrush and fungal infections|1
Lamisil|Terbinafine|1%|Cream|Novartis|Antifungal|Athlete's foot and ringworm|0
Zovirax|Aciclovir|5%|Cream|GSK|Antiviral|Cold sores|0
Acyclovir|Aciclovir|400mg|Tablet||Antiviral|Chickenpox, shingles, herpes|1
Permethrin|Permethrin|5%|Cream||Scabies|Scabies and lice|0
Tobradex|Tobramycin + Dexamethasone|0.3%/0.1%|Eye drops|Alcon|Eye|Eye infection with inflammation|1
Vigamox|Moxifloxacin|0.5%|Eye drops|Alcon|Eye antibiotic|Bacterial eye infections|1
Zentel|Albendazole|400mg|Tablet|GSK|Worms|Intestinal worms|0
Vermox|Mebendazole|100mg|Tablet|Janssen|Worms|Threadworm and roundworm|0
Coartem|Artemether + Lumefantrine|20/120mg|Tablet|Novartis|Malaria|Malaria treatment|1
Duphaston|Dydrogesterone|10mg|Tablet|Abbott|Women's health|Period problems and pregnancy support|1
Primolut-N|Norethisterone|5mg|Tablet|Bayer|Women's health|Heavy periods, delaying periods|1
Clomid|Clomifene|50mg|Tablet||Women's health|Helps ovulation (fertility)|1
Viagra|Sildenafil|50mg|Tablet|Pfizer|Men's health|Erectile dysfunction — never with nitrates|1
Flomax|Tamsulosin|0.4mg|Capsule||Urology|Enlarged prostate, urine flow|1
`;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function builtinCatalog(): Medicine[] {
  return RAW.trim().split('\n').map(line => {
    const [name, generic, strength, form, manufacturer, category, description, rx] = line.split('|');
    return {
      id: `cat-${slug(name)}`, name, generic, strength: strength === '—' ? '' : strength, form, manufacturer, category, description,
      rxRequired: rx === '1', salePrice: 0, gstBp: 0, reorderLevel: 10, reorderQty: 0, altBarcodes: [], source: 'catalog' as const,
    };
  });
}
